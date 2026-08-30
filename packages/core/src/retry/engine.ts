// SPDX-License-Identifier: MIT
// packages/core/src/retry/engine.ts
import {HttpStatusError, toHttpError} from '../body/http-status-error.js';
import {invariant} from '../invariant.js';
import type {Clock} from '../config/clock.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {failure, type Outcome} from '../recovery/outcome.js';
import {releaseQuietly, withReleaseFailure} from '../recovery/release.js';
import {suppress} from '../suppress.js';
import {stampAttempt} from './attempt-stamp.js';
import {computeDelay} from './backoff.js';
import {isResendable, isRetryableFailure} from './classify.js';
import {parsePacingHint} from './pacing.js';
import type {RetrySettings} from './settings.js';
import {getGlobalLogger} from '../observability/logger.js';

// Structured logging events (http.retry.attemptFailed, http.retry.exhausted, http.retry.delayOverrideFailed)
// are emitted through the global logger facade (OBS-39, RETRY-40).

/**
 * One attempt: dispatch the (possibly stamped) request and report the outcome without throwing.
 *
 * @internal
 */
export type RetryDispatch = (
  request: Request,
  attempt: number,
) => Promise<Outcome<Response>>;

/**
 * Everything {@link runWithRetry} needs beyond the request and the dispatch callback, bundled into
 * one trailing object so the function stays at ESLint's three-parameter ceiling.
 *
 * @internal
 */
export interface RetryConfig {
  readonly settings: RetrySettings;
  readonly signal?: AbortSignal | undefined;
  /**
   * Phase 7a's `Clock` seam (CFG-15). `clock.monotonic()` measures the total-timeout budget (CFG-16:
   * elapsed-time math never uses wall-clock, which MAY move backwards); `clock.now()` supplies
   * `parsePacingHint`'s wall-clock instant, since a `Retry-After` HTTP-date is an absolute instant,
   * not an elapsed duration. Never `Date.now()` directly.
   */
  readonly clock: Clock;
  /** Injectable randomness -- jitter and the X-RateLimit-Reset spread both draw from it. */
  readonly random: () => number;
  /** Highest-precedence delay source (RETRY-39). A throw is non-fatal (RETRY-40). */
  readonly delayOverride?:
    ((attempt: number) => number | undefined) | undefined;
}

interface LoopState {
  readonly config: RetryConfig;
  readonly request: Request;
  readonly attempt: number;
  readonly startedAt: number;
}

type Decision =
  | {readonly kind: 'stop'; readonly outcome: Outcome<Response>}
  | {readonly kind: 'retry'; readonly error: unknown; readonly delayMs: number};

function elapsed(state: LoopState): number {
  return state.config.clock.monotonic() - state.startedAt;
}

/** A budget of `undefined` or `0` disables the deadline (RETRY-27, RECOV-20). */
function budgetExhausted(state: LoopState): boolean {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return false;
  return elapsed(state) >= budget;
}

/**
 * RETRY-27's separate belt-and-braces clause ("the computed delay is additionally clamped so it
 * cannot overshoot the budget"). Deliberately defensive: {@link overshootsBudget} runs first on the
 * same delay and stops the loop unless `delay <= budget - elapsed`, so this `Math.min` narrows
 * nothing except across the clock drift between the two `elapsed()` reads. It ships because the
 * requirement lists it separately from the abort, not because a test can drive it.
 */
function clampToBudget(delayMs: number, state: LoopState): number {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return delayMs;
  return Math.max(0, Math.min(delayMs, budget - elapsed(state)));
}

/**
 * RETRY-27/RECOV-20's third abort condition: a delay that would push cumulative elapsed time PAST
 * the budget is SUPPRESSED and the last failure surfaced, not merely shortened. The clamp above is
 * the requirement's separate belt-and-braces clause, not a substitute for this check -- without it
 * the loop would sleep out the remainder of the budget and then dispatch one more attempt with
 * nothing left.
 */
function overshootsBudget(delayMs: number, state: LoopState): boolean {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return false;
  return elapsed(state) + delayMs > budget;
}

/**
 * RETRY-40: a throwing user override is ignored, never fatal. Emits http.retry.delayOverrideFailed at warning level.
 */
function callerOverride(state: LoopState): number | undefined {
  const {delayOverride} = state.config;
  if (delayOverride === undefined) return undefined;
  try {
    return delayOverride(state.attempt);
  } catch (error) {
    try {
      getGlobalLogger()
        .atLevel('warning')
        .event('http.retry.delayOverrideFailed')
        .cause(error)
        .emit();
    } catch {
      // OBS-20: logger failure must never fail the request or retry loop
    }
    return undefined;
  }
}

/** RETRY-39: caller override -> server pacing hint -> fixed delay -> exponential backoff. */
function resolveDelay(hint: number | null, state: LoopState): number {
  const override = callerOverride(state);
  if (override !== undefined) return override;
  // RETRY-20/RECOV-22: a hint REPLACES the schedule for this one decision and receives no additional
  // symmetric jitter.
  if (hint !== null) return hint;
  return computeDelay(
    state.attempt,
    state.config.settings,
    state.config.random,
  );
}

/**
 * Turns a response the loop is DISCARDING into the throwable its trail entry carries, buffering a
 * bounded copy of the body (RETRY-35/RECOV-16). Only ever called on a response that already failed
 * the gates -- a surviving response is returned live and untouched.
 */
async function retire(response: Response): Promise<unknown> {
  // toHttpError returns null for a sub-400 status, reachable only when a caller widens the
  // retryable set to include one. Fabricating an HttpStatusError there carries a status outside
  // BODY-31's 400-599 band -- a deliberate, narrow exception: the discarded response still owes
  // RETRY-34 a trail entry, and inventing a leaf error class for a caller-opted-in edge would
  // breach this phase's "no new error leaf classes" constraint for less benefit. The response is
  // NOT consumed on this path (BODY-31 hands it back intact), so the caller's `finally` closes it.
  return (
    (await toHttpError(response)) ??
    new HttpStatusError(response.status.code, undefined, undefined)
  );
}

/** What the schedule step decided, before the release outcome is folded in. */
interface Schedule {
  readonly error: unknown;
  readonly delayMs: number;
  readonly overshootsBudget: boolean;
}

/**
 * Reads the pacing hint off the STILL-OPEN response and resolves the delay.
 *
 * Ordering is load-bearing: `toHttpError` drains the body and drops the headers, so the hint must be
 * read first.
 */
async function scheduleFrom(
  outcome: Outcome<Response>,
  state: LoopState,
): Promise<Schedule> {
  // The exception path skips the header step, having no headers (RETRY-39).
  const hint =
    outcome.kind === 'success'
      ? parsePacingHint(
          outcome.value.headers,
          state.config.clock.now(),
          state.config.random,
        )
      : null;
  const error =
    outcome.kind === 'success' ? await retire(outcome.value) : outcome.error;
  const delayMs = resolveDelay(hint, state);
  // Tested BEFORE the clamp: the clamp would hide the overshoot it exists to report.
  return {
    error,
    overshootsBudget: overshootsBudget(delayMs, state),
    delayMs: clampToBudget(delayMs, state),
  };
}

/**
 * Retires the response the loop is discarding and schedules the wait, releasing the response on
 * every exit (RETRY-35's second clause) without ever letting the release outcome become primary.
 *
 * The budget-overshoot abort lands HERE rather than in `decideRetry`'s gate block because the delay
 * it tests is not known until the pacing hint has been read off the live response. By that point the
 * response is already retired, so RETRY-27's "surface the last failure unchanged" surfaces the
 * retired `HttpStatusError` as a Failure -- never a live response, which is what the gates above
 * return.
 */
async function retireAndSchedule(
  outcome: Outcome<Response>,
  state: LoopState,
): Promise<Decision> {
  const response = outcome.kind === 'success' ? outcome.value : undefined;
  let schedule: Schedule;
  try {
    schedule = await scheduleFrom(outcome, state);
  } catch (error) {
    throw withReleaseFailure(error, await releaseQuietly(response));
  }
  const error = withReleaseFailure(
    schedule.error,
    await releaseQuietly(response),
  );
  return schedule.overshootsBudget
    ? {kind: 'stop', outcome: failure(error)}
    : {kind: 'retry', error, delayMs: schedule.delayMs};
}

function isRetryableOutcome(
  outcome: Outcome<Response>,
  settings: RetrySettings,
): boolean {
  return outcome.kind === 'success'
    ? settings.retryableStatuses.has(outcome.value.status.code)
    : isRetryableFailure(outcome.error, settings.retryableStatuses);
}

async function decideRetry(
  outcome: Outcome<Response>,
  state: LoopState,
): Promise<Decision> {
  const {settings} = state.config;
  // RETRY-8: BOTH axes must hold. Gates run BEFORE any remap so a surviving response stays live.
  if (!isRetryableOutcome(outcome, settings)) return {kind: 'stop', outcome};
  if (!isResendable(state.request)) return {kind: 'stop', outcome};
  if (state.attempt >= settings.maxAttempts) return {kind: 'stop', outcome};
  if (budgetExhausted(state)) return {kind: 'stop', outcome};
  return retireAndSchedule(outcome, state);
}

/**
 * RETRY-34: prior failures ride along as `suppressed` on the surfaced error; the surfaced instance
 * itself is skipped, so a reused throwable cannot suppress itself. On success the trail is discarded
 * whole.
 *
 * The suppressed pair is a binary shape, so N entries fold into a nested chain. Built through Phase
 * 4b's `suppress()` helper rather than `new SuppressedError(...)`: the native class reached Node only
 * in 24.0.0 and this package's floor is `>=20.3`, so the direct form neither type-checks nor runs
 * there. Argument order is controlled explicitly -- native `using` disposal builds the pair the other
 * way round, making the *later* error primary.
 */
function withTrail(
  outcome: Outcome<Response>,
  trail: readonly unknown[],
): Outcome<Response> {
  if (outcome.kind === 'success') return outcome;
  const prior = trail.filter(entry => entry !== outcome.error);
  if (prior.length === 0) return outcome;
  const folded = prior.reduce((accumulated, entry) =>
    suppress(entry, accumulated, 'earlier retry attempt failed'),
  );
  return failure(suppress(outcome.error, folded, 'retry attempts exhausted'));
}

/**
 * RETRY-26/31: the cancellable inter-attempt wait.
 *
 * Delegates to Phase 7a's `Clock.sleep` (CFG-17) rather than hand-rolling a second
 * `setTimeout`-plus-abort-listener: `sleep` already races the timer against the signal, clears the
 * timer on both exits (RETRY-45's scheduler hygiene, which has no scheduler object to own in this
 * port), and rejects promptly for a signal that aborted earlier. Duplicating it here would be the
 * same second-implementation the Phase 7a retrofit removed for the RFC 1123 parser and the
 * retryable-status set, and it would put the wait outside the injected seam -- forcing real timers
 * into a unit suite `docs/knowledge/harvested/testing.md` requires to be deterministic.
 *
 * A non-positive delay short-circuits before `sleep` is reached: it continues inline with no timer
 * (RETRY-31), which is reachable after RETRY-17's past-instant hint and after the budget clamp, and
 * it is also what keeps a caller `delayOverride` returning a negative number out of `sleep`'s
 * negative-duration rejection (RETRY-40 makes a bad override non-fatal).
 *
 * Cancellation RESOLVES here rather than propagating: RETRY-26 wants the loop's next iteration to
 * observe the signal and stop through its own RETRY-32 path, so the abort rejection is the one
 * expected failure and is deliberately absorbed. Any other rejection is re-thrown.
 */
async function waitFor(delayMs: number, config: RetryConfig): Promise<void> {
  if (delayMs <= 0) return;
  try {
    await config.clock.sleep(delayMs, config.signal);
  } catch (error) {
    // The only tolerable rejection is the abort reason CFG-17 rejects with; anything else (a
    // misbehaving injected clock) must not be swallowed into a silent extra attempt.
    if (config.signal?.aborted !== true) throw error;
  }
}

/** One attempt: stamp, dispatch, and decide. Extracted so the loop can wrap it in a single catch. */
async function runAttempt(
  dispatch: RetryDispatch,
  state: LoopState,
): Promise<Decision> {
  const stamped = stampAttempt(
    state.request,
    state.attempt,
    state.config.settings.attemptHeaderName,
  );
  return decideRetry(await dispatch(stamped, state.attempt), state);
}

function maybeEmitExhausted(
  outcome: Outcome<Response>,
  trailLength: number,
  state: LoopState,
): void {
  if (outcome.kind === 'failure' && trailLength > 0) {
    try {
      const elapsedMs = state.config.clock.monotonic() - state.startedAt;
      getGlobalLogger()
        .atLevel('info')
        .event('http.retry.exhausted')
        .field('attempts', state.attempt)
        .field('elapsed_ms', elapsedMs)
        .emit();
    } catch {
      // OBS-20: logger failure must never fail the request
    }
  }
}

/**
 * The one retry loop (RETRY-13/RETRY-14, RECOV-30). Both entry points -- the RETRY pillar step and
 * the recovery-chain wrapper -- call this, so the schedule, the classifier, and the budget cannot
 * drift.
 *
 * Every piece of per-call state is a local (RETRY-42/RECOV-28): concurrent invocations sharing one
 * `RetryConfig` cannot clobber each other's attempt count or start instant.
 *
 * RETRY-30's trampoline requirement is satisfied by the language: an `await` loop is already
 * iterative, so N retries build no continuation chain and no stack growth. RETRY-33's "every
 * terminal path returns an Outcome" is honored literally -- an attempt that throws is folded into a
 * failure outcome carrying the trail, rather than left to surface as a bare rejected promise that
 * would drop RETRY-34's suppressed attempts on the floor.
 *
 * @param request - the captured template every attempt re-sends.
 * @param dispatch - performs one attempt and reports its outcome without throwing.
 * @param config - settings, clock, randomness, signal, and the optional delay override.
 * @returns the terminal outcome, with RETRY-34's suppressed trail attached on failure.
 *
 * @internal
 */
export async function runWithRetry(
  request: Request,
  dispatch: RetryDispatch,
  config: RetryConfig,
): Promise<Outcome<Response>> {
  // The one precondition both adapters share. `retrySettings()` already enforces it on the
  // configured route and `retryStep` re-enforces it on the per-call override route, but this is the
  // single choke point every caller passes through -- and a non-finite budget does not fail loudly
  // on its own: it makes the `attempt >= maxAttempts` gate permanently false, so the loop simply
  // never stops. Asserted once per call, never per attempt.
  invariant(
    Number.isFinite(config.settings.maxAttempts) &&
      config.settings.maxAttempts >= 1,
    `retry maxAttempts must be a finite count >= 1, got ${String(config.settings.maxAttempts)}`,
  );
  const startedAt = config.clock.monotonic();
  const trail: unknown[] = [];

  for (let attempt = 1; ; attempt += 1) {
    // RETRY-32: once the caller has cancelled, launch no further attempt.
    if (config.signal?.aborted === true) {
      return withTrail(failure(config.signal.reason), trail);
    }

    try {
      const state: LoopState = {
        config,
        request,
        attempt,
        startedAt,
      };
      const decision = await runAttempt(dispatch, state);
      if (decision.kind === 'stop') {
        maybeEmitExhausted(decision.outcome, trail.length, state);
        return withTrail(decision.outcome, trail);
      }

      trail.push(decision.error);

      try {
        getGlobalLogger()
          .atLevel('info')
          .event('http.retry.attemptFailed')
          .field('attempt', attempt)
          .field('delay_ms', decision.delayMs)
          .cause(decision.error)
          .emit();
      } catch {
        // OBS-20: logger failure must never fail the request or abort retry loop
      }
      await waitFor(decision.delayMs, config);
    } catch (error) {
      // RETRY-33 literally, not merely as a rejected promise. Three things under here can throw --
      // `stampAttempt`'s header build, `toHttpError`'s body drain, and a misbehaving injected
      // clock's `sleep` -- and letting any of them escape would discard the whole suppressed trail
      // RETRY-34 requires the surfaced failure to carry.
      return withTrail(failure(error), trail);
    }
  }
}
