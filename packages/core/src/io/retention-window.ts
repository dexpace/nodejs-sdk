// SPDX-License-Identifier: MIT
// packages/core/src/io/retention-window.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, SourceContractViolationError} from './errors.js';

/**
 * A reader's position, as a logical offset into the whole stream. Two cursors over one window are
 * mutually independent (IO-23): advancing one never moves another.
 *
 * @internal
 */
export interface Cursor {
  at: number;
}

/**
 * The shared buffer behind a `BufferedSource` and all of its peek/slice views.
 *
 * Bytes are retained from `min(all live cursors)` forward and trimmed as the slowest cursor advances, so
 * with no views outstanding retention collapses to the read size. There is deliberately **no cap** here:
 * §5 bounds nothing, and every cap the product spec mandates (BODY-19, BODY-30/HTTP-52, BODY-34) sits in
 * §6 and belongs to Phase 3b. A cap at this layer would bound the spread between the fastest and slowest
 * cursor, which in the divergent case stops a view reaching the end and partially fails IO-19's MUST.
 *
 * Owns the stream reader, so a view — which owns no reader — can still pull through its parent's source.
 *
 * @internal
 */
export class RetentionWindow {
  readonly #queue = new ByteQueue();
  readonly #cursors = new Set<Cursor>();
  readonly #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #retainedFrom = 0;
  #pulledThrough = 0;
  #exhausted = false;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array> | undefined) {
    this.#reader = reader;
    this.#exhausted = reader === undefined;
  }

  /** Logical offset one past the last byte pulled from the stream. */
  get pulledThrough(): number {
    return this.#pulledThrough;
  }

  /** Bytes currently held because some cursor may still need them. */
  get retainedBytes(): number {
    return this.#queue.size;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Register a new cursor at a logical offset (IO-23 — its own cursor, independent of every other). */
  register(at: number): Cursor {
    this.assertUsable();
    const cursor: Cursor = {at};
    this.#cursors.add(cursor);
    return cursor;
  }

  /**
   * Drop a cursor and let the retained head trim forward (IO-22 — releasing a view neither closes the
   * parent nor moves the parent's cursor).
   */
  release(cursor: Cursor): void {
    this.#cursors.delete(cursor);
    if (!this.#closed) this.#trim();
  }

  /**
   * Pull from the stream until `offset` bytes are available, or the stream ends. Returns false at end.
   */
  async pullThrough(offset: number): Promise<boolean> {
    this.assertUsable();
    while (this.#pulledThrough < offset && !this.#exhausted) {
      await this.#pullOnce();
      this.assertUsable();
    }
    return this.#pulledThrough >= offset;
  }

  /** Move up to `count` already-pulled bytes onto `dest`, advancing only `cursor`. */
  readInto(cursor: Cursor, dest: ByteQueue, count: number): number {
    this.assertUsable();
    const take = Math.min(count, this.#pulledThrough - cursor.at);
    if (take <= 0) return 0;
    this.#queue.copyTo(dest, cursor.at - this.#retainedFrom, take);
    cursor.at += take;
    this.#trim();
    return take;
  }

  /**
   * Materialize up to `count` already-pulled bytes starting `offset` ahead of `cursor`, without
   * advancing it (IO-19, IO-20).
   *
   * The offset exists so an incremental scanner can re-peek only the tail it has not seen. Without it
   * every caller re-materializes the whole scanned prefix on each pull, which is quadratic.
   */
  peekBytes(cursor: Cursor, offset: number, count: number): Uint8Array {
    this.assertUsable();
    const from = cursor.at + offset;
    const take = Math.min(count, this.#pulledThrough - from);
    if (take <= 0) return new Uint8Array(0);
    return this.#queue.copyOut(from - this.#retainedFrom, take);
  }

  /** How many pulled bytes sit at or ahead of `cursor`. Does not pull and does not advance. */
  availableFrom(cursor: Cursor): number {
    this.assertUsable();
    return Math.max(0, this.#pulledThrough - cursor.at);
  }

  /** IO-24: a closed window fails loudly with a state error, never as a normal EOF. */
  assertUsable(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSource');
  }

  /**
   * IO-41: idempotent. IO-22: invalidates every outstanding view, so a later read from one fails loudly
   * rather than returning stale bytes.
   *
   * The returned promise settles only once the underlying reader has actually been cancelled and its
   * lock released, and it REJECTS when that teardown fails. Detaching the cancel (`void reader.cancel()`)
   * would let `await source.close()` resolve ahead of the real release — racing anything a caller
   * sequences on it, such as connection reuse — and would swallow a teardown failure entirely.
   *
   * Memoized rather than early-returned on a flag: two overlapping `close()` calls must await the SAME
   * teardown and observe the SAME outcome, instead of the second resolving while the first is still in
   * flight or has already failed.
   */
  close(): Promise<void> {
    this.#closing ??= this.#teardown();
    return this.#closing;
  }

  async #teardown(): Promise<void> {
    this.#closed = true;
    this.#cursors.clear();
    this.#queue.clear();
    this.#queue.close();
    const reader = this.#reader;
    if (reader === undefined) return;
    try {
      await reader.cancel();
    } finally {
      // `cancel()` cancels the STREAM; it never releases the reader's lock — only `releaseLock()` does,
      // and without it the caller's ReadableStream stays locked forever. Runs even when the cancel
      // rejects, because a stream that failed to cancel is exactly the one whose lock must not leak.
      reader.releaseLock();
    }
  }

  async #pullOnce(): Promise<void> {
    invariant(this.#reader !== undefined, 'pull on a window with no reader');
    const {done, value} = await this.#reader.read();
    if (done) {
      this.#exhausted = true;
      return;
    }
    // IO-17: the `done: false` narrowing is a COMPILE-time guarantee about a value that arrives from a
    // caller-supplied stream, so it guarantees nothing at runtime. Without this check `undefined`
    // escapes as a raw `TypeError` outside the IoError tree, and a string chunk — what
    // `Readable.toWeb()` yields when the Node stream has an encoding set — passes the length test and
    // corrupts the queue, detonating much later and far from its cause.
    if (!(value instanceof Uint8Array)) {
      throw new SourceContractViolationError(
        `source delivered a non-Uint8Array chunk (${typeof value})`,
      );
    }
    if (value.length === 0) {
      // IO-17: a zero-length delivery for an outstanding read is a source-contract violation, never
      // end-of-stream and never something to spin on.
      throw new SourceContractViolationError(
        'source delivered 0 bytes without signalling end of stream',
      );
    }
    this.#queue.writeBytes(value);
    this.#pulledThrough += value.length;
  }

  /** Drop everything no live cursor can still reach. */
  #trim(): void {
    const low = this.#lowestCursor();
    const drop = low - this.#retainedFrom;
    if (drop <= 0) return;
    this.#queue.skip(drop);
    this.#retainedFrom = low;
  }

  #lowestCursor(): number {
    let low = this.#pulledThrough;
    for (const cursor of this.#cursors) low = Math.min(low, cursor.at);
    return low;
  }
}
