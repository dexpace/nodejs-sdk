// SPDX-License-Identifier: MIT
// packages/core/src/observability/redaction.test.ts
// Exercises: XCUT-19 (logging/telemetry redacts secrets BY DEFAULT: userinfo is never allow-listable,
// query and fragment key=value tokens are redacted unless explicitly allow-listed, and header logging is
// default-deny -- the whole clause is asserted across this file and credential.test.ts's no-secret-in-
// string-form rows),
// OBS-11 (userinfo always redacted), OBS-12 (query allow-list, default {api-version}), OBS-13
// (fragment key=value tokens redacted the same way, plain fragment preserved), OBS-14 (scheme/host/port/path
// untouched, no spurious "?"), OBS-15 (malformed URL -> fixed sentinel, never throws), OBS-16 (header-value
// URL: absolute redacted like a request URL, relative keeps path + "?***" marker), OBS-18 (header-name
// allow-list, default-deny).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {redactHeaderValue, redactUrl} from './redaction.js';

describe('redactUrl: components and allow-lists (OBS-11..14)', () => {
  test('userinfo is always redacted', () => {
    const redacted = redactUrl('https://user:secret@example.com/path');
    expect(redacted).not.toContain('user');
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('***:***@');
  });

  test('query values are redacted unless allow-listed (default {api-version})', () => {
    const redacted = redactUrl('https://example.com/p?api-version=1&token=abc');
    expect(redacted).toContain('api-version=1');
    expect(redacted).toContain('token=***');
  });

  test('empty query allow-list redacts every query param', () => {
    const redacted = redactUrl(
      'https://example.com/p?api-version=1&token=abc',
      new Set(),
    );
    expect(redacted).toContain('api-version=***');
    expect(redacted).toContain('token=***');
  });

  test('a fragment key=value token is redacted; a plain fragment is preserved', () => {
    expect(redactUrl('https://example.com/p#access_token=SECRET')).toContain(
      'access_token=***',
    );
    expect(redactUrl('https://example.com/p#section')).toContain('#section');
    expect(redactUrl('https://example.com/p#')).toBe('https://example.com/p#');
    expect(redactUrl('https://example.com/p')).toBe('https://example.com/p');
  });

  test('scheme, host, port, and path are never altered', () => {
    const redacted = redactUrl('https://example.com:8443/a/b?token=x');
    expect(redacted).toContain('https://example.com:8443/a/b');
  });

  test('preserves encoded query parameter names containing spaces (OBS-12)', () => {
    expect(redactUrl('https://example.com/p?a%20b=1')).toBe(
      'https://example.com/p?a%20b=***',
    );
  });

  test('opaque URLs like mailto are not altered to contain double slashes', () => {
    expect(redactUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });
});

describe('redactUrl: delimiters and total safety (OBS-14..15)', () => {
  test('a present-but-empty query keeps its trailing "?" (OBS-14)', () => {
    expect(redactUrl('https://example.com/p?')).toBe('https://example.com/p?');
  });

  test('a URL with no query gains no spurious "?" (OBS-14)', () => {
    expect(redactUrl('https://example.com/p')).toBe('https://example.com/p');
  });

  test('a "?" inside the fragment is not treated as a query delimiter (OBS-14)', () => {
    expect(redactUrl('https://example.com/p#a?b')).toBe(
      'https://example.com/p#a?b',
    );
  });

  test('handles URL object input', () => {
    const urlObj = new URL('https://example.com/p?api-version=2&secret=123');
    expect(redactUrl(urlObj)).toBe(
      'https://example.com/p?api-version=2&secret=***',
    );
    const emptyQueryUrl = new URL('https://example.com/p');
    expect(redactUrl(emptyQueryUrl)).toBe('https://example.com/p');

    const emptyTrailingQueryUrl = new URL('https://example.com/p?');
    expect(redactUrl(emptyTrailingQueryUrl)).toBe('https://example.com/p?');

    const emptyTrailingHashUrl = new URL('https://example.com/p#');
    expect(redactUrl(emptyTrailingHashUrl)).toBe('https://example.com/p#');
  });

  test('protocol-relative header URLs redact properly', () => {
    expect(redactHeaderValue('Location', '//example.com/path?secret=123')).toBe(
      '//example.com/path?***',
    );
  });

  test('a malformed URL redacts to the fixed sentinel, never throwing', () => {
    expect(() => redactUrl('not a url at all ###')).not.toThrow();
    expect(redactUrl('not a url at all ###')).toBe('[malformed url]');
  });

  test('property: never throws for any string', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(() => redactUrl(value)).not.toThrow();
      }),
    );
  });
});

describe('redactHeaderValue (OBS-16, OBS-17, OBS-18)', () => {
  test('an allow-listed header name passes its value through', () => {
    expect(redactHeaderValue('Content-Type', 'application/json')).toBe(
      'application/json',
    );
  });

  test('a non-allow-listed header name is marked, not passed through (default-deny, "mark" policy)', () => {
    expect(redactHeaderValue('Authorization', 'Bearer secret')).toBe(
      'REDACTED',
    );
  });

  test('the "omit" policy drops a non-allow-listed header entirely (OBS-18)', () => {
    expect(
      redactHeaderValue('Authorization', 'Bearer secret', 'omit'),
    ).toBeUndefined();
  });

  test('a Location header carrying a query is redacted through the URL-value redactor', () => {
    const value = redactHeaderValue('Location', '/callback?code=SECRET');
    expect(value).toContain('/callback?***');
    expect(value).not.toContain('SECRET');
  });

  test('a Content-Location header carrying an absolute URL is redacted through the URL-value redactor', () => {
    const value = redactHeaderValue(
      'Content-Location',
      'https://example.com/cb?token=SECRET',
    );
    expect(value).toContain('https://example.com/cb?token=***');
    expect(value).not.toContain('SECRET');
  });

  test('a relative path with no query/fragment passes through unchanged', () => {
    expect(redactHeaderValue('Location', '/plain/path')).toBe('/plain/path');
  });

  test('custom query allow-list is case-insensitive for param names', () => {
    const redacted = redactUrl(
      'https://example.com/p?Custom-Param=val&secret=123',
      new Set(['custom-PARAM']),
    );
    expect(redacted).toContain('Custom-Param=val');
    expect(redacted).toContain('secret=***');
  });

  test('rejects non-string header name or value', () => {
    expect(() => redactHeaderValue(null as unknown as string, 'val')).toThrow();
    expect(() =>
      redactHeaderValue('Location', null as unknown as string),
    ).toThrow();
  });
});
