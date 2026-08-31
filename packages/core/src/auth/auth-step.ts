// SPDX-License-Identifier: MIT
// packages/core/src/auth/auth-step.ts
import type {Clock} from '../config/clock.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {assertNever, invariant} from '../invariant.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {releaseQuietly, withReleaseFailure} from '../recovery/release.js';
import {
  clearCrossOriginMarker,
  hasCrossOriginMarker,
} from '../redirect/cross-origin.js';
import {basicHandler} from './basic.js';
import {BearerTokenCache} from './bearer-cache.js';
import {parseChallenges} from './challenge.js';
import type {Challenge, ChallengeHandler} from './challenge.js';
import {composingHandler, type ComposingHandler} from './composing-handler.js';
import type {
  ApiKeyCredential,
  NameKeyCredential,
  TokenProvider,
} from './credential.js';
import type {AuthDescriptor} from './descriptor.js';
import {digestHandler} from './digest.js';
import type {DigestAlgorithm} from './digest.js';
import {PlaintextCredentialError} from './errors.js';
import {resolveAuthRequirement, type AuthTiers} from './resolve.js';
import type {AuthScheme} from './scheme.js';
import {stampStaticKey} from './static-key.js';

/**
 * Username and password for the `BASIC` scheme.
 *
 * @public
 */
export interface BasicCredential {
  /** The user id (AUTH-14: non-empty; whitespace permitted). */
  readonly username: string;
  /** The password (AUTH-14: non-empty; whitespace permitted). */
  readonly password: string;
}

/**
 * Username, password, and algorithm preference for the `DIGEST` scheme.
 *
 * @public
 */
export interface DigestCredential {
  /** The user id. Must not be blank. */
  readonly username: string;
  /** The password. Must not be blank. */
  readonly password: string;
  /**
   * Preferred-first order, and also the acceptable set (AUTH-16). Omitted means strongest-first over
   * all four supported algorithms.
   */
  readonly algorithmPreference?: readonly DigestAlgorithm[] | undefined;
}

/**
 * The token source and refresh margin for the `OAUTH2` scheme.
 *
 * @public
 */
export interface BearerCredential {
  /** The token source (AUTH-11). */
  readonly provider: TokenProvider;
  /** Per-credential refresh margin; falls back to {@link AuthStepSettings.bearerMarginMs}. */
  readonly marginMs?: number | undefined;
}

/**
 * The static key, header, and prefix for the `API_KEY` scheme (AUTH-26).
 *
 * @public
 */
export interface ApiKeyCredentialConfig {
  /** The key. Both credential classes are nominal, so no object literal substitutes for one. */
  readonly credential: ApiKeyCredential | NameKeyCredential;
  /** The header to write. Defaults to `Authorization`. */
  readonly headerName?: string | undefined;
  /** A scheme prefix, written followed by exactly one space. */
  readonly prefix?: string | undefined;
}

/**
 * Which schemes a caller has actually configured a credential for.
 *
 * This shape is designed by this phase — neither the product spec nor the design doc names one. It is
 * both the credential material the step stamps with, and the source `availableSchemesOf()` derives
 * AUTH-5's `availableSchemes` from, which is what keeps resolution from ever inspecting a concrete
 * credential value.
 *
 * @public
 */
export interface AuthCredentialSet {
  /** Enables the `BASIC` scheme. */
  readonly basic?: BasicCredential | undefined;
  /** Enables the `DIGEST` scheme. */
  readonly digest?: DigestCredential | undefined;
  /** Enables the `OAUTH2` scheme. */
  readonly bearer?: BearerCredential | undefined;
  /** Enables the `API_KEY` scheme. */
  readonly apiKey?: ApiKeyCredentialConfig | undefined;
}

/**
 * AUTH-5: derives the satisfiable-scheme set from which credentials are configured, without exposing
 * any credential value to resolution.
 *
 * `NO_AUTH` is deliberately absent: AUTH-5 makes it satisfiable unconditionally, so membership here
 * would be redundant and would let a caller's empty credential set read as "nothing is available"
 * while a `NO_AUTH` requirement still resolves.
 *
 * @param credentials - the configured credential set.
 * @returns the schemes with a matching credential.
 *
 * @internal
 */
export function availableSchemesOf(
  credentials: AuthCredentialSet,
): ReadonlySet<AuthScheme> {
  const schemes = new Set<AuthScheme>();
  if (credentials.basic !== undefined) schemes.add('BASIC');
  if (credentials.digest !== undefined) schemes.add('DIGEST');
  if (credentials.bearer !== undefined) schemes.add('OAUTH2');
  if (credentials.apiKey !== undefined) schemes.add('API_KEY');
  return schemes;
}

/**
 * The handler list is derived from `credentials`, digest-first — "callers order stronger schemes
 * first" (AUTH-23). Both handlers need a username and password to do anything, so a zero-argument
 * `[digestHandler(), basicHandler()]` default is not constructible, which is why this is derived
 * rather than defaulted.
 *
 * There is deliberately no caller override. An earlier shape took `AuthStepSettings.handlers`, which
 * forced `Challenge`/`ChallengeHandler`/`DigestUriContext` onto the public barrel to make the field
 * callable — and then delivered less than it promised: `basicHandler`/`digestHandler` stay internal,
 * so a caller supplying one handler silently LOST the credential-derived ones rather than composing
 * with them. {@link AuthStepSettings.challengeHook} already covers the custom-scheme case end to end,
 * with a shape a caller can actually satisfy.
 */
function buildHandlers(
  credentials: AuthCredentialSet,
): readonly ChallengeHandler[] {
  const handlers: ChallengeHandler[] = [];
  if (credentials.digest !== undefined) {
    handlers.push(
      digestHandler(credentials.digest.username, credentials.digest.password, {
        algorithmPreference: credentials.digest.algorithmPreference,
      }),
    );
  }
  if (credentials.basic !== undefined) {
    handlers.push(
      basicHandler(credentials.basic.username, credentials.basic.password),
    );
  }
  return handlers;
}

/**
 * AUTH-30's pluggable 401/407 reaction.
 *
 * Returning `undefined` means "no replacement" — the challenge response is surfaced unchanged. A
 * returned request is driven exactly once through a fresh copy of the downstream chain, with no
 * further challenge handling on that drive.
 *
 * @public
 */
export type ChallengeHook = (
  response: Response,
  request: Request,
  options?: {
    /**
     * The calling request's cancellation, threaded straight through from `StepContext.signal`.
     *
     * A hook is the sanctioned place to run a custom OAuth2 refresh-token grant, which is external
     * I/O on the request path -- and `docs/knowledge/harvested/concurrency-and-async.md` is explicit that a
     * signal accepted at the top of a call chain must reach the actual I/O primitive, or it is
     * decoration. Without this a hung hook pinned the auth step, every retry attempt nested under
     * it, and the whole request, with no way for the caller to abort.
     */
    readonly signal?: AbortSignal | undefined;
  },
) => Promise<Request | undefined>;

/**
 * Everything {@link authStep} accepts.
 *
 * @public
 */
export interface AuthStepSettings {
  /** Which schemes are available, and the material to stamp them with. */
  readonly credentials: AuthCredentialSet;
  /**
   * The operation and client tiers, fixed at construction. The `perCall` slot may additionally be
   * supplied per call via `RequestOptions.auth` (AUTH-4), which wins over any `perCall` value
   * configured here.
   */
  readonly tiers: AuthTiers;
  /**
   * Replaces the scheme-dependent default 401/407 reaction entirely — e.g. a custom OAuth2
   * refresh-token grant (AUTH-30).
   */
  readonly challengeHook?: ChallengeHook | undefined;
  /**
   * Refresh margin ahead of a bearer token's expiry.
   *
   * @defaultValue 30000 — AUTH-34's "default 30 seconds".
   */
  readonly bearerMarginMs?: number | undefined;
  /**
   * Wall-clock source for bearer expiry evaluation, injected so the three-zone policy is testable
   * through the step and not only through the cache directly. Reading `Date.now()` inside the cache
   * would be a second, uncontrollable clock — `bearer-cache.ts` takes an injected `nowMs` precisely so
   * its one caller can supply a controllable one, and this is that caller.
   *
   * Typed as the `now()` half of {@link Clock}, not a bare `() => number` and not the whole `Clock`:
   * `RetryStepOptions.clock` is a full `Clock`, and one instance has to satisfy both slots or a
   * caller who fakes time for retry and forgets auth gets two clocks disagreeing inside one pipeline.
   * Narrowing to the member actually used means no caller has to implement `monotonic`/`sleep` for a
   * step that never sleeps.
   *
   * @defaultValue a `now()` reading `Date.now()`
   */
  readonly clock?: Pick<Clock, 'now'> | undefined;
}

/**
 * A refresh margin must be a finite, non-negative duration -- the same rule and the same wording
 * 5a's `retrySettings()` and 5b's `redirectSettings()` apply to every numeric setting they take, and
 * an invalid value is a PROGRAMMER error there and here alike, so it trips `invariant()` rather than
 * a typed error leaf.
 *
 * Not decorative. `isBearerTokenExpired` is `nowMs + marginMs > expiresAt`, so a `NaN` margin -- the
 * shape `Number(process.env.MARGIN_MS)` produces for an unset variable -- makes BOTH the margin
 * comparison and AUTH-35's no-margin comparison false. The cache then reads a long-dead token as
 * fresh, returns it from the hot path, and never calls the provider again: a revoked credential
 * stamped onto every request, indefinitely and silently. A large negative margin does the same.
 */
function validateMarginMs(label: string, value: number | undefined): void {
  if (value === undefined) return;
  invariant(
    Number.isFinite(value) && value >= 0,
    `${label} must be a finite, non-negative duration, got ${String(value)}`,
  );
}

/** AUTH-4: a per-call descriptor (`RequestOptions.auth`, via `StepContext.options`) fills the perCall slot. */
function effectiveTiers(
  configured: AuthTiers,
  perCall: AuthDescriptor | undefined,
): AuthTiers {
  return perCall === undefined ? configured : {...configured, perCall};
}

/** Stable identity for pillar-slot occupancy and anchor matching (PIPE-6/PIPE-18). @internal */
export const AUTH_STEP_TYPE: unique symbol = Symbol('dexpace.auth');

/** AUTH-28: case-insensitive, evaluated before any token fetch or header write. */
function requireHttps(url: URL, scheme: AuthScheme): void {
  if (url.protocol.toLowerCase() !== 'https:') {
    throw new PlaintextCredentialError('authStep', scheme);
  }
}

interface StampContext {
  readonly scheme: AuthScheme;
  readonly credentials: AuthCredentialSet;
  readonly bearerCache: BearerTokenCache;
  readonly marginMs: number;
  readonly nowMs: number;
  readonly signal: AbortSignal | undefined;
}

function withHeader(request: Request, name: string, value: string): Request {
  return request
    .newBuilder()
    .headers(request.headers.newBuilder().set(name, value).build())
    .build();
}

/**
 * Whether the caller has given up.
 *
 * A function, not two inline `signal?.aborted === true` tests, and the indirection is load-bearing:
 * `AbortSignal.aborted` is a LIVE getter that flips while an `await` is outstanding, but TypeScript
 * narrows it like an ordinary property and carries that narrowing straight across the await. The
 * second check in {@link handleChallenge} -- the one that exists precisely because the world moved
 * during the hook -- therefore reads as `'false | undefined' and 'true' have no overlap` and fails to
 * compile, which is the compiler being confidently wrong about mutable external state. Routing every
 * read through a call re-reads the getter each time.
 *
 * `docs/knowledge/harvested/concurrency-and-async.md`: "state checked before an `await` must be re-validated
 * after every `await` that could have let the world move."
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/** AUTH-25: which challenge header carried the offer decides which header the answer goes into. */
function answerHeaderName(isProxy: boolean): string {
  return isProxy ? 'Proxy-Authorization' : 'Authorization';
}

/**
 * `OAUTH2` and `API_KEY` stamp preemptively — no server round-trip is needed to know what to send.
 * `BASIC`, `DIGEST`, and `NO_AUTH` never do: Digest structurally cannot stamp before seeing the
 * server's `realm`/`nonce`, AUTH-14/AUTH-23–AUTH-25 phrase Basic entirely in terms of answering a
 * parsed challenge, and `NO_AUTH` has nothing to stamp.
 *
 * An exhaustive `switch` closing on `assertNever`, not an if-chain: `AuthScheme` is a closed
 * discriminant, and `docs/knowledge/harvested/data-modeling.md` bars an if-chain over one because it gives no
 * exhaustiveness guarantee and falls through silently when a variant is added — and the value that
 * would fall through here is a credential-stamping decision.
 */
async function preemptiveStamp(
  request: Request,
  context: StampContext,
): Promise<Request> {
  switch (context.scheme) {
    case 'OAUTH2': {
      const bearer = context.credentials.bearer;
      invariant(
        bearer !== undefined,
        'resolved OAUTH2 but no bearer credential configured',
      );
      const token = await context.bearerCache.stamp({
        provider: bearer.provider,
        marginMs: bearer.marginMs ?? context.marginMs,
        nowMs: context.nowMs,
        signal: context.signal,
      });
      return withHeader(request, 'Authorization', `Bearer ${token.token}`);
    }
    case 'API_KEY': {
      const apiKey = context.credentials.apiKey;
      invariant(
        apiKey !== undefined,
        'resolved API_KEY but no apiKey credential configured',
      );
      const {headerName, headerValue} = stampStaticKey(
        apiKey.credential,
        apiKey,
      );
      return withHeader(request, headerName, headerValue);
    }
    case 'BASIC':
    case 'DIGEST':
    case 'NO_AUTH':
      return request; // challenge-driven, or no credential at all
    default:
      return assertNever(context.scheme);
  }
}

/**
 * What the outbound pass decided, carried into the challenge pass.
 *
 * `crossOrigin` has to survive past the dispatch: AUTH-29's suppression covers the WHOLE hop, so the
 * challenge reaction needs the same answer the outbound pass computed, and the marker itself is gone
 * from the request by then.
 */
interface OutboundPlan {
  readonly crossOrigin: boolean;
  readonly outbound: Request;
}

/**
 * AUTH-29 then AUTH-28, in that order.
 *
 * The cross-origin check comes FIRST, and the marker is cleared unconditionally before either branch
 * — it must never reach the wire, and clearing up front means it cannot survive into a request built
 * by the stamping logic. A marked hop then skips the HTTPS guard AND preemptive stamping entirely,
 * forwarding the cleared request credential-free; AUTH-29 makes that skip deliberate, so a
 * server-chosen downgrade hop is forwarded rather than hard-failing.
 *
 * On an unmarked hop the HTTPS guard runs only where a credential will actually be attached —
 * `NO_AUTH` is exempt, matching AUTH-28's own qualifier — and before any token fetch or header write.
 */
async function planOutbound(
  seedRequest: Request,
  context: StampContext,
): Promise<OutboundPlan> {
  const crossOrigin = hasCrossOriginMarker(seedRequest.headers);
  const cleared = seedRequest
    .newBuilder()
    .headers(clearCrossOriginMarker(seedRequest.headers))
    .build();

  if (crossOrigin) return {crossOrigin, outbound: cleared};
  if (context.scheme !== 'NO_AUTH') requireHttps(cleared.url, context.scheme);
  return {crossOrigin, outbound: await preemptiveStamp(cleared, context)};
}

interface ChallengeSelection {
  readonly value: string;
  readonly isProxy: boolean;
}

/**
 * AUTH-25: a 401 is answered from `WWW-Authenticate`, a 407 from `Proxy-Authenticate`. Reading only
 * the header that matches the status keeps the pairing honest — a 401 carrying a stray
 * `Proxy-Authenticate` must not produce a `Proxy-Authorization`, and vice versa.
 */
function pickChallengeHeader(
  response: Response,
): ChallengeSelection | undefined {
  if (response.status.code === 401) {
    const www = response.headers.get('WWW-Authenticate');
    return www === undefined ? undefined : {value: www, isProxy: false};
  }
  const proxy = response.headers.get('Proxy-Authenticate');
  return proxy === undefined ? undefined : {value: proxy, isProxy: true};
}

interface DefaultHookContext {
  readonly scheme: AuthScheme;
  readonly credentials: AuthCredentialSet;
  readonly bearerCache: BearerTokenCache;
  readonly composing: ComposingHandler;
  readonly marginMs: number;
  readonly nowMs: number;
  readonly signal: AbortSignal | undefined;
}

/** AUTH-36: evict the exact rejected token, fetch a genuinely fresh one, re-stamp once. */
async function oauth2ChallengeHook(
  request: Request,
  selection: ChallengeSelection,
  context: DefaultHookContext,
): Promise<Request | undefined> {
  const bearer = context.credentials.bearer;
  invariant(
    bearer !== undefined,
    'resolved OAUTH2 but no bearer credential configured',
  );
  const headerName = answerHeaderName(selection.isProxy);
  const rejected = request.headers.get(headerName);
  // AUTH-36: no Authorization on the rejected request -> surface the challenge unchanged.
  if (rejected === undefined) return undefined;
  const challenges: readonly Challenge[] = parseChallenges(selection.value);
  if (!challenges.some(challenge => challenge.scheme === 'bearer')) {
    return undefined; // AUTH-36: the response advertises no Bearer challenge
  }

  // AUTH-36's preservation clause, made observable: `evict()` clears the cache only when the cached
  // token IS the rejected one, and hands back the survivor otherwise. A survivor means another
  // request already refreshed past this 401, so the retry stamps THAT rather than burning a second
  // provider fetch to arrive at the same place.
  const preserved = context.bearerCache.evict(rejected);
  if (preserved !== undefined) {
    return withHeader(request, headerName, `Bearer ${preserved.token}`);
  }

  // AUTH-37's post-eviction clause: a fetch that STARTED after this 401, so the retry cannot re-send
  // the rejected token. Plain `stamp()` would coalesce onto a fetch that may have started before this
  // 401 came back, and AUTH-11 permits a provider that caches internally, so that fetch can resolve
  // to exactly the token the server just rejected. `refreshPostEviction` still coalesces concurrent
  // 401s onto one fetch (AUTH-34) -- it supersedes pre-401 fetches only.
  //
  // The margin is INERT on this path and is passed anyway: `refresh()` validates the fetched token
  // against a zero margin (AUTH-35) and never reads `BearerFetch.marginMs`, which only `stamp()`
  // consults. It is resolved identically to the preemptive path rather than hard-coded, so the two
  // call sites cannot drift apart if `refresh()` ever grows a margin-dependent branch -- and so a
  // reader comparing them does not have to work out which of two spellings is the intended one.
  const token = await context.bearerCache.refreshPostEviction({
    provider: bearer.provider,
    marginMs: bearer.marginMs ?? context.marginMs,
    nowMs: context.nowMs,
    signal: context.signal,
  });
  return withHeader(request, headerName, `Bearer ${token.token}`);
}

/**
 * AUTH-23–AUTH-25: delegate to the composing handler; no replacement when nothing is satisfiable.
 *
 * `selection.isProxy` reaches {@link answerHeaderName} and nothing else. The handlers produce the
 * header VALUE only, and neither of them varies it by proxy-ness, so the flag stops here rather than
 * being threaded into a contract that cannot use it.
 */
async function basicDigestChallengeHook(
  request: Request,
  selection: ChallengeSelection,
  context: DefaultHookContext,
): Promise<Request | undefined> {
  const challenges = parseChallenges(selection.value);
  const url = request.url; // HTTP-5: a fresh URL per access, so read it once.
  const requestTarget = `${url.pathname}${url.search}`;
  const value = await context.composing.stamp(challenges, {
    method: request.method,
    requestTarget,
  });
  if (value === undefined) return undefined;
  return withHeader(request, answerHeaderName(selection.isProxy), value);
}

/**
 * The scheme-dependent default hook body. AUTH-30's generic contract governs INVOCATION; this decides
 * what each resolved scheme does with a parsed challenge. `API_KEY`/`NO_AUTH` never react — static or
 * absent credentials have no reactive behavior, which is exactly AUTH-30's "the default hook yields no
 * replacement".
 *
 * Exhaustive `switch` + `assertNever`, not an if-chain, for the same reason as `preemptiveStamp`: a
 * sixth `AuthScheme` added later must not silently inherit the BASIC/DIGEST branch's stamping.
 */
async function defaultChallengeHook(
  response: Response,
  request: Request,
  context: DefaultHookContext,
): Promise<Request | undefined> {
  const selection = pickChallengeHeader(response);
  if (selection === undefined) return undefined;

  switch (context.scheme) {
    case 'OAUTH2':
      return oauth2ChallengeHook(request, selection, context);
    case 'BASIC':
    case 'DIGEST':
      return basicDigestChallengeHook(request, selection, context);
    case 'API_KEY':
    case 'NO_AUTH':
      return undefined;
    default:
      return assertNever(context.scheme);
  }
}

/**
 * AUTH-28 on the REPLAY path. The outbound guard is not sufficient here: it is skipped entirely for
 * `NO_AUTH`, and nothing constrains a caller-supplied hook to preserve the request URL. A replay
 * carrying a credential header is by definition "a path where a credential will be attached", and
 * AUTH-28 says ANY such path.
 *
 * The challenge response is closed before the throw, for the same reason AUTH-32 closes it on a hook
 * throw: this is past the point where the caller still owns it, so propagating unclosed leaks the body.
 */
async function guardReplayScheme(
  replacement: Request,
  response: Response,
  scheme: AuthScheme,
): Promise<void> {
  const carriesCredential =
    replacement.headers.has('Authorization') ||
    replacement.headers.has('Proxy-Authorization');
  if (!carriesCredential) return;
  try {
    requireHttps(replacement.url, scheme);
  } catch (error) {
    // The GUARD's error stays primary. `Response.close()` rethrows whatever cancelling the body
    // raised, so a bare `await response.close()` here replaced `PlaintextCredentialError` -- typed,
    // caller-catchable, security-relevant -- with the teardown failure, the inversion RECOV-12
    // forbids. Same helpers 4b built and 5b's `decideOrClose` uses.
    throw withReleaseFailure(error, await releaseQuietly(response));
  }
}

/** What {@link runHook} needs besides the hook itself. Bundled to stay inside `max-params`. */
interface HookInvocation {
  readonly response: Response;
  readonly request: Request;
  readonly signal: AbortSignal | undefined;
}

/**
 * AUTH-32: a hook that throws, or whose promise rejects, closes the open challenge response before the
 * error propagates.
 *
 * The HOOK's error stays primary. `Response.close()` rethrows whatever cancelling the body raised, so
 * a bare `await response.close()` here discarded the hook's own failure and surfaced the teardown
 * failure in its place -- RECOV-12's "attaching any close error as suppressed so it never masks the
 * primary", inverted. `releaseQuietly`/`withReleaseFailure` are 4b's helpers, shared with the retry
 * engine and 5b's `decideOrClose`.
 */
async function runHook(
  hook: ChallengeHook,
  invocation: HookInvocation,
): Promise<Request | undefined> {
  const {response, request, signal} = invocation;
  try {
    return await hook(response, request, {signal});
  } catch (error) {
    throw withReleaseFailure(error, await releaseQuietly(response));
  }
}

interface ChallengeDrive {
  readonly response: Response;
  readonly outbound: Request;
  readonly fork: () => (request?: Request) => Promise<Response>;
  readonly settings: AuthStepSettings;
  readonly hookContext: DefaultHookContext;
}

/**
 * AUTH-30–AUTH-33: the 401/407 reaction, split out of the pillar closure to keep both under the
 * 70-line cap and to give the response-lifecycle rules one place to live.
 *
 * The challenge response is returned OPEN — the caller's to close — on every no-replay outcome (no
 * matching challenge header, a one-shot body, a hook yielding nothing, a non-replayable replacement).
 * It is CLOSED before the replay dispatch, and before propagating a hook throw or a replay-path guard
 * failure.
 */
async function handleChallenge(drive: ChallengeDrive): Promise<Response> {
  const {response, outbound, fork, settings, hookContext} = drive;

  const selection = pickChallengeHeader(response);
  // AUTH-33: no matching challenge header -> unchanged, and the hook is never consulted.
  if (selection === undefined) return response;

  // There is deliberately NO "skip the hook when the body is one-shot" fast path here. An earlier
  // shape had one, on the reasoning that the default hook would only fetch a replacement that is
  // then thrown away -- which is wrong on inspection: OAUTH2's hook EVICTS the rejected token and
  // populates the cache for every subsequent request, so the work is not wasted. Skipping it left a
  // server-revoked token cached behind every non-replayable request, and a token with no `expiresAt`
  // (AUTH-10's "never locally expires") never aged out either, so a stream-only client re-sent the
  // dead credential forever. AUTH-36's eviction clause and AUTH-31's replay gate are separate
  // sentences; only the DISPATCH below is gated.

  // The caller had already abandoned this call before the challenge even arrived. The default OAUTH2
  // hook does an IdP round trip and the BASIC/DIGEST one does key derivation, so running either here
  // is pure waste -- and `redirectStep` makes the same call, returning the current response open
  // rather than doing more work. The signal threaded into `runHook` below covers the other case: an
  // abort arriving while a hook is already in flight.
  if (isAborted(hookContext.signal)) return response;

  const hook: ChallengeHook =
    settings.challengeHook ??
    ((res, req) => defaultChallengeHook(res, req, hookContext));

  const replacement = await runHook(hook, {
    response,
    request: outbound,
    signal: hookContext.signal,
  });
  // AUTH-33: the hook yielded nothing -> the challenge response is surfaced unchanged and unclosed.
  if (replacement === undefined) return response;

  // AUTH-31, applied uniformly: a non-replayable replacement body skips the replay, surfaces the
  // original unchanged, and MUST NOT close it -- the caller owns it. The reference applies this gate on
  // its sync step only and recommends a port extend it; with one unified step there is exactly one
  // place to apply it, so it covers OAUTH2's evict-and-retry too.
  if (replacement.body !== undefined && !replacement.body.replayable) {
    return response;
  }

  // The caller gave up WHILE the hook ran -- the pre-hook check above cannot see this one. Surfacing
  // the challenge open and unclosed is the same answer every other no-replay outcome gives; spending
  // a second wire send on a request nobody is waiting for is the one thing that must not happen.
  if (isAborted(hookContext.signal)) return response;

  await guardReplayScheme(replacement, response, hookContext.scheme); // AUTH-28

  await response.close(); // AUTH-30: the original is closed before the replacement is driven.
  // AUTH-30: exactly once, through a FRESH chain copy, with no further challenge handling on it.
  return fork()(replacement);
}

/**
 * The single AUTH pillar step (AUTH-27–AUTH-33).
 *
 * One pluggable challenge-reaction extension point ({@link AuthStepSettings.challengeHook}) with a
 * scheme-dependent default body — not three competing mechanisms. AUTH-30's contract (consult the
 * hook, close the original on a non-null replacement, re-drive once through a fresh chain copy, no
 * nested re-challenge) governs every scheme uniformly; AUTH-23–AUTH-26 and AUTH-34–AUTH-37 describe
 * what the DEFAULT hook does for each resolved scheme.
 *
 * `stage: 'AUTH'` is baked into the descriptor this factory returns, which is how PIPE-36 is satisfied
 * structurally. `ctx.fork` is asserted rather than checked — AUTH is in `PILLAR_STAGES`, so its
 * absence means the descriptor was installed somewhere it cannot be, a programmer error. Every
 * dispatch, INCLUDING the first, goes through a fresh `ctx.fork()` rather than `ctx.next()`, since a
 * challenge may drive the chain a second time and `next()`'s single-invocation guard would trip
 * (PIPE-15).
 *
 * Nested inside both redirect (5b) and retry (5a) per AUTH-27's "redirect wraps retry wraps auth", so
 * it re-resolves and re-stamps per redirect hop and per retry attempt (PIPE-2).
 *
 * Both challenge statuses are handled: a 401 is answered from `WWW-Authenticate` into `Authorization`,
 * a 407 from `Proxy-Authenticate` into `Proxy-Authorization` (AUTH-25). A cross-origin-marked hop
 * answers neither (AUTH-29).
 *
 * AUTH-38 is satisfied structurally: `fn` is `async`, so the HTTPS-guard failure and any hook error
 * reach the caller as a rejected promise rather than a synchronous throw.
 *
 * @param settings - credentials, tiers, and the optional challenge hook and clock overrides.
 * @returns the descriptor to install in a pipeline's AUTH slot.
 * @throws PlaintextCredentialError — as a rejected promise — when the resolved scheme would attach a
 *   credential over a non-HTTPS URL (AUTH-28), on the outbound pass and again on a challenge replay.
 *   Recover by fixing the endpoint's scheme; retrying will not help.
 * @throws AuthResolutionError — as a rejected promise — when the selected tier lists no scheme with a
 *   matching configured credential (AUTH-6; AUTH-4 governs only WHICH tier is selected), or when the
 *   token provider returns a null or already-expired token (AUTH-35). The first is a configuration
 *   fault; the second is transient and the next request retries the fetch.
 * @throws HeaderValidationError — as a rejected promise — when the credential material will not fit in
 *   a header value: a `TokenProvider` yielding a token with a control character passes AUTH-9's
 *   non-blank check but fails HTTP-18's outbound grammar at the write.
 * @throws InvariantViolation — synchronously from this factory when `bearerMarginMs` or
 *   `BearerCredential.marginMs` is not a finite, non-negative duration, or a configured Digest/Basic
 *   credential is blank or not header-safe; and as a rejected promise from `send()` when no auth tier
 *   is configured at all (AUTH-6). All are caller misconfigurations, not operational failures.
 * @throws Anything a caller-supplied `TokenProvider` or `challengeHook` raises, unwrapped and
 *   unconverted — the same pass-through stance the redirect step takes for its `predicate`.
 *
 * @example
 * ```ts
 * const runtime = new PipelineBuilder(transport)
 *   .append(authStep({
 *     credentials: {bearer: {provider: () => fetchToken({signal: AbortSignal.timeout(5_000)})}},
 *     tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
 *   }))
 *   .build();
 * ```
 *
 * @public
 */
export function authStep(settings: AuthStepSettings): StepDescriptor {
  // Built ONCE per installed step, not per request. The bearer cache is the one piece of shared
  // mutable state, and sharing it across calls is the point -- AUTH-34's single-flight coalescing only
  // works if concurrent calls meet at the same instance.
  const bearerCache = new BearerTokenCache();
  const availableSchemes = availableSchemesOf(settings.credentials);
  const composing = composingHandler(buildHandlers(settings.credentials));
  validateMarginMs('authStep bearerMarginMs', settings.bearerMarginMs);
  validateMarginMs(
    'BearerCredential marginMs',
    settings.credentials.bearer?.marginMs,
  );
  const bearerMarginMs = settings.bearerMarginMs ?? 30_000;
  const readNow = settings.clock?.now.bind(settings.clock) ?? Date.now;

  return {
    type: AUTH_STEP_TYPE,
    stage: 'AUTH',
    fn: async (seedRequest, ctx) => {
      const {fork, signal} = ctx;
      invariant(
        fork !== undefined,
        'authStep must occupy the AUTH pillar stage',
      );

      const {scheme} = resolveAuthRequirement(
        effectiveTiers(settings.tiers, ctx.options?.auth),
        availableSchemes,
      );
      // One clock read per hop, threaded into every expiry evaluation this hop performs, so the
      // preemptive stamp and a challenge-driven refresh cannot disagree about "now" mid-call.
      const nowMs = readNow();
      const stampContext: StampContext = {
        scheme,
        credentials: settings.credentials,
        bearerCache,
        marginMs: bearerMarginMs,
        nowMs,
        signal,
      };

      const {crossOrigin, outbound} = await planOutbound(
        seedRequest,
        stampContext,
      );

      const response = await fork()(outbound);
      const status = response.status.code;
      if (status !== 401 && status !== 407) return response;

      // AUTH-29, second half: the marker suppresses stamping for the WHOLE hop, not just the outbound
      // pass. Answering a challenge here would stamp exactly the credential `planOutbound` declined
      // to send -- onto the server-chosen foreign host, over a URL whose HTTPS guard was deliberately
      // skipped. The challenge is the caller's to handle, so the response is returned untouched and
      // unclosed.
      if (crossOrigin) return response;

      return handleChallenge({
        response,
        outbound,
        fork,
        settings,
        hookContext: {...stampContext, composing},
      });
    },
  };
}
