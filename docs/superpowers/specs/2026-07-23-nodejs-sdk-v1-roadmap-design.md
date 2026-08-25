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
  [scaffold milestone design](./2026-07-23-scaffold-milestone-design.md) for the reconciled shape. The
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
| 0 | Toolchain & Style Gate | workspace root, `@dexpace/core` (stub) | — | §2, §9 (see [scaffold milestone design](./2026-07-23-scaffold-milestone-design.md)) |
| 1 | Core HTTP Domain Model | `@dexpace/core` | §4 | §4 |
| 2 | Seam Foundations | `@dexpace/core` | §3 | §3 |
| 3a | I/O Contracts | `@dexpace/core` | §5 | §3.1 (Web Streams direct, no pluggable provider) — see [Phase 3a design](./2026-07-24-phase3a-io-contracts-design.md) |
| 3b | Body Lifecycle | `@dexpace/core` | §6 | §3.1 — see [Phase 3b design](./2026-07-25-phase3b-body-lifecycle-design.md) |
| 4a | Execution Context | `@dexpace/core` | §7 | §5 — see [Phase 4a design](./2026-07-25-phase4a-execution-context-design.md) |
| 4b | Recovery-Chain Primitives | `@dexpace/core` | §8.2 | §5 — see [Phase 4b design](./2026-07-25-phase4b-recovery-chain-design.md) |
| 4c | Stage-Based Pipeline | `@dexpace/core` | §8.1 | §5 — see [Phase 4c design](./2026-07-25-phase4c-stage-pipeline-design.md) |
| 5a | Resilience — Retry | `@dexpace/core` | §9, appendix C `RECOV-17`–`RECOV-34` | §6 — see [Phase 5a design](./2026-07-26-phase5a-retry-design.md) |
| 5b | Resilience — Redirect | `@dexpace/core` | §10 | §6 — see [Phase 5b design](./2026-07-26-phase5b-redirect-design.md) |
| 5c | Resilience — Auth | `@dexpace/core` | §11 | §6 — see [Phase 5c design](./2026-07-26-phase5c-auth-design.md). Both 5b and 5c were drafted solo/concurrently (user away from keyboard); 5c's own doc records reconciling with 5b's cross-origin-marker design after finding it mid-draft — see its "Alignment with 5b's shipped design" sections |
| 6a | Serde | `@dexpace/core`, `@dexpace/codec-json` | §14 | §7.3 — see [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) |
| 6b | SSE | `@dexpace/core` | §13 | §7.2 — see [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) |
| 6c | Pagination | `@dexpace/core` | §12 | §7.1 — see [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) |
| 7a | Configuration & Platform Primitives | `@dexpace/core` | §16, appendix C `RECOV-33` | §8 — see [Phase 7 segmentation design](./2026-07-28-phase7-segmentation-design.md) and [Phase 7a design](./2026-07-28-phase7a-configuration-design.md) |
| 7b | Instrumentation & Observability | `@dexpace/core`, `@dexpace/logging-pino`, `@dexpace/logging-debug` | §15 | §8 — see [Phase 7 segmentation design](./2026-07-28-phase7-segmentation-design.md) and [Phase 7b design](./2026-07-28-phase7b-observability-design.md) |
| 8a | Transport Adapters | `@dexpace/transport-fetch`, `@dexpace/transport-undici`, `@dexpace/body-file`, `@dexpace/transport-shared` | §17 | §3.2 (single `Promise` primitive collapses JVM's SEAM-11/SEAM-16 fragmentation) — see [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) and [Phase 8a design](./2026-07-28-phase8a-transport-design.md) |
| 8b | Async-Runtime Bridge | `@dexpace/rx` | §18 | §3.2 (RxJS `Observable` is the only Node-worthwhile async adapter) — see [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) and [Phase 8b design](./2026-07-28-phase8b-async-runtime-design.md) |
| 9 | Cross-Cutting Invariants & Conformance | all packages, `@dexpace/shrink-test` | §19, §20, appendix B | — see [Phase 9 design](./2026-07-28-phase9-cross-cutting-conformance-design.md) and [Phase 9 plan](../plans/2026-07-28-phase9-cross-cutting-conformance.md) |
| 10 | Deviation Reconciliation | — (review only) | — | §10 |

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
6c (Pagination) — see the [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md). The split
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
2. A spec file at `docs/superpowers/specs/YYYY-MM-DD-<phase-name>-design.md`.
3. Its own implementation plan (via the writing-plans skill), executed independently.

This document is updated only to mark a phase's status (not-started / in-progress / done) and link to its spec
once written — it does not absorb implementation detail from completed phases. **Exception:** the Deferred Items
Log below. Every phase's brainstorming session should check this log for entries targeting it before starting,
and append any new deferral it produces before that phase is considered done — this is how a decision made in
Phase 0 ("we'll handle NFR-2 properly once adapter packages exist") doesn't silently evaporate by Phase 8.

## Deferred Items Log

Every item a phase's design or checklist explicitly pushed to a later phase, consolidated here so it isn't lost
between a phase's own spec/checklist files and this index. One row that is *not* a deferral, included anyway
because it's easy to mistake for one: `SEAM-5`–`SEAM-10` will **never** be built in this port — that's a
permanent simplification, not a postponement.

| Item | Originated in | Target phase | Note |
|---|---|---|---|
| `NFR-2` — each optional capability a separately installable unit (core + ≤1 external lib) | Phase 0 | **Phase 6a** (codec half; transport half stays **Phase 8a**) — retargeted 2026-07-28 | Originally "Phase 8, no adapter packages exist yet." The Phase 6 segmentation review found the premise false one phase early: `@dexpace/codec-json` is the workspace's first separately installable unit and takes **zero** external libraries — the cleanest instance of the requirement in the whole roadmap. 6a disposes of the codec half; `transport-fetch`/`transport-undici` close the rest in 8a — `transport-fetch` trivially (zero external libs), `transport-undici` with exactly one (`undici`). See the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) |
| `NFR-9` — automated shrink-survival regression guard | Phase 0 | **Resolved in Phase 9 (design)** | Explicitly out of scope per the scaffold design's own "Out of scope" list. Phase 9's design ships `@dexpace/shrink-test` (private, unpublished devDependency): an esbuild bundle/minify/tree-shake step, a dual-package-hazard fixture app, and a child-process round-trip guard wired into the default build as `bun run shrink-test`. Lands when Phase 9's plan executes |
| `NFR-11` — concurrency-model agnosticism, no async-framework type leak | Phase 0 | **Resolved in Phase 4c** | 4c's `Step`/`Next`/`Runtime` public surface is `Promise`-only — no RxJS, no generator, no framework-specific async type appears anywhere in the pipeline layer. Deferral closed |
| `NFR-12` — reproducible, byte-identical builds | Phase 0 | Phase 10 / first real release | Still open — Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 14) records the intended verification (double-build the workspace, diff output digests) but cannot execute it without a real build artifact. Unblocks at first real release |
| `NFR-13` — SPDX license header per source file | Phase 0 | Phase 1 onward — **written into Phase 1's plan (2026-07-28)** | Soft gap; the spec itself calls this "a review convention, not a mechanical gate". A 2026-07-28 plans review found no phase plan actually carried the convention, so Phase 1's plan now states it in its Global Constraints (`// SPDX-License-Identifier: MIT`, line 1 of every new file, all phases onward) — enforcement stays review-level |
| `NFR-14` — single source of truth for dependency/tool versions (Bun `catalog:`-equivalent) | Phase 0 | **Phase 6a** — retargeted 2026-07-28 | Trivially true today (one package, zero deps); the row's own text said it "becomes a real decision the moment a second package with its own dependencies exists." That moment is 6a scaffolding `@dexpace/codec-json`, not Phase 8. 6a picks the Bun equivalent of the pnpm `catalog:` protocol `sdk-design-nodejs/02` specifies, confirmed against `styleguide/typescript-bun/` |
| `NFR-15` — self-identifying version metadata (real `User-Agent`, never a placeholder) | Phase 0 | **Resolved in Phase 7a (design)** / **Phase 8a** | 7a's design ships `CFG-36`'s build/runtime descriptor (version via build-time codegen, never a runtime placeholder) and `RECOV-33`'s client-identity step that stamps it into `User-Agent`. Node-transport wiring (the header actually reaching the wire) still waits for 8a's concrete transports — a conformance test confirming `TRANSPORT-11`'s header-drop pass leaves it untouched, not new stamping logic. See the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) |
| `NFR-16` — publish provenance enforced on the release path | Phase 0 | Phase 10 / first real release | Still open — Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 14) records the intended verification (run the scripted `prepublishOnly` + `npm publish --provenance` path for real) but cannot execute it without a real publish. Unblocks at first real release |
| `NFR-8` — shrinker keep/retain configuration | Phase 0 | Phase 10 (Deviation Reconciliation) — closed 2026-07-28 | Re-confirmed as not applicable by design in Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 10) — this port has no reflection-driven discovery surface to keep-configure. Closed 2026-07-28 |
| Peer-dependency dedup for `@dexpace/core` (dual-package-hazard guard) | Phase 0 | **Phase 6a** — retargeted 2026-07-28 | Mechanism specified in `sdk-design-nodejs/02` §2. `@dexpace/codec-json` is the first package to declare the `@dexpace/core` peer, so the guard installs in 6a. Not theoretical for this package specifically: `sdk-design-nodejs/02` names the `Tristate` discriminant and the `Outcome` sum type as exactly the branded-symbol checks two non-identical copies of core would break — and `Tristate` is 6a's own deliverable |
| `NFR-10`/`NFR-17` residual — CI running the built artifact against the *declared minimum* Node version (18.17), not just whatever the runner defaults to | Phase 0 | **Resolved in Phase 2 (plan)** (pulled forward from Phase 3) | Low-risk while the only export was a trivial `ping()`. Phase 2 is where it stops being trivial: `composeSignal()` calls `AbortSignal.any()`, which landed in **exactly** Node 18.17.0 — the declared floor to the patch version. Phase 2's plan Task 7 ships the `node-floor-conformance` CI job (`actions/setup-node` pinned to 18.17.0 running `scripts/verify-node-floor.mjs`, which forces the `AbortSignal.any()` branch); its checklist marks the row ✅. Lands when Phase 2's plan executes |
| `MultipartBody` model (one of HTTP-3's "each builder-based model" list) | Phase 1 | **Resolved in Phase 3b (design)** | Retargeted from "Phase 3" when Phase 3 split. 3b's design ships `MultipartBody` in full — composite replayability (`BODY-2`), one shared framing routine driving both declared length and written bytes, RFC-2046 boundary generation/validation (`MultipartBoundaryError`), part-header quoting/escaping (`HTTP-51`). Lands when 3b's plan executes |
| `Request`/`Response` real body type (currently `unknown` placeholder) | Phase 1 | **Resolved in Phase 3b (design)** | 3b's design replaces both placeholders — `Request` carries the §6 `Body` model (replayability, consume-once), `Response.body` is a single-use `ReadableStream<Uint8Array> \| null` (`BODY-14`). Lands when 3b's plan executes |
| `Logger`/`LogEvent` seam | Phase 2 | **Resolved in Phase 7b (design)** | `sdk-design-nodejs/03` §3.5 discusses it inside the seam-mapping doc, but it carries no `SEAM-N` ID — it's an `OBS-*` concern. 7b's design ships the facade, the process-wide global logger slot, and the two bridge packages (`@dexpace/logging-pino`, `@dexpace/logging-debug`). Lands when 7b's plan executes |
| `FakeTransport` test double | Phase 2 | **Resolved in Phase 5a** | Deliberately not built speculatively — 4a and 4b both used file-local stubs instead, and 4c's own brainstorm chose to keep doing so rather than build a shared double for PIPE-9's empty-pipeline case alone. 5a is the phase that finally needs one: scripted multi-response sequences (`503,503,200`), wire-send counting, and per-response close observation. Ships at `packages/core/src/testing/fake-transport.ts` (`@internal`) alongside `countingResponse()`, whose `ReadableStream` `cancel()` hook is the **only** sanctioned way to observe `Response.close()` — instances are `Object.freeze`d, so a spy assignment throws. 5b and 5c consume it unchanged. Deferral closed |
| Phase 4 split into 4a (Execution Context, `§7`) / 4b (recovery-chain primitives, `§8.2`) / 4c (stage-based pipeline, `§8.1`) | Phase 4 brainstorm | — | ~76 combined normative IDs, comparable to Phase 3's ~79 that forced its own 3a/3b split; each sub-phase gets its own brainstorm→spec→plan cycle. Dependency order: 4a first (contexts are the pipeline's own per-call correlation state), then 4b and 4c |
| Phase 5 split into 5a (Retry, `§9`) / 5b (Redirect, `§10`) / 5c (Auth, `§11`) | Phase 5 brainstorm | — | 111 combined normative IDs — the largest single phase in the roadmap, well past the ~76–79 that already forced the Phase 3 and Phase 4 splits. Build order is forced by coupling, not just size: retry is independent of the other two; redirect owns the cross-origin marker `REDIR-11` defines and `AUTH-29` reads, so it must precede auth; the standard-resilience preset needs all three steps installed, so it closes 5c. Each sub-phase gets its own brainstorm→spec→plan cycle |
| Phase 6 split into 6a (Serde, `§14`) / 6b (SSE, `§13`) / 6c (Pagination, `§12`) | Phase 6 brainstorm (2026-07-28) | — | 107 combined normative IDs (`PAGE` 36, `SSE` 41, `SERDE` 30), between the ~76–79 that forced the Phase 3 and Phase 4 splits and Phase 5's 111. Cut along the spec's own section boundaries because **the spec forbids the couplings that would cross them**: `SSE-37` (MUST) bars any serde dependency from core SSE, and `§12`'s preamble declares pagination serde-agnostic — so the cross-segment contract surface is empty by mandate, which is exactly the property whose absence caused the 5b/5c drift below. **No segment depends on another; the 6a→6b→6c order is convenience, not dependency**, and any sub-phase may execute out of order. 6a leads only because it scaffolds the workspace's second package and is the one segment that reshapes an already-published seam (`SEAM-21`); 6c trails because it is the most coupled to *earlier* phases (4c's `Runtime`, 5a's `StepContext.options`, 3b's `Response` body). Full rationale, per-segment ownership, and the collapsed-ID clusters in the [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) |
| Collapsed-requirement disposition tables for Phase 6 — `PAGE-25`–`PAGE-33` (§12.9's async engine: this port has one async model, so the async generator *is* the engine), `SSE-18`/`SSE-31` (threading re-expressed against the event loop), `SERDE-8`/`SERDE-21`/`SERDE-22`/`SERDE-25`/`SERDE-26` (codec-engine configuration with no configurable engine to configure) | Phase 6 brainstorm | Each owning sub-phase's design (6c, 6b, 6a) | Same service 5a's `RECOV-17`–`RECOV-34` table performs: without a row-by-row disposition, a naive appendix-B sweep reads ~18 collapsed requirements as uncovered. The segmentation design identifies the clusters and what does **not** collapse inside each — notably `PAGE-26`/`PAGE-27`/`PAGE-32`'s close-exactly-once obligations (re-expressed as `finally`-block obligations on the single generator) and `SSE-31`'s close-during-in-flight-read branch, both of which stay real, testable work. **Note (Phase 9 design, 2026-07-28):** Phase 9's actual design scopes to `§19`/`§20` (`XCUT`/`NFR`) only — it does not re-verify `PAGE`/`SSE`/`SERDE` disposition, which stays each owning sub-phase's own responsibility as this row already states (6c, 6b, 6a respectively) |
| `sdk-design-nodejs/07` §7.1's item-view snippet closes the page *after* yielding its items; `PAGE-11` (MUST) requires closing *before* | Phase 6 brainstorm | **Phase 6c** (erratum against `sdk-design-nodejs/07` **and** `docs/knowledge/pagination.md`) | The 2026-07-28 plans review found the erratum was being written into `sdk-design-nodejs/07` only, while `docs/knowledge/pagination.md` carries the *same* wrong ordering in its Reference section directly beside the correct MUST in its Rules section. The knowledge corpus is the standing tie-breaker every later phase consults, so an erratum that skips it leaves the contradiction live; 6c's plan now amends both. Recorded because **the conformance test is weaker than the requirement**: the snippet's `finally` still passes `PAGE-11`'s stated check (an early `break` drives `.return()`, hence the close), so following the design doc ships a violation the appendix-B checklist would not catch. Resolution per the standing tie-breaker (normative spec + knowledge corpus win over an illustrative snippet): `PAGE-11` governs — copy items, close, *then* yield. Costs nothing, since materialized items survive close per `PAGE-2`. The snippet remains correct about the thing §7.1 is actually arguing (JavaScript's automatic `.return()`-on-abandon), just not about close ordering |
| `PAGE-5`'s "strategy MUST read everything it needs from the response **synchronously** inside parse" | Phase 6 brainstorm | **Phase 6c** (design must state the re-expression) | Node has no synchronous body read, so the literal reading is unimplementable and `parse` returns a promise. Every part of the requirement's actual intent survives: single-use-body discipline, no retention of the response or its body past the call, no close, no mutation. Flagged so an async signature does not later read as an oversight or get "fixed" back toward a literal reading |
| `SSE-41` — reactive SSE adapter (backpressure-honoring `Observable` view, fatal/non-fatal split, source-ownership documentation) | Phase 6 brainstorm | **Phase 8b** (`@dexpace/rx`) | `MAY`. 6b ships the pull-based `AsyncGenerator` surface `SSE-39` mandates; the reactive view is a bridge package, and the roadmap scopes `§18`'s async-runtime adapters to 8b specifically (not 8a's transports) as of the 2026-07-28 [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md). `sdk-design-nodejs/02` identifies RxJS's push-based `Observable` as the one async shape in the Node ecosystem worth bridging at all. Is `ASYNC-21` restated — the segmentation design's §5.2 names it 8b's marquee deliverable |
| Appendix C `RECOV-17`–`RECOV-34` reconciliation (18 rows filed under "Recovery-chain pipeline primitives" that `§8.2`'s prose never defines — it stops at `RECOV-16`) | Phase 4 sizing review | **Resolved in Phase 5a** | They are retry-engine requirements stated a second time for the reference's second retry stack. Since this port collapses both stacks into one engine (`RETRY-28`, `sdk-design/06`), 16 of the 18 collapse onto the same implementation as their `§9` twin (e.g. `RECOV-21` restates `RETRY-9`/`10`/`11`'s backoff formula verbatim); `RECOV-34`'s settings-object validation is partially new; `RECOV-32` and `RECOV-33` have **no** `§9` twin and are genuinely new work. The full row-by-row mapping table lives in the [Phase 5a design](./2026-07-26-phase5a-retry-design.md) — a naive appendix-B sweep should read it rather than re-deriving it, or it will read 18 requirements as uncovered. **Note (Phase 9 design, 2026-07-28):** `RECOV-*` is outside Phase 9's actual `XCUT`/`NFR`-scoped design; its disposition stays 5a's own responsibility per the table this row already points to |
| Real W3C Trace Context generation (trace-id/span-id byte generation, hex encoding, `traceparent`/`tracestate` parsing) — `InstrumentationBundle`'s actual tracing backend | Phase 4a | **Resolved in Phase 7b (design)** | 4a ships only `CTX-14`'s bundle shape and `CTX-15`'s no-op default. 7b's design generates real W3C/Datadog/no-op trace and span ids via `globalThis.crypto.getRandomValues` and lets a caller-supplied `tracerFactory` flow into `InstrumentationBundle` at pipeline-build time, without changing its already-frozen shape. Lands when 7b's plan executes |
| `contextsEqual()` value-equality utility for `ExecutionContext` | Phase 4a | Not scheduled — build only if 4b or 4c turns out to need one | `CTX-6` describes a consequence of key uniqueness, not a mandate for a new equality API; no consumer identified yet, so not built speculatively (same discipline as the original `FakeTransport` deferral) |
| `PIPE-35` — FLATTEN-vs-NEST seeding of a builder from an existing pipeline | Phase 4c | **Resolved in Phase 5c (design)** | Placed under `§8.1`'s "Bridges." heading but **not** bridge machinery — a builder capability independent of the sync/async collapse that disposes `PIPE-31`–`PIPE-34`. Deferred because 4c is the phase that first makes a pipeline constructible at all, so no caller yet holds one to seed from; the MUST clause ("make the choice explicit, never accidental") is vacuously satisfied while no seeding path exists. 5c's design ships `PipelineBuilder.seedFrom(runtime, 'flatten' \| 'nest')`, an explicit, non-defaulted mode argument. Deferral closed at design level; implementation lands when 5c's plan executes |
| `PIPE-2`'s redirect/retry conformance clause and `PIPE-40`'s 2-hop-redirect conformance clause | Phase 4c | `PIPE-40` → **Resolved in Phase 5b (design)**; `PIPE-2` → **Resolved in Phase 5c (design)** | 4c ships pipeline plumbing and zero pillar steps, so neither clause is testable there. `PIPE-40` is a contract on wrapping steps, closed by 5b's own two-hop `FakeTransport` test (wire-send count, per-hop close, final-response-open). `PIPE-2`'s stage-ordering half *is* covered in 4c; only the "auth step re-runs per redirect hop" half needed both a redirect step and an auth step — 5c's design specifies the per-hop re-run and adds the joint conformance test (auth step, "Closing `PIPE-2`'s remaining half and `AUTH-29`, jointly with 5b") |
| `PIPE-24`/`PIPE-39` — the standard-resilience preset (and `PIPE-24`'s "installs into empty slots only" clause) | Phase 4c | **Resolved in Phase 5c (design)** | 4c dispositioned both as "no preset shipped, revisit when one exists." A preset needs all three pillar steps installed, so it cannot land before auth. 5c's design ships `standardResilience()`, installing exactly the three pillars that exist by then (redirect, retry, auth) — `LOGGING` stays empty until Phase 7b ships a real logging step (**resolved in Phase 7b's design**, which amends `standardResilience()` to install it), a documented scope boundary, not a re-deferral |
| `PIPE-36` — a shipped pillar family locks its stage assignment | Phase 4c | **Resolved in Phase 5a** | 4c deferred it to "whichever future phase ships the first real pillar step family." That is 5a, and it is satisfied structurally: `retryStep()` is a factory returning a `StepDescriptor` with `stage: 'RETRY'` baked in — steps are functions carrying a descriptor, not classes with a subclassable stage assignment, so there is nothing to relocate. Deferral closed |
| Public-barrel promotion of the pillar-step authoring surface (`retryStep`, `StepDescriptor`, `Stage`, `PipelineBuilder`, `Runtime`) | Phase 4c, re-confirmed in Phase 5a | **Resolved in Phase 5c (design)** | 4c left "whether SDK callers ever author custom steps against a public surface" to "whichever phase first ships a pillar step." 5a answers: not yet. A caller cannot assemble a working pipeline until 5c's preset exists, and publishing `retryStep` alone would freeze shapes 5c may still reshape. 5c's design promotes `Stage`/`STAGE_ORDER`/`PILLAR_STAGES`/`StepDescriptor`/`StepContext`/`Next`/`PipelineBuilder`/`Runtime`/`retryStep`/`redirectStep`/`authStep`/`standardResilience`; everything else under `auth/` stays `@internal`. `packages/core/etc/core.api.md`'s diff at 5c's plan-writing time is the mechanical proof |
| `RETRY-29` — opt-in server-driven retry-classification override header | Phase 5a brainstorm | Not scheduled | `MAY`. Lets a response header force or suppress the retry classification. Widens the classifier's input surface to server-controlled values, which is a trust decision deserving its own deliberation rather than a default. No caller identified |
| `RECOV-33` — client-identity header step (Append/Replace token composition, blank-line suppression) | Phase 5a brainstorm | **Resolved in Phase 7a (design)** | One of only two appendix-C `RECOV-17`–`RECOV-34` rows with no `§9` `RETRY-*` twin (the other, `RECOV-32`'s idempotency key, shipped in 5a because retry preserves it per `RETRY-38`). Pure configuration-driven header composition with zero retry coupling, so it travels with `CFG-*` in 7a, ships as `clientIdentityStep()` consuming `CFG-36`'s build/runtime descriptor, and closes `NFR-15` alongside it. Lands when 7a's plan executes |
| `StepContext.signal` **and** `StepContext.options` — exposing the call's `AbortSignal` and per-call `RequestOptions` to steps | Phase 5a brainstorm (`signal`); 2026-07-28 plans review (`options`) | **Phase 5a, Task 1** | Found during 5a's spec self-review: 4c's `Cursor` accepts and threads a `signal` but `StepContext` never exposed it, so no step could observe cancellation — `RETRY-26`'s cancellable wait and `RETRY-32`'s "no attempts after cancellation" were both unimplementable. A 2026-07-28 review found the identical gap for `options`: `Cursor` threads them to terminal dispatch but `PIPE-17`'s "readable by any step" MUST was unsatisfied, and with it `RETRY-41`'s per-call override (`RequestOptions.maxRetries`, `HTTP-35`'s "0 disables retries for this call") had no wire — Phase 1 designed the knob, nothing read it. Both fields land as one additive amendment in 5a Task 1; 5a Task 9 wires the retry override, 5c Task 14 wires the per-call auth descriptor. **2026-07-29:** 4c's own design and plan now record the `PIPE-17` half as a deferral naming 5a Task 1, so the MUST is no longer deferred silently (4c validation review, F1); 4c's plan also forbids adding the two fields early, since their shape belongs to their first reader |
| `SEAM-30` cleanup (cancel an orphaned response on the completion race) | Phase 2 | **Phase 8a** | Documented as a TSDoc contract obligation on `Transport.send()` in Phase 2; only a real Transport implementation has a response to actually cancel. Collapses onto `TRANSPORT-9` (and `ASYNC-5`, which collapses onto the same thing) per the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) §5.1 — closes as part of 8a's conformance suite, not separate work |
| Byte-stream provider implementation (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) | Discussed in Phase 2 (`sdk-design/03` §3.1), built in | **Phase 3a** | `sdk-design-nodejs/03` covers this in the same document as Phase 2's other seams — the roadmap's phase split puts the *contract* in Phase 2 and the *implementation* in Phase 3a; don't conflate the two |
| Every buffering **cap** — `BODY-19`'s configurable tap cap, `BODY-30`/`HTTP-52`'s 1 MiB error-body cap, `BODY-34`'s shared preview-size configuration | Phase 3a | **Resolved in Phase 3b (design)** | Deliberate placement, not an omission — §5 bounds nothing; every spec-mandated cap sits in §6, and 3b's design wires all three: the `withRequestLogging` tee's `tapCapBytes` (`BODY-19`), `toHttpError()`'s fixed 1 MiB error-body cap (`BODY-30`/`HTTP-52`), and one shared preview-size parameter threaded through both logging tees and `toHttpError` (`BODY-34`). The rejected `maxRetainedBytes`-on-`BufferedSource` reasoning stands — don't re-litigate. Lands when 3b's plan executes |
| Promotion of any §5 type into the published `@dexpace/core` barrel | Phase 3a | **Resolved in Phase 3b (design)** — never promoted | 3b decided: `Body.writeTo` takes the platform's `WritableStream<Uint8Array>`, not `BufferedSink`, so no §5 type ever surfaces — all of `src/io/` stays `@internal` permanently. `api-extractor`'s report staying byte-identical across 3a was the mechanical proof the freeze held until the decision |
| `MAX_BYTE_ARRAY_LENGTH` constant value (`IO-9`) | Phase 3a | Phase 3a plan time | Core is runtime-agnostic, so `node:buffer`'s constant is off-limits; V8 and JavaScriptCore disagree and both have moved theirs; 12.6 forbids an import-time probe. Design fixes the *mechanism* (conservative constant + `RangeError` backstop); the number itself is confirmed when the plan is written |
| `Symbol.asyncDispose` on §5 resources (styleguide 13.1/13.2) | Phase 3a | **Re-scoped 2026-07-28 — the premise expired in Phase 6** | Declined in 3a for the same reason Phase 2 declined it on `Transport`: `Symbol.asyncDispose` postdates the `>=18.17` floor, and TypeScript does not polyfill it for a library *declaring* the method — the computed key silently becomes the string `"undefined"` at run time. The row's own escape clause was **"costs nothing today since no §5 type is public,"** and that stopped being true in Phase 6: 6b publishes `SseStream` and 6c publishes `Page`, both resource-owning classes whose primary teardown is a public `close()` — exactly the shape `styleguide/typescript/13` §13.1 forbids, with §13.2 prescribing `[Symbol.asyncDispose]` delegating to the legacy `close()`. It also has a second consumer now: `PAGE-12` (MUST) requires consumers of the page-level view to be *told* to wrap it in a scoped/auto-close construct, and `await using` is that construct. Both sub-phases therefore ship a **runtime-guarded, optionally-typed** `[Symbol.asyncDispose]`: installed via `Object.defineProperty` only when the well-known symbol exists (so the `"undefined"`-key hazard cannot occur on the declared floor), typed optional (so it never promises `await using` support the pinned 18.17.0 runtime cannot honor), and delegating to `close()`, which stays the supported teardown on every runtime. Requires `esnext.disposable` on the TypeScript `lib` list — a types-only change that does not move `engines.node`. Promotion to an unconditional `implements AsyncDisposable` is a one-line change still gated on the floor passing 18.18; **that** is the residue this row now tracks, not the expired "no public resource type" premise. See 6b's and 6c's designs, "Disposal" |
| `SEAM-5`–`SEAM-10` (discovery/registration/conflict-resolution machinery) | Phase 2 | **Never** — not deferred | Node has no pluggable byte-stream factory or fragmented async ecosystem to discover across; a permanent, documented simplification vs. the JVM reference, recorded in Phase 10's reconciled deviation ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 2), not "TODO'd" anywhere. Closed 2026-07-28 |
| Concrete `Serde` implementation (`@dexpace/codec-json`) | Phase 2 | **Phase 6a** | Phase 2 ships the `Serde<T>` interface only. Narrowed from "Phase 6" by the 2026-07-28 segmentation review |
| Concrete `Transport` implementations (`@dexpace/transport-fetch`, `-undici`) | Phase 2 | **Phase 8a** | Phase 2 ships the `Transport` interface only. Narrowed from "Phase 8" by the 2026-07-28 [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) |
| `SEAM-21` — explicit runtime type token for deserialization (the type-witness mechanism) | Phase 2 | **Phase 6a** | `sdk-design-nodejs/03` §3.3 defers to §7.3. Phase 2's `Serde<T>.deserialize(data: unknown): T` is the erased/inferred generic SEAM-21 forbids, so the interface **will** change shape — which is why Phase 2 keeps `Serde<T>` out of the package barrel and marks it `@internal`, so the rework is not a breaking change to a published API. Narrowed from "Phase 6" by the 2026-07-28 segmentation review, which also made this the reason 6a leads the phase: reshaping a seam belongs before, not after, other work built on the same barrel. 6a additionally decides whether the reshaped seam is finally promoted to the public barrel, and whether `Serde` stays generic in `T` at all once the schema carries `T` |
| `SEAM-14` — close *behavior* (idempotent, ownership-aware, releases only self-created resources) | Phase 2 | **Phase 8a** | The `close(): Promise<void>` **signature is locked in Phase 2** — adding a required method to a published seam later is a breaking change. Only the behavior waits, until a transport owns a pool worth releasing. Asymmetric across 8a's two packages: `transport-fetch` owns no persistent resource (a sanctioned no-op close); `transport-undici` owns a real `Pool`/`Client`/`Agent` |
| `SEAM-12` — concurrent-call conformance test | Phase 2 | **Phase 8a** | Stated as a TSDoc contract obligation on `Transport.send()` in Phase 2; "fire many concurrent requests and assert no cross-talk" needs a real transport to fire through. Collapses onto `TRANSPORT-29` (and `ASYNC-22`, its twin) per the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) §5.1 |
| `SEAM-18` (sync↔async bridges) | Phase 2 | **Never** — not deferred | Same class as `SEAM-5`–`SEAM-10`: a bridge connects two transport seams and this port has one. Every obligation SEAM-18 names presupposes a blocking transport Node cannot idiomatically have. Its one non-bridge clause ("per-call options MUST be threaded through, not dropped") survives as a `Transport.send()` obligation. Recorded in Phase 10's reconciled deviation ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 2). Closed 2026-07-28 |
| `HTTP-18`/`HTTP-48`/`HTTP-50` — outbound header strictness vs. ETag obs-text permission, discovered replaying a server-issued ETag with obs-text bytes through a conditional request | Phase 1 | **Resolved in Phase 10** | `RequestConditions.applyTo`'s strict outbound path is kept; `HTTP-18`'s MUST-level splitting defense (reinforced by `XCUT-18`) outranks `HTTP-48`'s SHOULD-level obs-text permission. See Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 15). Closed 2026-07-28 |
| `FileBody` (`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`) — file-backed request body | Phase 3b brainstorm | **Resolved in Phase 8a (design)** | Needs `node:fs`, which conflicts with `@dexpace/core`'s zero-`node:`-import invariant. Resolved as a **structural, not nominal, recognition contract**: `@dexpace/core`'s `Body.kind` union gains a `'file'` member and a type-only `FileBodyDescriptor` interface (zero runtime cost — types erase), retrofitted into Phase 3b's plan; the concrete `fileBody()` factory needing real `node:fs` validation ships in a new fourth Phase 8a package, `@dexpace/body-file`, which both transports depend on and recognize via `body.kind === 'file'` structural narrowing, never a cross-package `instanceof`. Separately, 8a's design confirms (not merely flags) that true kernel-level zero-copy dispatch (`TRANSPORT-28`'s SHOULD) **has no Node analogue** — neither `fetch` nor `undici` expose a `sendfile`-shaped API for outbound bodies — recorded as a `PAGE-29`-shaped collapse in 8a's Deviation Ledger, not chased further. See [Phase 8a design](./2026-07-28-phase8a-transport-design.md) §5 |
| `packages/core/src/redirect/cross-origin.ts` (the `REDIR-11`/`AUTH-29` shared signal — a real header, `CROSS_ORIGIN_MARKER_HEADER`, plus `hasCrossOriginMarker()`/`clearCrossOriginMarker()`) | Phase 5b brainstorm | **Resolved in Phase 5b (design)** | 5b ships and owns this module; 5c's own design (drafted concurrently, before either doc knew of the other) originally guessed an incompatible `WeakSet<Request>`-keyed shape against `REDIR-11`'s prose directly, then corrected itself against 5b's actual design once found mid-draft — see 5c's "How this doc was produced" / "Alignment with 5b's shipped design" sections. Recorded here as a caution: two solo brainstorms sharing a cross-phase contract, run without coordinating with each other, is exactly the scenario this kind of drift comes from — re-check for it explicitly if this ever happens again rather than assuming file-discovery mid-draft will always catch it. **The caution earned itself twice.** Catching the marker's *shape* mid-draft did not catch its *scope*: 5c's design consumed the marker on the outbound pass but still answered a `401`/`WWW-Authenticate` challenge on a marked hop, which would have stamped exactly the credential the marker exists to suppress — onto the server-chosen foreign host, over a URL whose HTTPS guard was deliberately skipped. Found in a plan review before any code existed and fixed in both 5c's plan and design (the marker now suppresses the whole hop, not just the outbound pass), but a cross-phase contract review needs to cover every place the consuming phase *acts on* the contract, not just where it reads it |
| `standardResilience()` gains a `LOGGING` pillar step | Phase 5c brainstorm | **Resolved in Phase 7b (design)** | 5c's preset installs only the three pillars that exist by then (redirect, retry, auth); a real logging step doesn't exist until Phase 7b. 7b's design amends `standardResilience()` to install `loggingStep()` (inert by default at `granularity: 'none'`) into the previously-empty slot. Lands when 7b's plan executes |
| `DigestChallengeUnsupportedError` — confirm a real caller-facing API needs to distinguish "unsatisfiable challenge" from "no replacement" before shipping it | Phase 5c brainstorm | **Resolved in Phase 10 — 2026-07-28** | `authStep()` itself never surfaces this distinction (both cases just leave the 401 unchanged); the leaf was sketched for a lower-level API 5c's design did not otherwise build. 5c's plan **kept** it rather than cutting — as an `@internal` leaf for a caller composing `composingHandler`/`digestHandler` directly, bypassing `authStep()`. **Resolved:** kept, permanently — no forced usage-sweep will ever run (Phase 9 is `XCUT`/`NFR`-scoped, no phase's code exists yet for one regardless), and an `@internal`-tier leaf costs nothing sitting unused; it can be removed later without a breaking change if it genuinely proves dead weight once real callers exist |
| Basic/Digest never stamp preemptively — an *interpretation*, not a stated requirement | Phase 5c brainstorm | **Resolved in Phase 10 — 2026-07-28** | `§11` phrases `AUTH-14` and `AUTH-15`–`AUTH-22` entirely as reactions to a parsed challenge, and never describes a preemptive-Basic path the way it separately describes Bearer's preemptive cached-token stamp; Digest structurally cannot stamp before seeing `realm`/`nonce`. 5c treats both uniformly as challenge-only. **Resolved:** confirmed correct as designed — the spec's asymmetry (describing Bearer's preemptive path, staying silent on Basic/Digest) reads as deliberate, and staying reactive matches this port's conservative-by-default posture elsewhere (credential-stripping by default, downgrade-deny by default). See Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 12) |
| True per-call / per-operation `AuthTiers`, resolved per call rather than fixed at step construction | Phase 5c plan | `perCall` tier: **Resolved in Phase 5c (design, 2026-07-28 revision)**. `operation` tier: unscoped | Originally fully unscoped because no phase shipped a per-call lookup source. The 2026-07-28 plans review closed the `perCall` half: the vehicle is `RequestOptions` (per-call operational overrides are exactly its Phase 1 charter), not `ExecutionContext` — `RequestOptions` gains `auth?: AuthDescriptor` (type-only, cycle-free import; amended in 5c Task 14 alongside `pipeline/builder.ts`'s existing amendment precedent), steps read it via `StepContext.options` (5a Task 1, `PIPE-17`), and `authStep` resolves `{...settings.tiers, perCall: ctx.options.auth}` when present. The `operation` tier still has no distinct source — nothing in this roadmap ships a per-operation layer (no codegen/client surface), so `operation` and `client` both remain construction-time configuration; that residue is a plumbing gap, not a conformance one (`AUTH-4`–`AUTH-7` are mechanically satisfied), and stays open here |
| Redirect predicate's scope over safety mechanics (credential stripping, downgrade, replayability, loop/cap) — 5b reads `REDIR-20`'s "MUST fully override" as scoped to code/method eligibility only, not these | Phase 5b brainstorm | **Resolved in Phase 10 — 2026-07-28** | A judgment call made without the user present; 5b's own design flagged it as narrow and mechanical to reverse if wrong. **Resolved:** confirmed correct as designed — `REDIR-20`'s snapshot (response, redirect count, visited URIs) carries nothing about credentials, and safety mechanics are separately governed by `XCUT-17`'s own universal, non-overridable framing; a predicate opting out of them would be a security regression, not a convenience. See Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 12) |
| Redirect structured logging (`SHOULD`-level hop/loop/downgrade events) | Phase 5b brainstorm | **Partially resolved in Phase 7b (plan, 2026-07-28)** | Same disposition as 5a's equivalent gap for retry. 7b's amendment to 5b's `redirect-step.ts` ships the hop event and a rejection event (distinguishing `SchemeDowngradeError`) via `getGlobalLogger()`, no change to `StepContext`'s shape. **Not fully closed:** `decide()`'s `Decision` type carries no reason discriminant on `'return-current'`, so a genuine loop-vs-hop-cap-vs-normal-termination distinction is out of scope for this retrofit — would need `Decision` reshaped, touching every assertion in `decide.test.ts`. 5a's equivalent (attempt-failed, retries-exhausted) closes cleanly with no such gap, since `Outcome.kind` already discriminates success/failure. Both land when their respective plans execute |
| 5a's `RetryConfig.clock`/`random` retyped against 7a's real `Clock` seam, replacing its ad hoc injection point | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | Single-sources the injectable-determinism seam 5a's own design already noted it was pre-empting ("the same injectable-determinism seam `CFG-15` wants for the clock") |
| 5a's private RFC 1123 parser in `pacing.ts` re-sourced from 7a's shared `config/http-date.ts` | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | 7a's module is a superset (adds the formatter 5a never needed); 5a's parser becomes an import, not a second implementation |
| 5a's private `RETRYABLE_STATUSES`/`isRetryableStatus` in `classify.ts` re-sourced from 7a's `config/retryable.ts` | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | `CFG-35` mandates one shared retryability definition; 7a Task 3 ships the identical set (408, 429, 5xx except 501/505) and 5a's `classify.ts` re-exports it unchanged, so `RETRY-1` and `CFG-35` cannot drift apart |
| `challengeHandler` slot on `ProxyOptions` has no protocol behind it | Phase 7a brainstorm | **Resolved in Phase 8a (design)** | The type carries the slot per `CFG-22`'s field list. Resolved as `transport-undici`-only: undici ships `ProxyAgent`/proxy-407 dispatch; `transport-fetch` ships no `proxy` option on `FetchTransportOptions` at all (an absent option, not a silently-ignored one) and documents no proxy support, since honoring `TRANSPORT-30` there would require depending on `undici` internally anyway, undercutting `transport-fetch`'s zero-added-dependency purpose. `§17`'s own preamble licenses this single-transport scoping. See [Phase 8a design](./2026-07-28-phase8a-transport-design.md) §6 |
| Whether `clientIdentityStep` should be added to `standardResilience()`'s default install list | Phase 7a brainstorm | **Resolved in Phase 10 — 2026-07-28** | Not installed by default — no requirement mandates it (`RECOV-33` governs the step's own internal composition, not whether a preset installs it; `NFR-15` only requires that *when* a `User-Agent` is emitted it's real, not that every call carry one), and 5c's preset already closed its own scope for the pillars that exist. **Resolved:** stays out, permanently — adding it would be unrequested preset scope creep; a caller who wants it installs it explicitly, already possible via the public authoring surface |
| Retry/redirect structured-logging event names/fields | Phase 7b brainstorm | Phase 7b plan time | No spec-fixed vocabulary exists for these `SHOULD`-level events; naming is a plan-time detail, not a design-level decision |
| Whether `standardResilience()` should also accept a `tracerFactory`/`meter` pass-through convenience | Phase 7b brainstorm | **Resolved in Phase 9 (design)** — no friction found | No requirement mandates preset-level convenience wiring beyond installing the `LOGGING` step itself. Phase 9's `tests/conformance/xcut/fixtures/composed-pipeline.ts` configures logging/tracing/metrics the same way 7b's own tests do — a `LoggingStepSettings` object passed to `standardResilience()`'s existing `logging` option, plus `setGlobalLogger()` for a spy `Logger` — with no need for a separate `tracerFactory`/`meter` preset-level parameter. Closed, not just deferred again |
| A real `@opentelemetry/sdk-metrics`-backed `Meter` adapter package | Phase 7b brainstorm | Not scheduled | `OBS-31` only requires the no-op default and that core not depend on a metrics runtime; no package in the roadmap's phase table ships a concrete metrics backend, unlike tracing's duck-typed zero-adapter path |
| Phase 8 split into 8a (Transport Adapters, `§17`) / 8b (Async-Runtime Bridge, `§18`) | Phase 8 brainstorm (2026-07-28) | — | 52 nominal combined IDs (`TRANSPORT` 30, `ASYNC` 22) — well under the ~76–79 that forced the Phase 3/4 splits — but §17 is paid twice (two full `Transport` implementations, `transport-fetch` and `transport-undici`) and nine Deferred Items Log rows land here, pushing effective weight to Phase-7-before-its-split territory. Cut along the package boundary the roadmap table already implied, verified empty by the same test Phase 6 applied: `@dexpace/rx` depends only on Phase 6's `Page`/`SseStream`, never on `Transport`, and nothing in `Transport`'s collapsed `Promise`-returning contract (`sdk-design-nodejs/03` §3.2) references RxJS or any `ASYNC-*` id. **No segment depends on the other; the 8a→8b order is convenience, not dependency** (8a leads only because it is the larger, riskier half). A large share of `§18`'s `ASYNC-*` IDs collapse onto their `§17` `TRANSPORT-*` twin (the SEAM-11/SEAM-16 collapse restated at the async-adapter layer) or are inapplicable outright — Node has no blocking-transport/worker-thread-pool model for `ASYNC-3`/`4`/`7`/`14` to bite on, the same premise that already closed `SEAM-18` as "Never." Full rationale, per-segment ownership, the collapsed-ID disposition tables, and open items (notably `FileBody`'s package placement and whether Node's HTTP stack has any zero-copy dispatch path at all) in the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) |

**Status note (2026-07-28, Phase 7).** Phase 7 was brainstormed and split into 7a (Configuration & Platform
Primitives, `§16`) / 7b (Instrumentation & Observability, `§15`) — see the
[Phase 7 segmentation design](./2026-07-28-phase7-segmentation-design.md). Unlike Phase 6's three segments, this
split has one real (if soft) cross-segment dependency — `OBS-35`'s log-level resolution wants 7a's `Configuration`
— so 7a leads and 7b trails deliberately, rather than "order is convenience only." Both sub-phases got full
designs in this same session (not just a segmentation note): [7a](./2026-07-28-phase7a-configuration-design.md)
and [7b](./2026-07-28-phase7b-observability-design.md). All six Deferred Items Log rows that previously targeted
bare "Phase 7" are updated above to point at 7a or 7b specifically, each marked resolved-at-design-level. Three
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
(Async-Runtime Bridge, `§18`) — see the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md).
Only a segmentation document was produced this session, not full per-sub-phase designs (unlike Phase 7, which got
both in one sitting) — 8a and 8b each still need their own brainstorm → spec → plan cycle. Nine Deferred Items
Log rows that previously targeted bare "Phase 8" or "first concrete Transport" are updated above to point at 8a
or 8b specifically; none is resolved-at-design-level yet, only re-targeted and, where the segmentation review's
own analysis showed it, pre-dispositioned as collapsed/not-applicable (recorded in the segmentation design's §5,
carried forward into 8a's/8b's own row-by-row tables when those designs are written, not re-derived). Two package
column changes: Phase 8's roadmap-table row splits into 8a/8b, and the segmentation design flags a **possible
fourth package** (`FileBody`'s home, e.g. `@dexpace/body-node`) that 8a's own design must confirm or reject
before the roadmap table can be updated further — not decided by this pass. No executed code exists yet for any
phase, so every change here is a document edit.

**Status note (2026-07-28, Phase 8, continued).** Both sub-phases got full designs and written implementation
plans in a follow-up pass this same day: [8a design](./2026-07-28-phase8a-transport-design.md) /
[8a plan](../plans/2026-07-28-phase8a-transport.md) and [8b design](./2026-07-28-phase8b-async-runtime-design.md) /
[8b plan](../plans/2026-07-28-phase8b-async-runtime.md). Neither plan has been executed — no `packages/`
directory exists in this repository as of this pass. The "possible fourth package" question above is settled:
8a's design confirms `@dexpace/body-file` (a fourth Phase 8a package, `FileBody`'s concrete factory) plus a fifth,
`@dexpace/transport-shared` (header-mapping helpers both transports need identically, found necessary only once
the plan reached implementation-level detail — the segmentation design and 8a's own design doc did not anticipate
this fifth package; it surfaced from "don't duplicate the same algorithm in two sibling packages" rather than
from any `TRANSPORT-N` requirement directly). The roadmap table's 8a row above is updated to list all four
published packages. `challengeHandler`'s protocol and the zero-copy-dispatch question are both resolved (not
merely flagged) in 8a's design — see the updated Deferred Items Log rows above. 8b's design resolved `ASYNC-18`
as inapplicable to the whole port, not merely out of 8b's scope — a correction to the segmentation design's
framing, recorded in 8b's design §3 and not requiring a Deferred Items Log row of its own since nothing was ever
targeted at a phase to begin with.

**Status note (2026-07-28, Phase 9).** Phase 9 was brainstormed solo (user away from keyboard, `docs/knowledge/`
as standing tie-breaker per standing precedent) and got a full design **and** a written implementation plan in
one session: [design](./2026-07-28-phase9-cross-cutting-conformance-design.md) /
[plan](../plans/2026-07-28-phase9-cross-cutting-conformance.md). Neither has been executed — no `packages/`
directory exists in this repository as of this pass. Per the roadmap's own framing ("audits what phases 0-8 built
rather than building anything new"), Phase 9's scope is deliberately narrow: a per-ID disposition table for all
24 `XCUT` IDs and all 17 `NFR` IDs (the grep across every prior spec/plan turned up exactly two incidental
`XCUT-N` citations before this pass, confirming this is the first systematic tabulation of that family), one new
package (`@dexpace/shrink-test`, closing `NFR-9`), and one new top-level `tests/conformance/xcut/` integration
suite driving 5c/7b's `standardResilience()` composed pipeline — not a general re-litigation of every open
judgment call that happened to say "Phase 9" in this log. Three consequences of that narrower scope:

- `NFR-9` closes here (design-level) — see the updated row above.
- One deferred item closes here too: whether `standardResilience()` needs a `tracerFactory`/`meter` pass-through
  convenience — resolved no, the composed-pipeline fixture needed no such convenience (see the updated row above).
- Four deferred items that targeted "Phase 9 conformance sweep" turned out to be `AUTH-*`/`REDIR-*` interpretive
  judgment calls or preset-shape questions, not `XCUT`/`NFR` conformance checks, and are retargeted above to
  Phase 10 (Deviation Reconciliation) — the roadmap's other audit-only phase and the one that already carries
  this class of write-up. This retargeting is a document edit only; it does not touch Phase 10's own design or
  plan files.

Also closed as part of this pass: three `unresolved 2026-07-25` markers in `docs/knowledge/tooling-and-quality-gates.md`
(package manager/lockfile, test-runner/coverage-gating, `gts` baseline) that a 2026-07-25 cross-phase checkpoint
had already decided but never back-ported into the corpus itself — directly relevant here since `NFR-5`/`NFR-6`/
`NFR-7` are exactly the rows those stale markers left unconfirmed.

## Open Findings — Phase 3b Validation Review (2026-07-28)

A validation pass over `specs/2026-07-25-phase3b-body-lifecycle-design.md` and
`plans/2026-07-25-phase3b-body-lifecycle.md` (`docs/validation-prompts/phase3b-body-lifecycle-validation-prompt.md`)
returned **BLOCKED** on two runtime defects and a cluster of overclaimed disposition rows. **All findings except
D1 and D2 below are applied** to both documents. Recorded here rather than in the Deferred Items Log because
these are review findings against an unexecuted phase, not deferrals of work.

The two blockers, both now fixed, are worth naming since they generalize: (1) `ReadableStream.cancel()` rejects
with `TypeError` on a locked stream and reading to `{done: true}` does **not** release the reader's lock, so
`Response.bytes()`, `toHttpError()` and the response-logging wrapper each had a `finally`-scoped close that
replaced a successful read with a `TypeError` — a `reader.releaseLock()`-before-cancel constraint now sits in the
plan's Global Constraints, and **every later phase that takes a reader and later closes the stream inherits it**;
(2) `HTTP-39`/`BODY-10`'s exact-length copy was dispositioned as "reuses Phase 3a's `writeAll`" while the plan's
own global constraint forbids importing `BufferedSink`, leaving a declared `contentLength` unverified and a short
stream sending a truncated body silently.

**Cross-phase note for 4b.** 4b's preamble relies on `Response.close()` latching `#closed` before awaiting
`body.cancel()` so a close rejection propagates exactly once. That still holds: the latch is unchanged and the
only rejection now swallowed is the `TypeError` a still-locked external reader produces, which `BODY-15` requires
close to tolerate. Every other close failure propagates as before.

| # | Sev | Finding | Where | Resolution |
|---|---|---|---|---|
| D1 | major — **CLOSED (3b execution)** | Task 13 Step 6 specifies a **minor** changeset on the reasoning that `Request.body`'s move from `unknown` to `Body \| undefined` is "not breaking for any real caller, since `unknown` accepted nothing usable before." That premise is false — `unknown` accepted *everything*, which is exactly why Task 7 Step 1 has to rewrite every `.body('x')` call site in the existing suite. `api-design.md:72` classes a narrowed parameter type as breaking, requiring MAJOR. `ResponseBuilder.body` narrows the same way | PLAN Task 13 Step 6; `api-design.md:72` | **Resolved: branch (b), minor.** `@dexpace/core` is `0.0.0`, and semver's own initial-development carve-out (<https://semver.org/#spec-item-4>) puts a 0.x breaking change out as minor; the pointer is recorded in the changeset itself, not only here. Revisit at 1.0, when the carve-out stops applying and Phases 4a/4b/5's identical narrowings become real majors. The alternatives were (a) ship it as **major**, which is what the corpus rule says and what the plan now instructs by default, or (b) if `@dexpace/core` is still pre-1.0 and the repo's release policy treats 0.x breaks as minor, keep minor and record the policy pointer. The plan carries both branches with the false justification deleted; pick one before Task 13 runs. Settle once — Phases 4a/4b/5 narrow Phase-1 placeholder types the same way |
| D2 | major — **CLOSED (3b execution)** | Three Phase-1/3a symbols the 3b plan now calls could not be verified: `MAX_ARRAY_BYTES` (assumed exported from `io/byte-queue.ts`, backing `AllocationLimitError`'s `limit` argument — used by both logging tees' `BODY-32` cap clamp), `Status.isError` (used by `toHttpError`'s `BODY-31` gate, replacing a `code < 400` that wrongly swept non-standard 6xx into the error path), and `Protocol.token` (used by `TypedResponse`). `packages/` does not exist on the planning branch, so none could be checked | PLAN Task 10, 11 (`MAX_ARRAY_BYTES`), Task 12 (`Status.isError`), Task 9 (`Protocol.token`) | **Verified against the real code.** All three exist and are used: the constant is `MAX_BYTE_ARRAY_LENGTH` in `io/limits.ts` (not `MAX_ARRAY_BYTES` in `io/byte-queue.ts` — the real name was used, no duplicate added), and `Status.isError` and `Protocol.token` are both present as assumed, so `HTTP-11`'s classification is not a Phase-1 gap. Original guidance, kept for the record: Task 11's Interfaces block carries a "Verify before writing" note. If a name differs, use the real one; do **not** add a second constant or a local `isError` helper. If `Status` genuinely has no `isError`, `HTTP-11`'s classification is itself a Phase-1 gap and the gate becomes `code >= 400 && code <= 599` pending that fix |

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

**Correction to 4b's F2 below.** That row states "Phases 1/2/3b/4a ship zero" assertions. **3b no longer does** —
`invariant` pre/postconditions now sit on both tees' caps, `materialize`'s byte accounting, `MultipartBody`'s
framing length, `StreamBody`'s `contentLength`, `drainOnce`'s cap, and `toHttpError`'s buffer loop. Phases 1, 2
and 4a still ship zero, so 4b's F2 remains open as a project-level question for Phase 10 — 3b is now a second
data point alongside 4c that the rule is applicable, not just aspirational.

## Open Findings — Phase 3b Execution (2026-08-25, expanded 2026-08-26)

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
| 5.4 | `Symbol.asyncDispose` + floor bump + `lib` entry | **Open** — E1 below |
| 5.5 | Bounded collections vs `RetentionWindow`/tap | **No action needed** — confirmatory in the checkpoint itself |
| 5.6 | `AbortSignal.any` composition | **No action needed** — confirmatory |
| 5.7 | Flat hoisting lets a package resolve an undeclared dependency | **Open** — E4 below |
| 5.8 | `NFR-14`'s stale "no direct Bun equivalent" reason | **Open** — E7 below |
| 5.9 | `bun test` proves nothing about the Node runtime | **Open** — E5 below, the largest |
| 5.10 | Per-class `#private` justification comments | **Open** — E6 below |
| 5.11 | Phase 4 pre-commitment: `Stage` must not be an `enum` | Not yet due (Phase 4) |
| 5.12 | Tooling conflicts already resolved by the plans | Recorded only |

Partial application is worse here than none at all. `§5.1` is visible in `bunfig.toml` and half of `§5.3` is
visible in `errors.ts`, so a reader checking whether the checkpoint had landed would have found evidence that it
had. **Verify a prerequisite against the artifact it was supposed to produce, not against a spot check.**

| # | Sev | Finding | Where | Resolution |
|---|---|---|---|---|
| E1 | **blocker — CLOSED in 3b, reopened against checkpoint §5.4** | 3b shipped `[Symbol.asyncDispose]` on `Response` and `LoggedResponseBody` on the strength of the design's claim that "the floor is bumped and `lib` extended before 3b starts". Neither happened: `engines.node` is still `">=18.17"` and `lib` is `["ES2022", "DOM", "DOM.AsyncIterable"]`. Two consequences, both real: below Node 18.18 the computed key evaluates to `undefined` and binds the method to the string `"undefined"`; and the symbol's *type* reaches the package only through a dev-only global, so a consumer compiling against the published `.d.ts` on this repo's own declared `lib` fails with `TS2550: Property 'asyncDispose' does not exist on type 'SymbolConstructor'`. No gate covered it — `verify:dual-consumption` runs `node`, not `tsc` | `packages/core/package.json`; `tsconfig.base.json`; 3b design §"Response Body" | **3b reverted to `close()`-only**, matching the decision Phase 3a shipped and every other resource owner still carries, with both classes now asserting the symbol's *absence* so it cannot be reintroduced ahead of the floor. Re-adding it is checkpoint §5.4's job and must land on all seven owners at once — `Transport`, `ByteQueue`, `BufferedSource`, `BufferedSink`, `RetentionWindow`, `Response`, `LoggedResponseBody`. **Version numbers now verified**, discharging §5.4's own "verify against the actual Node release notes before writing the number" instruction: `Symbol.dispose`/`Symbol.asyncDispose` first shipped in **Node 18.18.0**, backported to **20.4.0** — symbols only, not the `using` syntax. So §5.4's "believed 18.18.0" was right and the bump really is patch-level: `>=18.17` → `>=18.18.0`. **Note for 4b's F1:** that finding assumed the floor had already been "raised at most to `18.18.0` at the 2026-07-25 checkpoint" and that `esnext.disposable` was in `lib`. Neither premise holds — see F1's own amended row |
| E2 | major — **OPEN, checkpoint §5.2** | 3b's Task 1 flattened `io/`'s four error leaves off `IoError` on the stated basis that checkpoint §5.2 had already flattened Phase 1's `DomainModelError` tier. It had not, so the taxonomy is now *mixed*: `DexpaceError → EndOfStreamError` is two levels while `DexpaceError → DomainModelError → RequiredFieldError` is still three | `packages/core/src/http/errors.ts`; 3b design §"Error Tree" | **Deliberately not fixed in 3b.** Removing `DomainModelError` deletes a class exported from the public barrel that consumers can `instanceof` — a breaking API change belonging to the checkpoint. The residual is strictly smaller than what preceded it (`io/` no longer adds a second independent violation) and is recorded in 3b's ledger and checklist. **Blast radius, measured:** ten leaves extend it — `RequiredFieldError`, `HeaderValidationError`, `MediaTypeParseError`, `ProtocolParseError`, `UrlConstructionError`, `RequestOptionsValidationError`, `EtagParseError`, `HttpRangeValidationError`, `RequestConditionsValidationError`, `RequestBodyNotAllowedError` — all in one file, and `DomainModelError` itself is a runtime value export, so `instanceof` narrowing on it is live public API. §5.2 pre-specifies the replacement (an exported `isDomainModelError` type-guard union, never a re-subclass), and 3b already proved that pattern twice in-tree with `isIoError` and `isBodyError`. **Sequencing:** §5.2's own note — "Phase 4's error families then land as leaves on `DexpaceError` too, which is what keeps the flattening from being undone one phase later". **Ten queued phases introduce new SDK error types** — 4a (`DuplicateContextKeyError`), 4c (five, including `PillarCollisionError`, `CrossStageEditError`, `ReservedStageError`), 5b (`NonReplayableBodyError`, `SchemeDowngradeError`), 5c (`AuthResolutionError`, `PlaintextCredentialError`, `DigestChallengeUnsupportedError`), 6a (`SerdeError`, `SerializationError`, `DeserializationError`), 6b (`SseStreamError`, `SseLineTooLongError`), 6c (`PaginationError`), 8a (`TransportFailureError`), and 5a/8b, which reuse rather than define. Counted from the phase design docs 2026-08-26; 4b and 7a/7b define none. Every one of those that ships before the flatten is another tier decision taken against the wrong parent. Owned by checkpoint §5.2 |
| E3 | major — **OPEN, checkpoint §5.3** | §5.3 requires every error subclass to carry its identifying inputs as sanitized `readonly` fields, because `JSON.stringify(error)` and structured-log field enumeration bypass `.message` entirely. It was applied to **two** leaves and stopped: `RequiredFieldError` carries `fieldName`, `HeaderValidationError` carries `kind` + `escapedName`. The other **eight** carry nothing — their identifying data exists only interpolated into the message string, which is precisely the shape the rule forbids. Not raised by any of Phase 3b's three review passes either; found only when the checkpoint was audited item by item | `packages/core/src/http/errors.ts` | **Open.** Same file and same ten classes as E2, so doing §5.2 and §5.3 in one pass is strictly cheaper than two. §5.3 also specifies the sanitization shape per leaf: the offending *name* control-character-escaped, the offending *value* never stored raw (a `valueLength`, a masked minimum fragment, or no field at all), and for `MediaTypeParseError` the failing token/offset rather than the full input. It further asks for a file comment on `errors.ts` recording *why* fields are sanitized at construction — that comment is what stops a later contributor "restoring" the raw value |
| E4 | major — **OPEN, checkpoint §5.7** | No isolated linker is configured. `bunfig.toml` carries only a `[test]` block and there is no `.npmrc` at all, so the install is flat-hoisted by default. Under flat hoisting `@dexpace/core` can import a package it never declared and still pass every gate — including `verify:seam-1`, which reads the `dependencies` map rather than what the code actually resolves. That is the one phantom-dependency failure mode `SEAM-1`'s gate structurally cannot see | `bunfig.toml` (no linker key); no `.npmrc`; `scripts/verify-seam-1.mjs` | **Open.** §5.7 requires confirming the exact linker option against the pinned Bun version before writing it. Low effort, and it strengthens a `SEAM-1` guarantee the project treats as foundational |
| E5 | **blocker — OPEN, checkpoint §5.9** | The largest gap, and it has already bitten: **no `test:node` script exists**, yet the 3b plan's Task 13 Step 3 gate sequence calls `bun run test:node` — so that plan cannot be executed as written. `node-floor-conformance` still pins `18.17.0` alone, so current LTS is never exercised, directly contradicting the "in addition to current LTS" half of the rule. All 516 tests run on Bun | `.github/workflows/ci.yml`; root `package.json` scripts; 3b plan Task 13 Step 3 | **Open, and decaying with every phase.** For this codebase specifically: Bun's Web Streams, `AbortSignal` and async-iteration are independent implementations of Node's, and `io/` — chunk boundaries, backpressure timing, microtask ordering — is exactly where they diverge. The `no node: imports` grep proves runtime-*agnostic imports*, a far weaker claim than runtime-*correct on Node*. §5.9 explicitly **rejects** the obvious fix of moving to `vitest`/`node:test`: `docs/knowledge/testing.md` mandates `bun:test` symbol imports, `setSystemTime`, and `--concurrent`, so swapping runners is a styleguide-chapter deviation plus a whole-suite rewrite that buys nothing for the pure-logic majority |
| E6 | minor — **OPEN, checkpoint §5.10** | §5.10 ratifies the `#private` *choice* for wire-model classes but calls the missing per-declaration justification "a real, uncorrected gap" — the corpus wants the reason where a reader meets the field, not in a plan document they will never open. **None** of the eleven `packages/core/src/http/` model files carries one. Measured 2026-08-26 by grepping for a comment naming runtime privacy or citing `HTTP-1`/`SEAM-29` near a `#private` declaration: four files matched and all four were false positives — unrelated `HTTP-10`/`HTTP-11`/`HTTP-13`/`HTTP-18` requirement citations in ordinary TSDoc | `packages/core/src/http/*.ts` | **Open.** One short comment per declaring class (not per field), naming the runtime-privacy requirement and citing `HTTP-1`/`SEAM-29`. §5.10 also asks that the `http-domain-model.md` conflict entry then be resolved as a carve-out **scoped to wire-model classes only**, so it cannot read as blanket permission for `#private` elsewhere |
| E7 | minor — **OPEN, checkpoint §5.8** | The scaffold checklist defers `NFR-14` on the reasoning that pnpm's `catalog:` protocol "has no direct Bun equivalent". Bun has since added workspace catalogs. The *conclusion* (defer to Phase 8) is still right — with one package there is nothing to deduplicate — but the stated reason is wrong, and §5.8's point is that a wrong reason is worse than an open item: at Phase 8 someone reads "no Bun equivalent" and either hand-syncs versions or reopens the pnpm decision | `plans/2026-07-23-scaffold-milestone-checklist.md:45`; two `docs/knowledge` lines | **Open.** Correct the reason, keep the ⏳ status and the Phase 8 target. §5.8 requires confirming the catalog schema against the pinned Bun version before writing any of it |

### Suggested order

**Before Phase 4 starts:**

1. **E2 + E3 together**, in one pass over `packages/core/src/http/errors.ts`. Same ten classes, same file, and
   E2's sequencing argument means every phase that ships first adds leaves to a tier that is about to be removed.
2. **E1** (§5.4's three parts, which do not work separately). Cheaper now than when the checkpoint was written:
   the new `verify:consumer-types` gate mechanically proves a `lib` entry that is declared but whose floor was
   not raised, and proves the reverse too.
3. **Read 4b's F1 before designing against it** — amended 2026-08-26 with the verified `SuppressedError`
   version facts, which resolve it to branch (b). See "F1 resolution — the verified version facts" under
   "Open Findings — Phase 4b Validation Review" further down this document. That amendment changes 4b's design
   input, not just its wording, and F1 already notes the resolution has to land in 5a, 6b and 6c at the same
   time.

**Not blocking Phase 4, ordered by how fast they decay:** E5 (grows with every phase that adds Node-divergent
surface — Phase 4c's pipelines and Phase 8's transports most of all), then E4, E6, E7.

### Phase-3-owned residuals

Distinct from the checkpoint items above: these belong to Phase 3 itself and are recorded in its ledger and
checklist rather than being anyone else's to close.

| Item | Level | Disposition |
|---|---|---|
| Multipart boundary **non-appearance** in part content | `HTTP-51`, ⚠️ partial | RFC 2046 puts two duties on the sender; only the `bchars` grammar half is checkable here, because a `StreamBody` part's bytes do not exist until the write and a partial scan would read as a complete guarantee. Mitigated by generating a 32-character Web Crypto boundary by default and documenting the obligation on both caller-supplied entry points. Revisit only if demand for caller-chosen boundaries appears |
| `StreamBody` always single-use, no mark/reset | `BODY-9` (SHOULD), bounded | Node's `ReadableStream` has no generic mark/reset. Closes only if the platform gains one |
| `BODY-34`'s shared preview-cap **value** | ⏳ Phase 7 | Both tees take the parameter today; Phase 7 owns the `Logger`/config surface that threads one value through them |
| `BODY-4`/`BODY-5` replayability **consultation** | ⏳ Phase 5 | Phase 3 guarantees the property is correct; retry/redirect/auth consult it |
| `FileBody` (`HTTP-40`/`BODY-11`/`12`/`13`/`36`) | ⏳ Phase 8a | Already resolved in 8a's design as `@dexpace/body-file` plus a structural `Body.kind === 'file'` contract |
| Both logging tees unwired to any `Logger` | ⏳ Phase 7 | Mechanism ships now because the IDs are `§6`; nothing constructs one yet. Matches Phase 2 shipping `Serde<T>` with no implementation |

Also worth carrying forward, since three separate defects in 3b traced to the same root: **a `Body`/sink decorator
must forward BOTH teardown paths.** A `WritableStream` adapter that declares `write` and `close` but no `abort`
silently swallows the delegate's abort — the default abort algorithm is a no-op — leaving the real sink open and
locked and letting a truncated body be committed downstream as a complete one. Likewise `pipeTo`'s default
`preventCancel: false` cancels the *source* when the destination fails, which takes cancellation ownership away
from the caller (`BODY-8`). Phase 4c's stage pipeline and Phase 8a's transports both wrap sinks; both inherit this.

## Open Findings — Phase 4b Validation Review (2026-07-28)

A validation pass over `specs/2026-07-25-phase4b-recovery-chain-design.md` and
`plans/2026-07-25-phase4b-recovery-chain.md` (`docs/validation-prompts/phase4b-recovery-chain-validation-prompt.md`)
returned **BLOCKED**. The `RECOV-1`–`RECOV-16` mapping itself is sound and every cross-phase reference 4b consumes
checks out against the earlier phase plans — `toHttpError(): Promise<HttpStatusError | null>` (3b), `RequestOptions.EMPTY`
(Phase 1), `Transport.send(request, options?, signal?)` + `CancellationError` (Phase 2), and `Response.close()` latching
`#closed` *before* awaiting `body.cancel()` so it propagates a close rejection exactly once (3b). Nothing below is a
defect in that mapping. Recorded here rather than in the Deferred Items Log because these are review findings against
an unexecuted phase, not deferrals of work.

**Status (2026-07-28): F3–F10 are applied** to `specs/2026-07-25-phase4b-recovery-chain-design.md` and
`plans/2026-07-25-phase4b-recovery-chain.md`. **F1 and F2 remain open — they need decisions**, and both documents now
carry a blocking notice pointing here. The rows below keep the full finding text so the reasoning survives; the
Resolution column records what was done.

**F1 is cross-phase and blocks four phases, not one.** Phases 5a, 6b and 6c all reach for native `SuppressedError` on
the same false premise, so whichever resolution lands has to land in all four at once.

| # | Sev | Finding | Where | Resolution |
|---|---|---|---|---|
| F1 | **blocker** — OPEN | `SuppressedError` does not exist on the declared runtime floor. `engines.node` is `">=18.17"`, raised at most to `18.18.0` at the 2026-07-25 checkpoint (which exposes `Symbol.dispose`/`Symbol.asyncDispose` only — Node backported those two symbols; `SuppressedError` is a V8 global from the full Explicit Resource Management proposal). `esnext.disposable` in `lib` supplies its *type*, so `new SuppressedError(...)` type-checks and then throws `ReferenceError` at call time — the exact `NFR-10` trap `tooling-and-quality-gates.md:60-61` describes. `bun test` passes locally; the `node-floor-conformance` job pinned to `18.17.0`, `verify:node-floor` and `test:node` all fail | PLAN:19-20 (Tech Stack, claims it is "already available since Phase 3b's checkpoint lib bump" — false), PLAN:804, SPEC:124; also 5a plan:36, 6b design:163, 6c design:192 | **Resolved 2026-08-26: take branch (b)** — the runtime-guarded `suppress()` helper. The "confirm the first supporting Node release" condition this row left open is now discharged, and it settles the choice rather than merely informing it; two of this row's own premises also turn out to be false. See "F1 resolution — the verified version facts" below the table. **Partially applied 2026-07-28:** the false Tech Stack claim is deleted and replaced with a blocking notice at the top of the plan stating the real constraint; the mechanism itself is untouched pending implementation of (b) |
| F2 | major — OPEN | Zero assertions across the whole `recovery/` module — a dozen functions, no `invariant()` call, against `assertions.md:6-7`'s 2-per-function module average (and `styleguide-overview.md:22-23` Rule 8). Neither document acknowledges the rule or argues an exemption. Concretely: no `apply()` checks that a step returned a value at all, so a step returning `undefined` poisons the fold silently. Project-wide inconsistency, not 4b's alone — Phases 1/2/3b/4a ship zero, 4c ships fifteen | PLAN:463-479, 818-859, 964-966, 1352-1370 | **Undecided.** Either postcondition assertions at the fold sites, or a Deviation Ledger row. Worth settling at the project level (Phase 10) rather than per-phase |
| F3 | major — ✅ applied | SPEC:270 still says "the only new failure surface is `wrapCancellation()`'s `invariant()` crash" — stale text from a superseded draft. SPEC:194-204, SPEC:279 and PLAN:63-74 all state the opposite. An agent executing from the File Layout section would restore the `invariant()`, and because the helper runs inside `dispatchWithRecovery`'s own `catch`, that throw bypasses the response and recovery chains — the one failure mode `RECOV-2` exists to prevent | SPEC:270-271 | Replace with `assertNever`'s `InvariantViolation` crash, matching the already-correct PLAN:89-90 |
| F4 | minor — ✅ applied | Spec never designs the `assertNever` addition Task 1 builds. PLAN modifies `packages/core/src/invariant.ts` (new exported symbol, two tests, its own commit); SPEC's File Layout lists only `recovery/` | SPEC:258-268 vs PLAN:102-103, 124-197 | Add the `invariant.ts` line to the spec's File Layout with a one-line note that `fold()` is the codebase's first discriminated-union `switch` |
| F5 | minor — ✅ applied | `RECOV-14`'s second normative sentence (steps safe for concurrent invocation; per-request state never on the step instance) is claimed but neither designed nor tested — both documents cite `RECOV-14` for the defensive copy only. The design does satisfy it (all per-call state is local), but nothing records or guards that | SPEC:141-144, PLAN:49-51 | One sentence in the design + one plan test interleaving two `apply()` calls on one chain |
| F6 | minor — ✅ applied | `RECOV-32`/`RECOV-33` read as silent drops. 4b's deferral sentence covers "backoff, budget, pacing headers → Phase 5"; neither an idempotency-key header injector nor `User-Agent` composition is any of those. Both *are* built — `RECOV-32` in Phase 5a Task 11, `RECOV-33` in Phase 7a Task 9 — but 4b names neither, and 7a is not "Phase 5" | SPEC:18-20 | Extend the Scope sentence to name `RECOV-17`–`RECOV-31`/`RECOV-34` → 5a, `RECOV-32` → 5a, `RECOV-33` → 7a |
| F7 | minor — ✅ applied | `#private` fields with no justifying comment, against `data-modeling.md:20-23` (`private` is the default; `#private` needs a stated runtime-privacy requirement). Neither chain class needs it — unlike 3b's `Response`, whose `#closed` genuinely must survive `Object.freeze(this)`. Inherited pattern: 4a's `ContextStore` does the same | SPEC:64, 78-79; PLAN:464, 819-820, 833, 847 | Ledger row recording `#private` as the package-wide field style with no runtime-privacy claim; project-wide reconciliation is Phase 10's |
| F8 | minor — ✅ applied | Plan's `ResponseRecoveryChain` property test drops half of what the spec specifies. SPEC promises the property also proves the response-step phase never runs on a `Failure` input (`RECOV-4`); the plan's generator emits recovery steps only and never seeds a `Failure`, asserting only that `apply()` settles | SPEC:293-295 vs PLAN:754-773 | **Applied 2026-07-28 — generator extended**, not spec narrowed: the property now generates response *and* recovery steps over a seed that is arbitrarily `Success` or `Failure`, and asserts `responseStepRuns === 0` on every `Failure` seed. Task 3's expected test count moves 12 → 13 |
| F9 | minor — ✅ applied | `fold(outcome, onSuccess, onFailure)` takes three positional parameters, tripping `function-design.md:22-23` ("options object at 3 or more"), which is one stricter than the lint gate (`max-params: ['error', 3]` errors at four). Passes CI while violating the corpus. Phase 2's shipped `Transport.send(request, options?, signal?)` is the same shape | SPEC:36, PLAN:320 | Ledger row recording it as deliberate (matching `Transport.send`), or `fold(outcome, {onSuccess, onFailure})`. See the corpus conflict below |
| F10 | minor — ✅ applied | `statusMappingStep` is a module-level `const` arrow, against `function-design.md:18-21` ("top-level named `function` declarations… arrows are reserved for inline callbacks"). `func-style`'s `allowArrowFunctions: true` will not catch it, and named declarations survive in stack traces — which matters for a function whose whole job is to `throw` | SPEC:227, PLAN:1081 | `export async function statusMappingStep(...)` plus `statusMappingStep satisfies ResponseStep` to keep the conformance check |

### F1 resolution — the verified version facts

Two of F1's premises are false, and the second changes which branch is affordable.

**1. The floor was never raised.** F1 assumed `engines.node` had been "raised at most to `18.18.0` at the
2026-07-25 checkpoint" and that `esnext.disposable` was in `lib`. The checkpoint has not run at all — see
"Open Findings — Phase 3b Execution", finding E1. `engines.node` is still `">=18.17"` and `lib` is
`["ES2022", "DOM", "DOM.AsyncIterable"]`.

**2. `SuppressedError` needs a far higher floor than `Symbol.asyncDispose`.** These are not the same bump, and
F1 treats them as comparable. Node backported the `Symbol.dispose`/`Symbol.asyncDispose` *symbols alone* in
**18.18.0** and **20.4.0**. `SuppressedError` belongs to the full Explicit Resource Management proposal, which
shipped in **V8 13.8 / Chromium 134** and reached Node only in **24.0.0**. So F1's branch (a) — "raise
`engines.node` past the first release shipping Explicit Resource Management" — is not a patch bump from 18.18.
It means `>=24.0.0`, **dropping Node 18, 20 and 22 outright**, which is disproportionate to the need and is
exactly the kind of unsanctioned floor move the checkpoint at plan:57 forbids.

Branch **(b)** therefore wins on cost rather than as a compromise: a runtime-guarded
`suppress(primary, secondary)` helper in `packages/core/src/`, using native `SuppressedError` when
`globalThis.SuppressedError` exists and attaching a `suppressed` property otherwise.

**A third point that must not be lost when E1 lands.** `esnext.disposable` in `lib` supplies
`Symbol.asyncDispose`'s *type*; it does **not** supply `SuppressedError`'s *runtime*. The
type-checks-then-throws-`ReferenceError` trap F1 describes therefore survives E1's floor bump intact. Adding the
`lib` entry is not a fix for F1 and must not be read as one — including by Phases 5a, 6b and 6c, which reach for
native `SuppressedError` on the same false premise and which F1 already notes must be resolved together.

**Corpus conflict surfaced, not a finding.** `function-design.md:22-23` requires an options object at 3+ parameters
while `function-design.md:40-41` sets `max-params: ['error', 3]`, which errors only at four — the prose is one
parameter stricter than its own stated enforcement. F9 is filed against the prose; if the lint threshold is the
authority, F9 dissolves. Worth settling in the corpus rather than per-phase.

A second conflict the 4b documents met and resolved correctly, recorded so a later reader does not re-litigate it:
`resource-management.md:4-5,72` mandates `using`/`await using` and documents that native disposal builds a
`SuppressedError` with the *disposal* failure primary, while `RECOV-12` requires the opposite priority. 4b picks
`RECOV-12` and argues it at SPEC:107-113 / PLAN:55-59. Correct call, already justified in-document.

## Open Findings — Phase 4c Validation Review (2026-07-29)

A validation pass over `specs/2026-07-25-phase4c-stage-pipeline-design.md` and
`plans/2026-07-25-phase4c-stage-pipeline.md`
(`docs/validation-prompts/phase4c-stage-pipeline-validation-prompt.md`) returned **NEEDS WORK — no blockers.**
The `PIPE-1`–`PIPE-40` mapping is sound and every cross-phase reference 4c consumes checks out against the earlier
phase plans: `Transport.send(request, options?, signal?)` + `close()` (Phase 2), `DexpaceError` as the taxonomy
root under `http/errors.ts` (Phase 2's retrofit), `RequestOptions.EMPTY` (Phase 1), `Status.of`/`Protocol.HTTP_1_1`
(Phase 1), and 4a's `createRequestContext(request, init?)`, `promoteToRequest`/`promoteToExchange`,
`ContextStore.install/get/close/clear/size` with the `kind`/`key`/`request`/`instrumentation`/`operationName`
context shape. Nothing below is a defect in that mapping.

**Status: F1–F8 are applied** to both 4c documents. **F9 remains open — it needs a decision.**

| # | Sev | Finding | Where | Resolution |
|---|---|---|---|---|
| F9 | major — **OPEN, needs a decision** | `Cursor` accepts the caller's `AbortSignal`, threads it to the terminal transport, and never checks it between steps. `concurrency-and-async.md:46` requires `signal.throwIfAborted()` "at the top of each loop iteration or before each expensive step"; the step walk (and, worse, a pillar step's fork-driven re-drives) is exactly that. An aborted call keeps walking steps and keeps re-driving until the transport hop finally rejects | PLAN `cursor.ts` `#dispatch`; SPEC "Cursor and fork" | **Undecided**, because the fix is not one line: a raw `signal.throwIfAborted()` surfaces a `DOMException` the SDK taxonomy does not own, against Phase 2's `CancellationError` and `XCUT-1`'s "cancellation is terminal, non-retryable, flag preserved" — and `RECOV-11`/4b's `wrapCancellation` already has a shape for this. Either (a) check in `#dispatch` and map to `CancellationError`, or (b) leave the cursor signal-blind and let 5a's `ctx.signal` + `RETRY-32` carry cancellation, recording (b) as a Deviation Ledger row. Settle before 5a Task 1 lands, since 5a is what makes the signal reachable from a step |
| F1 | major — ✅ applied | `PIPE-17`'s "options MUST be readable by any step" was claimed satisfied while `StepContext` exposes only `next`/`fork`/`context`. A MUST silently unmet is a blocker; it is a legitimate deferral only if the document names the phase that takes it — neither did. (The work itself is already scheduled: 5a Task 1, per the Deferred Items Log row below) | SPEC "Steps", PLAN Self-Review `PIPE-17` row | Both documents now record the partial deferral by name — `StepContext.options`/`.signal` land in **Phase 5a Task 1**; the plan's Global Constraints forbid adding them early, since their shape belongs to their first reader |
| F2 | major — ✅ applied | Spec listed `replace` among the operations that raise `PillarCollisionError` on an occupied pillar; the plan's `replace()` deliberately runs no pillar check. `PIPE-5` exempts replace by name ("it swaps a single occupant within its own stage 1:1") and the collision error points the caller *at* replace — an agent following the spec would have made replacing a pillar step impossible, since the incoming type is distinct by definition | SPEC:285 vs PLAN `replace()` | `replace` removed from the collision bullet, `prependAll` added to it, and the exemption spelled out with `PIPE-5`'s own wording |
| F3 | major — ✅ applied | `afterEach(() => contextStore.clear())` in `runtime.test.ts` and `builder.test.ts`. 4a's plan forbids this by name — it wipes entries a sibling test file installed in the same `bun test` process (`testing.md:50,52`), and 4a's own store tests avoid the singleton for exactly this reason. Not needed either: `Runtime.send()` evicts its own entry in a `finally` on both paths | PLAN runtime.test.ts, builder.test.ts | Both hooks deleted (and the now-unused `afterEach`/`contextStore` imports), replaced by a comment recording why. The one surviving `contextStore.size` read is a before/after **delta** inside a single test, which the 2026-07-26 review already sanctioned |
| F4 | major — ✅ applied | `NFR-13`'s SPDX header was absent from all eleven code listings and from Global Constraints, against "written into Phase 1's plan… line 1 of every new file, all phases onward" (Deferred Items Log) and 4a's precedent | PLAN, every code block | Global Constraints bullet added, `// SPDX-License-Identifier: MIT` prepended to every listing, and Task 6 gains Step 3b's grep — 4a's gate, copied. **Project-wide drift, not 4c's alone:** the 4b, 5a, 5b, 5c, 6b and 6c plans carry no SPDX header either; Phase 9's `NFR-13` sweep is where that gets closed |
| F5 | major — ✅ applied | The design's "**Property tests:**" heading and the Phase 4 checklist's "Property tests where invariants exist ✅ … 4c (edit-order independence, batch ordering)" row both claimed properties the plan never shipped — `builder.test.ts` had no `fast-check` import and two hand-picked examples. `testing.md:29` puts an invariant-bearing assembler like `build()` squarely in property-test territory | SPEC "Testing" vs PLAN builder.test.ts | Three real `fc.assert` properties added (edit-sequence-equals-from-scratch for `PIPE-22`; batch order preserved / reversed for `PIPE-38`), generated over the non-pillar stages so cases exercise ordering rather than `PIPE-5`'s collision. Task 5's expected count 19 → 22; Tech Stack names `fast-check`. The spec's "arbitrary sequence" now says `append`/`prepend`, matching what the generator emits — the anchored edits need a generated anchor that exists, which makes the model larger than the property it proves, so they stay example-tested |
| F6 | minor — ✅ applied | `PillarCollisionError` and `AnchorNotFoundError` carried their symbols as fields but never rendered them into the message, while `PIPE-5` asks the error to "name both step types", `PIPE-21` to identify "the missing type", both 4c documents claimed exactly that, and `error-handling.md:40` requires identifying inputs in the message — a bare `symbol` field is invisible in a stack trace or log line | PLAN errors.ts | Both messages interpolate `String(type)` (`Symbol(retry)`), matching 4a's `DuplicateContextKeyError`; the fields stay for `error-handling.md:44`, and `errors.test.ts` now asserts the message names them |
| F7 | minor — ✅ applied | `StepContext.fork?: () => Next` spelled bare, against the plan's own `exactOptionalPropertyTypes` constraint ("optional properties are spelled `?: T \| undefined`, never bare `?: T`") — the same shape 5a Task 1's added fields will use | SPEC:135, PLAN step.ts | `fork?: (() => Next) \| undefined` in both documents |
| F8 | minor — ✅ applied | Spec's `PipelineBuilder` listing tagged `insertBefore` with `PIPE-19` and `replace` with "PIPE-18/19"; `PIPE-18` covers both inserts and `PIPE-19` covers replace. Also `#exchangeSource` in prose for what is a module-level exported function, not a private field | SPEC:274-275, SPEC:386 | IDs corrected; the prose names `exchangeSource` and says it is the module-level helper |

**Not findings, recorded so they are not re-raised.** Assertion density (`assertions.md:6-7`) is already open
project-wide as 4b's F2 — 4c is the phase that *satisfies* it, not one that violates it. `STAGE_ORDER` and
`PILLAR_STAGES` in `CONSTANT_CASE` sit against `naming-conventions.md:14`, whose worked example is literally a
module-level `new Set(...)` staying `lowerCamelCase` because its contents can mutate; a `ReadonlySet` type does
not make the underlying `Set` deeply immutable and `Object.freeze` cannot fix a `Set`. Left alone because the
casing question is project-wide (Phase 1's `Protocol`/`Status` statics, 4b's constants) and renaming one phase's
two constants would fork the convention rather than settle it — Phase 10's reconciliation owns it.
