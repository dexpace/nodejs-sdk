# Open Items

Running register of everything known to be unmet, unverified, misreported, or surprising across the
implemented portion of this project. **This is the only such register**; a second one at the repository root
was merged in as Section P on 2026-08-31 and deleted.

It is one of three files at the `docs/` root, and the boundary between them is *when* an item was created:

| Register | Holds | Item is |
|---|---|---|
| `open-items.md` (this file) | Everything unmet, unverified, misreported, or surprising | A gap found **after** the work, between what is claimed and what is built |
| [`deferred-items.md`](./deferred-items.md) | Work a phase decided not to do yet, with the phase that owns it | A decision made **before** the work: "not this phase, that one" |
| [`deviations.md`](./deviations.md) | The as-built audit of the deviation ledger | A place this port deliberately differs from the reference contract |

The same requirement ID can legitimately sit in two of them. `AUTH-37` was deferred to Phase 7b in
`deferred-items.md` and recorded here at G12 as a live silent swallow — G12 is retired now, its log half
having landed on 2026-09-02, which is the shape a requirement takes as it moves between the two files.

A requirement absent from this file is either satisfied or belongs to a phase that has not started. The point
of the file is that nothing is unmet *silently* — every gap below is scheduled against a named phase, awaiting a
decision, or `UNSCHEDULED` with a stated trigger in place of an owner.

**A resolved item is retired, never deleted.** Its body is removed and one row takes its place in
[Retired items](#retired-items) at the foot of this file, carrying the resolution, the date and the evidence.
The ID stays reserved and stays citable.

## Section index

Each section is a review. Its letter is permanent: source comments cite items as `docs/open-items.md K11`.
**A letter is never reused and an item is never renumbered.** A new review appends the next letter.

How many such citations exist is not written here. One command derives it, from the same regex and file
set the check uses — the lesson U10 records, which this paragraph itself broke until 2026-09-02 (V6):

```bash
node .claude/skills/housekeeping/probe.mjs --only=citations
```

**A citation into Sections Q–T is written with a section qualifier** — `open-items.md S.F8`,
`T.F9`, `Q.D1`, `R.E2` — because those sections' rows are the reviews' own numbering and three `F`
namespaces coexist. The probe's citation check resolves both forms; see U3.

**Every letter below is permanent, whether or not it still holds a live item.** The "Item IDs" column names
the whole namespace first, then the IDs that are retired.

| Section | Subject | Item IDs |
|---|---|---|
| A–C, E | Phase 1, re-verified at every review since | `A1`–`A6`, `B1`–`B4`, `C1`–`C3`, `E1`; `A1`, `A3`, `A5`, `B1`–`B4`, `C2`, `E1` retired — Sections B and E are now empty |
| D | Scheduled deferrals, Phase 1 onward | **none.** A bare table; its rows are cited by the anchors on them, or by row title, not by an item ID. 19 of its 25 rows retired |
| F | Phase 4b — recovery-chain primitives | `F1`–`F9`; `F3`, `F5`, `F6`, `F8` retired |
| G | Phase 5b — redirect | `G1`–`G13`; `G2`–`G4`, `G7`, `G10`–`G12` retired |
| H | Phase 6a — serde | `H1`–`H20`; `H1`–`H3`, `H5`, `H6`, `H12`–`H14` retired |
| I | Phase 6b — Server-Sent Events | `I1`–`I4`; `I1` retired |
| J | Phase 6c — pagination | `J1`–`J8`; all retired — Section J is now empty |
| K | Phase 7a — configuration and platform primitives | `K1`–`K20`; `K2`, `K4`, `K5`, `K9`, `K10`, `K14`, `K15`, `K17` retired |
| L | Phase 7b — instrumentation and observability | `L1`–`L4`; `L2` and `L3` retired. `L1` is a SPLIT: its `OBS-19` and `OBS-28` halves are retired without an ID, `OBS-29` is live as `V2` |
| M | Phase 8b — async-runtime bridge | `M1`–`M3`; `M2`, `M3` retired |
| N | Phase 9 — cross-cutting invariants and conformance | `N1`–`N4`; `N1`, `N2` retired |
| O | Knowledge-corpus split | `O1`–`O3`; `O3` retired |
| P | Phase 5a — retry (merged from the repository-root register, 2026-08-31) | `P1`–`P9`; `P1`, `P2`, `P9` retired |
| Q–T | Four validation/execution reviews relocated from the roadmap, 2026-08-31 | **table rows, not `###` items:** Q `D1`–`D2`, R `E1`–`E8`, S `F1`–`F10`, T `F1`–`F9`. The reviews' own numbering — see the note on Section S. All of Q, S and T retired; R keeps `E2`–`E4` |
| U | Documentation restructure | `U1`–`U11`; all but `U4` and `U5` retired |
| V | Register audit, 2026-09-02 | `V1`–`V15`; all but `V2`, `V3` and `V11` retired |
| [Retired items](#retired-items) | Every ID marked retired above, one row each | not a review; a resolved item's ID lives on here |

**Reviewed state.** Scaffold milestone (`0ebdc79`); Phase 1 (branch `2-phase-1-core-http-domain-model`,
uncommitted at time of review); Phases 3a/3b; Phase 4a (`7-phase-4a-execution-context`, three passes);
Phase 4b (`8-phase-4b-recovery-chain-primitives`); Phase 5b (`12-phase-5b-resilience-redirect`, three
passes); Phase 5a (three passes, now Section P, re-verified against source 2026-08-31); Phases 6a/6b/6c,
7a/7b, 8b, 9. Register-wide audit of every section against the tree, 2026-09-02 (Section V). Last
reviewed **2026-09-02**.

**Phase 4c is still not registered here.** It is merged and has an executed checklist, but never ran the scan
this file's maintenance rule asks for, so its absence means "not reviewed", not "nothing found". Section S is
a *document* validation review of 4b and Section T of 4c; neither is a review of the shipped code. Phase 5a's
gap closed on 2026-08-31 with Section P.

**Status vocabulary**

| Status | Meaning |
|---|---|
| **DECIDE** | Blocked on a human decision. Two or more defensible answers; picking one is the work. |
| **ACT** | Decision already made or obvious; the work is simply not done. |
| **SCHEDULED** | Deliberately deferred to a named phase. No action now; listed so it cannot be lost. |
| **WATCH** | Not a defect today. Becomes one when a stated trigger fires. |
| **UNSCHEDULED** | Real, unowned, and deliberately not scheduled. The roadmap's phase table ends at Phase 10 and every phase has shipped, so there is no phase to name; the row carries `trigger: …` instead, and no phase is invented to hold it. Added 2026-09-02, when the audit found twenty items naming a phase that had closed without doing the work. |
| **BLOCKED** | Real, understood, and stopped on a decision that is the owner's to make — not merely unowned. Distinct from `DECIDE` in that the analysis is finished and the blocking reason is named. |
| **FIXED** | Closed by work done for this register, with `file:line` evidence in the item's own dated note. |
| **CLOSED** | Closed by a reading rather than by work: the premise was false, the requirement is satisfied by delegation, or the decision is won't-fix. The reasoning is in the item. |
| **RETIRED** | Not a status an item carries — it is what happens to one that reached a resolved disposition — `FIXED`, `RESOLVED`, `CLOSED`, "merged into", or a closed decision such as won't-fix, an accepted deviation or an accepted risk. The body is removed and replaced by a single row in [Retired items](#retired-items) giving the resolution, the date and the evidence. **The ID is never released**: it is not renumbered, not reused, and still resolves from a source comment, because the citation check reads that table alongside the `### <ID>` headings. Introduced 2026-09-02, when 76 items and 49 table rows had accumulated with nothing left to act on. |

---

## Section A — Requirements unmet or misreported

### A2 — HTTP-22: the checklist describes an implementation that does not exist — **ACT**

Phase 1 checklist, HTTP-22 row: `✅ | Task 7, HeaderName.of()'s static cache`.

No such cache exists. The plan deliberately dropped interning (Task 7's `HeaderName` comment: "No interning:
HTTP-22 makes it a MAY, and an intern map keyed by caller-supplied names is exactly the unbounded,
process-lived, caller-influenced map XCUT-14's drain-to-cap rule forbids"), and
`packages/core/src/http/headers.ts` has no static map on `HeaderName`.

The decision is right and the requirement is a MAY, so nothing about the code needs to change. The checklist
row is simply false and should read ⏳/N/A with the XCUT-14 reasoning, not ✅.

### A4 — SEAM-1 is enforced narrowly relative to its conformance text — **ACT**

`scripts/verify-seam-1.mjs` asserts `packages/core/package.json`'s `dependencies` is `{}`. The spec's
conformance clause is broader: "a dependency audit of the core module finds only the standard library plus the
compile-scope logging facade; **no transport/codec/stream symbol is referenced from core**."

Blind spots today: `peerDependencies`, `optionalDependencies`, and `bundleDependencies` are unchecked, and
nothing inspects what the source actually imports. Low risk while core imports nothing but `URL`, but the gate
reads as stronger than it is. Cheap hardening: assert the other three dependency keys are absent-or-empty, and
add an import scan over `packages/core/src` allowing only relative specifiers and `node:`-prefixed builtins.

---

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

## Section B — Gates and tooling

All items retired 2026-09-02 — see [Retired items](#retired-items). IDs `B1`–`B4` remain reserved.

---

## Section C — Documentation defects

### C1 — Phase 1's scope statement contradicts its own plan — **ACT**

`docs/work/mvp/phase1/2026-07-23-phase1-core-http-domain-model-design.md` says the scope is "Full
`product-spec/04-core-http-domain-model.md` (HTTP-3 through HTTP-53, both MUST and SHOULD level) in one phase."

The plan's own Self-Review then amends that: *"The Phase 1 spec's scope statement should be read — and amended
— as HTTP-3..35, 46..50, 53"*, with the body-lifecycle cluster deferred to Phase 3b. The amendment was never
applied to the design doc, so read literally the two documents disagree about what Phase 1 owed. Correct the
design doc's scope line to match the plan.

### C3 — The Phase 4 checklist under-reports Phase 4a — **ACT**

`docs/work/mvp/phase4/2026-07-26-phase4-execution-context-and-pipelines-checklist.md` still carries its
banner: "the plans are reviewed and corrected as of 2026-07-26 but **not yet executed**. Every ✅ means 'the
plan builds and tests it,' not 'it is on `main`.'" Phase 4a's rows are now built, tested, and committed on
`7-phase-4a-execution-context`, so the banner understates them while 4b and 4c remain unbuilt.

The same checklist maps only `CTX-*`. It has no `XCUT-14` row, even though
`docs/work/mvp/phase9/2026-07-28-phase9-cross-cutting-conformance-design.md:66` names "4a's context registry"
as an XCUT-14 site and appendix B's only conformance row that `ContextStore` satisfies is B.8's
"Caller/server-keyed maps bounded with drain-to-cap loop (XCUT-14)" — appendix B has no CTX section at all. The
ID is now cited in `store.ts` and `store.test.ts`; the checklist is the remaining gap.

Split the banner per sub-phase, and add an `XCUT-14` row pointing at 4a Task 4 (qualified by A6 above).

---

## Section D — Scheduled deferrals

> **Historical, as of 2026-09-02.** [`docs/deferred-items.md`](./deferred-items.md) is the
> authoritative deferral register. The rows that stay do so because other documents link to them — the
> `await using` row and the `NFR-16` provenance row each carry an HTML anchor — and because a row's
> reasoning is often longer here than in the aggregate. Cite a row by that anchor or by its title,
> never by line. The **status marks below were re-derived against the tree on 2026-09-02**; the rows
> themselves are not re-litigated here.

No action now. Each is already owned by a named phase; this table exists so none can quietly lapse.
**Nineteen rows were retired 2026-09-02** — every row this table carried as **Done** is now one row in
[Retired rows without an item ID](#retired-rows-without-an-item-id), cited by section and row title. Six
rows remain, and they are below.

| Item | Requirement | Owner phase | Note |
|---|---|---|---|
| `Request.equals` compares body by reference, not by value | HTTP-46 (body clause) | 3b | Blocked on a real `Body` model supplying value equality. **Still open 2026-09-02** — `Body` ships but exposes no value equality, so the blocker stands |
| `RequestConditions.applyTo` cannot emit an obs-text ETag | HTTP-18 vs HTTP-48/50 | 10 | Spec text in scope does not resolve the tension; strict outbound path kept rather than guessed. Documented in `applyTo`'s TSDoc |
| `contextsEqual()`, value equality over `ExecutionContext` | CTX-5 (equality framing) | none | Built only if 4b or 4c needs one. `CTX-5`'s operative half — pinning an explicit shared key — ships via `ContextInit.key` |
| <a id="d-nfr-16-provenance"></a>Publish + provenance CI job | NFR-16 | release | `prepublishOnly` wired; nothing published yet. **Sharpened 2026-08-29:** there is no release workflow at all and `--provenance` appears in no manifest, workflow, or `.npmrc`. §10's ledger claimed the flag "is scripted"; it never was. Authoring the workflow is actionable **now** — only running it against a real registry is blocked. **2026-09-02:** `.github/workflows/release.yml` is authored (push to `main`, `changesets/action@v1`, `id-token: write`, `NPM_CONFIG_PROVENANCE: 'true'`), so "there is no release workflow at all" is no longer true. Inert until an `NPM_TOKEN` secret exists. Of the two prerequisites that still blocked the first publish, one is now fixed — no manifest carried a `repository` field, and all nine publishable manifests now do — and one is a maintainer call: `.changeset/config.json`'s `"access": "restricted"` conflicts with provenance's public transparency log |
| <a id="d-nfr-10-await-using"></a>`await using` support on `Page`, `fetchTransport()`, `undiciTransport()` | NFR-10 | **none — decided against 2026-08-30** | These three declared `[Symbol.asyncDispose]` as a plain class member; on the `>=20.3` floor the computed key is `undefined`, so the method bound to the string key `"undefined"` — junk on the prototype, no disposal, and a `.d.ts` promising `AsyncDisposable` regardless. Fixed 2026-08-29 to `SseStream`'s guarded install, which costs the type-level `await using` affordance (`close()` is unaffected). **This row previously read "raising the floor to `>=20.4` restores the declaration honestly and lets all four sites drop the guard." That is now a rejected option, not a pending one — the floor stays `>=20.3` and all four guarded installs stay.** Four reasons, in the order that decides it. (1) `NFR-10` is **MUST**-level and requires that "the emitted-artifact target and the visible-API level must agree" (`docs/product-spec/20-non-functional-requirements-and-quality-bar.md:29`); the unguarded class member violated it directly, and the guarded install *is* the repair — not a workaround waiting to be undone. (2) The same requirement's next clause: "A capability that genuinely requires a newer runtime MUST be isolated into its own unit that declares the higher floor explicitly; that unit MUST NOT be a hard dependency of the general-purpose core." Raising core's floor to recover `await using` is the exact inverse — it drags every consumer onto a higher runtime for one syntactic affordance. (3) **The floor is derived, not chosen.** `scripts/verify-runtime-floor.mjs:33` pairs language level `es2023` with `>=20.3`, and its own banner comment (`:22-29`) says the floor is "set by the runtime built-ins the SDK calls rather than by the syntax it emits" and that "adding or moving a row here is a reviewed choice about what runtimes the SDK supports, never a mechanical bump." `>=20.3` is the *minimum* Node that runs what this project emits — `globalThis.crypto` is absent from ESM on every Node 18, and `AbortSignal.any()` landed in 20.3.0. Moving it to satisfy a type-level convenience inverts what the gate is for. (4) **There is a decided precedent.** `docs/work/mvp/phase4/2026-07-26-phase4-execution-context-and-pipelines-checklist.md:208` rejected raising the floor for `SuppressedError` on the same reasoning and shipped a guarded shim instead — `packages/core/src/suppress.ts`. `close()` remains the supported teardown on every runtime; a consumer who has raised *their own* floor to 20.4+ can still reach the installed member through a cast. See §10 ledger item 11 and I3/J3 below |
| Erratum for the `PIPE-40` / `REDIR-22` contradiction | PIPE-40 vs REDIR-22 | 10 | **Still open 2026-09-02, and now unowned:** Phase 10 shipped without writing the erratum, and `docs/product-spec/` is frozen. Behavior is chosen and tested; one of the two spec sentences still needs correcting. See G1 |

---

## Section E — Process

All items retired 2026-09-02 — see [Retired items](#retired-items). ID `E1` remains reserved.

---

## Section F — Phase 4b (Recovery-Chain Primitives)

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

### F4 — The chains are classes where `data-modeling.md:10` asks for free functions — **UNSCHEDULED** (2026-09-02)

`RequestRecoveryChain` / `ResponseRecoveryChain` own no lifecycle and hold no mutable state, so the corpus
would have them be plain data plus free functions. Kept as classes because `RECOV-14`'s text is written about
the chain and step *instances*, and because the defensive copy wants a construction boundary. Ledgered in the
phase design.

**2026-09-02: the owner is spent.** Phase 10 shipped and did not touch it; the roadmap ends there, so
no phase is named in its place. The shape is stable and the reasoning above still holds.
**Trigger:** the first change to `recovery/`'s own surface that would rewrite these constructors
anyway — at that point free functions cost nothing extra, and until then the churn buys only
conformity.

### F7 — `suppress()`'s branch selection is only ever half-covered on any single runtime — **WATCH**

`suppress()` returns the native `SuppressedError` where the runtime has one and `FallbackSuppressedError` where
it does not. No test forces the other branch by deleting the global — that cannot survive parallel execution
(`docs/knowledge/harvested/testing.md:50`). Coverage comes from the `test:node` matrix instead: `lts/*` exercises the
native branch, the pinned `20.3.0` exercises the fallback. **Trigger:** if the matrix ever collapses to one
runtime, or the floor rises past Node 24 (where the fallback becomes dead code to be deleted, not guarded).

### F9 — The Phase 4 checklist's ✅ marks for 4a and 4c are still plan-level — **UNSCHEDULED** (2026-09-02)

`docs/work/mvp/phase4/2026-07-26-phase4-execution-context-and-pipelines-checklist.md` now says so
explicitly in its Status line, but the §7.x and §8.1 tables read identically to the §8.2 ones that
are now real. Re-scan both when their phases execute, per this file's own maintenance rule.

**Path corrected 2026-09-02.** This row cited `plans/2026-07-26-…`, a directory that has not existed
since the 2026-08-31 restructure; the file is under `docs/work/mvp/phase4/`. The citation checker
does not catch this, because it matches `docs/open-items.md <ID>` back-references, not file paths.

**Status 2026-09-02.** 4a and 4c both executed, so the trigger this WATCH named has fired and the
re-scan is owed. `docs/work/` is never retro-edited, so the outcome is a *note*, not a rewrite of the
checklist. **Trigger: the next review that reads the Phase 4 checklist as evidence** — until then no
document depends on those marks, and Sections F, S and T each carry the findings a re-scan would
produce.

---

## Section G — Phase 5b (Redirect)

Three review passes ran over this phase. Everything they found is either fixed in the branch or listed here.
Nothing below blocks the phase — `REDIR-1`–`REDIR-27` are satisfied, `PIPE-40` is closed, and every CI step is
green. `REDIR-28` is the one requirement in the chapter that ships unimplemented, and it is scheduled.

### G1 — `PIPE-40` and `REDIR-22` contradict each other on the non-replayable-body path — **UNSCHEDULED** (2026-09-02)

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

**2026-09-02: Phase 10 shipped and did not write it, so the owner is spent.** No phase is invented to
replace it. `docs/product-spec/` is a frozen tree, so the erratum is a deliberate hand edit by
whoever owns the specification, not a maintenance action. Nothing in the code waits on it.
**Trigger: the next deliberate amendment of `docs/product-spec/08-execution-pipelines.md` or
`docs/product-spec/10-redirect-handling.md`** — the erratum rides along with it.

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

### G8 — The 5b design doc's process note claims it is uncommitted — **ACT**

`docs/work/mvp/phase5/phase5b/2026-07-26-phase5b-redirect-design.md:23` ends: "Not committed — left for the user to
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

### G13 — two pre-existing cleanups Phase 5c's Reader pass found and deliberately did not take — **UNSCHEDULED** (2026-09-02)

Both predate 5c, sit in files Passes 1 and 2 declared settled, and were left alone rather than widening a
review pass into a refactor of earlier phases.

1. **`hasForbiddenOutboundByte` breaks its own family's naming.** `packages/core/src/http/ascii-validation.ts`
   exports `hasForbiddenNameByte`, `hasForbiddenInboundValueByte`, and `hasForbiddenOutboundByte` — the
   outbound *value* predicate is the only one that omits `Value`. At
   `packages/core/src/auth/digest.ts:229-231` and `:426` a reader cannot tell from the call whether the
   name rule or the value rule is being applied, and the two differ (HTAB is excepted by one and not the
   other). `hasForbiddenOutboundValueByte` restores the symmetry; **nine call sites outside the module,
   re-measured 2026-09-02** — `http/headers.ts`, `http/media-type.ts`, `body/media-type-safety.ts`
   (two) and `auth/digest.ts` (four).

   **Line numbers corrected 2026-09-02.** This entry cited `digest.ts:213` and `digest.ts:408`; both
   hold unrelated prose.
2. **`PipelineBuilder`'s duplicated bucket lookup.** `insertAfter`, `insertBefore`, and `replace` each repeat
   the same three lines — `const bucket = this.#buckets.get(anchor.stage);` plus an `invariant` whose message
   is identical in all three. One `#requireBucket(stage)` collapses them.

**Trigger:** the next edit to `ascii-validation.ts` (1) or `pipeline/builder.ts` (2) — stated as a
file rather than as a phase since 2026-09-02, because the roadmap ends at Phase 10 and every phase
has shipped. Both files were re-read on that date and both cleanups are still owed, unchanged;
neither file was touched by the register audit, so the trigger has not fired.

---

## Section H — Phase 6a (Serde)

Recorded at implementation time, before the three review passes. Everything here is either a deliberate
deviation from the phase plan, a requirement clause satisfied by delegation rather than by code, or work the
phase surfaced and deliberately left out of scope.

### H4 — plan deviations taken during implementation — **RECORDED**

Six places where the shipped code departs from
`docs/work/mvp/phase6/phase6a/2026-07-28-phase6a-serde.md` as written (path corrected 2026-09-02;
the `plans/` directory has not existed since the 2026-08-31 restructure):

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
   directly, and those two root scripts were extended instead. ~~`packages/codec-json/tsconfig.json` still
   carries the `references: [{"path": "../core"}]` entry, which is what lets it typecheck against core's
   *source* before core's `dist/` exists.~~

   **Corrected 2026-09-02.** That last sentence has been false since H18, four items below in this
   same section, removed the `references` entry — `packages/codec-json/tsconfig.json` has no
   `references` key today, and H18 states why: with `dist/` guaranteed present by `build:core`, the
   package typechecks against the **published** declarations rather than being redirected back to
   core's source. Section H asserted both things at once. Recorded as V12.
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

1. ~~`IoError`/`isIoError` are still not on `@dexpace/core`'s public barrel~~, so the nominal
   discriminator a caller would `instanceof` does not exist. The original entry's reasoning stands: the
   6a design's "Public Barrel" section does not list them, and promoting them reopens a Phase 3b
   decision.

   **Half-corrected 2026-09-02.** `IoError` **is** exported — `packages/core/src/index.ts:34`,
   promoted in `a0d734d` alongside `TransportFailureError` — so the nominal discriminator does exist
   and has since Phase 8a. `isIoError` is still unexported (`packages/core/src/io/errors.ts:102`), and
   `EndOfStreamError` was promoted in this pass under U9. What remains of this sub-item is the guard
   function alone, which matters only to a caller who wants to catch the four flat leaves as one
   category without naming them. **UNSCHEDULED — trigger: a consumer that needs the category catch;
   `e instanceof DexpaceError` plus a `name` check covers it today.**
2. `SuppressedError`/`SuppressedErrorLike` are likewise unexported, and one can still reach a caller (a decode
   failure whose release *also* fails — the 304 case has a passing test). Both handlers' `@throws` now
   document the shape: `name` is `'SuppressedError'`, `.error` is primary, `.suppressed` rides along, and
   `instanceof SuppressedError` is **not** a valid test because the class is absent on the declared
   `engines.node >=20.3` floor. Exporting a *type* for it is the narrowest possible fix.

**Trigger:** Phase 9 or Phase 10, whichever next audits the public barrel, for both promotion questions. The
foreign-stream-error residual triggers on the phase that builds the transport adapter, which is the only layer
that can tag a stream error at its source.

### H9 — every decode target is treated as non-null — **UNSCHEDULED** (2026-09-02)

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

**Trigger (2026-09-02, restated without a phase):** the first **consumer** — a generated client, most
likely — that declares a nullable top-level response body. No phase can be named: the roadmap ends at
Phase 10 and all ten have shipped. Deliberately **no** opt-in flag was invented here — new public
surface needs design sign-off, not a review pass. The open question is unchanged: whether
`DecodeTarget` should carry an explicit "this target admits null" opt-in.

### H10 — one concept, two spellings across the seam and the handler layer — **UNSCHEDULED** (2026-09-02; direction decided)

`Deserializer.deserialize(data, schema, typeName?)` takes the schema and its diagnostic label positionally;
`decodeResponse`/`decodeSuccessResponse` bundle the identical pair as `DecodeTarget<T>`. Both ship public in
this phase, in the same api-extractor report.

The positional form is what the plan's Task 2 Interfaces block specifies and it is defensible on its own terms
— three parameters, inside `max-params`, and an SPI a third-party codec *implements*, where a positional shape
is the smaller burden. The object form exists because positionally the handlers would be four parameters, which
is a lint error. So each layer's choice is locally right and the pair is globally inconsistent: a codec author
implements one spelling, a caller uses the other. `docs/knowledge/harvested/api-design.md:14` ("optional parameters
collected into a single options object rather than a positional list past two parameters") points at the object
form for both.

Not reshaped here: `Deserializer` is a seam this phase is publishing, and reshaping a seam without design
sign-off is out of scope for a review pass. The rationale is now stated on `Deserializer`'s TSDoc so the
inconsistency is deliberate and legible rather than accidental. Raised in the Phase 6a shape review as F5.

**2026-09-02: the direction is decided, the timing is not.** "The phase that next reshapes this seam"
names nobody — the roadmap ends at Phase 10 and every phase has shipped. Recorded so a later reader
does not re-derive it:

> **Unify on the `DecodeTarget<T>` object form.** `docs/knowledge/harvested/api-design.md:14` points
> there, the handler layer already uses it, and a codec author implementing one spelling while a
> caller uses the other is the cost being paid every day it stays split.

Not done now, because it is a breaking change to a published SPI and this pass is not the place to
take one alone. **UNSCHEDULED — trigger: the pre-publish breaking-change batch, before the first
non-`0.0.0` release.** That batch is the last moment the change is free: `@dexpace/core` is `0.0.0`,
and semver's initial-development carve-out (which Section Q's `D1` already invoked for a narrowing)
stops applying at 1.0.

### H11 — `tristate()`/`tristateObject()` are format-agnostic but ship in a format-specific package — **UNSCHEDULED** (2026-09-02)

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

**2026-09-02: left in `codec-json`, deliberately.** Neither argument above got stronger and no second
codec is on the roadmap, so moving a public export between published packages now would pay a
breaking change for a duplication that does not yet exist. **UNSCHEDULED — trigger: a second wire
codec.** No phase is named: the roadmap ends at Phase 10 and none is planned. Whoever writes that
codec meets this row before writing an import of `@dexpace/codec-json`.

### H20 — the coverage floor measures only the Bun run — **RECORDED, no gate** (2026-08-31)

`bunfig.toml`'s `coverageThreshold = 0.8` is enforced by `bun test` alone. `bun run test:node` contributes
nothing to it: `node --test` collects no coverage here, and the two runs do not share a report. So a line
reached only by `tests/node-conformance/` counts as uncovered, and a line covered only there cannot lift the
number.

Surfaced by the issue-55 audit, which named three gaps in the pre-Phase-10 arrangement. The naming gap was
closed by the tree move. The static-checks gap (`.mjs` gets the gts/format baseline only, and `tsc` never
opens the subtree) is recorded in `tests/tsconfig.json`'s own comment with its compensating control — CI runs
that suite on two Node versions. This is the third, and it was the one left unrecorded.

Not obviously a defect. The floor is a statement about `packages/*/src`, and the Node suite is deliberately
thin and additive rather than a second unit suite (`tests/node-conformance/README.md`), so its lines are
mostly re-assertions of behaviour `bun test` already covers. Merging the two reports would also mean
producing coverage from `node --test` over the BUILT `dist/`, which maps back to `src/` only through source
maps. Recorded so that "the floor covers everything" is never assumed.

**Trigger:** a requirement whose ONLY test is a `tests/node-conformance/` case — at that point the floor is
actively misreporting, and the case needs either a `bun test` counterpart or an explicit note in its phase
checklist.

### H15 — no `AbortSignal` on any long-running async API in this phase — **DECIDE-recorded, UNSCHEDULED** (2026-09-02)

Raised by the Phase 6a adversarial review as G10. Ledgered rather than fixed: adding `{signal}` to four public
APIs is a design decision, not a review-pass edit, and some of the sites would breach `max-params`.

`docs/knowledge/harvested/concurrency-and-async.md:18` ("every long-running async API must accept an options object with
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

**2026-09-02: the "no phase" problem applies, and one premise needs the owner's ruling.** The
candidate reading — "cancellation belongs to the I/O layer that produces the buffer; SSE and
pagination take signals because they are long-lived I/O *consumers*" — would close this row on the
reading alone, and it holds for `toHttpError` and `Response.bytes()`, which take buffered bytes.

It does **not** obviously hold for two of the four sites named above.
`Deserializer.deserializeFrom(source: ReadableStream<Uint8Array>, …)`
(`packages/core/src/seams/serde.ts:162`) and
`Serializer.serializeTo(value, sink: WritableStream<Uint8Array>)` (`:96`) take a **stream**, not a
buffer, and drive it themselves — so they are long-lived I/O consumers by the same test that earned
SSE and pagination their signals.

**The project-wide position, decided 2026-09-02 and stated here once:**

> **A signal is required where the API drives a stream it did not open. Buffered-bytes APIs take
> none.**

That answers the consistency question this row was really about. `toHttpError` and `Response.bytes()`
take buffered bytes and correctly take no signal; SSE and pagination are long-lived I/O consumers and
correctly do. Two of the four sites named above fall on the *other* side of that line and therefore
owe a signal:

- `Deserializer.deserializeFrom(source: ReadableStream<Uint8Array>, …)` (`seams/serde.ts:162`)
- `Serializer.serializeTo(value, sink: WritableStream<Uint8Array>)` (`:96`)

Both now carry a TSDoc `@remarks` citing this item, so the obligation is visible where the method is
read rather than only here. The mitigation above is unchanged and still true: abort IS honored
transitively today, and the CPU-bound `JSON.parse` span is not interruptible by any signal.

**UNSCHEDULED — trigger: the pre-publish breaking-change batch (H10's batch: same file, same
break).** Adding a parameter to a published SPI is breaking, `@dexpace/core` is `0.0.0`, and that
batch is the last moment it is free. Not taken now, alone, for exactly that reason.

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
so no `tests/node-conformance/` case was added: a test asserting "either encodes or throws `SerializationError`"
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
`[Symbol.asyncDispose]` at run time only when the symbol exists. `Response` (HTTP-38) goes further and ships
no disposal member at all — `close()` is its whole teardown surface, and `http/response.test.ts` pins the
absence of the `"undefined"` prototype key an unguarded declaration would leave behind. ~~Becomes an
unconditional `implements AsyncDisposable` when `engines.node` moves past Node 20.4.~~

**Widened 2026-08-30 (Phase 10).** `Page`, `FetchTransport`, and `UndiciTransport` were the three sites that
had declared the member unguarded; all four now share `SseStream`'s shape. See the deferred-items row
"`await using` support on `Page`, `fetchTransport()`, `undiciTransport()`" and §10 ledger item 11.

**Corrected 2026-08-30 (Phase 10): the "becomes unconditional when the floor moves" sentence is struck, not
merely deferred.** Raising `engines.node` to `>=20.4` to recover the declaration is **decided against** —
`NFR-10` (MUST) both requires the emitted target and the visible API level to agree *and* forbids making a
higher-floor capability a hard requirement of the general-purpose core, and the floor is derived from the
runtime built-ins the SDK calls (`scripts/verify-runtime-floor.mjs:22-29,33`), not chosen. The guarded install
is the permanent shape here, matching the `SuppressedError` precedent (`packages/core/src/suppress.ts`). Full
reasoning and citations in the deferred-items row named above. This item stays **WATCH** only for the narrower
thing it was always about: if a *future* TypeScript or `lib` change makes an optionally-typed declaration
honest on the floor, revisit the typing — never the floor.

### I4 — `SSE-21` hash equality is N/A in JavaScript — **RECORDED**

`SSE-21` mentions value equality and hash. JavaScript does not have language-level hash maps keyed by object
value equality (`hashCode`); value equality is provided via `sseEventsEqual()` (`SSE-21`).

---

## Section J — Phase 6c (Pagination)

All items retired 2026-09-02 — see [Retired items](#retired-items). IDs `J1`–`J8` remain reserved.

---

## Section K — Phase 7a (Configuration & Platform Primitives)

### K1 — `clientIdentityStep` is not reachable from the public barrel — **UNSCHEDULED** (2026-09-02; the stated blocker is gone)

`RECOV-33`'s step is implemented and tested (`config/client-identity-step.ts`), but it is **not** exported
from `packages/core/src/index.ts`. It returns a `StepDescriptor`, and the whole of `pipeline/` —
`StepDescriptor`, `Stage`, `Step`, `StepContext` — is `@internal` and absent from the barrel;
api-extractor rejects a `@public` export whose return type is a forgotten export. The phase design assumed
5c had already promoted the pipeline authoring surface, which has not run. Promoting it is a decision about
4c/5c's surface, not 7a's, so it was left alone rather than widened here. **Trigger:** when the phase that
publishes `StepDescriptor` lands, add `clientIdentityStep`/`ClientIdentitySettings` to the barrel, retag both
`@public`, and regenerate the API report. Until then `NFR-15`'s stamping step is in-package only.

**2026-09-02: "the whole of `pipeline/` is `@internal` and absent from the barrel" is false, and has
been since Phase 5c.** `packages/core/src/index.ts:82-84` exports `Stage`, `Next`, `Step`,
`StepContext` and `StepDescriptor`, and the next line exports `PipelineBuilder` — 5c's Task 16
promotion, which G10 records in detail. So the trigger this row named **has fired**: the phase that
publishes `StepDescriptor` landed, and `clientIdentityStep` was simply not added alongside it.

The same false statement was duplicated in source at `packages/core/src/index.ts:252-253`, 168 lines
below the exports that refute it. Both are corrected.

What is left is a decision, not a blocker: adding `clientIdentityStep` and `ClientIdentitySettings`
to the barrel widens the public surface, which needs sign-off rather than a maintenance pass.
**UNSCHEDULED — trigger: the next deliberate public-surface addition**, which should settle this and
K11's folder question together, as K11 asks.

### K3 — `CFG-12` is documented, not enforced — **WATCH**

"Builders SHOULD be usable single-threaded only" is a JVM statement about publication safety. A
`ConfigurationBuilder` has no cross-thread reachability in this runtime to guard, so the requirement is
carried as a doc comment on the class and nothing more. There is no test, because there is no observable
behavior to assert. **Trigger:** if a worker-thread story ever puts a builder behind `postMessage`.

### K6 — Six defects in the phase plan's own implementation sketches — **WATCH**

The plan doc at `docs/work/mvp/phase7/phase7a/2026-07-28-phase7a-configuration.md` still contains the sketches
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

### K11 — `client-identity-step.ts`'s folder placement is provisional — **UNSCHEDULED** (2026-09-02, with K1)

`RECOV-33`'s step lives at `packages/core/src/config/client-identity-step.ts` because the phase design doc's
File Layout names that path. Two arguments say it is not its long-term home, both recorded here rather than
acted on, because relocating a file into a neighbouring phase's folder on 7a's authority is the same
surface-widening the phase declined to do for K1:

1. **It is the sole outbound `config/ → pipeline/` edge.** Three of its four imports leave the folder —
   `../http/headers.js`, `../http/request.js`, `../pipeline/step.js` — and only `./build-info.js` stays.
   Every other module under `config/` imports nothing beyond `../invariant.js` and `../generated/version.js`.
   The file is grouped by which phase built it, not by feature (`docs/knowledge/harvested/module-organization.md:12`).
   There is no cycle today; the risk is that 5a's `RetryConfig.clock` and 7b's logging step both create the
   return edge, and nothing in CI would catch the loop (see K12).
2. **Its `RECOV-32` sibling would land elsewhere.** The idempotency-key step — the adjacent requirement, the
   same kind of object — is planned for `packages/core/src/recovery/idempotency-key.ts`
   (`docs/work/mvp/phase5/phase5a/2026-07-26-phase5a-retry.md:157,2529`). Two adjacent `RECOV-3x` steps in two
   unrelated folders.

Also noted here, since it is the same class of question: the barrel comment at `packages/core/src/index.ts`
explains the absence of a `config/index.ts`. This repo carries both patterns — `http/`, `body/`, `io/`, and
`seams/` have internal barrels; `pipeline/`, `context/`, and `config/` do not — and so does the knowledge
corpus, where `docs/knowledge/harvested/module-organization.md:18` bans internal barrels outright while
`docs/knowledge/harvested/api-design.md:8` endorses one per feature folder, with nothing in the corpus's
`--section conflicts` reconciling them. 7a followed its design doc, which rules a `config/index.ts` out by
name. ~~**Trigger:** the same phase as K1 — whichever one promotes the pipeline authoring surface.~~ Settle the
file's folder and the barrel question together there, and record the corpus tension at that point.

**2026-09-02: that trigger fired in Phase 5c and nothing happened.** The pipeline authoring surface
was promoted then (`packages/core/src/index.ts:82-86`) — see K1, whose own statement of the blocker
was stale for the same reason. Neither the folder nor the barrel question was settled, and no phase
remains to hand them to.

Nothing has decayed in the meantime: the `config/ → pipeline/` edge is still the only outbound one,
K12's import-cycle gate still does not exist, and `RECOV-32`'s sibling is still planned for
`recovery/`. **UNSCHEDULED — trigger: the same one K1 now carries**, the next deliberate
public-surface addition, which is when `clientIdentityStep`'s home and its export are one decision
rather than two.

### K12 — No import-cycle gate exists in CI — **WATCH** (repo tooling, not this phase)

`docs/knowledge/harvested/module-organization.md:20` treats any import cycle as a bug rather than a style nit, and
`:22` requires it be gated in CI with `madge --circular src` or `eslint-plugin-import/no-cycle` as a required
check. Neither string appears anywhere in `package.json`, `eslint.config.js`, or
`.github/workflows/ci.yml` — verified 2026-08-27. Every other rule in that topic is either enforced or
deliberately deviated from; this one is simply absent, so the repo's twelve-plus source folders rely on
review alone. Deliberately **not** added by Phase 7a: a new blocking CI step is repo tooling, outside a
feature phase's scope, and it belongs with whoever owns `.github/workflows/ci.yml`'s gate list. **Trigger:**
the next phase that touches the CI gate list, or the first observed cycle — K11's `config/ → pipeline/` edge
being the nearest candidate.

### K13 — A `CFG-7`-valid duration can exceed what any timer can honor — **UNSCHEDULED** (2026-09-02; the trigger named a phase that could not fire it)

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

**2026-09-02: "which is Phase 5a's retry engine" is wrong, and nothing else can fire this either.**
`Configuration.getDuration` has **zero non-test consumers** —
`packages/core/src/config/duration.ts:69` says so in a comment of its own — so Phase 5a's retry
engine never wired a configured duration into a timer, and neither has anything since.
`retrySettings` takes numbers from a caller, not from `Configuration`. This row has been waiting on a
hand-off no phase was ever going to make.

The residue is unchanged and still correct to leave: `getDuration` returns `8.64e26` for
`9999999999999999999d` because `CFG-7`'s grammar accepts it, and inventing a rejection rule the
requirement does not state would be the deviation. **UNSCHEDULED — trigger: the first real consumer
of `getDuration`**, which is the layer that knows what it will do with the value.

**What the advice above applied to was found anyway, one layer in** — and then answered from the
other direction. V4 records the defect: a configured retry delay was validated only from below, so an
unwaitable one failed inside the retry loop rather than at the call that supplied it. The fix is not
the `RECOV-34`-style bound this row recommends — V13 made `Clock.sleep` honor any finite duration by
chaining timers, so no unwaitable duration is left to reject. The general lesson stated above (bound
at the configuration boundary, not at the point of use) is sound and simply had no defect left to
apply to.

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

### K19 — No `fast-check` property test logs its seed — **UNSCHEDULED** (2026-09-02; both counts in it were wrong)

`docs/knowledge/harvested/testing.md:44` requires the seed of a failing seeded `fast-check` property test to reach CI
output, "or the shrunk counterexample that found the bug is lost". ~~No `fc.assert` call anywhere under
`packages/core/src` passes a `seed`, `numRuns`, or a `reporter` — verified 2026-08-27 across all 20
`fc.assert` sites, of which Phase 7a contributes 12.~~ A property failure in CI today reports the shrunk
counterexample for that run only; re-running does not reproduce it.

**Both halves of that sentence were wrong (re-measured 2026-09-02).** There are **64** `fc.assert`
sites under `packages/core/src`, not 20 — the count was taken before four phases landed and never
retaken — and **five of them are already seeded** with `{seed: 0x3b}`, added in `e3ba885`: two in
`body/multipart-body.test.ts` and one each in `body/materialize.test.ts`,
`body/request-body-logging.test.ts` and `body/response-body-logging.test.ts`. So the "no call
anywhere" claim was already false when it was written.

That makes the finding *stronger*, not weaker: the repo is in exactly the half-migrated state this
row argues against — five seeded, fifty-nine not — which is the shape
`docs/knowledge/harvested/styleguide-overview.md:32-33` forbids and which the row's own reasoning
("a seeding convention that covers half the suite is worse than none") names as the thing to avoid.

Deliberately **not** fixed by Phase 7a, and deliberately not fixed in this phase's tests alone: a seeding
convention that covers half the suite is worse than none, because the half without it looks deliberate. This
is one repo-wide decision — a shared `fc.configureGlobal({seed, verbose})` in a test preload, or a documented
`FC_SEED` environment convention — and it belongs with whoever owns `bunfig.toml`'s test configuration.
**UNSCHEDULED (2026-09-02) — trigger: the first property failure in CI that cannot be reproduced
locally**, or any deliberate change to `bunfig.toml`'s test configuration. No phase is named: the
roadmap ends at Phase 10 and every phase has shipped.

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

### L1 — Deferred HTTP-Tracer Vocabulary and Transport Policies — **SPLIT 2026-09-02** (OBS-19 **FIXED**; OBS-28 **CLOSED**; OBS-29 **UNSCHEDULED**)

- `OBS-19` (dropped-header verbosity policy): Deferred to Phase 8a alongside the concrete `fetch` transport that first detects unencodable caller-set headers.
- `OBS-28` (richer HTTP-tracer vocabulary with per-attempt and transport milestones) and `OBS-29` (HTTP-tracer lifecycle ordering contract): Deferred to Phase 8a (interface + transport milestones) and Phase 9 (ordering verification). Phase 7b ships operation/attempt-level `startSpan`/`end` (`OBS-21`..`OBS-25`).

**Trigger:** Phase 8a transport adapters and Phase 9 conformance sweep.

**2026-09-02: both named phases shipped without taking any of the three.** A grep for `OBS-29`
across `docs/work/mvp/phase8/` and `docs/work/mvp/phase9/` returns nothing. One row deferring three
requirements to two closed phases is the exact unowned-MUST shape this register exists to prevent, so
the row is split and each requirement is dispositioned on its own.

**`OBS-19` — FIXED (2026-09-02).** Phase 8a's `createDropLogger` had three modes and one level; all
three now emit at the level each requirement names. Retired — see
[Retired rows without an item ID](#retired-rows-without-an-item-id), row `L1 — OBS-19`, and `V1`,
which carries the finding and the `TRANSPORT-13` checklist contradiction.

**`OBS-28` — CLOSED (2026-09-02), satisfied-by-level.** A SHOULD whose own text asks only that every
method default to a no-op so adding an event is non-breaking; the port ships that mechanism. Retired —
see [Retired rows without an item ID](#retired-rows-without-an-item-id), row `L1 — OBS-28`.

**`OBS-29` — UNSCHEDULED, and it is a MUST.** See V2, which carries the full finding.

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

## Section N — Phase 9 (Cross-Cutting Invariants & Conformance)

Findings from the first systematic `XCUT-1`–`XCUT-24` / `NFR-1`–`NFR-17` pass. Every row here was found by
driving the **composed** pipeline (`standardResilience()` over a real `fetchTransport()` against a local
`node:http` fixture), which is the shape no earlier phase's own unit tests exercise.

### N3 — Phase 9's plan asks for a `docs/knowledge/` grep that cannot return empty — **UNSCHEDULED** (2026-09-02)

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

**2026-09-02: Phase 10 did not mark them, and `docs/knowledge/` is now a frozen tree.** Recording a
resolution there is a hand edit to `notes/`, not a maintenance action — and by the corpus's own rule
it belongs in `docs/knowledge/notes/`, never in `harvested/`, since a hand edit inside a harvested
entry changes no `<sub>` sha and the next harvest regenerates or duplicates it. Both markers remain
resolved *by the implementation* and unmarked *in the corpus*. **UNSCHEDULED — trigger: the next
deliberate edit to `docs/knowledge/notes/`, or the next re-harvest**, which is the moment the note
can be written without a lone edit to a frozen tree.

### N4 — `rxjs` version restated in three places against `NFR-14` — **UNSCHEDULED** (2026-09-02)

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

**2026-09-02: Phase 10 shipped without the dependency pass, so the owner is spent.** The finding is
unchanged and the fix is still one catalog entry collapsing the two `devDependencies` restatements.
Not taken in this pass because it changes the lockfile, and a lockfile change wants its own install
and its own verification rather than riding along with a register audit. **UNSCHEDULED — trigger: the
next `rxjs` bump**, which is the moment the three-places cost is actually paid.


## Section O — Knowledge-corpus split (2026-08-31)

### O1 — The `knowledge-harvest` skill's default `--corpus` still points at the tree no query reads — **WATCH**

`docs/knowledge/` is now two trees, `harvested/` and `notes/`, and `bun run knowledge` reads only those two.
The producing skill lives outside this repository (`~/.claude/skills/knowledge-harvest/`, user-global, shared
across projects) and its documented default is `<cwd>/docs/knowledge/`, with its canonical stored-run command
naming `--corpus docs/knowledge`. A run that forgets `--corpus docs/knowledge/harvested` therefore writes a
third copy of the corpus at the root, which no query reads.

Separately, `merge.py` emits a `## Superseded` heading unconditionally and offers `supersede` as one of its
four conflict resolutions. A harvest that writes one into `harvested/` produces an entry the structure gate
rejects, correctly — the resolution has to be hand-moved to `notes/`.

Neither can be fixed from inside this repository. The compensating controls are all here and all blocking:
`verify:knowledge-structure` rejects a `.md` stranded at the root of `docs/knowledge/` and rejects a
`Superseded` entry under `harvested/`, and the invocation is stated in `CLAUDE.md`, `docs/knowledge/README.md`
and the `knowledge-lookup` skill.

**Trigger:** anyone changing the global skill — make `harvested/` its default when the two-tree layout is
present, and stop emitting `Superseded` into a harvest target that has a sibling `notes/`.

### O2 — A note's key citation is checked by a report, not by a gate — **ACT** (2026-09-02; mechanism chosen)

A note names the harvested rule it overrides by that rule's stable key (`<topic>/<8 hex>`, digested from the
entry's text). `bun run knowledge:drift` reports a citation that no entry carries any more, `--key` resolves
one on demand, and a harvested entry that a note overrides prints `[overridden by notes/…]`. None of that is
blocking: a re-harvest that rewords a rule silently breaks every note citing it, and only a hand-run report
says so.

The issue that introduced the split specified three structural rules and this is not among them, so it was not
added unilaterally. Two candidate mechanisms were reviewed:

1. **Fail `verify:knowledge-structure` on an unresolvable key.** Ten lines, no new file, and it makes a
   re-harvest that orphans a note a red build rather than a silent rot. It also means a legitimate re-harvest
   cannot land until the notes it invalidates are updated in the same commit — which is arguably the point.
2. **Commit a key manifest** (`harvested/KEYS.md`) regenerated only by a harvest, and fail when the live key
   set diverges without a matching `SOURCES.md` sha change. This catches strictly more: it detects *any* hand
   edit to harvested text, including one that keeps the role, the section and the source and so passes all
   four current rules. Cost is a new generated artifact and a coupling to a skill this repo does not own.

**2026-09-02: mechanism 1 is chosen; implementing it is not part of this pass.** Extend
`scripts/verify-knowledge-structure.mjs` to fail on a note carrying a backticked `<topic>/<8 hex>`
key that no harvested entry carries. Ten lines, no new file, no new artifact, and it uses the parser
that gate already loads. Mechanism 2's key manifest was rejected on cost: it commits a generated
artifact and couples this repository to a skill it does not own, to catch a strictly larger class
(any hand edit to harvested text) that `verify:knowledge-structure`'s four existing rules and the
`harvested/`-is-never-hand-edited convention already discourage.

The consequence mechanism 1 carries is the point rather than an objection: a legitimate re-harvest
cannot land until the notes it invalidates are updated in the same commit.

**Trigger:** the next re-harvest, or the next deliberate change to `scripts/verify-knowledge-structure.mjs`.
Until then `bun run knowledge:drift` is the check, and it is named in the phase-start section of the
`knowledge-lookup` skill.

## Section P — Phase 5a (Retry)

> **Merged 2026-08-31 from the repository-root `open-items.md`.** Phase 5a's code review (passes 1–3,
> 2026-08-26) wrote its findings to a second register at the repository root, created in `cba4721` and never
> folded in — which is exactly the gap this file's own preamble named ("Two phases are shipped but were never
> registered here: 4c and 5a"). The root file is deleted; its nine findings are below, numbered `P1`–`P9`,
> text unchanged apart from the heading form and the status word. Its own status legend was
> 🔴 defect, owner named — 🟡 accepted limitation — 🟢 correct, documented to stop a future "fix" —
> 📄 documentation drift; each is restated in this register's vocabulary in the heading, with the original
> `**Owner:**` line kept intact.
>
> **Every item was re-verified against as-built source on 2026-08-31** before being merged, per this file's
> maintenance rule. Eight still hold. One (`P9`) had been closed by Phase 7b and is marked so.
>
> Findings that *were* fixed in 5a are not listed — they are in the code and its tests.

### P3 — `RetrySettings.retryableStatuses` is immutable by type, not at runtime — **WATCH**

**Where:** `packages/core/src/retry/settings.ts`

`retrySettings()` returns `Object.freeze({...})`, but freeze is shallow and does not seal a `Set`'s
internal slots: anyone holding the settings object can still call `.add()` on the status set and
change policy for every later call.

`RECOV-34`'s actual requirement — a *defensive copy* so a caller mutating **their own** source
collection cannot alter policy — is satisfied and tested. What is not achievable is `RETRY-42`'s
"immutable after construction" as a runtime guarantee.

This is a deliberate house position, not an oversight: `config/retryable.ts` records it — *"`Object.freeze`
does not seal a `Set`'s internal slots, so a frozen `Set` would be a misleading no-op — typed
`ReadonlySet` instead, same treatment as Phase 1's `IDEMPOTENT_METHODS`."* A genuine runtime guarantee
would need a wrapper object with no mutators, which changes the shape every consumer reads.

**Owner:** none. Recorded so the gap between the type-level and runtime guarantee is not rediscovered
as a bug.

**Re-verified 2026-08-31:** unchanged. `packages/core/src/retry/settings.ts:104-106` still returns
`Object.freeze({… retryableStatuses: new Set(merged.retryableStatuses)})`, and freeze does not seal a `Set`'s
internal slots.


### P4 — `RETRY-18`'s 365-day pacing ceiling is spec-mandated and operationally hazardous — **UNSCHEDULED** (2026-09-02; and the described behaviour is not what happens)

**Where:** `packages/core/src/retry/pacing.ts`

A server that sends `X-RateLimit-Reset` in **milliseconds** instead of epoch seconds — a common
server-side mistake — produces a delta of roughly 56,000 years. `RETRY-18`/`RECOV-26` require
clamping to a 365-day ceiling, so the parser returns exactly that: a retry parked for a year, which
is indistinguishable from a hang.

Nothing shortens it by default. `totalTimeoutMs` would, but `RETRY-28` makes it explicitly opt-in and
it is `undefined` by default. The caller's own `AbortSignal` is the only other exit.

Implementing a tighter ceiling would be a deviation from a MUST, so the port complies. Recorded
because "spec-compliant" and "safe by default" diverge here, and the mitigation (set
`totalTimeoutMs`) is a caller decision that needs documenting when the retry surface is finally
published in Phase 5c.

**Owner:** Phase 5c, as a documentation obligation on the public retry surface.

**Re-verified 2026-08-31: the Phase 5c documentation obligation was not discharged.** `MAX_PACING_MS` is
`packages/core/src/retry/pacing.ts:13-14`, commented as the `RETRY-18`/`RECOV-26` ceiling.
`RetrySettings.totalTimeoutMs`'s TSDoc (`settings.ts:22-27`) documents the opt-in and `RETRY-28`'s reasoning
but says nothing about the year-long park it mitigates, and neither does `retryStep`. Owner is now unassigned
— Phase 5c is closed. **The work is a TSDoc paragraph on `totalTimeoutMs` naming the failure mode.**

**2026-09-02: "a retry parked for a year" is not what happens, and the truth is a separate defect.**
`MAX_PACING_MS` is 31,536,000,000 ms; `Clock.sleep`'s `MAX_SLEEP_MS` is 2,147,483,647 ms — the
clamped hint is **fourteen times** the longest delay the platform can honor, so `waitFor` reaches
`sleep`, `sleep` rejects with an `InvariantViolation`, `waitFor` re-throws it (the signal is not
aborted), and the loop's `catch` returns `failure(InvariantViolation)`. The operator gets an
assertion failure naming the ceiling, not a hang. Measured 2026-09-02 against
`packages/core/src/retry/pacing.ts:14,25` and `packages/core/src/config/clock.ts:65,75`. Recorded as
V13, which is the defect; this row is the documentation obligation.

**UNSCHEDULED — trigger: the next deliberate edit to `RetrySettings`'s TSDoc.** The owed paragraph
changed twice in one day. It is not "this can park for a year"; it was briefly "a hint above ~24.8
days fails the call"; and since V13 made `Clock.sleep` chain timers it is back to the original
hazard, now real rather than theoretical: **a server-sent pacing hint clamped to `RETRY-18`'s
365-day ceiling is genuinely waited**, and `totalTimeoutMs` is the only thing that shortens it.


### P5 — `parsePacingHint` reads only the first value of a repeated header — **WATCH**

**Where:** `packages/core/src/retry/pacing.ts`

`Headers.get()` returns the first value. Given `Retry-After: garbage` followed by `Retry-After: 5`,
the parser tries `garbage`, fails, falls through the remaining header names, and returns `null` — no
hint, fall back to backoff — rather than trying the second value.

Safe (`RETRY-16`'s fallback is the conservative answer) and arguably correct, since a repeated
`Retry-After` is malformed to begin with. `RETRY-21`'s precedence is defined across header *names*,
not across duplicate values of one name, so nothing requires the second value to be tried.

**Owner:** none. Recorded because "first usable value wins" reads, on a fast skim of `RETRY-21`, like
it should scan duplicates too.

**Re-verified 2026-08-31:** unchanged.


### P6 — A fixed delay is deliberately not clamped to `maxDelayMs` — **WATCH**

**Where:** `packages/core/src/retry/backoff.ts`

`computeDelay` returns `fixedDelayMs` before the cap is applied, so `fixedDelayMs: 3_600_000` with
`maxDelayMs: 8000` waits an hour. This looks like a missed clamp and is not: `RETRY-43` describes the
mode as *"zeroing the base and cap so only the fixed delay applies"* — the cap is part of the schedule
this mode replaces, not a bound that outlives it.

Documented in the field's own TSDoc. Listed here so a future reviewer reaches the reasoning before
"fixing" it.

**Re-verified 2026-08-31:** unchanged. `packages/core/src/retry/backoff.ts:73` still returns
`settings.fixedDelayMs` before the cap is applied.


### P7 — A response that ends the retry loop is handed over live, not closed — **WATCH**

**Where:** `packages/core/src/retry/engine.ts`

`RETRY-32` says *"any response that arrives from an already-in-flight attempt MUST be closed rather
than leaked."* The engine closes every response it **discards**. A response that survives the gates —
attempt cap reached, budget spent, status not retryable — is returned **live and unread**, even when
the caller has already aborted.

That is not a leak: ownership transfers to the caller, which is the only reader that could close it,
and a `Promise` always resolves to its awaiter, so this port has no "value that can never be
delivered" case for the reference's orphan rule to bite on. Both halves are asserted.

The narrowing is inseparable from `RETRY-36`'s disposition (`toHttpError` drains the body and drops
the headers irreversibly, and 4c's pillar signature must return a `Response`), which the phase design
already ledgers.

**Re-verified 2026-08-31:** unchanged.


### P8 — The Phase 5a design doc overstates the `RETRY-32` guarantee — **UNSCHEDULED** (2026-09-02)

**Where:** `docs/work/mvp/phase5/phase5a/2026-07-26-phase5a-retry-design.md`, "The wait"

> `RETRY-32`: once the caller's signal is aborted the driver launches no further attempts, and any
> response arriving from an in-flight attempt is closed rather than leaked.

The second clause describes only responses the engine discards — see the item above. The
implementation checklist carries the corrected wording; the design doc still carries the blanket
claim, and was left alone because it is a phase design of record, not a working document.

**Owner:** Phase 9 (cross-cutting conformance), which reads these documents as its source.

**Re-verified 2026-08-31:** unchanged. The blanket claim is still at
`docs/work/mvp/phase5/phase5a/2026-07-26-phase5a-retry-design.md:357`. The design is a dated record and is not
retro-edited, which is why this item exists instead of an edit; what is owed is a correction *note*, not a
rewrite. Phase 9 is closed, so the owner is now unassigned.

**2026-09-02: the correction note is this item**, and that is the whole of what is owed. A reader who
reaches the design doc's blanket claim and does not reach this register is the failure mode, and the
only fix for it that does not retro-edit a dated record is a pointer from the checklist — which
already carries the corrected wording. **UNSCHEDULED — trigger: any future reader citing
`docs/work/mvp/phase5/phase5a/…-design.md:357` as evidence of `RETRY-32`'s scope.** P7 carries the
accurate statement.


## Section Q — Phase 3b validation review (2026-07-28)

> **Relocated.** A validation pass over Phase 3b's design and plan **before** either was executed. Relocated verbatim on
2026-08-31 from the roadmap's `## Open Findings — Phase 3b Validation Review (2026-07-28)` section. Its rows
are labelled `D1`, `D2` — the review's own numbering, not this register's item IDs.

A validation pass over `specs/2026-07-25-phase3b-body-lifecycle-design.md` and
`plans/2026-07-25-phase3b-body-lifecycle.md` (`docs/validation-prompts/phase3b-body-lifecycle-validation-prompt.md`)
returned **BLOCKED** on two runtime defects and a cluster of overclaimed disposition rows. **All findings except
D1 and D2 below are applied** to both documents. Recorded here rather than in `docs/deferred-items.md` because
these are review findings against an unexecuted phase, not deferrals of work.

The two blockers, both now fixed, are worth naming since they generalize: (1) `ReadableStream.cancel()` rejects
with `TypeError` on a locked stream and reading to `{done: true}` does **not** release the reader's lock, so
`Response.bytes()`, `toHttpError()` and the response-logging wrapper each had a `finally`-scoped close that
replaced a successful read with a `TypeError` — a `reader.releaseLock()`-before-cancel constraint now sits in the
plan's Global Constraints, and **every later phase that takes a reader and later closes the stream inherits it**;
(2) `HTTP-39`/`BODY-10`'s exact-length copy was dispositioned as "reuses Phase 3a's `writeAll`" while the plan's
own global constraint forbids importing `BufferedSink`, leaving a declared `contentLength` unverified and a short
stream sending a truncated body silently.

All rows retired 2026-09-02 — see [Retired items](#retired-items). Row IDs `Q.D1` and `Q.D2` remain
reserved and still resolve from a citation written `open-items.md Q.D1`.

**Applied without needing a decision** (recorded so the reasoning survives): `BODY-34`'s "one shared cap"
contradiction resolved in the plan's favour — the shared preview cap covers the two logging tees, and
`toHttpError`'s 1 MiB cap is separate because `HTTP-52` *fixes* its value and a spec-fixed value cannot be the
configurable one; `BODY-26`/`BODY-29` built (`LoggedResponseBody` gained a non-draining `error()` and a
regime-dependent `contentLength`); `BODY-25` ledgered as structurally inapplicable — `ReadableStreamDefaultReader`
takes no requested count, so "zero bytes for a positive count" has no analog; `BODY-32`'s negative-cap rejection
added to both tees, which previously accepted a negative cap and silently mirrored nothing; `HTTP-3`'s
`MultipartBodyBuilder` added (`HTTP-3` names "the multipart body" explicitly and Phase 1 could not satisfy it);
`HTTP-2` honored by exporting the concrete body classes from the public barrel as **types only**; the `@internal`
tags removed from the three errors Task 13 promotes, which would have made `api-extractor` either fail or
silently omit them; `withResponseLogging` decomposed under the 70-line cap and made pull-driven, since its
`start()`-loop tail stream eagerly materialized the whole remainder of exactly the oversized bodies the cap
exists to keep off the heap.


## Section R — Phase 3b execution (2026-08-25, expanded 2026-08-26)

> **Relocated.** What Phase 3b's execution found once the code existed. Relocated verbatim on 2026-08-31 from the roadmap's
`## Open Findings — Phase 3b Execution` section. Its rows are labelled `E1`–`E7` — the review's own
numbering, not this register's item IDs.

Findings that surfaced only once Phase 3b's plan was actually executed, across three review passes. Nearly all
are **checkpoint-owned**, not 3b-owned: the 3b design took the checkpoint
(`plans/2026-07-25-checkpoint-scaffold-through-phase3a.md`) as a signed-off prerequisite, and it has not run.
Every box in that document is unchecked and no commit implements it.

### Why nobody noticed: the checkpoint was cherry-picked, not skipped

The more useful framing than "the checkpoint did not run" is that **parts of it did**, which is exactly what made
the 3b plan's prerequisite claim plausible to whoever wrote it. Measured status of every `§5` item as of
2026-08-26:

| § | Item | Status |
|---|---|---|
| 5.1 | Coverage floor as a *blocking* gate | **Done** — `bunfig.toml` carries `coverage = true`, `coverageThreshold = 0.8` |
| 5.2 | Flatten the `DomainModelError` tier | **Open** — E2 below |
| 5.3 | Error leaves carry identifying `readonly` fields | **Partial** — 2 of 10; E3 below |
| 5.4 | `Symbol.asyncDispose` + floor bump + `lib` entry | **Open** — `R.E1`, retired |
| 5.5 | Bounded collections vs `RetentionWindow`/tap | **No action needed** — confirmatory in the checkpoint itself |
| 5.6 | `AbortSignal.any` composition | **No action needed** — confirmatory |
| 5.7 | Flat hoisting lets a package resolve an undeclared dependency | **Open** — E4 below |
| 5.8 | `NFR-14`'s stale "no direct Bun equivalent" reason | **Resolved in Phase 6a (2026-08-27)** — `R.E7`, retired |
| 5.9 | `bun test` proves nothing about the Node runtime | **Done 2026-08-26** — `R.E5`, retired |
| 5.10 | Per-class `#private` justification comments | **Open** — `R.E6`, retired |
| 5.11 | Phase 4 pre-commitment: `Stage` must not be an `enum` | Not yet due (Phase 4) |
| 5.12 | Tooling conflicts already resolved by the plans | Recorded only |

Partial application is worse here than none at all. `§5.1` is visible in `bunfig.toml` and half of `§5.3` is
visible in `errors.ts`, so a reader checking whether the checkpoint had landed would have found evidence that it
had. **Verify a prerequisite against the artifact it was supposed to produce, not against a spot check.**

| # | Sev | Finding | Where | Resolution |
|---|---|---|---|---|
| E2 | major — **UNSCHEDULED 2026-09-02, checkpoint §5.2. And now understated: Phase 8a ADDED a third-level branch this row says `io/` no longer contributes — `TransportFailureError extends IoError` (`packages/core/src/io/errors.ts:126`). `docs/deviations.md` §17 argues that one is uncorrectable (`TRANSPORT-20` requires the subtyping, and `classify.ts`'s cause-walk is load-bearing on it), so the tier question is two-sided rather than one. See V3. Trigger: the pre-publish breaking-change batch that also decides `DomainModelError`'s tier — the row `docs/deferred-items.md` carries for it.** | 3b's Task 1 flattened `io/`'s four error leaves off `IoError` on the stated basis that checkpoint §5.2 had already flattened Phase 1's `DomainModelError` tier. It had not, so the taxonomy is now *mixed*: `DexpaceError → EndOfStreamError` is two levels while `DexpaceError → DomainModelError → RequiredFieldError` is still three | `packages/core/src/http/errors.ts`; 3b design §"Error Tree" | **Deliberately not fixed in 3b.** Removing `DomainModelError` deletes a class exported from the public barrel that consumers can `instanceof` — a breaking API change belonging to the checkpoint. The residual is strictly smaller than what preceded it (`io/` no longer adds a second independent violation) and is recorded in 3b's ledger and checklist. **Blast radius, measured:** ten leaves extend it — `RequiredFieldError`, `HeaderValidationError`, `MediaTypeParseError`, `ProtocolParseError`, `UrlConstructionError`, `RequestOptionsValidationError`, `EtagParseError`, `HttpRangeValidationError`, `RequestConditionsValidationError`, `RequestBodyNotAllowedError` — all in one file, and `DomainModelError` itself is a runtime value export, so `instanceof` narrowing on it is live public API. §5.2 pre-specifies the replacement (an exported `isDomainModelError` type-guard union, never a re-subclass), and 3b already proved that pattern twice in-tree with `isIoError` and `isBodyError`. **Sequencing:** §5.2's own note — "Phase 4's error families then land as leaves on `DexpaceError` too, which is what keeps the flattening from being undone one phase later". **Ten queued phases introduce new SDK error types** — 4a (`DuplicateContextKeyError`), 4c (five, including `PillarCollisionError`, `CrossStageEditError`, `ReservedStageError`), 5b (`NonReplayableBodyError`, `SchemeDowngradeError`), 5c (`AuthResolutionError`, `PlaintextCredentialError`, `DigestChallengeUnsupportedError`), 6a (`SerdeError`, `SerializationError`, `DeserializationError`), 6b (`SseStreamError`, `SseLineTooLongError`), 6c (`PaginationError`), 8a (`TransportFailureError`), and 5a/8b, which reuse rather than define. Counted from the phase design docs 2026-08-26; 4b and 7a/7b define none. Every one of those that ships before the flatten is another tier decision taken against the wrong parent. Owned by checkpoint §5.2 |
| E3 | major — **OPEN, checkpoint §5.3** | §5.3 requires every error subclass to carry its identifying inputs as sanitized `readonly` fields, because `JSON.stringify(error)` and structured-log field enumeration bypass `.message` entirely. It was applied to **two** leaves and stopped: `RequiredFieldError` carries `fieldName`, `HeaderValidationError` carries `kind` + `escapedName`. The other **eight** carry nothing — their identifying data exists only interpolated into the message string, which is precisely the shape the rule forbids. Not raised by any of Phase 3b's three review passes either; found only when the checkpoint was audited item by item | `packages/core/src/http/errors.ts` | **Open.** Same file and same ten classes as E2, so doing §5.2 and §5.3 in one pass is strictly cheaper than two. §5.3 also specifies the sanitization shape per leaf: the offending *name* control-character-escaped, the offending *value* never stored raw (a `valueLength`, a masked minimum fragment, or no field at all), and for `MediaTypeParseError` the failing token/offset rather than the full input. It further asks for a file comment on `errors.ts` recording *why* fields are sanitized at construction — that comment is what stops a later contributor "restoring" the raw value |
| E4 | major — **OPEN, checkpoint §5.7** | No isolated linker is configured. `bunfig.toml` carries only a `[test]` block and there is no `.npmrc` at all, so the install is flat-hoisted by default. Under flat hoisting `@dexpace/core` can import a package it never declared and still pass every gate — including `verify:seam-1`, which reads the `dependencies` map rather than what the code actually resolves. That is the one phantom-dependency failure mode `SEAM-1`'s gate structurally cannot see | `bunfig.toml` (no linker key); no `.npmrc`; `scripts/verify-seam-1.mjs` | **Open.** §5.7 requires confirming the exact linker option against the pinned Bun version before writing it. Low effort, and it strengthens a `SEAM-1` guarantee the project treats as foundational |

Five rows retired 2026-09-02 — `E1`, `E5`–`E8`; see [Retired items](#retired-items). Their IDs remain
reserved.

### Phase-3-owned residuals

Distinct from the checkpoint items above: these belong to Phase 3 itself and are recorded in its ledger and
checklist rather than being anyone else's to close. **Marks re-derived against the tree 2026-09-02**; the four
that had shipped are retired to [Retired rows without an item ID](#retired-rows-without-an-item-id) as
`R — residual: …` rows. Two remain.

| Item | Level | Disposition |
|---|---|---|
| Multipart boundary **non-appearance** in part content | `HTTP-51`, ⚠️ partial | RFC 2046 puts two duties on the sender; only the `bchars` grammar half is checkable here, because a `StreamBody` part's bytes do not exist until the write and a partial scan would read as a complete guarantee. Mitigated by generating a 32-character Web Crypto boundary by default and documenting the obligation on both caller-supplied entry points. Revisit only if demand for caller-chosen boundaries appears |
| `StreamBody` always single-use, no mark/reset | `BODY-9` (SHOULD), bounded | Node's `ReadableStream` has no generic mark/reset. Closes only if the platform gains one |

Also worth carrying forward, since three separate defects in 3b traced to the same root: **a `Body`/sink decorator
must forward BOTH teardown paths.** A `WritableStream` adapter that declares `write` and `close` but no `abort`
silently swallows the delegate's abort — the default abort algorithm is a no-op — leaving the real sink open and
locked and letting a truncated body be committed downstream as a complete one. Likewise `pipeTo`'s default
`preventCancel: false` cancels the *source* when the destination fails, which takes cancellation ownership away
from the caller (`BODY-8`). Phase 4c's stage pipeline and Phase 8a's transports both wrap sinks; both inherit this.


## Section S — Phase 4b validation review (2026-07-28)

> **Relocated.** A validation pass over Phase 4b's design and plan before execution. Relocated verbatim on 2026-08-31 from
the roadmap's `## Open Findings — Phase 4b Validation Review (2026-07-28)` section.

**Its rows are `F1`–`F10`, the review's own numbering.** Section F above numbers *its* items `F1`–`F9`, and
Section T below numbers a different review's rows `F1`–`F9` again. Three `F` namespaces, no overlap in
meaning. A citation must name the section — "Section S's F2", never a bare "F2". Renumbering was rejected:
the roadmap's own status notes cite "4b's F2/F7" by these numbers, and a dated record that changes its row
IDs stops matching the documents that quote it.

A validation pass over `specs/2026-07-25-phase4b-recovery-chain-design.md` and
`plans/2026-07-25-phase4b-recovery-chain.md` (`docs/validation-prompts/phase4b-recovery-chain-validation-prompt.md`)
returned **BLOCKED**. The `RECOV-1`–`RECOV-16` mapping itself is sound and every cross-phase reference 4b consumes
checks out against the earlier phase plans — `toHttpError(): Promise<HttpStatusError | null>` (3b), `RequestOptions.EMPTY`
(Phase 1), `Transport.send(request, options?, signal?)` + `CancellationError` (Phase 2), and `Response.close()` latching
`#closed` *before* awaiting `body.cancel()` so it propagates a close rejection exactly once (3b). Nothing below is a
defect in that mapping. Recorded here rather than in `docs/deferred-items.md` because these are review findings against
an unexecuted phase, not deferrals of work.

**All ten rows are retired 2026-09-02** — `F1` and `F2` closed, `F3`–`F10` applied to the 4b documents; see
[Retired items](#retired-items). Row IDs `S.F1`–`S.F10` remain reserved and still resolve from a citation
written `open-items.md S.F8`. `F1`'s resolution is the runtime-guarded `suppress()` helper
(`packages/core/src/suppress.ts`); read it before designing against `SuppressedError` anywhere, because
`esnext.disposable` in `lib` supplies `Symbol.asyncDispose`'s *type* and not `SuppressedError`'s *runtime*.

**Corpus conflict surfaced, not a finding.** `function-design.md:22-23` requires an options object at 3+ parameters
while `function-design.md:40-41` sets `max-params: ['error', 3]`, which errors only at four — the prose is one
parameter stricter than its own stated enforcement. F9 is filed against the prose; if the lint threshold is the
authority, F9 dissolves. Worth settling in the corpus rather than per-phase.
→ **numbered 2026-09-02 as V11**, and given a disposition. "Worth settling" with no owner and no
trigger is how a finding sits unsettled for five weeks; V11 states which of the two the repository
actually follows and what would change it.

A second conflict the 4b documents met and resolved correctly, recorded so a later reader does not re-litigate it:
`resource-management.md:4-5,72` mandates `using`/`await using` and documents that native disposal builds a
`SuppressedError` with the *disposal* failure primary, while `RECOV-12` requires the opposite priority. 4b picks
`RECOV-12` and argues it at SPEC:107-113 / PLAN:55-59. Correct call, already justified in-document.


## Section T — Phase 4c validation review (2026-07-29)

> **Relocated.** A validation pass over Phase 4c's design and plan before execution. Relocated verbatim on 2026-08-31 from
the roadmap's `## Open Findings — Phase 4c Validation Review (2026-07-29)` section. **Its rows are `F1`–`F9`,
the review's own numbering** — see the namespace note on Section S.

A validation pass over `specs/2026-07-25-phase4c-stage-pipeline-design.md` and
`plans/2026-07-25-phase4c-stage-pipeline.md`
(`docs/validation-prompts/phase4c-stage-pipeline-validation-prompt.md`) returned **NEEDS WORK — no blockers.**
The `PIPE-1`–`PIPE-40` mapping is sound and every cross-phase reference 4c consumes checks out against the earlier
phase plans: `Transport.send(request, options?, signal?)` + `close()` (Phase 2), `DexpaceError` as the taxonomy
root under `http/errors.ts` (Phase 2's retrofit), `RequestOptions.EMPTY` (Phase 1), `Status.of`/`Protocol.HTTP_1_1`
(Phase 1), and 4a's `createRequestContext(request, init?)`, `promoteToRequest`/`promoteToExchange`,
`ContextStore.install/get/close/clear/size` with the `kind`/`key`/`request`/`instrumentation`/`operationName`
context shape. Nothing below is a defect in that mapping.

**All nine rows are retired 2026-09-02** — `F1`–`F8` applied to the 4c documents, `F9` fixed to its own
option (a); see [Retired items](#retired-items) and `V15`. Row IDs `T.F1`–`T.F9` remain reserved and still
resolve from a citation written `open-items.md T.F9`.

**Not findings, recorded so they are not re-raised.** Assertion density (`assertions.md:6-7`) is already open
project-wide as 4b's F2 — 4c is the phase that *satisfies* it, not one that violates it. `STAGE_ORDER` and
`PILLAR_STAGES` in `CONSTANT_CASE` sit against `naming-conventions.md:14`, whose worked example is literally a
module-level `new Set(...)` staying `lowerCamelCase` because its contents can mutate; a `ReadonlySet` type does
not make the underlying `Set` deeply immutable and `Object.freeze` cannot fix a `Set`. Left alone because the
casing question is project-wide (Phase 1's `Protocol`/`Status` statics, 4b's constants) and renaming one phase's
two constants would fork the convention rather than settle it — Phase 10's reconciliation owns it.

**Re-deferred 2026-08-30 (Phase 10): NOT SCHEDULED.** Phase 10 does not own it and did not settle it. The
`CONSTANT_CASE`-vs-`lowerCamelCase` question for module-level immutable collections is a naming-convention
call, not a deviation from the reference contract, so it is outside a reconciliation phase's scope; Phase 10 is
also the last row of the phase table, so there is no later phase to hand it to and none is invented here. The
state is unchanged and still consistent within itself — `STAGE_ORDER` and `PILLAR_STAGES` remain `CONSTANT_CASE`
and remain the pipeline's only such pair (`packages/core/src/pipeline/builder.ts:12`, `:179`, `:248`, `:269`).
**Trigger:** the next module-level immutable collection added outside `pipeline/`, which would make the fork
visible in a third place and force the choice — or a naming-convention sweep commissioned as its own phase.
Logged in `docs/deferred-items.md` so it is tracked rather than silent.


## Section U — Documentation restructure (2026-08-31)

Found while giving `docs/` a stated structure: three frozen trees, a `work/` tree of process records, an
as-built `sdk-documentation/` tree, and three registers at the root. Everything below is a consequence of
that pass, not of a phase.

### U4 — `docs/deviations.md` is keyed to a file inside a frozen tree — **WATCH**

`docs/deviations.md` states its own coupling: "§10 is the owner of the item numbers… **If §10 renumbers,
this file must be renumbered in the same commit.**" §10 is
`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, which now sits in a tree
the housekeeping skill refuses to write to.

That is the right arrangement — the normative ledger should not be edited by a maintenance tool — but it
means the two halves of one numbering scheme are now on opposite sides of a freeze boundary, and only one of
them can be repaired by the tool that notices the drift. Nothing checks that the two agree.

**Trigger:** the next deviation added to §10, which is a hand edit by definition, and must carry the matching
`docs/deviations.md` edit in the same commit.

### U5 — `CLAUDE.md` and `README.md` have no gate, and had drifted for nine phases — **WATCH**

Measured on `f93ccd9`, before this pass: `CLAUDE.md` claimed "two published packages today" against 9
publishable and 2 private; its API section named 2 committed reports against 9; its gate list omitted
`verify:sse-37`, a blocking CI step; and its documentation-hierarchy table omitted `docs/open-items.md`, the
largest file in the tree. `README.md` was two lines and misspelled "platform".

Every one of those is checkable against the repository in a few lines of script, and the `housekeeping`
skill's probe stage now does check them (`.claude/skills/housekeeping/probe.mjs`). It is deliberately **not**
a CI step — it is a hand-run tool, like `bun run test:scripts` was before Phase 10 promoted it.

**Trigger:** the same drift recurring after a phase lands. The probe existing is not the same as the probe
being run; if it recurs, the answer is a blocking CI step, and the precedent for promoting one is `test:scripts`
(open-items H13).

**The skill's own tests are not run by any CI step either.** How many is not written here — U10's
rule, applied: `node --test .claude/skills/housekeeping/*.test.mjs` reports it. It read **78** on
2026-09-02 before this pass added four, and **82** after; this row said 77 and U11 said 75, so two
rows of one register carried two different wrong counts of one thing. `package.json`'s `test:scripts`
globs
`scripts/*.test.mjs`, and these live in `.claude/skills/housekeeping/`. Promoting them is a one-line glob
change; the argument for it is H13's, exactly — a gate whose own logic degrades still exits 0, so nothing
else in the run notices. Not done here because wiring this skill into CI was explicitly out of scope for the
change that added it. Run them by hand with `node --test .claude/skills/housekeeping/*.test.mjs`.

## Section V — Register audit (2026-09-02)

A pass over all 21 preceding sections against the working tree at `b040968`, verifying every claim
rather than trusting the item's own text. Most of what it found belongs in the items themselves and
is recorded there as a dated note. What is below is what had **no item to belong to**: findings the
earlier reviews stated as prose without an ID, defects nobody had registered at all, and two places
where the register contradicted itself.

**Why a new letter rather than edits in place.** An item ID is permanent and is cited from source, so
a finding without one cannot be cited, cannot be closed, and does not appear in the section index.
Six of the fifteen below existed as prose in Sections Q, R, S and T; the prose is left where it is
with a one-line pointer, and the finding is here.

The audit's own driving observation, which is not a numbered item because it is a pattern rather than
a defect: **a phase closes, and the items naming it as owner keep the name.** Twenty items named a
phase that had shipped without doing the work. The roadmap's phase table ends at Phase 10 and Phase
10 is executed, so there is no phase to hand them to and none is invented — hence the `UNSCHEDULED`
status this section adds to the vocabulary above, which carries a `trigger:` instead of an owner.

---

### V2 — `OBS-29` is an unimplemented MUST with no owning row — **UNSCHEDULED** (2026-09-02)

The one finding in this audit that is a MUST rather than a mismatch.

`docs/product-spec/15-instrumentation-and-observability.md:54` requires an HTTP-tracer lifecycle:
`operationStarted` once at the start; `operationSucceeded` and `operationFailed` mutually exclusive
and each once at the end; attempt events any number of times; retries-exhausted immediately followed
by `operationFailed` with the same throwable; and **one tracer instance per logical operation**.

`packages/core/src/observability/tracing.ts:40-42` declares `Tracer` with exactly one method,
`startSpan(name: string): Span`. None of that vocabulary exists under those names.

**L1 deferred it to Phase 8a and Phase 9. Both shipped; neither took it.** A grep for `OBS-29` across
`docs/work/mvp/phase8/` and `docs/work/mvp/phase9/` returns nothing. An unimplemented MUST sitting
behind a marker that points at two closed phases is precisely the failure this register exists to
prevent, which is why it gets its own letter rather than staying inside L1.

**What the port does have.** A span is started once (`observability/logging-step.ts:427`) and ended
once, on exactly one of two paths: `span.end()` for success (`:398`), or
`span.recordException(error)` then `span.end()` for failure (`:414-415`). That is start / succeeded /
failed, in order, mutually exclusive, once each — the ordering half of `OBS-29`, under different
names.

**What it does not have, and this is the part that decides the question.** `PIPE-2` fixes the
`LOGGING` pillar step *inside* the `RETRY` and `REDIRECT` pipelines, so `startSpan` runs **per
transmission attempt and per redirect hop**, not once per logical operation. L4 records exactly that.
`OBS-29`'s "one tracer instance corresponds 1:1 to a single logical operation" is therefore not
satisfied by the span-per-attempt shape, and the per-attempt and retries-exhausted events have no
place to attach.

**One mitigating datum, which the appendix supplies and the chapter does not.** Appendix C's own
entry for `OBS-29` (`appendix-c-consolidated-normative-requirement-index.md:509`) ends: "This is a
documented emission contract; pipeline/transport wiring to emit it is a follow-up, so it is not yet
runtime-enforced." The spec anticipates the wiring lagging the contract.

**Decided 2026-09-02: BOTH halves, separately** — the shape is recorded as a deviation, and the
missing wiring stays open. They are different claims and collapsing them into one row is what let
this sit behind two closed phases in the first place.

**The shape is a `deviations.md` row**, under "Deviations recorded outside a phase": span-shaped
tracing carries `OBS-29`'s ordered started/succeeded/failed lifecycle, and the row states plainly
that the **1:1 tracer-to-logical-operation binding is not met**, because `PIPE-2` puts the span
inside the RETRY/REDIRECT pillars. A reader who finds only that row must not come away thinking the
requirement is covered, which is why the row says which half it is not claiming.

**The wiring stays here. UNSCHEDULED — trigger: the follow-up wiring appendix C `:509` names — an
outermost per-operation span opened by the client entry point, outside the pillars.** That is the
only shape that satisfies the 1:1 binding without moving the `LOGGING` step out of the pillars, which
`PIPE-2` fixes. Not implemented in this pass: it is new observability surface, not a repair.

---

### V3 — Phase 8a added a third error tier that Section R's `E2` says `io/` no longer contributes — **UNSCHEDULED**

`R.E2` records that 3b flattened `io/`'s leaves off `IoError`, leaving `DexpaceError → DomainModelError
→ RequiredFieldError` as the only three-level branch. `packages/core/src/io/errors.ts:126` is
`TransportFailureError extends IoError`, added by Phase 8a — a second three-level branch, in the very
folder `R.E2` says stopped contributing one. Nothing in this register recorded it.

**It is not unrecorded everywhere.** `docs/deviations.md` §17 covers it and argues it is
**uncorrectable**: `TRANSPORT-20` requires `TransportFailureError` to *be* an `IoError`, and
`classify.ts`'s cause-walk returns retryable for any `IoError`, so the `extends` is what makes a
no-response transport failure retryable with no edit to the retry layer. A flat sibling would have to
be enumerated by hand in the classifier, and again for every transport added later.

So the finding is not "an unrecorded deviation" but **a register that contradicts itself across two
files**: `deviations.md` §17 holds the tier at exactly three and argues for it; `open-items.md`'s
`R.E2` still describes a taxonomy with one such branch.

**UNSCHEDULED — trigger: the pre-publish breaking-change batch that also decides `DomainModelError`'s
tier** (the row `docs/deferred-items.md` carries for it). Both questions are the same question and
both are breaking; `@dexpace/core` is `0.0.0` and that batch is the last moment either is free.
`R.E2` is annotated to point here.

---

### V11 — Section S's corpus conflict declines to be a finding, and has sat unsettled since 2026-07-28 — **UNSCHEDULED**

`docs/knowledge/harvested/function-design.md:22-23` requires an options object at three or more
parameters; `:40-41` sets `max-params: ['error', 3]`, which errors only at four. The prose is one
parameter stricter than its own stated enforcement, and Section S's row `F9` is filed against the
prose. The paragraph says the conflict is "worth settling in the corpus rather than per-phase" and
stops there — no ID, no owner, no trigger.

**What the repository actually does, measured 2026-09-02: it follows the lint threshold.**
`eslint.config.js` sets `max-params` to 3 (errors at four), and three-parameter functions ship
throughout — `Transport.send(request, options?, signal?)`, `fold(outcome, onSuccess, onFailure)`,
`Deserializer.deserializeFrom(source, schema, typeName?)`, `redactHeaderValue(name, value, policy?)`.
Several carry a documented `eslint-disable-next-line max-params` for a fourth, which is the gate
being enforced rather than evaded. So the conflict is settled in practice and unsettled on paper, and
`S.F9` — filed against the prose — dissolves under the reading the code takes.

**Not settled *in the corpus* here.** `docs/knowledge/harvested/` is frozen and is never hand-edited;
the mechanism for recording a reading against a harvested rule is a note under
`docs/knowledge/notes/`, and writing one is a deliberate edit to a frozen tree rather than a
maintenance action. **UNSCHEDULED — trigger: the next deliberate edit to `docs/knowledge/notes/`**,
which should carry this alongside N3's two markers and U1's two `<sub>` paths. One visit, three fixes.

---

## Retired items

An item is retired when it is genuinely resolved: its body is removed and one row below takes its
place. **The ID is not released.** It stays reserved, it is never renumbered and never reused, and it
still resolves from a source comment — the citation check reads this table as a second source of
resolvable IDs alongside the `### <ID>` headings, so a comment citing `K10` or `T.F9` still lands.

Every row's first cell is the ID and nothing else. The rows that never had an ID — Section D's deferral
table, Section R's Phase-3-owned residuals, and `L1`'s two resolved halves — retire the same way and are
in [Retired rows without an item ID](#retired-rows-without-an-item-id) directly below.

| ID | Title | Resolution | Date | Evidence |
|---|---|---|---|---|
| `A1` | HTTP-24: `charset` did not return null for an unknown encoding | resolved against the runtime's WHATWG encoding registry, returns `undefined` | 2026-09-02 | `packages/core/src/http/media-type.ts` — the `charset` getter and `isKnownEncoding` |
| `A3` | HTTP-11: `Response` exposes no range classification of its own | closed on the delegation reading — `response.status.isSuccess` is one hop | 2026-09-02 | deviations.md row: "`HTTP-11`'s range classifications are on `Status` only" |
| `A5` | CTX-8: the duplicate-key error's message did not identify the key | default keys gained a serial description | 2026-09-02 | `packages/core/src/context/context.ts` — `defaultKey()` |
| `B1` | NFR-10/NFR-17: CI never runs on the declared minimum runtime | closed by the `node-conformance` job, a matrix over the declared floor and current LTS | 2026-08-26 | `.github/workflows/ci.yml`; `tests/node-conformance/` |
| `B2` | NFR-13: SPDX headers missing on scaffold-era files | all three files carry the line-1 header | 2026-09-02 | `eslint.config.js:1`, added in `d8217af` |
| `B3` | NFR-12: reproducible builds asserted, never proven | gated — two clean builds agree on every emitted file and every tarball | 2026-08-29, widened 2026-08-30 | `scripts/verify-reproducible-build.mjs`, a blocking CI step |
| `B4` | NFR-14: `expect-type` breaks the single-source-of-versions convention | premise inverted — nine manifests all read `"catalog:"` | 2026-09-02 | root `package.json:12` |
| `C2` | The structural-typing bypass deviation is not yet recorded | Phase 10 recorded it as §10 ledger item 4 | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:64-75` |
| `E1` | Phase 1 has no commits | decided by what happened — one squashed commit, accepted | 2026-09-02 | commit `8051364` |
| `F3` | Zero `invariant()` assertions across `recovery/` | won't fix — density is not a target, decided project-wide | 2026-09-02 | deviations.md row: "`invariant()` density is not a target, project-wide"; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `F5` | `#private` fields carry no per-use justification | closed — `CLAUDE.md` states the convention once, with the styleguide 6.7 carve-out | 2026-09-02 | `CLAUDE.md`, "Domain model construction pattern"; `docs/deferred-items.md`'s *`#private`-vs-`private`* row, still deferred |
| `F6` | `RECOV-11` is a no-op in this port | ledgered as promised | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:36-37` |
| `F8` | 4b did not depend on 4a | premise corrected — 4b's only outside imports are `http/`, `body/`, `seams/`, `invariant`, `suppress`; the sequencing half closed when both merged into the 4c branch | 2026-08-26 | `packages/core/src/recovery/` |
| `G2` | `REDIR-28`/`REDIR-15` observability clause ships unimplemented | all four event families now emit | 2026-09-02 | `packages/core/src/redirect/redirect-step.ts` |
| `G3` | `Decision` carries no reason on `'return-current'` | `RedirectStopReason` shipped; the two blocked events emit | 2026-09-02 | `packages/core/src/redirect/decide.ts` |
| `G4` | `REDIR-20`'s "fully override" read as scoped to eligibility | the scoped reading is confirmed and recorded | 2026-09-02 | deviations.md row: "`REDIR-20`'s 'fully override' is read as scoped" |
| `G7` | `XCUT-17`(b)'s foreign-host half needs an auth layer | delivered by Phase 5c — the auth step is the marker's consumer | 2026-09-02 | `packages/core/src/auth/auth-step.ts`, `planOutbound` |
| `G10` | Phase 5c publishes `Step`, the context family, and a PROVISIONAL `InstrumentationBundle` | accepted — `activeSpan`/`tracerFactory` are documented as provisional in the emitted `.d.ts`, on the interface and on each member, which is the honest form of the trade | Phase 5c | `packages/core/src/context/instrumentation.ts`; `packages/core/etc/core.api.md` |
| `G11` | `DigestChallengeUnsupportedError` was speculative | cut during Phase 5c's own shape review, before it shipped | Phase 5c | `packages/core/src/auth/` — no such class |
| `G12` | `AUTH-37`'s failed background refresh is swallowed silently | emits `http.auth.bearerRefreshFailed` at `warning`, then continues | 2026-09-02 | `packages/core/src/auth/bearer-cache.ts`, `warnRefreshFailed` |
| `H1` | `@dexpace/codec-json` buffers the whole decoded body before parsing | accepted deviation — `JSON.parse` has no incremental form, so this is a property of the format, not of the seam; `decodeResponse` itself never buffers | Phase 6a | `packages/codec-json/src/json-serde.ts`; `packages/core/src/serde/response-handlers.ts` |
| `H2` | `SERDE-23` (ignore unknown fields) is satisfied by delegation, not enforcement | accepted deviation — stripping or rejecting an extra wire key is the caller's schema's property, and core cannot override it without defeating caller-supplied schemas | Phase 6a | `jsonSerde`'s TSDoc, `packages/codec-json/src/json-serde.ts` |
| `H3` | No serde-specific error base class | accepted deviation — two flat leaves under `DexpaceError` plus `isSerdeError`, because checkpoint §5.2 caps the tier at two levels | Phase 6a | `packages/core/src/serde/errors.ts`; `packages/core/etc/core.api.md` |
| `H5` | `NFR-8`/`NFR-9` shrinker keep-configuration | Phase 9 answered it the other way — `NFR-8` not applicable, `NFR-9` shipped | 2026-09-02 | `packages/shrink-test/`; deviations.md §10 |
| `H6` | Assertion density in 6a | won't fix — the same decision F3 records | 2026-09-02 | F3, retired; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `H12` | `seams/index.ts` is an unimported internal barrel | deleted, after a three-way proof that it was dead | 2026-09-02 | `packages/core/src/seams/` carries no `index.ts` |
| `H13` | `test:scripts` runs in no CI job | closed by the `Gate self-tests (scripts/*.test.mjs)` step, mirrored in the preflight | 2026-08-31 | `.github/workflows/ci.yml`; `.claude/skills/ci-preflight/run-ci.mjs` |
| `H14` | `decodeSuccessResponse`'s 4xx/5xx branch is unprotected against a teardown failure | fixed at `toHttpError` with `releaseQuietly`/`withReleaseFailure` | 2026-09-02 | `packages/core/src/body/http-status-error.ts`; three cases in its test |
| `I1` | `SSE-41` reactive adapter deferred to Phase 8b | delivered by Phase 8b | 2026-09-02 | `packages/rx/src/sse.ts:34,50` |
| `J1` | `PAGE-11` close-before-yield vs §7.1's illustrative snippet | resolved with an erratum — `PAGE-11` governs; materialized items survive close, so closing first releases the response immediately | Phase 6c | `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.1; `docs/knowledge/notes/pagination.md` |
| `J2` | `PAGE-5`/`PAGE-29` asynchronous `PaginationStrategy.parse` signature | resolved with a spec clarification — bodies arrive as async streams, so `parse` returns `Promise<PageInfo<T>>` with the isolated non-mutating semantics intact | Phase 6c | `packages/core/src/pagination/strategy.ts` |
| `J3` | `Page<T>` disposal is a runtime-guarded install, not `implements AsyncDisposable` | resolved — guarded `[Symbol.asyncDispose]` install with `close()` as the supported teardown; the `>=20.4` floor bump is decided against | 2026-08-30 | `packages/core/src/pagination/page.ts`; Section D's `await using` row; `I3` |
| `J4` | WHATWG encode-set boundary and verbatim query splice | resolved by design — hand-rolled tokenization over the raw query substring, so untargeted parameters survive byte-for-byte (`PAGE-21`/`PAGE-22`) | Phase 6c | `packages/core/src/pagination/query-splice.ts` |
| `J5` | Transport-direct pagination without an internal resilience loop | resolved by design — resilience composes externally at the pipeline layer (`PIPE-9`), keeping the engine transport-agnostic | Phase 6c | `packages/core/src/pagination/paginator.ts` |
| `J6` | `items()` vs `pages()` single-use asymmetry | resolved by design — `items()` re-walks and closes each page before yielding; `pages()` hands out live connection ownership and so is single-use (`PAGE-8`/`PAGE-14`) | Phase 6c | `packages/core/src/pagination/paginator.ts` |
| `J7` | Iterative generator drive without a trampoline | resolved by design — `PAGE-31` sanctions native loops; `#walk` and `driveFetchers` are `async function*` loops in constant stack space | Phase 6c | `packages/core/src/pagination/paginator.ts`, `fetchers.ts` |
| `J8` | Error unwrapping and root-cause propagation | resolved by design — `PaginationError` is reserved for engine misuse; transport, parse and network failures propagate unwrapped with their causes (`PAGE-28`) | Phase 6c | `packages/core/src/pagination/errors.ts` |
| `K2` | Proxy resolution implements the property tier the design ledgered as collapsed | resolved — the ledger wording was narrowed to say the *production sources* collapse, not the resolution logic; without the tier `CFG-24`/`CFG-26` would have been silent gaps | 2026-08-27 | `packages/core/src/config/proxy.ts`; the 7a design doc's ledger row |
| `K4` | `CFG-28`'s global-configuration convenience resolver is not built | closed — the clause is a MAY, and practice threads a `Configuration` | 2026-09-02 | `packages/transport-undici/` |
| `K5` | `CFG-35`'s throwable axis is not in this phase | already delivered by Phase 5a when the row was written | 2026-09-02 | `packages/core/src/retry/classify.ts` |
| `K9` | `Configuration.default()` ships as a free `defaultConfiguration()` | resolved — `Configuration` is an `interface` in this port and cannot carry a static; the plan's own alternative placement | 2026-08-27 | `packages/core/src/config/configuration.ts:354` |
| `K10` | `CFG-24`'s warning half is not emitted | emits `http.proxy.configRejected` on every rejection path | 2026-09-02 | `packages/core/src/config/proxy.ts` |
| `K14` | A configuration seam that fails is silently invisible | `readLayer` emits `config.sourceFailed`, carrying layer and key | 2026-09-02 | `packages/core/src/config/configuration.ts` |
| `K15` | `HTTP-17`: `hasForbiddenNameByte` permits a space in a header name | decided — the predicate matches the frozen requirement exactly, no deviation filed | 2026-09-02 | `packages/core/src/http/ascii-validation.ts`; `docs/product-spec/04-core-http-domain-model.md:32` |
| `K17` | `formatProxyOptions` re-brackets an IPv6 host stored bare | resolved — bracketing lives in the formatter, keyed off a colon in the host; `host` stays bare as the stored representation | 2026-08-27 | `packages/core/src/config/proxy.ts:222` |
| `L2` | G2's deferred emissions | resolved — `REDIR-28` hop and rejection logging and `REDIR-15` downgrade logging are active through `getGlobalLogger()`; see `G2` | 2026-08-28 | `packages/core/src/redirect/redirect-step.ts` |
| `L3` | G12, K10, K14 config and auth logger retrofit | all three sites emit, taken as one change | 2026-09-02 | `auth/bearer-cache.ts`, `config/proxy.ts`, `config/configuration.ts` |
| `M2` | `ASYNC-*` IDs marked 🚫 are not satisfied anywhere | Phase 8a landed both transports and the shared conformance suite | 2026-09-02 | `a0d734d`; `packages/transport-conformance/` |
| `M3` | `ASYNC-18` confirmed a full-port collapse at implementation time | resolved — `@dexpace/rx` contains no timer, scheduler or backoff; already reflected in §10 ledger item 1 | 2026-08-28 | `packages/rx/`; `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` |
| `N1` | Cancellation surfaces two different types depending on the layer | a core-side `abortToSdkError` maps both core sites, timeout still distinct | 2026-09-02 | `packages/core/src/cancellation.ts` |
| `N2` | `HttpStatusError`'s constructor fabricates a "successful exception" | constructor enforces 400-599; `retire()` got its own trail-entry leaf | 2026-09-02 | `packages/core/src/body/errors.ts`, `packages/core/src/retry/errors.ts` |
| `O3` | The phase records still carry pre-split corpus paths | won't fix — `docs/work/` files are dated records of what a phase planned, are never retro-edited, and `CLAUDE.md` states the split so it does not read as an oversight | 2026-09-02 | `CLAUDE.md`; `grep -rhoE "docs/knowledge/[a-z0-9-]+\.md" docs/work \| wc -l` |
| `P1` | `toHttpError`'s `finally` can mask the drain failure | merged into H14, which is canonical and carries the fix | 2026-09-02 | H14, retired |
| `P2` | `RequestOptionsBuilder.maxRetries` — the pattern deserves a sweep | sweep run over every public numeric setter; four holes fixed to the full range | 2026-09-02 | `http/request-options.ts`, `retry/settings.ts` |
| `P9` | Phase 7b still owes `engine.ts` two log events | both ship, plus a third the finding did not anticipate | 2026-08-31 | `packages/core/src/retry/engine.ts` |
| `U1` | Five citations point at paths the restructure moved | closed as a finding — four corrections handed to the frozen trees, the `.changeset/` one left permanently | 2026-09-02 | `docs/knowledge/notes/`, `docs/sdk-design-nodejs/10-…` (see HANDOFF) |
| `U2` | Three phase deferrals never reached the aggregate log | recovered into the aggregate | 2026-08-31 | `docs/deferred-items.md` |
| `U3` | Three `F` namespaces coexist; a bare citation is ambiguous | options 1 and 3 together — a section qualifier, taught to the citation check | 2026-09-02 | `.claude/skills/housekeeping/probe.mjs`; this file's Section index |
| `U6` | Six citations named the wrong section, four resolved to nothing | five corrected in source; the `.changeset/` one left as frozen history | 2026-08-31 | `packages/core/src/config/` |
| `U7` | `redirectStep()` is public; the guard that makes it safe is not | option 1 — `withRedirect` and `stripCrossOriginMarkerStep` promoted | 2026-09-02 | `packages/core/etc/core.api.md` |
| `U8` | Two published READMEs shipped a sample that does not compile | both show `close()` in a `finally`, and say why | 2026-08-31 | `packages/transport-fetch/README.md`, `packages/transport-undici/README.md` |
| `U9` | A `@throws` named a class that does not exist, ten more unreachable | option 3 — eight promoted, the two bug-signalling tags rewritten | 2026-09-02 | `packages/core/etc/core.api.md`; `docs/sdk-documentation/errors.md` |
| `U10` | Three documents stated three different, all-wrong citation counts | replaced by one derivation, a command rather than a sentence | 2026-09-01 | `node .claude/skills/housekeeping/probe.mjs --only=citations` |
| `U11` | The count checker could not read the counts it was written for | `parseNumeral` plus a subject-anchored, required claim table | 2026-09-01 | `.claude/skills/housekeeping/probe.mjs`, `probe.test.mjs` |
| `V1` | `OBS-19`/`TRANSPORT-13`: three modes, one level | `'all'` and `'first-per-name'` now warn; `'quiet'` stays silent | 2026-09-02 | `packages/transport-shared/src/drop-log.ts` |
| `V4` | `retrySettings` accepted a delay no timer can honor | closed from the other side — V13's chunked clock waits any finite duration | 2026-09-02 | `packages/core/src/retry/settings.ts`; `packages/core/src/config/clock.ts` |
| `V5` | One defect, two register letters, two contradicting statuses | resolved by merge — H14 canonical, P1 points at it | 2026-09-02 | H14 and P1, both retired |
| `V6` | The register hard-coded its own citation count | number replaced by the derivation command U10 prescribes | 2026-09-02 | this file's Section index |
| `V7` | Section Q's `Response.close()` latch claim is stale | Q's superseded paragraph is removed by this retirement pass | 2026-09-02 | `packages/core/src/http/response.ts:200-207` |
| `V8` | Section Q's assertion-count correction is wrong about Phase 4a | Q's superseded paragraph is removed by this retirement pass | 2026-09-02 | `packages/core/src/context/store.ts:35,49,67` |
| `V9` | Section R's "Suggested order" sequences work before Phase 4 | closed as advice; the block is removed by this retirement pass | 2026-09-02 | Section R |
| `V10` | Section R's Phase-3 residuals show four shipped rows as pending | marks corrected, then the four rows retired with this pass | 2026-09-02 | the four `R — residual` rows below |
| `V12` | Section H asserts and denies the same fact, four items apart | `H4`'s stale sentence struck and pointed at `H18` | 2026-09-02 | `packages/codec-json/tsconfig.json` carries no `references` key |
| `V13` | A `RETRY-18`-clamped pacing hint exceeds any timer | `Clock.sleep` chains timers, so a 365-day hint is waitable and no deviation is owed | 2026-09-02 | `packages/core/src/config/clock.ts`, `sleepInChunks` |
| `V14` | `N2`'s premise is false: core constructs the forbidden exception | `RetryDiscardedResponseError` gave `retire()` an honest trail entry | 2026-09-02 | `packages/core/src/retry/errors.ts` |
| `V15` | Section T's `F9` deadline passed; `Cursor` never checks the signal | `Cursor.#dispatch` checks at every step boundary, mapping through N1's mapper | 2026-09-02 | `packages/core/src/pipeline/cursor.ts` |
| `Q.D1` | Changeset level for `Request.body`'s narrowing to `Body \| undefined` | resolved to minor under semver's initial-development carve-out, pointer in the changeset | 3b execution | `.changeset/2026-08-25-body-lifecycle.md` |
| `Q.D2` | Three Phase-1/3a symbols the 3b plan called could not be verified | verified against the real code; the real names were used, no duplicates added | 3b execution | `packages/core/src/io/limits.ts` (`MAX_BYTE_ARRAY_LENGTH`), `http/status.ts`, `http/protocol.ts` |
| `R.E1` | `[Symbol.asyncDispose]` declared ahead of the declared floor | 3b reverted to `close()`-only; the §5.4 reopening closed when the `>=20.4` bump was rejected | 2026-09-02 | Section D's `await using` row; `I3` |
| `R.E5` | `bun test` proves nothing about the Node runtime | §5.9's own prescription implemented — a `node --test` tree plus a two-version CI matrix | 2026-08-26 | `tests/node-conformance/`; `.github/workflows/ci.yml` |
| `R.E6` | No per-class `#private` justification comment | closed on `F5`'s reading — the convention is stated once, project-wide | 2026-09-02 | `CLAUDE.md`, "Domain model construction pattern" |
| `R.E7` | `NFR-14`'s stale "no direct Bun equivalent" reason | moot — Phase 6a adopted workspace catalogs | 2026-08-27 | root `package.json`, `workspaces.catalog` |
| `R.E8` | `crypto` is absent from ESM on every Node 18 | floor raised to `>=20.3`, with `lib`/`target` moved to ES2023 | 2026-08-26 | `scripts/verify-runtime-floor.mjs`; `packages/*/package.json` |
| `S.F1` | `SuppressedError` does not exist on the declared runtime floor | branch (b) — a runtime-guarded `suppress()` helper, not a `>=24` floor | 2026-08-26 | `packages/core/src/suppress.ts` |
| `S.F2` | Zero assertions across the whole `recovery/` module | ledgered in 4b, then settled project-wide as won't-fix at `F3` | 2026-09-02 | `F3`, retired; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `S.F3` | Stale `wrapCancellation()` `invariant()` sentence in the 4b spec | replaced with `assertNever`'s `InvariantViolation`, matching the plan | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F4` | The spec never designs the `assertNever` addition the plan builds | `invariant.ts` added to the spec's File Layout | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F5` | `RECOV-14`'s concurrent-invocation clause claimed but untested | one design sentence plus an interleaved-`apply()` test | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `S.F6` | `RECOV-32`/`RECOV-33` read as silent drops | the Scope sentence now names 5a and 7a by requirement | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F7` | `#private` fields with no justifying comment | closed on `F5`'s reading; the cosmetic remainder is logged, not owned | 2026-08-30 | `CLAUDE.md`; `docs/deferred-items.md`'s *`#private`-vs-`private`* row, still deferred |
| `S.F8` | The chain property test drops half of what the spec promises | generator extended to seed `Failure` and assert `RECOV-4` | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `S.F9` | `fold()`'s three positional parameters trip the corpus prose | dissolves under the lint threshold the repository actually follows — see `V11` | 2026-09-02 | `eslint.config.js` `max-params`; `V11`, live |
| `S.F10` | `statusMappingStep` is a module-level `const` arrow | changed to a named `function` declaration with a `satisfies` check | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `T.F1` | `PIPE-17`'s "options readable by any step" claimed while unmet | both documents record the partial deferral by name — 5a Task 1 | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` documents |
| `T.F2` | Spec lists `replace` among the pillar-collision raisers | `replace` removed, `prependAll` added, `PIPE-5`'s exemption spelled out | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` design doc |
| `T.F3` | `contextStore.clear()` in `afterEach` wipes sibling test state | both hooks deleted, with a comment recording why | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F4` | `NFR-13`'s SPDX header absent from every 4c listing | Global Constraints bullet, every listing, and Task 6's grep | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F5` | Claimed property tests the plan never shipped | three real `fc.assert` properties added for `PIPE-22`/`PIPE-38` | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F6` | Pipeline errors carry symbols as fields but never render them | both messages interpolate `String(type)` | 2026-07-29 | `packages/core/src/pipeline/errors.ts` |
| `T.F7` | `StepContext.fork?: () => Next` spelled bare | spelled `?: (() => Next) \| undefined` in both documents | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` documents |
| `T.F8` | `PIPE-18`/`PIPE-19` tags swapped on the builder listing | IDs corrected; the prose names the module-level helper | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` design doc |
| `T.F9` | `Cursor` never checks the signal between steps | option (a) — check in `#dispatch`, map through `abortToSdkError`; see `V15` | 2026-09-02 | `packages/core/src/pipeline/cursor.ts` |

---

## Retired rows without an item ID

Section D's deferral table and Section R's Phase-3-owned residuals hold rows, not items: they never
carried an ID, and are cited by section and row title. `L1` is a live SPLIT whose `OBS-19` and `OBS-28`
halves are resolved while `OBS-29` is not, so its two closed halves retire here by requirement rather
than by ID. Nothing in this table reserves an ID, which is why it is kept out of the one above — that
table is the register's second ID namespace and the citation check parses it.

| Row | Subject | Resolution | Date | Evidence |
|---|---|---|---|---|
| L1 — `OBS-19` | Dropped-header verbosity policy deferred to Phase 8a | fixed — the policy now has three levels, not one; recorded as V1 | 2026-09-02 | `packages/transport-shared/src/drop-log.ts` |
| L1 — `OBS-28` | Richer HTTP-tracer vocabulary deferred to Phase 8a | closed as satisfied-by-level — a SHOULD whose no-op extension mechanism ships | 2026-09-02 | `packages/core/src/observability/tracing.ts:40-74` |
| R — residual: `BODY-34`'s shared preview-cap value | one cap value for both logging tees | shipped in 7b — one configured value threaded through both | 2026-09-02 | `packages/core/src/observability/logging-step.ts` |
| R — residual: `BODY-4`/`BODY-5` replayability consultation | resilience must read `body.replayable` | shipped in 5a and 5b | 2026-09-02 | `retry/classify.ts` `isResendable`; `redirect/decide.ts` |
| R — residual: `FileBody` | `HTTP-40`/`BODY-11`/`12`/`13`/`36` | shipped in 8a as a package, on the structural `Body.kind === 'file'` contract | 2026-09-02 | `packages/body-file/` |
| R — residual: logging tees unwired to any `Logger` | both tees need a driver | shipped in 7b — both are driven from the logging step | 2026-09-02 | `packages/core/src/observability/logging-step.ts` |
| D — Body lifecycle | `HTTP-36`–`HTTP-43` | shipped in 3b | 2026-08-26 | `packages/core/src/body/` |
| D — Lazy `TypedResponse<T>` | `HTTP-44`, `HTTP-45` | shipped in 3b | 2026-08-26 | `packages/core/src/body/typed-response.ts` |
| D — `MultipartBody` | `HTTP-51` | shipped in 3b; the non-appearance clause stays open in Section R's residuals | 2026-08-26 | `packages/core/src/body/multipart-body.ts` |
| D — 1 MiB error-body buffering cap | `HTTP-52` | shipped in 3b; `RECOV-16` reuses it unchanged | 2026-08-26 | `packages/core/src/body/http-status-error.ts` |
| D — Seam contracts | `SEAM-2`–`SEAM-30` | verified shipped across Phases 2 and 6a; §10 item 2 records the byte-stream removal | 2026-09-02 | `packages/core/src/seams/` |
| D — Adapter packages, peer-dependency dedup | `NFR-2` | nine publishable packages, core a peer of every one | 2026-09-02 | `bun run verify:seam-1` |
| D — Shrink-survival regression guard | `NFR-9` | `@dexpace/shrink-test`, private, in the CI step list | 2026-09-02 | `packages/shrink-test/` |
| D — Concurrency-model agnosticism check | `NFR-11` | 4c executed; §10 item 1 carries the full-port collapse | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` |
| D — `CTX-17`'s positive half | `CTX-17` | `Runtime.send()` installs and evicts its own store entry | 2026-09-02 | `packages/core/src/pipeline/runtime.ts` |
| D — Real W3C Trace Context generation | `CTX-14`, `CTX-15` | `generateTraceId`/`generateSpanId` ship with the all-zero sentinel guard | 2026-09-02 | `packages/core/src/observability/tracing.ts` |
| D — `FakeTransport` test double | — | ships and is used across the retry, redirect, auth and observability suites | 2026-09-02 | `packages/core/src/testing/fake-transport.ts` |
| D — Self-identifying version metadata | `NFR-15` | shipped; the missing barrel export is `K1`, not this row | 2026-09-02 | `packages/core/src/config/build-info.ts`, `client-identity-step.ts` |
| D — `NFR-8` re-confirmed as a documented non-applicability | `NFR-8` | recorded as a deviation — no reflection-driven discovery surface exists | 2026-09-02 | deviations.md §10 |
| D — Redirect structured logging | `REDIR-28`, `REDIR-15`, `XCUT-17`(d) | all three families emit; see `G2` | 2026-09-02 | `packages/core/src/redirect/redirect-step.ts` |
| D — Redirect's loop-detected and malformed-Location events | `REDIR-28` | both emit behind the stop-reason discriminant; see `G3` | 2026-09-02 | `packages/core/src/redirect/decide.ts` |
| D — The cross-origin marker's consumption side | `REDIR-11`(b/c), `XCUT-17`(b), `AUTH-29` | `planOutbound` reads the marker and clears it; see `G7` | 2026-09-02 | `packages/core/src/auth/auth-step.ts` |
| D — Auth re-runs per redirect hop | `PIPE-2` | `standardResilience()` seats `authStep()` inside the redirect pillar | 2026-09-02 | `packages/core/src/auth/preset.ts` |
| D — Public-barrel promotion of `redirectStep`/`withRedirect` | — | the half 5c left is closed; see `U7` | 2026-09-02 | `packages/core/etc/core.api.md` |
| D — Re-confirm the redirect predicate's scope | `REDIR-20` | confirmed and recorded as a deviations row; see `G4` | 2026-09-02 | deviations.md, "Deviations recorded outside a phase" |

---

## Maintaining this file

Add an entry the moment a gap is found, not when it is fixed — the failure mode this file prevents is a
checklist row marked ✅ against code that does not implement it (A1 and A2 were both instances; A1 is retired).
**Never delete an entry.** When the underlying requirement is genuinely satisfied *and* its checklist row
agrees, retire it: cut the body, add one row to [Retired items](#retired-items) with the resolution, the date
and `file:line` evidence, and mark the ID retired in the Section index. The ID stays reserved for good. When a
phase closes, re-scan its checklist against the code rather than trusting the marks.

**A new review is a new section, with the next letter.** Never renumber an existing item and never reuse a
letter: item IDs are cited from source comments, which no gate updates. `node scripts/knowledge.mjs` has
nothing to do with this file; the check that every citation resolves lives in the `housekeeping` skill's probe
(`.claude/skills/housekeeping/probe.mjs`), and U6 records what it found the first time it ran.

**Heading form.** `## Section <Letter> — <Subject>` for a section, `### <Letter><N> — <title> — **STATUS**`
for an item. Sections A–G used `## A.` until 2026-08-31; the letters did not change, only the form.

**Do not open a second register.** One was opened at the repository root in `cba4721` and sat unmerged for
five days across four phases (now Section P). A finding that is not in this file is not registered, wherever
else it is written down.

