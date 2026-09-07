// SPDX-License-Identifier: MIT
// packages/core/src/pagination/lifecycle.test.ts
// Exercises: PAGE-4 (a malformed parse result closes the response and names the invariant), PAGE-11 (close
// BEFORE yielding items — the assertion appendix B does not make), PAGE-12 (close-on-abandon), PAGE-13 (parse
// failure closes inline, close error suppressed), PAGE-14 (single-use page view), PAGE-15 (close errors
// surface), PAGE-27 (exactly once on every path), PAGE-32 (consumer throw keeps consumer error primary,
// discarding return-phase close error).
import {expect, test} from 'bun:test';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {IoError} from '../io/errors.js';
import {PaginationError} from './errors.js';
import {pageInfo, type PageInfo} from './page.js';
import {Paginator} from './paginator.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {SuppressedErrorLike} from '../suppress.js';

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

function twoPageStrategy(): PaginationStrategy<string> {
  return {
    parse(_response: Response, template: Request): Promise<PageInfo<string>> {
      const page = Number(template.url.searchParams.get('page') ?? '1');
      const items = [
        `p${String(page)}a`,
        `p${String(page)}b`,
        `p${String(page)}c`,
      ];
      if (page >= 2) return Promise.resolve(pageInfo(items));
      const next = template
        .newBuilder()
        .url(new URL(`https://api.test/items?page=${String(page + 1)}`))
        .build();
      return Promise.resolve(pageInfo(items, next));
    },
  };
}

function transportOf(
  pages: number,
  onClose?: (index: number) => void,
): FakeTransport {
  return new FakeTransport(
    Array.from({length: pages}, (_unused, index) =>
      countingResponse({
        status: 200,
        headers: {'X-Page': String(index + 1)},
        body: '{}',
        onCancel: () => onClose?.(index),
      }),
    ),
  );
}

test('the item view closes a page BEFORE yielding any of its items (PAGE-11)', async () => {
  const events: string[] = [];
  const transport = transportOf(2, index =>
    events.push(`close:${String(index)}`),
  );
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  for await (const item of paginator.items()) {
    events.push(`item:${item}`);
  }

  // The close for page 0 must precede every one of its items. Under the design doc's illustrative snippet
  // (close in a `finally`, after `yield*`) this assertion fails while PAGE-11's own checklist test still passes.
  expect(events.indexOf('close:0')).toBeLessThan(events.indexOf('item:p1a'));
  expect(events.indexOf('close:1')).toBeLessThan(events.indexOf('item:p2a'));
});

test('taking one item and stopping closes that page and fetches no second page (PAGE-11)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, index => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  for await (const item of paginator.items()) {
    void item;
    break;
  }

  expect(closed).toEqual([0]);
  expect(transport.sendCount).toBe(1);
});

test('breaking out of the page view closes the held page (PAGE-12)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, index => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  for await (const page of paginator.pages()) {
    void page;
    break;
  }

  expect(closed).toEqual([0]);
});

test('advancing the page view closes the previous page (PAGE-12)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, index => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  const seen = [];
  for await (const page of paginator.pages()) seen.push(page);

  expect(seen).toHaveLength(2);
  expect(closed).toEqual([0, 1]);
});

test('a second pages() call returns a fresh, independent view — the restart PAGE-14 names', async () => {
  // PAGE-14's own recovery clause: "a caller restarts pagination by requesting a fresh view from the engine."
  // Guarding pages() itself would block that path AND make the engine stateful, which PAGE-8 forbids.
  const transport = transportOf(4);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  const first = [];
  for await (const page of paginator.pages()) first.push(page.items[0]);
  const second = [];
  for await (const page of paginator.pages()) second.push(page.items[0]);

  expect(second).toEqual(first);
  expect(transport.sendCount).toBe(4);
});

test('the page view is single-use at the ITERATOR level too (PAGE-14)', async () => {
  // The guard that matters. `for await` calls Symbol.asyncIterator afresh every time, so a view guarded only at
  // the pages() level would let a second loop over the *same* view silently restart the whole walk — the exact
  // "silently restart" PAGE-14 forbids, and invisible to the test above.
  const transport = transportOf(2);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });
  const view = paginator.pages();

  for await (const page of view) {
    void page;
  }
  const sendsAfterFirstPass = transport.sendCount;

  let caught: unknown;
  try {
    for await (const page of view) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(PaginationError);
  expect(transport.sendCount).toBe(sendsAfterFirstPass);
});

test('a transport failure surfaces the original cause, unwrapped (PAGE-28)', async () => {
  const transportFailure = new IoError('connection reset');
  const transport = {
    send: () => Promise.reject(transportFailure),
  } as unknown as FakeTransport;
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  // No pagination-flavored wrapper: PAGE-28 wants the cause the caller can actually act on.
  expect(caught).toBe(transportFailure);
  expect(caught).not.toBeInstanceOf(PaginationError);
});

test('advancing closes the held page before next send, and surfaces close error (PAGE-12, PAGE-15)', async () => {
  const closeFailure = new IoError('close failed');
  let sends = 0;
  const transport = {
    send: () => {
      sends += 1;
      return Promise.resolve(
        countingResponse({
          status: 200,
          headers: {'X-Page': '1'},
          body: '{}',
          onCancel: () => {
            throw closeFailure;
          },
        }),
      );
    },
  } as unknown as FakeTransport;
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(closeFailure);
  expect(sends).toBe(1);
});

test('a parse failure closes the response inline and propagates the parse error (PAGE-13)', async () => {
  const boom = new Error('malformed page');
  const closed: number[] = [];
  const transport = transportOf(1, index => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse(): Promise<never> {
        return Promise.reject(boom);
      },
    },
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(boom);
  expect(closed).toEqual([0]);
});

test('a close failure during a parse failure is suppressed, not masking (PAGE-13)', async () => {
  const parseFailure = new Error('malformed page');
  const closeFailure = new IoError('close failed');
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {},
      body: '{}',
      onCancel: () => {
        throw closeFailure;
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse(): Promise<never> {
        return Promise.reject(parseFailure);
      },
    },
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect((caught as SuppressedErrorLike).name).toBe('SuppressedError');
  expect((caught as SuppressedErrorLike).error).toBe(parseFailure);
  expect((caught as SuppressedErrorLike).suppressed).toBe(closeFailure);
});

test('a close error while releasing a held page surfaces rather than being swallowed (PAGE-15)', async () => {
  const closeFailure = new IoError('close failed');
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {'X-Page': '1'},
      body: '{}',
      onCancel: () => {
        throw closeFailure;
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse: () => Promise.resolve(pageInfo(['only'])),
    },
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(closeFailure);
});

test('a close failure while advancing stops walk before dispatching next request (PAGE-12, PAGE-15, PAGE-27)', async () => {
  const closePreviousFailure = new IoError('previous page close failed');
  const secondResponseClosed: number[] = [];
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {'X-Page': '1'},
      body: '{}',
      onCancel: () => {
        throw closePreviousFailure;
      },
    }),
    countingResponse({
      status: 200,
      headers: {'X-Page': '2'},
      body: '{}',
      onCancel: () => {
        secondResponseClosed.push(2);
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: twoPageStrategy(),
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(closePreviousFailure);
  expect(transport.sendCount).toBe(1);
  expect(secondResponseClosed).toEqual([]);
});

test.each([
  [
    'full drain of the page view',
    2,
    async (paginator: Paginator<string>) => {
      for await (const page of paginator.pages()) {
        void page;
      }
    },
  ],
  [
    'full drain of the item view',
    2,
    async (paginator: Paginator<string>) => {
      for await (const item of paginator.items()) {
        void item;
      }
    },
  ],
  [
    'early break from the page view',
    1,
    async (paginator: Paginator<string>) => {
      for await (const page of paginator.pages()) {
        void page;
        break;
      }
    },
  ],
  [
    'consumer throws mid-iteration',
    1,
    async (paginator: Paginator<string>) => {
      try {
        for await (const page of paginator.pages()) {
          void page;
          throw new Error('consumer blew up');
        }
      } catch {
        /* expected */
      }
    },
  ],
])(
  'every response closes exactly once: %s (PAGE-27)',
  async (_name, expectedFetches, drive) => {
    const closeCounts = new Map<number, number>();
    const transport = transportOf(2, index => {
      closeCounts.set(index, (closeCounts.get(index) ?? 0) + 1);
    });
    const paginator = new Paginator({
      transport,
      initialRequest: initialRequest(),
      strategy: twoPageStrategy(),
    });

    await drive(paginator);

    expect(closeCounts.size).toBe(expectedFetches);
    for (let i = 0; i < expectedFetches; i++) {
      expect(closeCounts.get(i)).toBe(1);
    }
  },
);

// A strategy is caller code, and `parse`'s declared return type does not survive the seam: an
// `any`-typed JSON decode, a forgotten `return`, or a server field the caller trusted all land here
// as a shape the engine's own types say cannot exist (PAGE-4). The casts below ARE the test — they
// reproduce the four values that reach `#walk` in practice.
function malformedStrategy(result: unknown): PaginationStrategy<string> {
  return {parse: () => Promise.resolve(result as PageInfo<string>)};
}

test.each([
  ['undefined', undefined, /never null or undefined/],
  ['null', null, /never null or undefined/],
  ['{items: null}', {items: null, nextRequest: undefined}, /PageInfo\.items/],
  ['{items: undefined}', {nextRequest: undefined}, /PageInfo\.items/],
])(
  'a strategy that returns %s closes the response exactly once and names the invariant (PAGE-4, PAGE-27)',
  async (_name, result, message) => {
    const closed: number[] = [];
    const transport = transportOf(1, index => closed.push(index));
    const paginator = new Paginator({
      transport,
      initialRequest: initialRequest(),
      strategy: malformedStrategy(result),
    });

    let caught: unknown;
    try {
      for await (const page of paginator.pages()) {
        void page;
      }
    } catch (e: unknown) {
      caught = e;
    }

    // Before the fix `items: null` reached the spread in `Page`'s constructor and surfaced as a
    // bare `TypeError` from array iteration, which names nothing a caller can act on.
    expect((caught as Error).message).toMatch(message);
    expect(closed).toEqual([0]);
  },
);

test('a close failure while rejecting a malformed PageInfo is suppressed, not masking (PAGE-4, PAGE-13)', async () => {
  const closeFailure = new IoError('close failed');
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {},
      body: '{}',
      onCancel: () => {
        throw closeFailure;
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: malformedStrategy(undefined),
  });

  let caught: unknown;
  try {
    for await (const page of paginator.pages()) {
      void page;
    }
  } catch (e: unknown) {
    caught = e;
  }

  const suppressed = caught as SuppressedErrorLike;
  expect(suppressed.name).toBe('SuppressedError');
  expect((suppressed.error as Error).message).toMatch(
    /never null or undefined/,
  );
  expect(suppressed.suppressed).toBe(closeFailure);
});
