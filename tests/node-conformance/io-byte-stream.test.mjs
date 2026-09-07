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

// The five Web Streams bridges had no case here at all until #77. Every one of them is a hand-written
// `ReadableStream`/`WritableStream` underlying-source or -sink object, so what they exercise is the
// runtime's own pull scheduling, cancel dispatch and reader-lock bookkeeping — the three things §5.9
// names and the three that two independent Streams implementations are most likely to differ on.

describe('BufferedSource.toReadableStream on Node (IO-16)', () => {
  it('pulls one chunk at a time instead of draining the source eagerly', async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) {
        pulls += 1;
        if (pulls > 4) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.from([pulls]));
      },
    });
    const bridge = BufferedSource.overStream(stream).toReadableStream();
    const reader = bridge.getReader();

    const first = await reader.read();
    assert.deepEqual([...first.value], [1]);
    // Node's default queuing strategy reads one chunk ahead, so at most one pull beyond the one just
    // served. The assertion that matters is that the whole 4-chunk source has not been materialized.
    assert.ok(pulls <= 2, `expected at most 2 pulls, saw ${pulls}`);
    await reader.cancel();
  });

  it('closes the bridge at natural EOF without tearing down the owning source', async () => {
    // IO-19: closing the source here would invalidate every outstanding peek/slice view, defeating the
    // bridge's most natural usage — take a preview, hand the bridge to the transport, read the preview
    // afterwards. Only an explicit cancel closes the source (next case).
    const source = BufferedSource.overStream(streamOfChunks([[1, 2], [3]]));
    const preview = source.peek();
    const collected = [];
    for await (const chunk of source.toReadableStream())
      collected.push(...chunk);

    assert.deepEqual(collected, [1, 2, 3]);
    assert.deepEqual([...(await preview.readBytes())], [1, 2, 3]);
    assert.equal(source.closed, false);
    await source.close();
  });

  it('cancelling the bridge closes the source AND releases the caller stream lock', async () => {
    const stream = streamOfChunks([[1, 2, 3]]);
    const source = BufferedSource.overStream(stream);
    assert.equal(stream.locked, true);

    await source.toReadableStream().cancel();
    assert.equal(source.closed, true);
    // cancel() cancels the stream but never releases the reader's lock; only releaseLock() does, and a
    // leaked lock on a connection-backed source is a held socket.
    assert.equal(stream.locked, false);
  });

  it('a mid-stream read failure closes the source rather than stranding the lock', async () => {
    // The Streams spec does NOT invoke `cancel` on an errored stream, so the bridge has to close the
    // source itself on this path. A runtime that dispatched cancel here would hide the bug.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
      },
      pull() {
        throw new Error('mid-stream read failure');
      },
    });
    const source = BufferedSource.overStream(stream);
    const reader = source.toReadableStream().getReader();

    assert.deepEqual([...(await reader.read()).value], [1, 2, 3]);
    await assert.rejects(reader.read(), /mid-stream read failure/);
    assert.equal(source.closed, true);
    assert.equal(stream.locked, false);
  });
});

describe('BufferedSink.toWritableStream on Node (IO-16)', () => {
  it('carries a pipeTo through to the destination and closes it', async () => {
    // `pipeTo` closes its destination on natural EOF, and IO-16 says closing the bridge closes the
    // sink, which closes the caller's stream. Three closes chained through two runtimes' plumbing.
    const written = [];
    let closed = false;
    const destination = new WritableStream({
      write: chunk => void written.push(...chunk),
      close: () => void (closed = true),
    });
    const sink = BufferedSink.overStream(destination);

    await streamOfChunks([[1, 2], [3]]).pipeTo(sink.toWritableStream());
    assert.deepEqual(written, [1, 2, 3]);
    assert.equal(sink.closed, true);
    assert.equal(closed, true);
  });

  it('aborting the bridge aborts the sink and carries the reason, rather than closing it', async () => {
    // Collapsing an abort into a graceful close commits a cancelled request body downstream as a
    // well-formed complete one, so the peer cannot tell an aborted upload from a successful short one.
    let closed = false;
    let abortReason = 'NOT-ABORTED';
    const destination = new WritableStream({
      write: chunk => void chunk,
      close: () => void (closed = true),
      abort: reason => void (abortReason = reason),
    });
    const sink = BufferedSink.overStream(destination);
    const writer = sink.toWritableStream().getWriter();
    await writer.write(Uint8Array.from([1, 2, 3]));

    const reason = new Error('user cancelled');
    await writer.abort(reason);
    assert.equal(abortReason, reason);
    assert.equal(closed, false);
    assert.equal(sink.closed, true);
  });

  it('drops a zero-length chunk rather than forwarding a chunked-encoding terminator', async () => {
    const {stream, written} = collectingStream();
    const sink = BufferedSink.overStream(stream);
    const writer = sink.toWritableStream().getWriter();
    await writer.write(new Uint8Array(0));
    await writer.write(Uint8Array.from([7]));
    await writer.close();
    assert.deepEqual([...written()], [7]);
  });
});

describe('TeeSink.toWritableStream on Node (IO-16, IO-26)', () => {
  it('routes through the tee, so bytes written to the bridge still reach the tap', async () => {
    // Handing callers the PRIMARY's bridge instead would let every byte written through it bypass the
    // tap, silently producing an empty capture.
    const {stream, written} = collectingStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 2);

    await streamOfChunks([
      [1, 2],
      [3, 4, 5],
    ]).pipeTo(tee.toWritableStream());
    assert.deepEqual([...written()], [1, 2, 3, 4, 5]);
    assert.deepEqual([...tee.snapshot()], [1, 2]);
  });

  it('forwards an abort to the primary while the tap survives to record what was attempted', async () => {
    let abortReason = 'NOT-ABORTED';
    const destination = new WritableStream({
      write: chunk => void chunk,
      abort: reason => void (abortReason = reason),
    });
    const tee = new TeeSink(BufferedSink.overStream(destination), 4);
    const writer = tee.toWritableStream().getWriter();
    await writer.write(Uint8Array.from([1, 2, 3]));

    const reason = new Error('deadline exceeded');
    await writer.abort(reason);
    assert.equal(abortReason, reason);
    assert.deepEqual([...tee.snapshot()], [1, 2, 3]);
  });
});
