// SPDX-License-Identifier: MIT
// packages/core/src/config/duration.test.ts
// Exercises: CFG-7 (the duration grammar itself -- ISO-8601 P/p-prefixed, shorthand <number><unit>
// over ms/s/m/h/d case-insensitively, a bare number as milliseconds; a negative duration and an
// unknown unit are rejected, and rejection is a null the caller turns into its own default).
// The accessor-level half of CFG-7 -- that Configuration.getDuration returns the caller's fallback
// on rejection and resolves through the full layered lookup first -- lives in configuration.test.ts.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {parseDurationMs} from './duration.js';

describe('parseDurationMs (CFG-7)', () => {
  test('accepts an ISO-8601 duration', () => {
    expect(parseDurationMs('PT5S')).toBe(5000);
    expect(parseDurationMs('P1DT2H3M4S')).toBe(93_784_000);
  });

  test('accepts a lower-case ISO-8601 duration', () => {
    expect(parseDurationMs('pt5s')).toBe(5000);
  });

  test('accepts shorthand units case-insensitively', () => {
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('2S')).toBe(2000);
    expect(parseDurationMs('3m')).toBe(180_000);
    expect(parseDurationMs('4h')).toBe(14_400_000);
    expect(parseDurationMs('5d')).toBe(432_000_000);
  });

  test('reads a bare number as milliseconds', () => {
    expect(parseDurationMs('1000')).toBe(1000);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseDurationMs('  PT5S  ')).toBe(5000);
  });

  test('rejects a negative duration', () => {
    expect(parseDurationMs('PT-5S')).toBeNull();
    expect(parseDurationMs('-500ms')).toBeNull();
  });

  test('rejects an unknown unit', () => {
    expect(parseDurationMs('5x')).toBeNull();
  });

  test('rejects an ISO-8601 duration with no components at all', () => {
    expect(parseDurationMs('P')).toBeNull();
    expect(parseDurationMs('PT')).toBeNull();
  });

  test('rejects the ambiguous month designator rather than guessing', () => {
    expect(parseDurationMs('P5M')).toBeNull();
  });

  test('reads the three grammars onto one scale', () => {
    // The canonical law CFG-7 implies (`docs/knowledge/testing.md:28`): ISO-8601, shorthand, and a
    // bare number are three spellings of one duration, so for any whole number of seconds all three
    // must land on the same milliseconds. A totality property cannot see the two scales drift apart.
    fc.assert(
      fc.property(fc.integer({min: 0, max: 100_000}), seconds => {
        const iso = parseDurationMs(`PT${String(seconds)}S`);

        expect(iso).toBe(seconds * 1000);
        expect(parseDurationMs(`${String(seconds)}s`)).toBe(iso);
        expect(parseDurationMs(String(seconds * 1000))).toBe(iso);
      }),
    );
  });

  test('never throws for an arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(() => parseDurationMs(value)).not.toThrow();
      }),
    );
  });
});
