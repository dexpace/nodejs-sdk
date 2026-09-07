// SPDX-License-Identifier: MIT
// packages/core/src/retry/attempt-stamp.test.ts
// Exercises: RETRY-38/RECOV-31 (1-based ordinal on a FRESH copy, never mutating the template,
// preserving the idempotency key and every other header, zero-allocation no-op when disabled).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import {stampAttempt} from './attempt-stamp.js';

function aRequest(): Request {
  return Request.newBuilder()
    .method('POST')
    .url('https://example.com')
    .headers(
      Headers.newBuilder()
        .add('Idempotency-Key', 'abc-123')
        .add('X-Trace', 't1')
        .build(),
    )
    .build();
}

describe('stampAttempt', () => {
  test('returns the ORIGINAL instance when no header name is configured (RETRY-38)', () => {
    const request = aRequest();
    expect(stampAttempt(request, 2, undefined)).toBe(request);
  });

  test('writes the 1-based ordinal under the configured header', () => {
    const stamped = stampAttempt(aRequest(), 3, 'X-Attempt');
    expect(stamped.headers.get('X-Attempt')).toBe('3');
  });

  test('never mutates the captured template', () => {
    const request = aRequest();
    stampAttempt(request, 3, 'X-Attempt');
    expect(request.headers.get('X-Attempt')).toBeUndefined();
  });

  test('preserves the idempotency key and every other header', () => {
    const stamped = stampAttempt(aRequest(), 2, 'X-Attempt');
    expect(stamped.headers.get('Idempotency-Key')).toBe('abc-123');
    expect(stamped.headers.get('X-Trace')).toBe('t1');
  });

  test('preserves method, url, and body', () => {
    const request = aRequest();
    const stamped = stampAttempt(request, 2, 'X-Attempt');
    expect(stamped.method).toBe(request.method);
    expect(stamped.url.href).toBe(request.url.href);
    expect(stamped.body).toBe(request.body);
  });

  test('re-stamping replaces rather than appends', () => {
    const once = stampAttempt(aRequest(), 2, 'X-Attempt');
    const twice = stampAttempt(once, 3, 'X-Attempt');
    expect(twice.headers.get('X-Attempt')).toBe('3');
  });
});
