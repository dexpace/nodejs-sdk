# Phase 5a — Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the retry engine in `@dexpace/core` — status/throwable classifier, backoff calculator,
pacing-header parser, validated settings, the attempt loop, per-attempt stamping, the idempotency-key recovery
step, and the two thin adapters binding the engine to the stage pipeline (4c) and the recovery chain (4b) —
satisfying `product-spec/09-retry-and-resilience.md` (`RETRY-1`–`RETRY-45`) and appendix C's
`RECOV-17`–`RECOV-34`, per `docs/superpowers/specs/2026-07-26-phase5a-retry-design.md`.

> **Amended 2026-07-28 (Phase 7a retrofit):** `RetryConfig.now`/`RetryStepOptions.now` are retyped to
> `clock: Clock`, consuming Phase 7a's `config/clock.ts` seam instead of an ad hoc `() => number`;
> `pacing.ts`'s private RFC 1123 parser is replaced by an import from Phase 7a's `config/http-date.ts`; and
> `classify.ts`'s private `RETRYABLE_STATUSES`/`isRetryableStatus` are replaced by a re-export from Phase 7a's
> `config/retryable.ts` (CFG-35). All three are single-sourcing corrections, not behavior changes — see
> `docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md`'s Scope section. This plan's execution now
> depends on Phase 7a's `config/` module existing first (see Prerequisite below); every other task is
> unaffected.
>
> **Amended 2026-07-28 (Phase 7b retrofit):** `engine.ts`'s `runWithRetry` (Task 8) gains two `SHOULD`-level
> structured log events via `getGlobalLogger()` — attempt-failed (with the next delay) and retries-exhausted
> (only when stopping after at least one retry with a failure outcome, cleanly derivable from
> `decision.outcome.kind` with no reshape). Narrow blast radius — only this file's own emission points. This
> plan's execution now additionally depends on Phase 7b's `observability/logger.ts` existing first for Task 8
> specifically. See `docs/superpowers/specs/2026-07-28-phase7b-observability-design.md`'s "Amendments to 5a
> and 5b" section.

**Architecture:** A new `packages/core/src/retry/` folder of eight independent files with no folder-level barrel,
plus one file in `src/recovery/` and one in a new `src/testing/`. The engine core is pure functions —
classification, backoff math, and pacing parsing take no I/O and no clock — driven by one attempt loop
(`runWithRetry`) parameterized by a dispatch callback. Two ~25-line adapters bind that loop: a `RETRY`-pillar
`StepDescriptor` that re-drives via `ctx.fork()`, and a wrapper around 4b's `dispatchWithRecovery`. **One retry
engine, not two stacks** — `RETRY-28` explicitly instructs a unifying port to make the total-timeout opt-in, which
`RetrySettings.totalTimeoutMs` does.

**Tech Stack:** TypeScript 5.8+, native `SuppressedError`, `fast-check` for the four invariant-bearing pure
functions, `bun test`. No new runtime dependencies — `SEAM-1` untouched. No `node:` imports — core's zero-`node:`
invariant, mechanically enforced since the scaffold, still holds (the RFC 1123 parser and the timer are both
platform-neutral).

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, 4a, 4b, and 4c are implemented exactly as their plans
specify, **plus Phase 7a's `Clock` seam** (added by the 2026-07-28 Phase 7a brainstorm's retrofit — see the
"`Clock` retrofit" note in `docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md`, Scope section).
This inverts this plan's original numeric ordering relative to Phase 7; 7a's `config/clock.ts` must exist before
Task 8 of this plan can be executed. Concretely:

- `packages/core/src/config/clock.js` — `Clock` (`now()`, `monotonic()`, `sleep(ms, signal?)`), `defaultClock`
- `packages/core/src/config/http-date.js` — `formatHttpDate(epochMs)`, `parseHttpDate(raw): number | null`
- `packages/core/src/config/retryable.js` — `RETRYABLE_STATUSES: ReadonlySet<number>`, `isRetryableStatus(code)`
- `packages/core/src/observability/logger.js` — `getGlobalLogger()` (Phase 7b; Task 8 only, per the 7b
  retrofit banner above). Its `atLevel(level).event(name).field(key, value).emit()` builder shape is 7b's;
  a `verbose` level that no backend consumes resolves to the no-op logger.
- `packages/core/src/http/method.js` — `type Method`, `isIdempotent(method)`
- `packages/core/src/http/request.js` — `Request` (`method`, `url`, `headers`, `body: Body | undefined`,
  `newBuilder()`), `RequestBuilder`
- `packages/core/src/http/headers.js` — `Headers` (`get(name): string | undefined`, case-insensitive;
  `newBuilder()`), `HeadersBuilder.set(name, value)`
- `packages/core/src/http/response.js` — `Response` (`status: Status`, `headers`, `body`, `close(): Promise<void>`,
  idempotent), `ResponseBuilder`
- `packages/core/src/http/status.js` — `Status.of(code)`, `status.code`
- `packages/core/src/http/protocol.js` — `Protocol.HTTP_1_1`
- `packages/core/src/http/errors.js` — `DexpaceError`
- `packages/core/src/io/errors.js` — `IoError`
- `packages/core/src/body/http-status-error.js` — `HttpStatusError`, `toHttpError(response)`
- `packages/core/src/seams/transport.js` — `Transport`, `CancellationError`
- `packages/core/src/recovery/outcome.js` — `Outcome<T>`, `success()`, `failure()`, `fold()`
- `packages/core/src/recovery/chains.js` — `RequestStep`
- `packages/core/src/recovery/orchestrator.js` — `dispatchWithRecovery(request, config)`, `DispatchConfig`
- `packages/core/src/pipeline/step.js` — `Step`, `StepContext`, `Next`, `StepDescriptor`
- `packages/core/src/pipeline/cursor.js` — `Cursor`, `CursorInit`
- `packages/core/src/invariant.js` — `invariant()`, `assertNever()`

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **Nothing from `src/retry/`, `src/recovery/`, or `src/testing/` is exported from
  `packages/core/src/index.ts`, and none of those folders gets an `index.ts`.**
  `docs/knowledge/module-organization.md:18` bans internal barrels outright. 4c explicitly left "whether SDK
  callers author custom steps against a public surface" to "whichever phase first ships a pillar step" — this
  phase decides: **not yet.** A caller cannot assemble a working pipeline until 5c ships the standard-resilience
  preset, and publishing `retryStep` alone would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes that
  5c may still reshape. The mechanical check is that `packages/core/etc/core.api.md` is **byte-identical** before
  and after this phase (Task 12), matching 3a/4a/4b/4c's gate.
- **No `node:` imports anywhere in `packages/core`.** The RFC 1123 parser is hand-written and the wait uses
  global `setTimeout`/`clearTimeout`; neither needs a Node builtin. `verify:seam-1` enforces this.
- **No new error leaf classes.** Settings validation is a *programmer* error (a caller passing
  `multiplier: 0.5`), so it uses `invariant()` per `docs/knowledge/error-handling.md`'s split — programmer errors
  crash loud, operational errors are typed. Terminal retry failures reuse `HttpStatusError` (3b) and whatever the
  transport threw. Do not add a `RetrySettingsError`.
- **`Response` instances are `Object.freeze`d.** Never assign a spy over `response.close`; it throws
  `TypeError: Cannot add property close, object is not extensible` under ESM strict mode. Observe close through
  the body `ReadableStream`'s `cancel()` hook — Task 6 ships the helper that does this, and every later task uses
  it.
- **`Date.parse`/`new Date(string)` are banned in `pacing.ts`.** `sdk-design/06`: JS date-string parsing is
  permissive and non-standardized across V8, JavaScriptCore, and SpiderMonkey, which is the opposite of
  `RETRY-16`'s totality mandate. The RFC 1123 parser (hand-written, explicit field range validation) is now
  Phase 7a's shared `config/http-date.ts`, imported here rather than duplicated — do not reintroduce a private
  copy in `pacing.ts`.
- **The pacing parser returns `null` for "no hint", never `0`.** `RETRY-16`: a malformed header must fall back to
  exponential backoff, not hammer the server immediately. `0` is reserved for a *validly-parsed* past instant
  (`RETRY-17`). This distinction is the single most important behavior in `pacing.ts`.
- **`RETRY-36`'s remap applies only to responses the engine discards.** Classification and both gates run first;
  a response that survives them is returned live and unread. Never remap a response the loop is about to return —
  `toHttpError()` drains the body and loses the headers irreversibly. Full reasoning in the design doc.
- **The total-timeout budget aborts on overshoot; it does not merely clamp.** `RETRY-27`/`RECOV-20` list three
  independent abort conditions, and "elapsed + next-delay would exceed the budget" is one of them. Clamping the
  delay alone would sleep out the remaining budget and then dispatch one more attempt with nothing left. Both
  the abort (`overshootsBudget`) and the clamp (`clampToBudget`) ship.
- **A negative retry count is REJECTED, never clamped to the default.** `RETRY-41` says clamp; `HTTP-35` (also
  MUST) says reject, precisely so a negative value cannot be "silently reinterpreted as 'use default'". The port
  takes `HTTP-35`'s line on both surfaces — `RequestOptionsBuilder` for the per-call option, `invariant()` in
  `retrySettings()` for `maxAttempts`. Do not "fix" `settings.test.ts` by making it expect a clamp.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`. `runWithRetry` takes
  `(request, dispatch, config)` — exactly three. Every helper below is decomposed to stay inside the depth and
  length caps; do not inline them back together.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`** (`erasableSyntaxOnly`). Unions and frozen constant objects only.
- **Explicit return types on every exported function.** Kebab-case filenames. Named exports only.
- **Tests must survive any order and parallel execution.** The engine holds zero module-level mutable state;
  attempt count and start instant are locals (`RETRY-42`/`RECOV-28`). Never introduce a module-scope counter.

---

## File Structure

```
packages/core/src/pipeline/
  step.ts              # MODIFIED — StepContext gains `signal` + `options` (Task 1, PIPE-17)
  cursor.ts            # MODIFIED — populates them from #signal/#options (Task 1)
packages/core/src/retry/
  classify.ts          # RETRY-1..8, 37    (Task 2)
  backoff.ts           # RETRY-9..12, 43   (Task 3)
  pacing.ts            # RETRY-15..21      (Task 4)
  settings.ts          # RETRY-12, 41, RECOV-34  (Task 5)
  attempt-stamp.ts     # RETRY-38, RECOV-31 (Task 7)
  engine.ts            # RETRY-22..44      (Task 8)
  retry-step.ts        # pillar adapter, PIPE-36, RETRY-44 (Task 9)
  retry-dispatch.ts    # recovery adapter, RECOV-17..20 (Task 10)
packages/core/src/recovery/
  idempotency-key.ts   # RECOV-32          (Task 11)
packages/core/src/testing/
  fake-transport.ts    # @internal double  (Task 6)
```

Every file has a colocated `*.test.ts`. Nine production files, each one responsibility, none over ~120 lines.

---

### Task 1: `StepContext.signal` + `StepContext.options` — the 4c amendment

4c's `Cursor` accepts and threads a `signal` and the caller's per-call `options`, but `StepContext` never
exposes either, so no step can observe cancellation or read per-call options. `RETRY-26`'s cancellable wait and
`RETRY-32`'s "no further attempts once cancelled" need the signal, and 5b/5c will too. The options exposure is
`PIPE-17`'s own MUST ("readable by any step") and the wire for `RETRY-41`'s per-call override
(`RequestOptions.maxRetries`, `HTTP-35`) and 5c's per-call auth descriptor. Additive, two fields.

**Files:**
- Modify: `packages/core/src/pipeline/step.ts`
- Modify: `packages/core/src/pipeline/cursor.ts`
- Test: `packages/core/src/pipeline/cursor.test.ts`

**Interfaces:**
- Consumes: `StepContext`, `Cursor`, `CursorInit` from Phase 4c; `RequestOptions` from `../http/request-options.js`
  (type-only, no cycle — `http/` imports nothing from `pipeline/`).
- Produces: `StepContext.signal?: AbortSignal | undefined` and `StepContext.options?: RequestOptions | undefined`,
  populated on every step invocation from the cursor's own fields. Task 9 reads both.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/pipeline/cursor.test.ts`:

```typescript
describe('StepContext.signal', () => {
  test('a step observes the signal the cursor was constructed with', async () => {
    const controller = new AbortController();
    const transport = new RecordingTransport();
    let observed: AbortSignal | undefined;
    const descriptor: StepDescriptor = {
      type: Symbol('observer'),
      stage: 'LOGGING',
      fn: async (request, ctx) => {
        observed = ctx.signal;
        return ctx.next();
      },
    };
    const cursor = new Cursor({
      steps: [descriptor],
      transport,
      request: aRequest(),
      context: aRequestContext(),
      signal: controller.signal,
    });

    await cursor.advance();

    expect(observed).toBe(controller.signal);
  });

  test('signal is undefined when the cursor was constructed without one', async () => {
    const transport = new RecordingTransport();
    let observed: AbortSignal | undefined = new AbortController().signal;
    const descriptor: StepDescriptor = {
      type: Symbol('observer'),
      stage: 'LOGGING',
      fn: async (request, ctx) => {
        observed = ctx.signal;
        return ctx.next();
      },
    };
    const cursor = new Cursor({steps: [descriptor], transport, request: aRequest(), context: aRequestContext()});

    await cursor.advance();

    expect(observed).toBeUndefined();
  });
});

describe('StepContext.options (PIPE-17)', () => {
  test('a step reads the per-call options the cursor was constructed with', async () => {
    const options = RequestOptions.newBuilder().maxRetries(0).build();
    const transport = new RecordingTransport();
    let observed: RequestOptions | undefined;
    const descriptor: StepDescriptor = {
      type: Symbol('observer'),
      stage: 'LOGGING',
      fn: async (request, ctx) => {
        observed = ctx.options;
        return ctx.next();
      },
    };
    const cursor = new Cursor({
      steps: [descriptor],
      transport,
      request: aRequest(),
      context: aRequestContext(),
      options,
    });

    await cursor.advance();

    expect(observed).toBe(options); // the same immutable instance, not a copy (PIPE-17)
  });

  test('options is undefined when the caller supplied none', async () => {
    const transport = new RecordingTransport();
    let observed: RequestOptions | undefined = RequestOptions.EMPTY;
    const descriptor: StepDescriptor = {
      type: Symbol('observer'),
      stage: 'LOGGING',
      fn: async (request, ctx) => {
        observed = ctx.options;
        return ctx.next();
      },
    };
    const cursor = new Cursor({steps: [descriptor], transport, request: aRequest(), context: aRequestContext()});

    await cursor.advance();

    expect(observed).toBeUndefined();
  });
});
```

`RecordingTransport`, `aRequest()`, and `aRequestContext()` are the helpers 4c's `cursor.test.ts` already
defines — reuse them, do not redefine. The options tests additionally import `RequestOptions` from
`../http/request-options.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/pipeline/cursor.test.ts -t 'StepContext'`
Expected: FAIL — `Property 'signal' does not exist on type 'StepContext'` (and likewise `options`) at
typecheck, or `observed` is `undefined` where the value was expected.

- [ ] **Step 3: Add the fields to `StepContext`**

In `packages/core/src/pipeline/step.ts`, add the fields to the existing interface (plus a type-only
`import type {RequestOptions} from '../http/request-options.js';`):

```typescript
export interface StepContext {
  readonly next: Next;
  readonly fork?: (() => Next) | undefined;
  readonly context: ExecutionContext;
  /**
   * The call's cancellation signal, threaded from the cursor (PIPE-13). Undefined when the caller supplied
   * none. A pillar step that waits between drives (retry's backoff, auth's token fetch) MUST honor it.
   */
  readonly signal?: AbortSignal | undefined;
  /**
   * The caller's per-call options, immutable and shared across every fork (PIPE-17: "readable by any
   * step"). Undefined when the caller supplied none. The retry step reads `maxRetries` (RETRY-41/HTTP-35);
   * the auth step reads the per-call auth descriptor (5c).
   */
  readonly options?: RequestOptions | undefined;
}
```

- [ ] **Step 4: Populate them in `Cursor`**

In `packages/core/src/pipeline/cursor.ts`, inside `#dispatch`, add `signal: this.#signal` and
`options: this.#options` to the object literal built for `ctx`, alongside the existing `next`, `fork`, and
`context` entries. No other change — `#signal` and `#options` are already fields.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/core/src/pipeline/cursor.test.ts`
Expected: PASS — the four new tests plus every pre-existing cursor test.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/step.ts packages/core/src/pipeline/cursor.ts packages/core/src/pipeline/cursor.test.ts
git commit -m "feat(core): expose the call's AbortSignal and per-call RequestOptions on StepContext"
```

---

### Task 2: `classify.ts` — the two eligibility axes

**Files:**
- Create: `packages/core/src/retry/classify.ts`
- Test: `packages/core/src/retry/classify.test.ts`

**Interfaces:**
- Consumes: `isIdempotent` from `../http/method.js`; `Request` from `../http/request.js`; `IoError` from
  `../io/errors.js`; `HttpStatusError` from `../body/http-status-error.js`; `RETRYABLE_STATUSES`,
  `isRetryableStatus` from Phase 7a's `../config/retryable.js` (re-exported unchanged — see Step 3's comment).
- Produces: `RETRYABLE_STATUSES: ReadonlySet<number>`; `isRetryableStatus(code: number): boolean`;
  `isRetryableFailure(error: unknown, statuses: ReadonlySet<number>): boolean`;
  `isResendable(request: Request): boolean`. Tasks 5, 8, and 10 consume all four.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/classify.test.ts
// Exercises: RETRY-1 (single-sourced status set, 501/505 excluded), RETRY-2 (iterative identity-tracking
// cause walk, cycle-safe), RETRY-3 (retryability derived from status, not a stored flag), RETRY-4 (transport
// failures always retryable), RETRY-5/6/7 (re-sendability), RETRY-8 (both axes required), RETRY-23/24
// (cancellation vs timeout), RETRY-25 (allow-list makes the fatal exclusion vacuous), RETRY-37 (configured set
// is authoritative -- widens AND narrows).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {HttpStatusError} from '../body/http-status-error.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';
import {CancellationError} from '../seams/transport.js';
import {RETRYABLE_STATUSES, isResendable, isRetryableFailure, isRetryableStatus} from './classify.js';

function aRequest(method: 'GET' | 'POST' | 'PUT', body?: ReturnType<typeof stringBody>): Request {
  const builder = Request.newBuilder().method(method).url('https://example.com');
  return body === undefined ? builder.build() : builder.body(body).build();
}

describe('isRetryableStatus', () => {
  test('408 and 429 are retryable', () => {
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('500-599 are retryable except 501 and 505', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(599)).toBe(true);
    expect(isRetryableStatus(501)).toBe(false);
    expect(isRetryableStatus(505)).toBe(false);
  });

  test('other statuses are not retryable', () => {
    for (const code of [200, 201, 301, 400, 401, 404, 409, 418, 499, 600]) {
      expect(isRetryableStatus(code)).toBe(false);
    }
  });

  test('the exported set and the predicate are the same source', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 700}), (code) => {
        expect(isRetryableStatus(code)).toBe(RETRYABLE_STATUSES.has(code));
      }),
    );
  });
});

describe('isRetryableFailure', () => {
  test('an IoError is retryable', () => {
    expect(isRetryableFailure(new IoError('connection refused'), RETRYABLE_STATUSES)).toBe(true);
  });

  test('an IoError buried in the cause chain is retryable (RETRY-2)', () => {
    const buried = new Error('wrapper', {cause: new Error('middle', {cause: new IoError('reset')})});
    expect(isRetryableFailure(buried, RETRYABLE_STATUSES)).toBe(true);
  });

  test('a cyclic cause chain terminates instead of hanging (RETRY-2)', () => {
    const first = new Error('first');
    const second = new Error('second', {cause: first});
    Object.defineProperty(first, 'cause', {value: second, configurable: true});

    expect(isRetryableFailure(first, RETRYABLE_STATUSES)).toBe(false);
  });

  test('an HttpStatusError derives retryability from its status (RETRY-3)', () => {
    expect(isRetryableFailure(new HttpStatusError(503, undefined, null), RETRYABLE_STATUSES)).toBe(true);
    expect(isRetryableFailure(new HttpStatusError(501, undefined, null), RETRYABLE_STATUSES)).toBe(false);
  });

  test('the configured set is authoritative and can widen (RETRY-37)', () => {
    const widened = new Set([...RETRYABLE_STATUSES, 404]);
    expect(isRetryableFailure(new HttpStatusError(404, undefined, null), widened)).toBe(true);
  });

  test('the configured set is authoritative and can narrow (RETRY-37)', () => {
    const narrowed = new Set([500]);
    expect(isRetryableFailure(new HttpStatusError(503, undefined, null), narrowed)).toBe(false);
  });

  test('a user abort is never retryable (RETRY-23)', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isRetryableFailure(controller.signal.reason, RETRYABLE_STATUSES)).toBe(false);
  });

  test('a CancellationError is never retryable, even nested (RETRY-23, XCUT-1)', () => {
    // Phase 2 declares `CancellationError extends DexpaceError`, NOT the IoError family, so the
    // allow-list already excludes it. Asserted rather than assumed: were it ever re-parented under
    // IoError, cancellation would silently become a retryable condition and XCUT-1 would break.
    const cancelled = new CancellationError('caller aborted');
    expect(isRetryableFailure(cancelled, RETRYABLE_STATUSES)).toBe(false);
    expect(isRetryableFailure(new Error('send failed', {cause: cancelled}), RETRYABLE_STATUSES)).toBe(false);
  });

  test('a timeout abort is retryable (RETRY-24)', () => {
    const reason = new DOMException('The operation timed out.', 'TimeoutError');
    expect(isRetryableFailure(reason, RETRYABLE_STATUSES)).toBe(true);
  });

  test('a timeout abort wrapped as a cause is retryable (RETRY-24)', () => {
    const reason = new DOMException('The operation timed out.', 'TimeoutError');
    expect(isRetryableFailure(new Error('send failed', {cause: reason}), RETRYABLE_STATUSES)).toBe(true);
  });

  test('an unlisted throwable is not retryable, no deny-list needed (RETRY-25)', () => {
    expect(isRetryableFailure(new RangeError('Maximum call stack size exceeded'), RETRYABLE_STATUSES)).toBe(false);
    expect(isRetryableFailure(new TypeError('bad'), RETRYABLE_STATUSES)).toBe(false);
    expect(isRetryableFailure('a bare string throw', RETRYABLE_STATUSES)).toBe(false);
    expect(isRetryableFailure(undefined, RETRYABLE_STATUSES)).toBe(false);
  });
});

describe('isResendable', () => {
  test('a body-less idempotent request is re-sendable (RETRY-5/6)', () => {
    expect(isResendable(aRequest('GET'))).toBe(true);
    expect(isResendable(aRequest('PUT'))).toBe(true);
  });

  test('a bare POST is NOT re-sendable even with nothing to resend (RETRY-7)', () => {
    expect(isResendable(aRequest('POST'))).toBe(false);
  });

  test('a POST with a replayable body is re-sendable (RETRY-5)', () => {
    expect(isResendable(aRequest('POST', stringBody('payload')))).toBe(true);
  });

  test('a request with a non-replayable body is NOT re-sendable (RETRY-5)', () => {
    const oneShot = streamBody(new ReadableStream<Uint8Array>({start: (c) => c.close()}), null, 0);
    const request = Request.newBuilder().method('POST').url('https://example.com').body(oneShot).build();
    expect(isResendable(request)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/classify.test.ts`
Expected: FAIL — `Cannot find module './classify.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/classify.ts
import {HttpStatusError} from '../body/http-status-error.js';
// Phase 7a retrofit: RETRY-1's status set and predicate previously lived here as a private
// `buildRetryableStatuses()`/`RETRYABLE_STATUSES`/`isRetryableStatus`. Phase 7a's CFG-35 promotes the exact
// same set to a public utility at `config/retryable.js` (for callers with no retry-engine dependency); this
// module now re-exports that single source instead of keeping a second definition. The doc comment below
// stays accurate -- "every consumer reads this one set" now includes 7a's own callers too.
export {RETRYABLE_STATUSES, isRetryableStatus} from '../config/retryable.js';
import {isIdempotent} from '../http/method.js';
import type {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';

/** True for the abort reason `AbortSignal.timeout()` produces, false for a caller abort (RETRY-23/24). */
function isTimeoutAbort(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'name' in value
    && (value as {readonly name: unknown}).name === 'TimeoutError';
}

function causeOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null && 'cause' in value
    ? (value as {readonly cause: unknown}).cause
    : undefined;
}

/**
 * Retryability as an ALLOW-list (RETRY-2): a throwable qualifies only if it, or something in its cause
 * chain, is an I/O error, a timeout, or a status the caller configured as retryable. The walk is iterative
 * and identity-tracking, so a cyclic `cause` chain terminates instead of spinning.
 *
 * The allow-list shape is why RETRY-25 needs no code: a stack-overflow `RangeError` is non-retryable
 * because it was never opted in, not because it was screened out. A caller's `AbortError` is likewise
 * non-retryable for free (RETRY-23), while a `TimeoutError` is explicitly listed (RETRY-24).
 *
 * @param statuses The CONFIGURED set, authoritative on its own -- it both widens and narrows relative to
 *   `RETRYABLE_STATUSES`, and the built-in classifier is not AND-ed in (RETRY-37).
 */
export function isRetryableFailure(error: unknown, statuses: ReadonlySet<number>): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof HttpStatusError) return statuses.has(current.status);
    if (current instanceof IoError) return true;
    if (isTimeoutAbort(current)) return true;
    current = causeOf(current);
  }
  return false;
}

/**
 * The second, orthogonal axis (RETRY-5/8): a body-less request is re-sendable iff its method is
 * idempotent; a body-bearing one iff its body is replayable. A bare non-idempotent POST is therefore not
 * re-sendable even though it has nothing to physically re-send -- the case RETRY-7 calls out.
 */
export function isResendable(request: Request): boolean {
  const {body} = request;
  return body === undefined ? isIdempotent(request.method) : body.replayable;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/classify.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/classify.ts packages/core/src/retry/classify.test.ts
git commit -m "feat(core): retry classification -- status set, cause walk, re-sendability"
```

---

### Task 3: `backoff.ts` — the delay calculator

**Files:**
- Create: `packages/core/src/retry/backoff.ts`
- Test: `packages/core/src/retry/backoff.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`.
- Produces: `interface BackoffSettings {initialDelayMs, multiplier, maxDelayMs, jitter, fixedDelayMs?}`;
  `computeDelay(attempt: number, settings: BackoffSettings, random: () => number): number`. Tasks 5 and 8 consume
  both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/backoff.test.ts
// Exercises: RETRY-9 (initialDelay * multiplier^(attempt-1), 1-indexed, capped), RETRY-10 (symmetric jitter
// bounds, midpoint, j=0 identity, negative floors to zero), RETRY-11 (attempt < 1 rejected, overflow
// saturates), RETRY-43 (fixed delay disables backoff AND jitter).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {computeDelay, type BackoffSettings} from './backoff.js';

const SETTINGS: BackoffSettings = {initialDelayMs: 200, multiplier: 2, maxDelayMs: 8000, jitter: 0};
const never = (): number => 0.5;

describe('exponential schedule', () => {
  test('attempt 1 is the initial delay, 1-indexed (RETRY-9)', () => {
    expect(computeDelay(1, SETTINGS, never)).toBe(200);
  });

  test('each attempt multiplies the previous (RETRY-9)', () => {
    expect(computeDelay(2, SETTINGS, never)).toBe(400);
    expect(computeDelay(3, SETTINGS, never)).toBe(800);
    expect(computeDelay(4, SETTINGS, never)).toBe(1600);
  });

  test('growth is clamped to maxDelayMs (RETRY-9)', () => {
    expect(computeDelay(20, SETTINGS, never)).toBe(8000);
  });

  test('an overflowing attempt saturates to the cap instead of throwing (RETRY-11)', () => {
    expect(computeDelay(5000, SETTINGS, never)).toBe(8000);
    expect(Number.isFinite(computeDelay(5000, SETTINGS, never))).toBe(true);
  });

  test('attempt < 1 is a programmer error (RETRY-11)', () => {
    expect(() => computeDelay(0, SETTINGS, never)).toThrow();
    expect(() => computeDelay(-1, SETTINGS, never)).toThrow();
  });
});

describe('symmetric jitter', () => {
  const jittered: BackoffSettings = {...SETTINGS, jitter: 0.2};

  test('jitter 0 returns the base delay unperturbed (RETRY-10)', () => {
    expect(computeDelay(3, SETTINGS, () => 0)).toBe(800);
    expect(computeDelay(3, SETTINGS, () => 1)).toBe(800);
  });

  test('the midpoint sample returns the base delay (RETRY-10)', () => {
    expect(computeDelay(3, jittered, () => 0.5)).toBeCloseTo(800, 6);
  });

  test('the sample spans exactly [d(1-j/2), d(1+j/2)] (RETRY-10)', () => {
    expect(computeDelay(3, jittered, () => 0)).toBeCloseTo(720, 6);
    expect(computeDelay(3, jittered, () => 1)).toBeCloseTo(880, 6);
  });

  test('a negative sample floors to zero (RETRY-10)', () => {
    const wide: BackoffSettings = {initialDelayMs: 10, multiplier: 1, maxDelayMs: 10, jitter: 1};
    expect(computeDelay(1, wide, () => -100)).toBe(0);
  });

  test('property: every sample lies inside the symmetric window (RETRY-10)', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 1, max: 12}),
        fc.double({min: 0, max: 1, noNaN: true}),
        fc.double({min: 0, max: 1, noNaN: true}),
        (attempt, jitter, sample) => {
          const settings: BackoffSettings = {...SETTINGS, jitter};
          const base = Math.min(200 * 2 ** (attempt - 1), 8000);
          const delay = computeDelay(attempt, settings, () => sample);
          expect(delay).toBeGreaterThanOrEqual(base * (1 - jitter / 2) - 1e-9);
          expect(delay).toBeLessThanOrEqual(base * (1 + jitter / 2) + 1e-9);
        },
      ),
    );
  });

  test('property: the unjittered delay never exceeds the cap and never decreases (RETRY-9)', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 200}), (attempt) => {
        const delay = computeDelay(attempt, SETTINGS, never);
        expect(delay).toBeLessThanOrEqual(SETTINGS.maxDelayMs);
        expect(delay).toBeGreaterThanOrEqual(computeDelay(Math.max(1, attempt - 1), SETTINGS, never));
      }),
    );
  });
});

describe('fixed delay (RETRY-43)', () => {
  test('a fixed delay disables both backoff growth and jitter', () => {
    const fixed: BackoffSettings = {...SETTINGS, jitter: 0.5, fixedDelayMs: 1234};
    expect(computeDelay(1, fixed, () => 0)).toBe(1234);
    expect(computeDelay(9, fixed, () => 1)).toBe(1234);
  });

  test('a fixed delay of zero is honored, not treated as absent', () => {
    expect(computeDelay(4, {...SETTINGS, fixedDelayMs: 0}, never)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/backoff.test.ts`
Expected: FAIL — `Cannot find module './backoff.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/backoff.ts
import {invariant} from '../invariant.js';

export interface BackoffSettings {
  readonly initialDelayMs: number;
  readonly multiplier: number;
  readonly maxDelayMs: number;
  /** Symmetric jitter fraction in [0,1]; 0 disables perturbation (RETRY-10). */
  readonly jitter: number;
  /** When set, forces a flat delay and makes the exponential path unreachable (RETRY-43). */
  readonly fixedDelayMs?: number | undefined;
}

/**
 * Draws uniformly from [delayMs*(1-jitter/2), delayMs*(1+jitter/2)], midpoint delayMs (RETRY-10).
 * A negative sample from a hostile random source floors to zero rather than producing a negative delay.
 */
function applyJitter(delayMs: number, jitter: number, random: () => number): number {
  if (jitter === 0) return delayMs;
  const width = delayMs * jitter;
  return Math.max(0, delayMs - width / 2 + random() * width);
}

/**
 * The single backoff calculator (RETRY-13): `initialDelay * multiplier^(attempt-1)`, clamped to the cap,
 * then jittered. `attempt` is 1-indexed, where 1 is the wait BEFORE the first retry (RETRY-9).
 *
 * Overflow-safe by construction (RETRY-11): a large attempt makes `**` return `Infinity`, which `Math.min`
 * absorbs into the cap. It saturates; it never throws.
 *
 * `random` is injected so jitter is assertable rather than statistical -- the same determinism seam CFG-15
 * wants for the clock.
 */
export function computeDelay(attempt: number, settings: BackoffSettings, random: () => number): number {
  invariant(attempt >= 1, `retry attempt must be 1-indexed and >= 1, got ${attempt}`);
  if (settings.fixedDelayMs !== undefined) return settings.fixedDelayMs;
  const growth = settings.initialDelayMs * settings.multiplier ** (attempt - 1);
  return applyJitter(Math.min(growth, settings.maxDelayMs), settings.jitter, random);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/backoff.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/backoff.ts packages/core/src/retry/backoff.test.ts
git commit -m "feat(core): overflow-safe exponential backoff with symmetric jitter"
```

---

### Task 4: `pacing.ts` — the server-hint parser

The largest spec surface per line in this phase. Read the Global Constraints on `Date.parse` and on
`null`-vs-`0` before starting. **Phase 7a retrofit:** this task now imports its RFC 1123 date parser from
`../config/http-date.js` (Phase 7a) rather than hand-rolling a private copy — see Step 3's comment for why.

**Files:**
- Create: `packages/core/src/retry/pacing.ts`
- Test: `packages/core/src/retry/pacing.test.ts`

**Interfaces:**
- Consumes: `Headers` from `../http/headers.js`; `parseHttpDate` from Phase 7a's `../config/http-date.js`.
- Produces: `parsePacingHint(headers: Headers, nowMs: number, random: () => number): number | null`. Task 8
  consumes it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/pacing.test.ts
// Exercises: RETRY-15 (all four recognized forms), RETRY-16 (total, malformed -> null not 0), RETRY-17
// (past instant -> 0), RETRY-18 (365-day ceiling), RETRY-19 (strict decimal grammar before any float
// parse), RETRY-21 (fixed precedence, first parseable wins), RECOV-25 (X-RateLimit-Reset positive jitter).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers} from '../http/headers.js';
import {parsePacingHint} from './pacing.js';

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const noJitter = (): number => 0;

function headersOf(entries: Record<string, string>): Headers {
  let builder = Headers.newBuilder();
  for (const [name, value] of Object.entries(entries)) builder = builder.add(name, value);
  return builder.build();
}

describe('Retry-After as delta-seconds (RETRY-15)', () => {
  test('an integer is honored', () => {
    expect(parsePacingHint(headersOf({'Retry-After': '30'}), NOW, noJitter)).toBe(30_000);
  });

  test('a fractional value is honored to sub-second resolution', () => {
    expect(parsePacingHint(headersOf({'Retry-After': '1.5'}), NOW, noJitter)).toBe(1500);
  });

  test('zero is honored as an immediate retry', () => {
    expect(parsePacingHint(headersOf({'Retry-After': '0'}), NOW, noJitter)).toBe(0);
  });
});

describe('Retry-After as an HTTP-date (RETRY-15)', () => {
  test('a full RFC 1123 date resolves to the delta', () => {
    const value = 'Thu, 01 Jan 2026 00:00:10 GMT';
    expect(parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter)).toBe(10_000);
  });

  test('a single-digit day is tolerated', () => {
    const value = 'Thu, 1 Jan 2026 00:00:10 GMT';
    expect(parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter)).toBe(10_000);
  });

  test('the informational weekday is ignored, even when wrong', () => {
    const value = 'Mon, 01 Jan 2026 00:00:10 GMT';
    expect(parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter)).toBe(10_000);
  });

  test('a date already in the past yields zero, not null (RETRY-17)', () => {
    const value = 'Thu, 01 Jan 2026 00:00:00 GMT';
    expect(parsePacingHint(headersOf({'Retry-After': value}), NOW + 5000, noJitter)).toBe(0);
  });

  test('an out-of-range field is rejected rather than rolled over (RETRY-16)', () => {
    expect(parsePacingHint(headersOf({'Retry-After': 'Thu, 32 Jan 2026 00:00:10 GMT'}), NOW, noJitter)).toBeNull();
    expect(parsePacingHint(headersOf({'Retry-After': 'Thu, 01 Jan 2026 24:00:10 GMT'}), NOW, noJitter)).toBeNull();
    expect(parsePacingHint(headersOf({'Retry-After': 'Thu, 01 Foo 2026 00:00:10 GMT'}), NOW, noJitter)).toBeNull();
  });
});

describe('strict decimal screening (RETRY-19)', () => {
  test('type-suffixed, hex-float, NaN, and Infinity forms are rejected', () => {
    for (const value of ['30d', '30f', '0x1p3', 'NaN', 'Infinity', '-Infinity', '1e3', '+30', ' 30 ']) {
      expect(parsePacingHint(headersOf({'Retry-After': value}), NOW, noJitter)).toBeNull();
    }
  });

  test('a negative delta maps to no hint, never a zero delay (RETRY-16)', () => {
    expect(parsePacingHint(headersOf({'Retry-After': '-5'}), NOW, noJitter)).toBeNull();
  });
});

describe('millisecond variants (RETRY-15)', () => {
  test('retry-after-ms is honored', () => {
    expect(parsePacingHint(headersOf({'retry-after-ms': '250'}), NOW, noJitter)).toBe(250);
  });

  test('x-ms-retry-after-ms is honored', () => {
    expect(parsePacingHint(headersOf({'x-ms-retry-after-ms': '250'}), NOW, noJitter)).toBe(250);
  });

  test('a malformed millisecond value falls through to no hint', () => {
    expect(parsePacingHint(headersOf({'retry-after-ms': '25.5'}), NOW, noJitter)).toBeNull();
  });
});

describe('X-RateLimit-Reset (RETRY-15, RECOV-25)', () => {
  test('an epoch-seconds reset resolves to the delta', () => {
    const reset = String(Math.floor(NOW / 1000) + 10);
    expect(parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, noJitter)).toBe(10_000);
  });

  test('positive jitter tops out at 120% of the delta (RECOV-25)', () => {
    const reset = String(Math.floor(NOW / 1000) + 10);
    expect(parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, () => 1)).toBeCloseTo(12_000, 6);
  });

  test('a past reset yields zero (RETRY-17)', () => {
    const reset = String(Math.floor(NOW / 1000) - 10);
    expect(parsePacingHint(headersOf({'X-RateLimit-Reset': reset}), NOW, () => 1)).toBe(0);
  });
});

describe('precedence (RETRY-21)', () => {
  test('numeric Retry-After beats every other form', () => {
    const headers = headersOf({
      'Retry-After': '30',
      'retry-after-ms': '1',
      'x-ms-retry-after-ms': '2',
      'X-RateLimit-Reset': String(Math.floor(NOW / 1000) + 99),
    });
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(30_000);
  });

  test('an unparseable Retry-After falls through to retry-after-ms, not to null', () => {
    const headers = headersOf({'Retry-After': 'garbage', 'retry-after-ms': '250'});
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(250);
  });

  test('retry-after-ms beats x-ms-retry-after-ms', () => {
    const headers = headersOf({'retry-after-ms': '250', 'x-ms-retry-after-ms': '999'});
    expect(parsePacingHint(headers, NOW, noJitter)).toBe(250);
  });
});

describe('bounds and totality', () => {
  test('a huge delta is clamped to the 365-day ceiling (RETRY-18)', () => {
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(parsePacingHint(headersOf({'Retry-After': '99999999999'}), NOW, noJitter)).toBe(yearMs);
  });

  test('no pacing header at all yields no hint', () => {
    expect(parsePacingHint(headersOf({}), NOW, noJitter)).toBeNull();
  });

  test('property: the parser never throws for any header value (RETRY-16)', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const headers = Headers.newBuilder().add('Retry-After', value.replaceAll(/[\r\n\0]/gu, '')).build();
        expect(() => parsePacingHint(headers, NOW, noJitter)).not.toThrow();
      }),
    );
  });

  test('property: the result is null or a finite non-negative number, never NaN (RETRY-16)', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        const headers = Headers.newBuilder().add('Retry-After', value.replaceAll(/[\r\n\0]/gu, '')).build();
        const hint = parsePacingHint(headers, NOW, noJitter);
        if (hint === null) return;
        expect(Number.isFinite(hint)).toBe(true);
        expect(hint).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/pacing.test.ts`
Expected: FAIL — `Cannot find module './pacing.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/pacing.ts
import type {Headers} from '../http/headers.js';
// Phase 7a retrofit: this module previously hand-rolled its own private RFC 1123 parser here (a HTTP_DATE
// regex, a MONTHS table, and a local `parseHttpDate` function, tolerant of an informational weekday and a
// single-digit day -- never `Date.parse`, since JS date-string parsing is permissive and non-standardized
// across engines, the opposite of RETRY-16's totality mandate). Phase 7a's `config/http-date.ts` is a
// superset (it adds the formatter this module never needed) built to the identical grammar, so that private
// copy is deleted and this line imports the shared one instead -- one RFC 1123 parser in the codebase, not two.
import {parseHttpDate} from '../config/http-date.js';

/** RETRY-18: every computed delta is clamped to this ceiling before use. */
const MAX_PACING_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * RETRY-19: the strict decimal grammar that screens a value BEFORE any float parse. Deliberately rejects
 * a leading sign, exponent notation, whitespace, and every type-suffixed or hex-float form -- `Number()`
 * would happily accept several of them and produce a wildly wrong instant.
 */
const DECIMAL_SECONDS = /^\d+(?:\.\d+)?$/u;
const DECIMAL_INTEGER = /^\d+$/u;

function clampPacing(deltaMs: number): number {
  return Math.min(Math.max(0, deltaMs), MAX_PACING_MS);
}

function parseDeltaSeconds(raw: string): number | null {
  if (!DECIMAL_SECONDS.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function parseIntegerValue(raw: string | undefined): number | null {
  if (raw === undefined || !DECIMAL_INTEGER.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRetryAfter(raw: string, nowMs: number): number | null {
  const seconds = parseDeltaSeconds(raw);
  if (seconds !== null) return clampPacing(seconds);
  const instant = parseHttpDate(raw);
  return instant === null ? null : clampPacing(instant - nowMs);
}

function parseRateLimitReset(headers: Headers, nowMs: number, random: () => number): number | null {
  const epochSeconds = parseIntegerValue(headers.get('X-RateLimit-Reset'));
  if (epochSeconds === null) return null;
  const delta = clampPacing(epochSeconds * 1000 - nowMs);
  // RECOV-25: positive jitter to [100%,120%] so clients released at one reset instant do not stampede.
  return delta === 0 ? 0 : clampPacing(delta * (1 + random() * 0.2));
}

/**
 * Resolves a server pacing hint from a response's headers, honoring the fixed precedence of RETRY-21:
 * `Retry-After` numeric, then `Retry-After` as an HTTP-date, then `retry-after-ms`, then
 * `x-ms-retry-after-ms`, then `X-RateLimit-Reset`. First parseable value wins.
 *
 * TOTAL by contract (RETRY-16): it never throws for any input. Malformed, negative, or out-of-range values
 * map to `null` -- "no hint" -- so the caller falls back to exponential backoff. They MUST NOT map to `0`,
 * which would hammer a server that just asked for room. `0` is reserved for a validly-parsed instant
 * already in the past (RETRY-17).
 *
 * @returns Milliseconds to wait, or `null` when no usable hint is present.
 */
export function parsePacingHint(headers: Headers, nowMs: number, random: () => number): number | null {
  const retryAfter = headers.get('Retry-After');
  if (retryAfter !== undefined) {
    const parsed = parseRetryAfter(retryAfter, nowMs);
    if (parsed !== null) return parsed;
  }
  const deltaMs = parseIntegerValue(headers.get('retry-after-ms'))
    ?? parseIntegerValue(headers.get('x-ms-retry-after-ms'));
  if (deltaMs !== null) return clampPacing(deltaMs);
  return parseRateLimitReset(headers, nowMs, random);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/pacing.test.ts`
Expected: PASS — 22 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/pacing.ts packages/core/src/retry/pacing.test.ts
git commit -m "feat(core): total Retry-After/X-RateLimit-Reset pacing parser"
```

---

### Task 5: `settings.ts` — validated policy

**Files:**
- Create: `packages/core/src/retry/settings.ts`
- Test: `packages/core/src/retry/settings.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `RETRYABLE_STATUSES` from `./classify.js`; `BackoffSettings` from
  `./backoff.js`.
- Produces: `interface RetrySettings extends BackoffSettings {maxAttempts, retryableStatuses, totalTimeoutMs?,
  attemptHeaderName?}`; `DEFAULT_RETRY_SETTINGS: RetrySettings`;
  `retrySettings(overrides?: Partial<RetrySettings>): RetrySettings`. Tasks 8, 9, and 10 consume all three.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/settings.test.ts
// Exercises: RETRY-12 (defaults), RETRY-14 (one budget, so nothing to reconcile), RETRY-27/28 (opt-in
// total timeout, 0 disables), RETRY-41 (negative retry count clamps to the default), RETRY-42 (immutable
// after construction), RECOV-34 (construction validation, defensive collection copies).
import {describe, expect, test} from 'bun:test';
import {RETRYABLE_STATUSES} from './classify.js';
import {DEFAULT_RETRY_SETTINGS, retrySettings} from './settings.js';

describe('defaults (RETRY-12)', () => {
  test('ship the spec defaults', () => {
    expect(DEFAULT_RETRY_SETTINGS.initialDelayMs).toBe(200);
    expect(DEFAULT_RETRY_SETTINGS.multiplier).toBe(2);
    expect(DEFAULT_RETRY_SETTINGS.maxDelayMs).toBe(8000);
    expect(DEFAULT_RETRY_SETTINGS.jitter).toBe(0.2);
    expect(DEFAULT_RETRY_SETTINGS.maxAttempts).toBe(3);
  });

  test('the total timeout is opt-in, undefined by default (RETRY-28)', () => {
    expect(DEFAULT_RETRY_SETTINGS.totalTimeoutMs).toBeUndefined();
  });

  test('the default retryable statuses are the single-sourced set', () => {
    expect([...DEFAULT_RETRY_SETTINGS.retryableStatuses].sort()).toEqual([...RETRYABLE_STATUSES].sort());
  });
});

describe('validation (RECOV-34)', () => {
  test('rejects a multiplier below 1.0', () => {
    expect(() => retrySettings({multiplier: 0.5})).toThrow();
  });

  test('rejects maxAttempts below 1', () => {
    expect(() => retrySettings({maxAttempts: 0})).toThrow();
    expect(() => retrySettings({maxAttempts: -3})).toThrow();
  });

  test('accepts maxAttempts of 1, which disables retries', () => {
    expect(retrySettings({maxAttempts: 1}).maxAttempts).toBe(1);
  });

  test('rejects a jitter outside [0,1]', () => {
    expect(() => retrySettings({jitter: -0.1})).toThrow();
    expect(() => retrySettings({jitter: 1.1})).toThrow();
  });

  test('rejects negative durations', () => {
    expect(() => retrySettings({initialDelayMs: -1})).toThrow();
    expect(() => retrySettings({maxDelayMs: -1})).toThrow();
    expect(() => retrySettings({totalTimeoutMs: -1})).toThrow();
    expect(() => retrySettings({fixedDelayMs: -1})).toThrow();
  });

  test('rejects non-finite durations', () => {
    expect(() => retrySettings({initialDelayMs: Number.NaN})).toThrow();
    expect(() => retrySettings({maxDelayMs: Number.POSITIVE_INFINITY})).toThrow();
  });

  test('a total timeout of zero is legal and means unbounded (RETRY-27)', () => {
    expect(retrySettings({totalTimeoutMs: 0}).totalTimeoutMs).toBe(0);
  });
});

describe('immutability (RETRY-42, RECOV-34)', () => {
  test('the status set is defensively copied, so later caller mutation cannot change policy', () => {
    const caller = new Set([500]);
    const settings = retrySettings({retryableStatuses: caller});
    caller.add(404);
    expect(settings.retryableStatuses.has(404)).toBe(false);
  });

  test('the returned settings object is frozen', () => {
    const settings = retrySettings();
    expect(Object.isFrozen(settings)).toBe(true);
  });

  test('DEFAULT_RETRY_SETTINGS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RETRY_SETTINGS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/settings.test.ts`
Expected: FAIL — `Cannot find module './settings.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/settings.ts
import {invariant} from '../invariant.js';
import type {BackoffSettings} from './backoff.js';
import {RETRYABLE_STATUSES} from './classify.js';

export interface RetrySettings extends BackoffSettings {
  /** Total wire sends including the initial one; 1 disables retries (RETRY-14, RECOV-34). */
  readonly maxAttempts: number;
  /** Authoritative on its own -- it both widens and narrows the built-in classifier (RETRY-37). */
  readonly retryableStatuses: ReadonlySet<number>;
  /**
   * OPT-IN total-timeout budget spanning attempts and inter-attempt delays (RETRY-27). Undefined by
   * default and `0` also disabling it -- RETRY-28 instructs a port that unifies the two reference retry
   * stacks to make this explicitly opt-in rather than always-on.
   */
  readonly totalTimeoutMs?: number | undefined;
  /** When set, each attempt is stamped with its 1-based ordinal under this header (RETRY-38). */
  readonly attemptHeaderName?: string | undefined;
}

export const DEFAULT_RETRY_SETTINGS: RetrySettings = Object.freeze({
  initialDelayMs: 200,
  multiplier: 2,
  maxDelayMs: 8000,
  jitter: 0.2,
  maxAttempts: 3,
  retryableStatuses: RETRYABLE_STATUSES,
});

function validateDuration(label: string, value: number | undefined): void {
  if (value === undefined) return;
  invariant(Number.isFinite(value) && value >= 0, `${label} must be a finite, non-negative duration, got ${value}`);
}

/**
 * Builds validated, frozen retry settings (RECOV-34). Invalid values are PROGRAMMER errors -- a caller
 * passing `multiplier: 0.5` has a bug, not an operational failure -- so they trip `invariant()` rather
 * than a typed error class.
 *
 * The status set is defensively copied at build time so later mutation of the caller's collection cannot
 * alter policy.
 */
export function retrySettings(overrides?: Partial<RetrySettings>): RetrySettings {
  const merged = {...DEFAULT_RETRY_SETTINGS, ...overrides};
  validateDuration('initialDelayMs', merged.initialDelayMs);
  validateDuration('maxDelayMs', merged.maxDelayMs);
  validateDuration('totalTimeoutMs', merged.totalTimeoutMs);
  validateDuration('fixedDelayMs', merged.fixedDelayMs);
  invariant(merged.multiplier >= 1, `retry multiplier must be >= 1.0, got ${merged.multiplier}`);
  invariant(
    Number.isFinite(merged.maxAttempts) && merged.maxAttempts >= 1,
    `retry maxAttempts must be >= 1 (1 disables retries), got ${merged.maxAttempts}`,
  );
  invariant(merged.jitter >= 0 && merged.jitter <= 1, `retry jitter must lie in [0,1], got ${merged.jitter}`);
  return Object.freeze({...merged, retryableStatuses: new Set(merged.retryableStatuses)});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/settings.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/settings.ts packages/core/src/retry/settings.test.ts
git commit -m "feat(core): validated, frozen retry settings with an opt-in total timeout"
```

---

### Task 6: `FakeTransport` — the shared test double

Closes the roadmap's twice-punted `FakeTransport` deferral. Tasks 8, 9, and 10 depend on it, and 5b/5c will
consume it unchanged.

**Files:**
- Create: `packages/core/src/testing/fake-transport.ts`
- Test: `packages/core/src/testing/fake-transport.test.ts`

**Interfaces:**
- Consumes: `Transport` from `../seams/transport.js`; `Request`, `RequestOptions`, `Response`, `Status`,
  `Protocol` from `../http/*`.
- Produces: `class FakeTransport implements Transport` with `constructor(script: readonly (Response | Error)[])`,
  `readonly calls: readonly FakeCall[]`, `get sendCount(): number`; `interface FakeCall {request, options,
  signal}`; `countingResponse(status: number, request?: Request): {response: Response; cancelCount: () => number}`.
  Tasks 8, 9, and 10 consume all of it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/testing/fake-transport.test.ts
// Exercises the double's own contract: scripted ordering, last-entry repetition, call recording, and the
// close-observation mechanism every later retry test depends on.
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {Status} from '../http/status.js';
import {FakeTransport, countingResponse} from './fake-transport.js';

const request = Request.newBuilder().url('https://example.com').build();

describe('FakeTransport', () => {
  test('serves scripted responses in order', async () => {
    const first = countingResponse(503).response;
    const second = countingResponse(200).response;
    const transport = new FakeTransport([first, second]);

    expect(await transport.send(request)).toBe(first);
    expect(await transport.send(request)).toBe(second);
  });

  test('repeats the last scripted entry once exhausted', async () => {
    const only = countingResponse(200).response;
    const transport = new FakeTransport([only]);

    await transport.send(request);
    expect(await transport.send(request)).toBe(only);
    expect(transport.sendCount).toBe(2);
  });

  test('a scripted Error is thrown, not returned', async () => {
    const boom = new Error('connection refused');
    const transport = new FakeTransport([boom]);

    await expect(transport.send(request)).rejects.toBe(boom);
  });

  test('records the request, options, and signal of every send', async () => {
    const controller = new AbortController();
    const transport = new FakeTransport([countingResponse(200).response]);

    await transport.send(request, undefined, controller.signal);

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.request).toBe(request);
    expect(transport.calls[0]?.signal).toBe(controller.signal);
  });

  test('an empty script is a programmer error', () => {
    expect(() => new FakeTransport([])).toThrow();
  });
});

describe('countingResponse', () => {
  test('reports the requested status', () => {
    expect(countingResponse(503).response.status).toEqual(Status.of(503));
  });

  test('cancelCount observes close without patching the frozen Response', async () => {
    const {response, cancelCount} = countingResponse(503);
    expect(cancelCount()).toBe(0);

    await response.close();

    expect(cancelCount()).toBe(1);
  });

  test('close is idempotent, so the body is cancelled at most once', async () => {
    const {response, cancelCount} = countingResponse(503);

    await response.close();
    await response.close();

    expect(cancelCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/testing/fake-transport.test.ts`
Expected: FAIL — `Cannot find module './fake-transport.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/testing/fake-transport.ts
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';

export interface FakeCall {
  readonly request: Request;
  readonly options: RequestOptions | undefined;
  readonly signal: AbortSignal | undefined;
}

/**
 * A scripted `Transport` for multi-attempt tests (`@internal`, never exported from the package barrel).
 *
 * Entries are served in order; once exhausted the LAST entry repeats, so a script of `[error, response]`
 * models "fails once, then succeeds forever" without counting attempts by hand. A `Response` entry is
 * returned; an `Error` entry is thrown.
 */
export class FakeTransport implements Transport {
  readonly #script: readonly (Response | Error)[];
  readonly #calls: FakeCall[] = [];

  constructor(script: readonly (Response | Error)[]) {
    invariant(script.length > 0, 'FakeTransport needs at least one scripted entry');
    this.#script = [...script];
  }

  get calls(): readonly FakeCall[] {
    return this.#calls;
  }

  get sendCount(): number {
    return this.#calls.length;
  }

  async send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    const index = Math.min(this.#calls.length, this.#script.length - 1);
    this.#calls.push({request, options, signal});
    const entry = this.#script[index];
    invariant(entry !== undefined, 'FakeTransport script index out of range');
    if (entry instanceof Error) throw entry;
    return entry;
  }

  async close(): Promise<void> {
    // Nothing to release -- the double owns no resources (SEAM-14's ownership rule).
  }
}

/**
 * Builds a `Response` whose close can be OBSERVED.
 *
 * `Response` instances are `Object.freeze`d, so assigning a spy over `response.close` throws
 * `TypeError: Cannot add property close, object is not extensible` under ESM strict mode. The only
 * sanctioned observation point is the body stream itself. Every retry, redirect, and auth test that
 * asserts a body was released uses this helper.
 *
 * `cancelCount()` counts RELEASE, by either of the two routes the engine can take, because the retire
 * path and the abandon path release the same body differently:
 *
 * - abandoned unread -- `Response.close()` cancels the stream, firing `cancel()`;
 * - retired -- `toHttpError()` DRAINS the body into its bounded buffer (HTTP-52), so the stream reaches
 *   EOF and the later `close()` finds nothing to cancel; `pull()` is the only hook that observes it.
 *
 * The stream MUST close (here, on the first `pull` after its single chunk is read). A `ReadableStream`
 * that enqueues and never closes leaves `toHttpError()`'s drain awaiting a chunk that never arrives, and
 * every engine test that discards a 503 hangs until the runner's timeout.
 */
export function countingResponse(
  status: number,
  request: Request = Request.newBuilder().url('https://example.com').build(),
): {response: Response; cancelCount: () => number} {
  let releases = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    pull(controller) {
      // Reached only once the single chunk has been read (default highWaterMark 1), i.e. a full drain.
      releases += 1;
      controller.close();
    },
    cancel() {
      releases += 1;
    },
  });
  const response = Response.newBuilder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .body(body)
    .build();
  return {response, cancelCount: () => releases};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/testing/fake-transport.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/fake-transport.ts packages/core/src/testing/fake-transport.test.ts
git commit -m "test(core): shared scripted FakeTransport with observable body close"
```

---

### Task 7: `attempt-stamp.ts` — the per-attempt request copy

**Files:**
- Create: `packages/core/src/retry/attempt-stamp.ts`
- Test: `packages/core/src/retry/attempt-stamp.test.ts`

**Interfaces:**
- Consumes: `Request` from `../http/request.js`.
- Produces: `stampAttempt(request: Request, attempt: number, headerName: string | undefined): Request`. Task 8
  consumes it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/attempt-stamp.test.ts
// Exercises: RETRY-38/RECOV-31 (1-based ordinal on a FRESH copy, never mutating the template, preserving
// the idempotency key and every other header, zero-allocation no-op when disabled).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import {stampAttempt} from './attempt-stamp.js';

function aRequest(): Request {
  return Request.newBuilder()
    .method('POST')
    .url('https://example.com')
    .headers(Headers.newBuilder().add('Idempotency-Key', 'abc-123').add('X-Trace', 't1').build())
    .build();
}

describe('stampAttempt', () => {
  test('returns the ORIGINAL instance when no header name is configured (RETRY-38)', () => {
    const request = aRequest();
    expect(stampAttempt(request, 2, undefined)).toBe(request);
  });

  test('writes the 1-based ordinal under the configured header', () => {
    const stamped = stampAttempt(aRequest(), 3, 'X-Attempt');
    expect(stamped.headers.get('X-Attempt')).toBe('3');
  });

  test('never mutates the captured template', () => {
    const request = aRequest();
    stampAttempt(request, 3, 'X-Attempt');
    expect(request.headers.get('X-Attempt')).toBeUndefined();
  });

  test('preserves the idempotency key and every other header', () => {
    const stamped = stampAttempt(aRequest(), 2, 'X-Attempt');
    expect(stamped.headers.get('Idempotency-Key')).toBe('abc-123');
    expect(stamped.headers.get('X-Trace')).toBe('t1');
  });

  test('preserves method, url, and body', () => {
    const request = aRequest();
    const stamped = stampAttempt(request, 2, 'X-Attempt');
    expect(stamped.method).toBe(request.method);
    expect(stamped.url.href).toBe(request.url.href);
    expect(stamped.body).toBe(request.body);
  });

  test('re-stamping replaces rather than appends', () => {
    const once = stampAttempt(aRequest(), 2, 'X-Attempt');
    const twice = stampAttempt(once, 3, 'X-Attempt');
    expect(twice.headers.get('X-Attempt')).toBe('3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/attempt-stamp.test.ts`
Expected: FAIL — `Cannot find module './attempt-stamp.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/attempt-stamp.ts
import type {Request} from '../http/request.js';

/**
 * Stamps the 1-based attempt ordinal onto a FRESH copy of the request (RETRY-38/RECOV-31).
 *
 * The captured template is never mutated -- `Request` is immutable and frozen, so "stamping" means
 * building a new value. `set()` replaces only the named header, so an idempotency key written upstream by
 * `recovery/idempotency-key.ts` (RECOV-32) and every other header survive untouched.
 *
 * Disabled by default: when `headerName` is undefined this returns the ORIGINAL instance and allocates
 * nothing, which is the zero-allocation no-op path RETRY-38 requires.
 */
export function stampAttempt(request: Request, attempt: number, headerName: string | undefined): Request {
  if (headerName === undefined) return request;
  return request
    .newBuilder()
    .headers(request.headers.newBuilder().set(headerName, String(attempt)).build())
    .build();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/attempt-stamp.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/attempt-stamp.ts packages/core/src/retry/attempt-stamp.test.ts
git commit -m "feat(core): per-attempt ordinal stamping on a fresh request copy"
```

---

### Task 8: `engine.ts` — the attempt loop

The core of the phase. Re-read the Global Constraint on `RETRY-36`'s discarding-only remap before starting — the
ordering in `decideRetry` is load-bearing, not stylistic.

**Files:**
- Create: `packages/core/src/retry/engine.ts`
- Test: `packages/core/src/retry/engine.test.ts`

**Interfaces:**
- Consumes: `toHttpError`, `HttpStatusError` from `../body/http-status-error.js`; `Outcome`, `success`, `failure`
  from `../recovery/outcome.js`; `Request`, `Response` from `../http/*`; `computeDelay` from `./backoff.js`;
  `isResendable`, `isRetryableFailure` from `./classify.js`; `parsePacingHint` from `./pacing.js`; `RetrySettings`
  from `./settings.js`; `stampAttempt` from `./attempt-stamp.js`; `Clock` (type-only) from Phase 7a's
  `../config/clock.js`.
- Produces: `type RetryDispatch = (request: Request, attempt: number) => Promise<Outcome<Response>>`;
  `interface RetryConfig {settings, signal?, clock, random, delayOverride?}`;
  `runWithRetry(request: Request, dispatch: RetryDispatch, config: RetryConfig): Promise<Outcome<Response>>`.
  Tasks 9 and 10 consume all three.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/engine.test.ts
// Exercises: RETRY-7/8 (both axes gate), RETRY-20 (a hint replaces the schedule, unjittered), RETRY-22
// (a pacing failure never masks the upstream failure), RETRY-26/31 (cancellable wait, zero delay inline),
// RETRY-27 (total-timeout budget with per-attempt shrinking), RETRY-32 (no attempts after cancellation),
// RETRY-34 (suppressed trail on failure, discarded on success, skip-self), RETRY-35 (body released before
// the wait), RETRY-36 (503,503,200 terminates on the 200; a surviving response is returned LIVE),
// RETRY-39/40 (delay precedence; a throwing override is non-fatal), RETRY-42/RECOV-28 (per-call state).
import {describe, expect, test} from 'bun:test';
import {HttpStatusError} from '../body/http-status-error.js';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {IoError} from '../io/errors.js';
import {failure, success, type Outcome} from '../recovery/outcome.js';
import {countingResponse} from '../testing/fake-transport.js';
import type {Clock} from '../config/clock.js';
import {retrySettings, type RetrySettings} from './settings.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';

const GET = Request.newBuilder().url('https://example.com').build();
const BARE_POST = Request.newBuilder().method('POST').url('https://example.com').build();

/** A fake Clock whose `now`/`monotonic` both advance only when a test advances `clockState.ms`. */
function fakeClock(clockState: {ms: number}): Clock {
  return {
    now: () => clockState.ms,
    monotonic: () => clockState.ms,
    sleep: () => Promise.resolve(),
  };
}

/** A config whose clock advances only when a test advances it, and whose jitter is pinned to the midpoint. */
function configOf(overrides?: Partial<RetrySettings>, clockState = {ms: 0}): RetryConfig {
  return {settings: retrySettings(overrides), clock: fakeClock(clockState), random: () => 0.5};
}

/** Serves outcomes in order; the last repeats. Records the requests it saw. */
function scriptedDispatch(script: readonly Outcome<Response>[]): RetryDispatch & {calls: Request[]} {
  const calls: Request[] = [];
  const dispatch = async (request: Request): Promise<Outcome<Response>> => {
    calls.push(request);
    return script[Math.min(calls.length - 1, script.length - 1)] ?? failure(new Error('empty script'));
  };
  return Object.assign(dispatch, {calls});
}

describe('eligibility (RETRY-7/8)', () => {
  test('a non-retryable failure is surfaced after exactly one attempt', async () => {
    const dispatch = scriptedDispatch([failure(new TypeError('bad'))]);
    const outcome = await runWithRetry(GET, dispatch, configOf());

    expect(dispatch.calls).toHaveLength(1);
    expect(outcome.kind).toBe('failure');
  });

  test('a bare POST is not retried even on a retryable failure (RETRY-7)', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(BARE_POST, dispatch, configOf());

    expect(dispatch.calls).toHaveLength(1);
  });

  test('a retryable failure on an idempotent request exhausts the budget', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(GET, dispatch, configOf({maxAttempts: 3, fixedDelayMs: 0}));

    expect(dispatch.calls).toHaveLength(3);
  });

  test('maxAttempts of 1 disables retries entirely', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(GET, dispatch, configOf({maxAttempts: 1}));

    expect(dispatch.calls).toHaveLength(1);
  });
});

describe('status-driven retry (RETRY-36)', () => {
  test('503, 503, 200 terminates on the 200', async () => {
    const first = countingResponse(503);
    const second = countingResponse(503);
    const third = countingResponse(200);
    const dispatch = scriptedDispatch([success(first.response), success(second.response), success(third.response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(dispatch.calls).toHaveLength(3);
    expect(outcome).toEqual(success(third.response));
  });

  test('each discarded response is released before the next attempt (RETRY-35)', async () => {
    const first = countingResponse(503);
    const second = countingResponse(200);
    const dispatch = scriptedDispatch([success(first.response), success(second.response)]);

    await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(first.cancelCount()).toBe(1);
    expect(second.cancelCount()).toBe(0);
  });

  test('a response that SURVIVES the gates is returned live and unread', async () => {
    const only = countingResponse(503);
    const dispatch = scriptedDispatch([success(only.response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({maxAttempts: 1}));

    expect(outcome).toEqual(success(only.response));
    expect(only.cancelCount()).toBe(0);
  });

  test('a non-retryable error status is returned as a live response, never remapped', async () => {
    const only = countingResponse(404);
    const dispatch = scriptedDispatch([success(only.response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(outcome).toEqual(success(only.response));
    expect(only.cancelCount()).toBe(0);
  });
});

describe('delay resolution (RETRY-39/40)', () => {
  test('a caller override wins over every other source', async () => {
    const clock = {ms: 0};
    const config = {...configOf({fixedDelayMs: 5000}, clock), delayOverride: () => 0};
    const dispatch = scriptedDispatch([failure(new IoError('reset')), success(countingResponse(200).response)]);

    await runWithRetry(GET, dispatch, config);

    expect(dispatch.calls).toHaveLength(2);
  });

  test('a throwing override is non-fatal and falls back to the schedule (RETRY-40)', async () => {
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 0}),
      delayOverride: () => {
        throw new Error('override exploded');
      },
    };
    const dispatch = scriptedDispatch([failure(new IoError('reset')), success(countingResponse(200).response)]);

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('success');
    expect(dispatch.calls).toHaveLength(2);
  });

  test('a malformed pacing header never masks the upstream failure (RETRY-22)', async () => {
    const response = countingResponse(503).response.newBuilder()
      .headers(Headers.newBuilder().add('Retry-After', 'garbage').build())
      .build();
    const dispatch = scriptedDispatch([success(response), success(countingResponse(200).response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(outcome.kind).toBe('success');
  });
});

describe('total-timeout budget (RETRY-27)', () => {
  test('an exhausted budget stops the loop', async () => {
    const clock = {ms: 0};
    const config = configOf({totalTimeoutMs: 50, fixedDelayMs: 0}, clock);
    const dispatch: RetryDispatch = async () => {
      clock.ms += 40;
      return failure(new IoError('reset'));
    };
    const calls: number[] = [];
    const counting: RetryDispatch = async (request, attempt) => {
      calls.push(attempt);
      return dispatch(request, attempt);
    };

    await runWithRetry(GET, counting, config);

    expect(calls).toEqual([1, 2]);
  });

  test('a delay that would overshoot the budget is suppressed, not merely clamped', async () => {
    const clock = {ms: 0};
    const config = configOf({totalTimeoutMs: 100, fixedDelayMs: 500, maxAttempts: 5}, clock);
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);

    await runWithRetry(GET, dispatch, config);

    // elapsed(0) + 500 > 100, so the loop surfaces after the first send rather than sleeping out the
    // remaining 100ms and dispatching a second attempt with no budget left (RETRY-27, RECOV-20).
    expect(dispatch.calls).toHaveLength(1);
  });

  test('a zero budget means unbounded, not immediately exhausted', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('reset'))]);
    await runWithRetry(GET, dispatch, configOf({totalTimeoutMs: 0, maxAttempts: 3, fixedDelayMs: 0}));

    expect(dispatch.calls).toHaveLength(3);
  });
});

describe('cancellation (RETRY-26/32)', () => {
  test('an already-aborted signal launches no attempt at all', async () => {
    const controller = new AbortController();
    controller.abort();
    const dispatch = scriptedDispatch([success(countingResponse(200).response)]);

    const outcome = await runWithRetry(GET, dispatch, {...configOf(), signal: controller.signal});

    expect(dispatch.calls).toHaveLength(0);
    expect(outcome.kind).toBe('failure');
  });

  test('aborting during the backoff wait stops the loop promptly', async () => {
    const controller = new AbortController();
    const config: RetryConfig = {
      ...configOf({fixedDelayMs: 60_000, maxAttempts: 5}),
      signal: controller.signal,
    };
    const dispatch: RetryDispatch = async () => {
      queueMicrotask(() => controller.abort());
      return failure(new IoError('reset'));
    };

    const outcome = await runWithRetry(GET, dispatch, config);

    expect(outcome.kind).toBe('failure');
  });
});

describe('suppressed trail (RETRY-34)', () => {
  test('prior attempt failures ride along as suppressed on the surfaced error', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('first')), failure(new IoError('second'))]);

    const outcome = await runWithRetry(GET, dispatch, configOf({maxAttempts: 2, fixedDelayMs: 0}));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    expect(outcome.error).toBeInstanceOf(SuppressedError);
  });

  test('the trail is discarded entirely on eventual success', async () => {
    const dispatch = scriptedDispatch([failure(new IoError('first')), success(countingResponse(200).response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({fixedDelayMs: 0}));

    expect(outcome.kind).toBe('success');
  });

  test('a reused instance never suppresses itself (RETRY-34 skip-self)', async () => {
    const reused = new IoError('same instance every time');
    const dispatch = scriptedDispatch([failure(reused)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({maxAttempts: 3, fixedDelayMs: 0}));

    expect(outcome).toEqual(failure(reused));
  });

  test('a single failed attempt surfaces its error unwrapped', async () => {
    const only = new TypeError('not retryable');
    const dispatch = scriptedDispatch([failure(only)]);

    expect(await runWithRetry(GET, dispatch, configOf())).toEqual(failure(only));
  });

  test('a discarded 503 becomes a buffered HttpStatusError in the trail (RECOV-16)', async () => {
    const dispatch = scriptedDispatch([success(countingResponse(503).response)]);

    const outcome = await runWithRetry(GET, dispatch, configOf({maxAttempts: 2, fixedDelayMs: 0}));

    expect(outcome.kind).toBe('failure');
    if (outcome.kind !== 'failure') return;
    const surfaced = outcome.error instanceof SuppressedError ? outcome.error.error : outcome.error;
    expect(surfaced).toBeInstanceOf(HttpStatusError);
  });
});

describe('per-call state (RETRY-42, RECOV-28)', () => {
  test('concurrent invocations do not clobber each other’s budget', async () => {
    const settings = retrySettings({maxAttempts: 3, fixedDelayMs: 0});
    const config: RetryConfig = {settings, clock: fakeClock({ms: 0}), random: () => 0.5};
    const left = scriptedDispatch([failure(new IoError('left'))]);
    const right = scriptedDispatch([failure(new IoError('right'))]);

    await Promise.all([runWithRetry(GET, left, config), runWithRetry(GET, right, config)]);

    expect(left.calls).toHaveLength(3);
    expect(right.calls).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/engine.test.ts`
Expected: FAIL — `Cannot find module './engine.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/engine.ts
import {HttpStatusError, toHttpError} from '../body/http-status-error.js';
import type {Clock} from '../config/clock.js';
// Phase 7b retrofit: getGlobalLogger() call sites below, narrow blast radius (only this file's own emission
// points; no other phase depends on them). See docs/superpowers/specs/2026-07-28-phase7b-observability-design.md's
// "Amendments to 5a and 5b" section.
import {getGlobalLogger} from '../observability/logger.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {failure, type Outcome} from '../recovery/outcome.js';
import {stampAttempt} from './attempt-stamp.js';
import {computeDelay} from './backoff.js';
import {isResendable, isRetryableFailure} from './classify.js';
import {parsePacingHint} from './pacing.js';
import type {RetrySettings} from './settings.js';

export type RetryDispatch = (request: Request, attempt: number) => Promise<Outcome<Response>>;

export interface RetryConfig {
  readonly settings: RetrySettings;
  readonly signal?: AbortSignal | undefined;
  /**
   * Phase 7a's `Clock` seam (CFG-15) -- replaces this field's original ad hoc `now: () => number` shape.
   * `clock.monotonic()` measures the total-timeout budget (CFG-16: elapsed-time math never uses wall-clock,
   * which MAY move backwards); `clock.now()` supplies `parsePacingHint`'s wall-clock instant, since a
   * `Retry-After` HTTP-date is an absolute instant, not an elapsed duration. Never `Date.now()` directly.
   */
  readonly clock: Clock;
  /** Injectable randomness -- jitter and the X-RateLimit-Reset spread both draw from it. */
  readonly random: () => number;
  /** Highest-precedence delay source (RETRY-39). A throw is non-fatal (RETRY-40). */
  readonly delayOverride?: ((attempt: number) => number | undefined) | undefined;
}

interface LoopState {
  readonly config: RetryConfig;
  readonly request: Request;
  readonly attempt: number;
  readonly startedAt: number;
}

type Decision =
  | {readonly kind: 'stop'; readonly outcome: Outcome<Response>}
  | {readonly kind: 'retry'; readonly error: unknown; readonly delayMs: number};

function elapsed(state: LoopState): number {
  return state.config.clock.monotonic() - state.startedAt;
}

/** A budget of `undefined` or `0` disables the deadline (RETRY-27, RECOV-20). */
function budgetExhausted(state: LoopState): boolean {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return false;
  return elapsed(state) >= budget;
}

function clampToBudget(delayMs: number, state: LoopState): number {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return delayMs;
  return Math.max(0, Math.min(delayMs, budget - elapsed(state)));
}

/**
 * RETRY-27/RECOV-20's third abort condition: a delay that would push cumulative elapsed time PAST the
 * budget is SUPPRESSED and the last failure surfaced, not merely shortened. The clamp above is the
 * requirement's separate belt-and-braces clause, not a substitute for this check -- without it the loop
 * would sleep out the remainder of the budget and then dispatch one more attempt with nothing left.
 */
function overshootsBudget(delayMs: number, state: LoopState): boolean {
  const budget = state.config.settings.totalTimeoutMs;
  if (budget === undefined || budget === 0) return false;
  return elapsed(state) + delayMs > budget;
}

/** RETRY-40: a throwing user override is logged and ignored, never fatal. */
function callerOverride(state: LoopState): number | undefined {
  const {delayOverride} = state.config;
  if (delayOverride === undefined) return undefined;
  try {
    return delayOverride(state.attempt);
  } catch (error) {
    // Phase 7b retrofit: RETRY-40 says "log and fall back". Swallowing silently would satisfy the
    // non-fatal half and drop the diagnostic half. XCUT-20 keeps the emission itself off the throw path.
    getGlobalLogger().atLevel('verbose')
      .event('retry.delayOverrideFailed')
      .field('attempt', state.attempt)
      .field('error', String(error))
      .emit();
    return undefined;
  }
}

/** RETRY-39: caller override -> server pacing hint -> fixed delay -> exponential backoff. */
function resolveDelay(hint: number | null, state: LoopState): number {
  const override = callerOverride(state);
  if (override !== undefined) return override;
  // RETRY-20: a hint REPLACES the schedule for this one decision and receives no additional jitter.
  if (hint !== null) return hint;
  return computeDelay(state.attempt, state.config.settings, state.config.random);
}

/**
 * Turns a response the loop is DISCARDING into the throwable its trail entry carries, buffering a bounded
 * copy of the body (RETRY-35/RECOV-16). Only ever called on a response that already failed the gates --
 * a surviving response is returned live and untouched.
 */
async function retire(response: Response): Promise<unknown> {
  // toHttpError returns null for a sub-400 status, reachable only when a caller widened the retryable set.
  return (await toHttpError(response)) ?? new HttpStatusError(response.status.code, undefined, null);
}

/**
 * Reads the pacing hint off the STILL-OPEN response, retires it, and schedules the wait.
 *
 * Ordering is load-bearing: `toHttpError` drains the body and drops the headers, so the hint must be read
 * first. The `finally` guarantees release even when the retry decision or the delay computation throws,
 * which is RETRY-35's second clause.
 *
 * The budget-overshoot abort lands HERE rather than in `decideRetry`'s gate block because the delay it
 * tests is not known until the pacing hint has been read off the live response. By that point the
 * response is already retired, so RETRY-27's "surface the last failure unchanged" surfaces the retired
 * `HttpStatusError` as a Failure -- never a live response, which is what the gates above return.
 */
async function retireAndSchedule(outcome: Outcome<Response>, state: LoopState): Promise<Decision> {
  const response = outcome.kind === 'success' ? outcome.value : undefined;
  try {
    const hint = response === undefined
      ? null
      : parsePacingHint(response.headers, state.config.clock.now(), state.config.random);
    const error = response === undefined ? outcome.error : await retire(response);
    const delayMs = resolveDelay(hint, state);
    if (overshootsBudget(delayMs, state)) return {kind: 'stop', outcome: failure(error)};
    return {kind: 'retry', error, delayMs: clampToBudget(delayMs, state)};
  } finally {
    await response?.close();
  }
}

function isRetryableOutcome(outcome: Outcome<Response>, settings: RetrySettings): boolean {
  return outcome.kind === 'success'
    ? settings.retryableStatuses.has(outcome.value.status.code)
    : isRetryableFailure(outcome.error, settings.retryableStatuses);
}

async function decideRetry(outcome: Outcome<Response>, state: LoopState): Promise<Decision> {
  const {settings} = state.config;
  // RETRY-8: BOTH axes must hold. Gates run BEFORE any remap so a surviving response stays live.
  if (!isRetryableOutcome(outcome, settings)) return {kind: 'stop', outcome};
  if (!isResendable(state.request)) return {kind: 'stop', outcome};
  if (state.attempt >= settings.maxAttempts) return {kind: 'stop', outcome};
  if (budgetExhausted(state)) return {kind: 'stop', outcome};
  return retireAndSchedule(outcome, state);
}

/**
 * RETRY-34: prior failures ride along as `suppressed` on the surfaced error; the surfaced instance itself
 * is skipped, so a reused throwable cannot suppress itself. On success the trail is discarded whole.
 *
 * `SuppressedError` is a binary pair, so N entries fold into a nested chain. Constructed by hand with the
 * argument order controlled explicitly -- native `using` disposal builds the pair the other way round,
 * making the older error primary.
 */
function withTrail(outcome: Outcome<Response>, trail: readonly unknown[]): Outcome<Response> {
  if (outcome.kind === 'success') return outcome;
  const prior = trail.filter((entry) => entry !== outcome.error);
  if (prior.length === 0) return outcome;
  const folded = prior.reduce((accumulated, entry) =>
    new SuppressedError(entry, accumulated, 'earlier retry attempt failed'));
  return failure(new SuppressedError(outcome.error, folded, 'retry attempts exhausted'));
}

/**
 * RETRY-26/31: a cancellable wait that yields the event loop rather than holding it. A non-positive delay
 * short-circuits the timer entirely and continues inline -- reachable after RETRY-17's past-instant hint
 * and after the budget clamp, where a `setTimeout(0)` would cost a macrotask turn for nothing.
 *
 * Resolves (never rejects) on abort; the loop's next iteration observes the signal and stops.
 *
 * The ALREADY-aborted check is load-bearing, not defensive: `AbortSignal` fires `abort` exactly once, at
 * abort time, so a listener added to a signal that aborted earlier (during `dispatch`, or during the
 * previous iteration's response retirement) is never invoked -- without this guard the timer would run to
 * completion and the loop would sleep the full backoff after cancellation, breaking RETRY-26/XCUT-3's
 * prompt-cancellation requirement.
 */
async function waitFor(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0 || signal?.aborted === true) return;
  await new Promise<void>((resolve) => {
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', settle);
      resolve();
    };
    const timer = setTimeout(settle, delayMs);
    signal?.addEventListener('abort', settle, {once: true});
  });
}

/**
 * The one retry loop (RETRY-13/14, RECOV-30). Both entry points -- the RETRY pillar step and the
 * recovery-chain wrapper -- call this, so the schedule, the classifier, and the budget cannot drift.
 *
 * Every piece of per-call state is a local (RETRY-42/RECOV-28): concurrent invocations sharing one
 * `RetryConfig` cannot clobber each other's attempt count or start instant.
 *
 * RETRY-30's trampoline requirement is satisfied by the language: an `await` loop is already iterative,
 * so N retries build no continuation chain and no stack growth.
 */
export async function runWithRetry(
  request: Request,
  dispatch: RetryDispatch,
  config: RetryConfig,
): Promise<Outcome<Response>> {
  const startedAt = config.clock.monotonic();
  const trail: unknown[] = [];

  for (let attempt = 1; ; attempt += 1) {
    // RETRY-32: once the caller has cancelled, launch no further attempt.
    if (config.signal?.aborted === true) return withTrail(failure(config.signal.reason), trail);

    const stamped = stampAttempt(request, attempt, config.settings.attemptHeaderName);
    const outcome = await dispatch(stamped, attempt);
    const decision = await decideRetry(outcome, {config, request, attempt, startedAt});
    if (decision.kind === 'stop') {
      // Phase 7b retrofit: a SHOULD-level retries-exhausted event. Cleanly derivable with no reshape --
      // `decision.outcome.kind` already discriminates success/failure (unlike `decision.kind`'s own
      // catch-all 'stop', which also covers a plain first-attempt success or a non-retryable failure).
      // `attempt > 1` is what makes this "exhausted after retrying," not "failed on the first try."
      if (decision.outcome.kind === 'failure' && attempt > 1) {
        getGlobalLogger().atLevel('verbose')
          .event('retry.exhausted')
          .field('attempts', attempt)
          .emit();
      }
      return withTrail(decision.outcome, trail);
    }

    // Phase 7b retrofit: a SHOULD-level attempt-failed event, fired each time the loop decides to retry.
    getGlobalLogger().atLevel('verbose')
      .event('retry.attemptFailed')
      .field('attempt', attempt)
      .field('nextDelayMs', decision.delayMs)
      .emit();

    trail.push(decision.error);
    await waitFor(decision.delayMs, config.signal);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/engine.test.ts`
Expected: PASS — 22 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `runWithRetry` is 3 params / 1 loop / well under 70 lines; every helper is 2 params or fewer.
If `max-depth` trips, the fix is another named helper — never an `eslint-disable`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/retry/engine.ts packages/core/src/retry/engine.test.ts
git commit -m "feat(core): the retry attempt loop with budget, pacing, and suppressed trail"
```

---

### Task 9: `retry-step.ts` — the pillar adapter

**Files:**
- Create: `packages/core/src/retry/retry-step.ts`
- Test: `packages/core/src/retry/retry-step.test.ts`

**Interfaces:**
- Consumes: `StepDescriptor`, `Next` from `../pipeline/step.js`; `Cursor` from `../pipeline/cursor.js`;
  `invariant` from `../invariant.js`; `fold`, `success`, `failure` from `../recovery/outcome.js`;
  `runWithRetry`, `RetryConfig`, `RetryDispatch` from `./engine.js`; `RetrySettings` from `./settings.js`;
  `RequestOptions` (type-only, via `ctx.options` from Task 1's amendment); `Clock`, `defaultClock` from Phase
  7a's `../config/clock.js`.
- Produces: `RETRY_STEP_TYPE: symbol`; `interface RetryStepOptions {settings, clock?, random?, delayOverride?}`;
  `retryStep(options?: RetryStepOptions): StepDescriptor`. Task 12 references it; 5c installs it in the preset.

**Per-call override (`RETRY-41`/`HTTP-35`).** The step resolves its effective attempt budget per call:
when `ctx.options?.maxRetries` is present, the engine runs with `maxAttempts = maxRetries + 1`
(`RetrySettings.maxAttempts` counts total sends, the option counts retries), else with the configured
settings unchanged. `maxRetries: 0` therefore yields exactly one send — HTTP-35's "disable retries for this
call". `RequestOptionsBuilder` already rejects negatives at construction, so no revalidation here.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/retry-step.test.ts
// Exercises: PIPE-36 (stage assignment is baked into the descriptor, not subclassable), RETRY-44 (a FRESH
// continuation per attempt via ctx.fork), RETRY-8 (both axes still gate inside the pipeline), RETRY-32
// (the step honors the call's signal, which only exists thanks to Task 1), RETRY-41/HTTP-35 (the per-call
// RequestOptions.maxRetries override, read via ctx.options from Task 1's amendment).
import {describe, expect, test} from 'bun:test';
import {createRequestContext, type ExecutionContext} from '../context/context.js';
import {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';
import {Cursor} from '../pipeline/cursor.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {RETRY_STEP_TYPE, retryStep} from './retry-step.js';

const GET = Request.newBuilder().url('https://example.com').build();

// Constructed inline rather than imported: 4c keeps `aRequestContext()` file-local to `cursor.test.ts`,
// and importing across `*.test.ts` files is not acceptable (see the note under this listing). This is
// exactly what 4c's own cursor tests do -- `createRequestContext(request)` from `../context/context.js`.
function aRequestContext(): ExecutionContext {
  return createRequestContext(GET);
}

function runThrough(descriptor: StepDescriptor, transport: FakeTransport, signal?: AbortSignal): Promise<unknown> {
  const cursor = new Cursor({
    steps: [descriptor],
    transport,
    request: GET,
    context: aRequestContext(),
    signal,
  });
  return cursor.advance();
}

describe('retryStep', () => {
  test('is pinned to the RETRY pillar stage (PIPE-36)', () => {
    const descriptor = retryStep();
    expect(descriptor.stage).toBe('RETRY');
    expect(descriptor.type).toBe(RETRY_STEP_TYPE);
  });

  test('re-drives the chain on a retryable status and returns the eventual success (RETRY-44)', async () => {
    const success = countingResponse(200).response;
    const transport = new FakeTransport([countingResponse(503).response, success]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});

    const response = await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(2);
    expect(response).toBe(success);
  });

  test('each attempt gets a fresh continuation, so no cursor is reused (RETRY-44)', async () => {
    const transport = new FakeTransport([
      new IoError('reset'),
      new IoError('reset'),
      countingResponse(200).response,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});

    await runThrough(descriptor, transport);

    expect(transport.sendCount).toBe(3);
  });

  test('rethrows the terminal failure rather than returning a failed outcome', async () => {
    const boom = new IoError('reset');
    const transport = new FakeTransport([boom]);
    const descriptor = retryStep({settings: {maxAttempts: 2, fixedDelayMs: 0}});

    await expect(runThrough(descriptor, transport)).rejects.toBeDefined();
  });

  test('honors the call signal from StepContext (RETRY-32)', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new FakeTransport([countingResponse(200).response]);
    const descriptor = retryStep();

    await expect(runThrough(descriptor, transport, controller.signal)).rejects.toBeDefined();
    expect(transport.sendCount).toBe(0);
  });

  test('per-call maxRetries: 0 disables retries for this call only (RETRY-41, HTTP-35)', async () => {
    const the503 = countingResponse(503);
    const transport = new FakeTransport([the503.response, countingResponse(200).response]);
    const descriptor = retryStep({settings: {maxAttempts: 3, fixedDelayMs: 0}});
    const options = RequestOptions.newBuilder().maxRetries(0).build();
    const cursor = new Cursor({steps: [descriptor], transport, request: GET, context: aRequestContext(), options});

    const response = await cursor.advance();

    expect(transport.sendCount).toBe(1); // the configured budget of 3 was overridden per call
    expect((response as {status: {code: number}}).status.code).toBe(503);
  });

  test('per-call maxRetries widens the configured budget too (RETRY-41 is present-override-wins)', async () => {
    const transport = new FakeTransport([
      countingResponse(503).response,
      countingResponse(503).response,
      countingResponse(200).response,
    ]);
    const descriptor = retryStep({settings: {maxAttempts: 1, fixedDelayMs: 0}});
    const options = RequestOptions.newBuilder().maxRetries(2).build();
    const cursor = new Cursor({steps: [descriptor], transport, request: GET, context: aRequestContext(), options});

    await cursor.advance();

    expect(transport.sendCount).toBe(3); // 2 retries + the initial send
  });
});
```

The two override tests additionally import `RequestOptions` from `../http/request-options.js`.

`aRequestContext()` is defined inline in the listing above, deliberately: 4c keeps its own copy file-local
to `cursor.test.ts`. Do **not** import it from another `*.test.ts`, and do **not** create a shared
`cursor.test-helpers.ts` for it. If 4c's `createRequestContext` signature differs from the one used above,
match 4c's actual call site rather than reshaping the factory.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/retry-step.test.ts`
Expected: FAIL — `Cannot find module './retry-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/retry-step.ts
import {invariant} from '../invariant.js';
import {defaultClock, type Clock} from '../config/clock.js';
import type {Next, StepContext, StepDescriptor} from '../pipeline/step.js';
import {failure, fold, success} from '../recovery/outcome.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';
import {retrySettings, type RetrySettings} from './settings.js';

/** Stable identity for pillar-slot occupancy and anchor matching (PIPE-6/PIPE-18). */
export const RETRY_STEP_TYPE: unique symbol = Symbol('dexpace.retry');

export interface RetryStepOptions {
  readonly settings?: Partial<RetrySettings> | undefined;
  readonly clock?: Clock | undefined;
  readonly random?: (() => number) | undefined;
  readonly delayOverride?: ((attempt: number) => number | undefined) | undefined;
}

/** Each attempt drives a FRESH one-shot continuation -- RETRY-44's per-attempt state, PIPE-15's fork. */
function attemptVia(fork: () => Next): RetryDispatch {
  return async (request) => {
    try {
      return success(await fork()(request));
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * RETRY-41/HTTP-35: the per-call `RequestOptions.maxRetries` override wins over the configured budget when
 * present. The option counts retries; `maxAttempts` counts total sends, hence the `+ 1`. Non-negativity is
 * enforced by RequestOptionsBuilder at construction.
 *
 * The derived object is frozen: a spread of a frozen source is NOT itself frozen, and RETRY-42 requires
 * every policy component to be immutable after construction, not merely typed `readonly`.
 */
function effectiveSettings(base: RetrySettings, perCallMaxRetries: number | undefined): RetrySettings {
  if (perCallMaxRetries === undefined) return base;
  return Object.freeze({...base, maxAttempts: perCallMaxRetries + 1});
}

function configFrom(options: RetryStepOptions, ctx: Pick<StepContext, 'signal' | 'options'>): RetryConfig {
  return {
    settings: effectiveSettings(retrySettings(options.settings), ctx.options?.maxRetries),
    signal: ctx.signal,
    clock: options.clock ?? defaultClock,
    random: options.random ?? (() => Math.random()),
    delayOverride: options.delayOverride,
  };
}

/**
 * The RETRY pillar step.
 *
 * `stage: 'RETRY'` is baked into the descriptor this factory returns, which is how PIPE-36 ("a shipped
 * pillar family must not be relocatable out of its pillar") is satisfied structurally: steps are functions
 * carrying a descriptor, not classes with a subclassable stage assignment.
 *
 * `ctx.fork` is asserted rather than checked -- RETRY is in `PILLAR_STAGES`, so its absence means the
 * descriptor was installed somewhere it cannot be, which is a programmer error.
 */
export function retryStep(options: RetryStepOptions = {}): StepDescriptor {
  return {
    type: RETRY_STEP_TYPE,
    stage: 'RETRY',
    fn: async (request, ctx) => {
      const {fork} = ctx;
      invariant(fork !== undefined, 'retryStep must occupy the RETRY pillar stage');
      const outcome = await runWithRetry(request, attemptVia(fork), configFrom(options, ctx));
      return fold(
        outcome,
        (response) => response,
        (error) => {
          throw error;
        },
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/retry-step.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/retry-step.ts packages/core/src/retry/retry-step.test.ts
git commit -m "feat(core): RETRY pillar step re-driving the chain via ctx.fork"
```

---

### Task 10: `retry-dispatch.ts` — the recovery-chain adapter

**Files:**
- Create: `packages/core/src/retry/retry-dispatch.ts`
- Test: `packages/core/src/retry/retry-dispatch.test.ts`

**Interfaces:**
- Consumes: `dispatchWithRecovery`, `DispatchConfig` from `../recovery/orchestrator.js`; `fold`, `success`,
  `failure` from `../recovery/outcome.js`; `runWithRetry`, `RetryConfig` from `./engine.js`.
- Produces: `interface RetryDispatchConfig extends DispatchConfig {retry: RetryConfig}`;
  `dispatchWithRetry(request: Request, config: RetryDispatchConfig): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/retry/retry-dispatch.test.ts
// Exercises: RECOV-17..20 (the recovery stack's retry lands here), RETRY-44 (each attempt re-runs the WHOLE
// recovery chain -- request chain, transport, response chain), RETRY-13/14 (both entry points share one
// engine, so the schedule cannot drift).
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {IoError} from '../io/errors.js';
import type {Clock} from '../config/clock.js';
import {RequestRecoveryChain, ResponseRecoveryChain} from '../recovery/chains.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {retrySettings} from './settings.js';
import {dispatchWithRetry, type RetryDispatchConfig} from './retry-dispatch.js';

const GET = Request.newBuilder().url('https://example.com').build();

const zeroClock: Clock = {now: () => 0, monotonic: () => 0, sleep: () => Promise.resolve()};

function configOf(transport: FakeTransport, requestSteps = new RequestRecoveryChain([])): RetryDispatchConfig {
  return {
    transport,
    requestChain: requestSteps,
    responseChain: new ResponseRecoveryChain([], []),
    retry: {
      settings: retrySettings({maxAttempts: 3, fixedDelayMs: 0}),
      clock: zeroClock,
      random: () => 0.5,
    },
  };
}

describe('dispatchWithRetry', () => {
  test('retries a transport failure and returns the eventual success', async () => {
    const transport = new FakeTransport([new IoError('reset'), countingResponse(200).response]);

    const response = await dispatchWithRetry(GET, configOf(transport));

    expect(response.status.code).toBe(200);
    expect(transport.sendCount).toBe(2);
  });

  test('re-runs the request recovery chain on every attempt (RETRY-44)', async () => {
    let applications = 0;
    const chain = new RequestRecoveryChain([
      async (request) => {
        applications += 1;
        return request;
      },
    ]);
    const transport = new FakeTransport([new IoError('reset'), countingResponse(200).response]);

    await dispatchWithRetry(GET, configOf(transport, chain));

    expect(applications).toBe(2);
  });

  test('rethrows the terminal failure unchanged in shape', async () => {
    const transport = new FakeTransport([new IoError('reset')]);

    await expect(dispatchWithRetry(GET, configOf(transport))).rejects.toBeDefined();
    expect(transport.sendCount).toBe(3);
  });

  test('a bare POST is dispatched exactly once (RETRY-7 holds on this entry point too)', async () => {
    const post = Request.newBuilder().method('POST').url('https://example.com').build();
    const transport = new FakeTransport([new IoError('reset')]);

    await expect(dispatchWithRetry(post, configOf(transport))).rejects.toBeDefined();
    expect(transport.sendCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/retry/retry-dispatch.test.ts`
Expected: FAIL — `Cannot find module './retry-dispatch.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/retry/retry-dispatch.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {DispatchConfig} from '../recovery/orchestrator.js';
import {dispatchWithRecovery} from '../recovery/orchestrator.js';
import {failure, fold, success} from '../recovery/outcome.js';
import {runWithRetry, type RetryConfig, type RetryDispatch} from './engine.js';

export interface RetryDispatchConfig extends DispatchConfig {
  readonly retry: RetryConfig;
}

function attemptVia(config: RetryDispatchConfig): RetryDispatch {
  return async (request) => {
    try {
      return success(await dispatchWithRecovery(request, config));
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * The recovery-chain entry point for retry (RECOV-17..RECOV-20).
 *
 * NOT a `RecoveryStep` -- a recovery step receives an outcome and has no way to re-dispatch. This wraps
 * 4b's orchestrator instead, mirroring its `(request, config)` shape, so each attempt re-runs the ENTIRE
 * recovery chain: request chain, transport, response chain. That is the recovery-side mirror of what
 * `ctx.fork()` does for the pillar step (RETRY-44).
 *
 * Shares `runWithRetry` with the pillar adapter, which is what makes RETRY-13/14/RECOV-30's "the two
 * stacks must not drift" structural rather than a discipline.
 */
export async function dispatchWithRetry(request: Request, config: RetryDispatchConfig): Promise<Response> {
  const outcome = await runWithRetry(request, attemptVia(config), config.retry);
  return fold(
    outcome,
    (response) => response,
    (error) => {
      throw error;
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/retry/retry-dispatch.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry/retry-dispatch.ts packages/core/src/retry/retry-dispatch.test.ts
git commit -m "feat(core): recovery-chain retry entry point sharing the one engine"
```

---

### Task 11: `idempotency-key.ts` — `RECOV-32`

**Files:**
- Create: `packages/core/src/recovery/idempotency-key.ts`
- Test: `packages/core/src/recovery/idempotency-key.test.ts`

**Interfaces:**
- Consumes: `Method` from `../http/method.js`; `Request` from `../http/request.js`; `RequestStep` from
  `../recovery/chains.js`.
- Produces: `interface IdempotencyKeyOptions {generate, headerName?, methods?, respectExisting?}`;
  `idempotencyKeyStep(options: IdempotencyKeyOptions): RequestStep`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/idempotency-key.test.ts
// Exercises: RECOV-32 (method gating, respect-existing default, strategy invoked at most once per
// applicable request, other methods untouched, defensive method-set copy).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import {idempotencyKeyStep} from './idempotency-key.js';

function aRequest(method: 'GET' | 'POST' | 'PUT' | 'PATCH', existing?: string): Request {
  const builder = Request.newBuilder().method(method).url('https://example.com');
  if (existing === undefined) return builder.build();
  return builder.headers(Headers.newBuilder().add('Idempotency-Key', existing).build()).build();
}

describe('idempotencyKeyStep', () => {
  test('stamps the default header on POST, PUT, and PATCH', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      const stamped = await step(aRequest(method));
      expect(stamped.headers.get('Idempotency-Key')).toBe('generated');
    }
  });

  test('passes other methods through untouched', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    const request = aRequest('GET');
    expect(await step(request)).toBe(request);
  });

  test('respects an existing header by default and does NOT invoke the strategy', async () => {
    let invocations = 0;
    const step = idempotencyKeyStep({
      generate: () => {
        invocations += 1;
        return 'generated';
      },
    });
    const request = aRequest('POST', 'caller-supplied');

    const result = await step(request);

    expect(result).toBe(request);
    expect(invocations).toBe(0);
  });

  test('overwrites an existing header when respectExisting is false', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated', respectExisting: false});
    const stamped = await step(aRequest('POST', 'caller-supplied'));
    expect(stamped.headers.get('Idempotency-Key')).toBe('generated');
  });

  test('invokes the strategy at most once per applicable request', async () => {
    let invocations = 0;
    const step = idempotencyKeyStep({
      generate: () => {
        invocations += 1;
        return `key-${invocations}`;
      },
    });

    await step(aRequest('POST'));

    expect(invocations).toBe(1);
  });

  test('honors a configured header name and method set', async () => {
    const step = idempotencyKeyStep({
      generate: () => 'generated',
      headerName: 'X-Request-Id',
      methods: new Set(['GET']),
    });
    expect((await step(aRequest('GET'))).headers.get('X-Request-Id')).toBe('generated');
    const post = aRequest('POST');
    expect(await step(post)).toBe(post);
  });

  test('defensively copies the method set', async () => {
    const methods = new Set<'GET' | 'POST'>(['GET']);
    const step = idempotencyKeyStep({generate: () => 'generated', methods});
    methods.add('POST');

    const post = aRequest('POST');

    expect(await step(post)).toBe(post);
  });

  test('never mutates the request it was given', async () => {
    const step = idempotencyKeyStep({generate: () => 'generated'});
    const request = aRequest('POST');

    await step(request);

    expect(request.headers.get('Idempotency-Key')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/recovery/idempotency-key.test.ts`
Expected: FAIL — `Cannot find module './idempotency-key.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/recovery/idempotency-key.ts
import type {Method} from '../http/method.js';
import type {Request} from '../http/request.js';
import type {RequestStep} from './chains.js';

const DEFAULT_HEADER = 'Idempotency-Key';
const DEFAULT_METHODS: readonly Method[] = ['POST', 'PUT', 'PATCH'];

export interface IdempotencyKeyOptions {
  /** The key strategy. Invoked at most once per applicable request (RECOV-32). */
  readonly generate: () => string;
  readonly headerName?: string | undefined;
  /** Defaults to the non-idempotent write methods; defensively copied at construction. */
  readonly methods?: ReadonlySet<Method> | undefined;
  /** When true (the default) a request already carrying the header is left entirely alone. */
  readonly respectExisting?: boolean | undefined;
}

/**
 * A `RequestStep` that stamps an idempotency key on write requests (RECOV-32).
 *
 * Runs ONCE per call, upstream of retry -- not per attempt. `retry/attempt-stamp.ts` is its sibling: that
 * one writes the attempt ordinal on each per-attempt copy and preserves whatever this wrote, so the server
 * sees one stable key across every retry of the same logical request.
 */
export function idempotencyKeyStep(options: IdempotencyKeyOptions): RequestStep {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const methods = new Set<Method>(options.methods ?? DEFAULT_METHODS);
  const respectExisting = options.respectExisting ?? true;

  return async (request: Request): Promise<Request> => {
    if (!methods.has(request.method)) return request;
    if (respectExisting && request.headers.get(headerName) !== undefined) return request;
    return request
      .newBuilder()
      .headers(request.headers.newBuilder().set(headerName, options.generate()).build())
      .build();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/recovery/idempotency-key.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/idempotency-key.ts packages/core/src/recovery/idempotency-key.test.ts
git commit -m "feat(core): idempotency-key request recovery step"
```

---

### Task 12: Gates, the unchanged API report, and the checklist

**Files:**
- Verify unchanged: `packages/core/etc/core.api.md`
- Verify unchanged: `packages/core/src/index.ts`
- Create: `docs/superpowers/plans/2026-07-26-phase5a-retry-checklist.md`

**Interfaces:**
- Consumes: every symbol from Tasks 1–11.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Confirm nothing leaked into the public barrel**

Run: `git diff --exit-code packages/core/etc/core.api.md packages/core/src/index.ts`
Expected: no output, exit 0. `src/retry/`, `src/testing/`, and `src/recovery/idempotency-key.ts` are all
internal this phase — 4c left the "do we publish a step-authoring surface" decision to the first phase shipping
a pillar step, and this plan's Global Constraints answer it: not until 5c ships the preset.

If the diff is non-empty, something was added to `packages/core/src/index.ts`. Remove the export; do not
regenerate the report to match.

- [ ] **Step 2: Confirm no `node:` import crept in**

Run: `bun run verify:seam-1`
Expected: PASS.

- [ ] **Step 3: Run the full gate sequence**

Run:

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS. `test:node` matters here specifically — `SuppressedError`, `DOMException`,
`ReadableStream`, and `AbortSignal.timeout()` must all behave identically under Node and Bun, and the
classifier's `TimeoutError`-name check is the one place a runtime difference would bite silently.

- [ ] **Step 4: Write the requirement checklist**

Create `docs/superpowers/plans/2026-07-26-phase5a-retry-checklist.md` in the same format as
`2026-07-24-phase3a-io-contracts-checklist.md` — `| ID | Level | Requirement gist | Status | Where |` tables,
legend ✅ shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **`§9.1` The two independent axes** — `RETRY-1`–`RETRY-8`, all ✅, Task 2.
2. **`§9.2` Backoff and pacing** — `RETRY-9`–`RETRY-12` ✅ Task 3; `RETRY-15`–`RETRY-22` ✅ Tasks 4 and 8.
3. **`§9.3` Cancellation, timeout, and the wait** — `RETRY-23`/`RETRY-24` ✅ Task 2 (abort-reason name);
   `RETRY-25` N/A (allow-list classifier, no deny-list needed); `RETRY-26` ✅ Task 8.
4. **`§9.4` Budgets and reconciliation** — `RETRY-27` ✅ Task 8; `RETRY-28` ✅ Task 5 (opt-in `totalTimeoutMs`);
   `RETRY-13`/`RETRY-14` ✅ structural (one engine); `RETRY-34`–`RETRY-37` ✅ Tasks 2 and 8.
5. **`§9.5` Trampoline and knobs** — `RETRY-30` N/A (an `await` loop is already iterative); `RETRY-31`–`RETRY-33`
   ✅ Task 8; `RETRY-38` ✅ Task 7; `RETRY-39`–`RETRY-44` ✅ Tasks 5, 8, 9; `RETRY-45` N/A (no scheduler object);
   `RETRY-29` ⏳ deferred, not scheduled.
6. **Appendix C `RECOV-17`–`RECOV-34`** — reproduce the design doc's mapping table verbatim, with `RECOV-32` ✅
   Task 11 and `RECOV-33` ⏳ Phase 7a.
7. **Cross-phase obligations** — `PIPE-36` ✅ Task 9; the `StepContext.signal`/`StepContext.options` amendment
   ✅ Task 1 (`PIPE-17`'s "readable by any step" + `RETRY-41`/`HTTP-35` per-call override, wired in Task 9); the
   2026-07-28 Phase 7a retrofit (`Clock`, RFC 1123 parser, retryable-status classifier single-sourcing) ✅
   applied directly to this plan/design, see the amendment banners at the top of each; the 2026-07-28 Phase 7b
   retrofit (two `SHOULD`-level structured log events in `engine.ts`, `RECOV-30`-adjacent) ✅ applied the same
   way.
8. **Deferred out of Phase 5a** — `RETRY-29`; `RECOV-33` → Phase 7a; public-barrel promotion of `retryStep` →
   5c, with the preset.

State explicitly at the top whether the plan has been executed, matching the Phase 4 checklist's convention.

- [ ] **Step 5: Record the deferrals in the roadmap's Deferred Items Log**

The design doc's Deferred Items table is headed "add to the roadmap's Deferred Items Log" — writing the
checklist does not discharge that. Append both rows to the log in
`docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`, in the log's existing column shape:
`RETRY-29` (opt-in server-driven retry-classification override, not scheduled) and `RECOV-33` (client-identity
header step, Phase 7a). Do not restate the justifications — link to this phase's design doc.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-26-phase5a-retry-checklist.md \
  docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md
git commit -m "docs: Phase 5a requirement checklist"
```

---

## Self-Review

**Spec coverage.** Walked every section of `2026-07-26-phase5a-retry-design.md`:

| Spec section | Task |
|---|---|
| Prerequisite `StepContext` amendment | 1 |
| Classification (`classify.ts`) | 2 |
| Backoff (`backoff.ts`) | 3 |
| Pacing (`pacing.ts`) | 4 |
| Settings (`settings.ts`) | 5 |
| `FakeTransport` | 6 |
| Per-attempt stamping | 7 (`RETRY-38`) and 11 (`RECOV-32`) |
| The attempt loop, the `RETRY-36` clash, the wait, the trail, `RETRY-30` | 8 |
| Pillar adapter, `PIPE-36` | 9 |
| Recovery adapter | 10 |
| Testing strategy (property tests, negative space) | 2, 3, 4, 8 |
| Deviation ledger, deferred items, public barrel | 12 |

No gaps.

**Type consistency.** `RetrySettings extends BackoffSettings`, so `computeDelay(attempt, settings, random)`
accepts a `RetrySettings` directly — Task 8 passes `config.settings` with no adapter. `RetryConfig.clock` (7a's
seam, post-retrofit — `clock.monotonic()` for the budget, `clock.now()` for `parsePacingHint`'s wall-clock
instant) and `RetryConfig.random` are the injected seams both `computeDelay` and `parsePacingHint` draw from,
spelled identically in Tasks 3, 4, and 8. `countingResponse` returns `{response, cancelCount}` in Task 6 and is destructured that way in
Tasks 8 and 9. `RetryDispatch` is declared once in Task 8 and imported by Tasks 9 and 10.

**Known rough edge, deliberately left.** Task 9's test imports `aRequestContext()` from 4c's cursor tests; the
step under it says to inline a `RequestContext` instead if 4c kept that helper file-local. Importing across
`*.test.ts` files is not acceptable — the inline path is the correct one if the helper is not already shared.
