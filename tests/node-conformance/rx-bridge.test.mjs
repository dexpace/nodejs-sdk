// SPDX-License-Identifier: MIT
// tests/node-conformance/rx-bridge.test.mjs
//
// Phase 8b's runtime-divergent surface, run against the BUILT artifact on real Node.
//
// `@dexpace/rx` is four one-line wrappers over `fromAsyncIterable`, and the whole reason that module is
// hand-written rather than `rxjs`'s own `from()` is a cancellation path whose behavior is decided by the
// runtime, not by this package:
//   1. Unsubscribing while a pull is suspended must reach the source. Whether that release lands depends on
//      Node's Web Streams `cancel()` and on Node's async-generator `return()` queueing behind an in-flight
//      `next()` -- both independent implementations of Bun's, and the SSE idle case is exactly the state a
//      long-lived event stream sits in almost all the time.
//   2. The release ordering the bridge relies on (close the source, THEN return the iterator) only settles a
//      suspended pull if the runtime's `ReadableStream` cancellation rejects/resolves the pending read.
//   3. `pages$` unsubscribed mid-walk must close the in-hand page's response body (PAGE-11/PAGE-26) through
//      the same generator-return path.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {firstValueFrom, toArray} from 'rxjs';
import {
  Paginator,
  Protocol,
  Request,
  Response,
  sseStreamFrom,
  Status,
} from '@dexpace/core';
import {pageItems$, pages$, sseEvents$, typedSse$} from '@dexpace/rx';

/**
 * An SSE response whose body stays open after the given text: the reader is left suspended on the next pull,
 * which is the idle state the cancellation cases below need. `cancel()` firing is the only sanctioned way to
 * observe the release (`Response` instances are frozen, so a spy assignment throws).
 */
function openSseStream(text, onCancel) {
  const request = Request.newBuilder()
    .method('GET')
    .url('https://example.com/events')
    .build();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    cancel() {
      onCancel();
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

function closedSseStream(text) {
  const request = Request.newBuilder()
    .method('GET')
    .url('https://example.com/events')
    .build();
  const body = new ReadableStream({
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

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

describe('sseEvents$ over Node Web Streams (SSE-41, ASYNC-21)', () => {
  it('emits every parsed event in order and completes at end-of-stream', async () => {
    const stream = closedSseStream('data: one\n\ndata: two\n\n');
    const events = await firstValueFrom(sseEvents$(stream).pipe(toArray()));
    assert.deepEqual(
      events.map(event => event.data),
      [['one'], ['two']],
    );
  });

  it('releases the response body when unsubscribed while idle (ASYNC-6)', async () => {
    let cancelled = 0;
    const stream = openSseStream('data: one\n\n', () => {
      cancelled += 1;
    });

    const received = [];
    const subscription = sseEvents$(stream).subscribe({
      next: event => received.push(event.data[0]),
    });

    await settle();
    assert.deepEqual(received, ['one'], 'the first event should have arrived');
    assert.equal(cancelled, 0, 'an idle stream must stay open until cancelled');

    subscription.unsubscribe();
    await settle();
    assert.equal(cancelled, 1, 'unsubscribing must release the response body');
  });

  it('releases the response body when unsubscribed from inside next() (ASYNC-6)', async () => {
    let cancelled = 0;
    const stream = openSseStream('data: one\n\ndata: two\n\n', () => {
      cancelled += 1;
    });

    const subscription = sseEvents$(stream).subscribe({
      next: () => {
        subscription.unsubscribe();
      },
    });

    await settle();
    assert.equal(cancelled, 1);
  });

  it('fails loudly on a second subscription (SSE-26, inherited)', async () => {
    const stream = closedSseStream('data: one\n\n');
    const events$ = sseEvents$(stream);
    await firstValueFrom(events$.pipe(toArray()));
    await assert.rejects(() => firstValueFrom(events$.pipe(toArray())));
  });
});

describe('typedSse$ over Node Web Streams (SSE-33..SSE-36)', () => {
  it('decodes events and terminates on the mapper done sentinel', async () => {
    const stream = closedSseStream(
      'event: delta\ndata: 1\n\nevent: delta\ndata: 2\n\nevent: end\ndata: x\n\n',
    );
    const values = await firstValueFrom(
      typedSse$(stream, (eventName, data) =>
        eventName === 'end'
          ? {kind: 'done'}
          : {kind: 'value', value: Number(data)},
      ).pipe(toArray()),
    );
    assert.deepEqual(values, [1, 2]);
  });

  it('releases the response body when unsubscribed while idle (ASYNC-6)', async () => {
    let cancelled = 0;
    const stream = openSseStream('data: 100\n\n', () => {
      cancelled += 1;
    });

    const subscription = typedSse$(stream, (_eventName, data) => ({
      kind: 'value',
      value: Number(data),
    })).subscribe({next: () => undefined});

    await settle();
    assert.equal(cancelled, 0);

    subscription.unsubscribe();
    await settle();
    assert.equal(cancelled, 1);
  });
});

describe('pageItems$/pages$ over Node (PAGE-8, ASYNC-6)', () => {
  const twoPages = () => {
    const closed = [];
    let sendCount = 0;
    const transport = {
      send(request) {
        sendCount += 1;
        const page = Number(request.url.searchParams.get('page') ?? '1');
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{}'));
          },
          cancel() {
            closed.push(page);
          },
        });
        return Promise.resolve(
          Response.newBuilder()
            .request(request)
            .status(Status.of(200))
            .protocol(Protocol.HTTP_1_1)
            .body(body)
            .build(),
        );
      },
      close: () => Promise.resolve(),
    };
    const strategy = {
      parse(_response, template) {
        const page = Number(template.url.searchParams.get('page') ?? '1');
        const items = [`item_${page}_1`, `item_${page}_2`];
        if (page >= 2) {
          return Promise.resolve({items, nextRequest: undefined});
        }
        const nextUrl = new URL(template.url);
        nextUrl.searchParams.set('page', String(page + 1));
        return Promise.resolve({
          items,
          nextRequest: Request.newBuilder()
            .method(template.method)
            .url(nextUrl)
            .build(),
        });
      },
    };
    const paginator = new Paginator({
      transport,
      initialRequest: Request.newBuilder()
        .method('GET')
        .url('https://api.example.com/items?page=1')
        .build(),
      strategy,
    });
    return {paginator, closed, sendCount: () => sendCount};
  };

  it('walks every page and is cold: a second subscription re-fetches', async () => {
    const {paginator, sendCount} = twoPages();
    const items$ = pageItems$(paginator);

    assert.deepEqual(await firstValueFrom(items$.pipe(toArray())), [
      'item_1_1',
      'item_1_2',
      'item_2_1',
      'item_2_2',
    ]);
    assert.equal(sendCount(), 2);

    await firstValueFrom(items$.pipe(toArray()));
    assert.equal(
      sendCount(),
      4,
      'PAGE-8: each subscription drives a fresh walk',
    );
  });

  it('closes the in-hand page body and stops fetching on unsubscribe (PAGE-11, ASYNC-6)', async () => {
    const {paginator, closed, sendCount} = twoPages();

    await new Promise(resolve => {
      const subscription = pages$(paginator).subscribe({
        next: () => {
          subscription.unsubscribe();
          resolve();
        },
      });
    });
    await settle();

    assert.equal(sendCount(), 1, 'page 2 must never be requested');
    assert.deepEqual(closed, [1], 'page 1 body must be released');
  });
});
