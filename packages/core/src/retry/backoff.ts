// SPDX-License-Identifier: MIT
// packages/core/src/retry/backoff.ts
import {invariant} from '../invariant.js';

/**
 * The pure-math half of the retry schedule (RETRY-9..RETRY-11, RETRY-43). Carried inside
 * `RetrySettings`, never constructed standalone by a caller.
 *
 * @public
 */
export interface BackoffSettings {
  /** The first attempt's delay in milliseconds, before any multiplier or jitter (RETRY-9). */
  readonly initialDelayMs: number;
  /** The exponential growth factor applied per attempt: delay(n) = initialDelayMs * multiplier^n (RETRY-9). */
  readonly multiplier: number;
  /** The ceiling the exponential schedule saturates at, in milliseconds (RETRY-11). */
  readonly maxDelayMs: number;
  /** Symmetric jitter fraction in [0,1]; 0 disables perturbation (RETRY-10). */
  readonly jitter: number;
  /**
   * When set, forces a flat delay and makes the exponential path unreachable (RETRY-43).
   *
   * Deliberately NOT clamped to `maxDelayMs`: RETRY-43 describes the mode as "zeroing the base and
   * cap so only the fixed delay applies", so the cap is part of the schedule this mode replaces
   * rather than a bound that outlives it. A fixed delay longer than `maxDelayMs` is honored.
   */
  readonly fixedDelayMs?: number | undefined;
}

/**
 * Draws uniformly from [delayMs*(1-jitter/2), delayMs*(1+jitter/2)], midpoint delayMs (RETRY-10).
 * A negative sample from a hostile random source floors to zero rather than producing a negative
 * delay.
 */
function applyJitter(
  delayMs: number,
  jitter: number,
  random: () => number,
): number {
  if (jitter === 0) return delayMs;
  const width = delayMs * jitter;
  return Math.max(0, delayMs - width / 2 + random() * width);
}

/**
 * The single backoff calculator (RETRY-13): `initialDelay * multiplier^(attempt-1)`, clamped to the
 * cap, then jittered. `attempt` is 1-indexed, where 1 is the wait BEFORE the first retry (RETRY-9).
 *
 * Overflow-safe by construction (RETRY-11): a large attempt makes `**` return `Infinity`, which
 * `Math.min` absorbs into the cap. It saturates; it never throws.
 *
 * Except at a zero base, where the saturation does not hold and the guard below is what supplies it.
 * `0 * Infinity` is `NaN`, and `Math.min` propagates `NaN` rather than clamping it -- so
 * `initialDelayMs: 0` with any multiplier above 1 produced a `NaN` delay at the attempt where the
 * power overflows (`multiplier: 2` reaches it at attempt 1100; `multiplier: 1e200` at attempt 3).
 * `retrySettings()` accepts both configurations. Downstream, `NaN` is worse than a large number: it
 * fails every comparison, so the engine's budget check, its overshoot check and its `delayMs <= 0`
 * short-circuit all read false and it arrives at `Clock.sleep`, which rejects with a `RangeError`
 * that replaces the failure being retried. Short-circuiting the zero base before the power is taken
 * is exact rather than a repair: the schedule's value there is `0` at every attempt, and jitter
 * around `0` is `0` for any sample (audit #67 / #78).
 *
 * `random` is injected so jitter is assertable rather than statistical -- the same determinism seam
 * CFG-15 wants for the clock.
 *
 * @param attempt - the 1-indexed retry ordinal; 1 is the wait before the first retry.
 * @param settings - the schedule's shape.
 * @param random - the uniform [0,1) source jitter draws from.
 * @returns the delay in milliseconds.
 * @throws InvariantViolation when `attempt` is below 1 -- a programmer error, not an operational one
 *   (RETRY-11).
 *
 * @internal
 */
export function computeDelay(
  attempt: number,
  settings: BackoffSettings,
  random: () => number,
): number {
  invariant(
    attempt >= 1,
    `retry attempt must be 1-indexed and >= 1, got ${String(attempt)}`,
  );
  if (settings.fixedDelayMs !== undefined) return settings.fixedDelayMs;
  // Before the power, not after: `0 * Infinity` is the one product `Math.min` cannot absorb.
  if (settings.initialDelayMs === 0) return 0;
  const growth = settings.initialDelayMs * settings.multiplier ** (attempt - 1);
  return applyJitter(
    Math.min(growth, settings.maxDelayMs),
    settings.jitter,
    random,
  );
}
