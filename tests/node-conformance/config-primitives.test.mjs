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
import {defaultClock, getBuildInfo, randomUuid} from '@dexpace/core';

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

  it('rejects a duration above the timer-delay ceiling instead of silently firing at once', async () => {
    // Node clamps a `setTimeout` delay to a 32-bit signed integer and rewrites anything larger to 1,
    // emitting only a `TimeoutOverflowWarning` on stderr. `sleep(2 ** 31)` therefore used to return
    // in about 7ms rather than waiting 24.8 days, turning an overflowed retry backoff into a hot
    // loop. This is the divergence the conformance suite exists for: it is Node timer behavior, not
    // shared code.
    const reason = await rejectionOf(defaultClock.sleep(2 ** 31));

    assert.equal(reason.name, 'InvariantViolation');
    assert.match(reason.message, /2147483647/u);
  });

  it('rejects a negative duration with an InvariantViolation', async () => {
    // Asserted by `name`, not `instanceof`: `InvariantViolation` is @internal and deliberately absent
    // from the package barrel, so this suite -- which imports through the `@dexpace/core` specifier --
    // has no constructor to compare against.
    assert.equal(
      (await rejectionOf(defaultClock.sleep(-1))).name,
      'InvariantViolation',
    );
  });

  it("surfaces Node's own default abort reason unchanged", async () => {
    const controller = new AbortController();
    controller.abort();

    const reason = await rejectionOf(
      defaultClock.sleep(60_000, controller.signal),
    );

    assert.equal(reason, controller.signal.reason);
    assert.equal(reason.name, 'AbortError');
  });

  it('surfaces a caller-supplied abort reason unchanged when cancelled mid-wait', async () => {
    const controller = new AbortController();
    const supplied = new Error('cancelled');
    const start = defaultClock.monotonic();

    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => {
      controller.abort(supplied);
    });

    assert.equal(await rejectionOf(pending), supplied);
    assert.ok(defaultClock.monotonic() - start < 50);
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
