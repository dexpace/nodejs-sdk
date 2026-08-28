// SPDX-License-Identifier: MIT
// packages/core/src/auth/preset.test.ts
// Exercises: PIPE-24 ("installs into empty pillar slots only" -- true by construction, since the preset
// always starts from a fresh PipelineBuilder), PIPE-39 (installs exactly the pillars that exist), and
// jointly with 5b: PIPE-2's "auth executes per redirect hop, not once for the whole call" plus
// AUTH-29's marker-CONSUMPTION side (5b produced the marker and routed consumption here).
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {PipelineBuilder} from '../pipeline/builder.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {CROSS_ORIGIN_MARKER_HEADER} from '../redirect/cross-origin.js';
import {REDIRECT_STEP_TYPE} from '../redirect/redirect-step.js';
import {withRedirect} from '../redirect/strip-marker-step.js';
import {RETRY_STEP_TYPE} from '../retry/retry-step.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {AUTH_STEP_TYPE} from './auth-step.js';
import {createBearerToken} from './credential.js';
import {createAuthDescriptor} from './descriptor.js';
import {standardResilience, type StandardResilienceOptions} from './preset.js';
import {createAuthRequirement} from './requirement.js';
import {LOGGING_STEP_TYPE} from '../observability/logging-step.js';

function aRequest(url = 'https://example.com/start'): Request {
  return Request.newBuilder().url(url).build();
}

// `FakeTransport` does not itself set a Location -- 5b's `decide()` reads it off `Response.headers`, so a
// scripted 3xx entry must carry one explicitly. `setInbound`, not `set`: Location is an inbound header.
function withLocation(response: Response, location: string): Response {
  return response
    .newBuilder()
    .headers(
      response.headers.newBuilder().setInbound('Location', location).build(),
    )
    .build();
}

function bearerOptions(): StandardResilienceOptions {
  return {
    auth: {
      credentials: {
        bearer: {
          provider: () => Promise.resolve(createBearerToken('tok', 60_000)),
        },
      },
      tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
      clock: {now: () => 0},
    },
  };
}

describe('standardResilience', () => {
  test('installs the resilience pillars plus 5b’s marker guard and 7b logging (PIPE-24/PIPE-39)', () => {
    const runtime = standardResilience(
      new FakeTransport([countingResponse(200).response]),
      bearerOptions(),
    );
    const types = runtime.steps.map(step => step.type);

    expect(types).toContain(REDIRECT_STEP_TYPE);
    expect(types).toContain(RETRY_STEP_TYPE);
    expect(types).toContain(AUTH_STEP_TYPE);
    expect(types).toContain(LOGGING_STEP_TYPE);
    // redirectStep + its POST_AUTH marker guard + retryStep + authStep + loggingStep.
    expect(types).toHaveLength(5);
  });

  test('the pillars flatten in redirect-then-retry-then-auth-then-logging order (AUTH-27/PIPE-2)', () => {
    const runtime = standardResilience(
      new FakeTransport([countingResponse(200).response]),
      bearerOptions(),
    );
    const order = runtime.steps.map(step => step.stage);

    expect(order.indexOf('REDIRECT')).toBeLessThan(order.indexOf('RETRY'));
    expect(order.indexOf('RETRY')).toBeLessThan(order.indexOf('AUTH'));
    expect(order.indexOf('AUTH')).toBeLessThan(order.indexOf('LOGGING'));
  });

  test('NO_AUTH is the default when no auth option is supplied', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const runtime = standardResilience(transport);

    await runtime.send(aRequest('https://example.com'));

    expect(
      transport.calls[0]?.request.headers.get('Authorization'),
    ).toBeUndefined();
  });

  test('the default NO_AUTH step does not trip the HTTPS guard on a plain-HTTP call (AUTH-28)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);

    await standardResilience(transport).send(aRequest('http://example.com'));

    expect(transport.sendCount).toBe(1);
  });
});

describe('standardResilience with redirects (PIPE-2 + AUTH-29, jointly with 5b)', () => {
  test('joint conformance (PIPE-2 + AUTH-29): credential absent on the cross-origin hop, restamped on return to same-origin', async () => {
    const toCrossOrigin = withLocation(
      countingResponse(302).response,
      'https://evil.example/mid',
    );
    const backToSeedOrigin = withLocation(
      countingResponse(302).response,
      'https://example.com/final',
    );
    const finalHop = countingResponse(200);
    const transport = new FakeTransport([
      toCrossOrigin,
      backToSeedOrigin,
      finalHop.response,
    ]);

    const runtime = standardResilience(transport, bearerOptions());
    const response = await runtime.send(aRequest());

    expect(transport.calls).toHaveLength(3);
    // Seed hop: same-origin, stamped.
    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe(
      'Bearer tok',
    );
    // Cross-origin hop: suppressed (AUTH-29).
    expect(
      transport.calls[1]?.request.headers.get('Authorization'),
    ).toBeUndefined();
    // Back to the seed origin: re-stamped, proving auth re-runs PER HOP (PIPE-2).
    expect(transport.calls[2]?.request.headers.get('Authorization')).toBe(
      'Bearer tok',
    );
    expect(response).toBe(finalHop.response);
  });
});

describe('the cross-origin marker is load-bearing on both sides (REDIR-11/AUTH-29)', () => {
  test('the internal cross-origin marker never reaches the wire (REDIR-11/AUTH-29)', async () => {
    const toCrossOrigin = withLocation(
      countingResponse(302).response,
      'https://evil.example/mid',
    );
    const transport = new FakeTransport([
      toCrossOrigin,
      countingResponse(200).response,
    ]);

    await standardResilience(transport, bearerOptions()).send(aRequest());

    for (const call of transport.calls) {
      expect(call.request.headers.has(CROSS_ORIGIN_MARKER_HEADER)).toBe(false);
    }
  });

  test('neither the redirect guard nor the marker check alone is sufficient -- both are independently necessary', async () => {
    // A minimal AUTH-stage step that IGNORES the cross-origin marker and always stamps -- standing in
    // for "what would happen if 5c's marker check were removed". With THIS step installed instead of the
    // real authStep(), the credential leaks onto the cross-origin hop, proving the marker suppresses
    // something observable rather than headers merely happening to come out empty.
    const leakyAuthStep: StepDescriptor = {
      type: Symbol('leaky-auth'),
      stage: 'AUTH',
      fn: (request, ctx) => {
        const stamped = request
          .newBuilder()
          .headers(
            request.headers
              .newBuilder()
              .set('Authorization', 'Bearer leaked')
              .build(),
          )
          .build();
        return ctx.next(stamped);
      },
    };
    const toCrossOrigin = withLocation(
      countingResponse(302).response,
      'https://evil.example/mid',
    );
    const transport = new FakeTransport([
      toCrossOrigin,
      countingResponse(200).response,
    ]);

    const runtime = withRedirect(new PipelineBuilder(transport))
      .append(leakyAuthStep)
      .build();
    await runtime.send(aRequest());

    // 5b's redirect step already strips Authorization unconditionally on every re-issue (REDIR-7), so
    // this variant demonstrates the OTHER half: a leaky auth step re-attaches a credential redirect just
    // stripped, proving 5b's stripping alone is not sufficient either. Both layers are load-bearing.
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe(
      'Bearer leaked',
    );
  });
});

describe('standardResilience logging options (Phase 7b)', () => {
  test('logging options pass through to the installed logging step', async () => {
    const {createLogger} = await import('../observability/logger.js');
    const events: string[] = [];
    const testLogger = createLogger((_level, fields) => {
      const name = fields.get('event');
      if (typeof name === 'string') events.push(name);
    });

    const transport = new FakeTransport([countingResponse(200).response]);
    const runtime = standardResilience(transport, {
      logging: {logger: testLogger, granularity: 'headers'},
    });

    await runtime.send(aRequest());

    expect(events).toEqual(['http.request', 'http.response']);
  });
});
