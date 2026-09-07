// SPDX-License-Identifier: MIT
// packages/core/src/recovery/response-chain.ts
import type {Response} from '../http/response.js';
import {suppress} from '../suppress.js';
import {failure, success, type Outcome} from './outcome.js';

/**
 * One link of the response phase, run only while the outcome is a Success (RECOV-4).
 *
 * @public
 */
export type ResponseStep = (response: Response) => Promise<Response>;

/**
 * One link of the recovery phase, run on every outcome, success or failure (RECOV-5).
 *
 * A recovery step SHOULD return a `Failure` rather than throw (RECOV-9); both are handled
 * identically, so this is a convention rather than something the chain enforces.
 *
 * @public
 */
export type RecoveryStep = (
  outcome: Outcome<Response>,
) => Promise<Outcome<Response>>;

/**
 * The response and recovery step folds (RECOV-4 … RECOV-9, RECOV-12, RECOV-13).
 *
 * Response steps run first and only while the outcome is a Success, in declared order; a throwing
 * response step becomes a Failure fed to the recovery phase (RECOV-7) rather than propagating.
 * Recovery steps then run on whatever the outcome is by then, always, in declared order; a throwing
 * recovery step becomes a Failure fed to the NEXT recovery step (RECOV-8). `apply()` itself never
 * throws, for any input.
 *
 * A step that *returns* a substitute outcome is never auto-closed (RECOV-13) — only a caught throw
 * reaches this module's `toFailureClosingSuccess`. A transforming step owns releasing whatever it
 * drops.
 *
 * Safe under concurrent `apply()` calls (RECOV-14): after construction the instance holds nothing
 * but its two step arrays, and all per-call state lives in the phase methods' locals.
 *
 * @public
 */
export class ResponseRecoveryChain {
  readonly #responseSteps: readonly ResponseStep[];
  readonly #recoverySteps: readonly RecoveryStep[];

  /**
   * Defensively copies both lists (RECOV-14).
   *
   * @param responseSteps - steps run on a Success, in order.
   * @param recoverySteps - steps run on every outcome, in order.
   */
  constructor(
    responseSteps: readonly ResponseStep[],
    recoverySteps: readonly RecoveryStep[],
  ) {
    this.#responseSteps = [...responseSteps];
    this.#recoverySteps = [...recoverySteps];
  }

  /**
   * Folds `outcome` through the response phase and then the recovery phase (RECOV-6).
   *
   * @param outcome - the outcome produced by the transport, or by an earlier failure.
   * @returns the terminal outcome. Never throws (RECOV-8).
   */
  async apply(outcome: Outcome<Response>): Promise<Outcome<Response>> {
    const afterResponsePhase = await this.#runResponsePhase(outcome);
    return this.#runRecoveryPhase(afterResponsePhase);
  }

  async #runResponsePhase(
    outcome: Outcome<Response>,
  ): Promise<Outcome<Response>> {
    let current = outcome;
    for (const step of this.#responseSteps) {
      // RECOV-4: the whole response phase is skipped once the outcome is not a Success.
      if (current.kind !== 'success') break;
      try {
        current = success(await step(current.value));
      } catch (thrownError) {
        current = await toFailureClosingSuccess(thrownError, current); // RECOV-7, RECOV-12
        break; // the remaining response steps do not run once converted to a Failure
      }
    }
    return current;
  }

  async #runRecoveryPhase(
    outcome: Outcome<Response>,
  ): Promise<Outcome<Response>> {
    let current = outcome;
    for (const step of this.#recoverySteps) {
      try {
        // RECOV-13: a normal return substituting the outcome is never auto-closed.
        current = await step(current);
      } catch (thrownError) {
        current = await toFailureClosingSuccess(thrownError, current); // RECOV-8, RECOV-12
        // RECOV-8: the remaining recovery steps still run — deliberately no `break` here.
      }
    }
    return current;
  }
}

/**
 * Shared close-on-throw handling for both phases (RECOV-12): when the outcome held at the moment of
 * the throw was a Success, its response is released before the throwable is wrapped into a Failure,
 * exactly once.
 *
 * A close failure rides along as `suppressed` on the ORIGINAL throwable — built by hand through
 * {@link suppress}, original first — never via `using` / `await using`, whose auto-generated
 * `SuppressedError` puts the *teardown* failure first and would silently invert which error the
 * caller ends up seeing (`docs/knowledge/harvested/resource-management.md:72`).
 *
 * **This function is total: it never throws, for any argument.** RECOV-8 makes "`apply()` MUST NOT
 * throw under any input" absolute, and this runs inside both phases' `catch` blocks — the last place
 * a throwable could escape the chain. The discriminant read and the `close()` call are therefore
 * inside the same `try`, not just the `close()`: a step that lies about its return type (a JS caller,
 * or one returning `undefined`) can leave `current` holding something with no `kind` and no
 * `close()`, and reading through it would otherwise raise a `TypeError` out of `apply()`. Handling it
 * here rather than crashing is the same call `wrapCancellation` makes — a step is a pluggable seam,
 * so a step that misbehaves is an operational failure, not a violated precondition of this codebase.
 * The step's own throwable stays primary either way; the plumbing failure rides along as
 * `suppressed`.
 */
async function toFailureClosingSuccess(
  thrownError: unknown,
  current: Outcome<Response>,
): Promise<Outcome<Response>> {
  try {
    if (current.kind === 'success') {
      // Awaited, not fire-and-forget: `Response.close()` returns a promise, so an un-awaited call
      // would settle outside this try with nothing to catch its rejection.
      await current.value.close();
    }
  } catch (closeError) {
    return failure(
      suppress(
        thrownError,
        closeError,
        'response close failed while handling a step error',
      ),
    );
  }
  return failure(thrownError);
}
