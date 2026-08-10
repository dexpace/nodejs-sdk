// SPDX-License-Identifier: MIT
// packages/core/src/seams/serde.ts

/**
 * @internal
 * Provisional. `deserialize(data: unknown): T` with `T` inferred from the instance is exactly the
 * erased/inferred generic SEAM-21 forbids ("deserialization MUST require an explicit runtime type
 * token"). Phase 6's type-witness mechanism will change this interface's shape — do not export this
 * from `packages/core/src/index.ts`.
 */
export interface Serde<T> {
  readonly mediaType: string;
  serialize(value: T): unknown;
  deserialize(data: unknown): T;
}
