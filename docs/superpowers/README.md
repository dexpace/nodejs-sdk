# `docs/superpowers/` — the inbox, not the archive

New phase documents land here. They do not stay here.

The Superpowers `brainstorming` and `writing-plans` skills write to hard-coded paths —
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (`brainstorming/SKILL.md:100`, restated at `:206`)
and `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` (`writing-plans/SKILL.md:18`, restated at
`:157`). Those skills are installed globally, shared across projects, and this repository cannot change
them. So the path stays, and this directory is the drop point it writes into.

The archive is [`docs/work/`](../work/). Every finished phase's design, plan and checklist lives under
`docs/work/mvp/phaseN/` — one directory per phase, sub-phases nested inside it, each file keeping its
`YYYY-MM-DD-` prefix. The 62 documents that were here on 2026-08-31 moved there in a single `git mv`
commit, so `git log --follow` still resolves each one across the move.

## What to do with a file that appears here

Run the `housekeeping` skill (`.claude/skills/housekeeping/`). Its probe stage lists every file sitting
in `specs/` or `plans/` — staged or not — and its apply stage works out which `docs/work/mvp/phaseN/`
directory each belongs in and moves it with `git mv`.

**It does not repoint the references.** That is deliberate and the tool says so when it finishes: a
maintenance tool that rewrites prose to make its own check pass produces documentation that is true and
useless at the same time. After `--write`, run the probe's `links` and `citations` checks and fix what
they report, in the same commit. Doing the whole thing by hand is fine too; the rules are in
[`docs/README.md`](../README.md) and the layout is visible in `docs/work/mvp/`.

A file left here is not lost — it is just not filed. The probe reports it every run until it is.

## What must not happen here

Do not point a citation at `docs/superpowers/`. It is a staging path, and anything written here is
scheduled to move. Cite `docs/work/mvp/phaseN/<file>` — the path the document will have for the rest of
its life. The one deliberate exception is a document describing the *skills'* write behavior, such as
this file and the roadmap's "How Phases Get Executed" section.
