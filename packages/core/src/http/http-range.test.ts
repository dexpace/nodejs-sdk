// SPDX-License-Identifier: MIT
// packages/core/src/http/http-range.test.ts
// Exercises: HTTP-49 (bounded/suffix/open factories, bytes-only, single-range, verbatim storage)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {HttpRange} from './http-range.js';
import {HttpRangeValidationError} from './errors.js';

describe('bounded()', () => {
  test('rejects a negative offset', () => {
    expect(() => HttpRange.bounded(-1, 10)).toThrow(HttpRangeValidationError);
  });

  test('rejects a non-positive length', () => {
    expect(() => HttpRange.bounded(0, 0)).toThrow(HttpRangeValidationError);
    expect(() => HttpRange.bounded(0, -5)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid bounded range', () => {
    const range = HttpRange.bounded(0, 500);
    expect(range.kind).toBe('bounded');
    expect(range.start).toBe(0);
    expect(range.length).toBe(500);
  });
});

describe('suffix()', () => {
  test('rejects a non-positive suffix length', () => {
    expect(() => HttpRange.suffix(0)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid suffix range', () => {
    const range = HttpRange.suffix(500);
    expect(range.kind).toBe('suffix');
    expect(range.suffixLength).toBe(500);
  });
});

describe('open()', () => {
  test('rejects a negative start', () => {
    expect(() => HttpRange.open(-1)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid open-ended range', () => {
    const range = HttpRange.open(9500);
    expect(range.kind).toBe('open');
    expect(range.start).toBe(9500);
  });
});

describe('parse()', () => {
  test('parses a bounded range and stores the raw text verbatim', () => {
    const range = HttpRange.parse('bytes=0-499');
    expect(range.kind).toBe('bounded');
    expect(range.start).toBe(0);
    expect(range.length).toBe(500);
    expect(range.raw).toBe('bytes=0-499');
  });

  test('parses a suffix range', () => {
    const range = HttpRange.parse('bytes=-500');
    expect(range.kind).toBe('suffix');
    expect(range.suffixLength).toBe(500);
  });

  test('parses an open-ended range', () => {
    const range = HttpRange.parse('bytes=9500-');
    expect(range.kind).toBe('open');
    expect(range.start).toBe(9500);
  });

  test('supports only the bytes unit', () => {
    expect(() => HttpRange.parse('items=0-4')).toThrow(
      HttpRangeValidationError,
    );
  });

  test('rejects a multi-range comma', () => {
    expect(() => HttpRange.parse('bytes=0-499,600-999')).toThrow(
      HttpRangeValidationError,
    );
  });

  test('rejects fractional, hex, and overflowing values in factories and parse alike', () => {
    expect(() => HttpRange.bounded(1.5, 2)).toThrow(HttpRangeValidationError);
    expect(() => HttpRange.parse('bytes=0x10-0x20')).toThrow(
      HttpRangeValidationError,
    );
    expect(() => HttpRange.parse('bytes=0-9007199254740993')).toThrow(
      HttpRangeValidationError,
    );
  });
});

describe('factory/parse round-trip property (HTTP-49, styleguide 11.5)', () => {
  test('a bounded factory raw form re-parses to the same range', () => {
    fc.assert(
      fc.property(
        fc.nat({max: 1_000_000}),
        fc.integer({min: 1, max: 1_000_000}),
        (start, length) => {
          const range = HttpRange.bounded(start, length);
          const reparsed = HttpRange.parse(range.raw);
          expect(reparsed.kind).toBe('bounded');
          expect(reparsed.start).toBe(start);
          expect(reparsed.length).toBe(length);
        },
      ),
    );
  });
});
