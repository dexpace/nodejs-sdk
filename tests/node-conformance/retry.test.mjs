// SPDX-License-Identifier: MIT
// tests/node-conformance/retry.test.mjs
//
// Phase 5a is a runtime-divergent surface at three specific points, and each one fails silently rather
// than loudly if the runtimes disagree:
//
//   1. `classify.ts` draws RETRY-23-vs-RETRY-24 (caller abort never retryable, read timeout still
//      retryable) off the abort reason's `name`. That reason is a `DOMException` produced by
//      `AbortSignal.timeout()`, whose class and `name` are the runtime's, not this package's -- if
//      Node named it anything but `TimeoutError`, every timed-out request would silently stop being
//      retried and `bun test` would still be green.
//   2. RETRY-34's trail used to go through `suppress()`, which picks the native `SuppressedError` or
//      the shape-compatible fallback depending on the runtime -- Bun has the global, the declared
//      floor (`engines.node >=20.3`) does not, and this suite's matrix runs both legs. #72 took that
//      branch off the retry path entirely: the final attempt's own error is surfaced and the trail
//      rides in a side table. So the assertion moved with it, from "the wrapper has the same shape on
//      either runtime" to "neither runtime produces a wrapper", which is the stronger claim and the
//      one a reintroduced `suppress()` would break differently on Node 20 than on Node 24.
//   3. RETRY-35/RECOV-16's "release the discarded response" rides on Web Streams: a retired response is
//      drained to EOF by `toHttpError()`, an abandoned one is cancelled by `Response.close()`. Node's
//      `cancel()`/`pull()` timing is an independent implementation of Bun's.
//   4. The inter-attempt wait itself is `defaultClock.sleep` (CFG-17), the one place the retry path
//      touches a real `setTimeout` and a real `AbortSignal` listener. The unit suite injects a fake
//      clock -- deliberately, so it stays deterministic -- which means the real timer/abort race is
//      covered HERE and nowhere else.
//
// The engine itself is `@internal` with no public subpath in `exports`, so it is reached by direct
// `dist/` file path, per this suite's import rule.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  CancellationError,
  Protocol,
  Request,
  Response,
  retryAttempts,
  Status,
} from '@dexpace/core';
import {
  isRetryableFailure,
  RETRYABLE_STATUSES,
} from '../../packages/core/dist/retry/classify.js';
import {runWithRetry} from '../../packages/core/dist/retry/engine.js';
import {retrySettings} from '../../packages/core/dist/retry/settings.js';
import {failure, success} from '../../packages/core/dist/recovery/outcome.js';
import {defaultClock} from '../../packages/core/dist/config/clock.js';

const GET = Request.newBuilder().url('https://example.com').build();

const zeroClock = {
  now: () => 0,
  monotonic: () => 0,
  sleep: () => Promise.resolve(),
};

function configOf(overrides) {
  return {
    settings: retrySettings(overrides),
    clock: zeroClock,
    random: () => 0.5,
  };
}

/** Mirrors `testing/fake-transport.ts`'s helper: release is observable only through the body stream. */
function countingResponse(status) {
  let releases = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    pull(controller) {
      releases += 1;
      controller.close();
    },
    cancel() {
      releases += 1;
    },
  });
  const response = Response.newBuilder()
    .request(GET)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .body(body)
    .build();
  return {response, cancelCount: () => releases};
}

function scriptedDispatch(script) {
  const calls = [];
  const dispatch = request => {
    calls.push(request);
    return Promise.resolve(
      script[Math.min(calls.length - 1, script.length - 1)],
    );
  };
  dispatch.calls = calls;
  return dispatch;
}

describe('retry classification on the declared Node floor', () => {
  it("names AbortSignal.timeout()'s reason TimeoutError, which RETRY-24 keys off", async () => {
    const signal = AbortSignal.timeout(1);
    // A ref'd deadline holds the loop open and fails the case if the abort never arrives -- awaiting
    // the unref'd timer alone is what this suite's README warns against.
    const aborted = await new Promise(resolve => {
      const deadline = setTimeout(() => {
        resolve(false);
      }, 1000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(deadline);
          resolve(true);
        },
        {once: true},
      );
    });

    assert.equal(aborted, true);
    assert.equal(signal.reason.name, 'TimeoutError');
    assert.equal(isRetryableFailure(signal.reason, RETRYABLE_STATUSES), true);
  });

  it('treats a caller abort as never retryable (RETRY-23)', () => {
    const controller = new AbortController();
    controller.abort();

    assert.equal(controller.signal.reason.name, 'AbortError');
    assert.equal(
      isRetryableFailure(controller.signal.reason, RETRYABLE_STATUSES),
      false,
    );
  });
});

describe('the retry engine on the declared Node floor', () => {
  it('surfaces the final attempt error itself, on a runtime that may lack SuppressedError', async () => {
    // Timeout aborts, because they are the retryable throwable this suite can build without reaching
    // into another `dist/` module -- two of them exhaust the budget and produce a one-entry trail.
    const first = new DOMException('timed out', 'TimeoutError');
    const last = new DOMException('timed out again', 'TimeoutError');
    const dispatch = scriptedDispatch([failure(first), failure(last)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 2, fixedDelayMs: 0}),
    );

    assert.equal(dispatch.calls.length, 2);
    assert.equal(outcome.kind, 'failure');
    assert.equal(outcome.error, last);
    assert.notEqual(outcome.error.name, 'SuppressedError');
    // RETRY-34's trail, read through the accessor as a CONSUMER reaches it -- the `@dexpace/core`
    // specifier and the built `dist/`, not the engine's own module path.
    const priors = retryAttempts(outcome.error);
    assert.equal(priors.length, 1);
    assert.equal(priors[0], first);
  });

  it('releases a discarded response through the drain route, over Node Web Streams (RETRY-35)', async () => {
    const discarded = countingResponse(503);
    const kept = countingResponse(200);
    const dispatch = scriptedDispatch([
      success(discarded.response),
      success(kept.response),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 0}),
    );

    assert.equal(outcome.kind, 'success');
    assert.equal(discarded.cancelCount(), 1);
    assert.equal(kept.cancelCount(), 0);
  });

  it('returns a response that survives the gates live and unread (RETRY-36)', async () => {
    const only = countingResponse(503);
    const dispatch = scriptedDispatch([success(only.response)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 1}),
    );

    assert.equal(outcome.kind, 'success');
    assert.equal(only.cancelCount(), 0);
  });

  it('waits on a REAL timer between attempts and resumes the loop (RETRY-26/31)', async () => {
    const dispatch = scriptedDispatch([
      failure(new DOMException('timed out', 'TimeoutError')),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(GET, dispatch, {
      settings: retrySettings({fixedDelayMs: 1, maxAttempts: 2}),
      clock: defaultClock,
      random: () => 0.5,
    });

    assert.equal(outcome.kind, 'success');
    assert.equal(dispatch.calls.length, 2);
  });

  it('cuts a REAL pending wait short when the caller aborts (RETRY-26/32)', async () => {
    const controller = new AbortController();
    const dispatch = () => {
      // Aborts from a macrotask, so the loop is already inside `defaultClock.sleep`'s timer when it
      // fires -- the abort LISTENER settles the race, not the already-aborted short-circuit.
      setTimeout(() => {
        controller.abort();
      }, 1);
      return Promise.resolve(
        failure(new DOMException('timed out', 'TimeoutError')),
      );
    };
    const startedAt = defaultClock.monotonic();

    const outcome = await runWithRetry(GET, dispatch, {
      settings: retrySettings({fixedDelayMs: 60_000, maxAttempts: 5}),
      clock: defaultClock,
      random: () => 0.5,
      signal: controller.signal,
    });

    assert.equal(outcome.kind, 'failure');
    // The point of the case: it returned instead of sleeping out the full 60s backoff.
    assert.ok(defaultClock.monotonic() - startedAt < 5_000);
    // XCUT-1 over a REAL AbortSignal and a REAL timer, which is the half the unit suite's injected
    // clock cannot reach. The trail is non-empty here by construction, so before #72 this was a
    // `SuppressedError` and the assertion below was false.
    assert.ok(outcome.error instanceof CancellationError);
  });
});
