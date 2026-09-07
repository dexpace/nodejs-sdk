// SPDX-License-Identifier: MIT
// packages/codec-json/src/tristate-schema.ts
import {
  absent,
  DeserializationError,
  nullValue,
  present,
  type Schema,
  type Tristate,
} from '@dexpace/core';

/**
 * The sentinel {@link tristateObject} feeds to a field's schema for "this key was not on the wire."
 *
 * `SERDE-17` is the awkward half of Tristate decoding: a `JSON.parse` reviver runs bottom-up per key
 * and never fires for a key that is *absent*, so the raw JSON layer structurally cannot tell Absent
 * from Null. The reference resolves this one layer up, in the codec's field-default machinery; this
 * port resolves it one layer up too, in the schema combinator — {@link tristateObject} looks the key
 * up on the parsed object and feeds this sentinel to the field's schema when it is missing.
 *
 * Not on the package's public barrel: no caller has to construct one, because {@link tristate} also
 * accepts plain `undefined` for Absent. A plain `Symbol` rather than `Symbol.for` for the same
 * reason — nothing crosses a package boundary on this identity, so the global registry buys nothing.
 *
 * @internal
 */
export const MISSING: unique symbol = Symbol('@dexpace/codec-json.missing');

/**
 * Wrap a schema so it decodes the three PATCH states (SERDE-16).
 *
 * @param inner - the schema for the value a Present carries.
 * @returns a schema producing `Tristate<T>`: a missing-key sentinel or `undefined` yields Absent, a wire
 * `null` yields Null, anything else runs through `inner` and yields Present.
 * @throws DeserializationError when `inner` resolves a present value to `null` or `undefined`. SERDE-14
 * has three states; a Present carrying nothing would be a fourth, and the wire said the key was there.
 * @public
 */
export function tristate<T>(inner: Schema<T>): Schema<Tristate<T>> {
  // Frozen for the same reason `jsonSerde()`'s bundle is (SERDE-29): a schema is shared across
  // every concurrent decode that names it, so it must be stateless AND unable to acquire state.
  return Object.freeze({
    parse(input: unknown): Tristate<T> {
      if (input === MISSING || input === undefined) return absent();
      if (input === null) return nullValue();
      const value = inner.parse(input);
      // The type system alone cannot hold SERDE-14's third state to non-null values: `present` takes
      // `NonNullable<T>`, but `T` here is whatever the caller's schema declares, so a schema that
      // NORMALIZES to null — a Zod `.transform()`, a "" → null cleanup — type-checks and produces
      // `{kind: 'present', value: null}`, the fourth state the union exists to forbid. Checked at
      // run time, and reported as a decode failure rather than an assertion: the input came off the
      // wire, and the pairing of that input with that schema is what has no Tristate (audit #67 /
      // #79). `undefined` is rejected with it — `NonNullable<T>` excludes both, and a Present of
      // `undefined` is Absent wearing the wrong label.
      if (value === null || value === undefined) {
        throw new DeserializationError(
          'a present Tristate cannot carry null or undefined; the inner schema resolved a wire value to one (SERDE-14)',
        );
      }
      // `as NonNullable<T>`: the nullish cases have all returned or thrown above, a fact the
      // compiler cannot derive through `inner.parse`'s unconstrained `T`.
      return present<T>(value);
    },
  });
}

/**
 * Build an object schema whose named fields decode as Tristate, feeding an internal sentinel for keys the
 * wire omitted (SERDE-17).
 *
 * Keys not named in `shape` pass through untouched **at runtime**, so this composes with a caller's
 * own schema for the rest of the DTO rather than replacing it. The returned *type* names only the
 * `shape` keys: an index signature would make every property access legal and typed `unknown`,
 * silently accepting a misspelled field name. A caller who needs the pass-through keys typed
 * intersects at their own call site, where the DTO's real shape is known.
 *
 * The input object is never mutated — the named fields are written onto a shallow copy.
 *
 * @param shape - a schema per Tristate-decoded field, keyed by wire name.
 * @returns a schema producing an object whose named keys are `Tristate`-wrapped.
 * @throws TypeError when the value being parsed is not a non-null object, or is an array.
 * @throws DeserializationError when a field's own schema resolves a present wire value to `null` or
 * `undefined`, which is {@link tristate}'s check applied per field (SERDE-14).
 * @public
 */
export function tristateObject<S extends Record<string, Schema<unknown>>>(
  shape: S,
): Schema<{
  [K in keyof S]: Tristate<S[K] extends Schema<infer T> ? T : never>;
}> {
  const fields = Object.entries(shape).map(
    ([key, inner]) => [key, tristate(inner)] as const,
  );
  // Frozen alongside `tristate()`'s result, and for the same reason (SERDE-29).
  return Object.freeze({
    parse(input: unknown) {
      // An array is `typeof 'object'` and non-null, so a bare object check let one through and
      // silently reshaped `[1,2,3]` into `{"0":1,"1":2,"2":3, ...}`. A JSON array arriving where a
      // DTO was expected is a shape mismatch, which SERDE-16 wants rejected rather than reshaped.
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new TypeError('tristateObject expects a non-array object');
      }
      // `as Record<string, unknown>`: the guard above established it is a non-null object;
      // TypeScript narrows to `object`, which is not indexable.
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {...source};
      for (const [key, schema] of fields) {
        // `Object.hasOwn`, never `key in source`: `in` walks the prototype chain, and `JSON.parse`
        // hands back objects rooted at `Object.prototype`. A field named after any of its eleven
        // members (`toString`, `constructor`, `valueOf`, `hasOwnProperty`, ...) then read as
        // PRESENT-of-a-native-function when the wire had omitted it, which SERDE-17 requires
        // resolve to Absent.
        const raw = Object.hasOwn(source, key) ? source[key] : MISSING;
        // `defineProperty`, never `out[key] = ...`: assignment to the key `__proto__` invokes
        // `Object.prototype`'s setter, which would replace the RESULT object's prototype with a
        // Tristate sentinel instead of writing a field. No global pollution either way — the
        // spread above already copies a wire-level `__proto__` as a plain own property — but the
        // returned DTO silently gained `kind`/`value` through the chain and lost the field.
        Object.defineProperty(out, key, {
          value: schema.parse(raw),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      // `as never`: the declared return is a mapped-plus-conditional type the compiler cannot see
      // this loop building key by key. The type-level test is what actually checks it — no runtime
      // test can.
      return out as never;
    },
  });
}
