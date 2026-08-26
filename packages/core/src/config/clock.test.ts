// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.test.ts
// Exercises: CFG-15 (three operations, shared default), CFG-16 (monotonic non-decreasing, meaningful
// only relative to itself), CFG-17 (sleep rejects negative, resolves promptly at zero, honors
// cancellation).
// Shipped ahead of Phase 7a as the prerequisite slice Phase 5a's plan names.
// docs/superpowers/plans/2026-07-28-phase7a-configuration.md Task 1
import {describe, expect, test} from 'bun:test';
import {defaultClock} from './clock.js';

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this
 * runner's type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper
 * keeps the assertion honest without a lint suppression.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('defaultClock', () => {
  test('now() returns a plausible wall-clock epoch millisecond value', () => {
    const before = Date.now();
    const value = defaultClock.now();
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  test('monotonic() is non-decreasing across two readings', () => {
    const first = defaultClock.monotonic();
    const second = defaultClock.monotonic();
    expect(second).toBeGreaterThanOrEqual(first);
  });

  test('sleep(0) resolves promptly', async () => {
    const start = defaultClock.monotonic();
    await defaultClock.sleep(0);
    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('sleep(negative) rejects', async () => {
    expect(await rejectionOf(defaultClock.sleep(-1))).toBeDefined();
  });

  test('sleep honors an already-aborted signal, rejecting with the abort reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    const reason = await rejectionOf(
      defaultClock.sleep(10_000, controller.signal),
    );
    expect((reason as Error).message).toBe('cancelled');
  });

  test('sleep honors cancellation mid-wait, resolving the race promptly rather than after the full delay', async () => {
    const controller = new AbortController();
    const start = defaultClock.monotonic();
    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => {
      controller.abort(new Error('cancelled'));
    });

    expect(((await rejectionOf(pending)) as Error).message).toBe('cancelled');
    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('a real wait elapses at least the requested duration', async () => {
    const start = defaultClock.monotonic();
    await defaultClock.sleep(20);
    expect(defaultClock.monotonic() - start).toBeGreaterThanOrEqual(15);
  });
});
