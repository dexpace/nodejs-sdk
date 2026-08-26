// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-step.test.ts
// Exercises: PIPE-36 (stage assignment is baked into the descriptor, not subclassable), RETRY-44 (a
// FRESH continuation per attempt via ctx.fork), RETRY-8 (both axes still gate inside the pipeline),
// RETRY-32 (the step honors the call's signal, which only exists thanks to Task 1), RETRY-41/HTTP-35
// (the per-call RequestOptions.maxRetries override, read via ctx.options from Task 1's amendment).
import {describe, expect, test} from 'bun:test';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import {IoError} from '../io/errors.js';
import {Cursor} from '../pipeline/cursor.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {RETRY_STEP_TYPE, retryStep} from './retry-step.js';

const GET = Request.newBuilder().url('https://example.com').build();

// Constructed inline rather than imported: 4c keeps `aRequestContext()` file-local to
// `cursor.test.ts`, and importing across `*.test.ts` files is not acceptable.
function aRequestContext(): ExecutionContext {
  return createRequestContext(GET);
}

function runThrough(
  descriptor: StepDescriptor,
  transport: FakeTransport,
  signal?: AbortSignal,
): Promise<Response> {
  return new Cursor({
    steps: [descriptor],
    transport,
    request: GET,
    context: aRequestContext(),
    signal,
  }).advance();
}

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this
 * runner's type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper
 * keeps the assertion honest without a lint suppression.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('retryStep', () => {
  test('is pinned to the RETRY pillar stage (PIPE-36)', () => {
    const descriptor = retryStep();
    expect(descriptor.stage).toBe('RETRY');
    expect(descriptor.type).toBe(RETRY_STEP_TYPE);
  });

  test('re-drives the chain on a retryable status and returns the eventual success (RETRY-44)', async () => {
    const succeeded = countingResponse(200).response;
    const transport = new FakeTransport([
      countingResponse(503).response,
      succeeded,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(2);
    expect(response).toBe(succeeded);
  });

  test('each attempt gets a fresh continuation, so no cursor is reused (RETRY-44)', async () => {
    const transport = new FakeTransport([
      new IoError('reset'),
      new IoError('reset'),
      countingResponse(200).response,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});

    await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(3);
  });

  test('rethrows the terminal failure rather than returning a failed outcome', async () => {
    const boom = new IoError('reset');
    const transport = new FakeTransport([boom]);
    const descriptor = retryStep({settings: {maxAttempts: 2, fixedDelayMs: 0}});

    expect(await rejectionOf(runThrough(descriptor, transport))).toBeDefined();
  });

  test('honors the call signal from StepContext (RETRY-32)', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new FakeTransport([countingResponse(200).response]);
    const descriptor = retryStep();

    expect(
      await rejectionOf(runThrough(descriptor, transport, controller.signal)),
    ).toBeDefined();
    expect(transport.sendCount).toBe(0);
  });
});

describe('retryStep per-call budget override (RETRY-41, HTTP-35)', () => {
  test('per-call maxRetries: 0 disables retries for this call only (RETRY-41, HTTP-35)', async () => {
    const the503 = countingResponse(503);
    const transport = new FakeTransport([
      the503.response,
      countingResponse(200).response,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});
    const options = RequestOptions.newBuilder().maxRetries(0).build();

    const response = await new Cursor({
      steps: [descriptor],
      transport,
      request: GET,
      context: aRequestContext(),
      options,
    }).advance();

    // The configured budget of 3 was overridden per call.
    expect(transport.sendCount).toBe(1);
    expect(response.status.code).toBe(503);
    // A surviving response is returned LIVE and unread (RETRY-36's discarding-only remap).
    expect(the503.cancelCount()).toBe(0);
  });

  test('a non-finite per-call maxRetries cannot reach the step at all', () => {
    // First line of defence, and the one a caller actually meets: HTTP-35 rejects at the setter.
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN, 1.5]) {
      expect(() => RequestOptions.newBuilder().maxRetries(value)).toThrow();
    }
  });

  test('the step re-checks it anyway, so a builder regression cannot make the loop unbounded', async () => {
    // Backstop, exercised through a hand-shaped options object the public builder would refuse to
    // produce. Worth asserting rather than trusting: the value lands directly in `maxAttempts`, and
    // a non-finite budget does not fail loudly -- it makes `attempt >= maxAttempts` permanently
    // false and the retry loop endless.
    const transport = new FakeTransport([new IoError('reset')]);
    const descriptor = retryStep({settings: {fixedDelayMs: 0}});
    const forged = {
      maxRetries: Number.POSITIVE_INFINITY,
    } as unknown as RequestOptions;

    const reason = await rejectionOf(
      new Cursor({
        steps: [descriptor],
        transport,
        request: GET,
        context: aRequestContext(),
        options: forged,
      }).advance(),
    );

    expect((reason as Error).message).toContain(
      'maxRetries must be a non-negative integer',
    );
    expect(transport.sendCount).toBe(0);
  });
});

describe('retryStep per-call budget widening (RETRY-41)', () => {
  test('per-call maxRetries widens the configured budget too (RETRY-41 is present-override-wins)', async () => {
    const transport = new FakeTransport([
      countingResponse(503).response,
      countingResponse(503).response,
      countingResponse(200).response,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 1, fixedDelayMs: 0}});
    const options = RequestOptions.newBuilder().maxRetries(2).build();

    await new Cursor({
      steps: [descriptor],
      transport,
      request: GET,
      context: aRequestContext(),
      options,
    }).advance();

    // 2 retries + the initial send.
    expect(transport.sendCount).toBe(3);
  });
});
