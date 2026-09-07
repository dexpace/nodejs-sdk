# naming-conventions

## Rules
- Apply Google's TypeScript identifier casing table verbatim, using `lowerCamelCase` for variables, functions, properties, parameters, and methods.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:36-48` · high · sha:173bc20714a0</sub>
- Use `UpperCamelCase` for classes, interfaces, types, type aliases, and enum-like `as const` maps.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:36-48` · high · sha:173bc20714a0</sub>
- Reserve `CONSTANT_CASE` only for module-level constants that are deeply immutable, per rule 2.3.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:36-48` · high · sha:173bc20714a0</sub>
- Do not prefix interface names with `I` (write `User`, not `IUser`), since the prefix is Hungarian notation that leaks an implementation distinction the consumer should not care about.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:52-59` · high · sha:173bc20714a0</sub>
- Do not use a leading or trailing underscore on any name to signal privacy; use the `private`, `protected`, or `#name` keywords instead so the compiler enforces the encapsulation rather than a convention.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:52-59` · high · sha:173bc20714a0</sub>
- Reserve `CONSTANT_CASE` for values that are deeply immutable and conceptually constant, testing each value by asking whether a field of it could ever change after construction; a mutable singleton like `const retryableStatus = new Set([429, 503])` stays `lowerCamelCase` even at module scope because its contents can mutate.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:61-69` · high · sha:173bc20714a0</sub>
- Name files in kebab-case (e.g. `user-service.ts`); the file name need not match the exported symbol's casing, so `user-client.ts` exporting `UserClient` is correct.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:71-77` · high · sha:173bc20714a0</sub>
- Spell names out beyond the idiomatic abbreviation set (`id`, `url`, `ctx`, and the loop counter `i`, which are allowed everywhere); everything else must be spelled out in full, e.g. `req` becomes `request`, `usr` becomes `user`, `cfg` becomes `config`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:81-89` · high · sha:173bc20714a0</sub>
- Never invent a shorthand by dropping letters from a name, such as `Sbx` for `Sandbox` or `Usr` for `User`, since such abbreviations are unsearchable and force the reader to decode them.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:87` · high · sha:173bc20714a0</sub>
- Draw every resource-operating method's verb from the fixed client-verb taxonomy and never invent a synonym, since `fetchUser`, `readUser`, or `findUser` are wrong when `getUser` is the established name, so the reader knows the contract without reading the method body.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:91-96` · high · sha:173bc20714a0</sub>
- Omit the `Async` suffix from method names (write `getUser`, not `getUserAsync`), because the `Promise` return type already announces asynchrony and the project ships no synchronous twin to disambiguate.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:110-117` · high · sha:173bc20714a0</sub>
- Prefix boolean-typed properties, variables, and parameters with `is`, `has`, `can`, or `should` so they read as yes/no questions, e.g. `isVerified` rather than `verified`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:119-127` · high · sha:173bc20714a0</sub>
- Avoid negative-stem boolean names such as `isNotReady`, since they produce double negatives like `!isNotReady`; prefer `isReady` and negate at the use site.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:124` · high · sha:173bc20714a0</sub>
- Apply the predicate naming convention (`is`/`has`/`can`/`should` prefix) to boolean-returning functions and methods as well, e.g. `canRetry(error)` and `hasCapacity(pool)`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:125-127` · high · sha:173bc20714a0</sub>
- Design every name for the reader of its call site rather than the author of its definition, testing a candidate name by writing the call site first; if it reads clearly without the definition, the name works.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:129-137` · high · sha:173bc20714a0</sub>
- Do not repeat the module context already present at the call site in a member name; `userStore.get(id)` is correct while `userStore.getUserById(id)` stutters the already-supplied noun.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:134` · high · sha:173bc20714a0</sub>
- Carry the physical unit in the name of any quantity, placing the unit as a suffix after the concept, e.g. `timeoutMs`, `sizeBytes`, `ttlSeconds`, `maxAgeMs` (not `msMaxAge`), because a caller passing the wrong unit compiles cleanly and fails only in production.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:139-146` · high · sha:173bc20714a0</sub>
- Use a single conventional letter for a type parameter when its role is obvious from position, e.g. `T` for one generic type, `K`/`V` for a key/value pair, `E` for an element.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:148-156` · high · sha:173bc20714a0</sub>
- Use a descriptive `UpperCamelCase` name with a `T` prefix for a type parameter when its role is not obvious, e.g. `TRow`, `TError`, `TResponse`, keeping it visually distinct from a concrete type of the same base name.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:148-156` · high · sha:173bc20714a0</sub>
- A side-effecting function's name must carry an effect verb (e.g. `writeLedger`, `emitEvent`, `fetchUser`) rather than a neutral name like `data` or `process`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:152-152` · high · sha:51c21236bb1b</sub>

## Constraints

## Conclusions
- dexpace holds a stricter deep-immutability line for `CONSTANT_CASE` than Google's guide, which allows `CONSTANT_CASE` on intent alone.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:67` · high · sha:173bc20714a0</sub>
- dexpace deviates from Google's snake_case file-naming convention in favor of kebab-case because kebab-case is case-insensitivity-safe, preventing import resolution from drifting between case-sensitive and case-insensitive filesystems, and matches the ecosystem norm for published TypeScript packages.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:71-78` · high · sha:173bc20714a0</sub>
- The unit suffix on a quantity name becomes redundant once a branded type encodes the unit, but remains mandatory in its absence.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:144` · high · sha:173bc20714a0</sub>

## Reference
- `eslint-plugin-unicorn`'s `filename-case` rule, set to `kebabCase`, enforces kebab-case file naming.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:79` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `get<Noun>` fetches one resource, with a contract to throw when the resource is absent or return `undefined` only if the signature documents that possibility.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `list<Noun>` enumerates many resources, returning an array or async iterable, never a single item and never `undefined`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `create<Noun>` creates a new resource and throws when it already exists.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `upsert<Noun>` idempotently creates or updates a resource.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `update<Noun>` modifies an existing resource and throws when the resource is absent.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `delete<Noun>` removes a resource, no-ops when the resource is absent, and does not throw on "not found."
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- In the client verb taxonomy, `begin<Noun>` starts a long-running operation and returns a poller or handle.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:98-106` · high · sha:173bc20714a0</sub>
- A separate typescript-react chapter overrides the kebab-case file-naming rule to require PascalCase component files.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/02-naming-conventions.md:164` · medium · sha:173bc20714a0</sub>

## Conflicts

## Superseded
