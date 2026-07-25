# Phase 4b — Recovery-Chain Primitives — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the recovery-chain primitives — `Outcome<T>`, the request and response recovery chains,
the unified dispatch orchestrator, the cancellation-wrapping helper, and the status→typed-exception mapping step
— satisfying `docs/product-spec/08-execution-pipelines.md` §8.2 (`RECOV-1`–`RECOV-16`). This is the second of
three sub-phases the roadmap's Phase 4 ("Execution Context & Pipelines") splits into: 4a (execution context,
done), **4b** (this document, `§8.2`), 4c (stage-based pipeline, `§8.1`, built on 4a+4b).

**Governing documents:** `docs/product-spec/08-execution-pipelines.md` §8.2/§8.3 (normative, cited by ID
throughout), `docs/sdk-design-nodejs/05-pipeline-architecture.md` (Node-port mapping for both pipeline layers),
`docs/knowledge/retry-and-resilience.md`, `docs/knowledge/error-handling.md`, `docs/knowledge/cancellation-and-timeouts.md`,
`docs/knowledge/resource-management.md`. Styleguide: `styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

Every `RECOV-N` in `§8.2` is dispositioned here. Retry itself (backoff, budget, pacing headers) is Phase 5's
resilience layer built *on top of* these primitives (per `§8.3`) — 4b ships the fold/orchestrator machinery a
retry step will later wrap, not retry behavior itself.

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
  attaching any close error as `suppressed` via a manually-constructed `SuppressedError` so a close failure never
  masks the primary throwable. The response is released exactly once.

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
          new SuppressedError(originalError, closeError, 'response close failed while handling step error'),
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
    outcome = wrapCancellation(error, config.signal);   // RECOV-11; degenerates to failure(error) otherwise
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
  request chain or the transport passes through `wrapCancellation()` on its way to a `Failure`, which is what
  makes the cancellation check an invariant of the real dispatch path rather than a primitive nothing calls. For
  a non-cancellation throwable it is exactly `failure(error)`.
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
function wrapCancellation(error: unknown, signal: AbortSignal | undefined): Outcome<never> {
  if (error instanceof CancellationError && !signal?.aborted) {
    invariant(false, 'CancellationError observed without a corresponding aborted signal');
  }
  return failure(error);
}
```

The reference requires re-asserting the cancellation signal on the current context when wrapping a
cancellation/interruption throwable, so code later blocked on the outcome still observes cancellation — a
concern specific to `Thread.interrupt()`'s flag being silently clearable. Node's `AbortSignal.aborted` is durable
once set (no equivalent clearing hazard exists), so there is nothing to *re-assert*. Instead, this helper
defensively re-checks: if the throwable is a `CancellationError` (Phase 2, `transport.ts`) but its paired signal
does not report `aborted`, that is a structurally-impossible state (wrong signal threaded through, or a
misclassified throwable) and crashes loudly via `invariant()` — a programmer error, not a recoverable `Failure`
— per `docs/knowledge/error-handling.md`'s "a violated precondition... must crash loudly... never be demoted to a
handled error." `instanceof` against the concrete class, not duck-typing, matches the styleguide's narrowing rule
and Phase 2's own precedent of distinguishing `CancellationError`/`TimeoutError` by concrete class rather than a
message string.

`dispatchWithRecovery`'s catch clause is the helper's only call site — it is deliberately *not* shipped as an
unwired primitive. Returning `Outcome<never>` keeps it assignable to the orchestrator's `Outcome<Response>` local
without a cast.

## Status→Typed-Exception Mapping Step (`RECOV-15`/`RECOV-16`)

```typescript
const statusMappingStep: ResponseStep = async (response) => {
  const httpError = await toHttpError(response);
  if (httpError === null) return response;
  throw httpError;
};
```

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
packages/core/src/recovery/
  outcome.ts          # Outcome<T>, success(), failure(), fold()
  request-chain.ts    # RequestRecoveryChain
  response-chain.ts   # ResponseRecoveryChain
  orchestrator.ts     # dispatchWithRecovery(), DispatchConfig
  cancellation.ts     # wrapCancellation()
  status-mapping.ts   # statusMappingStep()
```

No new error leaf files: the only new failure surface is `wrapCancellation()`'s `invariant()` crash, which is a
programmer-error assertion, not a catchable `DexpaceError` subclass.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Both recovery chains defensively copy their step lists at construction | `RECOV-14`'s reference asymmetry (request chain retains the caller's list by reference) | The spec text itself recommends a port copy both; true immutability on both chains costs nothing and removes an asymmetry a porter could otherwise assume away incorrectly |
| All step types (`RequestStep`/`ResponseStep`/`RecoveryStep`) are `async`, not synchronous transforms | `§8.2`'s framing of the recovery layer as synchronous | Node has one execution model end to end; the shipped `RECOV-15`/`16` step must call the already-async `toHttpError()`, so async is applied uniformly across all step shapes rather than mixed with sync ones |
| `RECOV-11`'s cancellation re-assertion becomes a defensive consistency check (`invariant()`), not a state re-assertion | `RECOV-11`'s literal "re-assert the cancellation signal" | `AbortSignal.aborted` is durable once fired, unlike a clearable `Thread.interrupt()` flag — nothing to re-assert. A mismatch between a classified cancellation error and a non-aborted signal is treated as a programmer error instead |
| No new per-status typed-exception hierarchy for `RECOV-15` | `RECOV-15`'s "matching typed exception" (which some ports read as a per-status class family) | Phase 3b's flat `HttpStatusError` (carrying `status` + buffered body) already satisfies this, and the corpus caps custom error hierarchies at two levels; a per-status class family would violate that cap |
| No default/preset recovery chain shipped in 4b | none — scope decision | Matches 4a's "primitives only" discipline; Phase 5 (retry) is the first real consumer and decides its own composition |

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `RECOV-N` IDs it exercises. No `FakeTransport` needed —
each test file hand-rolls a minimal `Transport` stub scoped to its own assertions, matching 4a's precedent of not
building a shared test double before a real consumer needs one.

**Property tests:**

- `RequestRecoveryChain.apply()` — for an arbitrary sequence of pure request transforms, the result equals
  applying each in order; an empty chain is the identity (`RECOV-3`).
- `ResponseRecoveryChain.apply()` — for an arbitrary mix of throwing/non-throwing response and recovery steps,
  `apply()` never throws (`RECOV-8`), and the response-step phase never runs when the input outcome is already a
  `Failure` (`RECOV-4`).

**Conformance examples** transcribed from `§8.2`'s own *Conformance:* clauses (`RECOV-2`: a throwing request step
and a throwing transport each surface as a `Failure` to a recovery hook; `RECOV-15`/`16`: 400..599 produce a
`Failure` with a typed exception, a sub-cap error body survives whole, an over-cap body truncates with the
connection released).

**Negative space:** a response step throwing while holding a `Success` closes that response exactly once, with a
close-failure attached as `suppressed` (`RECOV-12`); a recovery step returning a substitute `Success` does not
trigger an auto-close of the original (`RECOV-13`); `dispatchWithRecovery` rethrows a `Failure`'s error
byte-for-byte unchanged, no wrapping (`RECOV-10`); `wrapCancellation()` crashes via `invariant()` given a
classified cancellation error paired with a non-aborted signal.

## Deferred Items

Nothing new pushed out of this sub-phase. `contextsEqual()` (deferred from 4a to "4b or 4c if needed") is still
not needed — nothing here compares `ExecutionContext` values. `FakeTransport` (deferred from Phase 2 to 4c) is
still not built here — 4b's tests use file-local minimal stubs against the real `Transport` interface, not a
shared double.
