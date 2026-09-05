// SPDX-License-Identifier: MIT
// packages/transport-shared/src/body-less.test.ts
// Exercises: TRANSPORT-24 (every status is surfaced faithfully, including the ones that carry no
// body), TRANSPORT-25 (a response whose body a transport declines to expose still has its native
// handle released), TRANSPORT-27 (an absent length is the unknown-length case, not a failure)
import {describe, expect, test} from 'bun:test';
import type {Method} from '@dexpace/core';
import {hasNoResponseBody} from './body-less.js';

describe('hasNoResponseBody', () => {
  test('the WHATWG null-body statuses carry none, whatever the method', () => {
    for (const status of [101, 103, 204, 205, 304]) {
      expect([status, hasNoResponseBody('GET', status)]).toEqual([
        status,
        true,
      ]);
      expect([status, hasNoResponseBody('POST', status)]).toEqual([
        status,
        true,
      ]);
    }
  });

  test('an ordinary status carries one', () => {
    for (const status of [200, 201, 206, 302, 400, 404, 500, 520]) {
      expect([status, hasNoResponseBody('GET', status)]).toEqual([
        status,
        false,
      ]);
    }
  });

  test('HEAD never carries one, whatever the status', () => {
    // The Content-Length of a HEAD response describes the body a GET would have returned, so a
    // transport that framed a stream from it would hand the caller a read that never completes.
    for (const status of [200, 206, 404, 500]) {
      expect([status, hasNoResponseBody('HEAD', status)]).toEqual([
        status,
        true,
      ]);
    }
  });

  test('a 2xx CONNECT is a tunnel, a failed CONNECT is an ordinary error response', () => {
    expect(hasNoResponseBody('CONNECT', 200)).toBe(true);
    expect(hasNoResponseBody('CONNECT', 299)).toBe(true);
    expect(hasNoResponseBody('CONNECT', 407)).toBe(false);
    expect(hasNoResponseBody('CONNECT', 502)).toBe(false);
  });

  test('every other method the model admits is decided by the status alone', () => {
    const methods: readonly Method[] = [
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'OPTIONS',
      'TRACE',
      'PATCH',
    ];
    for (const method of methods) {
      expect([method, hasNoResponseBody(method, 204)]).toEqual([method, true]);
      expect([method, hasNoResponseBody(method, 200)]).toEqual([method, false]);
    }
  });
});
