// SPDX-License-Identifier: MIT
// packages/core/src/retry/retry-step.ts
import {defaultClock, type Clock} from '../config/clock.js';
import {invariant} from '../invariant.js';
import type {Next, StepContext, StepDescriptor} from '../pipeline/step.js';
import {failure, fold, success} from '../recovery/outcome.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';
import {retrySettings, type RetrySettings} from './settings.js';

/** Stable identity for pillar-slot occupancy and anchor matching (PIPE-6/PIPE-18). */
export const RETRY_STEP_TYPE: unique symbol = Symbol('dexpace.retry');

/**
 * Everything {@link retryStep} accepts. An options object rather than a bare `RetrySettings`: the
 * engine's two injected seams (`clock`, `random`) and RETRY-39's caller delay-override all have to
 * reach `RetryConfig`, and a no-argument `retryStep()` must stay the default-tuned pillar step
 * (RETRY-12).
 *
 * @public
 */
export interface RetryStepOptions {
  /**
   * Policy overrides. Any omitted field takes its spec default (RETRY-12).
   *
   * @defaultValue the spec defaults `retrySettings()` supplies
   */
  readonly settings?: Partial<RetrySettings> | undefined;
  /**
   * The wall-clock and sleep seam, injected so backoff is testable without real time. The same
   * instance also satisfies `AuthStepSettings.clock`, so one `Clock` drives every pillar in a
   * pipeline (CFG-15..CFG-18).
   *
   * @defaultValue a `Clock` over `Date.now`, `performance.now`, and a cancellable `setTimeout`
   */
  readonly clock?: Clock | undefined;
  /**
   * The randomness seam jitter draws from, in `[0, 1)`. Injected so a jittered schedule is
   * assertable (RETRY-10).
   *
   * @defaultValue `Math.random`
   */
  readonly random?: (() => number) | undefined;
  /**
   * RETRY-39's caller override: returns the delay in milliseconds to use for `attempt`, or
   * `undefined` to fall through to the configured schedule for that attempt.
   *
   * @defaultValue absent, so every attempt uses the configured schedule
   */
  readonly delayOverride?:
    ((attempt: number) => number | undefined) | undefined;
}

/** Each attempt drives a FRESH one-shot continuation -- RETRY-44's per-attempt state, PIPE-15's fork. */
function attemptVia(fork: () => Next): RetryDispatch {
  return async request => {
    try {
      return success(await fork()(request));
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * RETRY-41/HTTP-35: the per-call `RequestOptions.maxRetries` override wins over the configured budget
 * when present. The option counts retries; `maxAttempts` counts total sends, hence the `+ 1`.
 *
 * The value IS revalidated here, and the two guards now agree. `RequestOptionsBuilder.maxRetries`
 * rejects a negative, fractional or non-finite value at the call site that supplied it
 * (`../http/request-options.ts:212-219`, pinned by `request-options.test.ts`'s
 * `maxRetries validation (HTTP-35)` block), so this `invariant` is the engine asserting its own
 * precondition rather than the only thing enforcing it -- it should be unreachable, and tripping it
 * means the builder's guard was weakened. That was not true when this comment was first written: the
 * builder then rejected only a negative value, which was strictly weaker than the
 * `Number.isFinite(...) && >= 1` guard `retrySettings()` applies to the configured budget. The
 * assertion stays either way, because `Infinity` or `NaN` reaching `maxAttempts` makes the engine's
 * `attempt >= maxAttempts` gate permanently false and the retry loop unbounded, and the per-call
 * route must not be the one path into the engine that skips the check the configured route enforces.
 *
 * The derived object is frozen: a spread of a frozen source is NOT itself frozen, and RETRY-42
 * requires every policy component to be immutable after construction, not merely typed `readonly`.
 */
function effectiveSettings(
  base: RetrySettings,
  perCallMaxRetries: number | undefined,
): RetrySettings {
  if (perCallMaxRetries === undefined) return base;
  invariant(
    Number.isInteger(perCallMaxRetries) && perCallMaxRetries >= 0,
    `RequestOptions.maxRetries must be a non-negative integer, got ${String(perCallMaxRetries)}`,
  );
  return Object.freeze({...base, maxAttempts: perCallMaxRetries + 1});
}

function configFrom(
  base: RetryConfig,
  ctx: Pick<StepContext, 'signal' | 'options'>,
): RetryConfig {
  return {
    ...base,
    settings: effectiveSettings(base.settings, ctx.options?.maxRetries),
    signal: ctx.signal,
  };
}

/**
 * The RETRY pillar step.
 *
 * `stage: 'RETRY'` is baked into the descriptor this factory returns, which is how PIPE-36 ("a shipped
 * pillar family must not be relocatable out of its pillar") is satisfied structurally: steps are
 * functions carrying a descriptor, not classes with a subclassable stage assignment.
 *
 * `ctx.fork` is asserted rather than checked -- RETRY is in `PILLAR_STAGES`, so its absence means the
 * descriptor was installed somewhere it cannot be, which is a programmer error.
 *
 * **What it throws when it gives up is the FINAL attempt's own error, unwrapped.** The class you
 * catch does not depend on how many attempts ran: a transport failure surfaces as
 * `TransportFailureError` whether `maxAttempts` was 1 or 3, and an abort that ended a backoff wait
 * surfaces as `CancellationError` (`XCUT-1`). The earlier attempts' errors are not lost -- read them
 * with `retryAttempts(caught)`, oldest first (`RETRY-34`). A response the loop discards is always
 * closed first; the response that ENDS the loop is returned live and unread, and closing it is
 * yours.
 *
 * @param options - settings overrides and the injected clock, randomness, and delay override.
 * @returns the descriptor to install in a pipeline's RETRY slot.
 *
 * @public
 */
export function retryStep(options: RetryStepOptions = {}): StepDescriptor {
  // Built ONCE per installed step, not per request: `retrySettings()` validates every field and
  // takes a defensive copy of the retryable-status set, which is ~110 entries at the default. Only
  // the per-call `maxRetries` override and the call's signal are genuinely per-request, and
  // `configFrom` derives just those (RETRY-42: the policy is immutable and stateless after
  // construction, so one instance is safe to share across concurrent calls).
  const base: RetryConfig = {
    settings: retrySettings(options.settings),
    clock: options.clock ?? defaultClock,
    random: options.random ?? ((): number => Math.random()),
    delayOverride: options.delayOverride,
  };
  return {
    type: RETRY_STEP_TYPE,
    stage: 'RETRY',
    fn: async (request, ctx) => {
      const {fork} = ctx;
      invariant(
        fork !== undefined,
        'retryStep must occupy the RETRY pillar stage',
      );
      const outcome = await runWithRetry(
        request,
        attemptVia(fork),
        configFrom(base, ctx),
      );
      return fold(
        outcome,
        response => response,
        error => {
          throw error;
        },
      );
    },
  };
}
