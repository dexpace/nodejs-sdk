# variables-and-declarations

## Rules
- Default every binding to `const`; spend a `let` only when the reader can see why reassignment happens, such as an accumulator no pipeline expresses or a value built across branches; never use `var`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:37-41` · high · sha:50abaa8d73b9</sub>
- Ban the non-null assertion `!` outside test setup with a known-configured fixture and declared bridges to untyped code carrying a `// bridge:` comment; use `invariant(x !== undefined, '…')` to narrow and fail loud with a message instead.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:50-55,62` · high · sha:50abaa8d73b9</sub>
- Write `as const` on literal configuration objects, since without it the compiler silently widens literals, e.g. `{kind: 'retry'}` widens to `{kind: string}` and `[1, 2, 3]` widens to `number[]`, destroying the discriminant or tuple shape.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:64-68` · high · sha:50abaa8d73b9</sub>
- Use `as const` to freeze a literal to its narrowest type as the single source for derived types (`typeof CONFIG`, `keyof typeof CONFIG`); this differs from the banned `as SomeType` form because `as const` asserts the narrowest type the value already has, while `as SomeType` overrides the inferred type with a different one.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:68` · high · sha:50abaa8d73b9</sub>
- Declare each variable at its first point of use rather than hoisting declarations to the top, so its live range stays short and the reader meets each name only when it becomes relevant.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:77-80` · high · sha:50abaa8d73b9</sub>
- Declare exactly one binding per statement/line; destructuring one object into several names in a single `const {a, b} = obj` still counts as one declaration.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:77-81` · high · sha:50abaa8d73b9</sub>
- Ban chained assignment (`a = b = c`), since it is right-associative, binds two names from one expression, and hides the write to the middle variable; use two separate named `const` declarations instead.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:90-94` · high · sha:50abaa8d73b9</sub>
- Destructure only at boundaries, such as function parameters or a parse result, and apply defaults inline within the same pattern, e.g. `{timeout = 5_000} = options`, so the accepted shape and its fallback are visible in the signature.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:103-106` · high · sha:50abaa8d73b9</sub>
- Limit destructuring to at most two levels deep; when a third level is needed, destructure the intermediate value on its own line instead of nesting further, since deeply nested destructuring hides the shape of the source object in punctuation.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:107` · high · sha:50abaa8d73b9</sub>
- Ban module-level mutable state, i.e. a top-level `let` or mutable object, since it is shared by every importer for the life of the process, its behavior depends on import order, and it poisons test determinism by carrying state between test cases in the same process.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:116-119` · high · sha:50abaa8d73b9</sub>
- Own mutable state through a class instance you construct and dispose, a store passed as a parameter, or a value threaded through arguments; a module-level `const` holding a frozen value remains fine, since mutability, not module scope itself, is what is banned.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:120` · high · sha:50abaa8d73b9</sub>
- Ban shadowing; never reuse a name already bound in an outer scope, import, or built-in, including generic-sounding names like `name` or `length`, because a later refactor that moves or deletes the inner binding silently flips every reference to the outer variable without a compile error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:129-133` · high · sha:50abaa8d73b9</sub>
- Rename the inner binding when its value differs from the outer one it would otherwise shadow, e.g. `rawId` versus `id`; if the values are identical, delete the redundant inner declaration.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:133` · high · sha:50abaa8d73b9</sub>

## Constraints
- `var` is function-scoped and hoisted, so it leaks out of its block and reads as defined before its line.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/04-variables-and-declarations.md:41` · high · sha:50abaa8d73b9</sub>

## Conclusions

## Reference

## Conflicts

## Superseded
