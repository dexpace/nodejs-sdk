// SPDX-License-Identifier: MIT
// packages/core/src/redirect/redirect-step.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {releaseQuietly, withReleaseFailure} from '../recovery/release.js';
import {originOf} from './cross-origin.js';
import {decide, type Decision, type RedirectContext} from './decide.js';
import {redirectSettings, type RedirectSettings} from './settings.js';

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
 * Redirect's SHOULD-level structured logging (REDIR-28, and REDIR-15's observable surfacing of a
 * permitted downgrade) is deliberately absent here: the `Logger` seam is Phase 7b, which executes after
 * this phase and amends this file with its three emission sites in its own Task 9.
 *
 * @param overrides - redirect policy overrides; a zero-argument call yields the spec defaults.
 * @returns the descriptor to install in a pipeline's REDIRECT slot.
 *
 * @internal
 */
export function redirectStep(
  overrides?: Partial<RedirectSettings>,
): StepDescriptor {
  // Built ONCE per installed step, not per request: `redirectSettings()` validates every field and takes
  // a defensive copy of the allowed-method set. The policy is immutable and stateless after construction,
  // so one instance is safe to share across concurrent calls.
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
      // `Request.url` hands back a FRESH `URL` on every access (HTTP-5), so read it once.
      // REDIR-8: fixed for the whole chain. REDIR-16: seeded with the ORIGINAL request's URI.
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

        if (decision.kind === 'return-current') return response;
        if (decision.kind === 'fail') {
          // REDIR-22(b): closed before the error propagates, and the DECISION's error is the one that
          // propagates -- a failing release rides along as `suppressed` rather than replacing it.
          throw withReleaseFailure(
            decision.error,
            await releaseQuietly(response),
          );
        }
        if (signal?.aborted === true) return response;

        // REDIR-22(a): the superseded hop, released before the next drive. NOT quieted -- unlike the
        // two paths above there is no primary error to keep primary, and PIPE-40 makes the release
        // itself part of the contract, so a failure to release IS this call's failure.
        await response.close();
        visited.add(decision.nextRequest.url.href);
        redirectsFollowed += 1;
        request = decision.nextRequest;
      }
    },
  };
}
