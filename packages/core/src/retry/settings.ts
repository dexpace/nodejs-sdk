// SPDX-License-Identifier: MIT
// packages/core/src/retry/settings.ts
import {hasForbiddenNameByte} from '../http/ascii-validation.js';
import {invariant} from '../invariant.js';
import type {BackoffSettings} from './backoff.js';
import {RETRYABLE_STATUSES} from './classify.js';

/**
 * The complete retry policy: the backoff schedule plus the budget, the authoritative status set, and
 * the two opt-in knobs (RETRY-12, RETRY-27/28, RETRY-38, RECOV-34).
 *
 * Immutable and stateless after construction, so one instance is safe for concurrent invocation
 * (RETRY-42/RECOV-28).
 *
 * @public
 */
export interface RetrySettings extends BackoffSettings {
  /** Total wire sends including the initial one; 1 disables retries (RETRY-14, RECOV-34). */
  readonly maxAttempts: number;
  /** Authoritative on its own -- it both widens and narrows the built-in classifier (RETRY-37). */
  readonly retryableStatuses: ReadonlySet<number>;
  /**
   * OPT-IN total-timeout budget spanning attempts and inter-attempt delays (RETRY-27). Undefined by
   * default and `0` also disabling it -- RETRY-28 instructs a port that unifies the two reference
   * retry stacks to make this explicitly opt-in rather than always-on.
   */
  readonly totalTimeoutMs?: number | undefined;
  /** When set, each attempt is stamped with its 1-based ordinal under this header (RETRY-38). */
  readonly attemptHeaderName?: string | undefined;
}

/**
 * RETRY-12's defaults: 200 ms initial delay, doubling, an 8 s cap, 20% symmetric jitter, and three
 * total wire sends.
 *
 * @internal
 */
export const DEFAULT_RETRY_SETTINGS: RetrySettings = Object.freeze({
  initialDelayMs: 200,
  multiplier: 2,
  maxDelayMs: 8000,
  jitter: 0.2,
  maxAttempts: 3,
  retryableStatuses: RETRYABLE_STATUSES,
});

/**
 * A duration this module will hand to `Clock.sleep`, or compare against elapsed time.
 *
 * Bounded below only. A ceiling of `Clock`'s `MAX_SLEEP_MS` sat here between 2026-09-02 and later
 * the same day: it was the right guard while `Clock.sleep` REFUSED a longer wait, and it became
 * unnecessary the moment the clock started chaining timers to honor any finite duration
 * (`docs/open-items.md` V4, resolved by V13). Re-adding it would now reject a duration the platform
 * can wait -- and would make `RETRY-18`'s 365-day pacing clamp unconfigurable, which is the very
 * collision V13 closed.
 */
function validateDuration(label: string, value: number | undefined): void {
  if (value === undefined) return;
  invariant(
    Number.isFinite(value) && value >= 0,
    `${label} must be a finite, non-negative duration, got ${String(value)}`,
  );
}

/**
 * Builds validated, frozen retry settings (RECOV-34). Invalid values are PROGRAMMER errors -- a
 * caller passing `multiplier: 0.5` has a bug, not an operational failure -- so they trip
 * `invariant()` rather than a typed error class.
 *
 * A negative `maxAttempts` is REJECTED, never clamped to the default: RETRY-41 says clamp, HTTP-35
 * (also MUST) says reject precisely so a negative value cannot be silently reinterpreted as "use
 * default". The port takes HTTP-35's line on both surfaces.
 *
 * The status set is defensively copied at build time so later mutation of the caller's collection
 * cannot alter policy (RECOV-34).
 *
 * @param overrides - the fields to change; everything else takes RETRY-12's default.
 * @returns frozen, validated settings.
 * @throws InvariantViolation for a negative or non-finite duration; a multiplier below 1.0 or
 *   non-finite; a `maxAttempts` that is not an integer >= 1; or a jitter outside [0,1].
 *
 * @internal
 */
export function retrySettings(
  overrides?: Partial<RetrySettings>,
): RetrySettings {
  const merged = {...DEFAULT_RETRY_SETTINGS, ...overrides};
  validateDuration('initialDelayMs', merged.initialDelayMs);
  validateDuration('maxDelayMs', merged.maxDelayMs);
  validateDuration('totalTimeoutMs', merged.totalTimeoutMs);
  validateDuration('fixedDelayMs', merged.fixedDelayMs);
  // `Number.isFinite` on both, and integrality on the one that counts wire sends. The lower bound
  // alone let `Infinity` through on the multiplier -- which makes the second delay `Infinity` and
  // fails inside the retry loop at `Clock.sleep`'s ceiling instead of at the call that configured it
  // -- and let a fractional `maxAttempts` through, which is not a count. Same reasoning as HTTP-35's
  // on `RequestOptionsBuilder.maxRetries`: these two are among the four holes the 2026-09-02 sweep
  // of every public numeric setter closed to the full range (`docs/open-items.md` P2).
  invariant(
    Number.isFinite(merged.multiplier) && merged.multiplier >= 1,
    `retry multiplier must be a finite number >= 1.0, got ${String(merged.multiplier)}`,
  );
  invariant(
    Number.isInteger(merged.maxAttempts) && merged.maxAttempts >= 1,
    `retry maxAttempts must be an integer >= 1 (1 disables retries), got ${String(merged.maxAttempts)}`,
  );
  invariant(
    merged.jitter >= 0 && merged.jitter <= 1,
    `retry jitter must lie in [0,1], got ${String(merged.jitter)}`,
  );
  // Validated HERE rather than left to the first stamped attempt (RETRY-38). `HeadersBuilder`
  // rejects a malformed name (HTTP-26), so an unchecked value would surface as a throw from inside
  // the retry loop on some later request -- a configuration mistake reported as a request failure,
  // far from the call that made it, and only on the code path that actually retries.
  invariant(
    merged.attemptHeaderName === undefined ||
      (merged.attemptHeaderName.length > 0 &&
        !hasForbiddenNameByte(merged.attemptHeaderName)),
    `retry attemptHeaderName must be a valid header name, got ${String(merged.attemptHeaderName)}`,
  );
  return Object.freeze({
    ...merged,
    retryableStatuses: new Set(merged.retryableStatuses),
  });
}
