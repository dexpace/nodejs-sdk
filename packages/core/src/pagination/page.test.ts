// SPDX-License-Identifier: MIT
// packages/core/src/pagination/page.test.ts
// Exercises: PAGE-2 (items and metadata survive close; items never null, at construction too), PAGE-3 (one
// owned response, never null, closed exactly once), PAGE-4 (PageInfo shape, undefined next-request is the end
// signal).
import {expect, test} from 'bun:test';
import {Page, pageInfo} from './page.js';

function fakeResponse(): {
  response: Parameters<typeof makePage>[0];
  closes: () => number;
} {
  let closeCount = 0;
  let closing: Promise<void> | undefined;
  const response = {
    status: {code: 200},
    headers: {
      get: (n: string) => (n.toLowerCase() === 'x-total' ? '42' : undefined),
    },
    request: {method: 'GET'},
    async close(): Promise<void> {
      closing ??= Promise.resolve().then(() => {
        closeCount += 1;
      });
      return closing;
    },
  } as unknown as Parameters<typeof makePage>[0];
  return {response, closes: () => closeCount};
}

const makePage = <T>(
  response: ConstructorParameters<typeof Page<T>>[0],
  items: readonly T[],
): Page<T> => new Page(response, items);

test('items and derived metadata remain readable after close (PAGE-2)', async () => {
  const {response} = fakeResponse();
  const page = makePage(response, [1, 2, 3]);
  await page.close();
  expect(page.items).toEqual([1, 2, 3]);
  expect(page.status.code).toBe(200);
  expect(page.headers.get('X-Total')).toBe('42');
  expect(page.request).toBeDefined();
});

test('items are never null and are frozen (PAGE-2)', () => {
  const {response} = fakeResponse();
  const page = makePage(response, []);
  expect(page.items).toEqual([]);
  expect(Object.isFrozen(page.items)).toBe(true);
});

test('the items list is defensively copied from the caller (PAGE-2)', () => {
  const {response} = fakeResponse();
  const supplied = [1, 2];
  const page = makePage(response, supplied);
  supplied.push(3);
  expect(page.items).toEqual([1, 2]);
});

test('close releases the owned response exactly once, and is idempotent (PAGE-3)', async () => {
  const {response, closes} = fakeResponse();
  const page = makePage(response, [1]);
  await page.close();
  await page.close();
  await page.close();
  expect(closes()).toBe(1);
});

test('pageInfo with no next request signals end of stream (PAGE-4)', () => {
  expect(pageInfo([1, 2]).nextRequest).toBeUndefined();
});

test('pageInfo carries items plus a next request, both frozen (PAGE-4)', () => {
  const next = {method: 'GET'} as never;
  const info = pageInfo([1], next);
  expect(info.items).toEqual([1]);
  expect(info.nextRequest).toBe(next);
  expect(Object.isFrozen(info)).toBe(true);
});

test('an empty items list with a next request is a valid non-terminal page (PAGE-4)', () => {
  const next = {method: 'GET'} as never;
  const info = pageInfo([], next);
  expect(info.items).toEqual([]);
  expect(info.nextRequest).toBe(next);
});

test('the disposal member releases the page exactly once where the runtime has it (PAGE-3, PAGE-12)', async () => {
  const {response, closes} = fakeResponse();
  const page = makePage(response, [1]);
  // Read through a cast rather than `Symbol.asyncDispose` directly: on the pinned floor (Node 20.3,
  // which predates the symbol's 20.4 arrival) it is `undefined`, and a bare index would silently read
  // the string key `"undefined"` instead. Same shape as `sse/stream.test.ts`.
  const asyncDispose = (Symbol as {asyncDispose?: symbol}).asyncDispose;

  if (typeof asyncDispose !== 'symbol') {
    // The guarded install is correctly a no-op here; close() is the whole teardown surface.
    await page.close();
    expect(closes()).toBe(1);
    return;
  }

  const dispose = (
    page as unknown as Record<symbol, (() => Promise<void>) | undefined>
  )[asyncDispose];
  expect(dispose).toBeDefined();
  expect(page.items).toEqual([1]);
  expect(closes()).toBe(0);

  await dispose?.call(page);
  expect(closes()).toBe(1);

  // Dispose delegates to close, so it inherits Response.close()'s idempotence rather than adding a second guard.
  await page.close();
  expect(closes()).toBe(1);
});

test('no "undefined" prototype key survives the guarded install (PAGE-12)', () => {
  // The regression this pins: an unguarded `async [Symbol.asyncDispose]()` class member binds to the
  // string key "undefined" on the >=20.3 floor, leaving junk on the prototype and no working disposal.
  // `http/response.test.ts` carries the same assertion for `Response`.
  const {response} = fakeResponse();
  const page = makePage(response, [1]);
  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(page))).not.toContain(
    'undefined',
  );
});

// `Page` is `@public`, so these guards are reachable from consumer code, not only from the walk —
// and until audit #67 / #79 their messages said "never null" while the check tested `!== undefined`.
// A `null` therefore reached the item copy and surfaced as a bare `TypeError` from spread.
test.each([
  ['null items', null, /items must never be null/],
  ['undefined items', undefined, /items must never be null/],
])('a Page rejects %s at construction (PAGE-2)', (_name, items, message) => {
  const {response} = fakeResponse();
  expect(() =>
    makePage(response, items as unknown as readonly number[]),
  ).toThrow(message);
});

test('a Page rejects a null response at construction (PAGE-3)', () => {
  expect(() =>
    makePage(
      null as unknown as ConstructorParameters<typeof Page<number>>[0],
      [1],
    ),
  ).toThrow(/must own a response/);
});
