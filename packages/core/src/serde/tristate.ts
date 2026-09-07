// SPDX-License-Identifier: MIT
// packages/core/src/serde/tristate.ts

/**
 * Branding symbol. A wire codec recognizes a {@link Tristate} by this key rather than by structural
 * shape, so a caller DTO that happens to carry a `kind` field is never mistaken for one.
 *
 * Exported because `@dexpace/codec-json` — a *separate package* — needs it. That is also why
 * `@dexpace/codec-json` declares `@dexpace/core` as a `peerDependency`: two copies of core in one
 * dependency tree would mean two distinct symbols, and the codec would silently stop recognizing a
 * caller's Tristate values — emitting a key the caller asked to omit. `Symbol.for` resolves through
 * the cross-realm registry, so even two non-identical copies of core agree on this key.
 *
 * @public
 */
export const TRISTATE_BRAND: unique symbol = Symbol.for(
  '@dexpace/core.Tristate',
);

/**
 * The PATCH three-state type: a key missing from the wire, a key present with an explicit `null`, or
 * a key present with a value (SERDE-14).
 *
 * A discriminated union over frozen object literals, never a class hierarchy
 * (`styleguide/typescript/06` §6.4/§6.5) — the same pattern as `Body`'s `kind` union and
 * `Outcome<T>`.
 *
 * The illegal fourth state (Present of `null`) is unrepresentable *at the type level*, because
 * {@link present} takes `NonNullable<T>`. That is strictly earlier than a construction-time runtime
 * rejection.
 *
 * @public
 */
export type Tristate<T> =
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'absent'}
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'null'}
  | {
      readonly [TRISTATE_BRAND]: true;
      readonly kind: 'present';
      readonly value: T;
    };

const ABSENT = Object.freeze({[TRISTATE_BRAND]: true, kind: 'absent'} as const);
const NULL = Object.freeze({[TRISTATE_BRAND]: true, kind: 'null'} as const);

/**
 * The key was absent from the wire — a PATCH server reads this as "leave unchanged".
 *
 * @returns the shared Absent sentinel.
 * @public
 */
export function absent(): Tristate<never> {
  return ABSENT;
}

/**
 * The key was present with an explicit wire `null` — a PATCH server reads this as "clear".
 *
 * Named `nullValue`, not `null`, because `null` is a reserved word.
 *
 * @returns the shared Null sentinel.
 * @public
 */
export function nullValue(): Tristate<never> {
  return NULL;
}

/**
 * The key was present with a value. `value` cannot be `null` or `undefined` (SERDE-14).
 *
 * @param value - the non-nullish inner value.
 * @returns a frozen Present carrying `value`.
 * @public
 */
export function present<T>(value: NonNullable<T>): Tristate<T> {
  return Object.freeze({
    [TRISTATE_BRAND]: true,
    kind: 'present',
    value,
  } as const);
}

/**
 * Map a nullable value into a Tristate. Never yields Absent (SERDE-18) — a caller holding a
 * `T | null` has by definition observed the field, so "missing" is not one of the outcomes available
 * to it.
 *
 * @param value - the nullable value to lift.
 * @returns Null for `null`/`undefined`, otherwise Present.
 * @public
 */
export function ofNullable<T>(value: T | null | undefined): Tristate<T> {
  return value === null || value === undefined ? NULL : present<T>(value);
}

/**
 * The three branches {@link foldTristate} dispatches to.
 *
 * @public
 */
export interface TristateBranches<T, R> {
  /** Called when the key was missing from the wire. */
  readonly onAbsent: () => R;
  /** Called when the key carried an explicit wire `null`. */
  readonly onNull: () => R;
  /** Called with the inner value when the key carried one. */
  readonly onPresent: (value: T) => R;
}

/**
 * Exhaustive three-way dispatch (SERDE-18).
 *
 * Named `foldTristate`, not `fold`, because `Outcome<T>` (Phase 4b) already owns a `fold` in this
 * codebase. Both land in the same public barrel eventually; two different `fold`s exported from one
 * entry point would be an ambiguity a caller has to resolve at every import site.
 *
 * The branches travel in one object rather than as three trailing parameters: positionally this is a
 * four-parameter function, and ESLint's `max-params: 3` counts them all. It also reads better —
 * three bare arrow arguments in a row are indistinguishable at the call site.
 *
 * @param tristate - the value to dispatch on.
 * @param branches - the three handlers.
 * @returns whatever the matching branch returned.
 * @public
 */
export function foldTristate<T, R>(
  tristate: Tristate<T>,
  branches: TristateBranches<T, R>,
): R {
  switch (tristate.kind) {
    case 'absent':
      return branches.onAbsent();
    case 'null':
      return branches.onNull();
    case 'present':
      return branches.onPresent(tristate.value);
  }
}

/**
 * Collapse both empty branches to `null` (SERDE-18). Lossy by design — use {@link foldTristate} to
 * distinguish them.
 *
 * @param tristate - the value to unwrap.
 * @returns the inner value, or `null` for Absent and Null alike.
 * @public
 */
export function valueOrNull<T>(tristate: Tristate<T>): T | null {
  return tristate.kind === 'present' ? tristate.value : null;
}

/**
 * True when the key was missing from the wire — "leave unchanged" (SERDE-18).
 *
 * @param tristate - the value to test.
 * @returns whether it is Absent, narrowing on true.
 * @public
 */
export function isAbsent<T>(
  tristate: Tristate<T>,
): tristate is {readonly [TRISTATE_BRAND]: true; readonly kind: 'absent'} {
  return tristate.kind === 'absent';
}

/**
 * True when the key carried an explicit wire `null` — "clear" (SERDE-18).
 *
 * @param tristate - the value to test.
 * @returns whether it is Null, narrowing on true.
 * @public
 */
export function isNull<T>(
  tristate: Tristate<T>,
): tristate is {readonly [TRISTATE_BRAND]: true; readonly kind: 'null'} {
  return tristate.kind === 'null';
}

/**
 * True when the key carried a value, narrowing so `.value` is reachable without a second check
 * (SERDE-18).
 *
 * All three predicates narrow, so a caller can branch on any of them; they are not a mix of
 * narrowing and plain-boolean forms.
 *
 * @param tristate - the value to test.
 * @returns whether it is Present, narrowing on true.
 * @public
 */
export function isPresent<T>(tristate: Tristate<T>): tristate is {
  readonly [TRISTATE_BRAND]: true;
  readonly kind: 'present';
  readonly value: T;
} {
  return tristate.kind === 'present';
}

/**
 * True when `value` was produced by this module — the codec's recognition test (SERDE-15/SERDE-19).
 *
 * @param value - any candidate value, typically a key encountered mid-serialization.
 * @returns whether it carries this module's brand.
 * @public
 */
export function isTristate(value: unknown): value is Tristate<unknown> {
  return typeof value === 'object' && value !== null && TRISTATE_BRAND in value;
}

/**
 * Stable, identity-free rendering for logs and assertions (SERDE-30).
 *
 * @param tristate - the value to render.
 * @returns `'Absent'`, `'Null'`, or `Present(` followed by the rendered value and `)`.
 * @public
 */
export function tristateToString<T>(tristate: Tristate<T>): string {
  return foldTristate(tristate, {
    onAbsent: () => 'Absent',
    onNull: () => 'Null',
    onPresent: value => `Present(${String(value)})`,
  });
}
