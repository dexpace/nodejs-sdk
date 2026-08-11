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
  stringBody,
  type StringBody,
} from './body/simple-bodies.js';
export {streamBody, type StreamBody} from './body/stream-body.js';
export {TypedResponse} from './body/typed-response.js';
