// SPDX-License-Identifier: MIT
// packages/core/src/http/errors.test.ts
// Exercises: HTTP-4 (field-named errors), HTTP-20 (no value echo, escaped name)
import {describe, expect, test} from 'bun:test';
import {
  DexpaceError,
  DomainModelError,
  RequiredFieldError,
  HeaderValidationError,
  toError,
  RequestBodyNotAllowedError,
} from './errors.js';

describe('RequiredFieldError', () => {
  test('message and structured field name the missing field', () => {
    const error = new RequiredFieldError('url');
    expect(error.message).toBe('url is required');
    expect(error.name).toBe('RequiredFieldError');
    expect(error.fieldName).toBe('url'); // structured field, not just prose (styleguide 8.9)
  });
});

describe('HeaderValidationError', () => {
  test('never echoes the offending value', () => {
    const error = new HeaderValidationError(
      'name',
      'X-Trace',
      'secret-token-value',
    );
    expect(error.message).not.toContain('secret-token-value');
  });

  test('escapes control characters in an echoed name', () => {
    const error = new HeaderValidationError('name', 'a\rb', undefined);
    expect(error.message).not.toContain('\r');
    expect(error.message).toContain('\\r');
    expect(error.kind).toBe('name');
    expect(error.escapedName).toBe('a\\rb'); // the raw value is never stored, only the escaped name
  });
});

describe('toError', () => {
  test('returns an Error unchanged and wraps a non-Error without ever throwing', () => {
    const original = new Error('boom');
    expect(toError(original)).toBe(original);
    expect(toError('plain string')).toBeInstanceOf(Error);
    expect(toError(Object.create(null))).toBeInstanceOf(Error);
  });
});

describe('RequestBodyNotAllowedError', () => {
  test('names the offending method', () => {
    const error = new RequestBodyNotAllowedError('GET');
    expect(error.message).toContain('GET');
  });
});

// Exercises: the Phase 2 retrofit — DexpaceError as the taxonomy root above DomainModelError
describe('DexpaceError', () => {
  test('sets name to the concrete subclass name', () => {
    const error = new DexpaceError('boom');
    expect(error.name).toBe('DexpaceError');
  });

  test('DomainModelError is a DexpaceError, and every existing leaf still narrows by DomainModelError', () => {
    const error = new RequiredFieldError('url');
    expect(error).toBeInstanceOf(DomainModelError);
    expect(error).toBeInstanceOf(DexpaceError);
  });
});
