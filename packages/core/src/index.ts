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
