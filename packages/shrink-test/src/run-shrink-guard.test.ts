// SPDX-License-Identifier: MIT
// packages/shrink-test/src/run-shrink-guard.test.ts
// Exercises: NFR-9 (shrink-and-run regression guard, wired into the default build via the root
// `shrink-test` script), NFR-17 (that gate is blocking, not advisory).
// Substitutes for NFR-8's keep-configuration, which this port ships nothing for by design -- see the
// Phase 9 deviation ledger and docs/knowledge/deliberate-deviations.md:32.
import {describe, expect, test} from 'bun:test';
import {runShrinkGuard} from './run-shrink-guard.js';

describe('runShrinkGuard', () => {
  test('the shrunk bundle stays within budget and still runs standalone', async () => {
    const result = await runShrinkGuard();

    expect(result.bundleBytes).toBeLessThanOrEqual(result.budgetBytes);
    expect(result.roundTripSucceeded).toBe(true);
  });
});
