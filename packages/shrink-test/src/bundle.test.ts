// SPDX-License-Identifier: MIT
// packages/shrink-test/src/bundle.test.ts
// Exercises: NFR-9 (the shrink-and-run guard's bundle half -- a real minify + tree-shake pass over
// the shipped packages, which is what the round-trip check in run-shrink-guard.test.ts then runs).
import {describe, expect, test} from 'bun:test';
import {SHRINK_TEST_CONFIG} from '../shrink-test.config.js';
import {buildShrinkBundle} from './bundle.js';

describe('buildShrinkBundle', () => {
  test('produces a single bundle within the configured budget', async () => {
    const {code, bytes} = await buildShrinkBundle();

    expect(code.length).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(SHRINK_TEST_CONFIG.budgetBytes);
  });

  test('minifies, rather than emitting the readable source verbatim', async () => {
    const {code} = await buildShrinkBundle();

    // Source indentation would survive verbatim if `minify` silently stopped applying.
    expect(code).not.toContain('\n  runFixtureApp');
  });

  test('tree-shakes, rather than inlining every package the workspace publishes', async () => {
    const {bytes} = await buildShrinkBundle();

    // The fixture touches a narrow slice of core. Pulling the barrel in wholesale -- the regression
    // this guard exists to catch -- lands as a multiple of the budget, not a few bytes over it.
    expect(bytes).toBeLessThan(SHRINK_TEST_CONFIG.budgetBytes * 2);
  });
});
