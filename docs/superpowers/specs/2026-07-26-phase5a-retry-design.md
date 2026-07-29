# Phase 5a — Retry — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the retry engine — the status/throwable classifier, the backoff calculator, the pacing-header
parser, the settings object, the attempt loop, and the two thin adapters that bind it to the stage pipeline (4c) and
the recovery chain (4b) — satisfying `docs/product-spec/09-retry-and-resilience.md` (`RETRY-1`–`RETRY-45`) and the
retry-engine half of `docs/product-spec/08-execution-pipelines.md` §8.2 as indexed in appendix C
(`RECOV-17`–`RECOV-34`). This is the first of three sub-phases the roadmap's Phase 5 ("Resilience —
Retry/Redirect/Auth") splits into: **5a** (this document, retry), 5b (redirect, `§10`), 5c (auth, `§11`).

> **Amended 2026-07-28 (Phase 7a retrofit):** `RetryConfig`'s clock field, described below only informally as
> "clock" (see `runWithRetry`'s signature comment), is retyped to Phase 7a's real `Clock` seam (`CFG-15`)
> instead of an ad hoc `now: () => number`; `pacing.ts`'s hand-written RFC 1123 parser (referenced throughout
> this document) is re-sourced from Phase 7a's shared `config/http-date.ts` rather than staying a private
> copy; and `classify.ts`'s `RETRYABLE_STATUSES`/`isRetryableStatus` (`RETRY-1`) are re-exported from Phase 7a's
> `config/retryable.ts` (`CFG-35`) rather than defined here a second time. See
> `docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md`'s Scope section for the rationale; see
> the amended `docs/superpowers/plans/2026-07-26-phase5a-retry.md` for the concrete diffs.

**Governing documents:** `docs/product-spec/09-retry-and-resilience.md` (normative, cited by ID throughout),
`docs/product-spec/appendix-c-consolidated-normative-requirement-index.md` (`RECOV-17`–`RECOV-34`),
`docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md` (Node-port mapping — ES-module single-sourcing,
injectable random source, the hand-written RFC 1123 parser, the one-stack collapse), the Phase 4b and 4c design docs
(`Outcome`/recovery chains and `Stage`/`StepDescriptor`/`Cursor`, both consumed unchanged). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

5a ships the retry engine and nothing else. No redirect step, no auth step, no standard-resilience preset — those
are 5b, 5c, and 5c respectively. This continues the "primitives before presets" discipline 4a/4b/4c held to.

`RECOV-32` (idempotency-key injection) ships here despite not being retry mechanics, because it is retry-semantic:
its entire purpose is making a retried write safe, and `RETRY-38` explicitly requires the per-attempt stamp to
preserve it. `RECOV-33` (client-identity header) does **not** ship here — it is a configuration-driven header step
with no retry coupling, retargeted to Phase 7a alongside `CFG-*` (7a Task 9 ships it).

`FakeTransport` is built here (`packages/core/src/testing/fake-transport.ts`, `@internal`), closing the roadmap
deferral that named "Phase 5 or 6, whichever first needs a transport reusable across many multi-scenario tests."
Retry is that phase: scripted response sequences, wire-send counting, and per-response close observation are all
required by `RETRY-35`/`RETRY-36` tests. 5b and 5c consume the same double.

### The `RECOV-17`–`RECOV-34` reconciliation

Appendix C files eighteen `RECOV-*` rows under "Recovery-chain pipeline primitives" that
`08-execution-pipelines.md` §8.2 never defines in prose — §8.2 stops at `RECOV-16`. They are retry-engine
requirements stated a second time for the reference's second retry stack. Since this port collapses both stacks into
one engine (`RETRY-28`, `sdk-design/06`), they collapse onto the same implementation. Sixteen have `§9` twins; two
do not.

| Appendix C | `§9` equivalent | Disposition |
|---|---|---|
| `RECOV-17` | `RETRY-1`, `RETRY-4`, `RETRY-8`, `RETRY-37` | Same rule — `classify.ts` |
| `RECOV-18` | `RETRY-5`, `RETRY-6`, `RETRY-7` | Same rule — `classify.ts` |
| `RECOV-19` | `RETRY-36` | Same rule — `engine.ts` |
| `RECOV-20` | `RETRY-27` | Same rule — `engine.ts` |
| `RECOV-21` | `RETRY-9`, `RETRY-10`, `RETRY-11` | Same formula verbatim — `backoff.ts` |
| `RECOV-22` | `RETRY-20` | Same rule — `engine.ts` |
| `RECOV-23` | `RETRY-16`, `RETRY-17` | Same rule — `pacing.ts` |
| `RECOV-24` | `RETRY-15`, `RETRY-19`, `RETRY-21` | Same rule — `pacing.ts` |
| `RECOV-25` | `RETRY-15` (`X-RateLimit-Reset` clause) | Same rule — `pacing.ts` |
| `RECOV-26` | `RETRY-11`, `RETRY-18` | Same rule — `backoff.ts`, `pacing.ts` |
| `RECOV-27` | `RETRY-23`, `RETRY-26` | Same rule — `engine.ts` |
| `RECOV-28` | `RETRY-42` | Same rule — `engine.ts` |
| `RECOV-29` | `RETRY-22` | Same rule — `engine.ts` |
| `RECOV-30` | `RETRY-13`, `RETRY-14` | Structural here — one engine, no second stack to drift from |
| `RECOV-31` | `RETRY-38` | Same rule — `attempt-stamp.ts` |
| `RECOV-32` | **none** | Net-new — `recovery/idempotency-key.ts`, shipped in 5a |
| `RECOV-33` | **none** | Net-new — **deferred to Phase 7a** with `CFG-*` |
| `RECOV-34` | partial (`RETRY-11`, `RETRY-41` cover only the attempt index and count clamping) | Settings-object validation is new — `settings.ts` |

Phase 9's conformance sweep should read this table rather than re-deriving it. Effective unique scope for 5a is
therefore ~47 requirements, not 63.

## Prerequisite: a two-field amendment to 4c's `StepContext`

4c's `Cursor` accepts a `signal?: AbortSignal` and an `options?: RequestOptions` and threads both through to
terminal dispatch, but `StepContext` exposes only `next`, `fork`, and `context`. **A step can observe neither the
call's cancellation signal nor the caller's per-call options.**

- **`signal`.** The retry step must observe cancellation: `RETRY-26`'s cancellable inter-attempt wait and
  `RETRY-32`'s "launch no further attempts once the caller has cancelled" are both unimplementable without it,
  and 5b's redirect loop and 5c's token fetch need the same access.
- **`options`.** `PIPE-17` (MUST) requires the caller's per-call options to be "readable by any step", not only
  threaded into the terminal dispatch — with no exposure on `StepContext`, that clause is unsatisfied outright.
  It is also the missing wire for two already-designed per-call knobs: `RETRY-41`'s "effective retry count is
  present-override-wins" names exactly Phase 1's `RequestOptions.maxRetries` (`HTTP-35`, where `0` means
  "disable retries for this call"), which nothing read until now; and 5c's per-call auth-descriptor override
  rides the same field (see 5c's design).

The amendment is additive, two fields:

```typescript
interface StepContext {
  readonly next: Next;
  readonly fork?: () => Next;
  readonly context: ExecutionContext;
  readonly signal?: AbortSignal | undefined;         // NEW -- the call's signal, already held by Cursor
  readonly options?: RequestOptions | undefined;     // NEW -- the caller's per-call options (PIPE-17), already held by Cursor
}
```

Optional, `?: T | undefined` per `exactOptionalPropertyTypes`, populated from the `Cursor`'s existing `#signal`
and `#options`. No behavior changes for any step that ignores them. 4c is planned but not executed, so this lands
as 5a's Task 1 rather than a retrofit — but it is a genuine cross-phase dependency and must be applied before
5a's own implementation begins.

## Module Layout

All in `@dexpace/core`. Kebab-case filenames, no internal barrel — public symbols reach consumers through core's
single `index.ts` (styleguide 10.3, held since Phase 0).

```
packages/core/src/retry/
  classify.ts        # RETRY-1..8, 37    condition + re-sendability
  backoff.ts         # RETRY-9..12       pure delay math
  pacing.ts          # RETRY-15..21      header parser
  settings.ts        # RETRY-12, RECOV-34  defaults + construction validation
  engine.ts          # RETRY-27, 30..44  the attempt loop
  attempt-stamp.ts   # RETRY-38          per-attempt request copy
  retry-step.ts      # pillar adapter (4c)
  retry-dispatch.ts  # recovery adapter (4b)
packages/core/src/recovery/
  idempotency-key.ts # RECOV-32          RequestStep, upstream of retry
packages/core/src/testing/
  fake-transport.ts  # @internal test double
```

Three pieces are already single-sourced by earlier phases and are imported, never redeclared:

- **`isIdempotent(method)`** — Phase 1 `http/method.ts`. `RETRY-6`'s `{GET, HEAD, OPTIONS, PUT, DELETE}` set already
  exists and is already the one definition; `classify.ts` imports it.
- **`Body.replayable: boolean`** — Phase 3b. `RETRY-5`'s gate is one expression over existing state.
- **`IoError`** (3a), **`CancellationError`** (2), **`HttpStatusError`** with `status` and a bounded buffered body
  (3b). No new error leaf classes are introduced by 5a.

ES modules make `RETRY-13`'s single-sourcing mandate structural rather than a discipline: one module exporting
`RETRYABLE_STATUSES`, `computeDelay()`, and `parsePacingHint()` cannot exist twice the way two JVM classloaders can
each hold their own copy.

## Classification (`classify.ts`)

```typescript
const RETRYABLE_STATUSES: ReadonlySet<number>;   // 408, 429, 500-599 except 501 and 505
function isRetryableStatus(code: number): boolean;
function isRetryableFailure(error: unknown, statuses: ReadonlySet<number>): boolean;
function isResendable(request: Request): boolean;
```

`RETRY-1`'s classifier is the frozen set, computed once at module load. `RETRY-3` is satisfied by derivation rather
than a stored flag: `HttpStatusError` carries `status`, so retryability is `isRetryableStatus(error.status)`
evaluated at classification time — there is no per-subclass constant to get wrong.

`RETRY-2`'s throwable set is an **iterative, identity-tracking cause walk**: follow `.cause`, holding a `Set` of
visited nodes so a cyclic chain terminates rather than looping forever, returning true if any node is an `IoError`
or a timeout. `RETRY-4`'s transport-level failure (connection refused, TLS/DNS failure, socket read timeout, peer
reset) is retryable unconditionally at the condition level because such failures surface as `IoError` subclasses.

**`RETRY-23` vs `RETRY-24` has a clean platform answer.** The reference must distinguish "thread interrupted"
(never retryable) from "read timeout represented as an interrupted-I/O subtype" (still retryable) through a class
hierarchy that conflates them. Node draws the distinction natively: `AbortSignal.timeout()` aborts with a
`DOMException` named `TimeoutError`, a caller abort with one named `AbortError`, and Phase 2 already ships
`isTimeoutSignal()`. The classifier keys off the abort reason's name. A `CancellationError` from a user abort is
never retryable; a timeout abort is.

`RETRY-25` (never retry `OutOfMemoryError`/`StackOverflowError`) is **vacuous by construction**. The classifier is
an allow-list — a value is retryable only if it is an `IoError`, a timeout, or a configured status. A
stack-overflow `RangeError` is non-retryable because it was never opted in, not because it was screened out. V8
additionally has no catchable OOM class; a genuine OOM aborts the process without producing a JS exception.

`isResendable()` implements `RETRY-5`/`RETRY-7`/`RETRY-8`: a body-less request is re-sendable iff its method is
idempotent; a body-bearing request iff `body.replayable`. A bare non-idempotent POST is therefore not retried even
though it has nothing to physically re-send — the case `RETRY-7` calls out explicitly.

`RETRY-37`: for a failure carrying a received response the **configured** status set is authoritative, consulted
alone — it both widens and narrows relative to the built-in classifier, and the built-in flag is not AND-ed in. A
no-response transport failure falls back to always-retryable. This is `isRetryableFailure`'s second parameter.

## Backoff (`backoff.ts`)

```typescript
function computeDelay(attempt: number, settings: BackoffSettings, random: () => number): number;
```

Pure, three params, no I/O. `RETRY-9`: unjittered delay is `initialDelayMs × multiplier^(attempt−1)`, `attempt`
1-indexed where 1 is the wait before the first retry, clamped to `maxDelayMs`. `RETRY-11`: `attempt < 1` is a
programmer error and trips `invariant()`; overflow saturates to the cap rather than throwing — in JS the failure
mode is `Infinity` from `Math.pow`, which `Math.min` against the cap already absorbs, so saturation is checked
explicitly rather than assumed.

`RETRY-10`: symmetric jitter draws uniformly from `[d(1−j/2), d(1+j/2)]` with midpoint `d`; `j = 0` returns `d`
unperturbed; `j` is constrained to `[0,1]` at settings-construction time; a negative sample floors to zero. The
reference's "degenerate sub-nanosecond range returns the base delay" clause is a nanosecond-arithmetic artifact —
this port computes in milliseconds as `number`, where the degenerate case is the `j = 0` identity already
specified.

`random` is injected (defaulting to `Math.random`) — the same injectable-determinism seam `CFG-15` wants for the
clock, and what makes the jitter tests assertions rather than statistics.

`RETRY-43`'s fixed-delay mode is a settings field that short-circuits both backoff and jitter. It is a `MAY`, but
`RETRY-39`'s `MUST` precedence chain names it as a step, so it is load-bearing.

## Pacing (`pacing.ts`)

```typescript
function parsePacingHint(headers: Headers, nowMs: number, random: () => number): number | null;
```

**Totality is the defining property** (`RETRY-16`, `RECOV-23`): the parser never throws for any input, and every
failure path returns `null` — "no hint" — never `0`. The distinction matters because `0` means "retry immediately",
which is the opposite of what a server sending a malformed `Retry-After` is asking for. A validly-parsed instant
already in the past *does* return `0` (`RETRY-17`).

Recognized forms and precedence, first usable wins (`RETRY-21`, `RECOV-24`):

1. `Retry-After` as numeric delta-seconds (integer and fractional)
2. `Retry-After` as an RFC 1123 HTTP-date
3. `retry-after-ms` — integer milliseconds
4. `x-ms-retry-after-ms` — integer milliseconds
5. `X-RateLimit-Reset` — Unix epoch seconds

**The date parser is hand-written, never `Date.parse`.** `sdk-design/06` is explicit: JS `Date` string parsing is
permissive and non-standardized across V8, JavaScriptCore, and SpiderMonkey, which is precisely the opposite of
`RETRY-16`'s totality mandate — a lenient engine can silently accept a malformed header as a valid, wildly-wrong
instant. The parser accepts RFC 1123 tolerant of an informational weekday and a single-digit day, per `RETRY-15`.

`RETRY-19`: the numeric form is screened by a **strict decimal grammar before any float parse**, so `30d`,
hex-float forms, `NaN`, and `Infinity` are rejected and fall through to backoff rather than mis-parsing.

`RETRY-18`/`RECOV-26`: every computed delta clamps to a 365-day ceiling before use.

`RECOV-25`: `X-RateLimit-Reset` deltas receive positive jitter bounded to `[100%, 120%]` **inside the parser**, so
many clients released at one reset instant do not stampede. A literal `Retry-After` receives no additional jitter
(`RETRY-20`) — it is respected as given.

## Settings (`settings.ts`)

Defaults per `RETRY-12`: `initialDelayMs: 200`, `multiplier: 2.0`, `maxDelayMs: 8000`, `jitter: 0.2`,
`maxAttempts: 3` (three total wire sends). `RETRY-14`'s "both stacks' budgets must denote the same number of sends"
is structural — there is one budget, so there is nothing to reconcile.

`totalTimeoutMs` is **optional and undefined by default**. `RETRY-28` instructs a port that unifies the stacks to
make the total-timeout explicitly opt-in rather than always-on, and `sdk-design/06` already committed to that. An
explicit `0` also disables the deadline, matching `RETRY-27`/`RECOV-20`.

`RECOV-34` validation at construction, rejecting: negative durations, `multiplier < 1.0`, `maxAttempts < 1`,
`jitter` outside `[0,1]`. The one collection-valued setting — the retryable-status set — is a frozen defensive
copy so later caller mutation cannot alter policy. `RECOV-34` also names a *retryable-methods* collection: 5a
ships **no such setting**. `RETRY-6` fixes the idempotent set to `{GET, HEAD, OPTIONS, PUT, DELETE}` and
`HTTP-9` makes Phase 1's `http/method.ts` its single source, which `isResendable()` imports; there is nothing
per-instance to copy defensively, and no requirement obliges the set to be *configurable*. Recorded in the
deviation ledger below. `RETRY-42`: settings and every policy component are immutable and stateless after
construction, safe for concurrent invocation — including the per-call `maxAttempts` derivation in
`retry-step.ts`, which re-freezes rather than handing back a bare spread of a frozen source.

## The Attempt Loop (`engine.ts`)

```typescript
type RetryDispatch = (request: Request, attempt: number) => Promise<Outcome<Response>>;

async function runWithRetry(
  request: Request,
  dispatch: RetryDispatch,
  config: RetryConfig,   // settings + signal + clock + random + the optional delayOverride (RETRY-39)
): Promise<Outcome<Response>>;
```

Three params, at the `max-params: 3` ceiling — the same `ContextInit` trick 4a used and 4b applied to
`dispatchWithRecovery`.

### The `RETRY-36` contract clash, and how it resolves

`RETRY-36`/`RECOV-19` require a re-sent response carrying a retryable error status to be "re-mapped into a typed
failure (with its body buffered per `RETRY-35`/`RECOV-16`) so the loop keeps evaluating the budget." Applied
naively that breaks two things:

1. **4c's pillar step signature is `(request, ctx) => Promise<Response>`.** A step must produce a response. If the
   loop remapped every retryable-status response, a pipeline with a retry step but no status-mapping step would
   start throwing on a terminal 503 the caller never asked to have turned into an exception.
2. **The remap is irreversible and lossy.** `toHttpError()` (3b) drains the body into a bounded 1 MiB copy and
   closes the live response. `HttpStatusError` carries `status` and the buffered bytes — **not the headers**. Once
   remapped, the pacing headers are unreachable.

**Resolution: the remap applies only to responses the engine is discarding.** Classification and both gates run
first. A response the loop is about to abandon has its pacing hint read off the live headers, then is
remapped-and-closed; that buffered `HttpStatusError` becomes the trail entry `RETRY-34` needs, and the whole trail
is discarded on eventual success. A response that *survives* the gates — ineligible request, attempt cap reached,
budget exhausted — is returned **live and unread**, exactly as a caller with no retry step installed would have
received it.

This is a faithful reading, not a narrowing: `RETRY-36`'s stated purpose is "so the loop keeps evaluating the
budget," and a response that ends the loop has no budget left to evaluate. `RECOV-16`'s bounded buffering is
obtained on exactly the responses that need it. Recorded in the deviation ledger below.

### Iteration order

```
1  abort check                                   RETRY-32   (no further attempts once cancelled)
2  outcome = dispatch(stamp(request, n), n)
3  classify: retryable condition?                RETRY-1..4, 37
4  gate: re-sendable request?                    RETRY-5..8
5  gate: attempt cap, elapsed vs budget          RETRY-27, RECOV-20
   -- any gate fails: return the outcome untouched, live response intact
6  read pacing hint from the live headers        RETRY-15..21   (must precede step 7)
7  remap + close the discarded response          RETRY-35, 36
8  resolve delay: override -> hint -> fixed -> backoff   RETRY-39, 43
9  clamp to remaining budget; surface now if it would overshoot   RETRY-27
10 cancellable wait                              RETRY-26
11 fold error into the trail; loop
```

Steps 6–8 sit inside a `try`/`finally` whose `finally` closes the discarded response, satisfying `RETRY-35`'s second
clause — if the retry decision or the delay computation throws, the response is still released before the error
propagates. `RETRY-22`/`RECOV-29`: a pacing-parse failure can never mask the upstream failure, because the parser is
total and the original throwable is what the trail carries regardless.

`RETRY-39`'s precedence is caller delay-override → server pacing headers (response path only) → fixed delay →
exponential backoff; the exception path skips the header step, having no headers. `RETRY-40`: a throwing user
delay-override is non-fatal — the engine logs it at `verbose` through 7b's `getGlobalLogger()` and falls back to
the schedule. `RETRY-40`'s second clause (a throwing should-retry predicate aborts the call as a well-typed
error) is **vacuous here**: 5a exposes no user-supplied should-retry predicate. Retry classification is
`classify.ts`'s, parameterized only by the configured status set, so there is no caller code on that path to
throw. Recorded in the deviation ledger.

`RETRY-41`: an effective retry count is present-override-wins, else the configured value, and zero means "no
retries". The present override is per-call: `RequestOptions.maxRetries` (Phase 1, `HTTP-35`), read by the retry
step from `ctx.options` (the `StepContext` amendment above). When present, the engine's effective budget is
`maxRetries + 1` total sends (`RetrySettings.maxAttempts` counts sends, the option counts retries), so
`maxRetries: 0` yields exactly one attempt — `HTTP-35`'s "disable retries for this call".

**`RETRY-41`'s "a negative configured value is clamped to the default" is deliberately not implemented as a
clamp.** It collides head-on with `HTTP-35` (MUST): `RequestOptionsBuilder` *rejects* a negative max-retries at
construction, precisely because "a negative retry count would be silently reinterpreted as 'use default'". Both
are MUSTs and only one can hold. The port takes `HTTP-35`'s line on both surfaces — the per-call option is
rejected by the Phase 1 builder, and a negative `maxAttempts` trips `retrySettings()`'s `invariant()` — so an
out-of-range value is always a loud programmer error rather than a silently reinterpreted one. The retry step
therefore revalidates nothing. Recorded in the deviation ledger.

`RETRY-20`/`RECOV-22`: a present pacing hint **replaces**, never augments, the exponential value for that single
decision, receives no additional symmetric jitter, and is still clamped against the total-timeout deadline when one
is configured.

### The wait

`RETRY-26` requires a cancellable inter-attempt wait that does not pin an execution carrier. Node has no carriers
to pin, so the substance is prompt cancellability (`XCUT-3`): a `Promise` racing `setTimeout` against the call's
`AbortSignal`, with `clearTimeout` on **both** paths so no dangling timer keeps the event loop alive. `RETRY-45`'s
"never shut down a caller-supplied scheduler" has no analogue — there is no scheduler object to own — but its
intent survives as that timer hygiene.

`RETRY-31`: the wait is non-blocking by construction — `await` on a timer yields the event loop rather than holding
it — and a **zero-length delay short-circuits the timer entirely**, continuing to the next iteration inline. This
matters after `RETRY-17` (a past `Retry-After` instant yields `0`) and after step 9's budget clamp: scheduling a
`setTimeout(0)` there would cost a macrotask turn for nothing. The reference's "re-arming the active pump" is the
loop's next iteration.

`RETRY-32`: once the caller's signal is aborted the driver launches no further attempts, and any response arriving
from an in-flight attempt is closed rather than leaked. `RETRY-33`: every terminal path returns an `Outcome`;
because `runWithRetry` is `async`, a throw anywhere inside it becomes a rejected promise rather than a lost
completion — the same language-level guarantee 4c relied on for `PIPE-29`.

### The suppressed trail

`RETRY-34`: on terminal failure every prior attempt's error is attached to the surfaced error as suppressed; on
eventual success the trail is discarded entirely. `SuppressedError` is a binary pair, so N attempts fold into a
nested chain as they accrue:

```typescript
trail = trail === undefined ? error : new SuppressedError(error, trail);
```

Constructed by hand with argument order controlled explicitly — the same reason 4b refused native `using`
disposal, whose `SuppressedError` construction puts the *later* error first and would make the older attempt
primary. The **skip-self guard** is a reference-identity check before folding, so a re-thrown identical instance
cannot suppress itself. `RETRY-34` notes the reference applies this guard on only one of its two stacks and that a
port must apply it to both; with one stack there is one place to apply it.

### `RETRY-30`'s trampoline

The requirement is that N retries must not build an N-deep chain of continuations or stack frames. A `for` loop
with `await` is already iterative — each iteration's frame is released before the next begins, and no continuation
chain accumulates. Structurally satisfied, needing no re-arm flag or pump, exactly as 4c dispositioned
`PIPE-29`/`PIPE-30`. Not a deviation; the language provides what the reference had to build.

## Per-Attempt Stamping (`attempt-stamp.ts`, `recovery/idempotency-key.ts`)

`RETRY-38` (`SHOULD`) / `RECOV-31` (`MAY`), both shipped: stamp the 1-based attempt ordinal on a
**fresh per-attempt copy** of the
request, never mutating the captured template, preserving the idempotency key and every other header. Disabled by
default, in which case the function returns the original request unchanged and allocates nothing.

`RECOV-32` (`MUST`, net-new) is a `RequestStep` for 4b's `RequestRecoveryChain`, run **once** upstream of retry, not
per attempt:

- Applies only to methods in the configured set (default `{POST, PUT, PATCH}`); other methods pass through
  untouched.
- In respect-existing mode (the default) a request already carrying the header is left unchanged and the key
  strategy is **not invoked**; otherwise the strategy result overwrites.
- The strategy is invoked at most once per applicable request.

The two are siblings — one writes the key, the other must preserve it across attempts — which is why they ship
together despite living in different directories.

## Adapters

### Pillar adapter (`retry-step.ts`)

```typescript
const RETRY_STEP_TYPE: unique symbol = Symbol('dexpace.retry');

interface RetryStepOptions {
  readonly settings?: Partial<RetrySettings> | undefined;
  readonly clock?: Clock | undefined;            // defaults to 7a's defaultClock
  readonly random?: (() => number) | undefined;  // defaults to Math.random
  readonly delayOverride?: ((attempt: number) => number | undefined) | undefined;
}

function retryStep(options?: RetryStepOptions): StepDescriptor;   // stage: 'RETRY'
```

The factory takes an options object, not a bare `RetrySettings`: the engine's two other injected seams
(`clock`, `random`) and `RETRY-39`'s caller delay-override have to reach `RetryConfig` somehow, and an options
object is what the styleguide's three-parameter ceiling and zero-config-call rule ask for. A no-argument
`retryStep()` is the default-tuned pillar step (`RETRY-12`).

The step asserts `ctx.fork` is present via `invariant()` — `RETRY` is in `PILLAR_STAGES`, so its absence is a
programmer error, not an operational one — then calls `fork()` **once per attempt**. Each `fork()` yields a fresh
one-shot continuation, which is exactly `RETRY-44`'s "re-execute the downstream chain with fresh per-attempt
continuation state rather than reusing the prior attempt's in-flight chain." 4c built the mechanism; 5a is its first
consumer. The dispatch callback catches and wraps into `Outcome`; the step unwraps by `fold`, rethrowing on terminal
failure.

`RETRY-44`'s second clause — upstream steps must not mutate the shared in-flight request between attempts — is free:
`Request` is immutable and `Object.freeze`d (Phase 1).

`PIPE-36` (a shipped pillar family should lock its stage assignment so a subclass cannot relocate out of its
pillar), deferred out of 4c to "whichever future phase ships the first real pillar step family," lands here and is
satisfied structurally: `retryStep()` is a factory returning a descriptor with `stage: 'RETRY'` baked in. There is
no class to subclass and no way for a caller to relocate it.

### Recovery adapter (`retry-dispatch.ts`)

```typescript
async function dispatchWithRetry(request: Request, config: RetryDispatchConfig): Promise<Response>;
```

**Not** a `RecoveryStep` — a `RecoveryStep` receives an outcome and has no way to re-dispatch. This wraps 4b's
orchestrator instead, mirroring its `(request, config)` signature, with `dispatchWithRecovery` itself as the
dispatch callback. Each attempt therefore re-runs the entire recovery chain — request chain, transport, response
chain — the recovery-side mirror of what `fork()` does on the pillar side.

`RECOV-17`–`RECOV-20` land on this function. `RETRY-13`/`RETRY-14`/`RECOV-30`'s "must not drift" is structural
rather than a discipline: both adapters call the same `runWithRetry`, which calls the same `computeDelay` and
`parsePacingHint`.

## `FakeTransport`

`packages/core/src/testing/fake-transport.ts`, marked `@internal` and kept out of the public barrel — the same
treatment `Serde<T>` got in Phase 2 and all of `src/io/` got in Phase 3a, so promoting or reshaping it later is not
a breaking change.

```typescript
class FakeTransport implements Transport {
  constructor(script: readonly (Response | Error)[]);   // consumed in order; the last entry repeats
  readonly calls: readonly {request: Request; options?: RequestOptions; signal?: AbortSignal}[];
  get sendCount(): number;                              // wire-send counting
  async close(): Promise<void>;
}

// Response construction is a sibling free function, not a method: close observation belongs to the response,
// not to the transport that served it, and 5b/5c build responses the transport never sees.
function countingResponse(
  status: number,
  request?: Request,
): {response: Response; cancelCount: () => number};
```

`FakeTransport` records every send for wire-send counting and replays a scripted sequence, so `503,503,200` is
one line of setup. `countingResponse` builds the responses and reports how many times each was released.

**The body stream is the only sanctioned way to observe release.** `Response` instances are `Object.freeze`d at
construction (Phase 1, held through 3b), so assigning a spy over `response.close` throws
`TypeError: Cannot add property close, object is not extensible` under ESM strict mode. 4b's review established
this; it is a cross-phase invariant, restated here because 5b and 5c will write close-observing tests against the
same double.

Release reaches the stream by **two** routes, and the counter must see both: a response abandoned unread is
released by `Response.close()` cancelling the stream (`cancel()` fires), while a response the engine *retires*
has already been drained to EOF by `toHttpError()`'s bounded buffering (`HTTP-52`), after which there is nothing
left to cancel and only the source's `pull()` observed it. A helper that counted `cancel()` alone would read
zero on exactly the `RETRY-35` path it exists to prove. For the same reason the scripted body MUST close: a
`ReadableStream` that enqueues and never closes leaves the retire path's drain awaiting a chunk that never
arrives.

## Testing

`bun test`, colocated `*.test.ts`, fakes over mocks. No `mock.module` — nothing in 5a is a true external.

`clock` and `random` are injected through `RetryConfig`, which makes jitter, backoff, and total-timeout behavior
assertable exactly rather than statistically, and keeps the suite fast (no real waiting).

fast-check property tests on the four invariant-bearing pure functions:

- **`computeDelay`** — monotonically non-decreasing in `attempt`, never exceeds `maxDelayMs`, saturates instead of
  throwing for large attempts.
- **jitter** — the sample always lies within `[d(1−j/2), d(1+j/2)]`; `j = 0` is the identity.
- **`parsePacingHint`** — **never throws for any string**. Totality is the property, tested against arbitrary
  strings, not a fixed corpus of malformed examples.
- **the cause walk** — terminates on a cyclic `cause` chain (generated by constructing a cycle explicitly).

`RECOV-28`/`RETRY-42` are what make the suite order-independent and parallel-safe: the attempt count and start
instant are locals threaded through the loop, never instance fields, so concurrent invocations cannot clobber each
other's budget. A test asserting this runs two `runWithRetry` calls concurrently against one settings object.

**Negative space.** No test patches a method onto a frozen `Response`. No test asserts on real elapsed wall-clock
time. No test depends on `Math.random` unseeded.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| One retry engine with two thin adapters, not two stacks | Reference ships a recovery-chain retry and a stage-based retry step | Explicitly sanctioned by `RETRY-28` ("a port that unifies the stacks MUST make the total-timeout an explicitly opt-in feature"), pre-committed in `sdk-design/06`. The port has one execution model, so there is no second sync/async story to serve |
| `totalTimeoutMs` optional, undefined by default | Recovery stack always enforces a budget; stage stack never does | `RETRY-28`'s stated instruction to a unifying port |
| `RETRY-36`'s remap applies only to responses the engine discards | Reference remaps every re-sent retryable-status response | A remapped response is unrecoverable (body drained, headers lost) and 4c's pillar signature must return a `Response`. `RETRY-36`'s own stated purpose — "so the loop keeps evaluating the budget" — does not reach a response that ends the loop. Full reasoning above |
| Timeout-vs-cancellation keyed off the abort reason's name | Reference distinguishes by exception class hierarchy | `AbortSignal.timeout()` produces `DOMException` named `TimeoutError`, caller aborts `AbortError`; Phase 2's `isTimeoutSignal()` already draws the line. `RETRY-23`/`RETRY-24` are satisfied more precisely than the class-hierarchy approach they describe |
| `RETRY-30`'s trampoline is not built | Reference implements an explicit re-arm pump | An `await` loop is already iterative; N retries build no continuation chain. Same disposition class as 4c's `PIPE-29`/`PIPE-30` |
| `RETRY-25`'s fatal-error exclusion is not coded | Reference screens out `OutOfMemoryError`/`StackOverflowError` | The classifier is an allow-list, so unlisted throwables are already non-retryable; V8 has no catchable OOM class |
| `RETRY-23`'s "restore the interruption flag" is not implemented | Reference re-asserts the thread interrupt flag | No thread flag exists; `AbortSignal` is latched and observable by every later reader without re-assertion |
| `RETRY-45`'s scheduler-shutdown prohibition is not coded | Reference must not shut down a caller-supplied scheduler | No scheduler object exists to own or shut down; the intent survives as `clearTimeout` hygiene on both wait exits |
| `RETRY-29` not shipped | Reference offers an opt-in server-driven retry override header | `MAY`, no caller identified, and it raises a server-trust question that deserves its own decision. Deferred Items Log |
| `RECOV-33` not shipped in Phase 5 | Appendix C files it as a recovery-chain primitive | Client-identity header stamping has no retry coupling; it is configuration-driven, so it travels with `CFG-*` in Phase 7a (which now ships it — see 7a's Task 9) |
| `RETRY-41`'s negative-value clamp is a rejection instead | Reference clamps a negative configured retry count to the default and logs the clamp | Direct MUST-vs-MUST collision with `HTTP-35`, which rejects a negative max-retries at construction so it cannot be "silently reinterpreted as 'use default'". The port takes `HTTP-35`'s line on both surfaces; zero still means "no retries" and remains accepted. Full reasoning above |
| No configurable retryable-method set | `RECOV-34` lists retryable methods as a defensively-copied collection setting | `RETRY-6`/`HTTP-9` fix the idempotent set at `{GET, HEAD, OPTIONS, PUT, DELETE}` and make Phase 1's `http/method.ts` its single source. Nothing per-instance exists to copy, and no requirement obliges configurability |
| `RETRY-40`'s throwing-predicate clause is unreachable | Reference aborts the call when a user-supplied should-retry predicate throws | 5a exposes no user should-retry predicate; classification is `classify.ts`'s, parameterized only by the configured status set. The delay-override half of `RETRY-40` *is* implemented (log and fall back) |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Deferred from | Target | Reason |
|---|---|---|---|
| `RETRY-29` — opt-in server-driven retry classification override | Phase 5a brainstorm | Not scheduled | `MAY`. Widens the classifier's input surface to server-controlled values; wants an explicit trust decision, not a default |
| `RECOV-33` — client-identity header step | Phase 5a brainstorm | Phase 7a | Configuration-driven header composition (Append/Replace modes, blank-line suppression) with no retry coupling; belongs with `CFG-*` |
| Standard-resilience preset (`PIPE-24`, `PIPE-39`) and `PIPE-35`'s `seedFrom` | Phase 4c, re-confirmed here | Phase 5c | A preset needs all three pillar steps installed; only after auth ships do all three exist |
