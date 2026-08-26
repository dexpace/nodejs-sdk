// SPDX-License-Identifier: MIT
// packages/core/src/config/retryable.test.ts
// Exercises: CFG-35 (exactly 408, 429, and 5xx except 501/505 are retryable; this exact set is a
// hard contract where implemented). Re-exported by Phase 5a's classify.ts as RETRY-1's definition.
// docs/superpowers/plans/2026-07-28-phase7a-configuration.md Task 3
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {RETRYABLE_STATUSES, isRetryableStatus} from './retryable.js';

describe('isRetryableStatus', () => {
  test('408 and 429 are retryable', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('500-599 are retryable except 501 and 505', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
    expect(isRetryableStatus(501)).toBe(false);
    expect(isRetryableStatus(505)).toBe(false);
  });

  test('other statuses are not retryable', () => {
    for (const code of [200, 201, 301, 400, 401, 404, 409, 418, 499, 600]) {
      expect(isRetryableStatus(code)).toBe(false);
    }
  });

  test('the exported set and the predicate are the same source', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 700}), code => {
        expect(isRetryableStatus(code)).toBe(RETRYABLE_STATUSES.has(code));
      }),
    );
  });
});
