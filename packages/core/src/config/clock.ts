// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.ts
import {abortToSdkError} from '../cancellation.js';

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
   * Resolves after the requested delay, or rejects if `signal` fires first (CFG-17).
   *
   * `0` returns promptly as CFG-17 requires, but on the next turn of the *event loop* rather than the
   * next microtask: a `Promise.resolve()` short-circuit satisfies "promptly" while starving timers
   * and I/O, so a retry loop with a zero backoff spun 4.1 million times in 300ms without letting a
   * pending `setTimeout(fn, 0)` run once.
   *
   * @remarks
   * **Any finite, non-negative duration is honored**, including one longer than a single
   * `setTimeout` delay can represent. `setTimeout` clamps a delay above 2^31 - 1 ms and *silently*
   * rewrites it to `1`, so the default implementation chains timers in chunks rather than issuing
   * one oversized delay. That matters because `RETRY-18`/`RECOV-26` mandate clamping a server pacing
   * hint to a 365-day ceiling — roughly fourteen times what one timer can carry — so a conformant
   * retry must be able to wait longer than one timer allows.
   *
   * `Clock` is a seam a consumer may implement. **A custom implementation must honor long durations
   * too**: passing `durationMs` straight to `setTimeout` reintroduces the silent clamp, which turns
   * an overflowed backoff into no backoff at all and a hot loop against the upstream.
   *
   * Cancellation is checked before the first timer and again between chunks, so a long wait aborts
   * promptly rather than at the next chunk boundary only. The abort path clears the pending timer;
   * the resolve path detaches the abort listener. Neither a pending timer nor a live listener
   * outlives the wait.
   *
   * @param durationMs - how long to wait; any finite, non-negative number.
   * @param signal - the caller's cancellation signal, if any.
   * @returns a promise resolving when the full duration has elapsed.
   * @throws CancellationError when `signal` aborts, carrying the caller's own abort reason as
   *   `cause` — or `TransportFailureError` when the abort was a timeout, so a cancellation stays
   *   distinguishable from a timeout (XCUT-1, XCUT-3). CFG-17's "re-assert the cancellation status"
   *   clause is satisfied structurally: `AbortSignal.aborted` is latched, so a downstream handler
   *   observes the cancelled state whatever object is thrown.
   * @throws RangeError as a rejected promise, never synchronously, when `durationMs` is negative or
   *   not a finite number.
   */
  sleep(durationMs: number, signal?: AbortSignal): Promise<void>;
}

/**
 * The longest delay ONE `setTimeout` call can carry. Above this the platform clamps to a 32-bit
 * signed integer and *silently* rewrites the delay to `1` (Node prints a `TimeoutOverflowWarning` on
 * stderr and continues), so a single `setTimeout(fn, 2 ** 31)` fires in about a millisecond instead
 * of waiting 24.8 days.
 *
 * This is the CHUNK SIZE, not a ceiling on `sleep`. Until 2026-09-02 it was a ceiling: `sleep`
 * rejected anything larger with an `InvariantViolation`. That repaired the silent clamp — which was
 * the 2026-08-27 adversarial review's actual intent — but it also made a `RETRY-18`-conformant
 * pacing wait impossible, since that requirement clamps a server hint to 365 days, roughly fourteen
 * times this value. Chaining timers keeps the review's intent (never a silent clamp) and drops the
 * premise it rested on (that one timer is all there is).
 *
 * @internal
 */
export const MAX_SLEEP_MS = 2 ** 31 - 1;

/**
 * Chunking parameters for {@link sleepInChunks}, injected only by tests.
 *
 * A multi-chunk wait is otherwise unobservable without waiting 24.8 real days or installing a fake
 * timer. A tiny `chunkMs` makes the chunking testable on REAL timers, and `onChunk` counts the
 * slices without the test having to infer them from elapsed time.
 *
 * @internal
 */
export interface SleepChunking {
  /** The largest slice to hand a single timer. Defaults to {@link MAX_SLEEP_MS}. */
  readonly chunkMs: number;
  /** Called once per slice, before its timer is scheduled, with the slice's length. */
  readonly onChunk?: ((sliceMs: number) => void) | undefined;
}

/**
 * One slice: a single timer raced against the signal. Never called with more than `MAX_SLEEP_MS`.
 *
 * The abort path clears the timer and the resolve path detaches the listener, so neither outlives
 * the slice -- which is what keeps a chunked wait from accumulating one listener per chunk.
 */
function sleepOnce(sliceMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // The no-signal case is split out rather than written with `?.` throughout, so the abort branch
    // below can close over a NARROWED `signal` -- otherwise mapping the reason needs a non-null
    // assertion, which this project's lint forbids and which would be load-bearing here.
    if (signal === undefined) {
      setTimeout(resolve, sliceMs);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortToSdkError(signal, signal.reason));
    };
    const settle = (): void => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(settle, sliceMs);
    signal.addEventListener('abort', onAbort, {once: true});
  });
}

/**
 * The one wait primitive (CFG-17), chaining timers so any finite duration is honored.
 *
 * Split out of the object literal below so it carries an explicit return type and a name that
 * appears in stack traces, and exported so a test can drive the chunking with a tiny `chunkMs` on
 * real timers instead of waiting 24.8 days or installing a fake clock.
 *
 * @param durationMs - how long to wait; any finite, non-negative number.
 * @param signal - the caller's cancellation signal, if any.
 * @param chunking - test-only slice control; production passes nothing.
 * @returns a promise resolving when the full duration has elapsed.
 *
 * @internal
 */
export async function sleepInChunks(
  durationMs: number,
  signal?: AbortSignal,
  chunking?: SleepChunking,
): Promise<void> {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    // A rejection, never a synchronous throw: `sleep` returns a promise on every other path, and a
    // caller awaiting it must not have to also wrap the call site in a try/catch. A RangeError
    // rather than the project's assertion signal -- `InvariantViolation` is `@internal`, so a
    // `@throws` naming it on this `@public` method promised a class no consumer can catch.
    return Promise.reject(
      new RangeError(
        `Clock.sleep: durationMs must be a non-negative finite number, got ${String(durationMs)}`,
      ),
    );
  }
  const chunkMs = chunking?.chunkMs ?? MAX_SLEEP_MS;
  let remaining = durationMs;
  // A `do` rather than a `while`: zero must still go through ONE real timer. A resolved promise
  // settles on the microtask queue, which never lets the event loop turn, so a zero-backoff loop
  // would starve timers and I/O -- measured at 4.1 million iterations in 300ms with a pending
  // `setTimeout(fn, 0)` never running.
  do {
    // At the loop HEAD, so this one statement is both CFG-17's "an already-fired signal is honored
    // before any timer is scheduled" and the between-chunks check that lets a long wait abort at a
    // slice boundary. An abort arriving mid-slice is rejected immediately by `sleepOnce`'s own
    // listener, so no window is left uncovered.
    if (signal?.aborted === true) {
      throw abortToSdkError(signal, signal.reason);
    }
    const slice = Math.min(remaining, chunkMs);
    chunking?.onChunk?.(slice);
    await sleepOnce(slice, signal);
    remaining -= slice;
  } while (remaining > 0);
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
  // Bound without the chunking parameter, so the seam's public signature stays two parameters and
  // production always takes MAX_SLEEP_MS slices.
  sleep: (durationMs: number, signal?: AbortSignal): Promise<void> =>
    sleepInChunks(durationMs, signal),
});
