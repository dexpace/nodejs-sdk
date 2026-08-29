# Open Items

Running register of everything known to be unmet, unverified, misreported, or deliberately deferred across the
implemented portion of this project. Reviewed state: **scaffold milestone** (committed, `0ebdc79`),
**Phase 1 — Core HTTP Domain Model** (branch `2-phase-1-core-http-domain-model`, uncommitted at time of
review), **Phase 3a/3b**, **Phase 4a — Execution Context** (branch `7-phase-4a-execution-context`, three
review passes), **Phase 4b — Recovery-Chain Primitives** (branch
`8-phase-4b-recovery-chain-primitives`), and **Phase 5b — Redirect** (branch
`12-phase-5b-resilience-redirect`, three review passes). 4a and 4b are both merged into
`9-phase-4c-stage-based-pipeline`. Last reviewed **2026-08-27**.

**Two phases are shipped but were never registered here: 4c (stage-based pipeline) and 5a (retry).** Both are
merged and both have executed checklists, but neither ran the scan this file's maintenance rule asks for, so
their absence below means "not reviewed", not "nothing found". Section G was written without reviewing either,
and says nothing about them beyond what 5b's own work touched — the one 5a file 5b modified
(`retry/engine.ts`) is recorded at G9.

Sections A–E below were written against Phase 1 and are re-verified at each review; section F is Phase 4b's,
section G is Phase 5b's, section H is Phase 6a's, section I is Phase 6b's,
section J is Phase 6c's, and section K is Phase 7a's.

A requirement absent from this file is either satisfied or belongs to a phase that has not started. The point
of the file is that nothing is unmet *silently* — every gap below is either scheduled against a named phase or
awaiting a decision.

**Status vocabulary**

| Status | Meaning |
|---|---|
| **DECIDE** | Blocked on a human decision. Two or more defensible answers; picking one is the work. |
| **ACT** | Decision already made or obvious; the work is simply not done. |
| **SCHEDULED** | Deliberately deferred to a named phase. No action now; listed so it cannot be lost. |
| **WATCH** | Not a defect today. Becomes one when a stated trigger fires. |

---

## A. Requirements unmet or misreported

### A1 — HTTP-24: `charset` does not return null for an unknown encoding — **DECIDE**

`product-spec/04` §4.4 conformance text: "`charset=utf-8` → UTF-8; `charset=bogus` → **null**; no charset →
null." Actual behavior:

```ts
MediaType.parse('text/plain;charset=bogus').charset  // → 'bogus', not undefined
```

`packages/core/src/http/media-type.ts` returns the parameter verbatim. There is no registry of recognized
encodings to resolve against, so "unknown" is not a state the current design can detect — the reference
contract presumably assumed a `Charset` type whose lookup can fail.

The Phase 1 checklist marks HTTP-24 ✅ with no note, so the project currently *claims* conformance it does not
have. That is the actual defect; the behavior itself may well be the right call.

Two ways out, both acceptable, but one must be chosen:
1. Resolve against a known-encoding set (e.g. `TextDecoder` probing or an explicit allow-list) and return
   `undefined` for anything unrecognized.
2. Record a deliberate deviation in
   `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, on the grounds that the
   TypeScript port models charset as an opaque string and has no failing lookup to model "unknown" with.

Either way: correct the checklist row, and add a test pinning the chosen behavior. The getter's TSDoc already
documents the current behavior honestly.

### A2 — HTTP-22: the checklist describes an implementation that does not exist — **ACT**

Phase 1 checklist, HTTP-22 row: `✅ | Task 7, HeaderName.of()'s static cache`.

No such cache exists. The plan deliberately dropped interning (Task 7's `HeaderName` comment: "No interning:
HTTP-22 makes it a MAY, and an intern map keyed by caller-supplied names is exactly the unbounded,
process-lived, caller-influenced map XCUT-14's drain-to-cap rule forbids"), and
`packages/core/src/http/headers.ts` has no static map on `HeaderName`.

The decision is right and the requirement is a MAY, so nothing about the code needs to change. The checklist
row is simply false and should read ⏳/N/A with the XCUT-14 reasoning, not ✅.

### A3 — HTTP-11: `Response` exposes no range classification of its own — **DECIDE**

`product-spec/04` §4.3: "Status MUST classify by range … **and a response MUST expose these derived from its
status**." `Response` carries only `status`; callers reach classification one hop away via
`response.status.isSuccess`.

Defensible as satisfied — the classification *is* reachable and single-sourced on `Status`, and mirroring six
getters onto `Response` is pure surface duplication. But no one recorded that reading, so it is currently an
accident rather than a decision. Either add the delegating getters or write the interpretation into the
checklist row.

### A4 — SEAM-1 is enforced narrowly relative to its conformance text — **ACT**

`scripts/verify-seam-1.mjs` asserts `packages/core/package.json`'s `dependencies` is `{}`. The spec's
conformance clause is broader: "a dependency audit of the core module finds only the standard library plus the
compile-scope logging facade; **no transport/codec/stream symbol is referenced from core**."

Blind spots today: `peerDependencies`, `optionalDependencies`, and `bundleDependencies` are unchecked, and
nothing inspects what the source actually imports. Low risk while core imports nothing but `URL`, but the gate
reads as stronger than it is. Cheap hardening: assert the other three dependency keys are absent-or-empty, and
add an import scan over `packages/core/src` allowing only relative specifiers and `node:`-prefixed builtins.

---

### A5 — CTX-8: the duplicate-key error's *message* does not identify the key — **DECIDE**

Appendix C states CTX-8 more strictly than `product-spec/07` §7.3 does. §7.3 says the reject-on-duplicate
insert "fails all others with an error naming the key"; appendix C
(`appendix-c-consolidated-normative-requirement-index.md:176`) says "an error **whose message** identifies the
key."

`DuplicateContextKeyError`'s message is `` `context key already registered: ${String(key)}` ``. Call keys are
`Symbol()`s whose description is the flavor, not the identity, so every default-constructed context of a given
flavor renders identically:

```
context key already registered: Symbol(dispatch-context)
```

The message therefore names the *kind* of key, not *which* key. The error does carry the offending symbol as a
`readonly key: symbol` field — strictly more identifying than any string, and asserted in
`store.test.ts` — so the requirement's intent is met by the field while its letter is not met by the message.

Phase 4a's design already ledgers the `Symbol()` key choice with the cost "debuggability (opaque when logged or
printed)", but that row does not connect itself to CTX-8's message clause, so nothing currently records this as
a known partial deviation.

Two ways out, both defensible:
1. **Give default keys a distinguishing description** — `Symbol('dispatch-context#' + n)` from a module-scoped
   counter. The counter would label only the description; `Symbol()` remains the identity, so CTX-4/5/6's
   uniqueness is untouched and the ledger's rejection of a `traceId:spanId`+counter *string key* still stands.
   Costs a second module-level mutable binding (`docs/knowledge/variables-and-declarations.md:22`), on top of
   the `contextStore` singleton that already takes that deviation.
2. **Record a deliberate partial deviation** in the Phase 4a design's Deviation Ledger, on the grounds that a
   symbol has no unique rendering and the typed `.key` field identifies the key more precisely than a message
   can.

Either way the Phase 4 checklist's CTX-8 row should stop reading as an unqualified ✅.

### A6 — CTX-12 / XCUT-14: the drain **loop**'s shape is unverifiable, and untested — **WATCH**

`ContextStore.#drain` is a post-insert loop, as CTX-12 (SHOULD) and XCUT-14 (MUST) require. No test proves it
is a loop, and none can: `install` and `installIfAbsent` each set exactly one key before draining, so the map
is never more than one over the cap at drain entry and a second pass is unreachable. Replacing the loop body
with a single check-then-evict breaks nothing — confirmed by mutation testing across the module (that mutant is
the only meaningful survivor of 23).

The Phase 4a plan's Self-Review claims CTX-12 is covered by "a property-style burst test [that] asserts the
size never overshoots after any single insert". That test is real and passing, but it pins the **bound**, not
the drain's shape.

Not a defect today: the loop is present, the bound holds, and on a single-threaded runtime the two shapes are
behaviorally identical. `#drain` and the drain `describe` block both now carry a note saying so, so the loop is
not "simplified" away by a later reader.

**Trigger:** a runtime where inserts can stack more than one overshoot before a drain runs (worker threads, a
future concurrent store), or any change that lets the map exceed `cap + 1`. At that point the shape becomes
observable and owes a real test.

---

## B. Gates and tooling

### B1 — NFR-10 / NFR-17: CI never runs on the declared minimum runtime — **RESOLVED** (2026-08-26)

Closed by the `node-conformance` job in `.github/workflows/ci.yml`, which runs `test:node` against the built
artifact as a matrix over `['20.3.0', 'lts/*']` — the declared floor and current LTS. `test/node-conformance/`
holds 36 cases. Re-verified 2026-08-26. Original finding kept below for provenance.

#### Original finding — **ACT** (trigger has now fired)

The scaffold checklist deferred this explicitly: *"recommend adding an `actions/setup-node@v4` step pinned to
`18.17` running `scripts/verify-dual-consumption.mjs` once real Node-API usage lands (Phase 1 onward), rather
than adding it now for a function that touches no runtime API."*

**That trigger has fired.** Phase 1 uses the native `URL` class, `Object.freeze`, class `static {}` blocks, and
`#private` fields — all real runtime surface. `verify:runtime-floor` checks that `engines.node` and the
compiled language level *agree*, but nothing ever executes the artifact on Node 18.17; CI runs whatever the
GitHub Actions runner defaults to. The half of NFR-10 that catches "we shipped syntax the declared floor cannot
run" is still missing.

### B2 — NFR-13: SPDX headers missing on scaffold-era files — **ACT**

Phase 1 established the convention ("every new source file opens with `// SPDX-License-Identifier: MIT` on line
1") and every file under `packages/core/src/http/` complies. Three files predating it do not:

- ~~`scripts/verify-runtime-floor.mjs`~~ — fixed
- ~~`scripts/verify-seam-1.mjs`~~ — fixed
- `eslint.config.js` — **still missing** (re-verified 2026-08-26; line 1 is
  `import {createRequire} from 'node:module';`)

`scripts/verify-dual-consumption.mjs` gained one during Phase 1, which is what makes the omission of its two
siblings look accidental rather than scoped. NFR-13 is a review convention, not a mechanical gate, so this is a
one-line cleanup on the one file left. Phase 9's `NFR-13` sweep owns it if it is not done sooner.

### B3 — NFR-12: reproducible builds asserted, never proven — **CLOSED 2026-08-29**

Was: `bun install --frozen-lockfile` plus plain `tsc` are deterministic by construction, but nothing
demonstrates it.

Now proven, and kept proven. Two clean builds of an identical tree (every `dist/` and `*.tsbuildinfo` swept
between them) emit **644 byte-identical files**, and `npm pack` of `@dexpace/core` twice yields an identical
tarball digest. `bun run verify:reproducible-build` (`scripts/verify-reproducible-build.mjs`) is now a
blocking CI step and a `ci-preflight` step, so the assertion cannot silently rot back into a claim. It was
negative-tested by injecting a `Date.now()` into `packages/core/scripts/gen-version.mjs` — the one build-time
codegen step — and confirming the gate fails naming the offending file.

The "becomes real at first publish" framing was wrong in one respect worth recording: this needed *code*, not
a *publish*. It was verifiable from Phase 1 onward and stayed open two phases longer than it had to.

### B4 — NFR-14: `expect-type` breaks the single-source-of-versions convention — **WATCH**

Every other devDependency is centralized at the workspace root; Phase 1 added `expect-type` to
`packages/core/package.json`'s own `devDependencies` (re-verified 2026-08-26 — still there, and Phase 4b added
three more call sites, so the convention is now load-bearing in four files rather than two). Harmless with one package — it is exactly the restatement
NFR-14 warns about once a second package exists (Phase 8). Either hoist it to the root now or fold it into the
NFR-14 decision at Phase 8.

---

## C. Documentation defects

### C1 — Phase 1's scope statement contradicts its own plan — **ACT**

`docs/superpowers/specs/2026-07-23-phase1-core-http-domain-model-design.md` says the scope is "Full
`product-spec/04-core-http-domain-model.md` (HTTP-3 through HTTP-53, both MUST and SHOULD level) in one phase."

The plan's own Self-Review then amends that: *"The Phase 1 spec's scope statement should be read — and amended
— as HTTP-3..35, 46..50, 53"*, with the body-lifecycle cluster deferred to Phase 3b. The amendment was never
applied to the design doc, so read literally the two documents disagree about what Phase 1 owed. Correct the
design doc's scope line to match the plan.

### C2 — The structural-typing bypass deviation is not yet recorded — **SCHEDULED** (Phase 10)

The Phase 1 design doc acknowledges that `#private` fields close the *accidental* structural-typing bypass but
not deliberate reflection abuse (`Object.create(Request.prototype)`), and states this is "to be listed in
`sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` when that phase is reached." Listed
here so the promise survives until then.

### C3 — The Phase 4 checklist under-reports Phase 4a — **ACT**

`docs/superpowers/plans/2026-07-26-phase4-execution-context-and-pipelines-checklist.md` still carries its
banner: "the plans are reviewed and corrected as of 2026-07-26 but **not yet executed**. Every ✅ means 'the
plan builds and tests it,' not 'it is on `main`.'" Phase 4a's rows are now built, tested, and committed on
`7-phase-4a-execution-context`, so the banner understates them while 4b and 4c remain unbuilt.

The same checklist maps only `CTX-*`. It has no `XCUT-14` row, even though
`docs/superpowers/specs/2026-07-28-phase9-cross-cutting-conformance-design.md:66` names "4a's context registry"
as an XCUT-14 site and appendix B's only conformance row that `ContextStore` satisfies is B.8's
"Caller/server-keyed maps bounded with drain-to-cap loop (XCUT-14)" — appendix B has no CTX section at all. The
ID is now cited in `store.ts` and `store.test.ts`; the checklist is the remaining gap.

Split the banner per sub-phase, and add an `XCUT-14` row pointing at 4a Task 4 (qualified by A6 above).

---

## D. Scheduled deferrals

No action now. Each is already owned by a named phase; this table exists so none can quietly lapse.

| Item | Requirement | Owner phase | Note |
|---|---|---|---|
| ~~Body lifecycle: write/replayability, single-use, close, charset~~ | HTTP-36 – HTTP-43 | 3b | **Done** — `packages/core/src/body/`, merged 2026-08-26 |
| ~~Lazy `TypedResponse<T>` with parse-once memoization~~ | HTTP-44, HTTP-45 | 3b | **Done** — `body/typed-response.ts` |
| ~~`MultipartBody`~~ | HTTP-51 | 3b | **Done** — `body/multipart-body.ts`. Its non-appearance clause stays partial; see the roadmap's Phase-3-owned residuals |
| ~~1 MiB error-body buffering cap~~ | HTTP-52 | 3b | **Done** — `body/http-status-error.ts`; `RECOV-16` reuses it unchanged |
| `Request.equals` compares body by reference, not by value | HTTP-46 (body clause) | 3b | Blocked on a real `Body` model supplying value equality |
| `RequestConditions.applyTo` cannot emit an obs-text ETag | HTTP-18 vs HTTP-48/50 | 10 | Spec text in scope does not resolve the tension; strict outbound path kept rather than guessed. Documented in `applyTo`'s TSDoc |
| Seam contracts (byte-stream, transport, codec, projection) | SEAM-2 – SEAM-30 | 2–8 | |
| Adapter packages, peer-dependency dedup | NFR-2 | 8 | |
| Shrink-survival regression guard | NFR-9 | 9 | |
| Concurrency-model agnosticism check | NFR-11 | 4c | Retargeted from "Phase 4" by the 4a design: everything in 4a is synchronous, 4b's surface is `Promise`-only, and 4c's stage pipeline is where async-facing surface appears. 4c's plan claims closure; re-verify when 4c executes |
| `CTX-17`'s positive half — the first store entry installed by the first promotion | CTX-17 | 4c | 4a satisfies only the negative half (constructing a head context must not auto-register it), which holds structurally because `context.ts` never imports `store.ts`. Wiring the store into the promotions would invert the layering and make every promotion a global side effect |
| Real W3C Trace Context generation behind `InstrumentationBundle` | CTX-14, CTX-15 | 7 | 4a ships the bundle's frozen shape and the no-op default only. `activeSpan`/`tracerFactory` stay typed `unknown`, and `activeSpan` is `undefined` rather than a no-op span object, until a tracing adapter defines `Span` |
| `contextsEqual()`, value equality over `ExecutionContext` | CTX-5 (equality framing) | none | Built only if 4b or 4c needs one. `CTX-5`'s operative half — pinning an explicit shared key — ships via `ContextInit.key` |
| `FakeTransport` test double | — | 4c | 4a never touches `Transport`; `PIPE-9`'s empty-pipeline dispatch is the likely first real consumer |
| Self-identifying version metadata (real `User-Agent`) | NFR-15 | 7/8 | |
| Publish + provenance CI job | NFR-16 | release | `prepublishOnly` wired; nothing published yet. **Sharpened 2026-08-29:** there is no release workflow at all and `--provenance` appears in no manifest, workflow, or `.npmrc`. §10's ledger claimed the flag "is scripted"; it never was. Authoring the workflow is actionable **now** — only running it against a real registry is blocked |
| `await using` support on `Page`, `fetchTransport()`, `undiciTransport()` | — | when `engines.node` reaches `>=20.4` | These three declared `[Symbol.asyncDispose]` as a plain class member; on the `>=20.3` floor the computed key is `undefined`, so the method bound to the string key `"undefined"` — junk on the prototype, no disposal, and a `.d.ts` promising `AsyncDisposable` regardless. Fixed 2026-08-29 to `SseStream`'s guarded install, which costs the type-level `await using` affordance (`close()` is unaffected). Raising the floor to `>=20.4` restores the declaration honestly and lets all four sites drop the guard. See §10 ledger item 11 |
| NFR-8 re-confirmed as a documented non-applicability | NFR-8 | 10 | No reflection-driven discovery surface exists by design |
| Redirect structured logging — hop, rejection, and permitted-downgrade events | REDIR-28, REDIR-15 (surfacing clause), XCUT-17(d) | 7b | Task 9. 5b executes before 7b and 7b needs 5b's step, so the import cannot run either way until then. See G2 |
| Redirect's loop-detected and malformed-Location events | REDIR-28 | none | Blocked behind a reason discriminant on `decide()`'s `'return-current'` variant, which no phase owns. See G3 |
| The cross-origin marker's *consumption* side — skip-stamping on a cross-origin re-issue | REDIR-11(b/c), XCUT-17(b), AUTH-29 | 5c | 5b produces the marker and defends it with an independent `POST_AUTH` guard; nothing yet reads it. See G7 |
| Auth re-runs per redirect hop | PIPE-2 | 5c | Needs an auth step to re-run |
| Public-barrel promotion of `redirectStep`/`withRedirect` and the step-authoring surface | — | 5c | Same "not yet" 5a's `retry/` shipped with. Publishing a pillar-authoring surface early would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes 5c may still reshape |
| Erratum for the `PIPE-40` / `REDIR-22` contradiction | PIPE-40 vs REDIR-22 | 10 | Behavior is chosen and tested; one of the two spec sentences still needs correcting. See G1 |
| Re-confirm the redirect predicate's scope over the safety mechanics | REDIR-20 | 9 | See G4 |

---

## E. Process

### E1 — Phase 1 has no commits — **DECIDE**

`git log main..HEAD` shows only the scaffold commit. The Phase 1 plan specifies a commit after each of its 15
tasks (`feat(core): add Status value type (HTTP-10/11/12)`, and so on); all ~40 files currently sit in the
index and working tree as one undifferentiated change.

Not a correctness problem — every gate passes. But the per-task history the plan describes cannot be
reconstructed after the fact, and a single 3,300-line commit is materially harder to review or bisect. Decide
whether to reconstruct the task-by-task sequence before merging or to accept one squashed commit and note the
departure.

---

## F. Phase 4b — Recovery-Chain Primitives

Three review passes ran over this phase; everything they found is either fixed in the branch or listed here.
Nothing below blocks the phase — the `RECOV-1`–`RECOV-16` mapping is satisfied and every CI step is green.

### F1 — `ResponseRecoveryChain.apply()` still trusts its *seed* outcome — **WATCH**

`RECOV-8` is absolute: "the response recovery chain's apply operation MUST NOT throw under any input." Pass 2
found and closed the reachable half — a *step* returning a non-outcome used to raise
`TypeError: undefined is not an object` out of `apply()`, because `toFailureClosingSuccess` read `.kind` outside
its `try`. That function is now total, and three regression tests pin it.

What is not guarded is the seed: `apply(garbage)` with at least one response step installed throws on the
`current.kind !== 'success'` read at the loop head. Left alone deliberately — `current` is only ever the
caller's argument at that point, and the sole caller is `dispatchWithRecovery`, which constructs it with
`success()` or `wrapCancellation()`. Guarding it needs either a cast plus an optional chain (which
`no-unnecessary-condition` rejects on a typed value) or the postcondition assertions F3 defers.

**Trigger:** `recovery/` gaining a public export, or any JavaScript caller reaching `apply()` directly. Either
makes the seed a third-party value and this a real defect.

### F2 — A step returning a non-outcome poisons the fold silently when nothing downstream reads it — **WATCH**

The mirror of F1 on the value side. A response step returning `undefined` yields `success(undefined)`; if no
later step touches it, `apply()` resolves with a malformed Success and `dispatchWithRecovery` hands `undefined`
back as the response. Nothing throws, so `RECOV-8` holds — the failure surfaces layers away, in the caller.

This is the concrete cost named in the roadmap's finding F2 (assertion density), and it is why that finding is
recorded as a Deviation Ledger row rather than as "no assertions needed." **Trigger:** the same as F1, or
Phase 5's retry step being the first real third-party-shaped consumer.

### F3 — Zero `invariant()` assertions across `recovery/` — **SCHEDULED** (Phase 10)

`docs/knowledge/assertions.md:6-7` sets a 2-per-function module average; this phase ships none across roughly a
dozen functions. Project-wide inconsistency rather than 4b's — Phases 1/2/3b/4a ship zero, 4c's plan ships
fifteen — so adding them to 4b alone would deepen the split. Recorded in the phase design's Deviation Ledger.

One constraint Phase 10 must carry into the decision: **at the fold sites, `invariant()` is the wrong tool.**
An `invariant()` inside `apply()` throws, and `RECOV-8` forbids `apply()` from throwing. The correct shape
there is to convert a broken postcondition into a Failure, which is what the F1 fix already does.

### F4 — The chains are classes where `data-modeling.md:10` asks for free functions — **SCHEDULED** (Phase 10)

`RequestRecoveryChain` / `ResponseRecoveryChain` own no lifecycle and hold no mutable state, so the corpus
would have them be plain data plus free functions. Kept as classes because `RECOV-14`'s text is written about
the chain and step *instances*, and because the defensive copy wants a construction boundary. Ledgered in the
phase design.

### F5 — `#private` fields carry no per-use justification — **SCHEDULED** (Phase 10)

`data-modeling.md:20-23` makes `private` the default and requires a comment justifying each `#private` as a
genuine runtime-privacy requirement. No such claim is made for either chain class — unlike 3b's `Response`,
whose `#closed` must survive `Object.freeze(this)`. `#private` is the package-wide style (Phases 1, 3b, 4a), so
this is one project-wide reconciliation, not a 4b edit.

### F6 — `RECOV-11` is a no-op in this port — **SCHEDULED** (Phase 10, ledgered)

`wrapCancellation(error)` is `failure(error)`. The reference re-asserts a clearable `Thread.interrupt()` flag;
`AbortSignal.aborted` is durable once fired and the SDK never holds the caller's `AbortController`, so there is
nothing to re-assert. The helper exists as the one named site where the disposition lives. If Phase 5's retry
step lands without giving it behavior, inline it there and carry the disposition wholly in the ledger.

### F7 — `suppress()`'s branch selection is only ever half-covered on any single runtime — **WATCH**

`suppress()` returns the native `SuppressedError` where the runtime has one and `FallbackSuppressedError` where
it does not. No test forces the other branch by deleting the global — that cannot survive parallel execution
(`docs/knowledge/testing.md:50`). Coverage comes from the `test:node` matrix instead: `lts/*` exercises the
native branch, the pinned `20.3.0` exercises the fallback. **Trigger:** if the matrix ever collapses to one
runtime, or the floor rises past Node 24 (where the fallback becomes dead code to be deleted, not guarded).

### F8 — 4b did not depend on 4a — **RESOLVED** (2026-08-26)

The issue lists Phases 0–4a as 4b's dependency and 4b's design says "4a (execution context, done)". Neither
was true on the `8-phase-4b-recovery-chain-primitives` branch, where `packages/core/src/context/` did not
exist: 4b turned out not to depend on it — its only imports outside `recovery/` are `http/`,
`body/http-status-error.js`, `seams/transport.js`, `invariant.js` and `suppress.js`. The design's
parenthetical is corrected. The sequencing half is now closed too: 4a and 4b are both merged into
`9-phase-4c-stage-based-pipeline`, so `context/` is present ahead of 4c, which does depend on it.

### F9 — The Phase 4 checklist's ✅ marks for 4a and 4c are still plan-level — **WATCH**

`plans/2026-07-26-phase4-execution-context-and-pipelines-checklist.md` now says so explicitly in its Status
line, but the §7.x and §8.1 tables read identically to the §8.2 ones that are now real. Re-scan both when their
phases execute, per this file's own maintenance rule.

---

---

## G. Phase 5b — Redirect

Three review passes ran over this phase. Everything they found is either fixed in the branch or listed here.
Nothing below blocks the phase — `REDIR-1`–`REDIR-27` are satisfied, `PIPE-40` is closed, and every CI step is
green. `REDIR-28` is the one requirement in the chapter that ships unimplemented, and it is scheduled.

### G1 — `PIPE-40` and `REDIR-22` contradict each other on the non-replayable-body path — **SCHEDULED** (Phase 10)

Two `MUST`s naming the same trigger and prescribing opposite dispositions.

`product-spec/08-execution-pipelines.md:20` (`PIPE-40`): "on paths that abandon a re-drive (redirect cycle,
**non-replayable body**, budget exhausted) the in-flight response MUST be returned unclosed."

`product-spec/10-redirect-handling.md` (`REDIR-22`): "if building the follow-up throws (**non-replayable
body**, downgrade rejection) the current response MUST be closed before the error propagates."

5b implements `REDIR-22` — closes, then throws — on three grounds: `REDIR-6` independently fixes the control
flow ("the operation MUST fail with a clear error naming replayability"), so the path throws and a response
never *returned* cannot be "returned unclosed"; specific governs general, since `§10` owns the redirect step's
lifecycle; and closing is the safer reading, because the alternative leaks a body on an error path with no
caller holding a reference to close it. `PIPE-40`'s other two named paths do genuinely return, and both return
unclosed as it requires.

Not a code decision left open — the behavior is chosen, tested, and reasoned. What is open is that **one of the
two spec sentences needs an erratum**, which is Phase 10's to write. Recorded in the 5b design's Deviation
Ledger and asserted with the reasoning inline in `redirect-step.test.ts`.

### G2 — `REDIR-28` and `REDIR-15`'s observability clause ship unimplemented — **SCHEDULED** (Phase 7b, Task 9)

`REDIR-28` (SHOULD): hop, loop-detected, scheme-downgrade, and malformed-Location events as structured
records, URLs through a redactor. `REDIR-15` (MUST) carries a separate, easily-conflated obligation on the
*permitted* downgrade path — the `allowSchemeDowngrade` flag is the opt-in, and "MUST surface it observably" is
a second requirement on top of it. `XCUT-17`(d) restates the same pairing.

None of it is implemented. 5b executes before 7b, so an `observability/logger.js` import here would not
resolve, and 7b needs 5b's redirect step for its own retrofit conformance test — the dependency cannot run the
other way. `redirectStep()`'s TSDoc names 7b's Task 9 as the owner. Same disposition, and the same
cycle-breaking reason, as 5a's two `engine.ts` events.

**Note the MUST/SHOULD split when this is closed:** `REDIR-28` is a SHOULD, but `REDIR-15`'s surfacing clause
is part of a MUST. 7b's Task 9 closes both in one edit, so the distinction only matters if that task slips.

### G3 — `Decision` carries no reason on `'return-current'`, so two of `REDIR-28`'s four events stay blocked — **DECIDE**

`decide()`'s `'return-current'` variant is a bare `{kind}`. Nothing distinguishes loop-detected from
hop-cap-exceeded from normal termination from malformed-Location, so even after G2 lands, the hop, rejection,
and permitted-downgrade events can ship while **loop-detected and malformed-Location cannot**. `REDIR-28`'s
carve-out — that the malformed-Location event logs the raw Location string, since it failed to parse and
cannot be redacted — travels with that deferral.

Reshaping `Decision` touches every assertion in `decide.test.ts`, which is why it was not done inside the 7b
retrofit's scope. It is a `SHOULD`, so nothing is violated by leaving it — but it is not owned by any phase
today, which is why this is DECIDE rather than SCHEDULED. Either schedule it (7b or 9) or accept the two
events as permanently unshipped and record that in `sdk-design-nodejs/10`.

### G4 — `REDIR-20`'s "fully override" is read as scoped to code/method eligibility only — **DECIDE**

The spec says a configured predicate "MUST fully override the built-in decision". 5b reads that as scoped to
the *code/method eligibility* question, not as license to bypass the safety mechanics that follow it —
userinfo stripping, credential hygiene, the downgrade guard, body replayability, and loop/cap detection — on
the grounds that those are stated as unconditional `MUST`s elsewhere in the same chapter and are not "should
this kind of redirect be followed" policy. A caller predicate opting to follow a 307 with a single-use body
still cannot make that body re-sendable.

Defensible, and a test pins it. But it is a judgment call on genuinely ambiguous wording, made without the user
present. If wrong, the fix is narrow and mechanical: gate `decide()`'s step 3 onward behind the predicate's
answer. Flagged for re-confirmation at Phase 9's conformance sweep, or sooner.

### G5 — The marker-stripping guard is not the last step before `SEND` — **WATCH**

`REDIR-11`(c) requires the internal cross-origin marker be removed before dispatch. `stripCrossOriginMarkerStep()`
occupies `POST_AUTH`, but `STAGE_ORDER` runs six more stages after it — `PRE_LOGGING`, `LOGGING`,
`POST_LOGGING`, `PRE_SERDE`, `SERDE`, `POST_SERDE` — before `SEND`. A step installed in any of them runs
*closer to the wire than the guard* and could put the marker back.

Not a defect today: no step exists in any of those stages, so the guard is effectively last. It is also not a
plausible accident — nothing would write that header by name.

**Trigger:** a step installed after `POST_AUTH` that copies or synthesizes request headers wholesale rather
than setting named ones. 7b's `loggingStep` and 6a's serde step are the first two occupants of those stages;
neither should touch it, but neither has been read yet.

### G6 — Loop detection keys on `href`, so a fragment-only difference is a distinct URI — **WATCH**

`REDIR-16` says "recording every visited absolute URI". `visited` stores `URL.href`, which includes the
fragment — so `https://h/a` → `https://h/a#x` → `https://h/a#y` is three distinct entries, not a loop.

Correct by the letter (a fragment is part of the URI) and harmless in practice, because `REDIR-17`'s hop cap
bounds the chain regardless — the default budget of 3 stops it. Worth recording only because the reasoning is
non-obvious and the alternative (stripping the fragment before the visited check) would be a silent behavior
change if someone "fixed" it later.

Verified in the same pass that the *dangerous* normalizations do collapse: `HTTPS://EXAMPLE.COM/a` and
`https://example.com:443/a` both normalize to a href already in the set, so case and default-port variation
cannot be used to spin past the cap. Both are pinned by tests, in `bun test` and on Node's own URL parser.

### G7 — `XCUT-17`(b)'s "not re-applied to the foreign host" half needs an auth layer — **SCHEDULED** (Phase 5c)

`XCUT-17`(b) has two halves: strip `Cookie`/`Proxy-Authorization` on a cross-origin hop, **and** "ensure the
caller's credential is not re-applied to the foreign host". 5b ships the first and the *mechanism* for the
second — `REDIR-11`'s marker, plus an independent guard so it never reaches the wire — but nothing yet reads
the marker for its intended purpose. `AUTH-29`'s consumption side and `PIPE-2`'s auth-re-runs-per-hop clause
are the same deferral. Appendix B reaches redirect only through the `XCUT-17` line at
`appendix-b-conformance-test-checklist.md:81`, so this is the row Phase 9 will actually check.

### G8 — The 5b design doc's process note claims it is uncommitted — **ACT**

`docs/superpowers/specs/2026-07-26-phase5b-redirect-design.md:23` ends: "Not committed — left for the user to
review and commit if it holds up." It was committed in `c6603aa` ("Planning (#26)") and has since been amended
twice. The sentence is stale and should be dropped or rewritten; the rest of the process note (that the design
was authored autonomously and every judgment call is re-listed in the Deviation Ledger for challenge) is still
accurate and worth keeping. Left as-is rather than rewritten unilaterally, because it is the author's own
process note about their own delegation.

### G9 — `retry/engine.ts` was edited by a phase that does not own it — **WATCH**

5b's review pass 1 found both of its close-before-throw paths replacing the error they were meant to
propagate, because `Response.close()` rethrows whatever cancelling the body raised. The fix needed
`releaseQuietly`/`withReleaseFailure`, which existed as module-private helpers inside 5a's `retry/engine.ts`.
Rather than ship a second copy of a helper whose identity guard is load-bearing, they were extracted to
`packages/core/src/recovery/release.ts` and both call sites now import them.

The move is behavior-neutral — the diff is one import added and the two functions removed verbatim, and 5a's
suite passes untouched — and the new module has its own tests at 100% coverage. Recorded because a file
belonging to a merged phase changed outside that phase's plan, which is exactly the kind of edit a later
conformance sweep should be able to find an explanation for.

**Trigger:** none expected. Re-verify at Phase 9 that 5a's checklist rows for `RECOV-12`/`RETRY-22` still point
at code that exists where they say it does.

---

### G10 — Phase 5c publishes `Step`, the context family, and a PROVISIONAL `InstrumentationBundle` — **ACCEPTED RISK**

5c's plan (Task 16 Step 5) lists exactly which symbols the public barrel gains. Two symbol groups had to be
promoted that the list does not name, because promoting `StepContext` and `StepDescriptor` forces them:

- **`Step`** — `StepDescriptor.fn` is typed `Step`, so the type is reachable from a promoted signature.
- **`ExecutionContext`, `DispatchContext`, `RequestContext`, `ExchangeContext`, `InstrumentationBundle`** —
  `StepContext.context` is typed `ExecutionContext`, which is a union ALIAS; api-extractor refuses to analyze
  a re-exported union whose members are unexported, and a caller writing a custom step cannot type
  `ctx.context` without them.

**Narrowing `StepContext.context` was considered and rejected.** Cutting it down to `{readonly kind}` would
avoid publishing `InstrumentationBundle` — but `CTX-1` exists precisely so a step can read the exchange's
request and response, and every future logging and serde step needs that. Losing real capability to avoid
publishing a provisional type is the wrong trade.

**The accepted risk is `InstrumentationBundle.activeSpan` and `.tracerFactory`.** Both are typed `unknown`
pending Phase 7a's tracing adapter. They are now documented as provisional *in the emitted `.d.ts`*, on the
interface and on each member, so a consumer reading either is warned in the same place they read the type. A
consumer warned in the declaration is the honest version of this tradeoff; publishing the type silently was
not.

**Trigger:** Phase 7a. When the tracing adapter lands and those two members get concrete types, that is a
narrowing of what a caller receives and a widening of what they may pass — a `major` for anyone who read
either field. 7a owns that decision and the changeset wording for it. Phase 10 should confirm the promotion
as a whole was intended.

### G11 — `DigestChallengeUnsupportedError` was speculative — **CLOSED: cut in Phase 5c**

The design doc flagged this leaf as speculative and told the plan to cut it if no consumer materialized. None
did: `composingHandler()` returns `undefined` for an unsatisfiable challenge and `authStep()` leaves the 401
unchanged either way, so nothing in `packages/core` ever constructed or caught it. Its stated reason to exist
— "for a caller driving `digestHandler()` directly" — was self-refuting, because `digestHandler` is internal
and absent from the barrel, so no caller could drive it directly.

**Cut during Phase 5c's own shape review**, before it ever shipped: the class, its tests, its barrel export,
and the reference in `composing-handler.ts`'s doc comment are all gone. Removing an exported error class is a
breaking change, so doing it now cost nothing and doing it after release would have cost a `major`. If Phase
9's conformance sweep turns up a genuine need, adding it back is a `minor`.

### G12 — `AUTH-37`'s failed-background-refresh logging is swallowed silently — **DEFERRED to Phase 7b**

`AUTH-37` makes a failed background refresh non-fatal *and* expects it recorded. `bearer-cache.ts` swallows
the rejection explicitly and UNCONDITIONALLY — a bare `void` would leave an unhandled rejection that
terminates the process under Node's default policy, and the narrowed `catch` that briefly re-threw
`InvariantViolation` did exactly that, asynchronously and unattributable to any request, for a fault in
caller-supplied `TokenProvider` code. (That narrowing is gone; this entry described it for one revision
longer than the code did.) The log half has nowhere to go: no `Logger` seam exists until Phase 7b.

**Trigger:** Phase 7b, alongside the `loggingStep()` install into `standardResilience()`'s empty `LOGGING`
slot and redirect's own three deferred emission sites.

---

### G13 — two pre-existing cleanups Phase 5c's Reader pass found and deliberately did not take — **DEFERRED**

Both predate 5c, sit in files Passes 1 and 2 declared settled, and were left alone rather than widening a
review pass into a refactor of earlier phases.

1. **`hasForbiddenOutboundByte` breaks its own family's naming.** `packages/core/src/http/ascii-validation.ts`
   exports `hasForbiddenNameByte`, `hasForbiddenInboundValueByte`, and `hasForbiddenOutboundByte` — the
   outbound *value* predicate is the only one that omits `Value`. At `digest.ts:213` and `digest.ts:408` a
   reader cannot tell from the call whether the name rule or the value rule is being applied, and the two
   differ (HTAB is excepted by one and not the other). `hasForbiddenOutboundValueByte` restores the symmetry;
   nine call sites outside the module.
2. **`PipelineBuilder`'s duplicated bucket lookup.** `insertAfter`, `insertBefore`, and `replace` each repeat
   the same three lines — `const bucket = this.#buckets.get(anchor.stage);` plus an `invariant` whose message
   is identical in all three. One `#requireBucket(stage)` collapses them.

**Trigger:** whichever phase next edits `ascii-validation.ts` (1) or `pipeline/builder.ts` (2).

---

## Section H — Phase 6a (Serde)

Recorded at implementation time, before the three review passes. Everything here is either a deliberate
deviation from the phase plan, a requirement clause satisfied by delegation rather than by code, or work the
phase surfaced and deliberately left out of scope.

### H1 — `@dexpace/codec-json` buffers the whole decoded body before parsing — **ACCEPTED DEVIATION**

`SERDE-27` requires a response-decoding handler to stream the body through the deserializer "without first
materializing the whole body as a string/byte array". `decodeResponse` itself honors that — it hands the live
`ReadableStream` to `Deserializer.deserializeFrom` and never buffers. `@dexpace/codec-json` cannot: `JSON.parse`
has no incremental form, so `deserializeFrom` accumulates the decoded text of the entire body before parsing it.
A codec with a streaming parser satisfies `SERDE-27` fully behind the same interface, so this is a property of
this format, not of the seam.

No byte cap is imposed on the accumulator, deliberately: truncating a legitimate large payload is a worse
failure than the memory it would save, and a caller who needs a bound imposes it on the transport, where the
whole response is bounded at once.

**Trigger:** none. Recorded so Phase 9's sweep does not read the handler's compliance as end-to-end compliance.

### H2 — `SERDE-23` (ignore unknown fields) is satisfied by delegation, not enforcement — **ACCEPTED DEVIATION**

Whether an extra wire key is stripped or rejected is a property of the caller's schema (Zod's `.parse()` strips,
`.strict()` rejects). Core cannot override it without defeating the point of caller-supplied schemas. The
requirement's *intent* holds — the default path every mainstream schema library takes is the permissive one —
but nothing in this repository enforces it. Documented as a recommendation in `jsonSerde`'s TSDoc.

**Trigger:** none.

### H3 — no serde-specific error base class — **ACCEPTED DEVIATION**

`SEAM-23`/`SERDE-9`/`SERDE-10` describe write- and read-path failures as subtypes "of a common serde exception
root". This port ships two flat leaves under `DexpaceError` plus an exported `isSerdeError` guard, because the
checkpoint's §5.2 two-level cap is why Phase 3b retrofitted `IoError`'s tier away and a `SerdeError` base would
be the third instance of the banned shape. `DexpaceError` is the common root; `isSerdeError` is the
catch-one-category mechanism. The intent holds, the structure does not.

How a caller reaches response context, since there is no base class to hang it on: direction is narrowed
first. `isSerdeError(e)` groups the two leaves for a catch-one-category `catch`; `e instanceof
DeserializationError` then reaches `status`/`etag`/`location`, which live on the **read leaf only**. An earlier
implementation declared those three on both leaves so that reading `e.status` straight off the union would
compile — that put three permanently-empty fields on a published class, and a public constructor that accepted
a `status` it could never mean anything by, in exchange for saving callers one `instanceof` they were going to
write anyway. Corrected in review: `SerdeErrorOptions` now carries only `cause`, and
`DeserializationErrorOptions extends SerdeErrorOptions` adds the response context.

**Trigger:** none.

### H4 — plan deviations taken during implementation — **RECORDED**

Six places where the shipped code departs from `plans/2026-07-28-phase6a-serde.md` as written:

1. **`packages/codec-json` declares `engines.node: ">=20.3"`, not the plan's `">=18.17"`.** The plan also told
   Task 8 to copy `target`/`lib` verbatim from core (ES2023) and to stop if the two disagreed. They did:
   `scripts/verify-runtime-floor.mjs` pairs `es2023` with `>=20.3`, and a package peer-depending on
   `@dexpace/core` cannot honestly declare a floor below core's own. Raised to match.
2. **`decodeResponse`'s `closingAfter` is built on Phase 4b's `releaseQuietly`/`withReleaseFailure`, not on a
   fresh `SuppressedError` construction.** The plan's blocking notice resolved to the guarded `suppress()`
   helper; 4b already wraps that helper in a pair that also carries the identity guard `Response.close()`'s
   memoized rejection needs. Reusing it keeps one suppression mechanism across retry, redirect, auth, and serde.
3. **The codec's `SERDE-12` test asserts with a plain sentinel `Error`, not `IoError`.** The plan's Task 10 test
   imports `IoError` from `@dexpace/core`; that class is deliberately package-private (Phase 3b froze `io/` as
   unexported), so the import does not resolve. A sentinel proves the stronger property anyway: the codec
   re-wraps *nothing* coming off the stream.
4. **No workspace-root `tsconfig.json` solution file was created.** The plan's Task 8 said to add a project
   reference to it; this repo has never had one — `typecheck` and `build` name each package's tsconfig
   directly, and those two root scripts were extended instead. `packages/codec-json/tsconfig.json` still
   carries the `references: [{"path": "../core"}]` entry, which is what lets it typecheck against core's
   *source* before core's `dist/` exists.
5. **`MISSING` is module-private, not a package export, and is a plain `Symbol`.** An earlier implementation
   put it on `@dexpace/codec-json`'s barrel. The plan's Task 12 "Produces" block names only `tristate` and
   `tristateObject`, and its own test declares the sentinel locally — so the promotion was drift, not a
   decision. No caller has to construct one: `tristate()` also accepts plain `undefined` for Absent, and
   `tristateObject` feeds the sentinel itself. `Symbol.for` was likewise dropped for a plain `Symbol`, because
   unlike `TRISTATE_BRAND` nothing crosses a package boundary on this identity, so the cross-realm registry
   bought nothing. Corrected in review.
6. **`SERDE-30` ships as the `tristateToString()` free function, not as a `toString()` on the sentinels.** The
   design's Requirement Coverage row says "`Absent`/`Null` sentinels carry a stable `toString()`"; the
   implementation exports a free function over the whole union instead. `SERDE-30` is a MAY and is satisfied
   either way — this is a design-table mismatch, not a requirement gap. Deliberately **not** changed in review:
   giving `absent()` and `nullValue()` a `toString` that `present()`'s result did not have would make the
   discriminated union structurally inconsistent, and a free function is what the
   discriminated-union-over-classes pattern asks for.

**Trigger:** none — these are settled. Listed so a Phase 9 sweep reading the plan against the code does not
read them as drift.

### H5 — `NFR-8`/`NFR-9` shrinker keep-configuration — **DEFERRED to Phase 9**

`NFR-8` names "the runtime-wired SPI seams … (serde)" and "the Tristate type" among the surfaces a shipped
keep-configuration must cover. Both are created in this phase, and neither is keep-configured here: the
keep-config and its shrink-and-run guard are one workspace-wide deliverable, and
`plans/2026-07-28-phase9-cross-cutting-conformance.md` ships `@dexpace/shrink-test` with `@dexpace/codec-json`
and `jsonSerde` already listed in `participatingPackages`. 6a's only obligation is that both surfaces stay
reachable through the public barrels, which `index.public.test.ts` and `cross-package.test.ts` prove.

**Trigger:** Phase 9.

### H6 — assertion density — **DEFERRED to Phase 10, project-wide**

This phase ships one `invariant()` call across roughly fifteen functions, against
`docs/knowledge/assertions.md:6-7`'s 2-per-function module average. Phase 4b raised the identical gap and
resolved it to a ledger row rather than fixing 4b alone, on the grounds that the split is project-wide
(Phases 1/2/3b/4a ship zero, 4c ships fifteen) and half-migrating it is what
`docs/knowledge/styleguide-overview.md:32-33` forbids. 6a follows 4b, deliberately.

**Trigger:** Phase 10, which settles the density rule once.

### H7 — coverage now excludes `**/dist/**` — **RECORDED**

`bunfig.toml` gained `coveragePathIgnorePatterns = ["**/dist/**"]`. From this phase on, `@dexpace/codec-json`'s
tests reach core through its public entry point, which Bun resolves to `packages/core/dist/index.js` — so
without the exclusion the suite instruments core twice and the reported figure halves without a line of real
coverage changing. The 80% floor is a statement about `packages/*/src`, and now says so.

**`bun test` is build-dependent from this phase on**, which is the same fact seen from the other side. Bun
resolves `@dexpace/core` through the workspace symlink and that package's `exports` map, i.e. to
`packages/core/dist/index.js` — verified: `import.meta.resolve('@dexpace/core')` returns exactly that. So on a
fresh clone `bun test` cannot resolve core for the codec's six test files until `bun run build` has run, and
against a **stale** `dist/` the codec suite reports green over yesterday's core. CI is safe (its Build step
precedes its Test step); local runs are not. The root `test` script was deliberately **not** changed to build
first — that would slow the inner loop and change a documented command's meaning — so `CLAUDE.md`'s Commands
section now marks `bun test` build-dependent instead.

**Trigger:** none.

### H8 — `SERDE-12`'s discrimination: one bug fixed, one residual limit — **PARTLY RESOLVED / OPEN**

*Rewritten after the Phase 6a adversarial review (G1/G2). The previous text asserted "`decodeResponse`
implements `SERDE-12` correctly" and framed the whole gap as nominal-vs-structural. That was wrong on the
behaviour, and the correction is larger than the original entry.*

**What was actually broken.** The guard read `e instanceof IoError || e instanceof DeserializationError`.
`packages/core/src/io/errors.ts` is a **flat** tree — `EndOfStreamError`, `SourceContractViolationError`,
`ClosedResourceError` and `AllocationLimitError` all extend `DexpaceError` *directly*, not `IoError` — so the
guard whitelisted one of five I/O classes and re-stamped the other four, plus every foreign stream error, as
`DeserializationError`. Reproduced against the built artifacts on both Bun and Node:

| body stream errored with | caller received (before) | `isSerdeError(e)` |
|---|---|---|
| `IoError` | `IoError`, identity preserved | `false` ✅ |
| `EndOfStreamError` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |
| `ClosedResourceError` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |
| `AllocationLimitError` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |
| `SourceContractViolationError` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |
| plain `Error('ECONNRESET')` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |
| `TypeError('terminated')` (undici) | `DeserializationError` | **`true`** ❌ |
| `DOMException` `'AbortError'` | `SuppressedError{.error: DeserializationError}` | `false` ❌ |

The `SuppressedError` rows are a second-order effect worth recording: `Response.close()` cancels the body, and
`cancel()` on an *already-errored* stream replays that stream's stored error. `withReleaseFailure`'s identity
guard normally collapses that — but once the primary had been replaced by a fresh `DeserializationError` the
two objects differed, so the pair was suppressed together and a `SuppressedError` became the top-level
throwable. The abort case is the sharp one: a caller writing `if (e.name === 'AbortError')` saw
`'SuppressedError'`.

**Fixed.** The guard is now a single `e instanceof DexpaceError` pass-through: anything already in this SDK's
typed tree is never re-typed. That subsumes all five I/O leaves, `DeserializationError`, and `HttpStatusError`
in one check, and it collapses the `SuppressedError` rows too, because the primary is once again the same
object `cancel()` replays. One test per leaf, plus an `HttpStatusError` case, in
`packages/core/src/serde/response-handlers.test.ts`.

**The residual, which is irreducible here.** A *foreign* stream error — a `fetch`/undici body's
`TypeError('terminated')`, a hand-built `ReadableStream` errored with a bare `Error`, an aborted body's
`DOMException` — is still wrapped as `DeserializationError`. Core hands the live stream to the codec and never
reads it, so at the point of the catch a transport's raw error and a non-conforming codec leaking one are the
same shape, and `SERDE-27` requires the codec case be surfaced as a serde exception. Removing the wrap would
breach `SERDE-27`; keeping it mis-types foreign transport errors. Resolving it needs the transport to **tag**
its stream errors (a wrapping `TransformStream` at the transport seam), which is new machinery and was out of
scope for a review pass. Documented on `decodeResponse`'s TSDoc naming the affected transports, and pinned by
a test that asserts the limitation rather than the ideal — so when tagging lands, that test is the one that
changes.

**Two open promotion questions, both deliberately not taken here.**

1. `IoError`/`isIoError` are still not on `@dexpace/core`'s public barrel, so the nominal discriminator a
   caller would `instanceof` does not exist. The original entry's reasoning stands: the 6a design's "Public
   Barrel" section does not list them, and promoting them reopens a Phase 3b decision.
2. `SuppressedError`/`SuppressedErrorLike` are likewise unexported, and one can still reach a caller (a decode
   failure whose release *also* fails — the 304 case has a passing test). Both handlers' `@throws` now
   document the shape: `name` is `'SuppressedError'`, `.error` is primary, `.suppressed` rides along, and
   `instanceof SuppressedError` is **not** a valid test because the class is absent on the declared
   `engines.node >=20.3` floor. Exporting a *type* for it is the narrowest possible fix.

**Trigger:** Phase 9 or Phase 10, whichever next audits the public barrel, for both promotion questions. The
foreign-stream-error residual triggers on the phase that builds the transport adapter, which is the only layer
that can tag a stream error at its source.

### H9 — every decode target is treated as non-null — **OPEN**

`SERDE-13` says a wire `null` decoded into a **non-null** target must fail. An implementation sees a schema
*value*, which carries no nullability it could read, so `@dexpace/codec-json`'s `decodeText` rejects a
top-level wire `null` unconditionally, before the schema runs — and the `Deserializer` TSDoc raises that to a
contract obligation on every implementor, since no implementor can do better.

Two consequences, named so a later phase does not rediscover them as bugs:

1. A `200` whose entire body is the literal `null` does not decode. A legitimately nullable top-level target is
   outside this contract.
2. `tristate(inner)` cannot serve as a **top-level** decode target for the explicit-null case `SERDE-16`
   describes. It works exactly as documented as a *field* combinator inside `tristateObject`, which is the
   documented use and what every test exercises.

The check is deliberate and should not be casually relaxed: moving it after the schema would let a permissive
schema such as `{parse: (i) => i}` return the wire `null` as a non-null `T`, which is precisely the heap
pollution `SERDE-5` and `SERDE-13` exist to prevent. Both consequences are now stated on `Deserializer`'s and
`jsonSerde`'s TSDoc. Raised in the Phase 6a shape review as F3.

**Trigger:** the first phase that needs a nullable top-level decode target. Deliberately **no** opt-in flag was
invented here — new public surface needs design sign-off, not a review pass. The open question is whether
`DecodeTarget` should carry an explicit "this target admits null" opt-in.

### H10 — one concept, two spellings across the seam and the handler layer — **OPEN**

`Deserializer.deserialize(data, schema, typeName?)` takes the schema and its diagnostic label positionally;
`decodeResponse`/`decodeSuccessResponse` bundle the identical pair as `DecodeTarget<T>`. Both ship public in
this phase, in the same api-extractor report.

The positional form is what the plan's Task 2 Interfaces block specifies and it is defensible on its own terms
— three parameters, inside `max-params`, and an SPI a third-party codec *implements*, where a positional shape
is the smaller burden. The object form exists because positionally the handlers would be four parameters, which
is a lint error. So each layer's choice is locally right and the pair is globally inconsistent: a codec author
implements one spelling, a caller uses the other. `docs/knowledge/api-design.md:14` ("optional parameters
collected into a single options object rather than a positional list past two parameters") points at the object
form for both.

Not reshaped here: `Deserializer` is a seam this phase is publishing, and reshaping a seam without design
sign-off is out of scope for a review pass. The rationale is now stated on `Deserializer`'s TSDoc so the
inconsistency is deliberate and legible rather than accidental. Raised in the Phase 6a shape review as F5.

**Trigger:** the phase that next reshapes this seam. Unifying on `DecodeTarget<T>` would be a breaking change
to a published SPI, so it happens then or not at all.

### H11 — `tristate()`/`tristateObject()` are format-agnostic but ship in a format-specific package — **OPEN**

`packages/codec-json/src/tristate-schema.ts` imports nothing but `@dexpace/core` and operates on already-parsed
JavaScript values. Nothing in it is JSON-specific: the same combinators would work unchanged behind a CBOR or
msgpack codec, because "a missing key surfaces as `undefined` on the parsed object" is true of every one of
them.

The tension runs both ways and neither direction is free:

- **Against the current home:** when a second codec lands, it either duplicates this module or takes a
  dependency on `@dexpace/codec-json` — and adapter-to-adapter dependencies are exactly what
  `sdk-design-nodejs/02` §2's peer rule exists to prevent. Moving a public export between published packages
  later is a breaking change for both.
- **Against moving it to core:** the 6a design's Scope section says "Not in scope: a schema library", and
  `tristate()`/`tristateObject()` *are* schema constructors. Core defines `Schema<T>` as a witness the caller
  supplies and deliberately owns no surface for building one. Moving them in contradicts that boundary.

No code was moved. Recorded so the second codec's phase makes this deliberately rather than discovering it
mid-implementation. Raised in the Phase 6a shape review as F11.

**Trigger:** the first phase to ship a second wire codec.

### H12 — `seams/index.ts` is an unimported internal barrel — **OPEN**

`docs/knowledge/module-organization.md:18` bans internal folder-level barrels outright ("never create internal
barrels; import the specific file directly"), and `api-design.md:6` makes `index.ts` the package's *sole*
barrel. `packages/core/src/seams/index.ts` is one, from Phase 2, and 6a grew it by three re-exports
(`Deserializer`, `Schema`, `Serializer`).

Nothing imports it. Its only reference anywhere in the workspace is the comment in `packages/core/src/index.ts`
explaining why the public barrel deliberately does **not** re-export it.

The three additions were kept rather than reverted: leaving that file re-exporting `Serde` but not the three
interfaces that are the same seam would be a worse state than either extreme. `packages/core/src/serde/` — this
phase's own new folder — correctly has **no** barrel, which the plan's Global Constraints required and which
holds.

**Trigger:** any phase touching `packages/core/src/seams/`. The fix is to delete the file outright, not to
maintain it; out of scope for a review pass because it is Phase 2 surface.

### H13 — `test:scripts` runs in no CI job — **OPEN**

`scripts/*.test.mjs` runs only under `bun run test:scripts`, and `.github/workflows/ci.yml` has no step that
invokes it. As of 6b that glob covers `scripts/knowledge.test.mjs`, `scripts/verify-seam-1.test.mjs`, and
`scripts/verify-sse-37.test.mjs`.

The script was named `test:knowledge` until the Phase 6a reader pass renamed it: the glob had outgrown the
name the moment `verify-seam-1.test.mjs` landed, and both places that cite it had to explain the mismatch in
prose.

Low actual risk today: `verify-seam-1.test.mjs` tests the `verify:seam-1` **gate**, and that gate is itself a
blocking CI step, so the invariant is protected even though the test of it is not run. What is unprotected is
the gate's own logic silently degrading — a bad glob, a swallowed assertion — which is precisely what that test
file now exists to catch, by spawning the real script against fixture trees rather than restating its
assertions.

Not fixed here: `.github/workflows/ci.yml` was out of scope for this pass. Raised in the Phase 6a shape review
as F9.

**Trigger:** immediate — add a `bun run test:scripts` step to the `ci` job. One line.

### H14 — `decodeSuccessResponse`'s 4xx/5xx branch is unprotected against a teardown failure — **OPEN**

Raised by the Phase 6a adversarial review as G5; not fixed there, because the single-source fix is in Phase 3b
surface and this phase has no mandate over it.

`decodeSuccessResponse` routes its 2xx and "other status" branches through `closingAfter`, whose docblock
explains at length why a bare `finally { await response.close() }` inverts the error that matters. Its
**4xx/5xx branch bypasses that**, delegating to `toHttpError`
(`packages/core/src/body/http-status-error.ts:106-110`), which *is* a bare `finally { await response.close() }`
with no `withReleaseFailure` identity guard.

`Response.close()` memoizes its release promise, so a close that already failed hands the same rejection back.
That rejection then replaces the primary inside `toHttpError`'s `finally`. Reproduced:

```
first close failed as designed: CLOSE FAILED (memoized from an earlier close)
decodeSuccessResponse threw:    Error "CLOSE FAILED (memoized from an earlier close)"
is it the HttpStatusError the docs promise for a 5xx?  false
```

**Precondition, stated honestly:** the reachable trigger today is a response whose `close()` was *already
attempted and failed* before being handed to `decodeSuccessResponse`. For a plain `ReadableStream` the read
error and the cancel error coincide (cancel on an errored stream replays the stored error), so the two are
indistinguishable and the read error survives — verified. What is unconditionally true is that one of three
branches of the same function has no protection against a hazard the other two document at length.

**Consequence:** `@throws HttpStatusError on 4xx/5xx` is violated, and the caller loses the status, the
buffered error body, and `preview()`. The error is unrecoverable at the call site — `HttpStatusError` is
constructed *after* the `finally` that throws, so it never exists.

**Fix site:** `toHttpError`, switched to `releaseQuietly`/`withReleaseFailure` like every other subsystem.
Fixing it there covers every caller at once; patching only `decodeSuccessResponse` would leave `toHttpError`'s
other callers exposed.

**Trigger:** raised separately by the coordinator. Not scheduled here.

### H15 — no `AbortSignal` on any long-running async API in this phase — **OPEN**

Raised by the Phase 6a adversarial review as G10. Ledgered rather than fixed: adding `{signal}` to four public
APIs is a design decision, not a review-pass edit, and some of the sites would breach `max-params`.

`docs/knowledge/concurrency-and-async.md:18` ("every long-running async API must accept an options object with
`{ signal }`"), `:20` (accepting must be paired with honoring), and `:44` (a signal must reach the actual I/O
primitive) all apply. Four sites accept none: `Serializer.serializeTo`, `Deserializer.deserializeFrom`
(`packages/core/src/seams/serde.ts`), `decodeResponse` and `decodeSuccessResponse`
(`packages/core/src/serde/response-handlers.ts`).

What is true in mitigation, verified rather than assumed: **abort IS honored transitively.** A transport that
errors the body stream on abort makes `reader.read()` reject and the read loop exits promptly —
`deserializeFrom` surfaces the `DOMException` cleanly. What is *not* interruptible is the CPU-bound
`JSON.parse` / `schema.parse` span after the drain completes, which no signal could cancel anyway without a
streaming parser (see H1).

The project-wide position appears to be "cancellation rides the transport": `toHttpError` and
`Response.bytes()` take no signal either. So this is a consistency question about the whole SDK, not a 6a
defect — but it has never been written down, which is why it is here.

**Trigger:** the phase that next reshapes this seam, which is the only cheap moment to add a parameter to a
published SPI. The decision is to add `{signal}` across all four sites, or to state "cancellation rides the
transport" as an explicit project-wide position and cite it from each site's TSDoc.

### H17 — `SERDE-20`'s array-element half is the platform's, not this codec's — **RECORDED**

Found by the Phase 6a reader pass, by mutation: deleting `tristateReplacer`'s `!Array.isArray(this)` conjunct
left all 100 codec-json tests green, and `tristate-replacer.ts` reports 100% line coverage either way.

The branch was dead. `JSON.stringify`'s own `SerializeJSONArray` step appends the literal `null` for any array
element whose replacer returned `undefined` — so an Absent in an array position degrades to a wire `null`
without a line of code here. The conjunct, the `this: unknown` parameter it needed, and the two comments
narrating the mechanism were removed; one why-comment now records where the behaviour actually comes from, and
the array-position tests were kept as characterization of the platform behaviour the requirement rides on.

Consequence for the published surface: `tristateReplacer`'s signature lost its `this` parameter, so
`etc/codec-json.api.md` was regenerated. A caller's `JSON.stringify(v, tristateReplacer)` is unaffected —
`JSON.stringify` passed `this` and the function simply no longer reads it.

**Trigger:** none. Recorded so a later phase does not "restore" the branch on the reasonable-looking grounds
that SERDE-20 names two positions and only one has code.

### H16 — deep-nesting encode diverges between Bun and Node — **RECORDED, no gate**

A ~20k-deep object encodes successfully under Bun (whose `JSON.stringify` is iterative) and raises a
stack-overflow `RangeError` under Node, which `encodeToText` correctly wraps as `SerializationError`. **Both
outcomes are correct** — one succeeds, the other reports an unencodable value through the stable serde type —
so no `test/node-conformance/` case was added: a test asserting "either encodes or throws `SerializationError`"
asserts nothing a reader can act on. Recorded only so a future reader who trips over the difference does not
file it as a bug.

**Trigger:** none.

---

### H18 — every type-aware command now builds core first — **RECORDED**

`packages/codec-json` imports `@dexpace/core` by package name, so `tsc` resolves it through core's
`package.json` `types` field to `packages/core/dist/index.d.ts`. That file does not exist on a fresh clone, and
TypeScript's project-reference source redirect does not help: module resolution fails before the redirect is
ever consulted. CI runs `typecheck` before `build`, so the first CI run of this branch failed with 30
`TS2307: Cannot find module '@dexpace/core'` errors across all nine codec-json files.

The fix is a `build:core` script (`tsc -b packages/core/tsconfig.build.json`, incremental) that `typecheck`,
`lint`, `fix`, and `build` each run first. `packages/codec-json/tsconfig.json`'s `references` entry was removed
at the same time: with `dist/` guaranteed present, the package now typechecks against the **published**
declarations rather than being redirected back to core's source, so a symbol that `stripInternal` removes
cannot typecheck green here and fail at build.

Verified by deleting every `dist/` and `.tsbuildinfo` and running both CI jobs in their exact order.

**Trigger:** none. Recorded because the failure mode is invisible on a developer machine that has ever run
`bun run build`, and the obvious "simplification" — dropping the `build:core` prefix — reintroduces it.

---

### H19 — `fast-uri` pinned by a root `overrides` entry; two dev-only advisories left open — **PARTLY RESOLVED**

`bun run audit` (`--audit-level=high --prod`) failed in CI on `GHSA-7p8r-x3mc-p8w7`: `fast-uri <3.1.5`
mistakes a backslash for an authority introducer, so a crafted URI resolves to an unintended host. It reaches
this tree only through dev tooling — `eslint -> @eslint/eslintrc -> ajv -> fast-uri`, and
`@microsoft/api-extractor`.

**Why the branch surfaced it and `main` does not.** The package is in `main`'s lockfile too, so the exposure
predates this work. What changed is the *path*: Phase 6a gives `packages/codec-json` its own
`devDependencies`, and the pinned CI Bun (`.bun-version` 1.3.14) does not apply `--prod` to a **workspace
member's** dev dependencies the way it does to the root's. Local Bun 1.4.0 reports "checked 0 packages" for
the same command. So the gate's behaviour depends on the Bun version, and the version that is pinned is the
stricter one.

Fixed by a root `overrides: {"fast-uri": "^3.1.5"}`, which resolves to 3.1.6 — a patch release inside the
range every consumer of it already accepts. Pinned rather than suppressed: there was nothing to weigh.

**Still open, deliberately:** `bun audit --audit-level=high` (without `--prod`) reports two more high
advisories, both dev-only and both present on `main` — `js-yaml` via `@changesets/cli`
(GHSA-5p4m-2wfm-xmqj) and `tmp` via `gts -> inquirer -> external-editor` (GHSA-ph9p-34f9-6g65). Neither fails
the gate today, because both reach the tree only through **root** dev dependencies, which 1.3.14 does filter.
They are left alone as out of scope for a serde phase — but the filtering asymmetry above is what stands
between them and a red CI run, so they should be pinned the same way rather than waited on.

**Trigger:** the next phase that touches root tooling, or the first CI run that reports either of them.

---

## Section I — Phase 6b (Server-Sent Events)

### I1 — `SSE-41` reactive adapter deferred to Phase 8b (`@dexpace/rx`) — **SCHEDULED** (Phase 8b)

`SSE-41` (MAY) describes a backpressure-honoring `Observable` view over an SSE stream. Phase 6b ships the
pull-based `AsyncGenerator` surface `SSE-39` mandates; the reactive view is a bridge package, and the roadmap
scopes `§18`'s async-runtime adapters to Phase 8b specifically (`@dexpace/rx`).

### I2 — Hand-rolled `SseLineReader` vs `BufferedSource.readUtf8Line()` — **RECORDED**

`BufferedSource.readUtf8Line()` (`IO-14`) treats `\n` and `\r\n` as terminators but keeps a lone `\r` as line
content. `SSE-2` requires the opposite: a lone `\r` terminates an SSE line by itself. Both contracts are
normative for their respective subsystems, so SSE frames its own lines in `src/sse/line-reader.ts` rather than
reshaping a frozen Phase 3a surface. Recorded so Phase 10's deviation review does not read the duplication as
accidental.

### I3 — `[Symbol.asyncDispose]` runtime-guarded and omitted from `.d.ts` — **WATCH**

Node 20.3 (the pinned floor verified by `verify:runtime-floor` and CI `node-conformance`) predates
`Symbol.asyncDispose` (which landed in Node 20.4). TypeScript does not polyfill the well-known symbol for a
library that declares the member, so declaring it on the interface would cause `.d.ts` compilation failures for
consumers on standard `ES2023` lib without `esnext.disposable`. `SseStream` therefore installs
`[Symbol.asyncDispose]` at run time only when the symbol exists, matching `Response` (HTTP-38). Becomes an
unconditional `implements AsyncDisposable` when `engines.node` moves past Node 20.4.

### I4 — `SSE-21` hash equality is N/A in JavaScript — **RECORDED**

`SSE-21` mentions value equality and hash. JavaScript does not have language-level hash maps keyed by object
value equality (`hashCode`); value equality is provided via `sseEventsEqual()` (`SSE-21`).

---

## Section J — Phase 6c (Pagination)

Recorded at implementation and review time. Everything here is either an intentional design clarification, a requirement clause satisfied with documented deviation/erratum, or an accepted runtime consideration.

### J1 — `PAGE-11` close-before-yield precedence over §7.1 illustrative snippet — **RESOLVED WITH ERRATUM**

`sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.1 shows an illustrative generator snippet with `try { yield* page.items } finally { await page.close() }`.
`PAGE-11` (MUST) mandates closing *before* yielding any items on the page (`const items = page.items; await page.close(); yield* items;`). Materialized items survive close (`PAGE-2`), so closing before yielding releases the underlying response immediately and ensures an abandoned item iteration cannot strand an open response connection.
An erratum callout was added to `07-pagination-sse-and-serialization.md` §7.1 and documented in the Deferred Items Log.

**Trigger:** none.

### J2 — `PAGE-5` / `PAGE-29` asynchronous `PaginationStrategy.parse` signature — **RESOLVED WITH SPEC CLARIFICATION**

`PAGE-5` describes `parse` as reading what it needs "synchronously inside parse". In Node.js / Web Standards HTTP domain models, response bodies arrive as asynchronous streams (`ReadableStream<Uint8Array>`), making synchronous stream consumption impossible without prior full buffering.
`PaginationStrategy.parse` returns `Promise<PageInfo<T>>`, fulfilling all intended semantics of `PAGE-5` and `PAGE-29` (isolated, non-mutating parse) while maintaining compatibility with async body decoders.

**Trigger:** none.

### J3 — `Page<T>` implements `AsyncDisposable` with `Symbol.asyncDispose` — **RESOLVED**

`Page<T>` implements `AsyncDisposable` unconditionally (`[Symbol.asyncDispose](): Promise<void>`), delegating to `close()`. Consumers utilizing Explicit Resource Management (`await using`) against `Page` must include `"ESNext.Disposable"` in their compiler `lib`.

**Trigger:** none.

### J4 — WHATWG encode-set boundary & verbatim query splice (PAGE-21, PAGE-22) — **RESOLVED BY DESIGN**

`URLSearchParams` re-serializes full query strings, reorders parameters, and encodes space as `+` rather than RFC 3986 `%20`. `query-splice.ts` implements hand-rolled tokenization operating directly on the raw query substring, preserving untargeted parameters byte-for-byte.

**Trigger:** none.

### J5 — Transport-direct pagination without internal resilience loop — **RESOLVED BY DESIGN**

`Paginator` operates directly over `Transport` and `Request`. Resilience (retry, redirect, auth) is composed externally at the pipeline / `Runtime` layer (`PIPE-9`), keeping the pagination engine modular and transport-agnostic (§12).

**Trigger:** none.

### J6 — `items()` vs `pages()` single-use asymmetry (PAGE-8, PAGE-14) — **RESOLVED BY DESIGN**

`Paginator.items()` allows multiple independent iterations because each iteration starts a fresh walk and closes each page before yielding. `Paginator.pages()` is single-use because yielded `Page` objects hold live connection ownership, where re-iteration would cause double-consumption of unclosed resources.

**Trigger:** none.

### J7 — Iterative generator drive without trampoline (PAGE-31) — **RESOLVED BY DESIGN**

`PAGE-31` sanctions native loop models without recursion. `Paginator.#walk` and `driveFetchers` are implemented as `async function*` generator loops, guaranteeing constant stack space across thousands of pages without explicit trampoline structures.

**Trigger:** none.

### J8 — Error unwrapping and root cause propagation (PAGE-28) — **RESOLVED BY DESIGN**

`PaginationError` is reserved strictly for engine misuse and precondition violations (`maxPages <= 0`, single-use iterator re-use). Transport, parse, and network failures propagate unwrapped with original causes preserved.

**Trigger:** none.

---

## Section K — Phase 7a (Configuration & Platform Primitives)

### K1 — `clientIdentityStep` is not reachable from the public barrel — **SCHEDULED** (Phase 5c)

`RECOV-33`'s step is implemented and tested (`config/client-identity-step.ts`), but it is **not** exported
from `packages/core/src/index.ts`. It returns a `StepDescriptor`, and the whole of `pipeline/` —
`StepDescriptor`, `Stage`, `Step`, `StepContext` — is `@internal` and absent from the barrel;
api-extractor rejects a `@public` export whose return type is a forgotten export. The phase design assumed
5c had already promoted the pipeline authoring surface, which has not run. Promoting it is a decision about
4c/5c's surface, not 7a's, so it was left alone rather than widened here. **Trigger:** when the phase that
publishes `StepDescriptor` lands, add `clientIdentityStep`/`ClientIdentitySettings` to the barrel, retag both
`@public`, and regenerate the API report. Until then `NFR-15`'s stamping step is in-package only.

### K2 — Proxy resolution implements the property tier the design doc ledgered as collapsed — **RESOLVED** (2026-08-27)

`docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md` ledgers "system-property layer collapses
into environment-only (proxy and general config alike)" and its plan's Task 7 sketch dropped `CFG-24`'s
property tier and all of `CFG-26` accordingly. The shipped `resolveProxyOptions` implements both, against the
substitutable property seam `Configuration` already carries for `CFG-3`/`CFG-4`. Rationale: the collapse is a
statement about *production wiring* (Node has no ambient property store, so `defaultConfiguration()`'s
property seam is empty and real behavior is environment-only, exactly as ledgered), not about the seam; and
without the tier, `CFG-24`'s same-layer-port and https-only-credentials clauses and every clause of `CFG-26`
would have been silent gaps, with `getRawProperty` left without a single consumer in the repository. The
deviation ledger's wording is now narrowed to say the *production sources* collapse, not the resolution logic:
`docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md`'s ledger row and its §"Proxy model" prose
were both corrected on 2026-08-27. The correction was made here rather than deferred to Phase 10 because that
ledger is Phase 10's *input* — handing the reconciliation sweep a row that misstates the as-built code inverts
the dependency — and because the file is this phase's own design doc, which this phase may edit.

### K3 — `CFG-12` is documented, not enforced — **WATCH**

"Builders SHOULD be usable single-threaded only" is a JVM statement about publication safety. A
`ConfigurationBuilder` has no cross-thread reachability in this runtime to guard, so the requirement is
carried as a doc comment on the class and nothing more. There is no test, because there is no observable
behavior to assert. **Trigger:** if a worker-thread story ever puts a builder behind `postMessage`.

### K4 — `CFG-28`'s global-configuration convenience resolver is not built — **DECIDE**

`CFG-28` is a MAY with two halves. The prohibition half ("nothing may read proxy configuration implicitly at
startup") holds and is asserted. The optional half — a `resolveProxyOptions()` overload defaulting to
`getGlobalConfiguration()` — is deliberately not built: no caller exists, and a zero-argument overload that
silently reaches for process-wide state is the kind of convenience that is easier to add later than to
retract. **Trigger:** the first transport that wants proxy support without threading a `Configuration`.

### K5 — `CFG-35`'s throwable axis is not in this phase — **SCHEDULED** (Phase 5a)

`config/retryable.ts` ships the status axis (408/429/5xx-less-501-and-505) as the single shared definition.
`CFG-35`'s second clause — "a throwable is retryable iff it or any cause in its chain is an IO/timeout error,
cycle-safe" — needs the error taxonomy's retryability capability and belongs with 5a's `classify.ts`, which
re-exports this module rather than defining a second status set. The checklist marks the requirement split,
not whole.

### K6 — Six defects in the phase plan's own implementation sketches — **WATCH**

The plan doc at `docs/superpowers/plans/2026-07-28-phase7a-configuration.md` still contains the sketches
below. They were corrected in the shipped code; the plan was not rewritten, so a future reader following it
verbatim would reintroduce them. The plan now opens with a banner saying so and pointing here and at the
checklist as the as-built record, which is the mitigation — the six sketches are deliberately left in place
rather than rewritten, because a completed phase's plan is a historical artifact, not a maintained document.
**Trigger:** if this plan is ever used as an execution input again.

1. **Task 5's hash-consistency test asserts a false claim.** `deepEqual([1, {x: 2}, [3, 4]], [1, {x: 2}, [3,
   4]])` is asserted `true`, but `CFG-33` makes non-arrays fall back to ordinary equality, so two distinct
   object literals are not equal and the sketched test fails against a correct implementation.
2. **Task 7's `CFG-22` test tests nothing.** It builds an object literal whose `toString` returns a
   hard-coded masked string and asserts that string is masked. `ProxyOptions` in the same sketch has no
   `toString` at all, despite the design doc's interface declaring one.
3. **Task 6's `getInt` uses `Number.parseInt`**, which resolves `"12abc"` to `12` — `CFG-5` says an
   unparseable value returns the default.
4. **Task 2's parser uses `Date.UTC(year, ...)`**, which maps a four-digit year below 100 onto 1900-1999, so
   `0026` silently parses as 1926; and it range-checks fields individually without rejecting a rolled-over
   calendar date such as `31 Feb`.
5. **Task 7 omits `CFG-26` entirely** — no backslash escape, no property/environment precedence, and a
   trim-then-filter order that is the reverse of the one the requirement specifies.
6. **Task 8 Step 6 rewrites `build` to `tsc -b`**, which would replace the working
   `tsc -p tsconfig.build.json`. Only the `prebuild` line was added.

### K7 — `eslint.config.js`'s Node-globals block was widened — **WATCH**

`packages/core/scripts/gen-version.mjs` is the first build script living under a package rather than at the
repo root, and the config's globals block listed `scripts/*.mjs` only, so its `console` call tripped
`no-undef`. `packages/*/scripts/*.mjs` was added to the same list. **Trigger:** if package-level scripts ever
need a different tier than the root ones.

### K8 — `src/generated/version.ts` is committed and can be stale — **WATCH**

The generated version constant is committed deliberately, so an unbuilt `bun test` reports a real version
rather than a placeholder. That makes it possible for the file to disagree with `package.json` between a
version bump and the next build. `prebuild` regenerates it on both the package and root `build` scripts, and
release goes through `prepublishOnly`'s build, so a published artifact cannot carry a stale value — but a
working tree can, and nothing fails if the regenerated file is left uncommitted. **Trigger:** if CI ever
needs to assert the committed file matches `package.json`, add a `git diff --exit-code` after `prebuild`.

### K9 — `Configuration.default()` ships as a free `defaultConfiguration()` — **RESOLVED** (2026-08-27)

The design doc names the production wiring `Configuration.default()`. `Configuration` is an `interface` in
this port, which cannot carry a static, so it ships as the free function `defaultConfiguration()` — the same
placement the plan's Task 6 note offers as its alternative. Recorded so the design doc's name is not read as
a missing export.

### K10 — `CFG-24`'s warning half is not emitted — **SCHEDULED** (Phase 7b)

`CFG-24` requires that malformed proxy configuration resolve to null *with a warning* — "MUST NOT throw on
malformed input (invalid config → null + warning)", restated at `docs/knowledge/configuration.md:52`. The
shipped `resolveProxyOptions` gets the null half right on all three rejection paths (`parseProxyUrl`'s
`catch`, an unusable port, an absent host) and emits no diagnostic on any of them, because there is no
`Logger` in the package until 7b ships the `OBS-*` seam. The consequence today: a typo'd `HTTPS_PROXY`
silently routes direct instead of through the proxy, with nothing to read anywhere. **Trigger:** when 7b's
`Logger` lands, wire the three null paths in `config/proxy.ts` to it and re-mark the checklist's `CFG-24` row
whole. Recorded because this was the one clause in the phase with no paper trail — the checklist claimed
`CFG-24` outright, and it is now split `✅ (null) / ⏳ (warning, Phase 7b)`.

### K11 — `client-identity-step.ts`'s folder placement is provisional — **SCHEDULED** (with K1)

`RECOV-33`'s step lives at `packages/core/src/config/client-identity-step.ts` because the phase design doc's
File Layout names that path. Two arguments say it is not its long-term home, both recorded here rather than
acted on, because relocating a file into a neighbouring phase's folder on 7a's authority is the same
surface-widening the phase declined to do for K1:

1. **It is the sole outbound `config/ → pipeline/` edge.** Three of its four imports leave the folder —
   `../http/headers.js`, `../http/request.js`, `../pipeline/step.js` — and only `./build-info.js` stays.
   Every other module under `config/` imports nothing beyond `../invariant.js` and `../generated/version.js`.
   The file is grouped by which phase built it, not by feature (`docs/knowledge/module-organization.md:12`).
   There is no cycle today; the risk is that 5a's `RetryConfig.clock` and 7b's logging step both create the
   return edge, and nothing in CI would catch the loop (see K12).
2. **Its `RECOV-32` sibling would land elsewhere.** The idempotency-key step — the adjacent requirement, the
   same kind of object — is planned for `packages/core/src/recovery/idempotency-key.ts`
   (`docs/superpowers/plans/2026-07-26-phase5a-retry.md:157,2529`). Two adjacent `RECOV-3x` steps in two
   unrelated folders.

Also noted here, since it is the same class of question: the barrel comment at `packages/core/src/index.ts`
explains the absence of a `config/index.ts`. This repo carries both patterns — `http/`, `body/`, `io/`, and
`seams/` have internal barrels; `pipeline/`, `context/`, and `config/` do not — and so does the knowledge
corpus, where `docs/knowledge/module-organization.md:18` bans internal barrels outright while
`docs/knowledge/api-design.md:8` endorses one per feature folder, with nothing in the corpus's
`--section conflicts` reconciling them. 7a followed its design doc, which rules a `config/index.ts` out by
name. **Trigger:** the same phase as K1 — whichever one promotes the pipeline authoring surface. Settle the
file's folder and the barrel question together there, and record the corpus tension at that point.

### K12 — No import-cycle gate exists in CI — **WATCH** (repo tooling, not this phase)

`docs/knowledge/module-organization.md:20` treats any import cycle as a bug rather than a style nit, and
`:22` requires it be gated in CI with `madge --circular src` or `eslint-plugin-import/no-cycle` as a required
check. Neither string appears anywhere in `package.json`, `eslint.config.js`, or
`.github/workflows/ci.yml` — verified 2026-08-27. Every other rule in that topic is either enforced or
deliberately deviated from; this one is simply absent, so the repo's twelve-plus source folders rely on
review alone. Deliberately **not** added by Phase 7a: a new blocking CI step is repo tooling, outside a
feature phase's scope, and it belongs with whoever owns `.github/workflows/ci.yml`'s gate list. **Trigger:**
the next phase that touches the CI gate list, or the first observed cycle — K11's `config/ → pipeline/` edge
being the nearest candidate.

### K13 — A `CFG-7`-valid duration can exceed what any timer can honor — **SCHEDULED** (first phase wiring a configured duration into a timer)

`Clock.sleep` now rejects any `ms` above `2 ** 31 - 1` with an `InvariantViolation` naming the ceiling
(`packages/core/src/config/clock.ts`), because `setTimeout` silently clamps a larger delay to `1` — `sleep(2 **
31)` returned in 7ms instead of waiting 24.8 days, so an overflowed retry backoff became *no* backoff and a hot
loop against the upstream. That closes the silent half.

The residue is on the other side of the seam. `Configuration.getDuration` still returns
`8.64e26` for `9999999999999999999d` and `8.64e27` for `P100000000000000000000D`, and it is **right** to:
`CFG-7` defines the grammar and those parse correctly under it, so returning the caller's `fallback` there
would invent a rejection rule the requirement does not state. Deliberately **not** bounded by 7a for that
reason. The consequence today is contained — the value is `CFG-7`-valid, and the first thing that tries to
*wait* it raises a named error at the point of use rather than looping — but it means a config typo is caught
one layer later than it could be. **Trigger:** the first phase that wires a configured duration into a timer,
which is Phase 5a's retry engine. Bound it there, at the configuration boundary, following `RECOV-34`'s
precedent — that requirement already bounds every retry duration at "representable in nanoseconds (~292-year
ceiling)" and rejects at construction rather than at use.

### K14 — A configuration seam that fails is now silently invisible — **SCHEDULED** (Phase 7b, with K10)

`CFG-5`/`CFG-6`/`CFG-7` make every typed accessor total, and `CFG-11` makes both lookup layers
caller-supplied — so a seam backed by a file, a secrets store, or a remote key/value store can fail like any
I/O. Until 2026-08-27 that failure escaped unwrapped out of `getString`/`getInt`/`getBoolean`/`getDuration`,
contradicting the interface's own "never a throw" contract. `readLayer` in
`packages/core/src/config/configuration.ts` now absorbs it: a throwing layer supplies nothing and the lookup
falls through, exactly as it does for an absent key.

That is the correct precedence — `CFG-5` is the stronger obligation — but it trades a wrong error for no
error. An operator whose secrets-store seam is misconfigured now sees the caller's default resolve, with
nothing anywhere to say why. The same shape as K10, the same cause, and the same blocker: there is no
`Logger` in the package until 7b ships the `OBS-*` seam. **Trigger:** when 7b's `Logger` lands, wire
`readLayer`'s `catch` to it **together with** K10's three null paths in `config/proxy.ts` — they are one
change, not two.

### K15 — `HTTP-17`: `hasForbiddenNameByte` permits a space inside a header name — **DECIDE** (Phase 1 code, surfaced by 7a)

`packages/core/src/http/ascii-validation.ts`'s `hasForbiddenNameByte` rejects C0 controls, DEL, and every
non-ASCII byte, but permits `SP` (0x20) and the rest of the non-`tchar` punctuation RFC 9110's `token`
grammar excludes. Verified 2026-08-27: `Headers.newBuilder().set('User Agent', 'x')` and `set('Bad Name',
'x')` both succeed, and the name reaches the wire with the space in it.

Found while enumerating `clientIdentityStep`, which is the first caller to forward a **caller-supplied**
`headerName` straight into that predicate — before it, every name reaching `validateName` was either a
literal in this repo or came off an already-parsed response. Deliberately untouched by 7a: this is Phase 1
code and `HTTP-17`'s row belongs to Phase 1's checklist, so widening the character class on a review pass in a
different phase would change a validated surface without its owner's conformance evidence. **Trigger:**
whoever next revisits `HTTP-17`, or Phase 9's conformance pass — decide there whether the predicate should be
`tchar`-exact, and re-mark `HTTP-17` accordingly.

### K16 — `deepEqual` / `deepHash` require acyclic, bounded-depth input — **WATCH**

Both helpers in `packages/core/src/config/equality.ts` recurse with no cycle guard and no depth cap, so a
self-referential array (`const a = []; a.push(a)`), a mutually recursive pair, or ~100k levels of nesting
raises `RangeError: Maximum call stack size exceeded` rather than terminating. `CFG-33` says nothing either
way; the precondition is simply undocumented. Pinned by two tests in `equality.test.ts` so the constraint is
discoverable at review time rather than in production.

Deliberately **not** fixed: the module is not exported from the package barrel (`packages/core/src/index.ts`
records that decision) and has **zero callers** as of 2026-08-27, so a `WeakSet` cycle guard and a depth cap
would be cost paid by nothing. **Trigger:** the first consumer. It either supplies the acyclic,
bounded-depth guarantee itself — which every `CFG-33` use the spec describes does, since it compares
byte arrays and header value lists — or adds the guard and the cap at that point, and this entry closes.

### K17 — `formatProxyOptions` re-brackets an IPv6 host that `ProxyOptions.host` stores bare — **RESOLVED** (2026-08-27)

Pass 2 normalized `ProxyOptions.host` to the bare address on both `CFG-24` layers (F13), which left
`formatProxyOptions` rendering `http://2001:db8::1:8080` — an address and port that cannot be read back
apart. The bracketing now lives in the formatter, keyed off a colon in the host, since no registered name or
IPv4 literal can contain one. `host` stays bare as the stored representation; any bracketing is a rendering
concern, which is also what a future transport's URL construction will need.

### K18 — `isHeaderSafe` duplicates `http/ascii-validation.ts`'s outbound byte predicate — **WATCH** (split out of K11, 2026-08-27)

`packages/core/src/config/build-info.ts` carries its own four-line printable-ASCII-plus-HTAB predicate rather
than importing `hasForbiddenOutboundByte` from `packages/core/src/http/ascii-validation.ts`. The two encode
the same character class for the same reason — an ambient value that RECOV-33 puts straight into an outbound
header.

The duplication is **deliberate** and the trade is stated at the call site: `config/`'s outbound edges are
already a live concern (K11 tracks the `config/ → pipeline/` one), and adding a second one to reuse four
lines is the wrong side of that trade while K12's import-cycle gate does not exist.

Recorded separately from K11 because K11's own resolution — settle `client-identity-step.ts`'s folder and the
`config/index.ts` barrel question — would not touch this predicate, so a reader following the old pointer
found nothing that owned it. **Trigger:** whichever phase consolidates the ASCII predicates, or the first
third caller of the same character class; `build-info.ts`'s `isHeaderSafe` is one of the call sites it folds
in. Until then the risk is one-way drift — a fix to the `http/` predicate that this copy does not receive.
Cheap to bound: both are exercised by tests that assert the same class (`build-info.test.ts`'s header-safety
cases and `http/`'s own), so a divergence surfaces as a test failure rather than as silent behavior.

### K19 — No `fast-check` property test logs its seed — **WATCH** (repo tooling, not this phase)

`docs/knowledge/testing.md:44` requires the seed of a failing seeded `fast-check` property test to reach CI
output, "or the shrunk counterexample that found the bug is lost". No `fc.assert` call anywhere under
`packages/core/src` passes a `seed`, `numRuns`, or a `reporter` — verified 2026-08-27 across all 20
`fc.assert` sites, of which Phase 7a contributes 12. A property failure in CI today reports the shrunk
counterexample for that run only; re-running does not reproduce it.

Deliberately **not** fixed by Phase 7a, and deliberately not fixed in this phase's tests alone: a seeding
convention that covers half the suite is worse than none, because the half without it looks deliberate. This
is one repo-wide decision — a shared `fc.configureGlobal({seed, verbose})` in a test preload, or a documented
`FC_SEED` environment convention — and it belongs with whoever owns `bunfig.toml`'s test configuration.
**Trigger:** the next phase that touches the test harness configuration, or the first property failure in CI
that cannot be reproduced locally.

### K20 — `Retry-After: <year below 100>` changed disposition from no-hint to retry-immediately — **RECORDED** (2026-08-27)

Surfaced by rebasing 7a onto the branch that already carried 5a. Before 7a, `retry/pacing.ts` used a private
RFC 1123 parser that **rejected** a four-digit year in `[0,99]`, so `Retry-After: Thu, 01 Jan 0026 00:00:00
GMT` produced no hint and the caller fell back to backoff. 7a deletes that private copy in favour of the
shared `config/http-date.ts`, which reads the year literally (never `Date.UTC`, whose legacy mapping would
turn `0026` into 1926) and therefore accepts it as a well-formed instant in the past.

Kept 7a's reading. `RETRY-16`'s no-hint rule is about values that are *malformed, negative, or out of
range*; a literal year 26 CE is none of those, and `RETRY-17` is explicit that "a valid HTTP-date ... already
in the past MUST yield a zero delay (retry immediately), distinct from an unparseable value which yields no
hint". RFC 1123's `date1` year is `4DIGIT` with no lower bound, so rejecting `0026` was the stricter-than-spec
half of the two implementations. `packages/core/src/retry/pacing.test.ts` now asserts `0` for that input and
records why.

The behavioral cost is real but narrow: a server sending an absurdly old `Retry-After` gets an immediate
retry rather than a backed-off one. No such header exists in practice, and `RETRY-17` prescribes exactly this
for every other past instant, so a plausibility floor would be a new deviation rather than a fix.

**Trigger:** a real server observed to send a pre-1970 `Retry-After`, or a spec erratum giving `RETRY-16` a
lower bound on the year.

---

## Section L — Phase 7b (Instrumentation & Observability)

Recorded at implementation time. Verified against `docs/product-spec/15-instrumentation-and-observability.md` (`OBS-1`..`OBS-18`, `OBS-20`..`OBS-27`, `OBS-30`..`OBS-40` executed; `OBS-19`, `OBS-28`, `OBS-29` deferred per design).

### L1 — Deferred HTTP-Tracer Vocabulary and Transport Policies — **SCHEDULED** (Phase 8a / Phase 9)

- `OBS-19` (dropped-header verbosity policy): Deferred to Phase 8a alongside the concrete `fetch` transport that first detects unencodable caller-set headers.
- `OBS-28` (richer HTTP-tracer vocabulary with per-attempt and transport milestones) and `OBS-29` (HTTP-tracer lifecycle ordering contract): Deferred to Phase 8a (interface + transport milestones) and Phase 9 (ordering verification). Phase 7b ships operation/attempt-level `startSpan`/`end` (`OBS-21`..`OBS-25`).

**Trigger:** Phase 8a transport adapters and Phase 9 conformance sweep.

### L2 — G2 Deferred Emissions Resolved — **RESOLVED** (2026-08-28)

`REDIR-28` hop and rejection logging, and `REDIR-15` downgrade logging are now integrated and active through `getGlobalLogger()`.

### L3 — G12, K10, K14 Config & Auth Logger Retrofit — **SCHEDULED** (Phase 9)

`AUTH-37` failed background refresh logging (`auth/bearer-cache.ts`), `CFG-24` malformed proxy warning (`config/proxy.ts`), and `CFG-5` configuration layer error logging (`config/configuration.ts`) were deferred pending the `Logger` facade. With `Logger` shipped in 7b, these call sites remain for the Phase 9 conformance / hardening sweep to avoid modifying out-of-scope files in 7b.

**Trigger:** Phase 9 conformance sweep.

### L4 — Attempt-Level vs. Operation-Level Span and Metric Scope (PIPE-2) — **RECORDED** (2026-08-28)

`PIPE-2` fixes the `LOGGING` pillar step inside `RETRY` and `REDIRECT` pipelines. Consequently, `startSpan('http.client.request')` and metric increments (`http.client.request.count`, `http.client.request.duration`) execute per HTTP transmission attempt/hop. The higher-level logical operation span and HTTP-tracer lifecycle are owned by Phase 8a / `OBS-29`.


## Section M — Phase 8b (Async-Runtime Bridge, `@dexpace/rx`)

Recorded at implementation time. Verified against `docs/product-spec/18-asynchronous-runtime-adapter-contract.md`
(`ASYNC-1`..`ASYNC-22`) and `SSE-41`.

### M1 — The `AsyncIterable`→`Observable` Bridge Is Hand-Written, Not `rxjs`'s `from()` — **RECORDED** (2026-08-28)

8b's design (§1) and plan (Global Constraints) both instructed: do not hand-write the pull loop, use RxJS's own
`from(asyncIterable)`, and prove it satisfies `ASYNC-6`/`ASYNC-13`/`ASYNC-21` rather than assuming it. The proof
failed on one clause. `rxjs@7.8.2`'s async-iterable path tests `subscriber.closed` only *after* a pull resolves,
so unsubscribing while a pull is suspended never reaches the source. For pagination that is invisible; for SSE it
is the common case — an idle event stream is permanently suspended, so `unsubscribe()` would leave the response
body unreleased and the connection open until the server next sent something.

Resolved through the fallback both documents pre-authorized, scoped to that clause alone:
`packages/rx/src/from-async-iterable.ts` (`@internal`) adds a teardown that releases the caller-supplied source
and drives `iterator.return()`, release first so a suspended pull settles before the queued generator return.
No scheduler, no error re-wrapping, no buffering.

Full rationale in the plan's Self-Review. This is a deviation from the *plan's* implementation instruction, not
from the product spec — `ASYNC-6`/`ASYNC-21`/`SSE-41` are satisfied as written, and
`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`'s Phase 8b rows are unaffected.

**Trigger:** an RxJS release that closes the gap. `from-async-iterable.conformance.test.ts`'s last case asserts
the defect (`returns === 0` after an idle unsubscribe) and fails when it is fixed; at that point delete the
module and go back to `from()`.

### M2 — `ASYNC-*` IDs Marked 🚫 Are Not Yet Satisfied Anywhere — **SCHEDULED** (Phase 8a)

`ASYNC-1`, `-2`, `-5`, `-15`, `-16`, `-17`, `-20`, and `-22` collapse onto `TRANSPORT-*` twins (`TRANSPORT-23`,
`-21`, `-9`, `-15`/`-16`, `-29`, and the `SEAM-16` body-ownership invariant). The 8b checklist marks them 🚫
"collapses onto Phase 8a," which is the correct disposition but reads, at a glance, like a closed row. **No
shipped package implements those `TRANSPORT-*` requirements yet** — 8a (`transport-fetch`/`transport-undici`) has
not executed. Recorded so an appendix-B sweep run between 8b and 8a does not count eight `MUST`s as covered.

**Trigger:** Phase 8a landing. Its checklist owns the ✅ for each twin.

### M3 — `ASYNC-18` Confirmed a Full-Port Collapse at Implementation Time — **RESOLVED** (2026-08-28)

8b's design predicted that no adapter in this port needs a non-blocking scheduled-delay primitive, correcting the
segmentation design's narrower "8b-only scope boundary" framing. The as-built package confirms it: `@dexpace/rx`
contains no timer, no scheduler, and no backoff — the four wrappers only iterate what they are handed. SSE
reconnection stays caller-owned (`SSE-38`) and retry/backoff stays in 5a's engine. Already reflected in
`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` Item 1; no further action.


## Section N — Phase 9 (Cross-Cutting Invariants & Conformance)

Findings from the first systematic `XCUT-1`–`XCUT-24` / `NFR-1`–`NFR-17` pass. Every row here was found by
driving the **composed** pipeline (`standardResilience()` over a real `fetchTransport()` against a local
`node:http` fixture), which is the shape no earlier phase's own unit tests exercise.

### N1 — Cancellation surfaces two different types depending on which layer was cancelled — **ACT**

`XCUT-1` requires cancellation to surface "as a distinct, terminal, NON-retryable signal". The port has a type
for exactly that, `CancellationError`. It is produced on one path and not the other:

| Cancelled during | Surfaced as |
|---|---|
| the transport dispatch | `CancellationError` — `transport-shared`'s `abortToSdkError` maps the abort |
| a retry backoff wait | `SuppressedError('retry attempts exhausted')` wrapping a bare `DOMException` `AbortError` |

`retry/engine.ts` surfaces `config.signal.reason` (line 375) and whatever `Clock.sleep` rejected with (line 410)
verbatim, so no mapping to `CancellationError` ever happens on the retry path. Verified against the composed
pipeline: `.error` is `DOMException{name:'AbortError'}`, `.suppressed` is the prior `HttpStatusError`.

**Not a MUST violation on its own reading of `XCUT-3`** — a cancellation *is* surfaced, it aborts
near-immediately (measured well under 5s against a 60s backoff), no further attempt is dispatched, and it is
unambiguously not a timeout, which is all `XCUT-3` demands. The defect is consistency: a caller writing
`catch (e) { if (e instanceof CancellationError) … }` handles the transport case and silently misses the
backoff case. `XCUT-2`'s "told apart by ambient state, not a message string" still holds either way, since
`AbortError` vs `TimeoutError` is a `name` check.

**Decision needed:** map the retry engine's two cancellation exits through the same `abortToSdkError`-shaped
helper the transports use, or state in `CancellationError`'s own TSDoc that it is a transport-layer type and a
caller must check the chain. Deliberately **not** patched in Phase 9 — the phase's plan says a failure found
here "is in an earlier phase's shipped behavior, not something this task builds; file against that phase's own
plan rather than patching around it here". Owner: 5a.

`tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts` asserts the invariant `XCUT-3` actually
states (a cancellation is carried somewhere in the chain, and no timeout is) rather than pinning the current
wrapper shape, so whichever way the decision goes the suite keeps passing.

### N2 — `HttpStatusError`'s public constructor fabricates the "successful exception" `XCUT-8` forbids — **ACT**

`XCUT-8` requires the status-to-exception mapping factory to reject a non-error status "rather than fabricate a
'successful exception'", and permits a convenience form returning absent/null instead of throwing. The port
ships only the convenience form, `toHttpError`, and it is correct — `toHttpError(200)` and `toHttpError(304)`
both return `null` (asserted in `body/http-status-error.test.ts`). On that reading `XCUT-8` is satisfied.

The hole is one level down. `HttpStatusError`'s constructor is `@public` in `core.api.md` and validates
nothing:

```
new HttpStatusError(200, undefined, undefined)   →   HttpStatusError: HTTP 200   (status: 200)
```

That is precisely the "successful exception" the requirement names, and it contradicts the class's own TSDoc,
which asserts `status` is "always in HTTP-11's 400-599 error band (BODY-31)" — an invariant documented but
never enforced. Nothing in `packages/core` constructs one this way; the exposure is a consumer's.

**Decision needed:** validate in the constructor and throw for a status outside 400-599 (a breaking change to a
published constructor, so it wants a changeset), or drop the constructor from the public surface and let
`toHttpError` be the only way to obtain one. The second is closer to the domain-model pattern the rest of
`src/http/` follows, where a TS-`private` constructor keeps construction behind validation.

Not patched in Phase 9: this is 3b's shipped surface, and Phase 9 audits rather than edits another phase's
code. Owner: 3b, with Phase 10 as the natural landing spot since it already carries an API-surface pass.

### N3 — Phase 9's plan asks for a `docs/knowledge/` grep that cannot return empty — **SCHEDULED** (Phase 10)

The plan's Task 11 Step 4 runs `grep -rn "unresolved 2026-07-25" docs/knowledge/` and expects no output. It
cannot pass as written. The design scoped §4 to the **three** markers in `tooling-and-quality-gates.md`; the
grep is repo-wide and two further markers live elsewhere:

| Marker | File | State in the code |
|---|---|---|
| `#private` fields as the default for model state | `http-domain-model.md:131` | Settled in practice — `#private` throughout `src/http/`, documented as the pattern in CLAUDE.md |
| `enum` for the pipeline `Stage` ordering | `pipeline.md:179` | Settled in practice — `erasableSyntaxOnly` bans `enum`; the port ships `STAGE_ORDER`/`PILLAR_STAGES` frozen constant objects |

Both are resolved *by the implementation* but never marked resolved *in the corpus*, which is exactly the
silent-gap shape this register exists to prevent. Deliberately not marked here: writing a resolution into
`docs/knowledge/` is a decision record, the checkpoint's rule only obliges markers its own §5 touched, and
neither is an `XCUT`/`NFR` question — Phase 9's scope. Phase 10 owns deviation reconciliation and is the
right place. The three markers Phase 9 *was* scoped to were already backported at planning time (`c6603aa`)
and were confirmed still correct, not re-made.

### N4 — `rxjs` version restated in three places against `NFR-14` — **ACT**

`NFR-14` asks that dependency and tool versions live in a single source of truth so a bump is one edit. The
root `workspaces.catalog` holds `@microsoft/api-extractor`, `expect-type`, `fast-check` and `typescript`.
`rxjs@^7.8.0` is stated three times instead: root `devDependencies`, `packages/rx` `devDependencies`, and
`packages/rx` `peerDependencies`. A bump is three edits, two of which are easy to miss.

The peer range is legitimately per-package — it is part of what `@dexpace/rx` publishes, not a build
coordinate. The two `devDependencies` restatements are the defect; a `rxjs` catalog entry collapses them.

`debug >=4.0.0` and `pino >=8.0.0` are **not** defects for the same reason: each appears once, as a published
peer range. `undici ^6.21.1` likewise appears once, as `transport-undici`'s own runtime dependency.

Not fixed in Phase 9: it edits another package's manifest and changes the lockfile, which is 8b's surface.
Owner: Phase 10, alongside its own dependency pass.


## Maintaining this file

Add an entry the moment a gap is found, not when it is fixed — the failure mode this file prevents is a
checklist row marked ✅ against code that does not implement it (A1, A2 are both instances). Remove an entry
only when the underlying requirement is genuinely satisfied *and* its checklist row agrees. When a phase
closes, re-scan its checklist against the code rather than trusting the marks.

