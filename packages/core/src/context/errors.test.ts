// SPDX-License-Identifier: MIT
// packages/core/src/context/errors.test.ts
// Exercises: CTX-8 (reject-on-duplicate insert failure, naming the key)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {DuplicateContextKeyError} from './errors.js';

describe('DuplicateContextKeyError', () => {
  test('descends from DexpaceError and names the offending key', () => {
    const key = Symbol('call-1');
    const error = new DuplicateContextKeyError(key);
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.key).toBe(key);
    expect(error.message).toContain('call-1');
  });

  test('sets name from its own constructor', () => {
    expect(new DuplicateContextKeyError(Symbol('x')).name).toBe(
      'DuplicateContextKeyError',
    );
  });

  test('cause chains through', () => {
    const cause = new Error('boom');
    expect(new DuplicateContextKeyError(Symbol('x'), {cause}).cause).toBe(
      cause,
    );
  });
});
