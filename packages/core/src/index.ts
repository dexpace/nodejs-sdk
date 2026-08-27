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

// Deliberately NOT `export * from './seams/index.js';`. That file is a folder-level barrel, which
// docs/knowledge/module-organization.md:18 bans outright and api-design.md:6 makes this file the sole
// one of; nothing imports it and the right end state is deleting it (docs/open-items.md H12). Naming
// each public export here keeps the package's surface a decision made in one place rather than a
// consequence of what a folder happens to re-export.
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

// ---------------------------------------------------------------------------------------------
// The serde seam, promoted in Phase 6a.
//
// Public because `@dexpace/codec-json` is a SEPARATE PACKAGE and can reach core only through this
// entry point — which is what settles the promotion question by force. Phase 2 kept `Serde<T>`
// package-private precisely so SEAM-21's reshape would not be a breaking change; the reshape has
// landed, so that marking comes off here.
//
// The phrase "package-private" is deliberate: `stripInternal` is on, and TypeScript tests a
// declaration's WHOLE leading comment range for the release tag as a SUBSTRING — spelling that tag
// out in prose here silently deletes the export below from the emitted `.d.ts`. It did, once.
// ---------------------------------------------------------------------------------------------
export type {Deserializer, Schema, Serde, Serializer} from './seams/serde.js';
export {
  DeserializationError,
  isSerdeError,
  SerializationError,
} from './serde/errors.js';
export type {
  DeserializationErrorOptions,
  SerdeErrorOptions,
} from './serde/errors.js';
export {
  absent,
  foldTristate,
  isAbsent,
  isNull,
  isPresent,
  isTristate,
  nullValue,
  ofNullable,
  present,
  TRISTATE_BRAND,
  tristateToString,
  valueOrNull,
} from './serde/tristate.js';
export type {Tristate, TristateBranches} from './serde/tristate.js';
export {
  decodeResponse,
  decodeSuccessResponse,
} from './serde/response-handlers.js';
export type {DecodeTarget} from './serde/response-handlers.js';
export {serdeBody} from './body/serde-body.js';

// SSE (Phase 6b). The parser and line reader stay internal: they are driven only through the facade, and
// exposing them would expose a way to violate SSE-17's non-ownership contract by accident.
export type {SseEvent, SseEventFields} from './sse/event.js';
export {
  isSseEventEmpty,
  makeSseEvent,
  sseEventToString,
  sseEventsEqual,
} from './sse/event.js';
export {SseLineTooLongError} from './sse/line-reader.js';
export {SseStreamError} from './sse/errors.js';
export {SseStream, sseStreamFrom} from './sse/stream.js';
export type {SseStreamFromOptions, SseStreamOptions} from './sse/stream.js';
export {
  MAPPER_DONE,
  MAPPER_SKIP,
  mapperValue,
  typedSseStream,
} from './sse/typed.js';
export type {MapperOutcome, SseMapper} from './sse/typed.js';

// Pagination (Phase 6c). The query splice and link tokenizer stay internal: publishing them would put a second
// URL-manipulation surface next to Phase 1's QueryParams, which is the confusion the one-encoder rule avoids.
export {Page, pageInfo} from './pagination/page.js';
export type {PageInfo} from './pagination/page.js';
export type {PaginationStrategy} from './pagination/strategy.js';
export {Paginator} from './pagination/paginator.js';
export type {PaginatorInit} from './pagination/paginator.js';
export {
  cursorStrategy,
  linkHeaderStrategy,
  pageNumberStrategy,
} from './pagination/strategies.js';
export {paginateWithFetchers} from './pagination/fetchers.js';
export type {
  FetcherPage,
  FetcherPaginationInit,
  PagingOptions,
} from './pagination/fetchers.js';
export {PaginationError} from './pagination/errors.js';
