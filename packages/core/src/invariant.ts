// SPDX-License-Identifier: MIT
// packages/core/src/invariant.ts

/**
 * Thrown by {@link invariant} when a broken precondition or postcondition is detected.
 *
 * Its own class distinguishes a programmer error — a violated invariant — from an operational
 * failure a caller might recover from (styleguide 5.6, 8.7).
 *
 * @internal
 */
export class InvariantViolation extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'InvariantViolation';
  }
}

/**
 * The project's single sanctioned assertion primitive (styleguide 5.6).
 *
 * A TypeScript assertion function: after `invariant(x !== undefined, msg)`, `x` narrows to exclude
 * `undefined` for the rest of the scope. Used for preconditions and postconditions — broken
 * invariants, never operational failures a caller might recover from, which go through the typed
 * error tree instead.
 *
 * @internal
 */
export function invariant(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new InvariantViolation(msg);
}

/**
 * Closes an exhaustive discriminated-union `switch`'s `default` case
 * (`docs/knowledge/data-modeling.md`). If a new union variant is ever added without a matching
 * `case`, the call stops type-checking; if one reaches this at runtime anyway — a value crossing a
 * seam that the type says cannot exist — it crashes loudly rather than falling through silently.
 *
 * @internal
 */
export function assertNever(value: never, message?: string): never {
  throw new InvariantViolation(
    message ?? `unreachable case: ${describe(value)}`,
  );
}

/**
 * `String(value)` is not total: it throws on a null-prototype object (no `toString` to reach) and
 * on any value whose `toString`/`Symbol.toPrimitive` throws — the same hazard
 * `docs/knowledge/error-handling.md:18` makes `toError` guard. An assertion helper that throws from
 * its own message construction reports the wrong failure at the worst moment, so the fallback is a
 * fixed string.
 */
function describe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return 'an unstringifiable value';
  }
}
