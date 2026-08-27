// SPDX-License-Identifier: MIT
// packages/core/src/config/http-date.test.ts
// Exercises: CFG-29 (canonical formatting), CFG-30 (tolerant parsing -- case-insensitive month, zone
// aliases, informational weekday), CFG-31 (strict on the rest -- blank input, missing comma both
// fail). Consumed by Phase 5a's pacing.ts for RETRY-15's HTTP-date form.
// docs/superpowers/plans/2026-07-28-phase7a-configuration.md Task 2
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {formatHttpDate, parseHttpDate} from './http-date.js';

describe('formatHttpDate', () => {
  test('renders the canonical form with a zero-padded day, in UTC', () => {
    const epochMs = Date.UTC(1994, 10, 6, 8, 49, 37);
    expect(formatHttpDate(epochMs)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });

  test('single-digit days are zero-padded', () => {
    const epochMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(formatHttpDate(epochMs)).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });
});

describe('parseHttpDate tolerance (CFG-30)', () => {
  test('month names are case-insensitive', () => {
    const canonical = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Thu, 01 JAN 2026 00:00:10 GMT')).toBe(canonical);
    expect(parseHttpDate('Thu, 01 jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('GMT, UTC, +0000, and +00:00 all normalize to the same instant', () => {
    const gmt = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 UTC')).toBe(gmt);
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +0000')).toBe(gmt);
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +00:00')).toBe(gmt);
  });

  test('the weekday token is informational only, even when wrong', () => {
    const correct = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Mon, 01 Jan 2026 00:00:10 GMT')).toBe(correct);
  });

  test('a single-digit day is tolerated', () => {
    expect(parseHttpDate('Thu, 1 Jan 2026 00:00:10 GMT')).toBe(
      parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT'),
    );
  });
});

describe('parseHttpDate strictness (CFG-31)', () => {
  test('blank input fails', () => {
    expect(parseHttpDate('')).toBeNull();
  });

  test('a missing comma after the weekday fails', () => {
    expect(parseHttpDate('Mon 01 Jan 2024 00:00:00 GMT')).toBeNull();
  });

  test('an out-of-range field is rejected, not silently rolled over', () => {
    expect(parseHttpDate('Thu, 32 Jan 2026 00:00:10 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Jan 2026 24:00:10 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Foo 2026 00:00:10 GMT')).toBeNull();
  });

  test('a four-digit year below 100 is rejected, not mapped into the 1900s', () => {
    // `Date.UTC(26, ...)` applies legacy two-digit-year mapping, so an unguarded parse turns 0026
    // into 1926 -- a valid-looking instant 1900 years off, and the one input that would make a
    // malformed Retry-After read as a PAST instant (retry immediately) instead of no-hint.
    expect(parseHttpDate('Thu, 01 Jan 0026 00:00:00 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Jan 0099 00:00:00 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Jan 0100 00:00:00 GMT')).not.toBeNull();
  });

  test('a leap second is admitted and normalized to the next real instant', () => {
    // RFC 9110 allows second 60; there is no leap-second slot on this calendar, so the correct next
    // instant is the following minute. Documented normalization, unlike the field rollovers above.
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:60 GMT')).toBe(
      parseHttpDate('Thu, 01 Jan 2026 00:01:00 GMT'),
    );
  });

  test('property: never throws for any string', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(() => parseHttpDate(value)).not.toThrow();
      }),
    );
  });

  test('property: a formatted instant round-trips through parse', () => {
    fc.assert(
      fc.property(fc.integer({min: 0, max: 4_102_444_800_000}), epochMs => {
        const truncated = Math.floor(epochMs / 1000) * 1000;
        expect(parseHttpDate(formatHttpDate(truncated))).toBe(truncated);
      }),
    );
  });
});
