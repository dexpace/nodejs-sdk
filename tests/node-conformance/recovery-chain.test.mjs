// SPDX-License-Identifier: MIT
// tests/node-conformance/recovery-chain.test.mjs
//
// Phase 4b (`RECOV-12`) is a runtime-divergent surface for one specific reason: the `SuppressedError`
// global. Bun ships it and so does current Node, but it is a V8 global from the full Explicit Resource
// Management proposal and is absent on this package's declared floor (`engines.node ">=20.3"`). A
// `new SuppressedError(...)` written straight into `response-chain.ts` would pass `bun test` and then throw
// `ReferenceError: SuppressedError is not defined` at a consumer's call time — exactly the `NFR-10` trap
// `docs/knowledge/tooling-and-quality-gates.md:60-61` describes. `suppress()` guards on the global; this
// file is what proves the guarded path actually works on the runtime the SDK ships to, at both ends of the
// matrix.
//
// The close-on-throw half also exercises `RECOV-12`'s "released exactly once" over Node's own Web Streams
// implementation, whose `cancel()` and reader-lock timing are independent of Bun's.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {Protocol, Request, Response, Status} from '@dexpace/core';
import {
  FallbackSuppressedError,
  suppress,
} from '../../packages/core/dist/suppress.js';
import {ResponseRecoveryChain} from '../../packages/core/dist/recovery/response-chain.js';
import {success} from '../../packages/core/dist/recovery/outcome.js';

function aResponse(body = null) {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

describe('suppress() on the declared Node floor', () => {
  it('produces a shape-compatible error whether or not the runtime has SuppressedError', () => {
    const primary = new Error('primary');
    const secondary = new Error('secondary');

    const result = suppress(primary, secondary, 'teardown failed');

    assert.ok(result instanceof Error, 'suppress() must return an Error');
    assert.equal(result.name, 'SuppressedError');
    assert.equal(
      result.error,
      primary,
      'the primary throwable must stay primary',
    );
    assert.equal(result.suppressed, secondary);
    assert.equal(result.message, 'teardown failed');
  });

  it('takes the branch this runtime actually has, and both legs of the matrix are covered', () => {
    // Not forced by deleting the global — that would not survive parallel execution
    // (docs/knowledge/testing.md:50). The matrix is the forcing function: the pinned 20.3.0 leg has
    // no native class and takes the fallback, `lts/*` has one and takes the native branch. Either
    // way the result must be usable without the caller knowing which.
    const native = globalThis.SuppressedError;
    const result = suppress(
      new Error('primary'),
      new Error('secondary'),
      'teardown failed',
    );

    if (typeof native === 'function') {
      assert.ok(
        result instanceof native,
        'a runtime with SuppressedError must produce the native class',
      );
    } else {
      assert.ok(
        result instanceof FallbackSuppressedError,
        'a runtime without SuppressedError must produce the stand-in',
      );
    }
    assert.equal(result.name, 'SuppressedError');
    assert.equal(result.message, 'teardown failed');
  });

  it('builds the fallback stand-in with the same observable shape', () => {
    const primary = new Error('primary');
    const secondary = new Error('secondary');

    const result = new FallbackSuppressedError(
      primary,
      secondary,
      'teardown failed',
    );

    assert.ok(result instanceof Error);
    assert.equal(result.name, 'SuppressedError');
    assert.equal(result.error, primary);
    assert.equal(result.suppressed, secondary);
  });
});

describe('RECOV-12 close-on-throw over Node Web Streams', () => {
  it('closes the in-hand response exactly once and keeps the step error primary', async () => {
    let cancels = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        cancels += 1;
      },
    });
    const thrownError = new Error('step failed');
    const chain = new ResponseRecoveryChain(
      [
        () => {
          throw thrownError;
        },
      ],
      [],
    );

    const result = await chain.apply(success(aResponse(body)));

    assert.equal(cancels, 1, 'the response must be released exactly once');
    assert.equal(result.kind, 'failure');
    assert.equal(
      result.error,
      thrownError,
      'the step error must survive by identity',
    );
  });

  it('attaches a close failure as suppressed without displacing the step error', async () => {
    const closeError = new Error('close failed');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        throw closeError;
      },
    });
    const originalError = new Error('step failed');
    const chain = new ResponseRecoveryChain(
      [
        () => {
          throw originalError;
        },
      ],
      [],
    );

    const result = await chain.apply(success(aResponse(body)));

    assert.equal(result.kind, 'failure');
    assert.equal(result.error.name, 'SuppressedError');
    assert.equal(
      result.error.error,
      originalError,
      'RECOV-12: the original stays primary',
    );
    assert.equal(result.error.suppressed, closeError);
  });
});
