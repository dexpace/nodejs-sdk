# Scaffold Milestone — Design

**Status:** Draft, approved for planning.

**Purpose:** Bootstrap the `nodejs-sdk` repository from its current state (docs only, no `package.json`) to a
buildable, lintable, testable, dual-consumable state with **zero domain code**. This is Phase 0 of the
[v1 roadmap](../2026-07-23-nodejs-sdk-v1-roadmap-design.md) and the only phase this document covers in detail.

**Why this comes first:** every later phase is written under the styleguide and toolchain gates from line one.
Building domain code before the gates exist means retrofitting lint rules, coverage floors, and API-compatibility
snapshots onto code that was never written with them in mind — expensive and error-prone compared to gating from
the start.

**Governing documents:** `docs/sdk-design-nodejs/02-package-and-workspace-layout.md` (workspace shape, package
map) and `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md` (gate list) for the SDK-specific shape; the
TypeScript styleguide (`/home/mohammad/Projects/dexpace/styleguide/typescript/`) and its Bun companion guide
(`/home/mohammad/Projects/dexpace/styleguide/typescript-bun/`) for tooling and code style, binding from the first
line of code onward. **Where the two disagree on package manager/test runner, the styleguide wins** (resolved
2026-07-23): the project uses Bun, not pnpm — see Components §1 below. sdk-design-nodejs.md's workspace *shape*
(multi-package, `packages/*`, project references) still holds; only the pnpm-specific mechanics are replaced.

## Scope

In scope:

- Bun-based workspace scaffolding (`packages/*`, Bun workspaces, `.bun-version` pin, `bun.lock`).
- A single stub package, `@dexpace/core`, with a trivial placeholder export — enough surface to exercise every
  gate, not enough to constitute domain work.
- The full toolchain/CI gate list, wired and blocking, even though there is near-zero code to check.
- Verification that the built package is consumable from both TypeScript and plain JavaScript.

Out of scope (deferred to their own later phases per the roadmap):

- Any other package (`transport-fetch`, `transport-undici`, `codec-json`, `logging-pino`, `logging-debug`, `rx`,
  `shrink-test`) — created only when its own phase arrives.
- Any domain model, pipeline, resilience, pagination/SSE/serde, or instrumentation code.
- The conformance-checklist test harness (appendix B) — that is Phase 9's concern, once there is behavior to
  conform.

## Components

**1. Workspace init**
Bun workspaces (`workspaces` field in the root `package.json`, `packages/*` layout), root `tsconfig.base.json`
with `composite: true` project references, `.bun-version` committed (exact pin, no range — Bun has no LTS line),
`bun.lock` committed. Shared tool/dependency versions centralized at the workspace root, the Bun-native
equivalent of pnpm's `catalog:` protocol (per **NFR-14**).

**2. Stub package — `@dexpace/core`**
A package directory with `package.json`, its own `tsconfig.json` (project-referencing the root base config,
`lib`/`target` pinned to match a declared `engines.node` floor per **NFR-10** — this is a consumer-facing runtime
floor, independent of which runtime builds the package), and a single placeholder exported value. `dependencies`
committed as a hard-empty object per **SEAM-1**'s zero-runtime-dependency invariant — this constraint holds from
the very first commit, not retrofitted later.

**3. Toolchain gates, wired blocking from day one**

| Gate | Mechanism |
|---|---|
| Package manager | `bun install`, committed `bun.lock`, `bun install --frozen-lockfile` in CI |
| Lint | ESLint, `@typescript-eslint` `strict-type-checked` + `stylistic-type-checked`, gts baseline |
| Type strictness | `tsc --noEmit --strict`, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` |
| Explicit API surface | `explicit-module-boundary-types` + `explicit-function-return-type` lint rules |
| API-compatibility snapshot | `api-extractor` generating a committed `*.api.md` per package (present even for the trivial stub surface); CI fails on undeclared drift |
| Package-health gate | `publint` + `arethetypeswrong --pack .` — verifies `exports`/types resolve correctly under every module-resolution mode, before anything ships |
| Test runner + coverage | `bun test`, `bunfig.toml` `[test] coverage = true`, aggregate threshold |
| Bundle/tree-shake survival | `@dexpace/shrink-test`-style smoke check — config present, exercised against the stub |
| Dependency audit | `bun audit --audit-level=high --prod` as a required CI gate |
| Versioning | `changesets` — every consumer-facing PR carries a changeset; version/changelog derived from merged changesets, not hand-bumped |
| Runtime-floor discipline | `engines.node` and `tsconfig` `lib`/`target` pinned and checked against each other |
| Style rules | gts + this repo's `styleguide/typescript` overlay (70-line cap, `max-depth 3`, `max-params 3`, naming, etc.) enforced via the same ESLint pass |

**4. Dual JS/TS consumption check**
Build tool is plain `tsc` — confirmed correct even in an all-Bun toolchain: a *library* must stay runtime-agnostic
(consumers may run Node, browsers, Deno, or Cloudflare Workers, not just Bun), so `tsc -p tsconfig.build.json`
emits one `.js` per module, matching `.d.ts` declarations, and sourcemaps — never `Bun.build`, which is reserved
for services bundling to one artifact. Verification step confirms:

- `package.json` `exports` map (`types` + `import` conditions, one locked entry point) resolves correctly —
  gated by `publint` + `attw --pack .` (see gate table above), not a hand-rolled check.
- A plain-JS importer (no `ts-node`, no TS toolchain) can `import` the built package and run it.
- A TS importer gets correct types without a manual `.d.ts` reference.

**5. Publish path (scaffolded, not exercised)**
`prepublishOnly` runs build + `api-extractor` verify + `publint`/`attw`. The actual registry publish step uses
`npm publish --provenance` even in this Bun toolchain — `bun publish` has no `--provenance` flag yet, so
provenance stays on `npm` until Bun adds it; everything else (install, build, test, audit) stays on Bun. This
phase scaffolds the scripts; no package is actually published yet.

## Exit Criteria

`bun install --frozen-lockfile && tsc -p tsconfig.build.json && bun run lint && bun test` all green, run against
the stub `@dexpace/core` package, with every gate in the table above wired as a blocking CI step — not just
runnable locally. The dual-consumption check passes for both a JS and a TS importer. No domain code exists
beyond the placeholder export.

## Testing

Since there is no domain logic, "testing" this phase means testing the toolchain itself:

- A trivial unit test exists for the stub export, exercised through the coverage-floor gate, to prove the test
  runner and coverage tool are wired correctly rather than merely configured.
- CI is exercised end-to-end at least once (a real pushed commit or PR) to confirm every gate actually blocks on
  failure, not just that it runs.
- The dual-consumption check is run against the actual built output, not against source — it must catch a
  misconfigured `exports` map, not just assume the config is correct.
