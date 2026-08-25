// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-source.ts
import {invariant} from '../invariant.js';
import {ByteQueue, copyBytes} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import {assertAllocatable, END_OF_STREAM} from './limits.js';
import {RetentionWindow, type Cursor} from './retention-window.js';
import {assertDecodable, decodeText} from './text-codec.js';

/**
 * A buffered, non-blocking byte source over a `ReadableStream<Uint8Array>` (IO-11–IO-24).
 *
 * Peek and slice views are instances of this same class over the same `RetentionWindow`, differing only in
 * their cursor, their byte budget, and whether they own the window. A second class would need either
 * inheritance — which styleguide 6.4 reserves for `Error` hierarchies — or ten duplicated delegating
 * methods.
 *
 * Takes no `AbortSignal` and imposes no timeout: IO-40 assigns deadlines and prompt cancellation of
 * blocked I/O to the transport that owns the real socket. Not safe for concurrent use (IO-37).
 *
 * @internal
 */
export class BufferedSource {
  readonly #window: RetentionWindow;
  readonly #cursor: Cursor;
  readonly #ownsWindow: boolean;
  readonly #limit: number;
  readonly #startedAt: number;
  #closed = false;

  // eslint-disable-next-line max-params -- private, view-internal plumbing; peek()/slice() are the public entry points (0-2 params each)
  private constructor(
    window: RetentionWindow,
    cursor: Cursor,
    ownsWindow: boolean,
    limit: number,
  ) {
    this.#window = window;
    this.#cursor = cursor;
    this.#ownsWindow = ownsWindow;
    this.#limit = limit;
    this.#startedAt = cursor.at;
  }

  /** Wrap a caller-supplied stream (IO-30). */
  static overStream(stream: ReadableStream<Uint8Array>): BufferedSource {
    const window = new RetentionWindow(stream.getReader());
    return new BufferedSource(
      window,
      window.register(0),
      true,
      Number.POSITIVE_INFINITY,
    );
  }

  /** Wrap a byte array as an independent copy (IO-30). */
  static overBytes(bytes: Uint8Array): BufferedSource {
    const copy = copyBytes(bytes);
    return BufferedSource.overStream(
      new ReadableStream<Uint8Array>({
        start(controller): void {
          if (copy.length > 0) controller.enqueue(copy);
          controller.close();
        },
      }),
    );
  }

  /**
   * Whether this source can still be read.
   *
   * Must consider the window, not just this instance's own flag: a peek/slice view is invalidated when
   * its parent closes the window (IO-22) without anything touching the view's flag, so reading `#closed`
   * alone reports an unusable view as open — making the natural guard `if (!view.closed) …` take the
   * throwing branch every time, which is the opposite of what exposing the flag is for.
   */
  get closed(): boolean {
    return this.#closed || this.#window.closed;
  }

  /** Read up to `count` bytes onto `dest`'s tail (IO-1, IO-2, IO-3). */
  async read(dest: ByteQueue, count: number): Promise<number> {
    assertCount(count);
    this.#assertOpen();
    // IO-2 before any exhaustion determination — a zero-count read is 0, never END_OF_STREAM.
    if (count === 0) return 0;
    const want = Math.min(count, this.#remainingBudget());
    if (want <= 0) return END_OF_STREAM;
    const available = await this.#window.pullThrough(this.#cursor.at + 1);
    if (!available) return END_OF_STREAM;
    return this.#window.readInto(this.#cursor, dest, want);
  }

  /** True exactly when no more bytes are available (IO-11). */
  async exhausted(): Promise<boolean> {
    this.#assertOpen();
    if (this.#remainingBudget() <= 0) return true;
    return !(await this.#window.pullThrough(this.#cursor.at + 1));
  }

  /** The next byte, or a failure at end of stream (IO-11). */
  async readByte(): Promise<number> {
    const [value] = await this.readExactly(1);
    invariant(value !== undefined, 'readExactly(1) returned an empty array');
    return value;
  }

  /** Every remaining byte; empty when already exhausted (IO-11). */
  async readBytes(): Promise<Uint8Array> {
    this.#assertOpen();
    const staging = new ByteQueue();
    while ((await this.read(staging, READ_CHUNK)) !== END_OF_STREAM) {
      // IO-9: check as we go, not at the `snapshot()` at the end. A count-less read cannot know the
      // total up front, but deferring the check until materialization means a multi-gigabyte body is
      // fully buffered first — so the process is far likelier to die of a low-level allocation failure
      // than to reach the actionable refusal IO-9 exists to produce.
      assertAllocatable(staging.size);
    }
    return staging.snapshot();
  }

  /** Exactly `count` bytes, or a failure — never a short result (IO-12). */
  async readExactly(count: number): Promise<Uint8Array> {
    assertCount(count);
    this.#assertOpen();
    // IO-9: refuse eagerly with an actionable error. Routing this through ByteQueue would raise
    // EndOfStreamError instead, since takeBytes checks its size before it ever tries to allocate.
    assertAllocatable(count);
    const staging = new ByteQueue();
    while (staging.size < count) {
      const read = await this.read(staging, count - staging.size);
      if (read === END_OF_STREAM)
        throw new EndOfStreamError(staging.size, count);
    }
    return staging.takeBytes(count);
  }

  /** Decode `count` bytes (or every remaining byte) as UTF-8 (IO-13). */
  async readUtf8(count?: number): Promise<string> {
    return this.readString('utf-8', count);
  }

  /** Decode `count` bytes (or every remaining byte) with an explicit charset (IO-13). */
  async readString(charset: string, count?: number): Promise<string> {
    this.#assertOpen();
    // Reject an unusable label BEFORE consuming bytes, so a bad charset does not also destroy the body.
    assertDecodable(charset);
    const raw =
      count === undefined
        ? await this.readBytes()
        : await this.readExactly(count);
    return decodeText(raw, charset);
  }

  /**
   * The next line as UTF-8, with its terminator consumed (IO-14).
   *
   * Both `\n` and `\r\n` terminate. A lone `\r` not followed by `\n` stays line content, which falls out
   * of scanning only for `\n`. Returns the final unterminated line as-is, and `undefined` when the source
   * is exhausted before any byte — `undefined` rather than the spec's language-agnostic "null", per
   * styleguide 3.5.
   *
   * Scans with a NON-CONSUMING peek before reading, deliberately. Reading first and pushing back the
   * over-read cannot work: every read advances this cursor and `RetentionWindow.readInto` then trims the
   * queue head to the slowest cursor, so the bytes past the terminator are already discarded by the time
   * anything could rewind over them. Peeking leaves the cursor still, so the bytes stay retained, and the
   * subsequent `readExactly` consumes exactly the line plus its terminator.
   */
  async readUtf8Line(): Promise<string | undefined> {
    this.#assertOpen();
    const at = await this.#scanForNewline();
    if (at === END_OF_STREAM) {
      const rest = await this.readBytes();
      return rest.length === 0 ? undefined : decodeText(rest, 'utf-8');
    }
    const line = await this.readExactly(at + 1);
    const end = at > 0 && line[at - 1] === CARRIAGE_RETURN ? at - 1 : at;
    // Decoding goes through `decodeText`, which sets `ignoreBOM`. A per-line decoder with the default
    // would strip U+FEFF from the front of EVERY line, not just the stream's first — see the note on
    // `decodeText`, and SSE-12, which requires a mid-stream BOM to survive as ordinary data.
    return decodeText(line.subarray(0, end), 'utf-8');
  }

  /**
   * Offset of the next `\n` relative to this cursor, or `END_OF_STREAM` if the source ends first.
   * Never advances the cursor. Retention grows by one line's length, which is what IO-14 requires and
   * all it requires.
   */
  async #scanForNewline(): Promise<number> {
    let searched = 0;
    for (;;) {
      const available = Math.min(
        this.#window.availableFrom(this.#cursor),
        this.#remainingBudget(),
      );
      if (available > searched) {
        // Peek ONLY the bytes pulled since the last pass. Re-peeking the whole scanned prefix each time
        // makes this quadratic in bytes copied, with no line-length bound — and this is the primitive
        // header and chunked-encoding parsing run over attacker-controlled bytes, so a peer that
        // dribbles a long newline-free line would pin a CPU core.
        const tail = this.#window.peekBytes(
          this.#cursor,
          searched,
          available - searched,
        );
        const found = tail.indexOf(NEWLINE);
        if (found >= 0) return searched + found;
        searched = available;
      }
      if (searched >= this.#remainingBudget()) return END_OF_STREAM;
      if (!(await this.#window.pullThrough(this.#cursor.at + searched + 1)))
        return END_OF_STREAM;
    }
  }

  /**
   * A non-consuming view over the whole remaining source (IO-19). Reads from it never advance this
   * source's cursor.
   *
   * Deliberately uncapped: §5 bounds nothing, and every buffering cap the product spec mandates lives in
   * §6 (Phase 3b). See `RetentionWindow` for why a cap here would partially fail IO-19.
   */
  peek(): BufferedSource {
    this.#assertOpen();
    return new BufferedSource(
      this.#window,
      this.#window.register(this.#cursor.at),
      false,
      this.#remainingBudget(),
    );
  }

  /**
   * A non-consuming, length-bounded view exposing at most `count` bytes starting `offset` ahead of this
   * cursor (IO-20).
   *
   * Offset overflow is detected LAZILY — an offset past the source size constructs fine and surfaces as
   * an empty read (IO-21) — because callers may slice speculatively before the body length is known. A
   * negative offset or count is rejected eagerly. A slice of a slice composes additively and caps at the
   * outer slice's remaining budget (IO-23).
   */
  slice(offset: number, count: number): BufferedSource {
    invariant(
      Number.isInteger(offset) && offset >= 0,
      `offset must be a non-negative integer, got ${String(offset)}`,
    );
    assertCount(count);
    this.#assertOpen();
    const budget = Math.max(
      0,
      Math.min(count, this.#remainingBudget() - offset),
    );
    return new BufferedSource(
      this.#window,
      this.#window.register(this.#cursor.at + offset),
      false,
      budget,
    );
  }

  /** Advance past exactly `count` bytes; `skip(0)` is a no-op even at end of stream (IO-15). */
  async skip(count: number): Promise<void> {
    assertCount(count);
    this.#assertOpen();
    if (count === 0) return;
    const staging = new ByteQueue();
    let skipped = 0;
    while (skipped < count) {
      const read = await this.read(staging, count - skipped);
      if (read === END_OF_STREAM) throw new EndOfStreamError(skipped, count);
      skipped += read;
      staging.clear();
    }
  }

  /**
   * IO-41: idempotent. A view releases only its own cursor and never closes its parent or moves the
   * parent's cursor (IO-22); the owning source closes the window, which invalidates every outstanding
   * view.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (!this.#ownsWindow) {
      this.#window.release(this.#cursor);
      return;
    }
    // Awaited, so the promise settles only once the underlying reader is really cancelled and its lock
    // released — and rejects if that teardown fails, rather than reporting a success that never happened.
    await this.#window.close();
  }

  /** IO-42: a stream-backed source rejects reads after close, unlike an in-memory `ByteQueue`. */
  #assertOpen(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSource');
    this.#window.assertUsable();
  }

  /**
   * A read-only host-native byte-stream bridge (IO-16). Closing the bridge closes the owning source.
   *
   * For this port the host-native byte stream IS `ReadableStream` — that is `sdk-design/03` §3.1's whole
   * premise, and it keeps core free of any `node:` import. A consumer wanting a Node `Readable` calls
   * `Readable.fromWeb()` at their own edge.
   */
  toReadableStream(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      pull: async (controller): Promise<void> => {
        const staging = new ByteQueue();
        let read: number;
        try {
          read = await this.read(staging, BRIDGE_CHUNK);
        } catch (e: unknown) {
          // A mid-stream read failure errors the bridge, and `cancel` is NOT invoked on an errored
          // stream — so without this the reader lock and the retention window are both stranded on
          // exactly the failure path that matters most for a connection-backed source.
          await this.close().catch(() => undefined);
          throw e;
        }
        if (read === END_OF_STREAM) {
          // Close the BRIDGE only. IO-16 requires that closing the bridge close the owning source, and
          // `cancel` below does that; auto-closing at natural EOF is an extra step that would tear down
          // the whole RetentionWindow and invalidate every outstanding peek/slice view — defeating
          // IO-19's stated purpose (previews, replay) for its most natural usage: take a preview, hand
          // the bridge to the transport, read the preview afterwards.
          controller.close();
          return;
        }
        controller.enqueue(staging.snapshot());
      },
      cancel: async (): Promise<void> => {
        await this.close();
      },
    });
  }

  #remainingBudget(): number {
    if (this.#limit === Number.POSITIVE_INFINITY)
      return Number.POSITIVE_INFINITY;
    return Math.max(0, this.#limit - (this.#cursor.at - this.#startedAt));
  }
}

/** How much a bulk drain asks for per iteration. Not a retention bound — `read` transfers, never buffers. */
const READ_CHUNK = 16 * 1024;
const BRIDGE_CHUNK = 16 * 1024;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${String(count)}`,
  );
}
