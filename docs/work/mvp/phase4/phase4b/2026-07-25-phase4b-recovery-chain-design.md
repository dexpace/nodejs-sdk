# Phase 4b — Recovery-Chain Primitives — Design

**Status:** Implemented 2026-08-26. **Both open decisions are closed.** `RECOV-12`'s `SuppressedError` is
reached through a runtime-guarded `suppress()` helper — branch (b) of the cross-phase F1 decision, which the
roadmap resolved on the verified version facts (`SuppressedError` reached Node only in 24.0.0; branch (a) would
mean `>=24`, dropping Node 18/20/22 outright). F2 (this phase's zero `invariant()` assertions) is recorded as a
Deviation Ledger row for Phase 10's project-wide pass, the disposition F2 itself named as the alternative to
fold-site postconditions. Both are tracked in the roadmap's "Open Findings — Phase 4b Validation Review
(2026-07-28)" section.

**Purpose:** Implement the recovery-chain primitives — `Outcome<T>`, the request and response recovery chains,
the unified dispatch orchestrator, the cancellation-wrapping helper, and the status→typed-exception mapping step
— satisfying `docs/product-spec/08-execution-pipelines.md` §8.2 (`RECOV-1`–`RECOV-16`). This is the second of
three sub-phases the roadmap's Phase 4 ("Execution Context & Pipelines") splits into: 4a (execution context,
**not yet implemented** — 4b turned out not to depend on it; see `docs/open-items.md` F8), **4b** (this
document, `§8.2`), 4c (stage-based pipeline, `§8.1`, which does depend on both 4a and 4b).

**Governing documents:** `docs/product-spec/08-execution-pipelines.md` §8.2/§8.3 (normative, cited by ID
throughout), `docs/sdk-design-nodejs/05-pipeline-architecture.md` (Node-port mapping for both pipeline layers),
`docs/knowledge/retry-and-resilience.md`, `docs/knowledge/error-handling.md`, `docs/knowledge/cancellation-and-timeouts.md`,
`docs/knowledge/resource-management.md`. Styleguide: `styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

Every `RECOV-N` in `§8.2` is dispositioned here. Retry itself (backoff, budget, pacing headers) is Phase 5's
resilience layer built *on top of* these primitives (per `§8.3`) — 4b ships the fold/orchestrator machinery a
retry step will later wrap, not retry behavior itself.

Concretely, appendix C's remaining `RECOV-*` IDs land as follows, so none of them reads as a silent drop against
the consolidated index: `RECOV-17`–`RECOV-31` and `RECOV-34` (classification, re-sendability, budgets, backoff,
pacing headers, attempt stamping, config validation) → **Phase 5a**; `RECOV-32` (idempotency-key injection) →
**Phase 5a**, which ships it despite it not being retry mechanics because it is retry-*semantic*; `RECOV-33`
(client-identity header composition) → **Phase 7a**, alongside the `CFG-36` build/runtime descriptor that feeds
it. Note `RECOV-33` is **not** Phase 5 — the "Phase 5's resilience layer" sentence above does not cover it.

**Primitives only, no default chain.** 4b ships `Outcome`/`fold`, the two recovery chain classes, the
orchestrator, the cancellation helper, and the status-mapping step as standalone building blocks. No
preset/default chain is assembled here — that composition is Phase 5's (retry) or 4c's job, matching the
roadmap's "don't build speculatively" discipline already applied to `FakeTransport` and `contextsEqual()` in 4a.

## `Outcome<T>`

```typescript
type Outcome<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly error: unknown };

function success<T>(value: T): Outcome<T>;
function failure<T>(error: unknown): Outcome<T>;
function fold<T, R>(outcome: Outcome<T>, onSuccess: (value: T) => R, onFailure: (error: unknown) => R): R;
```

Satisfies `RECOV-1`'s "closed sum type with exactly two variants... derivable accessors and a fold that applies
exactly one of two branches at most once per call." A discriminated union gives compiler-checked exhaustiveness
on `kind` for free — "derivable accessors" reads as that narrowing, not a mandate for separate
`isSuccess()`/`getOrThrow()` helpers; none are built, matching 4a's precedent of not shipping `contextsEqual()`
speculatively. `error` is typed `unknown`, not `Error` — a JavaScript `throw` can legally raise any value
(`sdk-design-nodejs/05` calls this out explicitly for `RECOV-2`).

## Step Types

All steps are `async` functions, not synchronous transforms. This is a deliberate divergence from how the
reference (Kotlin) frames `§8.2` as synchronous: Node has one execution model end to end (Promise-based), and the
shipped `RECOV-15`/`16` status-mapping step must call the already-async `toHttpError()` from Phase 3b, so an
async step signature is required for at least one shipped step and is applied uniformly rather than mixing sync
and async step shapes in the same chain.

```typescript
type RequestStep = (request: Request) => Promise<Request>;
type ResponseStep = (response: Response) => Promise<Response>;
type RecoveryStep = (outcome: Outcome<Response>) => Promise<Outcome<Response>>;
```

## `RequestRecoveryChain`

```typescript
class RequestRecoveryChain {
  readonly #steps: readonly RequestStep[];
  constructor(steps: readonly RequestStep[]) { this.#steps = [...steps]; }
  async apply(request: Request): Promise<Request> { /* RECOV-3: sequential left-to-right fold */ }
}
```

`RECOV-3`: applies its ordered steps as a sequential fold (output of step N is input of step N+1); an empty chain
returns the input unchanged; a throwing step aborts the remainder and propagates — the orchestrator (below)
converts that propagation into a `Failure` per `RECOV-2`.

## `ResponseRecoveryChain`

```typescript
class ResponseRecoveryChain {
  readonly #responseSteps: readonly ResponseStep[];
  readonly #recoverySteps: readonly RecoveryStep[];
  constructor(responseSteps: readonly ResponseStep[], recoverySteps: readonly RecoveryStep[]) {
    this.#responseSteps = [...responseSteps];
    this.#recoverySteps = [...recoverySteps];
  }
  async apply(outcome: Outcome<Response>): Promise<Outcome<Response>> { /* see below */ }
}
```

`apply()`'s fold order (`RECOV-6`): all response steps first (success path only), then all recovery steps, in
declared order within each group.

- **`RECOV-4`/`RECOV-6`:** response steps run only when the current outcome is a `Success`; on a `Failure` the
  entire response-step phase is skipped.
- **`RECOV-7`:** if a response step throws, its throwable is converted into a `Failure` fed to the recovery
  phase — never propagated out of `apply()`. This is how the status-mapping step (below) flows an error status
  through recovery exactly like a transport error.
- **`RECOV-5`/`RECOV-6`:** recovery steps then run on the outcome — whatever it is at that point — sequentially,
  always, observing the terminal outcome including a `Failure` a response step just produced.
- **`RECOV-8`:** if a recovery step throws, its throwable is wrapped into a `Failure` fed to the *next* recovery
  step, never aborting the remaining recovery steps; `apply()` itself never throws under any input.
- **`RECOV-9`:** (SHOULD, not enforced) recovery steps are documented as preferring to return a `Failure` rather
  than throw; both are handled identically by `apply()`.
- **`RECOV-12`:** when a step throws while the current outcome is a `Success` holding a response, `apply()`
  closes that response (`response.close()`, from Phase 3b) before wrapping the throwable into a `Failure`,
  attaching any close error as `suppressed` through the `suppress()` helper so a close failure never masks the
  primary throwable. The response is released exactly once.

  **`SuppressedError` is not a global on the declared floor.** It belongs to the full Explicit Resource
  Management proposal, which reached Node only in **24.0.0**; `engines.node` is `>=20.3` and this package's
  `lib` (`ES2023`, `DOM`, `DOM.AsyncIterable`) does not even supply the *type*. `packages/core/src/suppress.ts`
  wraps that gap: `suppress(error, suppressed, message)` constructs the native class when
  `globalThis.SuppressedError` exists and a shape-compatible stand-in (`name`, `error`, `suppressed`) when it
  does not, reading the global per call rather than at module load. Callers never branch on which one they got,
  and assertions are written against the shape, never `instanceof SuppressedError`.

  **This must be a hand-written `try`/`catch` around the `close()` call, not `using`/`await using`.** Native
  disposal's own `SuppressedError` construction puts the *later* error first — when a body already threw and
  disposal then also throws, the runtime builds `new SuppressedError(disposalError, bodyError)`, making the
  disposal failure primary and the original body error `.suppressed`
  (`docs/knowledge/resource-management.md:72`). `RECOV-12` wants the opposite priority: the step's original
  throwable stays primary, and a close failure rides along as `.suppressed`. Reaching for `using` here would
  silently invert which error the caller ultimately sees. The correct shape:

  ```typescript
  try {
    current = success(await stepFn(...));
  } catch (originalError) {
    if (current.kind === 'success') {
      try {
        await current.value.close();   // Response.close() is Promise<void> (3b) -- must be awaited to be catchable
      } catch (closeError) {
        return failure(
          suppress(originalError, closeError, 'response close failed while handling a step error'),
        );
      }
    }
    return failure(originalError);     // RECOV-7/8: converted to a Failure, never rethrown out of apply()
  }
  ```

  Both the step call and the `close()` are `await`ed: every step type in this phase is `async`, and 3b's
  `Response.close()` returns `Promise<void>`, so an un-awaited call puts the rejection outside the `try` where
  nothing catches it. The catch block *returns* a `Failure` rather than rethrowing — `apply()` never throws
  (`RECOV-8`).
- **`RECOV-13`:** when a step *deliberately returns* a different outcome (no throw) — a recovery step
  transforming a `Success` into a `Failure`, or substituting a different `Success` — `apply()` does **not**
  auto-close the discarded original response. The transforming step owns releasing whatever it drops. This is
  mechanically distinct from `RECOV-12`: the driver only auto-closes on a caught throw, never on a normal return.

`RECOV-14`: both step lists are defensively copied at construction (`[...steps]`). The reference implementation
only copies the response chain's lists and retains the request chain's caller-supplied list by direct reference —
an asymmetry the spec text itself flags and recommends a port not copy. This design copies both anyway, per the
spec's own "a port SHOULD copy there too," logged as a deliberate divergence in the ledger below.

`RECOV-14`'s **second** normative clause — steps safe for concurrent invocation, per-request state never on the
step instance — is satisfied structurally and must stay that way: after construction a chain holds nothing but a
frozen-by-convention step array, and `apply()` keeps every piece of per-call state (`current`) in a local. One
chain instance is therefore safe under concurrent `apply()` calls, and a later phase must not add per-call
bookkeeping to a chain field. Tested, not just asserted — see Testing below.

## Orchestrator (`dispatchWithRecovery`)

```typescript
interface DispatchConfig {
  readonly transport: Transport;
  readonly requestChain: RequestRecoveryChain;
  readonly responseChain: ResponseRecoveryChain;
  readonly options?: RequestOptions;
  readonly signal?: AbortSignal;
}

async function dispatchWithRecovery(request: Request, config: DispatchConfig): Promise<Response> {
  let outcome: Outcome<Response>;
  try {
    const preparedRequest = await config.requestChain.apply(request);
    const response = await config.transport.send(preparedRequest, config.options, config.signal);
    outcome = success(response);
  } catch (error) {
    outcome = wrapCancellation(error);   // RECOV-11; never throws, so RECOV-2 admits no side exit
  }
  outcome = await config.responseChain.apply(outcome);
  return fold(
    outcome,
    (response) => response,
    (error) => { throw error; },
  );
}
```

Two positional params (`request`, `config`), not five — the same `max-params: 3` trap 4a's `ContextInit` was built to dodge, applied here to the orchestrator's own signature.

- **`RECOV-11`:** the orchestrator's catch is the helper's one and only call site. Every throwable leaving the
  request chain or the transport passes through `wrapCancellation()` on its way to a `Failure`, so the
  requirement sits on the real dispatch path rather than in a primitive nothing calls.
- **`RECOV-2`:** the single `try`/`catch` wraps both the request chain's `apply()` and the transport invocation,
  so every throwable from either is caught and converted to a `Failure` before reaching the response chain. This
  is the defining invariant — a before-request throw cannot skip after-error handling.
- **`RECOV-10`:** the final unwrap returns the contained response on `Success`, or rethrows the contained
  throwable *unchanged* (no wrapping, no substitution) on `Failure`. Any typed-exception surfacing is the
  responsibility of a recovery step constructing the error and returning a `Failure` — the orchestrator itself
  never constructs or substitutes an error.

`transport.send(request, options?, signal?)` is the Phase 2 `Transport` SPI unchanged — no new transport
abstraction is introduced here.

## Cancellation-Wrapping Helper (`RECOV-11`)

```typescript
function wrapCancellation(error: unknown): Outcome<never> {
  return failure(error);
}
```

The reference requires re-asserting the cancellation signal on the current context when wrapping a
cancellation/interruption throwable, so code later blocked on the outcome still observes cancellation — a
concern specific to `Thread.interrupt()`'s flag being silently clearable. Node's `AbortSignal.aborted` is durable
once set (no equivalent clearing hazard exists), and the SDK holds a signal, never the caller's
`AbortController`, so it could not set one even if it wanted to. There is nothing to *re-assert*, and the helper
degenerates to `failure(error)`.

**It deliberately does not crash on a `CancellationError` whose paired signal never aborted**, an earlier draft
of this design's shape. Two reasons:

- `Transport` is a pluggable seam. A mismatch between a classified `CancellationError` and the signal the SDK
  threaded in is a *third-party implementation* misbehaving — an operational failure — not a violated
  precondition of this codebase, which is what `docs/knowledge/error-handling.md` reserves crash-loud treatment
  for. A transport that aborts its in-flight requests from `close()` (which `SEAM-14` permits — it only says
  close need *not* cancel them) surfaces exactly this shape while the caller passed no signal at all.
- `RECOV-2` is absolute: no throwable from the pre-request phase or the transport may bypass the recovery hooks.
  `wrapCancellation` runs *inside* `dispatchWithRecovery`'s own `catch`, so throwing from it would skip the
  response and recovery chains entirely — the one failure mode `RECOV-2` exists to prevent.

`dispatchWithRecovery`'s catch clause is the helper's only call site — it is deliberately *not* shipped as an
unwired primitive. Returning `Outcome<never>` keeps it assignable to the orchestrator's `Outcome<Response>` local
without a cast. It is a thin pass-through by design: its job is to be the one named, findable site where
`RECOV-11`'s Node disposition lives. If Phase 5's retry step lands without giving it any behavior, inline it
there and carry the disposition wholly in Phase 10's ledger rather than keeping a function with no body.

## Status→Typed-Exception Mapping Step (`RECOV-15`/`RECOV-16`)

```typescript
async function statusMappingStep(response: Response): Promise<Response> {
  const httpError = await toHttpError(response);
  if (httpError === null) return response;
  throw httpError;
}

statusMappingStep satisfies ResponseStep;
```

A named `function` declaration, not `const statusMappingStep: ResponseStep = async (response) => …`:
`docs/knowledge/function-design.md:18-21` reserves arrows for inline callbacks and requires top-level named
declarations for module symbols, which also survive in stack traces more reliably — worth something for a
function whose whole job is to `throw`. `func-style`'s `allowArrowFunctions: true` would not have flagged the
arrow form, so this is a corpus rule the lint gate does not enforce. The trailing `satisfies` keeps the
compile-time proof that the signature still conforms to `ResponseStep`, which the discarded type annotation was
providing.

`toHttpError()` (Phase 3b, unchanged) already satisfies both requirements in full: it treats only 400..599 as
errors and returns non-error statuses unchanged (`RECOV-15`), and it buffers the error body into a bounded
(1 MiB), replayable in-memory copy inside the original response's own close-guaranteeing scope before mapping,
sharing the same cap used by 3b's logging tees (`RECOV-16`). No new buffering, no new per-status exception
hierarchy — `HttpStatusError` (flat, `DexpaceError → HttpStatusError`, already carrying `status` and the
buffered body as fields) *is* the "matching typed exception." The `throw` here is deliberate: it lets `RECOV-7`
convert it into a `Failure` the same way any other response-step throw is handled, rather than this step
special-casing its own error path.

## Public Barrel

**Nothing in this sub-phase is promoted.** `recovery/` stays out of `src/index.ts`, same reasoning as 4a's
`context/`: no real consumer exists yet inside `@dexpace/core` (Phase 5's retry step is the first). Whether SDK
callers ever author custom recovery/response steps against a public surface is a decision left to whichever
phase first needs it — most likely Phase 5.

**No `recovery/index.ts` either.** `docs/knowledge/module-organization.md:18` bans internal barrels outright —
"Never create internal barrels (an `index.ts` in every folder); import the specific file directly instead" — and
the ban applies regardless of whether the barrel is re-exported further up. A future consumer (Phase 5) imports
`./recovery/orchestrator.ts`, `./recovery/outcome.ts`, etc. directly, the same way any other cross-file import in
the package works. (4a's `context/index.ts` was retrofitted out of its design and plan for the same reason, and
4c ships no `pipeline/index.ts`. **3b's `body/index.ts` is the one remaining internal barrel** and still carries
the violation — retrofit it before Phase 3b is executed, or record it in Phase 10's deviation ledger.)

## File Layout

```
packages/core/src/invariant.ts   # MODIFY: add assertNever()
packages/core/src/suppress.ts    # NEW: suppress(), the runtime-guarded SuppressedError (F1 branch (b))

packages/core/src/recovery/
  outcome.ts          # Outcome<T>, success(), failure(), fold()
  request-chain.ts    # RequestRecoveryChain
  response-chain.ts   # ResponseRecoveryChain
  orchestrator.ts     # dispatchWithRecovery(), DispatchConfig
  cancellation.ts     # wrapCancellation()
  status-mapping.ts   # statusMappingStep()
```

`invariant.ts` and `suppress.ts` are the two files outside `recovery/` this sub-phase touches. `docs/knowledge/data-modeling.md`
requires every discriminated-union `switch` to close with `default: return assertNever(x)`, "defined once and
imported everywhere," and no prior phase plan actually adds it — `fold()` is the codebase's first such `switch`,
so `assertNever` lands here as a small addition alongside the `invariant()`/`InvariantViolation` that module
already exports.

No new error leaf files: the only new failure surface is `assertNever`'s `InvariantViolation` crash, which is a
programmer-error assertion, not a catchable `DexpaceError` subclass. `wrapCancellation()` does **not** crash —
see its section above for why an `invariant()` there would violate `RECOV-2`.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Both recovery chains defensively copy their step lists at construction | `RECOV-14`'s reference asymmetry (request chain retains the caller's list by reference) | The spec text itself recommends a port copy both; true immutability on both chains costs nothing and removes an asymmetry a porter could otherwise assume away incorrectly |
| All step types (`RequestStep`/`ResponseStep`/`RecoveryStep`) are `async`, not synchronous transforms | `§8.2`'s framing of the recovery layer as synchronous | Node has one execution model end to end; the shipped `RECOV-15`/`16` step must call the already-async `toHttpError()`, so async is applied uniformly across all step shapes rather than mixed with sync ones |
| `RECOV-11`'s cancellation re-assertion is a no-op — `wrapCancellation` is `failure(error)` and never throws | `RECOV-11`'s literal "re-assert the cancellation signal" | `AbortSignal.aborted` is durable once fired, unlike a clearable `Thread.interrupt()` flag, and the SDK never holds the caller's `AbortController` — nothing to re-assert. Not reframed as an `invariant()` crash on a signal mismatch: `Transport` is a third-party seam, so that is an operational failure rather than a violated precondition, and throwing from inside the orchestrator's catch would violate `RECOV-2` |
| No new per-status typed-exception hierarchy for `RECOV-15` | `RECOV-15`'s "matching typed exception" (which some ports read as a per-status class family) | Phase 3b's flat `HttpStatusError` (carrying `status` + buffered body) already satisfies this, and the corpus caps custom error hierarchies at two levels; a per-status class family would violate that cap |
| No default/preset recovery chain shipped in 4b | none — scope decision | Matches 4a's "primitives only" discipline; Phase 5 (retry) is the first real consumer and decides its own composition |
| `#private` fields and methods on both chain classes (`#steps`, `#responseSteps`, `#recoverySteps`, `#runResponsePhase`, `#runRecoveryPhase`) | `docs/knowledge/data-modeling.md:20-23` — `private` is the default; `#private` requires a comment justifying a genuine runtime-privacy requirement | **No runtime-privacy claim is made.** These classes are unfrozen holders of a readonly array, unlike 3b's `Response`, whose `#closed` genuinely must survive `Object.freeze(this)`. `#private` is the established package-wide field style (Phase 1, 3b, and 4a's `ContextStore` all use it), so switching 4b alone would fragment the package and trip the corpus's own "never mix two styles within a module/package" rule. Recorded as a project-wide deviation for Phase 10 to reconcile in one pass, not fixed here |
| `RECOV-12`'s suppressed-error pairing goes through a runtime-guarded `suppress()` helper rather than `new SuppressedError(...)` | none — a runtime-floor constraint, not a spec deviation. Listed so Phase 10 sees the shape | `SuppressedError` reached Node in 24.0.0; `engines.node` is `>=20.3` and `lib` does not supply the type. Raising the floor to reach one error class would drop Node 18, 20 and 22. The helper returns the native class where it exists and a shape-compatible stand-in where it does not, so nothing downstream branches. Phases 5a, 6a, 6b and 6c share the helper |
| `RequestRecoveryChain` / `ResponseRecoveryChain` are classes holding an immutable step array | `docs/knowledge/data-modeling.md:10` — classes are reserved for things that own a lifecycle or hold mutable runtime state behind an invariant; everything else is plain data transformed by free functions | Neither chain owns a lifecycle or mutable state — a free `applyRequestChain(steps, request)` would satisfy the corpus directly. Kept as classes because `RECOV-14`'s second clause is written about the *step instance* and the chain instance ("per-request state never on the step instance"), and because the defensive copy has to happen once at a construction boundary rather than on every call. Recorded rather than corrected: the shape is what `§8.2` describes and what Phase 5's retry step will compose against |
| Zero `invariant()` assertions across `recovery/` | `docs/knowledge/assertions.md:6-7`'s 2-per-function module average (Rule 8) | F2, deliberately not closed here. The concrete cost is named: no `apply()` postcondition checks that a step returned a value at all, so a step returning `undefined` poisons the fold silently and surfaces layers away. It is a project-wide inconsistency rather than 4b's — Phases 1/2/3b/4a ship zero, 4c ships fifteen — so adding assertions to 4b alone would deepen the split rather than close it. Phase 10 settles the density rule once and applies it everywhere |
| `fold(outcome, onSuccess, onFailure)` takes three positional parameters | `docs/knowledge/function-design.md:22-23` — "an options object when it has 3 or more parameters" | The prose rule is one parameter stricter than its own stated enforcement (`max-params: ['error', 3]` errors at four), so this passes lint while violating the corpus text — flagged as a corpus conflict in the roadmap, not silently ignored. Three positional parameters match Phase 2's already-shipped `Transport.send(request, options?, signal?)`; `fold(outcome, {onSuccess, onFailure})` would make 4b the only module in the package reading differently for a canonical two-branch fold |

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `RECOV-N` IDs it exercises. No `FakeTransport` needed —
each test file hand-rolls a minimal `Transport` stub scoped to its own assertions, matching 4a's precedent of not
building a shared test double before a real consumer needs one.

**Property tests:**

- `RequestRecoveryChain.apply()` — for an arbitrary sequence of pure request transforms, the result equals
  applying each in order; an empty chain is the identity (`RECOV-3`).
- `ResponseRecoveryChain.apply()` — for an arbitrary mix of throwing/non-throwing **response and recovery**
  steps, over a seed outcome that is arbitrarily a `Success` or a `Failure`: `apply()` always settles and never
  re-raises a step's throw (`RECOV-8`), and no response step runs on any generated case whose seed was already a
  `Failure` (`RECOV-4`). Both halves must be generated — a generator emitting recovery steps only, or seeding
  `Success` only, proves the first law and leaves the second to an example test.

**Concurrency (`RECOV-14`'s second clause):** two `apply()` calls interleaved on a *single* chain instance do not
observe each other's state — each sees only the outcome it was handed. Guards the structural property that all
per-call state lives in `apply()`'s locals rather than on a chain field.

**Conformance examples** transcribed from `§8.2`'s own *Conformance:* clauses (`RECOV-2`: a throwing request step
and a throwing transport each surface as a `Failure` to a recovery hook; `RECOV-15`/`16`: 400..599 produce a
`Failure` with a typed exception, a sub-cap error body survives whole, an over-cap body truncates with the
connection released).

**Negative space:** a response step throwing while holding a `Success` closes that response exactly once, with a
close-failure attached as `suppressed` (`RECOV-12`); a recovery step returning a substitute `Success` does not
trigger an auto-close of the original (`RECOV-13`); `dispatchWithRecovery` rethrows a `Failure`'s error
byte-for-byte unchanged, no wrapping (`RECOV-10`); a transport-raised `CancellationError` with no caller signal
still reaches the recovery steps rather than escaping the orchestrator (`RECOV-2`/`RECOV-11`).

**Type-level tests.** `Outcome<T>` is an exported generic type, so it ships `expectTypeOf` assertions
(styleguide 11.6): the `kind` union is closed, each variant's payload is reachable only after narrowing, and two
`@ts-expect-error` lines prove the negative — a narrowed `Success` has no `error` and a narrowed `Failure` has
no `value`. `statusMappingStep`'s conformance to `ResponseStep` is asserted the same way, in the test file
rather than as a module-level `satisfies` statement: `satisfies` erases to its operand, not to nothing, so the
module-level form leaves a dead `statusMappingStep;` expression statement in the published `dist/`.

**Node-runtime conformance.** `SuppressedError`'s presence is exactly the kind of runtime divergence
`test/node-conformance/`'s membership rule exists for — Bun and current Node ship it, the declared floor does
not — so `recovery-chain.test.mjs` forces the guarded branch from real Node and re-runs `RECOV-12`'s
release-exactly-once over Node's own Web Streams. `bun test` alone would only ever exercise whichever branch
Bun's runtime happens to take.

**A `Response` is frozen** (Phase 1's `Object.freeze(this)`, preserved by 3b's retrofit), so no test may patch
`response.close` — the assignment throws `TypeError` under an ES module's strict mode. `RECOV-12`/`RECOV-13`'s
close assertions observe the body stream's `cancel()` hook instead, the way 3b's own `response.test.ts` does.

## Deferred Items

Nothing new pushed out of this sub-phase. `contextsEqual()` (deferred from 4a to "4b or 4c if needed") is still
not needed — nothing here compares `ExecutionContext` values. `FakeTransport` (deferred from Phase 2 to 4c) is
still not built here — 4b's tests use file-local minimal stubs against the real `Transport` interface, not a
shared double.
