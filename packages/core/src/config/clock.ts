// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.ts

/**
 * CFG-15: an injectable seam for wall-clock instant, monotonic elapsed-time measurement, and a
 * cancellable wait. One primitive for the JVM reference's blocking-sleep/scheduled-async-delay pair
 * (CFG-15/17 vs. 18) -- Node has no carrier threads to distinguish "block this one" from "schedule
 * that one" against, and every timer is already non-blocking.
 *
 * @public
 */
export interface Clock {
  /** Wall-clock epoch milliseconds. MAY move backwards; MUST NOT be used for elapsed-time math (CFG-16). */
  now(): number;
  /**
   * Monotonic elapsed-time counter (CFG-16). Absolute value is meaningless -- only differences
   * between two readings are.
   */
  monotonic(): number;
  /**
   * Resolves after `ms` milliseconds, or rejects with `signal`'s abort reason if it fires first
   * (CFG-17). Rejects for a negative `ms`; resolves promptly (no timer scheduled) for `ms <= 0`.
   *
   * @param ms - the delay in milliseconds.
   * @param signal - aborts the wait, rejecting with the signal's reason.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms < 0) {
    return Promise.reject(
      new RangeError(`Clock.sleep: ms must be non-negative, got ${String(ms)}`),
    );
  }
  if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
  if (ms === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/** The platform-backed default (CFG-15's "a shared platform-backed default MUST be provided"). */
export const defaultClock: Clock = {
  now: () => Date.now(),
  monotonic: () => globalThis.performance.now(),
  sleep,
};
