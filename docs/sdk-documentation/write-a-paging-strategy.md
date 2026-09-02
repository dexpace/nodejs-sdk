# Write a paging strategy

A strategy is one method:

```typescript
interface PaginationStrategy<T> {
  parse(response: Response, template: Request): Promise<PageInfo<T>>;
}

interface PageInfo<T> {
  readonly items: readonly T[];
  readonly nextRequest: Request | undefined;   // undefined ends the walk
}
```

Given the page that just arrived and the request template the walk started from, produce this page's
items and the request that fetches the next one. `undefined` for `nextRequest` is how a walk ends —
there is no separate "done" flag to keep consistent with it.

## Three ship already

Reach for a custom strategy only when none of these fits.

```typescript
import {cursorStrategy, linkHeaderStrategy, pageNumberStrategy} from '@dexpace/core';

interface Thing {
  readonly id: string;
}
declare function parseItems(payload: string): readonly Thing[];

// ?cursor=<opaque>, taken from the payload
cursorStrategy<Thing>({
  extract: async r => {
    const {items, next} = JSON.parse(await r.text()) as {
      items: readonly Thing[];
      next: string | null;
    };
    return {items, cursor: next};
  },
  parameterName: 'cursor', // default
});

// RFC 8288 Link: <...>; rel="next"
linkHeaderStrategy<Thing>({extract: async r => parseItems(await r.text()), headerName: 'Link'});

// ?page=1,2,3…
pageNumberStrategy<Thing>({extract: async r => parseItems(await r.text()), startPage: 1});
```

`extract` is handed the live response. `Response` has `text()` and `bytes()`, not `json()` — this is
the SDK's own model, not the WHATWG one.

Each takes an `extract` that reads the payload and lets the strategy own the URL manipulation.

## Driving one

```typescript
import {
  Paginator,
  Request,
  type PaginationStrategy,
  type Transport,
} from '@dexpace/core';

interface Thing {
  readonly id: string;
}
declare const client: Transport;
declare const strategy: PaginationStrategy<Thing>;
declare const signal: AbortSignal;

const paginator = new Paginator<Thing>({
  transport: client,   // a Runtime is a Transport, so a full pipeline works here
  initialRequest: Request.newBuilder().url('https://api.example.com/v1/things').build(),
  strategy,
  maxPages: 50,
  signal,
});

for await (const thing of paginator.items()) { /* item by item */ }
for await (const page of paginator.pages()) { /* page by page */ }
```

`items()` and `pages()` each build a **fresh** generator per call (`PAGE-8`), so two iterations are
independent walks, not two views of one. That is also why `@dexpace/rx`'s `pageItems$`/`pages$` are
cold and repeatable while its SSE observables are not.

## The four rules

**1. Take everything you need from the response before your promise settles** (`PAGE-5`). The
response you are handed is live and single-use; the engine may close it the moment `parse` resolves.
Read the items and the cursor first, retain nothing past the call, and never hand the `Response`
itself to a caller.

**`parse` returns a `Promise`, and that is deliberate — do not "fix" it toward the literal
requirement.** `PAGE-5` says the strategy reads what it needs *synchronously* inside `parse`. Node has
no synchronous body read, so the literal form is unimplementable here and the discipline the clause
protects — single use, nothing retained — is what the async signature preserves. Recorded in
[`docs/deferred-items.md`](../deferred-items.md) precisely so an async signature does not later read
as an oversight. Every shipped strategy's `extract` above is `async` for the same reason.

**2. Build `nextRequest` from the template, not from the response.** The template carries the headers,
auth tier and options the walk was started with. A next request built from scratch loses all of them.

```typescript
const next = template
  .newBuilder()
  .url(withQueryParam(template.url, 'cursor', cursor))
  .build();
return pageInfo(items, next);
```

`pageInfo(items, nextRequest?)` is the `PageInfo` factory. Use `QueryParams` for the URL work — see
[`http.md`](./http.md) for why not `URLSearchParams`.

**3. A page is closed before its items are yielded** (`PAGE-11`). The engine does this for you. It is
worth knowing because it means your `extract` is the **only** place the response body is readable, and
because `sdk-design-nodejs/07` §7.1's illustrative snippet has it backwards — closing after yielding —
which is an erratum recorded in `docs/knowledge/notes/pagination.md` and `docs/open-items.md` J1.

**4. Terminate.** Returning a `nextRequest` equal to the one just fetched is an infinite walk.
`maxPages` on `PaginatorInit` is the backstop, not the design. Loop detection is not the paginator's
job.

`PaginationError` is reserved for engine misuse and precondition violations — not for "the server
returned a page I did not understand", which is your `extract`'s error to raise.

## The fetcher form

When the API is already wrapped in functions rather than reachable as requests, skip
`PaginationStrategy` entirely:

```typescript
import {paginateWithFetchers, type FetcherPage, type PagingOptions} from '@dexpace/core';

interface Thing {
  readonly id: string;
}
declare function firstPage(options: PagingOptions): Promise<FetcherPage<Thing> | undefined>;
declare function nextPage(key: string, options: PagingOptions): Promise<FetcherPage<Thing> | undefined>;

for await (const page of paginateWithFetchers<Thing>({
  first: async options => firstPage(options),
  next: async (key, options) => nextPage(key, options),
  maxPages: 20,
})) {
  console.log(page.items);
}
```

`first` and `next` return a `FetcherPage<T>` — a `Page<T>` plus either a `continuationToken` or a
`nextLink` — or `undefined` to end the walk. This is the adapter for a generated client whose
pagination is already a pair of methods.

## Disposal

`Page` has a `close()`. It does **not** support `await using`: `Symbol.asyncDispose` arrived in Node
20.4 and this project's floor is 20.3, so the disposal member is installed only when the symbol
exists and is never declared in the `.d.ts`. Declaring it anyway would be a type that lies on the
supported runtime, which `NFR-10` forbids. `close()` is the teardown on every runtime, and
`open-items.md`'s Section D row [`await using` support](../open-items.md#d-nfr-10-await-using)
records the decision with the four reasons the floor does not move instead.

Within a `Paginator` walk the engine closes each page for you; `close()` matters when you hold a
`Page` yourself.
