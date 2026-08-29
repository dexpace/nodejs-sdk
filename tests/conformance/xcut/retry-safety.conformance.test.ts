// SPDX-License-Identifier: MIT
// tests/conformance/xcut/retry-safety.conformance.test.ts
// Exercises: XCUT-10 (retry-SAFETY is decided at the retry step independently of retryability, and
// applies uniformly to protocol AND transport failures -- the gate must not special-case a transport
// error that never reached the server).
//
// The five rows are the ones XCUT-10's own conformance clause names, run for the first time against
// the composed pipeline rather than 5a's unit-level harness. Each asserts on dispatches that actually
// reached the terminal transport, which is the only vantage point where "was it re-sent?" is visible.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {Request, streamBody, stringBody} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

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
