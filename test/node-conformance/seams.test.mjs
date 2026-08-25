// SPDX-License-Identifier: MIT
// test/node-conformance/seams.test.mjs
//
// Folded in from the retired `scripts/verify-node-floor.mjs`, whose two assertions were the entirety of
// this repo's Node coverage before this suite existed (checkpoint §5.9). Keeping a second parallel Node
// entry point alongside `test:node` is what §5.9:375 tells us not to do.
//
// `AbortSignal.any()` landed in exactly Node 18.17.0, which is why `engines.node` says `">=18.17"`. This
// file is the assertion that the floor is real rather than aspirational.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {composeSignal, isTimeoutSignal} from '@dexpace/core';

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

    await new Promise(resolve => {
      timeoutOnly.addEventListener('abort', resolve, {once: true});
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
