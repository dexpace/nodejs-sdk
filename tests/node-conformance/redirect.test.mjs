// SPDX-License-Identifier: MIT
// tests/node-conformance/redirect.test.mjs
//
// Phase 5b is a runtime-divergent surface at two specific points, and both fail silently rather than
// loudly if the runtimes disagree:
//
//   1. `decide.ts` delegates ALL of REDIR-12/13/14/18 to the platform's WHATWG `URL` -- reference
//      resolution, percent-encoding preservation, userinfo clearing, the bracketed-IPv6 form, and which
//      malformed inputs throw versus resolve as a relative reference. Bun's URL parser is an independent
//      implementation of Node's. A divergence here does not crash: `%2F` silently decoding to `/` would
//      change the path structure of every followed redirect, and a Location that Node treats as a parse
//      failure where Bun treats it as a relative reference would flip "return the 3xx unfollowed" into
//      "dispatch a request nobody asked for" -- with `bun test` green throughout.
//   2. PIPE-40/REDIR-22's response-lifecycle discipline rides on Web Streams: each superseded hop is
//      released by `Response.close()` (which cancels the body stream), and the final response must be
//      left uncancelled. Node's `cancel()`/`pull()` timing is an independent implementation of Bun's,
//      and the whole close-count assertion is observed through that hook.
//
// `redirect/` is `@internal` with no public subpath in `exports`, so it is reached by direct `dist/`
// file path, per this suite's import rule.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  CancellationError,
  Headers,
  Protocol,
  Request,
  Response,
  Status,
  TransportFailureError,
} from '@dexpace/core';
import {createRequestContext} from '../../packages/core/dist/context/context.js';
import {Cursor} from '../../packages/core/dist/pipeline/cursor.js';
import {originOf} from '../../packages/core/dist/redirect/cross-origin.js';
import {decide} from '../../packages/core/dist/redirect/decide.js';
import {redirectStep} from '../../packages/core/dist/redirect/redirect-step.js';
import {redirectSettings} from '../../packages/core/dist/redirect/settings.js';
import {
  FakeTransport,
  countingResponse,
} from '../../packages/core/dist/testing/fake-transport.js';

const SEED_URL = 'https://example.com/start';

function aRequest(url = SEED_URL) {
  return Request.newBuilder().url(url).build();
}

function aRedirect(location, status = 302) {
  return Response.newBuilder()
    .request(aRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(Headers.newBuilder().setInbound('Location', location).build())
    .body(null)
    .build();
}

function contextFor(request) {
  return {
    currentRequest: request,
    seedOrigin: originOf(request.url),
    visited: new Set([request.url.href]),
    redirectsFollowed: 0,
  };
}

function followedTarget(location, from = SEED_URL) {
  const decision = decide(
    aRedirect(location),
    contextFor(aRequest(from)),
    redirectSettings(),
  );
  assert.equal(decision.kind, 'follow');
  return decision.nextRequest.url;
}

function withLocation(response, location) {
  return response
    .newBuilder()
    .headers(
      response.headers.newBuilder().setInbound('Location', location).build(),
    )
    .build();
}

describe("Location resolution on Node's own URL parser", () => {
  it('resolves a relative reference against the current hop (REDIR-14)', () => {
    assert.equal(
      followedTarget('/next', 'https://example.com/a/b').href,
      'https://example.com/next',
    );
  });

  it('never re-encodes an already-percent-encoded path or query (REDIR-13)', () => {
    const target = followedTarget('https://example.com/a%2Fb?q=x%26y');
    assert.equal(target.pathname, '/a%2Fb');
    assert.equal(target.search, '?q=x%26y');
  });

  it('preserves a bracketed IPv6 literal host and an explicit port (REDIR-13)', () => {
    const target = followedTarget('https://[2001:db8::1]:8443/x');
    assert.equal(target.hostname, '[2001:db8::1]');
    assert.equal(target.port, '8443');
  });

  it('drops userinfo without disturbing the rest of the URL (REDIR-12)', () => {
    const target = followedTarget('https://user:pass@other.example/x?q=1');
    assert.equal(target.username, '');
    assert.equal(target.password, '');
    assert.equal(target.href, 'https://other.example/x?q=1');
  });

  it('treats a non-URL string as a relative reference, not a parse failure (REDIR-14)', () => {
    // The behavior the `catch` in `resolveLocation` is deliberately NOT relied on for. If Node ever
    // threw here where Bun resolves, the step would silently stop following a redirect it should follow.
    assert.equal(
      followedTarget(' not a url').href,
      'https://example.com/not%20a%20url',
    );
  });

  it('resolves dot segments per RFC 3986 (REDIR-14)', () => {
    for (const [location, expected] of [
      ['.', 'https://example.com/a/b/'],
      ['..', 'https://example.com/a/'],
      ['../../x', 'https://example.com/x'],
    ]) {
      assert.equal(
        followedTarget(location, 'https://example.com/a/b/c').href,
        expected,
        location,
      );
    }
  });

  it('inherits the scheme for a protocol-relative Location (REDIR-14)', () => {
    assert.equal(
      followedTarget('//other.example/x').href,
      'https://other.example/x',
    );
  });

  it('normalizes case and the default port, which is what makes loop detection hold (REDIR-16)', () => {
    // `visited` keys on `href`. If Node normalized differently from Bun here, a loop a Bun-run test
    // says is caught would be followable on the runtime this package actually ships to.
    assert.equal(
      followedTarget('HTTPS://EXAMPLE.COM/a').href,
      'https://example.com/a',
    );
    assert.equal(
      followedTarget('https://example.com:443/a').href,
      'https://example.com/a',
    );
  });

  it('returns a malformed absolute form unfollowed rather than throwing (REDIR-18)', () => {
    const decision = decide(
      aRedirect('http://['),
      contextFor(aRequest()),
      redirectSettings(),
    );
    assert.deepEqual(decision, {
      kind: 'return-current',
      reason: 'malformed-location',
    });
  });

  it('returns an unsupported scheme unfollowed, never dispatching it (REDIR-18)', () => {
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
    ]) {
      const decision = decide(
        aRedirect(raw),
        contextFor(aRequest()),
        redirectSettings(),
      );
      assert.deepEqual(
        decision,
        {kind: 'return-current', reason: 'malformed-location'},
        raw,
      );
    }
  });
});

describe('redirect response lifecycle over real Node Web Streams', () => {
  it('closes every superseded hop and leaves the final response open (PIPE-40)', async () => {
    const first = countingResponse(301);
    const second = countingResponse(301);
    const third = countingResponse(200);
    const transport = new FakeTransport([
      withLocation(first.response, 'https://example.com/mid'),
      withLocation(second.response, '/final'),
      third.response,
    ]);
    const seed = aRequest();

    const response = await new Cursor({
      steps: [redirectStep()],
      transport,
      request: seed,
      context: createRequestContext(seed),
    }).advance();

    assert.equal(transport.sendCount, 3);
    assert.equal(first.cancelCount(), 1);
    assert.equal(second.cancelCount(), 1);
    assert.equal(third.cancelCount(), 0); // close-responsibility passes outward to the caller
    assert.equal(response, third.response);
  });

  it('returns a loop-detected response open, without throwing (REDIR-16/REDIR-22c)', async () => {
    const loop = countingResponse(301);
    const located = withLocation(loop.response, SEED_URL);
    const transport = new FakeTransport([located]);
    const seed = aRequest();

    const response = await new Cursor({
      steps: [redirectStep()],
      transport,
      request: seed,
      context: createRequestContext(seed),
    }).advance();

    assert.equal(transport.sendCount, 1);
    assert.equal(response, located);
    assert.equal(loop.cancelCount(), 0);
  });

  it("honors an abort raised DURING a hop, on Node's AbortSignal", async () => {
    // The redirect step's own per-hop guard: it runs before the step forks again, so the cursor's
    // step-boundary check never sees this abort and the hop response is handed back OPEN, which is
    // what PIPE-40 requires on the abandon path.
    const controller = new AbortController();
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'https://example.com/next');
    const never = countingResponse(200);
    const inner = new FakeTransport([located, never.response]);
    const seed = aRequest();
    const aborting = {
      send: async (request, options, signal) => {
        const response = await inner.send(request, options, signal);
        controller.abort();
        return response;
      },
      close: () => Promise.resolve(),
    };

    const response = await new Cursor({
      steps: [redirectStep()],
      transport: aborting,
      request: seed,
      context: createRequestContext(seed),
      signal: controller.signal,
    }).advance();

    assert.equal(inner.sendCount, 1);
    assert.equal(response, located);
    assert.equal(hop.cancelCount(), 0);
  });

  it("refuses the walk for a signal already aborted at entry, on Node's AbortSignal", async () => {
    // `Cursor` checks the signal at every step boundary, and maps the abort through the SDK's own
    // mapper rather than `throwIfAborted()`'s bare DOMException (N1). Node's
    // AbortSignal/AbortController is an independent implementation of Bun's, and `signal.reason`
    // defaulting is one of the places the two have diverged before -- so the mapped `cause` is
    // asserted here and not only under `bun test`.
    const controller = new AbortController();
    const reason = new Error('caller went away');
    controller.abort(reason);
    const never = countingResponse(200);
    const transport = new FakeTransport([never.response]);
    const seed = aRequest();

    await assert.rejects(
      new Cursor({
        steps: [redirectStep()],
        transport,
        request: seed,
        context: createRequestContext(seed),
        signal: controller.signal,
      }).advance(),
      error => {
        assert.ok(error instanceof CancellationError);
        assert.equal(error.cause, reason);
        return true;
      },
    );

    assert.equal(transport.sendCount, 0);
    assert.equal(never.cancelCount(), 0);
  });

  it('maps a TIMEOUT abort to TransportFailureError, not CancellationError (XCUT-3)', async () => {
    // The other half of the mapper: a cancellation must stay distinguishable from a timeout, and
    // `AbortSignal.timeout()`'s reason (`TimeoutError`) is runtime-provided.
    const signal = AbortSignal.timeout(1);
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, {once: true});
    });
    const never = countingResponse(200);
    const transport = new FakeTransport([never.response]);
    const seed = aRequest();

    await assert.rejects(
      new Cursor({
        steps: [redirectStep()],
        transport,
        request: seed,
        context: createRequestContext(seed),
        signal,
      }).advance(),
      error => {
        assert.ok(error instanceof TransportFailureError);
        assert.ok(!(error instanceof CancellationError));
        return true;
      },
    );

    assert.equal(transport.sendCount, 0);
  });
});
