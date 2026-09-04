// SPDX-License-Identifier: MIT
// packages/core/src/redirect/redirect-step.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {releaseQuietly, withReleaseFailure} from '../recovery/release.js';
import {originOf} from './cross-origin.js';
import {
  decide,
  type Decision,
  type RedirectContext,
  type RedirectStopReason,
} from './decide.js';
import {redirectSettings, type RedirectSettings} from './settings.js';
import {getGlobalLogger} from '../observability/logger.js';
import {redactHeaderValue, redactUrl} from '../observability/redaction.js';

/** Stable identity for pillar-slot occupancy and anchor matching (PIPE-6/PIPE-18). @internal */
export const REDIRECT_STEP_TYPE: unique symbol = Symbol('dexpace.redirect');

/**
 * REDIR-22(b): if deciding or building the follow-up throws, the current response MUST be closed before
 * the error propagates. `decide()` is pure EXCEPT that it invokes `settings.predicate`, which is caller
 * code and may throw for reasons this step cannot enumerate; `Request`/`Headers` builder validation is a
 * second, thinner vector. A raw `decide()` call in the loop would let either escape with the hop's
 * response still open, leaking the body.
 *
 * The decision's error stays PRIMARY. `Response.close()` rethrows whatever cancelling the body raised
 * (everything but the `TypeError` a locked stream reports), so a bare `await response.close()` here
 * would replace the caller's own error with the teardown failure -- the inversion RECOV-12 forbids.
 * `releaseQuietly`/`withReleaseFailure` (4b's helpers, shared with the retry engine) keep the primary
 * primary and hang the release failure off it as `suppressed`.
 *
 * Beyond that the error is rethrown unchanged. Note the deliberate asymmetry with retry, where
 * RETRY-40 converts a throwing predicate into a typed illegal-state error: redirect's spec states no
 * such conversion, so a caller's own error passes through as its own.
 */
async function decideOrClose(
  response: Response,
  context: RedirectContext,
  settings: RedirectSettings,
): Promise<Decision> {
  try {
    return decide(response, context, settings);
  } catch (error) {
    throw withReleaseFailure(error, await releaseQuietly(response));
  }
}

/**
 * REDIR-28's loop-detected and malformed-Location events, the two that were blocked on `decide()`
 * carrying a reason (`docs/open-items.md` G3). Both fire alongside `http.redirect.rejected`, which
 * says only THAT the hop stopped.
 *
 * The malformed-Location event logs the header **raw**, unredacted -- REDIR-28's own carve-out:
 * the value failed to parse into a URL, so `redactUrl` has nothing to key off, and a port receiving
 * credential-bearing malformed Location values inherits that exposure knowingly.
 */
function emitStopReason(stop: {
  readonly reason: RedirectStopReason;
  readonly request: Request;
  readonly rawLocation: string | undefined;
}): void {
  try {
    const {reason, request, rawLocation} = stop;
    if (reason === 'loop-detected') {
      getGlobalLogger()
        .atLevel('warning')
        .event('http.redirect.loopDetected')
        .field('url.full', redactUrl(request.url))
        // The header, not the resolved target: the target is `decide`'s own and never leaves it,
        // and REDIR-27 lets the header be renamed, so 'location' names the POLICY to apply here.
        .field('location', redactHeaderValue('location', rawLocation ?? ''))
        .emit();
      return;
    }
    if (reason === 'malformed-location') {
      getGlobalLogger()
        .atLevel('warning')
        .event('http.redirect.malformedLocation')
        .field('url.full', redactUrl(request.url))
        .field('location.raw', rawLocation ?? '')
        .emit();
    }
  } catch {
    // OBS-20: logger failure must never fail the request
  }
}

function emitRejected(error?: unknown): void {
  try {
    const event = getGlobalLogger()
      .atLevel('warning')
      .event('http.redirect.rejected');
    if (error !== undefined) {
      event.cause(error);
    }
    event.emit();
  } catch {
    // OBS-20: logger failure must never fail the request
  }
}

function emitFollowEvents(
  context: {readonly request: Request; readonly nextRequest: Request},
  response: Response,
  hop: number,
): void {
  try {
    const {request, nextRequest} = context;
    if (
      request.url.protocol === 'https:' &&
      nextRequest.url.protocol === 'http:'
    ) {
      getGlobalLogger()
        .atLevel('warning')
        .event('http.redirect.downgradePermitted')
        .field('from_url', redactUrl(request.url))
        .field('to_url', redactUrl(nextRequest.url))
        .emit();
    }

    getGlobalLogger()
      .atLevel('info')
      .event('http.redirect.hop')
      .field('hop', hop)
      .field('status', response.status.code)
      .field('url.full', redactUrl(nextRequest.url))
      .emit();
  } catch {
    // OBS-20: log emission must never fail the request
  }
}

/**
 * The REDIRECT pillar step (REDIR-1..REDIR-27, PIPE-40).
 *
 * `stage: 'REDIRECT'` is baked into the descriptor this factory returns, which is how PIPE-36 ("a shipped
 * pillar family must not be relocatable out of its pillar") is satisfied structurally: steps are
 * functions carrying a descriptor, not classes with a subclassable stage assignment. `ctx.fork` is
 * asserted rather than checked -- REDIRECT is in `PILLAR_STAGES`, so its absence means the descriptor was
 * installed somewhere it cannot be, which is a programmer error.
 *
 * Every dispatch, INCLUDING the first, goes through a fresh `ctx.fork()` -- never `ctx.next()` -- since
 * the step may re-drive the downstream chain an unknown number of times and `next()`'s single-invocation
 * guard would trip on the second hop (PIPE-15).
 *
 * **Response lifecycle** (PIPE-40/REDIR-22): a superseded intermediate response is closed before the next
 * hop's dispatch; on `'fail'` the current response is closed before the error propagates; on every
 * `'return-current'` outcome -- not-a-redirect, opted-out, malformed or missing Location, loop detected,
 * hop cap reached -- the response is returned OPEN, the caller's to close. Close-responsibility passes
 * outward.
 *
 * **What a caller catches.** Normally the decision's own error -- `SchemeDowngradeError`,
 * `NonReplayableBodyError`, or whatever a caller predicate threw -- so `instanceof` works directly. In
 * the one case where releasing that hop ALSO fails, the throw is a `SuppressedError`-shaped pairing
 * (`suppress.ts`) carrying the decision error as `.error` and the release failure as `.suppressed`, per
 * RECOV-12's "keep the primary primary". Code that must handle both reads `.error` when the caught value
 * has one. The same shape 5a's retry engine already surfaces on its equivalent path.
 *
 * Iterative, not recursive, so it is stack-safe regardless of `maxHops` (REDIR-23): each `await`
 * releases its iteration's frame before the next begins.
 *
 * `ctx.signal` is checked once per iteration, in the `follow` branch, BEFORE closing that hop's response
 * and re-driving -- the only placement under which "return the current response, open" is meaningful,
 * since `return-current` and `fail` already have their own disposition by the time it would run. No
 * cancellable wait is needed (unlike retry, there is nothing to sleep between hops), so this is one cheap
 * check rather than a timer race.
 *
 * **Caller obligation.** A caller installing this descriptor directly, rather than through
 * `withRedirect()`, must also install `stripCrossOriginMarkerStep()` -- otherwise REDIR-11's internal
 * marker reaches the transport whenever no auth step is present to strip it.
 *
 * **Exceeding `maxHops` does NOT throw** (REDIR-17). The hop cap returns the current 3xx response to
 * the caller unfollowed, which is also what `maxHops: 0` reduces to -- there is no separate "disable
 * redirects" branch. `decide.ts:205` is the gate. Stated here rather than after the tags below
 * because TSDoc folds trailing prose into the preceding block tag, where it would render as part of
 * a `@throws` description in the emitted `.d.ts`.
 *
 * @param overrides - redirect policy overrides; a zero-argument call yields the spec defaults.
 * @returns the descriptor to install in a pipeline's REDIRECT slot.
 * @throws SchemeDowngradeError - when an HTTPS to HTTP redirect is rejected by downgrade policy (REDIR-14, REDIR-15).
 * @throws NonReplayableBodyError - when a redirect requiring body resend encounters a single-use body (REDIR-6, REDIR-22).
 *
 * @public
 */
export function redirectStep(
  overrides?: Partial<RedirectSettings>,
): StepDescriptor {
  const settings = redirectSettings(overrides);
  return {
    type: REDIRECT_STEP_TYPE,
    stage: 'REDIRECT',
    fn: async (seedRequest, ctx) => {
      const {fork, signal} = ctx;
      invariant(
        fork !== undefined,
        'redirectStep must occupy the REDIRECT pillar stage',
      );
      const seedUrl = seedRequest.url;
      const seedOrigin = originOf(seedUrl);
      const visited = new Set<string>([seedUrl.href]);
      let request: Request = seedRequest;
      let redirectsFollowed = 0;

      for (;;) {
        const response = await fork()(request);
        const context: RedirectContext = {
          currentRequest: request,
          seedOrigin,
          visited,
          redirectsFollowed,
        };
        const decision = await decideOrClose(response, context, settings);

        if (decision.kind === 'return-current') {
          if (response.status.isRedirect) {
            emitRejected();
            emitStopReason({
              reason: decision.reason,
              request,
              rawLocation: response.headers.get(settings.locationHeader),
            });
          }
          return response;
        }
        if (decision.kind === 'fail') {
          const releaseError = await releaseQuietly(response);
          emitRejected(decision.error);
          throw withReleaseFailure(decision.error, releaseError);
        }
        if (signal?.aborted === true) return response;

        emitFollowEvents(
          {request, nextRequest: decision.nextRequest},
          response,
          redirectsFollowed + 1,
        );

        await response.close();
        visited.add(decision.nextRequest.url.href);
        redirectsFollowed += 1;
        request = decision.nextRequest;
      }
    },
  };
}
