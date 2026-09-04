---
name: housekeeping
description: Use when asked to tidy docs/, check whether CLAUDE.md or README.md still match the code, file phase documents left in docs/superpowers/, find broken links or dangling open-items citations, or verify the documentation before handing work over. Probes the repository for documentation drift, reports it, and applies the mechanical repairs.
---

# Housekeeping

## Overview

Documentation drifts because nothing checks it. `CLAUDE.md` claimed "two published packages
today" for nine phases while the workspace grew to eleven; `README.md` was two lines with a
spelling error; two shipped package READMEs opened with a code sample that had stopped
compiling. Every one of those is checkable against the repository in a few lines of script,
and none of them was checked.

This skill is that check. Two stages, and the order is not optional.

```bash
node .claude/skills/housekeeping/probe.mjs        # read-only. Report. Always first.
node .claude/skills/housekeeping/apply.mjs        # dry run: prints the moves it would make
node .claude/skills/housekeeping/apply.mjs --write
```

It is a hand-run tool, not a CI step. Run it before claiming documentation is current,
after landing a phase, and whenever `docs/superpowers/` has something in it.

## Stage 1 — probe

Read-only, and tested to be: `probe.test.mjs` snapshots `git status --porcelain` around a
run and asserts it did not move. Exit code is 0 by default; `--strict` exits 1 when
anything is found, so it can be promoted to a gate without changing what it reports.

```bash
node .claude/skills/housekeeping/probe.mjs
node .claude/skills/housekeeping/probe.mjs --strict
node .claude/skills/housekeeping/probe.mjs --only=links,citations
```

Eight checks. Each derives the repository fact **once, from the repository**, and compares
every document that states it against that one derivation — never one document against
another.

| Check | Finds |
|---|---|
| `inbox` | Files in `docs/superpowers/` that belong under `docs/work/<delivery>/phaseN/` |
| `root` | Markdown at the repository root that belongs under `docs/` |
| `claims` | `CLAUDE.md` and `README.md` against the real package list, the real `verify:*` gate list, the real named-CI-step count, the real API-report count and the real `docs/` tree; plus `docs/README.md` against the tree it indexes |
| `readmes` | A publishable package with no README, one under 800 bytes, or one declaring `@dexpace/core` as a dependency rather than a peer |
| `links` | Broken relative links in `docs/`, `CLAUDE.md`, `README.md` and every package README |
| `registers` | An aggregate `## Open Findings` / `## Deferred Items Log` / `## Open Items` left in a specification document instead of a register at the `docs/` root |
| `citations` | A `docs/open-items.md <Letter><N>` citation matching neither a `### <ID>` heading nor a `## Retired items` row |
| `guard` | The frozen list and the writable surface overlapping — the one way the apply stage could eat a normative document |

A **separate** check needs the built packages and so runs on its own:

```bash
bun run build && node .claude/skills/housekeeping/check-fences.mjs
```

It extracts every ` ```typescript ` fence that imports from `@dexpace/*` and typechecks the
lot against `dist/`. A fence with no such import is an illustrative fragment; a fence with a
relative import is package-local. Both are skipped, and an import of a package absent from
this workspace (`pino`, `debug`, `zod`) is reported rather than failed.

## Stage 2 — apply

**Only after reading the probe's report.** The apply stage does exactly one thing: drains
`docs/superpowers/` into `docs/work/<delivery>/phaseN/` with `git mv`, so `git log --follow`
resolves each file across the move.

```bash
node .claude/skills/housekeeping/apply.mjs                  # dry run
node .claude/skills/housekeeping/apply.mjs --write
node .claude/skills/housekeeping/apply.mjs --write --delivery=v2
```

It refuses the whole batch if any path is frozen, and refuses if a target already exists,
rather than half-applying.

Everything else the probe reports — a stale count in `CLAUDE.md`, a missing README, a broken
link, a dangling citation — is **prose, and you edit it**. That is deliberate. A tool that
rewrites a sentence to make its own check pass produces documentation that is true and
useless at the same time. The probe tells you what is wrong and where; the judgement about
what the sentence should say is yours.

Two things `--write` does not do, and says so when it finishes:

1. **Repoint references.** Re-run the probe's `links` and `citations` checks and fix what
   they report, in the same commit — a comment that no longer matches the code is corrected
   with the change that staled it (`docs/knowledge/harvested/documentation.md:34`).
2. **Commit.** A migration is its own commit, `git mv` only, so history follows every file.

## What it must never write

```
docs/knowledge/          docs/product-spec/        docs/product-spec.md
                         docs/sdk-design-nodejs/   docs/sdk-design-nodejs.md
```

This is a guard, not a promise. `guard.mjs` exports `assertWritable` and
`assertAllWritable`, and the two places this skill writes both go through one of them:
`apply.mjs`'s batch pre-check before any `git mv`, and `check-fences.mjs`'s scratch
directory, which it opens by deleting. `guard.test.mjs` proves the four ways a naive
implementation fails — a sibling whose name merely starts with a frozen one
(`docs/product-spec-draft/`), a `..` segment that lands inside after normalization, an
absolute path, and a **symlink** whose target is inside a frozen tree while its own path is
not. The frozen list itself is pinned by a test, so widening it is a reviewed diff rather
than a silent constant change.

Both call sites are covered by a test that fails when the call is deleted:
`apply.test.mjs`'s `--delivery=../product-spec` case and `check-fences.test.mjs`'s frozen
`dir` case. That matters because deleting `apply.mjs`'s `assertAllWritable` once left the
entire suite green.

The reasons are per-tree and are in [`docs/README.md`](../../../docs/README.md). The one
worth repeating: `docs/knowledge/harvested/` **cannot** absorb a hand edit, because a
`<sub>` sha digests the whole source file rather than the entry — an edit inside an entry
changes no sha, and the next harvest regenerates or duplicates it with nothing to notice.
A finding about a harvested rule goes in `docs/knowledge/notes/`, by hand, by a human.

## Where the rules come from

Not from this skill's opinion. The documentation rules are the corpus's:

```bash
bun run knowledge --topic documentation     # 21 harvested styleguide rules
```

The four this skill mechanises:

- `documentation.md:28` — every publishable package ships a README whose top gets a new
  engineer from zero to one working call, without reading source, in about 30 seconds.
- `documentation.md:32` — each fact in exactly one authoritative place, linked from
  everywhere else. This is why `docs/sdk-documentation/` does not restate the API report or
  the TSDoc, and why the probe checks links rather than duplicating content.
- `documentation.md:34` — a comment that no longer matches the code is updated or deleted in
  the same commit as the change that staled it, never deferred.
- `documentation.md:50` — the documentation build typechecks the code fences, so worked
  examples cannot silently drift. That is `check-fences.mjs`.

## Its own tests

```bash
node --test .claude/skills/housekeeping/*.test.mjs
```

Seventy-seven cases across the guard, the probe, the apply stage and the fence check. Each
check has a **pair**: a throwaway fixture tree it reports clean over, and a mutation of that
tree it must fire on — the shape `scripts/verify-seam-1.test.mjs:6`,
`verify-knowledge-structure.test.mjs:4` and `verify-test-partition.test.mjs:4` already use
here. An earlier version asserted only that the live tree was clean, and replacing the
bodies of seven of the eight checks with `return;` left it fully green. They are
**not** in `bun run test:scripts`, which globs `scripts/*.test.mjs` — promoting them is a
one-line glob change, and the argument for it is the same one that made `test:scripts`
blocking in Phase 10: a gate whose own logic degrades still exits 0, so nothing else
notices. Tracked in `docs/open-items.md` U5. No count is written here on purpose (U10):
`node --test .claude/skills/housekeeping/*.test.mjs` reports it.

## Structure

```
.claude/skills/housekeeping/
  SKILL.md            this file
  fixture.mjs         builds the throwaway repositories the tests probe
  guard.mjs           the frozen-path guard; both write sites go through it
  guard.test.mjs      13 cases: prefix, traversal, absolute, symlink
  probe.mjs           stage 1 — eight read-only checks
  probe.test.mjs      38 cases; every check has a fixture that must fire
  apply.mjs           stage 2 — git mv only, guarded, dry by default
  apply.test.mjs      17 cases; the CLI half spawns the real script
  check-fences.mjs    typechecks the documentation's code fences against dist/
  check-fences.test.mjs  9 cases over the fence classifier
```
