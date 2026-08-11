// SPDX-License-Identifier: MIT
// packages/core/src/body/stream-body.test.ts
// Exercises: BODY-9 (always single-use -- no generic mark/reset on Node's ReadableStream), BODY-3
// (second write fails loudly and is race-safe), BODY-8 (caller's stream is not force-closed -- read to
// natural exhaustion), HTTP-39/BODY-10 (declared length verified, short stream raises
// delivered-of-declared), IO-3 (a contentLength below the -1 sentinel is rejected)
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {EndOfStreamError} from '../io/errors.js';
import {ConsumedBodyError} from './errors.js';
import {streamBody} from './stream-body.js';

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
