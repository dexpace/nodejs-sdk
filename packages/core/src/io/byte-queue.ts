// SPDX-License-Identifier: MIT
// packages/core/src/io/byte-queue.ts
import {invariant} from '../invariant.js';
import {AllocationLimitError, EndOfStreamError} from './errors.js';
import {
  assertAllocatable,
  END_OF_STREAM,
  MAX_BYTE_ARRAY_LENGTH,
} from './limits.js';

/**
 * One node in the queue's chunk list. `bytes` is never mutated after the node is linked in, which is what
 * makes zero-copy `subarray` transfers between queues safe; `start` is the first byte not yet consumed.
 */
interface Chunk {
  readonly bytes: Uint8Array;
  start: number;
  next: Chunk | undefined;
}

/**
 * A FIFO byte queue that is simultaneously a source and a sink (IO-7).
 *
 * Synchronous throughout: pure memory has nothing to wait for, so making it async would allocate a Promise
 * on the SDK's hottest data structure (styleguide 15.4) and force every downstream synchronous consumer to
 * become async for no I/O reason. `BufferedSource`/`BufferedSink` are the async surfaces.
 *
 * Not safe for concurrent use (IO-37); callers serialize access.
 *
 * @internal
 */
export class ByteQueue {
  #head: Chunk | undefined = undefined;
  #tail: Chunk | undefined = undefined;
  #size = 0;
  #closed = false;
  /** Bumped whenever bytes leave the head, invalidating the memoized seek position. */
  #generation = 0;
  #seekChunk: Chunk | undefined = undefined;
  #seekStart = 0;
  #seekGeneration = -1;

  /** Bytes currently held (IO-7). */
  get size(): number {
    return this.#size;
  }

  /** Whether `close()` has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Append an independent copy of `bytes` to the tail. The copy is what lets IO-30's byte-array-wrapping
   * factory promise that mutating the caller's input afterwards does not change the source, and it is
   * what makes the `Chunk.bytes` "never mutated after linked in" invariant — and therefore `#moveTo`'s
   * zero-copy `subarray` transfers — safe.
   */
  writeBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.#append(copyBytes(bytes));
  }

  /**
   * Move up to `count` bytes from this queue's head onto `dest`'s tail (IO-1).
   *
   * Returns the number transferred: at least 1 when `count` is positive and the queue is not exhausted,
   * exactly 0 when `count` is 0, `END_OF_STREAM` at end, and never more than requested.
   */
  read(dest: ByteQueue, count: number): number {
    assertCount(count);
    // IO-2 is checked BEFORE exhaustion, deliberately: a zero-count read returns 0 even on an exhausted
    // queue, and must never collapse to END_OF_STREAM. Reordering these two lines breaks IO-2.
    if (count === 0) return 0;
    if (this.#size === 0) return END_OF_STREAM;
    const take = Math.min(count, this.#size);
    this.#moveTo(dest, take);
    return take;
  }

  /**
   * Move exactly `count` bytes from `src`'s head onto this queue's tail (IO-4). Fails rather than
   * transferring a partial amount when `src` holds fewer.
   */
  write(src: ByteQueue, count: number): void {
    assertCount(count);
    if (src.#size < count) throw new EndOfStreamError(src.#size, count);
    src.#moveTo(this, count);
  }

  /**
   * A fresh, independent copy of the current contents, without consuming or mutating (IO-8). Later
   * mutations do not affect a returned snapshot, and vice versa.
   */
  snapshot(): Uint8Array {
    return this.#materialize(0, this.#size);
  }

  /**
   * A fresh, independent copy of the window `[offset, offset + count)`, without consuming or mutating.
   *
   * The single-copy counterpart of `copyTo` for callers that want bytes rather than another queue:
   * `copyTo(staging, ...)` followed by `staging.snapshot()` materializes the same window twice, which is
   * what made `BufferedSource`'s newline scan quadratic.
   */
  copyOut(offset: number, count?: number): Uint8Array {
    invariant(
      Number.isInteger(offset) && offset >= 0,
      `offset must be a non-negative integer, got ${String(offset)}`,
    );
    const length = count ?? this.#size - offset;
    assertCount(length);
    invariant(
      offset + length <= this.#size,
      `copy window ${String(offset)}..${String(offset + length)} exceeds size ${String(this.#size)}`,
    );
    return this.#materialize(offset, length);
  }

  /**
   * Copy the window `[offset, offset + count)` into `dest` WITHOUT consuming or mutating this queue
   * (IO-10). `count` defaults to "from offset through end". An out-of-range window is rejected.
   */
  copyTo(dest: ByteQueue, offset: number, count?: number): void {
    invariant(
      Number.isInteger(offset) && offset >= 0,
      `offset must be a non-negative integer, got ${String(offset)}`,
    );
    const length = count ?? this.#size - offset;
    assertCount(length);
    invariant(
      offset + length <= this.#size,
      `copy window ${String(offset)}..${String(offset + length)} exceeds size ${String(this.#size)}`,
    );
    if (length === 0) return;
    dest.#append(this.#materialize(offset, length));
  }

  /** Consume and return exactly `count` bytes, failing rather than returning short. */
  takeBytes(count: number): Uint8Array {
    assertCount(count);
    // IO-9 before IO-4/IO-12's short-source check: an over-limit request is refused with an actionable
    // AllocationLimitError even when the queue also happens to be short, rather than surfacing as an
    // ordinary EndOfStreamError that hides the real problem.
    assertAllocatable(count);
    if (count > this.#size) throw new EndOfStreamError(this.#size, count);
    const out = this.#materialize(0, count);
    this.#discard(count);
    return out;
  }

  /** Discard up to `count` bytes from the head; returns how many were actually discarded. */
  skip(count: number): number {
    assertCount(count);
    const dropped = Math.min(count, this.#size);
    this.#discard(dropped);
    return dropped;
  }

  /** Discard every byte (IO-10). */
  clear(): void {
    this.#head = undefined;
    this.#tail = undefined;
    this.#size = 0;
    this.#generation += 1;
  }

  /**
   * Copy `count` bytes starting `offset` from the head into one contiguous array (IO-9-bounded).
   *
   * Parameter order matches `copyTo(dest, offset, count)` deliberately: two adjacent `number`s in
   * opposite orders across two methods is exactly the transposition hazard styleguide 5.5 names.
   */
  #materialize(offset: number, count: number): Uint8Array {
    assertAllocatable(count);
    const out = allocate(count);
    const seek = this.#seek(offset);
    let chunk = seek.chunk;
    let from = offset - seek.chunkStart;
    let at = 0;
    while (chunk !== undefined && at < count) {
      const available = chunk.bytes.length - chunk.start;
      const take = Math.min(available - from, count - at);
      const start = chunk.start + from;
      out.set(chunk.bytes.subarray(start, start + take), at);
      at += take;
      from = 0;
      chunk = chunk.next;
    }
    return out;
  }

  /**
   * Position at the chunk holding logical `offset`, resuming from the last seek when it is still valid.
   *
   * Walking from the head every time makes a SEQUENTIAL scan quadratic in the number of chunks, which is
   * how `readUtf8Line` stayed quadratic even after it was changed to peek only the newly pulled tail: a
   * peer dribbling one byte per chunk produces one chunk per byte, and each peek re-walked all of them.
   * Bytes are only ever appended at the tail, so a remembered position stays correct until something is
   * removed from the head — which `#generation` detects.
   */
  #seek(offset: number): {chunk: Chunk | undefined; chunkStart: number} {
    let chunk = this.#head;
    let chunkStart = 0;
    if (
      this.#seekChunk !== undefined &&
      this.#seekGeneration === this.#generation &&
      this.#seekStart <= offset
    ) {
      chunk = this.#seekChunk;
      chunkStart = this.#seekStart;
    }
    while (chunk !== undefined) {
      const available = chunk.bytes.length - chunk.start;
      if (offset < chunkStart + available) break;
      chunkStart += available;
      chunk = chunk.next;
    }
    this.#seekChunk = chunk;
    this.#seekStart = chunkStart;
    this.#seekGeneration = this.#generation;
    return {chunk, chunkStart};
  }

  #discard(count: number): void {
    if (count > 0) this.#generation += 1;
    let remaining = count;
    while (remaining > 0) {
      const head = this.#head;
      invariant(head !== undefined, 'byte-queue underflow during discard');
      const take = Math.min(head.bytes.length - head.start, remaining);
      head.start += take;
      remaining -= take;
      if (head.start === head.bytes.length) this.#dropHead();
    }
    this.#size -= count;
  }

  /**
   * Mark this queue closed (IO-41 — idempotent, the underlying resource released at most once).
   *
   * Deliberately leaves the read/write surface usable: IO-42 exempts a purely in-memory buffer so that
   * snapshot-after-close body logging still works. A queue owns no external resource, so there is nothing
   * else to release here. Invalidating derived views is `RetentionWindow`'s job, not this class's — views
   * are cursors over a window, never over a bare queue.
   */
  close(): void {
    this.#closed = true;
  }

  /** Caller owns the source-side size accounting; `#dropHead` deliberately does not touch `#size`. */
  #moveTo(dest: ByteQueue, count: number): void {
    if (count > 0) this.#generation += 1;
    let remaining = count;
    while (remaining > 0) {
      const head = this.#head;
      invariant(head !== undefined, 'byte-queue underflow during move');
      const take = Math.min(head.bytes.length - head.start, remaining);
      dest.#append(head.bytes.subarray(head.start, head.start + take));
      head.start += take;
      remaining -= take;
      if (head.start === head.bytes.length) this.#dropHead();
    }
    this.#size -= count;
  }

  #append(bytes: Uint8Array): void {
    const chunk: Chunk = {bytes, start: 0, next: undefined};
    if (this.#tail === undefined) this.#head = chunk;
    else this.#tail.next = chunk;
    this.#tail = chunk;
    this.#size += bytes.length;
  }

  #dropHead(): void {
    const head = this.#head;
    invariant(head !== undefined, 'byte-queue drop with no head');
    this.#head = head.next;
    if (this.#head === undefined) this.#tail = undefined;
  }
}

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${String(count)}`,
  );
}

/**
 * A genuinely independent copy of `bytes`.
 *
 * `bytes.slice()` is NOT sufficient: a Node `Buffer` is a `Uint8Array` subclass whose own
 * `slice` is an alias for `subarray`, so it returns an aliasing view over the caller's memory. Since a
 * `Buffer` — very often a pooled one handed over by a socket read — is the single most likely input type
 * in a Node SDK, that would silently break IO-30's independence guarantee. Allocating
 * a fresh array and `set` copies into it unconditionally, whatever the argument's subclass does.
 *
 * @internal
 */
export function copyBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

/**
 * IO-9's backstop. The eager `MAX_BYTE_ARRAY_LENGTH` check is deliberately conservative, so a host whose
 * real ceiling is lower would otherwise surface a raw `RangeError` — exactly the "low-level allocation
 * crash" IO-9 exists to prevent.
 */
function allocate(count: number): Uint8Array {
  try {
    return new Uint8Array(count);
  } catch (e: unknown) {
    if (e instanceof RangeError) {
      throw new AllocationLimitError(count, MAX_BYTE_ARRAY_LENGTH, {cause: e});
    }
    throw e;
  }
}
