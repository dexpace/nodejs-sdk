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
import {
  loggingStep,
  type LoggingStepSettings,
} from '../observability/logging-step.js';

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
  /** Logging and observability settings; omitted installs the default inert step. */
  readonly logging?: LoggingStepSettings | undefined;
}

// Built lazily rather than as a top-level `const NO_AUTH_SETTINGS = ...`: a module-scope factory call
// is import-time work a bundler must preserve (`docs/knowledge/harvested/performance.md`), and it would pin
// descriptor.ts/requirement.ts into every bundle that imports the preset. The allocation is per call,
// but the preset is constructed once per client, not per request.
function noAuthSettings(): AuthStepSettings {
  return {
    credentials: {},
    tiers: {client: createAuthDescriptor([createAuthRequirement('NO_AUTH')])},
  };
}

/**
 * Assembles the standard resilience pipeline: redirect, then retry, then auth, then logging (PIPE-24, PIPE-39).
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
 * `LOGGING` installs {@link loggingStep} to emit telemetry and metrics around dispatches. `SERDE` remains
 * reserved with no shipped behavior anywhere in this roadmap's current scope.
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
 * @throws SchemeDowngradeError — from the returned runtime's `send()` — when a redirect attempts an HTTPS to HTTP downgrade not permitted by settings (REDIR-14/15).
 * @throws MaxHopsExceededError — from the returned runtime's `send()` — when redirects exceed maxHops (REDIR-17/22).
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
    .append(loggingStep(options.logging))
    .build();
}
