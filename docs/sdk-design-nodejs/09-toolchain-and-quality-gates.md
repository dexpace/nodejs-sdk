## 9. Toolchain and Quality Gates

Every gate CLAUDE.md documents as enforced by the Gradle build has a direct Node-ecosystem counterpart; the port's
CI pipeline should wire each in as a blocking step the same way `./gradlew build` blocks on all of them together.

| Gradle gate | Node/TS equivalent |
|---|---|
| ktlint + detekt (`config/detekt.yml`) | ESLint with `@typescript-eslint`'s `strict-type-checked` + `stylistic-type-checked` configs |
| `allWarningsAsErrors` | `tsc --noEmit --strict` (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) as a required CI step |
| Explicit-API strict mode | `@typescript-eslint/explicit-module-boundary-types` + `explicit-function-return-type` lint rules |
| `apiCheck`/`apiDump` (binary-compat snapshots) | `api-extractor` generating a committed, reviewable `.api.md` report per package |
| Kover 80% aggregate line-coverage floor | `c8`/`@vitest/coverage-v8` with a `coverage.thresholds` aggregate floor wired into the default `test` script |
| R8 shrink-survival guard (`sdk-shrink-test`) | `@dexpace/shrink-test`: an esbuild/Rollup production build asserting a bundle-size budget and a post-tree-shake runtime smoke test |
| Cross-compile toolchain discipline (JDK 8 bytecode vs. newer stdlib symbols) | `engines.node` vs. `tsconfig` `lib`/`target` agreement |
| `gradle/libs.versions.toml` | pnpm workspace `catalog:` protocol |
| GPG-signed publications, staging repo | `npm publish --provenance` (Sigstore-based build provenance) |

A few of these deserve more than a table row.

**The API-compatibility gate** (**NFR-4**) is the one place a close, purpose-built analog already exists rather than
needing to be assembled from parts: `api-extractor` (part of Microsoft's Rushstack tooling, built for exactly this
problem on large TypeScript SDKs) rolls up a package's public surface into one `.api.md` report, fails CI on any
undeclared drift, and is regenerated and committed alongside an intentional change — the identical workflow
`apiDump` gives the Kotlin reference, down to "never regenerate to silence an unintentional break" being the same
review discipline in both ecosystems.

**The dead-code-elimination survival gate** (**NFR-8**/**NFR-9**) has a genuinely smaller risk surface in this port
than the JVM shrink-test guards against, and the smoke test should be scoped accordingly rather than mechanically
copying R8's shape. R8/ProGuard's hardest problem is reflection: code invoked only via annotation processing,
`ServiceLoader`, or reflective construction looks unreachable to a static analyzer and gets stripped unless
explicitly kept. JS bundlers (esbuild, Rollup) analyze a purely static `import`/`export` graph with no reflection
equivalent to trip over, so that entire failure class does not apply here — a large part of why §3.1 could retire
the `IoProvider` discovery mechanism outright is that nothing in this port needs runtime, reflection-driven
plugin resolution to begin with. The risk that *does* carry over is the dual-package hazard noted in §2: a bundler's
module-scope hoisting or a misconfigured peer-dependency resolution could theoretically cause two non-identical
copies of `@dexpace/core` to end up in one bundle, silently breaking the `instanceof` checks the typed exception
hierarchy and the `Outcome`/`Tristate` discriminated unions rely on. `@dexpace/shrink-test`'s runtime smoke test
therefore specifically exercises a cross-package check — e.g., catching an error thrown by `@dexpace/transport-
fetch` via `instanceof HttpError` imported from `@dexpace/core` — surviving a full bundle-and-tree-shake round trip,
in addition to a plain bundle-size budget assertion (via `size-limit`/`bundlesize`) catching the more mundane failure
mode of one adapter accidentally pulling in another.

**Runtime-floor discipline** (**NFR-10**) reproduces the same trap CLAUDE.md documents for
`sdk-transport-jdkhttp`/`sdk-async-virtualthreads` — a toolchain compiling against a newer standard-library surface
than the artifact's declared floor, producing a symbol reference that link-checks fine on the build machine but
fails at call time on an older runtime (`NoSuchMethodError` on the JVM; a plain `TypeError: X is not a function` in
Node). The TypeScript-specific version of this trap is a `tsconfig.json` `lib` setting newer than the package's
declared `engines.node` floor — for instance, `lib: ["ES2023"]` type-checks a call to
`Array.prototype.toSorted` cleanly while `engines.node: ">=18.17"` promises a runtime that does not have it,
producing exactly the same class of silent, deferred-to-call-time failure the JVM side already learned to guard
against. Each package's `tsconfig` `lib`/`target` must be pinned to match its own declared `engines.node` floor, not
inherited loosely from whatever the workspace root happens to use for editor tooling, and CI should run the built
output — not just `tsc --noEmit` — against each package's declared minimum Node version in addition to current LTS,
the direct analog of running each JVM module's tests against its declared toolchain rather than trusting the
compiler alone.

---

