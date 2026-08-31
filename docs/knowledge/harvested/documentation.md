# documentation

## Rules
- A comment must exist only to carry intent the code itself cannot express, and it is considered wrong the moment it stops matching the code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:3-3` · high · sha:c06a8b1ddca5</sub>
- Every public symbol exported from a package's index.ts must carry a TSDoc comment (a `/** ... */` block with `@`-tags), because a plain `//` comment or bare block is invisible to tsc, typedoc, and editor tooling.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:42-48` · high · sha:c06a8b1ddca5</sub>
- Private and module-internal symbols are documented with TSDoc only when the name does not already carry the meaning; a TSDoc block should not be pasted on something like `const double = (n: number) => n * 2`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:49-49` · high · sha:c06a8b1ddca5</sub>
- TSDoc prose must never restate the type signature; a `@param`/`@returns` line should add only what the type cannot say — intent, constraints, units, valid ranges, or the meaning of a sentinel.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:53-59` · high · sha:c06a8b1ddca5</sub>
- Omit a `@param` tag entirely when the parameter's name and type are already self-documenting.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:60-60` · high · sha:c06a8b1ddca5</sub>
- Reviewers reject `@param`/`@returns` lines that only echo the parameter's name or type, keeping only ones that add a constraint, unit, or sentinel meaning.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:62-62` · high · sha:c06a8b1ddca5</sub>
- Comments must explain why a line of code exists rather than narrating what it mechanically does, since the diff and signature already show the what.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:64-70` · high · sha:c06a8b1ddca5</sub>
- A TODO comment must include an owner and a date, in the form `// TODO(name yyyy-mm-dd): reason`; an ownerless TODO is considered a wish nobody is accountable for.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:71-71` · high · sha:c06a8b1ddca5</sub>
- Every non-obvious public API must carry a single, realistic, compilable call site under an `@example` tag showing the shape of usage rather than just the shape of a call.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:75-81` · high · sha:c06a8b1ddca5</sub>
- Obvious one-liner APIs, such as a pure `clamp(value, min, max)`, do not need an `@example` since the signature already serves as the example.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:82-82` · high · sha:c06a8b1ddca5</sub>
- Every error a public function can throw that a caller might reasonably catch must have a `@throws` tag naming the error type and what the caller should do about it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:86-92` · high · sha:c06a8b1ddca5</sub>
- `@throws` tags should list only the errors a caller would act on, ordered most-likely first, each paired with a recovery hint, rather than cataloguing every `Error` that could theoretically escape.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:92-92` · high · sha:c06a8b1ddca5</sub>
- Every publishable package must ship a README whose top gets a new engineer from zero to one working call without reading source, within about 30 seconds.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:97-103` · high · sha:c06a8b1ddca5</sub>
- A package README must lead with what the package is in one sentence, the install line, and one runnable example, linking deeper to API surface and edge cases rather than inlining them.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:99-106` · high · sha:c06a8b1ddca5</sub>
- Documentation must state each fact in exactly one authoritative place and link to it from everywhere else, using `{@link Symbol}` and relative paths rather than duplicating prose.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:108-115` · high · sha:c06a8b1ddca5</sub>
- A comment that no longer matches the code must be updated or deleted in the same commit as the change that caused the drift, never deferred to later.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:119-126` · high · sha:c06a8b1ddca5</sub>
- A diff that changes behavior and leaves its TSDoc or comments stale does not merge; it must update or delete the stale documentation in the same commit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:128-128` · high · sha:c06a8b1ddca5</sub>

## Constraints

## Conclusions
- Where failure is expected rather than exceptional, a `Result` return type is preferred over `@throws` so the failure contract lives in the type and cannot drift from the implementation.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:93-93` · high · sha:c06a8b1ddca5</sub>

## Reference
- TSDoc comments are part of a package's public API because they ship in the emitted `.d.ts`, surface in editor hover-cards, and feed the generated docs site.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:3-3` · high · sha:c06a8b1ddca5</sub>
- TSDoc enforcement is via ESLint with the TSDoc plugin, which validates tag syntax, plus review confirming every export from a barrel carries a documentation block.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:51-51` · high · sha:c06a8b1ddca5</sub>
- The documentation build typechecks the code fences inside `@example` tags so worked examples cannot silently drift out of sync with the API.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/14-documentation.md:84-84` · high · sha:c06a8b1ddca5</sub>

## Conflicts

## Superseded
