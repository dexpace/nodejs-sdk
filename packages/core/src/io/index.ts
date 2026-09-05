// SPDX-License-Identifier: MIT
// packages/core/src/io/index.ts
// Internal barrel for product-spec §5 (IO-1–IO-42).
//
// The PROVIDER types here — BufferedSource, BufferedSink, ByteQueue, TeeSink and their factories —
// are @internal and are not re-exported from packages/core/src/index.ts, kept out of the
// api-extractor surface so a later phase can promote them deliberately (styleguide 10.3), or not at
// all: 3b shaped BODY-1's write-to-sink around the platform's WritableStream rather than BufferedSink.
//
// The ERROR leaves are a different case, and this comment has twice claimed otherwise. Phase 8a
// promoted `IoError` and `TransportFailureError` to the public barrel because TRANSPORT-20 makes the
// subtyping a requirement and `retry/classify.ts`'s cause-walk is load-bearing on it, and Phase 9's
// U9 pass promoted `EndOfStreamError` — it was the subject of four `@throws` tags on public symbols
// with no class a caller could catch. `1f48926` finished the set: `isIoError`,
// `AllocationLimitError`, `ClosedResourceError` and `SourceContractViolationError` are exported as
// well, so every error symbol re-exported below is also on `packages/core/src/index.ts:39-48` and in
// `packages/core/etc/core.api.md`. Nothing in this file's error block is internal any more
// (docs/work/mvp/2026-09-04-open-items-dissolution.md H8, whose remaining sub-item was the category
// catch `isIoError` now provides).
//
// "Load-bearing on it" is narrower than it sounds, and the difference is a decision rather than an
// accident. The cause-walk at `../retry/classify.ts:90` tests `instanceof IoError`, so it matches
// `IoError` and `TransportFailureError` — and NOT the four leaves below, which extend `DexpaceError`
// directly and are grouped only by `isIoError`. That branch means "the wire failed": a send that
// produced no response is retryable (RETRY-4, TRANSPORT-20), while a violated source contract, a
// closed resource, an allocation cap and a short exact-length copy are this package's own failures
// and repeat identically on the next attempt. Audit #67 / #78 decided it; `docs/deviations.md`
// item 17 carries the rationale and `../retry/classify.test.ts` pins one answer per class. Do not
// re-parent a leaf under `IoError` to tidy the tree — that silently makes it retryable.
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
