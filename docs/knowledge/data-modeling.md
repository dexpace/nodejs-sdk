# data-modeling

## Rules
- A branded type such as `Cents` must be produced only by a single validating parse-constructor function that performs the type's one sanctioned `as` cast; no other code in the module casts to it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/05-functions.md:38-45` · high · sha:51c21236bb1b</sub>
- Domain data types must model each legal state as a separate union member with only the fields that state owns, rather than a single object with optional fields for every state, so illegal field combinations cannot be constructed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:46-62` · high · sha:e17977c5aa9d</sub>
- Use `interface` to declare object shapes (records with named fields) and use `type` for everything else the type system expresses — unions, intersections, mapped types, conditional types, tuples, and primitives.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:64-77` · high · sha:e17977c5aa9d</sub>
- Domain records must be modeled as plain data (typed with `interface`) transformed by free functions; classes are reserved for things that own a lifecycle (something opened/closed) or hold mutable runtime state behind an invariant, such as a connection, cache, pool, server, or client.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:79-98` · high · sha:e17977c5aa9d</sub>
- `extends` is used only for `Error` hierarchies; all other code reuse must be composed via explicit delegation (holding a collaborator as a field and forwarding calls).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:100-125` · high · sha:e17977c5aa9d</sub>
- Closed polymorphism must be modeled as a discriminated union with a literal discriminant field (named `kind`, or a domain term like `status`/`type`) branched on with an exhaustive `switch`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:127-150` · high · sha:e17977c5aa9d</sub>
- Every discriminated-union `switch` must close with `default: return assertNever(x)`, defined once and imported everywhere, so adding a variant without a matching `case` becomes a compile error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:132-148` · high · sha:e17977c5aa9d</sub>
- Fields must be `readonly` by default, with mutability declared explicitly only within lifecycle classes; public function signatures must accept `Readonly<T>` and `ReadonlyArray<T>` (or `readonly T[]`).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:152-166` · high · sha:e17977c5aa9d</sub>
- Class fields should use the `private` modifier by default rather than `#private` fields, since `private` is compile-time-only, erasable, and emits no runtime code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:168-183` · high · sha:e17977c5aa9d</sub>
- A `#private` field requires a comment justifying a genuine runtime-privacy requirement (e.g. a library whose internals must stay unreachable via reflective or bracket access); it is not the default for ordinary application code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:172-183` · high · sha:e17977c5aa9d</sub>
- Constructors must only assign arguments to fields — no I/O and no branching — so `new` never fails for a reason the caller has to decode.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:185-204` · high · sha:e17977c5aa9d</sub>
- Validation of raw inputs must live in a `create*` factory function that either returns a fully valid object or throws, so an invalid instance is unrepresentable at runtime once past the factory.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:185-204` · high · sha:e17977c5aa9d</sub>
- Value objects must be modeled as plain objects frozen with `Object.freeze` at their factory and compared by a free structural `equals` helper function, never by a bolted-on `.equals` method.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:206-222` · high · sha:e17977c5aa9d</sub>
- Two or more optional fields that are always present or absent together must be lifted into a discriminated union with one member per co-traveling combination, rather than left as independent optional fields.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:224-241` · high · sha:e17977c5aa9d</sub>
- Domain IDs must be branded (intersected with a unique phantom tag) at the point they enter the domain, so structurally identical IDs of different entities (e.g. `OrderId` vs `UserId`) are not mutually assignable.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:243-259` · high · sha:e17977c5aa9d</sub>
- The brand cast for an ID type is applied once, inside the parsing factory where the raw value enters the domain, so internal code never re-casts.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:247-247` · high · sha:e17977c5aa9d</sub>
- Shallow object updates must use spread (`{...obj, field}`); nested/deep updates must be pushed into small named helper functions rather than written as inline nested spreads.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:153-164` · high · sha:9825745ff645</sub>
- Branching on a discriminant must use an exhaustive `switch`, never an `if`/`else if` chain over the discriminant, because an if-chain gives no exhaustiveness guarantee and silently falls through when a variant is added.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:166-180` · high · sha:9825745ff645</sub>

## Constraints
- `Object.freeze` performs only a shallow freeze, so a value object must hold only primitives or already-frozen/`ReadonlyArray` values, never a mutable object that would remain writable after freezing.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:209-209` · high · sha:e17977c5aa9d</sub>
- `.sort()` and `.reverse()` mutate their receiving array in place, so the source array must be spread first (`[...xs].sort()`) when the original must survive.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/07-typescript-idioms.md:157-157` · high · sha:9825745ff645</sub>

## Conclusions
- Every optional field on a single object doubles the representable state space, so an object with two independent optional fields permits four combinations even when only three (or fewer) are legal.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:49-50` · high · sha:e17977c5aa9d</sub>

## Reference
- The interface-vs-type split is enforced via `@typescript-eslint/consistent-type-definitions` set to `interface`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:77-77` · high · sha:e17977c5aa9d</sub>
- `Error` is the sole sanctioned base for `extends` because `instanceof` dispatch and the platform's error model rely on the prototype chain.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:103-103` · high · sha:e17977c5aa9d</sub>
- The `extends`-for-`Error`-only rule is enforced via ESLint `@typescript-eslint/no-extraneous-class` plus review rejecting non-`Error` `extends`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:125-125` · high · sha:e17977c5aa9d</sub>
- Exhaustive-switch discipline is enforced via `@typescript-eslint/switch-exhaustiveness-check` combined with the `assertNever` `never`-type guard.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:150-150` · high · sha:e17977c5aa9d</sub>
- The `readonly`-by-default rule is enforced via `@typescript-eslint/prefer-readonly`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:166-166` · high · sha:e17977c5aa9d</sub>
- Constructor-assigns/factory-validates discipline is enforced by zod usage at boundaries plus review rejecting validation logic inside constructors and `new` calls that bypass the domain-type factory.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:204-204` · high · sha:e17977c5aa9d</sub>

## Conflicts

## Superseded
