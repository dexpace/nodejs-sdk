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
