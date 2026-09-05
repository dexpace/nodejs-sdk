// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-dispatch.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {
  dispatchPrepared,
  prepareRequest,
  type DispatchConfig,
} from '../recovery/orchestrator.js';
import {failure, fold, success} from '../recovery/outcome.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';

/**
 * 4b's `DispatchConfig` plus the retry policy the wrapper drives it with.
 *
 * @internal
 */
export interface RetryDispatchConfig extends DispatchConfig {
  readonly retry: RetryConfig;
}

/**
 * One attempt: the transport hop and the response chain over the ALREADY-prepared request the
 * engine handed back from `stampAttempt`. The request chain is deliberately not in here — see
 * {@link dispatchWithRetry}.
 */
function attemptVia(config: RetryDispatchConfig): RetryDispatch {
  return async request => {
    try {
      return success(await dispatchPrepared(success(request), config));
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * The recovery-chain entry point for retry (RECOV-17..RECOV-20).
 *
 * NOT a `RecoveryStep` -- a recovery step receives an outcome and has no way to re-dispatch. This
 * composes 4b's orchestrator halves instead, mirroring its `(request, config)` shape.
 *
 * **The request chain runs ONCE, above the loop; each attempt repeats only what is below it** --
 * the transport hop and the response chain, over `stampAttempt`'s fresh copy of the one prepared
 * request. That is the layering `recovery/idempotency-key.ts` documents and RECOV-32 needs: its
 * `generate()` is invoked once per logical request, so all N attempts reach the server under one
 * key, and RETRY-38's per-attempt ordinal is written on the copy without disturbing it. Until
 * 2026-09-05 this function re-ran the whole recovery chain per attempt and three attempts produced
 * three different keys, defeating the header's entire purpose (audit #67, issue #73).
 *
 * RETRY-44 is satisfied, not traded away. Its "downstream chain" is whatever sits below the retry
 * point, which here is transport plus response chain, and that is re-executed with fresh
 * per-attempt state every time. Its second clause -- upstream steps MUST NOT mutate the shared
 * in-flight request between attempts -- holds by construction now, because upstream steps no longer
 * run between attempts at all.
 *
 * A request-chain failure is NOT retried: it never reached the wire, so RETRY-5's re-send gate has
 * nothing to judge and re-running the step that just threw would only throw again. It still passes
 * through the response and recovery chains exactly once, so RECOV-2's "no throwable bypasses the
 * recovery hooks" and RECOV-10's unwrap are unchanged.
 *
 * One consequence worth naming: the engine's re-send gate (RETRY-5/RECOV-18, `isResendable`) now
 * reads the PREPARED request rather than the caller's, so a request step that swaps in a
 * non-replayable body makes the call non-retryable -- which is the honest answer, since the
 * prepared request is what a retry would have to re-send.
 *
 * Shares `runWithRetry` with the pillar adapter, which is what makes RETRY-13/RETRY-14/RECOV-30's
 * "the two stacks must not drift" structural rather than a discipline.
 *
 * @param request - the request to prepare, send, and possibly re-send.
 * @param config - the recovery chains, transport, and retry policy.
 * @returns the response of the terminal successful attempt.
 * @throws Whatever the FINAL attempt failed with, unwrapped -- the same class a single-attempt run
 *   would have thrown. RETRY-34's earlier attempts are recorded beside it and read back through
 *   `retryAttempts()`. A request-chain throwable surfaces the same way, with no trail.
 *
 * @internal
 */
export async function dispatchWithRetry(
  request: Request,
  config: RetryDispatchConfig,
): Promise<Response> {
  const prepared = await prepareRequest(request, config.requestChain);
  if (prepared.kind === 'failure') return dispatchPrepared(prepared, config);
  const outcome = await runWithRetry(
    prepared.value,
    attemptVia(config),
    config.retry,
  );
  return fold(
    outcome,
    response => response,
    error => {
      throw error;
    },
  );
}
