// SPDX-License-Identifier: MIT
// packages/core/src/seams/index.ts
// Internal-facing seams barrel — includes Serde<T>, unlike the package's public entry point
// (packages/core/src/index.ts), which deliberately omits it (SEAM-21 is deferred to Phase 6).
export type {Transport} from './transport.js';
export {
  composeSignal,
  isTimeoutSignal,
  CancellationError,
} from './transport.js';
export type {Serde} from './serde.js';
export type {OperationDescriptor} from './operation.js';
export {buildRequest, OperationAssemblyError} from './operation.js';
