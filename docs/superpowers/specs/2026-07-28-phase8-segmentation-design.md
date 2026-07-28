# Phase 8 — Transport & Async-Runtime Adapters — Segmentation Design

**Status:** Draft, approved for planning.

**Purpose:** Decide how Phase 8 is cut, ordered, and what it owns before either resulting sub-phase gets its own
brainstorm → spec → plan cycle — the same service the Phase 6 and Phase 7 segmentation designs performed for their
phases. This document does not design any sub-phase's implementation.

**Governing documents:** `docs/product-spec/17-transport-adapter-conformance-contract.md` (`TRANSPORT-1`–
`TRANSPORT-30`), `docs/product-spec/18-asynchronous-runtime-adapter-contract.md` (`ASYNC-1`–`ASYNC-22`),
`docs/sdk-design-nodejs/02-package-and-workspace-layout.md` (package list), `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md`
§3.2 (the SEAM-11/SEAM-16 collapse), `docs/knowledge/{transport-adapter,concurrency-and-async,message-bodies,
sse-streaming,resource-management,seams-and-extensibility,package-and-dependency-layout,redaction-and-security,
performance,observability,cancellation-and-timeouts,configuration,authentication}.md`. Styleguide:
`styleguide/typescript/09-concurrency.md`, `styleguide/typescript/13-resource-management.md`,
`styleguide/typescript/15-performance.md`.

**How this doc was produced.** Drafted solo, user away from keyboard, explicit instruction to fold in any
deferred item that fits and to treat `docs/knowledge/` as the standing tie-breaker per the roadmap's own
convention (echoed in the Phase 6 and Phase 7 segmentation docs). Every disposition below cites the knowledge-note
or spec line it rests on rather than asserting from memory.

---

## 1. The sizing case

| Section | IDs | Count |
|---|---|---|
| §17 Transport Adapter Conformance | `TRANSPORT-1`–`TRANSPORT-30` | 30 |
| §18 Async-Runtime Adapter Contract | `ASYNC-1`–`ASYNC-22` | 22 |
| **Nominal total** | | **52** |

52 nominal IDs sits well under the ~76–79 threshold that forced the Phase 3 and Phase 4 splits, and far under
Phase 5's 111 and Phase 6's 107. On raw count alone, Phase 8 does **not** need splitting — the opposite problem
from Phase 5/6.

But raw count understates Phase 8's real shape for two reasons the earlier phases didn't have:

1. **§17 is paid twice.** Unlike every earlier phase, which ships one implementation of its contract, Phase 8
   ships **two independent implementations of the same 30-item contract** — `@dexpace/transport-fetch` and
   `@dexpace/transport-undici` — because the roadmap table commits to both (mirroring the JVM reference's
   `sdk-transport-jdkhttp`/`sdk-transport-okhttp` pair, per `package-and-dependency-layout.md`'s "less low-level
   control" vs. "richer, pulls in a real library" framing). §17's own preamble already anticipates this: "Where a
   behavior exists in only one reference transport... the requirement is scoped accordingly." Effective weight is
   closer to **~55–60** once conformance work is counted per package, not per ID (§4 below narrows this further —
   several IDs collapse to near-zero work for `transport-fetch` specifically).
2. **Nine rows of the Deferred Items Log target Phase 8 by name** (§6), several carrying real, previously-unbuilt
   surface (`FileBody`, the `challengeHandler` protocol) rather than a checkbox.

Net: Phase 8 is mid-sized, comparable to Phase 7's 78 combined IDs before its split — not because the nominal
count is large, but because two full transport implementations plus the deferred-item backlog add up to
comparable real work. §2 below applies the same test Phase 6 used to decide *whether* that mid-size work should
split: is there a spec-mandated seam with **zero cross-segment contract surface**, or only a **soft** dependency
(Phase 7's shape), or neither (stay whole)?

## 2. Decision: two segments, cut along the package boundary the roadmap table already implies

**8a — Transport Adapters** (`@dexpace/transport-fetch`, `@dexpace/transport-undici`) · §17, `TRANSPORT-1`–`TRANSPORT-30`
**8b — Async-Runtime Bridge** (`@dexpace/rx`) · §18, `ASYNC-1`–`ASYNC-22`

This is not a novel cut — the roadmap's own Phase 8 table row already lists three packages that fall cleanly into
these two groups. The question this section actually answers is whether the two groups have any contract
dependency on each other, the same test §2 of the Phase 6 segmentation design applied to `PAGE`/`SSE`/`SERDE`.

**The dependency, checked in the direction that would matter (8b needing 8a):** `package-and-dependency-layout.md`
states `@dexpace/rx` is "thin optional sugar exposing **pagination and SSE** as RxJS Observables... not a bridge
for the request/response pivot itself." Pagination (`Page`) and SSE (`SseStream`) are both Phase 6 deliverables,
built over `AsyncGenerator`, with no reference to `Transport` in their public shape. `@dexpace/rx` therefore
depends on `@dexpace/core` (for `Page`/`SseStream`) and RxJS, never on `@dexpace/transport-fetch` or
`@dexpace/transport-undici`. A caller can install `@dexpace/rx` with **no transport package installed at all** and
it still type-checks and runs against whatever `Page`/`SseStream` instance they hand it.

**The dependency, checked the other direction (8a needing 8b):** nothing in §17 or the Transport interface
(`docs/sdk-design-nodejs/03` §3.2: `send(request, options?, signal?): Promise<Response>`) references RxJS or any
`ASYNC-*` id. The Promise-collapse reasoning in §3.2 is precisely the reason: `Transport` *is* the async pivot
already (§4 below), so it needs no separate bridge to be "asynchronous."

Cross-segment contract surface is therefore empty by mandate, the same property that decided Phase 6's cut and
the strongest argument for cutting here rather than elsewhere. Note this differs from Phase 7's cut (`OBS-35`'s
soft, real dependency on `CFG-1`/`CFG-14`) — Phase 8 is a Phase-6-shaped split, not a Phase-7-shaped one.

**A three- or four-way cut was considered and rejected.** Splitting `transport-fetch` and `transport-undici` into
separate sub-phases (8a1/8a2) would duplicate the same §17 design and conformance-suite content twice for no
benefit — they are two implementations of one contract, not two contracts, the same reason the JVM reference
ships both transports under one concern rather than two roadmap phases. They stay one sub-phase with two
implementation tasks.

## 3. Decision: order 8a → 8b, convenience only — no dependency

Per §2, neither segment depends on the other, so — matching Phase 6's framing, not Phase 7's — **either may
execute first or even in parallel; the order below is a cost/risk convenience choice, not a build constraint.**
State this explicitly in both sub-phase designs so a future reader does not infer a dependency that was never
there (the exact mistake the Phase 6 plans review caught and had to retrofit — see the roadmap's caution note).

**8a first**, for the same "pay the larger, riskier cost early" logic that put 6a first:

- 8a is the substantially larger segment (§1: ~55–60 effective weight across two packages plus most of the
  deferred-item backlog, vs. 8b's much lighter slice — §5).
- 8a is also the segment the roadmap's own ordering rationale is actually about: "the most Node-specific
  judgment calls" (line 106 of the roadmap doc) describes concrete transport behavior — proxy handling, zero-copy
  file bodies, header-drop policy — not the RxJS sugar layer.
- 8a resolves `SEAM-30`/`SEAM-12`/`SEAM-14`, three Phase-2 deferrals blocking nothing downstream but sitting
  open longest; closing the oldest deferrals first mirrors 6a's `SEAM-21` reasoning ("reshaping a seam belongs
  before, not after, other work built on the same barrel" — here, "closing a Phase-2 TSDoc-only obligation
  belongs before the phase ships without ever making good on it").

**8b (`@dexpace/rx`) could run first, or standalone, with no correctness cost** — flagged explicitly because a
future reader (or the user, on return) may reasonably choose to pull it earlier once Phase 6 lands, since its
only real prerequisite is `Page`/`SseStream`, already shipped. This document does not recommend that move — it
would split the roadmap table's existing Phase 8 grouping for a gain that is pure convenience, and the user's
brief was to fold deferred items *into* Phase 8, not re-litigate what's already placed there — but the option is
real and cheap, unlike anything in Phase 5b/5c's genuinely-coupled split.

## 4. What each segment owns

### 8a — Transport Adapters

Ships: `@dexpace/transport-fetch` (global `fetch`, zero added dependency, "less low-level control" per
`package-and-dependency-layout.md`) and `@dexpace/transport-undici` (undici `Client`/`Pool`/`request()`,
connection-pool tuning, trailers, explicit socket-level cancellation) — both implementing the single collapsed
`Transport` interface `docs/sdk-design-nodejs/03` §3.2 already fixed:
`send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>`.

Both packages implement all of §17's `TRANSPORT-1`–`TRANSPORT-30` (with per-ID collapse/scoping notes in §5.1)
plus the deferred items in §6 that target "Phase 8" or "first concrete Transport." A shared conformance test
suite (parametrized over both packages, the same shape as the existing per-package `api-extractor` pattern from
6a) is the mechanism that keeps the two implementations honest against one contract rather than drifting — write
it once against the `Transport` interface, run it against each package's concrete export.

Reuses, does not rebuild: `AbortSignal.timeout()`/`AbortSignal.any()` for cancellation and per-call timeout
scoping (`docs/sdk-design-nodejs/03` §3.2, already resolves `TRANSPORT-5`/`TRANSPORT-7` by construction);
6a's Bun `catalog:`-equivalent version single-sourcing and the `@dexpace/core` peer-dependency dedup pattern
(`NFR-14`, peer-dep guard, closed in 6a — 8a's two packages are simply the third and fourth consumers of an
already-decided mechanism, nothing to redecide); 7a's `CFG-36` build/runtime descriptor and `RECOV-33`'s
`clientIdentityStep()` for `User-Agent` composition (8a's job is only to confirm the header survives
`TRANSPORT-11`'s drop-and-recompute pass untouched, not to build version stamping again).

### 8b — Async-Runtime Bridge

Ships: `@dexpace/rx`, exposing `Page` and `SseStream` as RxJS `Observable`s. Implements the subset of §18 that
does not collapse (§5.2) plus `SSE-41` (§6), the reactive SSE adapter with backpressure-honoring polling
(`ASYNC-21`), fatal/non-fatal error-family split, and documented source ownership.

Reuses, does not rebuild: 7b's `AsyncLocalStorage`-backed diagnostic-context bridge
(`docs/superpowers/specs/2026-07-28-phase7b-observability-design.md` lines 151–169) for `ASYNC-8`–`ASYNC-12`'s
logging-context propagation — 7b's design already states `AsyncLocalStorage` auto-propagates across `await`,
promise chains, and timers, covering "most of what `OBS-24`'s bridge... manually requires," with an explicit
`captureDiagnosticSnapshot()`/`runWithSnapshot()` escape hatch already built for exactly the residual case
(§5.2 below) that RxJS's own scheduler boundary might land in. 8b's design owes a decision, not a rebuild:
does an `Observable` emission ever cross that residual boundary, and if so, does the existing snapshot helper
cover it as-is?

## 5. Requirements that collapse in this port

Each sub-phase's design owes a row-by-row disposition table for its collapsed IDs — the same service 5a's
`RECOV-17`–`RECOV-34` table and 6's §5 performed. Skipping it would make Phase 9's conformance sweep read these
as uncovered gaps rather than resolved-by-construction. Four clusters, identified now so 8a/8b don't re-derive
them.

### 5.1 — 8a: §17/§18 overlap, and one Node-wide structural gap

**§18 duplicates §17 for the collapsed transport.** Because `docs/sdk-design-nodejs/03` §3.2 collapses SEAM-11
(sync transport) and SEAM-16 (async transport) into one `Transport`, several `ASYNC-*` IDs restate a
`TRANSPORT-*` ID at the general "async-runtime adapter" level instead of the transport-specific level — the same
duplication pattern 5a's table found between `RECOV-*` and `RETRY-*`. These collapse onto their `TRANSPORT-*`
twin, not onto new work:

| `ASYNC-*` | Collapses onto | Why |
|---|---|---|
| `ASYNC-1` | `TRANSPORT-23` | Both state "non-null on success, exceptional completion on no-response" against the same `Promise<Response>` |
| `ASYNC-2` | `TRANSPORT-21` | Both state "construction-time failure via the failure channel, not a sync throw" |
| `ASYNC-5` | `TRANSPORT-9` | Both state "an orphaned response the future will never deliver must be closed exactly once" — for the collapsed `Transport`, the "adapter" and the "transport" are the same object, so there is no second orphan-closing site to build |
| `ASYNC-6` (transport half only) | `TRANSPORT-7`/`TRANSPORT-8` | Bidirectional cancellation between the canonical future and the "native primitive" — for `Transport`, the native primitive *is* the `AbortSignal` already threaded per `TRANSPORT-7`. `ASYNC-6` is **not fully** collapsed — it has a second, live instance in 8b (§5.2) for the `Observable`↔`AsyncGenerator` boundary, which is a genuinely different native primitive |
| `ASYNC-15`/`ASYNC-16`/`ASYNC-17` | `TRANSPORT-15`/`TRANSPORT-16` | Same idempotent/ownership-aware/interrupt-safe close contract. Real, asymmetric work between the two packages: `transport-fetch` owns no persistent resource (global `fetch` has no client object to shut down), so its close is realistically `ASYNC-17`'s sanctioned no-op; `transport-undici` owns a `Pool`/`Client`/`Agent` with real connections, so `TRANSPORT-15`/`16` bite there for real |
| `ASYNC-20` | (restates `SEAM-16`, already in `docs/knowledge/seams-and-extensibility.md`) | "Cancelling an already-completed success future does not close the delivered response" is already a stated `Transport` invariant, not new scope — 8a's job is a conformance test, not a design decision |
| `ASYNC-22` | `TRANSPORT-29` | Both state concurrent-call safety for the same object |

**A structural gap unique to Node: no blocking-transport, no worker-thread pool, no blocking bridge.**
`docs/sdk-design-nodejs/03` §3.2 states plainly that Node's event loop makes every I/O operation asynchronous "by
construction" — there is no idiomatic blocking HTTP call to wrap, the reason SEAM-11/SEAM-16 collapsed into one
seam in the first place. The roadmap's own Deferred Items Log already closed `SEAM-18` (sync↔async bridges) as
"**Never** — not deferred... every obligation SEAM-18 names presupposes a blocking transport Node cannot
idiomatically have." The same premise sinks a cluster of `ASYNC-*` IDs whose text is specifically about a
worker-thread pool executing blocking calls:

- `ASYNC-3`/`ASYNC-4` (cancel-with-interrupt vs. without on a worker thread; ordered interrupt delivery
  preventing pooled-thread poisoning) — inapplicable. Neither `transport-fetch` nor `transport-undici` dispatches
  blocking I/O to a thread pool; both run entirely on the event loop. There is no worker thread to interrupt and
  no pool to poison.
- `ASYNC-7` (documenting each adapter's interrupt-mode choice) — vacuous for the same reason; nothing chooses an
  interrupt mode because there is no blocking call being interrupted.
- `ASYNC-14` (async→sync blocking bridge honoring interruption) — inapplicable by the same `SEAM-18` disposition
  already on record. No sync bridge exists to honor interruption on.

These four close as **satisfied-by-construction / not-applicable**, the same disposition class 6a used for
`SERDE-8`/`21`/`22`/`25`/`26`, and belong in Phase 10's deviation ledger alongside `SEAM-18`'s existing entry —
this is the same simplification restated at the async-adapter layer, not a second, independent one.

**Genuinely live, not a duplicate:** `TRANSPORT-6` (clamp a sub-resolution positive timeout rather than truncate
to zero) is very likely also satisfied-by-construction — `AbortSignal.timeout(ms)` takes millisecond resolution
directly, with no coarser native unit to truncate against, unlike the JVM reference's second-granularity timeout
APIs. 8a's design should confirm this against both packages' concrete timeout wiring rather than assume it (a
one-line check, not a re-derivation), because a wrapping layer could still reintroduce coarser rounding
accidentally.

### 5.2 — 8b: which `ASYNC-*` IDs are genuinely `@dexpace/rx`'s to build

Given §5.1 disposes of the transport-shaped half of §18, 8b's real scope is narrower than "22 minus the
collapsed ones" suggests — most of what remains is about the `Observable`↔`AsyncGenerator` boundary specifically:

- **`ASYNC-21`** (reactive SSE backpressure, poll-per-demand, complete on end-of-source, propagate source errors
  without swallowing fatal ones, never close the caller-owned source, single-subscriber/fresh-source-per-subscription)
  — this **is** `SSE-41` (§6). The marquee, load-bearing deliverable of this sub-phase.
- **`ASYNC-6`** (second instance, per §5.1's note) — cancelling an RxJS subscription (`unsubscribe()`) must
  reach the underlying `AsyncGenerator`'s `.return()` (releasing the SSE/pagination resource per `SSE-27`/
  `PAGE-11`'s already-shipped close discipline), and a source ending must complete the `Observable`. Real,
  bounded work: bridge two already-correct primitives, don't re-implement either one's resource lifecycle.
- **`ASYNC-13`** (unwrap the async framework's wrapper exceptions to the original cause) — has a real but much
  smaller Node analogue than the JVM's `CompletionException` unwrapping: confirm an error thrown inside the
  wrapped `AsyncGenerator` surfaces through RxJS's error channel as the original error, not wrapped in an
  RxJS-internal type. Likely a single assertion in the conformance suite, not new production code, since RxJS's
  `from()`/generator interop does not wrap by default — 8b's design should verify this claim rather than assume
  it, the same "confirm, don't assume" posture as `TRANSPORT-6` above.
- **`ASYNC-19`** (per-call `RequestOptions` threaded through every bridge/facade overload) — applies wherever
  `@dexpace/rx` exposes an overload that starts a new `Page`/`SseStream` fetch (if it does at all — if it only
  wraps an already-constructed `Page`/`SseStream`, there is no options parameter to thread and this collapses;
  8b's design must state which shape it ships).
- **`ASYNC-8`–`ASYNC-12`** (logging-context propagation) — per §4's "reuse, does not rebuild" note, covered by
  7b's `AsyncLocalStorage` bridge for the common case (subscription driven from an `await`ed chain). The open
  question is narrow: does RxJS's own scheduler (if 8b uses one — `asyncScheduler` defers via `setTimeout`,
  which `AsyncLocalStorage` *does* auto-propagate through per Node's `async_hooks`, unlike a raw callback-style
  API) ever place an emission outside the tracked continuation entirely? If yes, 7b's existing
  `captureDiagnosticSnapshot()`/`runWithSnapshot()` escape hatch is very likely sufficient off-the-shelf — 8b's
  design should confirm this with a concrete trace of `@dexpace/rx`'s actual emission path rather than assert it
  from this document, which is reasoning about RxJS's general shape, not this package's specific implementation.
- **`ASYNC-18`** (non-blocking scheduled-delay primitive) — possibly **already resolved**. Retry backoff (5a)
  needed the same non-blocking-wait shape and almost certainly built it on `setTimeout`, which trivially
  satisfies "completes after the delay without blocking a thread" and "cancelling cancels the underlying timer."
  8b's design must check 5a's and 7a's `Clock`/wait implementation before building anything: if a suitable
  primitive already exists, reuse it (the 6c `HTTP-29` precedent — "a second implementation would be a defect");
  if none exists in a reusable shape, this is 8b's one piece of genuinely new, small work. **Open, not resolved
  here** — flagged the same way 6b/6c left their own open items for their designs to close, not this document.

**Everything else in §18 not named above** (`ASYNC-9`–`ASYNC-12`'s specific save/restore/no-backend/
lightweight-thread-transfer sub-clauses beyond the general propagation question, `ASYNC-17`'s no-op default —
already covered under 8a's `transport-fetch` in §5.1, restated once here so 8b's own table doesn't re-claim it)
is either a duplicate already dispositioned in §5.1 or a sub-clause of an item already listed above; 8b's design
should confirm this reading with its own table rather than take this document's word for it, per the standing
"design docs get the row-by-row proof, segmentation docs get the pointer" division of labor 5a/6/7 already
established.

## 6. Deferred Items Log disposition

Every row currently targeting "Phase 8" (or "first concrete Transport," which means the same thing), reconciled
against the segments above:

| Item | Originated in | Goes to | Note |
|---|---|---|---|
| Concrete `Transport` implementations (`@dexpace/transport-fetch`, `-undici`) | Phase 2 | **8a** | The phase's headline deliverable; Phase 2 shipped the interface only |
| `SEAM-30` cleanup (cancel an orphaned response on the completion race) | Phase 2 | **8a** | Collapses onto `TRANSPORT-9` per §5.1 — closes as part of 8a's conformance suite, not separate work |
| `SEAM-14` — close *behavior* (idempotent, ownership-aware, releases only self-created resources) | Phase 2 | **8a** | The `close(): Promise<void>` signature is already locked (Phase 2); 8a ships the behavior, asymmetric per package per §4 |
| `SEAM-12` — concurrent-call conformance test | Phase 2 | **8a** | Collapses onto `TRANSPORT-29` per §5.1 |
| `NFR-2` — transport half (core + ≤1 external lib per optional capability) | Phase 0, retargeted to 6a for the codec half (2026-07-28) | **8a** | `transport-fetch` trivially satisfies this (zero external libs — global `fetch` is a runtime API, not a library). `transport-undici` satisfies it with exactly one (`undici`, either the bundled `node:undici` or the npm package) |
| `NFR-15` — Node-transport wiring of `User-Agent` (the header actually reaching the wire) | Phase 0, resolved-at-design in 7a | **8a** | 7a already built the value (`CFG-36`) and the stamping step (`RECOV-33`'s `clientIdentityStep()`); 8a's job is a conformance test confirming `TRANSPORT-11`'s header-drop pass does not touch it, not building new stamping logic |
| `challengeHandler` slot on `ProxyOptions` has no protocol behind it | Phase 7a brainstorm | **8a** | See the open item below — likely `transport-undici`-only, a `TRANSPORT-30`-shaped scoping decision, not necessarily both packages' problem |
| `FileBody` (`BODY-11`/`12`/`13`/`36`) — file-backed request body | Phase 3b brainstorm | **8a** | See the open item below — needs a package-placement decision this document does not make |
| `SSE-41` — reactive SSE adapter | Phase 6 brainstorm | **8b** | `@dexpace/rx`'s marquee deliverable; is `ASYNC-21` per §5.2 |

Two rows resolve as **not-applicable, not new 8a work** (recorded here so the disposition is on record, not
buried in §5.1): the `ASYNC-3`/`ASYNC-4`/`ASYNC-7`/`ASYNC-14` cluster and `SEAM-18`'s pre-existing "Never"
disposition are the same finding restated once; nothing further to log.

## 7. Open items for the sub-phase designs

Named here so 8a/8b inherit questions rather than rediscovering them, matching the practice 6's §8 and 7's own
open items established:

- **8a — where does `FileBody` live?** `@dexpace/core` cannot host it (hard-committed zero-`node:`-import
  invariant, mechanically enforced since the scaffold). But `BODY-12`/`TRANSPORT-28` require a transport to
  *recognize* a file body **by type** to dispatch a zero-copy path — meaning both `transport-fetch` and
  `transport-undici` need to agree on one concrete `FileBody` class, which argues against embedding it inside
  either package alone (the other transport would then not recognize it, breaking the "one body model, any
  transport" invariant `Request`/`Body` was built around in 3b). A third small package (something like
  `@dexpace/body-node`, depending on `@dexpace/core` as a peer, `node:fs` as a runtime API rather than an
  external library) both transports depend on is the shape that avoids this — but that is a **roadmap-table
  amendment** (a fourth Phase 8 package not currently listed) this segmentation document flags rather than
  decides. 8a's design must settle it explicitly.
- **8a — does true zero-copy dispatch (`TRANSPORT-28`'s "SHOULD... zero-copy kernel path where supported") exist
  at all on Node's HTTP client surface?** The reference's "SHOULD" is written against platforms with a real
  `sendfile(2)`-shaped API (OkHttp's `okio.Source`, `FileChannel.transferTo`). Neither the global `fetch`
  implementation nor `undici`'s public API currently expose an equivalent zero-copy path for an *outbound
  request* body — streaming a file still means reading it into userspace and writing it out, even via
  `fs.createReadStream().pipe(...)`. If that holds, `TRANSPORT-28`'s zero-copy clause is a **`PAGE-29`-shaped
  collapse** ("no Node analogue" — the SHOULD is satisfied by "there is no such path to take," not by building
  one) rather than real engineering work, and 8a's design should record it as such rather than chase an API that
  may not exist. Flagged, not resolved — this document's confidence here is lower than the SEAM-18/blocking-bridge
  finding in §5.1, and 8a's plan-time research should verify before writing it down as settled.
- **8a — is `transport-fetch`'s proxy support in scope at all?** `TRANSPORT-30` (proxy limitation discoverability,
  challenge-handler fallback, credential-leak prevention) presupposes a transport that can *route through* a
  proxy in the first place. `transport-undici` can (undici ships `ProxyAgent`). Node's bare global `fetch` has no
  built-in proxy-env or custom-dispatcher story without reaching for `undici`'s `setGlobalDispatcher`/
  `ProxyAgent` under the hood — which, if `transport-fetch` needs it, quietly moves `transport-fetch` from "zero
  added dependency" to "depends on undici too," undermining its own reason to exist as the thin option. §17's own
  preamble licenses scoping a requirement to "only one reference transport" exactly for cases like this — 8a's
  design should decide explicitly whether `TRANSPORT-30` (and by extension the `challengeHandler` protocol) is
  `transport-undici`-only, and document `transport-fetch`'s proxy story (none, or degraded) as a deliberate scope
  boundary rather than a silent gap.
- **Both sub-phases — confirm, don't assume, three "likely collapses" this document reasons about but does not
  verify against the concrete implementation:** 8a's `TRANSPORT-6` (sub-resolution timeout clamping, §5.1) and
  8b's two items immediately below. Each needs a one-line confirmation at design or plan time, not a
  re-derivation.
- **8b — has 5a/7a already built a reusable non-blocking delay primitive `ASYNC-18` can reuse?** (§5.2) Check
  before building.
- **8b — does any `@dexpace/rx` emission path escape `AsyncLocalStorage`'s auto-propagation**, and if so, does
  7b's existing snapshot/bridge helper already cover it? (§5.2)
- **8b — does `@dexpace/rx` ever start a fetch itself (needing `ASYNC-19`'s per-call options threading), or does
  it only wrap an already-constructed `Page`/`SseStream`** (§5.2)? This is closer to a scope decision than an
  open research question, and should be made explicitly in 8b's design rather than left implicit in its API
  surface.

## 8. Roadmap changes this decision implies

- Phase table row 8 splits into 8a (Transport Adapters) / 8b (Async-Runtime Bridge), packages per §2.
- A Deferred Items Log row recording the split, its rationale, and the "no cross-segment dependency, order is
  convenience only" property — the same entry style as the Phase 6 split's log row.
- The nine Deferred Items Log rows in §6 above are updated in place to point at 8a or 8b instead of bare
  "Phase 8" / "first concrete Transport."
- A **possible fourth package** (§7's `FileBody` open item) is flagged for 8a's design to confirm or reject —
  if confirmed, this is a roadmap-table amendment beyond what this document alone authorizes, the same way 6a's
  segmentation review surfaced but did not itself resolve the `NFR-2`/`NFR-14`/peer-dedup retargeting (it named
  the finding; 6a's own design carried it through).
