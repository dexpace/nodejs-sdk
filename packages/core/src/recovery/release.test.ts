// SPDX-License-Identifier: MIT
// packages/core/src/recovery/release.test.ts
// Exercises: RECOV-12 (a teardown failure rides along as `suppressed` and never becomes primary),
// RETRY-22 and REDIR-22's shared consequence — the error that must propagate is the upstream/decision
// failure, not the release that ran on its way out. Extracted from `retry/engine.ts` in Phase 5b so the
// redirect step consumes it rather than shipping a second copy.
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {releaseQuietly, withReleaseFailure} from './release.js';

const REQUEST = Request.newBuilder().url('https://example.com').build();

/** `cancel` decides the release outcome: `undefined` releases cleanly, an `Error` is rethrown by close. */
function responseWith(cancelFailure?: Error): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      if (cancelFailure !== undefined) throw cancelFailure;
    },
  });
  return Response.newBuilder()
    .request(REQUEST)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .headers(Headers.newBuilder().build())
    .body(body)
    .build();
}

describe('releaseQuietly', () => {
  test('reports a clean release with a token withReleaseFailure treats as "nothing happened"', async () => {
    const primary = new Error('upstream');
    const token = await releaseQuietly(responseWith());
    expect(withReleaseFailure(primary, token)).toBe(primary);
  });

  test('an absent response releases cleanly', async () => {
    const primary = new Error('upstream');
    const token = await releaseQuietly(undefined);
    expect(withReleaseFailure(primary, token)).toBe(primary);
  });

  test('reports rather than raises whatever close() threw', async () => {
    const boom = new Error('cancel exploded');
    expect(await releaseQuietly(responseWith(boom))).toBe(boom);
  });

  test('a locked-stream TypeError is swallowed by close() itself, so the release reads clean', async () => {
    const response = responseWith();
    const body = response.body;
    expect(body).not.toBeNull();
    body?.getReader(); // hold the lock: cancel() now rejects with TypeError
    const primary = new Error('upstream');
    expect(withReleaseFailure(primary, await releaseQuietly(response))).toBe(
      primary,
    );
  });
});

describe('withReleaseFailure', () => {
  test('keeps the primary primary and carries the release failure as suppressed (RECOV-12)', async () => {
    const primary = new Error('upstream');
    const boom = new Error('cancel exploded');

    const result = withReleaseFailure(
      primary,
      await releaseQuietly(responseWith(boom)),
    );

    expect(result).not.toBe(primary);
    const suppressed = result as SuppressedErrorLike;
    expect(suppressed.name).toBe('SuppressedError');
    expect(suppressed.error).toBe(primary);
    expect(suppressed.suppressed).toBe(boom);
  });

  test('an identical instance is never suppressed under itself', () => {
    // `Response.close()` memoizes its release promise, so a close that already failed hands the SAME
    // rejection back to a second caller. Without the identity guard that instance wraps itself.
    const shared = new Error('same instance twice');
    expect(withReleaseFailure(shared, shared)).toBe(shared);
  });

  test('a non-Error primary survives unchanged', async () => {
    const boom = new Error('cancel exploded');
    const result = withReleaseFailure(
      'a bare string throw',
      await releaseQuietly(responseWith(boom)),
    );
    expect((result as SuppressedErrorLike).error).toBe('a bare string throw');
  });
});
