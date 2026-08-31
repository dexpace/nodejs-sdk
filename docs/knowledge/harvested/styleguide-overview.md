# styleguide-overview

## Rules
- The guide prioritizes correctness, explicitness, and simplicity, and never cleverness, `any`, or abstraction for its own sake.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:3-3` · high · sha:42fd5bfb14b8</sub>
- gts v7's Prettier defaults and lint baseline are final; formatting is treated as a non-discussion.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:13-13` · high · sha:42fd5bfb14b8</sub>
- Rule 1 for TypeScript is data and functions, not objects — model state as plain objects typed by `interface`, group behaviour into free functions and small interfaces, reserve `class` for stateful lifecycle resources you open and close, and use no inheritance for code reuse.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:59-59` · high · sha:42fd5bfb14b8</sub>
- Rule 2 for TypeScript is explicit over implicit — code says what it does at the call site and does nothing it did not say, no `any`, no decorator or DI magic, no type-space syntax that emits runtime code, every dependency is a visible parameter, and library options follow documented defaults with callers passing only what differs via an options object.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:60-60` · high · sha:42fd5bfb14b8</sub>
- Rule 3 for TypeScript is immutable by default — `const` over `let`, `readonly` fields, `ReadonlyArray<T>` in public signatures, frozen config, and updating by spreading into a new value rather than mutating.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:61-61` · high · sha:42fd5bfb14b8</sub>
- Rule 4 for TypeScript is errors are values, handled explicitly — typed `Error` subclasses per domain with mandatory `cause` chaining and context fields on rethrow, opt-in `Result<T, E>` discriminated unions for expected failure (never mixed within a module), `catch (e: unknown)` then narrow, no swallowing, and `no-floating-promises` making a dropped promise a lint error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:62-62` · high · sha:42fd5bfb14b8</sub>
- Rule 5 for TypeScript is composition over inheritance — `extends` is reserved for `Error` hierarchies only, closed polymorphism is a discriminated union, code reuse is delegation, and interfaces are composed small rather than built into a deep class tree.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:63-63` · high · sha:42fd5bfb14b8</sub>
- Rule 6 for TypeScript is transform, don't mutate — build pipelines from `map`/`filter`/`reduce`, reach for `for...of` only for effects or early exit, functions take input and return new output, and chains past roughly three stages get named intermediate `const`s.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:64-64` · high · sha:42fd5bfb14b8</sub>
- Rule 7 for TypeScript is always say why — TSDoc comments explain reasoning not mechanics, non-obvious public API gets an `@example`, enforcement notes name their rule, and if you can't say why a line exists you should question whether it should.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:65-65` · high · sha:42fd5bfb14b8</sub>
- Rule 8 for TypeScript is assert aggressively — an `invariant(cond, msg): asserts cond` helper backs runtime checks that also narrow types for the compiler, with a minimum average of two assertions per function (preconditions at entry, postconditions at exit), compound assertions split, and both positive and negative space asserted.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:66-66` · high · sha:42fd5bfb14b8</sub>
- Rule 9 for TypeScript is limits on everything — functions cap at 70 lines (lint-enforced), nesting caps at `max-depth 3` aiming for two, every loop/queue/retry/pool/cache/fan-out is bounded, timeouts are mandatory on external I/O via `AbortSignal.timeout()`, and no recursion is allowed in library code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:67-67` · high · sha:42fd5bfb14b8</sub>
- Rule 10 for TypeScript is small functions with breathing room — aim for 10-30 lines at one level of abstraction each, guard clauses first so the happy path stays flush left, and blank lines separate logical sections since whitespace is free.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:68-68` · high · sha:42fd5bfb14b8</sub>
- Rule 11 for TypeScript is performance from the outset — design-time is when 1000x improvements are cheap, work with the grain of V8 via stable object shapes for monomorphism, batch over serial awaits, and optimize the slowest resource first (network > disk > memory > CPU).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:69-69` · high · sha:42fd5bfb14b8</sub>
- Rule 12 for TypeScript is zero technical debt — what exists meets the design goals, perfection is preferred over technical debt because debt never gets paid, and things should be done right the first time since a second chance may never come.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:70-70` · high · sha:42fd5bfb14b8</sub>
- When adopting a new rule or migrating away from a deprecated pattern, the change must be applied at the module/package level or larger, never mixing two styles within the same module, because a half-migrated module is more confusing than either end state.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:94-94` · high · sha:42fd5bfb14b8</sub>

## Constraints

## Conclusions
- The value priority order is correctness > performance > developer experience (the root README's ordering), with developer experience further refined by this guide into simplicity > expressiveness.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:18-18` · high · sha:42fd5bfb14b8</sub>
- Correctness ranks first because a fast, simple, expressive program that computes the wrong answer is worthless, implying every feasible kind of testing (unit, property-based, type-level, mutation, component, e2e) and treating the type system as the first test suite.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:20-20` · high · sha:42fd5bfb14b8</sub>
- Performance ranks before simplicity because the right architecture is chosen once at design time and is expensive to retrofit; the guide directs working with the grain of V8 and optimizing the slowest resource first (network > disk > memory > CPU).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:21-21` · high · sha:42fd5bfb14b8</sub>
- Simplicity is defined as the simplest approach that accomplishes the goal, with no abstraction for its own sake and no cleverness; when two designs are both correct and fast enough, the simpler one wins.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:22-22` · high · sha:42fd5bfb14b8</sub>
- Expressiveness ranks last in the priority order because clarity is worth nothing if the code is wrong, slow, or needlessly complex.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:23-23` · high · sha:42fd5bfb14b8</sub>
- The guide bans `enum` (where Google allows it, banning only `const enum`) in favor of literal unions or `as const` maps, because numeric enums hide runtime emit (even a reverse-lookup object), string enums are nominal and create JSON-boundary friction (cannot take `JSON.parse` output without a cast), and native type-stripping/`isolatedModules` cannot execute enum syntax.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:78-78` · high · sha:42fd5bfb14b8</sub>
- The guide bans constructor parameter properties (where Google allows them) in favor of explicit declare-and-assign, because parameter properties hide field declaration and assignment inside the constructor signature, violating the "no hidden behaviour" principle.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:79-79` · high · sha:42fd5bfb14b8</sub>
- The guide adds a 70-line hard function-size cap, lint-enforced, as an addition Google does not address, as an owner decision following Tiger Style discipline and deliberately set at Go's level rather than scaled down for TypeScript.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:80-80` · high · sha:42fd5bfb14b8</sub>
- The guide uses kebab-case file naming instead of Google's specified snake_case, for ecosystem-norm alignment and case-sensitivity safety.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:81-81` · high · sha:42fd5bfb14b8</sub>

## Reference
- The dexpace TypeScript style guide targets TypeScript 5.8+, is ESM-only, and uses `gts` for tooling.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:3-3` · high · sha:42fd5bfb14b8</sub>
- The guide is platform-agnostic, covering the TypeScript language, type system, and runtime-neutral idioms, while runtime-specific rules live in companion guides for server (typescript-bun) and UI (typescript-react) concerns.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:5-5` · high · sha:42fd5bfb14b8</sub>
- The Google TypeScript Style Guide is the canonical authority for casing, syntax, and taste; where the dexpace guide's guidance collides with it, the official Google guide wins, except for deliberate recorded deviations.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:11-11` · high · sha:42fd5bfb14b8</sub>
- ts.dev/style is the community adaptation of the Google guide and is deferred to only to fill gaps that the official Google guide leaves open.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:12-12` · high · sha:42fd5bfb14b8</sub>
- The dexpace guide's own overlay on top of Google/ts.dev/gts adds Tiger Style discipline (assertion density, bounded everything, no recursion, zero debt), a 70-line function cap, an erasable-syntax stance (emits no runtime code), and `Result`-as-discriminated-union discipline.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:14-14` · high · sha:42fd5bfb14b8</sub>
- Chapter 01 (Formatting & Tooling) covers gts-only tooling, ESLint overlay, tsconfig flags, TS >= 5.8, bun install, pre-commit `gts lint`, a 70-line function cap, `max-depth 3`, and `max-params 3`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:33-33` · high · sha:42fd5bfb14b8</sub>
- Chapter 02 (Naming Conventions) covers Google casing, kebab-case files, a client verb taxonomy, banning the `I` prefix and `Async` suffix, and naming things for the call site.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:34-34` · high · sha:42fd5bfb14b8</sub>
- Chapter 03 (The Type System) covers banning `any` in favor of `unknown` plus narrowing, requiring a reason for `as`, `satisfies`/guards/parse, using `undefined` for absence, tested type guards, branded primitives, and `readonly`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:35-35` · high · sha:42fd5bfb14b8</sub>
- Chapter 04 (Variables & Declarations) covers `const` as default, `let` requiring justification, banning `var`, banning non-null `!` outside bridges, and `as const` for config.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:36-36` · high · sha:42fd5bfb14b8</sub>
- Chapter 05 (Functions) covers a 70-line cap, one level of abstraction, guard clauses, the step-down rule, an options object for 3+ parameters, an `invariant(): asserts` helper, and 2+ assertions.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:37-37` · high · sha:42fd5bfb14b8</sub>
- Chapter 06 (Classes & Data Modeling) covers making illegal states unrepresentable, `interface` plus free functions, reserving classes for lifecycle, discriminated unions, and "parse, don't validate".
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:38-38` · high · sha:42fd5bfb14b8</sub>
- Chapter 07 (TypeScript Idioms) covers `satisfies`, `as const`, `?.`/`??` (no `||` defaults), pipeline `map`/`filter`/`reduce`, `Map`/`Set`, `structuredClone`, and naming the steps.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:39-39` · high · sha:42fd5bfb14b8</sub>
- Chapter 08 (Error Handling) covers `Error` subclasses, mandatory `cause` chaining, `catch (e: unknown)` plus narrow, opt-in `Result` unions, and programmer versus operational errors.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:40-40` · high · sha:42fd5bfb14b8</sub>
- Chapter 09 (Concurrency & Async) covers async/await only, `no-floating-promises`, `AbortSignal.timeout()`, bounded fan-out via a worker-pool helper, and documented races.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:41-41` · high · sha:42fd5bfb14b8</sub>
- Chapter 10 (API Design) covers named exports only, `index.ts` as the contract, accepting interfaces while returning concrete types, zod at boundaries, `@deprecated` plus semver, and API symmetry.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:42-42` · high · sha:42fd5bfb14b8</sub>
- Chapter 11 (Testing) covers bun test, colocated `*.test.ts` files, fast-check property tests, `expectTypeOf` type-level testing, fakes over mocks, MSW, and determinism.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:43-43` · high · sha:42fd5bfb14b8</sub>
- Chapter 12 (Module Organization) covers ESM only, `import type` discipline, feature folders, barrels at the boundary only, `madge --circular`, and no module side effects.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:44-44` · high · sha:42fd5bfb14b8</sub>
- Chapter 13 (Resource Management) covers `using`/`await using`, `Symbol.dispose`, `AbortController` as a lifecycle handle, and bounded pools/queues/caches.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:45-45` · high · sha:42fd5bfb14b8</sub>
- Chapter 14 (Documentation) covers TSDoc on the public API, never restating types, why-comments, and `@example` on non-obvious publics.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:46-46` · high · sha:42fd5bfb14b8</sub>
- Chapter 15 (Performance) covers V8 monomorphism, avoiding `delete`/sparse arrays, allocation hygiene, eliminating serial awaits, measuring first, and the network > disk > memory > CPU resource order.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:47-47` · high · sha:42fd5bfb14b8</sub>
- Security, performance, and git practices are covered in the root-level code style guide; those cross-cutting docs are language-agnostic and this guide adapts them to TypeScript.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:53-53` · high · sha:42fd5bfb14b8</sub>
- The Google TypeScript Style Guide is the canonical authority the guide extends; where guidance collides, the official Google guide wins except for the recorded deviations.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:85-85` · high · sha:42fd5bfb14b8</sub>
- ts.dev/style is credited as the community adaptation of the Google guide that fills gaps the official guide leaves open.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:86-86` · high · sha:42fd5bfb14b8</sub>
- gts is credited as Google's opinionated TypeScript tooling, serving as the single formatter and lint baseline for the guide.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:87-87` · high · sha:42fd5bfb14b8</sub>
- Effective TypeScript by Dan Vanderkam is credited as community canon for idiomatic, type-safe patterns.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:88-88` · high · sha:42fd5bfb14b8</sub>
- total-typescript.com is credited as an influence for modern type-system technique — branded types, discriminated unions, `satisfies`, and inference design.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:89-89` · high · sha:42fd5bfb14b8</sub>
- TigerBeetle Tiger Style is credited as the influence behind assertion density, the 70-line function cap, limits on everything, no recursion, and zero technical debt.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:90-90` · high · sha:42fd5bfb14b8</sub>

## Conflicts

## Superseded
