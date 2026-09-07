// SPDX-License-Identifier: MIT
// tests/conformance/xcut/security-by-default.conformance.test.ts
// Exercises: XCUT-17 (redirect credential hygiene -- Authorization stripped before EVERY re-issue,
// origin-scoped credentials additionally stripped cross-origin), XCUT-16 (no credential is ever
// stamped over a non-HTTPS transport, and the refusal lands BEFORE any token fetch).
// Exercises: XCUT-19 (default-deny log redaction, clause (a) userinfo and clause (b) query values) on
// the rejected-redirect path, with OBS-11, OBS-12 and REDIR-28 as the requirements it lands under.
//
// These run over a real two-origin socket pair through the composed retry+redirect+auth+logging
// pipeline. 5b's own tests decide the hop in isolation against constructed inputs; this is the first
// place the decision runs with a live auth step installed behind it.
//
// Clauses that stay retrofit citations at their own phases' tests, because a plaintext fixture cannot
// reach them and XCUT-16 is precisely why:
//   XCUT-17(c) userinfo dropped   -> packages/core/src/redirect/decide.test.ts (REDIR-12)
//   XCUT-17(d) HTTPS->HTTP denied -> packages/core/src/redirect/decide.test.ts (REDIR-14/15) and
//                                    redirect-step.test.ts
//   XCUT-16 unit-level            -> packages/core/src/auth/auth-step.test.ts (AUTH-28)
//   XCUT-18 header splitting      -> packages/core/src/http/headers.test.ts
//   XCUT-19 default-deny redaction-> packages/core/src/observability/redaction.test.ts
//   XCUT-20 observability never throws -> packages/core/src/observability/logging-step.test.ts
//   XCUT-21 CSPRNG cnonce         -> packages/core/src/auth/digest.test.ts (AUTH-20)
//
// Also exercises: XCUT-16/AUTH-28 on the CHALLENGE-REPLAY path -- a hop the outbound pass guarded
// stays guarded, so a `challengeHook` that answers a 401 by downgrading to `http://` is refused
// whatever header it carries the credential in (audit #67 / #71).
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  createLogger,
  Headers,
  NonReplayableBodyError,
  NOOP_LOGGER,
  NameKeyCredential,
  PlaintextCredentialError,
  Protocol,
  Request,
  setGlobalLogger,
  streamBody,
  type AuthStepSettings,
  type Method,
  Response,
  Status,
  type Transport,
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

/** The credentials a caller sets by hand, which the redirect pillar must police on every hop. */
function callerCredentials(): Headers {
  return Headers.newBuilder()
    .set('authorization', 'Bearer caller-set')
    .set('cookie', 'sid=abc')
    .build();
}

/** Reads the fixture's echo of what actually arrived at the final hop. */
async function followAndEcho(
  path: string,
): Promise<{authorization: string | null; cookie: string | null}> {
  const pipeline = buildComposedPipeline();
  try {
    const response = await pipeline.runtime.send(
      Request.newBuilder()
        .url(`${server.url}${path}`)
        .headers(callerCredentials())
        .build(),
    );
    const body = JSON.parse(await response.text()) as {
      authorization: string | null;
      cookie: string | null;
    };
    await response.close();
    return body;
  } finally {
    await pipeline.close();
  }
}

describe('XCUT-17: Authorization is stripped before every redirect re-issue', () => {
  test('drops Authorization even on a same-origin hop', async () => {
    const echoed = await followAndEcho('/redirect-same-origin');

    // "even same-origin" is the clause that catches the tempting optimisation.
    expect(echoed.authorization).toBeNull();
  });

  test('keeps an origin-scoped Cookie on a same-origin hop', async () => {
    const echoed = await followAndEcho('/redirect-same-origin');

    // Cookie is origin-scoped, and this hop has not left the origin: stripping it here would be
    // over-broad, and XCUT-17 scopes the extra stripping to the cross-origin case.
    expect(echoed.cookie).toBe('sid=abc');
  });
});

describe('XCUT-17: origin-scoped credentials are additionally stripped cross-origin', () => {
  test('drops Authorization on a cross-origin hop', async () => {
    const echoed = await followAndEcho('/redirect-cross-origin');

    expect(echoed.authorization).toBeNull();
  });

  test('drops the Cookie on a cross-origin hop', async () => {
    const echoed = await followAndEcho('/redirect-cross-origin');

    // Judged against the seed origin, not the previous hop -- the two servers are genuinely
    // different origins (different ports), not one origin under two names.
    expect(echoed.cookie).toBeNull();
  });
});

describe('XCUT-19: a rejected redirect logs no raw URL (OBS-11, OBS-12, REDIR-28)', () => {
  const SECRET = 'SUPERSECRETTOKEN';

  test('redacts the redirect target inside the rejection cause', async () => {
    // A one-shot body makes the 307 unfollowable, so `decide()` fails with the target interpolated
    // into the error message -- the one field on this path that `redactUrl` did not already cover.
    const seed = Request.newBuilder()
      .method('POST')
      .url(`${server.url}/redirect-secret-target?secret=${SECRET}`)
      .body(
        streamBody(
          new ReadableStream<Uint8Array>({
            start: c => {
              c.close();
            },
          }),
          undefined,
          0,
        ),
      )
      .build();
    const pipeline = buildComposedPipeline({
      redirect: {allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST'])},
    });
    const records: Map<string, unknown>[] = [];
    setGlobalLogger(
      createLogger((_level, fields) => {
        records.push(new Map(fields));
      }),
    );

    try {
      const rejected = await rejectionOf(pipeline.runtime.send(seed));

      expect(rejected).toBeInstanceOf(NonReplayableBodyError);
      const rejections = records.filter(
        r => r.get('event') === 'http.redirect.rejected',
      );
      expect(rejections).toHaveLength(1);
      expect(String(rejections[0]?.get('cause'))).toContain('access_token=***');
      // Nothing the whole composed pipeline emitted -- not the redirect events, not the
      // request/response pair around them -- carries the secret in clear text.
      for (const record of records) {
        for (const field of record.values()) {
          expect(String(field)).not.toContain(SECRET);
        }
      }
    } finally {
      setGlobalLogger(NOOP_LOGGER);
      await pipeline.close();
    }
  });
});

describe('XCUT-16: a credential is never stamped over a non-HTTPS transport', () => {
  test('refuses a bearer credential over http:// before fetching the token', async () => {
    let providerInvocations = 0;
    const auth: AuthStepSettings = {
      credentials: {
        bearer: {
          provider: () => {
            providerInvocations += 1;
            return Promise.resolve(
              createBearerToken('secret', Date.now() + 60_000),
            );
          },
        },
      },
      tiers: {
        operation: createAuthDescriptor([createAuthRequirement('OAUTH2')]),
      },
    };
    const pipeline = buildComposedPipeline({auth});

    const pending = pipeline.runtime.send(
      Request.newBuilder().url(`${server.url}/echo`).build(),
    );

    expect(await rejectionOf(pending)).toBeInstanceOf(PlaintextCredentialError);
    // "fail loudly BEFORE any token fetch or header write" -- a guard that ran after the fetch would
    // already have pulled a live secret over the wire, which is the leak the ordering prevents.
    expect(providerInvocations).toBe(0);
    await pipeline.close();
  });

  test('never dispatches the credentialed request at all', async () => {
    const auth: AuthStepSettings = {
      credentials: {
        bearer: {
          provider: () =>
            Promise.resolve(createBearerToken('secret', Date.now() + 60_000)),
        },
      },
      tiers: {
        operation: createAuthDescriptor([createAuthRequirement('OAUTH2')]),
      },
    };
    const pipeline = buildComposedPipeline({auth});

    await pipeline.runtime
      .send(Request.newBuilder().url(`${server.url}/echo`).build())
      .catch(() => undefined);

    expect(pipeline.dispatches()).toBe(0);
    await pipeline.close();
  });
});

/**
 * A transport that answers everything with the same 401 challenge, so the replay path can be driven
 * without a TLS fixture. `XCUT-16`'s replay clause needs an outbound hop that is HTTPS — the guard
 * cannot have run otherwise — and the plaintext fixture server above cannot provide one. The stubbed
 * transport is the same device `error-taxonomy.conformance.test.ts` uses for the inputs a live socket
 * cannot produce; everything above the transport is still the real composed pipeline.
 */
class ChallengingTransport implements Transport {
  send(request: Request): Promise<Response> {
    return Promise.resolve(
      Response.newBuilder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(401))
        .headers(
          Headers.newBuilder()
            .setInbound('WWW-Authenticate', 'Basic realm="x"')
            .build(),
        )
        .build(),
    );
  }

  async close(): Promise<void> {
    // Nothing to release: this transport never opens anything.
  }
}

describe('XCUT-16: a guarded hop stays guarded across a challenge replay', () => {
  /** `X-Api-Key`, not `Authorization`: the header this step is configured to stamp. */
  function apiKeyAuth(replacement: (request: Request) => Request): {
    auth: AuthStepSettings;
    transport: Transport;
  } {
    return {
      auth: {
        credentials: {
          apiKey: {
            credential: new NameKeyCredential('x-api-key', 'SECRET'),
            headerName: 'X-Api-Key',
          },
        },
        tiers: {
          operation: createAuthDescriptor([createAuthRequirement('API_KEY')]),
        },
        challengeHook: (_response, request) =>
          Promise.resolve(replacement(request)),
      },
      transport: new ChallengingTransport(),
    };
  }

  test('refuses a replacement that downgrades to http:// and carries the key in X-Api-Key', async () => {
    // The reported hole: the replay guard tested two header NAMES, and neither of them is the one
    // `ApiKeyCredentialConfig.headerName` told this step to stamp. The credential went out in clear
    // text with the whole suite green.
    const {auth, transport} = apiKeyAuth(request =>
      request
        .newBuilder()
        .url('http://example.com/echo')
        .headers(
          request.headers.newBuilder().set('X-Api-Key', 'SECRET').build(),
        )
        .build(),
    );
    const pipeline = buildComposedPipeline({auth, transport});

    const pending = pipeline.runtime.send(
      Request.newBuilder().url('https://example.com/echo').build(),
    );

    expect(await rejectionOf(pending)).toBeInstanceOf(PlaintextCredentialError);
    // One dispatch: the guarded outbound pass. The replay never reached the transport.
    expect(pipeline.dispatches()).toBe(1);
    await pipeline.close();
  });

  test('refuses a downgraded replacement even with no credential header on it at all', async () => {
    // The rule is "this hop was guarded", not "this replacement looks credentialed" — a hook is free
    // to invent a carrier no enumeration of header names would know to look for.
    const {auth, transport} = apiKeyAuth(request =>
      Request.newBuilder()
        .url('http://example.com/echo')
        .method(request.method)
        .build(),
    );
    const pipeline = buildComposedPipeline({auth, transport});

    const pending = pipeline.runtime.send(
      Request.newBuilder().url('https://example.com/echo').build(),
    );

    expect(await rejectionOf(pending)).toBeInstanceOf(PlaintextCredentialError);
    expect(pipeline.dispatches()).toBe(1);
    await pipeline.close();
  });
});
