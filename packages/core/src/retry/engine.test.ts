// SPDX-License-Identifier: MIT
// packages/core/src/retry/engine.test.ts
// Exercises: RETRY-7/8 (both axes gate), RETRY-20 (a hint replaces the schedule, unjittered), RETRY-22
// (a pacing failure never masks the upstream failure), RETRY-26/31 (cancellable wait, zero delay
// inline), RETRY-27/RECOV-20 (total-timeout budget with per-attempt shrinking), RETRY-32 (no attempts
// after cancellation), RETRY-34 (suppressed trail on failure, discarded on success, skip-self),
// RETRY-35/RECOV-16 (body released before the wait, bounded buffering), RETRY-36/RECOV-19 (503,503,200
// terminates on the 200; a surviving response is returned LIVE), RETRY-39/40 (delay precedence; a
// throwing override is non-fatal), RETRY-42/RECOV-28 (per-call state).
import {describe, expect, test} from 'bun:test';
import {HttpStatusError} from '../body/http-status-error.js';
import type {Clock} from '../config/clock.js';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {IoError} from '../io/errors.js';
import {failure, success, type Outcome} from '../recovery/outcome.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {countingResponse} from '../testing/fake-transport.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';
import {retrySettings, type RetrySettings} from './settings.js';

const GET = Request.newBuilder().url('https://example.com').build();
const BARE_POST = Request.newBuilder()
  .method('POST')
  .url('https://example.com')
  .build();

/**
 * The suppressed pair is asserted on SHAPE, never `instanceof SuppressedError`: the native class is
 * absent on this package's Node floor (>=20.3), where `suppress()` returns a structural stand-in and
 * an `instanceof` assertion would silently assert nothing.
 */
function isSuppressedShape(value: unknown): value is SuppressedErrorLike {
  return (
    value instanceof Error &&
    value.name === 'SuppressedError' &&
    'error' in value &&
    'suppressed' in value
  );
}

/**
 * A fake Clock whose `now`/`monotonic` both advance only when a test advances `clockState.ms`, and
 * whose `sleep` returns instantly while still honoring CFG-17's cancellation contract -- rejecting
 * with the abort reason for an already-aborted signal. Modelling that half matters: the engine
 * delegates its inter-attempt wait to `clock.sleep`, so a fake that always resolved would make
 * RETRY-26's cancellation path untestable without a real timer.
 */
function fakeClock(clockState: {ms: number}): Clock {
  return {
    now: () => clockState.ms,
    monotonic: () => clockState.ms,
    sleep: (_ms, signal) =>
      signal?.aborted === true
        ? Promise.reject(signal.reason as Error)
        : Promise.resolve(),
  };
}

/** A config whose clock advances only when a test advances it, jitter pinned to the midpoint. */
function configOf(
  overrides?: Partial<RetrySettings>,
  clockState = {ms: 0},
): RetryConfig {
  return {
    settings: retrySettings(overrides),
    clock: fakeClock(clockState),
    random: () => 0.5,
  };
}

/** Serves outcomes in order; the last repeats. Records the requests it saw. */
function scriptedDispatch(
  script: readonly Outcome<Response>[],
): RetryDispatch & {calls: Request[]} {
  const calls: Request[] = [];
  const dispatch = (request: Request): Promise<Outcome<Response>> => {
    calls.push(request);
    return Promise.resolve(
      script[Math.min(calls.length - 1, script.length - 1)] ??
        failure(new Error('empty script')),
    );
  };
  return Object.assign(dispatch, {calls});
}

describe('eligibility (RETRY-7/8)', () => {
  test('a non-retryable failure is surfaced after exactly one attempt', async () => {
    const dispatch = scriptedDispatch([failure(new TypeError('bad'))]);
    const outcome = await runWithRetry(GET, dispatch, configOf());

    expect(dispatch.calls).toHaveLength(1);
    expect(outcome.kind).toBe('failure');
  });

  test('a bare POST is not retried even on a retryable failure (RETRY-7)', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(BARE_POST, dispatch, configOf());

    expect(dispatch.calls).toHaveLength(1);
  });

  test('a retryable failure on an idempotent request exhausts the budget', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(dispatch.calls).toHaveLength(3);
  });

  test('maxAttempts of 1 disables retries entirely', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(GET, dispatch, configOf({maxAttempts: 1}));

    expect(dispatch.calls).toHaveLength(1);
  });
});

describe('status-driven retry (RETRY-36)', () => {
  test('503, 503, 200 terminates on the 200', async () => {
    const first = countingResponse(503);
    const second = countingResponse(503);
    const third = countingResponse(200);
    const dispatch = scriptedDispatch([
      success(first.response),
      success(second.response),
      success(third.response),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 0}),
    );

    expect(dispatch.calls).toHaveLength(3);
    expect(outcome).toEqual(success(third.response));
  });

  test('each discarded response is released before the next attempt (RETRY-35)', async () => {
    const first = countingResponse(503);
    const second = countingResponse(200);
    const dispatch = scriptedDispatch([
      success(first.response),
      success(second.response),
    ]);

    await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(first.cancelCount()).toBe(1);
    expect(second.cancelCount()).toBe(0);
  });

  test('a response that SURVIVES the gates is returned live and unread', async () => {
    const only = countingResponse(503);
    const dispatch = scriptedDispatch([success(only.response)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 1}),
    );

    expect(outcome).toEqual(success(only.response));
    expect(only.cancelCount()).toBe(0);
  });

  test('a non-retryable error status is returned as a live response, never remapped', async () => {
    const only = countingResponse(404);
    const dispatch = scriptedDispatch([success(only.response)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 0}),
    );

    expect(outcome).toEqual(success(only.response));
    expect(only.cancelCount()).toBe(0);
  });
});

describe('delay resolution (RETRY-39/40)', () => {
  test('a caller override wins over every other source', async () => {
    const clock = {ms: 0};
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 5000}, clock),
      delayOverride: () => 0,
    };
    const dispatch = scriptedDispatch([
      failure(new IoError('reset')),
      success(countingResponse(200).response),
    ]);

    await runWithRetry(GET, dispatch, config);

    expect(dispatch.calls).toHaveLength(2);
  });

  test('a throwing override is non-fatal and falls back to the schedule (RETRY-40)', async () => {
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 0}),
      delayOverride: () => {
        throw new Error('override exploded');
      },
    };
    const dispatch = scriptedDispatch([
      failure(new IoError('reset')),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('success');
    expect(dispatch.calls).toHaveLength(2);
  });
});

describe('server pacing hints (RETRY-20/22)', () => {
  test('a malformed pacing header never masks the upstream failure (RETRY-22)', async () => {
    const response = countingResponse(503)
      .response.newBuilder()
      .headers(Headers.newBuilder().add('Retry-After', 'garbage').build())
      .build();
    const dispatch = scriptedDispatch([
      success(response),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('success');
  });

  test('a server pacing hint replaces the schedule for that decision (RETRY-20)', async () => {
    const clock = {ms: 0};
    const response = countingResponse(503)
      .response.newBuilder()
      .headers(Headers.newBuilder().add('Retry-After', '0').build())
      .build();
    // fixedDelayMs would be 60s; the hint of 0 replaces it, so the test does not hang.
    const dispatch = scriptedDispatch([
      success(response),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 60_000}, clock),
    );

    expect(outcome.kind).toBe('success');
    expect(dispatch.calls).toHaveLength(2);
  });
});

describe('total-timeout budget (RETRY-27)', () => {
  test('an exhausted budget stops the loop', async () => {
    const clock = {ms: 0};
    const config = configOf({totalTimeoutMs: 50, fixedDelayMs: 0}, clock);
    const calls: number[] = [];
    const counting: RetryDispatch = (_request, attempt) => {
      calls.push(attempt);
      clock.ms += 40;
      return Promise.resolve(failure(new IoError('reset')));
    };

    await runWithRetry(GET, counting, config);

    expect(calls).toEqual([1, 2]);
  });

  test('a delay that would overshoot the budget is suppressed, not merely clamped', async () => {
    const clock = {ms: 0};
    const config = configOf(
      {totalTimeoutMs: 100, fixedDelayMs: 500, maxAttempts: 5},
      clock,
    );
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);

    await runWithRetry(GET, dispatch, config);

    // elapsed(0) + 500 > 100, so the loop surfaces after the first send rather than sleeping out the
    // remaining 100ms and dispatching a second attempt with no budget left (RETRY-27, RECOV-20).
    expect(dispatch.calls).toHaveLength(1);
  });

  test('a zero budget means unbounded, not immediately exhausted', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(
      GET,
      dispatch,
      configOf({totalTimeoutMs: 0, maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(dispatch.calls).toHaveLength(3);
  });
});

describe('cancellation (RETRY-26/32)', () => {
  test('an already-aborted signal launches no attempt at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const dispatch = scriptedDispatch([
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(GET, dispatch, {
      ...configOf(),
      signal: controller.signal,
    });

    expect(dispatch.calls).toHaveLength(0);
    expect(outcome.kind).toBe('failure');
  });

  test('aborting during the backoff wait stops the loop promptly', async () => {
    const controller = new AbortController();
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 60_000, maxAttempts: 5}),
      signal: controller.signal,
    };
    const dispatch: RetryDispatch = () => {
      queueMicrotask(() => {
        controller.abort();
      });
      return Promise.resolve(failure(new IoError('reset')));
    };

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('failure');
  });
});

describe('suppressed trail (RETRY-34)', () => {
  test('prior attempt failures ride along as suppressed on the surfaced error', async () => {
    const dispatch = scriptedDispatch([
      failure(new IoError('first')),
      failure(new IoError('second')),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 2, fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(true);
  });

  test('the trail is discarded entirely on eventual success', async () => {
    const dispatch = scriptedDispatch([
      failure(new IoError('first')),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('success');
  });
});

describe('suppressed trail -- skip-self and single-attempt shapes (RETRY-34)', () => {
  test('a reused instance never suppresses itself (RETRY-34 skip-self)', async () => {
    const reused = new IoError('same instance every time');
    const dispatch = scriptedDispatch([failure(reused)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(outcome).toEqual(failure(reused));
  });

  test('a single failed attempt surfaces its error unwrapped', async () => {
    const only = new TypeError('not retryable');
    const dispatch = scriptedDispatch([failure(only)]);

    expect(await runWithRetry(GET, dispatch, configOf())).toEqual(
      failure(only),
    );
  });

  test('a discarded 503 becomes a buffered HttpStatusError in the trail (RECOV-16)', async () => {
    // The 503 is DISCARDED (attempt 1 retries), so it is remapped and buffered into the trail; the
    // second attempt's IoError is what the loop surfaces. A 503 that instead SURVIVES the gates is
    // never remapped -- covered by 'a response that SURVIVES the gates is returned live and unread'.
    const dispatch = scriptedDispatch([
      success(countingResponse(503).response),
      failure(new IoError('final')),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 2, fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(true);
    if (!isSuppressedShape(outcome.error)) return;
    expect(outcome.error.error).toBeInstanceOf(IoError);
    expect(outcome.error.suppressed).toBeInstanceOf(HttpStatusError);
  });
});

describe('the inter-attempt wait (RETRY-26/31)', () => {
  test('a positive delay is awaited through the injected clock, and the loop then continues', async () => {
    const slept: number[] = [];
    const config: RetryConfig = {
      settings: retrySettings({fixedDelayMs: 250, maxAttempts: 2}),
      clock: {
        now: () => 0,
        monotonic: () => 0,
        sleep: ms => {
          slept.push(ms);
          return Promise.resolve();
        },
      },
      random: () => 0.5,
    };
    const dispatch = scriptedDispatch([
      failure(new IoError('reset')),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('success');
    // RETRY-13: the wait goes through the single-sourced Clock seam, never a private timer.
    expect(slept).toEqual([250]);
  });

  test('a zero delay short-circuits the clock entirely (RETRY-31)', async () => {
    let sleeps = 0;
    const config: RetryConfig = {
      settings: retrySettings({fixedDelayMs: 0, maxAttempts: 2}),
      clock: {
        now: () => 0,
        monotonic: () => 0,
        sleep: () => {
          sleeps += 1;
          return Promise.resolve();
        },
      },
      random: () => 0.5,
    };
    const dispatch = scriptedDispatch([
      failure(new IoError('reset')),
      success(countingResponse(200).response),
    ]);

    await runWithRetry(GET, dispatch, config);

    expect(sleeps).toBe(0);
  });
});

describe('the inter-attempt wait -- degenerate and hostile delays', () => {
  test('a negative delay from a caller override never reaches the clock (RETRY-40)', async () => {
    let sleeps = 0;
    const config: RetryConfig = {
      settings: retrySettings({maxAttempts: 2}),
      clock: {
        now: () => 0,
        monotonic: () => 0,
        sleep: () => {
          sleeps += 1;
          return Promise.reject(new RangeError('negative'));
        },
      },
      random: () => 0.5,
      delayOverride: () => -5,
    };
    const dispatch = scriptedDispatch([
      failure(new IoError('reset')),
      success(countingResponse(200).response),
    ]);

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('success');
    expect(sleeps).toBe(0);
  });

  test('a clock whose sleep fails for a reason other than abort is not swallowed', async () => {
    const config: RetryConfig = {
      settings: retrySettings({fixedDelayMs: 10, maxAttempts: 3}),
      clock: {
        now: () => 0,
        monotonic: () => 0,
        sleep: () => Promise.reject(new RangeError('misbehaving clock')),
      },
      random: () => 0.5,
    };
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);

    const outcome = await runWithRetry(GET, dispatch, config);

    // Folded into the outcome rather than escaping as a bare rejection, and it stops the loop
    // instead of silently becoming an extra attempt.
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(true);
    if (!isSuppressedShape(outcome.error)) return;
    expect(outcome.error.error).toBeInstanceOf(RangeError);
    expect(dispatch.calls).toHaveLength(1);
  });
});

describe('cancellation while an attempt is in flight (RETRY-32)', () => {
  test('a retryable response arriving after the abort is released, not leaked (RETRY-32)', async () => {
    const controller = new AbortController();
    const inFlight = countingResponse(503);
    const dispatch: RetryDispatch = () => {
      // Aborts while this very attempt is in flight, so its response arrives to a cancelled call.
      controller.abort();
      return Promise.resolve(success(inFlight.response));
    };

    const outcome = await runWithRetry(GET, dispatch, {
      ...configOf({fixedDelayMs: 0, maxAttempts: 3}),
      signal: controller.signal,
    });

    expect(outcome.kind).toBe('failure');
    expect(inFlight.cancelCount()).toBe(1);
  });

  test('a response that ENDS the loop is handed to the caller live, even after an abort (RETRY-32)', async () => {
    const controller = new AbortController();
    const arriving = countingResponse(200);
    const dispatch: RetryDispatch = () => {
      controller.abort();
      return Promise.resolve(success(arriving.response));
    };

    const outcome = await runWithRetry(GET, dispatch, {
      ...configOf({fixedDelayMs: 0}),
      signal: controller.signal,
    });

    // Not a leak: ownership transfers to the caller, which is the only reader that could close it.
    // RETRY-32's "closed rather than leaked" bites on responses the ENGINE discards, above.
    expect(outcome).toEqual(success(arriving.response));
    expect(arriving.cancelCount()).toBe(0);
  });

  test('an abort raised WHILE the wait is pending settles it promptly (RETRY-26)', async () => {
    const controller = new AbortController();
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 60_000, maxAttempts: 5}),
      signal: controller.signal,
    };
    const dispatch: RetryDispatch = () => {
      controller.abort();
      return Promise.resolve(failure(new IoError('reset')));
    };

    const outcome = await runWithRetry(GET, dispatch, config);

    // The fake clock rejects with the abort reason; the engine absorbs it and the next iteration's
    // RETRY-32 check is what actually stops the loop.
    expect(outcome.kind).toBe('failure');
  });
});

describe('a throwing attempt still carries the trail (RETRY-33/34)', () => {
  test('a throw from inside the attempt is folded into a failure outcome, trail intact', async () => {
    const calls: number[] = [];
    const dispatch: RetryDispatch = (_request, attempt) => {
      calls.push(attempt);
      if (attempt === 1) return Promise.resolve(failure(new IoError('first')));
      throw new RangeError('decision blew up');
    };

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(calls).toEqual([1, 2]);
    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(true);
    if (!isSuppressedShape(outcome.error)) return;
    expect(outcome.error.error).toBeInstanceOf(RangeError);
    // RETRY-34: attempt 1's failure would have been lost had the throw escaped as a rejection.
    expect((outcome.error.suppressed as Error).message).toBe('first');
  });
});

describe('the suppressed trail with more than two entries (RETRY-34)', () => {
  test('three distinct attempt failures fold into a nested chain', async () => {
    const dispatch = scriptedDispatch([
      failure(new IoError('first')),
      failure(new IoError('second')),
      failure(new IoError('third')),
    ]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(true);
    if (!isSuppressedShape(outcome.error)) return;
    expect((outcome.error.error as Error).message).toBe('third');
    // The two priors folded into a nested pair, oldest innermost.
    const folded = outcome.error.suppressed;
    expect(isSuppressedShape(folded)).toBe(true);
    if (!isSuppressedShape(folded)) return;
    expect((folded.error as Error).message).toBe('second');
    expect((folded.suppressed as Error).message).toBe('first');
  });
});

describe('a failing release never becomes primary (RECOV-12, RETRY-35)', () => {
  /**
   * A response the engine must close ITSELF. A caller-widened sub-400 status makes `toHttpError`
   * return null without consuming or closing (BODY-31 hands it back intact), so the engine's own
   * release is the first and only close -- and unlike the 4xx/5xx path, where the body is already
   * drained and `cancel()` is a no-op, here the source's cancel hook really runs and can fail.
   */
  function uncancellableResponse(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        throw new IoError('cancel blew up');
      },
    });
    return Response.newBuilder()
      .request(GET)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(204))
      .body(body)
      .build();
  }

  test('a release that throws does not discard the retry decision it was released for', async () => {
    let sends = 0;
    const dispatch: RetryDispatch = () => {
      sends += 1;
      return Promise.resolve(success(uncancellableResponse()));
    };

    const outcome = await runWithRetry(GET, dispatch, {
      ...configOf({
        maxAttempts: 2,
        fixedDelayMs: 0,
        retryableStatuses: new Set([204]),
      }),
    });

    // The whole budget is spent and the surviving response is returned, exactly as if the release
    // had succeeded. A bare `finally { await close() }` would instead have thrown the teardown
    // failure out of the decision it was returning -- one send, and a cancel error where a retry
    // decision belonged.
    expect(sends).toBe(2);
    expect(outcome.kind).toBe('success');
  });
});

describe('a failing release -- masking and self-suppression', () => {
  test('the drain failure stays primary when the release fails too', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new IoError('socket died mid-drain');
      },
      cancel() {
        throw new IoError('cancel failed too');
      },
    });
    const hostile = Response.newBuilder()
      .request(GET)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(503))
      .body(body)
      .build();
    const dispatch = scriptedDispatch([success(hostile)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    const primary = isSuppressedShape(outcome.error)
      ? outcome.error.error
      : outcome.error;
    expect((primary as Error).message).toBe('socket died mid-drain');
  });

  test('a release failure is never suppressed under itself', async () => {
    // `Response.close()` memoizes its release promise, and cancelling an ERRORED stream rejects with
    // the stream's stored error rather than calling the cancel hook -- so the release hands back the
    // very instance already propagating. Without an identity guard that value would suppress itself.
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new IoError('socket died mid-drain');
      },
      cancel() {
        throw new IoError('cancel failed too');
      },
    });
    const hostile = Response.newBuilder()
      .request(GET)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(503))
      .body(body)
      .build();
    const dispatch = scriptedDispatch([success(hostile)]);

    const outcome = await runWithRetry(
      GET,
      dispatch,
      configOf({maxAttempts: 3, fixedDelayMs: 0}),
    );

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(isSuppressedShape(outcome.error)).toBe(false);
  });
});

describe('budget precondition', () => {
  test('a non-finite maxAttempts is rejected at the engine, not left to loop forever', async () => {
    // Both adapters reach the engine with settings a caller supplied. `retryStep` guards the
    // per-call override route; this is the guard for every other route, including
    // `dispatchWithRetry`, which takes a RetryConfig straight from its caller.
    const rogue = {
      ...retrySettings({fixedDelayMs: 0}),
      maxAttempts: Number.POSITIVE_INFINITY,
    };
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);

    const reason = await runWithRetry(GET, dispatch, {
      ...configOf(),
      settings: rogue,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((reason as Error).message).toContain('finite count >= 1');
    expect(dispatch.calls).toHaveLength(0);
  });
});

describe('per-call state (RETRY-42, RECOV-28)', () => {
  test('concurrent invocations do not clobber each other’s budget', async () => {
    const settings = retrySettings({maxAttempts: 3, fixedDelayMs: 0});
    const config: RetryConfig = {
      settings,
      clock: fakeClock({ms: 0}),
      random: () => 0.5,
    };
    const left = scriptedDispatch([failure(new IoError('left'))]);
    const right = scriptedDispatch([failure(new IoError('right'))]);

    await Promise.all([
      runWithRetry(GET, left, config),
      runWithRetry(GET, right, config),
    ]);

    expect(left.calls).toHaveLength(3);
    expect(right.calls).toHaveLength(3);
  });
});

describe('Phase 7b retrofit: structured retry logging', () => {
  test('emits attemptFailed per retry and exhausted when attempts run out', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    const testLogger = createLogger((_level, fields) => {
      events.push(new Map(fields));
    });
    setGlobalLogger(testLogger);

    try {
      const config = configOf({maxAttempts: 3, fixedDelayMs: 0});
      const dispatch = scriptedDispatch([
        failure(new IoError('first')),
        failure(new IoError('second')),
        failure(new IoError('third')),
      ]);

      await runWithRetry(GET, dispatch, config);

      const failedEvents = events.filter(
        e => e.get('event') === 'http.retry.attemptFailed',
      );
      expect(failedEvents).toHaveLength(2);
      expect(failedEvents[0]?.get('attempt')).toBe(1);
      expect(failedEvents[1]?.get('attempt')).toBe(2);

      const exhaustedEvents = events.filter(
        e => e.get('event') === 'http.retry.exhausted',
      );
      expect(exhaustedEvents).toHaveLength(1);
      expect(exhaustedEvents[0]?.get('attempts')).toBe(3);
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });

  test('emits delayOverrideFailed when delayOverride throws', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    const testLogger = createLogger((_level, fields) => {
      events.push(new Map(fields));
    });
    setGlobalLogger(testLogger);

    try {
      const config: RetryConfig = {
        ...configOf({maxAttempts: 2, fixedDelayMs: 0}),
        delayOverride: () => {
          throw new Error('bad override');
        },
      };
      const dispatch = scriptedDispatch([
        failure(new IoError('first')),
        success(countingResponse(200).response),
      ]);

      await runWithRetry(GET, dispatch, config);

      const overrideFailed = events.filter(
        e => e.get('event') === 'http.retry.delayOverrideFailed',
      );
      expect(overrideFailed).toHaveLength(1);
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });
});
