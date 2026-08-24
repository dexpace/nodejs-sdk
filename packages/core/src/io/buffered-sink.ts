// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-sink.ts
import {invariant} from '../invariant.js';
import type {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import type {Sink} from './sink.js';
import {encodeText} from './text-codec.js';

/**
 * A buffered byte sink over a `WritableStream<Uint8Array>` (IO-4, IO-5, IO-13, IO-18).
 *
 * Takes no `AbortSignal` and imposes no timeout (IO-40). Not safe for concurrent use (IO-37).
 *
 * @internal
 */
export class BufferedSink implements Sink {
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  #closed = false;
  #closing: Promise<void> | undefined;
  /**
   * The most recent downstream write, settled or not.
   *
   * `emit()` and `flush()` await this rather than returning unconditionally. Without it neither method
   * observes the writer at all: both report success on a stream that has already errored, and `flush()`
   * resolves while a write started with `void sink.write(...)` is still outstanding — so IO-18's
   * emit/flush distinction is unobservable in the only direction that matters.
   */
  #lastWrite: Promise<void> = Promise.resolve();

  private constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
    this.#writer = writer;
  }

  /** Wrap a caller-supplied stream (IO-30). */
  static overStream(stream: WritableStream<Uint8Array>): BufferedSink {
    return new BufferedSink(stream.getWriter());
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Remove exactly `count` bytes from `src`'s head and push them downstream (IO-4). Fails rather than
   * writing a partial amount when `src` holds fewer.
   *
   * `src` is drained only AFTER the downstream write resolves. Consuming first — the obvious reading of
   * "remove, then push" — destroys the payload when the write fails, leaving the caller that catches the
   * rejection with nothing to retry and nothing on the wire.
   */
  async write(src: ByteQueue, count: number): Promise<void> {
    assertCount(count);
    this.#assertOpen();
    if (count === 0) return;
    if (src.size < count) throw new EndOfStreamError(src.size, count);
    await this.#push(src.copyOut(0, count));
    src.skip(count);
  }

  /** Encode and write UTF-8 text (IO-13). */
  async writeUtf8(text: string): Promise<void> {
    return this.writeString(text, 'utf-8');
  }

  /**
   * Encode and write text with an explicit charset (IO-13).
   *
   * An empty payload writes NOTHING rather than a zero-length chunk, matching `write(src, 0)`, the tee,
   * and the bridge. A zero-length chunk is not inert on the wire: to an HTTP/1.1 chunked-encoding
   * transport it is the terminating chunk, so emitting one for `writeUtf8('')` can end a request body
   * early.
   */
  async writeString(text: string, charset: string): Promise<void> {
    this.#assertOpen();
    const encoded = encodeText(text, charset);
    if (encoded.length === 0) return;
    await this.#push(encoded);
  }

  /**
   * IO-18: a full force-out toward the destination — the outstanding write must reach the destination
   * AND the destination must have drained.
   */
  async flush(): Promise<BufferedSink> {
    this.#assertOpen();
    await this.#lastWrite;
    await this.#writer.ready;
    return this;
  }

  /**
   * IO-18: a cheap one-level handoff — hand the buffered bytes to the underlying stream and surface any
   * failure, without waiting for the destination to drain.
   */
  async emit(): Promise<BufferedSink> {
    this.#assertOpen();
    await this.#lastWrite;
    return this;
  }

  /**
   * IO-5, IO-41: closeable and idempotent, and the underlying resource is released at most once.
   *
   * Memoized rather than flag-guarded. Setting `#closed` before awaiting and early-returning on it means
   * a close that FAILS is reported as a success to every later caller — `sink.closed` reads `true` for a
   * destination that was never released, and the retry silently resolves. Handing every caller the same
   * promise makes the failure propagate on every path (BODY-27) while still closing at most once.
   */
  async close(): Promise<void> {
    this.#closing ??= this.#release(async () => this.#writer.close());
    return this.#closing;
  }

  /**
   * IO-42: discard the destination with a reason rather than committing what was written. Shares the
   * close latch, so a sink is torn down exactly once whichever path gets there first.
   */
  async abort(reason?: unknown): Promise<void> {
    this.#closing ??= this.#release(async () => this.#writer.abort(reason));
    return this.#closing;
  }

  /**
   * A writable host-native byte-stream bridge (IO-16). Closing the bridge closes the sink; ABORTING it
   * aborts the sink, carrying the reason through.
   */
  toWritableStream(): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      write: async (chunk): Promise<void> => {
        if (chunk.length === 0) return;
        await this.#push(chunk);
      },
      close: async (): Promise<void> => {
        await this.close();
      },
      // Forwarding the reason matters: collapsing an abort into a graceful close commits a cancelled
      // request body downstream as a well-formed complete one, so the peer cannot tell an aborted upload
      // from a successful short one.
      abort: async (reason: unknown): Promise<void> => {
        await this.abort(reason);
      },
    });
  }

  /** Track the in-flight write so `emit`/`flush` can observe it, without leaking an unhandled rejection. */
  async #push(payload: Uint8Array): Promise<void> {
    const pending = this.#writer.write(payload);
    this.#lastWrite = pending;
    // A caller may start a write with `void sink.write(...)` and only learn of the failure at the next
    // `emit()`/`flush()`. Marking the promise handled here keeps that from surfacing as an unhandled
    // rejection first; `pending` itself still rejects for everyone awaiting it.
    pending.catch(() => undefined);
    await pending;
  }

  async #release(teardown: () => Promise<void>): Promise<void> {
    this.#closed = true;
    await teardown();
  }

  /** IO-42: a stream-backed sink rejects writes, flushes, and emits after close. */
  #assertOpen(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSink');
  }
}

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${String(count)}`,
  );
}
