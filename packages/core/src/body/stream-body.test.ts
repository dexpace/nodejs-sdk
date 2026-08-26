// SPDX-License-Identifier: MIT
// packages/core/src/body/stream-body.test.ts
// Exercises: BODY-9 (always single-use -- no generic mark/reset on Node's ReadableStream), BODY-3
// (second write fails loudly and is race-safe), BODY-8 (caller's stream is not force-closed -- read to
// natural exhaustion), HTTP-39/BODY-10 (declared length verified, short stream raises
// delivered-of-declared, and an overrunning stream is stopped BEFORE the extra bytes reach the sink),
// IO-3 (a contentLength below the -1 sentinel is rejected), HTTP-26/HTTP-51 (a media type is
// header-safe), RECOV-12 (a close failure never masks the primary write failure), HTTP-1 (frozen at
// construction so the declared length cannot be desynced from the written bytes)
import {describe, expect, test} from 'bun:test';
import {MediaTypeParseError} from '../http/errors.js';
import {InvariantViolation} from '../invariant.js';
import {EndOfStreamError} from '../io/errors.js';
import {ConsumedBodyError} from './errors.js';
import {streamBody} from './stream-body.js';

/** Sentinel distinguishing "cancel() never ran" from "cancel() ran with undefined". */
const NOT_CANCELLED = Symbol('not-cancelled');

function readableOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function collectingSink(): {
  sink: WritableStream<Uint8Array>;
  written: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write: chunk => void chunks.push(chunk),
  });
  return {
    sink,
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

describe('caller stream ownership (BODY-8)', () => {
  test('a sink failure does not cancel the caller stream on the unknown-length path', async () => {
    // `pipeTo`'s default (`preventCancel: false`) cancels the SOURCE when the destination errors,
    // which takes cancellation ownership away from the caller on exactly the failure path -- and
    // disagrees with the declared-length path below, which only releases its reader.
    let cancelReason: unknown = NOT_CANCELLED;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const failing = new WritableStream<Uint8Array>({
      write: () => {
        throw new Error('SOCKET GONE');
      },
    });

    expect(streamBody(source).writeTo(failing)).rejects.toThrow('SOCKET GONE');
    await Promise.resolve();
    expect(cancelReason).toBe(NOT_CANCELLED);
  });

  test('a sink failure does not cancel the caller stream on the declared-length path either', async () => {
    let cancelReason: unknown = NOT_CANCELLED;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.close();
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const failing = new WritableStream<Uint8Array>({
      write: () => {
        throw new Error('SOCKET GONE');
      },
    });

    expect(streamBody(source, undefined, 3).writeTo(failing)).rejects.toThrow(
      'SOCKET GONE',
    );
    await Promise.resolve();
    expect(cancelReason).toBe(NOT_CANCELLED);
  });
});

describe('StreamBody properties and writeTo (BODY-1, BODY-9)', () => {
  test('is always single-use, regardless of declared length (BODY-9)', () => {
    expect(streamBody(readableOf([1, 2]), undefined, 2).replayable).toBe(false);
  });

  test('reports the caller-supplied mediaType and contentLength', () => {
    const body = streamBody(readableOf([1]), 'application/octet-stream', 1);
    expect(body.mediaType).toBe('application/octet-stream');
    expect(body.contentLength).toBe(1);
  });

  test('defaults contentLength to -1 (unknown)', () => {
    expect(streamBody(readableOf([1])).contentLength).toBe(-1);
  });

  test('writeTo forwards the exact bytes', async () => {
    const {sink, written} = collectingSink();
    await streamBody(readableOf([1, 2], [3])).writeTo(sink);
    expect([...written()]).toEqual([1, 2, 3]);
  });

  test('a second write throws ConsumedBodyError (BODY-3)', async () => {
    const body = streamBody(readableOf([1]));
    await body.writeTo(collectingSink().sink);
    expect(body.writeTo(collectingSink().sink)).rejects.toThrow(
      ConsumedBodyError,
    );
  });
});

describe('StreamBody declared length verification (HTTP-39, BODY-10, IO-3)', () => {
  test('a declared length the stream cannot satisfy raises EndOfStreamError (HTTP-39/BODY-10)', () => {
    const body = streamBody(readableOf([1, 2]), undefined, 5);
    expect(body.writeTo(collectingSink().sink)).rejects.toThrow(
      EndOfStreamError,
    );
  });

  test('a satisfied declared length writes exactly that many bytes (HTTP-39/BODY-10)', async () => {
    const {sink, written} = collectingSink();
    await streamBody(readableOf([1, 2], [3]), undefined, 3).writeTo(sink);
    expect([...written()]).toEqual([1, 2, 3]);
  });

  test('a declared length of 0 is a legitimate empty write (BODY-10)', () => {
    const {sink, written} = collectingSink();
    void streamBody(
      new ReadableStream({
        start: c => {
          c.close();
        },
      }),
      undefined,
      0,
    ).writeTo(sink);
    expect(written().length).toBe(0);
  });

  test('a contentLength below the -1 sentinel is rejected at construction (IO-3)', () => {
    expect(() => streamBody(readableOf([1]), undefined, -2)).toThrow(
      InvariantViolation,
    );
  });

  test('concurrent first writes: exactly one proceeds, the other rejects (BODY-3 race-safety)', async () => {
    const body = streamBody(readableOf([1, 2, 3]));
    const results = await Promise.allSettled([
      body.writeTo(collectingSink().sink),
      body.writeTo(collectingSink().sink),
    ]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter(r => r.status === 'rejected').length).toBe(1);
  });
});

interface SinkState {
  written: number[];
  closed: boolean;
  aborted: boolean;
}

function probeSink(): {state: SinkState; sink: WritableStream<Uint8Array>} {
  const state: SinkState = {written: [], closed: false, aborted: false};
  const sink = new WritableStream<Uint8Array>({
    write: chunk => void state.written.push(...chunk),
    close: () => void (state.closed = true),
    abort: () => void (state.aborted = true),
  });
  return {state, sink};
}

describe('a mis-framed body never reaches the wire (HTTP-39/BODY-10)', () => {
  test('an overrunning chunk is refused before any of it is written', () => {
    const {state, sink} = probeSink();
    expect(
      streamBody(readableOf([1, 2, 3, 4, 5, 6, 7, 8]), undefined, 3).writeTo(
        sink,
      ),
    ).rejects.toThrow(EndOfStreamError);
    // Not [1,2,3,4,5,6,7,8]: once a transport has stamped Content-Length: 3, the surplus sits on the
    // socket where the peer reads it as the start of the next message.
    expect(state.written).toEqual([]);
    expect(state.aborted).toBe(true);
  });

  test('bytes written before the overrun stay written, the straddling chunk does not', () => {
    const {state, sink} = probeSink();
    expect(
      streamBody(readableOf([1, 2], [3, 4]), undefined, 3).writeTo(sink),
    ).rejects.toThrow(EndOfStreamError);
    expect(state.written).toEqual([1, 2]);
  });

  test('a short stream aborts the sink rather than closing it cleanly', () => {
    const {state, sink} = probeSink();
    expect(
      streamBody(readableOf([1]), undefined, 5).writeTo(sink),
    ).rejects.toThrow(EndOfStreamError);
    expect(state.aborted).toBe(true);
    expect(state.closed).toBe(false); // a truncated body is never signalled as complete
  });

  test('an exact-length stream closes the sink cleanly', async () => {
    const {state, sink} = probeSink();
    await streamBody(readableOf([1, 2, 3]), undefined, 3).writeTo(sink);
    expect(state.written).toEqual([1, 2, 3]);
    expect(state.closed).toBe(true);
    expect(state.aborted).toBe(false);
  });
});

describe('StreamBody media type and failure propagation', () => {
  test('rejects a media type carrying CR/LF (HTTP-26/HTTP-51)', () => {
    expect(() =>
      streamBody(readableOf([1]), 'text/plain\r\nX-Injected: pwned'),
    ).toThrow(MediaTypeParseError);
  });

  test('surfaces the sink failure, not a close TypeError (RECOV-12)', () => {
    const sink = new WritableStream<Uint8Array>({
      write: () => {
        throw new Error('SOCKET GONE');
      },
    });
    expect(
      streamBody(readableOf([1, 2]), undefined, 2).writeTo(sink),
    ).rejects.toThrow('SOCKET GONE');
  });
});
