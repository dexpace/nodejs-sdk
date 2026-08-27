// SPDX-License-Identifier: MIT
// packages/core/src/auth/requirement.test.ts
// Exercises: AUTH-2 (frozen data shape, defensive copies of scopes/params, value equality).
import {describe, expect, test} from 'bun:test';
import {authRequirementsEqual, createAuthRequirement} from './requirement.js';

describe('createAuthRequirement', () => {
  test('defaults scopes to empty and params to an empty map', () => {
    const requirement = createAuthRequirement('BASIC');
    expect(requirement.scopes).toEqual([]);
    expect(requirement.params.size).toBe(0);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(createAuthRequirement('BASIC'))).toBe(true);
  });

  test('freezes the scopes array too', () => {
    expect(
      Object.isFrozen(createAuthRequirement('OAUTH2', ['read']).scopes),
    ).toBe(true);
  });

  test('defensively copies the scopes array', () => {
    const scopes = ['read'];
    const requirement = createAuthRequirement('OAUTH2', scopes);
    scopes.push('write');
    expect(requirement.scopes).toEqual(['read']);
  });

  test('defensively copies the params map', () => {
    const params = new Map([['tenant', 'a']]);
    const requirement = createAuthRequirement('OAUTH2', [], params);
    params.set('tenant', 'b');
    expect(requirement.params.get('tenant')).toBe('a');
  });
});

describe('authRequirementsEqual', () => {
  test('true for identical scheme/scopes/params, regardless of construction order', () => {
    const a = createAuthRequirement(
      'OAUTH2',
      ['read', 'write'],
      new Map([['tenant', 'x']]),
    );
    const b = createAuthRequirement(
      'OAUTH2',
      ['read', 'write'],
      new Map([['tenant', 'x']]),
    );
    expect(authRequirementsEqual(a, b)).toBe(true);
  });

  test('false for a differing scheme', () => {
    expect(
      authRequirementsEqual(
        createAuthRequirement('BASIC'),
        createAuthRequirement('DIGEST'),
      ),
    ).toBe(false);
  });

  test('false for differing scopes', () => {
    const a = createAuthRequirement('OAUTH2', ['read']);
    const b = createAuthRequirement('OAUTH2', ['write']);
    expect(authRequirementsEqual(a, b)).toBe(false);
  });

  test('scope ORDER is part of the value, not a set comparison', () => {
    const a = createAuthRequirement('OAUTH2', ['read', 'write']);
    const b = createAuthRequirement('OAUTH2', ['write', 'read']);
    expect(authRequirementsEqual(a, b)).toBe(false);
  });

  test('false for a differing scope count', () => {
    const a = createAuthRequirement('OAUTH2', ['read']);
    const b = createAuthRequirement('OAUTH2', ['read', 'write']);
    expect(authRequirementsEqual(a, b)).toBe(false);
  });

  test('false for differing params', () => {
    const a = createAuthRequirement('OAUTH2', [], new Map([['tenant', 'x']]));
    const b = createAuthRequirement('OAUTH2', [], new Map([['tenant', 'y']]));
    expect(authRequirementsEqual(a, b)).toBe(false);
  });

  test('false for a differing param count', () => {
    const a = createAuthRequirement('OAUTH2', [], new Map([['tenant', 'x']]));
    const b = createAuthRequirement(
      'OAUTH2',
      [],
      new Map([
        ['tenant', 'x'],
        ['region', 'eu'],
      ]),
    );
    expect(authRequirementsEqual(a, b)).toBe(false);
  });
});
