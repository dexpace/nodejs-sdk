# pipeline — notes

Hand-written. `docs/knowledge/harvested/pipeline.md` is what the design chapter and the styleguide
say; this file records what the implementation settled, and it wins. Each entry names the harvested
entry it answers by that entry's stable key.

## Conflicts
- **The `Stage` ordering is a frozen constant object, not an `enum`, and that is settled by the compiler rather than by preference.** Resolves `pipeline/e66ace13`, the conflict statement left `unresolved 2026-07-25`, which weighed an `enum` for the pipeline `Stage` ordering against a union of string literals. Nothing was weighed in the end: this package compiles with `erasableSyntaxOnly`, which bans `enum` outright along with namespaces and constructor parameter properties, so the design chapter's `enum` option was never reachable. The port ships `Stage` as a union of string literals with `STAGE_ORDER` and `PILLAR_STAGES` as frozen constant objects beside it (`packages/core/src/pipeline/stage.ts`), all three `@public` and on the barrel (`packages/core/src/index.ts`).

  **Why this is a note and not a re-harvest.** The marker sits inside a harvested entry, and a hand edit there changes no `<sub>` sha, so the next harvest would regenerate or duplicate it — `docs/knowledge/README.md` is the contract. It is recorded here for the same reason `notes/data-modeling.md` records the `#private` scoping: the resolution outlives the register row that carried it (`docs/work/mvp/2026-09-04-open-items-dissolution.md` N3, whose first marker closed 2026-09-04 and whose second is this one).

  **A note on N3's own grep.** Phase 9's plan asks for `grep -rn "unresolved 2026-07-25" docs/knowledge/` to return empty. It will not, and resolving the markers makes it worse rather than better: a note that resolves a marker has to quote the marker string to name what it resolves, so each resolution adds a match. The check that means something is `bun run knowledge --topic pipeline`, where the harvested entry now prints `[overridden by notes/pipeline.md]`.
  <sub>review · `packages/core/src/pipeline/stage.ts` · high · sha:manual-2026-09-04-stage-ordering-erasable-syntax</sub>
