## 4. Domain Model Construction

**HTTP-1**/**SEAM-29**/**HTTP-2** require immutable value + Builder construction with no public field-wise
constructor or unchecked-copy bypass. TypeScript's structural type system makes this harder to enforce than
Kotlin's nominal typing with genuinely private constructors, for two independent reasons worth separating:

1. TypeScript's `private`/`protected` modifiers are erased at compile time — a `private` field is only a
   type-checker fiction; `(instance as any).method` reaches it at runtime with no error. Real, runtime-enforced
   encapsulation in JavaScript requires ECMAScript private class fields (`#field`), which the engine itself refuses
   to let external code read, write, or even detect the existence of via reflection (`Object.keys`,
   `JSON.stringify`, `Reflect.ownKeys` all skip them). The port uses `#field` for every piece of state a model
   class holds, and exposes only `get` accessors and the builder's `build()` as the way to construct or read one —
   `private constructor` alone is not load-bearing and is used only as a secondary, compile-time signal for callers
   inside the same package.
2. TypeScript's structural typing means a *public* type like `interface Request { readonly method: Method; readonly
   url: URL; ... }` can be satisfied by any object literal shaped like it, entirely bypassing the builder and its
   validation (**HTTP-4**'s "required-field validation," **HTTP-7**'s "reject a body on GET/HEAD/TRACE/CONNECT").
   This hole cannot be fully closed in TypeScript — it is an acknowledged, structural limitation of the language,
   not an oversight, and is recorded as such in §10. The mitigation is to keep the *public* surface a concrete class
   (not a bare structural interface) exported from each package's single entry point, with the class itself as the
   only spelled type consumers are meant to name; a caller who deliberately duck-types past that is knowingly
   opting out of the invariant, the same way a JVM caller who reaches for unsafe reflection opts out of a sealed
   hierarchy's guarantees.

`newBuilder()` (**HTTP-3**) is a method on every model class returning a pre-filled builder that defensively copies
every mutable collection (arrays via spread, header/query maps via `new Map(...)`) rather than aliasing the
source's internals. Required-field validation is single-sourced (**SEAM-29**) through one shared helper —
`requireField(value, name)`, thrown as a common `RequiredFieldError` with the exact message form `` `${name} is
required` `` — used by every builder's `build()`, so **HTTP-4**'s field-named errors cannot drift between models.

Read-only collection exposure (**HTTP-5**) has a cheaper answer in the port than in the JVM reference. Kotlin's
unmodifiable-collection wrappers still allow re-reading a *live* backing collection through an unmodifiable view, so
the reference must additionally defensive-copy at build time and wrap with an unmodifiable type on top. Because
`@dexpace/core`'s models are genuinely immutable once built (§4's whole point), the defensive copy only needs to
happen *once*, at construction: `Object.freeze(new Map(headerEntries))` computed in the constructor and returned by
reference from every subsequent getter call, rather than re-copied per access the way an unmodifiable-wrapper
pattern would. `Object.freeze` is shallow — it prevents adding/removing/reassigning the frozen collection's own
entries but would not, by itself, protect a nested mutable value stored inside it — so every nested collection (each
header's value array, for instance) is frozen independently at the same construction step, not relied upon to
freeze transitively.

The `Headers` model (**HTTP-13**–**HTTP-22**) is a class wrapping two parallel maps: a lower-cased key → value-array
map for case-insensitive lookup/mutation/equality, and a lower-cased key → original-casing map for wire emission,
directly satisfying "case-insensitive for storage... preserving original casing." `MediaType`, `Status`, `Protocol`,
and the typed header-name type follow the reference's value-type-with-factory pattern (**HTTP-23**, **HTTP-33**,
etc.) as plain frozen classes reconstructed through a `parse`/`of` static factory rather than a builder, matching
the reference's own "value-based types with no builder... re-constructed through their factories" (**HTTP-3**).

The shared `Builder<T>` generic contract (**SEAM-29** restated) is a one-line structural interface —
`interface Builder<T> { build(): T }` — and, being structural, any class exposing a `build(): T` method already
satisfies it with no explicit `implements` clause required, which is if anything a closer match to the requirement's
intent ("generic composition helpers can accept any builder") than Kotlin's own nominal interface, since TypeScript
never forces a class to declare conformance it structurally already has.

---

