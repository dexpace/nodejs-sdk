# Phase 5c — Resilience — Auth — Design

**Status:** Draft, autonomous brainstorm — awaiting user review (see "How this doc was produced" below).

**Purpose:** Implement the authentication layer — the scheme-agnostic descriptor/resolver model, the credential
types, the RFC 7235 challenge parser, the Basic/Digest/static-key stamping handlers, and the single AUTH pillar
step that ties them together — satisfying `docs/product-spec/11-authentication.md` (`AUTH-1`–`AUTH-38`). This is
the third and final sub-phase of the roadmap's Phase 5 split: 5a (retry, done), 5b (redirect — see [Phase 5b
design](./2026-07-26-phase5b-redirect-design.md)), 5c (this document, auth). 5c also closes items the roadmap's
Deferred Items Log parked here: `PIPE-35`'s `seedFrom`, `AUTH-29`/marker-consumption (5b produced the marker and
left consumption to 5c), the standard-resilience preset (`PIPE-24`/`PIPE-39`), and public-barrel promotion of the
pillar-step authoring surface.

**Governing documents:** `docs/product-spec/11-authentication.md` (normative, cited by ID throughout),
`docs/product-spec/10-redirect-handling.md` (`REDIR-7`–`REDIR-11`, `REDIR-24` — the cross-origin marker contract
5c consumes) plus **the [Phase 5b design](./2026-07-26-phase5b-redirect-design.md) itself**, which is the actual
source of truth for that marker's concrete shape (see "Alignment with 5b's shipped design" below — an earlier
draft of this section guessed a different, incompatible shape before 5b's doc was found on disk),
`docs/product-spec/08-execution-pipelines.md` §8.1 (`PIPE-2`, `PIPE-24`, `PIPE-35`, `PIPE-39`, `PIPE-40`),
`docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md` (Web Crypto vs `node:crypto`, the self-implemented
MD5 module), the Phase 4c (`Stage`/`StepDescriptor`/`Cursor`/`PipelineBuilder`/`Runtime`) and Phase 5a
(`FakeTransport`, module-layout precedent, `RECOV`/`RETRY` collapse precedent) design docs, both consumed
unchanged. Styleguide: `styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## How this doc was produced

Produced solo, without the usual interactive brainstorming back-and-forth (user was away from keyboard and asked
for a self-directed pass). Where the normal process would have asked a clarifying question or presented approaches
for a choice, this doc instead states the decision inline with its reasoning, so it can be reviewed after the
fact exactly like an interactive brainstorm's output would be. Per instruction, wherever a decision point came up,
the knowledge-base notes (`docs/knowledge/*`, which mirror the product-spec/sdk-design verbatim) were treated as
the tie-breaker. **Not committed** — left as an untracked file pending your review, per your standing preference
against auto-committing specs.

**Mid-draft correction.** 5b had no design doc when this brainstorm started — only 5a existed — so the first draft
of this section designed a placeholder cross-origin-marker primitive (a `WeakSet<Request>`) against `REDIR-11`'s
prose directly, flagging it as a prerequisite for whoever drafted 5b later. Before finishing, a
`2026-07-26-phase5b-redirect-design.md` appeared in the working tree — apparently authored in parallel, elsewhere,
while this doc was in progress. Reading it surfaced a real bug in the placeholder: 5b's author correctly worked out
that a `WeakSet` keyed by request-object identity breaks the moment retry's stage sits between redirect and auth
and its (optional) attempt-stamping builds a fresh per-attempt `Request` copy — the auth step would then be
checking a different object than the one redirect marked. 5b instead ships the marker as a real header, which
survives that copy because attempt-stamping explicitly preserves headers. This doc's cross-origin-marker section
below was rewritten to consume 5b's actual shape rather than the withdrawn placeholder; the withdrawal itself is kept in
the Deviation Ledger so the reasoning trail isn't lost. This is exactly the kind of gap the "no interactive
back-and-forth" tradeoff makes possible, and exactly why the doc says so plainly rather than silently patching over
it.

## Scope

5c ships the auth engine and nothing else beyond the four deferred items named above. No new redirect logic (5b's
job), no `Logger`/`LogEvent` instrumentation (Phase 7), no `CFG-*` configuration surface beyond what auth's own
settings need locally.

`RECOV-33` (client-identity header step) does **not** ship here, despite living beside auth conceptually — 5a
already retargeted it to Phase 7 with `CFG-*`; not re-litigated.

## Alignment with 5b's shipped design: the cross-origin marker

5b's design (`packages/core/src/redirect/cross-origin.ts`) ships the `REDIR-11`/`AUTH-29` signal as a real header,
not an in-process marker, and gives the reason: `Request` is immutable and a redirect re-issue always builds a
**fresh** instance, but so does 5a's (optional) attempt-stamping when it sits between redirect and auth in the
pillar chain — an identity-keyed signal (a `WeakSet<Request>`, this doc's own withdrawn first draft) would silently
stop matching the moment stamping is on, because the auth step then observes a *different* object than the one
redirect marked. A header survives that intermediate copy because stamping explicitly preserves headers. 5c takes
this as fixed and consumes it as-is:

```typescript
// packages/core/src/redirect/cross-origin.ts — @internal, owned and exported by 5b, imported unchanged here
const CROSS_ORIGIN_MARKER_HEADER = 'x-dexpace-internal-redirect-cross-origin';
function hasCrossOriginMarker(headers: Headers): boolean;
function clearCrossOriginMarker(headers: Headers): Headers;   // idempotent if already absent
```

5b already defends `REDIR-11`'s own porter caveat independently of whether an auth step exists — it bundles a
second, non-pillar `stripCrossOriginMarkerStep()` at `POST_AUTH` (via `withRedirect()`) that unconditionally clears
the header, so a redirect-only pipeline with no auth step never forwards the marker to the wire. **5c's auth step
is the marker's *intended* consumer** — the `POST_AUTH` guard is 5b's redundant safety net; the auth step below is
where the marker actually does its job (suppress stamping) and, per 5b's own framing, becomes "the marker's real
consumer... and first stripper" once installed. The auth step must therefore both *read* the header (to decide
whether to suppress) and *clear* it via `clearCrossOriginMarker()` before building whatever request it hands
downstream — leaving it in place would mean two strippers racing to be first for no benefit, and the header must
never reach the wire regardless of which one gets there.

## Module Layout

All in `@dexpace/core`, mirroring 5a's kebab-case, no-internal-barrel convention.

```
packages/core/src/auth/
  scheme.ts                # AUTH-1              AuthScheme union
  requirement.ts           # AUTH-2               AuthRequirement factory + equality
  descriptor.ts            # AUTH-3               AuthDescriptor factory
  resolve.ts               # AUTH-4..7            resolveAuthRequirement()
  credential.ts            # AUTH-8..10            BearerToken, ApiKeyCredential, NameKeyCredential
  token-provider.ts        # AUTH-11               TokenProvider type
  challenge.ts             # AUTH-12..13           parseChallenges()
  md5.ts                   # AUTH-15..17           self-contained MD5 (no npm dependency)
  digest.ts                # AUTH-15..22           Digest handler + bounded nonce-count store
  basic.ts                 # AUTH-14               Basic handler
  static-key.ts            # AUTH-26               API-key / name-key stamping
  composing-handler.ts     # AUTH-23..25           ordered delegation over Basic/Digest
  bearer-cache.ts          # AUTH-34..37           single-flight, three-zone token cache
  auth-step.ts             # AUTH-27..33           pillar adapter, one per-scheme dispatch table
  preset.ts                # PIPE-24/39            standard-resilience preset
packages/core/src/pipeline/
  builder.ts               # amended: PipelineBuilder.seedFrom()  (PIPE-35)
```

Reused unchanged from earlier phases: `Body.replayable` (3b), `HttpStatusError`/`toHttpError()` (3b),
`Headers` case-insensitive lookup (1), `PipelineBuilder`/`Runtime`/`StepDescriptor`/`Stage`/`PILLAR_STAGES`/`Cursor`
(4c), `FakeTransport` (5a), `retryStep()` (5a — the preset installs it unmodified), `redirectStep()` +
`hasCrossOriginMarker()`/`clearCrossOriginMarker()` (5b — the preset installs `redirectStep()` unmodified; the auth
step below imports the marker functions unmodified).

## The descriptor/resolver model (`scheme.ts`, `requirement.ts`, `descriptor.ts`, `resolve.ts`)

`AUTH-1`'s scheme set has no behavior beyond identity and ordering — same shape call 4c made for `Stage`: a plain
string-literal union, not a class, not a `TypeScript enum` (barred by the roadmap's dual-JS/TS + `erasableSyntaxOnly`
constraint, restated from 5a/4c and not re-litigated here).

```typescript
export type AuthScheme = 'OAUTH2' | 'API_KEY' | 'BASIC' | 'DIGEST' | 'NO_AUTH';
```

`AUTH-2`'s requirement is a frozen data shape plus a pure equality function — the same "data and functions, not
objects" call 4a made for context types and 4c made for `Stage`, rather than a class with an `equals()` method:

```typescript
export interface AuthRequirement {
  readonly scheme: AuthScheme;
  readonly scopes: readonly string[];   // meaningful only for OAUTH2; preserved, never inspected by resolution
  readonly params: ReadonlyMap<string, string>;
}

export function createAuthRequirement(
  scheme: AuthScheme,
  scopes: readonly string[] = [],
  params: ReadonlyMap<string, string> = new Map(),
): AuthRequirement;   // defensive-copies scopes (spread) and params (new Map), freezes

export function authRequirementsEqual(a: AuthRequirement, b: AuthRequirement): boolean;
```

`AUTH-3`'s descriptor is the same shape — non-empty, immutable, ordered:

```typescript
export interface AuthDescriptor {
  readonly requirements: readonly AuthRequirement[];   // preference order
  readonly allowsAnonymous: boolean;                    // true iff any requirement's scheme is NO_AUTH
}

export function createAuthDescriptor(requirements: readonly AuthRequirement[]): AuthDescriptor;
// throws ArgumentError on an empty list (AUTH-3)
```

`AUTH-4`/`AUTH-5` resolution is a pure function over three optional tiers, no class, no hidden state (`AUTH-7`):

```typescript
export interface AuthTiers {
  readonly perCall?: AuthDescriptor | undefined;
  readonly operation?: AuthDescriptor | undefined;
  readonly client?: AuthDescriptor | undefined;
}

export function resolveAuthRequirement(
  tiers: AuthTiers,
  availableSchemes: ReadonlySet<AuthScheme>,
): AuthRequirement;
```

Tier selection is `perCall ?? operation ?? client`, the first present — **not** a fallthrough on failure: if the
selected tier's requirements are all unsatisfiable, `AuthResolutionError` is thrown naming that tier's required
schemes (in preference order) and `availableSchemes`; a lower tier is never consulted once a higher one is present
(`AUTH-4`). All tiers absent throws `ArgumentError` (`AUTH-6`). Within the selected descriptor, the first
requirement whose scheme is `NO_AUTH` or present in `availableSchemes` wins, without inspecting any concrete
credential value (`AUTH-5`) — `availableSchemes` is derived by the caller from which credential types it has
actually configured, not passed a credential object.

## Credentials (`credential.ts`, `token-provider.ts`)

Two different shapes for two different equality requirements (`AUTH-8`), same "pick the representation the
requirement calls for" reasoning as the requirement/descriptor split above:

- **`BearerToken`** needs *value* equality over token+expiry (redaction must not affect it) → a frozen data object
  plus a pure equality function, exactly like `AuthRequirement`:

  ```typescript
  export interface BearerToken {
    readonly token: string;
    readonly expiresAt: number | undefined;   // epoch ms; undefined = never locally expires (AUTH-10)
  }
  export function createBearerToken(token: string, expiresAt?: number): BearerToken;  // AUTH-9: rejects blank token
  export function bearerTokensEqual(a: BearerToken, b: BearerToken): boolean;
  export function isBearerTokenExpired(t: BearerToken, nowMs: number, marginMs: number): boolean;
  // AUTH-10: expired iff t.expiresAt !== undefined && nowMs + marginMs > t.expiresAt
  ```

  Redaction (`AUTH-8`) is a formatting concern, not an equality concern, so `BearerToken`'s own `toString`/inspect
  is irrelevant to `bearerTokensEqual` — the plain object is never logged directly; only the `redactedBearer()`
  helper below is.

- **`ApiKeyCredential`**/**`NameKeyCredential`** need *reference* identity (`AUTH-8`'s "two instances with
  identical fields are NOT equal") — a small class with a private field and an overridden `toString`/inspect,
  deliberately **without** an `equals` override, so `===` (the language default) already gives the required
  semantics for free:

  ```typescript
  export class ApiKeyCredential {
    readonly #key: string;
    constructor(key: string) { /* AUTH-9: rejects blank */ this.#key = key; }
    toString(): string { return 'ApiKeyCredential{key=***}'; }              // AUTH-8 redaction
    [Symbol.for('nodejs.util.inspect.custom')](): string { return this.toString(); }
  }

  export class NameKeyCredential {
    readonly name: string;      // AUTH-9: rejects blank
    readonly #key: string;      // AUTH-9: rejects blank
    constructor(name: string, key: string) { this.name = name; this.#key = key; }
    toString(): string { return `NameKeyCredential{name=${this.name}, key=***}`; }
    [Symbol.for('nodejs.util.inspect.custom')](): string { return this.toString(); }
  }
  ```

  `Symbol.for('nodejs.util.inspect.custom')` is included alongside `toString` because `console.log`/`util.inspect`
  do not always route through `toString` for object arguments — leaving it out would satisfy `AUTH-8`'s literal
  "string representation" while still leaking the secret through the far more common accidental-`console.log`
  path. Node-specific but harmless on other runtimes (an unrecognized well-known symbol is simply not read).

- **`TokenProvider`** (`AUTH-11`) is a plain async function type, no class:

  ```typescript
  export type TokenProvider = () => Promise<BearerToken>;
  ```

  A throwing/rejecting provider propagates and is never cached — this falls out of not catching around the call
  in `bearer-cache.ts` below, rather than needing an explicit "don't cache errors" branch.

## Challenge parsing (`challenge.ts`)

```typescript
export interface Challenge {
  readonly scheme: string;                      // lower-cased (AUTH-12)
  readonly params: ReadonlyMap<string, string>;  // lower-cased keys, verbatim unquoted values
}
export function parseChallenges(headerValue: string): readonly Challenge[];
```

Hand-written, same "don't trust a permissive built-in for a totality-critical parse" reasoning `sdk-design/06`
already applied to the RFC 1123 `Retry-After` date parser in 5a — there is no built-in RFC 7235 parser to lean on
in the first place, so this is written carefully rather than assembled from a general-purpose header-splitting
utility that might not honor quoted-string commas. **Total by construction** (`AUTH-13`): blank input → `[]`; a
malformed challenge recovers at the next top-level comma (tracked by a quote-depth counter, not a naive `.split
(',')`, which would break on a quoted value containing a comma); an unterminated quoted string terminates at
end-of-input; parameters parsed before a malformed tail are kept. A bare scheme (token68 or no `=`) is emitted with
an empty parameter map; a token68 value is recorded under a synthetic key (`'__token68__'`) so callers can
distinguish "scheme with no params" from "scheme with an opaque token" without a third variant shape.

## Stamping handlers (`basic.ts`, `digest.ts`, `md5.ts`, `static-key.ts`, `composing-handler.ts`)

**Basic** (`AUTH-14`): `Basic ` + base64(UTF-8(`username:password`)), computed once at construction (cached on the
handler instance, not recomputed per call — "computed once" is the point of caching it rather than a performance
nicety). Accepts a `basic` challenge case-insensitively; emits `Authorization` or `Proxy-Authorization` selected by
an explicit `isProxy` flag threaded down from which header carried the challenge (`AUTH-25`). Validates
non-blank-but-whitespace-permitted credentials per RFC 7617's laxer rule (`AUTH-14`), deliberately not reusing the
non-blank helper the credential types above use.

**Digest** (`AUTH-15`–`AUTH-22`): supports exactly `{MD5, MD5-sess, SHA-256, SHA-256-sess}`, `qop=auth` or absent,
declining `auth-int`-only and unsupported algorithms. Cryptographic primitives split across two sources for
portability, per `sdk-design/06`:

- **MD5/MD5-sess** — `md5.ts`, a small self-contained, dependency-free implementation, because Web Crypto's
  `subtle.digest()` deliberately excludes MD5 and RFC 7616 Digest still requires it for interop with servers that
  have not adopted SHA-256.
- **SHA-256/SHA-256-sess** — `crypto.subtle.digest('SHA-256', ...)` (Web Crypto), preferred over `node:crypto` to
  keep `@dexpace/core` portable to browsers/Deno/Cloudflare Workers (§3.1's whole premise, restated from
  `sdk-design/06`).
- **Client nonce** (`AUTH-20`, ≥128 bits) — `crypto.getRandomValues()` (Web Crypto, universal), never
  `Math.random()`.

Nonce-count store (`AUTH-18`/`AUTH-19`): `Map<string /* server nonce */, number /* nc */>`, starting at `1`
(rendered as `00000001`) and incrementing only on reuse of the same nonce, low-32-bits-on-overflow. Bounded at
1024 entries (`AUTH-19`, SHOULD), drained under the cap with a simple insertion-order eviction (`Map` iteration
order is insertion order, so the oldest entry is `store.keys().next().value` — no separate LRU structure needed).
**Concurrency** (`AUTH-24`): Node has no preemptive thread interleaving mid-statement, so "thread-safe primitives"
collapses to "increment the counter synchronously, with no `await` between the read and the write" — the same
collapse 5a documented for `BODY-3`'s materialize-once guard. The read-increment-write in
`nextNonceCount(nonce)` is one synchronous expression; nothing awaits inside it.

Digest satisfiability (`AUTH-16`): scheme is `digest` case-insensitive, `realm`+`nonce` present, `qop` absent or
containing `auth`, algorithm absent (defaults `MD5`) or one of the four supported — preferring the earliest match
in a **configured preference list**, not wire order, so a caller can force SHA-256 first against a server offering
both. HA1/HA2/response computed per RFC 7616/2069 (`AUTH-17`), UTF-8 hashing when the challenge advertises
`charset=UTF-8`, ISO-8859-1 otherwise (`AUTH-21`), request-target as the digest-uri, cnonce/nc/qop emitted only
when qop was negotiated (`AUTH-22`).

**Static key stamping** (`AUTH-26`): applies to both `ApiKeyCredential` and `NameKeyCredential` uniformly — write
the secret into a configured header (default `Authorization`), prefixed by a configured prefix + one space when
set. Stateless after construction; no challenge involved (see "The AUTH pillar step" below for why this path never
consults a `WWW-Authenticate` value).

**Composing handler** (`AUTH-23`–`AUTH-25`): an ordered list of `{canHandle(challenge): boolean; stamp(challenge,
isProxy): string /* header value */}` handlers (Basic, Digest — callers order stronger schemes first), defensively
copied at construction. Delegates to the first handler whose `canHandle` passes; returns no header (meaning: no
replacement request) when none can satisfy any offered challenge. Handlers are stateless except Digest's
per-nonce counter, already covered above.

## The AUTH pillar step (`auth-step.ts`)

**A reading this doc had to settle, stated explicitly rather than glossed over.** `AUTH-27` mandates *exactly one*
auth step at the AUTH pillar stage, yet `AUTH-34`–`AUTH-37` separately name "the bearer auth step" and `AUTH-30`
separately names "the challenge hook," as if three different things. Reconciled as: **one step, one pluggable
401-reaction extension point (`challengeHook`), with a scheme-dependent default body** — not three competing
mechanisms. `AUTH-30`'s generic contract (consult hook → on non-null replacement, close original, re-drive once
via `fork()`, no nested re-challenge) governs every scheme uniformly; `AUTH-23`–`AUTH-26`/`AUTH-34`–`AUTH-37`
describe what the *default* hook body does for each resolved scheme. A caller MAY override `challengeHook`
entirely (e.g., for a custom OAuth2 refresh-token grant), taking precedence over the scheme default. This is the
only reading that satisfies `AUTH-27`'s "exactly one auth step" while giving "the bearer auth step" and "the
challenge hook" both a coherent home in it.

A second reading decision, same "no unnecessary preemptive stamping" principle: **Basic and Digest never stamp
preemptively.** Both `AUTH-14` and `AUTH-15`–`AUTH-22` are phrased entirely in terms of *responding to* a parsed
challenge (Digest structurally cannot stamp before seeing a challenge — it needs the server's `realm`/`nonce` —
and this spec never separately describes a preemptive-Basic path the way it separately describes Bearer's
preemptive cached-token stamp). So for a request resolved to `BASIC`/`DIGEST`, the step's outbound pass sends the
request unstamped; the composing handler only engages on the resulting 401. `OAUTH2`/`API_KEY` stamp preemptively
(no server round-trip needed to know what to send); `NO_AUTH` never stamps.

```typescript
export interface AuthStepSettings {
  readonly credentials: AuthCredentialSet;         // which schemes are actually available, feeds resolveAuthRequirement
  readonly tiers: AuthTiers;                        // operation/client tiers, fixed at construction; perCall may be overridden per call (below)
  readonly handlers?: readonly ChallengeHandler[];  // Basic/Digest handlers, default = [digestHandler(), basicHandler()]
  readonly challengeHook?: ChallengeHook | undefined;  // caller override; default = per-scheme dispatch below
}

type ChallengeHook = (response: Response, request: Request) => Promise<Request | undefined>;

const AUTH_STEP_TYPE = Symbol('dexpace.auth');
export function authStep(settings: AuthStepSettings): StepDescriptor;   // stage: 'AUTH'
```

**Per-call tier override (`AUTH-4`'s `perCall` tier, closing part of the roadmap's "true per-call `AuthTiers`"
deferral).** `RequestOptions` (Phase 1) gains one optional field, `auth?: AuthDescriptor`, amended in this phase
the same way this phase already amends `pipeline/builder.ts` — `http/request-options.ts` takes a *type-only*
import of `AuthDescriptor`, whose module chain (`descriptor.ts` → `requirement.ts` → `scheme.ts`) imports nothing
from `http/`, so no cycle. The auth step reads it through `ctx.options` (exposed on `StepContext` by 5a's
Task 1 amendment, per `PIPE-17`'s "readable by any step") and resolves against effective tiers:

```typescript
const effectiveTiers = ctx.options?.auth === undefined
  ? settings.tiers
  : {...settings.tiers, perCall: ctx.options.auth};
```

`resolveAuthRequirement`'s `perCall ?? operation ?? client` logic (`AUTH-4`–`AUTH-7`) is unchanged — this only
gives the `perCall` slot a genuinely per-call source instead of the construction-time constant it was at plan
time. The `operation` tier still has no distinct source (nothing in this roadmap ships a per-operation layer);
that residue stays in the Deferred Items Log. `AuthDescriptor` was already public surface (transitively, via
`authStep`'s settings), so the field widens `core.api.md` by exactly the one `RequestOptions` member.

Per-call sequence, nested inside both redirect (5b) and retry (5a) per `AUTH-27`'s "redirect wraps retry wraps
auth":

1. Resolve the requirement (`resolveAuthRequirement`) from the call's effective tiers (per-call override above) +
   configured `credentials`.
2. **Cross-origin check first** (`AUTH-29`): `hasCrossOriginMarker(request.headers)`. Either way, immediately build
   the outbound request with `clearCrossOriginMarker()` applied via `request.newBuilder()` — the header must never
   reach the wire regardless of which branch runs, and clearing before either branch means the marker can't
   accidentally survive into a substituted request built by the stamping/no-op logic below. If the marker was
   present: skip the HTTPS guard, skip stamping entirely (forward the cleared request credential-free), call
   `ctx.next()`. This branch never runs step 3.
3. Otherwise, HTTPS guard (`AUTH-28`): reject a non-HTTPS URL (case-insensitive scheme check) with an error naming
   the step and the resolved scheme, evaluated **only** on a path where a credential will actually be attached —
   `NO_AUTH` never triggers the guard, matching `AUTH-28`'s own qualifier.
4. Preemptive stamp per resolved scheme (`OAUTH2` → `bearer-cache.ts`; `API_KEY` → `static-key.ts`; `BASIC`/
   `DIGEST`/`NO_AUTH` → no header this pass) and call `ctx.next()`.
5. On the response: **if the cross-origin marker was present, return the response untouched and stop here** —
   the suppression in step 2 covers the whole hop, not just the outbound pass. Answering a challenge on a
   marked hop would stamp exactly the credential step 2 declined to send, onto the server-chosen foreign host,
   over a URL whose HTTPS guard was deliberately skipped; the challenge is the caller's to handle. Otherwise:
   if status is `401` and carries `WWW-Authenticate`, or `407` and carries `Proxy-Authenticate` (`AUTH-30`,
   with `AUTH-25` deciding which of `Authorization`/`Proxy-Authorization` the answer lands in — reading only
   the header matching the status keeps that pairing honest), invoke the effective
   `challengeHook` (caller override, else the scheme-dependent default). If it throws or its promise rejects,
   close the 401's body before propagating (`AUTH-32`). If it yields a replacement request, gate on
   replayability (`AUTH-31` — applied uniformly, see deviation note below): non-replayable body → close nothing,
   surface the original 401 unchanged (caller owns it); replayable → close the original 401, `ctx.fork()` once,
   drive the replacement, no further challenge handling on that drive (`AUTH-30`'s "exactly once"). If the hook
   yields nothing, or the response has no `WWW-Authenticate`, return the 401 unchanged without invoking anything
   further (`AUTH-33`).

**Default hook bodies:**

- `OAUTH2`: `AUTH-36`'s evict-and-retry — extract the `Authorization` header the *rejected* request carried; if
  absent, or the challenge's scheme is not `bearer` (case-insensitive), return `undefined` (401 surfaces
  unchanged). Otherwise evict from `bearer-cache.ts` only if its currently-cached token's derived header value
  still equals the rejected one (so a token another in-flight request already refreshed survives), fetch fresh,
  build the replacement request with the new `Authorization` value. Fires regardless of HTTP method (`AUTH-36`'s
  explicit "regardless of HTTP method" — the replayability gate in step 5 above is what actually protects a
  non-replayable body, not a method check here).
- `BASIC`/`DIGEST`: the composing handler — `parseChallenges(wwwAuthenticateValue)`, delegate to the first
  satisfiable configured handler, build the replacement request with the produced header value. The auth step
  itself (not the handler) picks `Authorization` vs `Proxy-Authorization` from which of the two challenge headers
  was actually present (`AUTH-25`) — the handler only ever returns the value half of the pair. No replacement if
  none satisfy.
- `API_KEY`/`NO_AUTH`: `undefined`, always — static credentials have no reactive behavior; `AUTH-30`'s literal
  "the default hook yields no replacement" describes exactly this pair.

**Bearer cache** (`bearer-cache.ts`, `AUTH-34`/`AUTH-35`/`AUTH-37`): one instance per configured `TokenProvider`,
implementing the async three-zone policy as the *only* policy this port ships (see deviation note below) —

```typescript
class BearerTokenCache {
  #cached: BearerToken | undefined;
  #inFlight: Promise<BearerToken> | undefined;

  async stamp(provider: TokenProvider, marginMs: number, nowMs: number): Promise<BearerToken> {
    if (this.#cached !== undefined) {
      const expiring = isBearerTokenExpired(this.#cached, nowMs, marginMs);
      const expired = isBearerTokenExpired(this.#cached, nowMs, 0);           // AUTH-35: no margin at fetch time
      if (!expiring) return this.#cached;                                     // fresh: stamp, no refresh
      if (!expired) {                                                          // expiring-but-valid
        const stillValid = this.#cached;
        // Fire-and-forget, and the rejection is SWALLOWED explicitly: AUTH-37 calls a failed background
        // refresh non-fatal because a valid token was already stamped, and a bare `void` would leave an
        // unhandled rejection that terminates the process under Node's default policy.
        void this.#refresh(provider, nowMs).catch(() => undefined);
        return stillValid;
      }
    }
    return this.#refresh(provider, nowMs);      // expired/missing: await a fresh single-flight fetch
  }

  // `nowMs` is threaded in rather than read from `Date.now()`: `stamp()` already takes an injected clock, and
  // a refresh validating against the ambient wall clock while its caller reasons about an injected one is a
  // second, invisible clock -- it would reject every token under synthetic time and be uncontrollable in
  // production.
  #refresh(provider: TokenProvider, nowMs: number): Promise<BearerToken> {
    if (this.#inFlight !== undefined) return this.#inFlight;   // coalesce concurrent expiring/missing callers
    const fetch = provider()
      .then((token) => {
        if (token === null || isBearerTokenExpired(token, nowMs, 0)) {
          throw new AuthResolutionError(/* AUTH-35: reject null/already-expired */);
        }
        this.#cached = token;
        return token;
      })
      .finally(() => { this.#inFlight = undefined; });          // never cache a rejection (AUTH-11/35); a
                                                                  // rejection already propagates through
                                                                  // finally() untouched, so no catch() is added
    this.#inFlight = fetch;
    return fetch;
  }

  evict(rejectedHeaderValue: string): void {
    if (this.#cached !== undefined && `Bearer ${this.#cached.token}` === rejectedHeaderValue) {
      this.#cached = undefined;
    }
  }
}
```

Single-flight is a plain module-scoped `Promise` field, not a lock — Node's single-threaded event loop means the
only hazard is two logical calls both observing "no in-flight fetch" before either sets `#inFlight`, and that
cannot happen because nothing awaits between the check and the assignment (same synchronous-guard collapse
pattern as the Digest nonce counter and 5a's `BODY-3` note).

**Deviation, flagged for the ledger:** the reference ships two bearer strategies — a simpler synchronous
single-flight-only policy (`AUTH-34`) and a separate async three-zone policy (`AUTH-37`) — because it has two
pipeline execution stories to serve. This port has one (4c's `Promise`-only model), so it ships the three-zone
policy unconditionally; `AUTH-34`'s "non-blocking hot-path read of a valid cached token" is the fresh-zone branch
of the same state machine, not a separate code path. Directly parallel to 5a's "one retry engine, not two stacks"
disposition of `RETRY-28` — same reasoning, same shape of collapse.

**`AUTH-31`'s replayability gate, applied to both because there is only one path.** The product spec notes the
reference enforces this gate on its synchronous auth step only, and recommends (SHOULD) a port apply it uniformly.
With one unified step there is exactly one place to apply it, so it applies to every `challengeHook` replacement —
`OAUTH2`'s evict-retry included — closing that SHOULD rather than leaving it open.

## `PipelineBuilder.seedFrom()` (`PIPE-35`)

Deferred from 4c, retargeted here because it needs a caller-observable use case (deriving the standard-resilience
preset's builder from an existing one) that first exists once a preset does:

```typescript
class PipelineBuilder {
  // ...4c's existing members, unchanged...
  static seedFrom(runtime: Runtime, mode: 'flatten' | 'nest'): PipelineBuilder;
}
```

- **`flatten`**: copy `runtime.steps` into a fresh builder's stage buckets (re-bucketing each `StepDescriptor` by
  its own `stage`) and reuse `runtime`'s transport as the new builder's transport — the seeded steps run in the
  *same* loops as whatever is appended next. Pillar-collision rules (`PIPE-5`/`PIPE-6`) apply exactly as they would
  to any other `append` sequence, since flatten is defined as "as if each seeded descriptor were appended in
  order."
- **`nest`**: construct a fresh builder whose transport *is* `runtime` itself (treated as an opaque `Transport`,
  which `Runtime implements Transport` already makes possible with zero adapter code) — the new builder's own
  pillar steps run once, outside `runtime`'s already-flattened loops.

Explicit, non-defaulted `mode` argument, per `PIPE-35`'s MUST clause ("make the choice explicit, never
accidental") — no default value, so a caller cannot seed by accident without naming which semantics they want.

## The standard-resilience preset (`preset.ts`, `PIPE-24`/`PIPE-39`)

```typescript
export interface StandardResilienceOptions {
  readonly retry?: RetrySettings;          // 5a defaults if omitted
  readonly redirect?: RedirectSettings;     // 5b defaults if omitted
  readonly auth?: AuthStepSettings;         // required if any credential tier is configured; NO_AUTH-only otherwise
}

export function standardResilience(
  transport: Transport,
  options: StandardResilienceOptions = {},
): Runtime;
```

Installs exactly the three pillars that exist by the end of 5c — via 5b's `withRedirect(builder, options.redirect)`
(which seats both `redirectStep()` and its `stripCrossOriginMarkerStep()` safety net together, rather than calling
the bare step directly), `retryStep(options.retry)` (5a), `authStep(options.auth)` (this doc) — into a fresh
`PipelineBuilder`, in that order, then `build()`s. `LOGGING` and `SERDE`
stay empty: `LOGGING`'s real step ships in Phase 7 (Instrumentation & Configuration), which has not happened yet,
and `SERDE` remains reserved with no shipped behavior anywhere in this roadmap's current scope. This is a scope
boundary, not a deviation — `docs/knowledge/pipeline.md`'s "sync being redirect+retry+instrumentation" phrasing
describes the *reference's* eventual preset shape; this port's preset grows to match only once Phase 7 ships a
real logging step, at which point this function gets a narrow follow-up amendment, not a redesign.

`PIPE-24`'s "installs into empty slots only" (`MUST`): `standardResilience()` never takes a pre-populated builder
— it always starts from `new PipelineBuilder(transport)`, so "empty slots" is true by construction, with no
runtime check needed. If a future caller wants to layer the preset onto an already-customized builder, that is
exactly what `seedFrom(runtime, 'nest')` above is for — nest the customized runtime as this preset's opaque
transport, or flatten this preset's `Runtime` into a builder that already holds custom pre/post steps. The two
features compose rather than needing the preset itself to grow a "skip occupied slots" branch.

The async-variant half of `docs/knowledge/pipeline.md`'s SHOULD clause ("async being retry+instrumentation with a
caller-supplied scheduler") has no analogue here — 4c already dispositioned this port as one `Promise`-only
execution model with no second async pipeline to give a second preset to. Not re-litigated; recorded once more
here since this is the phase that would otherwise have been asked to build it.

## Public-barrel promotion (deferred from 4c, re-confirmed in 5a, closed here)

5c is the first point a caller can assemble a genuinely working pipeline — all three resilience pillars plus the
preset now exist. Promoting the authoring surface any earlier would have frozen shapes 5c still had latitude to
reshape (the roadmap's own reasoning for withholding it through 5a). Promoted through `@dexpace/core`'s single
public barrel as of this phase: `Stage`, `STAGE_ORDER`, `PILLAR_STAGES`, `StepDescriptor`, `StepContext`, `Next`,
`PipelineBuilder`, `Runtime`, `retryStep`, `redirectStep` (5b's, promoted alongside since it is equally part of
the authoring surface and 5b ships before this phase closes), `authStep`, `standardResilience`. Everything under
`packages/core/src/auth/` *not* in that list (the credential types, challenge parser, handlers, bearer cache)
stays `@internal` — a caller configures auth through `AuthStepSettings` passed to `authStep()`/`standardResilience
()`, not by constructing handler internals directly. `packages/core/etc/core.api.md`'s diff at plan-writing time
is the mechanical proof of exactly this surface and no more.

## Error Types

Three new leaves, following 4c's flat `DexpaceError` hierarchy convention:

- `AuthResolutionError` — carries required schemes (preference order) and available schemes (`AUTH-6`); also used
  for a null/pre-expired provider result (`AUTH-35`).
- `PlaintextCredentialError` — carries the concrete step name and offending scheme (`AUTH-28`).
- `DigestChallengeUnsupportedError` — carries the rejected algorithm/qop, for the case every configured handler
  declines (not a thrown error on the hot path — `composing-handler.ts` returns "no replacement," this leaf exists
  for a caller who wants to distinguish "no credential configured" from "credential configured but the challenge
  is unsatisfiable" via a lower-level API, not surfaced by `authStep()` itself, which just leaves the 401
  unchanged either way).
- `ArgumentError` reused from earlier phases for `AUTH-3`'s empty-descriptor rejection and `AUTH-6`'s all-tiers-
  absent case — no new leaf needed.

## Testing

`bun test`, colocated `*.test.ts`, `FakeTransport` (5a) for every pillar-step-level test — scripted `401,200`
sequences for challenge-response, wire-send counting to confirm the single-re-drive contract (`AUTH-30`), close-
observation via the sanctioned `ReadableStream.cancel()` hook (5a's note: `Response` is frozen, no spy-based close
assertions are possible or attempted).

**Closing `PIPE-2`'s remaining half and `AUTH-29`, jointly with 5b.** 5b's own design left these two exactly here.
A `standardResilience()`-built `Runtime` against a `FakeTransport` scripted `302 (cross-origin Location), 401
(Bearer challenge), 200`: assert (a) the auth step's Bearer credential is stamped on the pre-redirect request but
**absent** on the post-redirect re-issue (the cross-origin marker suppressed it — `AUTH-29`), (b) the redirect's
own `Authorization`-stripping (`REDIR-7`, 5b's job) and the auth step's marker-triggered suppression (5c's job) are
both independently necessary and neither alone is sufficient — a variant test with the auth step swapped for a
step that ignores the marker should show a credential leaking onto the cross-origin hop, proving the marker
actually does something observable, not just that headers happen to come out empty; (c) the auth step re-runs and
re-resolves per hop, not once for the whole call — a second, same-origin hop after the cross-origin one re-stamps
normally, confirming `AUTH-29`'s "a same-origin re-issue MUST be re-stamped normally" half too, and confirming
`PIPE-2`'s "auth executes per redirect hop and per retry attempt" for the redirect dimension specifically (5a's own
suite already covers the per-attempt dimension).

Property tests (fast-check), same "totality is the property" approach 5a used for `parsePacingHint`:

- **`parseChallenges`** — never throws for any string; a well-formed single challenge round-trips to
  scheme+params exactly; a comma inside a quoted value never splits the challenge.
- **Digest response computation** — recomputing HA1/HA2/response from the same inputs is deterministic
  (regression against RFC 7616's published test vectors, not a property in the fast-check sense, but colocated
  with the property suite).
- **Nonce-count monotonicity** — for a fixed nonce, `nextNonceCount` produces a strictly increasing sequence
  across N calls, wrapping correctly at the 32-bit boundary.
- **`resolveAuthRequirement`** — for any tier combination, the resolved requirement's scheme is always a member of
  `availableSchemes` or `NO_AUTH`, never anything else.

**Negative space:** no test patches a method onto a frozen `Response`. No test asserts on real Digest server
interop (out of this port's scope — RFC 7616 vector conformance is the substitute). No test exercises
`node:crypto` — only `globalThis.crypto`.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| One bearer strategy (three-zone async), not two | Reference ships a sync single-flight strategy and a separate async three-zone strategy | Same reasoning as 5a's `RETRY-28` collapse — one `Promise`-only execution model, so `AUTH-34`'s hot-path read is a branch of `AUTH-37`'s state machine, not a second stack |
| `AUTH-31`'s replayability gate applied uniformly | Reference applies it on the sync auth step only, SHOULD extend to async | One unified step leaves exactly one place to apply it; closes the spec's own SHOULD |
| Basic/Digest never stamp preemptively | Not explicitly stated either way in `§11`; inferred from AUTH-14/23-25's exclusively challenge-driven phrasing | Digest cannot stamp before seeing `realm`/`nonce`; no separate "preemptive Basic" ID exists to contradict treating both uniformly. Flagged as an interpretation, not a certainty — Phase 9's conformance sweep should re-check this reading against any reference test fixtures it turns up |
| This doc's first draft designed its own `WeakSet<Request>` cross-origin marker instead of consulting 5b | 5b (found mid-draft, see "How this doc was produced") ships the marker as a real header | The `WeakSet` draft was wrong, not just different: 5a's optional attempt-stamping constructs a fresh per-attempt `Request` between redirect and auth, which an identity-keyed signal cannot survive but a header (preserved by stamping) does. Withdrawn; 5c now consumes 5b's actual `hasCrossOriginMarker`/`clearCrossOriginMarker` |
| `standardResilience()` installs only REDIRECT/RETRY/AUTH, not LOGGING | `docs/knowledge/pipeline.md`'s preset description includes instrumentation | Phase 7 (instrumentation) has not shipped yet in this roadmap's sequence; scope boundary, not an omission — the function grows in a Phase 7 follow-up |
| No async-variant preset | Reference's async standard pipeline (retry+instrumentation+caller-supplied scheduler) | 4c already dispositioned one `Promise`-only execution model; no second pipeline exists to give a second preset to |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Deferred from | Target | Reason |
|---|---|---|---|
| `standardResilience()` gains a `LOGGING` pillar step | Phase 5c brainstorm | Phase 7 | No real logging step exists yet; today's preset only covers the three pillars that exist |
| Re-verification of the "Basic/Digest never preemptively stamp" reading against any reference fixtures | Phase 5c brainstorm | Phase 9 (conformance sweep) | Flagged as an interpretation in the Deviation Ledger above, not a certainty |
| `DigestChallengeUnsupportedError` — confirm whether any caller-facing API actually needs to distinguish this from a plain "no replacement" outcome, or whether it should be cut | Phase 5c brainstorm | Phase 5c plan time | Speculative leaf added for API completeness; cut it at plan time if no consumer materializes, per this codebase's YAGNI discipline |

## Alignment with 5b's shipped design: everything else checked

Beyond the marker (its own section above), cross-checked this doc against 5b's design for anything else that
needed reconciling:

- **`redirectStep()`'s export shape** matches what `preset.ts` assumes: a plain `redirectStep(settings):
  StepDescriptor` factory, `stage: 'REDIRECT'`, mirroring `retryStep()`'s shape exactly. No follow-up needed.
- **5b's `withRedirect(builder, settings)` helper** (installs `redirectStep()` + `stripCrossOriginMarkerStep()`
  together) is what the preset calls, not the bare step, so `standardResilience()` gets the `POST_AUTH` safety net
  for free — reflected directly in "The standard-resilience preset" above.
- **`PIPE-40`** (2-hop conformance) is closed entirely by 5b's own test suite — nothing left for 5c.
- **`PIPE-2`'s "auth step re-runs per redirect hop" clause** and **`AUTH-29`'s marker-consumption side** are
  exactly the two items 5b's own Deferred Items table already routes to 5c. Added to this doc's own Testing
  section below (the joint conformance test) rather than left as a dangling cross-reference.
