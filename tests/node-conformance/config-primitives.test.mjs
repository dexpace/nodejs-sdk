// SPDX-License-Identifier: MIT
// tests/node-conformance/config-primitives.test.mjs
//
// Phase 7a's runtime-divergent surfaces, driven through the `@dexpace/core` specifier on Node rather than
// Bun. Three things here are independent implementations, not shared code:
//
//   * `Clock.sleep` races `setTimeout` against an `AbortSignal` and clears the timer on both paths. Bun's
//     `AbortSignal` is not Node's — in particular the reason an `abort()` with no argument produces, which
//     CFG-17 requires to surface to the caller unchanged.
//   * `randomUuid` reads `globalThis.crypto`, which is absent from ESM on every Node 18 release and is the
//     reason `engines.node` reads `>=20.3`.
//   * `getBuildInfo().runtimeIdentity` feature-detects the host. On Node it must report the real
//     `process.version`, which is precisely the claim NFR-15 makes and Bun cannot verify.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  CancellationError,
  defaultClock,
  getBuildInfo,
  randomUuid,
} from '@dexpace/core';
// `sleepInChunks` is @internal with no public subpath, so it is reached by direct `dist/` path,
// per this suite's import rule.
import {sleepInChunks} from '../../packages/core/dist/config/clock.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (reason) {
    return reason;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('defaultClock.sleep on Node timers and AbortSignal (CFG-17)', () => {
  it('resolves promptly at zero, on the next turn of the event loop', async () => {
    // Prompt, but through a real timer rather than a resolved promise: a microtask-only zero starves
    // Node's timer and I/O phases, which is exactly what a zero retry backoff would sit inside.
    const start = defaultClock.monotonic();
    let timerRan = false;
    setTimeout(() => {
      timerRan = true;
    }, 0);

    await defaultClock.sleep(0);

    assert.equal(timerRan, true);
    assert.ok(defaultClock.monotonic() - start < 50);
  });

  it("does NOT let Node silently clamp a duration past one timer's reach (V13)", async () => {
    // THE Node-specific behaviour this file exists for. Node clamps a `setTimeout` delay to a 32-bit
    // signed integer and rewrites anything larger to 1, emitting only a `TimeoutOverflowWarning` on
    // stderr -- so a naive `setTimeout(fn, 2 ** 31)` fires in about a millisecond, turning an
    // overflowed retry backoff into a hot loop against the upstream.
    //
    // Asserted WITHOUT waiting: a real oversized sleep is 24.8 days. `sleepInChunks` takes the slice
    // size, so a tiny chunk proves the slicing on real Node timers, and the control below proves
    // Node really does clamp -- i.e. that the slicing is load-bearing and not decoration.
    const slices = [];
    await sleepInChunks(4, undefined, {
      chunkMs: 1,
      onChunk: sliceMs => slices.push(sliceMs),
    });
    assert.deepEqual(slices, [1, 1, 1, 1]);

    // The control: an unsliced oversized delay resolves at once on Node. If this ever starts
    // waiting, the platform changed and the chunking could be revisited.
    const start = defaultClock.monotonic();
    await new Promise(resolve => {
      setTimeout(resolve, 2 ** 31);
    });
    assert.ok(
      defaultClock.monotonic() - start < 1000,
      'expected Node to clamp an oversized setTimeout delay to ~1ms',
    );
  });

  it('rejects a negative duration with a RangeError', async () => {
    assert.ok(
      (await rejectionOf(defaultClock.sleep(-1))) instanceof RangeError,
    );
  });

  it("maps Node's own default abort reason to CancellationError, keeping it as cause", async () => {
    // Node's default abort reason is a `DOMException` named `AbortError`, constructed by the
    // platform -- an independent implementation of Bun's, and the reason this assertion lives here.
    const controller = new AbortController();
    controller.abort();

    const reason = await rejectionOf(
      defaultClock.sleep(60_000, controller.signal),
    );

    assert.ok(reason instanceof CancellationError);
    assert.equal(reason.cause, controller.signal.reason);
    assert.equal(reason.cause.name, 'AbortError');
  });

  it('keeps a caller-supplied abort reason as cause when cancelled mid-wait', async () => {
    const controller = new AbortController();
    const supplied = new Error('cancelled');
    const start = defaultClock.monotonic();

    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => {
      controller.abort(supplied);
    });

    const reason = await rejectionOf(pending);
    assert.ok(reason instanceof CancellationError);
    assert.equal(reason.cause, supplied);
    assert.ok(defaultClock.monotonic() - start < 50);
  });

  it('aborts BETWEEN chunks on Node timers, not only at the end (V13)', async () => {
    const controller = new AbortController();
    const supplied = new Error('gave up mid-wait');
    const slices = [];

    const pending = sleepInChunks(10, controller.signal, {
      chunkMs: 1,
      onChunk: sliceMs => {
        slices.push(sliceMs);
        if (slices.length === 3) controller.abort(supplied);
      },
    });

    const reason = await rejectionOf(pending);
    assert.ok(reason instanceof CancellationError);
    assert.equal(reason.cause, supplied);
    assert.ok(slices.length < 10);
  });

  it('waits at least the requested duration on Node timers', async () => {
    const start = defaultClock.monotonic();

    await defaultClock.sleep(20);

    assert.ok(defaultClock.monotonic() - start >= 15);
  });

  it('leaves no timer behind that would keep the event loop alive after cancellation', async () => {
    // Counted, not inferred from the process exiting. `assert.ok(true)` used to stand here on the
    // argument that a leaked 1-hour timer would hang `node --test` -- true, but it reported as a
    // passing assertion, and a runner started with `--test-force-exit` would have swallowed it.
    // `process.getActiveResourcesInfo()` is Node >= 17, comfortably inside `engines.node`'s 20.3.
    const pendingTimers = () =>
      process.getActiveResourcesInfo().filter(kind => kind === 'Timeout')
        .length;
    const before = pendingTimers();
    const controller = new AbortController();
    const pending = defaultClock.sleep(3_600_000, controller.signal);

    assert.equal(pendingTimers(), before + 1);
    controller.abort(new Error('cancelled'));
    await rejectionOf(pending);

    assert.equal(pendingTimers(), before);
  });
});

describe('randomUuid on Node WebCrypto (CFG-32)', () => {
  it('produces the RFC 4122 version-4 layout from globalThis.crypto', () => {
    assert.match(randomUuid(), UUID_V4);
  });

  it('produces no collisions across a batch', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i += 1) seen.add(randomUuid());

    assert.equal(seen.size, 1000);
  });
});

describe('getBuildInfo runtime detection on Node (CFG-36, NFR-15)', () => {
  it('reports the real process.version rather than the unknown placeholder', () => {
    const {runtimeIdentity} = getBuildInfo();

    // Still an exact equality -- anything looser loses the ability to catch a hardcoded or mangled
    // version -- but the expected value is derived independently: `slice(1)` off an asserted leading
    // `v`, not the implementation's own `replace(/^v/u, '')`. Restating the implementation's
    // expression and comparing to it is how this assertion previously agreed with itself.
    assert.ok(process.version.startsWith('v'));
    assert.equal(runtimeIdentity, `node/${process.version.slice(1)}`);
    assert.match(runtimeIdentity, /^node\/\d+\.\d+\.\d+/u);
    assert.notEqual(runtimeIdentity, 'unknown');
  });

  it('reports a compiled-in SDK version, never the placeholder', () => {
    assert.notEqual(getBuildInfo().sdkVersion, 'unknown');
  });

  it('carries both identity tokens, none blank', () => {
    const {identityTokens} = getBuildInfo();

    assert.equal(identityTokens.length, 2);
    for (const token of identityTokens) assert.notEqual(token.trim(), '');
  });
});
