// SPDX-License-Identifier: MIT
// packages/core/src/pagination/strategies.test.ts
// Exercises: PAGE-16 (cursor: single body read, null OR empty ends, configurable parameter), PAGE-17
// (page-number: empty items ends, start-page fallback on absent/empty/garbage, configurable name and start),
// PAGE-18/19/20 (link header: rel=next, RFC 3986 reference resolution, query-only reference preserves the path,
// unresolvable target ends the stream without throwing).
import {expect, test} from 'bun:test';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {
  cursorStrategy,
  linkHeaderStrategy,
  pageNumberStrategy,
} from './strategies.js';

const template = (href: string): Request =>
  ({
    url: new URL(href),
    newBuilder() {
      let target = new URL(href);
      return {
        url(next: URL) {
          target = next;
          return this;
        },
        build: () => ({url: target}) as unknown as Request,
      };
    },
  }) as unknown as Request;

const response = (init: {
  url?: string;
  headers?: Record<string, readonly string[]>;
}): Response =>
  ({
    request: {url: new URL(init.url ?? 'https://api.test/repo/issues?page=1')},
    headers: {
      get: (name: string) => init.headers?.[name.toLowerCase()]?.[0],
      getAll: (name: string) => init.headers?.[name.toLowerCase()] ?? [],
    },
  }) as unknown as Response;

// ---- cursor (PAGE-16) ----

test('a cursor sets the configured query parameter on the next request (PAGE-16)', async () => {
  let reads = 0;
  const strategy = cursorStrategy<string>({
    extract: () => {
      reads += 1;
      return Promise.resolve({items: ['a'], cursor: 'c'});
    },
  });
  const info = await strategy.parse(
    response({}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?cursor=c');
  expect(reads).toBe(1);
});

test('the cursor parameter name is configurable (PAGE-16)', async () => {
  const strategy = cursorStrategy<string>({
    extract: () => Promise.resolve({items: ['a'], cursor: 'c'}),
    parameterName: 'after',
  });
  const info = await strategy.parse(
    response({}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?after=c');
});

test.each([null, '', undefined])(
  'a %p cursor ends the stream (PAGE-16)',
  async cursor => {
    const strategy = cursorStrategy<string>({
      extract: () =>
        Promise.resolve({items: ['a'], cursor: cursor as string | null}),
    });
    const info = await strategy.parse(
      response({}),
      template('https://api.test/items'),
    );
    expect(info.nextRequest).toBeUndefined();
    expect(info.items).toEqual(['a']);
  },
);

// ---- page number (PAGE-17) ----

test('the first page with no parameter advances to start+1 (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({url: 'https://api.test/items'}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?page=2');
});

test('an empty items list ends the stream, defensively (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve([]),
  });
  const info = await strategy.parse(
    response({url: 'https://api.test/items?page=4'}),
    template('https://api.test/items?page=4'),
  );
  expect(info.nextRequest).toBeUndefined();
});

test('the current page comes from the EXECUTED request, not the template (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({url: 'https://api.test/items?page=7'}),
    template('https://api.test/items?page=1'),
  );
  expect(info.nextRequest?.url.search).toBe('?page=8');
});

test.each(['', 'garbage', '1.5', '-3'])(
  'a %p page value falls back to the start page (PAGE-17)',
  async value => {
    const strategy = pageNumberStrategy<string>({
      extract: () => Promise.resolve(['a']),
    });
    const info = await strategy.parse(
      response({url: `https://api.test/items?page=${value}`}),
      template('https://api.test/items'),
    );
    expect(info.nextRequest?.url.search).toBe('?page=2');
  },
);

test('the parameter name and start page are configurable, supporting 0-based servers (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve(['a']),
    parameterName: 'offset',
    startPage: 0,
  });
  const info = await strategy.parse(
    response({url: 'https://api.test/items'}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?offset=1');
});

// ---- link header (PAGE-18/19/20) ----

test('an absolute rel=next target is used as-is (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({headers: {link: ['<https://other.test/x?page=2>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.href).toBe('https://other.test/x?page=2');
});

test('a query-only reference preserves the base path and replaces only the query (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({
      url: 'https://api.test/repo/issues?page=1',
      headers: {link: ['<?page=2>; rel="next"']},
    }),
    template('https://api.test/repo/issues?page=1'),
  );
  // RFC 2396 would drop the last path segment here; RFC 3986 (and WHATWG URL) does not.
  expect(info.nextRequest?.url.pathname).toBe('/repo/issues');
  expect(info.nextRequest?.url.search).toBe('?page=2');
});

test('a relative path reference resolves against the response URL (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({
      url: 'https://api.test/repo/issues?page=1',
      headers: {link: ['<../pulls>; rel="next"']},
    }),
    template('https://api.test/repo/issues'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/pulls');
});

test('an unresolvable target ends the stream rather than throwing (PAGE-19)', async () => {
  // Picking this fixture takes care. With a base supplied, WHATWG `URL` resolves almost *anything* as a
  // relative reference rather than failing — `ht!tp://%%%` has no valid scheme, so it parses happily as a path
  // and yields a defined next request, which would make this test assert nothing. A genuinely unparseable
  // target needs a valid scheme and a broken authority, so the absolute-URL path is taken and fails: `http://[`
  // opens an IPv6 literal that never closes.
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({headers: {link: ['<http://[>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest).toBeUndefined();
  expect(info.items).toEqual(['a']);
});

test('the fixture above really is unparseable — the guard is not vacuous (PAGE-19)', () => {
  expect(() => new URL('http://[', 'https://api.test/items')).toThrow();
  // And the near-miss that does NOT throw, pinned so nobody "simplifies" the fixture back to it later.
  expect(() => new URL('ht!tp://%%%', 'https://api.test/items')).not.toThrow();
});

test('no Link header ends the stream (PAGE-18)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest).toBeUndefined();
});

test('the header name is configurable (PAGE-18)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
    headerName: 'X-Links',
  });
  const info = await strategy.parse(
    response({headers: {'x-links': ['</next>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/next');
});

test('two separate Link header instances are both considered (PAGE-20)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const info = await strategy.parse(
    response({headers: {link: ['</a>; rel="last"', '</b>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/b');
});

test('one strategy instance is safe across two concurrent walks (PAGE-5)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve(['a']),
  });
  const [first, second] = await Promise.all([
    strategy.parse(
      response({url: 'https://api.test/items?page=1'}),
      template('https://api.test/items'),
    ),
    strategy.parse(
      response({url: 'https://api.test/items?page=9'}),
      template('https://api.test/items'),
    ),
  ]);
  expect(first.nextRequest?.url.search).toBe('?page=2');
  expect(second.nextRequest?.url.search).toBe('?page=10');
});
