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

  /** Materialize up to `count` already-pulled bytes without advancing `cursor` (IO-19, IO-20). */
  peekBytes(cursor: Cursor, count: number): Uint8Array {
    this.assertUsable();
    const take = Math.min(count, this.#pulledThrough - cursor.at);
    if (take <= 0) return new Uint8Array(0);
    const staging = new ByteQueue();
    this.#queue.copyTo(staging, cursor.at - this.#retainedFrom, take);
    return staging.snapshot();
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
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cursors.clear();
    this.#queue.clear();
    this.#queue.close();
    // The reader lock must be released even if the stream already errored; a rejection here would
    // otherwise become an unhandled rejection on a teardown path.
    void this.#reader?.cancel().catch(() => undefined);
  }

  async #pullOnce(): Promise<void> {
    invariant(this.#reader !== undefined, 'pull on a window with no reader');
    const {done, value} = await this.#reader.read();
    if (done) {
      this.#exhausted = true;
      return;
    }
    // `done: false` narrows `value` to a defined `Uint8Array` per the Streams spec's discriminated
    // union — no runtime check needed on top of what the type already guarantees.
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
