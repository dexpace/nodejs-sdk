# Phase 5b — Redirect Implementation Plan — Checklist

Verification of [2026-07-26-phase5b-redirect.md](./2026-07-26-phase5b-redirect.md) against every requirement
ID in `docs/product-spec/10-redirect-handling.md` (`REDIR-1`–`REDIR-28`) plus `PIPE-40`, as dispositioned by
`docs/superpowers/specs/2026-07-26-phase5b-redirect-design.md`.

**Status: EXECUTED (2026-08-27).** Every task below is implemented, tested, and green across the full gate
sequence (`typecheck`, `lint`, `build`, `bun test` with coverage, `api:ci`, `lint:publish`,
`verify:dual-consumption`, `verify:consumer-types`, `verify:seam-1`, `verify:runtime-floor`, `test:node`,
`audit`). `packages/core/etc/core.api.md` and `packages/core/src/index.ts` are byte-identical to this phase's
starting point (`862bb46`, Phase 5a) — nothing in this phase reaches the public barrel. (Stated against
the branch point, not `main`: `main` currently sits three commits back at `8e55792`, so a diff against
it would show Phases 3, 4, and 5a's barrel changes and prove nothing about this one.)

**Legend:** ✅ Implemented and tested — 🚫 Not built (permanent simplification, named reason) — ⏳ Deferred
(named target phase) — N/A Not applicable in this port.

## Files shipped

| File | Requirements | Task |
|---|---|---|
| `packages/core/src/redirect/errors.ts` | `REDIR-6`, `REDIR-15` | 1 |
| `packages/core/src/redirect/codes.ts` | `REDIR-1`–`REDIR-5` | 2 |
| `packages/core/src/redirect/cross-origin.ts` | `REDIR-8`, `REDIR-11` | 3 |
| `packages/core/src/redirect/settings.ts` | `REDIR-17`, `REDIR-20`, `REDIR-26`, `REDIR-27` | 4 |
| `packages/core/src/redirect/decide.ts` | `REDIR-1`–`REDIR-21` | 5 |
| `packages/core/src/redirect/redirect-step.ts` | `REDIR-22`, `REDIR-23`, `PIPE-15`, `PIPE-36`, `PIPE-40` | 6 |
| `packages/core/src/redirect/strip-marker-step.ts` | `REDIR-11`(c) | 7 |
| `packages/core/src/recovery/release.ts` | `RECOV-12`, `RETRY-22`, `REDIR-22`(b) | review pass 1 |
| `test/node-conformance/redirect.test.mjs` | `REDIR-12`–`REDIR-14`, `REDIR-18`, `PIPE-40` on Node | 6 |

Every production file has a colocated `*.test.ts`; 124 tests across the eight pairs.

`recovery/release.ts` was not in the plan. It is `releaseQuietly`/`withReleaseFailure`, **extracted
unchanged** from `retry/engine.ts` during review pass 1 so this phase's two error paths consume them
rather than shipping a second copy of a helper whose identity guard is load-bearing. The move is
behavior-neutral for 5a — its suite passes untouched — and `engine.ts` now imports what it used to
define.

## 10.1 Recognized codes and eligibility

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-1 | MUST | Redirect attempted only for 301/302/303/307/308; any other status returned verbatim without consulting redirect logic | ✅ | Task 2 (`REDIRECT_STATUSES`, `isRecognizedRedirect`), Task 5 (`decide()`'s first statement, before any allocation) |
| REDIR-2 | MUST | 300/304/305 never auto-followed even with a Location; 305 never redirects to a server-chosen proxy | ✅ | Task 2 — excluded from the set by construction; asserted for all three codes *with* a Location present |
| REDIR-3 | MUST | 301/302 followed only when the ORIGINAL method is in the allowed set (default `{GET, HEAD}`); method AND body preserved, no automatic POST→GET rewrite | ✅ | Task 2 (`isEligibleByCode`), Task 5 (`buildFollowRequest` carries `current.method` and the builder-prefilled body through) |
| REDIR-4 | MUST | 307/308 preserve method and body, followed only when the method is in the allowed set | ✅ | Task 2 — same predicate; 303 is the only status branched on, so the four method-preserving codes cannot drift apart |
| REDIR-5 | MUST | 303 not followed by default; when opted in, re-issued as GET with the body dropped and every `Content-*` header removed case-insensitively; the original method is irrelevant to whether it is followed | ✅ | Task 2 (the `allow303`-only gate, asserted against an *empty* allowed-method set), Task 5 (`stripContentHeaders`, `method: 'GET'`, `body(undefined)`) |

## 10.2 Body and credential hygiene

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-6 | MUST | A followed method-preserving redirect re-sends the body, so it MUST be replayable; a non-replayable body fails with a clear error naming replayability, and the redirect is not attempted. 303 exempt | ✅ | Task 1 (`NonReplayableBodyError`), Task 5 — the gate is evaluated **before** any write is attempted, which is what separates it from 3b's `ConsumedBodyError` (a second-write failure). 303's exemption asserted with a single-use body |
| REDIR-7 | MUST | `Authorization` stripped before EVERY re-issue — same-origin and the 303 GET rebuild included | ✅ | Task 5 (`nextHopHeaders`, unconditional), asserted same-origin, cross-origin, on the 303 rebuild, and on a permitted downgrade; re-asserted end-to-end against the wire in Task 6 |
| REDIR-8 | MUST | Cross-origin iff the resolved target differs from the SEED origin in scheme, host (case-insensitive), or effective port (default when omitted) — never the immediately preceding hop | ✅ | Task 3 (`originOf`/`isCrossOrigin`) — the seed origin is computed once in the step and never advances with the chain (Task 6). A `fast-check` property asserts path/query/fragment never participate |
| REDIR-9 | MUST | On a cross-origin redirect (303 rebuild included), `Cookie` and `Proxy-Authorization` also stripped | ✅ | Task 5 |
| REDIR-10 | SHOULD | On a same-origin redirect the `Cookie` header is retained; only `Authorization` is stripped | ✅ | Task 5, asserted directly (both headers survive a same-origin hop) |
| REDIR-11 | MUST | A cross-origin re-issue carries an out-of-band signal telling the auth layer to skip stamping: (a) unforgeable — cleared on every re-issue before being conditionally set, (b) suppress-only, never causing a credential to be sent, (c) removed by the credential-attaching layer before dispatch | ✅ (a, b, c) | Task 3 (`CROSS_ORIGIN_MARKER_HEADER`, `withCrossOriginMarker` clears-then-sets in one `set` call), Task 5 (cleared unconditionally, set only when cross-origin), Task 7 (the `POST_AUTH` guard). (b) holds structurally — nothing in 5b reads the marker to *cause* a stamp; 5c's auth step is its first consumer. The porter caveat the requirement itself names ("a pipeline with no auth step forwards the internal marker to the transport") is closed here rather than left to 5c — see the cross-phase table **Review pass 1:** the guard step now early-returns when the marker is absent instead of rebuilding `Headers` and `Request` on every request through the pipeline, and `withRedirect()` removes any existing guard before re-installing, so a second call cannot seat a duplicate (`append` dedupes by `type` only for pillar stages) |
| REDIR-12 | MUST | Userinfo in the Location target dropped before re-issue; server-supplied embedded credentials never used | ✅ | Task 5 (`resolveLocation`), asserted in `bun test` and again on Node's own URL parser |

## 10.3 Location resolution

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-13 | MUST | Resolution preserves the wire-exact, already-percent-encoded path/query/fragment, bracketed IPv6 literal hosts, and explicit ports; `%2F`→`/` or `%26`→`&` re-encoding forbidden | ✅ | Task 5 — nothing decodes or re-encodes; the only mutation is clearing userinfo. Asserted for `%2F`/`%26` and for `[2001:db8::1]:8443`, and repeated in `test/node-conformance/redirect.test.mjs` because the parser is the runtime's, not this package's |
| REDIR-14 | MUST | A relative Location resolved against the CURRENT hop's request URL per RFC 3986; absolute values used as-is after userinfo stripping | ✅ | Task 5 — `new URL(raw, currentUrl)`. The two-hop test in Task 6 uses a *relative* second Location precisely so "current hop, not seed" is load-bearing |
| REDIR-18 | MUST | A malformed or unresolvable Location — invalid URI, illegal characters, or an unsupported/unknown scheme — MUST NOT throw; the step returns the current response unfollowed | ✅ (total) / ⏳ (the log) | Task 5 — totality asserted by a `fast-check` property over arbitrary strings sanitized only to what the *lenient* inbound header validator admits. The unsupported-scheme half needed an explicit `http:`/`https:` gate: WHATWG `URL` parses `javascript:`, `data:`, `file:`, and `mailto:` without complaint and the downgrade guard passes all of them. The requirement's "logs the condition" clause is deferred — see the deferral table |
| REDIR-19 | MUST | A missing or empty Location returns the response unfollowed | ✅ | Task 5, asserted for both the absent header and an empty value |
| REDIR-27 | MAY | The header the target is read from is configurable, default `Location` | ✅ | Task 4 (`locationHeader`), Task 5 (read through the setting), asserted with a custom header name. **Review pass 1:** the value was validated non-blank but stored untrimmed and never checked against the header-name grammar, while `Headers.get()` neither trims nor validates — so `' Location '` was accepted and then silently matched nothing, leaving every redirect unfollowed with no error at any layer. Now trimmed before storage and validated with `hasForbiddenNameByte` (HTTP-17), the same guard 5a applies to `attemptHeaderName` |

## 10.4 Loop, cap, and downgrade

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-15 | MUST | An HTTPS→HTTP downgrade across a single hop rejected by default with a clear error; opt-in permits it but MUST surface it observably; credential stripping applies regardless; evaluated per hop transition | ✅ (rejection, opt-in, stripping) / ⏳ (the observable surfacing) | Task 1 (`SchemeDowngradeError`), Task 5 — keyed to the CURRENT hop's scheme, not the seed's, so an HTTPS→HTTP→HTTPS chain flags only the hop that actually downgraded; asserted directly. Credential stripping on a *permitted* downgrade asserted separately. The "surface it observably" clause is a distinct obligation on the permitted path and is deferred with the rest of redirect's logging — see the deferral table |
| REDIR-16 | MUST | Loops detected by recording every visited absolute URI (seeded with the original request URI); revisiting one stops and returns the CURRENT response WITHOUT throwing, body left open | ✅ | Task 5 (the `visited` check), Task 6 (the set is seeded with the seed request's `href` and grown per followed hop). Asserted end-to-end: the loop response comes back identical and with `cancelCount() === 0` |
| REDIR-17 | MUST | Followed redirects capped by `maxHops` (default 3); on reaching the cap the last response is returned as-is even if itself a 3xx, without throwing; `maxHops: 0` disables following entirely | ✅ | Task 4 (default 3, `0` accepted as an ordinary value; **review pass 1** tightened the guard from finite-and-non-negative to `Number.isInteger`, so a fractional budget is rejected rather than silently truncated), Task 5 (`redirectsFollowed + 1 > maxHops`). Asserted end-to-end with a 4th 301 past a 3-hop cap — returned open, still a 301 — and with `maxHops: 0` on the first response. No special-case branch exists for `0`; the same gate produces it |
| REDIR-23 | SHOULD | Iterative loop, not unbounded recursion, so it is stack-safe regardless of `maxHops` | ✅ | Task 6 — a `for(;;)` with `await`; each iteration's frame is released before the next begins |

## 10.5 The predicate and the fast path

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-20 | MUST | A configured predicate fully overrides the built-in follow decision and receives a read-only, DEFENSIVELY COPIED condition snapshot (current response, redirects already followed, insertion-ordered visited set including the current request's URI) so it cannot mutate live cycle-detection state | ✅, scoped | Task 4 (`RedirectCondition`/`RedirectPredicate`), Task 5. The snapshot is a real `new Set(visited)` copy, not the live set typed `ReadonlySet` — the type is erased at runtime, and the assertion that a predicate casting it away cannot poison loop detection is a direct test. **The override is scoped to code/method eligibility only**, not to the safety mechanics that follow it (userinfo stripping, credential hygiene, downgrade rejection, replayability, loop/cap) — a judgment call on ambiguous wording, recorded in the design doc's Deviation Ledger and asserted as ledgered behavior |
| REDIR-21 | SHOULD | The non-redirect fast path short-circuits before allocating a snapshot and MUST NOT consult a predicate; a recognized 3xx ALWAYS allocates the snapshot and consults the predicate, even with no usable Location | ✅ | Task 5 — the recognized-status check is `decide()`'s first statement, asserted by a predicate that records whether it was called; the "even with no usable Location" half asserted with a 301 carrying no Location at all |

## 10.6 Lifecycle, ordering, and immutability

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-22 | MUST | Deterministic response-body lifecycle: (a) the prior redirect response closed before issuing a follow-up; (b) if building the follow-up throws, the current response closed before the error propagates; (c) on any "return current" outcome the response is left OPEN for the caller | ✅ | Task 6 — (a) the two-hop conformance test counts exactly one release per superseded hop; (b) `decideOrClose` wraps the decision because `decide()` invokes caller predicate code, asserted with a throwing predicate *and* with the downgrade rejection, both leaving `cancelCount() === 1`; (c) asserted on not-a-redirect, loop-detected, hop-cap, and cancelled paths. The error from (b) is rethrown **unchanged** — redirect's spec states no conversion, unlike `RETRY-40`. **Review pass 1:** both (b) paths originally did a bare `await response.close()`, which `Response.close()` is documented to reject from — so a failing release replaced the very error that was supposed to propagate. They now go through `releaseQuietly`/`withReleaseFailure`, keeping the decision error primary with the release failure as `suppressed` (`RECOV-12`); asserted for `SchemeDowngradeError` and for a caller predicate's own error. Path (a) is deliberately NOT quieted: there is no primary error to preserve, and `PIPE-40` makes the release part of the contract |
| REDIR-24 | MUST | The redirect follower wraps the credential-attaching layer — redirect OUTER, auth INSIDE, per hop | ✅ | Structural — 4c's `STAGE_ORDER` places `REDIRECT` before `AUTH`, and `redirectStep` is pinned to the `REDIRECT` pillar (`PIPE-36`), so a caller cannot invert the two. The clause's *consequence* — `REDIR-7`'s unconditional strip plus `REDIR-11`'s suppression signal — ships here; the auth step that runs inside the loop is 5c |
| REDIR-25 | MUST | The asynchronous pipeline MUST NOT follow redirects: no async redirect step ships, no async preset installs one, so a 3xx surfaces to the async caller verbatim | ✅ (preserved) | Structural — this phase ships **one** adapter, not 5a's two. There is no async redirect step and nothing to install one. The asymmetry with the sync pipeline is preserved rather than changed, so no documentation of a deviation is owed |
| REDIR-26 | MUST | The allowed-method set stored as an immutable defensive copy, decoupled from the caller's collection | ✅ | Task 4 — `new Set(merged.allowedMethods)`, asserted by mutating the caller's set after construction. Deliberately a copy and not a frozen `Set`: `Object.freeze` is shallow and does not disarm `Set.prototype.add`, so a "frozen set" would be a guarantee the runtime cannot keep. The settings object itself IS frozen |

## 10.7 Observability

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| REDIR-28 | SHOULD | Each followed hop, loop detection, and scheme-downgrade event emitted as structured records, URLs through a redactor, redaction failures degraded to a placeholder; the malformed-Location event logs the raw string as the stated exception | ⏳ | **Phase 7b, Task 9.** 5b executes before 7b, so an `observability/logger.js` import here would not resolve — and 7b's own retrofit conformance test needs 5b's redirect step, so the dependency cannot run the other way. `redirect-step.ts` carries a TSDoc note at `redirectStep()` naming 7b's Task 9 as the owner. Same disposition, and the same cycle-breaking reason, as 5a's two `engine.ts` events |

## Cross-cutting invariants (`§19`) — what appendix B actually checks for redirect

Appendix B carries **no `REDIR-`-prefixed checkbox at all**. Redirect reaches its conformance checklist only
through the cross-cutting line at `appendix-b-conformance-test-checklist.md:81`, so these are the rows Phase 9
will look for.

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| XCUT-16 | MUST | No credential stamped over a non-HTTPS transport; the guard applies only on the credential-attaching path, and a deliberately credential-free re-issue — explicitly "a marker-suppressed cross-origin redirect" — MAY proceed over any scheme | ✅ (5b's half) | Structural. 5b never attaches a credential; it only strips (`REDIR-7`) and signals suppression (`REDIR-11`). The carve-out this requirement names is exactly what `cross-origin.ts`'s marker produces. The enforcing half is 5c's auth step |
| XCUT-17 | MUST | Redirect credential hygiene: (a) strip `Authorization` before every re-issue, even same-origin; (b) cross-origin — judged against the seed, not the previous hop — additionally strip `Cookie`/`Proxy-Authorization` and ensure the caller's credential is not re-applied to the foreign host; (c) drop userinfo in the Location; (d) reject an HTTPS→HTTP downgrade by default, opt-in only, logging the deviation | ✅ (a, c, d-rejection) / ✅ (b, stripping half) / ⏳ (b's re-application half, and d's logging) | (a) Task 5, asserted same-origin, cross-origin, on the 303 rebuild, and on a permitted downgrade; every value stripped regardless of header casing. (b) Task 5 strips both, seed-judged; "not re-applied to the foreign host" needs an auth layer to refrain, so it is 5c's to close via the marker 5b produces. (c) Task 5, asserted in `bun test` and on Node's own parser. (d) Task 5 rejects by default with `SchemeDowngradeError` and permits only via `allowSchemeDowngrade`; the logging half travels with `REDIR-28` to Phase 7b |
| XCUT-19 | MUST | Default-deny log redaction of userinfo/query/fragment/headers/credentials/bodies | N/A in 5b | Vacuous while 5b emits nothing. Becomes live with Phase 7b's Task 9, which routes every URL field through `redactUrl()` |
| XCUT-20 | MUST | Observability never throws into the request path | N/A in 5b | Same — no emission sites exist here yet. 7b's `emitQuietly()` owns it |

## Cross-phase obligations

| Obligation | Status | Where |
|---|---|---|
| `PIPE-40` — a wrapping step releases every superseded intermediate response and never closes the one it hands back; on an abandoned re-drive the in-flight response is returned unclosed | ✅ **Resolved here** | Task 6's two-hop `FakeTransport` conformance test: three wire sends, exactly one release per intermediate response observed through `countingResponse()`'s stream hook, and `cancelCount() === 0` on the final response. Deferred out of 4c and targeted at "the first redirect step" by the roadmap — that is this phase. The abandon clause is asserted on the paths that genuinely return — loop detected, hop cap, and cancellation — each with `cancelCount() === 0`. **Its fourth named path, non-replayable body, is NOT one of them, and that is deliberate:** `PIPE-40` lists it among the responses "returned unclosed" while `REDIR-22`(b) lists the same trigger among those "closed before the error propagates", and `REDIR-6` settles the control flow by requiring that path to *fail with an error* rather than return. 5b closes and throws; the contradiction is recorded in the design's Deviation Ledger and deferred to Phase 10, and `redirect-step.test.ts` asserts the close-then-throw behavior with the reasoning inline |
| `PIPE-15` — a step that re-drives the chain takes a FRESH continuation per drive | ✅ | Task 6 — every dispatch, including the first, goes through `ctx.fork()`; `ctx.next()` is never called, since its single-invocation guard would trip on hop two |
| `PIPE-36` — a shipped pillar family locks its stage assignment | ✅ | Task 6 — satisfied structurally, as 5a's `retryStep` was: a factory returning a descriptor with `stage: 'REDIRECT'` baked in. Nothing to subclass, nothing to relocate |
| `PIPE-3` — the inert extension slots around each pillar | ✅ (consumed) | Task 7 — `stripCrossOriginMarkerStep()` is the first real occupant of `POST_AUTH`, which 4c shipped inert. No change to 4c was needed |
| `StepContext.signal` (5a's Task 1 amendment) | ✅ (consumed) | Task 6 — checked once per iteration, in the `follow` branch, before closing the hop and re-driving. No cancellable *wait* is needed here (unlike retry, nothing sleeps between hops), so this is one cheap read rather than a timer race |
| `FakeTransport` (5a's `@internal` double) | ✅ (reused unchanged) | Tasks 6 and 7 — consumed exactly as the roadmap said 5b and 5c would, with no edits to `testing/fake-transport.ts` |
| Node-runtime conformance (`CLAUDE.md`'s membership rule) | ✅ | `test/node-conformance/redirect.test.mjs` — Location resolution is delegated wholesale to the platform's WHATWG `URL`, an independent implementation on each runtime, and `PIPE-40`'s close counting rides on Web Streams. Thirteen cases: relative resolution, dot segments, protocol-relative, `%2F`/`%26` preservation, bracketed IPv6 with an explicit port, userinfo clearing, case/default-port normalization (what makes `REDIR-16`'s loop detection hold, since `visited` keys on `href`), non-URL-as-relative-reference, the malformed-absolute throw, the unsupported-scheme gate, and the three lifecycle paths |
| Public barrel unchanged | ✅ | Task 8 — `git diff --exit-code` on `core.api.md` and `index.ts` is empty, and `src/redirect/` gets no `index.ts`. Same "not yet" disposition 5a's `retry/` shipped with: 5c's promotion task is the first point any pillar-authoring surface goes public |

## Deferred out of Phase 5b

| Item | Target | Reason |
|---|---|---|
| `REDIR-28` — the hop, loop-detected, downgrade, and malformed-Location log events | Phase 7b (Task 9) | Cycle-breaking: 5b cannot import `observability/` (it does not exist at this plan's execution time), and 7b needs 5b's redirect step for its own retrofit conformance test. `redirect-step.ts` names 7b's Task 9 as the owner in its TSDoc |
| `REDIR-15`'s "surface it observably" clause on a *permitted* downgrade | Phase 7b (Task 9) | Travels with `REDIR-28`. The opt-in flag and the credential-stripping half both ship here; only the warning-level emission is outstanding. Note this is one obligation, not two: setting a boolean in a config file a year ago is not surfacing anything about the request that actually took the downgrade |
| A reason discriminant on `Decision`'s `'return-current'` variant | Not scheduled | 7b's amendment already flags this: without it, logging cannot distinguish loop-detected from hop-cap-exceeded from normal termination, so those two of `REDIR-28`'s four events stay open even after Task 9. Reshaping `Decision` touches every assertion in `decide.test.ts`; it is a `SHOULD`, so it did not earn that churn inside this phase |
| `AUTH-29` / the marker's *consumption* side — skip-stamping on a cross-origin re-issue, and the auth step's first-stripper role | Phase 5c | 5b only **produces** the marker and **defends** it with an independent guard. Nothing yet reads it for its intended purpose. When 5c ships, `stripCrossOriginMarkerStep()` stays installed as a redundant, idempotent backstop |
| `PIPE-2`'s auth-re-runs-per-hop clause | Phase 5c | Needs an auth step to re-run |
| The standard-resilience preset and public-barrel promotion of `redirectStep`/`withRedirect` | Phase 5c | The preset needs all three pillars installed; publishing a pillar-authoring surface early would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes 5c may still reshape |
| The predicate-override scope judgment (`REDIR-20`) | Phase 9 conformance sweep, or sooner | A judgment call made without the user present. Narrow and mechanical to reverse if wrong: gate `decide()`'s step 3 onward behind the predicate's answer. Recorded in the design doc's Deviation Ledger |
