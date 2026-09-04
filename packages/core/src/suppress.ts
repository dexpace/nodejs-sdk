// SPDX-License-Identifier: MIT
// packages/core/src/suppress.ts

/**
 * The shape of an error carrying a suppressed secondary throwable — structurally identical to the
 * ECMAScript `SuppressedError` this module produces when the runtime has one.
 *
 * @public
 */
export interface SuppressedErrorLike extends Error {
  /** The primary throwable — the one the caller actually cares about. */
  readonly error: unknown;
  /** The secondary throwable raised while unwinding, riding along rather than masking. */
  readonly suppressed: unknown;
}

type SuppressedErrorConstructor = new (
  error: unknown,
  suppressed: unknown,
  message: string,
) => SuppressedErrorLike;

/**
 * Pairs a primary throwable with a secondary one raised while unwinding, keeping the **primary**
 * primary (RECOV-12).
 *
 * `SuppressedError` is a V8 global from the full Explicit Resource Management proposal, absent on
 * this package's declared floor (`engines.node >=20.3`, set by `AbortSignal.any()`) and absent from
 * the `lib` this package compiles against. Raising the floor to reach it would drop every Node 20
 * and 22 consumer for one error class, so the class is used when the runtime happens to provide it
 * and {@link FallbackSuppressedError} is built when it does not — the same guarded shape the
 * roadmap already sanctioned for `Symbol.asyncDispose`. The global is read per call, not captured at
 * module load, so the choice tracks the runtime rather than the import order.
 *
 * Both branches return the same observable shape, so no caller branches on which one it got, and no
 * caller may test `instanceof SuppressedError` — that would silently assert nothing on the floor.
 * CI covers both: the `lts/*` leg of the `test:node` matrix takes the native branch, the pinned
 * `20.3.0` leg takes the fallback.
 *
 * Never built via `using`/`await using`: native disposal constructs
 * `new SuppressedError(disposalError, originalError)`, making the *teardown* failure primary
 * (`docs/knowledge/harvested/resource-management.md:72`) — the inverse of what RECOV-12 requires.
 *
 * @param error - the primary throwable; stays primary.
 * @param suppressed - the secondary throwable raised while unwinding.
 * @param message - describes the unwinding that produced `suppressed`.
 * @returns an error carrying both, with `error` primary.
 *
 * @internal
 */
export function suppress(
  error: unknown,
  suppressed: unknown,
  message: string,
): SuppressedErrorLike {
  const {SuppressedError: native} = globalThis as typeof globalThis & {
    SuppressedError?: SuppressedErrorConstructor;
  };
  return typeof native === 'function'
    ? new native(error, suppressed, message)
    : new FallbackSuppressedError(error, suppressed, message);
}

/**
 * The stand-in {@link suppress} builds on runtimes without the native class. Mirrors its observable
 * shape — `name`, `error`, `suppressed` — so a caller never has to branch on which one it received.
 *
 * `name` is pinned to `'SuppressedError'` rather than following `docs/knowledge/harvested/error-handling.md`'s
 * `this.name = new.target.name`: the point of this class is to be indistinguishable from the native
 * one, and reporting `FallbackSuppressedError` in a stack trace would make the runtime the reader is
 * on part of the error's identity.
 *
 * Exported so its shape is unit-testable directly. The alternative — deleting
 * `globalThis.SuppressedError` inside a test to force the fallback branch — would not survive
 * parallel execution, which `docs/knowledge/harvested/testing.md:50` requires of every test.
 *
 * @internal
 */
export class FallbackSuppressedError
  extends Error
  implements SuppressedErrorLike
{
  override readonly name = 'SuppressedError';
  readonly error: unknown;
  readonly suppressed: unknown;

  constructor(error: unknown, suppressed: unknown, message: string) {
    super(message);
    this.error = error;
    this.suppressed = suppressed;
  }
}
