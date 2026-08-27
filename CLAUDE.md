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

bun run typecheck        # tsc --noEmit per package (core, then codec-json)
bun run lint             # gts lint . — formatting AND type-aware rules; fatal
bun run fix              # gts fix . — autofixes formatting/lint
bun run build            # plain tsc per package (core, then codec-json) → each package's dist/
bun test                 # needs `build` first (see below); coverage on by default, 80% line floor
bun run test:node        # Node-runtime conformance against the BUILT artifact; needs `build` first
```

`bun test` runs the unit suite on **Bun** and is scoped to `packages/` (`bunfig.toml`'s `[test] root`).
**It needs `bun run build` to have run first**, from Phase 6a on: `@dexpace/codec-json`'s tests reach core
through its published entry point, which Bun resolves to `packages/core/dist/`. On a fresh clone they cannot
resolve core at all; against a stale `dist/` they report green over yesterday's core. CI is safe — its Build
step precedes its Test step. The root `test` script deliberately does not build first, so the inner loop stays
fast; rebuild when you have changed `packages/core/src/`.

`test:node` is a separate, thin layer under `test/node-conformance/` that runs the same built package under
`node --test`, because Bun's Web Streams / `AbortSignal` / `Uint8Array` behavior is an independent
implementation of Node's and `src/io/` is where they diverge. **A phase that touches a runtime-divergent
surface adds a case there, not only to `bun test`** — see `test/node-conformance/README.md`.

Single test file or single test:

```bash
bun test packages/core/src/http/media-type.test.ts
bun test -t 'rejects blank input'          # filter by test name
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
bun run verify:runtime-floor      # tsconfig target vs package engines.node consistency
bun run audit                     # bun audit --audit-level=high --prod
```

**Every one of these is a blocking CI step** (`.github/workflows/ci.yml`). Run the full set before claiming
work is done — `bun test` passing is not sufficient evidence.

`bun run test:scripts` (`node --test scripts/*.test.mjs`) tests the *gates themselves* — the knowledge CLI and
`verify-seam-1.mjs`. It is **not** wired into CI yet (`docs/open-items.md` H13), so run it by hand after
touching anything in `scripts/`.

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

`docs/knowledge/` is 518 KB across 39 topic files — never read a topic file whole when a filtered query
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
knowledge:** 256 of 645 IDs are named only by an appendix-B conformance roll-up, tagged `[appendix-B roll-up]`
in output; only 385 have a substantive entry (`--coverage` breaks this down). 16 of the 39 topics carry no
requirement ID at all and are reachable only via `--topic`/`--chapter` (`--list-topics`). Nothing in CI runs
this. The `.claude/skills/knowledge-lookup` skill carries the full workflow.

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
