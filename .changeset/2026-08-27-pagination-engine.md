---
'@dexpace/core': minor
---

Add the pagination engine for product-spec §12 (`PAGE-1`–`PAGE-36`). The public surface is `Paginator<T>`
with its two views, the `Page<T>` resource, the `PageInfo<T>` / `pageInfo()` pair and the
`PaginationStrategy<T>` interface, three built-in strategies (`cursorStrategy()`, `pageNumberStrategy()`,
`linkHeaderStrategy()`), the fetcher-driven front end `paginateWithFetchers()` with `PagingOptions` and
`FetcherPage<T>`, and the `PaginationError` leaf.

The engine drives a `Transport` directly and stays serde-agnostic: item extraction is a caller-supplied
callback on every built-in strategy, never a `Serde`. Resilience composes from outside — 4c's `Runtime` is
itself a `Transport`, so a full retry/redirect/auth pipeline drops in as the `transport` field with no
pagination-side change, recorded at `docs/open-items.md` §J5. The query splice and the `Link`
tokenizer stay internal; publishing them would stand a second URL-manipulation surface next to Phase 1's
`QueryParams`, which is the confusion the one-encoder rule exists to avoid.

What landed under `packages/core/src/pagination/`: `page.ts`, `strategy.ts`, `paginator.ts`,
`strategies.ts`, `link-header.ts`, `query-splice.ts`, `fetchers.ts`, and `errors.ts`, plus
`test/node-conformance/pagination.test.mjs`.

Three files changed outside it. `packages/core/src/http/query-params.ts` now exports
`encodeQueryComponent`/`decodeQueryComponent` (both `@internal`, so the API report is unaffected) —
`PAGE-22` restates HTTP-29's encoding rule verbatim, and two encoders in one codebase is a drift bug
waiting to happen. `packages/core/src/testing/fake-transport.ts` gains `sentOptions`/`sentSignals`
accessors and an init-object overload on `countingResponse()`. And `tsconfig.base.json` adds
`ESNext.Disposable` to `lib` — see the caveat below, because that one reaches consumers.

Five design calls worth recording:

- **Each page is closed *before* any of its items are yielded**, not in a `finally` after. `PAGE-11`
  mandates the ordering and `sdk-design-nodejs/07` §7.1's illustrative snippet shows the opposite — it
  closes after the yield, which holds the response open for the entire item walk and still passes the
  requirement's stated conformance test. Materialized items survive close (`PAGE-2`), so closing first
  costs nothing and means abandoning iteration mid-page can never strand a connection, however long the
  consumer takes. An erratum callout was added to §7.1; recorded at `docs/open-items.md` §J1.
- **`PaginationStrategy.parse` is asynchronous, against `PAGE-5`'s literal wording.** The requirement says
  a strategy reads what it needs "synchronously inside parse"; this runtime has no synchronous body read,
  because the bytes may not have arrived. Every enforceable part of the intent — isolated, non-mutating,
  one read, no retained body — survives the promise and is stated on the interface, since none of it is
  expressible in the type system. Recorded at §J2. It cannot be "fixed" back to a synchronous signature.
- **The query splice is hand-rolled rather than `URLSearchParams` or `QueryParams`.** Both re-serialize
  the *whole* query through their own canonical encoding on every mutation: untouched parameters get
  reordered and re-encoded, against `PAGE-21`'s byte-for-byte rule, and a space becomes `+` rather than
  the `%20` this port standardizes on. `query-splice.ts` tokenizes the raw query substring and copies
  every untargeted byte through, sharing only the component *encoder* — the part `PAGE-22` and `HTTP-29`
  genuinely agree on (§J4).
- **`Link` parsing is a scanner, not a regular expression.** The separator rules are context-sensitive in
  two directions at once: a comma splits link-values only outside both angle brackets and quoted strings,
  and a semicolon splits parameters under the same condition — and quoted strings support `\"` escapes, so
  quote tracking cannot be a simple toggle. A target that fails to resolve is end-of-stream, not an error
  (`PAGE-19`), which is one of the few places in this codebase where swallowing an exception is the
  specified behavior rather than a smell.
- **`items()` is re-iterable and `pages()` is single-use.** The asymmetry is deliberate: each `items()`
  walk closes every page before yielding, so a second iteration simply drives a second fetch sequence
  (`PAGE-8`), while `pages()` hands out live connection-owning objects whose re-iteration would
  double-consume unclosed resources (`PAGE-14`). `paginateWithFetchers()` is single-use for the same
  reason — a second loop would re-run `first()` and break `PAGE-34`'s "exactly once" (§J6).

Limits worth knowing at the call site:

- **`Page` declares `implements AsyncDisposable` unconditionally, and this package's declared `lib` grew
  `ESNext.Disposable` to make that compile.** A consumer compiling the published `.d.ts` needs the same
  lib entry (`"ESNext.Disposable"`, or `esnext`) or `Page` will not typecheck for them. This is also the
  one place the SDK is now internally inconsistent about explicit resource management: `Response`
  (`HTTP-38`) and Phase 6b's `SseStream` install `[Symbol.asyncDispose]` behind a runtime guard precisely
  because the declared `engines.node` floor is `>=20.3` and the symbol landed in 20.4, where a computed
  key evaluating to `undefined` binds the method to the string `"undefined"` instead. `Page` takes the
  unguarded route (§J3), so on the declared floor `await using page = ...` does not dispose and the class
  carries a stray `"undefined"` method. `test/node-conformance/pagination.test.mjs` does not catch this —
  its `page[Symbol.asyncDispose]` lookup coerces the key the same way the class definition did, so the
  assertion passes on 20.3 without exercising anything. Resolving this one way or the other is a
  floor-bump decision, not a pagination one.
- **Cancellation cannot reach a response the engine never received** (`PAGE-33`). If `signal` aborts
  before the transport delivers, releasing that response is the transport's job. A request already
  dispatched may still complete after the abort; when it does, the engine closes and discards it rather
  than yielding it.
- **`PaginationError` is reserved for engine misuse** — a non-positive `maxPages` at construction
  (`PAGE-9`), or a second iterator on a single-use view (`PAGE-14`). Transport, parse, and close failures
  propagate as whatever the underlying layer raised, because `PAGE-28` requires the original cause to
  surface rather than a pagination-flavored wrapper (§J8).
- **Ownership transfers to the page.** A fetcher builds a `Page` and must not close its response; the
  engine closes it as the consumer advances and at exhaustion. A fetcher that throws *before* building the
  page still owns whatever response it opened — the engine never saw it and has no handle to close it
  with.
- **Two built-in strategies defend against servers that never signal termination.** `cursorStrategy`
  treats an empty-string cursor as end-of-stream alongside `null`, and `pageNumberStrategy` stops on an
  empty item list before any arithmetic runs. Both would otherwise walk forever against a server that
  keeps answering past the end.
