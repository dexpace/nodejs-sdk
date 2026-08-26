# Phase 5a — Retry Implementation Plan — Checklist

Verification of [2026-07-26-phase5a-retry.md](./2026-07-26-phase5a-retry.md) against every requirement ID in
`docs/product-spec/09-retry-and-resilience.md` and appendix C's `RECOV-17`–`RECOV-34`, as dispositioned by
`docs/superpowers/specs/2026-07-26-phase5a-retry-design.md`.

**Status: EXECUTED (2026-08-26).** Every task below is implemented, tested, and green across the full gate
sequence (`typecheck`, `lint`, `build`, `bun test` with coverage, `api:ci`, `lint:publish`,
`verify:dual-consumption`, `verify:consumer-types`, `verify:seam-1`, `verify:runtime-floor`, `test:node`,
`audit`). `packages/core/etc/core.api.md` and `packages/core/src/index.ts` are byte-identical to `main` —
nothing in this phase reaches the public barrel.

**Legend:** ✅ Implemented and tested — 🚫 Not built (permanent simplification, named reason) — ⏳ Deferred
(named target phase) — N/A Not applicable in this port.

## Executed out of numeric order: the Phase 7a prerequisite slice

This plan's Prerequisite section requires Phase 7a's `config/` module to exist first — its Task 8 consumes the
`Clock` seam, its Task 4 imports the shared RFC 1123 parser, and its Task 2 re-exports the shared
retryable-status classifier. `packages/core/src/config/` did not exist. Rather than ship the private copies the
plan's Global Constraints ban, the three files 7a's plan specifies were built first, verbatim from
[2026-07-28-phase7a-configuration.md](./2026-07-28-phase7a-configuration.md) Tasks 1–3, with their tests:

| File | Requirements | From |
|---|---|---|
| `packages/core/src/config/clock.ts` | `CFG-15`, `CFG-16`, `CFG-17` | 7a Task 1 |
| `packages/core/src/config/http-date.ts` | `CFG-29`, `CFG-30`, `CFG-31` | 7a Task 2 |
| `packages/core/src/config/retryable.ts` | `CFG-35` | 7a Task 3 |

Phase 7a's own execution should mark these three tasks done rather than rebuild them; its Tasks 4–10
(`identifiers`, `equality`, `configuration`, `proxy`, build-info, `client-identity-step`, barrel promotion) are
untouched here. These three are **not** promoted to the public barrel by this phase — 7a's Task 10 owns that
decision.

## 9.1 The two independent axes

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RETRY-1 | MUST | Single-sourced retryable status set — 408, 429, 5xx except 501/505 | ✅ | Task 2, re-exported from `config/retryable.ts` (`CFG-35`) rather than defined twice |
| RETRY-2 | MUST | Retryable-throwable classification walks the cause chain | ✅ | Task 2 — iterative, identity-tracking walk; a cyclic `cause` chain terminates instead of spinning, asserted directly |
| RETRY-3 | MUST | Retryability derived from the carried status, not a stored per-subclass flag | ✅ | Task 2 — `HttpStatusError.status` is consulted at classification time; there is no constant to get wrong |
| RETRY-4 | MUST | Transport-level failure (refused, TLS/DNS, socket read timeout, peer reset) retryable at the condition level | ✅ | Task 2 — such failures surface as `IoError` subclasses, which the allow-list admits unconditionally |
| RETRY-5 | MUST | Body-bearing request re-sendable iff its body is replayable | ✅ | Task 2 (`isResendable`), over Phase 3b's `Body.replayable` |
| RETRY-6 | MUST | Idempotent method set is `{GET, HEAD, OPTIONS, PUT, DELETE}`, single-sourced | ✅ | Task 2 imports Phase 1's `http/method.ts` `isIdempotent` (`HTTP-9`); nothing is restated |
| RETRY-7 | MUST | A bare non-idempotent POST is not re-sendable even with nothing to re-send | ✅ | Task 2, asserted; re-asserted end-to-end on both entry points (Tasks 8, 10) |
| RETRY-8 | MUST | BOTH axes must hold before a retry | ✅ | Task 2 (the two predicates), Task 8 (`decideRetry` gates them in order) |
| RETRY-37 | MUST | For a failure carrying a response the CONFIGURED status set is authoritative alone — widens and narrows | ✅ | Task 2 — `isRetryableFailure`'s second parameter; both directions asserted, and the built-in flag is not AND-ed in |

## 9.2 Backoff and pacing

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RETRY-9 | MUST | `initialDelay × multiplier^(attempt−1)`, 1-indexed, clamped to the cap | ✅ | Task 3, plus a `fast-check` monotonicity/cap property |
| RETRY-10 | MUST | Symmetric jitter over `[d(1−j/2), d(1+j/2)]`, midpoint `d`, `j=0` the identity | ✅ | Task 3 — window asserted exactly at both ends and by property test; a negative sample floors to zero |
| RETRY-11 | MUST | `attempt < 1` rejected; overflow saturates rather than throwing | ✅ | Task 3 — `invariant()` for the programmer error; `Math.min` absorbs `Infinity` into the cap |
| RETRY-12 | MUST | Defaults: 200 ms, ×2, 8 s cap, 20% jitter, 3 attempts | ✅ | Task 5 (`DEFAULT_RETRY_SETTINGS`) |
| RETRY-43 | MAY | Fixed-delay mode short-circuits backoff AND jitter | ✅ | Task 3 — a `MAY`, but `RETRY-39`'s MUST precedence chain names it as a step, so it is load-bearing |
| RETRY-15 | MUST | Recognized pacing forms: `Retry-After` seconds, `Retry-After` HTTP-date, `retry-after-ms`, `x-ms-retry-after-ms`, `X-RateLimit-Reset` | ✅ | Task 4 |
| RETRY-16 | MUST | The parser is TOTAL: never throws, every failure path returns "no hint" (`null`), never `0` | ✅ | Task 4 — asserted by `fast-check` over arbitrary strings, and separately that the result is `null` or a finite non-negative number |
| RETRY-17 | MUST | A validly-parsed instant already in the past yields `0` | ✅ | Task 4 (both the HTTP-date and `X-RateLimit-Reset` forms) |
| RETRY-18 | MUST | Every computed delta clamps to a 365-day ceiling | ✅ | Task 4 |
| RETRY-19 | MUST | Strict decimal grammar screens the numeric form before any float parse | ✅ | Task 4 — `30d`, `0x1p3`, `NaN`, `Infinity`, `1e3`, `+30`, and surrounding whitespace all rejected |
| RETRY-20 | MUST | A hint REPLACES the schedule for that one decision, unjittered, still budget-clamped | ✅ | Task 8 (`resolveDelay`), asserted end-to-end |
| RETRY-21 | MUST | Fixed precedence, first usable value wins | ✅ | Task 4 — including the fall-through from an unparseable `Retry-After` to `retry-after-ms` |
| RETRY-22 | MUST | A pacing-parse failure never masks the upstream failure | ✅ | Structural — the parser is total, so the original throwable is what the trail carries regardless; asserted in Task 8 |
| RETRY-13 | MUST | One backoff/classifier definition, no second copy | ✅ | Structural under ES modules — one `computeDelay`, one `parsePacingHint`, one status set; both adapters call the same `runWithRetry` |
| RETRY-14 | MUST | Both stacks' budgets denote the same number of sends | ✅ | Structural — there is one budget (`RetrySettings.maxAttempts`), so there is nothing to reconcile. `runWithRetry` asserts it is finite and `>= 1` once per call: a non-finite budget does not fail loudly on its own, it makes the attempt gate permanently false and the loop simply never stops, and this is the single choke point both adapters pass through |

## 9.3 Cancellation, timeout, and the wait

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RETRY-23 | MUST | Caller cancellation is never retryable | ✅ | Task 2 — keyed off the abort reason's `name`; `CancellationError` is outside the allow-list, asserted so a future re-parenting under `IoError` breaks loudly. The reference's "restore the interruption flag" half is N/A: `AbortSignal` is latched and observable by every later reader without re-assertion |
| RETRY-24 | MUST | A read timeout represented as an interrupted-I/O subtype stays retryable | ✅ | Task 2 — `AbortSignal.timeout()` aborts with a `DOMException` named `TimeoutError`; asserted bare and wrapped as a `cause`, and again under Node in `test/node-conformance/retry.test.mjs` |
| RETRY-25 | MUST | Never retry fatal errors (`OutOfMemoryError`, `StackOverflowError`) | N/A | Vacuous by construction — the classifier is an allow-list, so an unlisted throwable was never opted in. V8 has no catchable OOM class. Asserted anyway for a stack-overflow `RangeError` and a bare string throw |
| RETRY-26 | MUST | Cancellable inter-attempt wait that does not pin an execution carrier | ✅ | Task 8 (`waitFor`) — delegates to Phase 7a's `Clock.sleep` (`CFG-17`) rather than hand-rolling a second timer-versus-signal race, so the wait sits behind the injected seam and the unit suite stays deterministic. Node has no carriers to pin, so the substance is prompt cancellability (`XCUT-3`): asserted for an abort raised before the wait, for one raised while the wait is pending, and — against a REAL timer — in `test/node-conformance/retry.test.mjs` |
| RETRY-31 | MUST | The wait is non-blocking; a zero delay does not schedule a timer | ✅ | Task 8 — `await` on a timer yields the event loop; `delayMs <= 0` continues inline without reaching the clock at all, asserted by counting `sleep` invocations. The same guard keeps a caller `delayOverride` returning a negative number away from `Clock.sleep`'s negative-duration rejection |
| RETRY-32 | MUST | No further attempts once the caller has cancelled; a response arriving from an already-in-flight attempt closed rather than leaked | ✅ | Task 8 (the loop's first statement), Task 9 (asserted through the pipeline: zero wire sends). Second clause asserted both ways: a response arriving after the abort that the engine **discards** is released (`cancelCount` 1), while one that **ends the loop** is handed to the caller live and unclosed — ownership transfers rather than leaking, since the caller is the only reader that could close it. The design doc's blanket "any response arriving from an in-flight attempt is closed" describes only the first case |
| RETRY-33 | MUST | Every terminal path returns an outcome | ✅ | Task 8 — honored literally, not merely as a rejected promise. `stampAttempt`'s header build, `toHttpError`'s body drain, and a misbehaving injected clock's `sleep` can each throw; all three are folded into a failure outcome **carrying the trail**, because letting one escape as a bare rejection would silently discard every prior attempt `RETRY-34` requires to ride along. Asserted |
| RETRY-45 | MUST | Never shut down a caller-supplied scheduler | N/A | No scheduler object exists to own. The intent survives as `clearTimeout` hygiene on both wait exits, so no dangling timer keeps the event loop alive |

## 9.4 Budgets, reconciliation, and the discard path

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RETRY-27 | MUST | Total-timeout budget spanning attempts and delays; three independent abort conditions | ✅ | Task 8 — `budgetExhausted` (elapsed ≥ budget), `overshootsBudget` (elapsed + next delay > budget, which SURFACES rather than merely clamping), and `clampToBudget`. Both the abort and the clamp ship; `0` and `undefined` disable |
| RETRY-28 | MUST | A port that unifies the stacks makes the total timeout explicitly opt-in | ✅ | Task 5 — `totalTimeoutMs` is optional and undefined by default |
| RETRY-34 | MUST | On terminal failure every prior attempt's error rides along as suppressed; discarded on success; skip-self guard | ✅ | Task 8 (`withTrail`) — built through Phase 4b's `suppress()`, never `new SuppressedError(...)` (the native class reached Node only in 24.0.0; the floor is `>=20.3`). A reused instance never suppresses itself, asserted; the ≥3-attempt nested fold is asserted oldest-innermost |
| RETRY-35 | MUST | A discarded response's body is released, including when the retry decision throws | ✅ | Task 8 — the `finally` in `retireAndSchedule`; observed through `countingResponse`'s stream, never a spy on a frozen `Response` |
| RETRY-36 | MUST | A re-sent retryable-status response is remapped into a typed failure so the loop keeps evaluating the budget | ✅ (narrowed, ledgered) | Task 8 — the remap applies **only to responses the engine is discarding**. Gates run first; a response that survives them is returned live and unread. `toHttpError()` drains the body and drops the headers irreversibly, and 4c's pillar signature must return a `Response`. Full reasoning in the design doc; recorded in its deviation ledger |
| RETRY-30 | MUST | N retries must not build an N-deep continuation or stack chain | N/A | An `await` loop is already iterative — each iteration's frame is released before the next begins. No trampoline, re-arm flag, or pump is built. Same disposition class as 4c's `PIPE-29`/`PIPE-30` |

## 9.5 Knobs, stamping, and re-drive

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| RETRY-38 | SHOULD | Stamp the 1-based attempt ordinal on a fresh per-attempt copy, preserving every other header | ✅ | Task 7 — disabled by default, in which case the original instance is returned and nothing is allocated |
| RETRY-39 | MUST | Delay precedence: caller override → server pacing → fixed delay → exponential backoff | ✅ | Task 8 (`resolveDelay`); the exception path skips the header step, having no headers |
| RETRY-40 | MUST | A throwing user delay-override is non-fatal; a throwing should-retry predicate aborts the call | ✅ (override half) / N/A (predicate half) | Task 8 — the override throw is caught and the schedule used instead, asserted. The predicate half is unreachable: 5a exposes no user should-retry predicate, so there is no caller code on that path to throw. The "log it" clause is Phase 7b's Task 9 (see Cross-phase below). Ledgered |
| RETRY-41 | MUST | Effective retry count is present-override-wins; zero means no retries; a negative configured value is clamped to the default | ✅ (override) / 🚫 (clamp — rejected instead, ledgered) | Task 9 reads `ctx.options?.maxRetries` and runs the engine with `maxAttempts = maxRetries + 1`, asserted both narrowing (`0` → one send) and widening (`2` → three sends). The per-call value is **revalidated** at the step: `RequestOptionsBuilder` rejects only a negative, which is weaker than `retrySettings()`'s `Number.isFinite(...) && >= 1`, so `Infinity`/`NaN` would otherwise reach `maxAttempts` and make the engine's attempt gate permanently false — an unbounded retry loop reachable from the public options API. The clamp collides head-on with `HTTP-35` (also MUST), which REJECTS a negative max-retries at construction precisely so it cannot be silently reinterpreted as "use default". The port takes `HTTP-35`'s line on both surfaces — the builder rejects the option, `retrySettings()` trips `invariant()` on a negative `maxAttempts` |
| RETRY-42 | MUST | Settings and every policy component immutable, stateless, and safe for concurrent invocation | ✅ | Task 5 (frozen settings, defensively copied status set), Task 8 (attempt count and start instant are locals, asserted by two concurrent `runWithRetry` calls over one settings object), Task 9 (the per-call derivation re-freezes rather than handing back a bare spread of a frozen source) |
| RETRY-44 | MUST | Re-execute the downstream chain with FRESH per-attempt continuation state | ✅ | Task 9 — `ctx.fork()` once per attempt, 4c's mechanism's first consumer. Task 10 is the recovery-side mirror: each attempt re-runs the whole chain, asserted by counting request-chain applications. The second clause (upstream steps must not mutate the shared in-flight request) is free — `Request` is immutable and frozen |
| RETRY-29 | MAY | Opt-in server-driven retry-classification override header | ⏳ | Not scheduled. Widens the classifier's input surface to server-controlled values; wants an explicit trust decision, not a default. Deferred Items Log |

## Appendix C — `RECOV-17`–`RECOV-34`

Appendix C files eighteen `RECOV-*` rows under "Recovery-chain pipeline primitives" that
`08-execution-pipelines.md` §8.2 never defines in prose — they are retry-engine requirements stated a second
time for the reference's second retry stack. This port collapses both stacks into one engine (`RETRY-28`), so
they collapse onto the same implementation. Phase 9's conformance sweep should read this table rather than
re-deriving it.

| Appendix C | `§9` equivalent | Status | Where |
|---|---|---|---|
| RECOV-17 | `RETRY-1`, `RETRY-4`, `RETRY-8`, `RETRY-37` | ✅ | Task 2 (`classify.ts`); reached on this entry point by Task 10 |
| RECOV-18 | `RETRY-5`, `RETRY-6`, `RETRY-7` | ✅ | Task 2 |
| RECOV-19 | `RETRY-36` | ✅ (narrowed as above) | Task 8 |
| RECOV-20 | `RETRY-27` | ✅ | Task 8 — both the abort and the clamp |
| RECOV-21 | `RETRY-9`, `RETRY-10`, `RETRY-11` | ✅ | Task 3 — the same formula verbatim |
| RECOV-22 | `RETRY-20` | ✅ | Task 8 |
| RECOV-23 | `RETRY-16`, `RETRY-17` | ✅ | Task 4 — totality is the property test |
| RECOV-24 | `RETRY-15`, `RETRY-19`, `RETRY-21` | ✅ | Task 4 |
| RECOV-25 | `RETRY-15` (`X-RateLimit-Reset` clause) | ✅ | Task 4 — positive jitter bounded to `[100%, 120%]` INSIDE the parser, so many clients released at one reset instant do not stampede. A literal `Retry-After` receives no additional jitter (`RETRY-20`) |
| RECOV-26 | `RETRY-11`, `RETRY-18` | ✅ | Tasks 3, 4 |
| RECOV-27 | `RETRY-23`, `RETRY-26` | ✅ | Task 8 |
| RECOV-28 | `RETRY-42` | ✅ | Task 8 — per-call locals, asserted concurrently |
| RECOV-29 | `RETRY-22` | ✅ | Structural (total parser), asserted in Task 8 |
| RECOV-30 | `RETRY-13`, `RETRY-14` | ✅ | Structural here — one engine, no second stack to drift from. Both adapters (Tasks 9, 10) call the same `runWithRetry` |
| RECOV-31 | `RETRY-38` | ✅ | Task 7 |
| RECOV-32 | **none** (net-new) | ✅ | Task 11 — `recovery/idempotency-key.ts`. Method-gated (default `{POST, PUT, PATCH}`, defensively copied), respect-existing by default with the strategy **not** invoked in that case, strategy invoked at most once per applicable request, never mutating the input |
| RECOV-33 | **none** (net-new) | ⏳ | Phase 7a Task 9. Client-identity header stamping has no retry coupling; it is configuration-driven, so it travels with `CFG-*` |
| RECOV-34 | partial (`RETRY-11`, `RETRY-41`) | ✅ (settings validation) / 🚫 (configurable retryable-method set) | Task 5 — construction validation rejects negative or non-finite durations, `multiplier < 1.0`, `maxAttempts < 1`, and `jitter` outside `[0,1]`; the status set is a defensive copy. **No configurable retryable-METHOD set ships**: `RETRY-6`/`HTTP-9` fix the idempotent set and make Phase 1's `method.ts` its single source, so there is nothing per-instance to copy and no requirement obliges configurability. Ledgered |

## Cross-phase obligations

| Obligation | Status | Where |
|---|---|---|
| `PIPE-36` — a shipped pillar family locks its stage assignment | ✅ | Task 9 — satisfied structurally: `retryStep()` is a factory returning a descriptor with `stage: 'RETRY'` baked in. There is no class to subclass and no way for a caller to relocate it. Deferred out of 4c to "whichever future phase ships the first real pillar step family" — that is this one |
| `PIPE-17` — the caller's per-call options readable by any step | ✅ | Task 1 — `StepContext.options`, populated from the cursor's existing field, shared by reference across every fork. Previously threaded only into the terminal dispatch, leaving the clause unsatisfied outright |
| `StepContext.signal` — the 4c amendment | ✅ | Task 1 — additive and optional; no behavior change for any step that ignores it. `RETRY-26`'s cancellable wait and `RETRY-32`'s no-further-attempts rule are both unimplementable without it, and 5b/5c need the same access |
| 2026-07-28 Phase 7a retrofit (`Clock`, RFC 1123 parser, retryable-status single-sourcing) | ✅ | Applied — the three `config/` files exist and are imported, not duplicated. See the prerequisite-slice table above |
| 2026-07-28 Phase 7b retrofit (two `SHOULD`-level structured log events in `engine.ts`) | ⏳ Phase 7b Task 9 | **Deliberately NOT applied here**, per this plan's own 2026-07-29 correction: 5a executes before 7b, so an `observability/logger.js` import would not resolve, and 7b needs 5a's `FakeTransport`, so the dependency cannot run the other way. `engine.ts` carries a comment at its head marking both emission points and naming 7b's Task 9 as their owner. `RETRY-40`'s "log and fall back" is the same row — the fall-back half ships here, the log half there |
| `FakeTransport` — the twice-punted shared double | ✅ | Task 6 — `packages/core/src/testing/fake-transport.ts`, `@internal`. Scripted response sequences (last entry repeats), wire-send counting, and `countingResponse()`, the only sanctioned way to observe `Response.close()`: `Response` is frozen, so a spy over `close` throws. The counter observes release by BOTH routes — `cancel()` for an abandoned response, `pull()`-to-EOF for one the engine retired through `toHttpError()`'s bounded drain — because a helper counting `cancel()` alone would read zero on exactly the `RETRY-35` path it exists to prove |
| Node-runtime conformance (`CLAUDE.md`'s membership rule) | ✅ | `test/node-conformance/retry.test.mjs` — the `TimeoutError`-name classification that `RETRY-24` keys off (asserted against a real `AbortSignal.timeout()` with a ref'd deadline), the suppressed-trail shape across the native/fallback split, and release-on-discard over Node's own Web Streams |
| Public barrel unchanged | ✅ | Task 12 — `git diff --exit-code` on `core.api.md` and `index.ts` is empty. 4c left "do we publish a step-authoring surface" to the first phase shipping a pillar step; this phase answers **not yet**, because a caller cannot assemble a working pipeline until 5c ships the standard-resilience preset, and publishing `retryStep` alone would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes 5c may still reshape |

## Deferred out of Phase 5a

| Item | Target | Reason |
|---|---|---|
| `RETRY-29` — opt-in server-driven retry-classification override | Not scheduled | `MAY`. Widens the classifier's input surface to server-controlled values; wants an explicit trust decision, not a default |
| `RECOV-33` — client-identity header step | Phase 7a (Task 9) | Configuration-driven header composition with no retry coupling; belongs with `CFG-*` |
| Public-barrel promotion of `retryStep` and the step-authoring surface | Phase 5c | Needs the standard-resilience preset (`PIPE-24`, `PIPE-39`) and `PIPE-35`'s `seedFrom`, which need all three pillar steps installed |
| The two structured retry log events (`retry.attemptFailed`, `retry.exhausted`) | Phase 7b (Task 9) | Cycle-breaking: 5a cannot import `observability/`, 7b needs 5a's `FakeTransport` |
