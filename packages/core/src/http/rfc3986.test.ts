// SPDX-License-Identifier: MIT
// packages/core/src/http/rfc3986.test.ts
// Exercises: HTTP-29 (RFC 3986 percent-encoding, not application/x-www-form-urlencoded) — the shared encoder
// used by QueryParams (HTTP-29/32) and buildRequest's path-segment encoding (SEAM-27)
import {describe, expect, test} from 'bun:test';
import {encodeRfc3986Component} from './rfc3986.js';

describe('encodeRfc3986Component', () => {
  test('encodes space as %20, never +', () => {
    expect(encodeRfc3986Component('a b')).toBe('a%20b');
  });

  test('encodes a literal + as %2B', () => {
    expect(encodeRfc3986Component('c+d')).toBe('c%2Bd');
  });

  test('encodes / as %2F', () => {
    expect(encodeRfc3986Component('a/b')).toBe('a%2Fb');
  });

  test("encodes the characters encodeURIComponent leaves unescaped but RFC 3986 doesn't: ! * ' ( )", () => {
    expect(encodeRfc3986Component("!*'()")).toBe('%21%2A%27%28%29');
  });

  test('leaves the unreserved set untouched: A-Z a-z 0-9 - . _ ~', () => {
    const unreserved = 'AZaz09-._~';
    expect(encodeRfc3986Component(unreserved)).toBe(unreserved);
  });
});
