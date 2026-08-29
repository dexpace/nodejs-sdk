---
name: ci-preflight
description: Use before pushing a branch, opening or updating a PR, or whenever asked whether CI will pass, to "run the CI checks", "check CI locally", or to verify a phase is done. Runs every blocking step of .github/workflows/ci.yml against the working tree, reports all failures at once, then resolves them.
---

# CI Preflight

## Overview

`.github/workflows/ci.yml` is 14 blocking steps across two jobs. Every one of them can run
locally, so a red CI run is always avoidable — `bun test` passing is not evidence, and it is
the single most common reason work gets handed over broken.

One command runs all of them, in CI's order:

```bash
node .claude/skills/ci-preflight/run-ci.mjs
```

~2.5 minutes warm on a green tree. Full output per step goes to
`node_modules/.cache/ci-preflight/<step>.log`; only a summary and a tail of each failure
reach stdout, so a red run costs a few hundred tokens rather than the ~40k that thirteen
raw `bun run` calls would.

Do not hand-run the thirteen commands instead. Two things go wrong when you do:

- **Order is load-bearing.** `test`, `api`, `lint:publish` and every `verify:*` gate resolve
  `@dexpace/core` by package name, which lands in `packages/core/dist/`. Run any of them
  before `build` and they either fail with unresolved-module noise or — worse — pass green
  against yesterday's artifact.
- **You will stop at the first failure.** The point is to hand the user the whole list.

## The workflow

1. **Run it.** Add `--skip-install` only if you have not touched `package.json` since the
   last install. **Add `--clean` before you push** — see below; a warm run cannot see a
   whole class of defect that CI hits on its first step.
2. **All green** → say so plainly: CI is all good, naming the count (`all 14 steps passed`).
   Nothing else to do.
3. **Anything red** → report the findings to the user *first*: which gates failed, what each
   one means, and the fix you intend. One line per finding, not a transcript dump.
4. **Then resolve them**, using the playbook below.
5. **Re-verify.** Re-run the affected gates while iterating
   (`--only lint,api --skip-install`), then **one full `--clean` run before reporting done**.
   A subset pass is not a green CI — fixes cross gate boundaries constantly (a lint fix edits
   an export, which moves the API report, which fails `api`).

Report honestly at every step: if a gate still fails, say so with its output. Never describe
a subset run as a full one.

**Resolve means fix the defect, not silence the gate.** Lowering `coverageThreshold`,
deleting a failing test, adding an `eslint-disable`, or regenerating an `.api.md` to bless an
unintended export are all ways to make the runner green while shipping the bug. Where the
real fix is a judgment call — a deliberate spec deviation, a moved runtime floor, an
intentional public-API change — stop and ask. This repo is structured specifically to
prevent silent gaps (`CLAUDE.md`, "Requirement-ID conventions"); a suppression needs a stated
reason and an owner.

## Two failure modes that read as success

Both of these will make you report a passing gate that CI rejects.

- **A compile error in core masks every lint finding.** `typecheck`, `lint` and `build` all
  run `build:core` first, so one bad type in `packages/core/src/` makes all three fail with
  the *same* `tsc` error and `gts lint .` never executes. Fix the compile error, then re-run
  `lint` — the formatting and rule findings are still there, unseen.
- **A warm tree hides missing build prerequisites.** CI checks out a tree with no `dist/` in
  it; yours almost never is one. A package whose `exports` point at `dist/`, imported by name
  from another package's `src/` with nothing building it first, resolves fine locally against
  the leftovers of your last build and fails on a fresh clone. Every gate goes green here and
  CI dies on step 2. **`--clean` is the answer** — it sweeps every `dist/` and `*.tsbuildinfo`
  first, so the run starts where CI starts. It costs ~40s of rebuild.

  This is not hypothetical. PR #52 failed exactly this way: Phase 8a made
  `@dexpace/transport-shared` the second published package imported by name from another
  package's `src/`, `typecheck` and `lint` still pre-built only core, and a warm preflight
  passed all 14 steps on the commit CI rejected. Fixed by `build:deps` — see CLAUDE.md, and
  keep that list current when a new package crosses the same line.
- **The coverage floor fails silently.** `bun test` enforces `bunfig.toml`'s
  `coverageThreshold` (0.8) by **exit code alone**. It prints no threshold message, and the
  summary still reads `0 fail`. The runner prints a `note:` when it detects this; without
  that note you would read the tail and conclude the step passed. (The
  `--coverage-threshold` CLI flag is ignored — bunfig is what gates.)

## Resolution playbook

`fix:` lines the runner prints come from here. Steps are listed in run order.

| Step | A failure means | First move |
|---|---|---|
| `install` | `bun.lock` disagrees with a `package.json`. The tree CI installs is not yours, so nothing after it is measuring the right thing — the runner stops here. | `bun install`, then commit `bun.lock`. |
| `typecheck` | `tsc --noEmit` over all 9 projects. | `Cannot find module '@dexpace/…'` means a build prerequisite is missing from `build:deps`, not a bad import — check with `--clean`. Otherwise a real fix; usual suspects: a missing `.js` extension on a relative import (NodeNext), a type import without `import type` (`verbatimModuleSyntax`), an enum/namespace/parameter property (`erasableSyntaxOnly`). |
| `lint` | Formatting **and** type-aware rules; formatting is an error, not a warning. | `bun run fix` first — it clears every prettier finding. Hand-fix what survives: 70-line function cap, `max-depth` 3, `max-params` 3, explicit return types on exported members. Every `eslint-disable` needs a `-- reason`. |
| `build` | Emit failed. **Blocks the ten gates below it**, which the runner reports `SKIP`. | Fix this before reading anything else; the skipped gates are unknown, not passing. |
| `test` | A failing test, *or* the silent coverage floor (see above). | If the tail says `0 fail`, it is coverage — find the file that dropped below 0.8 in the printed table and test it. Otherwise fix the test or the code. |
| `api` | The committed `etc/<pkg>.api.md` no longer matches the built surface, or an export lacks TSDoc. | Intended export change: `cd packages/<pkg> && bun run api:local`, then commit the regenerated report. `(undocumented)` in the diff means the export needs a `@public` block, plus `@throws` naming each catchable error class. **Unintended** change: revert the export, don't bless the report. |
| `lint:publish` | `publint` + `attw` on every built package's `exports` map, `types`/`main` fields, and declaration resolution. | Fix the manifest. `cjs-resolves-to-esm` is already ignored by design (ESM-only); every other rule is real. |
| `verify:dual-consumption` | A built package is no longer importable and runnable by plain `node` through its package name. | Usually a broken `exports` map or a subpath that ships no JS. |
| `verify:consumer-types` | The built `.d.ts` does not compile on the declared `lib` with `types: []` — i.e. a dev-only global (`@types/bun`) leaked into the public surface. | Remove the dependency on the dev global, or declare it. This gate exists because exactly that defect passed all four gates above it. |
| `verify:seam-1` | A package gained a runtime dependency outside the allow-list, or dropped its committed empty `dependencies` object (an omitted field is a violation too). | Remove the dependency — SEAM-1 is the constraint, not the gate. `@dexpace/core` is a **peer** of the satellites, never a dependency. |
| `verify:sse-37` | Core's SSE code reached for serde or a codec package. | Remove the import; SSE-37/38 forbid the coupling. |
| `verify:runtime-floor` | `engines.node` and the `target`/`lib` a package compiles to have drifted apart. | Move both together, deliberately — never raise one to silence this. |
| `audit` | A high-severity advisory in production dependencies. | `bun audit --prod` for detail. Note the tree is tiny (zero runtime deps by design), so a hit here is usually a transitive dev-dep misclassification worth reading carefully. |
| `test:node` | Bun-vs-Node runtime divergence, almost always in `packages/core/src/io/` — Web Streams, `AbortSignal`, `Uint8Array` chunking. | Fix against Node's semantics. A phase touching a runtime-divergent surface should be *adding* cases here; see `test/node-conformance/README.md`. |

## Local-vs-CI divergences worth stating

The runner reproduces CI's steps, not CI's machine. Two gaps survive, and both belong in
your report when they matter:

- **Node version.** `test:node` runs on whatever `node` is active; CI runs it twice, on the
  `engines.node` floor (**20.3.0**) and on `lts/*`. A green local run on a newer Node does
  not prove the floor. `--node-floor` runs the floor leg via `mise`/`fnm`/`nvm` (downloading
  the toolchain once); the runner prints a note when the active major is not 20.

  **Run it whenever the change adds or edits a file under `test/node-conformance/`**, touches
  `io/`, reaches for a new built-in, or moves the floor. This gap is not theoretical: Phase
  8a's `transport.test.mjs` passed on Node 26 and failed 20 of 22 cases on 20.3.0, because an
  async *root-level* `before` hook does not complete before subtests inside a `describe` when
  a file's only root children are suites — fixed in Node 22, and invisible to every other
  gate. Own hooks from an enclosing `describe`, never the file root.
- **Bun version.** CI pins `.bun-version`; your local `bun` may be newer. Rarely matters,
  but it is the first thing to check if a gate fails in CI and passes locally.

CI also runs `node-conformance` only after the `ci` job succeeds — so locally, a `test:node`
failure alongside other failures is the same signal, just surfaced earlier.

Not in CI at all, so the runner does not include them: `bun run test:scripts` (tests the
gates themselves — run it by hand after touching `scripts/`), and changesets (a
consumer-facing change still needs `bun run changeset`).

## Runner flags

| Flag | Effect |
|---|---|
| `--only a,b` | Run just these step ids. The iteration loop; still respects order and the build-gates-everything rule. |
| `--clean` | Sweep every `dist/` and `*.tsbuildinfo` first, so the run starts from the tree CI checks out. The pre-push default. ~40s. |
| `--skip-install` | Skip the frozen-lockfile install. Safe when `package.json` is untouched. |
| `--node-floor` | Also run `test:node` under Node 20.3.0 via mise/fnm/nvm. |
| `--tail N` | Lines of a failing log to print (default 30). Raise for a wall of tsc errors. |
| — | Each step is capped at 10 minutes and reported `timeout` if it hangs. A gate *can* hang rather than fail — a conformance test holding the event loop open on an unclosed server does exactly that. |
| `--list` | Step ids and the command each runs. |

Exit code is 0 only when every selected step ran and passed. `SKIP` is never a pass.
