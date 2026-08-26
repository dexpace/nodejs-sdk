// SPDX-License-Identifier: MIT
// packages/core/src/recovery/request-chain.ts
import type {Request} from '../http/request.js';

/**
 * One link of the request-preparation chain. Async like every other step type in this layer — Node
 * has a single execution model, so the phase does not mix sync and async step shapes.
 *
 * @internal
 */
export type RequestStep = (request: Request) => Promise<Request>;

/**
 * A sequential left-to-right fold over request steps (RECOV-3): the output of step N is the input
 * of step N+1, an empty chain returns its input unchanged, and a throwing step aborts the remainder
 * and propagates — `dispatchWithRecovery` (`orchestrator.ts`) converts that propagation into a
 * `Failure` per RECOV-2, which is the only reason propagating here is safe.
 *
 * Safe under concurrent `apply()` calls (RECOV-14): after construction the instance holds nothing
 * but its step array, and every piece of per-call state lives in `apply()`'s locals. A later phase
 * must not move per-call bookkeeping onto a field here.
 *
 * @internal
 */
export class RequestRecoveryChain {
  readonly #steps: readonly RequestStep[];

  /**
   * Defensively copies `steps` (RECOV-14). The reference implementation retains the caller's array
   * by reference on this chain only — an asymmetry the requirement's own text recommends a port not
   * reproduce.
   *
   * @param steps - the ordered request steps.
   */
  constructor(steps: readonly RequestStep[]) {
    this.#steps = [...steps];
  }

  /**
   * Folds the request through every step in order.
   *
   * @param request - the request to prepare.
   * @returns the request produced by the last step, or the input when the chain is empty.
   * @throws Whatever a step throws, aborting the remaining steps (RECOV-3).
   */
  async apply(request: Request): Promise<Request> {
    let current = request;
    for (const step of this.#steps) {
      current = await step(current);
    }
    return current;
  }
}
