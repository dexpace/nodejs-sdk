// SPDX-License-Identifier: MIT
// tests/conformance/xcut/security-by-default.conformance.test.ts
// Exercises: XCUT-17 (redirect credential hygiene -- Authorization stripped before EVERY re-issue,
// origin-scoped credentials additionally stripped cross-origin), XCUT-16 (no credential is ever
// stamped over a non-HTTPS transport, and the refusal lands BEFORE any token fetch).
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
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  Headers,
  PlaintextCredentialError,
  Request,
  type AuthStepSettings,
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
