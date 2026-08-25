// SPDX-License-Identifier: MIT
// packages/core/src/invariant.test.ts
// Exercises: the project's sole assertion primitive (styleguide 5.6) and its error class.
import {describe, expect, test} from 'bun:test';
import {invariant, InvariantViolation} from './invariant.js';

describe('invariant', () => {
  test('does not throw when the condition is truthy', () => {
    expect(() => {
      invariant(true, 'unreachable');
    }).not.toThrow();
  });

  test('throws InvariantViolation with the given message when the condition is falsy', () => {
    expect(() => {
      invariant(false, 'broken precondition');
    }).toThrow(InvariantViolation);
    expect(() => {
      invariant(false, 'broken precondition');
    }).toThrow('broken precondition');
  });

  test('InvariantViolation sets its name and descends from Error', () => {
    const error = new InvariantViolation('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('InvariantViolation');
    expect(error.message).toBe('boom');
  });
});
