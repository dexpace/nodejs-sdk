// SPDX-License-Identifier: MIT
// packages/core/src/index.ts
/**
 * The transport-agnostic HTTP core of `@dexpace/core`: an immutable domain model, and the pipeline
 * that drives it.
 *
 * Every DOMAIN MODEL type — requests, responses, headers, bodies, status — is frozen at construction
 * and reachable only through a builder or a static factory, so case-insensitivity, multi-value
 * semantics, ordering, header-injection defenses, method/body legality, and total status handling are
 * fixed once and behave identically under every transport.
 *
 * The PIPELINE surface promoted in Phase 5c is deliberately not held to that rule. `PipelineBuilder`
 * is mutable by design and freezes only at `build()`; `Stage`, `Step`, `Next`, `StepContext`, and the
 * settings records are plain types a caller writes literals for; `authStep`, `retryStep`,
 * `redirectStep`, and `standardResilience` are factories returning descriptors and runtimes.
 *
 * The package has zero runtime dependencies.
 *
 * @packageDocumentation
 */
export * from './http/index.js';

// Deliberately NOT `export * from './seams/index.js';` — that barrel also carries the internal-only,
// provisional Serde<T> (SEAM-21 will reshape it in Phase 6). Naming each public export here instead keeps
// Serde<T> unreachable from the package's public entry point and out of the api-extractor surface.
export type {Transport} from './seams/transport.js';
export {
  composeSignal,
  isTimeoutSignal,
  CancellationError,
} from './seams/transport.js';
export type {OperationDescriptor} from './seams/operation.js';
export {buildRequest, OperationAssemblyError} from './seams/operation.js';

// Deliberately NOT `export * from './body/index.js';` — that barrel also carries withRequestLogging/
// withResponseLogging, internal until Phase 7 supplies a Logger to drive them. Naming each public export
// here instead keeps that boundary enforced at the barrel, not by convention.
// The concrete body classes are exported as TYPES ONLY. Exporting the class as a value publishes
// `new ByteArrayBody(...)` as a field-wise constructor, which HTTP-2 forbids ("constructible only
// through their builder or dedicated factory") and which duplicates the factory functions for no
// stated need (NFR-3). Callers construct via the factories and annotate with the types.
export type {Body} from './body/body.js';
export {
  ConsumedBodyError,
  FormBodyValidationError,
  isBodyError,
  MultipartBoundaryError,
} from './body/errors.js';
export {HttpStatusError, toHttpError} from './body/http-status-error.js';
export {materialize} from './body/materialize.js';
export {
  multipartBody,
  type MultipartBody,
  MultipartBodyBuilder,
  type MultipartPart,
} from './body/multipart-body.js';
export {
  byteArrayBody,
  type ByteArrayBody,
  formUrlEncodedBody,
  type FormUrlEncodedBody,
  type FormUrlEncodedInput,
  type FormUrlEncodedValue,
  stringBody,
  type StringBody,
} from './body/simple-bodies.js';
export {streamBody, type StreamBody} from './body/stream-body.js';
export {TypedResponse} from './body/typed-response.js';

// ---------------------------------------------------------------------------------------------
// The pillar-authoring surface, promoted in Phase 5c.
//
// 5c is the first point a caller can assemble a genuinely working pipeline -- all three resilience
// pillars plus the preset now exist. Promoting any earlier would have frozen shapes 5c still had
// latitude to reshape, which is why every prior phase deliberately exported nothing from here.
// ---------------------------------------------------------------------------------------------

// Group 1: the authoring surface itself.
export type {Stage} from './pipeline/stage.js';
export {PILLAR_STAGES, STAGE_ORDER} from './pipeline/stage.js';
export type {Next, Step, StepContext, StepDescriptor} from './pipeline/step.js';
export {PipelineBuilder} from './pipeline/builder.js';
export {Runtime} from './pipeline/runtime.js';
export {retryStep} from './retry/retry-step.js';
export {redirectStep} from './redirect/redirect-step.js';
export {authStep} from './auth/auth-step.js';
export {standardResilience} from './auth/preset.js';

// Group 2: everything Group 1's signatures name. A promoted function whose parameter type is
// internal-only is an API a caller cannot call, and api-extractor reports each omission as
// `ae-forgotten-export`.
//
// The word "internal-only" above is deliberate and must not be spelled as the TSDoc tag: gts turns
// `stripInternal` on, and TypeScript tests the WHOLE leading comment range of a declaration for that
// tag as a substring -- so writing it in prose here silently deletes the export below from the
// emitted `.d.ts`. It did, for one commit. `api-extractor.json` now fails `api:ci` on the resulting
// `ae-forgotten-export`, and `verify:consumer-types` compiles these four names from the built
// package, so the same slip cannot ship twice.
// The whole context family, not just `ExecutionContext`: it is a union alias, and `StepContext.context`
// makes every member reachable from a promoted signature. A caller writing a custom step reads
// `ctx.context.kind` to tell which promotion stage it is in.
export type {
  DispatchContext,
  ExchangeContext,
  ExecutionContext,
  RequestContext,
} from './context/context.js';
export type {InstrumentationBundle} from './context/instrumentation.js';
export type {Clock} from './config/clock.js';
export type {BackoffSettings} from './retry/backoff.js';
export type {RetrySettings} from './retry/settings.js';
export type {RetryStepOptions} from './retry/retry-step.js';
export type {
  RedirectCondition,
  RedirectPredicate,
  RedirectSettings,
} from './redirect/settings.js';
export type {StandardResilienceOptions} from './auth/preset.js';
export type {
  ApiKeyCredentialConfig,
  AuthCredentialSet,
  AuthStepSettings,
  BasicCredential,
  BearerCredential,
  ChallengeHook,
  DigestCredential,
} from './auth/auth-step.js';
export type {AuthTiers} from './auth/resolve.js';
export type {AuthScheme} from './auth/scheme.js';
export type {DigestAlgorithm} from './auth/digest.js';

// Factories, not bare interfaces: AUTH-3 validates and freezes inside `createAuthDescriptor`, and
// `ApiKeyCredential`/`NameKeyCredential`/`BearerToken` are NOMINAL -- they carry a `#` field, so no
// caller-side object literal is assignable and the AUTH-9 validation in each factory cannot be routed
// around. Without these, API_KEY and OAUTH2 auth are unreachable from outside the package.
// `BearerToken` is a VALUE export, not a type-only one: it is a class, and `TokenProvider` returns it.
export type {AuthDescriptor} from './auth/descriptor.js';
export {createAuthDescriptor} from './auth/descriptor.js';
export type {AuthRequirement} from './auth/requirement.js';
export {
  authRequirementsEqual,
  createAuthRequirement,
} from './auth/requirement.js';
export type {TokenProvider} from './auth/credential.js';
export {
  ApiKeyCredential,
  BearerToken,
  NameKeyCredential,
  bearerTokensEqual,
  createBearerToken,
} from './auth/credential.js';
export {AuthResolutionError, PlaintextCredentialError} from './auth/errors.js';
