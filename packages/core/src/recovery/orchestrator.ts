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
 * @public
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
 * {@link DispatchConfig} without the request chain: everything the phases BELOW that chain need.
 *
 * A retry loop drives {@link dispatchPrepared} through this, having already run the request chain
 * once above itself. Naming it as a subset rather than duplicating the fields keeps the two shapes
 * from drifting when `DispatchConfig` grows.
 *
 * @internal
 */
export type PreparedDispatchConfig = Omit<DispatchConfig, 'requestChain'>;

/**
 * The request chain, run ONCE per logical request, with RECOV-2's conversion already applied: a
 * throwing step becomes a Failure here rather than propagating, so no caller has to catch it. That
 * conversion goes through {@link wrapCancellation} (RECOV-11); RECOV-2's guarantee rests on that
 * helper never throwing, since this `catch` is the last place a request-chain throwable could
 * escape without meeting the recovery hooks.
 *
 * Split out of {@link dispatchWithRecovery} on 2026-09-05 so `retry/retry-dispatch.ts` can run this
 * half once for a whole logical request and repeat only the half below it per attempt. Before that
 * split every retry attempt re-ran the request chain, and `recovery/idempotency-key.ts` generated a
 * fresh key on each one — three attempts of one logical request reached the server as three
 * distinct idempotency keys, which is exactly what RECOV-32's key is bought to prevent.
 *
 * @param request - the request to prepare.
 * @param requestChain - the ordered request steps (RECOV-3).
 * @returns a Success carrying the prepared request, or a Failure carrying whatever a step threw.
 *   Never throws, for any input.
 *
 * @internal
 */
export async function prepareRequest(
  request: Request,
  requestChain: RequestRecoveryChain,
): Promise<Outcome<Request>> {
  try {
    return success(await requestChain.apply(request));
  } catch (error) {
    return wrapCancellation(error);
  }
}

/**
 * The transport hop, with RECOV-2's conversion applied to whatever it throws.
 *
 * A `prepared` that is already a Failure short-circuits it: the transport is not called, and the
 * failure is handed on for the response chain to see. Both branches widen `Outcome<Request>` and
 * `Outcome<never>` to `Outcome<Response>` without a cast, because the failure variant does not
 * mention the type parameter — and neither branch throws, which is what keeps RECOV-2 absolute.
 */
async function sendPrepared(
  prepared: Outcome<Request>,
  config: PreparedDispatchConfig,
): Promise<Outcome<Response>> {
  if (prepared.kind === 'failure') return prepared;
  try {
    return success(
      await config.transport.send(
        prepared.value,
        config.options,
        config.signal,
      ),
    );
  } catch (error) {
    return wrapCancellation(error);
  }
}

/**
 * Everything below the request chain — the transport hop, the response chain, and RECOV-10's
 * terminal unwrap. This is the part a retry loop repeats, once per wire send (RETRY-44's
 * "downstream chain").
 *
 * It takes {@link prepareRequest}'s outcome rather than a bare `Request` because a request-chain
 * failure still owes RECOV-2 a trip through the response and recovery chains before it surfaces.
 * On that input the transport is not called at all, which is the whole difference between the two
 * variants.
 *
 * @param prepared - {@link prepareRequest}'s result for this logical request.
 * @param config - transport, response chain, and the per-call options and signal.
 * @returns the response the terminal outcome carries.
 * @throws Whatever the terminal Failure carries, by identity — any value, not necessarily an
 * `Error`.
 *
 * @internal
 */
export async function dispatchPrepared(
  prepared: Outcome<Request>,
  config: PreparedDispatchConfig,
): Promise<Response> {
  const finalOutcome = await config.responseChain.apply(
    await sendPrepared(prepared, config),
  );
  return fold(
    finalOutcome,
    response => response,
    error => {
      throw error;
    },
  );
}

/**
 * The unified recovery-chain orchestrator (RECOV-2, RECOV-10, RECOV-11).
 *
 * The two halves it composes are named: `prepareRequest` runs the request chain, and
 * `dispatchPrepared` runs the transport hop and the response chain. Neither is exported from the
 * package, so both are backticked rather than `{@link}`ed — api-extractor cannot resolve a
 * reference out of the published surface into one, and the unresolved link is an error, not a
 * warning to live with. Every throwable from either half is caught and converted into a Failure
 * before the response chain runs — a before-request throw cannot skip after-error handling.
 *
 * The final unwrap returns the response on a Success, or rethrows the Failure's throwable
 * **unchanged** — no wrapping, no substitution (RECOV-10). Surfacing a typed exception is a
 * recovery step's own responsibility, never this function's.
 *
 * **One dispatch is one wire send.** Nothing here retries; a caller that wants retries composes the
 * two halves itself so that the request chain runs once and only the second half repeats
 * (`retry/retry-dispatch.ts`).
 *
 * @param request - the request to prepare and send.
 * @param config - transport, chains, and the per-call options and signal.
 * @returns the response the terminal outcome carries.
 * @throws Whatever the terminal Failure carries, by identity — any value, not necessarily an
 * `Error`.
 *
 * @public
 */
export async function dispatchWithRecovery(
  request: Request,
  config: DispatchConfig,
): Promise<Response> {
  return dispatchPrepared(
    await prepareRequest(request, config.requestChain),
    config,
  );
}
