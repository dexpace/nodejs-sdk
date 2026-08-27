// SPDX-License-Identifier: MIT
// packages/core/src/config/http-date.test.ts
// Exercises: CFG-29 (canonical formatting -- zero-padded day, literal GMT, UTC), CFG-30 (tolerant
// parsing -- case-insensitive month, zone aliases, informational weekday), CFG-31 (strict on the
// rest -- blank input and a missing post-weekday comma both fail; totality).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {formatHttpDate, parseHttpDate} from './http-date.js';

describe('formatHttpDate (CFG-29)', () => {
  test('renders the canonical form in UTC', () => {
    const epochMs = Date.UTC(1994, 10, 6, 8, 49, 37);

    expect(formatHttpDate(epochMs)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });

  test('zero-pads a single-digit day-of-month', () => {
    const epochMs = Date.UTC(2026, 0, 1, 0, 0, 0);

    expect(formatHttpDate(epochMs)).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });

  test('rejects an instant outside the four-digit-year range RFC 1123 renders', () => {
    // `padStart(4, '0')` cannot render a year outside 0000..9999: year -1 came out as `00-1` and
    // year 275760 as `275760`, both malformed HTTP-dates emitted with no error at all.
    expect(() => formatHttpDate(-62_198_755_200_000)).toThrow(
      InvariantViolation,
    );
    expect(() => formatHttpDate(253_402_300_800_000)).toThrow(
      InvariantViolation,
    );
    expect(() => formatHttpDate(8_640_000_000_000_000)).toThrow(
      InvariantViolation,
    );
  });

  test('renders the outermost instants inside that range', () => {
    expect(formatHttpDate(-62_167_219_200_000)).toBe(
      'Sat, 01 Jan 0000 00:00:00 GMT',
    );
    expect(formatHttpDate(253_402_300_799_000)).toBe(
      'Fri, 31 Dec 9999 23:59:59 GMT',
    );
  });

  test('rejects a non-representable instant as a programmer error', () => {
    expect(() => formatHttpDate(Number.NaN)).toThrow(InvariantViolation);
  });
});

describe('parseHttpDate tolerance (CFG-30)', () => {
  const canonical = Date.UTC(2026, 0, 1, 0, 0, 10);

  test('accepts a canonical HTTP-date', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('accepts an upper-case month name', () => {
    expect(parseHttpDate('Thu, 01 JAN 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('accepts a lower-case month name', () => {
    expect(parseHttpDate('Thu, 01 jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('normalizes UTC to the same instant as GMT', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 UTC')).toBe(canonical);
  });

  test('normalizes +0000 to the same instant as GMT', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +0000')).toBe(canonical);
  });

  test('normalizes +00:00 to the same instant as GMT', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +00:00')).toBe(canonical);
  });

  test('treats the weekday token as informational, even when it contradicts the date', () => {
    expect(parseHttpDate('Mon, 01 Jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('accepts a single-digit day-of-month', () => {
    expect(parseHttpDate('Thu, 1 Jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseHttpDate('  Thu, 01 Jan 2026 00:00:10 GMT  ')).toBe(canonical);
  });

  test('rolls a leap second into the following minute rather than rejecting it', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:60 GMT')).toBe(
      Date.UTC(2026, 0, 1, 0, 1, 0),
    );
  });
});

describe('parseHttpDate strictness (CFG-31)', () => {
  test('rejects blank input', () => {
    expect(parseHttpDate('')).toBeNull();
  });

  test('rejects whitespace-only input', () => {
    expect(parseHttpDate('   ')).toBeNull();
  });

  test('rejects a form missing the comma after the weekday', () => {
    expect(parseHttpDate('Mon 01 Jan 2024 00:00:00 GMT')).toBeNull();
  });

  test('rejects an out-of-range day rather than rolling it over', () => {
    expect(parseHttpDate('Thu, 32 Jan 2026 00:00:10 GMT')).toBeNull();
  });

  test('rejects a day that does not exist in the given month', () => {
    expect(parseHttpDate('Thu, 31 Feb 2026 00:00:10 GMT')).toBeNull();
  });

  test('rejects an out-of-range hour', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 24:00:10 GMT')).toBeNull();
  });

  test('rejects an unknown month name', () => {
    expect(parseHttpDate('Thu, 01 Foo 2026 00:00:10 GMT')).toBeNull();
  });

  test('rejects a non-zero numeric offset', () => {
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +0100')).toBeNull();
  });

  test('reads a two-digit-looking year literally rather than mapping it onto the 1900s', () => {
    const parsed = parseHttpDate('Sun, 01 Jan 0026 00:00:00 GMT');

    expect(parsed).not.toBeNull();
    expect(new Date(parsed ?? 0).getUTCFullYear()).toBe(26);
  });
});

describe('parseHttpDate properties', () => {
  test('never throws for an arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(() => parseHttpDate(value)).not.toThrow();
      }),
    );
  });

  test('round-trips every second-precision instant a canonical format produces', () => {
    fc.assert(
      // The full span `formatHttpDate` accepts, not just the modern slice: year 0000-01-01 through
      // 9999-12-31. The old bound stopped at year 2100, so it never reached the negative epochs and
      // out-of-range years where the round-trip actually broke.
      fc.property(
        fc.integer({min: -62_167_219_200_000, max: 253_402_300_799_000}),
        epochMs => {
          const truncated = Math.floor(epochMs / 1000) * 1000;

          expect(parseHttpDate(formatHttpDate(truncated))).toBe(truncated);
        },
      ),
    );
  });
});
