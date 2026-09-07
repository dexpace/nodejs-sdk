// SPDX-License-Identifier: MIT
// packages/transport-shared/src/dispatch-classification.test.ts
// Exercises: TRANSPORT-20 (a failure that produced no response is the retryable transport failure),
// RETRY-2 (the retryable set is an allow-list, so a permanent misconfiguration outside the IoError
// tree is non-retryable for free), TRANSPORT-8 (an argument the native client can never accept is
// told apart from an exchange that failed)
import {describe, expect, test} from 'bun:test';
import {isIoError, TransportFailureError} from '@dexpace/core';
import {
  isPermanentDispatchFailure,
  toDispatchFailure,
} from './dispatch-classification.js';

/** An error carrying a native `code`, the shape undici and Bun both attach one to. */
function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), {code});
}

describe('isPermanentDispatchFailure', () => {
  test("undici's two argument-validation codes are permanent", () => {
    expect(
      isPermanentDispatchFailure(
        coded(
          'Invalid URL protocol: the URL must start with `http:` or `https:`.',
          'UND_ERR_INVALID_ARG',
        ),
      ),
    ).toBe(true);
    expect(
      isPermanentDispatchFailure(coded('expect', 'UND_ERR_NOT_SUPPORTED')),
    ).toBe(true);
  });

  test("Bun's coded fetch refusal for an unsupported scheme is permanent", () => {
    // Bun 1.3.14, measured: `fetch('ftp://…')` rejects with this exact shape, where Node's
    // undici-backed `fetch` rejects with `fetch failed` and an `unknown scheme` cause instead.
    const error = Object.assign(
      new TypeError('protocol must be http:, https: or s3:'),
      {code: 'ERR_INVALID_ARG_VALUE'},
    );
    expect(isPermanentDispatchFailure(error)).toBe(true);
  });

  test("a causeless TypeError is undici's argument validation, so it is permanent", () => {
    // Node's global `fetch` throws these out of the `Request` constructor, before any dispatch.
    for (const message of [
      "'CONNECT' HTTP method is unsupported.",
      "'BAD METHOD' is not a valid HTTP method.",
      'Request with GET/HEAD method cannot have body.',
    ]) {
      expect(isPermanentDispatchFailure(new TypeError(message))).toBe(true);
    }
  });

  test('a scheme refusal reported through `fetch failed` is permanent', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('unknown scheme'),
    });
    expect(isPermanentDispatchFailure(error)).toBe(true);
  });

  test('a network failure reported through `fetch failed` is NOT permanent', () => {
    const error = new TypeError('fetch failed', {
      cause: coded('getaddrinfo ENOTFOUND example.invalid', 'ENOTFOUND'),
    });
    expect(isPermanentDispatchFailure(error)).toBe(false);
  });

  test('a blocked port stays retryable (TRANSPORT-20 probes one by name)', () => {
    // `http://127.0.0.1:1` is the dead-port probe §17 names for TRANSPORT-20, and port 1 is on
    // WHATWG's blocked list, so Node's `fetch` refuses it before connecting and says so in the
    // cause. Classifying that reason as permanent would turn the SDK's headline retryable case
    // terminal, which is why the reason table excludes it explicitly.
    const error = new TypeError('fetch failed', {cause: new Error('bad port')});
    expect(isPermanentDispatchFailure(error)).toBe(false);
  });

  test('a plain connection failure and a non-Error rejection stay retryable', () => {
    expect(
      isPermanentDispatchFailure(
        coded('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED'),
      ),
    ).toBe(false);
    expect(isPermanentDispatchFailure('a string nobody typed')).toBe(false);
  });
});

describe('toDispatchFailure', () => {
  test('a permanent misconfiguration is a TypeError outside the IoError tree', () => {
    const cause = coded('invalid request method', 'UND_ERR_INVALID_ARG');
    const mapped = toDispatchFailure(cause, 'dispatch failed');
    expect(mapped).toBeInstanceOf(TypeError);
    // RETRY-2's allow-list is what makes this non-retryable; the class is how it stays outside it.
    expect(isIoError(mapped)).toBe(false);
    expect(mapped.cause).toBe(cause);
  });

  test('an exchange failure is the retryable TransportFailureError, cause intact', () => {
    const cause = coded('connect ECONNREFUSED 127.0.0.1:1', 'ECONNREFUSED');
    const mapped = toDispatchFailure(cause, 'dispatch failed');
    expect(mapped).toBeInstanceOf(TransportFailureError);
    expect(isIoError(mapped)).toBe(true);
    expect(mapped.message).toBe('connect ECONNREFUSED 127.0.0.1:1');
    expect(mapped.cause).toBe(cause);
  });

  test('a permanent verdict taken from the cause names the cause in its message', () => {
    // `fetch failed` names nothing; the reason that made the verdict is the useful half.
    const mapped = toDispatchFailure(
      new TypeError('fetch failed', {cause: new Error('unknown scheme')}),
      'fetch failed',
    );
    expect(mapped.message).toBe('fetch failed: unknown scheme');
  });

  test('an error already in the SDK vocabulary is passed through untouched', () => {
    // A request-body producer failure racing the dispatch arrives here already classified; the
    // table knows nothing about the producer and must not re-answer for it.
    const already = new TransportFailureError('producer exploded');
    expect(toDispatchFailure(already, 'fetch failed')).toBe(already);
  });

  test('a non-Error rejection falls back to the caller-supplied message', () => {
    const mapped = toDispatchFailure(Symbol('nope'), 'fetch failed');
    expect(mapped).toBeInstanceOf(TransportFailureError);
    expect(mapped.message).toBe('fetch failed');
  });
});
