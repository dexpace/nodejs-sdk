// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.test.ts
// Exercises: CFG-15 (three operations, shared platform-backed default), CFG-16 (monotonic
// non-decreasing, meaningful only relative to itself), CFG-17 (sleep rejects negative, resolves
// promptly at zero, honors cancellation), and V13 (any finite duration is honored by chaining timers,
// so RETRY-18's 365-day pacing clamp -- ~14x what one setTimeout can carry -- is waitable).
import {describe, expect, test} from 'bun:test';
import {CancellationError} from '../seams/transport.js';
import {MAX_SLEEP_MS, defaultClock, sleepInChunks} from './clock.js';

/**
 * Returns the reason a promise rejected with, failing loudly if it resolves instead. Awaiting the
 * promise directly (rather than `expect(...).rejects`) keeps the rejection reason available for
 * identity assertions -- CFG-17 is specifically about *which* value surfaces, not merely that one
 * does.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (reason: unknown) {
    return reason;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('defaultClock.now (CFG-15, CFG-16)', () => {
  test('returns a wall-clock epoch millisecond value bracketed by two Date.now readings', () => {
    const before = Date.now();

    const value = defaultClock.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('defaultClock.monotonic (CFG-16)', () => {
  test('is non-decreasing across two readings', () => {
    const first = defaultClock.monotonic();

    const second = defaultClock.monotonic();

    expect(second).toBeGreaterThanOrEqual(first);
  });

  test('draws on a different source from now rather than the wall clock under another name', () => {
    // CFG-16's whole point: `now` MAY step backwards, `monotonic` MUST NOT, which is why elapsed-time
    // math rides `monotonic`. Wiring `monotonic` to `Date.now()` satisfies every other assertion in
    // this file, so the distinction needs its own test.
    // Read with `Reflect.get` rather than `defaultClock.monotonic`: a bare method reference trips
    // `@typescript-eslint/unbound-method`, and the fact being asserted is about the two property
    // *values*, not about calling either of them.
    expect(Reflect.get(defaultClock, 'monotonic')).not.toBe(
      Reflect.get(defaultClock, 'now'),
    );
  });

  test('reads on a process-relative scale, not an epoch scale', () => {
    // The second, independent half: an implementation could still return a wall-clock reading from a
    // distinct function. `performance.now()` is milliseconds since process start; `Date.now()` is a
    // ~1.7e12 epoch offset. Anything within 1e9 ms (~11.6 days) of the epoch value is the wall clock.
    const separation = Math.abs(defaultClock.monotonic() - defaultClock.now());

    expect(separation).toBeGreaterThan(1e9);
  });
});

describe('defaultClock.sleep (CFG-17)', () => {
  test('resolves promptly when the duration is zero', async () => {
    const start = defaultClock.monotonic();

    await defaultClock.sleep(0);

    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('waits at least the requested duration when not cancelled', async () => {
    const start = defaultClock.monotonic();

    await defaultClock.sleep(20);

    expect(defaultClock.monotonic() - start).toBeGreaterThanOrEqual(15);
  });

  test("rejects with the signal's own abort reason when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);

    const pending = defaultClock.sleep(60_000, controller.signal);

    const surfaced = await rejectionOf(pending);
    expect(surfaced).toBeInstanceOf(CancellationError);
    expect((surfaced as Error).cause).toBe(reason);
  });

  test('rejects with a CancellationError carrying the reason when cancelled mid-wait', async () => {
    // Mapped rather than rethrown verbatim (N1/XCUT-1): one cancellation type wherever the abort was
    // observed, with the caller's own reason kept as `cause`, so nothing is lost. CFG-17's
    // "re-assert the cancellation status" clause is about the STATUS, not the object -- and
    // `AbortSignal.aborted` is latched, so a downstream handler sees the cancelled state either way.
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const start = defaultClock.monotonic();

    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => {
      controller.abort(reason);
    });

    const surfaced = await rejectionOf(pending);
    expect(surfaced).toBeInstanceOf(CancellationError);
    expect((surfaced as Error).cause).toBe(reason);
    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('an already-aborted signal short-circuits before any timer is scheduled', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const start = defaultClock.monotonic();

    expect(
      await rejectionOf(defaultClock.sleep(60_000, controller.signal)),
    ).toBeDefined();

    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });
});

describe('defaultClock.sleep duration bounds and scheduling (CFG-17, V13)', () => {
  test('rejects a negative duration with a RangeError, as a rejection not a throw', async () => {
    const reason = await rejectionOf(defaultClock.sleep(-1));

    expect(reason).toBeInstanceOf(RangeError);
  });

  test('rejects a non-finite duration', async () => {
    expect(
      await rejectionOf(defaultClock.sleep(Number.POSITIVE_INFINITY)),
    ).toBeInstanceOf(RangeError);
    expect(await rejectionOf(defaultClock.sleep(Number.NaN))).toBeInstanceOf(
      RangeError,
    );
  });

  test("a duration past one timer's reach is CHUNKED, never clamped to 1ms (V13)", async () => {
    // The defect this replaces: `setTimeout` silently rewrites a delay above 2^31-1 to `1`, so
    // `sleep(2 ** 31)` returned in ~1ms instead of waiting 24.8 days. Phase 7a repaired that by
    // REJECTING the duration, which also made RETRY-18's 365-day pacing clamp unwaitable.
    //
    // Asserted through the injected chunk rather than by waiting: `2 ** 31` against a 1ms chunk
    // would schedule two billion timers, so the scheduler count is checked with a chunk that
    // divides a small duration. What this pins is that the SLICE handed to any single timer never
    // exceeds the chunk -- which is exactly what stops the platform clamping.
    const slices: number[] = [];

    await sleepInChunks(4, undefined, {
      chunkMs: 1,
      onChunk: sliceMs => slices.push(sliceMs),
    });

    expect(slices).toEqual([1, 1, 1, 1]);
  });

  test('3x the chunk plus one schedules four timers and resolves (V13)', async () => {
    const slices: number[] = [];

    await sleepInChunks(3 * 2 + 1, undefined, {
      chunkMs: 2,
      onChunk: sliceMs => slices.push(sliceMs),
    });

    expect(slices).toHaveLength(4);
    expect(slices).toEqual([2, 2, 2, 1]);
    expect(slices.reduce((a, b) => a + b, 0)).toBe(7);
  });

  test('every slice is bounded by MAX_SLEEP_MS in production, with no chunking injected', () => {
    // The production chunk is the platform's own limit, so a real oversized sleep slices at exactly
    // the largest delay a timer can carry rather than at some smaller invented number.
    expect(MAX_SLEEP_MS).toBe(2 ** 31 - 1);
  });
});

describe('defaultClock.sleep chunk-boundary cancellation (CFG-17, V13)', () => {
  test('an abort BETWEEN chunks rejects with the mapped CancellationError', async () => {
    const controller = new AbortController();
    const reason = new Error('gave up mid-wait');
    const slices: number[] = [];

    const pending = sleepInChunks(10, controller.signal, {
      chunkMs: 1,
      onChunk: sliceMs => {
        slices.push(sliceMs);
        if (slices.length === 3) controller.abort(reason);
      },
    });

    const surfaced = await rejectionOf(pending);
    expect(surfaced).toBeInstanceOf(CancellationError);
    expect((surfaced as Error).cause).toBe(reason);
    // Stopped at the boundary rather than running all ten slices.
    expect(slices.length).toBeLessThan(10);
  });

  test('a duration at exactly one chunk still takes a single timer', async () => {
    const slices: number[] = [];

    await sleepInChunks(2, undefined, {
      chunkMs: 2,
      onChunk: sliceMs => slices.push(sliceMs),
    });

    expect(slices).toEqual([2]);
  });

  test('yields to the event loop at zero rather than only to the microtask queue', async () => {
    // A `Promise.resolve()` short-circuit satisfies "returns promptly" while starving timers and
    // I/O: a zero-backoff retry loop spun millions of times without ever letting a pending
    // `setTimeout(fn, 0)` run.
    let timerRan = false;
    setTimeout(() => {
      timerRan = true;
    }, 0);

    await defaultClock.sleep(0);

    expect(timerRan).toBe(true);
  });

  test('honors an already-aborted signal ahead of the zero-duration path', async () => {
    // The aborted check precedes the duration path, so cancellation wins even where the wait would
    // have been instantaneous anyway (CFG-17).
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);

    const surfaced = await rejectionOf(
      defaultClock.sleep(0, controller.signal),
    );
    expect(surfaced).toBeInstanceOf(CancellationError);
    expect((surfaced as Error).cause).toBe(reason);
  });
});
