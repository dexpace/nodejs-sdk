// SPDX-License-Identifier: MIT
// packages/core/src/body/materialize.test.ts
// Exercises: BODY-3/HTTP-37 (materialize-once)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {ConsumedBodyError} from './errors.js';
import {byteArrayBody} from './simple-bodies.js';
import {materialize} from './materialize.js';
import {streamBody} from './stream-body.js';

function readableOf(...bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

async function drainBody(body: {
  writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>;
}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: c => void chunks.push(c)}));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('materialize', () => {
  test('returns an already-replayable body unchanged', async () => {
    const body = byteArrayBody(Uint8Array.from([1, 2]));
    expect(await materialize(body)).toBe(body);
  });

  test('drains a single-use body into a fresh replayable ByteArrayBody', async () => {
    const materialized = await materialize(streamBody(readableOf(1, 2, 3)));
    expect(materialized.replayable).toBe(true);
    expect(materialized.kind).toBe('byte-array');
    expect([...(await drainBody(materialized))]).toEqual([1, 2, 3]);
  });

  test('the materialized body is writable more than once, byte-for-byte identical', async () => {
    const materialized = await materialize(streamBody(readableOf(9, 8)));
    expect([...(await drainBody(materialized))]).toEqual([9, 8]);
    expect([...(await drainBody(materialized))]).toEqual([9, 8]);
  });

  test('preserves the original mediaType', async () => {
    const materialized = await materialize(
      streamBody(readableOf(1), 'text/plain'),
    );
    expect(materialized.mediaType).toBe('text/plain');
  });

  test('under N concurrent callers exactly one drains; every other observes ConsumedBodyError (BODY-3)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({min: 2, max: 8}), async callers => {
        const body = streamBody(readableOf(1, 2, 3));
        const results = await Promise.allSettled(
          Array.from({length: callers}, () => materialize(body)),
        );

        const fulfilled = results.filter(r => r.status === 'fulfilled');
        expect(fulfilled.length).toBe(1);
        for (const result of results.filter(r => r.status === 'rejected')) {
          expect(result.reason).toBeInstanceOf(ConsumedBodyError);
        }
      }),
      {seed: 0x3b},
    );
  });
});
