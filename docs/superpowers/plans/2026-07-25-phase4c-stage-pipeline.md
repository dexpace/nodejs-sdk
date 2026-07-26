# Phase 4c — Stage-Based Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the stage-based pipeline in `@dexpace/core` — the fixed-stage step composition runtime, its
builder with surgical edit operations, the per-call cursor/fork mechanism, and the execution-context-store
wiring — satisfying `product-spec/08-execution-pipelines.md` §8.1 (`PIPE-1`–`PIPE-40`), per
`docs/superpowers/specs/2026-07-25-phase4c-stage-pipeline-design.md`.

**Architecture:** A new `packages/core/src/pipeline/` folder, six files with no folder-level barrel
(`docs/knowledge/module-organization.md`'s "never create internal barrels" — matching Phase 4b's actual
practice, not Phase 4a's grandfathered exception). `Stage` is a string-literal union plus an explicit
`STAGE_ORDER` array — no TS `enum` (the erasable-syntax rule bars it). A step is a plain function wrapped in a
`StepDescriptor` that carries a `type` symbol for identity/anchor matching. `Cursor` is one recursive dispatcher
per call; `next`/`fork` continuations are one-shot closures built over it, sharing a single mutable in-flight
request so a substitution sticks globally for the rest of the call. `Runtime` implements `Transport` itself and
owns the `ContextStore` wiring. `PipelineBuilder` assembles a `Runtime` via surgical stage-bucketed edits,
flattened once at `build()`. **Nothing in this phase enters the public package barrel** — `pipeline/` has no
real consumer yet (Phase 5's retry/redirect/auth steps are the first); `api-extractor`'s committed report must
come back byte-identical.

**Tech Stack:** TypeScript 5.8+, native `Symbol`/`Map`/`Object.freeze`. No new runtime dependencies — `SEAM-1`
untouched.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, 4a, and 4b are already implemented exactly as their
own plans specify. Concretely: `packages/core/src/http/*` exports `DexpaceError`, `Request`, `Response`,
`RequestOptions`, `Protocol`, `Status`; `packages/core/src/seams/transport.js` exports `Transport`; `packages/core/
src/context/context.js` exports `ExecutionContext`, `RequestContext`, `createDispatchContext`,
`createRequestContext`, `promoteToRequest`, `promoteToExchange`, and `packages/core/src/context/store.js` exports
`contextStore` (4a ships **no** `context/index.js` barrel — `docs/knowledge/module-organization.md:18`);
`packages/core/src/invariant.js` exports `invariant()`. The full gate
sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/`verify:dual-consumption`/
`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **No TypeScript `enum`.** `Stage` is a string-literal union plus an explicit `STAGE_ORDER: readonly Stage[]`
  array. The roadmap's "Dual JS/TS consumption" constraint bars TS-only runtime syntax (`erasableSyntaxOnly`);
  no prior phase in this codebase uses `enum` (`Protocol`/`Status` use a class-with-static-instances pattern
  instead, which `Stage` doesn't need since it has no behavior beyond ordering).
- **`Next` takes an optional replacement `Request`: `type Next = (request?: Request) => Promise<Response>`.**
  `PIPE-14` requires a step-substituted request to propagate downstream and to the terminal dispatch — a
  zero-arg `next()` has no way to carry that. Calling with no argument carries the current request through
  unchanged.
- **`ctx.fork` is present only when the invoking step's `StepDescriptor.stage` is in `PILLAR_STAGES`.** An
  ordinary step's `ctx.fork` is `undefined` — do not add a fork capability to every step "for consistency."
- **`Cursor`'s one-shot-continuation guard is scoped to the specific closure a step was handed, not to the
  `Cursor` instance as a whole.** A step that never calls `next` at all (a short-circuit) is normal and needs no
  opt-out. Do not add a `Cursor`-instance-level `#advanced` flag — build both `ctx.next` and every `ctx.fork()`
  call through the same private `#continuationAt(targetPosition, ownerStage)` helper, each producing its own
  independent one-shot closure.
- **`ctx.fork`'s returned continuations are always bound to the SAME target position (`position + 1` of the
  forking step), every time `fork()` is called.** A second retry attempt re-runs every downstream step fresh —
  it does not resume from wherever the first attempt's chain got to (`PIPE-16`).
- **`#request` is a single mutable field shared by the whole `Cursor` instance, not copied per fork.** `PIPE-14`'s
  stickiness is global for the entire call: any step's substitution is visible to every later step, every later
  fork, and the terminal dispatch. `PIPE-16`'s "forks advancing independently" is about cursor *position*
  independence, not request isolation — do not give each fork its own private request copy.
- **`Runtime` implements `Transport` with exactly one `send()` method — no `sendAsync`.** Phase 2's `Transport`
  SPI has one method; `PIPE-26`'s "delegate execute/execute-async to its own send/send-async" is satisfied by
  that single method having nothing else to delegate to.
- **`Runtime.close()` is `async close(): Promise<void> {}` — it must NEVER call the wrapped transport's
  `close()`.** `PIPE-27`: the pipeline never owns its transport.
- **`Runtime` exposes `get steps(): readonly StepDescriptor[]`.** `PIPE-25` literally requires the built runtime
  to "expose a read-only, ordered view of its steps" — this is not optional ergonomics.
- **An empty pipeline (`Runtime` built with zero steps) dispatches directly to the terminal transport in
  `send()`, without constructing a `Cursor`.** `PIPE-9`.
- **`Runtime.send()` installs a `RequestContext` into `contextStore` before the cursor runs, re-installs as an
  `ExchangeContext` under the same key after it resolves, and evicts in a `finally` block using a local variable
  that always tracks the MOST RECENTLY installed context** (reassigned at each promotion) — never the original
  `requestContext` reference. `contextStore.close()` is identity-conditional (4a, `CTX-9`/`CTX-10`); closing a
  stale reference after a later promotion would rely on that no-op-ing silently rather than being correct by
  construction.
- **Any `PipelineBuilder` insertion method given a descriptor whose `stage` is `SEND` throws
  `ReservedStageError` immediately.** `PIPE-8`'s "MUST NOT hold a user step" is a hard precondition — do not
  rely on `build()`'s flatten-time skip as the only enforcement; that would silently no-op a caller's mistake
  instead of crashing loud (`docs/knowledge/error-handling.md`).
- **Pillar-stage collision rules (`PIPE-4`/`5`/`6`), keyed by `StepDescriptor.type` (a `symbol`), not by
  function/object equality:** installing a *distinct* type onto an occupied pillar throws `PillarCollisionError`
  naming both types and the stage; re-installing the identical type (reference-equal `symbol`) is a silent,
  successful no-op.
- **`reload()` validates the entire incoming batch — including the `SEND`-stage check and the pillar-collision
  check — before calling `this.#buckets.clear()`.** `PIPE-23`: a rejected `reload()` must leave the builder's
  existing collection completely untouched, not partially rebuilt. It also **de-duplicates a repeated
  same-type pillar entry within the batch** rather than seating it twice — `PIPE-4` caps a pillar at one step,
  and the incremental `append` path already treats a same-type re-install as an idempotent no-op (`PIPE-6`);
  the bulk path must not be the back door that gets two onto one pillar.
- **`Cursor` takes a single `CursorInit` object.** Six positional parameters (`steps`/`transport`/`request`/
  `context`/`options`/`signal`) would fail `max-params: 3`, and Phase 1 reserves the `eslint-disable` escape
  hatch for private builder-internal constructors only — `Cursor` is not one. Same shape as 4a's `ContextInit`
  and 4b's `DispatchConfig`. **Do not port the reference's start-position parameter**: a fork produces a fresh
  one-shot closure over the existing dispatcher, never a second `Cursor`, so every instance starts at position
  0 and a settable start would be dead surface the coverage gate cannot exercise.
- **`Runtime` promotes to `ExchangeContext` from the request that was actually sent**, read back off
  `cursor.request` after the drive — not blindly off the original `requestContext`. `PIPE-14` lets a step
  substitute the outbound request; pairing the response with a request that never left the process contradicts
  `CTX-1`. The rebuild goes through `createRequestContext` with the **same key pinned** (`CTX-6`) so
  `promoteToExchange` itself stays strictly additive (`CTX-2`) — do not add a request-override parameter to
  4a's promotion API.
- **No `PIPE-35` seeding (FLATTEN vs NEST).** Not an async/bridge omission despite its placement under the
  spec's "Bridges." heading — it is deferred on its own merits, because 4c is the phase that first makes a
  pipeline constructible and no caller yet holds one to seed from. Do not add a `seedFrom`/copy-constructor
  "while we're here"; the future shape is an explicit, non-defaulted mode argument, decided by the phase that
  needs it.
- **No test patches a method on the `contextStore` singleton.** It is process-wide and shared by every test
  file in the run, so a patched `install`/`close` leaks beyond the test that installed it the moment anything
  runs concurrently, and it is a mock of an owned interface, which `docs/knowledge/testing.md` rejects. What
  needs asserting about the exchange context is `exchangeSource`'s two branches — a pure function, exported
  `@internal` from `runtime.ts` and tested directly. Prefer key-scoped assertions
  (`contextStore.get(key) === undefined`) over absolute `contextStore.size` checks for the same reason.
- **Non-null assertions (`!`) are banned outside test fixtures.** Every place an array/`Map` lookup is provably
  non-`undefined` by surrounding control flow but TypeScript can't prove it (`noUncheckedIndexedAccess`), use
  `invariant(x !== undefined, '…')` to narrow instead (`docs/knowledge/variables-and-declarations.md`).
- `exactOptionalPropertyTypes: true` — optional properties are spelled `?: T | undefined`, never bare `?: T`.
- **No `FakeTransport`.** Every test file that needs a `Transport` hand-rolls a minimal, file-local stub against
  the real `Transport` interface — matching 4a/4b's precedent. (The roadmap's Deferred Items Log row is
  re-punted past 4c, not resolved here.)
- **No standard-resilience preset.** `PIPE-39` (SHOULD) and `PIPE-24` (the preset's own empty-slots-only
  installation rule) are not shipped — pillar steps (redirect/retry/auth) don't exist until Phase 5+. The
  empty-pipeline fast path (`PIPE-9`) already gives a step-less passthrough for free; nothing further is built
  speculatively.
- **Do not add exception-normalization wrapping around a step call.** `PIPE-29`/`PIPE-30` (a step must not
  throw synchronously; the runtime must normalize any sync exception into a rejected promise) are structurally
  free because every `Step` is declared `async` — a JS `async` function can never throw synchronously to its
  caller, a body that throws before its first `await` still returns a rejected `Promise`. Adding a `try`/`catch`
  around `descriptor.fn(...)` in `Cursor` would be dead code the coverage gate can't exercise.
- Existing lint/coverage gates apply unchanged: `max-lines-per-function` 70, `max-depth` 3, `max-params` 3,
  explicit return types on exports, 80% aggregate coverage floor (`NFR-5`), no constructor parameter properties
  (`erasableSyntaxOnly`) — every class assigns fields in the constructor body.
- Every test file's top-of-file comment cites the `PIPE-N` (and `CTX-N`, where relevant) IDs it exercises.

---

## File Structure

```
packages/core/src/pipeline/
  stage.ts        # Stage, STAGE_ORDER, PILLAR_STAGES                                (Task 1)
  stage.test.ts
  errors.ts        # PillarCollisionError, AnchorNotFoundError, CrossStageEditError,  (Task 2)
                    # CursorAlreadyAdvancedError, ReservedStageError
  errors.test.ts
  step.ts           # Next, StepContext, Step, StepDescriptor (types only)            (Task 3)
  cursor.ts         # Cursor
  cursor.test.ts
  runtime.ts        # Runtime (implements Transport)                                 (Task 4)
  runtime.test.ts
  builder.ts        # PipelineBuilder                                                (Task 5)
  builder.test.ts
```

No `pipeline/index.ts` (see Global Constraints). Task 6 runs the full gate sequence — no barrel file to write.
`step.ts` has no test of its own — it is pure types with no independent runtime behavior, folded into Task 3
(its first and only consumer at this phase is `cursor.ts`; `builder.ts` also imports `StepDescriptor` from it
directly in Task 5).

---

### Task 1: `pipeline/stage.ts`

**Files:**
- Create: `packages/core/src/pipeline/stage.ts`
- Create: `packages/core/src/pipeline/stage.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Stage`, `const STAGE_ORDER: readonly Stage[]`, `const PILLAR_STAGES: ReadonlySet<Stage>`.
  Tasks 2, 3, 4, 5 all import `Stage`; Tasks 3 and 5 import `PILLAR_STAGES`; Task 5 imports `STAGE_ORDER`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pipeline/stage.test.ts
// Exercises: PIPE-2 (the mandatory chain, outermost pre-redirect slot through terminal SEND), PIPE-3
// (pre/post extension slots around every pillar), PIPE-4 (exactly the 5 configurable pillars), PIPE-8 (SEND
// is the final, terminal stage)
import {describe, expect, test} from 'bun:test';
import {PILLAR_STAGES, STAGE_ORDER, type Stage} from './stage.js';

describe('STAGE_ORDER (PIPE-2, PIPE-3)', () => {
  test('lists every stage exactly once, in declaration order', () => {
    expect(STAGE_ORDER).toEqual([
      'PRE_REDIRECT',
      'REDIRECT',
      'POST_REDIRECT',
      'PRE_RETRY',
      'RETRY',
      'POST_RETRY',
      'PRE_AUTH',
      'AUTH',
      'POST_AUTH',
      'PRE_LOGGING',
      'LOGGING',
      'POST_LOGGING',
      'PRE_SERDE',
      'SERDE',
      'POST_SERDE',
      'SEND',
    ]);
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
  });

  test('PRE_REDIRECT is the outermost slot (PIPE-2)', () => {
    expect(STAGE_ORDER.at(0)).toBe('PRE_REDIRECT');
  });

  test('SEND is the terminal, final stage (PIPE-8)', () => {
    expect(STAGE_ORDER.at(-1)).toBe('SEND');
  });
});

describe('PILLAR_STAGES (PIPE-4)', () => {
  test('is exactly REDIRECT, RETRY, AUTH, LOGGING, SERDE', () => {
    expect([...PILLAR_STAGES].sort()).toEqual(['AUTH', 'LOGGING', 'REDIRECT', 'RETRY', 'SERDE']);
  });

  test('does not include SEND or any extension slot', () => {
    expect(PILLAR_STAGES.has('SEND' as Stage)).toBe(false);
    expect(PILLAR_STAGES.has('PRE_REDIRECT' as Stage)).toBe(false);
    expect(PILLAR_STAGES.has('POST_LOGGING' as Stage)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/pipeline/stage.test.ts`
Expected: FAIL — `Cannot find module './stage.js'`.

- [ ] **Step 3: Write `stage.ts`**

```typescript
// packages/core/src/pipeline/stage.ts

/**
 * Fixed, totally-ordered pipeline stages (PIPE-1, PIPE-2). A string-literal union, not a TS `enum` --
 * `erasableSyntaxOnly` bars enums, and `Stage` has no behavior beyond ordering, which `STAGE_ORDER` alone
 * provides. `PRE_REDIRECT` is the outermost slot PIPE-2 mandates; `POST_REDIRECT`..`POST_SERDE` are PIPE-3's
 * SHOULD extension slots around every pillar. `SEND` is terminal and reserved -- PIPE-8, flattening skips it
 * and `PipelineBuilder` rejects any attempt to install a step there.
 *
 * @internal
 */
export type Stage =
  | 'PRE_REDIRECT'
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
  | 'SERDE'
  | 'POST_SERDE'
  | 'SEND';

/**
 * Declaration order (PIPE-1, PIPE-25): `PipelineBuilder.build()` flattens by walking this array. Inserting a
 * further stage later is one splice here -- no existing `Stage` value needs to change, so there is no
 * numeric-gap "renumbering" concern to design around.
 *
 * @internal
 */
export const STAGE_ORDER: readonly Stage[] = [
  'PRE_REDIRECT',
  'REDIRECT',
  'POST_REDIRECT',
  'PRE_RETRY',
  'RETRY',
  'POST_RETRY',
  'PRE_AUTH',
  'AUTH',
  'POST_AUTH',
  'PRE_LOGGING',
  'LOGGING',
  'POST_LOGGING',
  'PRE_SERDE',
  'SERDE',
  'POST_SERDE',
  'SEND',
];

/** A pillar stage admits at most one step (PIPE-4). @internal */
export const PILLAR_STAGES: ReadonlySet<Stage> = new Set(['REDIRECT', 'RETRY', 'AUTH', 'LOGGING', 'SERDE']);
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/pipeline/stage.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/stage.ts packages/core/src/pipeline/stage.test.ts
git commit -m "feat(core): add pipeline Stage, STAGE_ORDER, PILLAR_STAGES (PIPE-1..4, PIPE-8)"
```

---

### Task 2: `pipeline/errors.ts`

**Files:**
- Create: `packages/core/src/pipeline/errors.ts`
- Create: `packages/core/src/pipeline/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` (`../http/errors.js`), `Stage` (Task 1, type-only).
- Produces: `class PillarCollisionError`, `class AnchorNotFoundError`, `class CrossStageEditError`,
  `class CursorAlreadyAdvancedError`, `class ReservedStageError`, all `extends DexpaceError`. Task 3
  (`cursor.ts`) imports `CursorAlreadyAdvancedError`; Task 5 (`builder.ts`) imports the other four.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pipeline/errors.test.ts
// Exercises: PIPE-5 (PillarCollisionError), PIPE-21 (AnchorNotFoundError), PIPE-18/19 (CrossStageEditError),
// PIPE-11/15 (CursorAlreadyAdvancedError), PIPE-8 (ReservedStageError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  AnchorNotFoundError,
  CrossStageEditError,
  CursorAlreadyAdvancedError,
  PillarCollisionError,
  ReservedStageError,
} from './errors.js';

describe('PillarCollisionError (PIPE-5)', () => {
  test('carries the stage and both colliding type symbols, extends DexpaceError', () => {
    const existing = Symbol('existing');
    const incoming = Symbol('incoming');

    const error = new PillarCollisionError('RETRY', existing, incoming);

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.name).toBe('PillarCollisionError');
    expect(error.stage).toBe('RETRY');
    expect(error.existingType).toBe(existing);
    expect(error.incomingType).toBe(incoming);
  });
});

describe('AnchorNotFoundError (PIPE-21)', () => {
  test('carries the missing anchor type and the attempted operation', () => {
    const anchorType = Symbol('missing');

    const error = new AnchorNotFoundError(anchorType, 'insertAfter');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.anchorType).toBe(anchorType);
    expect(error.operation).toBe('insertAfter');
  });
});

describe('CrossStageEditError (PIPE-18, PIPE-19)', () => {
  test('carries the anchor stage and the incoming stage', () => {
    const error = new CrossStageEditError('RETRY', 'AUTH');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.anchorStage).toBe('RETRY');
    expect(error.incomingStage).toBe('AUTH');
  });
});

describe('CursorAlreadyAdvancedError (PIPE-11, PIPE-15)', () => {
  test('carries the stage of the step that reused its continuation', () => {
    const error = new CursorAlreadyAdvancedError('RETRY');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.stage).toBe('RETRY');
  });
});

describe('ReservedStageError (PIPE-8)', () => {
  test('carries the attempted operation', () => {
    const error = new ReservedStageError('append');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.operation).toBe('append');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/pipeline/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write `errors.ts`**

```typescript
// packages/core/src/pipeline/errors.ts
import {DexpaceError} from '../http/errors.js';
import type {Stage} from './stage.js';

/** PIPE-5: installing a distinct second step onto an occupied pillar; names both types and the stage. */
export class PillarCollisionError extends DexpaceError {
  readonly stage: Stage;
  readonly existingType: symbol;
  readonly incomingType: symbol;

  constructor(stage: Stage, existingType: symbol, incomingType: symbol, options?: ErrorOptions) {
    super(
      `pillar stage '${stage}' already holds a different step type; install rejected (use replace() to swap it)`,
      options,
    );
    this.stage = stage;
    this.existingType = existingType;
    this.incomingType = incomingType;
  }
}

/** PIPE-21: an insertAfter/insertBefore/replace whose anchor type matches nothing in the pipeline. */
export class AnchorNotFoundError extends DexpaceError {
  readonly anchorType: symbol;
  readonly operation: string;

  constructor(anchorType: symbol, operation: string, options?: ErrorOptions) {
    super(`${operation}: no step with the given anchor type is present in the pipeline`, options);
    this.anchorType = anchorType;
    this.operation = operation;
  }
}

/** PIPE-18/PIPE-19: a cross-stage insert/replace -- the incoming descriptor's stage differs from the anchor's. */
export class CrossStageEditError extends DexpaceError {
  readonly anchorStage: Stage;
  readonly incomingStage: Stage;

  constructor(anchorStage: Stage, incomingStage: Stage, options?: ErrorOptions) {
    super(
      `cannot insert/replace across stages: anchor is in '${anchorStage}', incoming step declares '${incomingStage}'`,
      options,
    );
    this.anchorStage = anchorStage;
    this.incomingStage = incomingStage;
  }
}

/** PIPE-11/PIPE-15: a step reused an already-invoked next()/fork() continuation instead of forking again. */
export class CursorAlreadyAdvancedError extends DexpaceError {
  readonly stage: Stage;

  constructor(stage: Stage, options?: ErrorOptions) {
    super(
      `step at stage '${stage}' reused an already-invoked continuation; a re-driving step must call fork() again`,
      options,
    );
    this.stage = stage;
  }
}

/** PIPE-8: an attempt to install a user step onto the reserved, terminal SEND stage. */
export class ReservedStageError extends DexpaceError {
  readonly operation: string;

  constructor(operation: string, options?: ErrorOptions) {
    super(`${operation}: the SEND stage is reserved for the terminal transport hop and cannot hold a user step`, options);
    this.operation = operation;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/pipeline/errors.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/errors.ts packages/core/src/pipeline/errors.test.ts
git commit -m "feat(core): add pipeline error leaves (PIPE-5, PIPE-8, PIPE-11, PIPE-15, PIPE-18, PIPE-19, PIPE-21)"
```

---

### Task 3: `pipeline/step.ts` + `pipeline/cursor.ts` — the per-call cursor

**Files:**
- Create: `packages/core/src/pipeline/step.ts`
- Create: `packages/core/src/pipeline/cursor.ts`
- Create: `packages/core/src/pipeline/cursor.test.ts`

**Interfaces:**
- Consumes: `Stage`/`PILLAR_STAGES` (Task 1), `CursorAlreadyAdvancedError` (Task 2), `ExecutionContext`
  (`../context/context.js`, type-only), `Request`/`Response` (`../http/*.js`, type-only), `RequestOptions`
  (`../http/request-options.js`, type-only), `Transport` (`../seams/transport.js`), `invariant`
  (`../invariant.js`).
- Produces: `type Next`, `interface StepContext`, `type Step`, `interface StepDescriptor` (`step.ts`);
  `class Cursor` (`cursor.ts`). Task 4 (`runtime.ts`) imports `Cursor`; Task 5 (`builder.ts`) imports
  `StepDescriptor` directly from `step.ts`, not through `cursor.ts`.

- [ ] **Step 1: Write `step.ts` (no test — pure types, no independent runtime behavior)**

```typescript
// packages/core/src/pipeline/step.ts
import type {ExecutionContext} from '../context/context.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {Stage} from './stage.js';

/**
 * Advances the pipeline once, optionally substituting a replacement request first (PIPE-14). `Request`
 * values are immutable, so "substitute" means constructing a new one and passing it downstream -- the
 * substitution sticks for every remaining step and the terminal dispatch for the rest of the current call.
 * Calling with no argument carries the current request through unchanged.
 *
 * @internal
 */
export type Next = (request?: Request) => Promise<Response>;

/**
 * What a step receives on each invocation (PIPE-12). `fork` is present only when the invoking step occupies
 * a pillar stage (PIPE-15/16); an ordinary step's `ctx.fork` is `undefined`.
 *
 * @internal
 */
export interface StepContext {
  readonly next: Next;
  readonly fork?: () => Next;
  readonly context: ExecutionContext;
}

/**
 * A pipeline step (PIPE-12): receives the inbound request, MAY invoke the rest of the chain via `ctx.next`
 * (or `ctx.fork` to re-drive more than once), and MAY inspect or substitute the outbound response --
 * including short-circuiting by never calling `next` at all.
 *
 * @internal
 */
export type Step = (request: Request, ctx: StepContext) => Promise<Response>;

/**
 * A registered step: its function plus the identity (`type`) PIPE-6's reference-identity pillar check and
 * PIPE-18/19's anchor-type matching both key off, and the `stage` it occupies.
 *
 * @internal
 */
export interface StepDescriptor {
  readonly type: symbol;
  readonly stage: Stage;
  readonly fn: Step;
}
```

- [ ] **Step 2: Write the failing test for `cursor.ts`**

```typescript
// packages/core/src/pipeline/cursor.test.ts
// Exercises: PIPE-9 (Cursor-level: an exhausted position dispatches to the terminal transport), PIPE-11/15
// (a reused next()/fork() continuation throws CursorAlreadyAdvancedError), PIPE-12 (ctx.context, ctx.fork
// gated by pillar stage), PIPE-13 (terminal dispatch threads request/options/signal), PIPE-14 (a substituted
// request sticks downstream and to the terminal dispatch), PIPE-15/16 (fork() returns independent,
// position-pinned one-shot continuations; a step that forks twice re-visits every downstream step both
// times), PIPE-17 (the caller's options are carried unchanged across every fork and into each dispatch)
import {describe, expect, test} from 'bun:test';
import {createRequestContext, type ExecutionContext} from '../context/context.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {Cursor} from './cursor.js';
import {CursorAlreadyAdvancedError} from './errors.js';
import type {Next, Step, StepDescriptor} from './step.js';

function aRequest(url: string): Request {
  return Request.newBuilder().url(url).build();
}

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(aRequest('https://example.com'))
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

class RecordingTransport implements Transport {
  readonly calls: Array<{request: Request; options: RequestOptions | undefined; signal: AbortSignal | undefined}> =
    [];
  #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  async send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    this.calls.push({request, options, signal});
    return this.#response;
  }

  async close(): Promise<void> {}
}

function passthroughStep(log: string[], label: string): Step {
  return async (_request, ctx) => {
    log.push(label);
    return ctx.next();
  };
}

describe('Cursor terminal dispatch (PIPE-9, PIPE-13)', () => {
  test('an exhausted cursor dispatches to the terminal transport, threading options and signal', async () => {
    const canned = aResponse(200);
    const transport = new RecordingTransport(canned);
    const request = aRequest('https://example.com/a');
    const signal = new AbortController().signal;
    const context = createRequestContext(request);

    const cursor = new Cursor({steps: [], transport, request, context, signal});
    const response = await cursor.advance();

    expect(response).toBe(canned);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.request).toBe(request);
    expect(transport.calls[0]?.signal).toBe(signal);
  });
});

describe('Cursor step invocation (PIPE-12)', () => {
  test('ctx.context is the exact reference passed to the constructor, visible to every step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const seen: ExecutionContext[] = [];
    const step: Step = async (_request, ctx) => {
      seen.push(ctx.context);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {type: Symbol('probe'), stage: 'PRE_LOGGING', fn: step};

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(seen[0]).toBe(context);
  });

  test('ctx.fork is undefined for a non-pillar-stage step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const seenFork: Array<(() => Next) | undefined> = [];
    const step: Step = async (_request, ctx) => {
      seenFork.push(ctx.fork);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {type: Symbol('probe'), stage: 'PRE_LOGGING', fn: step};

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(seenFork[0]).toBeUndefined();
  });

  test('ctx.fork is present for a pillar-stage step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let sawFork: (() => Next) | undefined;
    const step: Step = async (_request, ctx) => {
      sawFork = ctx.fork;
      invariant(sawFork !== undefined, 'pillar step must receive a fork');
      return sawFork()();
    };
    const descriptor: StepDescriptor = {type: Symbol('retry'), stage: 'RETRY', fn: step};

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(sawFork).toBeDefined();
  });
});

describe('Cursor continuation reuse (PIPE-11, PIPE-15)', () => {
  test('a second call to the same next() throws CursorAlreadyAdvancedError', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let capturedNext: Next | undefined;
    const step: Step = async (_request, ctx) => {
      capturedNext = ctx.next;
      return ctx.next();
    };
    const descriptor: StepDescriptor = {type: Symbol('probe'), stage: 'PRE_LOGGING', fn: step};

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    invariant(capturedNext !== undefined, 'the step must have run and captured its next()');
    await expect(capturedNext()).rejects.toBeInstanceOf(CursorAlreadyAdvancedError);
  });

  test('a second call to the same fork()-returned continuation throws CursorAlreadyAdvancedError', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let capturedContinuation: Next | undefined;
    const step: Step = async (_request, ctx) => {
      invariant(ctx.fork !== undefined, 'pillar step must receive a fork');
      capturedContinuation = ctx.fork();
      return capturedContinuation();
    };
    const descriptor: StepDescriptor = {type: Symbol('retry'), stage: 'RETRY', fn: step};

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    invariant(capturedContinuation !== undefined, 'the step must have run and captured its fork() continuation');
    await expect(capturedContinuation()).rejects.toBeInstanceOf(CursorAlreadyAdvancedError);
  });
});

describe('Cursor request substitution (PIPE-14)', () => {
  test('a substituted request propagates downstream and to the terminal dispatch', async () => {
    const original = aRequest('https://example.com/a');
    const substituted = aRequest('https://example.com/b');
    const context = createRequestContext(original);
    const seenByDownstream: Request[] = [];
    const substituteStep: Step = async (_request, ctx) => ctx.next(substituted);
    const downstreamStep: Step = async (request, ctx) => {
      seenByDownstream.push(request);
      return ctx.next();
    };
    const transport = new RecordingTransport(aResponse(200));
    const steps: StepDescriptor[] = [
      {type: Symbol('substitute'), stage: 'PRE_LOGGING', fn: substituteStep},
      {type: Symbol('downstream'), stage: 'POST_LOGGING', fn: downstreamStep},
    ];

    await new Cursor({steps, transport, request: original, context}).advance();

    expect(seenByDownstream[0]).toBe(substituted);
    expect(transport.calls[0]?.request).toBe(substituted);
  });
});

describe('Cursor fork (PIPE-15, PIPE-16, PIPE-17)', () => {
  test('a step forking twice re-visits every downstream step on both attempts', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const options = RequestOptions.EMPTY;
    const log: string[] = [];
    const retryStep: Step = async (_request, ctx) => {
      invariant(ctx.fork !== undefined, 'retryStep must occupy a pillar stage');
      log.push('retry:attempt-1');
      await ctx.fork()();
      log.push('retry:attempt-2');
      return ctx.fork()();
    };
    const steps: StepDescriptor[] = [
      {type: Symbol('retry'), stage: 'RETRY', fn: retryStep},
      {type: Symbol('downstream'), stage: 'POST_RETRY', fn: passthroughStep(log, 'downstream')},
    ];
    const transport = new RecordingTransport(aResponse(200));

    await new Cursor({steps, transport, request, context, options}).advance();

    expect(log).toEqual(['retry:attempt-1', 'downstream', 'retry:attempt-2', 'downstream']);
    expect(transport.calls).toHaveLength(2);
    // PIPE-17: the caller's per-call options are carried unchanged across every re-drive fork and threaded
    // into each terminal dispatch -- shared by reference, never copied-and-diverged per fork.
    expect(transport.calls.map((call) => call.options)).toEqual([options, options]);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd packages/core && bun test src/pipeline/cursor.test.ts`
Expected: FAIL — `Cannot find module './cursor.js'`.

- [ ] **Step 4: Write `cursor.ts`**

```typescript
// packages/core/src/pipeline/cursor.ts
import type {ExecutionContext} from '../context/context.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {CursorAlreadyAdvancedError} from './errors.js';
import {PILLAR_STAGES, type Stage} from './stage.js';
import type {Next, Step, StepContext, StepDescriptor} from './step.js';

/**
 * Everything a `Cursor` needs, bundled into one object. Six positional parameters would fail ESLint's
 * `max-params: 3`, and Phase 1 reserves the `eslint-disable` escape hatch for private builder-internal
 * constructors only -- the same trap 4a's `ContextInit` and 4b's `DispatchConfig` were built to dodge.
 *
 * @internal
 */
export interface CursorInit {
  readonly steps: readonly StepDescriptor[];
  readonly transport: Transport;
  readonly request: Request;
  readonly context: ExecutionContext;
  readonly options?: RequestOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Drives one call through the flattened step array (PIPE-9..PIPE-17). One instance per `Runtime.send()`
 * call (PIPE-10); `advance()` is its single public entry point. Internally a private recursive dispatcher
 * indexed by array position -- `next` and every `fork()` call are one-shot closures built over the same
 * dispatcher (PIPE-15/16), sharing a single mutable in-flight request so a substitution sticks globally for
 * the rest of the call (PIPE-14).
 *
 * There is deliberately no settable start position: a fork produces a fresh one-shot closure over the
 * existing dispatcher, never a second `Cursor`, so every instance starts at position 0.
 *
 * @internal
 */
export class Cursor {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;
  #request: Request;
  readonly #options: RequestOptions | undefined;
  readonly #signal: AbortSignal | undefined;
  readonly #context: ExecutionContext;

  constructor(init: CursorInit) {
    this.#steps = init.steps;
    this.#transport = init.transport;
    this.#request = init.request;
    this.#options = init.options;
    this.#signal = init.signal;
    this.#context = init.context;
  }

  /**
   * The in-flight request as of now: the one passed in, or whatever a step last substituted (PIPE-14).
   * `Runtime` reads this after the drive so the exchange context describes the request actually sent.
   */
  get request(): Request {
    return this.#request;
  }

  async advance(): Promise<Response> {
    return this.#dispatch(0);
  }

  async #dispatch(position: number): Promise<Response> {
    if (position >= this.#steps.length) {
      // PIPE-13: exhausted -- dispatch the current in-flight request to the terminal transport.
      return this.#transport.send(this.#request, this.#options, this.#signal);
    }
    const descriptor = this.#steps[position];
    invariant(descriptor !== undefined, `pipeline cursor position ${position} is within bounds but undefined`);
    const next = this.#continuationAt(position + 1, descriptor.stage);
    const ctx: StepContext = PILLAR_STAGES.has(descriptor.stage)
      ? {next, context: this.#context, fork: () => this.#continuationAt(position + 1, descriptor.stage)}
      : {next, context: this.#context};
    return descriptor.fn(this.#request, ctx);
  }

  /**
   * Builds a ONE-SHOT continuation targeting `targetPosition` (PIPE-11/15: a second call throws
   * CursorAlreadyAdvancedError). `ctx.next` and every `ctx.fork()` call share this helper -- both always
   * target `position + 1` of the requesting step; `fork()` may simply be called again to obtain a fresh
   * one-shot continuation bound to that same target (PIPE-16).
   */
  #continuationAt(targetPosition: number, ownerStage: Stage): Next {
    let used = false;
    return async (replacementRequest?: Request): Promise<Response> => {
      if (used) throw new CursorAlreadyAdvancedError(ownerStage);
      used = true;
      if (replacementRequest !== undefined) {
        this.#request = replacementRequest; // PIPE-14: sticks for every later step and the terminal dispatch.
      }
      return this.#dispatch(targetPosition);
    };
  }
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd packages/core && bun test src/pipeline/cursor.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/step.ts packages/core/src/pipeline/cursor.ts packages/core/src/pipeline/cursor.test.ts
git commit -m "feat(core): add Step/StepDescriptor types and the per-call Cursor (PIPE-9..PIPE-17)"
```

---

### Task 4: `pipeline/runtime.ts`

**Files:**
- Create: `packages/core/src/pipeline/runtime.ts`
- Create: `packages/core/src/pipeline/runtime.test.ts`

**Interfaces:**
- Consumes: `Cursor` (Task 3), `StepDescriptor` (Task 3, type-only), `Transport`/`Request`/`Response`/
  `RequestOptions` (external), `contextStore`/`createDispatchContext`/`promoteToRequest`/`promoteToExchange`/
  `ExecutionContext`/`RequestContext`/`createRequestContext` (`../context/context.js`), `contextStore`
  (`../context/store.js`).
- Produces: `class Runtime implements Transport`, with `send()`, `close()`, `get steps()`, plus the
  `exchangeSource()` helper (exported `@internal` so it is unit-testable as the pure function it is). Task 5
  (`builder.ts`) imports `Runtime`; `build()` constructs one.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pipeline/runtime.test.ts
// Exercises: PIPE-9 (an empty pipeline dispatches directly, no cursor/context allocated), PIPE-10 (each
// send() allocates its own per-call state), PIPE-14 (a substituted request reaches the wire, and is what the
// exchange context is built from), PIPE-25 (get steps() exposes the flattened, immutable array), PIPE-26
// (Runtime itself satisfies the Transport SPI with one send() method), PIPE-27 (close() never touches the
// wrapped transport), CTX-17's positive half (the first store entry is installed by the first promotion),
// CTX-1/2/3/6 (exchangeSource pins the call key and instrumentation when it rebuilds)
import {afterEach, describe, expect, test} from 'bun:test';
import {createRequestContext, type ExecutionContext} from '../context/context.js';
import {contextStore} from '../context/store.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {exchangeSource, Runtime} from './runtime.js';
import type {Step, StepDescriptor} from './step.js';

function aRequest(url: string): Request {
  return Request.newBuilder().url(url).build();
}

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(aRequest('https://example.com'))
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

class RecordingTransport implements Transport {
  readonly calls: Array<{request: Request; options: RequestOptions | undefined; signal: AbortSignal | undefined}> =
    [];
  closeCalls = 0;
  #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  async send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    this.calls.push({request, options, signal});
    return this.#response;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

afterEach(() => {
  contextStore.clear();
});

describe('Runtime.send empty pipeline (PIPE-9)', () => {
  test('dispatches directly to the terminal transport, threading options and signal, no context installed', async () => {
    const canned = aResponse(200);
    const transport = new RecordingTransport(canned);
    const runtime = new Runtime([], transport);
    const request = aRequest('https://example.com/a');
    const signal = new AbortController().signal;
    const sizeBefore = contextStore.size;

    const response = await runtime.send(request, undefined, signal);

    expect(response).toBe(canned);
    expect(transport.calls).toEqual([{request, options: undefined, signal}]);
    // A delta, not an absolute size: `contextStore` is process-wide, so a sibling test file sharing the
    // process must not be able to turn this assertion red (styleguide 11.7 -- tests survive any order).
    expect(contextStore.size).toBe(sizeBefore);
  });
});

describe('Runtime.send context-store wiring (CTX-17, CTX-8)', () => {
  test('installs a RequestContext before dispatch, then evicts it after the call resolves', async () => {
    let observed: ExecutionContext | undefined;
    const step: Step = async (_request, ctx) => {
      observed = contextStore.get(ctx.context.key);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {type: Symbol('probe'), stage: 'PRE_LOGGING', fn: step};
    const runtime = new Runtime([descriptor], new RecordingTransport(aResponse(200)));

    const response = await runtime.send(aRequest('https://example.com'));

    invariant(observed !== undefined, 'the step must have observed an installed context');
    expect(observed.kind).toBe('request');
    expect(contextStore.get(observed.key)).toBeUndefined(); // evicted in send()'s finally
    expect(response.status.code).toBe(200);
  });

  test('evicts the installed context even when a step throws', async () => {
    let observedKey: symbol | undefined;
    const step: Step = async (_request, ctx) => {
      observedKey = ctx.context.key;
      throw new Error('boom');
    };
    const descriptor: StepDescriptor = {type: Symbol('throws'), stage: 'PRE_LOGGING', fn: step};
    const runtime = new Runtime([descriptor], new RecordingTransport(aResponse(200)));

    await expect(runtime.send(aRequest('https://example.com'))).rejects.toThrow('boom');
    invariant(observedKey !== undefined, 'the step must have run and captured its call key');
    expect(contextStore.get(observedKey)).toBeUndefined();
  });
});

describe('exchangeSource (PIPE-14, CTX-1, CTX-2, CTX-3, CTX-6)', () => {
  // Tested directly rather than by spying on `contextStore.install`: the exchange context is evicted in
  // `send()`'s own `finally`, so observing it end-to-end would mean patching a method on the process-wide
  // singleton -- a mock of an owned interface (styleguide 11.3) that also leaks across test files sharing
  // the process if a run is ever parallelised. `exchangeSource` is a pure function; the end-to-end half that
  // remains observable (the substituted request is what actually reached the wire) is asserted below.
  test('returns the SAME context object when no step substituted the request', () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request, {operationName: 'GetWidget'});

    expect(exchangeSource(context, request)).toBe(context);
  });

  test('rebuilds around the substituted request, pinning the same key and instrumentation', () => {
    const original = aRequest('https://example.com/original');
    const substituted = aRequest('https://example.com/substituted');
    const context = createRequestContext(original, {operationName: 'GetWidget'});

    const rebuilt = exchangeSource(context, substituted);

    expect(rebuilt.request).toBe(substituted);
    expect(rebuilt.key).toBe(context.key); // CTX-3: one call key for the whole chain
    expect(rebuilt.instrumentation).toBe(context.instrumentation); // CTX-2: carried forward by reference
    expect(rebuilt.operationName).toBe('GetWidget');
  });
});

describe('Runtime.send request substitution reaches the wire (PIPE-14)', () => {
  test('the transport receives the substituted request, not the original', async () => {
    const original = aRequest('https://example.com/original');
    const substituted = aRequest('https://example.com/substituted');
    const substituteStep: Step = async (_request, ctx) => ctx.next(substituted);
    const descriptor: StepDescriptor = {type: Symbol('substitute'), stage: 'PRE_LOGGING', fn: substituteStep};
    const transport = new RecordingTransport(aResponse(200));

    await new Runtime([descriptor], transport).send(original);

    expect(transport.calls[0]?.request).toBe(substituted);
  });
});

describe('Runtime.steps (PIPE-25)', () => {
  test('exposes the exact flattened array it was constructed with', () => {
    const descriptor: StepDescriptor = {type: Symbol('probe'), stage: 'PRE_LOGGING', fn: async (_r, ctx) => ctx.next()};
    const runtime = new Runtime([descriptor], new RecordingTransport(aResponse(200)));

    expect(runtime.steps).toEqual([descriptor]);
  });
});

describe('Runtime.close (PIPE-27)', () => {
  test('never calls the underlying transport close', async () => {
    const transport = new RecordingTransport(aResponse(200));
    const runtime = new Runtime([], transport);

    await runtime.close();

    expect(transport.closeCalls).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/pipeline/runtime.test.ts`
Expected: FAIL — `Cannot find module './runtime.js'`.

- [ ] **Step 3: Write `runtime.ts`**

```typescript
// packages/core/src/pipeline/runtime.ts
import {
  createDispatchContext,
  createRequestContext,
  promoteToExchange,
  promoteToRequest,
  type ExecutionContext,
  type RequestContext,
} from '../context/context.js';
import {contextStore} from '../context/store.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {Cursor} from './cursor.js';
import type {StepDescriptor} from './step.js';

/**
 * The request context to promote from once the drive finishes: the original, unless a step substituted the
 * outbound request (PIPE-14), in which case an off-chain rebuild around the request that was actually sent,
 * pinned to the SAME call key (CTX-6's explicit-key path) and carrying the same instrumentation bundle by
 * reference (CTX-2/CTX-3). Promoting straight off the original would pair the response with a request that
 * never left the process, against CTX-1's "the exchange stage exposes the request and the response". Doing it
 * here rather than widening `promoteToExchange` with a request-override keeps promotion strictly additive.
 *
 * Exported (still `@internal`, still absent from the package barrel) so its two branches can be asserted as
 * the pure function they are. The alternative -- observing the exchange context end-to-end -- would require
 * patching `install` on the process-wide `contextStore` singleton, since `send()` evicts the entry in its own
 * `finally`.
 *
 * @internal
 */
export function exchangeSource(context: RequestContext, finalRequest: Request): RequestContext {
  if (finalRequest === context.request) return context;
  return createRequestContext(finalRequest, {
    key: context.key,
    instrumentation: context.instrumentation,
    operationName: context.operationName,
  });
}

/**
 * The built, immutable pipeline (PIPE-10, PIPE-25). Implements `Transport` itself (PIPE-26) -- Phase 2's
 * `Transport` SPI has one method (`send`), so there is no second `sendAsync` entry point to delegate through.
 * `close()` deliberately never touches the wrapped transport (PIPE-27): the pipeline never owns it.
 *
 * @internal
 */
export class Runtime implements Transport {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;

  constructor(steps: readonly StepDescriptor[], transport: Transport) {
    // PIPE-10/PIPE-25: the built runtime is immutable, and `get steps()` hands out a read-only view. Copying
    // and freezing here rather than trusting the caller makes both structural -- `PipelineBuilder` is not the
    // only construction site (tests build one directly, and Phase 5+ may too), so an unfrozen array passed in
    // would leave the "immutable after construction" guarantee resting on caller discipline.
    this.#steps = Object.freeze([...steps]);
    this.#transport = transport;
  }

  async send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> {
    if (this.#steps.length === 0) {
      // PIPE-9: an empty pipeline dispatches directly to the terminal transport, no cursor allocated.
      return this.#transport.send(request, options, signal);
    }
    const dispatchContext = createDispatchContext();
    const requestContext = promoteToRequest(dispatchContext, request);
    contextStore.install(requestContext); // CTX-17's positive half: the first store entry, at the first promotion.
    let currentContext: ExecutionContext = requestContext; // tracks the latest install for the finally below.
    try {
      const cursor = new Cursor({
        steps: this.#steps,
        transport: this.#transport,
        request,
        context: requestContext,
        options,
        signal,
      });
      const response = await cursor.advance();
      // PIPE-14: a step may have substituted the outbound request -- promote from whatever was actually sent.
      const exchangeContext = promoteToExchange(exchangeSource(requestContext, cursor.request), response);
      contextStore.install(exchangeContext); // install-or-replace under the same key (CTX-8).
      currentContext = exchangeContext;
      return response;
    } finally {
      contextStore.close(currentContext); // always the most recently installed context for this call.
    }
  }

  async close(): Promise<void> {
    // PIPE-27: the pipeline never owns its transport and MUST NOT close it.
  }

  get steps(): readonly StepDescriptor[] {
    return this.#steps; // PIPE-25: "exposes a read-only, ordered view of its steps."
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/pipeline/runtime.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/runtime.ts packages/core/src/pipeline/runtime.test.ts
git commit -m "feat(core): add Runtime, the Transport-implementing built pipeline (PIPE-9, PIPE-10, PIPE-25..27)"
```

---

### Task 5: `pipeline/builder.ts`

**Files:**
- Create: `packages/core/src/pipeline/builder.ts`
- Create: `packages/core/src/pipeline/builder.test.ts`

**Interfaces:**
- Consumes: `Runtime` (Task 4), `StepDescriptor` (Task 3, type-only), `Stage`/`STAGE_ORDER`/`PILLAR_STAGES`
  (Task 1), `AnchorNotFoundError`/`CrossStageEditError`/`PillarCollisionError`/`ReservedStageError` (Task 2),
  `Transport` (external), `invariant` (`../invariant.js`).
- Produces: `class PipelineBuilder` with `append`/`prepend`/`appendAll`/`prependAll`/`insertAfter`/
  `insertBefore`/`replace`/`remove`/`reload`/`build`. Not consumed by any other task in this plan — Phase 5+
  is the first real caller.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pipeline/builder.test.ts
// Exercises: PIPE-4/5/6 (a pillar admits at most one step; a distinct collision throws; the same type is
// idempotent), PIPE-7 (non-pillar stages preserve insertion order through append/prepend), PIPE-8 (SEND
// rejects any insertion), PIPE-18/19 (insertAfter/insertBefore/replace act relative to the first anchor
// instance; cross-stage is rejected), PIPE-20 (remove deletes every instance, no-op when absent), PIPE-21
// (a missing anchor fails), PIPE-22 (an edit sequence flattens the same as constructing the final set from
// scratch), PIPE-23 (a colliding reload leaves prior content untouched, and a same-type pillar repeat inside
// one batch seats only one step), PIPE-25 (flatten order), PIPE-38 (appendAll preserves batch order;
// prependAll reverses it), PIPE-1/PIPE-2 (a built pipeline, driven: entry in STAGE_ORDER, exit reversed)
import {afterEach, describe, expect, test} from 'bun:test';
import {contextStore} from '../context/store.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import type {Transport} from '../seams/transport.js';
import {PipelineBuilder} from './builder.js';
import {AnchorNotFoundError, CrossStageEditError, PillarCollisionError, ReservedStageError} from './errors.js';
import type {Runtime} from './runtime.js';
import {STAGE_ORDER} from './stage.js';
import type {Step, StepDescriptor} from './step.js';

function aRequest(url: string): Request {
  return Request.newBuilder().url(url).build();
}

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(aRequest('https://example.com'))
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

class StubTransport implements Transport {
  #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  async send(): Promise<Response> {
    return this.#response;
  }

  async close(): Promise<void> {}
}

// A driven pipeline installs a context per call; keep the process-wide singleton clean between tests.
afterEach(() => {
  contextStore.clear();
});

const noopStep: Step = async (_request, ctx) => ctx.next();

function descriptor(label: string, stage: StepDescriptor['stage']): StepDescriptor {
  return {type: Symbol(label), stage, fn: noopStep};
}

function labelsOf(runtime: Runtime): Array<string | undefined> {
  return runtime.steps.map((d) => d.type.description);
}

function aBuilder(): PipelineBuilder {
  return new PipelineBuilder(new StubTransport(aResponse(200)));
}

describe('PipelineBuilder pillar rules (PIPE-4, PIPE-5, PIPE-6)', () => {
  test('a pillar stage admits at most one step', () => {
    const builder = aBuilder().append(descriptor('a', 'RETRY'));

    expect(builder.build().steps).toHaveLength(1);
  });

  test('installing a distinct second step onto an occupied pillar throws, naming both types', () => {
    const builder = aBuilder();
    const a = descriptor('a', 'RETRY');
    const b = descriptor('b', 'RETRY');
    builder.append(a);

    try {
      builder.append(b);
      throw new Error('unreachable -- append must throw for a distinct pillar collision');
    } catch (error) {
      expect(error).toBeInstanceOf(PillarCollisionError);
      expect((error as PillarCollisionError).existingType).toBe(a.type);
      expect((error as PillarCollisionError).incomingType).toBe(b.type);
    }
  });

  test('re-installing the identical descriptor type onto its own pillar is an idempotent no-op', () => {
    const builder = aBuilder();
    const a = descriptor('a', 'RETRY');

    builder.append(a).append(a);

    expect(builder.build().steps).toHaveLength(1);
  });
});

describe('PipelineBuilder non-pillar ordering (PIPE-7)', () => {
  test('append adds to the tail, prepend adds to the head, within one stage', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const c = descriptor('c', 'PRE_LOGGING');

    const runtime = aBuilder().append(a).append(c).prepend(b).build();

    expect(labelsOf(runtime)).toEqual(['b', 'a', 'c']);
  });
});

describe('PipelineBuilder batch edits (PIPE-38)', () => {
  test('appendAll preserves the batch iteration order', () => {
    const steps = ['a', 'b', 'c'].map((label) => descriptor(label, 'PRE_LOGGING'));

    const runtime = aBuilder().appendAll(steps).build();

    expect(labelsOf(runtime)).toEqual(['a', 'b', 'c']);
  });

  test('prependAll results in the reversed batch order', () => {
    const steps = ['a', 'b', 'c'].map((label) => descriptor(label, 'PRE_LOGGING'));

    const runtime = aBuilder().prependAll(steps).build();

    expect(labelsOf(runtime)).toEqual(['c', 'b', 'a']);
  });
});

describe('PipelineBuilder anchor edits (PIPE-18, PIPE-19, PIPE-21)', () => {
  test('insertAfter/insertBefore act relative to the FIRST existing instance of the anchor type', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const builder = aBuilder().append(a).append(b);

    builder.insertAfter(a.type, descriptor('c', 'PRE_LOGGING'));
    builder.insertBefore(a.type, descriptor('d', 'PRE_LOGGING'));

    expect(labelsOf(builder.build())).toEqual(['d', 'a', 'c', 'b']);
  });

  test('insertAfter/insertBefore/replace reject a cross-stage edit', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const builder = aBuilder().append(a);
    const wrongStage = descriptor('x', 'POST_LOGGING');

    expect(() => builder.insertAfter(a.type, wrongStage)).toThrow(CrossStageEditError);
    expect(() => builder.insertBefore(a.type, wrongStage)).toThrow(CrossStageEditError);
    expect(() => builder.replace(a.type, wrongStage)).toThrow(CrossStageEditError);
  });

  test('an anchor edit against a missing type throws AnchorNotFoundError', () => {
    const builder = aBuilder();
    const missing = Symbol('missing');

    expect(() => builder.insertAfter(missing, descriptor('x', 'PRE_LOGGING'))).toThrow(AnchorNotFoundError);
    expect(() => builder.replace(missing, descriptor('x', 'PRE_LOGGING'))).toThrow(AnchorNotFoundError);
  });

  test('replace swaps the anchor step in place, same stage, same position', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const builder = aBuilder().append(a).append(b);

    builder.replace(a.type, descriptor('a2', 'PRE_LOGGING'));

    expect(labelsOf(builder.build())).toEqual(['a2', 'b']);
  });
});

describe('PipelineBuilder remove (PIPE-20)', () => {
  test('deletes every instance of a type, preserving relative order of the rest', () => {
    const a1 = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const a2: StepDescriptor = {type: a1.type, stage: 'POST_LOGGING', fn: noopStep};
    const builder = aBuilder().appendAll([a1, b]).append(a2);

    builder.remove(a1.type);

    expect(labelsOf(builder.build())).toEqual(['b']);
  });

  test('is a no-op when the type is absent', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const builder = aBuilder().append(a);

    expect(() => builder.remove(Symbol('absent'))).not.toThrow();
    expect(labelsOf(builder.build())).toEqual(['a']);
  });
});

describe('PipelineBuilder reload (PIPE-23)', () => {
  test('a colliding batch leaves the existing collection completely unchanged', () => {
    const builder = aBuilder().append(descriptor('original', 'PRE_LOGGING'));

    expect(() => builder.reload([descriptor('x', 'RETRY'), descriptor('y', 'RETRY')])).toThrow(PillarCollisionError);
    expect(labelsOf(builder.build())).toEqual(['original']);
  });

  test('a valid batch fully replaces the prior collection', () => {
    const builder = aBuilder().append(descriptor('stale', 'PRE_LOGGING'));

    builder.reload([descriptor('fresh', 'POST_LOGGING')]);

    expect(labelsOf(builder.build())).toEqual(['fresh']);
  });

  test('a batch repeating the SAME pillar type installs it once, not twice (PIPE-4, PIPE-6)', () => {
    const retry = descriptor('retry', 'RETRY');
    const builder = aBuilder();

    builder.reload([retry, retry]);

    // PIPE-4: a pillar admits at most one step. The incremental `append` path already treats a same-type
    // re-install as an idempotent no-op (PIPE-6); a bulk reload must not be the back door that seats two.
    expect(labelsOf(builder.build())).toEqual(['retry']);
  });
});

describe('PipelineBuilder reserved SEND stage (PIPE-8)', () => {
  test('rejects any insertion targeting SEND', () => {
    const sendShaped = descriptor('x', 'SEND');

    expect(() => aBuilder().append(sendShaped)).toThrow(ReservedStageError);
    expect(() => aBuilder().prepend(sendShaped)).toThrow(ReservedStageError);
    expect(() => aBuilder().reload([sendShaped])).toThrow(ReservedStageError);
  });
});

describe('PipelineBuilder.build() flatten order (PIPE-1, PIPE-25)', () => {
  test('flattens stages in declaration order regardless of append order', () => {
    const preRedirect = descriptor('pre-redirect', 'PRE_REDIRECT');
    const postSerde = descriptor('post-serde', 'POST_SERDE');

    const runtime = aBuilder().append(postSerde).append(preRedirect).build();

    expect(labelsOf(runtime)).toEqual(['pre-redirect', 'post-serde']);
  });

  // PIPE-1/PIPE-2's conformance clause, in the one place that can express it: a built pipeline actually
  // driven. Entry is the stage list top-down, exit is its exact reverse, with insertion order deliberately
  // the reverse of declaration order so a flatten that leaked insertion order would fail loudly.
  test('one probe step per stage enters in STAGE_ORDER and exits in its exact reverse', async () => {
    const stages = STAGE_ORDER.filter((stage) => stage !== 'SEND');
    const log: string[] = [];
    const builder = aBuilder();
    for (const stage of [...stages].reverse()) {
      builder.append({
        type: Symbol(stage),
        stage,
        fn: async (_request, ctx) => {
          log.push(`enter:${stage}`);
          const response = await ctx.next();
          log.push(`exit:${stage}`);
          return response;
        },
      });
    }

    await builder.build().send(aRequest('https://example.com'));

    expect(log).toEqual([
      ...stages.map((stage) => `enter:${stage}`),
      ...[...stages].reverse().map((stage) => `exit:${stage}`),
    ]);
  });
});

describe('PipelineBuilder edit-order independence (PIPE-22)', () => {
  test('an edit sequence flattens the same as constructing the final set from scratch', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const c = descriptor('c', 'POST_LOGGING');

    const edited = new PipelineBuilder(new StubTransport(aResponse(200))).append(a).append(c).prepend(b).build();
    const fromScratch = new PipelineBuilder(new StubTransport(aResponse(200))).appendAll([b, a, c]).build();

    expect(labelsOf(edited)).toEqual(labelsOf(fromScratch));
    expect(labelsOf(edited)).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/pipeline/builder.test.ts`
Expected: FAIL — `Cannot find module './builder.js'`.

- [ ] **Step 3: Write `builder.ts`**

```typescript
// packages/core/src/pipeline/builder.ts
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {AnchorNotFoundError, CrossStageEditError, PillarCollisionError, ReservedStageError} from './errors.js';
import {Runtime} from './runtime.js';
import {PILLAR_STAGES, STAGE_ORDER, type Stage} from './stage.js';
import type {StepDescriptor} from './step.js';

interface AnchorLocation {
  readonly stage: Stage;
  readonly index: number;
}

/**
 * Assembles a stage-based pipeline via surgical edits (PIPE-7, PIPE-18..PIPE-24), flattening into an
 * immutable Runtime at build() time (PIPE-25). Mutable while being built; the produced Runtime is frozen.
 *
 * @internal
 */
export class PipelineBuilder {
  readonly #buckets = new Map<Stage, StepDescriptor[]>();
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  append(descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'append');
    if (this.#checkPillarSlot(descriptor.stage, descriptor.type) === 'occupied-same-type') return this;
    this.#insertAt(descriptor.stage, descriptor, 'tail');
    return this;
  }

  prepend(descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'prepend');
    if (this.#checkPillarSlot(descriptor.stage, descriptor.type) === 'occupied-same-type') return this;
    this.#insertAt(descriptor.stage, descriptor, 'head');
    return this;
  }

  /** PIPE-38: batch iteration order preserved within a stage. */
  appendAll(descriptors: readonly StepDescriptor[]): this {
    for (const descriptor of descriptors) this.append(descriptor);
    return this;
  }

  /** PIPE-38: each element prepended individually -- the batch order comes out reversed, by construction. */
  prependAll(descriptors: readonly StepDescriptor[]): this {
    for (const descriptor of descriptors) this.prepend(descriptor);
    return this;
  }

  insertAfter(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'insertAfter');
    const anchor = this.#requireAnchor(anchorType, 'insertAfter');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    if (this.#checkPillarSlot(descriptor.stage, descriptor.type) === 'occupied-same-type') return this;
    const bucket = this.#buckets.get(anchor.stage);
    invariant(bucket !== undefined, 'anchor stage bucket must exist -- #requireAnchor just located an entry in it');
    bucket.splice(anchor.index + 1, 0, descriptor);
    return this;
  }

  insertBefore(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'insertBefore');
    const anchor = this.#requireAnchor(anchorType, 'insertBefore');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    if (this.#checkPillarSlot(descriptor.stage, descriptor.type) === 'occupied-same-type') return this;
    const bucket = this.#buckets.get(anchor.stage);
    invariant(bucket !== undefined, 'anchor stage bucket must exist -- #requireAnchor just located an entry in it');
    bucket.splice(anchor.index, 0, descriptor);
    return this;
  }

  replace(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'replace');
    const anchor = this.#requireAnchor(anchorType, 'replace');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    const bucket = this.#buckets.get(anchor.stage);
    invariant(bucket !== undefined, 'anchor stage bucket must exist -- #requireAnchor just located an entry in it');
    bucket.splice(anchor.index, 1, descriptor);
    return this;
  }

  /** PIPE-20: deletes every instance of `type`, preserving relative order; a no-op when absent. */
  remove(type: symbol): this {
    for (const [stage, bucket] of this.#buckets) {
      const filtered = bucket.filter((entry) => entry.type !== type);
      if (filtered.length !== bucket.length) this.#buckets.set(stage, filtered);
    }
    return this;
  }

  /** PIPE-23: all-or-nothing -- validated fully before any existing content is touched. */
  reload(descriptors: readonly StepDescriptor[]): this {
    const admitted: StepDescriptor[] = [];
    const pillarTypes = new Map<Stage, symbol>();
    for (const desc of descriptors) {
      this.#rejectReservedStage(desc.stage, 'reload');
      if (!PILLAR_STAGES.has(desc.stage)) {
        admitted.push(desc);
        continue;
      }
      const seenType = pillarTypes.get(desc.stage);
      if (seenType === desc.type) continue; // PIPE-6: a repeat of the SAME type is idempotent, not a second step.
      if (seenType !== undefined) throw new PillarCollisionError(desc.stage, seenType, desc.type); // PIPE-5
      pillarTypes.set(desc.stage, desc.type);
      admitted.push(desc);
    }
    // PIPE-4: `admitted` holds at most one entry per pillar stage by construction -- a same-type repeat was
    // skipped above rather than pushed, so a batch cannot install two steps onto one pillar the way the
    // incremental `append` path already refuses to.
    this.#buckets.clear();
    for (const desc of admitted) {
      const bucket = this.#buckets.get(desc.stage);
      if (bucket === undefined) this.#buckets.set(desc.stage, [desc]);
      else bucket.push(desc);
    }
    return this;
  }

  /** PIPE-25: flattens stage buckets in declaration order, skipping SEND, into an immutable Runtime. */
  build(): Runtime {
    const flattened: StepDescriptor[] = [];
    for (const stage of STAGE_ORDER) {
      if (stage === 'SEND') continue; // PIPE-8: terminal, reserved, flattening skips it.
      const bucket = this.#buckets.get(stage);
      if (bucket !== undefined) flattened.push(...bucket);
    }
    return new Runtime(flattened, this.#transport); // Runtime copies and freezes -- PIPE-10/PIPE-25.
  }

  #rejectReservedStage(stage: Stage, operation: string): void {
    if (stage === 'SEND') throw new ReservedStageError(operation); // PIPE-8
  }

  #checkPillarSlot(stage: Stage, type: symbol): 'ok' | 'occupied-same-type' {
    if (!PILLAR_STAGES.has(stage)) return 'ok';
    const bucket = this.#buckets.get(stage);
    if (bucket === undefined || bucket.length === 0) return 'ok';
    const occupant = bucket[0];
    invariant(occupant !== undefined, 'pillar bucket has non-zero length but its first element is undefined');
    if (occupant.type === type) return 'occupied-same-type'; // PIPE-6: idempotent re-installation.
    throw new PillarCollisionError(stage, occupant.type, type); // PIPE-5
  }

  #insertAt(stage: Stage, descriptor: StepDescriptor, where: 'head' | 'tail'): void {
    const bucket = this.#buckets.get(stage);
    if (bucket === undefined) {
      this.#buckets.set(stage, [descriptor]);
      return;
    }
    if (where === 'tail') bucket.push(descriptor);
    else bucket.unshift(descriptor);
  }

  #requireAnchor(type: symbol, operation: string): AnchorLocation {
    for (const stage of STAGE_ORDER) {
      const bucket = this.#buckets.get(stage);
      if (bucket === undefined) continue;
      const index = bucket.findIndex((entry) => entry.type === type);
      if (index !== -1) return {stage, index};
    }
    throw new AnchorNotFoundError(type, operation); // PIPE-21
  }

  #requireSameStage(anchorStage: Stage, incomingStage: Stage): void {
    if (anchorStage !== incomingStage) throw new CrossStageEditError(anchorStage, incomingStage); // PIPE-18/19
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/pipeline/builder.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pipeline/builder.ts packages/core/src/pipeline/builder.test.ts
git commit -m "feat(core): add PipelineBuilder (PIPE-7, PIPE-18..PIPE-25, PIPE-38)"
```

---

### Task 6: Full gate verification

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
! grep -rn "from 'node:" packages/core/src/pipeline/
```

Expected: exit 0, no matches.

- [ ] **Step 3: Verify no TypeScript `enum` crept in**

```bash
! grep -rn "^enum \|^export enum " packages/core/src/pipeline/
```

Expected: exit 0, no matches — `Stage` must stay a string-literal union, never an `enum`.

- [ ] **Step 4: Verify the public API surface did not move**

Step 1 already regenerated the report via `bun run api`; this only inspects the result. Run from the repo root:

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
git diff --exit-code packages/core/etc/core.api.md
```

Expected: **no output, exit 0.** Nothing from `src/pipeline/` reached the published surface — matching Phase
3a's/4a's/4b's gate. If this fails, remove whatever export leaked into `packages/core/src/index.ts` rather than
accepting the report change.

- [ ] **Step 5: Add a changeset**

Because nothing enters the public API, this is a patch-level, no-consumer-impact change:

```bash
bun run changeset
```

Select `@dexpace/core`, choose **patch**, summary:
`Internal: stage-based pipeline runtime for product-spec §8.1 (PIPE-1..40). No public API change.`

- [ ] **Step 6: Commit**

```bash
git add .changeset/
git commit -m "chore(core): verify full gate sequence for Phase 4c"
```

---

## Self-Review

**Spec coverage** — every `PIPE-N` in `§8.1`, mapped to its task or its disposition:

- `PIPE-1`, `PIPE-2`, `PIPE-3` → Task 1 (`Stage` union, `STAGE_ORDER`, the pre/post extension slots) and Task 5
  (the driven probe test: entry in `STAGE_ORDER`, exit its exact reverse). `PIPE-2`'s redirect/retry half needs
  a real pillar step and is deferred to Phase 5/6 in the roadmap's log.
- `PIPE-4`, `PIPE-5`, `PIPE-6` → Task 5 (`#checkPillarSlot`: at most one step per pillar; a distinct type
  throws `PillarCollisionError`; a reference-identical `type` symbol is an idempotent no-op — and `reload()`
  applies the same cap inside a single batch).
- `PIPE-7` → Task 5 (`append`/`prepend` on a stage bucket preserve insertion order).
- `PIPE-8` → Task 1 (`SEND` in `STAGE_ORDER`), Task 2 (`ReservedStageError`), Task 5 (`#rejectReservedStage`
  on every insertion path, plus `build()`'s flatten-time skip as defense in depth).
- `PIPE-9` → Task 4 (`Runtime.send`'s zero-step fast path — no `Cursor`, and no context installed, since with
  no steps there is no promotion for `CTX-17` to hang the first store entry on).
- `PIPE-10`, `PIPE-11` → Task 3 and Task 4 (one fresh `Cursor` per `send()`; `Runtime` holds no mutable
  per-call state; the one-shot guard lives on the continuation closure, not the `Cursor`).
- `PIPE-12` → Task 3 (`Step`'s `(request, ctx)` shape: read the request, optionally drive the chain,
  inspect or substitute the response, or short-circuit by never calling `next`).
- `PIPE-13` → Task 3 (`#dispatch`'s exhaustion branch dispatches to the terminal transport, threading
  `#request`/`#options`/`#signal`; the cursor only moves forward within one un-forked drive).
- `PIPE-14` → Task 3 (`Next`'s optional replacement `Request`, stored in the single mutable `#request` shared
  by the whole drive) and Task 4 (`exchangeSource` promotes the exchange context off the request that was
  actually sent — exported `@internal` and unit-tested directly, so no test has to patch the process-wide
  `contextStore` to observe a context `send()` evicts in its own `finally`).
- `PIPE-15`, `PIPE-16` → Task 3 (`ctx.fork` only for pillar-stage descriptors; every `fork()` call returns a
  fresh one-shot continuation pinned to the same target position; reusing one throws
  `CursorAlreadyAdvancedError`).
- `PIPE-17` → Task 3 (`#options` is read-only and shared by every fork, never copied-and-diverged; the
  two-fork test asserts the identical options object reaches both terminal dispatches).
- `PIPE-18`, `PIPE-19`, `PIPE-21` → Task 5 (`insertAfter`/`insertBefore`/`replace` against the first anchor
  instance; `CrossStageEditError` on a cross-stage edit; `AnchorNotFoundError` on a missing anchor).
- `PIPE-20` → Task 5 (`remove` filters every instance of a type, order-preserving, a no-op when absent).
- `PIPE-22` → Task 5 (structural: flattening is a pure function of the buckets' contents, asserted by the
  edit-order-independence property test).
- `PIPE-23` → Task 5 (`reload` validates the whole batch before `#buckets.clear()`).
- `PIPE-24`, `PIPE-39` → **not shipped** (no standard-resilience preset until real pillar steps exist).
- `PIPE-25` → Task 5 (`build()` flattens in `STAGE_ORDER`, skipping `SEND`) and Task 4 (`Runtime`'s
  constructor copies and freezes the array, so immutability holds for every construction site rather than
  only the builder's; `get steps()` hands out that frozen view).
- `PIPE-26`, `PIPE-27` → Task 4 (`Runtime implements Transport` with one `send()`; `close()` never touches the
  wrapped transport).
- `PIPE-28`, `PIPE-29`, `PIPE-30` → satisfied structurally, no code: one `STAGE_ORDER` means no second runtime
  can re-derive ordering, and every `Step` being `async` means no step can throw synchronously. `PIPE-30`'s
  fatal-error clause has no Node analogue — see the design's Scope.
- `PIPE-31`, `PIPE-32`, `PIPE-33`, `PIPE-34` → **not applicable** under the single-execution-model collapse
  (no async mirror to bridge to or from). Design ledger, rows 2 and 3.
- `PIPE-35` → **deferred on its own merits** (not an async/bridge disposition). Roadmap Deferred Items Log.
- `PIPE-36`, `PIPE-37` → placement/locking contracts on whichever future phase ships the first pillar step
  family; 4c ships none. Design Scope.
- `PIPE-38` → Task 5 (`appendAll` preserves batch order; `prependAll` reverses it, by construction).
- `PIPE-40` → Task 3 documents the responsibility on the forking step (not on `Cursor`/`Runtime`); its
  2-hop-redirect conformance clause needs a redirect step and is deferred with `PIPE-2`'s second half.
- `CTX-17`'s positive half (deferred into 4c by 4a) → Task 4 (`contextStore.install(requestContext)`
  immediately after the first promotion), plus `CTX-8`'s replace-under-the-same-key on the exchange promotion
  and `CTX-9`/`CTX-10`'s identity-conditional evict in the `finally`.

**Placeholder scan:** no `TBD`/`TODO`, no "add appropriate error handling." Every step has real code.

**Type consistency:** `StepDescriptor`'s three fields (Task 3) are the only ones read in Tasks 4 and 5 — no
drift. `CursorInit`'s field names match every construction site in `cursor.test.ts` and `runtime.ts`.
`Stage` values used in tests (`PRE_LOGGING`, `POST_LOGGING`, `RETRY`, `POST_RETRY`, `PRE_REDIRECT`,
`POST_SERDE`, `SEND`) are all members of the Task 1 union. `Runtime`'s `send`/`close` signatures match Phase 2's
`Transport` SPI exactly, which is what `implements Transport` checks.

**Lint-gate pre-check** (the failure modes this plan's shapes were chosen to avoid):

- `max-params` 3 — `Cursor(init)` is 1, `Runtime(steps, transport)` is 2, `PipelineBuilder(transport)` is 1,
  every builder edit method is 1 or 2, `#continuationAt(targetPosition, ownerStage)` is 2. No `eslint-disable`
  anywhere in this phase.
- `max-depth` 3 — deepest is `reload`'s `for` containing an `if`; the pillar checks are extracted into
  `#checkPillarSlot` rather than nested inline.
- `max-lines-per-function` 70 — longest is `PipelineBuilder.reload` at roughly 25 lines.
- `noUncheckedIndexedAccess` — every array/`Map` lookup that control flow proves non-`undefined`
  (`#dispatch`'s `#steps[position]`, `#checkPillarSlot`'s `bucket[0]`, the anchor-bucket lookups) narrows via
  `invariant()`, never a non-null assertion.
- Explicit return types on every export, including `get steps()` and `get request()`.
- No constructor parameter properties (`erasableSyntaxOnly`): every class, production and test-local, assigns
  fields in the constructor body.
- No TypeScript `enum`: `Stage` is a string-literal union, gated by Task 6 Step 3.
