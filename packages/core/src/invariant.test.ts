// SPDX-License-Identifier: MIT
// packages/core/src/invariant.test.ts
// Exercises: the project's sole assertion primitive (styleguide 5.6), its error class, and the
// discriminated-union exhaustiveness helper docs/knowledge/data-modeling.md requires every switch to
// close with.
import {describe, expect, test} from 'bun:test';
import {assertNever, invariant, InvariantViolation} from './invariant.js';

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

describe('assertNever', () => {
  test('throws InvariantViolation naming the unreachable value', () => {
    expect(() => {
      // @ts-expect-error -- deliberately calling with a value that is not `never`, to exercise the
      // runtime path a newly-added union variant would reach.
      assertNever('unexpected-variant');
    }).toThrow(InvariantViolation);
    expect(() => {
      // @ts-expect-error -- same as above.
      assertNever('unexpected-variant');
    }).toThrow('unexpected-variant');
  });

  test('does not throw from its own message construction on an unstringifiable value', () => {
    // `String()` is not total: a null-prototype object has no `toString` to reach, and a value
    // whose `toString` throws propagates that throw. An assertion helper that reported THOSE
    // instead of the invariant violation would name the wrong failure at the worst moment.
    expect(() => {
      assertNever(Object.create(null) as never);
    }).toThrow(InvariantViolation);
    expect(() => {
      assertNever({
        toString() {
          throw new Error('boom');
        },
      } as never);
    }).toThrow(InvariantViolation);
  });

  test('accepts a custom message', () => {
    expect(() => {
      // @ts-expect-error -- same as above.
      assertNever('x', 'custom message');
    }).toThrow('custom message');
  });
});
