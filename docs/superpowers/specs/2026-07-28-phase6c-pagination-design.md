# Phase 6c — Pagination — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the pagination engine — the `Page` resource, the `PageInfo` strategy contract, the
item-level and page-level views, the page cap, the three built-in strategies, the verbatim query splice, and the
fetcher-based front-end — satisfying `docs/product-spec/12-pagination.md` (`PAGE-1`–`PAGE-36`). Last of the three
sub-phases the [Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) splits Phase 6 into: 6a
(serde, `§14`), 6b (SSE, `§13`), **6c** (this document, pagination).

**Governing documents:** `docs/product-spec/12-pagination.md` (normative, cited by ID throughout),
`docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.1 (Node-port mapping — async generators,
close-on-abandon via `.return()`, `URLSearchParams` rejected), `docs/knowledge/pagination.md`, the Phase 1 design
(`Request`, `Response`, `QueryParams`' RFC 3986 encoder, `RequestOptions`), the Phase 2 design (`Transport`),
the Phase 3b design (`Response.close()`), the Phase 4c design (`Runtime implements Transport`), and the Phase 5a
design (`FakeTransport`). Styleguide: `styleguide/typescript/` chapters 03, 06, 08, 09, 11, 12, 13.

**Solo-brainstorm note.** Drafted with the user away from keyboard, `docs/knowledge/` as standing tie-breaker.
6c shares no types with 6a or 6b — `§12`'s preamble declares the engine serde-agnostic, and nothing in `§12`
touches SSE. Every touchpoint with an *earlier* phase is named in "Reused, Not Rebuilt."

## Scope

6c ships the engine, the views, the strategies, the query rewriter, and the fetcher front-end. It ships **no**
serde coupling: the built-in cursor strategy extracts items and a cursor through a caller-supplied function, never
through a `Serde` (`§12` preamble, MUST).

## Requirement Coverage

| ID | Level | Where |
|---|---|---|
| PAGE-1 | MUST | `paginate()` returns both views over one walk; server order preserved across page boundaries |
| PAGE-2 | MUST | `Page` keeps items/status/headers/request readable after close; only the body dies |
| PAGE-3 | MUST | `Page` owns exactly one response; whoever pulls it owns closing it |
| PAGE-4 | MUST | `PageInfo` — items plus `nextRequest`; `undefined` next-request is the sole end signal |
| PAGE-5 | MUST | Strategy contract — re-expressed for an async runtime, see below |
| PAGE-6, PAGE-7 | MUST | Generator laziness by construction; forward-only; idempotent end probes |
| PAGE-8 | MUST | `Paginator` holds frozen config only; each iteration builds fresh state |
| PAGE-9, PAGE-10 | MUST/SHOULD | `maxPages` validated strictly positive at construction; unbounded default |
| PAGE-11 | MUST | Item view copies items, **closes, then yields** — see the erratum below |
| PAGE-12 | MUST | Page view auto-closes on advance and at exhaustion; one-slot look-ahead buffer released too |
| PAGE-13 | MUST | Parse failure closes the response inline; close failure attaches as suppressed |
| PAGE-14 | MUST | Page view is single-use; a second iterator throws |
| PAGE-15 | MUST | Close errors surface, never swallowed; two failures → first primary, second suppressed |
| PAGE-16, PAGE-17, PAGE-18, PAGE-19, PAGE-20 | MUST/SHOULD | `cursorStrategy`, `pageNumberStrategy`, `linkHeaderStrategy` |
| PAGE-21–PAGE-24 | MUST | `spliceQueryParam()` — raw-substring rewrite, RFC 3986 component encoding, non-query components untouched |
| PAGE-25–PAGE-33 | MUST/SHOULD | Collapsed onto the single generator engine — see below |
| PAGE-34, PAGE-35 | MUST/SHOULD | `paginateWithFetchers()` |
| PAGE-36 | MUST | `RequestOptions` threaded into **every** page exchange, not just the first |

## Finding: `sdk-design-nodejs/07`'s item-view snippet violates `PAGE-11`

The segmentation design flagged this; 6c is where it is resolved. `sdk-design-nodejs/07` §7.1 illustrates the item
view as:

```
for await (const page of pages()) {
  try { yield* page.items }
  finally { await page.close() }
}
```

`PAGE-11` (MUST) requires the opposite ordering: *"eager-close each page **before** yielding any of that page's
items (after copying the materialized items)."* Under the snippet the response stays open for however long the
consumer takes to walk that page's items — which, for a slow consumer, is exactly the connection-holding the
requirement exists to prevent.

The snippet nonetheless **passes** `PAGE-11`'s own stated conformance test ("take one item from a multi-item
first page and stop; assert the first page's response was closed"), because an early `break` drives `.return()`
and therefore the `finally`. So this is a case where the appendix-B checklist is weaker than the requirement it
checks, and following the design doc would ship a violation nothing in the test suite catches.

**Resolution:** `PAGE-11` governs. The item view copies the materialized items, closes the page, and only then
yields:

```typescript
for await (const page of pages) {
  const items = page.items;   // already materialized and frozen at construction (PAGE-2)
  await page.close();
  yield* items;
}
```

This costs nothing — `PAGE-2` guarantees items survive close — and it makes the guarantee unconditional rather
than dependent on how promptly the consumer abandons. The snippet remains correct about the mechanism §7.1 is
actually arguing for (JavaScript's automatic `.return()`-on-abandon), just not about ordering. Recorded as an
erratum against `sdk-design-nodejs/07`.

Note the consequence: the item view does **not** use `finally` for the close, because the close already happened
before the first `yield`. A `finally` remains around the *page-level* walk, which is where an abandoned iteration
can still strand a page (`PAGE-12`).

## Finding: `PAGE-5`'s "synchronously inside parse" is unimplementable literally

`PAGE-5` (MUST): *"A strategy MUST read everything it needs from the response synchronously inside parse (the
body is single-use), MUST NOT retain the response or its body beyond the call, and MUST NOT close or mutate the
response."*

Node has no synchronous body read — `Response.text()`/`bytes()` are promises by construction, because the bytes
may not have arrived. The literal reading cannot be satisfied by any implementation.

Every part of the requirement's *intent* survives an async signature, and each is separately enforceable:

- **Single-use body discipline** — parse must read the body at most once. Enforced by the engine handing the
  strategy the `Response` exactly once and never reading the body itself.
- **No retention past the call** — enforced by the engine closing the response immediately after `parse` resolves,
  so a retained body is already dead and fails loudly on the next read rather than silently working sometimes.
- **No close, no mutate** — a TSDoc contract obligation on `PaginationStrategy.parse`, matching how Phase 2 stated
  the equivalent `Transport.send()` obligations.
- **Immutable and concurrency-safe strategies** — strategies are plain frozen objects with no per-call state; the
  conformance test runs one instance across two interleaved walks.

So: `parse(response, template): Promise<PageInfo>`. Recorded so a later reader does not read the promise as an
oversight, or "fix" it back toward a literal reading that cannot work.

## The Model

```typescript
interface PageInfo<T> {
  readonly items: readonly T[];
  /** `undefined` is the single, exclusive end-of-stream signal (PAGE-4). */
  readonly nextRequest: Request | undefined;
}

class Page<T> {
  readonly items: readonly T[];
  readonly status: Status;
  readonly headers: Headers;
  readonly request: Request;
  close(): Promise<void>;   // idempotent
}

interface PaginationStrategy<T> {
  parse(response: Response, template: Request): Promise<PageInfo<T>>;
}

class Paginator<T> {
  constructor(init: {
    transport: Transport;
    initialRequest: Request;
    strategy: PaginationStrategy<T>;
    maxPages?: number;
    options?: RequestOptions;
    signal?: AbortSignal;
  });
  items(): AsyncIterable<T>;
  pages(): AsyncIterable<Page<T>>;
}
```

`Page` is a class: it owns a resource with a lifecycle and an idempotent close, which is `styleguide/typescript/06`
§6.3's exact test for a class rather than a data structure. `PageInfo` is a frozen plain object for the mirror-image
reason.

**`Paginator` takes a `Transport`, not a `Runtime` specifically.** `Runtime implements Transport` (4c), so a
resilience pipeline drops in unchanged, but a bare transport and a `FakeTransport` also do — the engine is
`§12`'s "transport-agnostic" clause taken literally, and it makes 6c's tests independent of 5a–5c.

`PAGE-8` splits state cleanly: `Paginator` holds only frozen configuration and is safe to share; `items()` and
`pages()` each construct a fresh generator with its own page counter and cursor, so two iterations drive two full
fetch sequences. That is a property of generators, not bookkeeping the engine performs.

`PAGE-36` is threading, not logic: the same `RequestOptions` instance goes into every `transport.send()` call in
the walk. The failure mode it guards — a caller's timeout governing page 1 and silently not pages 2..N — is a
one-line omission, so it gets its own conformance test asserting the options object reaches all three sends of a
three-page walk.

## The Two Views

Both are `async function*` over one shared drive routine, exposed as `AsyncIterable` (`PAGE-1`).

**Laziness (`PAGE-6`) is free.** A generator body does not run until the first `.next()`, so "constructing the
paginator triggers zero exchanges" is true by construction. No lazy-initialization bookkeeping exists to get wrong.

**Item view** — copy items, close, yield (see the erratum above).

**Page view** — the harder one. `PAGE-12` requires closing the previous page as the consumer advances, closing the
last at exhaustion, and **buffering a fetched-but-undelivered page** so an emptiness probe followed by an explicit
close still releases it. In JavaScript there is no `hasNext()` probe to strand a page — `for await` pulls one
value at a time and an async iterator has no separate look-ahead step — so the two-outstanding-pages window the
reference has to manage does not open the same way. It still opens *once*: between the generator fetching a page
and the consumer receiving it, an abandonment can land. That is covered by the generator's `finally`, which closes
whatever page is currently held.

`PAGE-14`'s single-use rule is not free — a generator function called twice returns two independent generators —
so `pages()` sets a `viewTaken` flag and throws `PaginationError` on a second call. `items()` is deliberately
**not** single-use: `PAGE-14` scopes the restriction to the page-level view, and `PAGE-8` requires two independent
iterations to work.

`PAGE-15`'s two-close-failures case uses native `SuppressedError`, the same mechanism 5a and 6b use.

## Parse Failure (`PAGE-13`)

When `parse` rejects, the page object was never constructed, so nothing else will close the response — the engine
closes it inline on the exceptional path. A close failure must not mask the parse failure: parse error primary,
close error suppressed. Same shape as `PAGE-15`, different trigger, and both go through one shared helper so the
suppression ordering cannot drift between them.

## The Query Splice (`PAGE-21`–`PAGE-24`)

```typescript
function spliceQueryParam(url: URL, name: string, value: string | undefined): URL;
function readQueryParam(url: URL, name: string): string | undefined;
```

`sdk-design-nodejs/07` §7.1 rejects `URLSearchParams` and is right to: it re-serializes the entire query through
its own canonical encoding on every mutation, which reorders and re-encodes untouched parameters (against
`PAGE-21`'s byte-for-byte requirement) and encodes space as `+` rather than the `%20` this port standardizes on
(`HTTP-29`).

`QueryParams` (Phase 1) is also the wrong tool here, for the same reason in a different costume: `encode()`
re-renders the whole query from the parsed model. It is the right tool for *building* a query and the wrong one
for *splicing* one.

So the rewriter tokenizes the raw query substring by hand, copies every untargeted `&`-segment byte-for-byte, and
touches only the targeted parameter. But the **encoding rule** is identical to `HTTP-29`'s, so 6c reuses Phase 1's
component encoder rather than restating it — a second percent-encoder in this codebase would be a defect, and two
encoders that drift is a worse one. If Phase 1 kept that function module-private, 6c's plan exports it from
`query-params.ts` (an `@internal` export, no public-surface change) instead of copying the rule.

`PAGE-23`'s semantics: replace the first occurrence in place and drop later duplicates; append when absent; remove
entirely when the value is `undefined`; preserve order otherwise. `PAGE-24`: only the query may change — scheme,
userinfo, host, port, path, and fragment all survive byte-identically, which the tests assert on a URL carrying
all of them at once.

## The Built-in Strategies

**`cursorStrategy`** (`PAGE-16`) — takes a caller-supplied `extract: (response: Response) => Promise<{items:
readonly T[]; cursor: string | null}>`, reading the body exactly once. A `null` **or empty** cursor ends the
stream; both, not just null. The next request sets a configurable query parameter (default `cursor`) via the
splice above. Serde-agnostic by construction: the extractor is the caller's, so no codec is named here.

**`pageNumberStrategy`** (`PAGE-17`) — an empty items list ends the stream, defensively, before any page-number
arithmetic. Otherwise it reads the current page from the *executed* request's query parameter, falling back to a
configurable start page (default 1) when the parameter is absent, empty, or non-numeric, and sets the next
request's page to current + 1. A 0-based server is supported by setting `startPage: 0`.

**`linkHeaderStrategy`** (`PAGE-18`, `PAGE-19`, `PAGE-20`) — the only genuinely fiddly one. RFC 5988/8288
link-value parsing where a comma inside `<...>` or inside a quoted parameter value must **not** split link-values,
with quoted-pair escapes supported. `rel` may be quoted or unquoted and may list several space- or tab-separated
types; the match is on the token `next`, case-insensitively, within that list. `PAGE-20`'s multiple `Link` header
instances are normalized by concatenation before parsing.

`PAGE-19`'s reference resolution is `new URL(target, base)` where `base` is the originating page's response URL —
which gets the query-only (`?page=2`) case right natively: WHATWG URL resolution preserves the base path and
replaces only the query, whereas RFC 2396's older rule would drop the last path segment. A target that cannot
resolve is **end-of-stream, not an error** (`PAGE-19`), so the `URL` constructor's throw is caught and converted
to `undefined` — one of the few places in this codebase where swallowing an exception is the specified behavior,
and it gets a comment saying so.

## The Fetcher Front-End (`PAGE-34`, `PAGE-35`)

An alternative entry point for callers who already have per-page fetch functions:

```typescript
function paginateWithFetchers<T>(init: {
  first: (options: PagingOptions) => Promise<Page<T> | undefined>;
  next: (link: string, options: PagingOptions) => Promise<Page<T> | undefined>;
  maxPages?: number;
}): AsyncIterable<Page<T>>;
```

The first fetcher runs exactly once. Subsequent pages key off the previous page's next link, falling back to its
continuation token only when no link is present — **link wins**. A blank link with no fallback token, or an
`undefined` page from either fetcher, ends the stream; an `undefined` first page yields an empty stream. Each
fetcher builds a page that owns its response and must not close it; a fetcher that throws before building the
page remains responsible for that response (a TSDoc contract obligation — the engine has no handle to close).

`PAGE-35`'s single mutable `PagingOptions` instance is threaded through every fetcher call, so a custom retriever
can stash state between pages. Cross-call mutation visibility is the *point*, so it is documented rather than
defended against; the object is single-consumer and needs no synchronization.

## Collapsed Requirements — §12.9's Async Engine

Phase 9's sweep must read this table rather than re-deriving it, or nine requirements read as uncovered. The
reference has two engines, blocking and asynchronous; this port has one, because it has one async primitive. **The
async generator *is* the engine.**

| ID | Disposition |
|---|---|
| `PAGE-25` — drive fetch/parse/delivery/re-arm inside the completion graph with no thread blocked per page | **By construction.** There is no thread to block; an `await` yields the event loop. The second half — cancelling the walk halts it and best-effort aborts the in-flight exchange — does **not** collapse: it re-expresses as the `AbortSignal` threaded into every `transport.send()`, and is implemented and tested |
| `PAGE-26` — cancellation takes effect at page granularity; a fetched-but-undrained page is dropped **and closed**, close errors on that path swallowed | **Partially collapses.** "Items already being delivered still reach the consumer" is automatic: an abort observed between pulls ends the loop at a page boundary because that is the only place the generator checks. The close-and-swallow half is real work in the generator's `finally` |
| `PAGE-27` — every response closed exactly once on whichever path consumes it | **Does not collapse.** Fewer paths than the reference (no executor-rejection path), but drain, drop, and parse-failure all remain and each needs its close-once test |
| `PAGE-28` — a consumer throw, transport failure, parse failure, or eager transport throw terminates the walk surfacing the original cause | **Re-expressed.** No future to complete exceptionally — the generator simply rejects. "Unwrap the future-composition wrapper" has no analogue: `await` already propagates the original error. The "eager throw instead of a failed future" case collapses entirely — an `async` function cannot throw eagerly; a synchronous throw inside one becomes a rejected promise automatically |
| `PAGE-29` — no concurrent consumer invocation, ordered delivery, optional caller-supplied executor | **Serial delivery is by construction** (`for await` awaits each body before the next pull). The **executor mode does not exist**: the consumer's own loop is the scheduling authority, there is no transport callback thread to tie up, and a caller wanting to move work elsewhere already controls that inside their loop body. Not built |
| `PAGE-30` — an executor that rejects a re-dispatch fails the walk and closes the staged page | **N/A.** No executor exists, so no rejection can occur |
| `PAGE-31` — trampoline synchronously-completed pages rather than recursing | **N/A, by the requirement's own escape clause.** "A port on a runtime without deep-recursion risk MAY satisfy the intent with its native loop model but MUST NOT recurse per page." A `for await` loop is iterative; the engine structurally cannot recurse per page. A test drives thousands of already-resolved pages to prove no stack growth |
| `PAGE-32` — release happens whether the consumer succeeds or throws; a throwing close on the success path is reported, not escaped | **Re-expressed.** `finally` covers both halves; "reported through the result future" becomes "the generator rejects," which is what a consumer awaits anyway |
| `PAGE-33` — document the cancellation race | **Survives verbatim as documentation.** If an abort settles before the transport delivers a response, that response never reaches the paginator and releasing it is the transport's job; a page request already dispatched may still complete, and the paginator must close and discard it. Both are stated in `Paginator`'s TSDoc, and the second is implemented, not just documented |

## Reused, Not Rebuilt

| Surface | From | Why |
|---|---|---|
| The RFC 3986 component encoder behind `QueryParams` | 1 | `PAGE-22` restates `HTTP-29`'s rule exactly. Two encoders that drift is worse than one shared one; if it is module-private, export it `@internal` rather than copy it |
| `Request`/`RequestBuilder`, `Response`, `Status`, `Headers` | 1, 3b | `PAGE-23`'s "follow a whole next URL" swaps only the URL, preserving method, headers, and body — that is `newBuilder()` |
| `Response.close()` | 3b | Already idempotent, so `Page.close()` delegates rather than reimplementing close-once |
| `Transport` | 2 | `PAGE-25`'s transport-agnosticism; `Runtime` (4c) satisfies it, so a resilience pipeline drops in unchanged |
| `RequestOptions` | 1 | `PAGE-36` threads the caller's instance; the engine never constructs one |
| `FakeTransport`, `countingResponse()` | 5a | Scripted multi-response sequences, wire-send counting, and per-response close observation are exactly what `PAGE-6`/`PAGE-9`/`PAGE-27` need. 5a's design names `countingResponse()`'s `cancel()` hook as the **only** sanctioned way to observe a close — responses are frozen, so a spy assignment throws |
| `SuppressedError` usage pattern | 5a, 6b | `PAGE-13` and `PAGE-15` both need primary-plus-suppressed |

## File Layout

```
packages/core/src/pagination/
  page.ts            # Page, PageInfo                                   (PAGE-2, PAGE-3, PAGE-4)
  strategy.ts        # PaginationStrategy contract + TSDoc obligations  (PAGE-5)
  paginator.ts       # Paginator, items(), pages(), the drive routine   (PAGE-1, PAGE-6-15, PAGE-25-33, PAGE-36)
  query-splice.ts    # spliceQueryParam, readQueryParam                 (PAGE-21-24)
  link-header.ts     # RFC 8288 link-value tokenizer                    (PAGE-18, PAGE-20)
  strategies.ts      # cursorStrategy, pageNumberStrategy, linkHeaderStrategy  (PAGE-16-20)
  fetchers.ts        # paginateWithFetchers, PagingOptions              (PAGE-34, PAGE-35)
  errors.ts          # PaginationError
```

No folder barrel (`docs/knowledge/module-organization.md:18`). Also modifies `packages/core/src/http/
query-params.ts` — the `@internal` encoder export named above.

## Public Barrel

Promoted: `Paginator`, `Page`, `PageInfo`, `PaginationStrategy`, `cursorStrategy`, `pageNumberStrategy`,
`linkHeaderStrategy`, `paginateWithFetchers`, `PagingOptions`, `PaginationError`. A caller consuming a paginated
endpoint needs all of them, and no later phase reshapes them — 6c closes Phase 6.

Kept `@internal`: `spliceQueryParam`, `readQueryParam`, and the link-header tokenizer. They are strategy
implementation details; publishing them would publish a second URL-manipulation surface next to Phase 1's
`QueryParams`, which is exactly the confusion the "one encoder" rule above exists to avoid.

## Testing

`bun test`; `fast-check` for the two splice invariants. Notable cases:

- **`PAGE-11` ordering, asserted directly**, not via the weaker checklist test: instrument a page's close and its
  item iteration and assert the close happens *before* the first item is yielded. This is the test the appendix-B
  version does not perform, and the reason the erratum above needed writing down.
- A `FakeTransport` scripted with a server that never advances its cursor, plus `maxPages: N`, asserting exactly
  N exchanges then termination; and `maxPages: 0` and `-1` each throwing at construction.
- Close-exactly-once across drain, early break, parse failure, and abort (`PAGE-27`).
- Parse failure with a *also*-failing close, asserting parse error primary and close error suppressed
  (`PAGE-13`); the same assertion for two failing page closes (`PAGE-15`).
- Link-header fixtures with a quoted comma inside a parameter value, a comma inside an angle-bracketed URL,
  unquoted `rel`, a multi-token `rel=" prev next "`, mixed `rel=prev`/`rel=last` decoys, and two separate `Link`
  header instances (`PAGE-18`, `PAGE-20`).
- `PAGE-19`'s query-only reference against base `/repo/issues?page=1` resolving to `/repo/issues?page=2` — the
  RFC 2396 behavior would drop `issues` — and an unparseable target ending the stream with no exception.
- Thousands of already-resolved pages driven through the generator, asserting completion with no stack growth
  (`PAGE-31`'s intent).
- **Property:** `spliceQueryParam` leaves every untargeted byte of the query identical, for arbitrary queries.
- **Property:** `readQueryParam(spliceQueryParam(url, n, v), n) === v` for arbitrary values, including values
  containing `+`, `%20`, `/`, `=`, and spaces.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Item view closes **before** yielding, contrary to `sdk-design-nodejs/07` §7.1's snippet | `sdk-design-nodejs/07` §7.1 | `PAGE-11` (MUST) requires close-before-yield; the snippet holds the response open for the whole item walk. The snippet passes appendix B's own test anyway, which is why this is recorded rather than silently corrected |
| `PaginationStrategy.parse` is asynchronous | `PAGE-5`'s "synchronously inside parse" | No synchronous body read exists in this runtime. Every enforceable part of the intent — single-use body, no retention, no close, no mutate, immutable strategies — is preserved and separately tested |
| No caller-supplied executor mode | `PAGE-29` | The consumer's own `for await` loop is the scheduling authority; there is no transport callback thread to relieve. A caller wanting to offload work does it in their loop body |
| No trampoline | `PAGE-31` (SHOULD) | Satisfied by the requirement's own escape clause — a `for await` loop is iterative and cannot recurse per page |
| No executor-rejection path | `PAGE-30` | Vacuous without an executor |
| One engine, not a blocking one and an async one | `§12.9`'s framing | One async primitive in this runtime; `PAGE-6` explicitly anticipates a port where "invoking a walk method is itself the consumption trigger" |
| `items()` is re-iterable while `pages()` is single-use | `PAGE-14` | `PAGE-14` scopes single-use to the page-level view, and `PAGE-8` requires independent iterations to work. Not an oversight — the asymmetry is in the spec |
