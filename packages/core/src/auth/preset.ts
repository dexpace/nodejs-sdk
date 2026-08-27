// SPDX-License-Identifier: MIT
// packages/core/src/auth/preset.ts
import {PipelineBuilder} from '../pipeline/builder.js';
import type {Runtime} from '../pipeline/runtime.js';
import type {RedirectSettings} from '../redirect/settings.js';
import {withRedirect} from '../redirect/strip-marker-step.js';
import {retryStep, type RetryStepOptions} from '../retry/retry-step.js';
import type {Transport} from '../seams/transport.js';
import {authStep, type AuthStepSettings} from './auth-step.js';
import {createAuthDescriptor} from './descriptor.js';
import {createAuthRequirement} from './requirement.js';

/**
 * Per-pillar overrides for {@link standardResilience}. Every slot is optional; an omitted one takes
 * that pillar's own defaults.
 *
 * @public
 */
export interface StandardResilienceOptions {
  /** Retry settings and injected seams; omitted yields 5a's spec defaults. */
  readonly retry?: RetryStepOptions | undefined;
  /** Redirect policy overrides; omitted yields 5b's spec defaults. */
  readonly redirect?: Partial<RedirectSettings> | undefined;
  /**
   * Auth configuration. Required if any credential tier is meant to apply; omitted installs a
   * `NO_AUTH`-only step, which stamps nothing and never trips the HTTPS guard.
   */
  readonly auth?: AuthStepSettings | undefined;
}

// Built lazily rather than as a top-level `const NO_AUTH_SETTINGS = ...`: a module-scope factory call
// is import-time work a bundler must preserve (`docs/knowledge/performance.md`), and it would pin
// descriptor.ts/requirement.ts into every bundle that imports the preset. The allocation is per call,
// but the preset is constructed once per client, not per request.
function noAuthSettings(): AuthStepSettings {
  return {
    credentials: {},
    tiers: {client: createAuthDescriptor([createAuthRequirement('NO_AUTH')])},
  };
}

/**
 * Assembles the standard resilience pipeline: redirect, then retry, then auth (PIPE-24, PIPE-39).
 *
 * The order is AUTH-27's "redirect wraps retry wraps auth", so the auth step re-resolves and
 * re-stamps per redirect hop and per retry attempt (PIPE-2). Redirect is installed through 5b's
 * `withRedirect()`, which seats the pillar step AND its `POST_AUTH` cross-origin-marker guard
 * together, so the internal marker can never reach the wire.
 *
 * PIPE-24's "installs into empty pillar slots only" is true BY CONSTRUCTION: this function always
 * starts from a fresh `PipelineBuilder`, so no slot can be occupied and no runtime check is needed. A
 * caller wanting to layer this preset onto an already-customized builder reaches for
 * {@link PipelineBuilder.seedFrom} (`'nest'` or `'flatten'`) rather than this function growing a
 * "skip occupied slots" branch — the two features compose.
 *
 * `LOGGING` and `SERDE` stay empty. `LOGGING`'s real step ships in Phase 7b, which executes after this
 * phase and amends this function with a fourth `append` in its own plan; `SERDE` remains reserved with
 * no shipped behavior anywhere in this roadmap's current scope. That is a scope boundary, not a
 * deviation — the reference's preset description includes instrumentation, and this preset grows to
 * match once a real logging step exists.
 *
 * This function only assembles the pipeline. The failures below surface from the returned runtime's
 * `send()`, and are documented here because this factory is where a caller chooses the auth
 * configuration that determines whether they can occur at all.
 *
 * @param transport - the terminal transport. Never closed by the pipeline (PIPE-27).
 * @param options - per-pillar overrides.
 * @returns the built, immutable runtime.
 * @throws PlaintextCredentialError — from the returned runtime's `send()` — when a credentialed scheme
 *   meets a non-HTTPS URL (AUTH-28).
 * @throws AuthResolutionError — from the returned runtime's `send()` — when no configured credential
 *   satisfies the resolved auth tier (AUTH-6; AUTH-4 governs only WHICH tier is selected), or a token
 *   provider returns a null or already-expired token (AUTH-35).
 * @throws HeaderValidationError — from the returned runtime's `send()` — when credential material
 *   will not fit in a header value (HTTP-18).
 * @throws InvariantViolation — synchronously from this function — when any pillar's settings are
 *   invalid, including a non-finite bearer refresh margin or a non-header-safe Digest username. A
 *   caller-supplied `TokenProvider` or `challengeHook` error passes through `send()` unwrapped.
 *
 * @example
 * ```ts
 * const client = standardResilience(transport, {
 *   auth: {
 *     credentials: {apiKey: {credential: new ApiKeyCredential(process.env.API_KEY ?? '')}},
 *     tiers: {client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
 *   },
 * });
 * const response = await client.send(
 *   Request.newBuilder().url('https://api.example.com/v1/things').build(),
 * );
 * ```
 *
 * @public
 */
export function standardResilience(
  transport: Transport,
  options: StandardResilienceOptions = {},
): Runtime {
  const builder = new PipelineBuilder(transport);
  return withRedirect(builder, options.redirect)
    .append(retryStep(options.retry))
    .append(authStep(options.auth ?? noAuthSettings()))
    .build();
}
