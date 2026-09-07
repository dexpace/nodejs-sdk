// SPDX-License-Identifier: MIT
// packages/core/src/sse/stream.test.ts
// Exercises: SSE-23 (exactly one close across every termination path), SSE-24 (clean end releases),
// SSE-25 (partial consume releases), SSE-26 (single-pass), SSE-27 (post-close and mid-flight close),
// SSE-28 (idempotent close), SSE-29 (mid-stream failure releases first, close error suppressed),
// SSE-30 (auto-terminal release failure swallowed vs explicit close propagating), SSE-31 (close during a
// pending read surfaces as a read failure), SSE-32 (bodyless response), SSE-39 (no read-ahead).
import {expect, test} from 'bun:test';
import {BufferedSource} from '../io/buffered-source.js';
import {IoError} from '../io/errors.js';
import {suppress, type SuppressedErrorLike} from '../suppress.js';
import {SseStreamError} from './errors.js';
import type {SseEvent} from './event.js';
import {SseParser} from './parser.js';
import {SseStream, sseStreamFrom, type SseResource} from './stream.js';

function streamOver(
  text: string,
  closeImpl?: () => Promise<void>,
): {stream: SseStream; closes: () => number} {
  let closeCount = 0;
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const parser = new SseParser(BufferedSource.overStream(web));
  const resource = {
    async close(): Promise<void> {
      closeCount += 1;
      if (closeImpl !== undefined) await closeImpl();
    },
  };
  return {stream: new SseStream(parser, resource), closes: () => closeCount};
}

test('a fully consumed stream releases without an explicit close (SSE-24)', async () => {
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\n');
  const seen = [];
  for await (const event of stream) seen.push(event.data[0]);
  expect(seen).toEqual(['a', 'b']);
  expect(closes()).toBe(1);
});

test('a partial consume followed by close releases exactly once (SSE-25, SSE-23)', async () => {
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\ndata: c\n\n');
  for await (const event of stream) {
    void event;
    break;
  }
  await stream.close();
  expect(closes()).toBe(1);
});

test('an early break alone releases, via the iterator protocol (SSE-25)', async () => {
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\n');
  for await (const event of stream) {
    void event;
    break;
  }
  expect(closes()).toBe(1);
});

test('close is idempotent — three calls release once (SSE-28)', async () => {
  const {stream, closes} = streamOver('data: a\n\n');
  await stream.close();
  await stream.close();
  await stream.close();
  expect(closes()).toBe(1);
});

test('close after an automatic release keeps the count at one (SSE-28)', async () => {
  const {stream, closes} = streamOver('data: a\n\n');
  for await (const event of stream) {
    void event;
  }
  await stream.close();
  expect(closes()).toBe(1);
});

test('the stream is single-pass — a second iterator throws (SSE-26)', () => {
  const {stream} = streamOver('data: a\n\n');
  stream[Symbol.asyncIterator]();
  expect(() => stream[Symbol.asyncIterator]()).toThrow(SseStreamError);
});

test('requesting an iterator after close throws (SSE-27)', async () => {
  const {stream} = streamOver('data: a\n\n');
  await stream.close();
  expect(() => stream[Symbol.asyncIterator]()).toThrow(SseStreamError);
});

test('a close observed between pulls ends iteration cleanly (SSE-27, SSE-31)', async () => {
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\ndata: c\n\n');
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  await stream.close();
  expect((await iterator.next()).done).toBe(true);
  expect(closes()).toBe(1);
});

test('an explicit close whose release fails propagates (SSE-30)', () => {
  const {stream} = streamOver('data: a\n\n', () =>
    Promise.reject(new IoError('close failed')),
  );
  expect(stream.close()).rejects.toBeInstanceOf(IoError);
});

test('a release failure on the clean-terminal path is swallowed, not thrown (SSE-30)', async () => {
  const reported: unknown[] = [];
  let closeCount = 0;
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: a\n\ndata: b\n\n'));
      controller.close();
    },
  });
  const stream = new SseStream(
    new SseParser(BufferedSource.overStream(web)),
    {
      close(): Promise<void> {
        closeCount += 1;
        return Promise.reject(new IoError('close failed'));
      },
    },
    {onReleaseFailure: e => reported.push(e)},
  );

  const seen = [];
  for await (const event of stream) seen.push(event.data[0]);

  // Every delivered event survives; the failure is reported out-of-band instead of discarding them.
  expect(seen).toEqual(['a', 'b']);
  expect(reported).toHaveLength(1);
  expect(closeCount).toBe(1);
});

test('a mid-stream read failure releases before propagating, with the close error suppressed (SSE-29)', async () => {
  const readFailure = new IoError('socket reset');
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: a\n\n'));
      controller.error(readFailure);
    },
  });
  let closeCount = 0;
  const closeFailure = new IoError('close failed too');
  const stream = new SseStream(new SseParser(BufferedSource.overStream(web)), {
    close(): Promise<void> {
      closeCount += 1;
      return Promise.reject(closeFailure);
    },
  });

  let caught: unknown;
  try {
    for await (const event of stream) {
      void event;
    }
  } catch (e: unknown) {
    caught = e;
  }

  const suppressed = caught as SuppressedErrorLike;
  expect(suppressed.name).toBe('SuppressedError');
  expect(suppressed.error).toBe(readFailure);
  expect(suppressed.suppressed).toBe(closeFailure);
  expect(closeCount).toBe(1);
});

test('a release failure during an in-flight error is reported exactly once (SSE-29, SSE-30)', async () => {
  const readFailure = new IoError('socket reset');
  const closeFailure = new IoError('close failed too');
  const reported: unknown[] = [];
  let closeCount = 0;
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: a\n\n'));
      controller.error(readFailure);
    },
  });
  const stream = new SseStream(
    new SseParser(BufferedSource.overStream(web)),
    {
      close(): Promise<void> {
        closeCount += 1;
        return Promise.reject(closeFailure);
      },
    },
    {onReleaseFailure: e => reported.push(e)},
  );

  let caught: unknown;
  try {
    for await (const event of stream) {
      void event;
    }
  } catch (e: unknown) {
    caught = e;
  }

  const suppressed = caught as SuppressedErrorLike;
  expect(suppressed.error).toBe(readFailure);
  expect(suppressed.suppressed).toBe(closeFailure);
  // SSE-30 scopes the hook to the automatic CLEAN terminal path. With an error already in flight the
  // release failure is on the thrown error, and calling the hook as well makes one failure arrive
  // twice — once in whatever logs `onReleaseFailure`, once in whatever logs the caught error.
  expect(reported).toEqual([]);
  expect(closeCount).toBe(1);
});

test('sseStreamFrom binds lifecycle to the response body (SSE-32)', async () => {
  let responseClosed = 0;
  const response = {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: a\n\n'));
        controller.close();
      },
    }),
    close(): Promise<void> {
      responseClosed += 1;
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  for await (const event of sseStreamFrom(response)) {
    void event;
  }
  expect(responseClosed).toBe(1);
});

test('the disposal member releases exactly once where the runtime has it (styleguide 13.1/13.2)', async () => {
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\n');
  const asyncDispose = (Symbol as {asyncDispose?: symbol}).asyncDispose;

  if (typeof asyncDispose !== 'symbol') {
    // The pinned runtime floor (Node 20.3) predates Symbol.asyncDispose (Node 20.4).
    await stream.close();
    expect(closes()).toBe(1);
    return;
  }

  const dispose = (
    stream as unknown as Record<symbol, (() => Promise<void>) | undefined>
  )[asyncDispose];
  expect(dispose).toBeDefined();

  for await (const event of stream) {
    void event;
    break;
  }
  await dispose?.call(stream);
  expect(closes()).toBe(1);

  // Dispose delegates to close, so it inherits close's idempotence rather than adding a second guard.
  await stream.close();
  expect(closes()).toBe(1);
});

test('aborting the signal closes the stream, ending an idle iterator cleanly (SSE-25, SSE-27)', async () => {
  let responseClosed = 0;
  // The abort listener deliberately discards its close promise, so the test needs its own completion signal
  // rather than a timer — `new Promise` with a synchronous executor adapting a callback is the sanctioned form.
  let markClosed = (): void => undefined;
  const closed = new Promise<void>(resolve => {
    markClosed = resolve;
  });

  const controller = new AbortController();
  const response = {
    body: new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(
          new TextEncoder().encode('data: a\n\ndata: b\n\n'),
        );
        streamController.close();
      },
    }),
    close(): Promise<void> {
      responseClosed += 1;
      markClosed();
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  const stream = sseStreamFrom(response, {signal: controller.signal});
  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect((first.value as SseEvent | undefined)?.data).toEqual(['a']);

  controller.abort();
  await closed;

  expect(responseClosed).toBe(1);
  expect((await iterator.next()).done).toBe(true);
});

test('sseStreamFrom releases the byte source as well as the response (SSE-23, SSE-32)', async () => {
  // docs/knowledge/harvested/sse-streaming.md:84 — the facade's release must reach `response.body.cancel()` exactly once.
  // The BufferedSource holds the reader lock on that body, so unless the facade closes the *source*, a real
  // Response.close() would be cancelling a locked stream. A close-counting double cannot catch this; asserting
  // the body's own cancel hook fired is what does.
  let bodyCancelled = 0;
  let responseClosed = 0;
  const response = {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: a\n\n'));
      },
      cancel() {
        bodyCancelled += 1;
      },
    }),
    close(): Promise<void> {
      responseClosed += 1;
      return Promise.resolve();
    },
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  const stream = sseStreamFrom(response);
  for await (const event of stream) {
    void event;
    break;
  }
  await stream.close();

  expect(bodyCancelled).toBe(1);
  expect(responseClosed).toBe(1);
});

test('sseStreamFrom fails loudly on a bodyless response (SSE-32)', () => {
  const response = {
    body: null,
    close: () => Promise.resolve(),
  } as unknown as Parameters<typeof sseStreamFrom>[0];
  expect(() => sseStreamFrom(response)).toThrow(SseStreamError);
});

test('delivery is pull-based: no event is parsed before the consumer asks (SSE-39)', async () => {
  let delivered = 0;
  const web = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        delivered += 1;
        if (delivered > 3) {
          controller.close();
          return;
        }
        controller.enqueue(
          new TextEncoder().encode(`data: ${String(delivered)}\n\n`),
        );
      },
    },
    {highWaterMark: 0},
  );
  const stream = new SseStream(new SseParser(BufferedSource.overStream(web)), {
    close: () => Promise.resolve(),
  });

  const iterator = stream[Symbol.asyncIterator]();
  const before = delivered;
  await iterator.next();
  // One consumer pull draws at most one source chunk beyond whatever the stream had already buffered.
  expect(delivered - before).toBeLessThanOrEqual(1);
  await stream.close();
});

test('close during a pending read surfaces as an IoError, releasing exactly once (SSE-31)', async () => {
  let closeCount = 0;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  // A source that delivers one event and then never resolves again — so the second pull is genuinely pending
  // when the close lands, rather than racing a queued chunk.
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      controller.enqueue(new TextEncoder().encode('data: a\n\n'));
    },
  });
  const source = BufferedSource.overStream(web);
  const stream = new SseStream(new SseParser(source), {
    async close(): Promise<void> {
      closeCount += 1;
      await source.close();
    },
  });

  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect((first.value as SseEvent | undefined)?.data).toEqual(['a']);

  const pending = iterator.next();
  await stream.close();

  expect(pending).rejects.toBeInstanceOf(IoError);
  expect(closeCount).toBe(1);
  expect(controllerRef).toBeDefined();
});

test('normal stream close removes the abort event listener from the signal', async () => {
  const controller = new AbortController();
  let addCount = 0;
  let removeCount = 0;
  const originalAdd = controller.signal.addEventListener.bind(
    controller.signal,
  );
  const originalRemove = controller.signal.removeEventListener.bind(
    controller.signal,
  );
  controller.signal.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void => {
    if (type === 'abort') addCount++;
    originalAdd(type, listener, options);
  };
  controller.signal.removeEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void => {
    if (type === 'abort') removeCount++;
    originalRemove(type, listener, options);
  };

  const response = {
    body: new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('data: hello\n\n'));
        streamController.close();
      },
    }),
    close: () => Promise.resolve(),
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  const stream = sseStreamFrom(response, {signal: controller.signal});
  expect(addCount).toBe(1);
  expect(removeCount).toBe(0);

  for await (const event of stream) {
    void event;
  }
  expect(removeCount).toBe(1);
});

test('close() awaits in-flight quiet release and propagates any release error (SSE-30)', async () => {
  let releaseStarted = false;
  let releaseFinished = false;
  let finishRelease: (err?: Error) => void = (): void => undefined;
  const releasePromise = new Promise<void>((resolve, reject) => {
    finishRelease = (err?: Error): void => {
      releaseFinished = true;
      if (err) reject(err);
      else resolve();
    };
  });

  const resource: SseResource = {
    close(): Promise<void> {
      releaseStarted = true;
      return releasePromise;
    },
  };

  const stream = new SseStream(
    new SseParser(
      BufferedSource.overStream(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
            controller.close();
          },
        }),
      ),
    ),
    resource,
  );

  const iterator = stream[Symbol.asyncIterator]();
  const first = await iterator.next();
  expect((first.value as SseEvent | undefined)?.data).toEqual(['1']);

  // Next pull drives past EOF into #releaseQuietly, which awaits releasePromise
  const pendingNext = iterator.next();
  // Microtask tick to ensure #releaseQuietly is entered
  await new Promise(r => setTimeout(r, 5));
  expect(releaseStarted).toBe(true);
  expect(releaseFinished).toBe(false);

  // Calling close() while release is in flight awaits that same promise and propagates its error
  const closePromise = stream.close();
  const testError = new Error('teardown failed');
  finishRelease(testError);

  expect(closePromise).rejects.toThrow(testError);
  await pendingNext;
  expect(releaseFinished).toBe(true);
});

test('closingBoth attaches response close failure as suppressed when source close also fails', async () => {
  const sourceError = new Error('source failed');
  const responseError = new Error('response failed');

  const failingSource = {
    close() {
      return Promise.reject(sourceError);
    },
  } as unknown as BufferedSource;

  const failingResponse = {
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    }),
    close() {
      return Promise.reject(responseError);
    },
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  const stream = new SseStream(
    new SseParser(
      BufferedSource.overStream(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          },
        }),
      ),
    ),
    {
      async close(): Promise<void> {
        let sourceFailure: unknown;
        let sourceFailed = false;
        try {
          await failingSource.close();
        } catch (e: unknown) {
          sourceFailure = e;
          sourceFailed = true;
        }
        try {
          await failingResponse.close();
        } catch (responseFailure: unknown) {
          if (sourceFailed) {
            throw suppress(sourceFailure, responseFailure, 'both failed');
          }
          throw responseFailure;
        }
        if (sourceFailed) throw sourceFailure;
      },
    },
  );

  let caught: unknown;
  try {
    await stream.close();
  } catch (e: unknown) {
    caught = e;
  }
  expect((caught as SuppressedErrorLike).error).toBe(sourceError);
  expect((caught as SuppressedErrorLike).suppressed).toBe(responseError);
});

test('bindAbort routes release failure to onReleaseFailure', async () => {
  let releaseFailure: unknown;
  const controller = new AbortController();
  const closeError = new Error('abort close failed');

  const response = {
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: 1\n\n'));
      },
    }),
    close: () => Promise.reject(closeError),
  } as unknown as Parameters<typeof sseStreamFrom>[0];

  const stream = sseStreamFrom(response, {
    signal: controller.signal,
    onReleaseFailure: err => {
      releaseFailure = err;
    },
  });
  void stream;

  controller.abort();
  // Allow microtasks to settle
  await new Promise(r => setTimeout(r, 10));

  expect(releaseFailure).toBe(closeError);
});
