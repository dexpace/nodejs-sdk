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
