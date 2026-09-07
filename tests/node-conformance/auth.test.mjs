// SPDX-License-Identifier: MIT
// tests/node-conformance/auth.test.mjs
//
// Phase 5c reaches three runtime-provided globals that Bun implements independently of Node, and every
// one of them fails SILENTLY rather than loudly if the two disagree:
//
//   1. `globalThis.crypto.subtle.digest('SHA-256', ...)` -- the SHA-256/SHA-256-sess Digest algorithms
//      (AUTH-15/AUTH-17). A wrong digest is still a well-formed hex string, so a divergence produces a
//      header the server rejects rather than an exception a test would catch. The RFC 7616 vectors here
//      are the only thing that pins it. `bun test` covers the same vectors on Bun's implementation; this
//      file covers Node's.
//   2. `globalThis.crypto.getRandomValues()` -- the >=128-bit client nonce (AUTH-20). Its absence from
//      ESM on every Node 18 release is one of the two reasons `engines.node` reads `>=20.3`, so this is
//      also the floor assertion for that global.
//   3. `globalThis.btoa` -- Basic stamping (AUTH-14). A Latin-1/UTF-8 mismatch on a non-ASCII password
//      produces a valid-looking base64 blob that authenticates against nothing.
//
// A fourth surface is structural rather than platform-specific but is only observable through Web
// Streams: AUTH-30/AUTH-31/AUTH-32's response-lifecycle discipline is observed through
// `countingResponse()`'s `cancel()`/`pull()` hooks, and Node's timing there is an independent
// implementation of Bun's.
//
// A fifth was added at 5c's adversarial review: AUTH-34's single-flight fetch is shared, so it carries
// no caller signal and each caller instead races its own wait against its own `AbortSignal`. That rests
// on `AbortController`/`AbortSignal` listener add-and-remove semantics and on `Promise.race` settling
// order, both of which Bun implements independently of Node. A divergence here does not throw -- it
// either hangs a caller that aborted or rejects one that did not.
//
// The listener ACCOUNTING that shape depends on is asserted here rather than in `bearer-cache.test.ts`
// for two reasons: `node:events`' `getEventListeners` is the only portable way to count listeners on
// an `AbortSignal` without spying on `removeEventListener`, and no colocated unit test under
// `packages/core/src/` imports a `node:` builtin -- that is the portability posture `basic.ts` and
// `digest.ts` keep by reaching for Web Crypto and `btoa` instead. The Bun side asserts the leak's
// behavioural consequence instead.
//
// `auth/` is `@internal` apart from the barrel-promoted configuration surface, so the handler internals
// are reached by direct `dist/` file path, per this suite's import rule.
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {describe, it} from 'node:test';
import {
  BasicCredential,
  CancellationError,
  Request,
  authStep,
  createAuthDescriptor,
  createAuthRequirement,
} from '@dexpace/core';
import {basicHandler} from '../../packages/core/dist/auth/basic.js';
import {BearerTokenCache} from '../../packages/core/dist/auth/bearer-cache.js';
import {createBearerToken} from '../../packages/core/dist/auth/credential.js';
import {
  computeDigestResponse,
  digestHandler,
} from '../../packages/core/dist/auth/digest.js';
import {md5, toHex} from '../../packages/core/dist/auth/md5.js';
import {createRequestContext} from '../../packages/core/dist/context/context.js';
import {Cursor} from '../../packages/core/dist/pipeline/cursor.js';
import {
  FakeTransport,
  countingResponse,
} from '../../packages/core/dist/testing/fake-transport.js';

const REALM = 'testrealm@host.com';
const NONCE = 'dcd98b7102dd2f0e8b11d0f600bfb0c093';
const VECTOR = {
  realm: REALM,
  nonce: NONCE,
  isUtf8: true,
  method: 'GET',
  uri: '/dir/index.html',
  username: 'Mufasa',
  password: 'Circle Of Life',
  cnonce: '0a4f113b',
  nc: '00000001',
};

function digestChallenge(params) {
  return {scheme: 'digest', params: new Map(Object.entries(params))};
}

function aRequest(url = 'https://example.com/a') {
  return Request.newBuilder().url(url).build();
}

function runThrough(descriptor, transport, request = aRequest()) {
  return new Cursor({
    steps: [descriptor],
    transport,
    request,
    context: createRequestContext(request),
  }).advance();
}

function challengeResponse(status, headerName, headerValue) {
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

describe('Web Crypto SHA-256 under Node (AUTH-15/AUTH-17)', () => {
  it('computes the RFC 7616 SHA-256 response, qop=auth', async () => {
    assert.equal(
      await computeDigestResponse({
        ...VECTOR,
        algorithm: 'SHA-256',
        hasQopAuth: true,
      }),
      '5abdd07184ba512a22c53f41470e5eea7dcaa3a93a59b630c13dfe0a5dc6e38b',
    );
  });

  it('computes the RFC 7616 SHA-256-sess response, qop=auth', async () => {
    assert.equal(
      await computeDigestResponse({
        ...VECTOR,
        algorithm: 'SHA-256-sess',
        hasQopAuth: true,
      }),
      'b8822e12417cb7750f4e2b8515f0dcf25b7dd26993e80bee1426201446a7f59b',
    );
  });

  it('computes the RFC 7616 MD5 response, qop=auth, through the hand-rolled digest', async () => {
    assert.equal(
      await computeDigestResponse({
        ...VECTOR,
        algorithm: 'MD5',
        hasQopAuth: true,
      }),
      '6629fae49393a05397450978507c4ef1',
    );
  });

  it('pins the hand-rolled MD5 primitive itself against the RFC 1321 "abc" vector', async () => {
    assert.equal(
      toHex(md5(new TextEncoder().encode('abc'))),
      '900150983cd24fb0d6963f7d28e17f72',
    );
  });

  it('hashes UTF-8 and ISO-8859-1 inputs differently for a non-ASCII password (AUTH-21)', async () => {
    const utf8 = await computeDigestResponse({
      ...VECTOR,
      password: 'pässwörd',
      algorithm: 'SHA-256',
      hasQopAuth: true,
      isUtf8: true,
    });
    const latin1 = await computeDigestResponse({
      ...VECTOR,
      password: 'pässwörd',
      algorithm: 'SHA-256',
      hasQopAuth: true,
      isUtf8: false,
    });
    assert.notEqual(utf8, latin1);
  });
});

describe('crypto.getRandomValues under Node (AUTH-20)', () => {
  it('draws a fresh 128-bit client nonce per stamp', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({
      realm: REALM,
      nonce: NONCE,
      qop: 'auth',
    });
    const request = {method: 'GET', requestTarget: '/x'};

    const first = /cnonce="([0-9a-f]+)"/u.exec(
      await handler.stamp(challenge, request),
    );
    const second = /cnonce="([0-9a-f]+)"/u.exec(
      await handler.stamp(challenge, request),
    );

    assert.equal(first[1].length, 32); // 16 bytes as hex
    assert.notEqual(first[1], second[1]);
  });
});

describe('globalThis.btoa under Node (AUTH-14)', () => {
  it('base64-encodes the UTF-8 bytes of an ASCII credential', async () => {
    const value = await basicHandler('Aladdin', 'open sesame').stamp({
      scheme: 'basic',
      params: new Map(),
    });
    assert.equal(value, 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('base64-encodes the UTF-8 bytes -- not the Latin-1 code units -- of a non-ASCII credential', async () => {
    const value = await basicHandler('üser', 'päss').stamp({
      scheme: 'basic',
      params: new Map(),
    });
    const utf8 = new TextEncoder().encode('üser:päss');
    assert.equal(value, `Basic ${btoa(String.fromCharCode(...utf8))}`);
    // A naive `btoa('üser:päss')` would produce a different, shorter string on any runtime that
    // accepted it at all -- this is the assertion that catches an encoder swap.
    assert.notEqual(
      value,
      `Basic ${Buffer.from('üser:päss', 'latin1').toString('base64')}`,
    );
  });
});

describe('challenge response lifecycle over Node Web Streams (AUTH-30/AUTH-31/AUTH-32)', () => {
  const tiers = {
    client: createAuthDescriptor([createAuthRequirement('BASIC')]),
  };
  const credentials = {basic: new BasicCredential('u', 'p')};

  it('closes the original 401 before re-driving, and leaves the replacement response open', async () => {
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

    const response = await runThrough(
      authStep({credentials, tiers}),
      transport,
    );

    assert.equal(transport.sendCount, 2);
    assert.equal(challenged.cancelCount(), 1);
    assert.equal(success.cancelCount(), 0);
    assert.equal(response, success.response);
  });

  it('closes the 401 before propagating a throwing challenge hook (AUTH-32)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Basic realm="x"',
    );
    const transport = new FakeTransport([challenged.response]);
    const descriptor = authStep({
      credentials: {},
      tiers: {client: createAuthDescriptor([createAuthRequirement('NO_AUTH')])},
      challengeHook: () => Promise.reject(new Error('hook exploded')),
    });

    await assert.rejects(runThrough(descriptor, transport), /hook exploded/u);
    assert.equal(challenged.cancelCount(), 1);
  });

  it('leaves an unanswerable 401 open and unclosed -- the caller owns it (AUTH-33)', async () => {
    const challenged = challengeResponse(
      401,
      'WWW-Authenticate',
      'Negotiate abc123',
    );
    const transport = new FakeTransport([
      challenged.response,
      countingResponse(200).response,
    ]);

    const response = await runThrough(
      authStep({credentials, tiers}),
      transport,
    );

    assert.equal(transport.sendCount, 1);
    assert.equal(challenged.cancelCount(), 0);
    assert.equal(response, challenged.response);
  });
});

describe('single-flight cancellation over Node AbortSignal (AUTH-34)', () => {
  it('leaves no abort listener behind on a signal reused across many token fetches', async () => {
    // `raceAbort` adds one `abort` listener per WAIT and removes it in a `finally`. Drop that
    // removal and nothing in the suite fails, but a caller signal outliving many fetches -- one
    // request driving a long paginated sweep -- accumulates a dead listener per fetch until Node's
    // MaxListenersExceededWarning fires. The signal is never aborted here, so `{once: true}` cannot
    // do the cleanup for us: only the explicit removal can.
    const cache = new BearerTokenCache();
    const controller = new AbortController();

    for (let round = 0; round < 12; round += 1) {
      const token = createBearerToken(`t${round}`, 10_000);
      await cache.stamp({
        provider: () => Promise.resolve(token),
        marginMs: 0,
        nowMs: 0,
        signal: controller.signal,
      });
      cache.evict(`Bearer t${round}`); // send the next round back down the fetch path
    }

    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });

  it("an aborting caller stops waiting without cancelling a coalesced caller's fetch", async () => {
    let release;
    let invocations = 0;
    const provider = () => {
      invocations += 1;
      return new Promise(resolve => {
        release = resolve;
      });
    };
    const cache = new BearerTokenCache();
    const controller = new AbortController();

    const aborting = cache.stamp({
      provider,
      marginMs: 0,
      nowMs: 0,
      signal: controller.signal,
    });
    const patient = cache.stamp({
      provider,
      marginMs: 0,
      nowMs: 0,
      signal: undefined,
    });
    assert.equal(invocations, 1);

    const givenUp = new Error('caller A gave up');
    controller.abort(givenUp);
    // N1/XCUT-1: the SDK's own terminal type on Node's AbortController too, with the caller's
    // reason kept as the cause -- not the raw reason the cache used to rethrow.
    await assert.rejects(aborting, error => {
      assert.ok(error instanceof CancellationError);
      assert.equal(error.cause, givenUp);
      return true;
    });

    release(createBearerToken('t1', 10_000));
    assert.equal((await patient).token, 't1');
    assert.equal(invocations, 1);
  });
});
