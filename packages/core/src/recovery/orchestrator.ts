// SPDX-License-Identifier: MIT
// packages/core/src/recovery/orchestrator.ts
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {wrapCancellation} from './cancellation.js';
import {fold, success, type Outcome} from './outcome.js';
import type {RequestRecoveryChain} from './request-chain.js';
import type {ResponseRecoveryChain} from './response-chain.js';

/**
 * Everything {@link dispatchWithRecovery} needs beyond the request itself, bundled into one
 * trailing object. Five positional parameters would fail ESLint's `max-params: 3`.
 *
 * @internal
 */
export interface DispatchConfig {
  /** The terminal transport hop. */
  readonly transport: Transport;
  /** Run before the transport hop; its throwables become a Failure (RECOV-2). */
  readonly requestChain: RequestRecoveryChain;
  /** Run on the outcome, whatever it is (RECOV-4 … RECOV-8). */
  readonly responseChain: ResponseRecoveryChain;
  /** Per-call operational overrides, threaded to the transport unchanged. */
  readonly options?: RequestOptions | undefined;
  /** The caller's abort signal, threaded to the transport unchanged. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The unified recovery-chain orchestrator (RECOV-2, RECOV-10, RECOV-11).
 *
 * One `try`/`catch` wraps both the request chain's `apply()` and the transport invocation, so every
 * throwable from either is caught and converted into a Failure before the response chain runs — a
 * before-request throw cannot skip after-error handling. That conversion goes through
 * {@link wrapCancellation} (RECOV-11), this orchestrator's catch being its only call site; RECOV-2's
 * guarantee rests on that helper never throwing, since this catch clause is the last place a
 * throwable could escape without meeting the recovery hooks.
 *
 * The final unwrap returns the response on a Success, or rethrows the Failure's throwable
 * **unchanged** — no wrapping, no substitution (RECOV-10). Surfacing a typed exception is a
 * recovery step's own responsibility, never this function's.
 *
 * @param request - the request to prepare and send.
 * @param config - transport, chains, and the per-call options and signal.
 * @returns the response the terminal outcome carries.
 * @throws Whatever the terminal Failure carries, by identity — any value, not necessarily an
 * `Error`.
 *
 * @internal
 */
export async function dispatchWithRecovery(
  request: Request,
  config: DispatchConfig,
): Promise<Response> {
  let outcome: Outcome<Response>;
  try {
    const preparedRequest = await config.requestChain.apply(request);
    outcome = success(
      await config.transport.send(
        preparedRequest,
        config.options,
        config.signal,
      ),
    );
  } catch (error) {
    // RECOV-11: `Outcome<never>` widens to `Outcome<Response>` without a cast, and never throws,
    // which is what keeps RECOV-2 absolute.
    outcome = wrapCancellation(error);
  }
  const finalOutcome = await config.responseChain.apply(outcome);
  return fold(
    finalOutcome,
    response => response,
    error => {
      throw error;
    },
  );
}
