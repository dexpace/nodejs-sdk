# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js/TypeScript HTTP SDK platform, built as a **port of a language-agnostic product specification**. The
spec in `docs/product-spec/` is normative and numbered; the code exists to satisfy it. Work here is
spec-driven, not feature-driven: before implementing anything, find the requirement IDs it must satisfy.

Bun workspace. Two published packages today — `@dexpace/core` (`packages/core`) and the reference wire codec
`@dexpace/codec-json` (`packages/codec-json`, a `@dexpace/core` **peer**, never a dependency) — with more
planned per `docs/sdk-design-nodejs/02-package-and-workspace-layout.md`. Every gate below runs over all of
them, not over core alone.

## Commands

All run from the repo root unless noted.

```bash
bun install --frozen-lockfile

bun run build:core       # tsc -b of core's declarations; incremental
bun run build:deps       # build:core + the other packages another package's src or tests/
                         #   imports BY NAME; a prerequisite of the four below
bun run typecheck        # build:deps, then tsc --noEmit per package
bun run lint             # build:deps, then gts lint . — formatting AND type-aware rules; fatal
bun run fix              # build:deps, then gts fix . — autofixes formatting/lint
bun run build            # build:deps, then plain tsc for the rest → each package's dist/
bun run test             # BOTH test trees (see below); needs `build` first; coverage on, 80% line floor
bun run test:node        # Node-runtime conformance against the BUILT artifact; needs `build` first
```

**Anything that resolves a workspace package by name needs that package's `dist/` to exist**, from Phase 6a
on — a consumer reaches it only through its published entry point, and both `tsc` and Bun follow the
`types`/`main` fields there. `typecheck`, `lint`, `fix`, and `build` each run `build:deps` first for that
reason, so every one of them works on a fresh clone. Both legs are `tsc`, so a warm repeat is close to free.
Do not drop that prefix to "save a step": without it `typecheck` fails with unresolved-module errors the
moment `dist/` is absent, which is exactly what a CI runner sees.

**`build:deps` is the list, and it grows.** It is core, `@dexpace/transport-shared`, `@dexpace/codec-json` and
`@dexpace/transport-fetch` today. A package belongs in it the moment another package's `src/` — or the top-level
`tests/` tree — imports it *by name* and its `exports` point at `dist/`.
Phase 8a proved the cost of missing one: `transport-shared` landed as the second such package, `build:core`
stayed the prefix, and CI failed on `typecheck` at the first fresh clone while every local gate stayed green
against a warm `dist/`. Phase 9 grew it twice over for one reason: `packages/shrink-test/src/` imports `codec-json` and
`transport-fetch` by name, and so does `tests/conformance/xcut/`. `@dexpace/transport-conformance` is
deliberately absent — it is `private` and its `exports` name `./src/index.ts`, so it resolves unbuilt. Check the
graph, not this sentence:

```bash
for d in packages/*/; do grep -rhoE "from '@dexpace/[a-z-]+'" "$d/src" | sort -u; done
grep -rhoE "from '@dexpace/[a-z-]+'" tests | sort -u          # the second test tree counts too
```

`node .claude/skills/ci-preflight/run-ci.mjs --clean` is what catches a missing entry — it sweeps every
`dist/` and `*.tsbuildinfo` first, so the run starts from the tree CI checks out rather than a warm one.
It also pins every step to `.bun-version`'s Bun by default (via mise, falling back to PATH's with a loud
banner): CI resolves that file, and Bun's `fetch`/`node:http` differ enough between releases that Phase 8a's
transport rows passed on 1.4.0 and failed three ways on the pinned 1.3.14. `--clean` plus that default is the
difference between "the gates pass here" and "CI will be green".

**There are two test trees, and `bun run test` is the only command that runs both.** Colocated unit tests
live under `packages/*/src/`; everything that crosses a process, a network, or a *runtime* boundary lives
under `tests/`. Styleguide 11-testing scopes that rule to process and network boundaries; this repo reads a
**runtime** boundary the same way, and the Node suite is why — see the hard rule below. The root script is
`bun test ./packages ./tests` — two trees, one process, one coverage report, one exit code.

`tests/` in turn holds one subdirectory per **runner**, and they are not interchangeable:

```
tests/
  conformance/xcut/     # Bun runner, part of `bun run test`
  node-conformance/     # node --test, run by `bun run test:node`, against the built dist/
```

**A bare `bun test` silently runs only the first tree.** `bunfig.toml`'s `[test] root = "packages"` governs
discovery, so a bare invocation never visits `tests/` and reports green over a suite it never opened, with
no "0 files matched" to notice. Explicit `./`-prefixed paths override the root — a plain `tests/...`
argument is treated as a name filter and matches nothing, which is its own quiet failure. The coverage floor
does still fire on the combined run (confirmed by raising `coverageThreshold` and watching it exit 1), so
CI's Test step is `bun run test --coverage` rather than the bare form.

**Neither form reaches `tests/node-conformance/`**, and that is enforced by a config key rather than by the
file system — read the hard rule below before touching it.

**Either form needs `bun run build` to have run first**, from Phase 6a on: `@dexpace/codec-json`'s tests reach
core through its published entry point, which Bun resolves to `packages/core/dist/`. On a fresh clone they
cannot resolve core at all; against a stale `dist/` they report green over yesterday's core. CI is safe — its
Build step precedes its Test step. The root `test` script deliberately does not build first, so the inner loop
stays fast; rebuild when you have changed `packages/core/src/`.

`test:node` is a separate, thin layer under `tests/node-conformance/` that runs the same built package under
`node --test`, because Bun's Web Streams / `AbortSignal` / `Uint8Array` behavior is an independent
implementation of Node's and `src/io/` is where they diverge. **A phase that touches a runtime-divergent
surface adds a case there, not only to `bun run test`** — see `tests/node-conformance/README.md`. Cases sit
flat in that directory and are named `*.test.mjs`; the runner glob does not descend.

Single test file or single test:

```bash
bun test packages/core/src/http/media-type.test.ts
bun test -t 'rejects blank input'                    # filter by test name
bun test ./tests/conformance/xcut                    # a tests/ path needs the ./ prefix
```

API surface — one committed report per package (`packages/core/etc/core.api.md`,
`packages/codec-json/etc/codec-json.api.md`):

```bash
cd packages/core && bun run api:local     # regenerate that package's report after changing its exports
cd packages/codec-json && bun run api:local
bun run api                               # verify BOTH match — this is what CI runs
```

Release-shape and invariant gates:

```bash
bun run lint:publish              # publint + attw against every built package
bun run verify:dual-consumption   # plain `node` imports each built package and exercises it end to end
bun run verify:consumer-types     # the built .d.ts compiles on the declared `lib` with types: []
bun run test:node                 # CI runs this as a matrix over engines.node's floor and current LTS
bun run verify:seam-1             # zero runtime dependencies in EVERY package, plus the @dexpace/core
                                  # peer-dependency rule that guards the dual-package hazard
bun run verify:sse-37             # no serde dependency and no reconnect path in core SSE
bun run verify:runtime-floor      # tsconfig target vs package engines.node consistency
bun run verify:test-partition     # the five files that keep tests/ and tests/node-conformance/ apart
bun run verify:reproducible-build # two clean builds of one source tree agree, dist/ and tarball (NFR-12)
bun run test:scripts              # the gates' OWN tests (node --test scripts/*.test.mjs)
bun run audit                     # bun audit --audit-level=high --prod
```

**Every one of these is a blocking CI step** (`.github/workflows/ci.yml`). Run the full set before claiming
work is done — `bun run test` passing is not sufficient evidence.

`test:scripts` tests the *gates themselves* — the knowledge CLI, `verify-seam-1.mjs`, `verify-sse-37.mjs`,
`verify-test-partition.mjs`. Phase 10 made it a blocking CI step, closing `docs/open-items.md` H13. It was
not one before, and the proof that it should have been is that `knowledge.test.mjs` had been failing on
`main` since `36c3f96` with nobody noticing. A gate whose own logic degrades still exits 0, so nothing else
in the run would.

### HARD RULE — the `tests/` partition

`tests/` holds two suites. They must never run together. `tests/conformance/` runs on Bun, as part of
`bun run test`. `tests/node-conformance/` runs on `node --test`, through `bun run test:node`, against the
built `dist/`. It **must not** run on Bun. That is the only reason the tree exists.

Before Phase 10, the file system held this separation. The Node tree was at `test/`, and no Bun command
could reach it. One path — `tests/node-conformance/` — now holds it instead, written into five files that
must agree:

| File | What it holds |
|---|---|
| `bunfig.toml` | `[test] pathIgnorePatterns` — keeps the Node tree out of `bun test` |
| `package.json` | the `test:node` glob — the only command that runs the Node tree |
| `eslint.config.js` | the `.mjs` override — without it, `console`, `URL`, and the Web Streams globals fail `no-undef` |
| `.claude/skills/ci-preflight/run-ci.mjs` | three globs in the `--node-floor` path |
| `tests/node-conformance/README.md` | the membership rule, and the paths that name the tree |

**The key is `pathIgnorePatterns`. The key is not `testPathIgnorePatterns`.** Bun accepts an unknown
`[test]` key without complaint. A wrong key gives no warning, does not fail, and does not stop the run. Bun
then collects the Node suite. Bun runs `node:test` files without an error and reports them as passing. The
run reports success over a suite that proves nothing about Node. Measured on `bun run test`, pinned Bun
1.3.14: with the key, 164 files; without it, 178. Thirteen of the fourteen extra files pass silently; the
run goes red only because the fourteenth trips an unrelated timer assertion, which points nowhere near the
cause. Treat the exit code as an accident, not a control.

Never change one of these five files alone. Change one, then change all of them. Then run
`node scripts/verify-test-partition.mjs`. That gate catches the wrong key name, and CI blocks on it.

Do not remove the bunfig key and narrow the root script to `bun test ./packages ./tests/conformance`
instead. That protects the root script only. A command typed by hand, such as `bun test ./tests`, would
still collect the Node suite. The gate checks for this.

Keep `[test] root = "packages"`. It controls discovery for a bare `bun test`, and it keeps
`scripts/*.test.mjs` out of *that* run's coverage floor. It is a second mechanism, and it is independent.
It does not replace the ignore glob, which is what governs the explicit `./tests` path the root script
passes. The gate checks this too.

## Documentation hierarchy

Four distinct trees, easy to confuse:

| Path | Role |
|---|---|
| `docs/product-spec/` | **Normative.** Numbered requirements (`HTTP-7`, `SEAM-1`, `RETRY-13`, `NFR-5`, …). The source of truth. |
| `docs/sdk-design-nodejs/` | How each spec area maps to idiomatic TypeScript. Non-normative but binding by convention. |
| `docs/knowledge/` | Harvested styleguide + spec knowledge, topic-indexed (`INDEX.md`). Cited as "styleguide 6.7", "ch08". |
| `docs/superpowers/specs/` + `plans/` | Per-phase design doc, task-by-task implementation plan, and a requirement-coverage checklist. |

`docs/product-spec/appendix-c-consolidated-normative-requirement-index.md` is the fastest way to locate a
requirement ID.

### Querying `docs/knowledge/`

`docs/knowledge/` is 39 topic files — never read a topic file whole when a filtered query
answers the question. `bun run knowledge` parses the corpus into entries and filters them; a requirement-ID
query returns ~170 tokens against a ~5700-token file read.

```bash
bun run knowledge --req HTTP-13,HTTP-14,HTTP-15    # a whole task's IDs in one call (exact-token)
bun run knowledge --chapter 6 interface class      # a "styleguide 6.7" citation
bun run knowledge --section conflicts --brief      # open design-vs-styleguide calls; 6 entries corpus-wide
```

Different filters AND together, values within one filter OR; `--help` lists the rest. Each result carries its
`<sub>` provenance line — the citation for test-file headers and deferral notes, though styleguide paths are
absolute to a sibling repo and need their machine prefix stripped first. **A `--req` hit is not proof of
knowledge:** 255 of 645 IDs are named only by an appendix-B conformance roll-up, tagged `[appendix-B roll-up]`
in output; 386 have a substantive entry and 4 are cited nowhere at all (`--coverage` breaks this down). 15 of
the 39 topics carry no requirement ID at all and are reachable only via `--topic`/`--chapter`
(`--list-topics`). Every count in this paragraph moves when the corpus is edited, so
`scripts/knowledge.test.mjs` pins all four against the live corpus and its failure message names the two docs
to update alongside. No CI step gates corpus *content*; CI does run the CLI's own suite (`test:scripts`),
which parses the real corpus. The `.claude/skills/knowledge-lookup` skill carries the full workflow.

## Requirement-ID conventions (enforced by review, not tooling)

- Every source file opens with `// SPDX-License-Identifier: MIT` on **line 1** (NFR-13).
- Every test file's header comment cites the `HTTP-N` / `SEAM-N` IDs it exercises. Phase 9's conformance pass
  depends on this traceability existing already.
- When a requirement is deliberately not satisfied, record it — as a deferral in the phase plan naming the
  owning phase, or in `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`. Silent
  gaps are the failure mode this project is structured to prevent.

## Domain model construction pattern

Every model in `packages/core/src/http/` follows one shape. Deviating breaks invariants that tooling does not
catch:

- **`#private` fields only.** Not TS `private`. Styleguide 6.7 carves this out for libraries whose internals
  must stay unreachable reflectively.
- **TS `private` constructor**, so no public field-wise constructor appears in the emitted `.d.ts` — a
  consumer cannot construct around `build()`'s validation (HTTP-2).
- **The `createX` friend-class hook.** TypeScript has no friend classes, so a builder (a *different* class)
  reaches its model's private constructor through a module-scoped `let createX` assigned exactly once inside
  the class's `static {}` block. That `let` is init-once wiring, not mutable state. Every builder-based model
  repeats it: `createHeaders`, `createQueryParams`, `createRequest`, `createResponse`, `createRequestOptions`,
  `createRequestConditions`.
- **`Object.freeze(this)` once, at the end of the constructor.** Freeze is shallow and is never relied on to
  cascade — nested arrays and `Map`s are frozen independently at build time.
- **`newBuilder()` returns a pre-filled builder that deep-copies every collection**, never aliases the source
  (HTTP-3). Value types with no builder (`Status`, `Protocol`, `MediaType`, `ETag`, `HttpRange`) use static
  factories instead.
- **Required fields go through `requireField()`** from `builder.ts` — never a bespoke `if (!x) throw`. It
  single-sources HTTP-4's `` `${name} is required` `` message.
- **Typed errors only.** Everything descends from `DomainModelError`; no bare `throw new Error(...)`. Each
  subclass sets `this.name = new.target.name`, and wrap-and-rethrow always passes `{cause}`.
- **Getters return frozen or freshly-copied values.** `Request.url` clones on every access because the native
  `URL` is mutable — the one place a frozen class still leaks mutability (HTTP-5).

Validation uses explicit predicate functions, not zod. Zod targets untrusted boundary parsing; these modules
validate already-typed values against character-class and grammar rules (styleguide 6.8 permits this).

## Constraints that will bite

- **Zero runtime dependencies in `@dexpace/core`** (SEAM-1), gate-enforced. Reaching for a small date or URL
  utility is exactly the reflex `verify:seam-1` exists to catch. Dev dependencies are fine.
- **ESM-only, NodeNext.** Relative imports carry the `.js` extension even in `.ts` source.
  `verbatimModuleSyntax` is on, so type-only imports need `import type`.
- **`erasableSyntaxOnly`** — no enums, no namespaces, no constructor parameter properties.
- **Lint is type-aware and strict** (`strictTypeChecked` + `stylisticTypeChecked` over gts): 70-line function
  cap, `max-depth` 3, `max-params` 3, explicit return types on exported functions and methods.
  `max-params` counts constructor parameters, which is why several private model constructors carry a
  documented `eslint-disable-next-line max-params`.
- **Every `eslint-disable` must carry a `-- reason`** (`eslint-comments/require-description`, wired for
  NFR-7). Suppressing a rule without a stated reason and re-enable condition fails lint.
- **Prettier config is deliberately absent at the root.** `eslint.config.js` sources `gts/.prettierrc.json`
  explicitly; see the comment there before adding any Prettier file.
- **Formatting is a lint error**, not a warning. Run `bun run fix` before `bun run lint` if the diff is large.

## Public API surface

`packages/core/src/http/index.ts` is the single front door; `packages/core/src/index.ts` re-exports it. Internal
helpers (`requireField`, `toError`, the `ascii-validation` predicates, the `method.ts` classifiers) are
deliberately **not** re-exported — in-package consumers import the module directly.

Anything the barrel exports needs a TSDoc block with `@public`, plus `@throws` naming each catchable error
class on operations that throw. `api-extractor` will otherwise flag it, and the committed report records it as
`(undocumented)`. After changing exports: rebuild, run `api:local`, and commit the regenerated report.

Consumer-facing changes need a changeset — `bun run changeset`, not `bunx changeset`. The wrapper
(`scripts/changeset.mjs`) forwards every argument to the CLI, then renames the file it generates from
`@changesets/write`'s random `human-id` name to `YYYY-MM-DD-<slug>.md`, matching
`docs/superpowers/{specs,plans}`. The slug is prompted for, defaulting to the changeset's own first
sentence. Nothing reads the filename back — the CLI globs `.changeset/*.md` and decides from the
frontmatter — so a hand-written changeset just needs to be named the same way.

## Phase workflow

Work proceeds phase by phase against `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`. Each
phase has a design spec, an implementation plan with numbered tasks (TDD: write the failing test, confirm it
fails, implement, confirm it passes, commit), and a checklist mapping every requirement ID to the task that
satisfies it. When asked to implement or validate a phase, read all three before touching code.

Starting a numbered task means starting with what the corpus already knows about its requirement IDs — invoke
the `knowledge-lookup` skill, which carries both entry points (ID-first via appendix C, topic-first for the
styleguide-derived areas that carry no IDs).
