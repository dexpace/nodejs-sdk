// SPDX-License-Identifier: MIT
// tests/conformance/xcut/error-taxonomy.conformance.test.ts
// Exercises: XCUT-4 (two-branch taxonomy -- response-carrying protocol errors vs. response-less
// I/O-family transport errors), XCUT-6 (a custom error type participates in retry with no edit to
// the classifier), XCUT-7 (the CONFIGURED retryable-status set is authoritative and both widens and
// narrows), XCUT-9 (a cyclic cause chain terminates instead of hanging).
// XCUT-5 and XCUT-8 stay retrofit citations at their own phases' tests -- see this file's closing note.
//
// Every row drives the composed pipeline rather than calling `isRetryableFailure` directly. That is
// deliberate on two counts: the classifier is `@internal` and absent from core's barrel, so a
// consumer-shaped test cannot reach it at all; and calling it directly would restate 5a's own
// classify.test.ts, which this suite is explicitly not for.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  IoError,
  Request,
  toHttpError,
  type Response,
  type Transport,
} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';
import {rejectionOf} from './fixtures/settle.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

/** A transport that always throws whatever it was handed, to drive classification from the inside. */
class ThrowingTransport implements Transport {
  readonly #error: unknown;

  constructor(error: unknown) {
    this.#error = error;
  }

  send(): Promise<Response> {
    // This transport exists to reject with values that are deliberately NOT Errors, so XCUT-9's
    // cyclic-cause row and XCUT-6's opted-out row can drive the classifier with whatever they like.
    // An `async` + `throw` rewrite only trades this rule for `require-await`.
    /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejecting with a non-Error IS the behavior under test; re-enable if XCUT-6/XCUT-9 stop needing non-Error rejections */
    return Promise.reject(this.#error);
  }

  async close(): Promise<void> {
    // Nothing to release: this transport never opens anything.
  }
}

describe('XCUT-4: the taxonomy has exactly two branches', () => {
  test('a 5xx arrives as a protocol failure carrying its fully-received response', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 1}},
    });

    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).build(),
    );

    expect(response.status.code).toBe(500);
    await response.close();
    await pipeline.close();
  });

  test('that response converts to the response-carrying error exposing status and body', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 1}},
    });
    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).build(),
    );

    const error = await toHttpError(response);

    expect(error?.status).toBe(500);
    expect(error?.preview()).toContain('server error');
    await pipeline.close();
  });

  test('a connection failure arrives as the response-less I/O-family error', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 1}},
    });

    const pending = pipeline.runtime.send(
      // Port 1: nothing listens, so the connection is refused rather than merely slow.
      Request.newBuilder().url('http://127.0.0.1:1/').build(),
    );

    // Catchable as the generic I/O family, which is XCUT-4's "existing I/O catch sites keep matching".
    expect(await rejectionOf(pending)).toBeInstanceOf(IoError);
    await pipeline.close();
  });
});

describe('XCUT-6: a custom error type participates without editing the classifier', () => {
  test('retries an error type declared in this test file, unknown to classify.ts', async () => {
    // The port's retryability capability is subtyping, not a duck-typed `isRetryable` flag: the
    // cause-walk returns true for anything `instanceof IoError`, so extending it is what opts a new
    // failure in with no classifier edit (deviation ledger item 17, docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md).
    class CustomTransientError extends IoError {}
    const pipeline = buildComposedPipeline({
      transport: new ThrowingTransport(new CustomTransientError('transient')),
      retry: {settings: {maxAttempts: 3, initialDelayMs: 1}},
    });

    await pipeline.runtime
      .send(Request.newBuilder().url(`${server.url}/ok`).build())
      .catch(() => undefined);

    expect(pipeline.dispatches()).toBe(3);
    await pipeline.close();
  });

  test('does not retry a plain Error, which opted into nothing', async () => {
    const pipeline = buildComposedPipeline({
      transport: new ThrowingTransport(new Error('not opted in')),
      retry: {settings: {maxAttempts: 3, initialDelayMs: 1}},
    });

    await pipeline.runtime
      .send(Request.newBuilder().url(`${server.url}/ok`).build())
      .catch(() => undefined);

    // The allow-list shape is the whole point: unknown failures are terminal by default.
    expect(pipeline.dispatches()).toBe(1);
    await pipeline.close();
  });
});

describe('XCUT-7: the configured retryable-status set is authoritative', () => {
  test('widening it to include 501 retries a status the built-in classifier excludes', async () => {
    const pipeline = buildComposedPipeline({
      retry: {
        settings: {
          maxAttempts: 3,
          initialDelayMs: 1,
          retryableStatuses: new Set([501]),
        },
      },
    });

    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/status?code=501`).build(),
    );

    expect(pipeline.dispatches()).toBe(3);
    await response.close();
    await pipeline.close();
  });

  test('narrowing it to exclude 500 stops a status the built-in classifier includes', async () => {
    const pipeline = buildComposedPipeline({
      retry: {
        settings: {
          maxAttempts: 3,
          initialDelayMs: 1,
          retryableStatuses: new Set([503]),
        },
      },
    });

    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/status?code=500`).build(),
    );

    // 500's built-in classification is retryable; the configured set overrides it rather than
    // being AND-ed with it (RETRY-37).
    expect(pipeline.dispatches()).toBe(1);
    await response.close();
    await pipeline.close();
  });
});

describe('XCUT-9: a cyclic cause chain terminates', () => {
  test('classifies a self-referential error without hanging', async () => {
    const cyclic = new Error('cyclic');
    cyclic.cause = cyclic;
    const pipeline = buildComposedPipeline({
      transport: new ThrowingTransport(cyclic),
      retry: {settings: {maxAttempts: 3, initialDelayMs: 1}},
    });

    const surfaced = await rejectionOf(
      pipeline.runtime.send(
        Request.newBuilder().url(`${server.url}/ok`).build(),
      ),
    );

    // Reaching this line at all is the assertion: an identity-tracking walk terminates, a naive
    // recursive one would have spun until the test timed out.
    expect(surfaced).toBe(cyclic);
    await pipeline.close();
  });
});
