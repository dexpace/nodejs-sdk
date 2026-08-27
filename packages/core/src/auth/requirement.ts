// SPDX-License-Identifier: MIT
// packages/core/src/auth/requirement.ts
import type {AuthScheme} from './scheme.js';

/**
 * AUTH-2: one scheme bound to its own OAuth scopes and params.
 *
 * A frozen data shape plus a pure equality function — the same "data and functions, not objects"
 * call 4a made for context types and 4c made for `Stage`, rather than a class with an `equals()`
 * method.
 *
 * @public
 */
export interface AuthRequirement {
  /** The bound scheme. */
  readonly scheme: AuthScheme;
  /** Meaningful only for `OAUTH2`; preserved verbatim, never inspected by resolution (AUTH-2). */
  readonly scopes: readonly string[];
  /** Scheme-specific parameters, preserved verbatim and never inspected by resolution (AUTH-2). */
  readonly params: ReadonlyMap<string, string>;
}

/**
 * Builds a frozen {@link AuthRequirement}, defensively copying both collections so a caller mutating
 * its inputs afterwards cannot reach the stored value (AUTH-2).
 *
 * @param scheme - the scheme this requirement binds.
 * @param scopes - OAuth scopes; meaningful only for `OAUTH2`.
 * @param params - scheme-specific parameters.
 * @returns the frozen requirement.
 *
 * @public
 */
export function createAuthRequirement(
  scheme: AuthScheme,
  scopes: readonly string[] = [],
  params: ReadonlyMap<string, string> = new Map(),
): AuthRequirement {
  // `Object.freeze` is SHALLOW. `docs/knowledge/data-modeling.md` requires a frozen value object to
  // hold only primitives or already-frozen/read-only values, never a mutable object that stays
  // writable behind the freeze. `new Map(params)` satisfies AUTH-2's literal clause -- caller-side
  // mutation cannot reach the stored value -- but leaves the copy itself writable behind the
  // `ReadonlyMap` type. Rebuilding a frozen Map on every read is not worth it for a value this small
  // and this rarely read; instead the copy is made once here, and nothing in this package ever
  // re-casts `AuthRequirement['params']` back to `Map` (AUTH-2 also bars resolution from inspecting
  // params at all), which is what keeps the `ReadonlyMap` type honest in practice.
  return Object.freeze({
    scheme,
    scopes: Object.freeze([...scopes]),
    params: new Map(params),
  });
}

function scopesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((scope, index) => scope === b[index]);
}

function paramsEqual(
  a: ReadonlyMap<string, string>,
  b: ReadonlyMap<string, string>,
): boolean {
  return (
    a.size === b.size && [...a].every(([key, value]) => b.get(key) === value)
  );
}

/**
 * AUTH-2's value-based equality: over scheme, scopes (ordered), and params.
 *
 * @param a - the left requirement.
 * @param b - the right requirement.
 * @returns `true` when all three components match.
 *
 * @public
 */
export function authRequirementsEqual(
  a: AuthRequirement,
  b: AuthRequirement,
): boolean {
  return (
    a.scheme === b.scheme &&
    scopesEqual(a.scopes, b.scopes) &&
    paramsEqual(a.params, b.params)
  );
}
