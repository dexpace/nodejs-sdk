// SPDX-License-Identifier: MIT
// packages/core/src/http/method.test.ts
// Exercises: HTTP-9 (idempotency classification, uppercase wire token)
import {describe, expect, test} from 'bun:test';
import {
  isIdempotent,
  isBodyForbidden,
  methodWireToken,
  type Method,
} from './method.js';

describe('isIdempotent', () => {
  test('GET, HEAD, OPTIONS, PUT, DELETE are idempotent', () => {
    const idempotent: Method[] = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
    for (const method of idempotent) expect(isIdempotent(method)).toBe(true);
  });

  test('POST, PATCH, CONNECT, TRACE are not idempotent', () => {
    const notIdempotent: Method[] = ['POST', 'PATCH', 'CONNECT', 'TRACE'];
    for (const method of notIdempotent)
      expect(isIdempotent(method)).toBe(false);
  });
});

describe('isBodyForbidden', () => {
  test('GET, HEAD, TRACE, CONNECT forbid a body', () => {
    const forbidden: Method[] = ['GET', 'HEAD', 'TRACE', 'CONNECT'];
    for (const method of forbidden) expect(isBodyForbidden(method)).toBe(true);
  });

  test('POST, PUT, DELETE, PATCH, OPTIONS allow a body', () => {
    const allowed: Method[] = ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
    for (const method of allowed) expect(isBodyForbidden(method)).toBe(false);
  });
});

describe('methodWireToken', () => {
  test('equals the uppercase method name for every method', () => {
    const all: Method[] = [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'DELETE',
      'CONNECT',
      'OPTIONS',
      'TRACE',
      'PATCH',
    ];
    for (const method of all)
      expect(methodWireToken(method)).toBe(method.toUpperCase());
  });
});
