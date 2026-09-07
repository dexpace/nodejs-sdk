# pagination

## Rules
- A port of the pagination engine MUST preserve the two-view model, the page-lazy fetch discipline, deterministic response-lifecycle management, and the strategy contract.
  <sub>spec · `docs/product-spec/12-pagination.md:3-3` · high · sha:ba759edd34ec</sub>
- Both the item-level and page-level pagination views MUST be available over the same walk, and items MUST be delivered in server-defined order across page boundaries.
  <sub>spec · `docs/product-spec/12-pagination.md:9-9` · high · sha:ba759edd34ec</sub>
- Pagination iteration MUST be page-lazy such that exactly one HTTP exchange occurs per page actually yielded, with zero exchanges triggered by constructing the paginator or obtaining an iterable/iterator, and the non-blocking engine's walk invocation itself acts as the consumption trigger while still guaranteeing one exchange per page consumed.
  <sub>spec · `docs/product-spec/12-pagination.md:10-10` · high · sha:ba759edd34ec</sub>
- Pagination fetching MUST advance only forward and only on demand, MUST stop permanently after a page whose strategy returns a null/absent next-request, MUST make repeated end-of-stream probes idempotent, and an empty page carrying a non-null next-request still counts as one consumed exchange.
  <sub>spec · `docs/product-spec/12-pagination.md:11-11` · high · sha:ba759edd34ec</sub>
- Each independent pagination iteration MUST restart from the initial request with fresh state, the engine itself MUST hold only immutable configuration and be safe to share, and two separate iterations from the same engine MUST each drive a full fetch sequence yielding identical results, though a single returned iterator/stream MAY be single-consumer.
  <sub>spec · `docs/product-spec/12-pagination.md:12-12` · high · sha:ba759edd34ec</sub>
- Per-call request overrides such as timeout, retry budget, and tags supplied to the strategy-based pagination engine MUST be applied to every page exchange, not just the first, with no overrides applied by default.
  <sub>spec · `docs/product-spec/12-pagination.md:13-13` · high · sha:ba759edd34ec</sub>
- A page's materialized item list and its derived status, headers, and originating request MUST remain readable after the page is closed, only the raw response body/connection becomes invalid at close, and items MUST never be null though they MAY be empty.
  <sub>spec · `docs/product-spec/12-pagination.md:19-19` · high · sha:ba759edd34ec</sub>
- A Page MUST be a closeable resource owning exactly one underlying response, whoever pulls a page owns closing it, closing the page MUST release that response's body/connection, and a component that hands a caller a live page MUST NOT itself close the response.
  <sub>spec · `docs/product-spec/12-pagination.md:20-20` · high · sha:ba759edd34ec</sub>
- A pagination strategy's parse output MUST carry items plus a next-request value where a null/absent next-request is the single exclusive end-of-stream signal, parse MUST always return a well-formed non-null result, termination MUST never be signaled by throwing or a side channel, and an empty items list with a non-null next-request is a valid non-terminal page (PAGE-4).
  <sub>spec · `docs/product-spec/12-pagination.md:26-26` · high · sha:ba759edd34ec</sub>
- A pagination strategy MUST read everything it needs from the response synchronously inside parse since the body is single-use, MUST NOT retain the response or its body beyond the call, MUST NOT close or mutate the response, and strategies MUST be immutable and safe to share concurrently (PAGE-5).
  <sub>spec · `docs/product-spec/12-pagination.md:27-27` · high · sha:ba759edd34ec</sub>
- The pagination engine MUST accept a page cap bounding a server that never advances its cursor, the cap counts exchanges/pages not items, the engine MUST stop fetching once the cap is reached even if the strategy reports a next-request, and the cap MUST be validated as strictly positive at construction rather than lazily.
  <sub>spec · `docs/product-spec/12-pagination.md:31-31` · high · sha:ba759edd34ec</sub>
- The item-level pagination view MUST eager-close each page before yielding any of that page's items, after copying the materialized items, so that abandoning item iteration mid-page never strands the response.
  <sub>spec · `docs/product-spec/12-pagination.md:38-38` · high · sha:ba759edd34ec</sub>
- The page-level pagination view MUST be auto-closing with close-on-abandon guarantees: it closes the previous page as the consumer advances, closes the last page at exhaustion, buffers a fetched-but-undelivered page in owned storage so an emptiness probe or early break followed by explicit close still releases it, and an explicit close MUST release both the currently-held page and any buffered page.
  <sub>spec · `docs/product-spec/12-pagination.md:39-39` · high · sha:ba759edd34ec</sub>
- Consumers of the page-level pagination view MUST be told to wrap the view in a scoped/auto-close construct because up to two live pages can exist at once.
  <sub>spec · `docs/product-spec/12-pagination.md:39-39` · high · sha:ba759edd34ec</sub>
- The page-level pagination view MUST be single-use such that its iterator/stream may be obtained at most once, and re-iteration MUST fail rather than silently restart.
  <sub>spec · `docs/product-spec/12-pagination.md:40-40` · high · sha:ba759edd34ec</sub>
- A close error while releasing held pagination page(s) MUST be surfaced rather than swallowed, MUST be re-thrown wrapped when exposed through a stream whose terminal cannot declare the underlying I/O error type, and when both held pages fail to close, the first failure MUST propagate with the second attached as suppressed.
  <sub>spec · `docs/product-spec/12-pagination.md:41-41` · high · sha:ba759edd34ec</sub>
- If a pagination strategy's parse throws, the engine MUST close that response inline on the exceptional path since the page is never constructed, MUST then propagate the failure, and a close failure MUST NOT mask the parse failure but instead be attached as a suppressed/secondary error with the parse error primary.
  <sub>spec · `docs/product-spec/12-pagination.md:45-45` · high · sha:ba759edd34ec</sub>
- A rel=next target in the Link-header pagination strategy MUST resolve as an RFC 3986 reference against the originating page's response URL, a query-only reference (starting with `?`) MUST preserve the base URL's full path and replace only the query rather than dropping the last path segment, and a target that cannot resolve into a valid URL MUST be treated as end-of-stream rather than an error.
  <sub>spec · `docs/product-spec/12-pagination.md:52-52` · high · sha:ba759edd34ec</sub>
- When rewriting the next-page query string, the rebuilder MUST splice the raw query verbatim, copying every untargeted parameter byte-for-byte with order preserved, and MUST NOT re-render or canonicalize the whole query, decoding/encoding only the targeted parameter's name/value.
  <sub>spec · `docs/product-spec/12-pagination.md:59-59` · high · sha:ba759edd34ec</sub>
- Encoding a newly-set pagination query parameter MUST use RFC 3986 component encoding where a space becomes %20 and a literal + is preserved as data, and reading a parameter MUST decode with the same RFC 3986 semantics.
  <sub>spec · `docs/product-spec/12-pagination.md:60-60` · high · sha:ba759edd34ec</sub>
- Setting a query parameter during pagination request rewriting MUST replace the first existing occurrence in place while dropping further duplicates, MUST append if absent, MUST remove entirely when the new value is null/absent, MUST otherwise preserve order, and following an absolute/whole next URL MUST instead swap only the request's URL while preserving the template's method, headers, and body.
  <sub>spec · `docs/product-spec/12-pagination.md:61-61` · high · sha:ba759edd34ec</sub>
- Pagination URL rewriting MUST preserve all non-query components exactly (scheme, userinfo, host, port, path, fragment), with only the query allowed to change.
  <sub>spec · `docs/product-spec/12-pagination.md:62-62` · high · sha:ba759edd34ec</sub>
- The async pagination engine MUST drive fetch, parse, delivery, and re-arm inside the async completion graph without any thread blocking on a page, and cancelling/completing the walk's result future MUST halt the walk and best-effort abort the in-flight exchange by cancelling its transport future.
  <sub>spec · `docs/product-spec/12-pagination.md:68-68` · high · sha:ba759edd34ec</sub>
- Async pagination cancellation MUST take effect at page granularity so items already being delivered from the current page still reach the consumer while the driver stops at the next page boundary, and a page fetched-but-not-yet-drained when the result settles MUST be dropped undrained and closed, with any close error on that path swallowed.
  <sub>spec · `docs/product-spec/12-pagination.md:69-69` · high · sha:ba759edd34ec</sub>
- The async pagination engine MUST close each page's response exactly once on whichever path consumes it, whether after drain, when a fetched-but-undrained page is dropped, or inline on parse failure, with no double-close and no leak.
  <sub>spec · `docs/product-spec/12-pagination.md:70-70` · high · sha:ba759edd34ec</sub>
- A consumer that throws, a transport/connection failure, a parse failure, a null success completion, or a transport that eagerly throws instead of returning a failed future MUST terminate the async pagination walk and complete the result future exceptionally, surfacing the original underlying cause unwrapped.
  <sub>spec · `docs/product-spec/12-pagination.md:71-71` · high · sha:ba759edd34ec</sub>
- For a single async pagination walk, the consumer MUST NOT be invoked concurrently, items MUST be delivered one at a time in server order, the consumer MUST NOT assume a particular thread, by default the consumer runs inline on the page-completion thread, and the engine MUST also offer a mode running the driver and every consumer invocation on a caller-supplied executor.
  <sub>spec · `docs/product-spec/12-pagination.md:72-72` · high · sha:ba759edd34ec</sub>
- If the async pagination engine is given an executor that rejects a (re-)dispatch, the walk MUST terminate with the result future completed exceptionally carrying the rejection, any staged page MUST be closed, and it MUST NOT hang the future or leak the rejection.
  <sub>spec · `docs/product-spec/12-pagination.md:73-73` · high · sha:ba759edd34ec</sub>
- In the async pagination drain path, releasing a page's response MUST happen whether the consumer succeeds or throws, and a throwing close on the success path MUST be reported through the result future rather than escaping the driver, while a throwing close after the consumer already failed leaves that cause primary and swallows the close error.
  <sub>spec · `docs/product-spec/12-pagination.md:75-75` · high · sha:ba759edd34ec</sub>
- A port MUST document the inherent async pagination cancellation race where an external cancel settling the transport future before the transport delivers its response leaves that response's release as the transport's responsibility, while a page request already dispatched may still complete successfully after the abort, in which case the paginator MUST close and discard that response.
  <sub>spec · `docs/product-spec/12-pagination.md:76-76` · high · sha:ba759edd34ec</sub>
- The fetcher-based pagination front-end MUST call the first-page fetcher exactly once, drive subsequent pages by keying the next-page fetcher off the previous page's next link (falling back to its continuation token only when no next link is present), end the stream on an empty/blank next link with no fallback token or a null page from either fetcher (a null first page yields an empty stream), and each fetcher MUST build a page owning its response without closing it.
  <sub>spec · `docs/product-spec/12-pagination.md:82-82` · high · sha:ba759edd34ec</sub>

## Constraints

## Conclusions
- The default page cap SHOULD be effectively unbounded to match plain lazy-sequence semantics, with documentation directing production callers to set a finite cap.
  <sub>spec · `docs/product-spec/12-pagination.md:32-32` · high · sha:ba759edd34ec</sub>
- When a server splits pagination links across multiple separate Link header instances, the strategy SHOULD normalize them (e.g. by concatenation), and an empty header set SHOULD map to no next link.
  <sub>spec · `docs/product-spec/12-pagination.md:53-53` · high · sha:ba759edd34ec</sub>
- The async pagination driver SHOULD process synchronously-completed page futures iteratively via a trampoline rather than recursive future composition so a long run of already-complete pages does not overflow the stack, though a port on a runtime without deep-recursion risk MAY satisfy the intent with its native loop model but MUST NOT recurse per page.
  <sub>spec · `docs/product-spec/12-pagination.md:74-74` · high · sha:ba759edd34ec</sub>
- If a mutable paging-options object is offered to fetchers, the same instance SHOULD be threaded through every fetcher call so a custom retriever can stash cursor/state between pages, this cross-call mutation visibility SHOULD be documented, and the options object is single-consumer and need not be thread-safe.
  <sub>spec · `docs/product-spec/12-pagination.md:83-83` · high · sha:ba759edd34ec</sub>
- Item-level and page-level pagination consumption views are implemented as two `async function*` generators sharing one internal drive routine, exposed to callers as `AsyncIterable<T>`.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:5-7` · high · sha:d546f9973c4e</sub>
- Page-laziness is satisfied automatically because a generator function's body does not execute until its iterator's first `.next()` call, so constructing the paginator triggers zero exchanges without any additional bookkeeping.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:7-10` · high · sha:d546f9973c4e</sub>
- Close-on-abandon for pagination relies on JavaScript's iterator protocol automatically calling `.return()` on an async iterator when a `for await...of` loop exits early via break, return, or exception, resuming execution at the enclosing `finally` block, unlike Kotlin's `Iterator`/`Sequence` protocol which has no built-in early-termination cleanup hook and requires a bespoke `CloseablePages` wrapper.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:12-19` · high · sha:d546f9973c4e</sub>
- The page-level view holds the currently delivered page in the generator's `held` binding, releasing it upon advancing before dispatching the next request and releasing the last held page at exhaustion or early termination via the enclosing `finally` block.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:32-34` · high · sha:d546f9973c4e</sub>
- The port rejects `URLSearchParams` for verbatim query-parameter splicing because it re-serializes the entire query string through its own canonical encoding on every mutation, reordering and re-encoding untouched parameters and encoding space as `+` rather than the RFC 3986 `%20` the port's query model otherwise standardizes on.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:36-41` · high · sha:d546f9973c4e</sub>
- The query-parameter rewriter operates directly on the raw query substring via hand-rolled tokenization, splicing only the targeted parameter's value and leaving every other byte of the query string untouched.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:41-44` · high · sha:d546f9973c4e</sub>

## Reference
- The pagination engine is transport-agnostic and serde-agnostic, driven by a single stateless strategy that parses each response into the page's items plus the fully-formed request for the next page or an end-of-stream signal.
  <sub>spec · `docs/product-spec/12-pagination.md:3-3` · high · sha:ba759edd34ec</sub>
- The pagination engine exposes an item-level view that flattens each page's items into one ordered sequence and a page-level view that yields whole pages exposing raw per-page status, headers, originating request, and the live response.
  <sub>spec · `docs/product-spec/12-pagination.md:7-7` · high · sha:ba759edd34ec</sub>
- The built-in cursor pagination strategy reads items and the next cursor from a single read of the response body, treats a null or empty next cursor as end-of-stream, and derives the next request by setting a configurable cursor query parameter that defaults to `cursor` on the template.
  <sub>spec · `docs/product-spec/12-pagination.md:49-49` · high · sha:ba759edd34ec</sub>
- The built-in page-number pagination strategy treats an empty items list as end-of-stream, infers the current page from the originating request's page query parameter (defaulting to a configurable start page, default 1, when absent/empty/non-numeric), sets the next request's page to current+1, and allows the page parameter name (default `page`) and start page to be configured.
  <sub>spec · `docs/product-spec/12-pagination.md:50-50` · high · sha:ba759edd34ec</sub>
- The built-in Link-header pagination strategy selects the next URL using RFC 5988/8288 semantics by finding the first link-value whose rel contains the token "next" case-insensitively, parses link-values so commas inside angle-bracketed URLs or quoted parameter values do not split them, supports quoted-pair escapes, treats absence of a Link header or a rel=next segment as end-of-stream, and allows the header name to be configured (default `Link`).
  <sub>spec · `docs/product-spec/12-pagination.md:51-51` · high · sha:ba759edd34ec</sub>
- A cursor/continuation token is an opaque string a server returns to identify the next page of a paginated result, which the pagination cursor strategy folds into the next request's query.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:21` · high · sha:f0b3d2058626</sub>
- A Page is one page of results wrapping the live transport response, whose materialized items and derived metadata survive close while the raw body/connection is valid only until close.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:39` · high · sha:f0b3d2058626</sub>
- PageInfo is a pagination strategy's parse output consisting of the items on the current page plus the next-page request, where a null/absent next-request is the single end-of-stream signal.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:41` · high · sha:f0b3d2058626</sub>
- A pagination strategy is a stateless, immutable parser that, given a response and the original request template, returns a PageInfo, with three built-ins being cursor, page-number, and Link-header.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:43` · high · sha:f0b3d2058626</sub>
- The pagination conformance suite verifies that an item view and a page view over a one 3-page walk yield concatenated server-order items and three page objects (PAGE-1), that page metadata survives close (PAGE-2), and that a page closes its response exactly once with a fetcher never closing it (PAGE-3).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:7` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies that blocking iteration triggers zero exchanges until the first probe and then one exchange per page consumed while async pagination begins fetching on invocation (PAGE-6), that no fetch occurs past the terminal page with idempotent end-probes (PAGE-7), and that two iterations each drive a full sequence (PAGE-8).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:8` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies that a cap of zero or less throws at construction, that a non-advancing server stops at exactly N exchanges (PAGE-9), and that the default cap is effectively unbounded (PAGE-10).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:9` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies that item view eager-closes each page before yielding items on partial consume (PAGE-11), that page view releases held and buffered pages on early break or probe-then-close (PAGE-12), that a second page-view iterator throws (PAGE-14), and that a held-page close error surfaces wrapped with a second failure suppressed (PAGE-15).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:10` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies that a parse-throw closes the response inline with the parse error as primary and any close error suppressed (PAGE-13).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:11` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies cursor pagination ends on null/empty with a single body read (PAGE-16), page-number pagination ends on empty items with a start-page fallback on garbage (PAGE-17), Link-header pagination handles rel=next with quoted commas, multi-token rel, and multi-header split (PAGE-18/PAGE-20), and a query-only reference preserves the base path while an unparseable target ends iteration (PAGE-19).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:12` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies verbatim query splicing preserves untouched params byte-for-byte (PAGE-21), RFC 3986 component encode/decode treats `+` as data (PAGE-22), set operations replace-first/append/remove correctly with a whole-URL follow preserving method/headers/body (PAGE-23), and non-query URL components are preserved (PAGE-24).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:13` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies async pagination has no per-page thread block with cancel aborting the in-flight transport future (PAGE-25); page-granular cancellation drops and closes a staged page (PAGE-26); every response is closed exactly once across all paths (PAGE-27); failures surface the original cause including an eager transport throw (PAGE-28); serial ordered delivery plus executor mode (PAGE-29); executor rejection fails the walk and closes the staged page (PAGE-30); a trampoline handles thousands of sync pages (PAGE-31); a throwing close on success is reported through the future (PAGE-32); and cancellation-race ownership is documented (PAGE-33).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:14` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies the fetcher front-end runs the first fetcher once, uses nextLink over token, and terminates on a blank link or null (PAGE-34), and that the same options instance is threaded through with mutation observed (PAGE-35).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:15` · high · sha:0451cc7f3bb4</sub>
- The pagination conformance suite verifies that per-call options reach every page exchange (PAGE-36).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:16` · high · sha:0451cc7f3bb4</sub>
- The port's item-level generator wraps `yield* page.items` in a `finally` block that awaits `page.close()`, so an early `break` in the consumer's loop automatically triggers page closure with no wrapper type or documented convention required.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:19-31` · high · sha:d546f9973c4e</sub>

## Conflicts
- **spec vs design: item-view close ordering** — `PAGE-11` requires the item-level view to eager-close each page **before** yielding any of that page's items, after copying them. The §7.1 snippet shows the opposite ordering — `yield*` inside a `try`, `close()` in the `finally` — which holds the response open for the entire time a consumer walks that page's items.
  <sub>spec `docs/product-spec/12-pagination.md:38` · design `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:19-31` · resolved 2026-07-28</sub>

## Superseded
