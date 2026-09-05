// SPDX-License-Identifier: MIT
// packages/core/src/retry/classify.test.ts
// Exercises: RETRY-1 (single-sourced status set, 501/505 excluded), RETRY-2 (iterative
// identity-tracking cause walk, cycle-safe; and the I/O boundary the walk tests -- one case per
// error class in `io/errors.ts`, see the block below), RETRY-3 (retryability derived from status,
// not a stored flag), RETRY-4 (transport failures always retryable), RETRY-5/6/7 (re-sendability),
// RETRY-8 (both axes required), RETRY-23/24 (cancellation vs timeout), RETRY-25 (allow-list makes
// the fatal exclusion vacuous), RETRY-37 (configured set is authoritative -- widens AND narrows),
// TRANSPORT-20 (a no-response send surfaces as a retryable I/O subtype),
// XCUT-5 (the baked retryability flag comes from ONE shared status classifier covering 408/429/all
// 5xx except 501 and 505 -- asserted below. This port has no separately-cached boolean field: the
// classifier is a pure function of HttpStatusError.status, which never changes post-construction
// (XCUT-15), so querying it at any later time is equivalent to reading a flag baked at construction).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {HttpStatusError} from '../body/http-status-error.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import type {Body} from '../body/body.js';
import {Request} from '../http/request.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  isIoError,
  SourceContractViolationError,
  TransportFailureError,
} from '../io/errors.js';
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

/**
 * One case per class in `io/errors.ts`, pinning the boundary RETRY-2's "an I/O error" is read as.
 *
 * `isIoError` accepts all six classes the file declares; `classify.ts`'s walk tests
 * `instanceof IoError`, which two of them satisfy. That gap was undecided until audit #67 / #78
 * decided it (`docs/deviations.md` item 17): the branch means "the wire failed", so `IoError` and
 * `TransportFailureError` retry and the four flat leaves do not. Each leaf case asserts BOTH halves
 * -- that `isIoError` accepts the value, and what the classifier answers for it -- because the two
 * disagreeing is the decision, and a test that only asserted the classifier would read as an
 * oversight rather than a choice.
 *
 * These are the guard on re-parenting: moving any leaf back under `IoError`, or switching the branch
 * to `isIoError`, turns four of them red instead of quietly making a deterministic failure retryable.
 * Measured 2026-09-05 by making that one-line change: exactly these four fail.
 */
describe('the I/O boundary the cause-walk tests (RETRY-2/RETRY-4, TRANSPORT-20)', () => {
  test('IoError itself is retryable', () => {
    const error = new IoError('connection refused');
    expect(isIoError(error)).toBe(true);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(true);
  });

  test('TransportFailureError is retryable (TRANSPORT-20)', () => {
    // The one class TRANSPORT-20 requires to BE an IoError. A send that produced no response is the
    // canonical retryable condition (RETRY-4), and the `extends` is what carries it here.
    const error = new TransportFailureError('ECONNREFUSED');
    expect(error).toBeInstanceOf(IoError);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(true);
  });

  test('EndOfStreamError is NOT retryable, buried in a cause chain either', () => {
    // The exact-length-copy contract inside io/, not a wire truncation: a short copy repeats on the
    // next attempt. A truncated response is the transport's to report, as TransportFailureError.
    const error = new EndOfStreamError(3, 8);
    expect(isIoError(error)).toBe(true);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(false);
    // Asserted through a wrapper too: the walk is what would rescue it if the branch widened, so the
    // shallow case alone would not catch a change made one hop up.
    expect(
      isRetryableFailure(
        new Error('read failed', {cause: error}),
        RETRYABLE_STATUSES,
      ),
    ).toBe(false);
  });

  test('SourceContractViolationError is NOT retryable', () => {
    // A foreign source that returned zero bytes for a positive read (IO-17) is a programming error
    // in the source, deterministic on re-send.
    const error = new SourceContractViolationError('source returned 0 bytes');
    expect(isIoError(error)).toBe(true);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(false);
  });

  test('ClosedResourceError is NOT retryable', () => {
    // Using a closed resource (IO-42) is a caller lifecycle error; the resource stays closed.
    const error = new ClosedResourceError('response body');
    expect(isIoError(error)).toBe(true);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(false);
  });

  test('AllocationLimitError is NOT retryable', () => {
    // A cap the same request hits again (IO-9); retrying spends the budget to fail identically.
    const error = new AllocationLimitError(2 ** 32, 2 ** 31 - 1);
    expect(isIoError(error)).toBe(true);
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(false);
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
