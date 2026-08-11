// SPDX-License-Identifier: MIT
// packages/core/src/io/limits.ts

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
