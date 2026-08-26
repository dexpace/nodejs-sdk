// SPDX-License-Identifier: MIT
// packages/core/src/retry/classify.ts
import {HttpStatusError} from '../body/http-status-error.js';
import {isIdempotent} from '../http/method.js';
import type {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';

// Phase 7a retrofit: RETRY-1's status set and predicate previously lived here as a private
// `buildRetryableStatuses()`/`RETRYABLE_STATUSES`/`isRetryableStatus`. Phase 7a's CFG-35 promotes the
// exact same set to a utility at `config/retryable.js` (for callers with no retry-engine
// dependency); this module re-exports that single source instead of keeping a second definition
// (RETRY-13's single-sourcing mandate, structural under ES modules).
export {RETRYABLE_STATUSES, isRetryableStatus} from '../config/retryable.js';

/** True for the abort reason `AbortSignal.timeout()` produces, false for a caller abort (RETRY-23/24). */
function isTimeoutAbort(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    (value as {readonly name: unknown}).name === 'TimeoutError'
  );
}

/**
 * Reads `.cause` without trusting it. `cause` is an ordinary property, so a throwable built with a
 * lazy or hostile accessor can raise from the read itself -- and this walk runs while classifying a
 * failure that already happened, where a throw would replace the transport error with a
 * classification error and turn a retryable condition into a terminal one. RETRY-22's rule that a
 * secondary failure can never mask the upstream one applies here for the same reason it applies to
 * the pacing parser: ending the walk is always a safe answer, raising never is.
 */
function causeOf(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('cause' in value)) {
    return undefined;
  }
  try {
    return (value as {readonly cause: unknown}).cause;
  } catch {
    return undefined;
  }
}

/**
 * Retryability as an ALLOW-list (RETRY-2): a throwable qualifies only if it, or something in its
 * cause chain, is an I/O error, a timeout, or a status the caller configured as retryable. The walk
 * is iterative and identity-tracking, so a cyclic `cause` chain terminates instead of spinning.
 *
 * The allow-list shape is why RETRY-25 needs no code: a stack-overflow `RangeError` is non-retryable
 * because it was never opted in, not because it was screened out. A caller's `AbortError` is
 * likewise non-retryable for free (RETRY-23), while a `TimeoutError` is explicitly listed
 * (RETRY-24). A transport-level failure -- connection refused, TLS or DNS failure, peer reset --
 * surfaces as an `IoError` subclass and is therefore retryable unconditionally at this level
 * (RETRY-4).
 *
 * @param error - whatever was thrown; any value, not necessarily an `Error`.
 * @param statuses - the CONFIGURED set, authoritative on its own -- it both widens and narrows
 *   relative to `RETRYABLE_STATUSES`, and the built-in classifier is not AND-ed in (RETRY-37).
 * @returns true when the failure is a retryable condition.
 *
 * @internal
 */
export function isRetryableFailure(
  error: unknown,
  statuses: ReadonlySet<number>,
): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    // RETRY-3: derived from the carried status at classification time, never a stored per-subclass flag.
    if (current instanceof HttpStatusError) return statuses.has(current.status);
    if (current instanceof IoError) return true;
    if (isTimeoutAbort(current)) return true;
    current = causeOf(current);
  }
  return false;
}

/**
 * The second, orthogonal axis (RETRY-5/RETRY-8): a body-less request is re-sendable iff its method
 * is idempotent; a body-bearing one iff its body is replayable. A bare non-idempotent POST is
 * therefore not re-sendable even though it has nothing to physically re-send -- the case RETRY-7
 * calls out explicitly.
 *
 * RETRY-6's `{GET, HEAD, OPTIONS, PUT, DELETE}` set is Phase 1's `http/method.ts` (HTTP-9), imported
 * rather than restated.
 *
 * @param request - the request a retry would re-send.
 * @returns true when the request may be sent again.
 *
 * @internal
 */
export function isResendable(request: Request): boolean {
  const {body} = request;
  return body === undefined ? isIdempotent(request.method) : body.replayable;
}
