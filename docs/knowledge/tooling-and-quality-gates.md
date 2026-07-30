# tooling-and-quality-gates

## Rules
- dexpace TypeScript projects must use gts as the sole toolchain and must not maintain a standalone Prettier or ESLint config, because gts bundles Prettier, ESLint, and a TypeScript base config behind one opinionated dependency so the formatter and linter cannot drift apart between projects.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:66-74` · high · sha:640652667e83</sub>
- Bootstrap a new dexpace TypeScript project with `bunx gts init`, which scaffolds config files and scripts so every package starts identical.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:70` · high · sha:640652667e83</sub>
- Run `gts fix` locally to auto-fix formatting issues and rely on `gts lint` in CI as the enforcement gate, so no developer or reviewer negotiates over formatting output.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:71` · high · sha:640652667e83</sub>
- Delete any hand-rolled `.prettierrc` or parallel `.eslintrc` file and extend gts instead, since they re-open the formatting argument gts exists to close.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:72` · high · sha:640652667e83</sub>
- Prettier defaults as shipped by gts (quote style, semicolons, print width, trailing commas) are final and must not be overridden, because any override forks formatting from every other dexpace repo and from the upstream baseline.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:76-83` · high · sha:640652667e83</sub>
- tsconfig.json must extend the gts base config (`./node_modules/gts/tsconfig-google.json`) and add exactly six strictness flags beyond gts's `strict` defaults, since adding more flags is a guide-level change rather than a per-project choice.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:85-90` · high · sha:640652667e83</sub>
- Use TypeScript 5.8 or newer, tracked to the latest stable release, because `erasableSyntaxOnly` (required elsewhere in the guide) only landed in TypeScript 5.8.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:103-108` · high · sha:640652667e83</sub>
- Pin the TypeScript dependency with a caret range (`^5.8.0`) and bump it only as a deliberate, reviewed change rather than an ambient surprise.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:108` · high · sha:640652667e83</sub>
- Run `bun install` against a committed `bun.lock` file and use `bun install --frozen-lockfile` (or `bun ci`) in CI, since frozen mode installs exactly what the lockfile records and fails the build if `package.json` and `bun.lock` disagree, preventing unreviewed dependency drift.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:112-120` · high · sha:640652667e83</sub>
- Pin the Bun version out-of-band with a committed `.bun-version` file, since Bun has no LTS line, so every developer and CI runner use one resolver and one runtime.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:118` · high · sha:640652667e83</sub>
- Maintain exactly one ESLint overlay file (`eslint.config.js`) that extends gts and layers typescript-eslint's `strict-type-checked` and `stylistic-type-checked` configs on top, since the type-checked tiers catch bugs a syntax-only linter cannot see.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:122-129` · high · sha:640652667e83</sub>
- Every ESLint rule added to the overlay must trace to a chapter of the styleguide, since a rule with no chapter behind it is undocumented taste the next maintainer cannot explain.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:127` · high · sha:640652667e83</sub>
- Set `max-lines-per-function` to 70 with `skipComments: true` and `skipBlankLines: false`, so documentation never pushes a function over the limit but blank-line vertical sprawl still counts against it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:131-138` · high · sha:640652667e83</sub>
- Set ESLint `max-depth` to 3, so nesting past three levels, which hides control flow, becomes a lint error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:140-147` · high · sha:640652667e83</sub>
- Set ESLint `max-params` to 3, since a function reaching for a fourth parameter is usually doing too much or its arguments belong together in an options object.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:140-147` · high · sha:640652667e83</sub>
- Configure a pre-commit hook that runs `gts lint` and `tsc --noEmit`, mirroring the identical CI step, so broken style or type errors are caught before the commit object exists.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:149-156` · high · sha:640652667e83</sub>
- Every `eslint-disable` comment must carry a same-line reason in the form `// eslint-disable-next-line rule-name -- why this is safe here`, so the justification travels with the code it excuses.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:158-165` · high · sha:640652667e83</sub>
- The public API surface should be explicit and minimal, with every exported declaration deliberately public with a declared type, implementation details kept non-exported, and each adapter's public surface kept as small as its capability allows.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:12` · high · sha:5f4684bf7123</sub>
- The public API of every published unit should be captured in a checked-in, machine-comparable snapshot with the build failing on any drift, an intentional API change landed by regenerating and committing the snapshot in the same change, and the regeneration tool must not be used to silence an unintentional break.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:13` · high · sha:5f4684bf7123</sub>
- The build should enforce a minimum aggregate line-coverage floor, currently 80%, across the library units, wired into the default build lifecycle and excluding sample/example code, test-only guards, and test fixtures.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:17` · high · sha:5f4684bf7123</sub>
- Compiler warnings should be treated as errors across every unit, including deprecations.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:18` · high · sha:5f4684bf7123</sub>
- The build should run automated style/lint and static-analysis checks with findings treated as fatal, and where an analyzer cannot run on a given unit's toolchain, disabling it should be a narrowly-scoped, documented exception with explicit re-enable conditions rather than a silent global relaxation.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:19` · high · sha:5f4684bf7123</sub>
- The quality gates backing compatibility snapshots, coverage floor, warnings-as-errors, lint/static-analysis, shrink-survival where applicable, and runtime-floor checks must be enforced automatically and be blocking, failing the standard build/CI rather than being advisory.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:20` · high · sha:5f4684bf7123</sub>
- Each package's `tsconfig` `lib`/`target` must be pinned to match its own declared `engines.node` floor, not inherited loosely from the workspace root's editor-tooling configuration.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:51-52` · high · sha:2d2fd9dcfee4</sub>
- CI must run the built output, not just `tsc --noEmit`, against each package's declared minimum Node version in addition to current LTS.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:52-54` · high · sha:2d2fd9dcfee4</sub>

## Constraints
- By default `bun install` hoists dependencies into a flat `node_modules` layout (the npm/yarn style), so a package can resolve a transitive dependency it never declared.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:117` · high · sha:640652667e83</sub>
- Bun has no LTS release line.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:118` · high · sha:640652667e83</sub>
- A `tsconfig.json` `lib` setting newer than a package's declared `engines.node` floor — for example `lib: [\"ES2023\"]` type-checking `Array.prototype.toSorted` while `engines.node: \">=18.17\"` promises a runtime without it — produces a symbol reference that type-checks cleanly but fails at call time with a `TypeError: X is not a function` on an older runtime.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:43-50` · high · sha:2d2fd9dcfee4</sub>

## Conclusions
- dexpace's monorepo default is Bun's isolated linker (`--linker isolated`, symlinks under `node_modules/.bun/`) for strict per-package isolation, while non-monorepo repos rely on `tsc --noEmit` and review to catch undeclared imports instead of layout-level strictness.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:117` · medium · sha:640652667e83</sub>
- The dead-code-elimination survival gate has a genuinely smaller risk surface in the Node port than the JVM shrink-test, because JS bundlers (esbuild, Rollup) analyze a purely static import/export graph with no reflection equivalent to trip over, unlike R8/ProGuard which must guard against reflection-invoked code looking unreachable.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:27-33` · high · sha:2d2fd9dcfee4</sub>
- The risk that does carry over for the dead-code-elimination gate is the dual-package hazard, where a bundler's module-scope hoisting or misconfigured peer-dependency resolution could cause two non-identical copies of `@dexpace/core` to end up in one bundle, silently breaking the `instanceof` checks the typed exception hierarchy and the `Outcome`/`Tristate` discriminated unions rely on.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:34-37` · high · sha:2d2fd9dcfee4</sub>

## Reference
- Bun's text lockfile `bun.lock` has superseded the old binary `bun.lockb` format since Bun 1.2.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:115` · high · sha:640652667e83</sub>
- The `@eslint-community/eslint-comments/require-description` ESLint rule enforces that every `eslint-disable` comment includes a description.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:165` · high · sha:640652667e83</sub>
- The aggregate coverage floor is a minimum line-coverage percentage computed across all library units combined, not per-unit, excluding samples and test-support code, enforced by the default build.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:5` · high · sha:f0b3d2058626</sub>
- A quality gate is an automated, build-blocking check that fails the standard build when its condition is not met, such as the coverage floor, API-snapshot drift, warnings, lint/static-analysis, shrink-survival, or runtime-floor checks.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:51` · high · sha:f0b3d2058626</sub>
- A porter runs the conformance test checklist, organized by subsystem and referencing requirement IDs, to prove a reimplementation conforms, with a check passing only when the observable behavior matches.
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:1-3` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies the core has zero concrete runtime dependencies beyond the stdlib plus compile-only logging facade (NFR-1) and adapters depend on the core plus at most one third-party library (NFR-2).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:85` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies the public surface is explicit and minimal (NFR-3) and a machine-comparable API snapshot gates drift with regeneration deliberate (NFR-4).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:86` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies the aggregate coverage floor is enforced by the default build (NFR-5), warnings are treated as errors (NFR-6), lint/static-analysis is fatal with documented scoped waivers (NFR-7), and all gates are automatic and blocking (NFR-17).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:87` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies a shrinker keep-configuration is shipped for reflective/SPI surface (NFR-8) and a shrink-and-run regression guard runs in the default build (NFR-9).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:88` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies a declared runtime floor exists with higher-floor features isolated and the emitted-target and visible-API in agreement (NFR-10).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:89` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies the core is concurrency-model agnostic with no async-framework types in the public surface (NFR-11).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:90` · high · sha:0451cc7f3bb4</sub>
- The non-functional conformance checklist verifies reproducible byte-identical artifacts (NFR-12), a per-file license header (NFR-13), a single-source-of-truth for versions/coordinates (NFR-14), runtime-resolvable version metadata never showing a placeholder in packaged artifacts (NFR-15), and artifacts signed on the release/CI path while optional locally (NFR-16).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:91` · high · sha:0451cc7f3bb4</sub>
- ESLint with `@typescript-eslint`'s `strict-type-checked` and `stylistic-type-checked` configs is the Node/TS equivalent of the Gradle ktlint + detekt gate.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:8` · high · sha:2d2fd9dcfee4</sub>
- `tsc --noEmit --strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, as a required CI step is the Node/TS equivalent of Gradle's `allWarningsAsErrors`.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:9` · high · sha:2d2fd9dcfee4</sub>
- `@typescript-eslint/explicit-module-boundary-types` and `explicit-function-return-type` lint rules are the Node/TS equivalent of Kotlin's Explicit-API strict mode.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:10` · high · sha:2d2fd9dcfee4</sub>
- `api-extractor` generating a committed, reviewable `.api.md` report per package is the Node/TS equivalent of Kotlin's `apiCheck`/`apiDump` binary-compatibility snapshots.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:11` · high · sha:2d2fd9dcfee4</sub>
- `c8`/`@vitest/coverage-v8` with a `coverage.thresholds` aggregate floor wired into the default `test` script is the Node/TS equivalent of Kover's 80% aggregate line-coverage floor.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:12` · high · sha:2d2fd9dcfee4</sub>
- `@dexpace/shrink-test` — an esbuild/Rollup production build asserting a bundle-size budget and a post-tree-shake runtime smoke test — is the Node/TS equivalent of the R8 shrink-survival guard (`sdk-shrink-test`).
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:13` · high · sha:2d2fd9dcfee4</sub>
- Agreement between `engines.node` and `tsconfig` `lib`/`target` settings is the Node/TS equivalent of cross-compile toolchain discipline between JDK 8 bytecode and newer stdlib symbols.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:14` · high · sha:2d2fd9dcfee4</sub>
- The pnpm workspace `catalog:` protocol is the Node/TS equivalent of `gradle/libs.versions.toml`.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:15` · high · sha:2d2fd9dcfee4</sub>
- `npm publish --provenance` (Sigstore-based build provenance) is the Node/TS equivalent of GPG-signed publications and a staging repository.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:16` · high · sha:2d2fd9dcfee4</sub>
- `api-extractor` rolls up a package's public surface into one `.api.md` report, fails CI on any undeclared drift, and is regenerated and committed alongside an intentional change, matching the `apiDump` workflow of the Kotlin reference including the discipline of never regenerating to silence an unintentional break.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:20-25` · high · sha:2d2fd9dcfee4</sub>
- `@dexpace/shrink-test`'s runtime smoke test exercises a cross-package check — such as catching an error thrown by `@dexpace/transport-fetch` via `instanceof HttpError` imported from `@dexpace/core` — surviving a full bundle-and-tree-shake round trip, in addition to a plain bundle-size budget assertion via `size-limit`/`bundlesize`.
  <sub>design · `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:37-41` · high · sha:2d2fd9dcfee4</sub>

## Conflicts
- **design vs styleguide: package manager and lockfile** — RESOLVED in favor of the styleguide (2026-07-25, confirmed 2026-07-28 Phase 9 audit). The scaffold implements Bun (`bun.lock`, `.bun-version`, `bun install --frozen-lockfile` as the CI gate) throughout; the design's pnpm/`catalog:` framing describes a toolchain this repository does not use. Decision recorded at `docs/superpowers/plans/2026-07-23-scaffold-milestone-checklist.md:54`; the enforcement properties pnpm's layout gave for free (isolated linker, workspace catalogs) were restored separately — see the Bun workspace catalogs adopted in Phase 6a and the isolated linker set at the 2026-07-25 checkpoint.
  <sub>design `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:50-51` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:112-120` · resolved 2026-07-25, backported 2026-07-28</sub>
- **design vs styleguide: test runner and whether coverage gates the build** — RESOLVED as a split (2026-07-25, confirmed 2026-07-28 Phase 9 audit). Runner: `bun test` with `bun:test` symbol imports (the styleguide's choice) — the design's `c8`/`vitest` framing is dead. Gating: `NFR-5`/`NFR-17` are spec conformance obligations that outrank the styleguide's general "coverage is a trend, never a pass/fail gate" default; `bunfig.toml`'s `coverageThreshold = 0.8` blocks the build, as the scaffold's own plan already implemented.
  <sub>design `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:12` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:47-48,210-213` · resolved 2026-07-25, backported 2026-07-28</sub>
- **design vs styleguide: gts as the lint and format baseline** — RESOLVED in favor of the styleguide (2026-07-25, confirmed 2026-07-28 Phase 9 audit). The plans extend `gts` in `eslint.config.js` and layer `@typescript-eslint`'s `strict-type-checked`/`stylistic-type-checked` tiers on top as the single permitted overlay, satisfying the design's rule set as well; the design's table never mentioning `gts` describes a toolchain this repository does not use.
  <sub>design `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:8-10` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:66-83,122-129` · resolved 2026-07-25, backported 2026-07-28</sub>

## Superseded
