// SPDX-License-Identifier: MIT
// packages/core/src/index.ts
/**
 * The immutable, transport-agnostic HTTP domain model at the heart of `@dexpace/core`.
 *
 * Every type here is frozen at construction and built through a builder or a static factory, so
 * case-insensitivity, multi-value semantics, ordering, header-injection defenses, method/body
 * legality, and total status handling are fixed once and behave identically under every transport.
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

// Phase 7a — configuration and platform primitives. There is no `./config/index.js`, because 7a's
// design doc rules one out by name. Not because the question is settled: this repo carries both
// patterns — `http/`, `body/`, `io/`, and `seams/` each have an internal barrel, while `pipeline/`,
// `context/`, and `config/` do not — and so does the knowledge corpus, where
// docs/knowledge/module-organization.md:18 bans internal barrels outright and
// docs/knowledge/api-design.md:8 endorses one per feature folder, with no entry in the corpus's
// `--section conflicts` reconciling them. 7a followed its design doc and names each symbol here
// against its own file; see docs/open-items.md G11 for the standing note.
// Deliberately NOT exported: `config/equality.js`'s deepEqual/deepHash — no requirement gives a
// caller direct access to them, and they have no in-package caller either as of 2026-08-27, so the
// module is reachable only from its own test (docs/open-items.md G16 owns the first real consumer);
// and `config/client-identity-step.js`'s clientIdentityStep, whose StepDescriptor return type is
// part of the still-internal pipeline authoring surface (docs/open-items.md G1).
export type {Clock} from './config/clock.js';
export {defaultClock} from './config/clock.js';
export type {BuildInfo} from './config/build-info.js';
export {getBuildInfo} from './config/build-info.js';
export type {Configuration, SourceFn} from './config/configuration.js';
export {
  CFG_KEY_HTTPS_PROXY,
  CFG_KEY_HTTP_PROXY,
  CFG_KEY_LOG_LEVEL,
  CFG_KEY_MAX_RETRY_ATTEMPTS,
  CFG_KEY_NO_PROXY,
  ConfigurationBuilder,
  defaultConfiguration,
  getGlobalConfiguration,
  setGlobalConfiguration,
} from './config/configuration.js';
export {formatHttpDate, parseHttpDate} from './config/http-date.js';
export {randomUuid} from './config/identifiers.js';
export type {
  ProxyCredentials,
  ProxyOptions,
  ProxyOptionsInit,
  ProxyType,
} from './config/proxy.js';
export {
  createProxyOptions,
  formatProxyOptions,
  resolveProxyOptions,
  shouldBypassProxy,
} from './config/proxy.js';
export {RETRYABLE_STATUSES, isRetryableStatus} from './config/retryable.js';
