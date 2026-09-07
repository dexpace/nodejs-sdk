// SPDX-License-Identifier: MIT
// packages/core/src/pagination/paginator.test.ts
// Exercises: PAGE-1 (both views over one walk, server order across boundaries), PAGE-6 (page-lazy, zero
// exchanges before the first probe), PAGE-7 (forward-only, idempotent end probes), PAGE-8 (independent
// iterations), PAGE-9/PAGE-10 (cap), PAGE-36 (options on every page).
import {expect, test} from 'bun:test';
import {RequestOptions} from '../http/request-options.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {pageInfo, type PageInfo} from './page.js';
import {Paginator} from './paginator.js';
import {PaginationError} from './errors.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';

/** Three pages of two items each, then end. Reads a page number off a header the FakeTransport stamps. */
function threePageStrategy(): PaginationStrategy<string> {
  return {
    parse(_response: Response, template: Request): Promise<PageInfo<string>> {
      const page = Number(template.url.searchParams.get('page') ?? '1');
      const items = [`p${String(page)}i1`, `p${String(page)}i2`];
      if (page >= 3) return Promise.resolve(pageInfo(items));
      const next = template
        .newBuilder()
        .url(new URL(`https://api.test/items?page=${String(page + 1)}`))
        .build();
      return Promise.resolve(pageInfo(items, next));
    },
  };
}

/** A server that never advances: every page reports another page after it. */
function neverEndingStrategy(): PaginationStrategy<string> {
  return {
    parse(_response: Response, template: Request): Promise<PageInfo<string>> {
      return Promise.resolve(pageInfo(['x'], template));
    },
  };
}

function transportOf(pages: number): FakeTransport {
  return new FakeTransport(
    Array.from({length: pages}, (_unused, index) =>
      countingResponse({
        status: 200,
        headers: {'X-Page': String(index + 1)},
        body: '{}',
      }),
    ),
  );
}

/**
 * A `Request` stand-in carrying the two members the engine and the strategies actually touch: `url`, and a
 * `newBuilder()` chain for `PAGE-23`'s swap-only-the-URL rewrite.
 *
 * `newBuilder()` is not optional here — `threePageStrategy` below calls it on every non-terminal page, so a bare
 * `{url}` cast would fail on the first parse with `template.newBuilder is not a function`, in every test in this
 * file that walks more than one page.
 */
const requestAt = (href: string): Request =>
  ({
    url: new URL(href),
    newBuilder() {
      let target = new URL(href);
      return {
        url(next: URL) {
          target = next;
          return this;
        },
        build: () => requestAt(target.href),
      };
    },
  }) as unknown as Request;

const initialRequest = (): Request =>
  requestAt('https://api.test/items?page=1');

test('the item view flattens all pages in server order (PAGE-1)', async () => {
  const paginator = new Paginator({
    transport: transportOf(3),
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const seen: string[] = [];
  for await (const item of paginator.items()) seen.push(item);
  expect(seen).toEqual(['p1i1', 'p1i2', 'p2i1', 'p2i2', 'p3i1', 'p3i2']);
});

test('the page view yields exactly three pages with their own status and headers (PAGE-1)', async () => {
  const paginator = new Paginator({
    transport: transportOf(3),
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const pages = [];
  for await (const page of paginator.pages()) pages.push(page);
  expect(pages).toHaveLength(3);
  expect(pages.map(p => p.headers.get('X-Page'))).toEqual(['1', '2', '3']);
  expect(pages[0]?.status.code).toBe(200);
});

test('constructing the paginator and obtaining the iterator trigger zero exchanges (PAGE-6)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const iterable = paginator.items();
  const iterator = iterable[Symbol.asyncIterator]();
  expect(transport.sendCount).toBe(0);

  await iterator.next();
  expect(transport.sendCount).toBe(1);
});

test('exactly one exchange occurs per page consumed (PAGE-6)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  for await (const page of paginator.pages()) {
    void page;
  }
  expect(transport.sendCount).toBe(3);
});

test('no exchange happens past the terminal page, and end probes are idempotent (PAGE-7)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const iterator = paginator.items()[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) {
    /* drain */
  }
  expect((await iterator.next()).done).toBe(true);
  expect((await iterator.next()).done).toBe(true);
  expect(transport.sendCount).toBe(3);
});

test('two independent iterations each drive a full fetch sequence with equal results (PAGE-8)', async () => {
  const transport = transportOf(6);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const first: string[] = [];
  for await (const item of paginator.items()) first.push(item);
  const second: string[] = [];
  for await (const item of paginator.items()) second.push(item);
  expect(second).toEqual(first);
  expect(transport.sendCount).toBe(6);
});

test('the cap stops a non-advancing server at exactly N exchanges (PAGE-9)', async () => {
  const transport = transportOf(10);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: neverEndingStrategy(),
    maxPages: 4,
  });
  for await (const page of paginator.pages()) {
    void page;
  }
  expect(transport.sendCount).toBe(4);
});

test.each([0, -1, 1.5, Number.NaN])(
  'a cap of %p is rejected at construction, not lazily (PAGE-9)',
  maxPages => {
    expect(
      () =>
        new Paginator({
          transport: transportOf(1),
          initialRequest: initialRequest(),
          strategy: threePageStrategy(),
          maxPages: maxPages,
        }),
    ).toThrow(PaginationError);
  },
);

test('the default cap is effectively unbounded (PAGE-10)', async () => {
  const transport = transportOf(500);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: neverEndingStrategy(),
  });
  let count = 0;
  for await (const page of paginator.pages()) {
    void page;
    count += 1;
    if (count === 400) break;
  }
  expect(count).toBe(400);
});

test('per-call options reach every page exchange, not just the first (PAGE-36)', async () => {
  const transport = transportOf(3);
  // Deliberately NOT `RequestOptions.EMPTY`. The failure PAGE-36 guards is an engine that honours the caller's
  // options on page 1 and falls back to the default on pages 2..N — and against `EMPTY` that bug is invisible,
  // because the substituted default IS `EMPTY`. A distinctive instance makes the identity assertion bite.
  // (Use whichever HTTP-3 `newBuilder()` setter Phase 1 actually shipped; the only thing that matters here is
  // that `options !== RequestOptions.EMPTY`.)
  const options = RequestOptions.EMPTY.newBuilder().timeoutMs(1_234).build();
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
    options,
  });
  for await (const page of paginator.pages()) {
    void page;
  }
  expect(transport.sentOptions).toHaveLength(3);
  expect(transport.sentOptions.every(o => o === options)).toBe(true);
});
