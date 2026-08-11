// SPDX-License-Identifier: MIT
// packages/core/src/io/index.ts
// Internal barrel for product-spec §5 (IO-1–IO-42).
//
// NOTHING here is re-exported from packages/core/src/index.ts. Every symbol is @internal, kept out of
// the api-extractor surface so Phase 3b can promote deliberately (styleguide 10.3) — or not at all, if
// it shapes BODY-1's write-to-sink around the platform's WritableStream instead of BufferedSink.
export {BufferedSink} from './buffered-sink.js';
export {BufferedSource} from './buffered-source.js';
export {ByteQueue} from './byte-queue.js';
export {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  SourceContractViolationError,
} from './errors.js';
export {
  bufferedSinkOverPrimitive,
  bufferedSinkOverStream,
  bufferedSourceOverBytes,
  bufferedSourceOverPrimitive,
  bufferedSourceOverStream,
  newByteQueue,
  type PrimitiveSink,
  type PrimitiveSource,
} from './factories.js';
export {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';
export {writeAll} from './pump.js';
export {RetentionWindow, type Cursor} from './retention-window.js';
export {TeeSink} from './tee-sink.js';
