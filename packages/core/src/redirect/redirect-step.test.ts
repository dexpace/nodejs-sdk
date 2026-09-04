// SPDX-License-Identifier: MIT
// packages/core/src/redirect/redirect-step.test.ts
// Exercises: PIPE-36 (the stage is baked into the descriptor, not subclassable), PIPE-15 (every dispatch
// takes a FRESH ctx.fork() continuation -- ctx.next()'s single-invocation guard would trip on hop two),
// PIPE-40/REDIR-22 (the 2-hop conformance clause: wire-send count, per-hop close of each superseded
// response, the final response left OPEN for the caller), REDIR-22(b) (a throw out of the decision --
// including from caller predicate code -- closes the current response before propagating), REDIR-16
// (a detected loop returns the loop response open, without throwing), REDIR-15 (a rejected downgrade
// closes the current response and propagates SchemeDowngradeError), and the cancellation check (an
// an abort DURING a hop returns the current response open rather than issuing a further hop, while a
// signal already aborted at entry is refused by the cursor before the step runs -- see V15).
import {describe, expect, test} from 'bun:test';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {streamBody} from '../body/stream-body.js';
import {Headers} from '../http/headers.js';
import type {Method} from '../http/method.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {Cursor} from '../pipeline/cursor.js';
import type {StepDescriptor} from '../pipeline/step.js';
import type {Transport} from '../seams/transport.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';
import {REDIRECT_STEP_TYPE, redirectStep} from './redirect-step.js';

const SEED = Request.newBuilder().url('https://example.com/start').build();
const CANCEL_FAILURE = new Error('cancel exploded');

// Constructed inline rather than imported: 4c keeps `aRequestContext()` file-local to `cursor.test.ts`,
// and importing across `*.test.ts` files is not acceptable -- the same call 5a's `retry-step.test.ts` made.
function aRequestContext(request: Request = SEED): ExecutionContext {
  return createRequestContext(request);
}

function runThrough(
  descriptor: StepDescriptor,
  transport: FakeTransport,
  signal?: AbortSignal,
): Promise<Response> {
  return new Cursor({
    steps: [descriptor],
    transport,
    request: SEED,
    context: aRequestContext(),
    signal,
  }).advance();
}

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this runner's
 * type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper keeps the
 * assertion honest without a lint suppression. Same shape 5a's `retry-step.test.ts` settled on.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

// `FakeTransport` does not itself set a Location -- `decide()` reads it off `Response.headers`, so a
// scripted 3xx entry must carry one explicitly. `ResponseBuilder` carries the SAME body instance through
// `response.newBuilder()`, so the rebuilt response still reports through `countingResponse`'s counter.
// `setInbound`, not `set`: a Location is an inbound (response) header (HTTP-19).
function withLocation(response: Response, location: string): Response {
  return response
    .newBuilder()
    .headers(
      response.headers.newBuilder().setInbound('Location', location).build(),
    )
    .build();
}

/**
 * A response whose body `cancel()` REJECTS with a non-`TypeError` -- the one thing `Response.close()`
 * is documented to rethrow. Models a transport releasing over an already-broken socket.
 */
function hostileResponse(status: number, location: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      throw CANCEL_FAILURE;
    },
  });
  return Response.newBuilder()
    .request(SEED)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(Headers.newBuilder().setInbound('Location', location).build())
    .body(body)
    .build();
}

describe('redirectStep', () => {
  test('is pinned to the REDIRECT pillar stage (PIPE-36)', () => {
    const descriptor = redirectStep();
    expect(descriptor.stage).toBe('REDIRECT');
    expect(descriptor.type).toBe(REDIRECT_STEP_TYPE);
  });

  test('closes PIPE-40: two chained 301s then a 200', async () => {
    const first = countingResponse(301);
    const second = countingResponse(301);
    const third = countingResponse(200);
    const hop1 = withLocation(first.response, 'https://example.com/mid');
    const hop2 = withLocation(second.response, '/final'); // relative, resolved against /mid
    const transport = new FakeTransport([hop1, hop2, third.response]);

    const response = await runThrough(redirectStep(), transport);

    expect(transport.sendCount).toBe(3);
    expect(first.cancelCount()).toBe(1);
    expect(second.cancelCount()).toBe(1);
    expect(third.cancelCount()).toBe(0); // left open for the caller
    expect(response).toBe(third.response);
  });

  test('each hop is dispatched against the rewritten request (REDIR-7/REDIR-14)', async () => {
    const first = countingResponse(301);
    const final = countingResponse(200);
    const seedWithAuth = Request.newBuilder()
      .url('https://example.com/start')
      .headers(Headers.newBuilder().add('Authorization', 'Bearer x').build())
      .build();
    const transport = new FakeTransport([
      withLocation(first.response, '/next'),
      final.response,
    ]);

    await new Cursor({
      steps: [redirectStep()],
      transport,
      request: seedWithAuth,
      context: aRequestContext(seedWithAuth),
    }).advance();

    expect(transport.sendCount).toBe(2);
    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe(
      'Bearer x',
    );
    expect(transport.calls[1]?.request.url.href).toBe(
      'https://example.com/next',
    );
    expect(
      transport.calls[1]?.request.headers.get('Authorization'),
    ).toBeUndefined();
  });

  test('a non-redirect response is returned open, untouched, on the very first hop', async () => {
    const only = countingResponse(200);
    const transport = new FakeTransport([only.response]);

    const response = await runThrough(redirectStep(), transport);

    expect(transport.sendCount).toBe(1);
    expect(only.cancelCount()).toBe(0);
    expect(response).toBe(only.response);
  });
});

describe('redirectStep -- termination without a throw', () => {
  test('a loop is detected and the loop response returned open, not thrown (REDIR-16)', async () => {
    const loopHop = countingResponse(301);
    const located = withLocation(loopHop.response, 'https://example.com/start');
    const transport = new FakeTransport([located]);

    const response = await runThrough(redirectStep(), transport);

    expect(response).toBe(located); // Location === seed URI -> visited hit -> return-current, unclosed
    expect(loopHop.cancelCount()).toBe(0);
    expect(transport.sendCount).toBe(1);
  });

  test('the hop cap returns the last response as-is, even a 3xx, without throwing (REDIR-17)', async () => {
    const hopA = countingResponse(301);
    const hopB = countingResponse(301);
    const hopC = countingResponse(301);
    const capped = countingResponse(301);
    const transport = new FakeTransport([
      withLocation(hopA.response, 'https://example.com/1'),
      withLocation(hopB.response, 'https://example.com/2'),
      withLocation(hopC.response, 'https://example.com/3'),
      withLocation(capped.response, 'https://example.com/4'),
    ]);

    const response = await runThrough(redirectStep(), transport);

    expect(transport.sendCount).toBe(4); // seed + 3 followed hops, the default cap
    expect(response.status.code).toBe(301);
    expect(capped.cancelCount()).toBe(0); // returned open even though it is itself a redirect
  });

  test('maxHops: 0 disables following entirely (REDIR-17)', async () => {
    const only = countingResponse(301);
    const located = withLocation(only.response, 'https://example.com/next');
    const transport = new FakeTransport([located]);

    const response = await runThrough(redirectStep({maxHops: 0}), transport);

    expect(transport.sendCount).toBe(1);
    expect(response).toBe(located);
    expect(only.cancelCount()).toBe(0);
  });
});

describe('redirectStep -- cancellation and the failure paths', () => {
  test('an abort DURING the first hop returns that response open, never dispatching a second', async () => {
    // The redirect step's own per-hop `signal?.aborted` check, which is what discharges PIPE-40's
    // "the in-flight response MUST be returned unclosed" on the abandon path. It runs BEFORE the
    // step forks again, so the cursor's own step-boundary check (V15) never sees this abort and
    // cannot pre-empt the open hand-back. Aborting mid-flight rather than up front is what keeps
    // this test on the step's guard instead of the cursor's.
    const controller = new AbortController();
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'https://example.com/next');
    const never = countingResponse(200);
    const transport = new FakeTransport([located, never.response]);
    const aborting: Transport = {
      send: async (request, options, signal) => {
        const response = await transport.send(request, options, signal);
        controller.abort();
        return response;
      },
      close: () => Promise.resolve(),
    };

    const response = await new Cursor({
      steps: [redirectStep()],
      transport: aborting,
      request: SEED,
      context: aRequestContext(),
      signal: controller.signal,
    }).advance();

    expect(transport.sendCount).toBe(1); // the first hop dispatched; the second never does
    expect(response).toBe(located); // returned open -- the caller owns it
    expect(hop.cancelCount()).toBe(0);
  });
});

describe('redirectStep -- cancellation at entry (V15)', () => {
  test('a signal already aborted at entry never dispatches at all', async () => {
    // Distinct from the case above: the cursor now refuses the walk before the step runs, so there
    // is no in-flight response to hand back and nothing to leak. Before 2026-09-02 this dispatched
    // the first hop and returned it open.
    const {CancellationError} = await import('../seams/transport.js');
    const controller = new AbortController();
    controller.abort();
    const never = countingResponse(200);
    const transport = new FakeTransport([never.response]);

    const error = await rejectionOf(
      runThrough(redirectStep(), transport, controller.signal),
    );

    expect(error).toBeInstanceOf(CancellationError);
    expect(transport.sendCount).toBe(0);
    expect(never.cancelCount()).toBe(0);
  });

  test('a rejected scheme downgrade closes the current response first (REDIR-15/REDIR-22b)', async () => {
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'http://example.com/next');
    const transport = new FakeTransport([located]);

    const error = await rejectionOf(runThrough(redirectStep(), transport));

    expect(error).toBeInstanceOf(SchemeDowngradeError);
    expect(hop.cancelCount()).toBe(1); // the hop's body is not leaked
  });

  test('a throwing predicate closes the current response before the error propagates (REDIR-22b)', async () => {
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'https://example.com/next');
    const transport = new FakeTransport([located]);
    const boom = new Error('predicate exploded');
    const step = redirectStep({
      predicate: () => {
        throw boom;
      },
    });

    const error = await rejectionOf(runThrough(step, transport));

    expect(error).toBe(boom); // the caller's own error, not remapped to a redirect error type
    expect(hop.cancelCount()).toBe(1); // decideOrClose closed it -- the hop's body is not leaked
  });

  test('a cross-origin hop carries the suppression marker to the next dispatch (REDIR-11)', async () => {
    const hop = countingResponse(302);
    const final = countingResponse(200);
    const transport = new FakeTransport([
      withLocation(hop.response, 'https://other.example/next'),
      final.response,
    ]);

    await runThrough(redirectStep(), transport);

    expect(
      transport.calls[1]?.request.headers.get(
        'x-dexpace-internal-redirect-cross-origin',
      ),
    ).toBe('1');
  });
});

describe('redirectStep -- a failing release never masks the primary error', () => {
  test('a rejecting close() keeps SchemeDowngradeError primary (REDIR-22b, RECOV-12)', async () => {
    const transport = new FakeTransport([
      hostileResponse(301, 'http://example.com/next'),
    ]);

    const error = await rejectionOf(runThrough(redirectStep(), transport));

    // Without withReleaseFailure this was `Error: cancel exploded` -- the typed, caller-catchable,
    // security-relevant error silently replaced by the teardown failure.
    const suppressed = error as SuppressedErrorLike;
    expect(suppressed.error).toBeInstanceOf(SchemeDowngradeError);
    expect(suppressed.suppressed).toBe(CANCEL_FAILURE);
  });

  test("a rejecting close() keeps the caller's predicate error primary (REDIR-22b)", async () => {
    const boom = new Error('predicate exploded');
    const transport = new FakeTransport([
      hostileResponse(301, 'https://example.com/next'),
    ]);
    const step = redirectStep({
      predicate: () => {
        throw boom;
      },
    });

    const error = await rejectionOf(runThrough(step, transport));

    const suppressed = error as SuppressedErrorLike;
    expect(suppressed.error).toBe(boom);
    expect(suppressed.suppressed).toBe(CANCEL_FAILURE);
  });

  test('a clean release leaves the primary error untouched, unwrapped', async () => {
    const hop = countingResponse(301);
    const transport = new FakeTransport([
      withLocation(hop.response, 'http://example.com/next'),
    ]);

    const error = await rejectionOf(runThrough(redirectStep(), transport));

    expect(error).toBeInstanceOf(SchemeDowngradeError); // NOT wrapped when nothing was suppressed
    expect(hop.cancelCount()).toBe(1);
  });
});

describe("redirectStep -- REDIR-22(b)'s other named trigger, and concurrency", () => {
  test('a non-replayable body closes the current response before the error propagates', async () => {
    // REDIR-22(b) names exactly two triggers -- "non-replayable body, downgrade rejection". The
    // downgrade one is covered above; this is the other. Note the deliberate reading of a conflict:
    // PIPE-40's parenthetical lists "non-replayable body" among the paths whose in-flight response is
    // "returned unclosed", which is the opposite disposition. REDIR-6 ("MUST fail with a clear error")
    // and REDIR-22(b) agree that this path THROWS, and a response that is never returned cannot be
    // "returned unclosed" -- so the redirect chapter governs. Recorded in the design's Deviation Ledger.
    const oneShot = streamBody(
      new ReadableStream<Uint8Array>({
        start: c => {
          c.close();
        },
      }),
      undefined,
      0,
    );
    const seed = Request.newBuilder()
      .method('POST')
      .url('https://example.com/start')
      .body(oneShot)
      .build();
    const hop = countingResponse(307);
    const transport = new FakeTransport([
      withLocation(hop.response, 'https://example.com/next'),
    ]);
    const step = redirectStep({
      allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
    });

    const error = await rejectionOf(
      new Cursor({
        steps: [step],
        transport,
        request: seed,
        context: aRequestContext(seed),
      }).advance(),
    );

    expect(error).toBeInstanceOf(NonReplayableBodyError);
    expect(hop.cancelCount()).toBe(1); // closed, not leaked
    expect(transport.sendCount).toBe(1); // the redirect was not attempted
  });

  test('one descriptor drives concurrent calls without sharing loop state', async () => {
    // Every piece of per-call state -- `visited`, `redirectsFollowed`, `request`, `seedOrigin` -- is a
    // local inside `fn`, so a single installed descriptor is safe under concurrency. The same property
    // 5a asserts for its own engine (RETRY-42/RECOV-28).
    const step = redirectStep();
    const drive = async (host: string): Promise<string | undefined> => {
      const hop = countingResponse(301);
      const final = countingResponse(200);
      const transport = new FakeTransport([
        withLocation(hop.response, `https://${host}/final`),
        final.response,
      ]);
      const seed = Request.newBuilder().url(`https://${host}/start`).build();
      const response = await new Cursor({
        steps: [step],
        transport,
        request: seed,
        context: aRequestContext(seed),
      }).advance();
      expect(response).toBe(final.response);
      return transport.calls[1]?.request.url.href;
    };

    const [a, b] = await Promise.all([drive('a.example'), drive('b.example')]);

    expect(a).toBe('https://a.example/final');
    expect(b).toBe('https://b.example/final');
  });
});

describe('Phase 7b retrofit: redirect hop and downgrade logging', () => {
  test('emits http.redirect.hop for followed hops', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    const testLogger = createLogger((_level, fields) => {
      events.push(new Map(fields));
    });
    setGlobalLogger(testLogger);

    try {
      const hop = countingResponse(302);
      const final = countingResponse(200);
      const transport = new FakeTransport([
        withLocation(hop.response, 'https://example.com/dest'),
        final.response,
      ]);

      await runThrough(redirectStep(), transport);

      const hops = events.filter(e => e.get('event') === 'http.redirect.hop');
      expect(hops).toHaveLength(1);
      expect(hops[0]?.get('hop')).toBe(1);
      expect(hops[0]?.get('status')).toBe(302);
      expect(hops[0]?.get('url.full')).toBe('https://example.com/dest');
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });
});

describe('REDIR-28: the loop-detected and malformed-Location events (G3)', () => {
  test('emits http.redirect.loopDetected when the target is already visited', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    setGlobalLogger(
      createLogger((_level, fields) => {
        events.push(new Map(fields));
      }),
    );

    try {
      const hop = countingResponse(302);
      const loop = countingResponse(302);
      const transport = new FakeTransport([
        withLocation(hop.response, 'https://example.com/dest'),
        withLocation(loop.response, 'https://example.com/dest'),
      ]);

      await runThrough(redirectStep(), transport);

      const detected = events.filter(
        e => e.get('event') === 'http.redirect.loopDetected',
      );
      expect(detected).toHaveLength(1);
      expect(detected[0]?.get('location')).toBe('https://example.com/dest');
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });

  test('emits http.redirect.malformedLocation with the RAW header', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    setGlobalLogger(
      createLogger((_level, fields) => {
        events.push(new Map(fields));
      }),
    );

    try {
      const bad = countingResponse(302);
      const transport = new FakeTransport([
        withLocation(bad.response, 'javascript:alert(1)'),
      ]);

      await runThrough(redirectStep(), transport);

      const malformed = events.filter(
        e => e.get('event') === 'http.redirect.malformedLocation',
      );
      expect(malformed).toHaveLength(1);
      // REDIR-28's carve-out: unredacted, because it never parsed into a URL.
      expect(malformed[0]?.get('location.raw')).toBe('javascript:alert(1)');
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });
});

describe('Phase 7b retrofit: the permitted-downgrade event', () => {
  test('emits http.redirect.downgradePermitted when downgrade policy permits http redirect', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    const testLogger = createLogger((_level, fields) => {
      events.push(new Map(fields));
    });
    setGlobalLogger(testLogger);

    try {
      const hop = countingResponse(302);
      const final = countingResponse(200);
      const transport = new FakeTransport([
        withLocation(hop.response, 'http://example.com/downgraded'),
        final.response,
      ]);

      await runThrough(redirectStep({allowSchemeDowngrade: true}), transport);

      const downgrades = events.filter(
        e => e.get('event') === 'http.redirect.downgradePermitted',
      );
      expect(downgrades).toHaveLength(1);
      expect(downgrades[0]?.get('from_url')).toBe('https://example.com/start');
      expect(downgrades[0]?.get('to_url')).toBe(
        'http://example.com/downgraded',
      );
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });
});

describe('Phase 7b retrofit: redirect rejection logging', () => {
  test('emits http.redirect.rejected on rejected redirect or loop', async () => {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    const testLogger = createLogger((_level, fields) => {
      events.push(new Map(fields));
    });
    setGlobalLogger(testLogger);

    try {
      const hop = countingResponse(302);
      const transport = new FakeTransport([
        withLocation(hop.response, 'https://example.com/start'), // loop to self
      ]);

      await runThrough(redirectStep(), transport);

      const rejections = events.filter(
        e => e.get('event') === 'http.redirect.rejected',
      );
      expect(rejections).toHaveLength(1);
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
  });
});
