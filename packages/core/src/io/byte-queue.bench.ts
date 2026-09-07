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

// A pool of pre-filled queues, so the two benches below measure only the operation they are named
// after. `writeBytes` COPIES, so a 64 KiB fill inside the timed closure costs about as much as the read
// it is setting up — roughly halving the sensitivity of the regression floor Phases 6 and 8 diff
// against. mitata has no per-iteration setup hook, so the fill is hoisted and the pool re-primed in
// batches instead. Only the first bench measures `writeBytes`, deliberately.
const POOL_SIZE = 256;

function primedPool(): ByteQueue[] {
  return Array.from({length: POOL_SIZE}, () => {
    const queue = new ByteQueue();
    queue.writeBytes(LARGE);
    return queue;
  });
}

let readPool = primedPool();
let readAt = 0;
const sinkQueue = new ByteQueue();

bench('ByteQueue read of 64 KiB, pre-filled (warm-JIT, not end-to-end)', () => {
  if (readAt >= POOL_SIZE) {
    readPool = primedPool();
    readAt = 0;
  }
  const source = readPool[readAt];
  readAt += 1;
  if (source === undefined) return;
  sinkQueue.clear();
  source.read(sinkQueue, source.size);
});

const snapshotQueue = new ByteQueue();
snapshotQueue.writeBytes(LARGE);

bench(
  'ByteQueue snapshot of 64 KiB, pre-filled (warm-JIT, not end-to-end)',
  () => {
    snapshotQueue.snapshot();
  },
);

await run();
