// SPDX-License-Identifier: MIT
// packages/core/src/body/errors.test.ts
// Exercises: BODY-3 (ConsumedBodyError), HTTP-51 (MultipartBoundaryError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  ConsumedBodyError,
  isBodyError,
  MultipartBoundaryError,
} from './errors.js';

describe('body errors', () => {
  test('ConsumedBodyError descends from DexpaceError and names the body kind', () => {
    const error = new ConsumedBodyError('stream');
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.bodyKind).toBe('stream');
    expect(error.message).toContain('stream');
  });

  test('MultipartBoundaryError descends from DexpaceError and names the offending boundary', () => {
    const error = new MultipartBoundaryError('bad boundary');
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.boundary).toBe('bad boundary');
  });

  test('isBodyError groups both leaves without a class tier', () => {
    expect(isBodyError(new ConsumedBodyError('stream'))).toBe(true);
    expect(isBodyError(new MultipartBoundaryError('x'))).toBe(true);
    expect(isBodyError(new DexpaceError('other'))).toBe(false);
  });
});
