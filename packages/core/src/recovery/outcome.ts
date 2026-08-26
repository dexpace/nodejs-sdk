// SPDX-License-Identifier: MIT
// packages/core/src/recovery/outcome.ts
import {assertNever} from '../invariant.js';

/**
 * The recovery chain's closed two-variant outcome (RECOV-1): a success carrying a value, or a
 * failure carrying whatever was thrown.
 *
 * `error` is `unknown`, not `Error` — a JavaScript `throw` can legally raise any value, and this
 * type sits directly under a `catch`. The discriminated union is what RECOV-1's "derivable
 * accessors" buys in TypeScript: narrowing on `kind` is compiler-checked, so no `isSuccess()` /
 * `getOrThrow()` pair is shipped.
 *
 * @internal
 */
export type Outcome<T> =
  | {readonly kind: 'success'; readonly value: T}
  | {readonly kind: 'failure'; readonly error: unknown};

/**
 * Builds the success variant.
 *
 * @param value - the value carried by the outcome.
 * @returns a success outcome holding `value`.
 *
 * @internal
 */
export function success<T>(value: T): Outcome<T> {
  return {kind: 'success', value};
}

/**
 * Builds the failure variant.
 *
 * @param error - whatever was thrown; any value, not necessarily an `Error`.
 * @returns a failure outcome holding `error`.
 *
 * @internal
 */
export function failure<T>(error: unknown): Outcome<T> {
  return {kind: 'failure', error};
}

/**
 * Applies exactly one of `onSuccess` / `onFailure`, never both, satisfying RECOV-1's "a fold that
 * applies exactly one of two branches at most once per call."
 *
 * Three positional parameters rather than an options object: `max-params` errors at four, and this
 * matches Phase 2's already-shipped `Transport.send(request, options?, signal?)`. Recorded as a
 * corpus deviation in the phase design's ledger.
 *
 * @param outcome - the outcome to fold.
 * @param onSuccess - applied to the value of a success outcome.
 * @param onFailure - applied to the error of a failure outcome.
 * @returns whichever branch ran.
 *
 * @internal
 */
export function fold<T, R>(
  outcome: Outcome<T>,
  onSuccess: (value: T) => R,
  onFailure: (error: unknown) => R,
): R {
  switch (outcome.kind) {
    case 'success':
      return onSuccess(outcome.value);
    case 'failure':
      return onFailure(outcome.error);
    default:
      return assertNever(outcome);
  }
}
