// SPDX-License-Identifier: MIT
// packages/core/src/auth/md5.test.ts
// Exercises: AUTH-15, AUTH-17 (MD5 correctness against RFC 1321's own test vectors, and the
// lower-case hex rendering the Digest response is built from).
import {describe, expect, test} from 'bun:test';
import {md5, toHex} from './md5.js';

function md5Hex(input: string): string {
  return toHex(md5(new TextEncoder().encode(input)));
}

describe('md5 (RFC 1321 test vectors)', () => {
  test('the empty string', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  test('"a"', () => {
    expect(md5Hex('a')).toBe('0cc175b9c0f1b6a831c399e269772661');
  });

  test('"abc"', () => {
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  test('"message digest"', () => {
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  test('the lowercase alphabet, exercising a multi-block input', () => {
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe(
      'c3fcd3d76192e4007dfb496cca67e13b',
    );
  });

  test('the 62-character alphanumeric vector', () => {
    expect(
      md5Hex('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
    ).toBe('d174ab98d277d9f5a5611c2c9f419d9f');
  });

  test('the 80-digit vector, exercising a two-block input', () => {
    expect(md5Hex('1234567890'.repeat(8))).toBe(
      '57edf4a22be3c955ac49da2e2107b67a',
    );
  });

  test('a 55-byte input, the last length that pads into a single block', () => {
    expect(md5Hex('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65');
  });

  test('a 56-byte input, the first length that forces a second block', () => {
    expect(md5Hex('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218');
  });

  test('a 64-byte input, exactly one block before padding', () => {
    expect(md5Hex('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367');
  });

  test('non-ASCII bytes hash by their UTF-8 encoding', () => {
    expect(md5Hex('é')).toBe('66ddcd97cfdeabb2f6fb8a999b4bc76f');
  });

  test('the digest is 16 bytes', () => {
    expect(md5(new Uint8Array()).length).toBe(16);
  });

  test('is pure -- the same input hashes identically twice', () => {
    const input = new TextEncoder().encode('repeat me');
    expect(toHex(md5(input))).toBe(toHex(md5(input)));
  });
});

describe('toHex', () => {
  test('pads each byte to two lower-case hex digits', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });

  test('renders the empty array as the empty string', () => {
    expect(toHex(new Uint8Array())).toBe('');
  });
});
