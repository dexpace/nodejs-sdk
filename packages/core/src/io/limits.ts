// SPDX-License-Identifier: MIT
// packages/core/src/io/limits.ts
import {invariant} from '../invariant.js';
import {AllocationLimitError} from './errors.js';

/**
 * End-of-stream sentinel returned by every read (IO-1).
 *
 * The numeric protocol is kept spec-literal rather than modelled as `number | undefined`, because IO-2
 * (a zero-count read returns 0 and must NOT report end-of-stream) and, later, BODY-25 ("EOF is signaled
 * only by the explicit sentinel") both reason over it.
 *
 * @internal
 */
export const END_OF_STREAM = -1;

/**
 * Largest byte count this package will attempt to materialize as one contiguous `Uint8Array` (IO-9).
 *
 * Deliberately conservative. Core is runtime-agnostic, so `node:buffer`'s constant is unavailable; V8 and
 * JavaScriptCore disagree on the real ceiling and both have moved it, and rule 12.6 forbids probing at
 * import time. 2 GiB − 1 is at or below every supported host's limit. Callers that exceed it get an
 * actionable `AllocationLimitError` rather than a low-level allocation crash; a `RangeError` backstop at
 * the allocation site covers any host whose real ceiling is lower still.
 *
 * @internal
 */
export const MAX_BYTE_ARRAY_LENGTH = 2 ** 31 - 1;

/**
 * IO-9's eager guard: refuse a materialization that would exceed the ceiling, with an actionable error
 * that points at streaming alternatives, BEFORE any allocation is attempted.
 *
 * A named function rather than an inlined `if` at each site because the count-less read path has to
 * apply it incrementally — it cannot know the total up front — and a rule applied in two shapes is a
 * rule that drifts.
 */
export function assertAllocatable(count: number): void {
  if (count > MAX_BYTE_ARRAY_LENGTH) {
    throw new AllocationLimitError(count, MAX_BYTE_ARRAY_LENGTH);
  }
}

/**
 * IO-3's eager guard: a negative or non-integer count is an argument error, rejected BEFORE any I/O so
 * neither the source nor the destination is touched.
 *
 * Single-sourced here for the same reason `assertAllocatable` is. It previously existed as three
 * byte-for-byte copies (`byte-queue.ts`, `buffered-source.ts`, `buffered-sink.ts`) and `TeeSink` — the
 * fourth size-taking surface — had none at all, so a negative count reached it and was rejected only
 * indirectly, by whichever `ByteQueue` call happened to run first. That is exactly the drift the
 * "a rule applied in two shapes is a rule that drifts" note above warns about.
 */
export function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${String(count)}`,
  );
}
