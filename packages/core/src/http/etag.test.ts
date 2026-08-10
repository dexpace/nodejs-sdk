// SPDX-License-Identifier: MIT
// packages/core/src/http/etag.test.ts
// Exercises: HTTP-48 (strong/weak/any forms, etagc validation, round-trip, absent-for-blank)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {ETag} from './etag.js';
import {EtagParseError} from './errors.js';

describe('ETag.parse', () => {
  test('parses a strong ETag', () => {
    const etag = ETag.parse('"abc123"');
    expect(etag?.isWeak).toBe(false);
    expect(etag?.opaque).toBe('abc123');
  });

  test('parses a weak ETag', () => {
    const etag = ETag.parse('W/"abc123"');
    expect(etag?.isWeak).toBe(true);
    expect(etag?.opaque).toBe('abc123');
  });

  test('parses the any singleton', () => {
    const etag = ETag.parse('*');
    expect(etag?.isAny).toBe(true);
  });

  test('rejects a literal quote, control chars, or DEL inside the opaque tag', () => {
    expect(() => ETag.parse('"a"b"')).toThrow(EtagParseError);
    expect(() => ETag.parse('"a\r\nb"')).toThrow(EtagParseError);
  });

  test('permits obs-text inside the opaque tag', () => {
    expect(() => ETag.parse('"café"')).not.toThrow();
  });

  test('rejects an empty strong opaque tag', () => {
    expect(() => ETag.parse('""')).toThrow(EtagParseError);
  });

  test('permits an empty weak opaque tag', () => {
    expect(() => ETag.parse('W/""')).not.toThrow();
  });

  test('round-trips its raw form', () => {
    expect(ETag.parse('"abc123"')?.raw).toBe('"abc123"');
  });

  test('rejects an unterminated form', () => {
    expect(() => ETag.parse('"abc123')).toThrow(EtagParseError);
  });

  test('returns absent, not an error, for blank input', () => {
    expect(ETag.parse('')).toBeUndefined();
    expect(ETag.parse('   ')).toBeUndefined();
  });
});

describe('raw-form round-trip property (HTTP-48, styleguide 11.5)', () => {
  test('parse reproduces the raw form, weakness, and opaque for generated valid ETags', () => {
    const opaqueArb = fc.stringMatching(/^[\x23-\x7e]{0,12}$/); // etagc subset; 0x22 (") sits below the range
    fc.assert(
      fc.property(opaqueArb, fc.boolean(), (opaque, isWeak) => {
        fc.pre(isWeak || opaque !== ''); // an empty strong opaque is invalid by HTTP-48
        const raw = isWeak ? `W/"${opaque}"` : `"${opaque}"`;
        const parsed = ETag.parse(raw);
        expect(parsed?.raw).toBe(raw);
        expect(parsed?.opaque).toBe(opaque);
        expect(parsed?.isWeak).toBe(isWeak);
      }),
    );
  });
});
