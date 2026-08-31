// SPDX-License-Identifier: MIT
// tests/node-conformance/io-byte-stream.test.mjs
//
// Phase 3a's byte-stream surface, on Node. §5.9:358 names this layer specifically: "chunk boundaries,
// backpressure timing, queueMicrotask ordering" are where Bun's and Node's independent Web Streams
// implementations diverge, and every one of its ~300 unit tests runs only on Bun.
//
// Imported by direct `dist/` file path rather than through the `@dexpace/core` specifier: `io/` is
// `@internal` by design and `exports` maps only `"."`, so there is deliberately no public subpath. This
// is still the BUILT artifact, never `src/` (§5.9:372).
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {ByteQueue} from '../../packages/core/dist/io/byte-queue.js';
import {BufferedSource} from '../../packages/core/dist/io/buffered-source.js';
import {BufferedSink} from '../../packages/core/dist/io/buffered-sink.js';
import {TeeSink} from '../../packages/core/dist/io/tee-sink.js';
import {writeAll} from '../../packages/core/dist/io/pump.js';
import {END_OF_STREAM} from '../../packages/core/dist/io/limits.js';

/** A stream that hands out exactly the chunk boundaries the caller asks for. */
function streamOfChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function collectingStream() {
  const chunks = [];
  const stream = new WritableStream({
    write: chunk => void chunks.push(Uint8Array.from(chunk)),
  });
  return {
    stream,
    written: () => {
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    },
  };
}

async function drain(source) {
  const staging = new ByteQueue();
  while ((await source.read(staging, 8)) !== END_OF_STREAM) {
    /* pull to exhaustion */
  }
  return staging.snapshot();
}

describe('ByteQueue Uint8Array semantics on Node', () => {
  it('keeps a snapshot independent of later mutation, in both directions', () => {
    const queue = new ByteQueue();
    const input = Uint8Array.from([1, 2, 3]);
    queue.writeBytes(input);

    // The copy is what makes zero-copy subarray transfers between queues safe. A runtime whose
    // TypedArray slice/subarray semantics differed here would corrupt every body the SDK sends.
    input[0] = 99;
    const snapshot = queue.snapshot();
    assert.deepEqual([...snapshot], [1, 2, 3]);

    snapshot[1] = 88;
    assert.deepEqual([...queue.snapshot()], [1, 2, 3]);
  });

  it('preserves byte order across arbitrary chunk splits and read increments', () => {
    const queue = new ByteQueue();
    for (const chunk of [[1], [2, 3, 4], [], [5, 6], [7, 8, 9, 10]]) {
      queue.writeBytes(Uint8Array.from(chunk));
    }
    const dest = new ByteQueue();
    for (const take of [3, 1, 4, 2]) queue.read(dest, take);

    assert.equal(queue.size, 0);
    assert.deepEqual([...dest.snapshot()], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns 0 for a zero-count read and END_OF_STREAM only when exhausted', () => {
    const queue = new ByteQueue();
    const dest = new ByteQueue();
    assert.equal(
      queue.read(dest, 0),
      0,
      'a zero-count read is 0, never end-of-stream',
    );
    assert.equal(queue.read(dest, 4), END_OF_STREAM);
    queue.writeBytes(Uint8Array.from([1, 2]));
    assert.equal(queue.read(dest, 0), 0);
    assert.equal(queue.read(dest, 4), 2);
  });
});

describe('BufferedSource over a Node ReadableStream', () => {
  it('reads an exact count across chunk boundaries the stream chose, not the ones we asked for', async () => {
    const source = BufferedSource.overStream(
      streamOfChunks([[1, 2], [3], [4, 5, 6]]),
    );
    assert.deepEqual([...(await source.readExactly(4))], [1, 2, 3, 4]);
    assert.deepEqual([...(await source.readExactly(2))], [5, 6]);
    assert.equal(await source.exhausted(), true);
    await source.close();
  });

  it('splits lines when the CRLF terminator straddles two stream chunks', async () => {
    // The case hand-picked examples miss and the one most sensitive to how a runtime delivers chunks:
    // "\r" ends one chunk and "\n" begins the next.
    const source = BufferedSource.overStream(
      streamOfChunks([
        [0x61, 0x0d],
        [0x0a, 0x62, 0x0a],
      ]),
    );
    assert.equal(await source.readUtf8Line(), 'a');
    assert.equal(await source.readUtf8Line(), 'b');
    assert.equal(await source.readUtf8Line(), undefined);
    await source.close();
  });

  it('keeps a lone CR as line content rather than treating it as a terminator', async () => {
    const source = BufferedSource.overStream(
      streamOfChunks([[0x61, 0x0d, 0x62, 0x0a]]),
    );
    assert.equal(await source.readUtf8Line(), 'a\rb');
    await source.close();
  });

  it('serves a slice view without advancing the parent cursor', async () => {
    const source = BufferedSource.overStream(
      streamOfChunks([
        [0, 1, 2],
        [3, 4],
        [5, 6, 7, 8, 9],
      ]),
    );
    const view = source.slice(2, 5);

    assert.deepEqual([...(await drain(view))], [2, 3, 4, 5, 6]);
    // Retention has to hold bytes the parent has not reached while the view races ahead — the
    // RetentionWindow behavior that depends on when the underlying reader delivers.
    assert.deepEqual(
      [...(await drain(source))],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    await source.close();
  });

  it('releases the caller stream lock on close', async () => {
    const stream = streamOfChunks([[1, 2, 3]]);
    const source = BufferedSource.overStream(stream);
    assert.equal(stream.locked, true);
    await source.close();
    // cancel() cancels the stream but never releases the reader's lock; only releaseLock() does, and a
    // leaked lock on a connection-backed source is a held socket.
    assert.equal(stream.locked, false);
  });
});

describe('BufferedSink and TeeSink over a Node WritableStream', () => {
  it('writes exactly the requested count and drains the source only after the write resolves', async () => {
    const {stream, written} = collectingStream();
    const sink = BufferedSink.overStream(stream);
    const source = new ByteQueue();
    source.writeBytes(Uint8Array.from([1, 2, 3, 4, 5]));

    await sink.write(source, 3);
    assert.deepEqual([...written()], [1, 2, 3]);
    assert.equal(source.size, 2, 'only the written bytes leave the source');
    await sink.close();
  });

  it('mirrors into the tap while forwarding the full untruncated payload', async () => {
    const {stream, written} = collectingStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 2);
    const source = new ByteQueue();
    source.writeBytes(Uint8Array.from([1, 2, 3, 4, 5]));

    await tee.write(source, 5);
    // The invariant logging exists for: the wire body is never reduced by the tap.
    assert.deepEqual([...written()], [1, 2, 3, 4, 5]);
    assert.deepEqual([...tee.snapshot()], [1, 2]);
    await tee.close();
  });

  it('pumps a source to exhaustion through a tee', async () => {
    const {stream, written} = collectingStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 4);
    const payload = Uint8Array.from(
      Array.from({length: 200}, (_, i) => i % 256),
    );

    const total = await writeAll(BufferedSource.overBytes(payload), tee);
    await tee.close();

    assert.equal(total, payload.length);
    assert.deepEqual([...written()], [...payload]);
    assert.equal(tee.snapshot().length, 4);
  });

  it('surfaces a failed downstream write through flush rather than reporting success', async () => {
    const failing = new WritableStream({
      write() {
        throw new Error('WIRE DIED');
      },
    });
    const sink = BufferedSink.overStream(failing);
    const source = new ByteQueue();
    source.writeBytes(Uint8Array.from([1]));

    await assert.rejects(sink.write(source, 1), /WIRE DIED/);
    // Backpressure and error propagation timing is exactly the queueMicrotask-ordering surface §5.9 names.
    await assert.rejects(sink.flush(), /WIRE DIED/);
    assert.equal(
      source.size,
      1,
      'a failed write leaves the payload for the caller to retry',
    );
  });
});
