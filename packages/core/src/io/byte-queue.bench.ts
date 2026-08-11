// SPDX-License-Identifier: MIT
// packages/core/src/io/byte-queue.bench.ts
// Baseline only — no optimization has been applied and none is justified yet (styleguide 15.1, 15.6:
// do not tune ahead of a profile). This exists so Phases 6 and 8 inherit a regression floor on the
// SDK's hottest data structure. mitata measures a warm JIT in isolation, not end-to-end throughput.
import {bench, run} from 'mitata';
import {ByteQueue} from './byte-queue.js';

const SMALL = new Uint8Array(64).fill(1);
const LARGE = new Uint8Array(64 * 1024).fill(1);

bench(
  'ByteQueue writeBytes x1000 small chunks (warm-JIT, not end-to-end)',
  () => {
    const queue = new ByteQueue();
    for (let i = 0; i < 1000; i += 1) queue.writeBytes(SMALL);
  },
);

bench(
  'ByteQueue write-then-read round trip, 64 KiB (warm-JIT, not end-to-end)',
  () => {
    const source = new ByteQueue();
    source.writeBytes(LARGE);
    source.read(new ByteQueue(), source.size);
  },
);

bench('ByteQueue snapshot of 64 KiB (warm-JIT, not end-to-end)', () => {
  const queue = new ByteQueue();
  queue.writeBytes(LARGE);
  queue.snapshot();
});

await run();
