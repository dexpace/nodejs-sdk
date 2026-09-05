// SPDX-License-Identifier: MIT
// packages/rx/src/sse.test.ts
//
// Exercises: SSE-41 (reactive adapter), SSE-26 (single-pass: second subscription fails loudly),
// SSE-33-36 (typed adapter mapping over reactive stream), ASYNC-21, ASYNC-6, SSE-28 (idempotent release),
// SSE-30 (quiet automatic release).
//
// The `resource ownership` blocks pin the deliberate departure from ASYNC-21's "MUST NOT close the
// caller-owned source on any termination" clause -- see the ASYNC-21 row of `docs/deviations.md`. They count
// the release the OWNED RESOURCE sees, never `SseStream.close()` calls: `close()` memoizes its release
// promise (SSE-28), so a facade-level count reads "once" no matter how many paths call it.
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, toArray} from 'rxjs';
import {
  Protocol,
  Request,
  Response,
  SseLineTooLongError,
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

/**
 * The two halves of the ONE resource `sseStreamFrom` hands the facade -- `closingBoth(source, response)` in
 * core's `sse/stream.ts`. `socket` is the byte stream's own teardown, which the platform invokes at most once
 * per stream and not at all once a producer has already ended it, so it corroborates rather than carries the
 * count.
 */
interface ReleaseCounts {
  /** `BufferedSource.close()` -> `RetentionWindow.close()` -> `reader.cancel()`. */
  source: number;
  /** `Response.close()` -> `body.cancel()`. */
  response: number;
  /** The `ReadableStream`'s own `cancel` hook. */
  socket: number;
}

interface CountingSseStream {
  readonly stream: SseStream;
  readonly releases: ReleaseCounts;
  /** Settles the first time the byte stream itself is torn down. */
  readonly socketTornDown: Promise<void>;
}

/**
 * A `ReadableStream` facade counting every `cancel()` the SDK routes through it, at both levels
 * `sseStreamFrom` uses.
 *
 * A structural double rather than a subclass, because `ResponseBuilder.body()` stores what it is handed and
 * runs no `instanceof` check. A platform `ReadableStream` cannot do this job on its own: its underlying
 * `cancel` hook is invoked at most once by specification and never at all after the producer closed the
 * controller, so a second release would collapse into the first and read as clean.
 */
function countingBody(
  bytes: ReadableStream<Uint8Array>,
  releases: ReleaseCounts,
): ReadableStream<Uint8Array> {
  const reader = (): ReadableStreamDefaultReader<Uint8Array> => {
    const real = bytes.getReader();
    return {
      closed: real.closed,
      read: () => real.read(),
      releaseLock: () => {
        real.releaseLock();
      },
      cancel: async (reason?: unknown) => {
        releases.source += 1;
        return real.cancel(reason);
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  };
  return {
    get locked(): boolean {
      return bytes.locked;
    },
    getReader: reader,
    cancel: async (reason?: unknown) => {
      releases.response += 1;
      return bytes.cancel(reason);
    },
  } as unknown as ReadableStream<Uint8Array>;
}

/**
 * An `SseStream` over a body that reports every release it is asked for.
 *
 * `ended: false` leaves the producer's controller open, which is the idle state a live event stream sits in
 * between events -- the reader stays suspended in a pull and only a cancel can settle it.
 */
function makeCountingSseStream(
  text: string,
  options: {readonly ended: boolean; readonly maxLineBytes?: number},
): CountingSseStream {
  const releases: ReleaseCounts = {source: 0, response: 0, socket: 0};
  let tornDown = (): void => undefined;
  const socketTornDown = new Promise<void>(resolve => {
    tornDown = resolve;
  });
  const bytes = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      if (options.ended) controller.close();
    },
    cancel() {
      releases.socket += 1;
      tornDown();
    },
  });
  const request = Request.newBuilder()
    .method('GET')
    .url('https://example.com/events')
    .build();
  const response = Response.newBuilder()
    .request(request)
    .status(Status.of(200))
    .protocol(Protocol.HTTP_1_1)
    .body(countingBody(bytes, releases))
    .build();
  return {
    stream: sseStreamFrom(response, {maxLineBytes: options.maxLineBytes}),
    releases,
    socketTornDown,
  };
}

/** Lets the adapter's teardown, which is driven off the microtask queue, run to completion. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 20));
};

/**
 * Awaits `promise`, failing with a line number rather than hanging when it never settles.
 *
 * The suspended-pull case regresses as a *hang*, and a bare `await` would surface that as a bare runner
 * timeout naming no assertion.
 */
async function within(ms: number, promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the teardown did not settle within ${String(ms)}ms`));
    }, ms);
  });
  try {
    await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

describe('sseEvents$ resource ownership (ASYNC-21 departure, SSE-28)', () => {
  test('end-of-source releases each half of the owned resource exactly once', async () => {
    const {stream, releases} = makeCountingSseStream(
      'data: one\n\ndata: two\n\n',
      {ended: true},
    );

    const events = await firstValueFrom(sseEvents$(stream).pipe(toArray()));

    expect(events).toHaveLength(2);
    await settle();
    // `socket: 0` is not a miss: the producer ended the byte stream, so there is nothing left for the
    // platform to tear down. The two halves the facade owns are still released, once each.
    expect(releases).toEqual({source: 1, response: 1, socket: 0});
  });

  test('a source error releases each half exactly once and surfaces the error unwrapped', async () => {
    const {stream, releases} = makeCountingSseStream(
      `data: ${'x'.repeat(64)}\n\n`,
      {ended: false, maxLineBytes: 16},
    );

    const failure = await rejection(firstValueFrom(sseEvents$(stream)));

    // SSE-29 releases before the error propagates; the adapter's own release then finds it already done.
    expect(failure).toBeInstanceOf(SseLineTooLongError);
    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 1});
  });

  test('early unsubscribe releases each half exactly once', async () => {
    const {stream, releases} = makeCountingSseStream(
      'data: one\n\ndata: two\n\ndata: three\n\n',
      {ended: false},
    );

    const subscription = sseEvents$(stream).subscribe({
      next() {
        subscription.unsubscribe();
      },
    });

    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 1});
  });

  test('unsubscribing while a pull is suspended settles the teardown', async () => {
    const {stream, releases, socketTornDown} = makeCountingSseStream(
      'data: one\n\n',
      {ended: false},
    );
    const received: string[] = [];
    const subscription = sseEvents$(stream).subscribe({
      next(event) {
        const item = event.data[0];
        if (item !== undefined) received.push(item);
      },
    });

    await settle();
    expect(received).toEqual(['one']);
    expect(releases.socket).toBe(0);

    // The server will never send another byte, so the reader is parked in a pull. Only the release running
    // AHEAD of `iterator.return()` settles it -- a `return()` on an async generator queues behind the
    // in-flight `next()`. Drop the release from `sseEvents$` and this never resolves.
    subscription.unsubscribe();
    await within(500, socketTornDown);

    // `socketTornDown` fires inside the source half; the response half follows it (release order is reverse
    // acquisition), so let the rest of the teardown run before counting.
    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 1});
  });
});

describe('typedSse$ resource ownership (ASYNC-21 departure, SSE-28)', () => {
  test('end-of-source releases each half of the owned resource exactly once', async () => {
    const {stream, releases} = makeCountingSseStream('data: 1\n\ndata: 2\n\n', {
      ended: true,
    });

    const values = await firstValueFrom(
      typedSse$(stream, (_event, data) => ({
        kind: 'value',
        value: Number(data),
      })).pipe(toArray()),
    );

    expect(values).toEqual([1, 2]);
    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 0});
  });

  test('a throwing mapper releases each half exactly once (SSE-36)', async () => {
    const {stream, releases} = makeCountingSseStream('data: one\n\n', {
      ended: false,
    });

    // Three release paths converge here: `runMapper`'s explicit `close()`, the adapter's `release`, and the
    // mapping generator's `return()` unwinding into the facade's own quiet release.
    const failure = await rejection(
      firstValueFrom(
        typedSse$(stream, () => {
          throw new TypeError('mapper blew up');
        }),
      ),
    );

    expect(failure).toBeInstanceOf(TypeError);
    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 1});
  });

  test('unsubscribing while a pull is suspended settles the teardown through the mapping generator', async () => {
    const {stream, releases, socketTornDown} = makeCountingSseStream(
      'data: 100\n\n',
      {ended: false},
    );
    const subscription = typedSse$(stream, (_event, data) => ({
      kind: 'value',
      value: Number(data),
    })).subscribe({
      next() {
        // ignore
      },
    });

    await settle();
    expect(releases.socket).toBe(0);

    subscription.unsubscribe();
    await within(500, socketTornDown);

    // `socketTornDown` fires inside the source half; the response half follows it (release order is reverse
    // acquisition), so let the rest of the teardown run before counting.
    await settle();
    expect(releases).toEqual({source: 1, response: 1, socket: 1});
  });
});
