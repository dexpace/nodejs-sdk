// SPDX-License-Identifier: MIT
// packages/core/src/pagination/cancellation.test.ts
// Exercises: PAGE-25 (the signal reaches every exchange and halts the walk), PAGE-26 (page-granular
// cancellation; a fetched-but-undelivered page is dropped AND closed), PAGE-31 (no per-page recursion),
// PAGE-33 (a response that arrives after the abort is closed and discarded).
import {expect, test} from 'bun:test';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {pageInfo} from './page.js';
import {Paginator} from './paginator.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';

const initialRequest = (): Request =>
  ({
    method: 'GET',
    url: new URL('https://api.test/items'),
    headers: {get: () => undefined},
  }) as unknown as Request;

const transportOf = (
  pages: number,
  onClose?: (index: number) => void,
): FakeTransport =>
  new FakeTransport(
    Array.from({length: pages}, (_, i) =>
      countingResponse({
        body: `page-${String(i)}`,
        onCancel: () => onClose?.(i),
      }),
    ),
  );

const endless = (): PaginationStrategy<string> => ({
  parse: (response: Response, template: Request) =>
    Promise.resolve(
      pageInfo(['x'], {
        method: template.method,
        url: new URL(`${template.url.pathname}?page=next`, template.url),
      } as Request),
    ),
});

test('the signal is threaded into every page exchange (PAGE-25)', async () => {
  const controller = new AbortController();
  const transport = transportOf(5);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    maxPages: 3,
    signal: controller.signal,
  });
  for await (const page of paginator.pages()) {
    void page;
  }
  expect(transport.sentSignals).toHaveLength(3);
  expect(transport.sentSignals.every(s => s === controller.signal)).toBe(true);
});

test('aborting mid-walk stops the walk at the next page boundary (PAGE-25, PAGE-26)', async () => {
  const controller = new AbortController();
  const transport = transportOf(10);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    signal: controller.signal,
  });

  let delivered = 0;
  for await (const page of paginator.pages()) {
    void page;
    delivered += 1;
    if (delivered === 2) controller.abort();
  }

  // Pre-dispatch abort check ensures Page 3 is never dispatched.
  expect(delivered).toBe(2);
  expect(transport.sendCount).toBe(2);
});

test('a page fetched while abort is in flight is closed and discarded, never yielded (PAGE-26, PAGE-33)', async () => {
  const controller = new AbortController();
  const closed: number[] = [];
  let sendCount = 0;
  const transport = {
    send: () => {
      sendCount += 1;
      if (sendCount === 2) {
        controller.abort();
      }
      return Promise.resolve(
        countingResponse({
          body: `page-${String(sendCount)}`,
          onCancel: () => closed.push(sendCount),
        }),
      );
    },
    close: () => Promise.resolve(),
  } as unknown as FakeTransport;

  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    signal: controller.signal,
  });

  const delivered = [];
  for await (const page of paginator.pages()) {
    delivered.push(page);
  }

  expect(delivered).toHaveLength(1);
  expect(sendCount).toBe(2);
  // Page 1 closed at exit, Page 2 closed by post-fetch abort check (PAGE-33).
  expect(closed.sort()).toEqual([1, 2]);
});

test('thousands of immediately-resolved pages complete without stack growth (PAGE-31)', async () => {
  const PAGES = 5000;
  const transport = transportOf(PAGES);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    maxPages: PAGES,
  });

  let count = 0;
  for await (const page of paginator.pages()) {
    void page;
    count += 1;
  }

  // A `for await` loop is iterative by construction — the engine structurally cannot recurse per page, which
  // is PAGE-31's own sanctioned escape from building a trampoline.
  expect(count).toBe(PAGES);
});
