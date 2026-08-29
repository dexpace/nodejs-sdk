---
"@dexpace/rx": minor
---

Add `@dexpace/rx`, the RxJS async-runtime bridge (Phase 8b, `SSE-41` / the non-collapsed `ASYNC-*` subset):

- `sseEvents$(stream)` and `typedSse$(stream, mapper)` — single-subscription `Observable` views of Phase 6b's
  `SseStream` and `typedSseStream`. A second `subscribe()` surfaces `SseStream`'s own `SSE-26` guard through the
  error channel rather than inventing a new restriction.
- `pageItems$(paginator)` and `pages$(paginator)` — cold, repeatable `Observable` views of Phase 6c's
  `Paginator`, one independent fetch sequence per subscription (`PAGE-8`).
- Unsubscribing reaches the source even while a pull is suspended (`ASYNC-6`), so an idle SSE stream releases its
  response body immediately instead of at the server's next event. This is the one clause RxJS's own
  `from(asyncIterable)` does not satisfy, so the package ships a small internal bridge in its place; the
  conformance suite pins both behaviors.
- Source errors reach the error channel unwrapped (`ASYNC-13`); no new error class.
- `rxjs` and `@dexpace/core` are peer dependencies, and the package has zero runtime dependencies (`SEAM-1`).
