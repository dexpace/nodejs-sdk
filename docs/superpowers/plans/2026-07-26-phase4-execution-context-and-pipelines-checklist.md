# Phase 4 (4a + 4b + 4c) — Execution Context & Pipelines — Checklist

Verification of the three Phase 4 implementation plans —
[4a Execution Context](./2026-07-25-phase4a-execution-context.md),
[4b Recovery-Chain Primitives](./2026-07-25-phase4b-recovery-chain.md),
[4c Stage-Based Pipeline](./2026-07-25-phase4c-stage-pipeline.md) — against every requirement ID in
`docs/product-spec/07-execution-context-model.md` (`CTX-*`) and
`docs/product-spec/08-execution-pipelines.md` (`PIPE-*`, `RECOV-*`), as dispositioned by their design docs.

**Legend:** ✅ Planned, implemented and tested — 🚫 Not built (permanent simplification, named reason) —
⏳ Deferred (named target phase) — N/A Not applicable in this port.

**Status:** the plans are reviewed and corrected as of 2026-07-26 (see *Review findings applied*, below) but
**not yet executed**. Every ✅ means "the plan builds and tests it," not "it is on `main`."

---

## §7.1 The promotion chain (4a)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| CTX-1 | MUST | Three flavors, one-way dispatch → request → exchange; exchange terminal, no promote-back | ✅ | 4a Task 3. The no-promote-back half is a *compile-time* guarantee, asserted by two `@ts-expect-error` lines that fail `typecheck` if either promotion ever widens to accept an `ExchangeContext` |
| CTX-2 | MUST | Promotion additive and non-mutating; bundle + key carried by reference; exactly one artifact added | ✅ | 4a Task 3 — carried-forward fields asserted as identical *references*, source asserted unchanged |
| CTX-3 | MUST | One call key shared by the whole chain | ✅ | 4a Task 3 |

## §7.2 Call-key uniqueness (4a)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| CTX-4 | MUST | Key unique per call, never derived from trace/span id alone | ✅ | 4a Task 3 (`Symbol()` keys). §7's own conformance clause — two contexts with identical trace AND span id get differing keys and *both register* — is transcribed in `store.test.ts`, since "both register" needs a store |
| CTX-5 / CTX-6 | MUST | Off-chain construction mints a fresh key; an explicit key can be pinned | ✅ | 4a Task 3, including a population-scale check that 3000 default contexts across all three flavors are pairwise key-distinct — a scheme colliding every Nth call would pass a single-pair test |
| CTX-17 | MUST | Registration at promotion, never at head-context construction | ✅ (split) | **Negative half in 4a** (Task 3/4: `context.ts` never imports `store.ts`, so it holds structurally; a never-promoted context leaves no entry and its close is a no-op). **Positive half in 4c** (Task 4: `contextStore.install(requestContext)` immediately after the first promotion) — the deferral 4a's plan opened, closed here |

## §7.3 The context store (4a)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| CTX-7 | MUST | Contexts immutable; store safe for concurrent register/overwrite/remove | ✅ | 4a Task 3 (`Object.freeze` per flavor) + Task 4. Thread-safety collapses to a plain `Map`: Node's event loop makes synchronous `Map` mutation non-interleaving. Ledgered |
| CTX-8 | MUST | Install-or-replace never throws; reject-on-duplicate names the key | ✅ | 4a Task 4 (`install`, `installIfAbsent` → `DuplicateContextKeyError`) |
| CTX-9 | MUST | Close evicts conditionally on **reference identity**, never value equality | ✅ | 4a Task 4 |
| CTX-10 | MUST | Closing an already-superseded intermediate link is a no-op | ✅ | 4a Task 4 — asserted with the promoted context still in the slot |
| CTX-18 | MUST | Unknown-key lookup returns absent; unknown/repeat removal is a no-op; neither throws | ✅ | 4a Task 4, both directions |

## §7.4 Bounded backstop (4a)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| CTX-11 | MUST | Bounded store, drained back to the cap after each insert | ✅ | 4a Task 4 (`DEFAULT_MAX_ENTRIES = 10_000`, `#drain`) |
| CTX-12 | SHOULD | Post-insert drain **loop**, not a single check-then-evict | ✅ | 4a Task 4 — property-style burst test asserts the size never overshoots *after any single insert*, in both `install` and `installIfAbsent` |
| CTX-13 | MAY | Victim selection arbitrary; no entry, including the just-inserted one, is guaranteed to survive | ✅ | 4a Task 4 — oldest-inserted is the chosen (cheapest) victim, documented as *not* a retention promise |
| CTX-19 | MUST | Strong references only; the cap, not GC, is the leak backstop | ✅ | Satisfied by construction — a plain `Map`, never `WeakRef`/`WeakMap`. Stated, not manufactured as a test |

## §7.5 Instrumentation bundle and operation name (4a)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| CTX-14 | MUST | Bundle exposes trace id, span id, flags, state, encoding flavor, validity/remoteness, active span, tracer factory | ✅ (shape) | 4a Task 1. `activeSpan`/`tracerFactory` typed `unknown` — the real `Span`/`Tracer` shapes belong to a tracing adapter, ⏳ **Phase 7**. Ledgered |
| CTX-15 | MUST | No-op default: all-zero ids, zero flags, empty state, invalid/not-remote, no-op span and factory | ✅ (partial) | 4a Task 1. `activeSpan` is `undefined` rather than a no-op span *object*: with the type deferred there is no shape to build a no-op of. Every other sentinel ships exactly as specified. Knowing partial deviation, ledgered |
| CTX-15 (2nd clause) | MUST | Key derivation stays call-unique even when every bundle field is identical | ✅ | 4a Task 3's 3000-context test (all sharing `noopInstrumentationBundle`) and Task 4's CTX-4 conformance test |
| CTX-16 | SHOULD | Optional operation name, introduced at the request stage, carried forward, advisory only | ✅ | 4a Task 3 — absent on `DispatchContext` by type (`Omit<ContextInit, 'operationName'>`), and the "never influences the store key" clause asserted directly |
| CTX-20 | SHOULD | Tracer factory defaults to a no-op emitting nothing, safe to invoke concurrently | ✅ | 4a Task 1 |

---

## §8.2 Recovery-chain primitives (4b)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RECOV-1 | MUST | Closed two-variant sum type; fold applies exactly one branch, at most once | ✅ | 4b Task 1 (`Outcome<T>`, `success`/`failure`/`fold`, `assertNever` default). No `isSuccess()`/`getOrThrow()` accessors — "derivable accessors" reads as discriminant narrowing, which the union gives free |
| RECOV-2 | MUST | One catch wraps every request-chain and transport throwable into a Failure; nothing bypasses the recovery hooks | ✅ | 4b Task 6. Load-bearing on `wrapCancellation` never throwing — see *Review findings applied* #2 |
| RECOV-3 | MUST | Request chain is a sequential left-to-right fold; empty is identity; a throwing step aborts and propagates | ✅ | 4b Task 2, plus a property test that `apply()` equals a manual reduce over arbitrary step sequences |
| RECOV-4 | MUST | Response steps run only on a Success; the whole phase is skipped on a Failure | ✅ | 4b Task 3 (`#runResponsePhase`) |
| RECOV-5 | MUST | Recovery steps run on every outcome, always, sequentially | ✅ | 4b Task 3 (`#runRecoveryPhase`) |
| RECOV-6 | MUST | Fold order: all response steps, then all recovery steps, declared order within each | ✅ | 4b Task 3 |
| RECOV-7 | MUST | A throwing response step becomes a Failure fed to recovery, never propagated | ✅ | 4b Task 3 — asserted with a later response step proving the phase stops |
| RECOV-8 | MUST | A throwing recovery step becomes a Failure fed to the **next** recovery step; `apply()` never throws | ✅ | 4b Task 3 (no `break` in the recovery loop), plus a property test over arbitrary throwing/non-throwing sequences |
| RECOV-9 | SHOULD | Recovery steps should return a Failure rather than throw | ✅ | Satisfied structurally — both shapes are handled identically, documented rather than enforced |
| RECOV-10 | MUST | Unwrap: Success returns the response; Failure rethrows the throwable **unchanged** | ✅ | 4b Task 6 — asserted with `rejects.toBe(typedError)`, identity not message |
| RECOV-11 | MUST | Wrapping a cancellation throwable re-asserts the cancellation signal | ✅ (reframed) | 4b Task 4. An `AbortSignal` is durable once fired and the SDK never holds the caller's `AbortController`, so there is nothing to re-assert; the helper is `failure(error)` and **never throws**, which is what keeps RECOV-2 absolute. Ledgered |
| RECOV-12 | MUST | A step throwing while holding a Success closes that response exactly once, close error `suppressed`, original primary | ✅ | 4b Task 3 (`toFailureClosingSuccess`, hand-built `SuppressedError` — never `using`, whose auto-generated one inverts the priority). Close observed via the body stream's `cancel()` hook, since `Response` is frozen |
| RECOV-13 | MUST | A deliberately *returned* different outcome is never auto-closed | ✅ | 4b Task 3 — only a caught throw reaches the close path; asserted for both a substitute Failure and a substitute Success |
| RECOV-14 | MUST | Step lists immutable; response chain copies both | ✅ | 4b Tasks 2 and 3 — the request chain is copied too, which the reference does not do and the requirement's own text recommends. Ledgered |
| RECOV-15 | MUST | Only 400..599 map to the typed exception; every other status passes through | ✅ | 4b Task 5, delegating to Phase 3b's unchanged `toHttpError()` |
| RECOV-16 | MUST | Error body buffered into a bounded (1 MiB) replayable copy before mapping, shared cap | ✅ | Phase 3b's `toHttpError()`, unchanged. 4b Task 5 proves the wiring only; the buffering itself is 3b's own suite's job |

---

## §8.1 Stage-based pipeline (4c)

### Stage model and composition

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PIPE-1 | MUST | One fixed total order from stage assignment, independent of insertion order | ✅ | 4c Task 1 (`STAGE_ORDER`) + Task 5's driven probe test (entry in declaration order, exit its exact reverse, installed in reverse so a leak of insertion order fails loudly) |
| PIPE-2 | MUST | Pillar precedence PRE_REDIRECT → REDIRECT → RETRY → AUTH → LOGGING → SERDE → SEND | ✅ (stage half) | 4c Tasks 1 and 5. ⏳ The "auth re-runs per redirect hop" half needs a real pillar step — **Phase 5/6** |
| PIPE-3 | SHOULD | Pre/post extension slots around each pillar; sparse keys so new stages need no renumbering | ✅ | 4c Task 1 — a string-literal union satisfies the underlying goal more directly than sparse numbers: inserting a stage is one `splice`, and no existing `Stage` value moves. Ledgered |
| PIPE-4 | MUST | A pillar admits at most one step; pillars are exactly REDIRECT/RETRY/AUTH/LOGGING/SERDE | ✅ | 4c Tasks 1 and 5 (`PILLAR_STAGES`, `#checkPillarSlot`, and `reload`'s in-batch cap) |
| PIPE-5 | MUST | A distinct second step on an occupied pillar fails fast, naming both types, pointing at replace | ✅ | 4c Task 2 (`PillarCollisionError`) + Task 5 |
| PIPE-6 | MUST | Re-installing the same step is idempotent, by **reference identity** | ✅ | 4c Task 5 — keyed on the `type` symbol, not value equality |
| PIPE-7 | MUST | Non-pillar stages ordered; append→tail, prepend→head, order preserved through re-bucketing | ✅ | 4c Task 5 |
| PIPE-8 | MUST | SEND reserved for the transport hop, holds no user step, skipped at flatten | ✅ | 4c Task 5 — enforced at *every* insertion path (`ReservedStageError`), not only passively at flatten time; the flatten skip remains as defense in depth |
| PIPE-18 / PIPE-19 | MUST | insert-after/insert-before/replace act on the first anchor instance; cross-stage rejected | ✅ | 4c Task 5 (`#requireAnchor`, `#requireSameStage` → `CrossStageEditError`) |
| PIPE-20 | MUST | Remove deletes every instance, order-preserving, no-op when absent | ✅ | 4c Task 5 |
| PIPE-21 | MUST | A missing anchor fails, identifying the type | ✅ | 4c Task 2 (`AnchorNotFoundError`) + Task 5 |
| PIPE-22 | MUST | Any edit sequence flattens identically to building the same set from scratch | ✅ | 4c Task 5 — structural (flattening is a pure function of the buckets) plus an edit-order-independence test |
| PIPE-23 | MUST | Bulk reload is all-or-nothing; a collision leaves the collection completely unchanged | ✅ | 4c Task 5 — full batch validated before `#buckets.clear()`; a same-type pillar repeat inside one batch seats one step, not two |
| PIPE-25 | MUST | `build()` flattens in declaration order, skipping SEND, into an immutable runtime with a read-only ordered view | ✅ | 4c Task 5 (`build()`) + Task 4 (`Runtime` copies and freezes its step array at construction; `get steps()`) |
| PIPE-38 | MUST | `appendAll` preserves batch order; `prependAll` reverses it; the asymmetry is documented | ✅ | 4c Task 5, both directions asserted |

### Execution: runtime, cursor, forks

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PIPE-9 | MUST | An empty pipeline dispatches straight to the transport, threading options, without per-call cursor state | ✅ | 4c Task 4 — no `Cursor` and no context installed (with no promotion there is no first store entry for `CTX-17` to hang) |
| PIPE-10 | MUST | Runtime immutable after construction; each send allocates its own cursor | ✅ | 4c Tasks 4 and 3 |
| PIPE-11 | MUST | Steps safe for concurrent invocation; per-request state on the cursor, never the step | ✅ | 4c Tasks 3 and 4 — `Runtime` holds no mutable per-call state; the one-shot guard lives on the continuation closure, not the `Cursor` |
| PIPE-12 | MUST | Steps bidirectional; may substitute the response; may short-circuit without calling next | ✅ | 4c Task 3 (`Step`'s `(request, ctx)` shape) |
| PIPE-13 | MUST | next() advances a monotonic cursor; exhaustion dispatches to the transport with the caller's options | ✅ | 4c Task 3 (`#dispatch`'s exhaustion branch) |
| PIPE-14 | MUST | A substituted request propagates to every downstream step and the terminal dispatch | ✅ | 4c Task 3 (`Next`'s optional replacement, one mutable `#request` per drive) + Task 4 (`exchangeSource`, so the exchange context describes what was actually sent, not what the caller handed in) |
| PIPE-15 | MUST | A re-driving step forks a fresh cursor each time; reusing a handle is a defect | ✅ | 4c Task 3 — **stronger than the reference**, which describes the reused handle silently resuming; here it throws `CursorAlreadyAdvancedError`, so that conformance clause is not transcribable as written |
| PIPE-16 | MUST | A forked cursor resumes from the same position, carries the in-flight request, shares options, advances independently | ✅ | 4c Task 3 — every `fork()` call is pinned to the same target position, so attempt 2 re-runs every downstream step fresh |
| PIPE-17 | MUST | Per-call options carried unchanged across every fork, threaded into the terminal dispatch, shared not copied | ✅ | 4c Task 3 — the two-fork test asserts the identical options object reaches both dispatches |
| PIPE-26 | MUST | The runtime itself implements the transport SPI so a pipeline can stand in for a transport | ✅ | 4c Task 4 (`Runtime implements Transport`). The "delegate execute/execute-async" framing collapses: the SPI has one method. Ledgered |
| PIPE-27 | MUST | Closing the pipeline never closes the underlying transport | ✅ | 4c Task 4, spy-asserted |
| PIPE-40 | MUST | A re-driving step releases each superseded response and never closes the one it returns | ✅ (contract) | 4c Task 3 documents the obligation on the forking step, matching the reference's placement — it is not a `Cursor`/`Runtime` behavior. ⏳ Its 2-hop-redirect conformance clause travels with the first redirect step — **Phase 5/6** |

### Dispositions — no task, by design

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| PIPE-24 | MUST | The standard-resilience preset installs into empty pillar slots only | ⏳ | No preset exists in 4c for the rule to apply to; travels with `PIPE-39` |
| PIPE-28 | MUST | The async runtime reuses identical stage identities; no independent re-derivation | ✅ | Vacuous with one `STAGE_ORDER` — there is no second runtime to drift |
| PIPE-29 | MUST | An async step must not throw synchronously | ✅ | Structural: every `Step` is `async`, and a JS `async` function cannot throw synchronously — a body that throws before its first `await` still returns a rejected promise |
| PIPE-30 | MUST | The runtime normalizes a step's synchronous throw; fatal errors propagate unswallowed | ✅ / N/A | First clause structural (as PIPE-29 — adding a `try`/`catch` would be dead code the coverage gate cannot exercise). Second clause N/A: V8 has no catchable fatal-error class for a naive catch to swallow — a genuine OOM aborts the process without producing a JS exception |
| PIPE-31 | MUST | The async terminal response-mapping operator closes on success and on failure, unwrapping wrappers | N/A | No distinct async surface. The close-on-throw discipline itself is not lost — 4b's `RECOV-12` owns it for the single execution model |
| PIPE-32 | MUST | Document the async standard pipeline's no-redirect asymmetry vs. the sync one | N/A | With one pipeline there is no asymmetry to document, and its redirect pillar exists |
| PIPE-33 / PIPE-34 | MUST | sync↔async bridges | 🚫 | **Never built.** A bridge connects two execution models and this port has one — same class as Phase 2's `SEAM-18` disposition, recorded as permanent, not deferred |
| PIPE-35 | SHOULD | FLATTEN-vs-NEST seeding from an existing pipeline, the choice always explicit | ⏳ | **Phase 5/6.** Not a bridge disposition despite its placement under the spec's "Bridges." heading. Its MUST clause is vacuously satisfied while 4c offers no seeding path at all; the future shape is `seedFrom(runtime, 'flatten' \| 'nest')` with a non-defaulted mode argument |
| PIPE-36 | SHOULD | Shipped pillar families lock their stage assignment against subclass relocation | N/A | Steps are functions carrying `stage` on a `StepDescriptor`, not subclassable classes. Applies to whichever phase ships the first pillar family. Ledgered |
| PIPE-37 | MUST | A step depending on the single terminal response occupies the outermost pre-redirect slot | ⏳ | A placement contract on whoever installs such a step, not a rule 4c's plumbing enforces. `PRE_REDIRECT` exists and is installable today; the obligation lands on whichever phase wires 4b's `statusMappingStep` into a real pipeline — **Phase 5** |
| PIPE-39 | SHOULD | Convenience constructors: step-less passthrough, and a standard resilience pipeline | ⏳ (partial) | The step-less passthrough falls out of `PIPE-9`'s fast path for free. The resilience preset needs real pillar steps — **Phase 5+** |

---

## Cross-cutting plan obligations

| Obligation | Source | Status | Where |
|---|---|---|---|
| Nothing enters the published API surface | styleguide 10.3; Phase 3a/4a precedent | ✅ | 4a Task 5 / 4b Task 7 / 4c Task 6 — `git diff --exit-code packages/core/etc/core.api.md` must produce no output. Mechanical proof, not a review promise |
| No runtime dependency added | `SEAM-1` | ✅ | `verify:seam-1` in each phase's gate task |
| No `node:` import in core | `sdk-design/03` §3.1, runtime-agnosticism | ✅ | Grep step in each gate task |
| No internal barrel (`index.ts` per folder) | `docs/knowledge/module-organization.md:18` | ✅ | No `context/`, `recovery/`, or `pipeline/` barrel. 4a Task 5 asserts its absence mechanically. **Open:** 3b's `body/index.ts` is the one remaining violation — retrofit before 3b executes, or ledger it |
| No TypeScript `enum` | `erasableSyntaxOnly`, binding since Phase 0 | ✅ | 4c Task 6 Step 3 greps for it; `Stage` is a string-literal union |
| Property tests where invariants exist | styleguide 11.5 | ✅ | 4a (key distinctness, drain convergence), 4b (`fold` identity laws, request-chain fold law, `apply()` never throws), 4c (edit-order independence, batch ordering) |
| Negative-space assertions | styleguide 11.9 | ✅ | Duplicate-key install, no-op closes, cross-stage edits, missing anchors, reserved SEND, continuation reuse, transport `close()` never called |
| Options object over positional params | `max-params: 3` | ✅ | `ContextInit` (4a), `DispatchConfig` (4b), `CursorInit` (4c). No `eslint-disable` anywhere in Phase 4 |
| Fakes over mocks; no owned interface mocked | styleguide 11.3 | ✅ | File-local `Transport` stubs throughout; no `FakeTransport`, no `mock.module`, and (as of the 2026-07-26 review) no patched `Response` method and no patched `contextStore` singleton |
| Every test file cites its requirement IDs | Phase 1 convention, for Phase 9 | ✅ | Top-of-file comment in every test file across all three plans |
| 80% aggregate coverage floor | `NFR-5` | ✅ | Each phase's gate task |

---

## Review findings applied (2026-07-26)

Four defects found reviewing the plans against the knowledge corpus and the earlier phases' actual output.
All are fixed in the plans (and their design docs) rather than left for the implementing agent to trip over.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **Blocking** | 4b's `RECOV-12`/`RECOV-13` tests monkey-patched `response.close`. `Response` calls `Object.freeze(this)` at the end of its constructor (Phase 1's rule, preserved by 3b's retrofit), so the assignment throws `TypeError: Cannot add property close, object is not extensible` under an ES module's strict mode — verified on both Bun and Node. Four test sites would have failed at runtime | Close is now observed through the body stream's `cancel()` hook, exactly as Phase 3b's own `response.test.ts` does. `Response.close()` is idempotent and cancels at most once, so the cancel count *is* the "released exactly once" count. Added as a Global Constraint so it is not reintroduced |
| 2 | **Correctness** | 4b's `wrapCancellation` crashed via `invariant()` when a `CancellationError` arrived without a correspondingly-aborted signal. It runs inside `dispatchWithRecovery`'s own `catch`, so the crash let a transport throwable bypass the response and recovery chains — the exact failure mode `RECOV-2` exists to forbid. It also treated a *pluggable third-party seam* misbehaving as a programmer error, where the corpus reserves crash-loud for our own violated preconditions. Reachable in practice: a transport that aborts in-flight requests from `close()` (permitted by `SEAM-14`) with no caller signal in play | `wrapCancellation(error)` now always returns `failure(error)` and never throws; the signal parameter is gone. Tests reworked to assert exactly that, including a transport-raised cancellation reaching the recovery steps. Design ledger row and the RECOV-11 section rewritten |
| 3 | **Robustness** | 4c's runtime tests patched `install` on the process-wide `contextStore` singleton to observe the exchange context (which `send()` evicts in its own `finally`). That mocks an owned interface and leaks across test files sharing the process the moment a run is parallelised — against styleguide 11.3 and 11.7 | `exchangeSource` is exported `@internal` and unit-tested directly as the pure function it is; the end-to-end half that stays observable (the substituted request reached the transport) is asserted through the transport stub. Absolute `contextStore.size` assertions replaced with key-scoped `get(key) === undefined` checks or a before/after delta |
| 4 | Minor | `Runtime`'s constructor trusted the caller's array, leaving `PIPE-25`'s immutability resting on `PipelineBuilder` being the only construction site; `PIPE-17` was claimed but never asserted; two 4c test files had out-of-order imports; `fc.char()` is deprecated in fast-check 3.22+; 4b Task 1's snippet would land an unused `invariant` import; the builder task's expected test count was 15 against 19 tests | `Runtime` now does `Object.freeze([...steps])` (builder no longer pre-freezes); the two-fork test asserts the identical options object reaches both dispatches; imports reordered; `fc.char()` → `fc.string({minLength: 1, maxLength: 1})`; the snippet notes it extends an existing import; count corrected |

---

## Deferred out of Phase 4

| Item | Target | Note |
|---|---|---|
| Real W3C Trace Context generation — `InstrumentationBundle`'s actual tracing backend | Phase 7 | 4a ships only `CTX-14`'s shape and `CTX-15`'s no-op default; `activeSpan`/`tracerFactory` stay `unknown` until an adapter defines them, alongside `Logger`/`LogEvent` |
| `contextsEqual()` value-equality utility | Not scheduled | `CTX-6` describes a consequence of key uniqueness, not a new equality API. Neither 4b nor 4c needed one — the deferral's stated condition for building it did not fire |
| `FakeTransport` test double | Phase 5 or 6 | Re-punted past 4c; all three sub-phases used file-local stubs instead. Retargeted to whichever phase first needs a transport reusable across many multi-scenario tests |
| `PIPE-35` FLATTEN-vs-NEST seeding | Phase 5 or 6 | Deferred on its own merits, not as a bridge disposition. Nothing yet holds a built pipeline to seed from |
| `PIPE-2`'s redirect/retry clause; `PIPE-40`'s 2-hop-redirect clause | Phase 5 or 6 | Both need a real redirect pillar step to be testable at all |
| `PIPE-24`/`PIPE-39`'s standard-resilience preset; `PIPE-37`'s placement obligation | Phase 5+ | All three presuppose real pillar steps |
| `NFR-11` (no async-framework type leak) | **Closed in 4c** | `Step`/`Next`/`Runtime`'s surface is `Promise`-only. Deferral resolved, not re-punted |
