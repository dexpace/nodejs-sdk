// SPDX-License-Identifier: MIT
// packages/core/src/http/ascii-validation.test.ts
// Exercises: HTTP-18 (outbound value grammar: HTAB + printable ASCII 0x20-0x7E only)
import {describe, expect, test} from 'bun:test';
import {
  hasForbiddenOutboundByte,
  hasForbiddenNameByte,
  hasForbiddenInboundValueByte,
} from './ascii-validation.js';

describe('hasForbiddenOutboundByte', () => {
  test('accepts HTAB and printable ASCII', () => {
    expect(hasForbiddenOutboundByte('a\tb')).toBe(false);
    expect(hasForbiddenOutboundByte('printable ASCII 0x20-0x7E')).toBe(false);
  });

  test('rejects CR/LF and other control characters', () => {
    expect(hasForbiddenOutboundByte('a\r\nb')).toBe(true);
    expect(hasForbiddenOutboundByte('a\0b')).toBe(true);
  });

  test('rejects non-ASCII bytes', () => {
    expect(hasForbiddenOutboundByte('vålue')).toBe(true);
  });
});

describe('hasForbiddenNameByte', () => {
  test('rejects HTAB, unlike the value predicate', () => {
    expect(hasForbiddenNameByte('a\tb')).toBe(true);
  });

  test('rejects CR/LF, NUL, DEL, and non-ASCII', () => {
    expect(hasForbiddenNameByte('a\r\nb')).toBe(true);
    expect(hasForbiddenNameByte('a\0b')).toBe(true);
    expect(hasForbiddenNameByte('héader')).toBe(true);
  });

  test('accepts ordinary printable ASCII', () => {
    expect(hasForbiddenNameByte('X-Trace')).toBe(false);
  });
});

describe('hasForbiddenInboundValueByte', () => {
  test('permits obs-text (bytes >= 0x80)', () => {
    expect(hasForbiddenInboundValueByte('café')).toBe(false);
  });

  test('still rejects control characters', () => {
    expect(hasForbiddenInboundValueByte('a\r\nb')).toBe(true);
    expect(hasForbiddenInboundValueByte('a\0b')).toBe(true);
  });

  test('permits HTAB', () => {
    expect(hasForbiddenInboundValueByte('a\tb')).toBe(false);
  });
});
