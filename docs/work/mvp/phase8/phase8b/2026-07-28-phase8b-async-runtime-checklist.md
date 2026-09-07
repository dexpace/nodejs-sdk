# Phase 8b — Async-Runtime Bridge — Checklist

**Status: EXECUTED.** Every ✅ below names code and tests that exist on this branch, not a plan step. Verified
against `docs/product-spec/18-asynchronous-runtime-adapter-contract.md` (`ASYNC-1` through `ASYNC-22`),
`docs/product-spec/13-server-sent-events-and-streaming.md` (`SSE-41`), plus Task 1 through Task 4 deliverables,
package builds, and API reports.

**One implementation deviation**, recorded in full in the plan's Self-Review: the `AsyncIterable`→`Observable`
bridge is `packages/rx/src/from-async-iterable.ts`, not RxJS's own `from()`, because `rxjs@7.8.2` does not reach
the source when a subscription is torn down while a pull is suspended — the `ASYNC-6` clause an idle SSE stream
depends on. Every row citing that module below is citing the reason it exists. The `🚫` rows that name Phase 8a
are **not satisfied yet**: they collapse onto `TRANSPORT-*` requirements no shipped package implements — see
`docs/work/mvp/2026-09-04-open-items-dissolution.md` §M2.

**Legend:** ✅ Implemented and tested — 🚫 Not built (permanent simplification / collapse, named reason) — ⏳ Deferred
(named target phase) — N/A Not applicable in this port.

## 18.1 Completion and failure delivery

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-1 | MUST | Single-value completion future delivers non-null Response on success, failure channel on no response | 🚫 | Collapses onto `TRANSPORT-23` (Phase 8a) — for `Transport`, `send()` returns `Promise<Response>` directly |
| ASYNC-2 | MUST | Construction-time failure via failure channel, not sync throw | 🚫 | Collapses onto `TRANSPORT-21` (Phase 8a) |

## 18.2 Cancellation modes

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-3 | MUST | Cancel-with-interrupt vs without on worker thread | N/A | Node event loop has no worker-thread-pool transport model to interrupt (`SEAM-18` disposition) |
| ASYNC-4 | MUST | Ordered interrupt delivery preventing pooled-thread poisoning | N/A | Node event loop has no pooled worker threads to poison (`SEAM-18` disposition) |
| ASYNC-5 | MUST | Orphaned closeable result closed exactly once on race | 🚫 | Collapses onto `TRANSPORT-9` (Phase 8a) |
| ASYNC-6 | MUST | Bidirectional cancellation across adapter | ✅ | `packages/rx/src/from-async-iterable.ts`'s teardown (release the source, then `iterator.return()`). Asserted across all four paths — synchronous unsubscribe from inside `next()`, unsubscribe while a pull is suspended, unsubscribe before the first emission, and a rejected release — in `from-async-iterable.conformance.test.ts`, `sse.test.ts`, `pagination.test.ts`, and on real Node in `test/node-conformance/rx-bridge.test.mjs`. The same suite pins RxJS's native `from()` **failing** this clause |
| ASYNC-7 | SHOULD | Document interrupt-mode choice per adapter | N/A | Vacuous: no blocking worker thread calls to interrupt |

## 18.3 Logging-context propagation

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-8 | SHOULD | Propagate logging context across thread/scheduler hops | ✅ | Node `AsyncLocalStorage` auto-propagation through promise chains/async iteration; the package installs no RxJS scheduler, which is what keeps the continuation chain intact. Stated in `sseEvents$`/`typedSse$` TSDoc, including the caller-introduced `observeOn`/`subscribeOn` boundary |
| ASYNC-9 | MUST | Save, install, restore logging context | ✅ | Node `AsyncLocalStorage` auto-propagation invariant |
| ASYNC-10 | MUST | Capture logging context at logical caller point | ✅ | Node `AsyncLocalStorage` captures per subscription at iteration pull time |
| ASYNC-11 | MUST | Safe when no logging context backend installed | ✅ | `AsyncLocalStorage` handles undefined store gracefully |
| ASYNC-12 | MUST | Explicit transfer at thread boundary where auto-inheritance absent | N/A | Single-threaded event loop; continuation-local storage auto-propagates |

## 18.4 Error unwrapping and blocking bridge

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-13 | MUST | Unwrap async framework wrapper exceptions to original cause | ✅ | `packages/rx/src/from-async-iterable.ts` passes a thrown value straight to `subscriber.error`; asserted in `from-async-iterable.conformance.test.ts` (`RangeError` in, same `RangeError` out) and `sse.test.ts` (a throwing `SseMapper`) |
| ASYNC-14 | MUST | Async->sync blocking bridge honoring thread interruption | N/A | Inapplicable in Node — no blocking HTTP client bridge (`SEAM-18` disposition) |

## 18.5 Lifecycle

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-15 | MUST | Close/dispose operation idempotent, ownership-aware, interrupt-safe | 🚫 | Owned by Phase 8a `TRANSPORT-15`/`16`; `@dexpace/rx` owns no background thread pools |
| ASYNC-16 | SHOULD | Graceful executor shutdown on close | 🚫 | Owned by Phase 8a |
| ASYNC-17 | SHOULD | No-op default close for lightweight/functional transports | 🚫 | Owned by Phase 8a (`transport-fetch`) |

## 18.6 Delay, options, and streaming

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| ASYNC-18 | MUST | Non-blocking scheduled-delay primitive | N/A | Resolved N/A to this port: `@dexpace/rx` does no reconnection, retry, or backoff; SSE reconnection is caller-owned; pagination retry lives in pipeline layer |
| ASYNC-19 | MUST | Per-call request options threaded through overloads | N/A | Resolved N/A: `@dexpace/rx` wraps already-constructed `SseStream` / `Paginator` instances; does not initiate new HTTP calls |
| ASYNC-20 | MUST | Delivered Response body not closed on late future cancel | 🚫 | Restates `SEAM-16` / transport invariant owned by Phase 8a |
| ASYNC-21 | MUST | Reactive streaming adapter (SSE) honors backpressure, completes on end-of-source, propagates errors without swallowing, single-subscriber | ✅ | `packages/rx/src/sse.ts`: `sseEvents$`, `typedSse$`, over `from-async-iterable.ts`'s one-pull-per-emission loop. `from-async-iterable.conformance.test.ts` (poll-once-per-demand, complete-on-end, error passthrough), `sse.test.ts` (single-subscriber via `SSE-26`), `test/node-conformance/rx-bridge.test.mjs` |
| ASYNC-22 | MUST | Safe for concurrent calls | 🚫 | Collapses onto `TRANSPORT-29` (Phase 8a) |

## 13.7 Server-Sent Events

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-41 | MAY | Reactive SSE adapter with fatal/non-fatal split and documented source ownership | ✅ | `packages/rx/src/sse.ts`: `sseEvents$`, `typedSse$`. Source ownership is documented on both functions and in `packages/rx/README.md` (the adapter closes the stream on unsubscribe; the caller owns reconnection). The fatal/non-fatal split collapses — JavaScript has no catchable-fatal tier, per the design doc's Deviation Ledger. Asserted in `sse.test.ts` and `from-async-iterable.conformance.test.ts` |
