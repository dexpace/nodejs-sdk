# assertions

## Rules
- The project defines and uses a single `invariant(cond, msg)` assertion function project-wide as the sanctioned assertion primitive, rather than ad hoc `if (!x) throw` checks.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:116-135` · high · sha:51c21236bb1b</sub>
- Functions should assert preconditions and postconditions aggressively, averaging 2 or more assertions per function across a module.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:137-146` · high · sha:51c21236bb1b</sub>
- Assertions should check both positive and negative space — that the expected value holds and that impossible values are absent.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:141-141` · high · sha:51c21236bb1b</sub>
- Pair assertions to verify one property via two independent derivations so a disagreement between them surfaces the bug at the assertion site.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:142-144` · high · sha:51c21236bb1b</sub>

## Constraints

## Conclusions

## Reference
- The `invariant` helper is a TypeScript assertion function with signature `function invariant(cond: unknown, msg: string): asserts cond`, and it narrows the type of its condition argument after the call.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:130-133` · high · sha:51c21236bb1b</sub>
- `invariant` throws an `InvariantViolation`, a dedicated `Error` subclass distinguishing broken invariants (programmer error) from operational failures that a caller might recover from.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:121-133` · high · sha:51c21236bb1b</sub>

## Conflicts

## Superseded
