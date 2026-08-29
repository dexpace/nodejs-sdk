// SPDX-License-Identifier: MIT
// packages/body-file/src/file-body.ts
import {createReadStream, statSync} from 'node:fs';
import type {FileBodyDescriptor} from '@dexpace/core';
import {invariant} from './invariant.js';

/**
 * Options for configuring a file-backed request body.
 *
 * @public
 */
export interface FileBodyOptions {
  /** The starting byte offset within the file (default 0). */
  readonly start?: number;
  /** The number of bytes to stream (default: remaining bytes from start to end of file). */
  readonly count?: number;
}

/**
 * Creates a file-backed request body descriptor with fail-fast construction validation (HTTP-40, BODY-11).
 *
 * @param path - the absolute or relative path to the regular file.
 * @param options - optional byte range (start offset and count).
 * @returns an immutable `FileBodyDescriptor`.
 * @throws Error if the file does not exist, is not a regular file, or if the byte range is invalid.
 *
 * @public
 */
export function fileBody(
  path: string,
  options: FileBodyOptions = {},
): FileBodyDescriptor {
  const stats = statSync(path);
  invariant(stats.isFile(), `not a regular file: ${path}`);
  const start = options.start ?? 0;
  invariant(start >= 0, `start must be non-negative, got ${String(start)}`);
  invariant(
    start <= stats.size,
    `start (${String(start)}) exceeds file size (${String(stats.size)})`,
  );
  const count = options.count ?? stats.size - start;
  invariant(count >= 0, `count must be non-negative, got ${String(count)}`);
  invariant(
    start + count <= stats.size,
    `start + count (${String(start + count)}) exceeds file size (${String(stats.size)})`,
  );

  return Object.freeze({
    kind: 'file' as const,
    mediaType: undefined,
    contentLength: count,
    replayable: true,
    path,
    start,
    count,
    async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
      const writer = sink.getWriter();
      if (count === 0) {
        writer.releaseLock();
        return;
      }
      let transferred = 0;
      const stream = createReadStream(path, {
        start,
        end: start + count - 1,
      });
      try {
        for await (const chunk of stream) {
          const bytes = chunk as Buffer;
          await writer.write(
            new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
          );
          transferred += bytes.byteLength;
        }
        invariant(
          transferred === count,
          `short write: transferred ${String(transferred)} of ${String(count)} bytes`,
        );
      } catch (error) {
        await writer.abort(error);
        throw error;
      } finally {
        stream.destroy();
        writer.releaseLock();
      }
    },
  });
}
