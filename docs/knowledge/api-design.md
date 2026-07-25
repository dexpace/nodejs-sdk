# api-design

## Rules
- Modules must never use `export default`; every export must be a named symbol.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:40-46` · high · sha:29344ed7df3d</sub>
- `index.ts` must be the sole barrel re-exporting a package's public surface; every other module is an implementation detail free to move, rename, or split.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:53-57` · high · sha:29344ed7df3d</sub>
- A package should have one barrel per feature folder, not per directory, since deep barrel chains create import cycles and defeat tree-shaking.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:58-58` · high · sha:29344ed7df3d</sub>
- Functions should accept the narrowest `interface` describing only the members they actually use (consumer-defined interfaces), rather than a wide concrete class.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:81-86` · high · sha:29344ed7df3d</sub>
- Functions must return the concrete, fully-specified, `readonly` type, never a wide `unknown` or a bare interface where a concrete `readonly` type is known.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:86-86` · high · sha:29344ed7df3d</sub>
- Optional parameters must be collected into a single options object rather than a positional list past two parameters.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:94-97` · high · sha:29344ed7df3d</sub>
- Each option's default value must live in exactly one place (the implementation) and be documented on the option field with a `@default` TSDoc tag.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:98-98` · high · sha:29344ed7df3d</sub>
- The whole options object and every field within it must be optional and `readonly`, so a zero-config call works and a caller can override one field without restating the rest.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:99-99` · high · sha:29344ed7df3d</sub>
- Parallel operations on a resource (e.g. `getUser`, `listUsers`, `createUser`) must share the same verb taxonomy, parameter order (resource argument first, options object last), and cancellation field name (`signal`).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:112-116` · high · sha:29344ed7df3d</sub>
- Parallel return shapes must match the operation semantics: `get` returns one item, `list` enumerates many, `create` returns the created item.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:116-116` · high · sha:29344ed7df3d</sub>
- Divergence from the established API family pattern must be a deliberate, documented exception, not an accident of who wrote which method.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:116-116` · high · sha:29344ed7df3d</sub>
- Data crossing an external boundary (a `fetch` response, a request body, a queue message) must be parsed into a domain type via a zod schema before interior code touches it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:125-128` · high · sha:29344ed7df3d</sub>
- The TypeScript type for wire data must be derived from the schema via `z.infer`, never hand-written alongside the schema, because a separately maintained type and schema silently drift.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:129-129` · high · sha:29344ed7df3d</sub>
- A zod schema must be parsed once at the boundary where the data enters, with downstream code consuming the inferred type without re-validation.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:130-130` · high · sha:29344ed7df3d</sub>
- `.readonly()` must be called on a zod schema so the parsed value is frozen at runtime and `z.infer` yields a readonly type, with no separate `Readonly<>` wrapper needed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:130-130` · high · sha:29344ed7df3d</sub>
- Every public operation must declare its failure modes with a `@throws` tag per catchable error type or a `Result<T, E>` return type, and must accept cancellation via a `{ signal }: AbortSignal` option threaded to the underlying I/O.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:141-146` · high · sha:29344ed7df3d</sub>
- A public symbol slated for removal must first be marked `@deprecated`, kept working as a thin shim for one major release cycle, then deleted.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:158-161` · high · sha:29344ed7df3d</sub>
- A `@deprecated` tag must name a specific migration path (the replacement symbol) and the version in which the symbol will be removed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:162-162` · high · sha:29344ed7df3d</sub>
- A result set that could be large or unbounded must be returned as an `AsyncIterable<T>` rather than an eagerly materialized array.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:173-176` · high · sha:29344ed7df3d</sub>
- Pagination logic (continuation-token plumbing) must live inside the async generator, hidden from the caller, which fetches the next page only when the consumer has drained the current one.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:177-177` · high · sha:29344ed7df3d</sub>
- An `AsyncIterable`-returning operation must thread `{ signal }` cancellation like every other operation so an abort stops the in-flight page fetch and the `for await` loop.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:178-178` · high · sha:29344ed7df3d</sub>
- A streaming operation's public signature must declare the return type as `AsyncIterable<T>`, not a concrete generator type, so the implementation is free to change.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:178-178` · high · sha:29344ed7df3d</sub>

## Constraints
- `import/no-default-export` (from the `gts` baseline) enforces named-only exports and is allowed only where a framework demands a default export (e.g. a route module), confined to those files.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:51-51` · high · sha:29344ed7df3d</sub>
- `max-params 3` forces the use of an options object for functions with more than a couple of parameters.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:110-110` · high · sha:29344ed7df3d</sub>

## Conclusions
- New helpers, types, and classes default to unexported (private) status and are promoted into the barrel only once an outside caller genuinely needs them, because every export is a permanent contract that is expensive to remove once shipped.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:68-73` · high · sha:29344ed7df3d</sub>
- `Result` is preferred over `@throws` for public API failure documentation because it cannot drift from the implementation, whereas a `@throws` comment can.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:145-145` · high · sha:29344ed7df3d</sub>

## Reference
- A package's public API is a contract kept for every caller, in every refactor, until a major version allows breaking it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:3-3` · high · sha:29344ed7df3d</sub>
- A default export has no canonical name at the import site, so each caller can invent a different local name for the same symbol.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:43-43` · high · sha:29344ed7df3d</sub>
- A symbol marked `export` in a non-barrel module but never re-exported from `index.ts` is private to the package, even though TypeScript itself does not enforce that privacy.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:57-57` · high · sha:29344ed7df3d</sub>
- The `package.json` `exports` field is the hard wall that makes `import 'pkg/internal/x'` fail to resolve, detailed separately in the Bun guide's build chapter.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:58-58` · high · sha:29344ed7df3d</sub>
- The consumer-defined-interfaces input pattern is ported from Kotlin style guide chapter 10.2.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:85-85` · high · sha:29344ed7df3d</sub>
- Removing or renaming a public symbol, narrowing a parameter type, or changing return semantics is a breaking change requiring a MAJOR semver bump; a new optional option or method is MINOR; a contract-preserving bug fix is PATCH.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/10-api-design.md:163-163` · high · sha:29344ed7df3d</sub>

## Conflicts

## Superseded
