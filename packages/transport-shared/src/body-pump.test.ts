// SPDX-License-Identifier: MIT
// packages/transport-shared/src/body-pump.test.ts
// Exercises: TRANSPORT-17 (a body is written exactly once), TRANSPORT-19 (an abandoned streaming
// producer is unblocked, teardown idempotent), BODY-8 (the sink's creator owns closing it)
import {describe, expect, test} from 'bun:test';
import {byteArrayBody, type Body} from '@dexpace/core';
import {
  isMaterializable,
  materializeBody,
  producerFailure,
  pumpBody,
} from './body-pump.js';

function countingBody(closesSink: boolean): Body & {readonly writes: number[]} {
  const writes: number[] = [];
  return {
    kind: 'stream',
    mediaType: 'text/plain',
    contentLength: -1,
    replayable: false,
    writes,
    async writeTo(sink) {
      writes.push(1);
      const writer = sink.getWriter();
      await writer.write(new TextEncoder().encode('ab'));
      if (closesSink) await writer.close();
      else writer.releaseLock();
    },
  };
}

/** Awaits `pending` and hands back its rejection reason, so the assertion stays ordered. */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(new TextDecoder().decode(value));
  }
  return parts.join('');
}

describe('pumpBody', () => {
  test('terminates the stream for a body that closes the sink it was given', async () => {
    const body = countingBody(true);
    const pump = pumpBody(body);
    expect(await drain(pump.readable)).toBe('ab');
    await pump.done;
    expect(body.writes.length).toBe(1);
  });

  test('terminates the stream for a body that leaves the sink open (BODY-8)', async () => {
    // @dexpace/body-file's writeTo releases its lock without closing; the pump must still end the
    // stream, or the native client waits forever on a request body that never finishes.
    const pump = pumpBody(countingBody(false));
    expect(await drain(pump.readable)).toBe('ab');
    await pump.done;
  });

  test('a producer failure rejects `done` rather than hanging the stream', async () => {
    const body: Body = {
      kind: 'stream',
      mediaType: undefined,
      contentLength: -1,
      replayable: false,
      writeTo() {
        return Promise.reject(new Error('producer exploded'));
      },
    };
    const pump = pumpBody(body);
    expect(await rejection(pump.done)).toMatchObject({
      message: 'producer exploded',
    });
    expect(await rejection(drain(pump.readable))).toBeDefined();
  });

  test('abandon unblocks a producer that would otherwise never finish, idempotently', async () => {
    let unblocked = false;
    const body: Body = {
      kind: 'stream',
      mediaType: undefined,
      contentLength: -1,
      replayable: false,
      async writeTo(sink) {
        const writer = sink.getWriter();
        try {
          // No reader ever drains this, so the second write parks on backpressure forever unless
          // abandon() aborts the writer underneath it (TRANSPORT-19).
          for (;;) await writer.write(new Uint8Array(64 * 1024));
        } finally {
          unblocked = true;
        }
      },
    };
    const pump = pumpBody(body);
    await pump.abandon(new Error('send failed'));
    await pump.abandon(new Error('send failed'));
    expect(unblocked).toBe(true);
  });
});

describe('producerFailure', () => {
  /** Settles `pending` against a marker, so "never settles" is observable without hanging the row. */
  async function raceWithTimeout(pending: Promise<never>): Promise<string> {
    return Promise.race([
      pending.then(
        () => 'resolved',
        (error: unknown) => `rejected: ${(error as Error).message}`,
      ),
      new Promise<string>(resolve =>
        setTimeout(() => {
          resolve('pending');
        }, 50),
      ),
    ]);
  }

  test('never settles when there is no streamed producer', async () => {
    expect(await raceWithTimeout(producerFailure(undefined))).toBe('pending');
  });

  test('never settles when the producer succeeds', async () => {
    // A producer finishing says nothing about the response, so this must not win a `Promise.race`
    // against a dispatch that is still in flight.
    expect(await raceWithTimeout(producerFailure(Promise.resolve()))).toBe(
      'pending',
    );
  });

  test('carries the producer failure onward', async () => {
    const done = Promise.reject(new Error('producer exploded'));
    expect(await raceWithTimeout(producerFailure(done))).toBe(
      'rejected: producer exploded',
    );
  });

  test('keeps a handler on a rejection that lands after the race settled', async () => {
    // The delivery-path guarantee, at its source: once `Promise.race` has attached to this promise,
    // a producer that fails later is an observed rejection rather than one that reaches the
    // runtime's default `unhandledRejection` policy. A leak here fails the row on both runners.
    let fail!: (error: Error) => void;
    const done = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    const raced = await Promise.race([
      producerFailure(done),
      new Promise<string>(resolve =>
        setTimeout(() => {
          resolve('delivered');
        }, 10),
      ),
    ]);
    expect(raced).toBe('delivered');
    fail(new Error('late producer failure'));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
});

describe('materializeBody / isMaterializable', () => {
  test('collects every chunk in order', async () => {
    const bytes = await materializeBody(
      byteArrayBody(new Uint8Array([1, 2, 3])),
    );
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  test('classifies by replayability and declared length', () => {
    const small = byteArrayBody(new Uint8Array([1]));
    expect(isMaterializable(small, 10)).toBe(true);
    expect(isMaterializable(small, 0)).toBe(false);
    expect(isMaterializable(countingBody(true), 10)).toBe(false);
  });
});
