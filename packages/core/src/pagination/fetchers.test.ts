// SPDX-License-Identifier: MIT
// packages/core/src/pagination/fetchers.test.ts
// Exercises: PAGE-34 (first fetcher runs once; next keys off nextLink with token fallback; blank link or
// undefined page terminates; a fetcher builds a page it does not close), PAGE-35 (one shared mutable options
// instance threaded through every call).
import {expect, test} from 'bun:test';
import {Page} from './page.js';
import {PaginationError} from './errors.js';
import {paginateWithFetchers, type PagingOptions} from './fetchers.js';
import type {Response} from '../http/response.js';

function fakePage<T>(items: readonly T[], onClose: () => void): Page<T> {
  let closed = false;
  const response = {
    status: {code: 200},
    headers: {get: () => undefined},
    request: {},
    close(): Promise<void> {
      if (!closed) {
        closed = true;
        onClose();
      }
      return Promise.resolve();
    },
  } as unknown as Response;
  return new Page(response, items);
}

test('the first fetcher runs exactly once and the next keys off nextLink (PAGE-34)', async () => {
  let firstCalls = 0;
  const nextLinks: string[] = [];
  const iterable = paginateWithFetchers<string>({
    first: () => {
      firstCalls += 1;
      return Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/p2',
      });
    },
    next: link => {
      nextLinks.push(link);
      return Promise.resolve({page: fakePage(['b'], () => undefined)});
    },
  });

  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);

  expect(firstCalls).toBe(1);
  expect(nextLinks).toEqual(['/p2']);
  expect(seen).toEqual(['a', 'b']);
});

test('the continuation token is used only when no next link is present — link wins (PAGE-34)', async () => {
  const keys: string[] = [];
  let nextCalls = 0;
  const iterable = paginateWithFetchers<string>({
    // Page 1 offers BOTH a link and a token; the link must win.
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/p2',
        continuationToken: 'tok-2',
      }),
    next: key => {
      keys.push(key);
      nextCalls += 1;
      return nextCalls === 1
        ? Promise.resolve({
            page: fakePage(['b'], () => undefined),
            // Page 2 offers ONLY a token; now the token must be used.
            continuationToken: 'tok-3',
          })
        : Promise.resolve(undefined);
    },
  });

  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);

  expect(seen).toEqual(['a', 'b']);
  expect(keys).toEqual(['/p2', 'tok-3']);
});

test('a blank, whitespace-only, or undefined nextLink ends the stream (PAGE-34)', async () => {
  let calls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '   ',
      }),
    next: () => {
      calls += 1;
      return Promise.resolve({page: fakePage(['b'], () => undefined)});
    },
  });

  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);

  expect(seen).toEqual(['a']);
  expect(calls).toBe(0);
});

test('an undefined first-page result yields an empty stream (PAGE-34)', async () => {
  const iterable = paginateWithFetchers<string>({
    first: () => Promise.resolve(undefined),
    next: () => Promise.resolve(undefined),
  });

  const seen = [];
  for await (const page of iterable) seen.push(page);

  expect(seen).toEqual([]);
});

test('an undefined page from the next fetcher ends the stream (PAGE-34)', async () => {
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/p2',
      }),
    next: () => Promise.resolve(undefined),
  });
  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);
  expect(seen).toEqual(['a']);
});

test('options bag is passed to first and next as the identical mutable instance (PAGE-35)', async () => {
  const received: (PagingOptions | undefined)[] = [];
  const iterable = paginateWithFetchers<string>({
    first: options => {
      received.push(options);
      options.custom = 'stashed';
      return Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/p2',
      });
    },
    next: (_link, options) => {
      received.push(options);
      return Promise.resolve({page: fakePage(['b'], () => undefined)});
    },
  });

  for await (const page of iterable) {
    void page;
  }

  expect(received[0]).toBe(received[1]);
  expect(received[1]?.custom).toBe('stashed');
});

test('options.nextLink and options.continuationToken are populated before next() call (PAGE-34, PAGE-35)', async () => {
  const optionsSeen: PagingOptions[] = [];
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/p2',
        continuationToken: 'tok-1',
      }),
    next: (_key, options) => {
      optionsSeen.push({...options});
      return Promise.resolve(undefined);
    },
  });

  for await (const page of iterable) {
    void page;
  }

  expect(optionsSeen).toHaveLength(1);
  expect(optionsSeen[0]?.nextLink).toBe('/p2');
  expect(optionsSeen[0]?.continuationToken).toBe('tok-1');
});

test('pages are closed as the consumer advances and at exhaustion (PAGE-3, PAGE-12)', async () => {
  const closed: string[] = [];
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => closed.push('a')),
        nextLink: '/p2',
      }),
    next: () =>
      Promise.resolve({page: fakePage(['b'], () => closed.push('b'))}),
  });

  for await (const page of iterable) {
    void page;
  }

  expect(closed).toEqual(['a', 'b']);
});

test('the cap bounds a fetcher pair that never terminates, fetching nothing extra (PAGE-9)', async () => {
  const closed: string[] = [];
  let calls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => closed.push('a')),
        nextLink: '/loop',
      }),
    next: () => {
      calls += 1;
      const label = `x${String(calls)}`;
      return Promise.resolve({
        page: fakePage([label], () => closed.push(label)),
        nextLink: '/loop',
      });
    },
    maxPages: 3,
  });

  let delivered = 0;
  for await (const page of iterable) {
    void page;
    delivered += 1;
  }

  expect(delivered).toBe(3);
  // Three pages delivered means the fetcher ran twice, not three times: the third call would produce a fourth
  // page the cap forbids delivering, and a page fetched but never delivered is a page nobody closes.
  expect(calls).toBe(2);
  // Every page that was fetched was also closed — no leak on the capped path.
  expect(closed.sort()).toEqual(['a', 'x1', 'x2']);
});

test.each([0, -1, 1.5, NaN])(
  'non-positive integer maxPages throws PaginationError (PAGE-9)',
  maxPages => {
    expect(() =>
      paginateWithFetchers<string>({
        first: () => Promise.resolve(undefined),
        next: () => Promise.resolve(undefined),
        maxPages,
      }),
    ).toThrow(PaginationError);
  },
);

test('the fetcher view is single-use at the iterator level, and does not re-run first() (PAGE-14, PAGE-34)', async () => {
  let firstCalls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () => {
      firstCalls += 1;
      return Promise.resolve({page: fakePage(['a'], () => undefined)});
    },
    next: () => {
      throw new Error('must not be called');
    },
  });

  for await (const page of iterable) {
    void page;
  }

  let caughtView: unknown;
  try {
    for await (const page of iterable) {
      void page;
    }
  } catch (e: unknown) {
    caughtView = e;
  }
  expect(caughtView).toBeInstanceOf(PaginationError);
  // PAGE-34 says the first-page fetcher runs exactly once. Without the guard a second loop would run it again.
  expect(firstCalls).toBe(1);
});

test('a throwing next fetcher propagates its failure and closes previous page (PAGE-15, PAGE-28)', async () => {
  const fetcherFailure = new Error('page 2 fetch blew up');
  let page1Closed = false;
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => {
          page1Closed = true;
        }),
        nextLink: '/p2',
      }),
    next: () => Promise.reject(fetcherFailure),
  });

  let caught: unknown;
  try {
    for await (const page of iterable) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(fetcherFailure);
  expect(page1Closed).toBe(true);
});

test('a close failure while advancing stops the walk before next fetch (PAGE-12, PAGE-15, PAGE-27)', async () => {
  const closePreviousFailure = new Error('previous page close failed');
  let nextCalls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => {
          throw closePreviousFailure;
        }),
        nextLink: '/p2',
      }),
    next: () => {
      nextCalls += 1;
      return Promise.resolve({
        page: fakePage(['b'], () => undefined),
      });
    },
  });

  let caught: unknown;
  try {
    for await (const page of iterable) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(closePreviousFailure);
  expect(nextCalls).toBe(0);
});
