// SPDX-License-Identifier: MIT
// packages/rx/src/sse.test.ts
//
// Exercises: SSE-41 (reactive adapter), SSE-26 (single-pass: second subscription fails loudly),
// SSE-33-36 (typed adapter mapping over reactive stream), ASYNC-21, ASYNC-6.
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, toArray} from 'rxjs';
import {
  Protocol,
  Request,
  Response,
  SseStream,
  SseStreamError,
  sseStreamFrom,
  Status,
} from '@dexpace/core';
import {sseEvents$, typedSse$} from './sse.js';

/** Distinguishes "the promise resolved" from a rejection value that happens to be falsy. */
const RESOLVED = Symbol('resolved');

/**
 * Settles `promise` and hands back whatever it rejected with.
 *
 * `expect(p).rejects.toX()` is typed `void` under `bun:test`, so awaiting it trips `await-thenable` -- the same
 * idiom `@dexpace/codec-json`'s `json-serde.test.ts` settled on.
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return RESOLVED;
  } catch (e: unknown) {
    return e;
  }
}

function makeSseStreamFixture(text: string): SseStream {
  const request = Request.newBuilder()
    .method('GET')
    .url('https://example.com/events')
    .build();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const response = Response.newBuilder()
    .request(request)
    .status(Status.of(200))
    .protocol(Protocol.HTTP_1_1)
    .body(body)
    .build();
  return sseStreamFrom(response);
}

function makeUnclosedSseStream(text: string, onCancel?: () => void): SseStream {
  const request = Request.newBuilder()
    .method('GET')
    .url('https://example.com/events')
    .build();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    cancel() {
      onCancel?.();
    },
  });
  const response = Response.newBuilder()
    .request(request)
    .status(Status.of(200))
    .protocol(Protocol.HTTP_1_1)
    .body(body)
    .build();
  return sseStreamFrom(response);
}

describe('sseEvents$', () => {
  test('emits every parsed SseEvent in order and completes at end-of-stream', async () => {
    const stream = makeSseStreamFixture('data: one\n\ndata: two\n\n');
    const events = await firstValueFrom(sseEvents$(stream).pipe(toArray()));
    expect(events.map(e => e.data)).toEqual([['one'], ['two']]);
  });

  test('a second subscription fails loudly (SSE-26, inherited)', async () => {
    const stream = makeSseStreamFixture('data: one\n\n');
    const observable = sseEvents$(stream);
    await firstValueFrom(observable.pipe(toArray()));

    // SseStream's own single-pass guard, surfaced through the error channel rather than reimplemented.
    expect(
      await rejection(firstValueFrom(observable.pipe(toArray()))),
    ).toBeInstanceOf(SseStreamError);
  });

  test('unsubscribing mid-stream synchronously releases the underlying stream resource', async () => {
    let cancelCalled = false;
    const stream = makeUnclosedSseStream(
      'data: one\n\ndata: two\n\ndata: three\n\n',
      () => {
        cancelCalled = true;
      },
    );
    const subscription = sseEvents$(stream).subscribe({
      next(event) {
        if (event.data[0] === 'one') {
          subscription.unsubscribe();
        }
      },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(cancelCalled).toBe(true);
  });

  test('unsubscribing asynchronously while idle releases the underlying stream resource (ASYNC-6)', async () => {
    let cancelCalled = false;
    const stream = makeUnclosedSseStream('data: one\n\n', () => {
      cancelCalled = true;
    });
    const received: string[] = [];
    const subscription = sseEvents$(stream).subscribe({
      next(event) {
        const item = event.data[0];
        if (item !== undefined) {
          received.push(item);
        }
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(received).toEqual(['one']);
    expect(cancelCalled).toBe(false);

    subscription.unsubscribe();
    await new Promise(r => setTimeout(r, 20));
    expect(cancelCalled).toBe(true);
  });
});

describe('typedSse$', () => {
  test('decodes events and honors Value, Skip, and Done outcomes', async () => {
    const stream = makeSseStreamFixture(
      ':ping\n\nevent: delta\ndata: {"num":1}\n\nevent: delta\ndata: {"num":2}\n\nevent: done\ndata: end\n\ndata: ignored\n\n',
    );
    const observable = typedSse$(stream, (event, data) => {
      if (event === undefined) return {kind: 'skip'};
      if (event === 'done') return {kind: 'done'};
      const parsed = JSON.parse(data) as {num: number};
      return {kind: 'value', value: parsed.num};
    });

    const values = await firstValueFrom(observable.pipe(toArray()));
    expect(values).toEqual([1, 2]);
  });

  test('a throwing mapper propagates error through the Observable error channel', async () => {
    const stream = makeSseStreamFixture('data: invalid-json\n\n');
    const observable = typedSse$(stream, (_event, data) => {
      if (data === 'invalid-json') {
        throw new TypeError('invalid json payload');
      }
      return {kind: 'value', value: data};
    });

    const errors: unknown[] = [];
    await new Promise<void>(resolve => {
      observable.subscribe({
        next() {
          // ignore
        },
        error(err: unknown) {
          errors.push(err);
          resolve();
        },
      });
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect((errors[0] as TypeError).message).toBe('invalid json payload');
  });

  test('unsubscribing asynchronously from typedSse$ releases the underlying stream (ASYNC-6)', async () => {
    let cancelCalled = false;
    const stream = makeUnclosedSseStream('data: 100\n\n', () => {
      cancelCalled = true;
    });
    const subscription = typedSse$(stream, (_e, d) => ({
      kind: 'value',
      value: Number(d),
    })).subscribe({
      next() {
        // ignore
      },
    });

    await new Promise(r => setTimeout(r, 10));
    expect(cancelCalled).toBe(false);

    subscription.unsubscribe();
    await new Promise(r => setTimeout(r, 20));
    expect(cancelCalled).toBe(true);
  });
});
