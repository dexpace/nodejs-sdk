// SPDX-License-Identifier: MIT
// packages/core/src/io/test-support/rejection.test.ts
// Exercises the `rejection()` test helper's own failure paths, not covered by its many callers
// (which all reject with a real Error).
import {describe, expect, test} from 'bun:test';
import {rejection} from './rejection.js';

describe('rejection', () => {
  test('returns the rejection reason when the promise rejects with an Error', async () => {
    const error = new Error('boom');
    expect(await rejection(Promise.reject(error))).toBe(error);
  });

  test('throws when the promise rejects with a non-Error value', async () => {
    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercising rejection()'s non-Error branch
      await rejection(Promise.reject('not an error'));
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'expected an Error rejection, got string',
    );
  });

  test('throws when the promise resolves instead of rejecting', async () => {
    let caught: unknown;
    try {
      await rejection(Promise.resolve('fine'));
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'expected the promise to reject, but it resolved',
    );
  });
});
