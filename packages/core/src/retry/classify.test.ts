// SPDX-License-Identifier: MIT
// packages/core/src/retry/classify.test.ts
// Exercises: RETRY-1 (single-sourced status set, 501/505 excluded), RETRY-2 (iterative
// identity-tracking cause walk, cycle-safe), RETRY-3 (retryability derived from status, not a stored
// flag), RETRY-4 (transport failures always retryable), RETRY-5/6/7 (re-sendability), RETRY-8 (both
// axes required), RETRY-23/24 (cancellation vs timeout), RETRY-25 (allow-list makes the fatal
// exclusion vacuous), RETRY-37 (configured set is authoritative -- widens AND narrows).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {HttpStatusError} from '../body/http-status-error.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import type {Body} from '../body/body.js';
import {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';
import {CancellationError} from '../seams/transport.js';
import {
  RETRYABLE_STATUSES,
  isResendable,
  isRetryableFailure,
  isRetryableStatus,
} from './classify.js';

function aRequest(method: 'GET' | 'POST' | 'PUT', body?: Body): Request {
  const builder = Request.newBuilder()
    .method(method)
    .url('https://example.com');
  return body === undefined ? builder.build() : builder.body(body).build();
}

describe('isRetryableStatus', () => {
  test('408 and 429 are retryable', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('500-599 are retryable except 501 and 505', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
    expect(isRetryableStatus(501)).toBe(false);
    expect(isRetryableStatus(505)).toBe(false);
  });

  test('other statuses are not retryable', () => {
    for (const code of [200, 201, 301, 400, 401, 404, 409, 418, 499, 600]) {
      expect(isRetryableStatus(code)).toBe(false);
    }
  });

  test('the exported set and the predicate are the same source', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 700}), code => {
        expect(isRetryableStatus(code)).toBe(RETRYABLE_STATUSES.has(code));
      }),
    );
  });
});

describe('isRetryableFailure', () => {
  test('an IoError is retryable', () => {
    expect(
      isRetryableFailure(new IoError('connection refused'), RETRYABLE_STATUSES),
    ).toBe(true);
  });

  test('an IoError buried in the cause chain is retryable (RETRY-2)', () => {
    const buried = new Error('wrapper', {
      cause: new Error('middle', {cause: new IoError('reset')}),
    });
    expect(isRetryableFailure(buried, RETRYABLE_STATUSES)).toBe(true);
  });

  test('a cyclic cause chain terminates instead of hanging (RETRY-2)', () => {
    const first = new Error('first');
    const second = new Error('second', {cause: first});
    Object.defineProperty(first, 'cause', {value: second, configurable: true});

    expect(isRetryableFailure(first, RETRYABLE_STATUSES)).toBe(false);
  });

  test('an HttpStatusError derives retryability from its status (RETRY-3)', () => {
    expect(
      isRetryableFailure(
        new HttpStatusError(503, undefined, undefined),
        RETRYABLE_STATUSES,
      ),
    ).toBe(true);
    expect(
      isRetryableFailure(
        new HttpStatusError(501, undefined, undefined),
        RETRYABLE_STATUSES,
      ),
    ).toBe(false);
  });

  test('the configured set is authoritative and can widen (RETRY-37)', () => {
    const widened = new Set([...RETRYABLE_STATUSES, 404]);
    expect(
      isRetryableFailure(
        new HttpStatusError(404, undefined, undefined),
        widened,
      ),
    ).toBe(true);
  });

  test('the configured set is authoritative and can narrow (RETRY-37)', () => {
    const narrowed = new Set([500]);
    expect(
      isRetryableFailure(
        new HttpStatusError(503, undefined, undefined),
        narrowed,
      ),
    ).toBe(false);
  });
});

describe('isRetryableFailure -- cancellation, timeouts, and the allow-list', () => {
  test('a user abort is never retryable (RETRY-23)', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      isRetryableFailure(controller.signal.reason, RETRYABLE_STATUSES),
    ).toBe(false);
  });

  test('a CancellationError is never retryable, even nested (RETRY-23, XCUT-1)', () => {
    // Phase 2 declares `CancellationError extends DexpaceError`, NOT the IoError family, so the
    // allow-list already excludes it. Asserted rather than assumed: were it ever re-parented under
    // IoError, cancellation would silently become a retryable condition and XCUT-1 would break.
    const cancelled = new CancellationError('caller aborted');
    expect(isRetryableFailure(cancelled, RETRYABLE_STATUSES)).toBe(false);
    expect(
      isRetryableFailure(
        new Error('send failed', {cause: cancelled}),
        RETRYABLE_STATUSES,
      ),
    ).toBe(false);
  });

  test('a throwing cause accessor ends the walk instead of masking the failure', () => {
    // `cause` is an ordinary property, so a lazily-built one can raise from the read. Classifying a
    // failure must never replace it with a classification error.
    const hostile = new IoError('connection refused');
    Object.defineProperty(hostile, 'cause', {
      get() {
        throw new Error('hostile accessor');
      },
    });
    const wrapper = new Error('wrapper');
    Object.defineProperty(wrapper, 'cause', {
      get() {
        throw new Error('hostile accessor');
      },
    });

    expect(isRetryableFailure(hostile, RETRYABLE_STATUSES)).toBe(true);
    expect(isRetryableFailure(wrapper, RETRYABLE_STATUSES)).toBe(false);
  });

  test('a timeout abort is retryable (RETRY-24)', () => {
    const reason = new DOMException('The operation timed out.', 'TimeoutError');
    expect(isRetryableFailure(reason, RETRYABLE_STATUSES)).toBe(true);
  });

  test('a timeout abort wrapped as a cause is retryable (RETRY-24)', () => {
    const reason = new DOMException('The operation timed out.', 'TimeoutError');
    expect(
      isRetryableFailure(
        new Error('send failed', {cause: reason}),
        RETRYABLE_STATUSES,
      ),
    ).toBe(true);
  });

  test('an unlisted throwable is not retryable, no deny-list needed (RETRY-25)', () => {
    expect(
      isRetryableFailure(
        new RangeError('Maximum call stack size exceeded'),
        RETRYABLE_STATUSES,
      ),
    ).toBe(false);
    expect(isRetryableFailure(new TypeError('bad'), RETRYABLE_STATUSES)).toBe(
      false,
    );
    expect(isRetryableFailure('a bare string throw', RETRYABLE_STATUSES)).toBe(
      false,
    );
    expect(isRetryableFailure(undefined, RETRYABLE_STATUSES)).toBe(false);
  });
});

describe('isResendable', () => {
  test('a body-less idempotent request is re-sendable (RETRY-5/6)', () => {
    expect(isResendable(aRequest('GET'))).toBe(true);
    expect(isResendable(aRequest('PUT'))).toBe(true);
  });

  test('a bare POST is NOT re-sendable even with nothing to resend (RETRY-7)', () => {
    expect(isResendable(aRequest('POST'))).toBe(false);
  });

  test('a POST with a replayable body is re-sendable (RETRY-5)', () => {
    expect(isResendable(aRequest('POST', stringBody('payload')))).toBe(true);
  });

  test('a request with a non-replayable body is NOT re-sendable (RETRY-5)', () => {
    const oneShot = streamBody(
      new ReadableStream<Uint8Array>({
        start: c => {
          c.close();
        },
      }),
      undefined,
      0,
    );
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com')
      .body(oneShot)
      .build();
    expect(isResendable(request)).toBe(false);
  });
});
