// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-sink.test.ts
// Exercises: IO-4 (exact head removal, no partial write), IO-5 (flush, closeable),
// IO-13 (symmetric write-side encodings), IO-18 (emit vs flush), IO-41 (idempotent close),
// IO-42 (rejects after close), IO-6 (wrapper owns the caller's stream)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import {collectingWritableStream} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

const queueOf = (...values: number[]): ByteQueue => {
  const queue = new ByteQueue();
  queue.writeBytes(Uint8Array.from(values));
  return queue;
};

describe('BufferedSink', () => {
  test('IO-4: write removes exactly the requested count from the source head', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const source = queueOf(1, 2, 3, 4);
    await sink.write(source, 3);
    await sink.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect(source.size).toBe(1);
  });

  test('IO-4: writing more than the source holds throws and transfers nothing', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const source = queueOf(1, 2);
    expect(await rejection(sink.write(source, 3))).toBeInstanceOf(
      EndOfStreamError,
    );
    await sink.close();
    expect([...written()]).toEqual([]);
    expect(source.size).toBe(2);
  });

  test('IO-13: writeUtf8 encodes non-ASCII text symmetrically with the read side', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.writeUtf8('héllo ☃');
    await sink.close();
    expect(new TextDecoder('utf-8').decode(written())).toBe('héllo ☃');
  });

  test('IO-13: writeString encodes ISO-8859-1', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.writeString('hé', 'iso-8859-1');
    await sink.close();
    expect([...written()]).toEqual([0x68, 0xe9]);
  });

  test('IO-13: writeString rejects a code point ISO-8859-1 cannot represent', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    expect(
      (await rejection(sink.writeString('☃', 'iso-8859-1'))).message,
    ).toContain('code point 9731 is not representable in iso-8859-1');
  });

  test('IO-13: writeString rejects a charset the write side cannot encode', async () => {
    // TextEncoder is UTF-8-only and SEAM-1 forbids an encoding dependency, so the write side covers
    // exactly UTF-8 and ISO-8859-1. Anything else throws rather than silently re-encoding as UTF-8.
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    expect(
      (await rejection(sink.writeString('x', 'shift_jis'))).message,
    ).toContain(
      'unsupported write charset: shift_jis (only utf-8 and iso-8859-1 can be encoded)',
    );
  });
});

describe('BufferedSink charset round-trips (IO-13)', () => {
  /**
   * Code points 0x80–0x9F are deliberately outside this generator: the WHATWG Encoding Standard maps
   * the label `iso-8859-1` onto windows-1252, so `TextDecoder` turns 0x80 into U+20AC rather than
   * U+0080. That asymmetry is the platform's, not this sink's, and HTTP never needs those C1 controls;
   * the round-trip holds across every byte outside that band.
   */
  const latin1Codes = fc.array(
    fc.oneof(
      fc.integer({min: 0x00, max: 0x7f}),
      fc.integer({min: 0xa0, max: 0xff}),
    ),
    {maxLength: 64},
  );

  test('property: arbitrary text round-trips through the sink and back as UTF-8', async () => {
    // Styleguide 11.5 names codecs explicitly, and IO-13's whole claim is that the write side is
    // symmetric with the read side — a claim only a round-trip can check.
    await fc.assert(
      fc.asyncProperty(
        fc.string({unit: 'grapheme', maxLength: 64}),
        async text => {
          const {stream, written} = collectingWritableStream();
          const sink = BufferedSink.overStream(stream);
          await sink.writeString(text, 'utf-8');
          await sink.close();
          const source = BufferedSource.overBytes(written());
          expect(await source.readString('utf-8')).toBe(text);
        },
      ),
    );
  });

  test('property: arbitrary ISO-8859-1 text round-trips as one byte per code point', async () => {
    // IO-13's own conformance note names ISO-8859-1 as the non-UTF-8 charset to round-trip. The
    // one-byte-per-code-point assertion is what distinguishes an honored charset from a silent
    // UTF-8 re-encoding, which would widen every code point above 0x7F to two bytes.
    await fc.assert(
      fc.asyncProperty(latin1Codes, async codes => {
        const text = codes.map(code => String.fromCharCode(code)).join('');
        const {stream, written} = collectingWritableStream();
        const sink = BufferedSink.overStream(stream);
        await sink.writeString(text, 'iso-8859-1');
        await sink.close();
        expect([...written()]).toEqual(codes);
        const source = BufferedSource.overBytes(written());
        expect(await source.readString('iso-8859-1')).toBe(text);
      }),
    );
  });
});

describe('BufferedSink lifecycle (IO-18, IO-41, IO-42, IO-6)', () => {
  test('IO-18: flush and emit both return the sink for chaining', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    expect(await sink.emit()).toBe(sink);
    expect(await sink.flush()).toBe(sink);
    await sink.close();
  });

  test('IO-41: close is idempotent', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    await sink.close();
    expect(sink.closed).toBe(true);
  });

  test('IO-42: write, flush, and emit all reject after close', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    expect(await rejection(sink.write(queueOf(1), 1))).toBeInstanceOf(
      ClosedResourceError,
    );
    expect(await rejection(sink.flush())).toBeInstanceOf(ClosedResourceError);
    expect(await rejection(sink.emit())).toBeInstanceOf(ClosedResourceError);
  });

  test('IO-6: closing the sink closes the caller stream it took ownership of', async () => {
    const {stream, isClosed} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    expect(isClosed()).toBe(true);
  });
});

describe('BufferedSink host-native bridge (IO-16)', () => {
  test('toWritableStream forwards written chunks', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const bridge = sink.toWritableStream();
    const writer = bridge.getWriter();
    await writer.write(Uint8Array.from([1, 2]));
    await writer.close();
    expect([...written()]).toEqual([1, 2]);
  });

  test('closing the bridge closes the sink', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const writer = sink.toWritableStream().getWriter();
    await writer.close();
    expect(sink.closed).toBe(true);
  });
});
