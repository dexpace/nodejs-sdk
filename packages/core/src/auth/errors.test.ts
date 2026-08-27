// SPDX-License-Identifier: MIT
// packages/core/src/auth/errors.test.ts
// Exercises: AUTH-6 (the resolution error names required and available schemes, and copies both
// lists onto its own frozen fields), AUTH-28 (the plaintext guard names the step and scheme),
// AUTH-35 (the resolution error's message-only construction path).
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {AuthResolutionError, PlaintextCredentialError} from './errors.js';

describe('AuthResolutionError', () => {
  test('a plain message constructs directly', () => {
    const error = new AuthResolutionError(
      'token provider returned an expired token',
    );
    expect(error.name).toBe('AuthResolutionError');
    expect(error.message).toContain('expired');
  });

  test('the message-only path carries no scheme lists (AUTH-35)', () => {
    const error = new AuthResolutionError('token provider returned null');
    expect(error.requiredSchemes).toBeUndefined();
    expect(error.availableSchemes).toBeUndefined();
  });

  test('unsatisfiable() names both the required and available schemes', () => {
    const error = AuthResolutionError.unsatisfiable(
      ['BASIC', 'DIGEST'],
      ['API_KEY'],
    );
    expect(error.message).toContain('BASIC');
    expect(error.message).toContain('DIGEST');
    expect(error.message).toContain('API_KEY');
  });

  test('unsatisfiable() also carries them as indexable fields, not only as prose (AUTH-6)', () => {
    const error = AuthResolutionError.unsatisfiable(
      ['BASIC', 'DIGEST'],
      ['API_KEY'],
    );
    expect(error.requiredSchemes).toEqual(['BASIC', 'DIGEST']); // preference order preserved
    expect(error.availableSchemes).toEqual(['API_KEY']);
  });

  test('unsatisfiable() copies the caller arrays rather than aliasing them', () => {
    const required = ['BASIC'];
    const error = AuthResolutionError.unsatisfiable(required, []);
    required.push('DIGEST');
    expect(error.requiredSchemes).toEqual(['BASIC']);
  });

  test('descends from DexpaceError, so a caller can catch the whole taxonomy', () => {
    expect(new AuthResolutionError('x')).toBeInstanceOf(DexpaceError);
  });
});

describe('AuthResolutionError copies its scheme lists (AUTH-6)', () => {
  test('the constructor copies, so a caller mutating its array cannot reach the error', () => {
    const required = ['BASIC'];
    const available = ['DIGEST'];
    const error = new AuthResolutionError('nope', required, available);
    required.push('OAUTH2');
    available.push('API_KEY');
    expect(error.requiredSchemes).toEqual(['BASIC']);
    expect(error.availableSchemes).toEqual(['DIGEST']);
  });

  test('unsatisfiable() delegates to that one copy site', () => {
    const required = ['BASIC'];
    const error = AuthResolutionError.unsatisfiable(required, []);
    required.push('DIGEST');
    expect(error.requiredSchemes).toEqual(['BASIC']);
  });
});

describe('PlaintextCredentialError', () => {
  test('names the step and the resolved scheme', () => {
    const error = new PlaintextCredentialError('authStep', 'BASIC');
    expect(error.message).toContain('authStep');
    expect(error.message).toContain('BASIC');
  });

  test('carries them as fields too (error-handling.md)', () => {
    const error = new PlaintextCredentialError('authStep', 'BASIC');
    expect(error.stepName).toBe('authStep');
    expect(error.scheme).toBe('BASIC');
    expect(error.name).toBe('PlaintextCredentialError');
  });
});
