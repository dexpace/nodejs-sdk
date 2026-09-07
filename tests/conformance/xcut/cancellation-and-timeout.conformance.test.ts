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
import {
  CancellationError,
  HttpStatusError,
  Request,
  retryAttempts,
} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';
import {rejectionOf} from './fixtures/settle.js';

let server: XcutFixtureServer;

/**
 * Walks everything a surfaced failure can nest a prior error under, visiting by identity so a cyclic
 * chain terminates -- the same discipline `XCUT-9` puts on the classifier.
 *
 * Kept after #72 made the top-level assertion possible, because the two answer different questions.
 * `CancellationError` carries the raw `AbortSignal.reason` as its `cause`, so the walk is what
 * proves the ambient abort was not swallowed on the way out, and it is also what catches a
 * `TimeoutError` hiding one hop down where `XCUT-3` forbids one. What it must no longer be is the
 * ONLY assertion: 5a's engine folded the retry trail into a `SuppressedError` (`RETRY-34`), the
 * cancellation arrived as `.error` beneath that wrapper, and a chain walk was the only way to find
 * it -- which is precisely the defect, since a caller writing `catch (e) { e instanceof
 * CancellationError }` has no walk. Every row below asserts the top level too.
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

    // XCUT-1's conformance clause, at the top level and unqualified: "assert the surfaced error is
    // the cancellation type". Two separate defects had to be fixed for this line to hold. Until
    // 2026-09-02 the engine surfaced `signal.reason` verbatim, so a cancelled backoff arrived as a
    // bare DOMException `AbortError` while the transport mapped the identical abort to
    // `CancellationError` -- one requirement, two types, depending on which layer noticed. Until
    // 2026-09-05 the mapping was then undone one line later by the retry trail's `SuppressedError`
    // wrapper, and a cancelled backoff ALWAYS has a non-empty trail, so this row was false for
    // every reachable case.
    expect(surfaced).toBeInstanceOf(CancellationError);
    // The chain still has to carry the raw abort (the ambient flag survived the mapping) and must
    // not carry a timeout, which is XCUT-3's own letter.
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

describe('RETRY-34: the trail survives the unwrapped cancellation', () => {
  test('the attempt the cancelled wait was scheduled for stays reachable', async () => {
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

    // Surfacing the cancellation unwrapped is not allowed to LOSE the 500 that provoked the retry
    // in the first place -- that was the one thing the `SuppressedError` wrapper did buy. It rides
    // in the trail instead, and the retired response is a buffered `HttpStatusError` (RECOV-16).
    const priors = retryAttempts(surfaced);
    expect(priors).toHaveLength(1);
    expect(priors[0]).toBeInstanceOf(HttpStatusError);
    expect((priors[0] as HttpStatusError).status).toBe(500);

    await pipeline.close();
  });
});
