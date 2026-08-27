// SPDX-License-Identifier: MIT
// packages/core/src/auth/descriptor.test.ts
// Exercises: AUTH-3 (non-empty, immutable, ordered; empty list rejected as a programmer error via
// invariant(), not a typed operational leaf -- see the plan's Global Constraints).
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {createAuthDescriptor} from './descriptor.js';
import {createAuthRequirement} from './requirement.js';

describe('createAuthDescriptor', () => {
  test('preserves requirement order', () => {
    const descriptor = createAuthDescriptor([
      createAuthRequirement('DIGEST'),
      createAuthRequirement('BASIC'),
    ]);
    expect(descriptor.requirements.map(r => r.scheme)).toEqual([
      'DIGEST',
      'BASIC',
    ]);
  });

  test('allowsAnonymous is true iff any requirement is NO_AUTH', () => {
    expect(
      createAuthDescriptor([createAuthRequirement('NO_AUTH')]).allowsAnonymous,
    ).toBe(true);
    expect(
      createAuthDescriptor([createAuthRequirement('BASIC')]).allowsAnonymous,
    ).toBe(false);
    expect(
      createAuthDescriptor([
        createAuthRequirement('BASIC'),
        createAuthRequirement('NO_AUTH'),
      ]).allowsAnonymous,
    ).toBe(true);
  });

  test('rejects an empty requirement list (AUTH-3) -- a programmer error, not AuthResolutionError', () => {
    expect(() => createAuthDescriptor([])).toThrow(InvariantViolation);
  });

  test('is frozen, including the requirements array', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.requirements)).toBe(true);
  });

  test('defensively copies the requirement list', () => {
    const requirements = [createAuthRequirement('BASIC')];
    const descriptor = createAuthDescriptor(requirements);
    requirements.push(createAuthRequirement('NO_AUTH'));
    expect(descriptor.requirements.length).toBe(1);
  });
});
