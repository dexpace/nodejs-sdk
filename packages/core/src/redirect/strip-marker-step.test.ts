// SPDX-License-Identifier: MIT
// packages/core/src/redirect/strip-marker-step.test.ts
// Exercises: REDIR-11(c) (the internal cross-origin marker is removed before dispatch, INDEPENDENTLY of
// whether a credential-attaching layer runs -- the porter caveat the spec names, and a live leak today
// since no auth step exists until Phase 5c). The guard is an ordinary single-invocation step: it calls
// ctx.next() and never forks. Also: withRedirect() installs the pillar step and the guard together, so a
// caller reaching for redirect support gets the safety net without knowing the marker exists.
import {describe, expect, test} from 'bun:test';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {PipelineBuilder} from '../pipeline/builder.js';
import {Cursor} from '../pipeline/cursor.js';
import {FakeTransport} from '../testing/fake-transport.js';
import {
  CROSS_ORIGIN_MARKER_HEADER,
  withCrossOriginMarker,
} from './cross-origin.js';
import {REDIRECT_STEP_TYPE} from './redirect-step.js';
import {
  STRIP_MARKER_STEP_TYPE,
  stripCrossOriginMarkerStep,
  withRedirect,
} from './strip-marker-step.js';

function aResponse(): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .headers(Headers.newBuilder().build())
    .body(null)
    .build();
}

function aRequestContext(request: Request): ExecutionContext {
  return createRequestContext(request);
}

describe('stripCrossOriginMarkerStep', () => {
  test('occupies POST_AUTH and is not a pillar step', () => {
    const descriptor = stripCrossOriginMarkerStep();
    expect(descriptor.stage).toBe('POST_AUTH');
    expect(descriptor.type).toBe(STRIP_MARKER_STEP_TYPE);
  });

  test('clears a marker present on the request, then calls next (REDIR-11c)', async () => {
    const marked = Request.newBuilder()
      .url('https://example.com')
      .headers(withCrossOriginMarker(Headers.newBuilder().build()))
      .build();
    const transport = new FakeTransport([aResponse()]);
    const cursor = new Cursor({
      steps: [stripCrossOriginMarkerStep()],
      transport,
      request: marked,
      context: aRequestContext(marked),
    });

    await cursor.advance();

    expect(transport.sendCount).toBe(1);
    expect(
      transport.calls[0]?.request.headers.get(CROSS_ORIGIN_MARKER_HEADER),
    ).toBeUndefined();
  });

  test('is a no-op when the marker is already absent', async () => {
    const bare = Request.newBuilder()
      .url('https://example.com')
      .headers(Headers.newBuilder().add('X-Other', 'kept').build())
      .build();
    const transport = new FakeTransport([aResponse()]);
    const cursor = new Cursor({
      steps: [stripCrossOriginMarkerStep()],
      transport,
      request: bare,
      context: aRequestContext(bare),
    });

    await cursor.advance();

    expect(
      transport.calls[0]?.request.headers.has(CROSS_ORIGIN_MARKER_HEADER),
    ).toBe(false);
    expect(transport.calls[0]?.request.headers.get('X-Other')).toBe('kept'); // nothing else disturbed
    // The guard runs on every request, so the common (unmarked) case must not rebuild anything: the
    // request reaches the transport as the SAME instance it was handed.
    expect(transport.calls[0]?.request).toBe(bare);
  });
});

describe('withRedirect', () => {
  test('installs both the pillar step and the guard onto the builder', () => {
    const runtime = withRedirect(
      new PipelineBuilder(new FakeTransport([aResponse()])),
    ).build();
    const types = runtime.steps.map(step => step.type);
    expect(types).toContain(REDIRECT_STEP_TYPE);
    expect(types).toContain(STRIP_MARKER_STEP_TYPE);
  });

  test('is idempotent -- a second call does not seat a second guard', () => {
    // `PipelineBuilder.append` dedupes by `type` only for PILLAR stages (PIPE-6). POST_AUTH is not
    // one, so without withRedirect()'s own `remove` the pillar half would be idempotent while the
    // guard half silently duplicated.
    const builder = new PipelineBuilder(new FakeTransport([aResponse()]));
    const runtime = withRedirect(withRedirect(builder)).build();
    const types = runtime.steps.map(step => step.type);
    expect(types.filter(type => type === STRIP_MARKER_STEP_TYPE)).toHaveLength(
      1,
    );
    expect(types.filter(type => type === REDIRECT_STEP_TYPE)).toHaveLength(1);
  });

  test('the guard sits after the pillar step in flattened order', () => {
    const runtime = withRedirect(
      new PipelineBuilder(new FakeTransport([aResponse()])),
    ).build();
    const types = runtime.steps.map(step => step.type);
    expect(types.indexOf(REDIRECT_STEP_TYPE)).toBeLessThan(
      types.indexOf(STRIP_MARKER_STEP_TYPE),
    );
  });

  test('a cross-origin redirect never reaches the wire carrying the marker (REDIR-11c)', async () => {
    const hop = Response.newBuilder()
      .request(Request.newBuilder().url('https://example.com/start').build())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(302))
      .headers(
        Headers.newBuilder()
          .setInbound('Location', 'https://other.example/next')
          .build(),
      )
      .body(null)
      .build();
    const transport = new FakeTransport([hop, aResponse()]);
    const runtime = withRedirect(new PipelineBuilder(transport)).build();
    const seed = Request.newBuilder().url('https://example.com/start').build();

    await runtime.send(seed);

    // The redirect step set the marker for the (not-yet-existing) auth layer; the guard took it off
    // again before the terminal dispatch. Without the guard this second send would carry it to the wire.
    expect(transport.sendCount).toBe(2);
    expect(transport.calls[1]?.request.url.href).toBe(
      'https://other.example/next',
    );
    expect(
      transport.calls[1]?.request.headers.has(CROSS_ORIGIN_MARKER_HEADER),
    ).toBe(false);
  });
});
