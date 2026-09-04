// SPDX-License-Identifier: MIT
// packages/core/src/auth/auth-step.test.ts
// Exercises: XCUT-16 (a credential is NEVER stamped over a non-HTTPS transport; the refusal is loud and
// lands before any token fetch or header write, and it applies only on the credential-attaching path --
// a marker-suppressed cross-origin re-issue may proceed credential-free over any scheme),
// AUTH-27 (exactly one AUTH-stage descriptor, pinned to the pillar), AUTH-28 (HTTPS guard,
// NO_AUTH exempt, re-applied on the replay path), AUTH-29 (the cross-origin marker skips the guard and
// stamping, is cleared from the outbound headers, and suppresses the challenge reaction too -- so the
// credential cannot re-enter via the 401), AUTH-25 (a 407 is answered from Proxy-Authenticate into
// Proxy-Authorization), AUTH-30 (401 + WWW-Authenticate invokes the hook; a replacement re-drives
// exactly once through a fresh fork()), AUTH-31 (a non-replayable replacement body surfaces the
// original challenge unchanged and unclosed), AUTH-32 (a throwing hook closes the challenge response
// before propagating), AUTH-33 (no matching challenge header, or a hook yielding nothing -> unchanged),
// AUTH-36 (OAUTH2's default hook evicts the exact rejected token and re-stamps -- including behind a
// non-replayable body, where only the REPLAY is skipped), AUTH-4 (a per-call RequestOptions.auth
// descriptor overrides the configured tiers, via ctx.options), AUTH-5/AUTH-6 (resolution against the
// derived available-scheme set), RECOV-12 (a failing release never masks the primary error),
// AUTH-34/AUTH-35 (a refresh margin is validated as a finite, non-negative duration).
import {describe, expect, test} from 'bun:test';
import {streamBody} from '../body/stream-body.js';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {Cursor} from '../pipeline/cursor.js';
import type {Transport} from '../seams/transport.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {CROSS_ORIGIN_MARKER_HEADER} from '../redirect/cross-origin.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {invariant} from '../invariant.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {
  AUTH_STEP_TYPE,
  authStep,
  availableSchemesOf,
  type AuthCredentialSet,
} from './auth-step.js';
import {createBearerToken, ApiKeyCredential} from './credential.js';
import {createAuthDescriptor} from './descriptor.js';
import {AuthResolutionError, PlaintextCredentialError} from './errors.js';
import {createAuthRequirement} from './requirement.js';
import type {AuthScheme} from './scheme.js';

// Constructed inline rather than imported: 4c keeps `aRequestContext()` file-local to `cursor.test.ts`,
// and importing across `*.test.ts` files is not acceptable -- the same call 5a's and 5b's step suites made.
function aRequestContext(request: Request): ExecutionContext {
  return createRequestContext(request);
}

function aRequest(url = 'https://example.com/a'): Request {
  return Request.newBuilder().url(url).build();
}

function markedRequest(url: string): Request {
  return Request.newBuilder()
    .url(url)
    .headers(Headers.newBuilder().add(CROSS_ORIGIN_MARKER_HEADER, '1').build())
    .build();
}

/** The optional per-drive inputs, bundled so `runThrough` stays within `max-params`. */
interface DriveOverrides {
  readonly request?: Request | undefined;
  readonly options?: RequestOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

// `Transport`, not `FakeTransport`: the only thing this helper does with it is hand it to `Cursor`,
// and narrowing to what is actually used is what lets the gated double below be driven through it too
// (`docs/knowledge/harvested/api-design.md` -- accept the narrowest interface describing the members used).
function runThrough(
  descriptor: StepDescriptor,
  transport: Transport,
  overrides: DriveOverrides = {},
): Promise<Response> {
  const request = overrides.request ?? aRequest();
  return new Cursor({
    steps: [descriptor],
    transport,
    request,
    context: aRequestContext(request),
    options: overrides.options,
    signal: overrides.signal,
  }).advance();
}

function tiersFor(scheme: AuthScheme): {
  client: ReturnType<typeof createAuthDescriptor>;
} {
  return {client: createAuthDescriptor([createAuthRequirement(scheme)])};
}

/**
 * A challenge response: `countingResponse` plus the challenge header. `ResponseBuilder` carries the
 * SAME body instance through `newBuilder()`, so the rebuilt response still reports through the
 * original's release counter. `setInbound`, not `set`: these are inbound headers, and a real server may
 * send obs-text in a realm (HTTP-19).
 */
function challengeResponse(
  status: number,
  headerName: string,
  headerValue: string,
): {response: Response; cancelCount: () => number} {
  const base = countingResponse(status);
  const response = base.response
    .newBuilder()
    .headers(
      base.response.headers
        .newBuilder()
        .setInbound(headerName, headerValue)
        .build(),
    )
    .build();
  return {response, cancelCount: base.cancelCount};
}

/** A one-shot request body: `StreamBody.replayable` is `false` (AUTH-31's gate). */
function oneShotPost(url = 'https://example.com/a'): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return Request.newBuilder()
    .method('POST')
    .url(url)
    .body(streamBody(stream, 'text/plain', 0))
    .build();
}

const CANCEL_FAILURE = new Error('cancel exploded');

/**
 * A 401 whose body `cancel()` REJECTS with a non-`TypeError` -- the one thing `Response.close()` is
 * documented to rethrow. Models a transport releasing over an already-broken socket. Same shape 5b's
 * `redirect-step.test.ts` uses for its own RECOV-12 coverage.
 */
function hostileChallenge(value = 'Basic realm="x"'): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      throw CANCEL_FAILURE;
    },
  });
  return Response.newBuilder()
    .request(aRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(401))
    .headers(Headers.newBuilder().setInbound('WWW-Authenticate', value).build())
    .body(body)
    .build();
}

/**
 * A macrotask boundary, so a fire-and-forget background refresh's whole then/finally chain has
 * drained regardless of how many microtask hops it takes. Same helper `bearer-cache.test.ts` uses.
 */
function drainMacrotask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/**
 * Drives three requests through `descriptor`, draining between them, and reports the `Authorization`
 * value each one actually put on the wire.
 *
 * Three drives is the shortest sequence that can observe a refresh MARGIN at all: the first fills an
 * empty cache (where no margin is consulted), the second is the one the margin either does or does
 * not push into AUTH-37's expiring-but-valid zone, and the third reveals whether that zone's
 * background refresh actually happened.
 */
async function stampsOverThreeDrives(
  descriptor: StepDescriptor,
): Promise<readonly (string | undefined)[]> {
  const transport = new FakeTransport([
    countingResponse(200).response,
    countingResponse(200).response,
    countingResponse(200).response,
  ]);
  for (let drive = 0; drive < 3; drive += 1) {
    await runThrough(descriptor, transport);
    await drainMacrotask();
  }
  return transport.calls.map(call => call.request.headers.get('Authorization'));
}

/**
 * A provider issuing `t1` at `firstExpiresAt` and then `t2` far out of any margin's reach, counting
 * its calls. Every test below pins the clock at 0, so `firstExpiresAt` IS t1's remaining lifetime.
 */
function agingTokenProvider(firstExpiresAt: number): {
  readonly credentials: AuthCredentialSet;
  readonly callCount: () => number;
} {
  let issued = 0;
  return {
    credentials: {
      bearer: {
        provider: () => {
          issued += 1;
          return Promise.resolve(
            createBearerToken(
              `t${String(issued)}`,
              issued === 1 ? firstExpiresAt : 10_000_000,
            ),
          );
        },
      },
    },
    callCount: () => issued,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('availableSchemesOf (AUTH-5)', () => {
  test('is empty for an empty credential set', () => {
    expect([...availableSchemesOf({})]).toEqual([]);
  });

  test('maps each configured credential to its scheme', () => {
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
      digest: {username: 'u', password: 'p'},
      bearer: {provider: () => Promise.resolve(createBearerToken('t'))},
      apiKey: {credential: new ApiKeyCredential('k')},
    };
    expect([...availableSchemesOf(credentials)].sort()).toEqual([
      'API_KEY',
      'BASIC',
      'DIGEST',
      'OAUTH2',
    ]);
  });
});

describe('authStep: resolution and the preemptive stamp (AUTH-26..AUTH-28, AUTH-34)', () => {
  test('is pinned to the AUTH pillar stage (AUTH-27)', () => {
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});
    expect(descriptor.stage).toBe('AUTH');
    expect(descriptor.type).toBe(AUTH_STEP_TYPE);
  });

  test('NO_AUTH stamps nothing and never triggers the HTTPS guard, even over plain HTTP (AUTH-28)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});

    await runThrough(descriptor, transport, {
      request: aRequest('http://example.com/a'),
    });

    expect(
      transport.calls[0]?.request.headers.get('Authorization'),
    ).toBeUndefined();
  });

  test('API_KEY stamps preemptively via the configured header/prefix (AUTH-26)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {
        credential: new ApiKeyCredential('secret'),
        headerName: 'X-Api-Key',
      },
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});

    await runThrough(descriptor, transport);

    expect(transport.calls[0]?.request.headers.get('X-Api-Key')).toBe('secret');
  });

  test('OAUTH2 stamps a cached bearer token preemptively (AUTH-34)', async () => {
    const transport = new FakeTransport([
      countingResponse(200).response,
      countingResponse(200).response,
    ]);
    let calls = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          calls += 1;
          return Promise.resolve(
            createBearerToken(`t${String(calls)}`, 100_000),
          );
        },
      },
    };
    const descriptor = authStep({
      credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    await runThrough(descriptor, transport);
    await runThrough(descriptor, transport);

    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe(
      'Bearer t1',
    );
    // The second call reads the still-fresh cached token rather than refetching.
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe(
      'Bearer t1',
    );
    expect(calls).toBe(1);
  });
});

describe('authStep: the HTTPS guard and tier resolution (AUTH-6/AUTH-28)', () => {
  test('a credentialed scheme over plain HTTP throws PlaintextCredentialError before any send (AUTH-28)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret')},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});

    const error = await rejectionOf(
      runThrough(descriptor, transport, {
        request: aRequest('http://example.com/a'),
      }),
    );

    expect(error).toBeInstanceOf(PlaintextCredentialError);
    expect((error as PlaintextCredentialError).scheme).toBe('API_KEY');
    expect(transport.sendCount).toBe(0);
  });

  test('the guard fires before the token fetch, not after (AUTH-28)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    let fetched = false;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          fetched = true;
          return Promise.resolve(createBearerToken('t', 100_000));
        },
      },
    };
    const descriptor = authStep({
      credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    await rejectionOf(
      runThrough(descriptor, transport, {
        request: aRequest('http://example.com/a'),
      }),
    );

    expect(fetched).toBe(false);
  });

  test('an unsatisfiable tier surfaces AuthResolutionError (AUTH-6)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const descriptor = authStep({credentials: {}, tiers: tiersFor('BASIC')});

    const error = await rejectionOf(runThrough(descriptor, transport));

    expect(error).toBeInstanceOf(AuthResolutionError);
    expect(transport.sendCount).toBe(0);
  });

  test('BASIC/DIGEST never stamp preemptively -- the outbound request carries no Authorization', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    await runThrough(descriptor, transport);

    expect(
      transport.calls[0]?.request.headers.get('Authorization'),
    ).toBeUndefined();
  });
});

describe('authStep: the cross-origin marker (AUTH-29)', () => {
  test('AUTH-29: a cross-origin-marked request skips the guard and stamping, marker cleared', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret')},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});
    // Plain HTTP -- would normally trip the guard, but the marker skips it (AUTH-29).
    const marked = markedRequest('http://example.com/a');

    await runThrough(descriptor, transport, {request: marked});

    const sent = transport.calls[0]?.request;
    expect(sent?.headers.get('Authorization')).toBeUndefined();
    expect(sent?.headers.has(CROSS_ORIGIN_MARKER_HEADER)).toBe(false);
  });

  test('AUTH-29: the marker is cleared even on the ordinary same-origin path', async () => {
    // An unmarked request has nothing to clear, but a marked HTTPS request on a stamping path must
    // still not forward the header -- clearing happens before the branch, not inside one of them.
    const transport = new FakeTransport([countingResponse(200).response]);
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});

    await runThrough(descriptor, transport, {
      request: markedRequest('https://example.com/a'),
    });

    expect(
      transport.calls[0]?.request.headers.has(CROSS_ORIGIN_MARKER_HEADER),
    ).toBe(false);
  });

  test('AUTH-29: a cross-origin-marked request does NOT answer a challenge either', async () => {
    // The suppression covers the whole hop. Answering the challenge here would stamp exactly the
    // credential the outbound pass declined to send, onto the server-chosen foreign host, over a URL
    // whose HTTPS guard was skipped -- the precise leak AUTH-29 exists to prevent.
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport, {
      request: markedRequest('http://evil.example/a'),
    });

    expect(transport.sendCount).toBe(1); // no re-drive was attempted
    expect(response).toBe(challenged.response); // unchanged and unclosed -- the caller owns it
    expect(challenged.cancelCount()).toBe(0);
  });
});

describe('authStep: challenge detection (AUTH-25/AUTH-33)', () => {
  test('a 407 is answered from Proxy-Authenticate into Proxy-Authorization (AUTH-25)', async () => {
    const challenged = challengeResponse(
      407,
      'Proxy-Authenticate',
      'Basic realm="p"',
    );
    const success = countingResponse(200);
    const transport = new FakeTransport([
      challenged.response,
      success.response,
    ]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(2);
    expect(
      transport.calls[1]?.request.headers
        .get('Proxy-Authorization')
        ?.startsWith('Basic '),
    ).toBe(true);
    expect(
      transport.calls[1]?.request.headers.get('Authorization'),
    ).toBeUndefined();
  });

  test('a 401 carrying only Proxy-Authenticate is NOT answered (AUTH-25)', async () => {
    const challenged = challengeResponse(
      401,
      'Proxy-Authenticate',
      'Basic realm="p"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(1);
    expect(response).toBe(challenged.response);
  });
});

describe('authStep: challenge detection, negative cases (AUTH-33)', () => {
  test('a 401 without WWW-Authenticate is returned unchanged (AUTH-33)', async () => {
    const the401 = countingResponse(401);
    const transport = new FakeTransport([the401.response]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport);

    expect(response).toBe(the401.response);
    expect(transport.sendCount).toBe(1);
    expect(the401.cancelCount()).toBe(0);
  });

  test('a non-challenge status is returned untouched', async () => {
    const success = countingResponse(200);
    const transport = new FakeTransport([success.response]);
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});

    expect(await runThrough(descriptor, transport)).toBe(success.response);
  });
});

describe('authStep: the challenge replay (AUTH-30/AUTH-31)', () => {
  test('a 401 with a Basic challenge re-drives exactly once with the stamped Authorization (AUTH-30)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const success = countingResponse(200);
    const transport = new FakeTransport([
      challenged.response,
      success.response,
    ]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(2);
    expect(
      transport.calls[1]?.request.headers
        .get('Authorization')
        ?.startsWith('Basic '),
    ).toBe(true);
    expect(response).toBe(success.response);
    expect(challenged.cancelCount()).toBe(1); // AUTH-30: the original is closed before the re-drive
  });

  test('no nested re-challenge: a second 401 on the replay is returned as-is (AUTH-30)', async () => {
    const first = challengeResponse(401, 'WWW-Authenticate', 'Basic realm="x"');
    const second = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([first.response, second.response]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(2); // exactly one replay, not a loop
    expect(response).toBe(second.response);
    expect(second.cancelCount()).toBe(0); // the surfaced response is the caller's, left open
  });
});

describe('authStep: answering a Digest challenge (AUTH-15..AUTH-22)', () => {
  test('a Digest challenge is answered with a Digest header value (AUTH-15..22)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Digest realm="r", nonce="n", qop="auth"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const credentials: AuthCredentialSet = {
      digest: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('DIGEST')});

    await runThrough(descriptor, transport, {
      request: aRequest('https://example.com/a?q=1'),
    });

    const value = transport.calls[1]?.request.headers.get('Authorization');
    expect(value?.startsWith('Digest ')).toBe(true);
    // AUTH-22: the digest-uri is the request-target, path AND query.
    expect(value).toContain('uri="/a?q=1"');
  });
});

describe('authStep: the replayability gate (AUTH-31)', () => {
  test('an unsatisfiable challenge leaves the response unchanged (AUTH-25/AUTH-33)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Negotiate abc123',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(1);
    expect(response).toBe(challenged.response);
    expect(challenged.cancelCount()).toBe(0);
  });

  // AUTH-31 gates the DISPATCH only. The hook still runs for a one-shot body -- there is deliberately
  // no "skip the hook when the body is one-shot" fast path (see `handleChallenge`), because OAUTH2's
  // default hook evicts the rejected token on the way past and that work is not wasted. What this
  // test pins is the replay gate's own three obligations; the eviction half is pinned separately by
  // 'a revoked token is evicted even though the replay is skipped' below.
  test('a non-replayable body surfaces the original 401 unchanged and unclosed, with no replay (AUTH-31)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const credentials: AuthCredentialSet = {
      basic: {username: 'u', password: 'p'},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport, {
      request: oneShotPost(),
    });

    expect(response).toBe(challenged.response);
    expect(transport.sendCount).toBe(1); // no replacement dispatch was attempted
    expect(challenged.cancelCount()).toBe(0); // the caller owns it -- MUST NOT be closed
  });

  test('AUTH-31 also gates a caller hook that returns a non-replayable replacement', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: () => Promise.resolve(oneShotPost()),
    });

    const response = await runThrough(descriptor, transport);

    expect(response).toBe(challenged.response);
    expect(transport.sendCount).toBe(1);
    expect(challenged.cancelCount()).toBe(0);
  });
});

describe('authStep: challenge-hook failure and override (AUTH-30/AUTH-32/AUTH-33)', () => {
  test('a throwing challengeHook closes the 401 before propagating (AUTH-32)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: () => Promise.reject(new Error('hook exploded')),
    });

    const error = await rejectionOf(runThrough(descriptor, transport));

    expect((error as Error).message).toBe('hook exploded');
    expect(challenged.cancelCount()).toBe(1);
  });

  test('a hook throwing SYNCHRONOUSLY also closes the 401 (AUTH-32/AUTH-38)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: (): Promise<Request | undefined> => {
        throw new Error('sync boom');
      },
    });

    const error = await rejectionOf(runThrough(descriptor, transport));

    expect((error as Error).message).toBe('sync boom');
    expect(challenged.cancelCount()).toBe(1);
  });

  test('a hook yielding nothing leaves the 401 unchanged and unclosed (AUTH-33)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: () => Promise.resolve(undefined),
    });

    const response = await runThrough(descriptor, transport);

    expect(response).toBe(challenged.response);
    expect(challenged.cancelCount()).toBe(0);
  });
});

describe('authStep: hook override and non-reactive schemes (AUTH-30)', () => {
  test('a caller-supplied challengeHook takes precedence over the scheme default (AUTH-30)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    let hookInvoked = false;
    const descriptor = authStep({
      credentials: {basic: {username: 'u', password: 'p'}},
      tiers: tiersFor('BASIC'),
      challengeHook: (_response, request) => {
        hookInvoked = true;
        return Promise.resolve(
          request
            .newBuilder()
            .headers(
              request.headers
                .newBuilder()
                .set('Authorization', 'Custom xyz')
                .build(),
            )
            .build(),
        );
      },
    });

    await runThrough(descriptor, transport);

    expect(hookInvoked).toBe(true);
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe(
      'Custom xyz',
    );
  });
});

describe('authStep: schemes with no reactive behavior (AUTH-30)', () => {
  test('API_KEY does not react to a 401 -- static credentials have no reactive behavior (AUTH-30)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret')},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(1);
    expect(response).toBe(challenged.response);
  });
});

describe('authStep: the OAUTH2 default hook (AUTH-36)', () => {
  test('OAUTH2 default hook evicts the exact rejected token and re-stamps (AUTH-36)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Bearer realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    let calls = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          calls += 1;
          return Promise.resolve(
            createBearerToken(`t${String(calls)}`, 100_000),
          );
        },
      },
    };
    const descriptor = authStep({
      credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    await runThrough(descriptor, transport);

    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe(
      'Bearer t1',
    );
    // Evicted t1, fetched genuinely fresh.
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe(
      'Bearer t2',
    );
    expect(calls).toBe(2);
  });
});

/**
 * Holds one nominated send until {@link GatedTransport.release} is called, so a two-drive
 * interleaving can be pinned instead of left to the scheduler. Everything else delegates to the
 * scripted double.
 */
class GatedTransport implements Transport {
  readonly #inner: FakeTransport;
  readonly #gatedEntry: number;
  #entered = 0;
  #release: (() => void) | undefined;
  readonly #gate: Promise<void>;

  constructor(inner: FakeTransport, gatedEntry: number) {
    this.#inner = inner;
    this.#gatedEntry = gatedEntry;
    this.#gate = new Promise<void>(resolve => {
      this.#release = resolve;
    });
  }

  release(): void {
    this.#release?.();
  }

  async send(request: Request): Promise<Response> {
    // Counted on ENTRY, not off the inner double's `sendCount`: a gated call has not reached the
    // inner transport yet, so `sendCount` would still be pointing at the gated position and every
    // later call would gate too -- a deadlock, which is exactly what the first shape of this did.
    this.#entered += 1;
    if (this.#entered === this.#gatedEntry) await this.#gate;
    return this.#inner.send(request);
  }

  async close(): Promise<void> {
    // Nothing to release; the inner double owns no resources.
  }
}

describe('authStep: OAUTH2 preserves a token another request refreshed (AUTH-36)', () => {
  test('a 401 on a token the cache has already replaced stamps the survivor, with no second fetch', async () => {
    // AUTH-36's "preserving a token another request already refreshed", at the seam where it is
    // actually observable. Two drives both stamp `t1` off one single-flight fetch. Drive A's 401
    // runs to completion first -- evicting `t1` and caching `t2` -- and only then is drive B's 401
    // released. B's rejected header (`t1`) no longer matches the cache (`t2`), so the eviction
    // PRESERVES `t2` and the retry stamps it. Burning a third provider call to re-derive the same
    // token, which the earlier unconditional-`refreshNow()` shape did, is what makes the clause a
    // no-op rather than a behaviour.
    // Scripted in the order the inner double actually SEES them, which the gate pins: A's 401, A's
    // replay, then B's 401 and B's replay once released.
    const inner = new FakeTransport([
      challengeResponse(401, 'WWW-Authenticate', 'Bearer realm="x"').response,
      countingResponse(200).response,
      challengeResponse(401, 'WWW-Authenticate', 'Bearer realm="x"').response,
      countingResponse(200).response,
    ]);
    const transport = new GatedTransport(inner, 2); // hold drive B's first send
    let calls = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          calls += 1;
          return Promise.resolve(
            createBearerToken(`t${String(calls)}`, 100_000),
          );
        },
      },
    };
    const descriptor = authStep({
      credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    const driveA = runThrough(descriptor, transport);
    const driveB = runThrough(descriptor, transport);
    await driveA;
    transport.release();
    await driveB;

    expect(calls).toBe(2); // the initial fetch and A's post-eviction fetch. B fetched nothing.
    expect(inner.calls[2]?.request.headers.get('Authorization')).toBe(
      'Bearer t1', // B's original stamp, the one the server rejected
    );
    expect(inner.calls[3]?.request.headers.get('Authorization')).toBe(
      'Bearer t2', // the PRESERVED token, stamped without a third fetch
    );
  });
});

describe('authStep: OAUTH2 declines a non-Bearer challenge (AUTH-36)', () => {
  test('OAUTH2 leaves a 401 unchanged when it advertises no Bearer challenge (AUTH-36)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    let calls = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          calls += 1;
          return Promise.resolve(
            createBearerToken(`t${String(calls)}`, 100_000),
          );
        },
      },
    };
    const descriptor = authStep({
      credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(1);
    expect(response).toBe(challenged.response);
    expect(calls).toBe(1); // no eviction-driven refetch
  });
});

describe('authStep: the replay HTTPS guard (AUTH-28)', () => {
  test('AUTH-28 is re-applied to a challenge replacement that carries a credential', async () => {
    // The outbound guard is SKIPPED for NO_AUTH, and nothing constrains a caller hook to preserve the
    // URL -- so without a second guard a hook answering a challenge stamps a credential over plaintext.
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'), // outbound guard skipped entirely
      challengeHook: (_response, request) =>
        Promise.resolve(
          request
            .newBuilder()
            .headers(
              request.headers
                .newBuilder()
                .set('Authorization', 'Basic c3B5')
                .build(),
            )
            .build(),
        ),
    });

    const error = await rejectionOf(
      runThrough(descriptor, transport, {
        request: aRequest('http://example.com/a'),
      }),
    );

    expect(error).toBeInstanceOf(PlaintextCredentialError);
    expect(transport.sendCount).toBe(1); // the replacement never reached the wire
    expect(challenged.cancelCount()).toBe(1); // and the 401 was closed before the throw, not leaked
  });

  test('a credential-free replacement over plaintext is NOT blocked by the replay guard (AUTH-28/AUTH-29)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const success = countingResponse(200);
    const transport = new FakeTransport([
      challenged.response,
      success.response,
    ]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: (_response, request) =>
        Promise.resolve(
          request.newBuilder().url('http://example.com/b').build(),
        ),
    });

    const response = await runThrough(descriptor, transport, {
      request: aRequest('http://example.com/a'),
    });

    expect(transport.sendCount).toBe(2);
    expect(response).toBe(success.response);
  });
});

describe('authStep: per-call configuration and injected seams (AUTH-4/AUTH-11)', () => {
  test('a per-call RequestOptions.auth descriptor overrides the configured tiers (AUTH-4)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {
        credential: new ApiKeyCredential('secret'),
        headerName: 'X-Api-Key',
      },
    };
    // Configured tiers resolve to API_KEY; the per-call descriptor demands NO_AUTH and must win.
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});
    const options = RequestOptions.newBuilder()
      .auth(createAuthDescriptor([createAuthRequirement('NO_AUTH')]))
      .build();

    await runThrough(descriptor, transport, {options});

    expect(
      transport.calls[0]?.request.headers.get('X-Api-Key'),
    ).toBeUndefined();
  });

  test('a per-call descriptor that is unsatisfiable does NOT fall through to the client tier (AUTH-4)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret')},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});
    const options = RequestOptions.newBuilder()
      .auth(createAuthDescriptor([createAuthRequirement('BASIC')]))
      .build();

    const error = await rejectionOf(
      runThrough(descriptor, transport, {options}),
    );

    expect(error).toBeInstanceOf(AuthResolutionError);
    expect(transport.sendCount).toBe(0);
  });
});

describe('authStep: answering an unrecognized scheme through challengeHook', () => {
  // There is deliberately no `AuthStepSettings.handlers`: `challengeHook` is the ONE caller-facing
  // extension point, and it covers the case a handler list was reaching for -- a scheme none of the
  // built-in handlers recognizes -- without putting `ChallengeHandler` on the public barrel where
  // neither `basicHandler` nor `digestHandler` is reachable to compose with.
  test('a challengeHook answers a scheme no built-in handler recognizes', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Custom realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const descriptor = authStep({
      credentials: {basic: {username: 'u', password: 'p'}},
      tiers: tiersFor('BASIC'),
      challengeHook: (_response, request) =>
        Promise.resolve(
          request
            .newBuilder()
            .headers(
              request.headers
                .newBuilder()
                .set('Authorization', 'Custom abc')
                .build(),
            )
            .build(),
        ),
    });

    await runThrough(descriptor, transport);

    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe(
      'Custom abc',
    );
  });
});

describe('authStep: the call signal', () => {
  test('the call signal reaches the challenge hook (AUTH-30)', async () => {
    // A hook is the sanctioned place for a custom OAuth2 refresh grant, i.e. network I/O on the
    // request path, so it must be able to observe the caller's cancellation.
    const transport = new FakeTransport([
      challengeResponse(401, 'WWW-Authenticate', 'Basic realm="x"').response,
      countingResponse(200).response,
    ]);
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: (_response, request, options) => {
        observed = options?.signal;
        return Promise.resolve(request);
      },
    });
    const request = aRequest();

    await new Cursor({
      steps: [descriptor],
      transport,
      request,
      context: aRequestContext(request),
      signal: controller.signal,
    }).advance();

    expect(observed).toBe(controller.signal);
  });

  // There is deliberately no "the provider is not given the call signal" test any more: after M6,
  // `TokenProvider` is `() => Promise<BearerToken>` and has no parameter to populate, so the property
  // is structural. A test for it would only be exercising the type checker.
});

describe('authStep: a failing release never masks the primary error (RECOV-12)', () => {
  test("a rejecting close() keeps the HOOK's own error primary (AUTH-32)", async () => {
    // `Response.close()` rethrows whatever cancelling the body raised, so a bare
    // `await response.close(); throw error;` discarded the hook's failure and surfaced the teardown
    // failure in its place -- the inversion RECOV-12 forbids, and the one 5b's `decideOrClose`
    // already guards against with the same two helpers.
    const hookFailure = new Error('hook exploded');
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: () => Promise.reject(hookFailure),
    });

    const error = await rejectionOf(
      runThrough(descriptor, new FakeTransport([hostileChallenge()])),
    );

    const suppressed = error as SuppressedErrorLike;
    expect(suppressed.error).toBe(hookFailure);
    expect(suppressed.suppressed).toBe(CANCEL_FAILURE);
  });

  test('a rejecting close() keeps PlaintextCredentialError primary on the replay guard (AUTH-28)', async () => {
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      // A replacement that downgrades to http AND carries a credential: AUTH-28 must refuse it, and
      // that refusal is what the caller has to be able to see.
      challengeHook: () =>
        Promise.resolve(
          Request.newBuilder()
            .url('http://example.com/a')
            .headers(
              Headers.newBuilder().set('Authorization', 'Bearer t').build(),
            )
            .build(),
        ),
    });

    const error = await rejectionOf(
      runThrough(descriptor, new FakeTransport([hostileChallenge()])),
    );

    const suppressed = error as SuppressedErrorLike;
    expect(suppressed.error).toBeInstanceOf(PlaintextCredentialError);
    expect(suppressed.suppressed).toBe(CANCEL_FAILURE);
  });
});

describe('authStep: a non-replayable body still evicts (AUTH-31 vs AUTH-36)', () => {
  test('a revoked token is evicted even though the replay is skipped', async () => {
    // AUTH-31 gates the REPLAY on replayability; AUTH-36's eviction is a separate sentence. An
    // earlier shape skipped the whole hook for a one-shot body, which left the token the server had
    // just rejected sitting in the cache -- and a token with no `expiresAt` (AUTH-10's "never locally
    // expires") never aged out either, so a stream-only client re-sent the dead credential forever.
    let issued = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: () => {
          issued += 1;
          return Promise.resolve(createBearerToken(`t${String(issued)}`));
        },
      },
    };
    const descriptor = authStep({credentials, tiers: tiersFor('OAUTH2')});

    const first = challengeResponse(
      401,
      'WWW-Authenticate',
      'Bearer realm="x"',
    );
    const firstDrive = await runThrough(
      descriptor,
      new FakeTransport([first.response]),
      {
        request: oneShotPost(),
      },
    );
    const second = challengeResponse(
      401,
      'WWW-Authenticate',
      'Bearer realm="x"',
    );
    const secondTransport = new FakeTransport([second.response]);
    await runThrough(descriptor, secondTransport, {request: oneShotPost()});

    // AUTH-31 still holds: the original is surfaced unchanged and NOT closed.
    expect(firstDrive.status.code).toBe(401);
    expect(first.cancelCount()).toBe(0);
    // AUTH-36 now also holds: the second request carries a freshly fetched token, not the dead one.
    expect(secondTransport.calls[0]?.request.headers.get('Authorization')).toBe(
      'Bearer t2',
    );
  });
});

describe('authStep: refresh-margin validation (AUTH-34/AUTH-35)', () => {
  // `nowMs + marginMs > expiresAt` is false for a NaN margin, so BOTH the margin check and AUTH-35's
  // no-margin check say "not expired" and the cache serves a dead token from the hot path forever.
  // Same rule and wording 5a's `retrySettings()` and 5b's `redirectSettings()` apply.
  test('rejects a non-finite bearerMarginMs', () => {
    expect(() =>
      authStep({
        credentials: {},
        tiers: tiersFor('NO_AUTH'),
        bearerMarginMs: Number.NaN,
      }),
    ).toThrow('finite, non-negative duration');
  });

  test('rejects a negative bearerMarginMs', () => {
    expect(() =>
      authStep({
        credentials: {},
        tiers: tiersFor('NO_AUTH'),
        bearerMarginMs: -1,
      }),
    ).toThrow('finite, non-negative duration');
  });

  test('rejects a non-finite per-credential marginMs', () => {
    expect(() =>
      authStep({
        credentials: {
          bearer: {
            provider: () => Promise.resolve(createBearerToken('t')),
            marginMs: Number.NaN,
          },
        },
        tiers: tiersFor('OAUTH2'),
      }),
    ).toThrow('finite, non-negative duration');
  });
});

describe('authStep: the bearer refresh margin, in effect (AUTH-34/AUTH-37)', () => {
  // The margin was validated at construction but its EFFECT was unasserted: both
  // `AuthStepSettings.bearerMarginMs`'s 30 s default and `BearerCredential.marginMs`'s override could
  // be deleted outright and every test still passed. AUTH-34 names the 30 s default itself, and
  // `marginMs` is public surface, so both need a test that fails when the number changes.
  // The two tests below pin the default from BOTH sides, deliberately. A single "a token 20 s out
  // gets refreshed" assertion is satisfied by any margin >= 20 s, so it cannot tell 30 s from 60 s;
  // the pair brackets the boundary at exactly 30 000 ms.
  test("a token expiring just INSIDE AUTH-34's 30 s default is refreshed in the background", async () => {
    const aging = agingTokenProvider(29_999);
    const descriptor = authStep({
      credentials: aging.credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    const stamped = await stampsOverThreeDrives(descriptor);

    // Drive 2 stamps the stale-but-valid t1 and kicks off the refresh; drive 3 sees t2 (AUTH-37).
    expect(stamped).toEqual(['Bearer t1', 'Bearer t1', 'Bearer t2']);
    expect(aging.callCount()).toBe(2);
  });

  test('a token expiring just OUTSIDE the 30 s default stays in the fresh zone', async () => {
    const aging = agingTokenProvider(30_001);
    const descriptor = authStep({
      credentials: aging.credentials,
      tiers: tiersFor('OAUTH2'),
      clock: {now: () => 0},
    });

    const stamped = await stampsOverThreeDrives(descriptor);

    expect(stamped).toEqual(['Bearer t1', 'Bearer t1', 'Bearer t1']);
    expect(aging.callCount()).toBe(1);
  });

  test('a per-credential marginMs overrides the step-wide one', async () => {
    const aging = agingTokenProvider(29_999);
    const bearer = aging.credentials.bearer;
    invariant(bearer !== undefined, 'agingTokenProvider configures a bearer');
    const descriptor = authStep({
      credentials: {bearer: {...bearer, marginMs: 30_000}},
      tiers: tiersFor('OAUTH2'),
      bearerMarginMs: 0, // the step-wide margin alone would leave t1 in the fresh zone forever
      clock: {now: () => 0},
    });

    const stamped = await stampsOverThreeDrives(descriptor);

    expect(stamped).toEqual(['Bearer t1', 'Bearer t1', 'Bearer t2']);
    expect(aging.callCount()).toBe(2);
  });

  test('an explicit zero margin beats the default and suppresses the background refresh', async () => {
    const aging = agingTokenProvider(29_999); // inside the default margin, outside a zero one
    const descriptor = authStep({
      credentials: aging.credentials,
      tiers: tiersFor('OAUTH2'),
      bearerMarginMs: 0,
      clock: {now: () => 0},
    });

    const stamped = await stampsOverThreeDrives(descriptor);

    expect(stamped).toEqual(['Bearer t1', 'Bearer t1', 'Bearer t1']);
    expect(aging.callCount()).toBe(1);
  });
});

describe('authStep: the replay HTTPS guard covers Proxy-Authorization too (AUTH-25/AUTH-28)', () => {
  test('a replacement carrying only Proxy-Authorization over plaintext is refused', async () => {
    // AUTH-28 says ANY path where a credential will be attached, and AUTH-25 makes
    // `Proxy-Authorization` exactly such a path for a 407. The guard's `Authorization` arm was
    // asserted and this one was not, so dropping it left a proxy credential able to go out over
    // plaintext with the whole suite green.
    const challenged = challengeResponse(
      407,
      'Proxy-Authenticate',
      'Basic realm="p"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'), // outbound guard skipped entirely
      challengeHook: (_response, request) =>
        Promise.resolve(
          request
            .newBuilder()
            .headers(
              request.headers
                .newBuilder()
                .set('Proxy-Authorization', 'Basic c3B5')
                .build(),
            )
            .build(),
        ),
    });

    const error = await rejectionOf(
      runThrough(descriptor, transport, {
        request: aRequest('http://example.com/a'),
      }),
    );

    expect(error).toBeInstanceOf(PlaintextCredentialError);
    expect(transport.sendCount).toBe(1); // the replacement never reached the wire
    expect(challenged.cancelCount()).toBe(1); // and the 407 was closed before the throw
  });
});

describe('authStep: a challenge this client cannot echo (AUTH-21/AUTH-22)', () => {
  test('a non-ASCII Digest realm surfaces the 401 unchanged rather than throwing', async () => {
    // HTTP-19 lets a received field-value carry obs-text, so `realm="café"` -- a real RFC 7616 shape,
    // which is why the spec has a `charset` parameter at all -- reaches us intact. HTTP-18 will not
    // let it back out. `parseDigestChallenge` declines, so AUTH-33 surfaces the 401 open and
    // unchanged; building the header anyway threw HeaderValidationError out of the whole step.
    const challenge = challengeResponse(
      401,
      'WWW-Authenticate',
      'Digest realm="café", nonce="n", algorithm=MD5, charset=UTF-8',
    );
    const transport = new FakeTransport([challenge.response]);
    const descriptor = authStep({
      credentials: {digest: {username: 'u', password: 'p'}},
      tiers: tiersFor('DIGEST'),
    });

    const response = await runThrough(descriptor, transport);

    expect(response.status.code).toBe(401);
    expect(transport.sendCount).toBe(1); // no replay
    expect(challenge.cancelCount()).toBe(0); // AUTH-33: returned open, the caller's to close
  });
});

describe('authStep: cancellation (AUTH-30)', () => {
  test('a call already aborted at entry runs no step, no hook, and no wire send (V15)', async () => {
    // The default OAUTH2 hook does an IdP round trip and the BASIC/DIGEST one does key derivation.
    // Neither is worth doing for a caller who has already gone, so the hook is not even built.
    //
    // Strengthened 2026-09-02: the cursor now refuses the walk at the first step boundary, so a
    // pre-aborted call spends NO wire send either and rejects with `CancellationError` rather than
    // handing back the 401. The auth step's OWN abort guard is what the next test covers -- an
    // abort arriving during the hook, which the cursor never sees.
    let hookRan = false;
    const controller = new AbortController();
    controller.abort();
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: (_response, request) => {
        hookRan = true;
        return Promise.resolve(request);
      },
    });

    const {CancellationError} = await import('../seams/transport.js');
    const error = await rejectionOf(
      runThrough(descriptor, transport, {signal: controller.signal}),
    );

    expect(error).toBeInstanceOf(CancellationError);
    expect(hookRan).toBe(false);
    expect(transport.sendCount).toBe(0);
    expect(challenged.cancelCount()).toBe(0); // never dispatched, so nothing to close
  });

  test('an abort arriving DURING the hook still spends no second wire send', async () => {
    // `redirectStep` checks `signal?.aborted` before each hop and the retry engine before each
    // attempt; the auth step must not be the one pillar that dispatches for a caller who has gone.
    const controller = new AbortController();
    const transport = new FakeTransport([
      challengeResponse(401, 'WWW-Authenticate', 'Basic realm="x"').response,
      countingResponse(200).response,
    ]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: (_response, request) => {
        controller.abort(); // the caller gives up while the hook is running
        return Promise.resolve(request);
      },
    });

    const response = await runThrough(descriptor, transport, {
      signal: controller.signal,
    });

    expect(response.status.code).toBe(401); // surfaced open, like every other no-replay outcome
    expect(transport.sendCount).toBe(1);
  });
});
