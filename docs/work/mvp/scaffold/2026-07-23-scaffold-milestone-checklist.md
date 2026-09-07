# Scaffold Milestone Implementation Plan — Checklist

Verification of [2026-07-23-scaffold-milestone.md](./2026-07-23-scaffold-milestone.md) against the actual
requirement text in `docs/product-spec/` (not just the citations `docs/sdk-design-nodejs/` makes of it), plus the
Bun-specific mechanisms `sdk-design-nodejs/02` calls for.

**Scope boundary.** `docs/product-spec/appendix-c-consolidated-normative-requirement-index.md` lists 19
requirement-ID prefixes. Seventeen of them (`HTTP`, `IO`, `BODY`, `CTX`, `PIPE`, `RECOV`, `RETRY`, `REDIR`, `AUTH`,
`PAGE`, `SSE`, `SERDE`, `OBS`, `CFG`, `TRANSPORT`, `ASYNC`, `XCUT`) are behavioral contracts on domain code — this
phase ships zero domain code, so none of them are evaluable yet. They aren't listed item-by-item below; they're
tracked at their respective phases in
[2026-07-23-nodejs-sdk-v1-roadmap-design.md](../2026-07-23-nodejs-sdk-v1-roadmap-design.md). Only the two
prefixes with toolchain/architectural-level applicability — `NFR` (17 requirements) and `SEAM` (2 of its 30
requirements: `SEAM-1`/`SEAM-2`, the architectural ones; `SEAM-3` onward are seam *behavior* contracts, equally
out of scope until Phase 2) — are checked here.

**Legend:** ✅ Addressed — ⏳ Deferred (named target phase) — N/A — Not applicable to this phase — ⚠️→✅ Gap found
during this verification pass, fixed in the plan (see the plan's Self-Review section for the diff).

## SEAM (architectural-level)

| ID | Level | Requirement (verbatim gist) | Status | Where |
|---|---|---|---|---|
| SEAM-1 | MUST | Core MUST NOT embed a concrete transport/I-O/codec; runtime deps limited to stdlib + compile-time logging facade. | ✅ | `dependencies: {}` in `packages/core/package.json` (Task 3); mechanically enforced by `scripts/verify-seam-1.mjs`, blocking in CI (Task 6, Task 8). ⚠️→✅ the enforcement script itself was the gap — `sdk-design-nodejs/02` explicitly calls for "a CI script [that] parses [`dependencies`] and fails the build the moment anything is added"; the original plan draft had the empty object but no script checking it stays empty. |
| SEAM-2 | MUST | Each core-owned external concern MUST be exactly one narrow interface seam; core MUST NOT reference a concrete implementation by name. | N/A this phase | No seams exist yet — Phase 2 (Seam Foundations) per the roadmap. |
| SEAM-3 .. SEAM-30 | mixed | Byte-stream provider, transport (sync/async), wire-codec, operation-input projection, discovery/registration, resource ownership, shared construction contract. | N/A this phase | Behavioral seam contracts, require actual seam implementations. Phases 2–8 per the roadmap. |

## NFR (non-functional / quality bar)

| ID | Level | Requirement (verbatim gist) | Status | Where |
|---|---|---|---|---|
| NFR-1 | MUST | Core depends only on stdlib/runtime + compile-time-only logging facade; zero runtime deps. | ✅ | Same mechanism as SEAM-1 above (Task 3, Task 6). |
| NFR-2 | SHOULD | Each optional capability is a separate unit depending on core + at most one external lib. | ⏳ Phase 8 | No adapter packages (`transport-fetch`, `transport-undici`, `logging-pino`, etc.) exist yet — only `@dexpace/core`. |
| NFR-3 | SHOULD | Public API surface explicit and minimal; single entry point where possible. | ✅ | `exports` map has exactly one entry (`"."`, Task 3); one named export, `ping` (Task 4). |
| NFR-4 | SHOULD | Public API captured in a checked-in, machine-comparable snapshot; build fails on drift. | ✅ | `api-extractor`, committed `etc/core.api.md`, `api:ci` blocking in CI (Task 5, Task 8). |
| NFR-5 | SHOULD | Aggregate line-coverage floor (80%) wired into the default build. | ⚠️→✅ | `bunfig.toml`'s `coverage = true` alone only *reports* coverage — doesn't fail below the floor. Fixed by adding `coverageThreshold = 0.8` (Task 1 Step 4). |
| NFR-6 | SHOULD | Compiler warnings treated as errors across every unit. | ✅ | `tsc --strict` has no separate "warning" tier — every diagnostic is an error; every custom ESLint rule in the overlay is configured at `'error'` severity, never `'warn'` (Task 2). |
| NFR-7 | SHOULD | Lint/static-analysis findings fatal; any disabled analyzer is a narrow, documented, re-enable-conditioned exception. | ✅ | ESLint blocking in CI (Task 2, Task 8); Global Constraints mandates a same-line reason on every `eslint-disable`. |
| NFR-8 | MUST | Ship keep/retain config so a downstream shrinker's reflectively-reached surface survives shrinking. | N/A | Conditional requirement — applies "in target ecosystems that support... tree-shaking" *and* that need reflection-style keep-rules. `sdk-design-nodejs/09` documents why this port has no reflection-driven discovery surface at all (the `IoProvider`-style mechanism is retired outright, §3.1) — there is nothing to keep-configure by design, not by omission. Worth re-confirming explicitly as a documented deviation in Phase 10 (Deviation Reconciliation), not actionable now. |
| NFR-9 | SHOULD | Automated regression guard for the shrink-survival config, wired into the default build. | ⏳ Phase 9 (or wherever `@dexpace/shrink-test` is scaffolded) | Explicitly out of scope for this phase per the design doc's own "Out of scope" list; already flagged in the plan's Self-Review. |
| NFR-10 | MUST | Declared lowest-supported-runtime floor; artifact target and visible-API level must agree; higher-floor capability isolated into its own unit. | ⚠️→✅ | `tsconfig.base.json`'s `lib: ["ES2022"]` existed in the original draft, but `packages/core/package.json` had no matching `engines.node` declaration — the *consumer-facing* half of the requirement. Fixed: `"engines": {"node": ">=18.17"}` added (Task 3). **Residual gap, not fixed:** the spec's conformance test — "run each unit's artifact on its declared minimum runtime" — isn't wired into CI; Task 8 runs everything on whatever Node version the GitHub Actions runner defaults to, not pinned to 18.17. Low risk for a single trivial export, but real; recommend adding an `actions/setup-node@v4` step pinned to `18.17` running `scripts/verify-dual-consumption.mjs` once real Node-API usage lands (Phase 1 onward), rather than adding it now for a function that touches no runtime API. |
| NFR-11 | SHOULD | Core concurrency-model agnostic; no async-framework types leak into the public surface. | N/A this phase | No async code exists yet — Phase 4 (Execution Context & Pipelines). |
| NFR-12 | SHOULD | Reproducible builds — identical source yields byte-identical artifacts. | ⏳ not verified | `bun install --frozen-lockfile` + plain `tsc` are both deterministic by construction, but nothing in the plan *proves* it (e.g. build twice, diff digests). Not blocking for a stub; worth a real CI check once artifacts are actually published (around Phase 10 / first release). |
| NFR-13 | SHOULD | Every source file carries the project's license/SPDX header. Explicitly "a review convention, not a mechanical gate" per spec text. | ⏳ not addressed | `packages/core/src/index.ts` and `index.test.ts` (Task 4) carry no header. Since the spec itself says this is a review convention rather than a mechanical gate, not fixing inline — but flagging so the convention starts at Phase 1 when real files begin landing, rather than being retrofitted later across a larger tree. |
| NFR-14 | SHOULD | Dependency/tool versions and coordinates live in one source of truth, not restated per unit. | ✅ for now / ⏳ formalize at Phase 8 | Trivially true today — one package (`@dexpace/core`), zero deps, all devDependencies centralized at the workspace root (Task 1). `sdk-design-nodejs/02`'s original mechanism was pnpm's `catalog:` protocol, which has no direct Bun equivalent wired in this plan. Not a gap yet because there's nothing to restate across packages — becomes a real design decision the moment a second package is scaffolded (Phase 8, first adapter package with its own runtime peer-dependency like `undici` or `pino`). |
| NFR-15 | SHOULD | Published artifacts embed self-identifying version metadata (e.g. a real `User-Agent`, never a placeholder). | N/A this phase | No HTTP/User-Agent code exists yet — relevant once instrumentation/transport code assembles request headers (Phase 7/8). |
| NFR-16 | SHOULD | Published artifacts cryptographically signed for provenance; enforced on release/CI, optional locally. | ⏳ scaffolded, not exercised | Matches the design doc's own framing exactly: `prepublishOnly` wired (Task 3, this pass's fix), `npm publish --provenance` is the documented mechanism (Global Constraints) — but no actual publish/provenance CI job exists yet, correctly, since nothing is being published in this phase. |
| NFR-17 | MUST | All the quality gates above MUST be enforced automatically and blocking, not advisory. | ✅ with one residual note | Every gate that applies at this phase (NFR-1/3/4/5/6/7) is wired as a blocking CI step (Task 8). The one gate explicitly named in NFR-17's own text that isn't fully blocking yet is the **runtime-floor check** — see NFR-10's residual gap above; everything else this requirement covers is either blocking now or legitimately not-yet-applicable (shrink-survival, NFR-8/9). |

## sdk-design-nodejs-specific mechanisms (not separate requirement IDs, but explicitly named)

| Item | Source | Status | Where |
|---|---|---|---|
| Bun vs pnpm reconciliation | `sdk-design-nodejs/02` (pnpm) vs styleguide ch01/typescript-bun (Bun) | ✅ Resolved | Styleguide wins per your 2026-07-23 decision; scaffold design doc's Components §1 and this plan's Task 1 use Bun throughout. |
| Peer-dependency dedup for `@dexpace/core` | `sdk-design-nodejs/02` — every adapter declares core as a `peerDependency` to avoid a dual-package hazard | N/A this phase | No adapter packages exist yet — Phase 8. |
| Library build via plain `tsc`, never `Bun.build` | `typescript-bun/08-build-and-distribution.md`, 8.1 | ✅ | Task 3's `build` script is `tsc -p tsconfig.build.json`; Global Constraints states this explicitly as a permanent rule, not a one-time choice. |
| `bun publish` has no `--provenance` flag | `typescript-bun/08`, 8.6 | ✅ Documented | Global Constraints and Task 3's `prepublishOnly` note both call this out; actual publish step deferred (correctly) past this phase. |

## Summary

Four gaps found and fixed in the plan during this verification pass (marked ⚠️→✅ above): `engines.node`
(**NFR-10**), coverage threshold enforcement (**NFR-5**), the **SEAM-1** dependency-audit script `sdk-design-
nodejs/02` explicitly requires, and `prepublishOnly` wiring. Five items are legitimately deferred to a named
future phase (**NFR-2**, **NFR-9**, **NFR-11**, **NFR-15**, peer-dependency dedup). Three are soft, non-blocking
notes for later hardening rather than plan defects (**NFR-12** reproducibility proof, **NFR-13** SPDX headers,
the residual **NFR-10**/**NFR-17** pinned-runtime CI check). One (**NFR-8**) is not applicable by design, per
`sdk-design-nodejs/09`'s own documented reasoning, to be re-confirmed at Phase 10.
