# Phase 5b — Redirect — Design

**Status:** Draft, self-authored per explicit delegation — see note at end of this section.

**Purpose:** Implement the redirect-following pillar step — status/method eligibility, Location resolution,
credential/cookie hygiene, the cross-origin credential-suppression marker, scheme-downgrade guarding, loop and
hop-cap detection, and the predicate override — satisfying `docs/product-spec/10-redirect-handling.md`
(`REDIR-1`–`REDIR-*`) and closing the `PIPE-40` deferred item. This is the second of three sub-phases the roadmap's
Phase 5 ("Resilience — Retry/Redirect/Auth") splits into: 5a (retry, done), **5b** (this document, redirect), 5c
(auth, `§11`).

**Governing documents:** `docs/product-spec/10-redirect-handling.md` (normative, cited by ID throughout — cited here
by the `docs/knowledge/redirect-handling.md` harvest rather than direct line numbers where the harvest already
carries the citation), `docs/product-spec/08-execution-pipelines.md` (`PIPE-*`, pillar/cursor/fork mechanics),
`docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md` (Node-port mapping — WHATWG `URL` origin
comparison), the Phase 4c design (`Stage`/`StepDescriptor`/`Cursor`/`fork()`, consumed unchanged) and the Phase 5a
design (`FakeTransport`, the "primitives before presets" discipline, the deviation-ledger format this document
follows). Styleguide: `styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

**Process note:** brainstormed and written autonomously (user unavailable for the live back-and-forth the
brainstorming skill normally runs). Per explicit instruction, every judgment call below is resolved against
`docs/knowledge/*` first; each one is called out inline and re-listed in the Deviation Ledger so it is easy to
challenge on review. Not committed — left for the user to review and commit if it holds up.

## Scope

5b ships the redirect step and nothing else: no auth step (5c), no standard-resilience preset (5c — it needs all
three pillars installed), no recovery-chain adapter. Unlike 5a's retry engine, redirect has **no async-side
mirror to adapt**: `pipeline.md`/`PIPE-*` is explicit that the async standard pipeline does not follow redirects at
the pipeline layer at all (no async redirect pillar exists), so this phase is pillar-only — one adapter, not two.

`FakeTransport` (built in 5a, `packages/core/src/testing/fake-transport.ts`) is reused unchanged, per the roadmap's
own note that "5b and 5c consume it unchanged."

This phase closes the roadmap's `PIPE-40` deferred item ("2-hop-redirect conformance clause... travels with the
first redirect step in 5b") — see Testing. It does **not** close `PIPE-2`'s auth-re-runs-per-hop clause (needs an
auth step, 5c) nor the `AUTH-29` marker-*consumption* side (5c also) — 5b only **produces** and **defends** the
marker; 5c is where something finally reads it for its intended purpose.

## Module Layout

All in `@dexpace/core`. Kebab-case filenames, no internal barrel, matching 5a's convention.

```
packages/core/src/redirect/
  codes.ts                 # recognized redirect-status set, per-code eligibility rules
  cross-origin.ts          # origin comparison (seed-relative) + the credential-suppression marker
  settings.ts               # RedirectSettings + construction validation
  decide.ts                 # pure per-hop decision function
  redirect-step.ts          # pillar adapter (4c) -- stage 'REDIRECT'
  strip-marker-step.ts      # defensive guard -- stage 'POST_AUTH', bundled with redirectStep()
  errors.ts                 # NonReplayableBodyError, SchemeDowngradeError
```

Reused, not redeclared: `Body.replayable` (3b), `Request.newBuilder()` / `Headers` case-insensitive mutation
(Phase 1/2, `HTTP-3`/`HTTP-13`), `Response.close()` idempotency (Phase 1, held through 3b/4b), `Cursor`/`fork()`
(4c), `FakeTransport` (5a), the no-op `Logger`/`LogEvent` default (installed process-wide, but the *seam itself*
isn't promoted to a public interface until Phase 7 per the roadmap's Deferred Items Log — see "Logging" below).

## Recognized codes and eligibility (`codes.ts`)

```typescript
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const DEFAULT_ALLOWED_METHODS: ReadonlySet<Method>;   // {GET, HEAD}
function isRecognizedRedirect(status: number): boolean;
function isEligibleByCode(status: number, method: Method, allowed: ReadonlySet<Method>, allow303: boolean): boolean;
```

300/304/305 are never auto-followed regardless of a Location header — 305 in particular must never redirect to a
server-chosen proxy — and any other status (2xx/4xx/5xx/non-redirect-3xx) is returned verbatim without consulting
redirect logic at all (the fast path below never even reaches `isEligibleByCode`).

301/302/307/308 are eligible only when `method ∈ allowed` (default `{GET, HEAD}`); when followed, method and body
are preserved — deliberately no automatic POST→GET rewrite. 303 is eligible only when the caller opted in
(`allow303`), and when followed it is **always** re-issued as GET with the body dropped, regardless of the original
method.

## Cross-origin comparison and the credential-suppression marker (`cross-origin.ts`)

```typescript
function isCrossOrigin(seedOrigin: Origin, target: URL): boolean;
const CROSS_ORIGIN_MARKER_HEADER = 'x-dexpace-internal-redirect-cross-origin';
function withCrossOriginMarker(headers: Headers): Headers;   // clears any inbound copy, then sets '1'
function clearCrossOriginMarker(headers: Headers): Headers;   // clears only, idempotent if absent
function hasCrossOriginMarker(headers: Headers): boolean;
```

`isCrossOrigin` compares scheme, host (case-insensitive), and effective port (scheme default when omitted) against
the **seed** request's origin — never the previous hop — so a same-origin sub-redirect on a foreign host cannot
re-expose the credential. This is the same comparison the knowledge notes flag as a JVM-reference wrinkle Node
sidesteps entirely: `new URL(...).origin` never performs DNS resolution, so there is no `java.net.URL.equals()`
hostname-resolution trap to work around.

**Why a header, not an in-process marker.** An earlier draft of this design considered a `WeakSet<Request>`
keyed by object identity — trivially unforgeable, and it never touches the wire. It was rejected: stage order is
`REDIRECT → RETRY → AUTH` (outer to inner), and 5a's attempt-stamping (`attempt-stamp.ts`) constructs a **fresh**
per-attempt `Request` copy when enabled. A `WeakSet` keyed to the exact instance the redirect step built would
silently stop matching the moment retry sits between redirect and auth and stamping is on — the auth step would
receive a different object than the one flagged, and cross-origin credential suppression would fail exactly when a
retry is layered underneath a redirect, which is a real, expected pipeline shape. A header survives this because
5a's stamping explicitly "preserves the idempotency key and every other header" — so the marker travels correctly
through an intermediate copy where an identity-based signal would not. This is why the knowledge notes describe the
mechanism in header/wire vocabulary ("removed by the credential-attaching layer before dispatch," "forwards the
internal marker to the transport") rather than an in-memory flag — it is the only mechanism that composes correctly
with a fresh Request copy in between.

**The independent-of-auth guard (`strip-marker-step.ts`).** The knowledge notes call out, explicitly, that in the
reference implementation only the auth step strips the marker, so "a pipeline with no auth step, including the
sync standard-resilience preset, forwards the internal marker to the transport," and that "a robust port should
strip the signal independently of whether a credential layer runs." 5b ships before 5c — **today, with only a
redirect step installed, there is no auth step to strip anything**, so this isn't a future concern to defer, it is
an immediate leak this phase would otherwise ship. The fix stays inside 5b's own scope, without reaching into 4c's
shared `Cursor` or waiting on 5c: `STAGE_ORDER` already carries an inert `POST_AUTH` extension slot for exactly this
kind of user-installable step. 5b ships a second, non-pillar step there — unconditionally clears the marker header
if present, otherwise a no-op — and a `redirectStep()` caller is expected to install both descriptors together (see
"Adapters" below). When 5c ships, the auth step becomes the marker's real *consumer* (skip-stamping) and *first*
stripper; `strip-marker-step.ts` remains installed as a redundant, idempotent safety net — stripping an
already-absent header costs nothing.

## Scheme-downgrade guard

Evaluated **per hop**, comparing the *current* (most recently dispatched) request's scheme against the *next*
target's scheme — **not** the seed scheme. This is a deliberate, different reference point from cross-origin's
seed-relative comparison, easy to conflate since both are "origin-shaped" checks: cross-origin exists to protect a
credential attached at the seed from leaking to any later origin, so it must always compare against the seed;
downgrade exists to catch a single HTTPS→HTTP transition wherever it happens in the chain, so an
HTTPS→HTTP→HTTPS round trip only flags the one hop that actually downgraded, not the whole chain relative to the
seed. An HTTPS-to-HTTP transition is rejected by default (`SchemeDowngradeError`, current response closed before
the throw) and permitted only via an opt-in settings flag, `allowSchemeDowngrade`; credential stripping still
applies regardless of this flag.

`REDIR-15` asks for two distinct things here and it is easy to read them as one: the flag is the **opt-in**, and
"MUST surface it observably (e.g. a warning log)" is a **separate obligation on the permitted path**. Setting a
boolean is not surfacing anything — a downgrade that the caller opted into a year ago in a config file still
needs to show up in the logs of the request that actually took it. So a *permitted* downgrade emits its own
warning-level event, distinct from the rejection event on the default path. This is also the third of the three
5b events Phase 7b's "Amendments to 5a and 5b" section names ("a downgrade event ... if the settings permit it
at all"). It is derived in `redirect-step.ts` by comparing the two hops' schemes rather than carried on
`decide()`'s `follow` variant, so the `Decision` shape stays as designed.

## Settings (`settings.ts`)

```typescript
interface RedirectSettings {
  readonly maxHops: number;                        // default 3; 0 disables following (see below)
  readonly allowedMethods: ReadonlySet<Method>;      // default {GET, HEAD}; defensive copy
  readonly allow303: boolean;                        // default false
  readonly allowSchemeDowngrade: boolean;             // default false
  readonly locationHeader: string;                    // default 'Location'
  readonly predicate?: RedirectPredicate;
}
```

`allowedMethods` is stored as a defensive copy so post-construction mutation of the caller's collection cannot
change policy (the same discipline 5a's `settings.ts` applied to its retryable-status/idempotent-method sets) —
the copy, not a freeze, is what `REDIR-26` actually asks for: `Object.freeze` is shallow and does not disarm
`Set.prototype.add`, so a "frozen `Set`" would be a promise the runtime cannot keep. The settings object itself
is frozen; `ReadonlySet` is what keeps SDK-internal code from writing to the set. `maxHops: 0` needs no special
branch — step 5 of `decide()` below applies the same hop-cap gate every other
`maxHops` value uses, and a 0-hop budget simply fails it on the first follow attempt.

## The per-hop decision (`decide.ts`)

```typescript
interface RedirectCondition {
  readonly response: Response;
  readonly redirectsFollowed: number;
  readonly visited: ReadonlySet<string>;   // insertion-ordered, includes the current request's URI
}
type RedirectPredicate = (condition: Readonly<RedirectCondition>) => boolean;

type Decision =
  | { readonly kind: 'follow'; readonly nextRequest: Request; readonly crossOrigin: boolean }
  | { readonly kind: 'return-current' }
  | { readonly kind: 'fail'; readonly error: Error };

function decide(
  response: Response,
  currentRequest: Request,
  seedOrigin: Origin,
  visited: ReadonlySet<string>,
  settings: RedirectSettings,
): Decision;
```

`decide` is pure — no I/O, no header mutation side effects beyond building the returned `nextRequest` value,
mirroring 5a's `classify.ts`/`backoff.ts` split of decision logic away from the imperative loop. Its steps, in
order:

1. **Fast path.** `response.status` not in `REDIRECT_STATUSES` → `return-current`, without allocating a
   `RedirectCondition` or consulting a predicate at all. This is a `SHOULD`-level optimization the knowledge notes
   name explicitly ("the implementation SHOULD short-circuit before allocating a condition snapshot"), and it is
   the one branch where skipping the snapshot is observably correct: nothing downstream can distinguish "fast path
   taken" from "snapshot allocated, predicate said no."
2. **Snapshot allocation and the follow/no-follow call.** The `RedirectCondition`'s `visited` set is a defensive
   *copy* of the step's live cycle-detection set, not the set itself typed `ReadonlySet` — the spec's wording
   ("so it cannot mutate the live cycle-detection state") is about the object, not the type, and a predicate that
   casts the readonly away could otherwise pre-seed or clear loop detection for the rest of the call. Any
   recognized 3xx allocates the `RedirectCondition` and
   is at least offered to a configured predicate — **even with no usable Location** — matching the knowledge
   notes' explicit "a recognized 3xx always allocates the snapshot and consults the predicate, even with no usable
   Location." If a predicate is configured, its boolean return **is** the follow/no-follow decision, replacing
   `isEligibleByCode`. If none is configured, `isEligibleByCode` decides.
   - **Scope of the override, a judgment call.** "MUST fully override the built-in decision" is read here as
     scoped to the *code/method eligibility* question only — not as license to bypass the safety mechanics below
     (userinfo stripping, credential/cookie hygiene, scheme-downgrade rejection, body-replayability, loop/cap
     detection). Those aren't "should I follow this kind of redirect" policy, they're wire-safety invariants the
     product spec states in `MUST` terms unconditionally elsewhere in the same document; a caller predicate opting
     to follow a 307 with a non-idempotent, non-replayable body still can't make that body re-sendable, and
     shouldn't be able to silently corrupt it either. If this reading is wrong, it is a narrow, mechanical fix:
     move step 3 onward inside an `if (predicateSaysFollow)` and skip straight to returning the live response
     otherwise — logged in the Deviation Ledger so it's easy to revisit.
   - No-follow (predicate says no, or code/method ineligible, or 303 not opted in) → `return-current`.
3. **Location resolution.** Missing/empty Location → `return-current`. Otherwise resolve against the *current
   hop's* request URL per RFC 3986 (relative) or use as-is (absolute), via WHATWG `URL` — never re-encoding the
   already-percent-encoded path/query/fragment, never decoding `%2F`/`%26`. A malformed/unresolvable Location (bad
   URI, illegal characters, unsupported scheme) → `return-current` (logged, see "Logging" below) — never throws.
   Userinfo (`user:pass@`) is dropped unconditionally; a server-embedded credential is never used.
   - **Two things WHATWG `URL` does not give us for free**, both explicit in the implementation. First, with a
     base supplied it *almost never throws*: any string that is not a valid absolute URL is treated as a relative
     reference, so `' not a url'` resolves to `.../not%20a%20url` rather than failing. The `catch` is therefore a
     narrow path (a malformed absolute form like `http://[`), not the general garbage guard it looks like — and
     that is correct, since a relative reference the server actually sent should be followed. Second, it parses
     schemes we must never dispatch against: `javascript:`, `data:`, `file:`, `mailto:` all construct fine, and
     the scheme-downgrade guard would wave them through (none of them is `http:`). Resolution therefore ends with
     an explicit followable-scheme gate — `http:`/`https:` only — which is what makes the spec's "unsupported
     scheme is returned unfollowed" clause true rather than aspirational.
4. **Loop detection.** If the resolved target's absolute URI is already in `visited` → `return-current` (the loop
   response, not thrown).
5. **Hop cap.** If following this hop would exceed `maxHops` → `return-current` (the last response, even if itself
   a 3xx). This is the one gate `maxHops: 0` always fails immediately, which is what "disables redirect following
   entirely" reduces to — no separate branch needed.
6. **Scheme-downgrade guard.** Current-hop scheme HTTPS, target scheme HTTP, `allowSchemeDowngrade` false →
   `fail(SchemeDowngradeError)`.
7. **Cross-origin determination**, against `seedOrigin` (not the current hop) — feeds header construction next.
8. **Header construction for the next hop**, from `currentRequest.newBuilder()` (HTTP-3): strip `Authorization`
   unconditionally (every re-issue, including same-origin and the 303 rebuild); if cross-origin, additionally strip
   `Cookie` and `Proxy-Authorization`; clear any inbound copy of the cross-origin marker, then conditionally set it
   if cross-origin (never both — clearing always precedes the conditional set, so a forged/stale inbound copy
   can't survive a hop that shouldn't carry it); for a 303 rebuild, additionally strip every `Content-*` header
   (case-insensitive match) and force the method to GET.
9. **Body handling.** 303 drops the body — exempt from replayability. For a method-preserving redirect
   (301/302/307/308) carrying a body, gate on `body.replayable`; if not replayable →
   `fail(NonReplayableBodyError)` naming the body's replayability rather than corrupting or truncating a re-send.
   Replayable bodies are re-sent as-is — the *rewind* itself is 3b's `writeTo` contract (`BODY-9`), not this
   step's job.
10. Build `nextRequest` from the accumulated header/method/URL/body decisions → `{kind: 'follow', nextRequest,
    crossOrigin}`.

## Adapter: the pillar step (`redirect-step.ts`)

```typescript
const REDIRECT_STEP_TYPE = Symbol('dexpace.redirect');
function redirectStep(settings: RedirectSettings): StepDescriptor;      // stage: 'REDIRECT'
function withRedirect(builder: PipelineBuilder, settings: RedirectSettings): PipelineBuilder;
```

Like 5a's `retryStep()`, this asserts `ctx.fork` via `invariant()` (`REDIRECT` is in `PILLAR_STAGES`) and **never**
calls `ctx.next()` — every dispatch, including the first, goes through a fresh `fork()`, since the step may need to
re-drive the downstream chain an unknown number of times and `next()`'s single-invocation guard would trip on the
second hop. `PIPE-15`'s re-drive-with-fresh-cursor mandate and `PIPE-36`'s locked-stage-assignment both land the
same way 5a's did: a factory returning a descriptor with `stage: 'REDIRECT'` baked in, nothing to subclass or
relocate.

**Response lifecycle**, matching the knowledge notes' explicit ordering: before dispatching hop N+1, hop N's
response is closed (there is no "prior" response before the very first dispatch). If `decide()` returns `'fail'`,
the *current* response is closed before the error propagates. On every `'return-current'` outcome, the response is
returned **open** — the caller's to close. This is the same close-responsibility-passes-outward discipline
`pipeline.md` states generally for any wrapping step that re-drives the chain.

`REDIR-22`(b) says "if building the follow-up throws" — not "if `decide()` returns `'fail'`", which is the
narrower thing. `decide()` is pure *except* that it invokes `settings.predicate`, which is caller code and may
throw for reasons this step cannot enumerate; `Request`/`Headers` builder validation is a second, thinner
vector. A raw `decide()` call in the loop would let either escape with the hop's response still open, leaking
the body. The call is therefore wrapped so any throw closes the current response and rethrows unchanged — the
error is the caller's own, so it is not remapped to a redirect error type. Note the asymmetry with retry, where
`RETRY-40` says a throwing predicate SHOULD be converted to a typed illegal-state error: redirect's spec states
no such conversion, so the throw passes through.

```
visited = { request.url }             -- seeded with the original (seed) request's absolute URI
loop:
  response = fork()(request)          -- first iteration; subsequent iterations re-fork per hop
  decision = decide(response, request, seedOrigin, visited, settings)
  switch decision.kind:
    'return-current' -> return response (open)
    'fail'           -> close(response); throw decision.error
    'follow'         -> close(response); visited.add(decision.nextRequest.url); 
                        request = decision.nextRequest; continue loop
```

Iterative, not recursive — stack-safe by construction, the same trampoline-for-free argument 5a made for
`RETRY-30`: a `for`/`while` loop with `await` releases each iteration's frame before the next begins.

`ctx.signal` (the amendment 5a's brainstorm added to `StepContext`) is checked once per iteration before issuing
the next hop's dispatch: if already aborted, the loop stops and returns the current response as-is, open, rather
than issuing a hop the caller has already cancelled. No cancellable *wait* is needed here (unlike retry) — there is
nothing to sleep between hops — so this is a single cheap check, not a timer race.

### Guard step (`strip-marker-step.ts`)

```typescript
function stripCrossOriginMarkerStep(): StepDescriptor;   // stage: 'POST_AUTH', non-pillar
```

Unconditionally clears `CROSS_ORIGIN_MARKER_HEADER` if present and calls `ctx.next()` (ordinary single-invocation
step, no fork needed — it never re-drives). `withRedirect(builder, settings)` installs both `redirectStep()` and
this guard together, so a caller reaching for redirect support gets the safety net without needing to know the
marker exists. A caller who installs `redirectStep()` directly against the builder's lower-level API without going
through `withRedirect()` is responsible for installing the guard too — documented on `redirectStep()`'s TSDoc.

## Errors (`errors.ts`)

Two new leaves, both direct `DexpaceError` children (the corpus's two-level cap, same collapse 3b applied to its
own new error types):

```typescript
class NonReplayableBodyError extends DexpaceError { ... }   // redirect wants to re-send a non-replayable body
class SchemeDowngradeError extends DexpaceError { ... }      // HTTPS-to-HTTP hop rejected
```

`NonReplayableBodyError` is distinct from 3b's `ConsumedBodyError`: the latter fires on a *second write attempt*
against an already-consumed single-use body; this one fires *before* attempting any write at all, as a fail-fast
gate on `body.replayable`, naming replayability specifically as the knowledge notes require ("a clear error naming
replayability rather than corrupting or truncating the re-send").

## Logging

> **Amended 2026-07-28 (Phase 7b retrofit).** The paragraph below was written when the `Logger` seam did not
> exist. Phase 7b built it, and amended this phase to emit three of these events — see the plan's amendment
> banner and the revised disposition after the original text.

*Original disposition (superseded):* `redirect-handling.md` says each followed hop, loop detection, and
scheme-downgrade event *SHOULD* be emitted as structured records, redacted, with the malformed-Location event
logging the raw string as an explicit exception (it failed to parse and cannot be redacted). This phase does
**not** implement it: the roadmap's own Deferred Items Log places the `Logger`/`LogEvent` seam at Phase 7, and
5a — despite `retry-and-resilience.md`'s equivalent `SHOULD`-level logging language — shipped with none either.
Wiring redirect's log call sites is a one-file addition once Phase 7's `Logger` interface exists; doing it now
against a facade that doesn't exist yet would mean guessing its shape twice. Not re-litigated; consistent with
5a's precedent.

*Current disposition:* `redirect-step.ts` emits three events via `getGlobalLogger()` — a per-hop event, a
rejection event on the `'fail'` path, and the permitted-downgrade event described under "Scheme-downgrade
guard". Two constraints bind every one of them, and neither is optional:

- **Every URL field goes through `redactUrl()`** (`observability/redaction.ts`, 7b), the same function 7b's
  `loggingStep` uses for `url.full`. A raw `url.href` in a log line defeats `REDIR-28`'s "URLs passed through a
  redactor" and the cross-cutting default-deny redaction invariant (`XCUT-19`) in one stroke: the seed URL can
  carry userinfo and the query string can carry a token, and the redirect step is precisely the code path a
  credential-bearing URL travels down. One function, three call sites, no second policy to drift.
- **Every emission site is contained** (`emitQuietly`), per `OBS-20`/`XCUT-20` — observability must never throw
  into the request path. This matters most on the `'fail'` path, where an unguarded emit placed before
  `response.close()` would both leak the body and replace `SchemeDowngradeError` with a logger's own error. The
  close therefore happens first, and the emit cannot escape.

Still deferred, and *not* closed by the retrofit: the loop-detected event and the malformed-Location event.
Both need a reason discriminant on `decide()`'s `'return-current'` variant, which `decide.test.ts` asserts the
shape of throughout; reshaping it is out of this retrofit's scope. `REDIR-28`'s carve-out — that the
malformed-Location event logs the raw string, since it failed to parse and cannot be redacted — travels with
that deferral.

## Testing

`bun test`, colocated `*.test.ts`, fakes over mocks — `FakeTransport` (5a) scripts response sequences
(`301,301,200`, a self-referencing Location for loop detection, a 4th 301 past a 3-hop cap, a cross-origin 302).

**Closing `PIPE-40`.** The 2-hop-redirect conformance clause is the direct test of the response-lifecycle discipline
above: two chained 301s then a 200, asserting (a) `FakeTransport.calls.length === 3` (wire-send count), (b) both
intermediate responses report exactly one `closedCount()` each via the `ReadableStream.cancel()` hook (5a's
sanctioned close-observation method — `Response` is frozen, so no spy assignment), and (c) the final response is
*not* closed, left for the caller. This is the same "close-responsibility passes outward" property 5a's own tests
never needed to exercise (retry re-drives without redirect's response-return-vs-close bifurcation), so it is a
genuinely new conformance case, not a restatement of a 5a test.

Property tests (fast-check), matching 5a's discipline of testing invariants rather than fixed corpora:

- **Location resolution never re-encodes.** For a corpus of already-percent-encoded relative/absolute Locations,
  resolved `pathname`/`search`/`hash` are byte-identical to the input's corresponding components.
- **Cross-origin comparison is scheme/host/port-only.** Never true for two URLs differing only in path/query/
  fragment; always true for a differing host, scheme, or non-default port.
- **Malformed-Location totality.** `decide()` never throws for arbitrary garbage in the Location header — every
  failure path returns `'return-current'`.
- **Loop detection terminates** for an arbitrarily deep synthetic redirect chain, bounded by `maxHops` regardless
  of chain length.

**Negative space.** No test patches a method onto a frozen `Response`. No test depends on real DNS resolution or a
real network origin. No test asserts wall-clock timing (redirect has no delay/backoff component — unlike 5a,
nothing here is timing-sensitive). No test relies on `Date.parse` (redirect resolves URLs, not HTTP-date pacing
hints — that parser is 5a's `pacing.ts`, untouched here).

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| Cross-origin marker is a real header, cleared-then-conditionally-set every hop | (same — reference also signals out-of-band per-request) | An in-process `WeakSet` alternative was considered and rejected: it silently breaks the moment 5a's attempt-stamping sits between redirect and auth and produces a fresh `Request` copy, which a header survives because stamping explicitly preserves headers |
| A second, always-bundled `POST_AUTH` guard step strips the marker independently of whether an auth step exists | Reference relies solely on the auth step to strip it | Knowledge notes explicitly flag this as a leak today (no auth step exists until 5c) and explicitly recommend independent stripping; implemented via an existing user-extensible stage slot, no changes to 4c or 5c required |
| Scheme-downgrade check keyed to the *previous hop's* scheme; cross-origin check keyed to the *seed's* scheme | Both described in similarly "per-hop"/"origin" language, easy to conflate | Different purposes: downgrade catches a single transition wherever it occurs; cross-origin must stay anchored to the credential's original origin for the whole chain, per the spec's explicit "MUST be against the seed origin, not the previous hop" |
| Redirect predicate override is scoped to code/method eligibility only, not to the safety mechanics (credential stripping, downgrade, replayability, loop/cap) | "MUST fully override the built-in decision" | A judgment call on ambiguous scope; the safety mechanics are stated as unconditional `MUST`s elsewhere in the same spec document, not as part of "should this redirect be followed" policy. Flagged for review |
| Location resolution ends with an explicit `http:`/`https:` followable-scheme gate | Spec states "an unsupported scheme" is returned unfollowed, without saying how it is detected | WHATWG `URL` happily parses `javascript:`, `data:`, `file:`, and `mailto:`, and the scheme-downgrade guard passes them (none is `http:`) — without the gate the step would dispatch a server-supplied `javascript:` target |
| The predicate's `RedirectCondition.visited` is a defensive copy, not the live set typed `ReadonlySet` | Spec: "a read-only, defensively-copied condition snapshot… so it cannot mutate the live cycle-detection state" | A `ReadonlySet` type annotation is erased at runtime; a predicate that casts it away could pre-seed or clear loop detection for the rest of the call. The spec's wording is about the object, not the type |
| `maxHops: 0` is an ordinary cap value, not a special-cased early return | Spec states it as "disables redirect following entirely" | Falls out of the same cap gate every other `maxHops` value uses — a 0-hop budget always fails the "would this exceed the cap" check on the first follow attempt, producing identical observable behavior with no branch to get wrong |
| No stage-pipeline recovery-chain adapter | 5a shipped two adapters (pillar + recovery) over one retry engine | `pipeline.md`/`PIPE-*` states plainly there is no async redirect pillar — the async standard pipeline does not follow redirects at the pipeline layer at all, so there is no second consumer to adapt for |
| ~~Redirect logging not implemented~~ — **superseded 2026-07-28 by the Phase 7b retrofit**; hop, rejection, and permitted-downgrade events now ship, redacted and contained | Spec: `SHOULD` emit structured records per hop/loop/downgrade event | Was: `Logger`/`LogEvent` seam is Phase 7 per the roadmap's Deferred Items Log. Now: only the loop-detected and malformed-Location events remain deferred, both blocked on a reason discriminant `decide()`'s `Decision` does not carry |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Note |
|---|---|---|---|
| `PIPE-40` — 2-hop-redirect conformance clause | Phase 4c, targeted here by the roadmap | **Resolved in Phase 5b** | Satisfied by the two-hop `FakeTransport` test above (wire-send count, per-hop close, final-response-open) |
| `AUTH-29` / marker *consumption* (skip-stamping on a cross-origin re-issue, first-stripper role) | This brainstorm | **Phase 5c** | 5b only produces the marker and defends it with an independent guard step; nothing yet reads it for its intended purpose (suppressing credential stamping) — that is 5c's auth step |
| Redirect structured logging (`SHOULD`-level hop/loop/downgrade events) | This brainstorm | **Partially resolved 2026-07-28 (Phase 7b)** | Hop, rejection, and permitted-downgrade events ship in `redirect-step.ts`, URLs through `redactUrl()`, emissions through `emitQuietly()`. The loop-detected and malformed-Location events remain open — both need a reason discriminant on `decide()`'s `'return-current'` variant |
| Redirect predicate's scope over safety mechanics (see Deviation Ledger) | This brainstorm | Re-confirm at Phase 9 conformance sweep, or sooner if the user disagrees | A judgment call made without the user present; narrow and mechanical to reverse if wrong |
