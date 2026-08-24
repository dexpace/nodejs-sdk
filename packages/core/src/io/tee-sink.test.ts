// SPDX-License-Identifier: MIT
// packages/core/src/io/tee-sink.test.ts
// Exercises: IO-25 (mirror into a tap AND forward the full untruncated payload),
// IO-26 (tap capacity limit; unbounded default; a limit of 0 mirrors nothing),
// IO-27 (mirror BEFORE forwarding; staging cleared even on a failed write),
// IO-28 (no direct backing-buffer handle), IO-29 (flush/close/emit forward to the primary only),
// IO-42 (write after close rejects with the source intact),
// IO-13 (the tap mirrors the primary's exact encoded bytes, and refuses a label identically),
// IO-16 (the tee's own writable bridge still feeds the tap)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError} from './errors.js';
import {TeeSink} from './tee-sink.js';
import {writeAll} from './pump.js';
import {
  collectingWritableStream,
  failingWritableStream,
} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

const queueOf = (bytes: Uint8Array): ByteQueue => {
  const queue = new ByteQueue();
  queue.writeBytes(bytes);
  return queue;
};

describe('TeeSink', () => {
  test('IO-25: the primary receives the full payload and the tap mirrors it', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect([...tee.snapshot()]).toEqual([1, 2, 3]);
  });

  test('IO-26: past the tap limit the tap stops copying but the primary still gets everything', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 2);
    await tee.write(queueOf(Uint8Array.from([1, 2, 3, 4, 5])), 5);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
    expect([...tee.snapshot()]).toEqual([1, 2]);
  });

  test('IO-26: a limit of 0 mirrors nothing and forwards everything', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 0);
    await tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect([...tee.snapshot()]).toEqual([]);
  });

  test('IO-26: the default limit mirrors everything', async () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(new Uint8Array(10_000).fill(7)), 10_000);
    await tee.close();
    expect(tee.snapshot().length).toBe(10_000);
  });
});

describe('TeeSink mirror-before-forward and lifecycle (IO-27, IO-28, IO-29, IO-42)', () => {
  test('IO-27: a failed primary write still captures the attempted bytes in the tap', async () => {
    const tee = new TeeSink(
      BufferedSink.overStream(failingWritableStream('primary down')),
    );
    expect(
      (await rejection(tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3)))
        .message,
    ).toContain('primary down');
    await Promise.resolve();
    expect([...tee.snapshot()]).toEqual([1, 2, 3]);
  });

  test("IO-27: a write following a FAILED write does not prepend the failed write's bytes", async () => {
    // The staging buffer is per-call, so this holds structurally — but the assertion has to actually
    // drive the failure path to prove it, which is why the first sink is the failing one.
    const failing = new TeeSink(
      BufferedSink.overStream(failingWritableStream('primary down')),
    );
    expect(
      (await rejection(failing.write(queueOf(Uint8Array.from([1, 2])), 2)))
        .message,
    ).toContain('primary down');

    const {stream, written} = collectingWritableStream();
    const good = new TeeSink(BufferedSink.overStream(stream));
    await good.write(queueOf(Uint8Array.from([3])), 1);
    await good.close();
    expect([...written()]).toEqual([3]);
  });

  test('IO-27: consecutive successful writes concatenate without duplication or reordering', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2])), 2);
    await tee.write(queueOf(Uint8Array.from([3])), 1);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
  });
});

describe('TeeSink no-raw-buffer and close (IO-28, IO-29, IO-42)', () => {
  test('IO-28: there is no direct backing-buffer handle', () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    expect(() => tee.buffer).toThrow(
      'TeeSink exposes no backing buffer; use the typed write methods',
    );
  });

  test('IO-29: close forwards to the primary and leaves the tap intact for later snapshotting', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2])), 2);
    await tee.close();
    expect([...written()]).toEqual([1, 2]);
    expect([...tee.snapshot()]).toEqual([1, 2]);
  });

  test('IO-29: flush and emit return the tee and leave the tap intact', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2])), 2);
    expect(await tee.flush()).toBe(tee);
    expect(await tee.emit()).toBe(tee);
    expect([...tee.snapshot()]).toEqual([1, 2]);
    await tee.close();
    expect([...written()]).toEqual([1, 2]);
  });

  test('IO-29: flush and emit really reach the primary — a closed primary makes both reject', async () => {
    // The observable proof that neither is swallowed by the decorator: BufferedSink rejects a flush
    // or emit after close (IO-42), so the rejection can only have come from the primary.
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.close();
    expect(await rejection(tee.flush())).toBeInstanceOf(ClosedResourceError);
    expect(await rejection(tee.emit())).toBeInstanceOf(ClosedResourceError);
  });
});

describe('TeeSink text writes (IO-13, IO-25)', () => {
  test('IO-25: writeUtf8 forwards the encoded bytes and mirrors exactly those bytes', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.writeUtf8('héllo ☃');
    await tee.close();
    expect([...tee.snapshot()]).toEqual([...written()]);
    expect(new TextDecoder('utf-8').decode(written())).toBe('héllo ☃');
  });

  test('IO-13: writeString mirrors the charset-encoded bytes, not a UTF-8 re-encoding', async () => {
    // 'é' is one byte in ISO-8859-1 and two in UTF-8, so a tap that re-encoded would differ from the
    // wire body — the exact divergence the single shared `encodeText` exists to prevent.
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.writeString('hé', 'iso-8859-1');
    await tee.close();
    expect([...written()]).toEqual([0x68, 0xe9]);
    expect([...tee.snapshot()]).toEqual([0x68, 0xe9]);
  });

  test('IO-13: an unsupported charset is refused before anything is mirrored or forwarded', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    expect(
      (await rejection(tee.writeString('x', 'shift_jis'))).message,
    ).toContain(
      'unsupported write charset: shift_jis (only utf-8 and iso-8859-1 can be encoded)',
    );
    await tee.close();
    expect([...tee.snapshot()]).toEqual([]);
    expect([...written()]).toEqual([]);
  });

  test('IO-42: write after close rejects and leaves the source intact', async () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.close();
    const source = queueOf(Uint8Array.from([1, 2]));
    expect(await rejection(tee.write(source, 2))).toBeInstanceOf(
      ClosedResourceError,
    );
    expect(source.size).toBe(2);
    expect([...tee.snapshot()]).toEqual([]);
  });

  test('IO-25 property: the primary always receives the exact concatenation of every written byte', async () => {
    // The single most important property in §5: logging never reduces the wire body, whatever the cap.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({maxLength: 32}), {maxLength: 8}),
        fc.integer({min: 0, max: 64}),
        async (writes, tapLimit) => {
          const {stream, written} = collectingWritableStream();
          const tee = new TeeSink(BufferedSink.overStream(stream), tapLimit);
          for (const chunk of writes)
            await tee.write(queueOf(chunk), chunk.length);
          await tee.close();

          const expected = writes.flatMap(chunk => [...chunk]);
          expect([...written()]).toEqual(expected);
          expect(tee.snapshot().length).toBe(
            Math.min(tapLimit, expected.length),
          );
        },
      ),
    );
  });
});

describe('TeeSink as a first-class sink (IO-16, IO-25)', () => {
  test('a tee is accepted anywhere a sink is, including by the pump and by another tee', async () => {
    // `BufferedSink`'s #private fields make it a NOMINAL type, so a decorator can never be assignable
    // to it. Without a shared interface the only pump in the package cannot take a tee and tees cannot
    // nest — which defeats the body capture IO-25 exists for.
    const {stream, written} = collectingWritableStream();
    const inner = new TeeSink(BufferedSink.overStream(stream));
    const outer = new TeeSink(inner);
    const total = await writeAll(
      BufferedSource.overBytes(Uint8Array.from([1, 2, 3])),
      outer,
    );
    expect(total).toBe(3);
    expect([...written()]).toEqual([1, 2, 3]);
    expect([...outer.snapshot()]).toEqual([1, 2, 3]);
    expect([...inner.snapshot()]).toEqual([1, 2, 3]);
  });

  test('IO-16: the tee exposes its own bridge, so bridged bytes still reach the tap', async () => {
    // Handing callers the primary's bridge instead would route every byte written through it past the
    // tap, silently producing an empty capture.
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    const writer = tee.toWritableStream().getWriter();
    await writer.write(Uint8Array.from([7, 8]));
    await writer.close();
    expect([...written()]).toEqual([7, 8]);
    expect([...tee.snapshot()]).toEqual([7, 8]);
  });

  test('IO-16: aborting the tee bridge aborts the primary with the reason', async () => {
    const {stream, wasAborted, abortReason} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    const reason = new Error('cancelled');
    await tee.toWritableStream().abort(reason);
    expect(wasAborted()).toBe(true);
    expect(abortReason()).toBe(reason);
  });

  test('a failed primary write leaves the caller its bytes, and the tap records the attempt', async () => {
    // IO-27 requires the tap capture the ATTEMPTED bytes, so it keeps them either way; what must not
    // happen is `src` being drained by a write that never reached the wire.
    const tee = new TeeSink(
      BufferedSink.overStream(failingWritableStream('boom')),
    );
    const source = queueOf(Uint8Array.from([1, 2, 3]));
    expect((await rejection(tee.write(source, 3))).message).toContain('boom');
    expect(source.size).toBe(3);
    expect([...source.snapshot()]).toEqual([1, 2, 3]);
    expect([...tee.snapshot()]).toEqual([1, 2, 3]);
  });

  test('an empty payload produces the same chunk sequence as the sink and the bridge', async () => {
    const {stream, chunkSizes} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.writeUtf8('');
    expect(chunkSizes()).toEqual([]);
    expect(tee.snapshot().length).toBe(0);
  });
});
