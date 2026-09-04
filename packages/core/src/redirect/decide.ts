// SPDX-License-Identifier: MIT
// packages/core/src/redirect/decide.ts
import type {Headers} from '../http/headers.js';
import type {Method} from '../http/method.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {isEligibleByCode, isRecognizedRedirect} from './codes.js';
import {
  clearCrossOriginMarker,
  isCrossOrigin,
  withCrossOriginMarker,
  type Origin,
} from './cross-origin.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';
import type {RedirectCondition, RedirectSettings} from './settings.js';

/**
 * Everything one hop's decision reads, bundled: `decide()` would otherwise take five positional
 * parameters against the codebase's `max-params: 3`.
 *
 * `seedOrigin` is the ORIGINAL request's origin and never advances with the chain (REDIR-8); `visited`
 * is the step's live cycle-detection set, seeded with the seed request's URI (REDIR-16).
 *
 * @internal
 */
export interface RedirectContext {
  readonly currentRequest: Request;
  readonly seedOrigin: Origin;
  readonly visited: ReadonlySet<string>;
  readonly redirectsFollowed: number;
}

/**
 * WHY a hop stopped, on a `'return-current'` decision.
 *
 * `REDIR-28` names four structured events, and two of them -- loop-detected and malformed-Location
 * -- are indistinguishable from ordinary termination once the decision is a bare `{kind}`. They were
 * blocked on this discriminant and are emitted by `redirectStep` as of 2026-09-02. The other three
 * reasons are carried for symmetry: a discriminant set on some paths and absent on others is a worse
 * shape than either extreme.
 *
 * @internal
 */
export type RedirectStopReason =
  /**
   * The status is not a redirect code this SDK follows. Covers a non-3xx status AND the three 3xx
   * codes REDIR-2 excludes by name (300/304/305), both of which take REDIR-21's fast path before
   * the eligibility gate is reached.
   */
  | 'not-a-redirect'
  /** A caller predicate said no, or the code/method pair is not eligible (REDIR-2, REDIR-20). */
  | 'not-eligible'
  /** Location was absent, empty, unparseable, or named an unsupported scheme (REDIR-18, REDIR-19). */
  | 'malformed-location'
  /** The target is already in the visited set (REDIR-16). */
  | 'loop-detected'
  /** Following would exceed `maxHops` (REDIR-17). */
  | 'hop-cap';

/**
 * One hop's outcome. `'return-current'` hands the live response back to the caller unclosed (REDIR-16,
 * REDIR-17, REDIR-18, REDIR-19, PIPE-40); `'fail'` is the caller's to close before rethrowing (REDIR-22b).
 *
 * @internal
 */
export type Decision =
  | {
      readonly kind: 'follow';
      readonly nextRequest: Request;
      readonly crossOrigin: boolean;
    }
  | {readonly kind: 'return-current'; readonly reason: RedirectStopReason}
  | {readonly kind: 'fail'; readonly error: Error};

// Frozen because each is SHARED: one instance per reason is handed to every caller taking that path,
// so an accidental write would corrupt every later decision in the process. `outcome.ts`'s
// `success`/`failure` build a fresh object per call and have no equivalent exposure.
const RETURN_CURRENT: Readonly<Record<RedirectStopReason, Decision>> =
  Object.freeze({
    'not-a-redirect': Object.freeze({
      kind: 'return-current',
      reason: 'not-a-redirect',
    }),
    'not-eligible': Object.freeze({
      kind: 'return-current',
      reason: 'not-eligible',
    }),
    'malformed-location': Object.freeze({
      kind: 'return-current',
      reason: 'malformed-location',
    }),
    'loop-detected': Object.freeze({
      kind: 'return-current',
      reason: 'loop-detected',
    }),
    'hop-cap': Object.freeze({kind: 'return-current', reason: 'hop-cap'}),
  });

/**
 * The only schemes this SDK will re-issue a request against. Anything else -- `javascript:`, `data:`,
 * `file:`, `mailto:` -- is REDIR-18's "unsupported scheme", returned unfollowed rather than dispatched.
 */
const FOLLOWABLE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * REDIR-14/REDIR-12/REDIR-13: resolves relative-or-absolute per RFC 3986 via WHATWG `URL`, drops
 * userinfo, and never re-encodes an already-percent-encoded path/query/fragment. Total -- REDIR-18 says
 * a malformed or unresolvable Location MUST NOT throw.
 *
 * Two things WHATWG `URL` does NOT do for us, both handled explicitly here:
 *
 * 1. **It almost never throws when a base is supplied.** `new URL(' not a url', 'https://example.com/a')`
 *    does not fail -- it resolves to `https://example.com/not%20a%20url`, because any string that is not
 *    a valid absolute URL is treated as a relative reference. So the `catch` below is a genuine but
 *    NARROW path (a malformed absolute form such as `http://[` still throws); it is not the general
 *    "garbage in the Location header" guard it might look like. Garbage that parses as a relative
 *    reference is followed, which is correct per RFC 3986 -- the server said so.
 * 2. **It happily parses schemes we must never dispatch against.** `new URL('javascript:alert(1)', base)`
 *    succeeds, and the scheme-downgrade guard would wave it through (the target is not `http:`). The
 *    {@link FOLLOWABLE_SCHEMES} check is what makes REDIR-18's unsupported-scheme clause true rather
 *    than aspirational.
 */
function resolveLocation(raw: string | undefined, base: URL): URL | null {
  if (raw === undefined || raw.trim() === '') return null; // REDIR-19: missing or empty.
  try {
    const resolved = new URL(raw, base);
    if (!FOLLOWABLE_SCHEMES.has(resolved.protocol.toLowerCase())) return null;
    // REDIR-12: assigning the empty string clears the component without touching path/query/fragment.
    resolved.username = '';
    resolved.password = '';
    return resolved;
  } catch {
    return null;
  }
}

/** REDIR-5: the 303 GET rebuild drops every `Content-*` request header, matched case-insensitively. */
function stripContentHeaders(headers: Headers): Headers {
  let builder = headers.newBuilder();
  for (const name of headers.names()) {
    if (name.toLowerCase().startsWith('content-'))
      builder = builder.set(name, null);
  }
  return builder.build();
}

/**
 * REDIR-7: `Authorization` is stripped on EVERY re-issue, same-origin and the 303 rebuild included.
 * REDIR-9/REDIR-10: `Cookie` and `Proxy-Authorization` are origin-scoped, so they survive a same-origin
 * hop and are stripped cross-origin. REDIR-11(a): the marker is cleared before it is conditionally set,
 * so a forged or stale inbound copy can never survive a hop that should not carry it.
 */
function nextHopHeaders(headers: Headers, crossOrigin: boolean): Headers {
  let builder = headers.newBuilder().set('Authorization', null);
  if (crossOrigin) {
    builder = builder.set('Cookie', null).set('Proxy-Authorization', null);
  }
  const cleared = clearCrossOriginMarker(builder.build());
  return crossOrigin ? withCrossOriginMarker(cleared) : cleared;
}

interface FollowPlan {
  readonly target: URL;
  readonly status: number;
  readonly crossOrigin: boolean;
}

/** REDIR-3/REDIR-4 preserve method and body; REDIR-5 forces GET and drops the body. */
function buildFollowRequest(current: Request, plan: FollowPlan): Request {
  const {target, status, crossOrigin} = plan;
  const is303 = status === 303;
  const method: Method = is303 ? 'GET' : current.method;
  let headers = nextHopHeaders(current.headers, crossOrigin);
  if (is303) headers = stripContentHeaders(headers);
  const builder = current
    .newBuilder()
    .url(target)
    .method(method)
    .headers(headers);
  return is303 ? builder.body(undefined).build() : builder.build();
}

/**
 * The per-hop redirect decision. Pure -- no I/O, no clock, no header-mutation side effects beyond the
 * `nextRequest` value it returns -- mirroring 5a's split of `classify.ts`/`backoff.ts` away from the
 * imperative loop.
 *
 * Step order:
 *
 * 1. **Fast path** (REDIR-1/REDIR-21): a status outside the recognized set short-circuits BEFORE
 *    allocating a condition snapshot and never consults a configured predicate.
 * 2. **Snapshot and the follow/no-follow call** (REDIR-20/REDIR-21): any recognized 3xx allocates the
 *    snapshot and is offered to a configured predicate, EVEN with no usable Location. A configured
 *    predicate's boolean return IS the decision, replacing `isEligibleByCode`.
 * 3. **Location resolution** (REDIR-12/13/14/18/19), including the followable-scheme gate.
 * 4. **Loop detection** (REDIR-16).
 * 5. **Hop cap** (REDIR-17) -- the one gate `maxHops: 0` always fails, which is what "disables redirect
 *    following entirely" reduces to; no separate branch.
 * 6. **Scheme-downgrade guard** (REDIR-15), keyed to the CURRENT hop's scheme, not the seed's. This is a
 *    deliberately different reference point from step 8's seed-relative cross-origin check: downgrade
 *    catches a single transition wherever it happens, while cross-origin must stay anchored to the
 *    origin the credential was attached at, for the whole chain.
 * 7. **Body-replayability gate** (REDIR-6); 303 is exempt because it drops the body.
 * 8. **Cross-origin determination** (REDIR-8) and header construction for the next hop.
 *
 * **Scope of the predicate override.** REDIR-20's "MUST fully override the built-in decision" is read
 * here as scoped to the code/method eligibility question only -- not as license to bypass steps 4-7's
 * wire-safety invariants, which the same spec document states as unconditional MUSTs elsewhere. A
 * caller predicate opting to follow a 307 with a non-replayable body still cannot make that body
 * re-sendable. If this reading is wrong the fix is narrow and mechanical: gate step 3 onward behind the
 * predicate's answer. Recorded in the design doc's Deviation Ledger.
 *
 * @param response - the hop's response.
 * @param context - the current request, the seed origin, the live visited set, and the hop count.
 * @param settings - the validated redirect policy.
 * @returns whether to follow, return the current response, or fail.
 *
 * @internal
 */
export function decide(
  response: Response,
  context: RedirectContext,
  settings: RedirectSettings,
): Decision {
  if (!isRecognizedRedirect(response.status.code)) {
    return RETURN_CURRENT['not-a-redirect'];
  }

  const {currentRequest, seedOrigin, visited, redirectsFollowed} = context;
  // REDIR-20: the snapshot is defensively COPIED, not merely typed `ReadonlySet`. `visited` is the
  // step's LIVE cycle-detection set, and the type annotation is erased at runtime -- a predicate that
  // casts it away could otherwise pre-seed or clear loop detection for the rest of the call. The spec's
  // wording is about the object, not the type.
  const condition: RedirectCondition = {
    response,
    redirectsFollowed,
    visited: new Set(visited),
  };
  const eligible =
    settings.predicate === undefined
      ? isEligibleByCode(response.status.code, currentRequest.method, settings)
      : settings.predicate(condition);
  if (!eligible) return RETURN_CURRENT['not-eligible'];

  // `Request.url` hands back a FRESH `URL` on every access (HTTP-5) -- read it once.
  const currentUrl = currentRequest.url;
  const target = resolveLocation(
    response.headers.get(settings.locationHeader),
    currentUrl,
  );
  if (target === null) return RETURN_CURRENT['malformed-location'];
  if (visited.has(target.href)) return RETURN_CURRENT['loop-detected'];
  if (redirectsFollowed + 1 > settings.maxHops) {
    return RETURN_CURRENT['hop-cap'];
  }

  if (
    currentUrl.protocol.toLowerCase() === 'https:' &&
    target.protocol.toLowerCase() === 'http:' &&
    !settings.allowSchemeDowngrade
  ) {
    return {
      kind: 'fail',
      error: new SchemeDowngradeError(currentUrl.href, target.href),
    };
  }

  const status = response.status.code;
  const body = currentRequest.body;
  if (status !== 303 && body !== undefined && !body.replayable) {
    return {kind: 'fail', error: new NonReplayableBodyError(target.href)};
  }

  const crossOrigin = isCrossOrigin(seedOrigin, target);
  return {
    kind: 'follow',
    nextRequest: buildFollowRequest(currentRequest, {
      target,
      status,
      crossOrigin,
    }),
    crossOrigin,
  };
}
