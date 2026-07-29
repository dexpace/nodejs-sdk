# Phase 4c — Stage-Based Pipeline — Design

**Status:** Draft, approved for planning. **One open finding (2026-07-29 validation review, F9):** whether
`Cursor` should observe the caller's `AbortSignal` between steps, and as which error type — tracked in the
roadmap's "Open Findings — Phase 4c Validation Review (2026-07-29)" section
(`docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`). Decide before Phase 5a Task 1 lands
`StepContext.signal`. Everything else from that review is applied.

**Purpose:** Implement the stage-based pipeline — the fixed-stage step composition runtime, its builder with
surgical edit operations, the per-call cursor/fork mechanism, and the execution-context-store wiring —
satisfying `docs/product-spec/08-execution-pipelines.md` §8.1 (`PIPE-1`–`PIPE-40`). This is the third and final
of three sub-phases the roadmap's Phase 4 ("Execution Context & Pipelines") splits into: 4a (execution context,
done), 4b (recovery-chain primitives, done), **4c** (this document, `§8.1`, built on 4a+4b).

**Governing documents:** `docs/product-spec/08-execution-pipelines.md` §8.1/§8.3 (normative, cited by ID
throughout), `docs/sdk-design-nodejs/05-pipeline-architecture.md` (Node-port mapping — Step-as-function, frozen
`Stage` enum, `next()`/`fork()` split, single-execution-model collapse of the async-mirror/bridge subsections),
`docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md` (`Transport` SPI shape), the Phase 4a and 4b design
docs (context promotion chain, `ContextStore`, `Outcome`/recovery chains this phase builds on top of but does not
modify). Styleguide: `styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

Every `PIPE-N` in `§8.1` is dispositioned here. **Plumbing only, no preset** — matching 4a/4b's "primitives only,
no default chain" discipline. Pillar stages (`REDIRECT`/`RETRY`/`AUTH`/`LOGGING`/`SERDE`) get slot validation and
ordering; the actual step bodies (redirect-following, retry backoff, auth challenge handling) are Phase 5/6/7's
job. `PIPE-39`'s SHOULD convenience constructors are **not** shipped here beyond the step-less passthrough that
falls out of the empty-pipeline fast path (`PIPE-9`) for free — a standard-resilience preset needs real pillar
steps that don't exist yet; building a half-wired stub now would just be a Phase 5 rewrite. The recovery-chain
layer (4b) is **not** integrated into the terminal `SEND` dispatch here — per `§8.3` the two layers are parallel
and cooperate, not nested; a future pillar step (Phase 5's retry) is the first place they meet.

**Six IDs need an explicit disposition rather than a task, so they don't read as missed:**

- **`PIPE-24`** (standard-resilience preset installs into empty slots only) — inherits the same "no preset
  shipped" scope decision as `PIPE-39`. There is no preset function in 4c for this requirement to apply to;
  revisit together when a future phase builds one.
- **`PIPE-29`/`PIPE-30`** (an async step must not throw synchronously; the runtime must defensively normalize
  any synchronous exception from a step into a rejected promise) — structurally free, not a deviation. Every
  `Step` is declared `async` (`step.ts`); calling an `async` function can never throw synchronously in
  JavaScript — a body that throws before its first `await` still returns a rejected `Promise`, not a thrown
  value. No wrapping code is needed in `Cursor`/`Runtime` to satisfy this; it falls out of the language.
  `PIPE-30`'s second clause ("fatal/unrecoverable errors propagate synchronously and MUST NOT be swallowed")
  has no Node analogue and is dispositioned as not-applicable: the JVM's fatal category (`OutOfMemoryError`,
  `StackOverflowError`, `ThreadDeath`) is a *catchable* `Throwable` a naive `catch (Throwable)` can swallow,
  which is the trap the clause exists to close. V8 has no such catchable class — a genuine OOM aborts the
  process without producing a JS exception at all — so there is nothing for the runtime to distinguish, and the
  same `async`-normalization that satisfies the first clause cannot swallow anything the first clause protects.
- **`PIPE-35`** (the builder SHOULD offer FLATTEN vs NEST seeding from an existing pipeline, and a port MUST
  make the choice explicit rather than accidental) — **not shipped in 4c, and it is not bridge machinery.**
  It sits under `§8.1`'s "Bridges." heading but names a builder capability independent of any sync/async split,
  so the single-execution-model collapse that disposes `PIPE-31`–`PIPE-34` does not reach it. It is deferred on
  its own merits: seeding presupposes an existing built pipeline worth re-deriving from, and 4c is the phase
  that first makes a pipeline constructible at all — there is no caller yet with one in hand. The MUST clause
  is satisfied vacuously today, since 4c offers *no* seeding path, so nothing can be chosen accidentally.
  Whichever phase first wants to derive one pipeline from another (Phase 5's retry preset is the likely
  candidate) adds `seedFrom(runtime, 'flatten' | 'nest')` — an explicit, non-defaulted mode argument, never an
  overload pair where the difference is inferred. Added to the roadmap's Deferred Items Log.
- **`PIPE-36`** (shipped pillar families should lock their stage assignment so a subclass can't relocate out of
  its pillar) — already addressed in the Deviation Ledger below: steps are functions carrying their `stage` on
  a `StepDescriptor`, not classes with subclassable stage assignment. Applies to whichever future phase ships
  the first real pillar step family (Phase 5+), not to 4c, which ships none.
- **`PIPE-37`** (a step depending on the single terminal response, e.g. status-mapping, must occupy the
  outermost pre-redirect slot) — a placement contract for whoever installs such a step, not a mechanical rule
  4c's plumbing enforces. `PRE_REDIRECT` exists as an available extension slot (see Stages, below); nothing
  stops a step from being installed there today. The obligation to actually put the right step there falls on
  whichever future phase wires 4b's `statusMappingStep` (or similar) into a real pipeline — most likely Phase 5.

## Stages

`PIPE-2`'s mandatory chain (outermost pre-redirect slot, `REDIRECT` → `RETRY` → `AUTH` → `LOGGING` → `SERDE`,
terminal `SEND`) plus `PIPE-3`'s SHOULD pre/post extension slots around every pillar, including redirect. Sparse
numeric keys leave room to insert further stages later without renumbering.

TypeScript `enum` is off the table — the roadmap's "Dual JS/TS consumption" constraint bars TS-only runtime
syntax (`erasableSyntaxOnly`: no enums, no decorators, no constructor parameter properties), and no prior phase
in this codebase uses one (`Protocol`/`Status` use a class-with-static-instances pattern instead). `Stage` has no
behavior of its own beyond ordering, so a plain string-literal union plus an explicit declaration-order array is
the minimal, idiomatic fit — root rule 1's "data and functions, not objects" default, same call 4a made for the
context types:

```typescript
export type Stage =
  | 'PRE_REDIRECT'   // outermost slot, PIPE-2's mandatory pre-redirect position
  | 'REDIRECT'
  | 'POST_REDIRECT'
  | 'PRE_RETRY'
  | 'RETRY'
  | 'POST_RETRY'
  | 'PRE_AUTH'
  | 'AUTH'
  | 'POST_AUTH'
  | 'PRE_LOGGING'
  | 'LOGGING'
  | 'POST_LOGGING'
  | 'PRE_SERDE'
  | 'SERDE'            // reserved, no shipped behavior
  | 'POST_SERDE'
  | 'SEND';             // terminal, reserved -- PIPE-8, flattening skips it

/** Declaration order (PIPE-1/PIPE-25's flatten order is exactly this array, SEND excluded at flatten time). */
export const STAGE_ORDER: readonly Stage[] = [
  'PRE_REDIRECT', 'REDIRECT', 'POST_REDIRECT',
  'PRE_RETRY', 'RETRY', 'POST_RETRY',
  'PRE_AUTH', 'AUTH', 'POST_AUTH',
  'PRE_LOGGING', 'LOGGING', 'POST_LOGGING',
  'PRE_SERDE', 'SERDE', 'POST_SERDE',
  'SEND',
];

export const PILLAR_STAGES: ReadonlySet<Stage> = new Set(['REDIRECT', 'RETRY', 'AUTH', 'LOGGING', 'SERDE']);
```

`PIPE-3`'s "sparse numeric order keys so new stages can be inserted without renumbering" names a mechanism, not a
requirement in itself — the actual requirement is that inserting a new stage later must not force touching
existing stages' identities. A string-literal union achieves that more directly than sparse numbers ever could:
inserting a stage is one `splice` into `STAGE_ORDER` at the right position, and every existing `Stage` value
(a string) is untouched by construction — there is no numeric gap to have reserved correctly up front. Extension
slots (`PRE_*`/`POST_*`) are inert until a step is actually appended to one — kept for all five pillars rather
than trimmed to only the pillars an immediate consumer needs, since the cost is one array entry each and the
alternative is a future phase editing `STAGE_ORDER` to insert one it turns out to need.

## Steps

A step is a function, not a class (`sdk-design-nodejs/05`). `PIPE-6`'s reference-identity distinction and
`PIPE-18`–`PIPE-21`'s anchor-type matching both need a stable "type" tag that isn't the function value itself, so
every step is registered as a `StepDescriptor` wrapping a type `symbol`, its `Stage`, and the function.

`PIPE-12`'s bidirectionality is the signature itself: a step receives the inbound `request`, MAY drive the rest of
the chain via `ctx.next()`, and MAY inspect or substitute the outbound `Response` on the way back out — or
short-circuit by returning a synthetic response without calling `next` at all, which needs no opt-in flag since
the one-shot guard lives on the continuation rather than on the `Cursor`.

```typescript
type Next = (request?: Request) => Promise<Response>;

interface StepContext {
  readonly next: Next;
  readonly fork?: (() => Next) | undefined;  // present only when the invoking cursor position is a pillar stage
  readonly context: ExecutionContext;        // current promoted context (4a), read-only
}

type Step = (request: Request, ctx: StepContext) => Promise<Response>;

interface StepDescriptor {
  readonly type: symbol;
  readonly stage: Stage;
  readonly fn: Step;
}
```

`ctx.fork` is `undefined` for a step whose descriptor's `stage` is not in `PILLAR_STAGES`; a pillar step that
needs to re-drive the chain more than once (`PIPE-15`: retry re-attempting, redirect following a hop, auth
retrying after a challenge) asserts its presence (`invariant(fork, ...)`) and calls it once per re-drive. `ctx.next`
enforces single-invocation for every step (`PIPE-15`'s "reusing the handle... MUST be treated as a defect" for
ordinary steps) — a second call on the same cursor's `next` throws `CursorAlreadyAdvancedError`.

`Next` takes an optional replacement `Request` (`PIPE-14`: a step MAY substitute the outbound request — HTTP
domain model `Request` values are immutable, so "substitute" means constructing a new value and passing it
downstream — and that substitution "sticks" for every remaining step and the terminal dispatch for the rest of
that drive). Calling `next()` with no argument carries the current request through unchanged.

`ctx.context` exposes the call's `ExecutionContext` (4a) to every step, since the pipeline already
creates/promotes/installs one per call regardless (see "Context-store wiring" below) — the value is in scope at
every invocation whether or not a step reads it. In practice it is always the `RequestContext`: promotion to
`ExchangeContext` happens after the drive completes, so no step ever observes an exchange-stage context. It is
typed as the union rather than `RequestContext` so that a later phase can hand steps a further-promoted context
without changing `StepContext`'s shape; a step that needs the narrower type narrows on `kind`.

**`StepContext` carries neither the caller's `options` nor its `signal` in 4c — a partial deferral of `PIPE-17`,
targeted at Phase 5a Task 1.** `Cursor` accepts both and threads them into the terminal dispatch, which is
`PIPE-17`'s "threaded into the terminal transport dispatch" and "carried unchanged across every re-drive fork"
halves. Its remaining clause — options "MUST be readable by any step" — is *not* satisfied here: no step in 4c
exists to read them, and adding two fields whose only consumer is a phase that has not been designed yet would
freeze their shape before the first real reader (5a's retry engine, which needs the signal for `RETRY-26`'s
cancellable wait and the options for `RETRY-41`'s per-call `maxRetries` override) states what it needs. Phase 5a
Task 1 lands both as one additive amendment to `step.ts`/`cursor.ts` — `signal?: AbortSignal | undefined` and
`options?: RequestOptions | undefined`, populated from the cursor's own fields on every invocation. Recorded in
the roadmap's Deferred Items Log so the MUST is deferred to a named phase rather than silently.

## Cursor and fork

One `Cursor` instance is allocated per call (`PIPE-10`) and owns the entire drive through every step, not just
one position — `advance()` is its single public entry point. Internally it is a private recursive dispatcher
parameterized by array position; `next` and `fork`'s returned continuations are both thin, independently
one-shot closures over that same dispatcher, which is what makes `PIPE-15`'s guard ("reusing the handle...MUST
be treated as a defect") a property of the *closure*, not of the `Cursor` object as a whole — a step that never
calls `next` at all (a short-circuit) is completely normal and needs no separate opt-out.

```typescript
interface CursorInit {
  readonly steps: readonly StepDescriptor[];
  readonly transport: Transport;
  readonly request: Request;
  readonly context: ExecutionContext;
  readonly options?: RequestOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

class Cursor {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;
  #request: Request;                              // current in-flight request; PIPE-14, "sticks" once substituted
  readonly #options: RequestOptions | undefined;  // immutable, shared across every fork -- PIPE-17
  readonly #signal: AbortSignal | undefined;
  readonly #context: ExecutionContext;

  constructor(init: CursorInit) { /* assigns every field */ }

  /** The in-flight request as of now -- the original, or whatever a step last substituted (PIPE-14). */
  get request(): Request { return this.#request; }

  async advance(): Promise<Response> {
    return this.#dispatch(0);
  }

  async #dispatch(position: number): Promise<Response> {
    // PIPE-13: terminal dispatch on exhaustion, threading #request/#options/#signal.
    // Otherwise builds ctx.next (and ctx.fork, only for a pillar-stage descriptor) via #continuationAt,
    // then invokes descriptor.fn(#request, ctx).
  }

  #continuationAt(targetPosition: number, ownerStage: Stage): Next {
    // Returns a ONE-SHOT closure: a second call throws CursorAlreadyAdvancedError(ownerStage) (PIPE-11/15).
    // A call with a replacement Request sets #request before recursing -- PIPE-14, sticks globally from
    // that point on, visible to every later step, every later fork, and the terminal dispatch.
    // Otherwise recurses into #dispatch(targetPosition).
  }
}
```

**`Cursor` takes one `CursorInit` object, not six positional parameters.** ESLint's `max-params` is 3 and counts
constructor parameters, and Phase 1 reserves the `eslint-disable` escape hatch for private builder-internal
constructors only — `Cursor` is neither. Same call 4a made for `ContextInit` and 4b for `DispatchConfig`. The
reference's start-position parameter is *not* carried over: a fork produces a fresh one-shot closure over the
existing dispatcher, never a second `Cursor` instance, so nothing in this design (or any consumer of it) ever
constructs a cursor starting anywhere but position 0. A settable start position would be dead surface the
coverage gate could not exercise.

`ctx.fork`, when present, is `() => this.#continuationAt(position + 1, descriptor.stage)` — the SAME target
position (`position + 1`) every time it is called, matching `PIPE-16`'s "bound to that same starting position
each time it is called": a second retry attempt re-runs every downstream step fresh, it does not resume from
wherever the first attempt's chain got to. `ctx.next` is built via the identical helper
(`this.#continuationAt(position + 1, descriptor.stage)`) — the same one-shot machinery serves both, since their
per-call semantics are identical; only pillar steps get the *additional* ability to call the factory (`fork`)
more than once.

A single mutable `#request` field, shared by the whole drive (not copied per fork), is what makes `PIPE-14`'s
stickiness "global for the entire call" rather than scoped to whichever branch substituted it — any step's
substitution is visible to every subsequent step, every subsequent fork, and the terminal dispatch, for the rest
of that call. `PIPE-16`'s "forks advancing independently" describes position independence (each fork's own
recursive walk through the *downstream* steps is unaffected by a sibling fork's walk), not request isolation —
the two forks still observe one shared, sequentially-updated `#request`.

`PIPE-14`: when a step returns having substituted a different outbound response, or a wrapping pillar step
substitutes a different *request* before forking, that substitution propagates to every downstream step and the
terminal dispatch for the remainder of that drive — carried as the cursor's own `#request` field, updated by
whichever step chose to substitute before calling `next`/`fork`.

`PIPE-40`: a step that forks more than once is responsible for closing whatever response its own prior fork
produced before invoking `fork()` again (mirrors `sdk-design-nodejs/05`'s placement of this responsibility on the
wrapping step, not the cursor/runtime).

## `PipelineBuilder`

```typescript
class PipelineBuilder {
  readonly #buckets = new Map<Stage, StepDescriptor[]>();  // insertion order preserved per stage -- PIPE-7
  readonly #transport: Transport;

  constructor(transport: Transport) { this.#transport = transport; }

  append(descriptor: StepDescriptor): this { /* tail of its stage bucket; pillar collision check */ }
  prepend(descriptor: StepDescriptor): this { /* head of its stage bucket */ }
  appendAll(descriptors: readonly StepDescriptor[]): this { /* PIPE-38: batch order preserved */ }
  prependAll(descriptors: readonly StepDescriptor[]): this { /* PIPE-38: each prepended individually -> reversed batch order */ }
  insertAfter(anchorType: symbol, descriptor: StepDescriptor): this { /* PIPE-18 */ }
  insertBefore(anchorType: symbol, descriptor: StepDescriptor): this { /* PIPE-18 */ }
  replace(anchorType: symbol, descriptor: StepDescriptor): this { /* PIPE-19 */ }
  remove(type: symbol): this { /* PIPE-20: every instance, order-preserving, no-op if absent */ }
  reload(descriptors: readonly StepDescriptor[]): this { /* PIPE-23: all-or-nothing bulk */ }

  build(): Runtime { /* PIPE-25: flatten stage buckets in Stage declaration order, skip SEND, freeze */ }
}
```

Validation is synchronous and fail-fast at the mutating call, not deferred to `build()`:

- `append`/`prepend`/`appendAll`/`prependAll`/`insertAfter`/`insertBefore` onto an occupied pillar stage with a
  **different** `type` symbol → `PillarCollisionError` naming both types and the stage (`PIPE-5`).
- **`replace` is deliberately absent from that list.** `PIPE-5`'s own text exempts it — "Replace itself cannot
  trigger this collision: it swaps a single occupant within its own stage 1:1" — and the collision error points
  the caller *at* `replace` as the sanctioned way past it, so running the pillar check inside `replace` would
  make replacing a pillar step impossible (the incoming type is distinct by definition). `replace` runs the
  anchor and cross-stage checks only.
- The same call with the **same** `type` symbol (reference-identical) on an already-occupied pillar → idempotent
  no-op, not an error (`PIPE-6`).
- `insertAfter`/`insertBefore`/`replace` whose `anchorType` matches nothing → `AnchorNotFoundError` naming the
  missing type (`PIPE-21`).
- `insertAfter`/`insertBefore`/`replace` where the new descriptor's `stage` differs from the anchor's stage →
  `CrossStageEditError` (`PIPE-18`/`PIPE-19`: "a cross-stage insert/replace MUST be rejected").
- `reload` validates the entire incoming set against pillar rules **before** touching `#buckets`; any collision
  leaves the existing collection completely unchanged (`PIPE-23`). Within the batch, a repeat of the *same*
  pillar type is dropped rather than seated a second time — the bulk path must not be a back door around
  `PIPE-4`'s one-step-per-pillar rule that `append` already enforces via `PIPE-6`'s idempotent no-op.
- Any insertion method (`append`/`prepend`/`appendAll`/`prependAll`/`insertAfter`/`insertBefore`/`replace`/
  `reload`) given a descriptor whose `stage` is `SEND` → `ReservedStageError`. `PIPE-8`'s "MUST NOT hold a user
  step" reads as a hard precondition, not something to satisfy only passively at flatten time — silently
  no-op-ing a caller's step onto `SEND` would contradict this codebase's own crash-loud-on-a-violated-
  precondition stance (`docs/knowledge/error-handling.md`). Flattening still skips `SEND` regardless (defense
  in depth), but no code path should be able to install there in the first place.

`build()` flattens `#buckets` in `Stage` declaration order, skipping `SEND` (`PIPE-8`), into a `Runtime` whose
step array is frozen. `PIPE-22`: any sequence of edits followed by `build()` produces the same flattened order as
constructing the equivalent final set from scratch — a property the builder's stage-bucketed storage gives
structurally, since flattening is a pure function of the buckets' current contents.

## `Runtime`

```typescript
class Runtime implements Transport {
  readonly #steps: readonly StepDescriptor[];   // flattened, immutable -- PIPE-10, PIPE-25
  readonly #transport: Transport;

  async send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    if (this.#steps.length === 0) {
      return this.#transport.send(request, options, signal);  // PIPE-9, no cursor allocated
    }
    const dispatchContext = createDispatchContext();
    const requestContext = promoteToRequest(dispatchContext, request);
    contextStore.install(requestContext);
    let currentContext: ExecutionContext = requestContext;   // tracks the latest install, no cast needed below
    try {
      const cursor = new Cursor({steps: this.#steps, transport: this.#transport, request, context: requestContext, options, signal});
      const response = await cursor.advance();
      const exchangeContext = promoteToExchange(exchangeSource(requestContext, cursor.request), response);
      contextStore.install(exchangeContext);   // install-or-replace under the same key, CTX-8
      currentContext = exchangeContext;
      return response;
    } finally {
      contextStore.close(currentContext);     // always the most recently installed context for this call
    }
  }

  async close(): Promise<void> { /* PIPE-27: no-op -- the pipeline never owns its transport */ }

  get steps(): readonly StepDescriptor[] { return this.#steps; }  // PIPE-25: "exposes a read-only, ordered view"
}

// Module-level, not a method -- it reads no instance state. The request context to promote from: the original,
// unless a step substituted the outbound request (PIPE-14), in which case an off-chain rebuild pinned to the
// SAME key (CTX-6) so the exchange context describes the request that was actually sent. Exported (still
// @internal) so its two branches are testable as the pure function they are -- `send()` evicts the exchange
// context in its own `finally`, so the alternative would be patching the process-wide store singleton.
export function exchangeSource(context: RequestContext, finalRequest: Request): RequestContext {
  if (finalRequest === context.request) return context;
  return createRequestContext(finalRequest, {
    key: context.key,                            // CTX-3: one call key for the whole chain
    instrumentation: context.instrumentation,    // CTX-2: carried forward by reference
    operationName: context.operationName,
  });
}
```

Each `send()` call allocates exactly one fresh `Cursor` (`PIPE-10`); the `Runtime` itself holds no mutable
per-call state (`PIPE-11`) — `#steps` and `#transport` are fixed at construction, with `#steps` copied and
frozen there (`Object.freeze([...steps])`) rather than trusting whatever array the caller passed, so
`PIPE-25`'s "immutable, read-only ordered view" holds at every construction site and not only through
`PipelineBuilder.build()`. `PIPE-26`'s "delegate
execute/execute-async to its own send/send-async" is satisfied by a single `send()` method: Phase 2's `Transport`
SPI has one method, not a sync/async pair, so there is no second entry point to delegate through.

**Context-store wiring (`CTX-17`'s positive half, deferred from 4a to here).** `Runtime` owns the store handle.
`createDispatchContext()` builds the head context unregistered (4a's `CTX-17` negative half — construction never
auto-installs). The first store entry is installed by the first promotion (`promoteToRequest`), immediately
followed by `contextStore.install(currentContext)` — this *is* `CTX-17`'s "the first store entry is installed by
the first promotion." A later `promoteToExchange` re-installs under the same key (`CTX-2`/`CTX-3`: key carried
forward unchanged), which `install()`'s install-or-replace semantics (`CTX-8`) turn into a straightforward
replace. `currentContext` is a mutable local reassigned at each promotion specifically so the `finally` block
always closes whichever context is currently installed under the shared key — closing the stale `requestContext`
reference after a later `exchangeContext` install would rely on `ContextStore.close()`'s identity-conditional
match (`CTX-9`/`CTX-10`) silently no-op-ing, which is correct-by-accident rather than correct-by-construction.

**The exchange context describes the request that was actually sent, not the one the caller handed in.**
`PIPE-14` lets any step substitute the outbound request, and the substitution sticks through the terminal
dispatch — so promoting straight off `requestContext` would pair the response with a request that never left the
process, against `CTX-1`'s "the exchange stage exposes the request and the response." `Cursor` exposes its
in-flight `request`; when it is reference-identical to the original (the overwhelmingly common case, and always
so until Phase 5 ships a step that substitutes) the original context is promoted unchanged. Otherwise
`exchangeSource` (the module-level helper above, not a private method) rebuilds a `RequestContext` off-chain
around the final request, pinned to the same `key` and
carrying the same `instrumentation` reference — exactly the explicit-key path `CTX-6` provides for. This keeps
`promoteToExchange` itself strictly additive (`CTX-2`: a promotion adds one artifact, it never rewrites an
existing one), rather than widening 4a's promotion API with a request-override parameter.

The empty-pipeline fast path (`PIPE-9`) installs no context at all — with no steps there is no promotion, and
`CTX-17` puts the first store entry at the first promotion. A pure pass-through call therefore leaves the store
untouched, which is the intended reading, not an omission.

`close()` satisfies the `Transport` SPI's required method (Phase 2, `SEAM-14`) but deliberately never calls
`this.#transport.close()` (`PIPE-27`: "the pipeline never owns its transport and MUST NOT close it").

## Error Types

Four new leaves for `PipelineBuilder` validation, plus one for cursor misuse — all flat, `DexpaceError` →
leaf, matching the two-level cap 4b's ledger already established:

- `PillarCollisionError` — carries the occupied `Stage`, the existing `type` symbol, and the incoming `type`
  symbol (`PIPE-5`).
- `AnchorNotFoundError` — carries the missing anchor `type` symbol and the attempted operation name (`PIPE-21`).

**Every one of these renders its identifying fields into its own message, not only onto the instance.** `PIPE-5`
asks the error to "name both step types," `PIPE-21` to identify "the missing type," and
`docs/knowledge/error-handling.md:40` requires the message itself to carry the identifying inputs the reader
cannot otherwise see — a `symbol` field is invisible in a stack trace or a log line. Symbols render via
`String(type)` (`Symbol(retry)`), the same form 4a's `DuplicateContextKeyError` already uses for a context key.
Structured fields stay on the instance as well (`error-handling.md:44`), so both audiences are served.
- `CrossStageEditError` — carries the anchor's `Stage` and the incoming descriptor's `Stage` (`PIPE-18`/`19`).
- `CursorAlreadyAdvancedError` — carries the `Stage` of the step that attempted the double-invocation
  (`PIPE-15`/`11`).
- `ReservedStageError` — carries the attempted operation name; thrown by any `PipelineBuilder` insertion method
  given a descriptor whose `stage` is `SEND` (`PIPE-8`).

## File Layout

```
packages/core/src/pipeline/
  stage.ts        # Stage, STAGE_ORDER, PILLAR_STAGES
  step.ts         # Step, StepContext, Next, StepDescriptor
  cursor.ts        # Cursor + CursorInit (advance/fork), PIPE-13/15/16
  builder.ts       # PipelineBuilder
  runtime.ts       # Runtime (implements Transport)
  errors.ts        # PillarCollisionError, AnchorNotFoundError, CrossStageEditError, ReservedStageError,
                    # CursorAlreadyAdvancedError
```

No `pipeline/index.ts` — `docs/knowledge/module-organization.md:18` bans internal barrels; a future consumer
imports the specific file directly, same pattern as 4a/4b.

## Public Barrel

**Nothing in this sub-phase is promoted.** `pipeline/` stays out of `src/index.ts`. No real consumer exists yet
inside `@dexpace/core` — Phase 5's retry/redirect/auth steps are the first. Whether SDK callers ever author
custom steps against a public surface (vs. only the shipped pillar presets) is a decision left to whichever phase
first ships a pillar step.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| No standard-resilience preset shipped | `PIPE-39` (SHOULD) | Plumbing only, matching 4a/4b's "primitives only" discipline; the preset needs real redirect/retry/auth steps that don't exist until Phase 5+. Deferred to whichever phase installs the first pillar step |
| `PIPE-33`/`PIPE-34`'s sync↔async bridges are not built | §8.1's "Bridges." subsection | Single execution model — one `Transport.send()`, no sync/async split — same simplification `sdk-design-nodejs/05` already applies to §3.2. A bridge connects two execution models and this port has one; same class as Phase 2's `SEAM-18` disposition, which the roadmap already records as **never**, not deferred |
| `PIPE-31`/`PIPE-32` have no distinct async surface to apply to | §8.1's "The async mirror." subsection | Follows from the row above. `PIPE-32`'s obligation is to *document an asymmetry* between the sync and async standard pipelines; with one pipeline there is no asymmetry to document, and its redirect pillar exists. `PIPE-31`'s close-on-success/close-on-failure discipline for a terminal response-mapping operator is not lost — 4b's `RECOV-12` already owns exactly that obligation for the single execution model |
| `PIPE-28`/`PIPE-29`/`PIPE-30` satisfied structurally, not deviated from | — | `PIPE-28` (both runtimes share one staging policy, neither re-derives it) is vacuous with a single `STAGE_ORDER`; `PIPE-29`/`PIPE-30`'s sync-throw normalization falls out of every `Step` being `async`. Listed here only because their ID range reads as bridge territory — see Scope for the full argument |
| `PIPE-35`'s FLATTEN-vs-NEST pipeline seeding is not shipped | `PIPE-35` (SHOULD) | **Not** an async/bridge disposition despite its placement under the "Bridges." heading — a builder capability in its own right. Deferred because nothing yet holds a built pipeline to seed from; its MUST clause ("make the choice explicit, never accidental") is vacuously satisfied while no seeding path exists. See Scope for the shape a future phase adds |
| `PIPE-26`'s "delegate execute/execute-async to its own send/send-async" satisfied by one `send()` method | `PIPE-26`'s literal two-method framing | Follows directly from the row above: `Transport` has one method, so there is nothing to delegate to beyond it |
| Steps are functions wrapped in a `StepDescriptor`, not classes implementing an interface | Reference's class-based step modeling (`PIPE-36`'s subclass-locking framing) | `sdk-design-nodejs/05`'s existing precedent; `StepDescriptor.type` (a `symbol`) carries the identity/anchor-matching role a class hierarchy would otherwise provide |
| `Stage` is a string-literal union plus an explicit `STAGE_ORDER` array, not numeric enum values with gaps | `PIPE-3`'s "sparse numeric order keys" (SHOULD, naming a mechanism) | The styleguide bars TS `enum` outright (erasable-syntax rule, binding since Phase 0); a string union + ordered array satisfies the same underlying goal (inserting a stage never touches existing stages' identities) without a numeric type at all |

## Deferred Items

**Retargeted or disposed here, per the roadmap's "check the log before starting" discipline:**

- `NFR-11` (concurrency-model agnosticism, no async-framework type leak) — **disposed in 4c.** `Step`/`Next`/
  `Runtime`'s public surface is `Promise`-only; no RxJS, no generator, no framework-specific async type appears
  anywhere in the pipeline layer. Closes the deferral; no further phase needed.
- `FakeTransport` test double — **re-deferred**, still not built. 4c's own tests use file-local `Transport`
  stubs (matching 4a/4b's precedent) rather than a shared double. Retargeted to whichever of Phase 5/6 first
  needs a transport reusable across many retry/redirect scenarios — the roadmap's Deferred Items Log entry is
  updated to point past 4c rather than at it.
- `contextsEqual()` — still not needed. 4c's `StepContext.context` exposure reads a context, it does not compare
  two for equality. No change to this deferral's target (revisit only if a future phase needs one).

**Newly produced by this sub-phase's own design**, added to the roadmap's Deferred Items Log:

- `PIPE-35`'s FLATTEN-vs-NEST pipeline seeding (see Scope and the ledger). Targeted at whichever phase first
  wants to derive one pipeline from another — Phase 5's retry preset is the likely candidate.
- `PIPE-2`'s redirect/retry conformance clause and `PIPE-40`'s 2-hop-redirect conformance clause. Both need a
  real redirect pillar step; they move to Phase 5/6 with the step that makes them testable.
- `PIPE-17`'s "options MUST be readable by any step" clause, together with exposing the call's `AbortSignal` to
  steps. `Cursor` carries both and threads them to the terminal dispatch; `StepContext` exposes neither, and 4c
  ships no step that could read them (see "Steps"). Targeted at **Phase 5a Task 1**, which lands
  `StepContext.options` and `StepContext.signal` as one additive amendment for the retry engine's per-call
  `maxRetries` override (`RETRY-41`) and cancellable wait (`RETRY-26`).

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `PIPE-N` IDs it exercises. File-local minimal `Transport`
stubs per test file, matching 4a/4b's precedent (see the `FakeTransport` disposition above).

**Property tests** — real `fast-check` properties over generated inputs, not hand-picked examples; `build()` is
an invariant-bearing assembler, which `docs/knowledge/testing.md:29` puts squarely in property-test territory:

- An arbitrary sequence of `append`/`prepend` edits followed by `build()` produces the same flattened order as
  constructing the equivalent final set from scratch (`PIPE-22`). Generated over the non-pillar stages, where an
  arbitrary-length edit sequence is legal — a generator that also emitted pillar stages would spend most of its
  cases hitting `PIPE-5`'s collision rather than exercising ordering. The anchored edits
  (`insertAfter`/`insertBefore`/`replace`/`remove`) need a generated *anchor* that exists, which makes the model
  larger than the property it proves; they stay on the example-based tests below.
- `appendAll` preserves the batch's iteration order within a stage, and `prependAll` (each element prepended
  individually) results in the reversed batch order, for a batch of any size (`PIPE-38`).

**Conformance examples** transcribed from `§8.1`'s own *Conformance:* clauses, adapted to what 4c actually
ships (plumbing, no pillar steps — a test that needs redirect or retry *behavior* cannot be written here):

- One probe step per stage, installed in shuffled order, records entry on the way down and exit on the way back
  up: entry order matches `STAGE_ORDER` and exit is its exact reverse (`PIPE-1`/`PIPE-2`). This is the
  stage-ordering half of `PIPE-2`'s clause; its redirect/retry half needs pillar steps that do not exist until
  Phase 5, and moves there with the pillar step that first makes it meaningful.
- A retry-shaped probe step at the `RETRY` stage re-driving twice via `fork()` visits every downstream step on
  both attempts (`PIPE-15`/`16`).
- Retaining a continuation and calling it a second time throws `CursorAlreadyAdvancedError` (`PIPE-15`'s
  "reusing the handle... MUST be treated as a defect"). Note this is *stronger* than the reference, whose
  conformance clause describes the handle silently resuming past already-visited steps — the behavior the
  one-shot guard makes unreachable, so that clause is not transcribable as written.

`PIPE-40`'s response-release discipline is a contract on wrapping steps, not on `Cursor`/`Runtime` (see "Cursor
and fork"), and its conformance clause is a 2-hop redirect — untestable without a redirect step. It moves to the
phase that ships one, alongside `PIPE-2`'s second half.

**No test patches the `contextStore` singleton.** It is process-wide and shared across every test file in a
run, so a patched method leaks past the test that installed it under any concurrency, and it mocks an owned
interface. `exchangeSource` is exported `@internal` and asserted directly instead; the end-to-end half that
stays observable — the substituted request is what reached the transport — is asserted through the transport
stub. Prefer `contextStore.get(key) === undefined` over absolute `contextStore.size` checks for the same
order-independence reason.

**Negative space:** an empty pipeline dispatches directly to the terminal transport without allocating a cursor
(`PIPE-9`, asserted via a transport spy plus absence of any cursor-only side effect); a second call to a given
cursor's `next` throws `CursorAlreadyAdvancedError`; installing a distinct second step onto an occupied pillar
throws `PillarCollisionError` naming both types; re-installing the identical descriptor (same `type` reference)
onto its own pillar is a silent no-op; an anchor edit against a missing type throws `AnchorNotFoundError`; a
cross-stage `insertAfter`/`replace` throws `CrossStageEditError`; a `reload` with an internal pillar collision
leaves the builder's existing collection byte-for-byte unchanged; `Runtime.close()` never calls the underlying
transport's `close()` (spy assertion).
