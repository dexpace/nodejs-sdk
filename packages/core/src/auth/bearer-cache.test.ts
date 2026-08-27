// SPDX-License-Identifier: MIT
// packages/core/src/auth/bearer-cache.test.ts
// Exercises: AUTH-34 (fresh-zone hot-path read, no refresh), AUTH-35 (null/expired provider result
// throws and is never cached; a rejecting provider propagates and is never cached), AUTH-37
// (expiring-but-valid zone: stale value returned, background refresh fired, a FAILED background
// refresh non-fatal and not an unhandled rejection; expired/missing zone: single-flight await,
// concurrent callers coalesce to exactly one provider invocation; the post-eviction path
// (`refreshPostEviction`) fetches genuinely fresh, while concurrent post-eviction refreshes still
// coalesce onto ONE fetch), AUTH-36
// (eviction matched on the stamped header value; the survivor is returned so the preservation clause
// is observable), AUTH-11 (a provider error propagates through the async channel and is never
// cached), AUTH-38 (a provider that fails SYNCHRONOUSLY still reaches the async channel, so a
// background refresh stays non-fatal and refreshPostEviction never throws synchronously), AUTH-34's
// cancellation shape (the shared fetch carries no caller signal; each caller races its own, and a
// long-lived signal reused across many fetches does not accumulate abort listeners).
//
// Every `nowMs` below is injected, and the cache validates fetched tokens against that SAME injected
// clock -- so `expiresAt` values are small synthetic epochs, not wall-clock instants. A cache that
// reached for `Date.now()` internally would reject every one of these tokens.
import {describe, expect, test} from 'bun:test';
import {BearerTokenCache, type BearerFetch} from './bearer-cache.js';
import {
  createBearerToken,
  type BearerToken,
  type TokenProvider,
} from './credential.js';
import {AuthResolutionError} from './errors.js';

function providerReturning(token: ReturnType<typeof createBearerToken>): {
  provider: TokenProvider;
  callCount: () => number;
} {
  let invocations = 0;
  const provider: TokenProvider = () => {
    invocations += 1;
    return Promise.resolve(token);
  };
  return {provider, callCount: () => invocations};
}

/** Fails the test if invoked. Used to assert a path did NOT reach the provider. */
function unexpectedProvider(why: string): TokenProvider {
  return () => Promise.reject(new Error(`provider must not be called: ${why}`));
}

/** The four fetch parameters are bundled (`BearerFetch`); this keeps the call sites readable. */
function fetchWith(
  provider: TokenProvider,
  marginMs: number,
  nowMs: number,
): BearerFetch {
  return {provider, marginMs, nowMs, signal: undefined};
}

/**
 * A macrotask boundary -- not a fixed number of microtask hops -- so a fire-and-forget refresh's whole
 * then/finally chain has drained regardless of how many ticks it takes.
 */
function drainMacrotask(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this runner's
 * type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper keeps the
 * assertion honest without a lint suppression. Same shape 5a's and 5b's step suites settled on.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('BearerTokenCache: the fresh and expiring zones (AUTH-34/AUTH-37)', () => {
  test('a fresh cached token is returned without invoking the provider (AUTH-34)', async () => {
    const cache = new BearerTokenCache();
    const fresh = providerReturning(createBearerToken('t1', 10_000));
    await cache.stamp(fetchWith(fresh.provider, 1000, 0)); // primes the cache
    // nowMs=0, expiresAt=10000, margin=1000 -- not expiring.
    const result = await cache.stamp(
      fetchWith(unexpectedProvider('the cached token is still fresh'), 1000, 0),
    );
    expect(result.token).toBe('t1');
    expect(fresh.callCount()).toBe(1);
  });

  test('a token with no expiry is always in the fresh zone (AUTH-10/AUTH-34)', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(
      fetchWith(providerReturning(createBearerToken('forever')).provider, 0, 0),
    );
    const result = await cache.stamp(
      fetchWith(
        unexpectedProvider('a token with no expiry never expires locally'),
        60_000,
        Number.MAX_SAFE_INTEGER,
      ),
    );
    expect(result.token).toBe('forever');
  });

  test('expiring-but-valid: returns the stale token AND fires a background refresh (AUTH-37)', async () => {
    const cache = new BearerTokenCache();
    const initial = providerReturning(createBearerToken('t1', 1000));
    // primes: expiresAt=1000, nowMs=0, margin=500 -- not yet expiring
    await cache.stamp(fetchWith(initial.provider, 500, 0));

    const refreshed = providerReturning(createBearerToken('t2', 5000));
    // nowMs=900: expiring (900+500 > 1000) but not expired (900 > 1000 is false)
    const result = await cache.stamp(fetchWith(refreshed.provider, 500, 900));
    expect(result.token).toBe('t1'); // stale value returned immediately
    await drainMacrotask();
    const after = await cache.stamp(
      fetchWith(unexpectedProvider('the refresh already cached t2'), 500, 900),
    );
    expect(after.token).toBe('t2');
  });
});

describe('BearerTokenCache: the expired/missing zone (AUTH-37)', () => {
  test('expired/missing: awaits a fresh fetch', async () => {
    const cache = new BearerTokenCache();
    // The FETCHED token must itself be valid at the injected `nowMs` -- a provider handing back an
    // already-expired token is AUTH-35's rejection case, covered separately below.
    const {provider, callCount} = providerReturning(
      createBearerToken('t1', 10_000),
    );
    const result = await cache.stamp(fetchWith(provider, 0, 5000)); // nothing cached
    expect(result.token).toBe('t1');
    expect(callCount()).toBe(1);
  });

  test('an EXPIRED cached token awaits a fresh fetch rather than being stamped (AUTH-37)', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(
      fetchWith(
        providerReturning(createBearerToken('t1', 1000)).provider,
        0,
        0,
      ),
    );
    const {provider, callCount} = providerReturning(
      createBearerToken('t2', 9000),
    );
    const result = await cache.stamp(fetchWith(provider, 0, 5000)); // t1 expired at 1000
    expect(result.token).toBe('t2');
    expect(callCount()).toBe(1);
  });
});

describe('BearerTokenCache: a failed background refresh is non-fatal (AUTH-37)', () => {
  test('a FAILING background refresh is non-fatal and never becomes an unhandled rejection (AUTH-37)', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(
      fetchWith(
        providerReturning(createBearerToken('t1', 1000)).provider,
        500,
        0,
      ),
    );

    const failing: TokenProvider = () =>
      Promise.reject(new Error('refresh backend down'));
    // Expiring-but-valid: stamps t1, refresh fails in the background.
    const result = await cache.stamp(fetchWith(failing, 500, 900));
    // The still-valid token was already stamped -- the failure changes nothing.
    expect(result.token).toBe('t1');

    // Drain past the fire-and-forget chain; an unhandled rejection would surface here.
    await drainMacrotask();

    // t1 is still cached and still served -- a failed refresh must not evict what it failed to replace.
    const after = await cache.stamp(
      fetchWith(
        unexpectedProvider('t1 is still cached and still valid at this nowMs'),
        0,
        900,
      ),
    );
    expect(after.token).toBe('t1');
  });
});

describe('BearerTokenCache: single-flight and cancellation (AUTH-11/AUTH-34)', () => {
  test('concurrent expired/missing callers coalesce to exactly one provider invocation (single-flight)', async () => {
    let resolveProvider:
      ((token: ReturnType<typeof createBearerToken>) => void) | undefined;
    let invocations = 0;
    const provider: TokenProvider = () => {
      invocations += 1;
      return new Promise(resolve => {
        resolveProvider = resolve;
      });
    };
    const cache = new BearerTokenCache();

    const first = cache.stamp(fetchWith(provider, 0, 0));
    const second = cache.stamp(fetchWith(provider, 0, 0));
    expect(invocations).toBe(1); // the second caller coalesced onto the first's in-flight fetch

    resolveProvider?.(createBearerToken('t1', 10_000));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.token).toBe('t1');
    expect(secondResult.token).toBe('t1');
  });
});

describe('BearerTokenCache: cancellation is per-caller, not per-fetch (AUTH-34)', () => {
  // A coalesced fetch is owned by no single call, so it carries no caller signal. That is structural
  // rather than asserted: `TokenProvider` is `() => Promise<BearerToken>` and has no parameter to
  // populate. What IS asserted below is the behaviour that replaces it -- each caller races its own
  // wait against its own signal.
  test("an aborting caller stops waiting without cancelling a coalesced caller's fetch", async () => {
    let resolveProvider:
      ((token: ReturnType<typeof createBearerToken>) => void) | undefined;
    let invocations = 0;
    const provider: TokenProvider = () => {
      invocations += 1;
      return new Promise(resolve => {
        resolveProvider = resolve;
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
    const patient = cache.stamp(fetchWith(provider, 0, 0)); // no signal at all
    expect(invocations).toBe(1);

    controller.abort(new Error('caller A gave up'));
    expect((await rejectionOf(aborting)) as Error).toHaveProperty(
      'message',
      'caller A gave up',
    );

    // The shared fetch was never cancelled, so B still gets its token.
    resolveProvider?.(createBearerToken('t1', 10_000));
    expect((await patient).token).toBe('t1');
    expect(invocations).toBe(1);
  });

  test('a caller whose signal is already aborted rejects without starting a fetch', async () => {
    const cache = new BearerTokenCache();
    const controller = new AbortController();
    controller.abort(new Error('already gone'));

    const rejected = await rejectionOf(
      cache.stamp({
        provider: unexpectedProvider('the caller had already aborted'),
        marginMs: 0,
        nowMs: 0,
        signal: controller.signal,
      }),
    );

    expect(rejected as Error).toHaveProperty('message', 'already gone');
  });
});

describe('BearerTokenCache: a signal outliving many fetches (AUTH-34)', () => {
  test('a long-lived signal driving many sequential fetches still aborts exactly one waiter', async () => {
    // `raceAbort` attaches an abort listener per WAIT and removes it in a `finally`. Without that
    // removal a caller signal that outlives many token fetches -- one request driving a long
    // paginated sweep, say -- accumulates one dead listener per fetch until Node's
    // MaxListenersExceededWarning fires. The listener COUNT is asserted directly in
    // `test/node-conformance/auth.test.mjs`, where `node:events`' `getEventListeners` is available;
    // this is the behavioural half, on Bun: after many settled fetches the signal must still drive
    // exactly the one waiter outstanding when it fires, not a backlog of stale ones.
    const cache = new BearerTokenCache();
    const controller = new AbortController();
    let rejections = 0;
    for (let round = 0; round < 8; round += 1) {
      const {provider} = providerReturning(
        createBearerToken(`t${String(round)}`, 10_000),
      );
      await cache.stamp({
        provider,
        marginMs: 0,
        nowMs: 0,
        signal: controller.signal,
      });
      cache.evict(`Bearer t${String(round)}`); // force the next round back into the fetch path
    }

    let release: ((token: BearerToken) => void) | undefined;
    const parked = cache.stamp({
      provider: () =>
        new Promise<BearerToken>(resolve => {
          release = resolve;
        }),
      marginMs: 0,
      nowMs: 0,
      signal: controller.signal,
    });
    controller.abort(new Error('the sweep was cancelled'));
    if ((await rejectionOf(parked)) !== undefined) rejections += 1;

    expect(rejections).toBe(1);
    release?.(createBearerToken('unused', 10_000));
  });
});

describe('BearerTokenCache: a provider that fails SYNCHRONOUSLY (AUTH-37/AUTH-38)', () => {
  // `TokenProvider` is caller-supplied and its declared return type is a promise, but a plain-JS
  // provider can throw before returning one -- the same boundary AUTH-35's `null` guard distrusts.
  const syncThrowing: TokenProvider = () => {
    throw new Error('provider exploded synchronously');
  };

  test('a failed BACKGROUND refresh stays non-fatal: the valid token is still stamped (AUTH-37)', async () => {
    const cache = new BearerTokenCache();
    const {provider} = providerReturning(createBearerToken('t1', 1000));
    await cache.stamp(fetchWith(provider, 0, 0)); // primes the cache

    // nowMs=900, margin=200 -> expiring-but-valid. AUTH-37: stamp the stale token, refresh in the
    // background, and the background failure MUST NOT fail this request. A bare `provider()` call
    // threw straight out of `stamp` here, past the `void ... .catch(...)` that had not been attached
    // yet, rejecting a request that had a perfectly good token to send.
    const stamped = await cache.stamp(fetchWith(syncThrowing, 200, 900));

    expect(stamped.token).toBe('t1');
  });

  test('refreshPostEviction rejects rather than throwing synchronously (AUTH-38)', async () => {
    const cache = new BearerTokenCache();

    const rejected = await rejectionOf(
      cache.refreshPostEviction(fetchWith(syncThrowing, 0, 0)),
    );

    expect(rejected as Error).toHaveProperty(
      'message',
      'provider exploded synchronously',
    );
  });

  test('stamp rejects rather than throwing synchronously on the expired/missing path', async () => {
    const cache = new BearerTokenCache();

    const rejected = await rejectionOf(
      cache.stamp(fetchWith(syncThrowing, 0, 0)),
    );

    expect(rejected as Error).toHaveProperty(
      'message',
      'provider exploded synchronously',
    );
  });
});

describe('BearerTokenCache: provider failure handling (AUTH-11/AUTH-35)', () => {
  test('a null provider result throws AuthResolutionError (AUTH-35)', async () => {
    const cache = new BearerTokenCache();
    // A plain-JS caller can hand back null regardless of TokenProvider's non-nullable return type;
    // AUTH-35 requires a RUNTIME guard, so the cast is the point of the test, not a workaround.
    const nullish = (() => Promise.resolve(null)) as unknown as TokenProvider;
    expect(
      await rejectionOf(cache.stamp(fetchWith(nullish, 0, 0))),
    ).toBeInstanceOf(AuthResolutionError);
  });

  test('an already-expired provider result throws and is never cached (AUTH-35)', async () => {
    const cache = new BearerTokenCache();
    const alreadyExpired: TokenProvider = () =>
      Promise.resolve(createBearerToken('t1', -1)); // expiresAt in the past
    expect(
      await rejectionOf(cache.stamp(fetchWith(alreadyExpired, 0, 1000))),
    ).toBeInstanceOf(AuthResolutionError);

    const {provider: recovers, callCount} = providerReturning(
      createBearerToken('t2', 10_000),
    );
    const result = await cache.stamp(fetchWith(recovers, 0, 1000));
    expect(result.token).toBe('t2');
    // The earlier rejection left nothing cached to short-circuit this call.
    expect(callCount()).toBe(1);
  });

  test('a rejecting provider propagates and is never cached (AUTH-11)', async () => {
    const cache = new BearerTokenCache();
    const boom = new Error('network down');
    const failing: TokenProvider = () => Promise.reject(boom);
    expect(await rejectionOf(cache.stamp(fetchWith(failing, 0, 0)))).toBe(boom);

    const {provider: recovers} = providerReturning(
      createBearerToken('t1', 10_000),
    );
    const result = await cache.stamp(fetchWith(recovers, 0, 0));
    expect(result.token).toBe('t1'); // no stale rejection cached -- this call fetches cleanly
  });
});

describe('BearerTokenCache: refreshPostEviction supersedes a pre-401 fetch (AUTH-37)', () => {
  test('does NOT coalesce onto a fetch that was already in flight', async () => {
    // The exact hazard: a background refresh started BEFORE the 401 came back. AUTH-11 permits a
    // provider that caches internally, so that older fetch can resolve to the very token the server
    // rejected. A `stamp()` here would coalesce onto it and re-send the rejected token.
    const cache = new BearerTokenCache();
    const resolvers: ((token: ReturnType<typeof createBearerToken>) => void)[] =
      [];
    let invocations = 0;
    const provider: TokenProvider = () => {
      invocations += 1;
      return new Promise(resolve => {
        resolvers.push(resolve);
      });
    };

    const stale = cache.stamp(fetchWith(provider, 0, 0)); // starts fetch #1 and parks it in flight
    expect(invocations).toBe(1);

    const fresh = cache.refreshPostEviction(fetchWith(provider, 0, 0));
    expect(invocations).toBe(2); // a SECOND provider call, not a handle on the first

    resolvers[0]?.(createBearerToken('rejected-token', 10_000));
    resolvers[1]?.(createBearerToken('genuinely-fresh', 10_000));
    await stale;
    expect((await fresh).token).toBe('genuinely-fresh');
  });

  test('a superseded fetch resolving LAST still cannot re-cache the rejected token', async () => {
    // Same hazard, opposite resolution order -- the one a generation-less cache gets wrong: the
    // pre-401 fetch settles after the fresh one and would otherwise overwrite it.
    const cache = new BearerTokenCache();
    const resolvers: ((token: ReturnType<typeof createBearerToken>) => void)[] =
      [];
    const provider: TokenProvider = () =>
      new Promise(resolve => {
        resolvers.push(resolve);
      });

    const stale = cache.stamp(fetchWith(provider, 0, 0));
    const fresh = cache.refreshPostEviction(fetchWith(provider, 0, 0));

    resolvers[1]?.(createBearerToken('genuinely-fresh', 10_000));
    await fresh;
    resolvers[0]?.(createBearerToken('rejected-token', 10_000));
    await stale;
    await drainMacrotask();

    const served = await cache.stamp(
      fetchWith(
        unexpectedProvider('the fresh token is cached and valid'),
        0,
        0,
      ),
    );
    expect(served.token).toBe('genuinely-fresh');
  });
});

describe('BearerTokenCache: refreshPostEviction caches and re-drives (AUTH-36/AUTH-37)', () => {
  test('the EVICTION path supersedes a pre-401 fetch that resolves late', async () => {
    // The sibling above drives `stamp` + `refreshPostEviction` directly. This one goes through AUTH-36's
    // actual 401 sequence -- evict, then refreshPostEviction -- with the pre-401 background fetch resolving
    // to exactly the token the server rejected, which AUTH-11 expressly permits a
    // internally-caching provider to do.
    const cache = new BearerTokenCache();
    let releasePreFetch: (() => void) | undefined;
    const slow: TokenProvider = () =>
      new Promise(resolve => {
        releasePreFetch = () => {
          resolve(createBearerToken('rejected-token', 10_000));
        };
      });

    await cache.stamp(
      fetchWith(
        providerReturning(createBearerToken('rejected-token', 1000)).provider,
        0,
        0,
      ),
    );
    await cache.stamp(fetchWith(slow, 200, 900)); // parks a pre-401 background fetch in flight

    expect(cache.evict('Bearer rejected-token')).toBeUndefined();
    const fresh = await cache.refreshPostEviction(
      fetchWith(
        providerReturning(createBearerToken('genuinely-fresh', 100_000))
          .provider,
        0,
        900,
      ),
    );
    expect(fresh.token).toBe('genuinely-fresh');

    releasePreFetch?.();
    await drainMacrotask();

    const served = await cache.stamp(
      fetchWith(
        unexpectedProvider('the post-eviction token is cached and valid'),
        0,
        1000,
      ),
    );
    expect(served.token).toBe('genuinely-fresh');
  });

  test('caches its result like any other fetch', async () => {
    const cache = new BearerTokenCache();
    const {provider, callCount} = providerReturning(
      createBearerToken('t1', 10_000),
    );
    await cache.refreshPostEviction(fetchWith(provider, 0, 0));
    const again = await cache.stamp(
      fetchWith(
        unexpectedProvider('refreshPostEviction() populated the cache'),
        0,
        0,
      ),
    );
    expect(again.token).toBe('t1');
    expect(callCount()).toBe(1);
  });
});

describe('BearerTokenCache: a 401 burst coalesces (AUTH-34/AUTH-37)', () => {
  test('N concurrent post-eviction refreshes share ONE provider fetch, not N', async () => {
    // A server-side revocation 401s every in-flight request at once. Superseding the pre-401 fetch is
    // required (AUTH-37), but starting one provider call per 401 is the thundering herd AUTH-34's
    // "at most one provider fetch" clause forbids.
    const cache = new BearerTokenCache();
    let calls = 0;
    let release: ((token: BearerToken) => void) | undefined;
    const provider = (): Promise<BearerToken> => {
      calls += 1;
      return new Promise<BearerToken>(resolve => {
        release = resolve;
      });
    };

    const burst = [
      cache.refreshPostEviction(fetchWith(provider, 0, 0)),
      cache.refreshPostEviction(fetchWith(provider, 0, 0)),
      cache.refreshPostEviction(fetchWith(provider, 0, 0)),
      cache.refreshPostEviction(fetchWith(provider, 0, 0)),
    ];
    release?.(createBearerToken('fresh', 10_000));
    const tokens = await Promise.all(burst);

    expect(calls).toBe(1);
    expect(tokens.map(token => token.token)).toEqual([
      'fresh',
      'fresh',
      'fresh',
      'fresh',
    ]);
  });

  test('a LATER 401 still supersedes: it does not join the settled burst fetch', async () => {
    const cache = new BearerTokenCache();
    const first = providerReturning(createBearerToken('t1', 10_000));
    await cache.refreshPostEviction(fetchWith(first.provider, 0, 0));
    const second = providerReturning(createBearerToken('t2', 10_000));

    const result = await cache.refreshPostEviction(
      fetchWith(second.provider, 0, 0),
    );

    expect(result.token).toBe('t2');
    expect(second.callCount()).toBe(1);
  });

  test('a stamp()-driven fetch sitting at the current generation is NOT joined by refreshPostEviction', async () => {
    // The guard is `inFlightEvictionGeneration`, not the generation counter alone: an ordinary
    // single-flight fetch must still be superseded, or a pre-401 fetch could hand back the very token
    // the server just rejected (AUTH-37).
    const cache = new BearerTokenCache();
    let release: ((token: BearerToken) => void) | undefined;
    const stale = (): Promise<BearerToken> =>
      new Promise<BearerToken>(resolve => {
        release = resolve;
      });
    const pending = cache.stamp(fetchWith(stale, 0, 0));

    const fresh = providerReturning(createBearerToken('fresh', 10_000));
    const result = await cache.refreshPostEviction(
      fetchWith(fresh.provider, 0, 0),
    );

    expect(result.token).toBe('fresh');
    expect(fresh.callCount()).toBe(1);
    release?.(createBearerToken('rejected', 10_000));
    await pending;
  });
});

describe('BearerTokenCache: evict (AUTH-36)', () => {
  test('evicts only when the header value matches the exact cached token', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(
      fetchWith(
        providerReturning(createBearerToken('t1', 10_000)).provider,
        0,
        0,
      ),
    );
    // The survivor is RETURNED, which is what makes AUTH-36's "preserving a token another request
    // already refreshed" observable rather than a no-op the next fetch overwrites.
    expect(cache.evict('Bearer some-other-token')?.token).toBe('t1');
    const result = await cache.stamp(
      fetchWith(
        unexpectedProvider('a non-matching evict() must not clear the cache'),
        0,
        0,
      ),
    );
    expect(result.token).toBe('t1');
  });

  test('a matching evict() forces the next call to refetch', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(
      fetchWith(
        providerReturning(createBearerToken('t1', 10_000)).provider,
        0,
        0,
      ),
    );
    expect(cache.evict('Bearer t1')).toBeUndefined();
    const {provider, callCount} = providerReturning(
      createBearerToken('t2', 10_000),
    );
    const result = await cache.stamp(fetchWith(provider, 0, 0));
    expect(result.token).toBe('t2');
    expect(callCount()).toBe(1);
  });

  test('is a no-op returning undefined when nothing is cached', () => {
    expect(new BearerTokenCache().evict('Bearer anything')).toBeUndefined();
  });
});
