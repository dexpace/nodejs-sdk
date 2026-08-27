// SPDX-License-Identifier: MIT
// packages/core/src/auth/resolve.test.ts
// Exercises: AUTH-4 (perCall ?? operation ?? client, first PRESENT wins, no fallthrough on failure),
// AUTH-5 (first requirement whose scheme is NO_AUTH or in availableSchemes wins), AUTH-6 (all tiers
// absent is a programmer error), AUTH-7 (pure function, no hidden state).
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {createAuthDescriptor} from './descriptor.js';
import {AuthResolutionError} from './errors.js';
import {createAuthRequirement} from './requirement.js';
import {resolveAuthRequirement} from './resolve.js';

describe('tier selection (AUTH-4)', () => {
  test('perCall wins when present, even if operation/client are also present', () => {
    const requirement = resolveAuthRequirement(
      {
        perCall: createAuthDescriptor([createAuthRequirement('BASIC')]),
        operation: createAuthDescriptor([createAuthRequirement('DIGEST')]),
        client: createAuthDescriptor([createAuthRequirement('API_KEY')]),
      },
      new Set(['BASIC', 'DIGEST', 'API_KEY']),
    );
    expect(requirement.scheme).toBe('BASIC');
  });

  test('operation wins over client when perCall is absent', () => {
    const requirement = resolveAuthRequirement(
      {
        operation: createAuthDescriptor([createAuthRequirement('DIGEST')]),
        client: createAuthDescriptor([createAuthRequirement('API_KEY')]),
      },
      new Set(['DIGEST', 'API_KEY']),
    );
    expect(requirement.scheme).toBe('DIGEST');
  });

  test('client is used when it is the only tier present', () => {
    const requirement = resolveAuthRequirement(
      {client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
      new Set(['API_KEY']),
    );
    expect(requirement.scheme).toBe('API_KEY');
  });

  test('a lower tier is NEVER consulted once a higher one is present, even if unsatisfiable', () => {
    expect(() =>
      resolveAuthRequirement(
        {
          perCall: createAuthDescriptor([createAuthRequirement('DIGEST')]),
          client: createAuthDescriptor([createAuthRequirement('BASIC')]),
        },
        // would satisfy client's tier, but perCall is present and DIGEST is not available
        new Set(['BASIC']),
      ),
    ).toThrow(AuthResolutionError);
  });

  test('an explicitly-undefined higher tier is treated as absent', () => {
    const requirement = resolveAuthRequirement(
      {
        perCall: undefined,
        client: createAuthDescriptor([createAuthRequirement('BASIC')]),
      },
      new Set(['BASIC']),
    );
    expect(requirement.scheme).toBe('BASIC');
  });
});

describe('within-descriptor selection (AUTH-5)', () => {
  test('the first requirement whose scheme is available wins, in preference order', () => {
    const descriptor = createAuthDescriptor([
      createAuthRequirement('OAUTH2'),
      createAuthRequirement('BASIC'),
    ]);
    const requirement = resolveAuthRequirement(
      {client: descriptor},
      new Set(['BASIC']),
    );
    expect(requirement.scheme).toBe('BASIC');
  });

  test('NO_AUTH always wins regardless of availableSchemes', () => {
    const descriptor = createAuthDescriptor([
      createAuthRequirement('NO_AUTH'),
      createAuthRequirement('BASIC'),
    ]);
    const requirement = resolveAuthRequirement({client: descriptor}, new Set());
    expect(requirement.scheme).toBe('NO_AUTH');
  });

  test('scopes and params are never inspected -- only the scheme decides', () => {
    const descriptor = createAuthDescriptor([
      createAuthRequirement('OAUTH2', ['read'], new Map([['tenant', 'x']])),
    ]);
    const requirement = resolveAuthRequirement(
      {client: descriptor},
      new Set(['OAUTH2']),
    );
    expect(requirement.scopes).toEqual(['read']);
    expect(requirement.params.get('tenant')).toBe('x');
  });

  test('an unsatisfiable descriptor throws AuthResolutionError naming both schemes', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('DIGEST')]);
    try {
      resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthResolutionError);
      expect((error as Error).message).toContain('DIGEST');
      expect((error as Error).message).toContain('BASIC');
    }
  });

  test('the thrown error carries required schemes in PREFERENCE order (AUTH-6)', () => {
    const descriptor = createAuthDescriptor([
      createAuthRequirement('DIGEST'),
      createAuthRequirement('OAUTH2'),
    ]);
    try {
      resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as AuthResolutionError).requiredSchemes).toEqual([
        'DIGEST',
        'OAUTH2',
      ]);
      expect((error as AuthResolutionError).availableSchemes).toEqual([
        'BASIC',
      ]);
    }
  });
});

describe('AUTH-6: all tiers absent', () => {
  test('is a programmer error, not AuthResolutionError', () => {
    expect(() => resolveAuthRequirement({}, new Set())).toThrow(
      InvariantViolation,
    );
    expect(() => resolveAuthRequirement({}, new Set())).not.toThrow(
      AuthResolutionError,
    );
  });
});

describe('AUTH-7: purity', () => {
  test('the same inputs always resolve to an equal requirement', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const first = resolveAuthRequirement(
      {client: descriptor},
      new Set(['BASIC']),
    );
    const second = resolveAuthRequirement(
      {client: descriptor},
      new Set(['BASIC']),
    );
    // Same object identity: resolve() picks from the existing descriptor, building nothing new.
    expect(first).toBe(second);
  });
});
