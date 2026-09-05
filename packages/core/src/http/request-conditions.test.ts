// SPDX-License-Identifier: MIT
// packages/core/src/http/request-conditions.test.ts
// Exercises: HTTP-50 (comma-joined If-Match/If-None-Match, RFC 1123 dates, idempotent apply, any-tag
// exclusivity, and an invalid Date rejected at the setter rather than emitted as `Invalid Date`)
import {describe, expect, test} from 'bun:test';
import {
  RequestConditions,
  RequestConditionsBuilder,
} from './request-conditions.js';
import {ETag} from './etag.js';
import {Headers} from './headers.js';
import {RequestConditionsValidationError} from './errors.js';

function etag(raw: string): ETag {
  const parsed = ETag.parse(raw);
  if (parsed === undefined)
    throw new Error(`test fixture is not a valid ETag: ${raw}`);
  return parsed;
}

describe('If-Match / If-None-Match emission', () => {
  test('emits multiple ETags as one comma-separated header', () => {
    const conditions = RequestConditions.newBuilder()
      .ifMatch(etag('"a"'))
      .ifMatch(etag('"b"'))
      .build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Match')).toBe('"a", "b"');
  });
});

describe('date emission', () => {
  test('emits If-Modified-Since as an RFC 1123 date', () => {
    const conditions = RequestConditions.newBuilder()
      .ifModifiedSince(new Date('2015-10-21T07:28:00Z'))
      .build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Modified-Since')).toBe(
      'Wed, 21 Oct 2015 07:28:00 GMT',
    );
  });
});

describe('idempotent apply', () => {
  test('applying the same conditions twice does not duplicate the header', () => {
    const conditions = RequestConditions.newBuilder()
      .ifMatch(etag('"a"'))
      .build();
    const once = conditions.applyTo(Headers.newBuilder().build());
    const twice = conditions.applyTo(once);
    expect(twice.getAll('If-Match')).toEqual(['"a"']);
  });
});

describe('any-tag mutual exclusivity', () => {
  test('collapses repeated * to one', () => {
    const conditions = RequestConditions.newBuilder()
      .ifMatch(ETag.ANY)
      .ifMatch(ETag.ANY)
      .build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Match')).toBe('*');
  });

  test('rejects mixing * with a concrete ETag', () => {
    const builder = new RequestConditionsBuilder().ifMatch(ETag.ANY);
    expect(() => builder.ifMatch(etag('"a"'))).toThrow(
      RequestConditionsValidationError,
    );
  });

  test('rejects adding * after a concrete ETag', () => {
    const builder = new RequestConditionsBuilder().ifMatch(etag('"a"'));
    expect(() => builder.ifMatch(ETag.ANY)).toThrow(
      RequestConditionsValidationError,
    );
  });
});

describe('newBuilder derivation (HTTP-3) and Date isolation (HTTP-1)', () => {
  test('deriving and rebuilding preserves conditions without affecting the original', () => {
    const original = RequestConditions.newBuilder()
      .ifMatch(etag('"a"'))
      .build();
    const derived = original.newBuilder().ifNoneMatch(etag('"b"')).build();

    const originalHeaders = original.applyTo(Headers.newBuilder().build());
    const derivedHeaders = derived.applyTo(Headers.newBuilder().build());

    expect(originalHeaders.get('If-None-Match')).toBeUndefined();
    expect(derivedHeaders.get('If-Match')).toBe('"a"');
    expect(derivedHeaders.get('If-None-Match')).toBe('"b"');
  });

  test('mutating the caller-supplied Date after build does not change what applyTo emits', () => {
    const date = new Date('2015-10-21T07:28:00Z');
    const conditions = RequestConditions.newBuilder()
      .ifModifiedSince(date)
      .build();

    date.setFullYear(1999);

    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Modified-Since')).toBe(
      'Wed, 21 Oct 2015 07:28:00 GMT',
    );
  });
});

describe('ifUnmodifiedSince (HTTP-50)', () => {
  test('emits an RFC 1123 date and survives mutation of the caller-supplied Date', () => {
    const date = new Date('2015-10-21T07:28:00Z');
    const conditions = RequestConditions.newBuilder()
      .ifUnmodifiedSince(date)
      .build();

    date.setFullYear(1999);

    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Unmodified-Since')).toBe(
      'Wed, 21 Oct 2015 07:28:00 GMT',
    );
  });

  test('is carried through newBuilder derivation and applies idempotently', () => {
    const original = RequestConditions.newBuilder()
      .ifUnmodifiedSince(new Date('2015-10-21T07:28:00Z'))
      .build();
    const derived = original.newBuilder().build();

    const once = derived.applyTo(Headers.newBuilder().build());
    const twice = derived.applyTo(once);
    expect(twice.getAll('If-Unmodified-Since')).toEqual([
      'Wed, 21 Oct 2015 07:28:00 GMT',
    ]);
  });
});

describe('an invalid Date is rejected at the setter (HTTP-50)', () => {
  // `toRfc1123` is `date.toUTCString()`, which renders the literal string `Invalid Date` for a NaN
  // time value. `Invalid Date` is HTAB-free printable ASCII, so HTTP-18's outbound header grammar
  // waves it through and it reaches the wire as `If-Modified-Since: Invalid Date` — a header no
  // server can evaluate, produced from a caller mistake made several frames earlier. HTTP-50's
  // "emit RFC 1123 dates" is not satisfiable from a NaN instant, so the setter is where it fails.
  // Measured on the pre-fix tree, audit #67 / #76.
  test.each([
    ['new Date("nope")', new Date('nope')],
    ['new Date(NaN)', new Date(Number.NaN)],
  ])(
    'ifModifiedSince rejects %s with RequestConditionsValidationError',
    (_label, date) => {
      expect(() =>
        RequestConditions.newBuilder().ifModifiedSince(date),
      ).toThrow(RequestConditionsValidationError);
    },
  );

  test.each([
    ['new Date("nope")', new Date('nope')],
    ['new Date(NaN)', new Date(Number.NaN)],
  ])(
    'ifUnmodifiedSince rejects %s with RequestConditionsValidationError',
    (_label, date) => {
      expect(() =>
        RequestConditions.newBuilder().ifUnmodifiedSince(date),
      ).toThrow(RequestConditionsValidationError);
    },
  );

  test('the message names the setter, so the caller knows which field to fix', () => {
    expect(() =>
      RequestConditions.newBuilder().ifModifiedSince(new Date('nope')),
    ).toThrow(/If-Modified-Since/);
    expect(() =>
      RequestConditions.newBuilder().ifUnmodifiedSince(new Date('nope')),
    ).toThrow(/If-Unmodified-Since/);
  });

  test('no invalid instant can reach applyTo, so no header renders "Invalid Date"', () => {
    const builder = RequestConditions.newBuilder();
    expect(() => builder.ifModifiedSince(new Date('nope'))).toThrow(
      RequestConditionsValidationError,
    );
    const headers = builder.build().applyTo(Headers.newBuilder().build());
    expect(headers.has('If-Modified-Since')).toBe(false);
  });
});
