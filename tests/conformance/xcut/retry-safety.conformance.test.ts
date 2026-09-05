// SPDX-License-Identifier: MIT
// tests/conformance/xcut/retry-safety.conformance.test.ts
// Exercises: XCUT-10 (retry-SAFETY is decided at the retry step independently of retryability, and
// applies uniformly to protocol AND transport failures -- the gate must not special-case a transport
// error that never reached the server), XCUT-1 (the class of the surfaced error does not depend on
// how many attempts the pillar spent), RETRY-34 (the earlier attempts stay reachable beside it).
//
// The five XCUT-10 rows are the ones its own conformance clause names, run for the first time against
// the composed pipeline rather than 5a's unit-level harness. Each asserts on dispatches that actually
// reached the terminal transport, which is the only vantage point where "was it re-sent?" is visible.
// The two XCUT-1/RETRY-34 rows below need the same vantage point for the opposite reason: the budget
// they vary is only observable as a dispatch count.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  Request,
  retryAttempts,
  streamBody,
  stringBody,
  TransportFailureError,
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

/** Three attempts with a negligible backoff, so a retried row is unmistakable from a non-retried one. */
function retrying(): {settings: {maxAttempts: number; initialDelayMs: number}} {
  return {settings: {maxAttempts: 3, initialDelayMs: 1}};
}

/**
 * A GET at a closed port. Retry-SAFE (idempotent, body-less) and retryABLE (the transports map a
 * refused connection to `TransportFailureError`, an `IoError`), so the pillar spends its whole
 * budget and every attempt fails the same way -- which is what makes the surfaced CLASS the only
 * variable between the two budgets below.
 */
function unreachable(): Request {
  return Request.newBuilder().url('http://127.0.0.1:1/').method('GET').build();
}

describe('XCUT-10: retry-safety on a body-less request follows method idempotence', () => {
  test('retries a body-less GET against a retryable protocol failure', async () => {
    const pipeline = buildComposedPipeline({retry: retrying()});

    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).method('GET').build(),
    );

    expect(pipeline.dispatches()).toBe(3);
    await response.close();
    await pipeline.close();
  });

  test('does not retry a body-less POST failing with a protocol error', async () => {
    const pipeline = buildComposedPipeline({retry: retrying()});

    const response = await pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).method('POST').build(),
    );

    // The 500 is retryABLE; the bare POST is not retry-SAFE. Two orthogonal axes, and safety wins.
    expect(pipeline.dispatches()).toBe(1);
    await response.close();
    await pipeline.close();
  });

  test('still does not retry a body-less POST failing with a transport error', async () => {
    const pipeline = buildComposedPipeline({retry: retrying()});

    const pending = pipeline.runtime.send(
      Request.newBuilder().url('http://127.0.0.1:1/').method('POST').build(),
    );
    await pending.catch(() => undefined);

    // The row XCUT-10 calls out explicitly: the request demonstrably never reached the server, and
    // the gate MUST still refuse. A safety gate that special-cased transport errors would read 3.
    expect(pipeline.dispatches()).toBe(1);
    await pipeline.close();
  });
});

describe('XCUT-10: retry-safety on a body-bearing request follows body replayability', () => {
  test('retries a POST whose body is replayable', async () => {
    const pipeline = buildComposedPipeline({retry: retrying()});

    const response = await pipeline.runtime.send(
      Request.newBuilder()
        .url(`${server.url}/fail-500`)
        .method('POST')
        .body(stringBody('payload'))
        .build(),
    );

    // A replayable body makes a non-idempotent method safe to re-send: the body clause governs
    // once a body is present, rather than being AND-ed with method idempotence.
    expect(pipeline.dispatches()).toBe(3);
    await response.close();
    await pipeline.close();
  });

  test('does not retry a POST whose body is a single-use stream', async () => {
    const {readable} = new TransformStream<Uint8Array, Uint8Array>();
    const pipeline = buildComposedPipeline({retry: retrying()});

    const pending = pipeline.runtime.send(
      Request.newBuilder()
        .url(`${server.url}/fail-500`)
        .method('POST')
        .body(streamBody(readable))
        .build(),
    );
    await pending.catch(() => undefined).then(r => r?.close());

    expect(pipeline.dispatches()).toBe(1);
    await pipeline.close();
  });
});

describe('XCUT-1/RETRY-34: what a retrying pipeline surfaces when it gives up', () => {
  test('the same failure surfaces as TransportFailureError for maxAttempts 1 and for 3', async () => {
    const once = buildComposedPipeline({
      retry: {settings: {maxAttempts: 1}},
    });
    const thrice = buildComposedPipeline({retry: retrying()});

    const afterOne = await rejectionOf(once.runtime.send(unreachable()));
    const afterThree = await rejectionOf(thrice.runtime.send(unreachable()));

    expect(once.dispatches()).toBe(1);
    expect(thrice.dispatches()).toBe(3);
    // The row #72 exists for. Until 2026-09-05 the three-attempt case surfaced a `SuppressedError`
    // holding the transport failure at `.error`, so one condition had two surfaced classes and the
    // discriminator was the attempt budget -- something no caller writing `catch` can see.
    expect(afterOne).toBeInstanceOf(TransportFailureError);
    expect(afterThree).toBeInstanceOf(TransportFailureError);

    await once.close();
    await thrice.close();
  });

  test('the earlier attempts are reachable beside it, oldest first, self excluded', async () => {
    const pipeline = buildComposedPipeline({retry: retrying()});

    const surfaced = await rejectionOf(pipeline.runtime.send(unreachable()));

    // RETRY-34 through the composed pipeline: three sends, so two priors, and the surfaced instance
    // is not a member of its own trail.
    const priors = retryAttempts(surfaced);
    expect(pipeline.dispatches()).toBe(3);
    expect(priors).toHaveLength(2);
    expect(priors.every(prior => prior instanceof TransportFailureError)).toBe(
      true,
    );
    expect(priors).not.toContain(surfaced);

    await pipeline.close();
  });
});
