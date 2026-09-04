// SPDX-License-Identifier: MIT
// packages/core/src/io/index.ts
// Internal barrel for product-spec §5 (IO-1–IO-42).
//
// The PROVIDER types here — BufferedSource, BufferedSink, ByteQueue, TeeSink and their factories —
// are @internal and are not re-exported from packages/core/src/index.ts, kept out of the
// api-extractor surface so a later phase can promote them deliberately (styleguide 10.3), or not at
// all: 3b shaped BODY-1's write-to-sink around the platform's WritableStream rather than BufferedSink.
//
// The ERROR leaves are a different case, and this comment claimed otherwise until 2026-09-02. Phase
// 8a promoted `IoError` and `TransportFailureError` to the public barrel (`index.ts:34`) because
// TRANSPORT-20 makes the subtyping a requirement and `retry/classify.ts`'s cause-walk is
// load-bearing on it, and Phase 9's U9 pass promoted `EndOfStreamError` — it was the subject of four
// `@throws` tags on public symbols with no class a caller could catch. `isIoError`,
// `AllocationLimitError`, `ClosedResourceError` and `SourceContractViolationError` remain internal
// (docs/work/mvp/2026-09-04-open-items-dissolution.md H8).
export {BufferedSink} from './buffered-sink.js';
export {BufferedSource} from './buffered-source.js';
export {ByteQueue, copyBytes} from './byte-queue.js';
export {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  isIoError,
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
export {
  assertAllocatable,
  assertCount,
  END_OF_STREAM,
  MAX_BYTE_ARRAY_LENGTH,
} from './limits.js';
export {writeAll} from './pump.js';
export {RetentionWindow, type Cursor} from './retention-window.js';
export type {Sink} from './sink.js';
export {TeeSink} from './tee-sink.js';
export {decodeText, encodeText} from './text-codec.js';
