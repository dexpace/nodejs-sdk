// SPDX-License-Identifier: MIT
// tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts
// Exercises: XCUT-1 (cancellation is terminal, non-retryable, and the ambient cancel flag survives),
// XCUT-3 (an inter-attempt retry wait is promptly cancellable and surfaces the cancellation signal,
// not a spurious timeout).
// XCUT-2 stays a retrofit citation at its Phase 2 source (packages/core/src/seams/transport.test.ts),
// where isTimeoutSignal's two branches are asserted directly.
//
// These run the invariants through the fully composed retry+redirect+auth+logging pipeline over a
// real socket, which is what this suite adds over 5a's and Phase 2's own unit-level coverage.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {CancellationError, Request} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';
import {rejectionOf} from './fixtures/settle.js';

let server: XcutFixtureServer;

/**
 * Walks everything a surfaced failure can nest a prior error under, visiting by identity so a cyclic
 * chain terminates -- the same discipline `XCUT-9` puts on the classifier.
 *
 * The walk is necessary because 5a's engine folds the retry trail into a `SuppressedError`
 * (`RETRY-34`), so the cancellation that ended a backoff wait arrives as `.error` beneath a wrapper
 * rather than as the top-level throwable. Asserting on the top level alone would test the wrapping,
 * not the invariant.
 */
function* chainOf(error: unknown): Generator {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined || seen.has(current))
      continue;
    seen.add(current);
    yield current;
    if (typeof current !== 'object') continue;
    const node = current as Record<string, unknown>;
    queue.push(node.cause, node.error, node.suppressed);
  }
}

/** True when anything in the chain is a caller cancellation, by type or by `AbortSignal` reason name. */
function carriesCancellation(error: unknown): boolean {
  for (const link of chainOf(error)) {
    if (link instanceof CancellationError) return true;
    if ((link as {name?: unknown} | null)?.name === 'AbortError') return true;
  }
  return false;
}

/** True when the chain carries the SDK's own terminal cancellation type, not merely an abort. */
function carriesSdkCancellationError(error: unknown): boolean {
  for (const link of chainOf(error)) {
    if (link instanceof CancellationError) return true;
  }
  return false;
}

/** True when anything in the chain is a timeout -- the classification `XCUT-3` forbids here. */
function carriesTimeout(error: unknown): boolean {
  for (const link of chainOf(error)) {
    if ((link as {name?: unknown} | null)?.name === 'TimeoutError') return true;
  }
  return false;
}

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

describe('XCUT-1: cancellation is terminal and never retried', () => {
  test('surfaces CancellationError when an in-flight request is aborted', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 3, initialDelayMs: 1}},
    });
    const controller = new AbortController();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/slow?ms=2000`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 25).unref();

    expect(await rejectionOf(pending)).toBeInstanceOf(CancellationError);

    await pipeline.close();
  });

  test('does not re-dispatch a cancelled request when retries remain', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 3, initialDelayMs: 1}},
    });
    const controller = new AbortController();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/slow?ms=2000`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 25).unref();
    await pending.catch(() => undefined);

    // The retry pillar had two attempts left and must not have spent them: XCUT-1 makes
    // cancellation terminal at the condition level, distinct from the safety gate.
    expect(pipeline.dispatches()).toBe(1);

    await pipeline.close();
  });

  test('leaves the ambient cancellation flag set after the error surfaces', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 1}},
    });
    const controller = new AbortController();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/slow?ms=2000`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 25).unref();
    await pending.catch(() => undefined);

    // The JVM reference re-asserts the interrupt flag; the port's equivalent is that the signal it
    // was handed is still aborted, never reset on the way out (deviation ledger item 11).
    expect(controller.signal.aborted).toBe(true);

    await pipeline.close();
  });
});

describe('XCUT-3: an inter-attempt wait is promptly cancellable', () => {
  test('aborts a 60s backoff near-immediately instead of waiting it out', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 5, initialDelayMs: 60_000}},
    });
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 50).unref();
    await pending.catch(() => undefined);

    // Nowhere near the 60s backoff: the wait aborted rather than expiring.
    expect(Date.now() - startedAt).toBeLessThan(5_000);

    await pipeline.close();
  });

  test('surfaces a cancellation, not a spurious timeout, from inside the wait', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 5, initialDelayMs: 60_000}},
    });
    const controller = new AbortController();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 50).unref();
    const surfaced = await rejectionOf(pending);

    // Asserted on the chain rather than the top-level type, because the top level is a
    // `SuppressedError` pairing the cancellation with the prior attempt's failure. What the chain
    // must carry is the SDK's OWN type: until 2026-09-02 the retry engine surfaced `signal.reason`
    // verbatim, so a cancelled backoff arrived as a bare DOMException `AbortError` while the
    // transport path mapped the identical abort to `CancellationError` -- one requirement, two
    // types, depending on which layer noticed. Both layers now map through the same shape
    // (docs/open-items.md N1), so this asserts the type as well as XCUT-3's letter.
    expect(carriesCancellation(surfaced)).toBe(true);
    expect(carriesSdkCancellationError(surfaced)).toBe(true);
    expect(carriesTimeout(surfaced)).toBe(false);

    await pipeline.close();
  });

  test('does not dispatch a further attempt once the wait is cancelled', async () => {
    const pipeline = buildComposedPipeline({
      retry: {settings: {maxAttempts: 5, initialDelayMs: 60_000}},
    });
    const controller = new AbortController();
    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/fail-500`).build(),
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 50).unref();
    await pending.catch(() => undefined);

    // One dispatch produced the 500; the cancelled wait must not produce a second.
    expect(pipeline.dispatches()).toBe(1);

    await pipeline.close();
  });
});
