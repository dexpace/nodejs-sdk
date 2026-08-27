// SPDX-License-Identifier: MIT
// packages/core/src/retry/pacing.test.ts
// Exercises: RETRY-15 (all recognized forms), RETRY-16/RECOV-23 (total, malformed -> null not 0),
// RETRY-17 (past instant -> 0), RETRY-18/RECOV-26 (365-day ceiling), RETRY-19 (strict decimal grammar
// before any float parse), RETRY-21/RECOV-24 (fixed precedence, first parseable wins), RECOV-25
// (X-RateLimit-Reset positive jitter).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers} from '../http/headers.js';
import {parsePacingHint} from './pacing.js';

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const noJitter = (): number => 0;

function headersOf(entries: Record<string, string>): Headers {
  let builder = Headers.newBuilder();
  for (const [name, value] of Object.entries(entries)) {
    builder = builder.add(name, value);
  }
  return builder.build();
}

describe('Retry-After as delta-seconds (RETRY-15)', () => {
  test('an integer is honored', () => {
    expect(
      parsePacingHint(headersOf({'Retry-After': '30'}), NOW, noJitter),
    ).toBe(30_000);
  });

  test('a fractional value is honored to sub-second resolution', () => {
    expect(
      parsePacingHint(headersOf({'Retry-After': '1.5'}), NOW, noJitter),
    ).toBe(1500);
  });

  test('zero is honored as an immediate retry', () => {
    expect(
      parsePacingHint(headersOf({'Retry-After': '0'}), NOW, noJitter),
    ).toBe(0);
  });
});

describe('Retry-After as an HTTP-date (RETRY-15)', () => {
  test('a full RFC 1123 date resolves to the delta', () => {
    const value = 'Thu, 01 Jan 2026 00:00:10 GMT';
    expect(
      parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter),
    ).toBe(10_000);
  });

  test('a single-digit day is tolerated', () => {
    const value = 'Thu, 1 Jan 2026 00:00:10 GMT';
    expect(
      parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter),
    ).toBe(10_000);
  });

  test('the informational weekday is ignored, even when wrong', () => {
    const value = 'Mon, 01 Jan 2026 00:00:10 GMT';
    expect(
      parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter),
    ).toBe(10_000);
  });

  test('a date already in the past yields zero, not null (RETRY-17)', () => {
    const value = 'Thu, 01 Jan 2026 00:00:00 GMT';
    expect(
      parsePacingHint(headersOf({'Retry-After': value}), NOW + 5000, noJitter),
    ).toBe(0);
  });

  test('a year below 100 is a valid past instant, so it yields zero (RETRY-17)', () => {
    // Until Phase 7a's shared parser landed, this module's private one REJECTED a year in [0,99],
    // and this case asserted null. `config/http-date.ts` reads the year literally instead (never
    // `Date.UTC`, whose legacy mapping would turn 0026 into 1926), which makes this a well-formed
    // HTTP-date already in the past -- and RETRY-17 governs that case: a valid past instant MUST
    // yield a zero delay, distinct from RETRY-16's unparseable-value-yields-no-hint. Recorded at
    // docs/open-items.md K20.
    expect(
      parsePacingHint(
        headersOf({'Retry-After': 'Thu, 01 Jan 0026 00:00:00 GMT'}),
        NOW,
        noJitter,
      ),
    ).toBe(0);
  });

  test('an out-of-range field is rejected rather than rolled over (RETRY-16)', () => {
    expect(
      parsePacingHint(
        headersOf({'Retry-After': 'Thu, 32 Jan 2026 00:00:10 GMT'}),
        NOW,
        noJitter,
      ),
    ).toBeNull();
    expect(
      parsePacingHint(
        headersOf({'Retry-After': 'Thu, 01 Jan 2026 24:00:10 GMT'}),
        NOW,
        noJitter,
      ),
    ).toBeNull();
    expect(
      parsePacingHint(
        headersOf({'Retry-After': 'Thu, 01 Foo 2026 00:00:10 GMT'}),
        NOW,
        noJitter,
      ),
    ).toBeNull();
  });
});

describe('strict decimal screening (RETRY-19)', () => {
  test('type-suffixed, hex-float, NaN, and Infinity forms are rejected', () => {
    for (const value of [
      '30d',
      '30f',
      '0x1p3',
      'NaN',
      'Infinity',
      '-Infinity',
      '1e3',
      '+30',
      ' 30 ',
    ]) {
      expect(
        parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter),
      ).toBeNull();
    }
  });

  test('a negative delta maps to no hint, never a zero delay (RETRY-16)', () => {
    expect(
      parsePacingHint(headersOf({'Retry-After': '-5'}), NOW, noJitter),
    ).toBeNull();
  });
});

describe('millisecond variants (RETRY-15)', () => {
  test('retry-after-ms is honored', () => {
    expect(
      parsePacingHint(headersOf({'retry-after-ms': '250'}), NOW, noJitter),
    ).toBe(250);
  });

  test('x-ms-retry-after-ms is honored', () => {
    expect(
      parsePacingHint(headersOf({'x-ms-retry-after-ms': '250'}), NOW, noJitter),
    ).toBe(250);
  });

  test('a malformed millisecond value falls through to no hint', () => {
    expect(
      parsePacingHint(headersOf({'retry-after-ms': '25.5'}), NOW, noJitter),
    ).toBeNull();
  });
});

describe('X-RateLimit-Reset (RETRY-15, RECOV-25)', () => {
  test('an epoch-seconds reset resolves to the delta', () => {
    const reset = String(Math.floor(NOW / 1000) + 10);
    expect(
      parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, noJitter),
    ).toBe(10_000);
  });

  test('positive jitter tops out at 120% of the delta (RECOV-25)', () => {
    const reset = String(Math.floor(NOW / 1000) + 10);
    expect(
      parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, () => 1),
    ).toBeCloseTo(12_000, 6);
  });

  test('a past reset yields zero (RETRY-17)', () => {
    const reset = String(Math.floor(NOW / 1000) - 10);
    expect(
      parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, () => 1),
    ).toBe(0);
  });
});

describe('precedence (RETRY-21)', () => {
  test('numeric Retry-After beats every other form', () => {
    const headers = headersOf({
      'Retry-After': '30',
      'retry-after-ms': '1',
      'x-ms-retry-after-ms': '2',
      'X-RateLimit-Reset': String(Math.floor(NOW / 1000) + 99),
    });
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(30_000);
  });

  test('an unparseable Retry-After falls through to retry-after-ms, not to null', () => {
    const headers = headersOf({
      'Retry-After': 'garbage',
      'retry-after-ms': '250',
    });
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(250);
  });

  test('retry-after-ms beats x-ms-retry-after-ms', () => {
    const headers = headersOf({
      'retry-after-ms': '250',
      'x-ms-retry-after-ms': '999',
    });
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(250);
  });
});

describe('bounds and totality', () => {
  test('a huge delta is clamped to the 365-day ceiling (RETRY-18)', () => {
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(
      parsePacingHint(headersOf({'Retry-After': '99999999999'}), NOW, noJitter),
    ).toBe(yearMs);
  });

  test('no pacing header at all yields no hint', () => {
    expect(parsePacingHint(headersOf({}), NOW, noJitter)).toBeNull();
  });

  test('property: the parser never throws for any header value (RETRY-16)', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        const headers = Headers.newBuilder()
          .add('Retry-After', value.replaceAll(/[\r\n\0]/gu, ''))
          .build();
        expect(() => parsePacingHint(headers, NOW, noJitter)).not.toThrow();
      }),
    );
  });

  test('property: the result is null or a finite non-negative number, never NaN (RETRY-16)', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        const headers = Headers.newBuilder()
          .add('Retry-After', value.replaceAll(/[\r\n\0]/gu, ''))
          .build();
        const hint = parsePacingHint(headers, NOW, noJitter);
        if (hint === null) return;
        expect(Number.isFinite(hint)).toBe(true);
        expect(hint).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
