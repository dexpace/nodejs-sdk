// SPDX-License-Identifier: MIT
// packages/core/src/io/factories.ts
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {SourceContractViolationError} from './errors.js';
import {END_OF_STREAM} from './limits.js';

/**
 * IO-30's factory half. Named free functions rather than a namespace object, so the module stays
 * tree-shakeable (styleguide 10.1, 15.9).
 *
 * IO-30's provider-*resolution* half — install precedence, idempotent install, caching, warning,
 * de-duplication, and the IO-31–IO-36 rules it defers to — is deliberately not built. There is one
 * implementation, always present, requiring no installation call; `sdk-design/03` §3.1 derives this in
 * full, and it is the same permanent simplification as SEAM-5–SEAM-10.
 *
 * @internal
 */

/** A fresh, independent, empty buffer (IO-30). */
export function newByteQueue(): ByteQueue {
  return new ByteQueue();
}

/** Wrap a caller stream as a buffered source (IO-30). */
export function bufferedSourceOverStream(
  stream: ReadableStream<Uint8Array>,
): BufferedSource {
  return BufferedSource.overStream(stream);
}

/** Wrap a byte array as a buffered source over an independent copy (IO-30). */
export function bufferedSourceOverBytes(bytes: Uint8Array): BufferedSource {
  return BufferedSource.overBytes(bytes);
}

/** Wrap a caller stream as a buffered sink (IO-30). */
export function bufferedSinkOverStream(
  stream: WritableStream<Uint8Array>,
): BufferedSink {
  return BufferedSink.overStream(stream);
}

/**
 * The raw read protocol of IO-1 — append up to `count` bytes to `dest`'s tail, return the number
 * transferred or `END_OF_STREAM` — with none of the typed reads, views, or line semantics. What a
 * "foreign primitive" source implements.
 */
export interface PrimitiveSource {
  read(dest: ByteQueue, count: number): Promise<number> | number;
}

/** The raw write protocol of IO-4 — remove exactly `count` bytes from `src`'s head, push downstream. */
export interface PrimitiveSink {
  write(src: ByteQueue, count: number): Promise<void> | void;
}

/** How much the primitive-source adapter asks for per pull. */
const PRIMITIVE_CHUNK = 16 * 1024;

/** Wrap a foreign primitive source with the typed buffered surface (IO-30). */
export function bufferedSourceOverPrimitive(
  source: PrimitiveSource,
): BufferedSource {
  const staging = new ByteQueue();
  return BufferedSource.overStream(
    new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        const read = await source.read(staging, PRIMITIVE_CHUNK);
        if (read === END_OF_STREAM) {
          controller.close();
          return;
        }
        if (read === 0) {
          // IO-17: a zero-byte read for a positive request is a source-contract violation — never
          // tolerated as end-of-stream, never spun on.
          throw new SourceContractViolationError(
            'foreign source returned 0 bytes for a positive request',
          );
        }
        controller.enqueue(staging.takeBytes(read));
      },
    }),
  );
}

/** Wrap a foreign primitive sink with the typed buffered surface (IO-30). */
export function bufferedSinkOverPrimitive(sink: PrimitiveSink): BufferedSink {
  return BufferedSink.overStream(
    new WritableStream<Uint8Array>({
      async write(chunk): Promise<void> {
        const staging = new ByteQueue();
        staging.writeBytes(chunk);
        await sink.write(staging, staging.size);
      },
    }),
  );
}
