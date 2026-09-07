---
'@dexpace/core': patch
---

Add the retry pillar for product-spec §9 (`RETRY-1`–`RETRY-45`) and appendix C's `RECOV-17`–`RECOV-34`, plus
the Phase 7a `config/` prerequisite slice and the shared `FakeTransport`. No public API change.

Everything this adds lives under `packages/core/src/{retry,config,testing}/` and none of it is re-exported
from `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than
an empty changeset because files under `packages/` did change: the published tarball carries the new
`dist/retry/*.js`, `dist/config/*.js`, and `dist/testing/*.js`, and a consumer stepping through the package in
a debugger will see them. (The one behavior change a caller can observe from outside — tightening
`RequestOptionsBuilder.maxRetries` to a non-negative integer — ships under its own changeset.)

Public-barrel promotion of `retryStep` and the step-authoring surface is deliberately **not** in this release.
A caller cannot assemble a working pipeline until the standard-resilience preset exists, and publishing
`retryStep` alone would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes that still had latitude to
move. Phase 5c owns that promotion.

## What landed

`packages/core/src/retry/`, eight files, no folder barrel:

- **`classify.ts`** — the two orthogonal axes (`RETRY-1`–`RETRY-8`, `RETRY-37`). Retryability is an
  ALLOW-list over an iterative, identity-tracking cause walk; `isResendable` is the second axis over
  `Body.replayable` and Phase 1's `isIdempotent`.
- **`backoff.ts`, `pacing.ts`** — the pure math and the server-hint parser, split away from the imperative
  loop.
- **`settings.ts`** — `RETRY-12`'s defaults, `RECOV-34`'s construction validation, and `totalTimeoutMs` as an
  opt-in.
- **`engine.ts`** — the one attempt loop both adapters reach.
- **`attempt-stamp.ts`, `retry-step.ts`, `retry-dispatch.ts`** — per-attempt stamping and the two thin
  adapters: the `RETRY` pillar step and the recovery-chain wrapper.

Plus `recovery/idempotency-key.ts` (`RECOV-32`) and `testing/fake-transport.ts`, which closes the roadmap's
twice-punted `FakeTransport` deferral.

Two files outside those folders changed, both additively. `StepContext` gains `signal` and `options`
(`PIPE-13`/`PIPE-17`): `Cursor` already carried both and threaded them into terminal dispatch, but no step
could read either, so `RETRY-26`'s cancellable wait and `RETRY-32` were unimplementable and `PIPE-17`'s
"readable by any step" MUST was unsatisfied outright — which is also the wire `RETRY-41`'s per-call
`maxRetries` override (`HTTP-35`) had been missing since Phase 1 designed the knob.

## Executed out of numeric order: the Phase 7a prerequisite slice

`config/clock.ts` (`CFG-15`–`CFG-17`), `config/http-date.ts` (`CFG-29`–`CFG-31`), and `config/retryable.ts`
(`CFG-35`) are built here, verbatim from Phase 7a's plan Tasks 1–3, because 5a's Global Constraints ban
shipping the private copies that would otherwise be needed: Task 8 consumes the `Clock` seam, Task 4 imports
the shared RFC 1123 parser, and Task 2 re-exports the shared retryable-status set instead of defining it a
second time. Phase 7a's Tasks 4–10 are untouched, and none of the three enters the public barrel — 7a's Task
10 still owns that decision.

## Design calls worth recording

- **One retry loop, reached by both adapters.** `RETRY-13`/`RETRY-14` and `RECOV-30` require the pillar stack
  and the recovery-chain stack not to drift. `runWithRetry` is the single choke point both call, so the
  schedule, the classifier, and the budget cannot diverge — structural, not a discipline. Every piece of
  per-call state is a local (`RETRY-42`/`RECOV-28`), so concurrent invocations sharing one config cannot
  clobber each other's attempt count or start instant.
- **`RETRY-25`'s fatal-error exclusion needs no code.** Because classification is an allow-list, a
  stack-overflow `RangeError` is non-retryable for never having been opted in, not for having been screened
  out. A caller `AbortError` is likewise non-retryable for free (`RETRY-23`), while `TimeoutError` is
  explicitly listed (`RETRY-24`) — keying off the abort reason's `name` draws that line more precisely than
  the class hierarchy the reference describes.
- **The pacing parser is total, and a failure never maps to `0`.** `RETRY-16` makes never-throwing the
  defining property; every malformed, negative, or out-of-range value maps to `null` ("no hint", fall back to
  backoff). `0` is reserved for a validly-parsed instant already in the past (`RETRY-17`) — mapping a
  malformed header to `0` would hammer a server that just asked for room. `X-RateLimit-Reset` receives
  `RECOV-25`'s positive [100%, 120%] jitter so a fleet released at one reset instant does not stampede; a
  literal `Retry-After` receives none (`RETRY-20`).
- **`RETRY-36`'s remap applies only to responses the engine DISCARDS.** A response surviving the gates is
  returned live and unread: `toHttpError()` drains the body and drops the headers irreversibly, and 4c's
  pillar signature must return a `Response`. This is also why the pacing hint is read BEFORE the retire step
  — that ordering is load-bearing, not stylistic.
- **`RETRY-27`'s budget clause is implemented as three separate checks, deliberately.** A delay that would
  push cumulative elapsed time past the budget SUPPRESSES the retry and surfaces the last failure; the
  `Math.min` clamp beside it is the requirement's separately-listed belt-and-braces clause and narrows
  nothing except across clock drift between two `elapsed()` reads. It ships because the requirement lists it
  separately, not because a test can drive it.
- **A non-finite retry ceiling is guarded at three layers.** Unlike a negative value, which still fails a
  downstream `>= 1` guard, `Infinity` or `NaN` makes `attempt >= ceiling` permanently false and the loop
  unbounded. The setter, the step's per-call derivation, and a `runWithRetry` precondition each reject it —
  the precondition being the one choke point both adapters pass through.
- **`RETRY-41`'s "clamp a negative retry count to the default" is implemented as a REJECTION.** It collides
  head-on with `HTTP-35`, also a MUST, which rejects precisely so the value cannot be silently reinterpreted
  downstream. The port takes `HTTP-35`'s line on both surfaces; recorded in the design's Deviation Ledger.
- **The inter-attempt wait delegates to `Clock.sleep`.** `CFG-17` already races the timer against the signal,
  clears it on both exits (`RETRY-45`'s scheduler hygiene, which has no scheduler object to own in this
  port), and rejects promptly for a signal that aborted earlier. Hand-rolling a second `setTimeout`-plus-
  listener would put the wait outside the injected seam and force real timers into a suite that must stay
  deterministic. Cancellation RESOLVES rather than propagates, so the loop's next iteration observes the
  signal and stops through its own `RETRY-32` path.
- **`RETRY-33`'s "every terminal path returns an Outcome" is honored literally.** An attempt that throws is
  folded into a failure outcome carrying the trail rather than left to surface as a bare rejected promise,
  which would drop `RETRY-34`'s suppressed attempts on the floor. The trail folds through Phase 4b's
  `suppress()` helper, not `new SuppressedError(...)`: the native class reached Node only in 24.0.0 and this
  package's floor is `>=20.3`. Argument order is controlled explicitly — native `using` disposal builds the
  pair the other way round, making the LATER error primary.
- **`RETRY-30`'s trampoline requirement is satisfied by the language.** An `await` loop is already iterative,
  so N retries build no continuation chain and no stack growth.
- **`PIPE-36` is satisfied structurally.** `retryStep()` is a factory returning a descriptor with
  `stage: 'RETRY'` baked in — no class to subclass, no way for a caller to relocate a shipped pillar family
  out of its pillar. 4c deferred this to "whichever future phase ships the first real pillar step family";
  this is that phase.
- **`countingResponse()` counts release by BOTH routes it can happen** — `cancel()` for an abandoned
  response, `pull()`-to-EOF for one `toHttpError()` drained. A helper counting `cancel()` alone reads zero on
  exactly the `RETRY-35` path it exists to prove.

## Known gaps, each recorded rather than left silent

- **`RETRY-29`** (opt-in server-driven retry-classification override) is a `MAY` and is unscheduled: it
  widens the classifier's input surface to server-controlled values and wants an explicit trust decision, not
  a default.
- **`RECOV-33`** (client-identity header step) belongs with the `CFG-*` work and is Phase 7a's Task 9.
- **`RETRY-40`'s "log the failure" clause and the two SHOULD-level structured events** (`retry.attemptFailed`,
  `retry.exhausted`) are not implemented here. 5a executes before 7b, so an `observability/logger.js` import
  would not resolve; 7b in turn needs this phase's `FakeTransport`, so the cycle only breaks in this
  direction. Phase 7b's Task 9 owns them, named in `engine.ts`'s retrofit note.
