// SPDX-License-Identifier: MIT
// packages/core/src/seams/index.ts
// Folder-level seams barrel, from Phase 2. NOT the package's public surface: that is
// packages/core/src/index.ts, which names each export directly and deliberately does not re-export
// this file. The "internal-facing" label this comment used to carry is no longer accurate either —
// Phase 6a closed SEAM-21, so the serde seam it re-exports is public, just promoted through
// index.ts rather than through here.
//
// Nothing imports this file. docs/knowledge/module-organization.md:18 bans internal folder-level
// barrels outright, so the right end state is deleting it rather than maintaining it; recorded at
// docs/open-items.md H12 for the next phase that touches packages/core/src/seams/. Phase 6a's own
// new folder, packages/core/src/serde/, correctly has no barrel at all.
export type {Transport} from './transport.js';
export {
  composeSignal,
  isTimeoutSignal,
  CancellationError,
} from './transport.js';
export type {Deserializer, Schema, Serde, Serializer} from './serde.js';
export type {OperationDescriptor} from './operation.js';
export {buildRequest, OperationAssemblyError} from './operation.js';
