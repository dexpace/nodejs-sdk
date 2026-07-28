# Phase 9 — Cross-Cutting Invariants & Conformance — Design

**Status:** Draft, approved for planning.

**Purpose:** Close the roadmap's build-phase sequence by proving `docs/product-spec/19-cross-cutting-invariants-and-policies.md`
(`XCUT-1`–`XCUT-24`) and `docs/product-spec/20-non-functional-requirements-and-quality-bar.md` (`NFR-1`–`NFR-17`)
hold across the whole workspace, not just within any one phase's own subsystem. Per the roadmap
(`2026-07-23-nodejs-sdk-v1-roadmap-design.md:108-110`), Phase 9 "audits what phases 0-8 built rather than building
anything new" — this document honors that: the only genuinely new production code is one package
(`@dexpace/shrink-test`, satisfying `NFR-9`, already named in the Deferred Items Log against this phase); everything
else is either a cross-package conformance test proving an already-shipped mechanism, or a documentation fix closing
a gap a prior phase left open.

**Governing documents:** `docs/product-spec/19-cross-cutting-invariants-and-policies.md`,
`docs/product-spec/20-non-functional-requirements-and-quality-bar.md`,
`docs/product-spec/appendix-b-conformance-test-checklist.md` (§B.8, §B.9), `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`
(Deferred Items Log), `docs/superpowers/plans/2026-07-25-checkpoint-scaffold-through-phase3a.md` (the one prior
cross-phase audit this roadmap has produced — its structure and its unclosed action items are both inputs here),
every prior phase's own design/plan (cited per-ID below). `docs/knowledge/{cross-cutting-invariants,testing,
tooling-and-quality-gates,deliberate-deviations,seams-and-extensibility,resource-management,cancellation-and-timeouts,
concurrency-and-async,redaction-and-security,authentication,error-handling}.md`.

**How this doc was produced.** Solo, user away from keyboard, `docs/knowledge/` as standing tie-breaker — the same
discipline every prior sub-phase design applied (explicit precedent: 5b/5c's own designs, and 8a's). No packages
exist yet in this repository (confirmed: no `packages/` directory) — this document, like every phase design before
it, is planning only, written against the packages/files earlier phases' own specs and plans describe.

## Scope

Phase 9 ships:

1. **`@dexpace/shrink-test`** — a new, private, unpublished devDependency package implementing `NFR-9`'s
   shrink-and-run regression guard, wired into the default build. This is the one item the Deferred Items Log
   explicitly routes here (roadmap `NFR-9` row: "Phase 9 (or whenever `@dexpace/shrink-test` is scaffolded)").
2. **`tests/conformance/xcut/`** — a new top-level integration-test directory (first use of
   `docs/knowledge/testing.md:8`'s "integration/e2e tests crossing process/network boundaries live under a
   top-level `tests/` directory" convention in this repository) holding one conformance-test file per `§19`
   subsection, each proving its `XCUT-N` rows hold when the real, already-shipped components from phases 0-8
   compose together — not a reimplementation of any subsystem's own unit tests.
3. **A per-ID disposition table** (below) for all 24 `XCUT` IDs and all 17 `NFR` IDs — the same discipline 5a's
   `RECOV-17`–`RECOV-34` table and 8a's `TRANSPORT-N` table already used, extended here to the two ID families nothing
   upstream has ever tabulated end-to-end (the grep across every existing spec/plan turned up exactly two incidental
   `XCUT-N` citations before this phase — `XCUT-2` in Phase 2, `XCUT-3` in 5a's design prose — confirming this really
   is the first systematic pass).
4. **Three documentation fixes** to `docs/knowledge/tooling-and-quality-gates.md`, closing action items the
   2026-07-25 checkpoint already decided but never back-ported into the corpus (§4 below) — directly relevant here
   because `NFR-5`/`NFR-6`/`NFR-7`/`NFR-14` are exactly the rows those markers block a confident "✅" on.

Phase 9 does **not**: touch `NFR-12` (reproducible builds) or `NFR-16` (publish provenance) — both are ledgered in
the roadmap's own Deferred Items Log as "Phase 10 / first real release," and nothing in this phase's scope changes
that; re-implement any subsystem's unit tests; or introduce a new pluggable seam, error type, or public API surface
in `@dexpace/core`.

## Why a cross-package suite, not per-package retrofits

Every `XCUT-N` behavior demonstrably already exists somewhere in phases 0-8 — the greps below prove the mechanism,
not just the requirement text, predates this phase:

- Cancellation/timeout discrimination by `signal.reason.name`, never message-matching (`XCUT-1`/`2`/`3`): Phase 2's
  `composeSignal`/`isTimeoutSignal`, exercised further by 5a's backoff-wait cancellation.
- Cycle-safe cause-chain walks (`XCUT-9`): 5a's `classify.ts` already tracks visited `cause` references by identity
  during its retryability walk (a distinct mechanism from 5b's URI revisit-set for redirect-loop detection, which
  guards a different cycle — the request's own URI history, not an error's `cause` chain).
- CSPRNG nonces (`XCUT-21`): 5c's Digest `cnonce` generation.
- Wait-free credential read + single-flight refresh (`XCUT-12`): 5c's credential cache.
- Bounded, drain-to-cap maps (`XCUT-14`): 4a's context registry, 4b's recovery-chain state, 5c's per-realm nonce
  counters all cite the same pattern independently.
- Immutable wire models (`XCUT-15`): Phase 1, throughout.
- Credential hygiene on redirect (`XCUT-16`/`17`), header-splitting validation (`XCUT-18`): 5b/5c.
- Default-deny redaction, observability-never-throws (`XCUT-19`/`20`): 7b.

So the risk Phase 9 actually guards against is not "does the behavior exist" (it does) but **does it still hold
when every subsystem runs together** — a shared `Transport` instance driven by concurrent calls through the full
retry→redirect→auth→observability stack, not each piece exercised in isolation against a fake. This is the same
justification 8a gave for its shared `transport-conformance` suite (one algorithm, tested once, not per-callsite) —
scaled from "two sibling packages" to "the whole workspace," which is why the right home is the top-level `tests/`
directory `docs/knowledge/testing.md` already reserves for exactly this shape of test, not another private package
(a private package was right for 8a because two *siblings* shared one subsystem's contract; here the consumer is
the workspace itself).

## `XCUT` disposition table

| ID | Already-shipped mechanism (phase) | Phase 9 action |
|---|---|---|
| `XCUT-1` | Phase 2 `CancellationError`, terminal/non-retryable by type | New test: interrupt a real in-flight retry wait (5a) and assert the surfaced error is `CancellationError`, not re-issued |
| `XCUT-2` | Phase 2 `isTimeoutSignal()`, already cites this ID in its own design/plan | Retrofit only: add `XCUT-2` to the existing test's ID-citation comment (it currently cites only `TRANSPORT-4`-shaped IDs in some call sites) |
| `XCUT-3` | 5a backoff wait races a `Promise`/`setTimeout` against the call's signal | New test: cancel mid-backoff, assert near-immediate abort and the armed timer is cleared (no dangling `setTimeout` handle — assert via `bun:test`'s fake timer count) |
| `XCUT-4` | Phase 3a `IoError`, Phase 3b `HttpStatusError`/`toHttpError()`-shaped response-carrying error | New test: a real transport failure and a real 5xx response through the same pipeline, asserted against the two branches simultaneously |
| `XCUT-5` | 5a's status classifier (`RECOV-17`-era table) | Retrofit: confirm 5a's own classifier test already asserts 408/429/5xx-except-501/505; add the two boundary statuses (501, 505) if missing, cite `XCUT-5` |
| `XCUT-6` | 5a's capability-based classifier extension point | New test: a locally-defined custom error type declaring itself retryable via the capability, with **no edit to `classify.ts`**, is retried |
| `XCUT-7` | 5a's configurable retryable-status set | New test: widen the set to include 501, narrow it to exclude 500, assert both against a live classify+retry pass |
| `XCUT-8` | Phase 1's status-to-exception mapping factory | Retrofit: cite `XCUT-8` on Phase 1's existing "rejects non-error status" test |
| `XCUT-9` | 5a's `classify.ts` cycle-safe cause-chain walk | New test: an error whose `cause` points back to itself, run through 5a's classifier as part of the composed retry pipeline, assert no hang |
| `XCUT-10` | 5a's retry-safety gate | New test: the five-way matrix (body-less GET / body-less POST+protocol-error / body-less POST+transport-error / POST+replayable body / POST+streaming body) run once against the composed pipeline, not just 5a's own unit tests |
| `XCUT-11` | Cited by every shared-step phase (2, 4b, 4c, 5a/b/c) as a TSDoc obligation | New test: one shared `Transport`/retry-step instance invoked concurrently (`Promise.all`) with distinct requests carrying distinct correlation ids; assert no cross-talk in the returned responses |
| `XCUT-12` | 5c's credential cache | Retrofit: 5c's own single-flight test already exists; cite `XCUT-12` in its header comment, no new test needed |
| `XCUT-13` | Phase 2 `Transport.close()`, 8a's per-transport close tests | New test: call `close()` twice on a real composed client (not just a bare transport) and assert the second call is a no-op with no throw |
| `XCUT-14` | 4a/4b/5c's bounded, drain-to-cap collections | New test: insert far more than the documented cap into one of these (pick 5c's nonce counter — the one with caller-influenced keys, the exact risk `XCUT-14`'s rationale describes) from concurrent callers; assert size never exceeds the cap |
| `XCUT-15` | Phase 1 immutable models | Retrofit: cite `XCUT-15` on Phase 1's existing builder-mutation-after-build tests |
| `XCUT-16` | 5c's HTTPS-only credential-attach guard | Retrofit: cite `XCUT-16`; 5c's own test already covers this exactly |
| `XCUT-17` | 5b's redirect credential-hygiene (Authorization/Cookie/Proxy-Authorization/userinfo/downgrade) | New test: drive a real same-origin-then-cross-origin two-hop redirect through the composed retry+redirect+auth pipeline and assert the full hygiene set at each hop — 5b's own tests exercise redirect in isolation; this is the first place it runs with a real auth step re-attaching credentials afterward |
| `XCUT-18` | Phase 1 header validation | Retrofit: cite `XCUT-18` on Phase 1's existing control-byte/non-ASCII rejection tests |
| `XCUT-19` | 7b's default-deny redaction | Retrofit: cite `XCUT-19`; 7b's own suite is already exhaustive here |
| `XCUT-20` | 7b's never-throws-into-request-path guard | Retrofit: cite `XCUT-20` |
| `XCUT-21` | 5c's CSPRNG cnonce | Retrofit: cite `XCUT-21` |
| `XCUT-22` | 8a's ownership-aware close (BYO dispatcher never closed) | Retrofit: cite `XCUT-22` on 8a's existing `dispatcher` test |
| `XCUT-23` | **N/A by construction — see below** | Documented disposition, no test |
| `XCUT-24` | 7b's `LOGGING` step body-preview cap (`OBS-36`), built on 3a/3b's tee primitives | New test: a 10 MB response body through the composed pipeline with `loggingStep`'s `previewSizeBytes` set low; assert the captured log preview is truncated and the caller's own full-body read still sees every byte |

**`XCUT-23` resolved as not applicable to this port, not skipped.** The requirement's "explicit-install >
auto-discovery > loud-fail" ordering exists to arbitrate a *classpath/plugin-registry* auto-discovery mechanism —
`docs/knowledge/seams-and-extensibility.md:4,32` names it explicitly (`SEAM-5`). The roadmap's own Deferred Items
Log already records `SEAM-5`–`SEAM-10` as a **permanent simplification, never built in this port** — Node has no
classpath equivalent, and `docs/knowledge/deliberate-deviations.md` confirms the one seam the reference version
targeted (the byte-stream provider) is not pluggable at all here; it is implemented directly against Web Streams.
Checked against every seam this port actually ships: `Transport` (8a — chosen by direct construction:
`fetchTransport()`/`undiciTransport()`), `Serde` (6a — `jsonSerde()`, explicit parameter, "core owns no codec and
must not acquire one"), the logger facade (7b — `getGlobalLogger()`/`setGlobalLogger()`, an explicit call, not a
scan). None of them has a competing auto-discovery path to race against an explicit install. The ordering therefore
holds *vacuously* — explicit install always wins because there is nothing else to win against — which is a
satisfied requirement, not an untested one, in the same sense 8a's design recorded `TRANSPORT-8` as
"scoped out, not a gap" for `transport-fetch`. Recorded in this phase's Deviation Ledger below.

## `NFR` disposition table

| ID | Status entering Phase 9 | Phase 9 action |
|---|---|---|
| `NFR-1` | True by construction — `@dexpace/core`'s `dependencies` field has been hard-empty since Phase 2, mechanically gated by `verify:seam-1` | Confirm the gate still passes against the full tree; no new code |
| `NFR-2` | Resolved: codec half in 6a, transport half in 8a (roadmap Deferred Items Log) | Confirm every adapter package (`transport-fetch`, `transport-undici`, `body-file`, `codec-json`, `logging-pino`, `logging-debug`, `rx`) declares core-plus-at-most-one-external-lib; a one-line audit script, not new logic |
| `NFR-3` | Ongoing per-package discipline (explicit named exports, no internal barrels — `module-organization.md`) | Confirm via each package's existing `etc/*.api.md`; no new mechanism |
| `NFR-4` | `api-extractor` wired since Phase 0/1 | Confirm every published package (not just core) has a committed `.api.md` and the gate is wired into its own `lint:publish`; 6a/7a/7b/8a each added their own — no new package should be missing one by Phase 9 |
| `NFR-5` | Blocking via `bunfig.toml`'s `coverageThreshold = 0.8` since scaffold — but the styleguide-vs-spec tension behind this choice is still marked `unresolved 2026-07-25` in the corpus | **Documentation fix** (§4): back-port the checkpoint's already-decided resolution into `docs/knowledge/tooling-and-quality-gates.md` |
| `NFR-6` | `tsc --noEmit --strict` + `allowJs: false`, warnings-as-errors since scaffold | Confirm still true across all packages added since the 3a checkpoint (4a-8a); no new mechanism |
| `NFR-7` | ESLint `strict-type-checked`/`stylistic-type-checked` overlay since scaffold — same corpus tension as `NFR-5` (gts baseline) | **Documentation fix** (§4) |
| `NFR-8` | **Not applicable by design** — roadmap Deferred Items Log: "this port has no reflection-driven discovery surface to keep-configure; re-confirm as a documented deviation, don't re-litigate" | Re-confirm the deviation reasoning still holds (no new SPI/reflection surface was introduced by phases 4-8) and record it in this phase's Deviation Ledger; no keep-configuration is shipped |
| `NFR-9` | Open — this is Phase 9's one real deliverable | Build `@dexpace/shrink-test` (§3) |
| `NFR-10` | Resolved in Phase 2's plan (`node-floor-conformance` CI job, `verify-node-floor.mjs` / `test:node`) | Confirm the matrix now covers every package added since (8a's transports, 6a's codec) — this is a config-file audit (root CI job's package list), not new test logic |
| `NFR-11` | Resolved in Phase 4c — `Step`/`Next`/`Runtime` are `Promise`-only | Confirm 8b's `@dexpace/rx` (the one place an async-framework type legitimately exists) stays outside `@dexpace/core`'s public surface; a symbol-grep, not a new test |
| `NFR-12` | Deferred to Phase 10 / first release | Out of scope, unchanged |
| `NFR-13` | Review convention since Phase 1 (never mechanically gated, per spec's own text) | A one-time grep-and-fix pass across every file in every package (mechanical, not a design decision) confirming the SPDX header convention Phase 1's plan established actually holds everywhere by Phase 9 |
| `NFR-14` | Resolved in 6a (Bun workspace catalogs) | Confirm every package added since 6a (7a, 7b, 8a) participates in the catalog rather than restating a version; audit, not new mechanism |
| `NFR-15` | Resolved in 7a (design) + 8a (wiring test) | Confirm the wiring test 8a added (`User-Agent` survives the header-drop pass) also exists for any transport added after 8a — none currently planned, so this is a no-op confirmation |
| `NFR-16` | Deferred to first actual publish, not yet scheduled | Out of scope, unchanged |
| `NFR-17` | Blanket "every gate above is blocking" requirement | Satisfied exactly to the extent each row above is — this row has no independent test of its own; it is the aggregate claim the rest of this table supports |

## §3 — `@dexpace/shrink-test`

The one new package. Per `docs/knowledge/tooling-and-quality-gates.md`'s own conclusion (already decided, not
re-litigated here): "an esbuild/Rollup production build asserting a bundle-size budget and a post-tree-shake
runtime smoke test... targets the dual-package hazard of two copies of `@dexpace/core` breaking cross-package
`instanceof` checks after a bundle-and-tree-shake round trip" — this is the Node-appropriate re-expression of
`NFR-8`/`NFR-9`'s JVM shrinker-survival concern (`deliberate-deviations.md`'s own framing, unopposed in the corpus).

```
packages/shrink-test/              # private: true, unpublished devDependency
  package.json                       # devDependency of the workspace root only; no package depends on it
  src/
    fixture-app.ts                    # a tiny synthetic consumer: imports @dexpace/core, @dexpace/transport-fetch,
                                       # @dexpace/codec-json; throws an HttpError from one package, catches it via
                                       # `instanceof` imported from another -- the exact dual-package-hazard shape
                                       # tooling-and-quality-gates.md:116 already specifies
    bundle.ts                          # esbuild build() call: bundle fixture-app.ts, minify, tree-shake
    run-shrink-guard.ts                 # the NFR-9 guard: bundles, asserts a size-limit budget, then runs the
                                        # bundled output in a child process and asserts the instanceof check and a
                                        # full round-trip (request build -> fake transport -> parse) still succeed
  shrink-test.config.ts                # the budget number + which packages participate, analogous to a
                                        # `size-limit`/`bundlesize` config file
```

```typescript
// packages/shrink-test/src/run-shrink-guard.ts (shape)
export interface ShrinkGuardResult {
  readonly bundleBytes: number;
  readonly budgetBytes: number;
  readonly roundTripSucceeded: boolean;
}
export async function runShrinkGuard(): Promise<ShrinkGuardResult>;
```

Wired into the default build as `bun run shrink-test`, added to the root gate sequence (alongside `typecheck`/
`lint`/`build`/`test`/`api`/etc.) so `NFR-17`'s "automatic and blocking" holds for this gate specifically, closing
the one row the 3a-era checkpoint listed as `NFR-9 | Scaffold | Same as above` (i.e., wherever `@dexpace/shrink-test`
finally gets scaffolded) — this is that moment. `NFR-8`'s keep-configuration itself is still not shipped, because
it remains not-applicable (disposition table above); `run-shrink-guard.ts` needs no keep-rules file to assert
against, only the bundle-and-round-trip check.

**Every package's `package.json` gains a `devDependency` on `@dexpace/shrink-test`? No** — only the workspace root
does. `fixture-app.ts` imports the *published* packages by their workspace-catalog version, the same way an
external consumer would after `npm install`, which is the point: this package is testing what a real downstream
bundler sees, not the monorepo's own internal linking.

## §4 — Closing the three `tooling-and-quality-gates.md` conflicts

`docs/knowledge/tooling-and-quality-gates.md`'s `## Conflicts` section carries three entries still marked
`unresolved 2026-07-25`, despite `2026-07-25-checkpoint-scaffold-through-phase3a.md`'s §5.1 and §5.12 already
deciding two of the three in full and the runner half of the third. That checkpoint's own §6 sign-off required
"every `unresolved 2026-07-25` marker touched by §5 is resolved in `docs/knowledge` itself, not only here" — the
markers are still present, so that sign-off item was never actually closed. Phase 9, as the last full audit before
Phase 10, is the right place to finish it rather than let a fourth phase inherit the same stale markers.

- **Package manager and lockfile**: resolved in favor of the styleguide (Bun throughout) — checkpoint §5.12,
  decision already recorded at `2026-07-23-scaffold-milestone-checklist.md:54`. Action: replace the marker with
  this resolution.
- **Test runner and whether coverage gates the build**: resolved as a split — runner is `bun test`/`bun:test`
  (styleguide), gating is the spec's `NFR-5` via `bunfig.toml`'s `coverageThreshold = 0.8` (checkpoint §5.1).
  Action: replace the marker, stating both halves.
- **`gts` as the lint/format baseline**: resolved in favor of the styleguide — the plans extend `gts` in
  `eslint.config.js` and layer `strict-type-checked`/`stylistic-type-checked` on top as the single permitted
  overlay (checkpoint §5.12). Action: replace the marker.

This is a documentation-only action (three sentences replacing three "unresolved" markers with their already-made
decisions) — no code changes, no re-litigation of the choices themselves.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| `XCUT-23`'s explicit-install/auto-discovery/loud-fail ordering is satisfied vacuously, not tested as a race | JVM reference arbitrates a real classpath auto-discovery race for its SPI seams | Every seam this port ships (`Transport`, `Serde`, the logger facade) is explicit-call-only; the classpath/plugin-registry auto-discovery mechanism `SEAM-5`–`SEAM-10` describes is a permanent simplification never built in this port (roadmap Deferred Items Log), so there is no competing resolution path for an explicit install to beat |
| `NFR-8`'s shrinker keep-configuration ships nothing | JVM reference ships ProGuard/R8 keep rules for its reflective/SPI surface | This port has no reflection-driven discovery surface to keep-configure — `deliberate-deviations.md`'s dual-package-hazard framing is the risk that actually carries over, and `@dexpace/shrink-test` (§3) targets that instead |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Reason |
|---|---|---|---|
| `NFR-12` reproducible-build proof (byte-identical double-build check) | Scaffold, re-confirmed here | Phase 10 / first release | Unchanged from the original deferral — `tsc`/`bun install --frozen-lockfile` are deterministic by construction but this remains unproven by an actual double-build comparison; still not blocking |
| `NFR-16` publish provenance signing | Scaffold, re-confirmed here | First actual publish, not yet scheduled | Unchanged — nothing has been published yet |

## Testing

`bun test` for `tests/conformance/xcut/*.conformance.test.ts` (colocated fixtures under
`tests/conformance/xcut/fixtures/`, reusing `@dexpace/transport-conformance`'s local `node:http` server pattern
where a real socket is needed — e.g. the `XCUT-17` cross-origin redirect test). Each file's header comment cites
the `XCUT-N` IDs it exercises, per the project's running convention (8a's `transport-conformance` suite, 5a's
`RECOV-N` citations). `@dexpace/shrink-test`'s own guard runs as a root-level `bun run shrink-test` script, not
`bun test` — it shells out to a child process to run the bundled artifact in isolation, which is a different
concern from an in-process unit/integration test. The full root gate sequence (per the 3a-era checkpoint's §1) gains
one line: `bun run shrink-test`.

## File Layout

```
packages/shrink-test/
  package.json              # private: true; devDependency of the workspace root only
  shrink-test.config.ts
  src/
    fixture-app.ts
    bundle.ts
    run-shrink-guard.ts

tests/conformance/xcut/
  fixtures/
    composed-pipeline.ts     # helper: builds one real retry+redirect+auth+observability-wrapped client over a
                             # real fetchTransport()/undiciTransport() against a local node:http fixture server
  cancellation-and-timeout.conformance.test.ts   # XCUT-1, 3 (XCUT-2 stays a retrofit at its Phase 2 source)
  error-taxonomy.conformance.test.ts              # XCUT-4, 6, 7, 9 (XCUT-5, 8 stay retrofits at their source)
  retry-safety.conformance.test.ts                 # XCUT-10
  concurrency-and-lifecycle.conformance.test.ts    # XCUT-11, 13, 14 (XCUT-12, 22 stay retrofits at their source)
  security-by-default.conformance.test.ts           # XCUT-17 (XCUT-16, 18, 19, 20, 21 stay retrofits at their source)
  diagnostic-previews.conformance.test.ts            # XCUT-24
```

Root `package.json` `scripts` gains exactly one new entry: `shrink-test`. No other script changes.

## Public Barrel

None. `@dexpace/shrink-test` is `private: true` and unpublished — it has no public barrel. `tests/conformance/xcut/`
is not a package at all. Phase 9 adds zero new exported symbols to any published package.

## Error Handling

No new `Error` subclass. Every error type this phase's tests assert against (`CancellationError`,
`TransportFailureError`, `IoError`, the response-carrying protocol-error type, `HttpStatusError`) already exists
from an earlier phase.
