# Quality gates

Twenty named steps across two CI jobs, every one of them blocking
([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). Seventeen in the `ci` job, three in a
`node-conformance` matrix that runs after it. `bun run test` passing is not evidence that the work is
done; the whole set is.

## Running them

```bash
node .claude/skills/ci-preflight/run-ci.mjs --clean
```

That is the command. `--clean` sweeps every `dist/` and `*.tsbuildinfo` first, so the run starts from
the tree CI checks out rather than a warm one, and it pins every step to `.bun-version`'s Bun via
mise. Both matter: Phase 8a's transport rows passed on Bun 1.4.0 and failed three ways on the pinned
1.3.14, and a missing `build:deps` entry is invisible against a warm `dist/`.

## The `ci` job, in order

| Step | Command | What it protects |
|---|---|---|
| Install | `bun install --frozen-lockfile` | The lockfile is authoritative |
| Knowledge-corpus structure | `verify:knowledge-structure` | `docs/knowledge/`'s two trees stay separate. First, because it is pure Node over Markdown — a corpus mistake reports in seconds |
| Typecheck | `typecheck` | `tsc --noEmit` per package, over twelve projects |
| Lint | `lint` | `gts lint` — formatting **and** type-aware rules, both fatal |
| Build | `build` | Every package's `dist/` |
| Test | `test --coverage` | Both Bun test trees, one coverage report, 80% line floor |
| Gate self-tests | `test:scripts` | The gates' own logic, on `node --test` |
| API surface | `api` | All 9 committed `etc/*.api.md` reports match |
| Package health | `lint:publish` | `publint` + `attw` over every built package |
| Dual consumption | `verify:dual-consumption` | Plain `node` imports each built package and exercises it |
| Consumer types | `verify:consumer-types` | The built `.d.ts` compiles on the declared `lib` with `types: []` |
| SEAM-1 | `verify:seam-1` | Zero runtime dependencies in **every** package, plus the `@dexpace/core` peer rule |
| SSE-37/38 | `verify:sse-37` | No serde dependency and no reconnect path in core SSE |
| Runtime floor | `verify:runtime-floor` | `tsconfig` target and `engines.node` agree |
| Test partition | `verify:test-partition` | The five files that keep the two `tests/` suites apart |
| Reproducible build | `verify:reproducible-build` | Two clean builds of one tree agree, `dist/` and tarball (`NFR-12`) |
| Dependency audit | `audit` | `bun audit --audit-level=high --prod` |

Three of those deserve their reasons stated, because each exists because something silently broke.

**`test:scripts` tests the gates themselves.** A gate whose own logic degrades — a bad glob, a
swallowed assertion — still exits 0, so nothing else in the run would notice. It became blocking in
Phase 10, and the proof it should have been is that `knowledge.test.mjs` had been failing on `main`
since `36c3f96` with nobody noticing.

**`verify:reproducible-build` runs after every step that needs `dist/`, deliberately.** It sweeps
every `dist/` and rebuilds the workspace twice, so it would otherwise pull the rug from under any
step above that resolves a workspace package by name. It is not the last step — `Dependency audit`
follows it (`.github/workflows/ci.yml:93` then `:96`), and can, because `bun audit` reads manifests
rather than build output.

**`verify:seam-1` covers every package, not core alone.** `NFR-2` is the reason: each optional
capability is core plus at most one external library, and the gate is what makes reaching for a small
utility a red build rather than a code-review argument.

## The `node-conformance` job

Install, build, then `bun run test:node` under real Node — as a matrix over `engines.node`'s declared
floor (`20.3.0`) and `lts/*`, with `fail-fast: false`, because "broken on the floor" and "broken on
LTS" are different diagnoses.

It exists because Bun's Web Streams, `AbortSignal` and `Uint8Array` are an independent implementation
of Node's, and `packages/core/src/io/` is where they diverge. **A change to a runtime-divergent
surface adds a case there, not only to `bun run test`.**

## Two test trees, and the rule between them

```
packages/*/src/*.test.ts      colocated unit tests        bun
tests/conformance/xcut/       cross-cutting conformance   bun
tests/node-conformance/       runtime conformance         node --test, against dist/
```

`bun run test` is the **only** command that runs both Bun trees; it passes `./packages ./tests`
explicitly. A bare `bun test` silently runs only the first, because `bunfig.toml`'s
`[test] root = "packages"` governs discovery — and reports green over a suite it never opened, with no
"0 files matched" to notice.

`tests/node-conformance/` must never run on Bun; that is the only reason the tree exists. One key
holds the line — `bunfig.toml`'s `[test] pathIgnorePatterns` — and Bun accepts an unknown `[test]` key
without complaint, so a typo gives no warning and no failure. Measured on pinned Bun 1.3.14: with the
key, 164 files; without it, 178, of which thirteen pass silently and the fourteenth trips an unrelated
timer assertion. Treat that exit code as an accident, not a control. `verify:test-partition` checks
the key's name and the four other files that must agree with it.

## Gates that are not in CI, on purpose

| Command | Why not |
|---|---|
| `bun run knowledge:drift` | 16 of the 47 corpus sources are a sibling styleguide repository no CI checkout has. Drift is normal and the fix is a re-harvest, not a red build |
| `bun run shrink-test` | Runs inside the default build via `@dexpace/shrink-test`, not as its own step |
| The `housekeeping` skill's probe | A hand-run maintenance tool, like `test:scripts` was before Phase 10 promoted it |

## Per-package obligations

- **A changeset** for any consumer-facing change: `bun run changeset`, never `bunx changeset`. The
  wrapper renames the generated file to `YYYY-MM-DD-<slug>.md`.
- **A regenerated API report** after changing a package's exports: `cd packages/<pkg> && bun run
  api:local`, then commit it. `bun run api` is what CI diffs.
- **A TSDoc block with `@public`** on anything the barrel exports, plus `@throws` naming each
  catchable error class. `api-extractor` records an undocumented export as `(undocumented)` in the
  committed report, which makes the omission a reviewable diff.
- **`// SPDX-License-Identifier: MIT` on line 1** of every source file (`NFR-13`).
- **A requirement-ID citation** in every test file's header comment.
- **A reason on every `eslint-disable`** (`eslint-comments/require-description`, wired for `NFR-7`).
  Suppressing a rule without a stated reason fails lint.
