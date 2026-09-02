# Node.js SDK — v1 Roadmap

**Status:** Draft, approved for planning.

**Purpose:** High-level, ordered phase list from empty repo to a spec-conformant v1 of the `nodejs-sdk`. This is
an index, not an implementation plan — each phase gets its own brainstorm → spec → plan cycle when its turn
comes. Do not add implementation detail to this document as phases complete; instead link to the phase's own
spec file.

**Governing documents:**

- `docs/product-spec.md` (+ `docs/product-spec/*`) — the language-agnostic, normative contract. Requirement IDs
  (`SEAM-*`, `HTTP-*`, `IO-*`, `BODY-*`, `CTX-*`, `PIPE-*`, `RECOV-*`, `RETRY-*`, `REDIR-*`, `AUTH-*`, `PAGE-*`,
  `SSE-*`, `SERDE-*`, `OBS-*`, `CFG-*`, `TRANSPORT-*`, `ASYNC-*`, `XCUT-*`, `NFR-*`) are the vocabulary every
  phase below cites against.
- `docs/sdk-design-nodejs.md` (+ `docs/sdk-design-nodejs/*`) — the Node/TS port design, already broken into the
  seams this roadmap sequences.
- `/home/mohammad/Projects/dexpace/styleguide/typescript/` (core rules) and
  `/home/mohammad/Projects/dexpace/styleguide/typescript-bun/` (toolchain/runtime rules) — binding, in force from
  Phase 0 onward, for every phase without exception.

## Cross-Cutting Constraints (apply to every phase, not their own phase)

- **Styleguide enforcement is continuous**, not a one-time gate. Every phase's code is written and reviewed
  against `styleguide/typescript`'s 15 chapters (Tiger Style overlay on Google's TS guide) from the moment the
  toolchain exists (Phase 0).
- **Package manager and test runner: Bun, not pnpm.** `sdk-design-nodejs/02` specifies a pnpm workspace; the
  styleguide mandates Bun (`bun install`, `bun.lock`, `.bun-version`, `bun test`) as binding for all dexpace
  projects. Resolved 2026-07-23 in favor of the styleguide — see the
  [scaffold milestone design](./scaffold/2026-07-23-scaffold-milestone-design.md) for the reconciled shape. The
  multi-package workspace *layout* from `sdk-design-nodejs/02` (package map, project references, peer-dependency
  discipline) still holds; only the pnpm-specific mechanics are replaced. Library packages still build with
  plain `tsc` (never `Bun.build`, which is reserved for services), per `typescript-bun/08-build-and-distribution.md`.
- **Dual JS/TS consumption.** TypeScript is the source of truth; the SDK must serve both TS and plain-JS
  consumers. `tsc` compiles to ESM JS + `.d.ts`; no TS-only runtime syntax leaks into shipped output (the
  styleguide's erasable-syntax stance already helps here — no enums, no decorators, no constructor parameter
  properties). Verified per-package as each package is built, not only once at the end.
- **Requirement-ID traceability.** Each phase's deliverable should be traceable back to the product-spec
  requirement IDs it satisfies, feeding `docs/product-spec/appendix-c-consolidated-normative-requirement-index.md`
  and the Phase 9 conformance pass.

## Phase List

| Phase | Name | Package(s) | Product-spec refs | sdk-design refs |
|---|---|---|---|---|
| 0 | Toolchain & Style Gate | workspace root, `@dexpace/core` (stub) | — | §2, §9 (see [scaffold milestone design](./scaffold/2026-07-23-scaffold-milestone-design.md)) |
| 1 | Core HTTP Domain Model | `@dexpace/core` | §4 | §4 |
| 2 | Seam Foundations | `@dexpace/core` | §3 | §3 |
| 3a | I/O Contracts | `@dexpace/core` | §5 | §3.1 (Web Streams direct, no pluggable provider) — see [Phase 3a design](./phase3/phase3a/2026-07-24-phase3a-io-contracts-design.md) |
| 3b | Body Lifecycle | `@dexpace/core` | §6 | §3.1 — see [Phase 3b design](./phase3/phase3b/2026-07-25-phase3b-body-lifecycle-design.md) |
| 4a | Execution Context | `@dexpace/core` | §7 | §5 — see [Phase 4a design](./phase4/phase4a/2026-07-25-phase4a-execution-context-design.md) |
| 4b | Recovery-Chain Primitives | `@dexpace/core` | §8.2 | §5 — see [Phase 4b design](./phase4/phase4b/2026-07-25-phase4b-recovery-chain-design.md) |
| 4c | Stage-Based Pipeline | `@dexpace/core` | §8.1 | §5 — see [Phase 4c design](./phase4/phase4c/2026-07-25-phase4c-stage-pipeline-design.md) |
| 5a | Resilience — Retry | `@dexpace/core` | §9, appendix C `RECOV-17`–`RECOV-34` | §6 — see [Phase 5a design](./phase5/phase5a/2026-07-26-phase5a-retry-design.md) |
| 5b | Resilience — Redirect | `@dexpace/core` | §10 | §6 — see [Phase 5b design](./phase5/phase5b/2026-07-26-phase5b-redirect-design.md) |
| 5c | Resilience — Auth | `@dexpace/core` | §11 | §6 — see [Phase 5c design](./phase5/phase5c/2026-07-26-phase5c-auth-design.md). Both 5b and 5c were drafted solo/concurrently (user away from keyboard); 5c's own doc records reconciling with 5b's cross-origin-marker design after finding it mid-draft — see its "Alignment with 5b's shipped design" sections |
| 6a | Serde | `@dexpace/core`, `@dexpace/codec-json` | §14 | §7.3 — see [Phase 6 segmentation design](./phase6/2026-07-28-phase6-segmentation-design.md) |
| 6b | SSE | `@dexpace/core` | §13 | §7.2 — see [Phase 6 segmentation design](./phase6/2026-07-28-phase6-segmentation-design.md) |
| 6c | Pagination | `@dexpace/core` | §12 | §7.1 — see [Phase 6 segmentation design](./phase6/2026-07-28-phase6-segmentation-design.md) |
| 7a | Configuration & Platform Primitives | `@dexpace/core` | §16, appendix C `RECOV-33` | §8 — see [Phase 7 segmentation design](./phase7/2026-07-28-phase7-segmentation-design.md) and [Phase 7a design](./phase7/phase7a/2026-07-28-phase7a-configuration-design.md) |
| 7b | Instrumentation & Observability | `@dexpace/core`, `@dexpace/logging-pino`, `@dexpace/logging-debug` | §15 | §8 — see [Phase 7 segmentation design](./phase7/2026-07-28-phase7-segmentation-design.md) and [Phase 7b design](./phase7/phase7b/2026-07-28-phase7b-observability-design.md) |
| 8a | Transport Adapters | `@dexpace/transport-fetch`, `@dexpace/transport-undici`, `@dexpace/body-file`, `@dexpace/transport-shared` | §17 | §3.2 (single `Promise` primitive collapses JVM's SEAM-11/SEAM-16 fragmentation) — see [Phase 8 segmentation design](./phase8/2026-07-28-phase8-segmentation-design.md) and [Phase 8a design](./phase8/phase8a/2026-07-28-phase8a-transport-design.md) |
| 8b | Async-Runtime Bridge | `@dexpace/rx` | §18 | §3.2 (RxJS `Observable` is the only Node-worthwhile async adapter) — see [Phase 8 segmentation design](./phase8/2026-07-28-phase8-segmentation-design.md) and [Phase 8b design](./phase8/phase8b/2026-07-28-phase8b-async-runtime-design.md) |
| 9 | Cross-Cutting Invariants & Conformance | all packages, `@dexpace/shrink-test` | §19, §20, appendix B | — see [Phase 9 design](./phase9/2026-07-28-phase9-cross-cutting-conformance-design.md) and [Phase 9 plan](./phase9/2026-07-28-phase9-cross-cutting-conformance.md) |
| 10 | Deviation Reconciliation | `@dexpace/core`, `@dexpace/transport-fetch`, `@dexpace/transport-undici`, `@dexpace/shrink-test` — **corrected 2026-08-30**; this cell read `— (review only)` and the phase shipped code. See the Phase 10 status note below | — | §10 |

**Status note (2026-07-27).** Phases 5a/5b/5c have a design **and** a written implementation plan; none of the
three has been executed — no `src/retry/`, `src/redirect/`, or `src/auth/` exists yet. 5b's and 5c's plans were
reviewed against the knowledge corpus and against each other's declared APIs before execution; the corrections
that outlive their own phase are logged below (see the `cross-origin.ts`, `AuthTiers`, preemptive-stamp, and
`DigestChallengeUnsupportedError` rows). Everything else stayed inside the two plans' own Deviation Ledgers.

**Status note (2026-07-28).** A cross-phase deferral review swept this log against every written design/plan.
Two real gaps were found and folded into the unexecuted plans: `StepContext` never exposed the caller's per-call
`RequestOptions` (`PIPE-17`'s "readable by any step" MUST — extended 5a Task 1's amendment to two fields), which
in turn left `RETRY-41`'s per-call retry-count override (`RequestOptions.maxRetries`, `HTTP-35`) wired to
nothing (now read by 5a Task 9) and left `AUTH-4`'s `perCall` tier with no per-call source (now
`RequestOptions.auth?: AuthDescriptor`, amended in 5c Task 14). Bookkeeping: the rows targeting Phase 2 and
Phase 3b below were marked resolved-at-design/plan level, and `NFR-13`'s SPDX convention was written into
Phase 1's plan. No executed code exists yet, so every change was a document edit, not a retrofit.

**Status note (2026-07-28, later same day).** Phase 6 was brainstormed and split into 6a (Serde) / 6b (SSE) /
6c (Pagination) — see the [Phase 6 segmentation design](./phase6/2026-07-28-phase6-segmentation-design.md). The split
review produced three findings recorded in the log below that outlive the sizing question: three Phase-0 deferrals
(`NFR-2`, `NFR-14`, peer-dependency dedup) become live in 6a rather than Phase 8, because `@dexpace/codec-json` —
not a transport adapter — is the workspace's first second package; `sdk-design-nodejs/07`'s item-view snippet
contradicts `PAGE-11`'s close-before-yield MUST in a way appendix B's own conformance test does not catch; and
`PAGE-5`'s "synchronously inside parse" needs an explicit re-expression for a runtime with no synchronous body
read.

**Status note (2026-07-28, end of day).** All three sub-phases now have **both** a design and a written
implementation plan (`specs/2026-07-28-phase6{a,b,c}-*-design.md`, `plans/2026-07-28-phase6{a,b,c}-*.md`); none
has been executed — no `src/serde/`, `src/sse/`, `src/pagination/`, or `packages/codec-json/` exists yet. The
three plans were then reviewed against each other and against the knowledge corpus, the same pass 5b/5c got. The
corrections that outlive their own sub-phase are logged below (the `Symbol.asyncDispose` row, whose stated
premise 6b/6c invalidate, and the `PAGE-11` erratum row, which needed carrying into `docs/knowledge/` and not
only into `sdk-design-nodejs/07`). Everything else stayed inside the three plans' own task lists and Deviation
Ledgers. One process note worth keeping: the segmentation design declares the three sub-phases order-free, but
each plan's **Prerequisite** section had been written as a linear chain (6b "Phases 0 through 6a", 6c "0 through
6b"), which would have silently re-imposed the dependency the split exists to avoid. All three now state
"Phases 0 through 5c" plus an explicit note naming what — if anything — a sibling sub-phase adds.

**Ordering rationale:** toolchain first (Phase 0) so every subsequent phase is written under the style/quality
gates from line one. From there, bottom-up by dependency: domain model before the seams that operate on it,
seams before the pipelines built on top of them, pipelines before the resilience layer wrapping them, and
pagination/SSE/serde/instrumentation as the outer layers consuming everything underneath. Transport and
async-runtime adapters (Phase 8) come late because they are the most Node-specific judgment calls (per
sdk-design's §3 framing) and benefit from every other seam already being stable. Conformance (Phase 9) and
deviation reconciliation (Phase 10) close the roadmap by construction — they audit what phases 0-8 built rather
than building anything new.

## How Phases Get Executed

Each phase, when its turn comes:

1. Its own brainstorming session — scoped to that phase alone, referencing this roadmap for context.
2. A spec file.
3. Its own implementation plan (via the writing-plans skill), executed independently.

Both land in `docs/superpowers/` first — the `brainstorming` and `writing-plans` skills hard-code that
path — and are collected from there into `docs/work/mvp/phaseN/`, which is where a phase's design, plan
and checklist live once the phase is done. The `housekeeping` skill does the collecting.

This document is updated only to mark a phase's status (not-started / in-progress / done) and link to its spec
once written — it does not absorb implementation detail from completed phases. It carried one exception until
2026-08-31, the Deferred Items Log, which is now [`docs/deferred-items.md`](../../deferred-items.md). Every
phase's brainstorming session should check that register for entries targeting it before starting, and append
any new deferral it produces before that phase is considered done — this is how a decision made in Phase 0
("we'll handle NFR-2 properly once adapter packages exist") doesn't silently evaporate by Phase 8.

## Deferred Items Log

**Moved out on 2026-08-31.** The aggregate log — 74 rows — is now
[`docs/deferred-items.md`](../../deferred-items.md), a register at the `docs/` root beside `open-items.md`
and `deviations.md`.

It was here because there was nowhere else to put it, and this document's own rule (["How Phases Get
Executed"](#how-phases-get-executed)) had to carve out an exception for it: the roadmap records phase
*status*, "**Exception:** the Deferred Items Log below." The exception is gone with the log. A phase's
brainstorm still checks the register before starting and appends to it before the phase is done — at the
new path.

## Phase Status Notes

**Reading these.** Each note below is dated and is not retro-edited. Written when the log sat in this file,
they say "the row above" and "the rows above"; every such reference now means a row of
[`docs/deferred-items.md`](../../deferred-items.md), and the ones that name a specific row have been
repointed in place. The four `## Open Findings` review sections that used to follow them are
[`docs/open-items.md`](../../open-items.md) Sections Q, R, S and T.

**Status note (2026-07-28, Phase 7).** Phase 7 was brainstormed and split into 7a (Configuration & Platform
Primitives, `§16`) / 7b (Instrumentation & Observability, `§15`) — see the
[Phase 7 segmentation design](./phase7/2026-07-28-phase7-segmentation-design.md). Unlike Phase 6's three segments, this
split has one real (if soft) cross-segment dependency — `OBS-35`'s log-level resolution wants 7a's `Configuration`
— so 7a leads and 7b trails deliberately, rather than "order is convenience only." Both sub-phases got full
designs in this same session (not just a segmentation note): [7a](./phase7/phase7a/2026-07-28-phase7a-configuration-design.md)
and [7b](./phase7/phase7b/2026-07-28-phase7b-observability-design.md). All six Deferred Items Log rows that previously targeted
bare "Phase 7" are updated in `docs/deferred-items.md` to point at 7a or 7b specifically, each marked resolved-at-design-level. Three
new retrofits to 5a's already-written (still unexecuted) design/plan came out of 7a's brainstorm (`Clock`, RFC
1123 parser, and `RETRY-1`/`CFG-35` retryable-status single-sourcing); two more amendments — to 5a's and 5b's
steps for structured logging, and to 5c's preset for the `LOGGING` slot — came out of 7b's. No executed code
exists yet for any phase, so every change listed here is a document edit, not a retrofit to shipped code.

**Execution order is no longer the numeric order for Phase 5.** These five retrofits do not merely annotate 5a/5b/5c
— they make Phase 7 a *prerequisite* of Phase 5's execution, in both directions the amendment banners record:
7a's `config/{clock,http-date,retryable}.ts` must exist before 5a's plan runs (its Task 8 consumes `Clock`), and
7b's `observability/{logger,redaction,logging-step}.ts` must exist before 5b's Task 6 and 5c's Task 16 run. The
**Ordering rationale** above ("resilience layer... instrumentation as the outer layers consuming everything
underneath") describes the dependency direction as originally designed; it holds for everything except these
named modules, which invert it. Anyone executing plans in roadmap order must run 7a (and, for 5b/5c, 7b) first,
or execute 5a/5b/5c against the pre-amendment text and accept a duplicate-implementation deviation. Each affected
plan's own **Prerequisite** section states this; this note exists so the roadmap does not read as contradicting
them.

**Status note (2026-07-28, Phase 8).** Phase 8 was brainstormed solo (user away from keyboard, `docs/knowledge/`
as standing tie-breaker per standing instruction) and split into 8a (Transport Adapters, `§17`) / 8b
(Async-Runtime Bridge, `§18`) — see the [Phase 8 segmentation design](./phase8/2026-07-28-phase8-segmentation-design.md).
Only a segmentation document was produced this session, not full per-sub-phase designs (unlike Phase 7, which got
both in one sitting) — 8a and 8b each still need their own brainstorm → spec → plan cycle. Nine Deferred Items
Log rows that previously targeted bare "Phase 8" or "first concrete Transport" are updated there to point at 8a
or 8b specifically; none is resolved-at-design-level yet, only re-targeted and, where the segmentation review's
own analysis showed it, pre-dispositioned as collapsed/not-applicable (recorded in the segmentation design's §5,
carried forward into 8a's/8b's own row-by-row tables when those designs are written, not re-derived). Two package
column changes: Phase 8's roadmap-table row splits into 8a/8b, and the segmentation design flags a **possible
fourth package** (`FileBody`'s home, e.g. `@dexpace/body-node`) that 8a's own design must confirm or reject
before the roadmap table can be updated further — not decided by this pass. No executed code exists yet for any
phase, so every change here is a document edit.

**Status note (2026-07-28, Phase 8, continued).** Both sub-phases got full designs and written implementation
plans in a follow-up pass this same day: [8a design](./phase8/phase8a/2026-07-28-phase8a-transport-design.md) /
[8a plan](./phase8/phase8a/2026-07-28-phase8a-transport.md) and [8b design](./phase8/phase8b/2026-07-28-phase8b-async-runtime-design.md) /
[8b plan](./phase8/phase8b/2026-07-28-phase8b-async-runtime.md). Neither plan has been executed — no `packages/`
directory exists in this repository as of this pass. The "possible fourth package" question above is settled:
8a's design confirms `@dexpace/body-file` (a fourth Phase 8a package, `FileBody`'s concrete factory) plus a fifth,
`@dexpace/transport-shared` (header-mapping helpers both transports need identically, found necessary only once
the plan reached implementation-level detail — the segmentation design and 8a's own design doc did not anticipate
this fifth package; it surfaced from "don't duplicate the same algorithm in two sibling packages" rather than
from any `TRANSPORT-N` requirement directly). The roadmap table's 8a row above is updated to list all four
published packages. `challengeHandler`'s protocol and the zero-copy-dispatch question are both resolved (not
merely flagged) in 8a's design — see the updated Deferred Items Log rows in `docs/deferred-items.md`. 8b's design resolved `ASYNC-18`
as inapplicable to the whole port, not merely out of 8b's scope — a correction to the segmentation design's
framing, recorded in 8b's design §3 and not requiring a Deferred Items Log row of its own since nothing was ever
targeted at a phase to begin with.

**Status note (2026-08-26, Phase 5a EXECUTED).** Phase 5a is implemented and green across the full gate
sequence — the first phase to run out of numeric order, per the execution-order note above. Closed by this
execution: `PIPE-36`, `PIPE-17`'s "readable by any step" MUST (via `StepContext.options`),
`StepContext.signal`, the `FakeTransport` double, `RECOV-32`, and the `RECOV-17`-`RECOV-34` reconciliation —
each row there already anticipated 5a and is now satisfied in code rather than only at design level. Two new
rows were added: the Phase 7b log-event deferral, and the record that 7a's Tasks 1-3 were executed early as
5a's prerequisite. Still deferred out of 5a: `RETRY-29` (not scheduled), `RECOV-33` (7a Task 9), and
public-barrel promotion of the step-authoring surface (5c) — `packages/core/etc/core.api.md` is byte-identical
across the phase, which is that decision's mechanical proof. Per-requirement disposition:
[2026-07-26-phase5a-retry-checklist.md](./phase5/phase5a/2026-07-26-phase5a-retry-checklist.md).

**Status note (2026-07-28, Phase 9).** Phase 9 was brainstormed solo (user away from keyboard, `docs/knowledge/`
as standing tie-breaker per standing precedent) and got a full design **and** a written implementation plan in
one session: [design](./phase9/2026-07-28-phase9-cross-cutting-conformance-design.md) /
[plan](./phase9/2026-07-28-phase9-cross-cutting-conformance.md). Neither has been executed — no `packages/`
directory exists in this repository as of this pass. Per the roadmap's own framing ("audits what phases 0-8 built
rather than building anything new"), Phase 9's scope is deliberately narrow: a per-ID disposition table for all
24 `XCUT` IDs and all 17 `NFR` IDs (the grep across every prior spec/plan turned up exactly two incidental
`XCUT-N` citations before this pass, confirming this is the first systematic tabulation of that family), one new
package (`@dexpace/shrink-test`, closing `NFR-9`), and one new top-level `tests/conformance/xcut/` integration
suite driving 5c/7b's `standardResilience()` composed pipeline — not a general re-litigation of every open
judgment call that happened to say "Phase 9" in this log. Three consequences of that narrower scope:

- `NFR-9` closes here (design-level) — see the updated row in `docs/deferred-items.md`.
- One deferred item closes here too: whether `standardResilience()` needs a `tracerFactory`/`meter` pass-through
  convenience — resolved no, the composed-pipeline fixture needed no such convenience (see the updated row there).
- Four deferred items that targeted "Phase 9 conformance sweep" turned out to be `AUTH-*`/`REDIR-*` interpretive
  judgment calls or preset-shape questions, not `XCUT`/`NFR` conformance checks, and are retargeted there to
  Phase 10 (Deviation Reconciliation) — the roadmap's other audit-only phase and the one that already carries
  this class of write-up. This retargeting is a document edit only; it does not touch Phase 10's own design or
  plan files.

Also closed as part of this pass: three `unresolved 2026-07-25` markers in `docs/knowledge/tooling-and-quality-gates.md`
(package manager/lockfile, test-runner/coverage-gating, `gts` baseline) that a 2026-07-25 cross-phase checkpoint
had already decided but never back-ported into the corpus itself — directly relevant here since `NFR-5`/`NFR-6`/
`NFR-7` are exactly the rows those stale markers left unconfirmed.

**Status note (2026-08-30, Phase 10 EXECUTED — scope corrected).** Phase 10 is executed, and it **shipped code**.
The phase-table row above and this phase's own design (`2026-07-28-phase10-deviation-reconciliation-design.md:15`,
"Phase 10 ships no package") both said the opposite; both are corrected in place rather than overwritten, because
an unrecorded scope change is the exact failure mode this phase spent its audit correcting elsewhere. What
actually landed, on `25-phase-10-deviation-reconciliation`:

- **A live defect, found by auditing the ledger against source rather than against the specs that produced it.**
  `Page`, `FetchTransport` and `UndiciTransport` each declared `[Symbol.asyncDispose]` as a plain computed class
  member. The symbol arrived in Node 20.4 and every package declares `engines.node ">=20.3"`, so on the declared
  floor the computed key evaluated to `undefined` and the method bound to the string key `"undefined"` — junk on
  the prototype, no disposal, and a `.d.ts` promising `AsyncDisposable` regardless (`NFR-10`). All three now
  install it through a guarded module-scope `Object.defineProperty`, matching `SseStream`
  (`packages/core/src/pagination/page.ts:114`, `packages/transport-fetch/src/fetch-transport.ts:314`,
  `packages/transport-undici/src/undici-transport.ts:566`, `packages/core/src/sse/stream.ts:209`).
- **A breaking type change across three packages,** with two changesets: `Page` no longer declares `implements
  AsyncDisposable` and the two transport factories no longer return `Transport & AsyncDisposable`, so `await
  using` stops type-checking. Pre-1.0, so `minor` per the same initial-development carve-out the earlier `Body`
  narrowing used.
- **A new blocking CI step** closing `NFR-12` on evidence — `bun run verify:reproducible-build`
  (`scripts/verify-reproducible-build.mjs`), see the `NFR-12` row in `docs/deferred-items.md`.
- **Three further defects, from three subsequent review passes:** a `verify-dual-consumption` assertion that
  passed on the floor only *because* of the junk prototype key, a dispatcher leak in `UndiciTransport.close()`
  where the first rejecting `destroy()` aborted the reverse walk and stranded the `ProxyAgent` holding the pooled
  connections, and a stranded body producer in `send()` from evaluating `prepareBody()` before header mapping.
- **An extended shrink guard** — `packages/shrink-test/` now asserts the disposal installs survive a real esbuild
  `bundle + minify + treeShaking` pass, which is the standing evidence for keeping `"sideEffects": false` on the
  three packages carrying one.

**Why the "review only" scope was right to break, and where that judgment is recorded.** The audit's method —
re-derive every ledger claim from as-built source — is what surfaced the defect; a documents-only phase would
have copied the wrong claim forward. Fixing a live correctness defect found *by* the audit is inside the phase's
purpose, and leaving it recorded-but-unfixed would have shipped a `.d.ts` that lies on the declared floor. The
project-wide **convention sweeps** that also named Phase 10 were held to the original scope and re-deferred
instead — see the three rows added to `docs/deferred-items.md` and the dated dispositions on 4b's F2/F7 and
4c's `CONSTANT_CASE` note, now `docs/open-items.md` Sections S and T. Per-item evidence: `docs/deviations.md` (the as-built audit).

## Open Findings

**Moved out on 2026-08-31.** The four review sections that used to close this document are now
[`docs/open-items.md`](../../open-items.md):

| Was | Now |
|---|---|
| `## Open Findings — Phase 3b Validation Review (2026-07-28)` | Section Q |
| `## Open Findings — Phase 3b Execution (2026-08-25, expanded 2026-08-26)` | Section R |
| `## Open Findings — Phase 4b Validation Review (2026-07-28)` | Section S |
| `## Open Findings — Phase 4c Validation Review (2026-07-29)` | Section T |

They are review findings against phase documents, which is the running register's subject, not the roadmap's.
Each moved verbatim, with a relocation banner naming its origin. **Their row IDs did not change and are not
this register's item IDs:** Sections S and T each number their rows `F1`–`F10` and `F1`–`F9`, the reviews'
own numbering, which collides with Section F's items. A citation has to name the section — "Section S's F2",
never a bare "F2".
