# type-system

## Rules
- Treat the tsconfig strict flag family as law; none of the `strict` baseline plus the six added flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) may be weakened per-project without a recorded deviation-ledger entry.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:35-39` · high · sha:d5a94a6c0de1</sub>
- Ban `any` throughout the codebase and accept `unknown` for external input, narrowing it inward, because `any` disables every compiler check on a value and on everything derived from it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:48-51` · high · sha:d5a94a6c0de1</sub>
- Annotate boundary variables that receive external input (`JSON.parse`, `fetch`, request payloads) as `unknown` rather than letting them default to `any`, then parse them into a domain type before the interior code sees them.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:51-52` · high · sha:d5a94a6c0de1</sub>
- Ban `@ts-ignore` entirely, and allow `@ts-expect-error` only with an inline reason and only in test files or declared bridges to untyped third-party code, because `@ts-ignore` silences whatever error sits on the next line, including new ones introduced later, while `@ts-expect-error` itself errors when the next line has no error to suppress.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:62-67` · high · sha:d5a94a6c0de1</sub>
- Require a why-comment on every type assertion (`as`), reaching first for `satisfies`, a type guard, or a runtime parse (e.g. zod), and reserving `as` for cases like generating a brand after validation or narrowing a value the compiler cannot follow.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:76-80` · high · sha:d5a94a6c0de1</sub>
- Represent absence as `undefined` throughout the interior of the codebase; let `null` in only where an external contract (JSON APIs, database drivers, the DOM) forces it, and convert `null` to `undefined` at the boundary where you parse.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:89-93` · high · sha:d5a94a6c0de1</sub>
- Prefer the optional-property syntax `{name?: string}` over the explicit-union form `{name: string | undefined}` in object types, reserving the explicit union for the rare case where the key must exist as a signal even when empty.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:101-105` · high · sha:d5a94a6c0de1</sub>
- Narrow types with the weakest sufficient tool, in this preference order: a discriminant property first, then built-in `typeof`/`instanceof`/`in` checks, then a custom type guard as the last resort.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:114-118` · high · sha:d5a94a6c0de1</sub>
- Unit-test every custom type guard (`x is T`) with both positive cases that must pass and negative cases (wrong type, missing field, `null`) that must fail, because the compiler cannot verify that a guard's body actually matches its claimed type.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:132-136` · high · sha:d5a94a6c0de1</sub>
- Brand domain primitives in high-rigor modules using a phantom tag, e.g. `type UserId = string & {readonly __brand: 'UserId'}`, since in a structural type system every plain `string` is otherwise interchangeable and the compiler will pass one string type where another was meant.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:148-152` · high · sha:d5a94a6c0de1</sub>
- Restrict creation of a branded value to a single parsing constructor that validates the raw input and generates the brand, making that constructor the one sanctioned place for an `as` assertion on that type.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:152` · high · sha:d5a94a6c0de1</sub>
- Mark every field `readonly`, every array parameter as `ReadonlyArray<T>` (or `readonly T[]`), and wrap every object return type in `Readonly<T>` on public signatures, so the API contract, not caller discipline, guarantees immutability at the boundary.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:164-168` · high · sha:d5a94a6c0de1</sub>
- Constrain every generic type parameter to what the function body actually needs (e.g. `<T extends {id: string}>`), and delete any type parameter that appears exactly once in a signature since it constrains nothing.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:177-180` · high · sha:d5a94a6c0de1</sub>
- Annotate variance with `in` and `out` on public generic interfaces, so the compiler can check the intended direction of data flow.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:177-187` · high · sha:d5a94a6c0de1</sub>
- Write erasable syntax only; `enum`, runtime `namespace`, constructor parameter properties, and `import =` aliases are banned because they are type-looking syntax that emits runtime code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:191-196,209` · high · sha:d5a94a6c0de1</sub>
- Replace a banned `enum` with either a bare literal union (e.g. `type Color = 'red' | 'green'`) for a small closed set, or an `as const` object plus a derived type (`const Color = {...} as const; type Color = (typeof Color)[keyof typeof Color]`) when iteration over the values is needed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:199-207` · high · sha:d5a94a6c0de1</sub>

## Constraints
- Under `exactOptionalPropertyTypes`, `{name: undefined}` does not satisfy an optional property type `{name?: string}`, since the two forms are compiler-distinguished.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:104-112` · high · sha:d5a94a6c0de1</sub>
- `const enum` is broken under the `isolatedModules` compiler flag, and Node's native type-stripping cannot execute non-erasable syntax.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:196` · high · sha:d5a94a6c0de1</sub>
- Consuming an `enum` from codegen or a third-party library (Prisma, gRPC, the TypeScript compiler API) is allowed at the boundary provided it is converted to a domain union immediately inside; `declare namespace` in an ambient `.d.ts` file remains legal because it is erasable.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:208` · high · sha:d5a94a6c0de1</sub>

## Conclusions

## Reference
- The `noUncheckedIndexedAccess` compiler flag makes indexing an array or record yield `T | undefined`, forcing a bounds check.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:94` · high · sha:640652667e83</sub>
- The `exactOptionalPropertyTypes` compiler flag distinguishes an absent property from one explicitly set to `undefined`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:95` · high · sha:640652667e83</sub>
- The `noImplicitOverride` compiler flag requires the `override` keyword when overriding a base class member, turning a renamed base method into a compile error instead of a silent new method.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:96` · high · sha:640652667e83</sub>
- The `isolatedModules` compiler flag requires each file to be transpilable alone, keeping source compatible with single-file transpilers like esbuild and SWC.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:97` · high · sha:640652667e83</sub>
- The `verbatimModuleSyntax` compiler flag requires type-only imports to use `import type`, so the emitter never has to guess whether an import survives to runtime.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:98` · high · sha:640652667e83</sub>
- The `erasableSyntaxOnly` compiler flag bans TypeScript syntax that emits runtime code, including `enum`, namespaces with runtime code, parameter properties, and `import =`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:99` · high · sha:640652667e83</sub>
- `JSON.parse` and `res.json()` return `any`, which the `no-unsafe-assignment` ESLint rule flags when assigned without an explicit type.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:52` · high · sha:d5a94a6c0de1</sub>
- A numeric TypeScript `enum` emits a bidirectional lookup object at runtime, so `Color[0]` reverse-maps to the enum member's name.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:194` · high · sha:d5a94a6c0de1</sub>
- The ban on `enum` and on constructor parameter properties is recorded as two separate entries in the project's Deviations ledger.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:208` · high · sha:d5a94a6c0de1</sub>
- With `noUncheckedIndexedAccess` enabled, an indexed lookup (e.g. `RATES[jurisdiction]`) is typed as possibly `undefined`, so the flag forces a guard after the lookup.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:47-47` · high · sha:51c21236bb1b</sub>

## Conflicts

## Superseded
