// SPDX-License-Identifier: MIT
// packages/rx/src/pagination.test.ts
//
// Exercises: PAGE-8 (cold and repeatable: multiple subscriptions drive independent fetch sequences),
// PAGE-1 (emits every item across all pages in server order, pages$ yields whole pages),
// ASYNC-6 (unsubscribing mid-walk cancels the generator cleanly),
// ASYNC-13 (a walk failure reaches the error channel unwrapped, after the items already delivered).
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, toArray} from 'rxjs';
import {
  Paginator,
  Protocol,
  Request,
  Response,
  Status,
  type PageInfo,
  type PaginationStrategy,
  type Transport,
} from '@dexpace/core';
import {pageItems$, pages$} from './pagination.js';

function createMockTransport(): {
  transport: Transport;
  getSendCount: () => number;
} {
  let sendCount = 0;
  const transport: Transport = {
    send(req: Request): Promise<Response> {
      sendCount++;
      return Promise.resolve(
        Response.newBuilder()
          .request(req)
          .status(Status.of(200))
          .protocol(Protocol.HTTP_1_1)
          .build(),
      );
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
  return {transport, getSendCount: () => sendCount};
}

function createTwoPageStrategy(): PaginationStrategy<string> {
  return {
    parse(_response: Response, template: Request) {
      const page = Number(template.url.searchParams.get('page') ?? '1');
      const items = [`item_${String(page)}_1`, `item_${String(page)}_2`];
      if (page >= 2) {
        return Promise.resolve({items, nextRequest: undefined});
      }
      const nextUrl = new URL(template.url);
      nextUrl.searchParams.set('page', String(page + 1));
      const nextRequest = Request.newBuilder()
        .method(template.method)
        .url(nextUrl)
        .build();
      return Promise.resolve({items, nextRequest});
    },
  };
}

function createInitialRequest(): Request {
  return Request.newBuilder()
    .method('GET')
    .url('https://api.example.com/items?page=1')
    .build();
}

/** Serves page 1 normally, then fails the page-2 exchange, so a walk breaks mid-stream rather than at the head. */
function createFailingTransport(failure: Error): Transport {
  return {
    send(req: Request): Promise<Response> {
      if (Number(req.url.searchParams.get('page') ?? '1') >= 2) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        Response.newBuilder()
          .request(req)
          .status(Status.of(200))
          .protocol(Protocol.HTTP_1_1)
          .build(),
      );
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

describe('pageItems$', () => {
  test('emits every item across all pages in order', async () => {
    const {transport} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const items = await firstValueFrom(pageItems$(paginator).pipe(toArray()));
    expect(items).toEqual(['item_1_1', 'item_1_2', 'item_2_1', 'item_2_2']);
  });

  test('is cold and repeatable: two subscriptions each drive a fresh fetch sequence', async () => {
    const {transport, getSendCount} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const observable = pageItems$(paginator);
    const firstWalk = await firstValueFrom(observable.pipe(toArray()));
    expect(firstWalk).toEqual(['item_1_1', 'item_1_2', 'item_2_1', 'item_2_2']);
    expect(getSendCount()).toBe(2);

    const secondWalk = await firstValueFrom(observable.pipe(toArray()));
    expect(secondWalk).toEqual([
      'item_1_1',
      'item_1_2',
      'item_2_1',
      'item_2_2',
    ]);
    expect(getSendCount()).toBe(4); // Re-fetched both pages on second subscription
  });

  test('unsubscribing mid-walk cancels the page iteration cleanly (ASYNC-6)', async () => {
    const {transport, getSendCount} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const items: string[] = [];
    await new Promise<void>(resolve => {
      const subscription = pageItems$(paginator).subscribe({
        next(item) {
          items.push(item);
          if (items.length === 2) {
            subscription.unsubscribe();
            resolve();
          }
        },
      });
    });

    expect(items).toEqual(['item_1_1', 'item_1_2']);
    expect(getSendCount()).toBe(1); // Did not fetch page 2
  });
});

describe('pages$', () => {
  test('emits whole Page objects across all pages in order', async () => {
    const {transport} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const pages = await firstValueFrom(pages$(paginator).pipe(toArray()));
    expect(pages).toHaveLength(2);
    const p0 = pages[0];
    const p1 = pages[1];
    expect(p0).toBeDefined();
    expect(p1).toBeDefined();
    if (p0 === undefined || p1 === undefined) {
      throw new Error('expected 2 pages');
    }
    expect(p0.items).toEqual(['item_1_1', 'item_1_2']);
    expect(p0.status.code).toBe(200);
    expect(p1.items).toEqual(['item_2_1', 'item_2_2']);
    expect(p1.status.code).toBe(200);
  });

  test('is cold and repeatable for whole pages', async () => {
    const {transport, getSendCount} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const observable = pages$(paginator);
    await firstValueFrom(observable.pipe(toArray()));
    expect(getSendCount()).toBe(2);

    await firstValueFrom(observable.pipe(toArray()));
    expect(getSendCount()).toBe(4);
  });

  test('unsubscribing after page 1 cancels further fetches (ASYNC-6)', async () => {
    const {transport, getSendCount} = createMockTransport();
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const received: unknown[] = [];
    await new Promise<void>(resolve => {
      const subscription = pages$(paginator).subscribe({
        next(page) {
          received.push(page);
          subscription.unsubscribe();
          resolve();
        },
      });
    });

    expect(received).toHaveLength(1);
    expect(getSendCount()).toBe(1);
  });
});

describe('pagination error propagation (ASYNC-13)', () => {
  test('a transport failure mid-walk reaches the error channel unwrapped, after the items already delivered', async () => {
    const failure = new TypeError('the page-2 exchange failed');
    const paginator = new Paginator({
      transport: createFailingTransport(failure),
      initialRequest: createInitialRequest(),
      strategy: createTwoPageStrategy(),
    });

    const items: string[] = [];
    const errors: unknown[] = [];
    await new Promise<void>(resolve => {
      pageItems$(paginator).subscribe({
        next(item) {
          items.push(item);
        },
        error(err: unknown) {
          errors.push(err);
          resolve();
        },
      });
    });

    // Page 1's items are not rolled back by page 2's failure -- the error is a terminal signal, not an undo.
    expect(items).toEqual(['item_1_1', 'item_1_2']);
    expect(errors).toHaveLength(1);
    // The exact instance, not an RxJS-internal or PaginationError wrapper.
    expect(errors[0]).toBe(failure);
  });

  test('a strategy failure reaches pages$ error channel unwrapped', async () => {
    const failure = new RangeError('cannot parse this page');
    const {transport} = createMockTransport();
    const strategy: PaginationStrategy<string> = {
      parse(): Promise<PageInfo<string>> {
        return Promise.reject(failure);
      },
    };
    const paginator = new Paginator({
      transport,
      initialRequest: createInitialRequest(),
      strategy,
    });

    const errors: unknown[] = [];
    await new Promise<void>(resolve => {
      pages$(paginator).subscribe({
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
    expect(errors[0]).toBe(failure);
  });
});
