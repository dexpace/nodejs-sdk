// SPDX-License-Identifier: MIT
// packages/codec-json/src/tristate-replacer.ts
import {isTristate, type Tristate} from '@dexpace/core';

/**
 * Resolve through a chain of nested Presents to the Tristate that actually decides the wire form.
 *
 * `present<T>(value: NonNullable<T>)` accepts a Tristate — one is a non-null object — so
 * `Tristate<Tristate<T>>` is a well-typed value the public API constructs happily, and
 * `tristate(tristate(inner))` produces one on the decode side. Without this walk the replacer
 * returns the *inner sentinel object*, and `JSON.stringify` then serializes that object's own
 * properties, putting `{"kind":"present","value":1}` — this SDK's internal discriminant — on the
 * wire. A replacer's return value is never fed back through the replacer, so one unwrap is not
 * enough; the walk has to run to the bottom.
 *
 * Module-private: both call sites (`degradeTopLevelTristate` and `tristateReplacer`) live in this
 * file, so exporting it would widen the module's surface for no consumer.
 *
 * @param value - the outermost Tristate.
 * @returns the innermost Tristate: never a Present whose value is itself a Tristate.
 */
function innermostTristate(value: Tristate<unknown>): Tristate<unknown> {
  let current = value;
  while (current.kind === 'present' && isTristate(current.value)) {
    current = current.value;
  }
  return current;
}

/**
 * The wire form of a Tristate in a position that cannot omit a key (SERDE-20).
 *
 * Used for the **top-level** value, which `jsonSerde()`'s serializer resolves before calling
 * `JSON.stringify` — see {@link tristateReplacer} for why that cannot happen inside the replacer.
 *
 * @param value - any top-level value; returned unchanged when it is not a Tristate.
 * @returns the inner value for Present, `null` for Absent and Null alike.
 *
 * @internal
 */
export function degradeTopLevelTristate(value: unknown): unknown {
  if (!isTristate(value)) return value;
  const resolved = innermostTristate(value);
  return resolved.kind === 'present' ? resolved.value : null;
}

/**
 * `JSON.stringify` replacer implementing PATCH three-state semantics (SERDE-15).
 *
 * Absent → the key is omitted entirely (a PATCH server reads that as "leave unchanged").
 * Null → the key is emitted with a wire `null` ("clear").
 * Present → the key is emitted with the inner value.
 *
 * Returning `undefined` from a replacer makes `JSON.stringify` drop the key — the exact mechanism
 * SERDE-15 needs, built into the language. SERDE-20's array half comes from the same mechanism and
 * needs no code here: an **array element** cannot be dropped without shifting every index after it,
 * so `JSON.stringify` itself emits `null` for an element whose replacer returned `undefined`. This
 * function therefore treats every non-top-level position identically.
 *
 * **This replacer does not handle the top-level position, and cannot.** `JSON.stringify` invokes a
 * replacer for the top-level value with `key === ''`, but so does an ordinary object key that is
 * literally the empty string — `{"": absent()}` is legal JSON at any depth, and the two cases are
 * indistinguishable from `(key, value)` alone. Testing `key === ''` would emit a wire `null` for a
 * `""` key that SERDE-15 requires be omitted, silently turning "leave unchanged" into "clear".
 * `jsonSerde()` resolves a top-level Tristate *before* calling `JSON.stringify`, via this module's
 * `degradeTopLevelTristate`, which is the one place that can tell the two apart.
 *
 * The consequence for a caller composing their own `JSON.stringify(value, tristateReplacer)` call:
 * a **top-level** Tristate is not degraded here and `JSON.stringify` returns `undefined` for a
 * top-level Absent. Nested and array-element positions behave exactly as documented above. Route
 * through `jsonSerde()`'s serializer if the top-level case matters.
 *
 * Installed by `jsonSerde()` by default (SERDE-19).
 *
 * @param key - the key being serialized; unused, because every position this function sees takes the
 * same decision — see the top-level note above.
 * @param value - the value at that key, before encoding.
 * @returns the value to encode, or `undefined` to omit the key.
 * @public
 */
export function tristateReplacer(key: string, value: unknown): unknown {
  if (!isTristate(value)) return value;

  const resolved = innermostTristate(value);
  if (resolved.kind === 'present') return resolved.value;

  // Absent means "omit the key", which is SERDE-15's central interop invariant. In an array position
  // `JSON.stringify` renders the dropped element as `null` on its own, which is where SERDE-20's
  // array-element degradation actually comes from — no branch here produces it.
  return resolved.kind === 'absent' ? undefined : null;
}
