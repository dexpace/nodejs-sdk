# typescript-idioms

## Rules
- Use `satisfies` rather than a type annotation to validate a value against a type while preserving its inferred literal type, for config objects, lookup tables, and route maps.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:34-45` · high · sha:9825745ff645</sub>
- Use `as const` to freeze a literal into its narrowest, fully `readonly` shape.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:47-58` · high · sha:9825745ff645</sub>
- Default values must use `??` and never `||`, because `||` falls back on every falsy value (`0`, `''`, `false`, `NaN`) while `??` falls back only on `null`/`undefined`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:60-71` · high · sha:9825745ff645</sub>
- Optional chaining (`?.`) may be used for a single optional step, but an expression with two or more `?.` links must not be written; instead parse the input into a known non-optional shape.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:73-84` · high · sha:9825745ff645</sub>
- Data transforms must be built with `map`/`filter`/`reduce`; `for…of` is reserved for effects (I/O, logging, external mutation) or early exit via `break`/`return`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:86-98` · high · sha:9825745ff645</sub>
- `.forEach` is discouraged because it cannot `await`, cannot `break`, and returns nothing, making it strictly weaker than `for…of`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:91-91` · high · sha:9825745ff645</sub>
- `for…in` is banned outright because it iterates inherited and string keys in unspecified order rather than an array's values.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:91-91` · high · sha:9825745ff645</sub>
- Once a method chain passes roughly three stages, split it into named intermediate `const`s so each stage's meaning is explicit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:100-112` · high · sha:9825745ff645</sub>
- Use `Map`/`Set` for collections with dynamic, runtime-discovered keys; reserve plain objects for records with a fixed, author-time-known set of named fields.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:114-125` · high · sha:9825745ff645</sub>
- Deep-clone values with `structuredClone(x)` rather than the `JSON.parse(JSON.stringify(x))` round-trip.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:127-138` · high · sha:9825745ff645</sub>
- Compose assembled strings with template literals rather than `+` concatenation, and use template literal types (e.g. `` `/api/${string}` ``) to make a string format a compile-time contract.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:140-151` · high · sha:9825745ff645</sub>
- Do not write clever one-liners; if a competent reader must read a line twice to be sure what it does, split it into named steps on separate lines.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:182-194` · high · sha:9825745ff645</sub>

## Constraints

## Conclusions

## Reference
- An `as const` object combined with `keyof typeof` / indexed-access derivation is the sanctioned replacement for TypeScript `enum`, which is banned, giving named constants with zero runtime emit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:51-56` · high · sha:9825745ff645</sub>
- The `??`-over-`||` defaulting rule is enforced via `@typescript-eslint/prefer-nullish-coalescing` set to error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:71-71` · high · sha:9825745ff645</sub>
- The loop-style rules are enforced via `no-restricted-syntax` banning `ForInStatement` and discouraging `.forEach`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:98-98` · high · sha:9825745ff645</sub>
- Using an object as a dynamic dictionary forfeits `.size`, guaranteed ordered iteration, non-string keys, and creates prototype-key hazards such as `__proto__` collisions.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:118-118` · high · sha:9825745ff645</sub>
- `JSON.parse(JSON.stringify(x))` silently drops `undefined` and functions and stringifies `Date`, `Map`, `Set`, and `RegExp` into unusable output.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:130-130` · high · sha:9825745ff645</sub>
- `structuredClone(x)` preserves `Date`, `Map`, `Set`, typed arrays, and cyclic references, and throws on truly non-cloneable values such as functions and DOM nodes.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:131-131` · high · sha:9825745ff645</sub>
- The template-literal-composition rule is enforced via `prefer-template` set to error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:151-151` · high · sha:9825745ff645</sub>

## Conflicts

## Superseded
