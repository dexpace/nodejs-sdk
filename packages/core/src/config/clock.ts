// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.ts
import {InvariantViolation} from '../invariant.js';

/**
 * An injectable seam for wall-clock instant, monotonic elapsed-time measurement, and a cancellable
 * wait (CFG-15). Time-dependent logic routes through this seam so tests drive time deterministically
 * instead of depending on real elapsed wall time.
 *
 * One primitive covers the reference's blocking-sleep/scheduled-async-delay pair (CFG-15/CFG-17 vs.
 * CFG-18): Node has no carrier threads to distinguish "block this one" from "schedule that one"
 * against, and every timer is already non-blocking. Recorded in the phase's Deviation Ledger.
 *
 * @public
 */
export interface Clock {
  /**
   * Wall-clock epoch milliseconds. MAY move backwards (clock adjustment, NTP step) and MUST NOT be
   * used for elapsed-time math -- use {@link Clock.monotonic} for that (CFG-16).
   */
  now(): number;

  /**
   * A non-decreasing counter for measuring elapsed durations (CFG-16). Only the difference between
   * two readings of the same clock is meaningful; the absolute value is not.
   */
  monotonic(): number;

  /**
   * Resolves after the requested delay, or rejects with `signal`'s abort reason if it fires first
   * (CFG-17).
   *
   * `0` returns promptly as CFG-17 requires, but on the next turn of the *event loop* rather than the
   * next microtask: a `Promise.resolve()` short-circuit satisfies "promptly" while starving timers
   * and I/O, so a retry loop with a zero backoff spun 4.1 million times in 300ms without letting a
   * pending `setTimeout(fn, 0)` run once.
   *
   * Cancellation surfaces the caller's own abort reason rather than a fresh error. The abort path
   * clears the timer; the resolve path detaches the abort listener. Neither a pending timer nor a
   * live listener outlives the wait.
   *
   * @throws InvariantViolation -- as a rejected promise, never synchronously -- when `durationMs`
   *   is negative, not a finite number, or above the ceiling a timer delay can represent. That is a
   *   programmer error, so it takes the project's assertion signal rather than a domain error a
   *   caller might reasonably catch and recover from.
   */
  sleep(durationMs: number, signal?: AbortSignal): Promise<void>;
}

/**
 * The longest wait a timer delay can carry. `setTimeout` clamps its delay to a 32-bit signed
 * integer; anything larger is *silently* rewritten to `1` (Node says so on stderr and continues), so
 * `sleep(2 ** 31)` returned in 7ms instead of 24.8 days. A configured retry backoff that overflowed
 * -- `RETRY_DELAY=99999999999999999d` parses fine under CFG-7 -- therefore became no backoff at all
 * and a hot loop against the upstream. Loud rejection instead, following RECOV-34's precedent of
 * bounding a duration at what the platform can actually honor.
 */
const MAX_SLEEP_MS = 2 ** 31 - 1;

/**
 * The one wait primitive. Split out of the object literal below so it carries an explicit return
 * type and a name that appears in stack traces.
 */
function sleep(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > MAX_SLEEP_MS
  ) {
    // A rejection, never a synchronous throw: `sleep` returns a promise on every other path, and a
    // caller awaiting it must not have to also wrap the call site in a try/catch.
    return Promise.reject(
      new InvariantViolation(
        `Clock.sleep: durationMs must be a non-negative finite number no greater than ${String(MAX_SLEEP_MS)}, got ${String(durationMs)}`,
      ),
    );
  }
  // CFG-17: an already-fired signal is honored before any timer is scheduled, so a cancelled caller
  // never waits at all and never leaves a timer behind.
  if (signal?.aborted === true) {
    // CFG-17 surfaces the caller's own abort reason verbatim -- wrapping it in an `Error` would
    // replace the cancellation the caller is observing with a fresh one.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- CFG-17 requires the caller's abort reason unchanged, and `AbortSignal.reason` is not typed as `Error`; re-enable if it ever is
    return Promise.reject(signal.reason as unknown);
  }
  // No `durationMs === 0` short-circuit: a resolved promise settles on the microtask queue, which
  // never lets the event loop turn. Zero goes through the same timer as every other duration, so it
  // stays prompt (CFG-17) *and* cancellable, and a zero-backoff loop cannot starve timers and I/O.
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- CFG-17 requires the caller's abort reason unchanged, and `AbortSignal.reason` is not typed as `Error`; re-enable if it ever is
      reject(signal?.reason as unknown);
    };
    const settle = (): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(settle, durationMs);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * The shared platform-backed default CFG-15 requires. Frozen: it is a process-wide singleton, and a
 * caller swapping one method on it would silently retime every consumer that took the default.
 *
 * @public
 */
export const defaultClock: Clock = Object.freeze({
  now: (): number => Date.now(),
  monotonic: (): number => globalThis.performance.now(),
  sleep,
});
