// SPDX-License-Identifier: MIT
// packages/core/src/auth/bearer-cache.ts
import {
  isBearerTokenExpired,
  type BearerToken,
  type TokenProvider,
} from './credential.js';
import {AuthResolutionError} from './errors.js';
import {abortToSdkError} from '../cancellation.js';
import {getGlobalLogger} from '../observability/logger.js';

/**
 * The value {@link BearerTokenCache.inFlightEvictionGeneration} carries when the in-flight fetch (if
 * any) came from the ordinary {@link BearerTokenCache.stamp} path. Never a real generation: the
 * counter only ever increments from 0, so no post-eviction fetch can collide with it.
 */
const NO_EVICTION_GENERATION = -1;

/**
 * AUTH-37's record half: a background refresh that failed is non-fatal, and is *logged*.
 *
 * Swallowed rather than re-raised for the reason stated at the call site -- a bare `void` leaves an
 * unhandled rejection that terminates the process under Node's default policy, asynchronously and
 * unattributable to any request, for a fault in caller-supplied `TokenProvider` code. The log is
 * what makes "continue" honest rather than silent.
 */
function warnRefreshFailed(error: unknown): void {
  try {
    getGlobalLogger()
      .atLevel('warning')
      .event('http.auth.bearerRefreshFailed')
      .cause(error)
      .emit();
  } catch {
    // OBS-20: logger failure must never fail the request -- and this one is not even on a request
    // path, so a throw here would be the detached rejection the catch above exists to prevent.
  }
}

/**
 * One token fetch's inputs.
 *
 * Bundled rather than passed positionally: `max-params` is 3, and
 * `docs/knowledge/harvested/function-design.md` requires an options object at three or more parameters anyway.
 *
 * @internal
 */
export interface BearerFetch {
  /** The token source (AUTH-11). */
  readonly provider: TokenProvider;
  /** AUTH-34's refresh margin: how long before expiry a token counts as expiring. */
  readonly marginMs: number;
  /**
   * The injected clock reading. Never `Date.now()` inside this class — see {@link
   * BearerTokenCache.refresh}.
   */
  readonly nowMs: number;
  /**
   * The calling request's cancellation.
   *
   * It is NOT handed to the provider. A fetch reached through AUTH-34's single-flight coalescing is
   * shared by every caller that joined it, so cancelling it on one caller's signal would reject
   * callers who never aborted -- and a caller who supplied no signal at all. Instead each caller
   * RACES the shared promise against its own signal ({@link raceAbort}): an aborting caller stops
   * waiting, and the work the others are joined to keeps running. {@link TokenProvider} therefore
   * takes no parameters at all, and carries the deadline obligation that follows from the fetch
   * itself being uncancellable.
   */
  readonly signal: AbortSignal | undefined;
}

/**
 * Calls `provider` so that a SYNCHRONOUS failure reaches the async channel like every other provider
 * failure (AUTH-37, AUTH-38).
 *
 * A `TokenProvider` is caller-supplied code. Its declared return type is `Promise<BearerToken>`, but
 * a plain-JS provider can throw before returning, or return something that is not a promise at all --
 * the same boundary the `null | undefined` widening in {@link BearerTokenCache.refresh} already
 * distrusts, distrusted the same way. Left as a bare `provider(...)` call, such a failure escaped past
 * `stamp`'s `void ... .catch(...)` before the catch was ever attached, turning AUTH-37's expressly
 * non-fatal background refresh into a fatal one and rejecting a request that had a perfectly good
 * cached token to stamp.
 *
 * An `async` wrapper, NOT `Promise.resolve().then(provider)`: an async function body runs
 * synchronously up to its first `await`, so the provider is still invoked in the same tick as the
 * `inFlight` assignment. Deferring it by a microtask would put an await between the single-flight
 * check and the assignment -- the one thing the guard's lock-free correctness rests on. Returning
 * `provider()` unawaited is likewise deliberate: `await`ing it here would trip `return-await` outside
 * a try, and buys nothing, because the `async` keyword already converts a synchronous throw into a
 * rejection.
 *
 * No `signal` is passed because {@link TokenProvider} takes no parameters at all: a coalesced fetch
 * is owned by no single call, so there is nothing a caller signal could correctly mean here. See
 * {@link BearerFetch.signal} for what happens instead; the provider owns its own deadline.
 *
 * Collapse this back into a bare `provider()` call only if `TokenProvider` stops being
 * caller-supplied code.
 */
async function invokeProvider(provider: TokenProvider): Promise<BearerToken> {
  return provider();
}

/**
 * Starts (or joins) a fetch and awaits it, but stops waiting when `signal` aborts -- WITHOUT
 * cancelling the fetch, which is shared by every caller coalesced onto it (AUTH-34).
 *
 * Takes a factory rather than a promise so the already-aborted check runs BEFORE any fetch is
 * started, and so `start()` is still invoked in the caller's own synchronous span: an `async`
 * function body runs to its first `await` synchronously, which is what keeps the single-flight
 * assignment and the generation bump un-interleaved.
 *
 * `new Promise` with a synchronous executor adapting an event-emitter callback is the one shape
 * `docs/knowledge/harvested/concurrency-and-async.md` sanctions for it, and the listener is removed on every
 * exit so a long-lived caller signal does not accumulate one per token fetch.
 *
 * A `pending` that rejects after losing the race is still settled through `Promise.race`'s own
 * handler, so it never becomes an unhandled rejection.
 */
async function raceAbort(
  start: () => Promise<BearerToken>,
  signal: AbortSignal | undefined,
): Promise<BearerToken> {
  // Before `start()`, so an already-dead caller never opens a fetch it cannot use --
  // `concurrency-and-async.md`'s "check the signal before each expensive step".
  //
  // Mapped through `abortToSdkError` rather than rethrown verbatim (N1/XCUT-1): a cancelled token
  // fetch and a cancelled transport dispatch are the same event to a caller, and used to arrive as
  // two different types. The caller's own reason is kept as `.cause`.
  if (signal?.aborted === true) throw abortToSdkError(signal, signal.reason);
  const pending = start();
  if (signal === undefined) return pending;
  let onAbort = (): void => undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        onAbort = (): void => {
          reject(abortToSdkError(signal, signal.reason));
        };
        signal.addEventListener('abort', onAbort, {once: true});
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * The single-flight, three-zone bearer token cache (AUTH-34, AUTH-35, AUTH-37).
 *
 * The async three-zone policy is shipped unconditionally. This port has one `Promise`-only pipeline
 * execution model (4c), so AUTH-34's "non-blocking hot-path read of a valid cached token" is the
 * fresh-zone branch of this same state machine, not a second stack — directly parallel to 5a's
 * one-retry-engine disposition of RETRY-28.
 *
 * Single-flight is a plain field, not a lock. On Node and Bun the only hazard would be two logical
 * calls both observing "no in-flight fetch" before either assigns the slot, and that cannot happen
 * because nothing awaits between the check and the assignment in {@link BearerTokenCache.refresh} —
 * the same synchronous-guard collapse as Digest's nonce counter.
 *
 * One instance per configured {@link TokenProvider}; every test constructs its own.
 *
 * @internal
 */
export class BearerTokenCache {
  private cached: BearerToken | undefined;
  private inFlight: Promise<BearerToken> | undefined;
  /**
   * Bumped by {@link BearerTokenCache.refreshPostEviction} to supersede every fetch already in
   * flight. A superseded fetch still resolves to its own caller, but must not publish its token into
   * `cached` or clear the newer fetch's `inFlight` slot — otherwise a pre-401 fetch resolving late
   * would re-cache exactly the token the server rejected, which is the outcome AUTH-37 forbids.
   */
  private generation = 0;
  /**
   * The generation an EVICTION-DRIVEN fetch currently in flight was started at, or
   * {@link NO_EVICTION_GENERATION} when the in-flight fetch (if any) came from the ordinary
   * {@link BearerTokenCache.stamp} path.
   *
   * This is what lets {@link BearerTokenCache.refreshPostEviction} coalesce without re-opening the
   * hazard it exists to close. A pre-401 fetch must never be joined -- it can resolve to the very
   * token the server just rejected -- but two 401s on the SAME token arriving together should share
   * one fetch, or a mass revocation turns every in-flight request into its own provider call, which
   * is exactly the thundering herd AUTH-34's single-flight clause forbids. Comparing this against
   * `generation` separates the two cases exactly: only a fetch started by `refreshPostEviction` AT
   * the current generation is a genuine post-eviction fetch.
   */
  private inFlightEvictionGeneration = NO_EVICTION_GENERATION;

  /**
   * AUTH-34/AUTH-37's three zones: fresh (stamp, no refresh), expiring-but-valid (stamp the stale
   * token, refresh in the background), expired or missing (await a fresh single-flight fetch).
   *
   * @param fetchOptions - the provider, margin, injected clock reading, and call signal.
   * @returns the token to stamp.
   * @throws AuthResolutionError when the provider yields null or an already-expired token (AUTH-35).
   */
  async stamp(fetchOptions: BearerFetch): Promise<BearerToken> {
    const {marginMs, nowMs} = fetchOptions;
    if (this.cached !== undefined) {
      const expiring = isBearerTokenExpired(this.cached, nowMs, marginMs);
      if (!expiring) return this.cached; // fresh zone: stamp, no refresh
      const expired = isBearerTokenExpired(this.cached, nowMs, 0); // AUTH-35: no margin at fetch time
      if (!expired) {
        const stillValid = this.cached;
        // Expiring-but-valid zone: fire-and-forget, and the catch is BLANKET on purpose. AUTH-37 is
        // unconditional -- "a failed/unusable BACKGROUND refresh MUST NOT fail the in-flight
        // request (log-and-continue)" -- and a bare `void this.refresh(...)` would leave the
        // rejection unhandled, which under Node's default policy terminates the process.
        //
        // An earlier shape re-threw an InvariantViolation here, reasoning that a programmer error
        // must crash loudly. That was wrong twice over. The throw landed in a promise nobody awaits,
        // so it did not surface at the fault -- it killed the host process asynchronously, with no
        // request to attribute it to, while the request that triggered it had already been served a
        // valid token. And the fault it re-raised is not ours: a blank token from a caller-supplied
        // `TokenProvider` is an operational fault (an empty environment variable, a malformed IdP
        // payload) as often as a coding one. `error-handling.md`'s crash-loudly rule governs OUR
        // invariants at the point WE detect them; it does not license re-raising someone else's
        // failure into a detached promise.
        //
        // AUTH-37's "log-and-continue" is now BOTH halves. The log arrived on 2026-09-02, once 7b's
        // `getGlobalLogger()` existed to write to; until then the rejection was swallowed with no
        // trace at all. Continue is unchanged: the still-valid token was already returned and a
        // failed refresh evicts nothing.
        //
        // Not raced against `fetchOptions.signal`: this refresh belongs to the cache, not to the
        // request that happened to trigger it, and it must outlive that request's cancellation.
        void this.refresh(fetchOptions, NO_EVICTION_GENERATION).catch(
          (error: unknown) => {
            warnRefreshFailed(error);
          },
        );
        return stillValid;
      }
    }
    // Expired/missing zone: await a fresh single-flight fetch, but only until this caller's own
    // signal fires (AUTH-34, and `concurrency-and-async.md`'s honour-the-signal rule).
    return raceAbort(
      () => this.refresh(fetchOptions, NO_EVICTION_GENERATION),
      fetchOptions.signal,
    );
  }

  /**
   * AUTH-37's post-eviction path: a fetch guaranteed to have STARTED after a 401 in this eviction
   * burst, never before one.
   *
   * {@link BearerTokenCache.stamp} is not a substitute. It routes through `refresh`, which hands back
   * an already-in-flight promise — and that fetch may have started BEFORE the 401 arrived. AUTH-11
   * explicitly permits a provider that caches or refreshes internally, so such a fetch can resolve to
   * the very token the server just rejected, which is precisely what AUTH-37's "re-stamp a single
   * retry with a freshly fetched token" forbids.
   *
   * It does NOT bypass single-flight wholesale, which an earlier shape did: under a mass revocation
   * every in-flight request gets its own 401, and starting one provider fetch per 401 is the
   * thundering herd AUTH-34's "at most one provider fetch" clause exists to prevent. Coalescing is
   * gated on {@link BearerTokenCache.inFlightEvictionGeneration} instead, so concurrent 401s share
   * one post-eviction fetch while a pre-401 fetch is still always superseded. That is why the name
   * is `refreshPostEviction` rather than `refreshNow`: this call may JOIN a sibling 401's fetch, and
   * what it actually guarantees is that no fetch predating this eviction burst is ever joined.
   *
   * @param fetchOptions - the provider, margin, injected clock reading, and call signal.
   * @returns the freshly fetched token.
   * @throws AuthResolutionError when the provider yields null or an already-expired token (AUTH-35).
   */
  // `async` for AUTH-38's uniform error model: this path runs caller-supplied provider code, and a
  // provider that fails BEFORE returning a promise would otherwise throw synchronously out of a
  // method whose declared return type is `Promise<BearerToken>`.
  async refreshPostEviction(fetchOptions: BearerFetch): Promise<BearerToken> {
    return raceAbort(
      () => this.startPostEviction(fetchOptions),
      fetchOptions.signal,
    );
  }

  /**
   * The join-or-supersede decision, split out so {@link raceAbort} can gate it on the caller's signal
   * without the generation bump drifting out of the caller's synchronous span. Nothing awaits between
   * the `inFlight` read and the write, which is what makes single-flight lock-free.
   */
  private startPostEviction(fetchOptions: BearerFetch): Promise<BearerToken> {
    if (
      this.inFlight !== undefined &&
      this.inFlightEvictionGeneration === this.generation
    ) {
      // Another 401 in this same burst already started a post-eviction fetch: join it (AUTH-34).
      return this.inFlight;
    }
    this.generation += 1; // supersede every fetch already in flight
    this.inFlight = undefined; // drop the pre-401 fetch's claim on the slot before starting a new one
    return this.refresh(fetchOptions, this.generation);
  }

  /**
   * AUTH-36: clears the cache only when the currently-cached token is the exact one that produced the
   * 401, matched on the stamped header value — so a token another in-flight request already refreshed
   * survives.
   *
   * The survivor is RETURNED, not merely left in place, because that is the only way AUTH-36's
   * "preserving a token another request already refreshed" clause becomes observable. Preserving it
   * and then unconditionally fetching a replacement — which is what the caller did before — overwrote
   * the preserved token on the next tick and made the whole clause a no-op.
   *
   * @param rejectedHeaderValue - the `Authorization` value the rejected request carried.
   * @returns the cached token when it is NOT the rejected one (another request already refreshed it,
   *   so the retry should stamp this instead of fetching again), or `undefined` when the rejected
   *   token was evicted or nothing was cached.
   */
  evict(rejectedHeaderValue: string): BearerToken | undefined {
    if (this.cached === undefined) return undefined;
    if (`Bearer ${this.cached.token}` === rejectedHeaderValue) {
      this.cached = undefined;
      return undefined;
    }
    return this.cached;
  }

  /**
   * `nowMs` is threaded in rather than read from `Date.now()`: `stamp()` already takes an injected
   * clock, and a refresh validating against the ambient wall clock while its caller reasons about an
   * injected one would be a second, invisible clock — it would reject every token under synthetic
   * time and be uncontrollable in production.
   */
  private refresh(
    fetchOptions: BearerFetch,
    evictionGeneration: number,
  ): Promise<BearerToken> {
    // Returns the RAW shared promise, never one raced against a caller signal. `raceAbort` is applied
    // by the two public entry points instead, so the background refresh in `stamp()` -- which belongs
    // to the cache rather than to any one request -- is deliberately left unraced.
    if (this.inFlight !== undefined) return this.inFlight; // coalesce concurrent expiring/missing callers
    const generation = this.generation;
    // The generation is passed in rather than derived from a boolean flag: the ordinary path writes
    // `NO_EVICTION_GENERATION` so a later `refreshPostEviction` cannot mistake a `stamp()`-driven
    // fetch that happens to sit at the current generation for a post-eviction one and join it.
    this.inFlightEvictionGeneration = evictionGeneration;
    const pending = invokeProvider(fetchOptions.provider)
      .then((token: BearerToken | null | undefined) => {
        // `token` is widened at this ONE boundary on purpose. `TokenProvider`'s declared return type
        // is non-nullable, so comparing the un-widened value against null trips
        // `@typescript-eslint/no-unnecessary-condition` from the strict-type-checked tier -- but
        // AUTH-35 requires a RUNTIME guard, because a plain-JS caller (or a mis-typed `any`
        // boundary) can hand back null regardless of what the type says. Widening states that intent
        // instead of suppressing the rule.
        if (
          token === null ||
          token === undefined ||
          isBearerTokenExpired(token, fetchOptions.nowMs, 0)
        ) {
          throw new AuthResolutionError(
            'token provider returned a null or already-expired token',
          ); // AUTH-35
        }
        if (generation === this.generation) this.cached = token;
        return token;
      })
      .finally(() => {
        // Never cache a rejection (AUTH-11/AUTH-35) -- it already propagates through `finally`
        // untouched, so no `catch` is added. Guarded on the generation so a superseded fetch cannot
        // clear a newer fetch's slot.
        if (generation === this.generation) this.inFlight = undefined;
      });
    this.inFlight = pending;
    return pending;
  }
}
