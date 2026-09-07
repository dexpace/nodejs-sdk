// SPDX-License-Identifier: MIT
// packages/core/src/retry/attempt-stamp.ts
import type {Request} from '../http/request.js';

/**
 * Stamps the 1-based attempt ordinal onto a FRESH copy of the request (RETRY-38/RECOV-31).
 *
 * The captured template is never mutated -- `Request` is immutable and frozen, so "stamping" means
 * building a new value. `set()` replaces only the named header, so an idempotency key written
 * upstream by `recovery/idempotency-key.ts` (RECOV-32) and every other header survive untouched.
 *
 * Disabled by default: when `headerName` is undefined this returns the ORIGINAL instance and
 * allocates nothing, which is the zero-allocation no-op path RETRY-38 requires.
 *
 * @param request - the captured template, never mutated.
 * @param attempt - the 1-based attempt ordinal.
 * @param headerName - the header to stamp under, or undefined to disable stamping.
 * @returns the stamped copy, or the original instance when stamping is disabled.
 *
 * @internal
 */
export function stampAttempt(
  request: Request,
  attempt: number,
  headerName: string | undefined,
): Request {
  if (headerName === undefined) return request;
  return request
    .newBuilder()
    .headers(
      request.headers.newBuilder().set(headerName, String(attempt)).build(),
    )
    .build();
}
