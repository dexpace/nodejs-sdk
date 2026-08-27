// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.test.ts
// Exercises: CFG-15 (three operations, shared platform-backed default), CFG-16 (monotonic
// non-decreasing, meaningful only relative to itself), CFG-17 (sleep rejects negative, resolves
// promptly at zero, honors cancellation by surfacing the signal's own abort reason).
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {defaultClock} from './clock.js';

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

  test('rejects with an InvariantViolation when the duration is negative', async () => {
    const pending = defaultClock.sleep(-1);

    expect(await rejectionOf(pending)).toBeInstanceOf(InvariantViolation);
  });

  test('rejects with an InvariantViolation when the duration is NaN', async () => {
    const pending = defaultClock.sleep(Number.NaN);

    expect(await rejectionOf(pending)).toBeInstanceOf(InvariantViolation);
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

    expect(await rejectionOf(pending)).toBe(reason);
  });

  test("rejects with the signal's own abort reason when cancelled mid-wait", async () => {
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const start = defaultClock.monotonic();

    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => {
      controller.abort(reason);
    });

    expect(await rejectionOf(pending)).toBe(reason);
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

describe('defaultClock.sleep duration bounds and scheduling (CFG-17)', () => {
  test('rejects with an InvariantViolation above the timer-delay ceiling', async () => {
    // `setTimeout` clamps its delay to a 32-bit signed integer and *silently* rewrites anything
    // larger to 1, so this used to resolve in about a millisecond instead of waiting 24.8 days --
    // a configured retry backoff that overflowed became no backoff at all.
    const reason = await rejectionOf(defaultClock.sleep(2 ** 31));

    expect(reason).toBeInstanceOf(InvariantViolation);
    expect((reason as InvariantViolation).message).toContain('2147483647');
  });

  test('accepts the largest duration a timer delay can represent, rather than rejecting it', async () => {
    // The inclusive edge of the ceiling. Asserted by the reason's *identity*: a bare `toBeDefined()`
    // could not tell this abort from the `InvariantViolation` that widening the bound by one (`>` to
    // `>=`) would produce, so the only test guarding the edge could not see the edge move.
    const controller = new AbortController();
    const reason = new Error('cancelled');

    const pending = defaultClock.sleep(2 ** 31 - 1, controller.signal);
    controller.abort(reason);

    expect(await rejectionOf(pending)).toBe(reason);
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

    expect(await rejectionOf(defaultClock.sleep(0, controller.signal))).toBe(
      reason,
    );
  });
});
