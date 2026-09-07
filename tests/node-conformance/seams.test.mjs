// SPDX-License-Identifier: MIT
// tests/node-conformance/seams.test.mjs
//
// Folded in from the retired `scripts/verify-node-floor.mjs`, whose two assertions were the entirety of
// this repo's Node coverage before this suite existed (checkpoint §5.9). Keeping a second parallel Node
// entry point alongside `test:node` is what §5.9:375 tells us not to do.
//
// This file is the assertion that the declared floor is real rather than aspirational. `engines.node` says
// `">=20.3"`, and two separate built-ins put it there: `globalThis.crypto` — which `MultipartBody` needs to
// generate a boundary — is exposed unflagged only from Node 19.0.0 and is absent from ESM on every Node 18
// release including 18.20.x; and `AbortSignal.any()`, backported to 18.17.0, reached the 20.x line only in
// 20.3.0. 20.3.0 is the first release carrying both.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {composeSignal, isTimeoutSignal, RequestOptions} from '@dexpace/core';

describe('composeSignal on the declared Node floor', () => {
  it('returns a distinct AbortSignal.any() result when both a signal and a timeout are supplied', () => {
    const controller = new AbortController();
    const combined = composeSignal(controller.signal, 50);

    assert.ok(
      combined instanceof AbortSignal,
      'composeSignal() must return an AbortSignal when both a user signal and a timeout are supplied',
    );
    assert.notEqual(
      combined,
      controller.signal,
      'the combined signal must be a distinct AbortSignal.any() result, not the raw user signal',
    );
  });

  it('propagates a user abort through the composed signal, and does not call it a timeout', () => {
    const controller = new AbortController();
    const combined = composeSignal(controller.signal, 60_000);
    assert.equal(combined.aborted, false);

    controller.abort(new Error('caller cancelled'));
    // Abort propagation through AbortSignal.any() is synchronous per spec, but the two runtimes reach it
    // by different implementations — asserting it here rather than only on Bun is the point.
    assert.equal(combined.aborted, true);
    assert.equal(
      isTimeoutSignal(combined),
      false,
      'a caller abort must not be misreported as a timeout',
    );
  });

  it('reports a fired timeout by its structured reason, not by instanceof', async () => {
    const timeoutOnly = composeSignal(undefined, 5);
    assert.ok(timeoutOnly instanceof AbortSignal);
    // Not yet fired: `reason` is undefined, so the predicate is false until the timer runs.
    assert.equal(isTimeoutSignal(timeoutOnly), false);

    // `AbortSignal.timeout()`'s timer is unref'd on every Node version — deliberately, so a pending
    // timeout never keeps a process alive on its own. Awaiting the `abort` event with nothing else
    // scheduled therefore lets the loop drain before the 5ms timer runs, and Node 18.17's test runner
    // reports that as `Promise resolution is still pending but the event loop has already resolved`
    // and cancels the rest of the file. Newer runners hold the loop open through handles of their
    // own, which is the whole reason this passed on current LTS and failed on the declared floor.
    // Hold it open here rather than depending on the runner: the ref'd deadline keeps the loop alive
    // and fails loudly if the timeout never arrives, instead of hanging until the job times out.
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error('AbortSignal.timeout(5) did not fire within 5s'));
      }, 5_000);

      timeoutOnly.addEventListener(
        'abort',
        () => {
          clearTimeout(deadline);
          resolve(undefined);
        },
        {once: true},
      );
    });

    // The shape of what AbortSignal.timeout() stores in `reason` is the runtime-divergent part:
    // isTimeoutSignal reads `reason.name === 'TimeoutError'` precisely because `instanceof DOMException`
    // is realm-bound and would fail across a worker or node:vm boundary.
    assert.equal(timeoutOnly.aborted, true);
    assert.equal(isTimeoutSignal(timeoutOnly), true);
  });

  it('returns undefined when neither a signal nor a timeout is supplied', () => {
    assert.equal(composeSignal(undefined, undefined), undefined);
  });
});

describe('Web Crypto on the declared Node floor', () => {
  it('exposes globalThis.crypto.getRandomValues to an ES module', () => {
    // The floor-defining global. `MultipartBody` reads it synchronously at construction, so there is no
    // asynchronous fallback available to it, and no `node:crypto` import either — the package is documented
    // as runnable on browsers, Deno, Bun and Workers, all of which supply the global. Asserted here in an
    // `.mjs` file on purpose: Node 18 exposes `crypto` to CommonJS while leaving it undefined in ESM, so a
    // CJS probe would have reported this floor as satisfied when it was not.
    assert.equal(
      typeof globalThis.crypto?.getRandomValues,
      'function',
      'the declared engines.node floor must expose globalThis.crypto.getRandomValues to ES modules',
    );
  });
});

describe('composeSignal timeout range on Node (HTTP-35)', () => {
  // Runtime-divergent by measurement, 2026-09-05: `AbortSignal.timeout(1.5)` and
  // `AbortSignal.timeout(2 ** 32)` raise `RangeError` on Node and are accepted on Bun, and a
  // negative delay raises `RangeError` on Node against `TypeError` on Bun. `bun test` therefore
  // cannot assert either half of this, which is what puts the case here rather than only in
  // `packages/core/src/seams/transport.test.ts`. Added by audit #67 / #76, which moved the range
  // check onto `RequestOptionsBuilder.timeoutMs` for this reason.
  it('accepts every timeout RequestOptionsBuilder accepts, at both ends of the range', () => {
    for (const value of [1, 1000, 2 ** 32 - 1]) {
      const accepted = RequestOptions.newBuilder()
        .timeoutMs(value)
        .build().timeoutMs;
      assert.equal(accepted, value);
      assert.ok(
        composeSignal(undefined, accepted) instanceof AbortSignal,
        `composeSignal must accept the timeout ${value}, which the model admits`,
      );
    }
  });

  it('would raise RangeError on the values the model now rejects', () => {
    for (const value of [1.5, 2 ** 32]) {
      assert.throws(
        () => composeSignal(undefined, value),
        RangeError,
        `Node's AbortSignal.timeout() must still reject ${value}; the model is what keeps it unreachable`,
      );
      assert.throws(() => RequestOptions.newBuilder().timeoutMs(value), {
        name: 'RequestOptionsValidationError',
      });
    }
  });
});
