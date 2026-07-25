# Phase 4a — Execution Context — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the execution context promotion chain and its bounded process-wide store —
`DispatchContext`/`RequestContext`/`ExchangeContext`, the `InstrumentationBundle` shape, and `ContextStore` —
satisfying `docs/product-spec/07-execution-context-model.md` (`CTX-1`–`CTX-20`). This is the first of three
sub-phases the roadmap's Phase 4 ("Execution Context & Pipelines") splits into, mirroring Phase 3's 3a/3b split:
**4a** (this document, `§7`), **4b** (recovery-chain primitives, `§8.2`, `RECOV-*`), **4c** (stage-based pipeline,
`§8.1`, `PIPE-*`, built on 4a+4b). Combined, the three carry roughly 76 normative IDs — comparable to Phase 3's
~79 that forced its own split.

**Governing documents:** `docs/product-spec/07-execution-context-model.md` (normative, cited by ID throughout),
`docs/knowledge/execution-context.md`, `docs/knowledge/concurrency-and-async.md` (the bounded-map drain-loop
pattern this design reuses verbatim from an existing corpus rule). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

Every `CTX-N` in `§7` is dispositioned here. `§7` has no sub-references to other phases' machinery — it is a
self-contained data-type-plus-store layer, unlike Phase 3b which built directly on Phase 3a's frozen surface.

## The Promotion Chain

No shared base class and no class at all for the three context flavors — nothing here owns a lifecycle or needs
runtime-forgery protection the way `Request`/`Response` do (`HTTP-1`/`SEAM-29`), so root rule 1's default applies
cleanly: plain `interface` + frozen object literals + free functions, not classes (a discriminated union, per
`styleguide/typescript/06` §6.5, over data rather than over independent classes as Body used in 3b — Body needed
classes because its variants carry real internal state, e.g. `StreamBody`'s consumed-once flag; contexts have
none).

```typescript
interface InstrumentationBundle {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly traceState: string;
  readonly traceIdEncoding: string;
  readonly isValid: boolean;
  readonly isRemote: boolean;
  readonly activeSpan: unknown;
  readonly tracerFactory: (operationName: string) => unknown;
}

interface DispatchContext {
  readonly kind: 'dispatch';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
}
interface RequestContext {
  readonly kind: 'request';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
}
interface ExchangeContext {
  readonly kind: 'exchange';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
  readonly response: Response;
}
type ExecutionContext = DispatchContext | RequestContext | ExchangeContext;
```

`operationName` is absent from `DispatchContext` and introduced starting at `RequestContext` — `CTX-16` names it
"introduced at the request stage as an argument to the dispatch→request promotion," not a dispatch-stage field.

Free functions: `createDispatchContext(init?)`, `createRequestContext(request, init?)`,
`createExchangeContext(request, response, init?)` (direct, off-chain construction for all three flavors, each
defaulting `key` to a fresh `Symbol()` per call — `CTX-5` — and accepting an explicit key to pin for
value-equality — `CTX-6`), and the
two promotions: `promoteToRequest(context: DispatchContext, request: Request, operationName?: string):
RequestContext`, `promoteToExchange(context: RequestContext, response: Response): ExchangeContext`. Both carry
`key` and `instrumentation` forward by reference, unchanged (`CTX-2`, `CTX-3`), and return a fresh frozen object
rather than mutating the source (`CTX-2`, `CTX-7`).

The `create*` trio takes its optional inputs as one trailing `ContextInit` object
(`{operationName?, instrumentation?, key?}`, each spelled `?: T | undefined` for `exactOptionalPropertyTypes`)
rather than positionally. ESLint's `max-params` is 3 and counts optional parameters, so a positional
`createExchangeContext(request, response, operationName?, instrumentation?, key?)` is a 5-param lint failure,
and Phase 1 reserves the `eslint-disable` escape hatch for private builder-internal constructors only.
`createDispatchContext` takes `Omit<ContextInit, 'operationName'>` — `CTX-16` introduces the operation name at
the request stage, so the dispatch factory must not offer the field.

Neither promotion calls `ContextStore.install`. `CTX-17`'s negative half (constructing the head context must
not auto-register it) holds structurally, since `context.ts` never imports `store.ts`; its positive half ("the
first store entry is installed by the first promotion") is deferred to **4c**, which owns the store handle.
Wiring the store into `context.ts` would invert the layering and make every promotion a global side effect.

**`InstrumentationBundle.activeSpan`/`tracerFactory` are typed `unknown`, not invented `Span`/`Tracer`
interfaces.** This phase ships the bundle's *shape* and `CTX-15`'s no-op default only — no real W3C Trace Context
generation, no OpenTelemetry integration. That is real tracing-backend territory, deferred the same way
`Logger`/`LogEvent` was deferred to Phase 7 in Phase 2's own brainstorm. Guessing a `Span`/`Tracer` shape now
risks a breaking change once a real adapter exists; nothing in this phase or the next two consumes either field
beyond carrying it forward.

```typescript
const noopInstrumentationBundle: InstrumentationBundle = Object.freeze({
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  traceFlags: 0,
  traceState: '',
  traceIdEncoding: 'none',
  isValid: false,
  isRemote: false,
  activeSpan: undefined,
  tracerFactory: () => undefined,
});
```

**No `contextsEqual()` utility.** `CTX-6` — "two default-constructed contexts with otherwise identical fields are
NOT equal" — reads as a *description* of a consequence (default contexts get distinct `Symbol()` keys, so any
would-be equality check naturally differs), not a mandate to ship a new equality API. Nothing in `§7` or the next
two sub-phases calls for comparing contexts by value. Revisit if 4b or 4c turns out to need one.

## `ContextStore`

The one class in this sub-phase — it owns real mutable state (a bounded map) with a real lifecycle-adjacent
operation set (install/evict), unlike the lifecycle-less context values above.

```typescript
const DEFAULT_MAX_ENTRIES = 10_000; // exact value confirmed at plan time, same precedent as 3a's MAX_BYTE_ARRAY_LENGTH

class ContextStore {
  readonly #entries = new Map<symbol, ExecutionContext>();
  readonly #maxEntries: number;

  // rejects maxEntries < 1, which is what lets #drain skip an otherwise-unreachable in-loop guard
  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) { /* RangeError on a non-positive-integer cap */ }

  install(context: ExecutionContext): void { /* CTX-8: install-or-replace, never throws */ }
  installIfAbsent(context: ExecutionContext): void { /* CTX-8: reject-on-duplicate */ }
  get(key: symbol): ExecutionContext | undefined { /* CTX-18: absent, never throws */ }
  close(context: ExecutionContext): void { /* CTX-9/10: identity-conditional evict, no-op otherwise */ }
  clear(): void { /* test isolation for the singleton below */ }
  get size(): number { /* current entry count -- the observable 4b/4c tests assert the cap and eviction against */ }
}

export const contextStore = new ContextStore(); // CTX-4/5: one process-wide store
```

`CTX-7`'s thread-safety requirement is satisfied by construction: Node's single-threaded event loop means no two
synchronous `Map` mutations ever interleave, collapsing the reference's real concurrency primitive (a
`ConcurrentHashMap`-equivalent) into a plain `Map` — the same deviation class as 3b's materialize-once boolean
flag replacing an atomic compare-and-set. `close()` never throws; a stale or already-evicted context closing is a
harmless no-op by construction (`CTX-18`, `CTX-10`).

Draining (`CTX-11`/`12`) is a post-insert loop, not a single check-then-evict, evicting the oldest-inserted entry
(`Map` iteration order) each round — a valid, cheap choice given `CTX-13` disclaims any retention guarantee at
all, including for the just-inserted entry; callers must not rely on which entry survives.

Both the class and the singleton are exported: the class so a test can construct an isolated, small-capped
instance to exercise draining without depending on or polluting global state; the singleton because 4b/4c's real
code imports and uses exactly that one process-wide store, per `CTX-4`/`CTX-5`'s "globally distinct... across the
whole process" framing — a true singleton is the direct, faithful translation of "process-wide" into Node, not a
per-client instance.

**One new error leaf:** `DuplicateContextKeyError extends DexpaceError` (flat, per the discipline 3b's checkpoint
retrofit established), thrown only by `installIfAbsent`, carrying `readonly key: symbol`.

## Public Barrel

**Nothing in this sub-phase is promoted.** `context/` stays `@internal`, same reasoning as Phase 3a's `io/`: this
is correlation plumbing a caller never constructs directly — pipeline steps (4c) use it internally. Phase 7
decides whether any piece (e.g. a way to supply a real `InstrumentationBundle`) needs a public configuration
surface later.

## File Layout

```
packages/core/src/context/
  instrumentation.ts   # InstrumentationBundle interface + noopInstrumentationBundle default (CTX-14/15)
  context.ts           # DispatchContext/RequestContext/ExchangeContext, create*/promote* functions
  store.ts             # ContextStore, contextStore singleton
  errors.ts            # DuplicateContextKeyError
```

**No `context/index.ts`.** `docs/knowledge/module-organization.md:18` bans internal barrels outright — "Never
create internal barrels (an `index.ts` in every folder); import the specific file directly instead" — and the ban
applies regardless of whether the barrel is further re-exported. 4c's pipeline imports `./context/context.js`,
`./context/store.js`, etc. directly.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Thread-safe store collapses to a plain `Map` | `§7`'s concurrent-store contract | Node's single-threaded event loop makes synchronous `Map` mutation inherently non-interleaved; same collapse class as 3b's materialize-once guard |
| Call key is `Symbol()`, not a `traceId:spanId`+counter string | `CTX-4`'s reference implementation | Trivial, guaranteed uniqueness with no counter to manage; costs debuggability (opaque when logged/printed) |
| `InstrumentationBundle.activeSpan`/`tracerFactory` typed `unknown`, no `Span`/`Tracer` interfaces | `CTX-14`'s named fields | Real shape belongs to a future tracing adapter; inventing one now risks a breaking change later |
| `noopInstrumentationBundle.activeSpan` is `undefined`, not a no-op span *object* | `CTX-15`'s "a no-op span" | Follows from the row above: with `activeSpan` typed `unknown` there is no `Span` shape to build a no-op instance of, so absence is the only honest encoding. Partial, not total — every other `CTX-15` sentinel (all-zero ids, zero flags, empty state, `isValid`/`isRemote` false, no-op `tracerFactory`) ships exactly as specified. Revisit when Phase 7's tracing adapter defines `Span` |
| `CTX-17`'s registration-at-promotion half not implemented in 4a | `CTX-17` | Only the negative half (no auto-register at construction) is structural here; installing on first promotion needs the pipeline that owns the store handle. Retargeted to **4c**, whose plan must close it — not a permanent deviation |
| `create*` take a `ContextInit` options object, not positional `instrumentation`/`key`/`operationName` | — (no spec text; an ergonomics/lint decision) | `max-params` 3 counts optional parameters, and Phase 1 reserves the disable for private builder constructors; the object also keeps all three factory signatures uniform |
| No `contextsEqual()` utility | `CTX-6`'s value-equality framing | Read as descriptive, not a mandate; no consumer needs it yet |

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `CTX-N` IDs it exercises.

**Property tests:** `ContextStore` stays at or under its cap across a burst of synchronous inserts exceeding it
(`CTX-11`/`12`); N default-constructed contexts (any flavor) all receive pairwise-distinct keys (`CTX-5`).

**Conformance examples** transcribed from `§7`'s own *Conformance:* clauses (`CTX-1`: each stage exposes exactly
its expected artifacts, the exchange type has no promote-back method; `CTX-2`: promoted fields are the identical
reference, source unchanged; `CTX-4`: two contexts sharing identical trace AND span id still get differing keys
and both register).

**Negative space:** `installIfAbsent` on an occupied key throws `DuplicateContextKeyError` naming the key;
`close()` on an intermediate (already-promoted-past) context is a no-op; `close()` on an unknown/already-evicted
context is a no-op; `get()` on an unknown key returns `undefined`, never throws.

## Deferred Items

**Retargeted now that Phase 4 is split.** Two existing roadmap rows named "Phase 4" generically; neither applies
to 4a — both are updated in the roadmap to point at **4c** specifically (pending 4c's own brainstorm confirming):

- `NFR-11` (concurrency-model agnosticism, no async-framework type leak) — everything in 4a is synchronous;
  4c's stage-based pipeline is where async-facing public surface actually appears.
- `FakeTransport` test double — 4a never touches `Transport`; 4c's empty-pipeline-dispatches-to-terminal-transport
  behavior (`PIPE-9`) is the more likely first real consumer, though 4b's `RECOV-2` (catching a throwable "from
  the transport invocation") is worth checking too when 4b is brainstormed.

**Newly produced by this sub-phase's own design**, added to the roadmap's Deferred Items Log:

- Real W3C Trace Context generation — `InstrumentationBundle`'s actual tracing backend (trace-id/span-id byte
  generation, hex encoding, `traceparent`/`tracestate` parsing). 4a ships only the bundle's shape and `CTX-15`'s
  no-op default. Targeted at Phase 7, alongside `Logger`/`LogEvent` — both are `OBS-*`-adjacent instrumentation
  concerns with the same "shape now, real backend later" shape.
- `contextsEqual()`, a value-equality utility for `ExecutionContext`. Not scheduled to any phase — built only if
  4b or 4c turns out to need one, matching the "don't build speculatively" discipline `FakeTransport` originally
  established.
