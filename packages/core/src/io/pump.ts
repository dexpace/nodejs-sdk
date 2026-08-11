// SPDX-License-Identifier: MIT
// packages/core/src/io/pump.ts
import type {BufferedSink} from './buffered-sink.js';
import type {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {END_OF_STREAM} from './limits.js';

/** How much the pump asks for per iteration. */
const PUMP_CHUNK = 16 * 1024;

/**
 * Pump `source` to exhaustion into `sink` and return the total bytes transferred (IO-17).
 *
 * Terminates only on the end-of-stream sentinel. A zero-byte read for a non-zero requested count is a
 * source-contract violation raised by the source itself — never tolerated here as end-of-stream, and
 * never spun on.
 *
 * @internal
 */
export async function writeAll(
  source: BufferedSource,
  sink: BufferedSink,
): Promise<number> {
  const staging = new ByteQueue();
  let total = 0;
  for (;;) {
    const read = await source.read(staging, PUMP_CHUNK);
    if (read === END_OF_STREAM) return total;
    await sink.write(staging, staging.size);
    total += read;
  }
}
