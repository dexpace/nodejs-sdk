---
name: knowledge-lookup
description: Use when starting a numbered task from a docs/superpowers/plans/ file, implementing or reviewing against a requirement ID (HTTP-7, SEAM-1, RETRY-13, NFR-5), or resolving a styleguide citation such as "styleguide 6.7" or "ch08".
---

# Knowledge Lookup

## Overview

`docs/knowledge/` is 39 topic files and ~1470 harvested entries — 512 KB, past what belongs
in context. `bun run knowledge` filters it. A requirement-ID query runs ~120–580 tokens
(median ~230) against a topic file of ~1800–5200 (median ~2300): roughly 9× smaller, and
much more than that when the ID you want lives in a file you'd never have guessed.

Every entry is one bullet plus a `<sub>` line carrying role, source path, line range, and
sha — the citation a test-file header or deferral note needs.

## Start of a phase: run this once

```bash
bun run knowledge --section conflicts --brief      # 6 entries corpus-wide, ~1.1k tokens
```

Six entries exist. They are where a design-vs-styleguide contradiction is recorded as
resolved or still open, and a plan's Global Constraints may assert as settled something the
corpus still lists **unresolved**. Nothing else in this workflow will surface them.

## Starting a numbered task: one query, not six

Plan tasks list their requirement IDs in the task header. Pass the whole set at once —
`--req` accepts commas and ORs within itself:

```bash
bun run knowledge --req HTTP-13,HTTP-14,HTTP-15,HTTP-16,HTTP-3,HTTP-5
```

Different filters AND together; multiple values inside one filter OR. So
`--req A --req B --topic headers` means "(cites A or B) and is in a headers file".

## Check the result is real before trusting it

**A `--req` hit is not proof the corpus knows anything.** 256 of the 641 cited IDs resolve
*only* to an appendix-B conformance roll-up — one sentence naming three to five IDs and
stating none of them. It exits 0, so nothing else will warn you.

The CLI tags these `[appendix-B roll-up]` and prints a WARNING when every hit is one. When
you see it, stop querying and go to the source:

```bash
grep -n '^| HTTP-10 ' docs/product-spec/appendix-c-consolidated-normative-requirement-index.md
```

The leading `| ` and trailing space are load-bearing — `grep 'HTTP-1'` matches HTTP-10
through HTTP-19.

## Two entry points

**ID-first — you have requirement IDs.** This is the plan-task case.

1. `bun run knowledge --req <ids>` — what the corpus concluded. Design-role entries quote
   `docs/sdk-design-nodejs/` inline, so this usually covers the TypeScript mapping too; add
   `--role design` to isolate them. Open the design doc only to follow a line range.
2. `grep -n '^| <ID> ' docs/product-spec/appendix-c-…md` — canonical text, when the query
   came back a roll-up or you need the normative wording verbatim.

**Topic-first — you have an area, or a styleguide citation.**

```bash
bun run knowledge --list-topics                    # 39 topics, entry and ID counts
bun run knowledge --topic pipeline --section rules --brief cursor fork
```

**16 of the 39 topics carry no requirement ID at all** — every styleguide-derived one,
including `data-modeling`, `error-handling`, `assertions`, `testing`, `api-design`. ID-first
cannot reach them. `--list-topics` shows which; don't work from a memorised list.

For "styleguide 6.7" / "ch08", use `--chapter`:

```bash
bun run knowledge --chapter 6 interface class      # styleguide 6.7 → the classes chapter
```

Entries record a chapter file and line range, never a section number, so `--chapter 6.7`
queries chapter 6 and tells you it dropped the `.7`. Narrow with bare words instead.

## Never read a whole topic file — with two stated exceptions

**Reading a topic file when a filtered query answers the question is the failure this tool
exists to prevent.** Not "I'll grep it myself" — `grep` has no section, role, or exact-token
ID matching. Not "I need surrounding context" — widen the filter first.

The two cases where reading is correct, and how:

- **An unnarrowed `--topic` costs more than the file.** `--topic http-domain-model` is
  22,196 bytes; the file is 20,157. A topic query without `--section`, `--chapter`, or bare
  words is not a filter. Add one, or read the file — don't run the query.
- **Following up a located entry, when you need the exact bytes.** The bullet sits at the
  printed line, its `<sub>` at line+1, entries are 2 lines with no blank between — so read
  an even span starting on the bullet or you will split a rule from its citation, and stop
  at the section boundary or you silently cross into Constraints.

  Reach for this last. A neighbouring entry is only related to the one you found about half
  the time (54% of adjacent pairs share a source line or one within 3), so "read around it"
  is a weak way to find the rest of a rule cluster. Two better moves first:
  - **The cluster is defined by ID, not by file position.** Landed on HTTP-5 and want the
    rule it belongs to? `--req HTTP-3,HTTP-4,HTTP-5`. Appendix C numbers related
    requirements together; the topic file does not order them for you.
  - **Pull the section.** `--topic X --section rules` — the median section is 7 entries
    (~550 tokens). Only the big subsystem `Rules` sections (pipeline 58, retry 43, auth 41)
    are expensive enough to need narrowing with bare words.

## Quick reference

| Flag | Effect |
|---|---|
| `--req HTTP-7,HTTP-8` | Entries citing any of these. Exact-token: never matches `HTTP-70`. |
| `--topic pipeline,retry` | Topic files by substring — matches broadly and silently. |
| `--section rules,…` | rules, constraints, conclusions, reference, conflicts. (superseded is empty.) |
| `--role spec\|design\|styleguide\|review` | Filter by provenance role. |
| `--chapter 6` | Styleguide chapter. The only way in from a "styleguide N.M" citation. |
| `--grep <regex>` / bare words | Case-insensitive; regex is real, bare words are literal. |
| `--brief` | Drop `<sub>` lines, ~30% smaller — but you lose the citation. |
| `--json` | Records, each with a `rollup` boolean. |
| `--list-topics` | The 39 topics with entry and distinct-ID counts. |
| `--list-reqs` | ID → location map. **~6k tokens, bigger than any topic file.** Prefer `--coverage`. |
| `--coverage` | Substantive vs roll-up-only vs uncited, per prefix. A report, not a gate. |

Zero matches exits 1 and names what does exist — nearest IDs, available topics, harvested
chapters. Follow it rather than guessing again. `--help` for the rest.

## Citing what you find

The `<sub>` line is the citation, but it comes in two tiers:

- **spec / design** — repo-relative, quote verbatim:
  `` docs/product-spec/09-retry-and-resilience.md:28 · sha:9efbe276001e ``
- **styleguide** — an absolute path to a sibling repo on the harvest machine
  (`/home/…/styleguide/typescript/11-testing.md:110-114`). **Strip the machine prefix**
  before committing it: `styleguide/typescript/11-testing.md:110-114`. Pasting it raw
  produces a citation that resolves on one laptop.

Shape is not uniform: Conflicts entries carry two sources and no sha; one `review` entry has
no line range. Copy what is there, don't assume four fields.

Drop `--brief` whenever the result will be cited.

## Common mistakes

| Mistake | Fix |
|---|---|
| Trusting a `--req` hit that is all roll-up | Watch for the WARNING; go to appendix C and the owning `product-spec/NN` chapter. |
| Six sequential `--req` calls for one task | One comma-separated call. |
| ID-first on `data-modeling` / `error-handling` / `testing` | Those carry zero IDs. Topic- or chapter-first. |
| Pasting a styleguide `<sub>` path verbatim | Strip the machine prefix first. |
| `--topic X` with nothing else | Not a filter; costs more than the file. |
| Reading `--coverage`'s total as "the corpus knows this" | 385/645 are substantive; 256 more are roll-up only. |
| Treating `--coverage` as a gate | Hand-run report. Nothing in CI runs it. |
