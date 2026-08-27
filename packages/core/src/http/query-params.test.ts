// SPDX-License-Identifier: MIT
// packages/core/src/http/query-params.test.ts
// Exercises: HTTP-28 (case-sensitive, multi-value, value-less param), HTTP-29/32 (RFC 3986 encoding),
// HTTP-30 (order-sensitive equality, empty-list dropped), HTTP-31 (lenient parse)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {
  QueryParams,
  decodeQueryComponent,
  encodeQueryComponent,
} from './query-params.js';

describe('case-sensitive names and multi-value (HTTP-28)', () => {
  test('page and Page are distinct names', () => {
    const params = QueryParams.newBuilder()
      .add('page', '1')
      .add('Page', '2')
      .build();
    expect(params.get('page')).toBe('1');
    expect(params.get('Page')).toBe('2');
  });

  test('a value-less parameter models as a single empty-string value', () => {
    const params = QueryParams.newBuilder().add('flag', null).build();
    expect(params.get('flag')).toBe('');
    expect(params.has('flag')).toBe(true);
  });

  test('an absent name returns undefined from get, false from has', () => {
    const params = QueryParams.newBuilder().build();
    expect(params.get('missing')).toBeUndefined();
    expect(params.has('missing')).toBe(false);
  });
});

describe('RFC 3986 encoding (HTTP-29/32)', () => {
  test('space encodes as %20, never +; literal + encodes as %2B', () => {
    const params = QueryParams.newBuilder()
      .add('q', 'a b')
      .add('plus', 'c+d')
      .build();
    expect(params.encode()).toBe('q=a%20b&plus=c%2Bd');
  });

  test('reserved characters / and * are percent-encoded', () => {
    const params = QueryParams.newBuilder()
      .add('path', 'a/b')
      .add('star', 'a*b')
      .build();
    expect(params.encode()).toBe('path=a%2Fb&star=a%2Ab');
  });

  test('is empty when there are no params', () => {
    expect(QueryParams.newBuilder().build().encode()).toBe('');
  });
});

describe('order-sensitive equality (HTTP-30)', () => {
  test('two instances are equal iff they encode identically', () => {
    const a = QueryParams.newBuilder().add('x', '1').add('y', '2').build();
    const b = QueryParams.newBuilder().add('x', '1').add('y', '2').build();
    const reordered = QueryParams.newBuilder()
      .add('y', '2')
      .add('x', '1')
      .build();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(reordered)).toBe(false);
  });
});

describe('lenient parsing (HTTP-31)', () => {
  test('null/blank query parses to empty', () => {
    expect(QueryParams.parse(null).encode()).toBe('');
    expect(QueryParams.parse('').encode()).toBe('');
    expect(QueryParams.parse('   ').encode()).toBe('');
  });

  test('tolerates a leading ?', () => {
    expect(QueryParams.parse('?a=1').get('a')).toBe('1');
  });

  test('a segment with no = or a trailing = yields an empty-string value', () => {
    expect(QueryParams.parse('flag').get('flag')).toBe('');
    expect(QueryParams.parse('flag=').get('flag')).toBe('');
  });

  test('a stray & is skipped rather than producing a phantom entry', () => {
    const params = QueryParams.parse('a=1&&b=2');
    expect(params.getAll('')).toEqual([]);
    expect(params.get('a')).toBe('1');
    expect(params.get('b')).toBe('2');
  });

  test('malformed percent-encoding falls back to raw text instead of throwing', () => {
    expect(() => QueryParams.parse('a=%zz')).not.toThrow();
    expect(QueryParams.parse('a=%zz').get('a')).toBe('%zz');
  });
});

describe('parse(x.encode()) round-trip (HTTP-29/31 as inverses)', () => {
  test('holds for arbitrary generated name/value pairs', () => {
    fc.assert(
      fc.property(
        fc.string({minLength: 1, maxLength: 15}),
        fc.string({maxLength: 15}),
        (name, value) => {
          const original = QueryParams.newBuilder().add(name, value).build();
          const restored = QueryParams.parse(original.encode());
          expect(restored.equals(original)).toBe(true);
        },
      ),
    );
  });
});

describe('newBuilder derivation (HTTP-3)', () => {
  test('a derived builder is pre-filled and does not alias the original', () => {
    const original = QueryParams.newBuilder()
      .add('x', '1')
      .add('x', '2')
      .add('y', '3')
      .build();

    const derived = original.newBuilder().add('x', '4').build();

    expect(derived.getAll('x')).toEqual(['1', '2', '4']);
    expect(derived.get('y')).toBe('3');
    expect(original.getAll('x')).toEqual(['1', '2']);
  });
});

// PAGE-22 restates HTTP-29's rule. These assertions pin the shared function so the pagination splice can rely
// on it instead of restating the rule and drifting.
test('the component encoder is directly reachable and follows RFC 3986 (HTTP-29, reused by PAGE-22)', () => {
  expect(encodeQueryComponent('a b')).toBe('a%20b');
  expect(encodeQueryComponent('a+b')).toBe('a%2Bb');
  expect(encodeQueryComponent('a/b')).toBe('a%2Fb');
  expect(encodeQueryComponent('a=b')).toBe('a%3Db');
  expect(encodeQueryComponent('a*b')).toBe('a%2Ab');
  expect(encodeQueryComponent('AZaz09-._~')).toBe('AZaz09-._~');
});

test('the component decoder treats a literal + as data, not a space (HTTP-29, PAGE-22)', () => {
  expect(decodeQueryComponent('a+b')).toBe('a+b');
  expect(decodeQueryComponent('a%20b')).toBe('a b');
  expect(decodeQueryComponent('a%2Bb')).toBe('a+b');
});

test('the decoder falls back to raw text on malformed percent-encoding (HTTP-31)', () => {
  expect(decodeQueryComponent('a%zzb')).toBe('a%zzb');
});
