// SPDX-License-Identifier: MIT
// packages/shrink-test/src/run-shrink-guard.test.ts
// Exercises: NFR-9 (shrink-and-run regression guard, wired into the default build via the root
// `shrink-test` script), NFR-17 (that gate is blocking, not advisory), PAGE-12 and NFR-10 (the
// guarded, module-scope `[Symbol.asyncDispose]` installs that keep the emitted artifact on the
// declared Node floor are still present and callable after tree-shaking -- see
// `fixture-app.ts`'s `probeDisposalSymbol`).
// Substitutes for NFR-8's keep-configuration, which this port ships nothing for by design -- see the
// Phase 9 deviation ledger and docs/knowledge/deliberate-deviations.md:55 (that corpus file is flagged
// stale as of 2026-08-30; docs/deviations.md section 10 is the current statement).
import {describe, expect, test} from 'bun:test';
import {runShrinkGuard} from './run-shrink-guard.js';

describe('runShrinkGuard', () => {
  test('the shrunk bundle stays within budget and still runs standalone', async () => {
    const result = await runShrinkGuard();

    expect(result.bundleBytes).toBeLessThanOrEqual(result.budgetBytes);
    expect(result.roundTripSucceeded).toBe(true);
  });
});
