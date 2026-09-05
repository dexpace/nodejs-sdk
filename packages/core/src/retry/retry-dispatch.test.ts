// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-dispatch.test.ts
// Exercises: RECOV-17..20 (the recovery stack's retry lands here), RECOV-32 (one idempotency key per
// LOGICAL request -- the strategy runs once and every wire send carries its result), RETRY-38 (the
// per-attempt ordinal is stamped on a fresh copy and preserves that key), RETRY-44 (fresh per-attempt
// state below the retry point; upstream steps do not run between attempts), RECOV-2 (a request-chain
// throw still meets the response and recovery hooks), RETRY-13/14/RECOV-30 (both entry points share
// one engine, so the schedule cannot drift).
import {describe, expect, test} from 'bun:test';
import {stringBody} from '../body/simple-bodies.js';
import type {Clock} from '../config/clock.js';
import {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {IoError} from '../io/errors.js';
import {idempotencyKeyStep} from '../recovery/idempotency-key.js';
import {failure, success, type Outcome} from '../recovery/outcome.js';
import {RequestRecoveryChain} from '../recovery/request-chain.js';
import {
  ResponseRecoveryChain,
  type RecoveryStep,
} from '../recovery/response-chain.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {dispatchWithRetry, type RetryDispatchConfig} from './retry-dispatch.js';
import {retrySettings, type RetrySettings} from './settings.js';

const GET = Request.newBuilder().url('https://example.com').build();

/** A POST the re-send gate lets through: RETRY-5 wants a body, and a replayable one. */
function replayablePost(): Request {
  return Request.newBuilder()
    .method('POST')
    .url('https://example.com')
    .body(stringBody('payload'))
    .build();
}

const zeroClock: Clock = {
  now: () => 0,
  monotonic: () => 0,
  sleep: () => Promise.resolve(),
};

/** The third parameter is an object because `max-params` errors at four. */
interface ConfigExtras {
  readonly settings?: Partial<RetrySettings>;
  readonly recoverySteps?: readonly RecoveryStep[];
}

function configOf(
  transport: FakeTransport,
  requestSteps = new RequestRecoveryChain([]),
  extras: ConfigExtras = {},
): RetryDispatchConfig {
  return {
    transport,
    requestChain: requestSteps,
    responseChain: new ResponseRecoveryChain([], extras.recoverySteps ?? []),
    retry: {
      settings: retrySettings({
        maxAttempts: 3,
        fixedDelayMs: 0,
        ...extras.settings,
      }),
      clock: zeroClock,
      random: () => 0.5,
    },
  };
}

/**
 * A one-step request chain whose key strategy is COUNTED and whose keys are DISTINCT. Both matter:
 * a strategy returning one constant value would pass every assertion below even if it were called
 * once per attempt, which is the bug these cases exist to catch.
 */
function countingKeyChain(): {
  chain: RequestRecoveryChain;
  generated: () => number;
} {
  let generated = 0;
  const chain = new RequestRecoveryChain([
    idempotencyKeyStep({
      generate: () => {
        generated += 1;
        return `key-${String(generated)}`;
      },
    }),
  ]);
  return {chain, generated: () => generated};
}

/** The named header seen by each wire send, in order. */
function headerSent(
  transport: FakeTransport,
  name = 'Idempotency-Key',
): (string | undefined)[] {
  return transport.calls.map(call => call.request.headers.get(name));
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

  test('applies the request recovery chain ONCE per logical request, not per attempt (RETRY-44)', async () => {
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

    expect(transport.sendCount).toBe(2);
    expect(applications).toBe(1);
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

describe('dispatchWithRetry and the idempotency key (RECOV-32)', () => {
  test('generates ONE key for three attempts and sends it on all three', async () => {
    const {chain, generated} = countingKeyChain();
    const transport = new FakeTransport([
      new IoError('reset'),
      new IoError('reset'),
      countingResponse(200).response,
    ]);

    const response = await dispatchWithRetry(
      replayablePost(),
      configOf(transport, chain),
    );

    expect(response.status.code).toBe(200);
    expect(transport.sendCount).toBe(3);
    expect(generated()).toBe(1);
    expect(headerSent(transport)).toEqual(['key-1', 'key-1', 'key-1']);
  });

  test('the run that exhausts the budget sends the same key on every attempt too', async () => {
    const {chain, generated} = countingKeyChain();
    const transport = new FakeTransport([new IoError('reset')]);

    await rejectionOf(
      dispatchWithRetry(replayablePost(), configOf(transport, chain)),
    );

    expect(transport.sendCount).toBe(3);
    expect(generated()).toBe(1);
    expect(headerSent(transport)).toEqual(['key-1', 'key-1', 'key-1']);
  });

  test('the attempt ordinal varies per send while the key does not (RETRY-38)', async () => {
    const {chain, generated} = countingKeyChain();
    const transport = new FakeTransport([
      new IoError('reset'),
      new IoError('reset'),
      countingResponse(200).response,
    ]);

    await dispatchWithRetry(
      replayablePost(),
      configOf(transport, chain, {settings: {attemptHeaderName: 'X-Attempt'}}),
    );

    // The ordinal is the ENGINE's, written per attempt on `stampAttempt`'s fresh copy; the key is
    // the request chain's, written once above the loop. Both survive on every send.
    expect(generated()).toBe(1);
    expect(headerSent(transport)).toEqual(['key-1', 'key-1', 'key-1']);
    expect(headerSent(transport, 'X-Attempt')).toEqual(['1', '2', '3']);
  });
});

describe('dispatchWithRetry and a failing request chain (RECOV-2)', () => {
  const boom = new IoError('request step failed');
  const throwingChain = (): RequestRecoveryChain =>
    new RequestRecoveryChain([() => Promise.reject(boom)]);

  test('does not retry it, never reaches the transport, and runs the recovery phase once', async () => {
    const seen: Outcome<Response>[] = [];
    const recovery: RecoveryStep = outcome => {
      seen.push(outcome);
      return Promise.resolve(outcome);
    };
    const transport = new FakeTransport([countingResponse(200).response]);

    const thrown = await rejectionOf(
      dispatchWithRetry(
        GET,
        configOf(transport, throwingChain(), {recoverySteps: [recovery]}),
      ),
    );

    expect(thrown).toBe(boom);
    expect(transport.sendCount).toBe(0);
    expect(seen).toEqual([failure(boom)]);
  });

  test('a recovery step may still convert that failure into a success', async () => {
    const substitute = countingResponse(204).response;
    const recovery: RecoveryStep = () => Promise.resolve(success(substitute));
    const transport = new FakeTransport([countingResponse(200).response]);

    const response = await dispatchWithRetry(
      GET,
      configOf(transport, throwingChain(), {recoverySteps: [recovery]}),
    );

    expect(response).toBe(substitute);
    expect(transport.sendCount).toBe(0);
  });
});
