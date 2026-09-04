# `docs/`

Eight trees and three registers, each with one owner and one job — counting `knowledge/`'s
`harvested/` and `notes/` as the two that `CLAUDE.md` treats them as, and `assets/` as one. This file
is the index; the rule is that nothing in `docs/` is unowned, and nothing is written by two things.

| Entry | Owns | Written by | Housekeeping may write? |
|---|---|---|---|
| [`product-spec/`](./product-spec/) + [`product-spec.md`](./product-spec.md) | **Normative.** The numbered requirements — `HTTP-7`, `SEAM-1`, `RETRY-13`, `NFR-5`, … — that the code exists to satisfy | A human, deliberately | **No — frozen** |
| [`sdk-design-nodejs/`](./sdk-design-nodejs/) + [`sdk-design-nodejs.md`](./sdk-design-nodejs.md) | How each spec area maps to idiomatic TypeScript. Non-normative but binding by convention. §10 is the **normative deviation ledger** | A human, deliberately | **No — frozen** |
| [`knowledge/harvested/`](./knowledge/harvested/) | Harvested styleguide and spec knowledge, topic-indexed. Cited as "styleguide 6.7", "ch08" | The `knowledge-harvest` skill. **Never hand-edited** | **No — frozen** |
| [`knowledge/notes/`](./knowledge/notes/) | What the implementation found, overriding a harvested entry. Role `review`, manual `sha:` | A human | **No — frozen** |
| [`sdk-documentation/`](./sdk-documentation/) | **As-built.** How the packages compose, which one to install, worked cross-package examples | A human, or the skill on request | Yes |
| [`work/`](./work/) | Process records: per-phase design, plan and checklist, one directory per phase under a unit of delivery | The phase that produced them; **collected** here by the skill | Yes — `git mv` only |
| [`superpowers/`](./superpowers/) | Nothing, for long. The **inbox** the Superpowers skills write into | `brainstorming`, `writing-plans` | Yes — it drains it |
| [`open-items.md`](./open-items.md) | Everything unmet, unverified, misreported, or surprising. Sections A–U, letters permanent | Every review | Yes — appends |
| [`deferred-items.md`](./deferred-items.md) | Two tables: work a phase decided not to do yet and has not done, then *Delivered and retired* — the compact audit trail of every deferral since discharged. Rows move between them; none is deleted. Cite a row by its key, never by line | Every phase's brainstorm | Yes — appends, and retires |
| [`deviations.md`](./deviations.md) | The as-built audit of §10, and the landing point for a deviation found outside a phase | An audit or review | Yes — appends |
| [`assets/`](./assets/) | Vendored wordmark SVGs the root `README.md` renders | Copied from `dexpace/morphic` | Yes |

## Frozen means frozen

`knowledge/`, `product-spec/`, `sdk-design-nodejs/` and the two sibling tables of contents are
**read-only** to routine maintenance. The `housekeeping` skill refuses to write to them, and that
refusal is a testable guard, not a paragraph of good intent
(`.claude/skills/housekeeping/guard.mjs`, `guard.test.mjs`).

Each has its own reason:

- **`product-spec/`** is what the code is measured against. A tool editing the yardstick is a
  category error.
- **`sdk-design-nodejs/`** carries §10, the normative deviation ledger, whose numbering
  `deviations.md` is keyed to. Amending it is a deliberate act; the audit beside it is where a
  maintenance pass writes instead (`open-items.md` U4).
- **`knowledge/harvested/`** cannot absorb a hand edit. Its `<sub>` shas digest the whole source
  file, not the entry, so an edit inside an entry changes no sha and the next harvest regenerates or
  duplicates it silently. Record the finding in `knowledge/notes/` instead.
- **`knowledge/notes/`** is hand-written and could in principle be edited; it is grouped with
  `harvested/` because the CLI reads the two as one corpus and a note's key citation couples them.
  Whether that grouping is right is an open question (`open-items.md` U1).

## The three registers, and which one a thing goes in

The boundary is **when** the item was created, not what it is about.

- A **deferral** is a decision made *before* the work: "not this phase, that one." →
  `deferred-items.md`
- An **open item** is a discovery made *after*: "this is not what the checklist says it is." →
  `open-items.md`
- A **deviation** is a place the port differs from the reference contract on purpose. → the owning
  phase's `## Deviation Ledger` section, consolidated into §10; `deviations.md` audits §10 and
  catches what has no owning phase.

The same requirement ID can legitimately appear in two. `AUTH-37` was deferred to Phase 7b in
`deferred-items.md` and is recorded as a live silent swallow at `open-items.md` G12.

Register letters and item numbers in `open-items.md` are **permanent**: they are cited across the
repository from source comments, tests, changesets and this tree. A new review appends the next
letter; nothing is ever renumbered or reused. `node .claude/skills/housekeeping/probe.mjs
--only=citations` both counts them and checks that every one still resolves — the count lives in that
command, not in a sentence here, because three documents once carried three different wrong ones
(`open-items.md` U10).

## `work/` and the inbox

`docs/work/<delivery>/phaseN/` is the archive. `mvp/` is the only delivery so far and holds every
phase to date; a later effort becomes a sibling.

```
work/mvp/
  2026-07-23-nodejs-sdk-v1-roadmap-design.md      # belongs to no phase
  2026-07-25-checkpoint-scaffold-through-phase3a.md
  scaffold/
  phase1/ … phase10/
    phase6/2026-07-28-phase6-segmentation-design.md   # spans the phase
    phase6/phase6a/ phase6b/ phase6c/                 # one per sub-phase
```

A phase directory is `phaseN`, no hyphen. A phase with sub-phases nests one directory per sub-phase.
A document spanning a whole phase — a segmentation design, a shared checklist — sits at the `phaseN/`
level. Every file keeps its `YYYY-MM-DD-` prefix, which carries ordering the directory name does not.

New documents do **not** land there directly. The `brainstorming` and `writing-plans` skills hard-code
`docs/superpowers/{specs,plans}/`, they are installed globally, and this repository cannot change
them — so that directory stays as an inbox and the `housekeeping` skill collects from it. See
[`superpowers/README.md`](./superpowers/README.md).

## Querying the corpus

`docs/knowledge/` is two trees and 39 topics. Never read a topic file whole when a filtered query
answers the question — a requirement-ID query returns ~170 tokens against a ~5700-token file read.

```bash
bun run knowledge --req HTTP-13,HTTP-14,HTTP-15    # a whole task's IDs in one call
bun run knowledge --origin note --brief            # everything the implementation found
bun run knowledge --topic documentation            # the 21 rules the housekeeping skill obeys
bun run knowledge --chapter 6 interface class      # a "styleguide 6.7" citation
```

`bun run verify:knowledge-structure` keeps the two trees apart and is a blocking CI step.
`bun run knowledge:drift` is the hand-run companion, deliberately not in CI: 16 of the 47 sources are
a sibling styleguide repository no CI checkout has.

## Keeping this file true

`.claude/skills/housekeeping/` probes every claim here against the repository — the tree itself,
`CLAUDE.md`'s package and gate counts, `README.md`'s, a README on every publishable package, broken
relative links, and register text that landed in a specification document. It is a hand-run tool, not
a CI step. Run it before claiming the documentation is current.
