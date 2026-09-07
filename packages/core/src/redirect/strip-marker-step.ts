// SPDX-License-Identifier: MIT
// packages/core/src/redirect/strip-marker-step.ts
import type {PipelineBuilder} from '../pipeline/builder.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {clearCrossOriginMarker, hasCrossOriginMarker} from './cross-origin.js';
import {redirectStep} from './redirect-step.js';
import type {RedirectSettings} from './settings.js';

/** Stable identity for anchor matching (PIPE-18). @internal */
export const STRIP_MARKER_STEP_TYPE: unique symbol = Symbol(
  'dexpace.redirect.strip-marker',
);

/**
 * REDIR-11(c)'s independent safety net.
 *
 * The requirement says the signal MUST be removed by the credential-attaching layer before dispatch --
 * and names the porter caveat that in the reference only the auth step strips it, so "a pipeline with no
 * auth step, including the sync standard-resilience preset, forwards the internal marker to the
 * transport", recommending a robust port strip it independently of whether a credential layer runs.
 *
 * That is not a future concern here: 5b ships before 5c, so today there IS no auth step, and without this
 * guard the marker would reach the wire on every cross-origin hop. `POST_AUTH` is 4c's inert
 * user-installable extension slot (PIPE-3) -- inside AUTH, outside SEND -- so the guard needs no change to
 * 4c's `Cursor` and no coordination with 5c. When 5c ships, its auth step becomes the marker's real
 * CONSUMER and first stripper; this stays installed as a redundant, idempotent backstop, since stripping
 * an already-absent header costs nothing.
 *
 * An ordinary single-invocation step: it calls `ctx.next()` once and never re-drives, so it needs no fork.
 *
 * @returns the descriptor to install in a pipeline's POST_AUTH slot.
 *
 * @public
 */
export function stripCrossOriginMarkerStep(): StepDescriptor {
  return {
    type: STRIP_MARKER_STEP_TYPE,
    stage: 'POST_AUTH',
    // The guard runs on EVERY request through a redirect-enabled pipeline, while the marker is present
    // only on a cross-origin hop -- so the common case must not pay for the rare one. Rebuilding is not
    // cheap: `HeadersBuilder.build()` deep-copies every value list plus both name maps, and
    // `Request.newBuilder()` re-parses the URL. The guard below is a single `Map.has`, and the
    // "no-op when the marker is already absent" test pins the branch it introduces.
    fn: (request, ctx) => {
      if (!hasCrossOriginMarker(request.headers)) return ctx.next();
      return ctx.next(
        request
          .newBuilder()
          .headers(clearCrossOriginMarker(request.headers))
          .build(),
      );
    },
  };
}

/**
 * Installs {@link redirectStep} and its bundled guard together, so a caller reaching for redirect support
 * gets REDIR-11(c)'s safety net without needing to know the marker exists. A caller who installs
 * `redirectStep()` directly against the builder's lower-level API is responsible for installing the guard
 * too.
 *
 * Idempotent: calling it twice leaves one pillar step and one guard. A guard the caller had already
 * installed is relocated to the tail of `POST_AUTH` rather than duplicated -- which is where it
 * belongs anyway, since a step seated after it runs closer to `SEND` and could otherwise put the
 * marker back.
 *
 * @param builder - the pipeline being assembled.
 * @param overrides - redirect policy overrides; omitted yields the spec defaults.
 * @returns the same builder, for chaining.
 *
 * @public
 */
export function withRedirect(
  builder: PipelineBuilder,
  overrides?: Partial<RedirectSettings>,
): PipelineBuilder {
  // `remove` first so a second `withRedirect()` call does not seat a second guard. `append` dedupes by
  // `type` only for PILLAR stages (PIPE-6), and `POST_AUTH` is not one -- so without this the pillar
  // half of this call would be idempotent while the guard half silently duplicated. `remove` is a no-op
  // when absent, and the type symbol is this module's own, so it can only ever match this guard.
  return builder
    .remove(STRIP_MARKER_STEP_TYPE)
    .append(redirectStep(overrides))
    .append(stripCrossOriginMarkerStep());
}
