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
| 5 | Resilience — Retry, Redirect, Auth | `@dexpace/core` | §9, §10, §11 | §6 |
| 6 | Pagination, SSE, Serde | `@dexpace/core`, `@dexpace/codec-json` | §12, §13, §14 | §7 |
| 7 | Instrumentation & Configuration | `@dexpace/core`, `@dexpace/logging-pino`, `@dexpace/logging-debug` | §15, §16 | §8 |
| 8 | Transport & Async-Runtime Adapters | `@dexpace/transport-fetch`, `@dexpace/transport-undici`, `@dexpace/rx` | §17, §18 | §3.2 (single `Promise` primitive collapses JVM's multi-adapter fragmentation) |
| 9 | Cross-Cutting Invariants & Conformance | all packages, `@dexpace/shrink-test` | §19, §20, appendix B | — |
| 10 | Deviation Reconciliation | — (review only) | — | §10 |

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
| `NFR-2` — each optional capability a separately installable unit (core + ≤1 external lib) | Phase 0 | Phase 8 | No adapter packages exist until `transport-fetch`/`transport-undici`/etc. are scaffolded |
| `NFR-9` — automated shrink-survival regression guard | Phase 0 | Phase 9 (or whenever `@dexpace/shrink-test` is scaffolded) | Explicitly out of scope per the scaffold design's own "Out of scope" list |
| `NFR-11` — concurrency-model agnosticism, no async-framework type leak | Phase 0 | **Resolved in Phase 4c** | 4c's `Step`/`Next`/`Runtime` public surface is `Promise`-only — no RxJS, no generator, no framework-specific async type appears anywhere in the pipeline layer. Deferral closed |
| `NFR-12` — reproducible, byte-identical builds | Phase 0 | Phase 10 / first real release | Soft gap — `tsc`/`bun install --frozen-lockfile` are deterministic by construction but unproven by a real double-build check; not blocking |
| `NFR-13` — SPDX license header per source file | Phase 0 | Phase 1 onward | Soft gap; the spec itself calls this "a review convention, not a mechanical gate" — should be followed starting with Phase 1's first real source files, not retrofitted onto a larger tree later |
| `NFR-14` — single source of truth for dependency/tool versions (Bun `catalog:`-equivalent) | Phase 0 | Phase 8 | Trivially true today (one package, zero deps); becomes a real decision the moment a second package with its own dependencies exists |
| `NFR-15` — self-identifying version metadata (real `User-Agent`, never a placeholder) | Phase 0 | Phase 7 / Phase 8 | No HTTP header-assembly code exists yet |
| `NFR-16` — publish provenance enforced on the release path | Phase 0 | Phase 10 / first real release | `prepublishOnly` + `npm publish --provenance` scripted (Phase 0 Task 3) but never exercised — nothing has been published yet |
| `NFR-8` — shrinker keep/retain configuration | Phase 0 | Phase 10 (Deviation Reconciliation) | Not applicable by design — this port has no reflection-driven discovery surface to keep-configure; re-confirm as a documented deviation, don't re-litigate |
| Peer-dependency dedup for `@dexpace/core` (dual-package-hazard guard) | Phase 0 | Phase 8 | Mechanism specified in `sdk-design-nodejs/02` §2; no adapter package exists yet to declare the `peerDependency` |
| `NFR-10`/`NFR-17` residual — CI running the built artifact against the *declared minimum* Node version (18.17), not just whatever the runner defaults to | Phase 0 | **Phase 2** (pulled forward from Phase 3) | Low-risk while the only export was a trivial `ping()`. Phase 2 is where it stops being trivial: `composeSignal()` calls `AbortSignal.any()`, which landed in **exactly** Node 18.17.0 — the declared floor to the patch version. A floor that is now load-bearing for a *runtime API* fails at run time, not build time, so the `actions/setup-node@18.17` conformance step belongs in the phase that first depends on one |
| `MultipartBody` model (one of HTTP-3's "each builder-based model" list) | Phase 1 | **Phase 3b** | Depends on the body-lifecycle contracts (product-spec §6) this port hasn't built yet; retargeted from "Phase 3" when Phase 3 split |
| `Request`/`Response` real body type (currently `unknown` placeholder) | Phase 1 | **Phase 3b** | Same dependency — the body lifecycle owns the real representation (streams, replayability) |
| `Logger`/`LogEvent` seam | Phase 2 | Phase 7 | `sdk-design-nodejs/03` §3.5 discusses it inside the seam-mapping doc, but it carries no `SEAM-N` ID — it's an `OBS-*` concern the roadmap already scoped to Instrumentation & Configuration |
| `FakeTransport` test double | Phase 2 | **Phase 5 or 6** (re-punted past 4c) | Deliberately not built speculatively — 4a and 4b both used file-local stubs instead, and 4c's own brainstorm chose to keep doing so rather than build a shared double for PIPE-9's empty-pipeline case alone. Retargeted to whichever of Phase 5 (retry) / Phase 6 (redirect/auth) first needs a transport reusable across many multi-scenario tests |
| Phase 4 split into 4a (Execution Context, `§7`) / 4b (recovery-chain primitives, `§8.2`) / 4c (stage-based pipeline, `§8.1`) | Phase 4 brainstorm | — | ~76 combined normative IDs, comparable to Phase 3's ~79 that forced its own 3a/3b split; each sub-phase gets its own brainstorm→spec→plan cycle. Dependency order: 4a first (contexts are the pipeline's own per-call correlation state), then 4b and 4c |
| Real W3C Trace Context generation (trace-id/span-id byte generation, hex encoding, `traceparent`/`tracestate` parsing) — `InstrumentationBundle`'s actual tracing backend | Phase 4a | Phase 7 (alongside `Logger`/`LogEvent`, both `OBS-*`-adjacent instrumentation concerns) | 4a ships only `CTX-14`'s bundle shape and `CTX-15`'s no-op default (`activeSpan`/`tracerFactory` typed `unknown`); a caller gets zero real tracing until a future phase, or a separate adapter package mirroring `Logger`/`LogEvent`'s pattern, supplies one |
| `contextsEqual()` value-equality utility for `ExecutionContext` | Phase 4a | Not scheduled — build only if 4b or 4c turns out to need one | `CTX-6` describes a consequence of key uniqueness, not a mandate for a new equality API; no consumer identified yet, so not built speculatively (same discipline as the original `FakeTransport` deferral) |
| `PIPE-35` — FLATTEN-vs-NEST seeding of a builder from an existing pipeline | Phase 4c | Phase 5 or 6 (whichever first derives one pipeline from another) | Placed under `§8.1`'s "Bridges." heading but **not** bridge machinery — a builder capability independent of the sync/async collapse that disposes `PIPE-31`–`PIPE-34`. Deferred because 4c is the phase that first makes a pipeline constructible at all, so no caller yet holds one to seed from; the MUST clause ("make the choice explicit, never accidental") is vacuously satisfied while no seeding path exists. Future shape: `seedFrom(runtime, 'flatten' \| 'nest')` with an explicit, non-defaulted mode argument |
| `PIPE-2`'s redirect/retry conformance clause and `PIPE-40`'s 2-hop-redirect conformance clause | Phase 4c | Phase 5 or 6 | 4c ships pipeline plumbing and zero pillar steps, so neither clause is testable there. `PIPE-2`'s stage-ordering half *is* covered in 4c; only the "auth step re-runs per redirect hop" half moves. `PIPE-40` itself is a contract on wrapping steps, not on `Cursor`/`Runtime` — it travels with the first redirect step |
| `SEAM-30` cleanup (cancel an orphaned response on the completion race) | Phase 2 | Phase 8 | Documented as a TSDoc contract obligation on `Transport.send()` in Phase 2; only a real Transport implementation has a response to actually cancel |
| Byte-stream provider implementation (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) | Discussed in Phase 2 (`sdk-design/03` §3.1), built in | **Phase 3a** | `sdk-design-nodejs/03` covers this in the same document as Phase 2's other seams — the roadmap's phase split puts the *contract* in Phase 2 and the *implementation* in Phase 3a; don't conflate the two |
| Every buffering **cap** — `BODY-19`'s configurable tap cap, `BODY-30`/`HTTP-52`'s 1 MiB error-body cap, `BODY-34`'s shared preview-size configuration | Phase 3a | Phase 3b | Deliberate placement, not an omission. §5 bounds nothing; **every** cap the product spec mandates sits in §6. A `maxRetainedBytes` cap on `BufferedSource` was considered and rejected — it bounds the *spread* between the fastest and slowest cursor, so in the divergent case a view cannot reach the end, partially failing `IO-19`'s MUST and `sdk-design/03` §3.1's own commitment to satisfy `IO-1`–`IO-42`. Don't re-litigate; wire the §6 caps through instead |
| Promotion of any §5 type into the published `@dexpace/core` barrel | Phase 3a | Phase 3b or later | Phase 3a publishes **nothing** — all of `src/io/` is `@internal`, per styleguide 10.3 and Phase 2's `Serde<T>` precedent. 3b decides whether `BODY-1`'s "write-to-sink" takes `BufferedSink` (promoting §5) or the platform's `WritableStream<Uint8Array>` (never surfacing it). `api-extractor`'s report staying byte-identical across 3a is the mechanical proof this held |
| `MAX_BYTE_ARRAY_LENGTH` constant value (`IO-9`) | Phase 3a | Phase 3a plan time | Core is runtime-agnostic, so `node:buffer`'s constant is off-limits; V8 and JavaScriptCore disagree and both have moved theirs; 12.6 forbids an import-time probe. Design fixes the *mechanism* (conservative constant + `RangeError` backstop); the number itself is confirmed when the plan is written |
| `Symbol.asyncDispose` on §5 resources (styleguide 13.1/13.2) | Phase 3a | Whenever `engines.node` floor moves | Declined for the same reason Phase 2 declined it on `Transport`. `Symbol.asyncDispose` postdates the `>=18.17` floor, and TypeScript does not polyfill it for a library *declaring* the method — the computed key silently becomes the string `"undefined"` at run time. Costs nothing today since no §5 type is public |
| `SEAM-5`–`SEAM-10` (discovery/registration/conflict-resolution machinery) | Phase 2 | **Never** — not deferred | Node has no pluggable byte-stream factory or fragmented async ecosystem to discover across; a permanent, documented simplification vs. the JVM reference, recorded in Phase 10's deviation ledger, not "TODO'd" anywhere |
| Concrete `Serde` implementation (`@dexpace/codec-json`) | Phase 2 | Phase 6 | Phase 2 ships the `Serde<T>` interface only |
| Concrete `Transport` implementations (`@dexpace/transport-fetch`, `-undici`) | Phase 2 | Phase 8 | Phase 2 ships the `Transport` interface only |
| `SEAM-21` — explicit runtime type token for deserialization (the type-witness mechanism) | Phase 2 | Phase 6 | `sdk-design-nodejs/03` §3.3 defers to §7.3. Phase 2's `Serde<T>.deserialize(data: unknown): T` is the erased/inferred generic SEAM-21 forbids, so the interface **will** change shape — which is why Phase 2 keeps `Serde<T>` out of the package barrel and marks it `@internal`, so the rework is not a breaking change to a published API |
| `SEAM-14` — close *behavior* (idempotent, ownership-aware, releases only self-created resources) | Phase 2 | Phase 8 | The `close(): Promise<void>` **signature is locked in Phase 2** — adding a required method to a published seam later is a breaking change. Only the behavior waits, until a transport owns a pool worth releasing |
| `SEAM-12` — concurrent-call conformance test | Phase 2 | Phase 8 | Stated as a TSDoc contract obligation on `Transport.send()` in Phase 2; "fire many concurrent requests and assert no cross-talk" needs a real transport to fire through |
| `SEAM-18` (sync↔async bridges) | Phase 2 | **Never** — not deferred | Same class as `SEAM-5`–`SEAM-10`: a bridge connects two transport seams and this port has one. Every obligation SEAM-18 names presupposes a blocking transport Node cannot idiomatically have. Its one non-bridge clause ("per-call options MUST be threaded through, not dropped") survives as a `Transport.send()` obligation. Record in Phase 10's deviation ledger, don't re-litigate |
| `FileBody` (`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`) — file-backed request body | Phase 3b brainstorm | Phase 8 | Needs `node:fs` (fresh handle per write, zero-copy transfer), which conflicts with `@dexpace/core`'s zero-`node:`-import invariant, mechanically enforced since the scaffold and re-verified every phase since. `sdk-design-nodejs/10` (Deliberate Deviations) does not address this — checked, silent. Rather than carve out an exception in core now, deferred to Phase 8, the phase already scoped as "the most Node-specific judgment calls" per this roadmap's own ordering rationale, where a home (carve-out in core vs. a separate package vs. a generic caller-supplied-stream-factory shape) gets decided deliberately. Phase 3b ships the rest of §6 (`BODY-1`–`BODY-10`, `BODY-14`–`BODY-37` minus the file-specific IDs, `HTTP-36`–`HTTP-52` minus `HTTP-40`) without it |
