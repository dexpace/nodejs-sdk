// SPDX-License-Identifier: MIT
// packages/core/src/http/protocol.test.ts
// Exercises: HTTP-33 (canonical lowercase wire form, case-insensitive alias parsing)
import {describe, expect, test} from 'bun:test';
import {Protocol} from './protocol.js';
import {ProtocolParseError} from './errors.js';

describe('Protocol.parse', () => {
  test('parses the canonical lowercase forms', () => {
    expect(Protocol.parse('http/1.1').token).toBe('http/1.1');
    expect(Protocol.parse('http/2').token).toBe('http/2');
  });

  test('accepts the HTTP/2 and HTTP/2.0 aliases case-insensitively', () => {
    expect(Protocol.parse('HTTP/2').token).toBe('http/2');
    expect(Protocol.parse('HTTP/2.0').token).toBe('http/2');
    expect(Protocol.parse('Http/1.1').token).toBe('http/1.1');
  });

  test('throws ProtocolParseError on an unrecognized identifier', () => {
    expect(() => Protocol.parse('ftp/1.0')).toThrow(ProtocolParseError);
  });
});

describe('equals', () => {
  test('two protocols with the same token are equal', () => {
    expect(Protocol.parse('HTTP/2').equals(Protocol.HTTP_2)).toBe(true);
  });
});
