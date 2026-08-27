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
section G is Phase 5b's.

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

### B3 — NFR-12: reproducible builds asserted, never proven — **WATCH**

`bun install --frozen-lockfile` plus plain `tsc` are deterministic by construction, but nothing demonstrates
it. Becomes real at first publish (~Phase 10): build twice, diff artifact digests.

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
| Publish + provenance CI job | NFR-16 | release | `prepublishOnly` wired; nothing published yet |
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

## Maintaining this file

Add an entry the moment a gap is found, not when it is fixed — the failure mode this file prevents is a
checklist row marked ✅ against code that does not implement it (A1, A2 are both instances). Remove an entry
only when the underlying requirement is genuinely satisfied *and* its checklist row agrees. When a phase
closes, re-scan its checklist against the code rather than trusting the marks.
