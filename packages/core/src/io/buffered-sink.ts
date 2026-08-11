// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-sink.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, IoError} from './errors.js';

/**
 * A buffered byte sink over a `WritableStream<Uint8Array>` (IO-4, IO-5, IO-13, IO-18).
 *
 * Takes no `AbortSignal` and imposes no timeout (IO-40). Not safe for concurrent use (IO-37).
 *
 * @internal
 */
export class BufferedSink {
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  #closed = false;

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
   */
  async write(src: ByteQueue, count: number): Promise<void> {
    assertCount(count);
    this.#assertOpen();
    if (count === 0) return;
    // takeBytes raises EndOfStreamError when the source is short, before anything reaches the wire.
    const payload = src.takeBytes(count);
    await this.#writer.write(payload);
  }

  /** Encode and write UTF-8 text (IO-13). */
  async writeUtf8(text: string): Promise<void> {
    return this.writeString(text, 'utf-8');
  }

  /**
   * Encode and write text with an explicit charset (IO-13).
   *
   * The write side supports UTF-8 and ISO-8859-1 only. `TextEncoder` is UTF-8-only — there is no
   * `TextEncoder('iso-8859-1')` — and SEAM-1 forbids an encoding dependency, so full symmetry with the
   * read side is not reachable. These are the two encodings HTTP needs, and IO-13's own conformance note
   * names ISO-8859-1. Any other label throws rather than silently re-encoding as UTF-8, which would
   * corrupt the bytes on the wire.
   */
  async writeString(text: string, charset: string): Promise<void> {
    this.#assertOpen();
    await this.#writer.write(encodeText(text, charset));
  }

  /** IO-18: a full force-out toward the destination. */
  async flush(): Promise<BufferedSink> {
    this.#assertOpen();
    await this.#writer.ready;
    return this;
  }

  /** IO-18: a cheap one-level handoff, distinguished from `flush`. */
  async emit(): Promise<BufferedSink> {
    this.#assertOpen();
    return Promise.resolve(this);
  }

  /** IO-5, IO-41: closeable and idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writer.close();
  }

  /**
   * A writable host-native byte-stream bridge (IO-16). Closing the bridge closes the sink.
   */
  toWritableStream(): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      write: async (chunk): Promise<void> => {
        const staging = new ByteQueue();
        staging.writeBytes(chunk);
        await this.write(staging, staging.size);
      },
      close: async (): Promise<void> => {
        await this.close();
      },
      abort: async (): Promise<void> => {
        await this.close();
      },
    });
  }

  /** IO-42: a stream-backed sink rejects writes, flushes, and emits after close. */
  #assertOpen(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSink');
  }
}

/**
 * The single source of truth for write-side encoding (IO-13).
 *
 * Exported because `TeeSink` must mirror the exact bytes this sink will emit. A second copy there would
 * be two implementations of one encoding rule, free to drift — the same DRY hazard that had the RFC 3986
 * encoder extracted in Phase 2. Keeping the charset *rejection* here too means `TeeSink` cannot
 * accidentally accept a label the primary would refuse.
 *
 * ISO-8859-1 is a direct code-point-to-byte map for 0–255; anything above is not representable.
 */
export function encodeText(text: string, charset: string): Uint8Array {
  const normalized = charset.toLowerCase();
  if (normalized === 'utf-8' || normalized === 'utf8')
    return new TextEncoder().encode(text);
  if (normalized !== 'iso-8859-1' && normalized !== 'latin1') {
    throw new IoError(
      `unsupported write charset: ${charset} (only utf-8 and iso-8859-1 can be encoded)`,
    );
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new IoError(
        `code point ${String(code)} is not representable in ${charset}`,
      );
    }
    out[i] = code;
  }
  return out;
}

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${String(count)}`,
  );
}
