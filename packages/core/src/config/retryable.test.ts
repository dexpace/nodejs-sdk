// SPDX-License-Identifier: MIT
// packages/core/src/config/retryable.test.ts
// Exercises: CFG-35 (exactly 408, 429, and 5xx except 501/505 are retryable; where implemented,
// this exact set is a hard contract).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {RETRYABLE_STATUSES, isRetryableStatus} from './retryable.js';

/**
 * CFG-35's membership rule restated from the requirement's prose, so a property can compare the
 * implementation against the requirement rather than against itself.
 */
function isRetryableByRequirement(code: number): boolean {
  if (code === 408 || code === 429) return true;
  return code >= 500 && code <= 599 && code !== 501 && code !== 505;
}

/** 408 and 429, plus the hundred 5xx codes less 501 and 505 (CFG-35). */
const RETRYABLE_STATUS_COUNT = 2 + 100 - 2;

describe('RETRYABLE_STATUSES immutability (CFG-35)', () => {
  test('refuses an add, so the hard contract cannot be rewritten by a consumer', () => {
    // The `ReadonlySet` type is compile-time only, and `Object.freeze` does not seal a `Set`'s
    // internal slots. This binding leaves through the package barrel, so `add(418)` used to succeed
    // and permanently change the process-wide classifier for everyone.
    expect(() => (RETRYABLE_STATUSES as Set<number>).add(418)).toThrow(
      InvariantViolation,
    );
    expect(isRetryableStatus(418)).toBe(false);
  });

  test('refuses a delete, so a retryable status cannot be removed by a consumer', () => {
    expect(() => (RETRYABLE_STATUSES as Set<number>).delete(500)).toThrow(
      InvariantViolation,
    );
    expect(isRetryableStatus(500)).toBe(true);
  });

  test('refuses a clear', () => {
    expect(() => {
      (RETRYABLE_STATUSES as Set<number>).clear();
    }).toThrow(InvariantViolation);
    expect(RETRYABLE_STATUSES.size).toBe(RETRYABLE_STATUS_COUNT);
  });

  test('is frozen, so the refusing mutators cannot be defined away', () => {
    expect(Object.isFrozen(RETRYABLE_STATUSES)).toBe(true);
  });
});

describe('isRetryableStatus (CFG-35)', () => {
  test('treats 408 Request Timeout as retryable', () => {
    expect(isRetryableStatus(408)).toBe(true);
  });

  test('treats 429 Too Many Requests as retryable', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('treats the 5xx range as retryable', () => {
    for (const code of [500, 502, 503, 504, 599]) {
      expect(isRetryableStatus(code)).toBe(true);
    }
  });

  test('excludes 501 Not Implemented from the retryable 5xx range', () => {
    expect(isRetryableStatus(501)).toBe(false);
  });

  test('excludes 505 HTTP Version Not Supported from the retryable 5xx range', () => {
    expect(isRetryableStatus(505)).toBe(false);
  });

  test('treats every other status as not retryable', () => {
    for (const code of [200, 201, 301, 400, 401, 404, 409, 418, 499, 600]) {
      expect(isRetryableStatus(code)).toBe(false);
    }
  });
});

describe('RETRYABLE_STATUSES (CFG-35)', () => {
  // Both properties compare against `isRetryableByRequirement`, never against each other.
  // `isRetryableStatus`'s body *is* `RETRYABLE_STATUSES.has(code)`, so a property asserting those two
  // agree compares an expression with itself and survives replacing the whole set with `{418}`.
  test('holds exactly the codes CFG-35 names, across the whole status range', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 700}), code => {
        expect(RETRYABLE_STATUSES.has(code)).toBe(
          isRetryableByRequirement(code),
        );
      }),
    );
  });

  test('exposes a predicate that answers what CFG-35 names, across the whole status range', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 700}), code => {
        expect(isRetryableStatus(code)).toBe(isRetryableByRequirement(code));
      }),
    );
  });

  test('holds exactly 100 codes -- 408, 429, and the hundred 5xx less 501 and 505', () => {
    expect(RETRYABLE_STATUSES.size).toBe(RETRYABLE_STATUS_COUNT);
  });
});
