// SPDX-License-Identifier: MIT
// packages/core/src/http/errors.test.ts
// Exercises: HTTP-4 (field-named errors), HTTP-7 (body on a body-forbidding method),
// HTTP-20 (no value echo, escaped name)
import {describe, expect, test} from 'bun:test';
import {
  DexpaceError,
  isDomainModelError,
  RequiredFieldError,
  HeaderValidationError,
  MediaTypeParseError,
  ProtocolParseError,
  UrlConstructionError,
  RequestOptionsValidationError,
  EtagParseError,
  HttpRangeValidationError,
  RequestConditionsValidationError,
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

// Exercises: the flattened taxonomy — DexpaceError is the single root, and `isDomainModelError` is
// the group check that replaced the removed `DomainModelError` class tier
describe('DexpaceError', () => {
  test('sets name to the concrete subclass name', () => {
    const error = new DexpaceError('boom');
    expect(error.name).toBe('DexpaceError');
  });

  test('every domain-model leaf sits two levels down and isDomainModelError matches it', () => {
    const leaves = [
      new RequiredFieldError('url'),
      new HeaderValidationError('name', 'X-Trace', undefined),
      new MediaTypeParseError('bad media type'),
      new ProtocolParseError('bad protocol'),
      new UrlConstructionError('bad url'),
      new RequestOptionsValidationError('bad options'),
      new EtagParseError('bad etag'),
      new HttpRangeValidationError('bad range'),
      new RequestConditionsValidationError('bad conditions'),
      new RequestBodyNotAllowedError('GET'),
    ];
    expect(leaves).toHaveLength(10);
    for (const leaf of leaves) {
      expect(leaf).toBeInstanceOf(DexpaceError);
      expect(isDomainModelError(leaf)).toBe(true);
      // Two levels, not three: the leaf's own superclass is DexpaceError itself, so a
      // reintroduced tier fails here rather than passing silently through `instanceof`.
      expect(Object.getPrototypeOf(leaf.constructor)).toBe(DexpaceError);
    }
  });

  test('an error outside the domain model is not matched', () => {
    expect(isDomainModelError(new DexpaceError('boom'))).toBe(false);
    expect(isDomainModelError(new Error('boom'))).toBe(false);
    expect(isDomainModelError(undefined)).toBe(false);
  });
});
