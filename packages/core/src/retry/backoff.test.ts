// SPDX-License-Identifier: MIT
// packages/core/src/retry/backoff.test.ts
// Exercises: RETRY-9 (initialDelay * multiplier^(attempt-1), 1-indexed, capped), RETRY-10 (symmetric
// jitter bounds, midpoint, j=0 identity, negative floors to zero), RETRY-11 (attempt < 1 rejected,
// overflow saturates -- INCLUDING at a zero initial delay, where `0 * Infinity` used to give NaN;
// audit #67 / #78), RETRY-43 (fixed delay disables backoff AND jitter).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {computeDelay, type BackoffSettings} from './backoff.js';

const SETTINGS: BackoffSettings = {
  initialDelayMs: 200,
  multiplier: 2,
  maxDelayMs: 8000,
  jitter: 0,
};
const never = (): number => 0.5;

describe('exponential schedule', () => {
  test('attempt 1 is the initial delay, 1-indexed (RETRY-9)', () => {
    expect(computeDelay(1, SETTINGS, never)).toBe(200);
  });

  test('each attempt multiplies the previous (RETRY-9)', () => {
    expect(computeDelay(2, SETTINGS, never)).toBe(400);
    expect(computeDelay(3, SETTINGS, never)).toBe(800);
    expect(computeDelay(4, SETTINGS, never)).toBe(1600);
  });

  test('growth is clamped to maxDelayMs (RETRY-9)', () => {
    expect(computeDelay(20, SETTINGS, never)).toBe(8000);
  });

  test('an overflowing attempt saturates to the cap instead of throwing (RETRY-11)', () => {
    expect(computeDelay(5000, SETTINGS, never)).toBe(8000);
    expect(Number.isFinite(computeDelay(5000, SETTINGS, never))).toBe(true);
  });

  test('attempt < 1 is a programmer error (RETRY-11)', () => {
    expect(() => computeDelay(0, SETTINGS, never)).toThrow();
    expect(() => computeDelay(-1, SETTINGS, never)).toThrow();
  });
});

/**
 * RETRY-11's "saturating rather than throwing" has one hole, and it is the zero base. Every other
 * accepted setting overflows into `Math.min`'s cap; `0 * Infinity` overflows into `NaN`, which
 * `Math.min` propagates. Audit #67 / #78.
 */
describe('a zero initial delay (RETRY-11)', () => {
  test('stays zero where the power overflows', () => {
    // Downstream, NaN is worse than a large number: `overshootsBudget` reads false for it, the
    // engine's `delayMs <= 0` guard reads false for it, and it lands in `Clock.sleep` as a
    // RangeError that replaces the failure being retried. `retrySettings()` accepts both settings
    // below (`initialDelayMs >= 0`, finite `multiplier >= 1`), so RETRY-11 covers them.
    const hugeMultiplier: BackoffSettings = {
      ...SETTINGS,
      initialDelayMs: 0,
      multiplier: 1e200,
    };
    expect(computeDelay(3, hugeMultiplier, never)).toBe(0);

    const manyAttempts: BackoffSettings = {...SETTINGS, initialDelayMs: 0};
    // 2 ** 1099 is Infinity: the first attempt at which the doubling schedule overflows a double.
    expect(computeDelay(1100, manyAttempts, never)).toBe(0);
  });

  test('stays zero under jitter too (RETRY-10)', () => {
    const jitteredZero: BackoffSettings = {
      ...SETTINGS,
      initialDelayMs: 0,
      multiplier: 1e200,
      jitter: 1,
    };
    expect(computeDelay(4, jitteredZero, () => 0)).toBe(0);
    expect(computeDelay(4, jitteredZero, () => 1)).toBe(0);
  });

  test('property: every accepted schedule is finite and non-negative (RETRY-11)', () => {
    // The ranges are exactly what `retrySettings()` admits, so a passing property means no
    // configuration a caller can build reaches the engine as a non-finite delay. `initialDelayMs`
    // is drawn through an explicit `constant(0)` arm: the failing region needs a zero base AND an
    // overflowing power together, and 100 runs of an unbiased double never produced the pair.
    const accepted = fc.record({
      initialDelayMs: fc.oneof(
        fc.constant(0),
        fc.double({min: 0, max: 1e9, noNaN: true}),
      ),
      multiplier: fc.double({min: 1, max: 1e300, noNaN: true}),
      maxDelayMs: fc.double({min: 0, max: 1e9, noNaN: true}),
      jitter: fc.double({min: 0, max: 1, noNaN: true}),
    });

    fc.assert(
      fc.property(
        fc.integer({min: 1, max: 5000}),
        accepted,
        (attempt, settings) => {
          const delay = computeDelay(attempt, settings, never);
          expect(Number.isFinite(delay)).toBe(true);
          expect(delay).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('symmetric jitter', () => {
  const jittered: BackoffSettings = {...SETTINGS, jitter: 0.2};

  test('jitter 0 returns the base delay unperturbed (RETRY-10)', () => {
    expect(computeDelay(3, SETTINGS, () => 0)).toBe(800);
    expect(computeDelay(3, SETTINGS, () => 1)).toBe(800);
  });

  test('the midpoint sample returns the base delay (RETRY-10)', () => {
    expect(computeDelay(3, jittered, () => 0.5)).toBeCloseTo(800, 6);
  });

  test('the sample spans exactly [d(1-j/2), d(1+j/2)] (RETRY-10)', () => {
    expect(computeDelay(3, jittered, () => 0)).toBeCloseTo(720, 6);
    expect(computeDelay(3, jittered, () => 1)).toBeCloseTo(880, 6);
  });

  test('a negative sample floors to zero (RETRY-10)', () => {
    const wide: BackoffSettings = {
      initialDelayMs: 10,
      multiplier: 1,
      maxDelayMs: 10,
      jitter: 1,
    };
    expect(computeDelay(1, wide, () => -100)).toBe(0);
  });

  test('property: every sample lies inside the symmetric window (RETRY-10)', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 1, max: 12}),
        fc.double({min: 0, max: 1, noNaN: true}),
        fc.double({min: 0, max: 1, noNaN: true}),
        (attempt, jitter, sample) => {
          const settings: BackoffSettings = {...SETTINGS, jitter};
          const base = Math.min(200 * 2 ** (attempt - 1), 8000);
          const delay = computeDelay(attempt, settings, () => sample);
          expect(delay).toBeGreaterThanOrEqual(base * (1 - jitter / 2) - 1e-9);
          expect(delay).toBeLessThanOrEqual(base * (1 + jitter / 2) + 1e-9);
        },
      ),
    );
  });

  test('property: the unjittered delay never exceeds the cap and never decreases (RETRY-9)', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 200}), attempt => {
        const delay = computeDelay(attempt, SETTINGS, never);
        expect(delay).toBeLessThanOrEqual(SETTINGS.maxDelayMs);
        expect(delay).toBeGreaterThanOrEqual(
          computeDelay(Math.max(1, attempt - 1), SETTINGS, never),
        );
      }),
    );
  });
});

describe('fixed delay (RETRY-43)', () => {
  test('a fixed delay disables both backoff growth and jitter', () => {
    const fixed: BackoffSettings = {
      ...SETTINGS,
      jitter: 0.5,
      fixedDelayMs: 1234,
    };
    expect(computeDelay(1, fixed, () => 0)).toBe(1234);
    expect(computeDelay(9, fixed, () => 1)).toBe(1234);
  });

  test('a fixed delay of zero is honored, not treated as absent', () => {
    expect(computeDelay(4, {...SETTINGS, fixedDelayMs: 0}, never)).toBe(0);
  });
});
