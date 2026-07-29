# Phase 4b — Recovery-Chain Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `Outcome<T>`, the request/response recovery chains, the unified dispatch orchestrator, the
cancellation-wrapping helper, and the status→typed-exception mapping step in `@dexpace/core`, satisfying
`product-spec/08-execution-pipelines.md` §8.2 (`RECOV-1`–`RECOV-16`), per
`docs/superpowers/specs/2026-07-25-phase4b-recovery-chain-design.md`.

**Architecture:** A new `packages/core/src/recovery/` folder, six independent files with no folder-level barrel
(`docs/knowledge/module-organization.md`'s "never create internal barrels" applies — a future consumer imports
each file directly). `Outcome<T>` is a plain discriminated union with `success()`/`failure()`/`fold()`. The two
recovery chains are small classes holding defensively-copied step lists. The orchestrator is one free function.
All step types are `async`, matching Node's single execution model and letting the shipped status-mapping step
reuse Phase 3b's already-async `toHttpError()` directly. **Nothing in this phase enters the public package
barrel** — `recovery/` is resilience-layer plumbing; `api-extractor`'s committed report must come back
byte-identical.

**Tech Stack:** TypeScript 5.8+, `fast-check` for the invariant-bearing-function property tests. No new runtime
dependencies — `SEAM-1` untouched.

> ### ⛔ BLOCKED — do not execute this plan yet
>
> **`RECOV-12`'s `SuppressedError` is not available on the declared runtime floor.** An earlier draft of this
> plan claimed it was "already available since Phase 3b's checkpoint lib bump" — that is false and has been
> removed. The checkpoint raised `engines.node` only to the first release exposing `Symbol.dispose`/
> `Symbol.asyncDispose` (`plans/2026-07-25-checkpoint-scaffold-through-phase3a.md:57`, believed `18.18.0`,
> which also forbids any further floor movement as "unreviewed drift"). Node backported those two symbols on
> its own; `SuppressedError` is a V8 global from the full Explicit Resource Management proposal and is absent
> on every 18.x runtime.
>
> Adding `esnext.disposable` to `lib` supplies the *type* only. So `new SuppressedError(...)` at Task 3 type-
> checks, passes `bun test` locally, and then throws `ReferenceError: SuppressedError is not defined` at call
> time — precisely the `NFR-10` trap `docs/knowledge/tooling-and-quality-gates.md:60-61` describes. Task 7's
> `bun run verify:node-floor`, `bun run test:node`, and the `node-floor-conformance` job pinned to `18.17.0`
> would all fail.
>
> **Needs a decision, and it is cross-phase** — Phases 5a, 6a, 6b and 6c reach for `SuppressedError` on the same
> premise (`plans/2026-07-26-phase5a-retry.md:36`, `plans/2026-07-28-phase6a-serde.md`'s `closingAfter` helper,
> `specs/2026-07-28-phase6b-sse-design.md:163`, `specs/2026-07-28-phase6c-pagination-design.md:192`), so
> whichever option lands must land in all five:
>
> - **(a) Raise `engines.node`** past the first release shipping Explicit Resource Management. Consumer-visible
>   breaking change, and the checkpoint forbids unsanctioned floor moves. Confirm the exact release first.
> - **(b) A runtime-guarded `suppress(primary, secondary)` helper** in `packages/core/src/`, using native
>   `SuppressedError` when `globalThis.SuppressedError` exists and attaching a `suppressed` property otherwise —
>   the same guarded shape the roadmap already sanctioned for `Symbol.asyncDispose`. Changes Task 3's
>   `expect(wrapped).toBeInstanceOf(SuppressedError)` assertion.
>
> **Second open decision, non-blocking: assertion density.** This phase ships zero `invariant()` calls across
> roughly a dozen functions, against `docs/knowledge/assertions.md:6-7`'s 2-per-function module average. The
> concrete cost: no `apply()` checks that a step returned a value at all, so a step returning `undefined`
> poisons the fold silently and surfaces layers away. Project-wide inconsistency rather than 4b's alone —
> Phases 1/2/3b/4a ship zero, 4c ships fifteen. Resolve as either postcondition assertions at the fold sites
> or a Deviation Ledger row, ideally project-wide at Phase 10.
>
> Both items are tracked in the roadmap's "Open Findings — Phase 4b Validation Review (2026-07-28)" section.
> Everything else that review raised (F3–F10) is already applied to this plan and its design.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, and 4a are already implemented exactly as their own
plans specify. Concretely: `packages/core/src/http/*` exports `DexpaceError`, `Request`, `Response`,
`RequestOptions`; `packages/core/src/seams/transport.js` exports `Transport`, `CancellationError`; `packages/core/
src/body/http-status-error.js` exports `HttpStatusError`, `toHttpError()`; `packages/core/src/invariant.js`
exports `invariant()`. The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

**Note on `assertNever`:** `docs/knowledge/data-modeling.md` requires "every discriminated-union `switch` must
close with `default: return assertNever(x)`, defined once and imported everywhere." No prior phase plan actually
adds `assertNever` to `packages/core/src/invariant.ts` — `Outcome<T>`'s `fold()` (Task 1) is the first place in
the codebase that switches over a discriminated union, so Task 1 adds it there as a small, self-contained
addition alongside the existing `invariant()`/`InvariantViolation` it already exports.

## Global Constraints

- **Nothing from `src/recovery/` is exported from `packages/core/src/index.ts`, and there is no
  `src/recovery/index.ts` either.** `docs/knowledge/module-organization.md:18` bans internal barrels outright,
  independent of whether they're re-exported further up. Any future consumer (Phase 5's retry step) imports each
  file directly, e.g. `import {dispatchWithRecovery} from '../recovery/orchestrator.js'`. The mechanical check is
  that `packages/core/etc/core.api.md` is **byte-identical** before and after this phase (Task 7), matching Phase
  3a's/4a's gate.
- **Every step type is `async`.** `RequestStep = (request: Request) => Promise<Request>`, `ResponseStep =
  (response: Response) => Promise<Response>`, `RecoveryStep = (outcome: Outcome<Response>) => Promise<Outcome<Response>>`.
  This is a deliberate divergence from the reference's synchronous framing of `§8.2` — the shipped status-mapping
  step (Task 5) must call the already-async `toHttpError()`, so async is applied uniformly rather than mixed with
  sync step shapes.
- **Both recovery chains defensively copy their step lists at construction** (`[...steps]`), including the
  request chain, which the reference implementation does not copy. `RECOV-14`'s own text recommends a port copy
  both — do not "optimize" the request chain back to holding the caller's array by reference.
- **`dispatchWithRecovery` takes exactly two positional parameters: `(request, config)`.** `config` bundles
  `transport`/`requestChain`/`responseChain`/`options`/`signal`. Five positional parameters would fail ESLint's
  `max-params: 3` — the same trap 4a's `ContextInit` was built to dodge, applied here to the orchestrator itself.
- **`RECOV-12`'s close-on-throw is a hand-written `try`/`catch`, never `using`/`await using`.** Native
  disposal's auto-generated `SuppressedError` puts the *later* error (the disposal failure) first, making it
  primary and the original body error `.suppressed` — the opposite of what `RECOV-12` wants (the step's original
  throwable stays primary; a close failure rides along as `.suppressed`). Construct
  `new SuppressedError(originalError, closeError, message)` by hand — original first.
- **`RECOV-13`: a step that deliberately *returns* a different outcome (no throw) is never auto-closed.** Only a
  caught throw triggers the close-and-wrap path. Do not add a "close whenever the outcome changes" check — that
  would violate `RECOV-13` by closing a response a step meant to keep alive or already closed itself.
- **`wrapCancellation` never throws — it always returns a `Failure`.** `AbortSignal.aborted` is durable once
  set (unlike `Thread.interrupt()`'s clearable flag) and the SDK does not own the caller's `AbortController`
  anyway, so `RECOV-11`'s "re-assert the cancellation signal" has nothing to act on in Node. It is **not**
  reframed as an `invariant()` crash on a `CancellationError` whose paired signal never aborted, for two
  reasons: (1) `Transport` is a pluggable seam whose implementations the SDK does not control, so a
  mismatch is a misbehaving third-party plugin — an operational failure — not a violated precondition of our
  own code, and `docs/knowledge/error-handling.md` reserves crash-loud treatment for the latter; (2)
  `RECOV-2` is absolute — *no* throwable from the transport may bypass the recovery hooks — and throwing from
  inside `dispatchWithRecovery`'s own `catch` would do exactly that, skipping the response chain entirely.
  A concrete way to trip it: a transport that aborts its in-flight requests from `close()` (permitted by
  `SEAM-14`, which only says close need *not* cancel them) surfaces a `CancellationError` while the caller
  passed no signal at all.
- **No new per-status typed-exception hierarchy for `RECOV-15`.** Phase 3b's flat `HttpStatusError` (carrying
  `status` + a buffered, replayable body) already satisfies "the matching typed exception." The status-mapping
  step is a thin wrapper around the existing `toHttpError()` — do not reimplement buffering or invent
  `BadRequestError`/`NotFoundError`-style per-status classes; the corpus caps custom error hierarchies at two
  levels (`DexpaceError → Leaf`).
- **Never monkey-patch a `Response` method in a test.** `Response` calls `Object.freeze(this)` at the end of
  its constructor (Phase 1's rule, preserved by 3b's body retrofit), so `response.close = ...` throws
  `TypeError: Cannot add property close, object is not extensible` — ES modules are strict mode, so the
  assignment fails loudly rather than silently. Observe close through the body stream's `cancel()` hook
  instead, the way Phase 3b's own `response.test.ts` does; `Response.close()` is idempotent and cancels at
  most once, so a cancel counter is exactly the "released exactly once" count `RECOV-12` asks about.
- **No `FakeTransport`.** Each test file that needs a `Transport` hand-rolls a minimal, file-local stub against
  the real `Transport` interface — matching 4a's precedent of not building a shared test double before a real
  consumer (Phase 5) needs one.
- No new error leaf classes in this phase. The only new failure surface is `assertNever`'s
  `InvariantViolation` crash — a programmer error, not a catchable `DexpaceError` subclass. `wrapCancellation`
  does **not** crash; see its constraint above.
- **`#private` fields and methods stay `#private`; `fold` keeps three positional parameters.** Both are known
  corpus deviations, both are recorded in the design's Deviation Ledger, and neither is to be "corrected" while
  executing this plan. `docs/knowledge/data-modeling.md:20-23` prefers `private` and requires a justifying
  comment for `#private` — no runtime-privacy claim is made here, but `#private` is the package-wide style
  (Phases 1, 3b and 4a), so a 4b-only switch would fragment the package. `docs/knowledge/function-design.md:22-23`
  wants an options object at 3+ parameters, one stricter than the `max-params: ['error', 3]` gate it cites, and
  `fold(outcome, onSuccess, onFailure)` matches Phase 2's shipped `Transport.send(request, options?, signal?)`.
  Phase 10 reconciles both project-wide, in one pass.
- **`statusMappingStep` is a named `function` declaration, not a `const` arrow** (Task 5), per
  `docs/knowledge/function-design.md:18-21`. `func-style`'s `allowArrowFunctions: true` will not flag the arrow
  form, so this is on the author, not the gate. Keep the trailing `statusMappingStep satisfies ResponseStep;`
  — it is the only thing still proving the signature conforms once the `: ResponseStep` annotation is gone.
- Existing lint/coverage gates apply unchanged: `max-lines-per-function` 70, `max-depth` 3, `max-params` 3,
  explicit return types on exports, 80% aggregate coverage floor (`NFR-5`), no constructor parameter properties
  (`erasableSyntaxOnly`) — every test-local class stub assigns fields in the constructor body, never via a
  parameter-property shorthand.
- Every test file's top-of-file comment cites the `RECOV-N` IDs it exercises.

---

## File Structure

```
packages/core/src/invariant.ts        # MODIFY: add assertNever()                              (Task 1)
packages/core/src/invariant.test.ts   # MODIFY: add assertNever coverage

packages/core/src/recovery/
  outcome.ts             # Outcome<T>, success(), failure(), fold()                             (Task 1)
  outcome.test.ts
  request-chain.ts        # RequestRecoveryChain                                                 (Task 2)
  request-chain.test.ts
  response-chain.ts       # ResponseRecoveryChain                                                (Task 3)
  response-chain.test.ts
  cancellation.ts         # wrapCancellation()                                                   (Task 4)
  cancellation.test.ts
  status-mapping.ts       # statusMappingStep()                                                  (Task 5)
  status-mapping.test.ts
  orchestrator.ts         # dispatchWithRecovery(), DispatchConfig                                (Task 6)
  orchestrator.test.ts
```

No `recovery/index.ts` (see Global Constraints). Task 7 runs the full gate sequence — no barrel file to write.

---

### Task 1: `assertNever` + `recovery/outcome.ts`

**Files:**
- Modify: `packages/core/src/invariant.ts` (add `assertNever`)
- Modify: `packages/core/src/invariant.test.ts` (add its coverage)
- Create: `packages/core/src/recovery/outcome.ts`
- Create: `packages/core/src/recovery/outcome.test.ts`

**Interfaces:**
- Consumes: `InvariantViolation` (already exported from `invariant.ts`).
- Produces: `assertNever(value: never, message?: string): never` (from `invariant.ts`); `type Outcome<T>`,
  `success<T>(value: T): Outcome<T>`, `failure<T>(error: unknown): Outcome<T>`, `fold<T, R>(outcome, onSuccess,
  onFailure): R` (from `recovery/outcome.ts`). Every later task in this plan imports `Outcome`/`success`/`failure`
  from `outcome.js`.

- [ ] **Step 1: Write the failing test for `assertNever`**

```typescript
// packages/core/src/invariant.test.ts
// Add alongside the existing invariant() tests. Exercises the discriminated-union exhaustiveness helper
// docs/knowledge/data-modeling.md requires every switch to close with.
//
// This is an ADDITION to the existing file, not a replacement: extend its existing import statement with
// `assertNever` rather than pasting the line below wholesale, or `invariant` lands unused in whichever copy
// survives and fails `no-unused-vars`.
import {describe, expect, test} from 'bun:test';
import {assertNever, InvariantViolation, invariant} from './invariant.js';

describe('assertNever', () => {
  test('throws InvariantViolation naming the unreachable value', () => {
    // @ts-expect-error -- deliberately calling with a value that is not `never`, to exercise the runtime path
    expect(() => assertNever('unexpected-variant')).toThrow(InvariantViolation);
  });

  test('accepts a custom message', () => {
    // @ts-expect-error -- same as above
    expect(() => assertNever('x', 'custom message')).toThrow('custom message');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/invariant.test.ts`
Expected: FAIL — `assertNever is not a function` (or similar export error).

- [ ] **Step 3: Add `assertNever` to `invariant.ts`**

Append to the existing file (do not touch the existing `invariant()`/`InvariantViolation` exports):

```typescript
// packages/core/src/invariant.ts (append)

/**
 * Closes an exhaustive discriminated-union `switch`'s `default` case. If a new union variant is ever added
 * without a matching `case`, this becomes reachable at runtime and crashes loudly rather than silently
 * falling through.
 */
export function assertNever(value: never, message = `unreachable case: ${String(value)}`): never {
  throw new InvariantViolation(message);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/invariant.test.ts`
Expected: PASS, including the 2 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/invariant.ts packages/core/src/invariant.test.ts
git commit -m "feat(core): add assertNever exhaustiveness helper"
```

- [ ] **Step 6: Write the failing test for `Outcome<T>`**

```typescript
// packages/core/src/recovery/outcome.test.ts
// Exercises: RECOV-1 (closed two-variant sum type, mutually exclusive/jointly exhaustive, fold applies
// exactly one branch at most once per call)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {failure, fold, success} from './outcome.js';

describe('success / failure (RECOV-1)', () => {
  test('success carries its value under kind "success"', () => {
    const outcome = success(42);

    expect(outcome.kind).toBe('success');
    expect(outcome.kind === 'success' && outcome.value).toBe(42);
  });

  test('failure carries its error under kind "failure", typed unknown', () => {
    // A JS throw can legally raise any value, not only an Error (sdk-design-nodejs/05).
    const outcome = failure('a string throw');

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe('a string throw');
  });
});

describe('fold (RECOV-1)', () => {
  test('applies onSuccess for a success outcome', () => {
    const result = fold(success(10), (v) => v * 2, () => -1);

    expect(result).toBe(20);
  });

  test('applies onFailure for a failure outcome', () => {
    const error = new Error('boom');
    const result = fold(failure(error), () => 'unreachable', (e) => e);

    expect(result).toBe(error);
  });

  test('invokes exactly one branch, never both, for either variant', () => {
    let successCalls = 0;
    let failureCalls = 0;
    const onSuccess = () => {
      successCalls += 1;
      return 'ok';
    };
    const onFailure = () => {
      failureCalls += 1;
      return 'err';
    };

    fold(success(1), onSuccess, onFailure);
    fold(failure(new Error('x')), onSuccess, onFailure);

    expect(successCalls).toBe(1);
    expect(failureCalls).toBe(1);
  });
});

describe('fold identity law (RECOV-1)', () => {
  // Canonical law for an invariant-bearing function (docs/knowledge/testing.md): folding a success through
  // the identity success-handler and folding a failure through the identity failure-handler must each
  // recover the original payload, for arbitrary values.
  test('fold(success(x), id, _) === x for arbitrary x', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(fold(success(value), (v) => v, () => 'unreachable')).toBe(value);
      }),
    );
  });

  test('fold(failure(e), _, id) === e for arbitrary e', () => {
    fc.assert(
      fc.property(fc.anything(), (error) => {
        expect(fold(failure(error), () => 'unreachable', (e) => e)).toBe(error);
      }),
    );
  });
});
```

- [ ] **Step 7: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/outcome.test.ts`
Expected: FAIL — `Cannot find module './outcome.js'`.

- [ ] **Step 8: Write `outcome.ts`**

```typescript
// packages/core/src/recovery/outcome.ts
import {assertNever} from '../invariant.js';

/**
 * The recovery chain's closed two-variant outcome (RECOV-1): a success carrying a value, or a failure
 * carrying whatever was thrown. `error` is `unknown`, not `Error` -- a JavaScript `throw` can legally raise
 * any value.
 *
 * @internal
 */
export type Outcome<T> =
  | {readonly kind: 'success'; readonly value: T}
  | {readonly kind: 'failure'; readonly error: unknown};

/** @internal */
export function success<T>(value: T): Outcome<T> {
  return {kind: 'success', value};
}

/** @internal */
export function failure<T>(error: unknown): Outcome<T> {
  return {kind: 'failure', error};
}

/**
 * Applies exactly one of `onSuccess`/`onFailure`, never both, satisfying RECOV-1's "a fold that applies
 * exactly one of two branches at most once per call."
 *
 * @internal
 */
export function fold<T, R>(outcome: Outcome<T>, onSuccess: (value: T) => R, onFailure: (error: unknown) => R): R {
  switch (outcome.kind) {
    case 'success':
      return onSuccess(outcome.value);
    case 'failure':
      return onFailure(outcome.error);
    default:
      return assertNever(outcome);
  }
}
```

- [ ] **Step 9: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/outcome.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/recovery/outcome.ts packages/core/src/recovery/outcome.test.ts
git commit -m "feat(core): add Outcome<T>, success/failure/fold (RECOV-1)"
```

---

### Task 2: `recovery/request-chain.ts`

**Files:**
- Create: `packages/core/src/recovery/request-chain.ts`
- Create: `packages/core/src/recovery/request-chain.test.ts`

**Interfaces:**
- Consumes: `Request` (`../http/request.js`, type-only). The test reaches `Headers` through
  `request.headers.newBuilder()`, so neither the module nor the test imports `../http/headers.js` directly.
- Produces: `type RequestStep = (request: Request) => Promise<Request>`, `class RequestRecoveryChain`. Task 6
  (`orchestrator.ts`) imports `RequestRecoveryChain`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/request-chain.test.ts
// Exercises: RECOV-3 (sequential left-to-right fold, empty chain is identity, a throwing step aborts the
// remainder and propagates), RECOV-14 (defensive copy at construction)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Request} from '../http/request.js';
import {RequestRecoveryChain, type RequestStep} from './request-chain.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function tagAppendStep(char: string): RequestStep {
  return async (request) => {
    const current = request.headers.get('X-Trace') ?? '';
    return request.newBuilder().headers(request.headers.newBuilder().set('X-Trace', current + char).build()).build();
  };
}

describe('RequestRecoveryChain.apply (RECOV-3)', () => {
  test('an empty chain returns the input unchanged', async () => {
    const chain = new RequestRecoveryChain([]);
    const request = aRequest();

    const result = await chain.apply(request);

    expect(result).toBe(request);
  });

  test('applies steps as a sequential left-to-right fold', async () => {
    const chain = new RequestRecoveryChain([tagAppendStep('a'), tagAppendStep('b'), tagAppendStep('c')]);

    const result = await chain.apply(aRequest());

    expect(result.headers.get('X-Trace')).toBe('abc');
  });

  test('a throwing step aborts the remainder and propagates', async () => {
    const failingStep: RequestStep = () => {
      throw new Error('step failed');
    };
    const chain = new RequestRecoveryChain([tagAppendStep('a'), failingStep, tagAppendStep('c')]);

    await expect(chain.apply(aRequest())).rejects.toThrow('step failed');
  });
});

describe('RequestRecoveryChain construction (RECOV-14)', () => {
  test('defensively copies its step list -- mutating the source array after construction has no effect', async () => {
    const steps: RequestStep[] = [tagAppendStep('a')];
    const chain = new RequestRecoveryChain(steps);
    steps.push(tagAppendStep('b'));

    const result = await chain.apply(aRequest());

    expect(result.headers.get('X-Trace')).toBe('a');
  });
});

describe('RequestRecoveryChain.apply fold law', () => {
  // Canonical law for an invariant-bearing function: applying the chain equals manually reducing the same
  // steps in order, for an arbitrary sequence of single-character append steps.
  test('apply() equals a manual left-to-right reduce, for arbitrary step sequences', async () => {
    await fc.assert(
      // `fc.string({minLength: 1, maxLength: 1})` rather than `fc.char()`: the latter is deprecated in
      // fast-check 3.22+ (removed in 4.x) and would print a deprecation warning on every run.
      fc.asyncProperty(fc.array(fc.string({minLength: 1, maxLength: 1}), {maxLength: 10}), async (chars) => {
        const steps = chars.map(tagAppendStep);
        const chain = new RequestRecoveryChain(steps);

        const chained = await chain.apply(aRequest());
        let manual = aRequest();
        for (const step of steps) manual = await step(manual);

        expect(chained.headers.get('X-Trace')).toBe(manual.headers.get('X-Trace'));
      }),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/request-chain.test.ts`
Expected: FAIL — `Cannot find module './request-chain.js'`.

- [ ] **Step 3: Write `request-chain.ts`**

```typescript
// packages/core/src/recovery/request-chain.ts
import type {Request} from '../http/request.js';

/** @internal */
export type RequestStep = (request: Request) => Promise<Request>;

/**
 * Sequential left-to-right fold over request steps (RECOV-3): the output of step N is the input of step
 * N+1, an empty chain returns the input unchanged, and a throwing step aborts the remainder and propagates
 * -- the orchestrator (`orchestrator.ts`) converts that propagation into a Failure per RECOV-2.
 *
 * @internal
 */
export class RequestRecoveryChain {
  readonly #steps: readonly RequestStep[];

  /** Defensively copies `steps` (RECOV-14) -- the reference implementation does not, but the requirement's
   * own text recommends a port copy both chains. */
  constructor(steps: readonly RequestStep[]) {
    this.#steps = [...steps];
  }

  async apply(request: Request): Promise<Request> {
    let current = request;
    for (const step of this.#steps) {
      current = await step(current);
    }
    return current;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/request-chain.test.ts`
Expected: PASS, 5 tests (including the fast-check property, which itself runs 100 cases by default).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/request-chain.ts packages/core/src/recovery/request-chain.test.ts
git commit -m "feat(core): add RequestRecoveryChain (RECOV-3, RECOV-14)"
```

---

### Task 3: `recovery/response-chain.ts`

**Files:**
- Create: `packages/core/src/recovery/response-chain.ts`
- Create: `packages/core/src/recovery/response-chain.test.ts`

**Interfaces:**
- Consumes: `Response` (`../http/response.js`, type-only + `.close()` at runtime), `Outcome`/`success`/`failure`
  (Task 1).
- Produces: `type ResponseStep = (response: Response) => Promise<Response>`, `type RecoveryStep = (outcome:
  Outcome<Response>) => Promise<Outcome<Response>>`, `class ResponseRecoveryChain`. Task 6 imports
  `ResponseRecoveryChain`; Task 5's `statusMappingStep` is typed as a `ResponseStep`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/response-chain.test.ts
// Exercises: RECOV-4 (response steps run only on Success), RECOV-5/6 (recovery steps always run, fold
// order is response-then-recovery), RECOV-7 (a throwing response step converts to a Failure fed to
// recovery, not propagated), RECOV-8 (a throwing recovery step wraps into a Failure fed to the NEXT step;
// apply() never throws), RECOV-12 (close-on-throw with correct SuppressedError priority), RECOV-13 (no
// auto-close on a deliberate outcome substitution), RECOV-14 (defensive copy of both lists AND the
// second clause: steps safe for concurrent invocation, per-call state never on the chain instance)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {failure, success, type Outcome} from './outcome.js';
import {ResponseRecoveryChain, type RecoveryStep, type ResponseStep} from './response-chain.js';

function aResponse(body: ReadableStream<Uint8Array> | null = null): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

/**
 * Close is observed through the body stream's `cancel()`, exactly the way Phase 3b's own `response.test.ts`
 * observes it -- NOT by patching `response.close`. `Response` calls `Object.freeze(this)` at the end of its
 * constructor (Phase 1's rule, kept by 3b's retrofit), so `response.close = ...` throws
 * `TypeError: Cannot add property close, object is not extensible` in an ES module's strict mode.
 * `Response.close()` is idempotent and cancels the body at most once, so the cancel count IS the
 * effective-close count RECOV-12's "released exactly once" asks about.
 */
function countingCloseResponse(): {response: Response; closeCount: () => number} {
  let cancels = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    cancel() {
      cancels += 1;
    },
  });
  return {response: aResponse(body), closeCount: () => cancels};
}

/** A response whose `close()` rejects: `Response.close()` awaits `body.cancel()`, which rethrows here. */
function failingCloseResponse(closeError: Error): Response {
  return aResponse(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        throw closeError;
      },
    }),
  );
}

describe('response-step phase (RECOV-4, RECOV-6)', () => {
  test('response steps run in order on a Success outcome', async () => {
    const seen: string[] = [];
    const stepA: ResponseStep = async (r) => {
      seen.push('a');
      return r;
    };
    const stepB: ResponseStep = async (r) => {
      seen.push('b');
      return r;
    };
    const chain = new ResponseRecoveryChain([stepA, stepB], []);

    await chain.apply(success(aResponse()));

    expect(seen).toEqual(['a', 'b']);
  });

  test('response steps do not run when the input outcome is already a Failure', async () => {
    const stepShouldNotRun: ResponseStep = async () => {
      throw new Error('must not run');
    };
    const chain = new ResponseRecoveryChain([stepShouldNotRun], []);

    const result = await chain.apply(failure(new Error('original')));

    expect(result.kind).toBe('failure');
    expect(result.kind === 'failure' && (result.error as Error).message).toBe('original');
  });
});

describe('recovery-step phase (RECOV-5, RECOV-6)', () => {
  test('recovery steps run on every outcome, successes and failures, in order', async () => {
    const seenKinds: string[] = [];
    const record: RecoveryStep = async (outcome) => {
      seenKinds.push(outcome.kind);
      return outcome;
    };
    const chain = new ResponseRecoveryChain([], [record, record]);

    await chain.apply(success(aResponse()));
    await chain.apply(failure(new Error('x')));

    expect(seenKinds).toEqual(['success', 'success', 'failure', 'failure']);
  });

  test('fold order is all response steps first, then all recovery steps', async () => {
    const order: string[] = [];
    const responseStep: ResponseStep = async (r) => {
      order.push('response');
      return r;
    };
    const recoveryStep: RecoveryStep = async (outcome) => {
      order.push('recovery');
      return outcome;
    };
    const chain = new ResponseRecoveryChain([responseStep], [recoveryStep]);

    await chain.apply(success(aResponse()));

    expect(order).toEqual(['response', 'recovery']);
  });
});

describe('RECOV-7: a throwing response step converts to a Failure fed to recovery', () => {
  test('the throwable is never propagated out of apply(), and recovery observes the Failure', async () => {
    const stepAfterThatMustNotRun: ResponseStep = async () => {
      throw new Error('must not run -- response phase stops after the throw');
    };
    const thrownError = new Error('response step failed');
    const throwingStep: ResponseStep = () => {
      throw thrownError;
    };
    const seenByRecovery: Outcome<Response>[] = [];
    const recoveryStep: RecoveryStep = async (outcome) => {
      seenByRecovery.push(outcome);
      return outcome;
    };
    const chain = new ResponseRecoveryChain([throwingStep, stepAfterThatMustNotRun], [recoveryStep]);

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
    expect(result.kind === 'failure' && result.error).toBe(thrownError);
    expect(seenByRecovery).toHaveLength(1);
    expect(seenByRecovery[0]?.kind).toBe('failure');
  });
});

describe('RECOV-8: a throwing recovery step wraps into a Failure fed to the next step', () => {
  test('apply() never throws, and the remaining recovery steps still run', async () => {
    const secondStepSeen: Outcome<Response>[] = [];
    const throwingRecoveryStep: RecoveryStep = () => {
      throw new Error('recovery step failed');
    };
    const secondRecoveryStep: RecoveryStep = async (outcome) => {
      secondStepSeen.push(outcome);
      return outcome;
    };
    const chain = new ResponseRecoveryChain([], [throwingRecoveryStep, secondRecoveryStep]);

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('failure');
    expect(secondStepSeen).toHaveLength(1);
    expect(secondStepSeen[0]?.kind).toBe('failure');
  });
});

describe('RECOV-12: close-on-throw while holding a Success', () => {
  test('closes the in-hand response exactly once before wrapping the throwable', async () => {
    const {response, closeCount} = countingCloseResponse();
    const thrownError = new Error('step failed');
    const throwingStep: ResponseStep = () => {
      throw thrownError;
    };
    const chain = new ResponseRecoveryChain([throwingStep], []);

    const result = await chain.apply(success(response));

    expect(closeCount()).toBe(1);
    expect(result.kind === 'failure' && result.error).toBe(thrownError);
  });

  test('a close failure is attached as suppressed, with the original throwable staying primary', async () => {
    const closeError = new Error('close failed');
    const response = failingCloseResponse(closeError);
    const originalError = new Error('step failed');
    const throwingStep: ResponseStep = () => {
      throw originalError;
    };
    const chain = new ResponseRecoveryChain([throwingStep], []);

    const result = await chain.apply(success(response));

    expect(result.kind).toBe('failure');
    const wrapped = result.kind === 'failure' ? result.error : undefined;
    expect(wrapped).toBeInstanceOf(SuppressedError);
    expect((wrapped as SuppressedError).error).toBe(originalError);
    expect((wrapped as SuppressedError).suppressed).toBe(closeError);
  });
});

describe('RECOV-13: a deliberate outcome substitution is never auto-closed', () => {
  test('a recovery step returning a different Failure does not trigger a close', async () => {
    const {response, closeCount} = countingCloseResponse();
    const substituteStep: RecoveryStep = async () => failure(new Error('substituted, not thrown'));
    const chain = new ResponseRecoveryChain([], [substituteStep]);

    await chain.apply(success(response));

    expect(closeCount()).toBe(0);
  });

  test('a recovery step substituting a different Success does not trigger a close', async () => {
    const {response: original, closeCount} = countingCloseResponse();
    const substitute = aResponse();
    const substituteStep: RecoveryStep = async () => success(substitute);
    const chain = new ResponseRecoveryChain([], [substituteStep]);

    const result = await chain.apply(success(original));

    expect(closeCount()).toBe(0);
    expect(result.kind === 'success' && result.value).toBe(substitute);
  });
});

describe('RECOV-14: both step lists are defensively copied', () => {
  test('mutating the source arrays after construction has no effect on apply()', async () => {
    const responseSteps: ResponseStep[] = [];
    const recoverySteps: RecoveryStep[] = [];
    const chain = new ResponseRecoveryChain(responseSteps, recoverySteps);
    responseSteps.push(async () => {
      throw new Error('must not run -- pushed after construction');
    });
    recoverySteps.push(async (outcome) => outcome);

    const result = await chain.apply(success(aResponse()));

    expect(result.kind).toBe('success');
  });
});

describe('apply() never throws (RECOV-8 property)', () => {
  // Canonical law for an invariant-bearing function: for an arbitrary mix of throwing and non-throwing
  // RESPONSE AND RECOVERY steps, over a seed outcome that is arbitrarily a Success or a Failure, apply()
  // always settles (resolves or rejects its own returned promise cleanly, never synchronously throws /
  // never leaves an unhandled rejection) and never re-raises a step's throw (RECOV-8) -- and no response
  // step runs on any generated case whose seed was already a Failure (RECOV-4).
  //
  // BOTH phases and BOTH seed variants must be generated. A generator emitting recovery steps only, or
  // seeding Success only, proves the RECOV-8 law and silently leaves RECOV-4 to the example test above.
  test('apply() settles and skips the response phase on a Failure seed, for arbitrary step sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), {maxLength: 4}),
        fc.array(fc.boolean(), {maxLength: 4}),
        fc.boolean(),
        async (responseFlags, recoveryFlags, seedIsSuccess) => {
          let responseStepRuns = 0;
          const responseSteps: ResponseStep[] = responseFlags.map((shouldThrow, index) => async (response) => {
            responseStepRuns += 1;
            if (shouldThrow) throw new Error(`response step ${index} failed`);
            return response;
          });
          const recoverySteps: RecoveryStep[] = recoveryFlags.map((shouldThrow, index) => async (outcome) => {
            if (shouldThrow) throw new Error(`recovery step ${index} failed`);
            return outcome;
          });
          const chain = new ResponseRecoveryChain(responseSteps, recoverySteps);
          const seed = seedIsSuccess ? success(aResponse()) : failure(new Error('seed failure'));

          const result = await chain.apply(seed);

          expect(result.kind === 'success' || result.kind === 'failure').toBe(true);
          if (!seedIsSuccess) expect(responseStepRuns).toBe(0); // RECOV-4
        },
      ),
    );
  });
});

describe('RECOV-14: steps are safe for concurrent invocation', () => {
  // RECOV-14's SECOND normative clause: per-request state lives in the passed value, never on the step or
  // the chain. Guards the structural property that apply()'s only per-call state is its `current` local --
  // a later phase adding per-call bookkeeping to a chain field would fail here.
  test('two interleaved apply() calls on ONE chain instance do not observe each other', async () => {
    const gate: Array<() => void> = [];
    const slowStep: RecoveryStep = async (outcome) => {
      await new Promise<void>((resolve) => gate.push(resolve));
      return outcome;
    };
    const chain = new ResponseRecoveryChain([], [slowStep]);
    const successSeed = success(aResponse());
    const failureSeed = failure(new Error('second call'));

    const first = chain.apply(successSeed);
    const second = chain.apply(failureSeed);
    await Promise.resolve();
    for (const release of gate) release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.kind).toBe('success');
    expect(secondResult.kind === 'failure' && (secondResult.error as Error).message).toBe('second call');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/response-chain.test.ts`
Expected: FAIL — `Cannot find module './response-chain.js'`.

- [ ] **Step 3: Write `response-chain.ts`**

```typescript
// packages/core/src/recovery/response-chain.ts
import type {Response} from '../http/response.js';
import {failure, success, type Outcome} from './outcome.js';

/** @internal */
export type ResponseStep = (response: Response) => Promise<Response>;
/** @internal */
export type RecoveryStep = (outcome: Outcome<Response>) => Promise<Outcome<Response>>;

/**
 * Shared close-on-throw handling for both phases (RECOV-12): if the outcome held at the moment of the
 * throw was a Success, its response is closed before the throwable is wrapped into a Failure. A close
 * failure is attached as `suppressed` on the ORIGINAL throwable -- constructed by hand, original first --
 * never via `using`/`await using`, whose auto-generated SuppressedError would invert that priority.
 */
async function toFailureClosingSuccess(thrownError: unknown, current: Outcome<Response>): Promise<Outcome<Response>> {
  if (current.kind === 'success') {
    try {
      await current.value.close();
    } catch (closeError) {
      return failure(new SuppressedError(thrownError, closeError, 'response close failed while handling step error'));
    }
  }
  return failure(thrownError);
}

/**
 * The response and recovery step folds (RECOV-4..RECOV-9, RECOV-12, RECOV-13): response steps run only on
 * a Success outcome, in order, first; a throwing response step converts to a Failure fed to the recovery
 * phase (RECOV-7), not propagated. Recovery steps then run on every outcome, always, in order; a throwing
 * recovery step wraps into a Failure fed to the NEXT step (RECOV-8) -- `apply()` itself never throws.
 *
 * @internal
 */
export class ResponseRecoveryChain {
  readonly #responseSteps: readonly ResponseStep[];
  readonly #recoverySteps: readonly RecoveryStep[];

  /** Defensively copies both lists (RECOV-14). */
  constructor(responseSteps: readonly ResponseStep[], recoverySteps: readonly RecoveryStep[]) {
    this.#responseSteps = [...responseSteps];
    this.#recoverySteps = [...recoverySteps];
  }

  async apply(outcome: Outcome<Response>): Promise<Outcome<Response>> {
    const afterResponsePhase = await this.#runResponsePhase(outcome);
    return this.#runRecoveryPhase(afterResponsePhase);
  }

  async #runResponsePhase(outcome: Outcome<Response>): Promise<Outcome<Response>> {
    let current = outcome;
    for (const step of this.#responseSteps) {
      if (current.kind !== 'success') break; // RECOV-4: skip the remaining response steps once not Success
      try {
        current = success(await step(current.value));
      } catch (thrownError) {
        current = await toFailureClosingSuccess(thrownError, current); // RECOV-7, RECOV-12
        break; // remaining response steps do not run once converted to a Failure
      }
    }
    return current;
  }

  async #runRecoveryPhase(outcome: Outcome<Response>): Promise<Outcome<Response>> {
    let current = outcome;
    for (const step of this.#recoverySteps) {
      try {
        current = await step(current); // RECOV-13: a normal return substituting the outcome is never auto-closed
      } catch (thrownError) {
        current = await toFailureClosingSuccess(thrownError, current); // RECOV-8, RECOV-12
        // RECOV-8: never aborts the remaining recovery steps -- no break here.
      }
    }
    return current;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/response-chain.test.ts`
Expected: PASS, 13 tests (including the fast-check property and the RECOV-14 concurrency test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/response-chain.ts packages/core/src/recovery/response-chain.test.ts
git commit -m "feat(core): add ResponseRecoveryChain (RECOV-4..RECOV-9, RECOV-12, RECOV-13, RECOV-14)"
```

---

### Task 4: `recovery/cancellation.ts`

**Files:**
- Create: `packages/core/src/recovery/cancellation.ts`
- Create: `packages/core/src/recovery/cancellation.test.ts`

**Interfaces:**
- Consumes: `Outcome`/`failure` (Task 1).
- Produces: `wrapCancellation(error: unknown): Outcome<never>`. Task 6's orchestrator is its only call site;
  Phase 5's retry step is the next likely one. It is the single named site where `RECOV-11`'s Node
  disposition lives — if it is still a pure pass-through once Phase 5 lands, inline it there and move the
  disposition wholly into Phase 10's deviation ledger rather than keeping an abstraction with no behavior.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/cancellation.test.ts
// Exercises: RECOV-11 (wrapping a cancellation throwable into a Failure), reframed for Node -- an
// AbortSignal is durable once aborted and the SDK does not own the caller's AbortController, so there is
// nothing to re-assert; what the requirement still buys is the guarantee that a cancellation is surfaced
// through the SAME Failure channel as every other throwable, never through a side exit (RECOV-2).
import {describe, expect, test} from 'bun:test';
import {CancellationError} from '../seams/transport.js';
import {wrapCancellation} from './cancellation.js';

describe('wrapCancellation (RECOV-11)', () => {
  test('wraps a CancellationError into a Failure carrying it unchanged', () => {
    const error = new CancellationError('cancelled by caller');

    const outcome = wrapCancellation(error);

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe(error);
  });

  test('wraps an ordinary error into a Failure carrying it unchanged', () => {
    const error = new Error('an ordinary failure');

    const outcome = wrapCancellation(error);

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe(error);
  });

  test('wraps a non-Error throw unchanged -- a JS throw can raise any value', () => {
    const outcome = wrapCancellation('a string throw');

    expect(outcome.kind === 'failure' && outcome.error).toBe('a string throw');
  });

  test('never throws, for any input', () => {
    // RECOV-2 depends on this: dispatchWithRecovery calls it from inside its own catch, so a throw here
    // would let a transport failure bypass the response/recovery chain entirely.
    expect(() => wrapCancellation(new CancellationError('x'))).not.toThrow();
    expect(() => wrapCancellation(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/cancellation.test.ts`
Expected: FAIL — `Cannot find module './cancellation.js'`.

- [ ] **Step 3: Write `cancellation.ts`**

```typescript
// packages/core/src/recovery/cancellation.ts
import {failure, type Outcome} from './outcome.js';

/**
 * Wraps a cancellation/interruption throwable into a Failure (RECOV-11). The reference requires re-asserting
 * the cancellation signal on the current context so code later blocked on the outcome still observes
 * cancellation -- a concern specific to a clearable `Thread.interrupt()` flag. Node has nothing to
 * re-assert: an `AbortSignal` stays aborted once fired, and the SDK holds the signal, never the caller's
 * `AbortController`, so it could not set one anyway.
 *
 * It deliberately does **not** crash on a `CancellationError` whose paired signal never aborted.
 * `Transport` is a pluggable seam, so that mismatch is a misbehaving third-party implementation -- an
 * operational failure -- not a violated precondition of this codebase, and crash-loud treatment is reserved
 * for the latter (`docs/knowledge/error-handling.md`). It would also break RECOV-2: this runs inside
 * `dispatchWithRecovery`'s own `catch`, so throwing here would let a transport failure skip the response and
 * recovery chains entirely, which is precisely what RECOV-2 forbids.
 *
 * This function never throws, for any input.
 *
 * @internal
 */
export function wrapCancellation(error: unknown): Outcome<never> {
  return failure(error);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/cancellation.test.ts`
Expected: PASS, 4 tests.

`CancellationError` is imported by the *test* only (to prove a classified cancellation gets no special
treatment); `cancellation.ts` itself no longer needs it, so do not add the import back to the module.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/cancellation.ts packages/core/src/recovery/cancellation.test.ts
git commit -m "feat(core): add wrapCancellation (RECOV-11)"
```

---

### Task 5: `recovery/status-mapping.ts`

**Files:**
- Create: `packages/core/src/recovery/status-mapping.ts`
- Create: `packages/core/src/recovery/status-mapping.test.ts`

**Interfaces:**
- Consumes: `toHttpError`, `HttpStatusError` (`../body/http-status-error.js`, Phase 3b, unchanged), `Response`
  (`../http/response.js`, type-only), `ResponseStep` (Task 3, type-only, for the `satisfies` check).
- Produces: `async function statusMappingStep(response: Response): Promise<Response>`. Not consumed by any other
  task in this plan -- a future consumer (Phase 5 or 4c) installs it into a `ResponseRecoveryChain`'s
  response-step list.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/status-mapping.test.ts
// Exercises: RECOV-15 (400..599 map to the matching typed exception; all other statuses pass through
// unchanged), RECOV-16 (the mapping reuses Phase 3b's already-bounded/replayable buffering -- this test
// only proves the wiring, not the buffering itself, which is Phase 3b's own test suite's job)
import {describe, expect, test} from 'bun:test';
import {HttpStatusError} from '../body/http-status-error.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {statusMappingStep} from './status-mapping.js';

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

describe('statusMappingStep (RECOV-15)', () => {
  test('returns a 2xx response unchanged', async () => {
    const response = aResponse(200);

    const result = await statusMappingStep(response);

    expect(result).toBe(response);
  });

  test('returns a 3xx response unchanged', async () => {
    const response = aResponse(304);

    const result = await statusMappingStep(response);

    expect(result).toBe(response);
  });

  test('throws HttpStatusError naming the status for a 404', async () => {
    const response = aResponse(404);

    await expect(statusMappingStep(response)).rejects.toBeInstanceOf(HttpStatusError);
    try {
      await statusMappingStep(aResponse(404));
      throw new Error('unreachable -- statusMappingStep must throw for a 404');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpStatusError);
      expect((error as HttpStatusError).status).toBe(404);
    }
  });

  test('throws HttpStatusError for a 500', async () => {
    await expect(statusMappingStep(aResponse(500))).rejects.toBeInstanceOf(HttpStatusError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/status-mapping.test.ts`
Expected: FAIL — `Cannot find module './status-mapping.js'`.

- [ ] **Step 3: Write `status-mapping.ts`**

```typescript
// packages/core/src/recovery/status-mapping.ts
import {toHttpError} from '../body/http-status-error.js';
import type {Response} from '../http/response.js';
import type {ResponseStep} from './response-chain.js';

/**
 * The status→typed-exception mapping response step (RECOV-15/16). `toHttpError()` (Phase 3b, unchanged)
 * already satisfies both requirements in full: it treats only 400..599 as errors and returns non-error
 * statuses unchanged (RECOV-15), and it buffers the error body into a bounded, replayable in-memory copy
 * inside the response's own close-guaranteeing scope before mapping, sharing the same cap used by 3b's
 * logging tees (RECOV-16). `HttpStatusError` -- flat, carrying `status` and the buffered body -- IS the
 * "matching typed exception"; no new buffering, no per-status class hierarchy. The throw is deliberate: it
 * lets RECOV-7 (`response-chain.ts`) convert it into a Failure the same way any other response-step throw
 * is handled.
 *
 * @internal
 */
export async function statusMappingStep(response: Response): Promise<Response> {
  const httpError = await toHttpError(response);
  if (httpError === null) return response;
  throw httpError;
}

// A named declaration, not `const statusMappingStep: ResponseStep = async (response) => ...`: arrows are
// reserved for inline callbacks (docs/knowledge/function-design.md:18-21), and a named declaration survives
// in stack traces -- which this function, whose job is to throw, actually depends on. `func-style`'s
// `allowArrowFunctions: true` would not have flagged the arrow form. `satisfies` keeps the compile-time
// conformance proof the discarded `: ResponseStep` annotation was giving.
statusMappingStep satisfies ResponseStep;
```

`Response` is now imported (type-only) because the explicit parameter and return annotations a `function`
declaration needs replace the inference the `: ResponseStep` annotation was supplying.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/status-mapping.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/status-mapping.ts packages/core/src/recovery/status-mapping.test.ts
git commit -m "feat(core): add statusMappingStep, wiring 3b's toHttpError into the recovery chain (RECOV-15, RECOV-16)"
```

---

### Task 6: `recovery/orchestrator.ts`

**Files:**
- Create: `packages/core/src/recovery/orchestrator.ts`
- Create: `packages/core/src/recovery/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Transport` (`../seams/transport.js`), `RequestOptions` (`../http/request-options.js`),
  `RequestRecoveryChain` (Task 2), `ResponseRecoveryChain` (Task 3), `wrapCancellation` (Task 4),
  `Outcome`/`success`/`fold` (Task 1). `failure` is **not** imported here — every failure this function
  produces goes through `wrapCancellation` (`RECOV-11`).
- Produces: `interface DispatchConfig`, `dispatchWithRecovery(request: Request, config: DispatchConfig):
  Promise<Response>`. Terminal task of this plan -- no later task consumes this file.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/recovery/orchestrator.test.ts
// Exercises: RECOV-2 (one try/catch wraps the request chain AND the transport invocation; no throwable
// from either bypasses the recovery hooks), RECOV-10 (unwrap: Success returns the response, Failure
// rethrows the throwable unchanged, no wrapping/substitution), RECOV-11 (the catch routes through
// wrapCancellation -- a CancellationError paired with an aborted signal surfaces normally, and the
// helper is on the real dispatch path, not an unwired primitive)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {CancellationError, type Transport} from '../seams/transport.js';
import {dispatchWithRecovery} from './orchestrator.js';
import {RequestRecoveryChain, type RequestStep} from './request-chain.js';
import {ResponseRecoveryChain, type RecoveryStep, type ResponseStep} from './response-chain.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function aResponse(request: Request): Response {
  return Response.newBuilder().request(request).protocol(Protocol.HTTP_1_1).status(Status.of(200)).build();
}

/** A minimal, file-local Transport stub -- no shared FakeTransport exists yet (see Global Constraints). */
class StubTransport implements Transport {
  readonly #impl: (request: Request, options?: RequestOptions, signal?: AbortSignal) => Promise<Response>;

  constructor(impl: (request: Request, options?: RequestOptions, signal?: AbortSignal) => Promise<Response>) {
    this.#impl = impl;
  }

  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    return this.#impl(request, options, signal);
  }

  async close(): Promise<void> {}
}

function emptyChains(): {requestChain: RequestRecoveryChain; responseChain: ResponseRecoveryChain} {
  return {requestChain: new RequestRecoveryChain([]), responseChain: new ResponseRecoveryChain([], [])};
}

describe('dispatchWithRecovery happy path', () => {
  test('returns the transport response when everything succeeds', async () => {
    const request = aRequest();
    const response = aResponse(request);
    const transport = new StubTransport(async () => response);

    const result = await dispatchWithRecovery(request, {transport, ...emptyChains()});

    expect(result).toBe(response);
  });

  test('threads per-call options and signal through to the transport unchanged', async () => {
    const request = aRequest();
    const options = RequestOptions.EMPTY;
    const controller = new AbortController();
    let receivedOptions: RequestOptions | undefined;
    let receivedSignal: AbortSignal | undefined;
    const transport = new StubTransport(async (req, opts, signal) => {
      receivedOptions = opts;
      receivedSignal = signal;
      return aResponse(req);
    });

    await dispatchWithRecovery(request, {transport, ...emptyChains(), options, signal: controller.signal});

    expect(receivedOptions).toBe(options);
    expect(receivedSignal).toBe(controller.signal);
  });
});

describe('RECOV-2: every throwable from the request chain or the transport is caught', () => {
  test('a throwing request step surfaces as a Failure to a recovery hook, not an unhandled throw', async () => {
    const thrownError = new Error('request step failed');
    const failingStep: RequestStep = () => {
      throw thrownError;
    };
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = async (outcome) => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return outcome;
    };
    const transport = new StubTransport(async () => {
      throw new Error('must not run -- request chain already failed');
    });

    await expect(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([failingStep]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    ).rejects.toThrow('request step failed');
    expect(seenByRecovery).toEqual([thrownError]);
  });

  test('a throwing transport surfaces as a Failure to a recovery hook, not an unhandled throw', async () => {
    const thrownError = new Error('transport failed');
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = async (outcome) => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return outcome;
    };
    const transport = new StubTransport(async () => {
      throw thrownError;
    });

    await expect(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    ).rejects.toThrow('transport failed');
    expect(seenByRecovery).toEqual([thrownError]);
  });
});

describe('RECOV-10: the final unwrap is unchanged, no wrapping or substitution', () => {
  test('a recovery step constructing a typed error and returning a Failure surfaces exactly that error', async () => {
    class MyTypedError extends Error {}
    const typedError = new MyTypedError('mapped');
    const mapToTypedError: ResponseStep = () => {
      throw typedError;
    };
    const transport = new StubTransport(async (request) => aResponse(request));

    await expect(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([mapToTypedError], []),
      }),
    ).rejects.toBe(typedError);
  });
});

describe('RECOV-11: the catch routes every throwable through wrapCancellation', () => {
  test('a transport CancellationError paired with an aborted signal surfaces unchanged', async () => {
    const controller = new AbortController();
    const cancellation = new CancellationError('aborted by caller');
    const transport = new StubTransport(async () => {
      controller.abort();
      throw cancellation;
    });

    await expect(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], []),
        signal: controller.signal,
      }),
    ).rejects.toBe(cancellation);
  });

  test('a CancellationError raised with no caller signal still reaches the recovery chain (RECOV-2)', async () => {
    // A transport may abort its own in-flight requests for reasons the caller never signalled -- SEAM-14
    // permits close() to cancel them. That must surface as an ordinary Failure through the recovery hooks,
    // not as a side exit: RECOV-2 admits no throwable from the transport bypassing them.
    const cancellation = new CancellationError('aborted by the transport itself');
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = async (outcome) => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return outcome;
    };
    const transport = new StubTransport(async () => {
      throw cancellation;
    });

    await expect(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    ).rejects.toBe(cancellation);
    expect(seenByRecovery).toEqual([cancellation]);
  });
});
```

`CancellationError` is imported from `../seams/transport.js` (Phase 2) alongside the `Transport` type.

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/recovery/orchestrator.test.ts`
Expected: FAIL — `Cannot find module './orchestrator.js'`.

- [ ] **Step 3: Write `orchestrator.ts`**

```typescript
// packages/core/src/recovery/orchestrator.ts
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {wrapCancellation} from './cancellation.js';
import {fold, success, type Outcome} from './outcome.js';
import type {RequestRecoveryChain} from './request-chain.js';
import type {ResponseRecoveryChain} from './response-chain.js';

/**
 * Everything `dispatchWithRecovery` needs beyond the request itself, bundled into one trailing object.
 * Five positional parameters (transport/requestChain/responseChain/options/signal) would fail ESLint's
 * `max-params: 3` -- the same trap 4a's `ContextInit` was built to dodge.
 *
 * @internal
 */
export interface DispatchConfig {
  readonly transport: Transport;
  readonly requestChain: RequestRecoveryChain;
  readonly responseChain: ResponseRecoveryChain;
  readonly options?: RequestOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The unified recovery-chain orchestrator (RECOV-2, RECOV-10, RECOV-11). One try/catch wraps the request
 * chain's `apply()` and the transport invocation, so every throwable from either is caught and converted to
 * a Failure before reaching the response chain -- a before-request throw cannot skip after-error handling.
 * That conversion goes through `wrapCancellation` (RECOV-11), which is the helper's only call site and which
 * never throws for any input -- RECOV-2's guarantee depends on that, since this catch clause is the last
 * place a transport throwable could escape without meeting the recovery hooks. The final unwrap returns the
 * response on Success, or rethrows the Failure's throwable
 * UNCHANGED -- no wrapping, no substitution. Any typed-exception surfacing is a recovery step's own
 * responsibility.
 *
 * @internal
 */
export async function dispatchWithRecovery(request: Request, config: DispatchConfig): Promise<Response> {
  let outcome: Outcome<Response>;
  try {
    const preparedRequest = await config.requestChain.apply(request);
    const response = await config.transport.send(preparedRequest, config.options, config.signal);
    outcome = success(response);
  } catch (error) {
    // RECOV-11: `Outcome<never>` widens to `Outcome<Response>` without a cast. Never throws (RECOV-2).
    outcome = wrapCancellation(error);
  }
  const finalOutcome = await config.responseChain.apply(outcome);
  return fold(
    finalOutcome,
    (response) => response,
    (error) => {
      throw error;
    },
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/recovery/orchestrator.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recovery/orchestrator.ts packages/core/src/recovery/orchestrator.test.ts
git commit -m "feat(core): add dispatchWithRecovery orchestrator (RECOV-2, RECOV-10)"
```

---

### Task 7: Full gate verification

**Files:** none created — this task only runs and verifies the existing gate sequence.

**Interfaces:**
- Consumes: every preceding task.
- Produces: nothing new; verifies the whole phase is green and the public surface did not move.

- [ ] **Step 1: Run the full gate sequence**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
bun run typecheck
bun run lint
bun run build
bun test --coverage
bun run api
bun run lint:publish
bun run verify:dual-consumption
bun run verify:seam-1
bun run verify:node-floor
bun run test:node
bun run audit
```

Expected: all exit 0. Coverage at or above the 80% aggregate floor (`NFR-5`).

- [ ] **Step 2: Verify no `node:` import crept in**

```bash
! grep -rn "from 'node:" packages/core/src/recovery/
```

Expected: exit 0, no matches.

- [ ] **Step 3: Verify the public API surface did not move**

Step 1 already regenerated the report via `bun run api`; this only inspects the result. Run from the repo root:

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
git diff --exit-code packages/core/etc/core.api.md
```

Expected: **no output, exit 0.** Nothing from `src/recovery/` reached the published surface — matching Phase
3a's/4a's gate. If this fails, remove whatever export leaked into `packages/core/src/index.ts` rather than
accepting the report change.

- [ ] **Step 4: Add a changeset**

Because nothing enters the public API, this is a patch-level, no-consumer-impact change:

```bash
bun run changeset
```

Select `@dexpace/core`, choose **patch**, summary:
`Internal: recovery-chain primitives for product-spec §8.2 (RECOV-1..16). No public API change.`

- [ ] **Step 5: Commit**

```bash
git add .changeset/
git commit -m "chore(core): verify full gate sequence for Phase 4b"
```

---

## Self-Review

**Spec coverage** — every requirement ID from the design's scope, mapped to its task:

- `RECOV-1` → Task 1 (`Outcome<T>`, `success`/`failure`, `fold` applying exactly one branch).
- `RECOV-2` → Task 6 (`dispatchWithRecovery`'s single `try`/`catch` wrapping the request chain and transport
  invocation).
- `RECOV-3` → Task 2 (`RequestRecoveryChain.apply`'s sequential fold, empty-chain identity, throw-aborts-and-
  propagates).
- `RECOV-4`, `RECOV-5`, `RECOV-6` → Task 3 (`#runResponsePhase` only advances on Success; `#runRecoveryPhase`
  runs on every outcome; `apply()`'s fold order is response-phase-then-recovery-phase).
- `RECOV-7` → Task 3 (`#runResponsePhase`'s catch converts a throw to a Failure via `toFailureClosingSuccess`,
  never propagating out of `apply()`).
- `RECOV-8` → Task 3 (`#runRecoveryPhase`'s catch wraps into a Failure fed to the next iteration, no `break`;
  `apply()` itself has no un-caught path).
- `RECOV-9` → satisfied structurally: both phases treat a step's thrown error and a step's returned `Failure`
  identically (a thrown error becomes a Failure via the catch block; a returned Failure is just the next
  `current`). Recovery-step authors may prefer either; the chain does not care.
- `RECOV-10` → Task 6 (the terminal `fold` returns the response on Success or rethrows the Failure's error
  unchanged).
- `RECOV-11` → Task 4 (`wrapCancellation`, reframed for `AbortSignal`'s durable-once-set semantics — see the
  design's deviation ledger for why a literal re-assertion has nothing to act on in Node, and why the
  mismatch case is **not** an `invariant()` crash) **and Task 6**, its only call site:
  `dispatchWithRecovery`'s catch converts every throwable through it, so it sits on the real dispatch path
  rather than being an unwired primitive.
- `RECOV-12` → Task 3 (`toFailureClosingSuccess`'s close-then-wrap, with a hand-built `SuppressedError` keeping
  the original throwable primary).
- `RECOV-13` → Task 3 (a step's normal return, without a throw, never touches `toFailureClosingSuccess` — no
  auto-close path exists for that case).
- `RECOV-14` → Task 2 and Task 3, **both** its clauses: `[...steps]` at construction in `RequestRecoveryChain`
  and `ResponseRecoveryChain` (including the request chain the reference does not copy), and the
  concurrent-invocation clause — after construction a chain holds nothing but its step array and `apply()` keeps
  all per-call state in locals, guarded by Task 3's interleaved-`apply()` test.
- `RECOV-15`, `RECOV-16` → Task 5 (`statusMappingStep` wraps Phase 3b's unchanged `toHttpError()`/
  `HttpStatusError`, which already satisfies the 400..599 mapping and the bounded/replayable/shared-cap
  buffering).

**Placeholder scan:** no `TBD`/`TODO`, no "add appropriate error handling." Every step has real code.

**Type consistency:** `RequestStep`/`ResponseStep`/`RecoveryStep` (declared in Tasks 2/3) match every call site in
Tasks 3, 5, and 6 — no task calls a step with an extra or missing argument. `Outcome<T>`'s `kind`/`value`/`error`
fields (Task 1) are the only fields read anywhere in Tasks 3, 4, and 6 — no drift between the declared shape and
destructured/narrowed usage. `DispatchConfig`'s field names (Task 6: `transport`, `requestChain`,
`responseChain`, `options`, `signal`) match exactly what `orchestrator.test.ts` constructs at every call site,
including the `emptyChains()` spread helper.

**Lint-gate pre-check** (the failure modes this plan's shapes were chosen to avoid):

- `max-params` 3 — `dispatchWithRecovery(request, config)` is 2; every class constructor in this phase
  (`RequestRecoveryChain`, `ResponseRecoveryChain`, `StubTransport`) takes 1 or 2. No `eslint-disable` anywhere in
  this phase.
- `max-depth` 3 — deepest nesting is `#runResponsePhase`'s `for` containing a `try`/`catch` containing an `if`
  inside the `catch` only via the shared helper, not inline.
- `max-lines-per-function` 70 — longest function is `#runResponsePhase`/`#runRecoveryPhase`, each under 15 lines.
- Explicit return types on every export.
- No constructor parameter properties: `StubTransport` (test-local) and every production class assign fields in
  the constructor body.
- No unused imports: `orchestrator.test.ts`'s `RequestStep`/`RecoveryStep`/`ResponseStep` type imports are each
  used by at least one locally-defined step in that file.
