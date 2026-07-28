# Phase 8b — Async-Runtime Bridge — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement `@dexpace/rx`, exposing Phase 6's `Paginator`/`Page` and `SseStream` as RxJS `Observable`s
— satisfying the non-collapsed subset of `docs/product-spec/18-asynchronous-runtime-adapter-contract.md`
(`ASYNC-*`) identified in the [Phase 8 segmentation design](./2026-07-28-phase8-segmentation-design.md) §5.2, plus
`SSE-41` (the reactive SSE adapter, Phase 6 brainstorm). Second of two Phase 8 sub-phases; has no dependency on 8a
and may execute in either order.

**Governing documents:** `docs/product-spec/18-asynchronous-runtime-adapter-contract.md`, `docs/product-spec/
13-server-sent-events-and-streaming.md` (`SSE-41`, `SSE-26`'s single-pass rule), `docs/superpowers/specs/
2026-07-28-phase8-segmentation-design.md` §4/§5.2/§7 (this document resolves every 8b open item that document
flagged), `docs/superpowers/specs/2026-07-28-phase6b-sse-design.md` (`SseStream`, `typedSseStream`),
`docs/superpowers/specs/2026-07-28-phase6c-pagination-design.md` (`Paginator`, `Page`), `docs/superpowers/specs/
2026-07-28-phase7b-observability-design.md` (the `AsyncLocalStorage` diagnostic-context bridge this phase reuses),
`docs/sdk-design-nodejs/02-package-and-workspace-layout.md`, `docs/knowledge/{concurrency-and-async,
sse-streaming,pagination,observability,resource-management}.md`.

**How this doc was produced.** Solo, user away from keyboard, `docs/knowledge/` as standing tie-breaker. No
packages exist yet in this repository — planning only, like every prior phase design.

## Scope

8b ships one package, `@dexpace/rx`, and nothing else. It does not touch `Transport`, `§17`, or any of 8a's
packages (segmentation design §2 — verified zero contract dependency in either direction). It ships the
non-collapsed `ASYNC-*` subset (§2 below narrows this further than the segmentation design could without seeing
the concrete API shape) plus `SSE-41`.

## §1 — The one real primitive: `AsyncIterable<T>` → `Observable<T>`

Both of 8b's wrapping targets are already `AsyncIterable`, not bespoke shapes needing separate bridge code:

```typescript
// already shipped by Phase 6, consumed here unmodified
class SseStream implements AsyncIterable<SseEvent> { [Symbol.asyncIterator](): AsyncIterator<SseEvent>; close(): Promise<void>; }
function typedSseStream<T>(stream: SseStream, mapper: SseMapper<T>): AsyncIterable<T>;
class Paginator<T> { items(): AsyncIterable<T>; pages(): AsyncIterable<Page<T>>; }
```

`package-and-dependency-layout.md`'s "exposing pagination and SSE as RxJS Observables" therefore reduces to one
generic primitive plus four thin, named, ergonomic wrappers over it — not four independent bridge
implementations. **RxJS 7+ ships a native `from(input: ObservableInput<T>): Observable<T>` overload that already
accepts an `AsyncIterable<T>`** (`ObservableInput` is a documented RxJS union covering promises, iterables,
async iterables, and array-likes). The design decision this phase makes explicitly, per the project's own "a
second implementation would be a defect" discipline (6c's `HTTP-29` precedent): **do not hand-write the
`AsyncIterable`→`Observable` pull loop.** Use RxJS's own `from()`, and prove — not assume — that it satisfies
`ASYNC-21`'s clauses with a conformance test per clause (§4). If any clause's test fails against the installed
RxJS version, a minimal wrapping `Observable` is the fallback, scoped to only the failing clause — recorded as an
open item for plan time (§6), not resolved by assumption here.

```typescript
// packages/rx/src/sse.ts
export function sseEvents$(stream: SseStream): Observable<SseEvent>;
export function typedSse$<T>(stream: SseStream, mapper: SseMapper<T>): Observable<T>;

// packages/rx/src/pagination.ts
export function pageItems$<T>(paginator: Paginator<T>): Observable<T>;
export function pages$<T>(paginator: Paginator<T>): Observable<Page<T>>;
```

All four are one-line bodies: `from(stream)`, `from(typedSseStream(stream, mapper))`, `from(paginator.items())`,
`from(paginator.pages())`. The value this package adds is not the bridge logic — RxJS supplies that — but the
**documented, tested, named surface** or a Node/RxJS team would otherwise have to discover `from()`'s async-
iterable overload themselves and get the single-subscription question (§2) wrong.

## §2 — Single-subscription (SSE) vs. cold/repeatable (pagination), and why they differ

This is a real asymmetry the segmentation design didn't have visibility into (it named the open question; this is
the answer), and it must be documented, not smoothed over:

- **`sseEvents$`/`typedSse$` are single-subscription.** `SseStream` wraps one already-open HTTP response whose
  body is itself single-use (`BODY-14`) and is itself single-pass by contract (`SSE-26`: "obtaining an iterator
  succeeds at most once... a second attempt MUST fail loudly"). There is no way to make the *domain* repeatable —
  you cannot re-read an already-consumed response body — so `sseEvents$` cannot honestly be a standard cold,
  multi-subscribe `Observable`. A second `.subscribe()` call reaches `SseStream`'s own already-shipped guard and
  fails loudly, inheriting `SSE-26`'s behavior rather than reimplementing it. This is `SseStream`'s existing
  contract surfacing through the bridge unchanged, not a new restriction 8b invents.
- **`pageItems$`/`pages$` are properly cold and repeatable.** `Paginator.items()`/`.pages()` each construct a
  **fresh** generator per call (6c's design, `PAGE-8`: "two iterations drive two full fetch sequences"), so
  `from(paginator.items())` called again — or the same `Observable` subscribed twice, since `from()` re-invokes
  its input factory-shaped argument per subscription for a repeatable input — drives a second, independent fetch
  sequence. Standard RxJS cold-Observable semantics, no caveat needed.

`@dexpace/rx`'s TSDoc on `sseEvents$`/`typedSse$` must state the single-subscription restriction explicitly
(mirroring `SseStream`'s own TSDoc) so a caller does not discover it only at a confusing second-subscribe
failure.

## §3 — Resolving the segmentation design's open items

**`ASYNC-6` (bidirectional cancellation).** `Observable.subscribe()` returns a `Subscription`; calling
`.unsubscribe()` on it must reach the underlying generator's `.return()`. This is exactly what a `for await...of`
loop's early exit already does under JS's iteration protocol, and it is exactly what RxJS's `from()` does
internally for an async-iterable input (breaking its internal pull loop on unsubscribe triggers `.return()` on
the iterator) — so this is **satisfied by RxJS's existing implementation**, confirmed by a conformance test
(§4), not hand-built. Closing the generator is in turn what already triggers `SseStream.close()`/`Page.close()`'s
established lifecycle (`SSE-23`–`SSE-32`, `PAGE-11`/`PAGE-26`/`PAGE-27`/`PAGE-32`) — 8b adds no new close logic,
it relies on a cancellation reaching a `finally` block that already exists.

**`ASYNC-19` (per-call options threading) — resolved N/A, not merely narrowed.** Re-examined against the concrete
API in §1: none of the four wrapper functions accepts `RequestOptions` or starts a new HTTP call. `Paginator`'s
constructor already takes `options`/`signal` (6c's design; `PAGE-36`'s per-call-options-reaches-every-page
conformance test is 6c's, already closed there), and `SseStream` wraps an already-fetched `Response`. There is no
options parameter anywhere in `@dexpace/rx`'s surface for a per-call override to fail to reach — the requirement
does not apply because the shape of what this package does (wrap an already-configured object) is not the shape
the requirement is written against (start a new call through a bridge).

**`ASYNC-18` (non-blocking scheduled-delay primitive) — resolved N/A, correcting the segmentation design's
framing.** The segmentation design left this as "check whether 5a/7a already built a reusable primitive." Having
now fixed 8b's actual scope (§1), the more precise answer is that **nothing in `@dexpace/rx` needs a delay
primitive at all** — reconnection and retry are explicitly the caller's responsibility for SSE
(`docs/knowledge/sse-streaming.md`: "the SSE subsystem surfaces the retry hint... but MUST NOT auto-reconnect"),
and pagination has no backoff/delay concept of its own (`Paginator` drives pages back-to-back through whatever
`Transport` it was given, and any retry/backoff already lives in 5a's pipeline layer if a `Runtime` is the
supplied transport). `ASYNC-18` has no home anywhere in this Node port, not just no home in 8b — it belongs in
Phase 10's deviation ledger as a full collapse, the same disposition class as `SEAM-5`–`SEAM-10`.

**`ASYNC-8`–`ASYNC-12` (logging-context propagation) — resolved, not merely "likely covered."** `from()`'s
internal pull loop is a plain `for await` inside a native async function — no `setTimeout`, no worker thread, no
RxJS scheduler in the default (unscheduled) path §1's four wrappers use. `AsyncLocalStorage` propagates through
`await`/promise chains automatically (7b's design, confirmed), so the diagnostic context active when a consumer
calls `.subscribe()` (or, more precisely, active on the task that ultimately drives each `await source.next()`)
is already the context every downstream log line sees — no explicit capture/reinstall needed anywhere in 8b's
four wrapper functions. **The residual case 7b's `captureDiagnosticSnapshot()`/`runWithSnapshot()` exists for
(a callback invoked from outside the tracked continuation chain) only arises if a *caller* pipes 8b's output
through an RxJS scheduler operator (`observeOn(asyncScheduler)`, `subscribeOn`, etc.) downstream of these
functions** — which is caller-composed pipeline, not something `@dexpace/rx` constructs itself. 8b's TSDoc notes
this precisely: context propagates automatically through the shipped functions; a caller who reintroduces a
scheduler is reintroducing the exact boundary 7b's snapshot helper exists for, and can reach for it directly.

**`ASYNC-13` (unwrap wrapper exceptions).** RxJS's `from()` does not introduce a wrapper exception type around a
value thrown by its input iterable — the caught error is passed to `subscriber.error()` unmodified. Confirmed by
a conformance test (§4), not asserted.

**`ASYNC-21`'s fatal/non-fatal split, resolved as a full collapse — not a design decision 8b makes.** The JVM
reference's "MAY catch only recoverable exceptions, let the fatal/VM-error family escape" presupposes a
`Throwable` hierarchy splitting `Error` (fatal: `OutOfMemoryError`, `StackOverflowError`) from `Exception`
(recoverable). JavaScript has no such split — 5a's own design already established this precisely for `RETRY-25`
("V8 has no catchable OOM class; a genuine OOM aborts the process without producing a JS exception" — the closest
analogue, `RangeError: Maximum call stack size exceeded`, is a perfectly ordinary, type-indistinguishable
`RangeError`). There is no fatal-but-catchable tier in this runtime for `@dexpace/rx` to special-case: every
catchable error the wrapped `AsyncIterable` throws is legitimately routed through the `Observable`'s error
channel, full stop. This is the same disposition class as `RETRY-25`, restated once for the reactive-adapter
layer rather than re-derived.

## §4 — Conformance suite

`@dexpace/rx` is thin enough that its conformance suite is the actual specification of correctness here, not a
supplement to hand-written logic (§1's functions are one line each). One suite, run against `from()`'s actual
behavior with a hand-built `AsyncGenerator` test double (not `SseStream`/`Paginator`, to isolate "does RxJS's
`from()` satisfy `ASYNC-21`" from "does `SseStream`'s own close discipline work," already proven in 6b/6c):

```typescript
// packages/rx/src/from-async-iterable.conformance.test.ts
// ASYNC-21: poll-once-per-demand — a spy-wrapped async generator asserts exactly one .next() call per
//   subscriber.next() emission under a synchronous (unscheduled) subscriber.
// ASYNC-21: complete-on-end-of-source — generator that returns after N yields completes the Observable at N.
// ASYNC-21/ASYNC-13: source throw — generator that throws mid-iteration surfaces the exact thrown value via
//   the Observable's error() channel, not a wrapped type.
// ASYNC-6: unsubscribe mid-stream calls the generator's .return() exactly once (spy on a `finally` block).
// ASYNC-21: single-subscriber-per-source — subscribing an already-iterated single-pass AsyncIterable a second
//   time surfaces SseStream's own SSE-26 failure through the Observable's error channel (via sseEvents$
//   specifically, not the generic primitive, since a plain AsyncGenerator has no single-pass guard of its own).
```

If any assertion fails against the installed RxJS version, the fallback (§1) is scoped to the failing clause only
— this document does not pre-write that fallback since it should not exist unless a real gap is found.

## File Layout

```
packages/rx/
  package.json          # peerDependencies: {"@dexpace/core": "workspace:*", "rxjs": "^7.8.0"}; dependencies: {}
  tsconfig.json          # composite, project reference to ../core
  api-extractor.json
  etc/rx.api.md
  src/
    sse.ts                # sseEvents$, typedSse$
    pagination.ts          # pageItems$, pages$
    from-async-iterable.conformance.test.ts
    index.ts
```

`rxjs` is a **peer**, not a regular dependency — matching `logging-pino`/`logging-debug`'s existing pattern of
peering on the library they bridge to, since a consuming application very likely already pins its own RxJS
version and a duplicate copy would risk exactly the dual-package-hazard class `@dexpace/core`'s own peer-dedup
guard exists to prevent (RxJS `Observable`/`Subscription` identity checks would be as fragile as `Tristate`'s
branded-symbol checks across two non-identical copies).

## Public Barrel

`sseEvents$`, `typedSse$`, `pageItems$`, `pages$` re-exported from `packages/rx/src/index.ts` — no internal
barrel, same discipline as every prior package.

## Error Handling

No new `Error` subclass. Every error this package's surface can produce originates from the wrapped
`AsyncIterable` (`SseStream`'s `SseStreamError`/`SseLineTooLongError`, a typed mapper's thrown error, a
`Paginator` strategy's error) and passes through RxJS's error channel unmodified (`ASYNC-13`, §3).

## Testing

`bun test`, colocated `*.test.ts` plus the conformance suite (§4). Integration tests build a real `SseStream`
over a fixture byte source and a real `Paginator` over a `FakeTransport` (5a's, reused per its own "not built
speculatively... 5a is the phase that finally needs one" precedent) to prove the full stack — RxJS's `from()`
plus 6b's/6c's own close discipline — behaves correctly end-to-end, distinct from §4's isolated-primitive proof.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| No fatal/non-fatal error-class split (`ASYNC-21`'s MAY clause) | JVM's `Throwable`→`Error`/`Exception` split lets a reactive adapter let VM errors escape uncaught | JavaScript has no catchable-fatal error tier; `RangeError`/stack-overflow is an ordinary catchable error, and true OOM never reaches a catch block at all. Same disposition already recorded for `RETRY-25` in 5a, restated here |
| No non-blocking scheduled-delay primitive anywhere in this port (`ASYNC-18`) | JVM async adapters each need a delay bridge for their own internal scheduling | No adapter in this port does reconnection, retry, or backoff — SSE reconnection is explicitly caller-owned, pagination's retry (if any) lives in the pipeline layer via `Transport`, not in `@dexpace/rx` or its sibling transports |
| `sseEvents$`/`typedSse$` are single-subscription Observables, not standard cold/repeatable ones | Reference reactive adapters are typically cold, fresh-source-per-subscription | `SseStream` wraps an already-consumed-once HTTP response body; there is no domain-level way to make re-subscription meaningful without a second HTTP call this package does not initiate |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Reason |
|---|---|---|---|
| A hand-written `AsyncIterable`→`Observable` fallback, scoped to whichever `ASYNC-21` clause (if any) RxJS's native `from()` fails at plan-time conformance testing | 8b brainstorm | 8b plan time, only if needed | §4's suite is the actual test; this document deliberately does not pre-build a fallback for a gap not yet confirmed to exist |
