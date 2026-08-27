# Phase 6c — Pagination Implementation Plan — Checklist

Verification of pagination requirements (`PAGE-1`–`PAGE-36`) from `docs/product-spec/16-pagination.md` and `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md`, as dispositioned by `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`.

**Status: EXECUTED (2026-08-27).** All tasks implemented, tested, and reviewed. Deviations and design ledger rows are recorded in `docs/open-items.md` §I.

**Legend:** ✅ Implemented and tested — ✅(t) Satisfied by construction or type test — 🚫 Not built — ⏳ Deferred — N/A Not applicable.

---

## §16.1 — Core Data Model & Strategy Contract (`PAGE-1`–`PAGE-5`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-1 | MUST | Items and pages views over one walk, server order preserved across page boundaries | ✅ | `Page`, `Paginator` in `packages/core/src/pagination/page.ts`, `paginator.ts`, tested in `paginator.test.ts` |
| PAGE-2 | MUST | Materialized items frozen, survive close; items never null | ✅ | `packages/core/src/pagination/page.ts`, tested in `page.test.ts` |
| PAGE-3 | MUST | Exactly one owned response per page; idempotent close delegates to `Response.close()` | ✅ | `packages/core/src/pagination/page.ts`, `Page.close()`, `Page[Symbol.asyncDispose]()`, tested in `page.test.ts` |
| PAGE-4 | MUST | `PageInfo` carries items + nextRequest; `undefined` signals end of stream | ✅ | `packages/core/src/pagination/page.ts` (`pageInfo`), tested in `page.test.ts` |
| PAGE-5 | MUST | `PaginationStrategy.parse` contract returning `Promise<PageInfo<T>>` | ✅ | `packages/core/src/pagination/strategy.ts`, tested in `strategy.test.ts` (ledger row I2) |

---

## §16.2 — Paginator Lifecycle & Consumption Views (`PAGE-6`–`PAGE-15`, `PAGE-27`, `PAGE-31`–`PAGE-33`, `PAGE-36`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-6 | MUST | Page-lazy: zero wire exchanges before first probe | ✅ | `Paginator.#walk`, tested in `paginator.test.ts` |
| PAGE-7 | MUST | Forward-only walk, idempotent end probes | ✅ | `Paginator.#walk`, tested in `paginator.test.ts` |
| PAGE-8 | MUST | Independent iterations over item-level view (`items()`) | ✅ | `Paginator.items()`, tested in `paginator.test.ts` |
| PAGE-9 | MUST | `maxPages` cap: positive integer at construction, stops walk | ✅ | `Paginator`, `paginateWithFetchers`, tested in `paginator.test.ts`, `fetchers.test.ts` |
| PAGE-10 | MUST | Capped walk delivers exactly capped count even when strategy supplies nextRequest | ✅ | `Paginator.#walk`, tested in `paginator.test.ts` |
| PAGE-11 | MUST | Close response BEFORE yielding items on `items()` view | ✅ | `Paginator.items()`, tested in `lifecycle.test.ts` (ledger row I1) |
| PAGE-12 | MUST | Auto-close on abandon / break / exhaustion, scoped construct (`await using`) support | ✅ | `Page[Symbol.asyncDispose]`, `Paginator.#walk`, tested in `page.test.ts`, `lifecycle.test.ts` |
| PAGE-13 | MUST | Parse failure closes inline, close error suppressed | ✅ | `parseOrClose` in `paginator.ts`, tested in `lifecycle.test.ts` |
| PAGE-14 | MUST | Page-level view (`pages()`) is single-use; subsequent iterator throws | ✅ | `Paginator.pages()`, `paginateWithFetchers`, tested in `lifecycle.test.ts`, `fetchers.test.ts` |
| PAGE-15 | MUST | Close errors surface when walk or release fails | ✅ | `releaseHeldOnFailure`, `suppress()`, tested in `lifecycle.test.ts`, `fetchers.test.ts` |
| PAGE-27 | MUST | Every response closed exactly once (no double-close, no leak) | ✅ | `lifecycle.test.ts` (`test.each`), `test/node-conformance/pagination.test.mjs` |
| PAGE-28 | MUST | Underlying causes propagated unwrapped | ✅ | `lifecycle.test.ts`, `errors.test.ts` |
| PAGE-29 | MUST | Async parse boundary (`Promise<PageInfo<T>>`) | ✅(t) | `strategy.ts`, `strategy.test.ts` |
| PAGE-30 | MUST | Synchronous item array within page | ✅(t) | `page.ts`, `strategy.test.ts` |
| PAGE-31 | MUST | Stack safety across thousands of pages (iterative generator drive) | ✅ | `cancellation.test.ts` (5000 pages test) |
| PAGE-32 | MUST | Consumer throw discards return-phase close error, keeping consumer error primary | ✅ | `Paginator.#walk` finally, tested in `lifecycle.test.ts` |
| PAGE-33 | MUST | Race between abort and arrival drops and closes response | ✅ | `Paginator.#walk`, tested in `cancellation.test.ts` |
| PAGE-36 | MUST | Per-operation RequestOptions passed to every page exchange | ✅ | `Paginator.#walk`, tested in `paginator.test.ts` |

---

## §16.3 — Built-in Strategies & Parsing (`PAGE-16`–`PAGE-20`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-16 | MUST | Built-in cursor strategy (single body read, null/empty/undefined ends) | ✅ | `packages/core/src/pagination/strategies.ts` (`cursorStrategy`), tested in `strategies.test.ts` |
| PAGE-17 | MUST | Built-in page number strategy (empty items ends, start page fallback) | ✅ | `packages/core/src/pagination/strategies.ts` (`pageNumberStrategy`), tested in `strategies.test.ts` |
| PAGE-18 | MUST | Built-in link header strategy (RFC 8288, case-insensitive `rel="next"`) | ✅ | `packages/core/src/pagination/strategies.ts`, `link-header.ts`, tested in `strategies.test.ts`, `link-header.test.ts` |
| PAGE-19 | MUST | Unresolvable Link header URL throws | ✅ | `packages/core/src/pagination/strategies.ts`, tested in `strategies.test.ts` |
| PAGE-20 | MUST | Multiple Link headers parsed and combined | ✅ | `packages/core/src/pagination/link-header.ts`, tested in `link-header.test.ts`, `strategies.test.ts` |

---

## §16.4 — Verbatim Query Splicing (`PAGE-21`–`PAGE-24`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-21 | MUST | Verbatim query splice without URLSearchParams; untargeted params preserved byte-for-byte | ✅ | `packages/core/src/pagination/query-splice.ts`, tested in `query-splice.test.ts`, `query-splice.property.test.ts` |
| PAGE-22 | MUST | RFC 3986 percent-encoding in query components (`+` is data, not space) | ✅ | `packages/core/src/http/query-params.ts`, `query-splice.ts`, tested in `query-splice.test.ts` |
| PAGE-23 | MUST | Replace-first, append, remove query parameter maintaining order | ✅ | `packages/core/src/pagination/query-splice.ts`, tested in `query-splice.test.ts`, `query-splice.property.test.ts` |
| PAGE-24 | MUST | Non-query URL components preserved verbatim | ✅ | `packages/core/src/pagination/query-splice.ts`, tested in `query-splice.test.ts` |

---

## §16.5 — Cancellation Integration (`PAGE-25`–`PAGE-26`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-25 | MUST | AbortSignal threaded into every exchange | ✅ | `Paginator.#walk`, tested in `cancellation.test.ts`, `test/node-conformance/pagination.test.mjs` |
| PAGE-26 | MUST | Page-granular cancellation (abort stops walk, in-flight response closed and dropped) | ✅ | `Paginator.#walk`, tested in `cancellation.test.ts`, `test/node-conformance/pagination.test.mjs` |

---

## §16.6 — Fetcher-Based Front-End (`PAGE-34`–`PAGE-35`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PAGE-34 | MUST | Fetcher pagination (`first` once, `next` keys off link/token, returns `Page`) | ✅ | `packages/core/src/pagination/fetchers.ts` (`paginateWithFetchers`), tested in `fetchers.test.ts` |
| PAGE-35 | MUST | Mutable shared options bag threaded across fetcher calls | ✅ | `packages/core/src/pagination/fetchers.ts` (`PagingOptions`), tested in `fetchers.test.ts` |
