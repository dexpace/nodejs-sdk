// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-dispatch.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {
  dispatchWithRecovery,
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

function attemptVia(config: RetryDispatchConfig): RetryDispatch {
  return async request => {
    try {
      return success(await dispatchWithRecovery(request, config));
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * The recovery-chain entry point for retry (RECOV-17..RECOV-20).
 *
 * NOT a `RecoveryStep` -- a recovery step receives an outcome and has no way to re-dispatch. This
 * wraps 4b's orchestrator instead, mirroring its `(request, config)` shape, so each attempt re-runs
 * the ENTIRE recovery chain: request chain, transport, response chain. That is the recovery-side
 * mirror of what `ctx.fork()` does for the pillar step (RETRY-44).
 *
 * Shares `runWithRetry` with the pillar adapter, which is what makes RETRY-13/RETRY-14/RECOV-30's
 * "the two stacks must not drift" structural rather than a discipline.
 *
 * @param request - the request to prepare, send, and possibly re-send.
 * @param config - the recovery chains, transport, and retry policy.
 * @returns the response of the terminal successful attempt.
 * @throws Whatever the terminal Failure carries, with RETRY-34's suppressed trail attached.
 *
 * @internal
 */
export async function dispatchWithRetry(
  request: Request,
  config: RetryDispatchConfig,
): Promise<Response> {
  const outcome = await runWithRetry(request, attemptVia(config), config.retry);
  return fold(
    outcome,
    response => response,
    error => {
      throw error;
    },
  );
}
