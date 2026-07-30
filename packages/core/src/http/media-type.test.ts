// SPDX-License-Identifier: MIT
// packages/core/src/http/media-type.test.ts
// Exercises: HTTP-23 (case rules), HTTP-24 (charset never throws), HTTP-25/HTTP-53 (parse/render round-trip),
// HTTP-26 (forbidden bytes), HTTP-27 (wildcard matching)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {MediaType} from './media-type.js';
import {MediaTypeParseError} from './errors.js';

describe('MediaType.parse', () => {
  test('lower-cases type, subtype, and parameter keys; preserves parameter value case', () => {
    const mediaType = MediaType.parse('Application/JSON;Charset=UTF-8');
    expect(mediaType.type).toBe('application');
    expect(mediaType.subtype).toBe('json');
    expect(mediaType.parameter('charset')).toBe('UTF-8');
  });

  test('rejects blank input', () => {
    expect(() => MediaType.parse('')).toThrow(MediaTypeParseError);
    expect(() => MediaType.parse('   ')).toThrow(MediaTypeParseError);
  });

  test('rejects an empty type or subtype', () => {
    expect(() => MediaType.parse('/json')).toThrow(MediaTypeParseError);
    expect(() => MediaType.parse('application/')).toThrow(MediaTypeParseError);
  });

  test('rejects a parameter with no "=" or an empty key/value', () => {
    expect(() => MediaType.parse('text/plain;charset')).toThrow(
      MediaTypeParseError,
    );
    expect(() => MediaType.parse('text/plain;=utf-8')).toThrow(
      MediaTypeParseError,
    );
  });

  test('respects quoted-strings when splitting parameters', () => {
    const mediaType = MediaType.parse('text/plain;boundary="a;b=c"');
    expect(mediaType.parameter('boundary')).toBe('a;b=c');
  });
});

describe('charset', () => {
  test('resolves case-insensitively', () => {
    expect(MediaType.parse('text/plain;CHARSET=utf-8').charset).toBe('utf-8');
  });

  test('is undefined, never throws, when absent or unknown', () => {
    expect(MediaType.parse('text/plain').charset).toBeUndefined();
  });
});

describe('construction rejects forbidden bytes (HTTP-26)', () => {
  test('rejects a control character or non-ASCII byte in type/subtype/params', () => {
    expect(() => MediaType.of('text', 'plain\r\n')).toThrow(
      MediaTypeParseError,
    );
    expect(() =>
      MediaType.of('text', 'plain', new Map([['name', 'vålue']])),
    ).toThrow(MediaTypeParseError);
  });

  test('rejects a non-token or empty type, subtype, or parameter key via of()', () => {
    expect(() => MediaType.of('', 'json')).toThrow(MediaTypeParseError);
    expect(() => MediaType.of('te;xt', 'plain')).toThrow(MediaTypeParseError);
    expect(() =>
      MediaType.of('text', 'plain', new Map([['ke=y', 'v']])),
    ).toThrow(MediaTypeParseError);
  });
});

describe('wildcard matching (HTTP-27)', () => {
  test('a bare */* matches anything', () => {
    expect(
      MediaType.parse('application/json').matches(MediaType.parse('*/*')),
    ).toBe(true);
  });

  test('a wildcard subtype matches any concrete subtype, but not the reverse', () => {
    expect(
      MediaType.parse('application/json').matches(
        MediaType.parse('application/*'),
      ),
    ).toBe(true);
    expect(
      MediaType.parse('application/json').matches(MediaType.parse('text/*')),
    ).toBe(false);
  });

  test('rejects a wildcard type with a concrete subtype', () => {
    expect(() => MediaType.parse('*/json')).toThrow(MediaTypeParseError);
  });
});

describe('parse(render(x)) === x round-trip (HTTP-25)', () => {
  test('holds for generated type/subtype/parameter combinations', () => {
    const tokenArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/);
    const valueArb = fc
      .string({minLength: 0, maxLength: 12})
      .filter(s => /^[\x20-\x7e]*$/.test(s));
    fc.assert(
      fc.property(
        tokenArb,
        tokenArb,
        fc.dictionary(tokenArb, valueArb, {maxKeys: 4}),
        (type, subtype, params) => {
          const original = MediaType.of(
            type,
            subtype,
            new Map(Object.entries(params)),
          );
          const restored = MediaType.parse(original.render());
          expect(restored.equals(original)).toBe(true);
        },
      ),
    );
  });
});
