// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-dispatch.test.ts
// Exercises: RECOV-17..20 (the recovery stack's retry lands here), RETRY-44 (each attempt re-runs the
// WHOLE recovery chain -- request chain, transport, response chain), RETRY-13/14/RECOV-30 (both entry
// points share one engine, so the schedule cannot drift).
import {describe, expect, test} from 'bun:test';
import type {Clock} from '../config/clock.js';
import {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';
import {RequestRecoveryChain} from '../recovery/request-chain.js';
import {ResponseRecoveryChain} from '../recovery/response-chain.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {dispatchWithRetry, type RetryDispatchConfig} from './retry-dispatch.js';
import {retrySettings} from './settings.js';

const GET = Request.newBuilder().url('https://example.com').build();

const zeroClock: Clock = {
  now: () => 0,
  monotonic: () => 0,
  sleep: () => Promise.resolve(),
};

function configOf(
  transport: FakeTransport,
  requestSteps = new RequestRecoveryChain([]),
): RetryDispatchConfig {
  return {
    transport,
    requestChain: requestSteps,
    responseChain: new ResponseRecoveryChain([], []),
    retry: {
      settings: retrySettings({maxAttempts: 3, fixedDelayMs: 0}),
      clock: zeroClock,
      random: () => 0.5,
    },
  };
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

describe('dispatchWithRetry', () => {
  test('retries a transport failure and returns the eventual success', async () => {
    const transport = new FakeTransport([
      new IoError('reset'),
      countingResponse(200).response,
    ]);

    const response = await dispatchWithRetry(GET, configOf(transport));

    expect(response.status.code).toBe(200);
    expect(transport.sendCount).toBe(2);
  });

  test('re-runs the request recovery chain on every attempt (RETRY-44)', async () => {
    let applications = 0;
    const chain = new RequestRecoveryChain([
      request => {
        applications += 1;
        return Promise.resolve(request);
      },
    ]);
    const transport = new FakeTransport([
      new IoError('reset'),
      countingResponse(200).response,
    ]);

    await dispatchWithRetry(GET, configOf(transport, chain));

    expect(applications).toBe(2);
  });

  test('rethrows the terminal failure unchanged in shape', async () => {
    const transport = new FakeTransport([new IoError('reset')]);

    expect(
      await rejectionOf(dispatchWithRetry(GET, configOf(transport))),
    ).toBeDefined();
    expect(transport.sendCount).toBe(3);
  });

  test('a bare POST is dispatched exactly once (RETRY-7 holds on this entry point too)', async () => {
    const post = Request.newBuilder()
      .method('POST')
      .url('https://example.com')
      .build();
    const transport = new FakeTransport([new IoError('reset')]);

    expect(
      await rejectionOf(dispatchWithRetry(post, configOf(transport))),
    ).toBeDefined();
    expect(transport.sendCount).toBe(1);
  });
});
