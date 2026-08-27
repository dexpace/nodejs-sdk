// SPDX-License-Identifier: MIT
// packages/core/src/redirect/codes.test.ts
// Exercises: REDIR-1 (the recognized set is exactly {301,302,303,307,308}; any other status is returned
// verbatim without consulting redirect logic), REDIR-2 (300/304/305 are never auto-followed even with a
// Location), REDIR-3 (301/302 gated on method membership, default {GET,HEAD}), REDIR-4 (307/308 gated the
// same way), REDIR-5 (303 gated ONLY on the opt-in, independent of the original method).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import type {Method} from '../http/method.js';
import {
  DEFAULT_ALLOWED_METHODS,
  REDIRECT_STATUSES,
  isEligibleByCode,
  isRecognizedRedirect,
} from './codes.js';

describe('isRecognizedRedirect', () => {
  test('301, 302, 303, 307, 308 are recognized', () => {
    for (const code of [301, 302, 303, 307, 308]) {
      expect(isRecognizedRedirect(code)).toBe(true);
    }
  });

  test('300, 304, 305 are never recognized (REDIR-2)', () => {
    for (const code of [300, 304, 305]) {
      expect(isRecognizedRedirect(code)).toBe(false);
    }
  });

  test('non-3xx statuses are not recognized (REDIR-1)', () => {
    for (const code of [200, 404, 500]) {
      expect(isRecognizedRedirect(code)).toBe(false);
    }
  });

  test('the exported set and the predicate are the same source', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 599}), code => {
        expect(isRecognizedRedirect(code)).toBe(REDIRECT_STATUSES.has(code));
      }),
    );
  });
});

describe('isEligibleByCode', () => {
  const eligibility = {
    allowedMethods: DEFAULT_ALLOWED_METHODS,
    allow303: false,
  };

  test('301/302/307/308 are eligible for GET/HEAD, the default allowed set', () => {
    for (const status of [301, 302, 307, 308]) {
      expect(isEligibleByCode(status, 'GET', eligibility)).toBe(true);
      expect(isEligibleByCode(status, 'HEAD', eligibility)).toBe(true);
    }
  });

  test('301/302/307/308 are NOT eligible outside the allowed set (REDIR-3/REDIR-4)', () => {
    for (const status of [301, 302, 307, 308]) {
      expect(isEligibleByCode(status, 'POST', eligibility)).toBe(false);
    }
  });

  test('a caller-widened allowed set makes POST eligible', () => {
    const widened = {
      allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
      allow303: false,
    };
    expect(isEligibleByCode(301, 'POST', widened)).toBe(true);
  });

  test('303 is never eligible by default, regardless of method (REDIR-5)', () => {
    expect(isEligibleByCode(303, 'GET', eligibility)).toBe(false);
    expect(isEligibleByCode(303, 'POST', eligibility)).toBe(false);
  });

  test('303 is eligible once opted in, regardless of method (REDIR-5)', () => {
    const opted = {allowedMethods: DEFAULT_ALLOWED_METHODS, allow303: true};
    expect(isEligibleByCode(303, 'DELETE', opted)).toBe(true);
  });

  test('303 ignores the allowed-methods set entirely (REDIR-5)', () => {
    const empty = {allowedMethods: new Set<Method>(), allow303: true};
    expect(isEligibleByCode(303, 'POST', empty)).toBe(true);
  });
});
