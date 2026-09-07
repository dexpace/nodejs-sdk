# tooling-and-quality-gates — notes

Hand-written. `docs/knowledge/harvested/tooling-and-quality-gates.md` states each design-vs-styleguide
contradiction; this file records how the repository resolved it, and it wins. Each entry names the
harvested statement it resolves by that statement's stable key.

## Conflicts
- **Package manager and lockfile: the styleguide wins.** Resolves `tooling-and-quality-gates/4f1a46a5`. The scaffold implements Bun throughout — `bun.lock`, `.bun-version`, and `bun install --frozen-lockfile` as the CI gate; the design's pnpm/`catalog:` framing describes a toolchain this repository does not use. The two enforcement properties pnpm's layout gave for free were restored separately: Bun workspace catalogs in Phase 6a, and the isolated linker at the 2026-07-25 checkpoint. Decided 2026-07-25, confirmed by the 2026-07-28 Phase 9 audit.
  <sub>review · `docs/superpowers/plans/2026-07-23-scaffold-milestone-checklist.md:54` · high · sha:manual-2026-07-25-package-manager</sub>
- **Test runner and coverage gating: a split decision.** Resolves `tooling-and-quality-gates/99637a28`. Runner: `bun test` with `bun:test` symbol imports, the styleguide's choice — the design's `c8`/`vitest` framing is dead. Gating: the styleguide's general "coverage is a trend, never a pass/fail gate" default loses here, because `NFR-5`/`NFR-17` are spec conformance obligations that outrank a general style default; `bunfig.toml`'s `coverageThreshold = 0.8` blocks the build. Decided 2026-07-25, confirmed by the 2026-07-28 Phase 9 audit.
  <sub>review · `bunfig.toml` · high · sha:manual-2026-07-25-test-runner</sub>
- **gts as the lint and format baseline: the styleguide wins.** Resolves `tooling-and-quality-gates/90367d73`. `eslint.config.js` extends `gts` and layers `@typescript-eslint`'s `strict-type-checked` and `stylistic-type-checked` tiers on top as the single permitted overlay, which satisfies the design's rule set as well; the design's table never mentioning `gts` describes a toolchain this repository does not use. The corollary is load-bearing and easy to undo by accident: no root Prettier config, so `eslint.config.js` sources `gts/.prettierrc.json` itself. Decided 2026-07-25, confirmed by the 2026-07-28 Phase 9 audit.
  <sub>review · `eslint.config.js` · high · sha:manual-2026-07-25-gts-baseline</sub>
