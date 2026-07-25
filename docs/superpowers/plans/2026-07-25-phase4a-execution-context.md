# Phase 4a — Execution Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the execution context promotion chain and its bounded process-wide store in `@dexpace/core` —
`DispatchContext`/`RequestContext`/`ExchangeContext`, the `InstrumentationBundle` shape, and `ContextStore` —
satisfying `product-spec/07-execution-context-model.md` (`CTX-1`–`CTX-20`), per
`docs/superpowers/specs/2026-07-25-phase4a-execution-context-design.md`.

**Architecture:** A new `packages/core/src/context/` folder, layered `instrumentation` → `errors` → `context` →
`store` → `index`. The three context flavors are plain frozen interfaces plus free functions — no class, since
nothing here owns a lifecycle or needs runtime-forgery protection (unlike `Request`/`Response`). `ContextStore` is
the one class: a bounded `Map`, exported both as the class (for isolated test instances) and as a process-wide
singleton (`contextStore`). **Nothing in this phase enters the public package barrel** — `context/` is
SDK-internal correlation plumbing; `api-extractor`'s committed report must come back byte-identical.

**Tech Stack:** TypeScript 5.8+, native `Symbol`/`Map`/`Object.freeze`. No new runtime dependencies — `SEAM-1`
untouched. Nothing here is runtime-divergent (no streams, no timers, no `AbortSignal`), so this phase adds no
`test:node` conformance cases.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, and 3b are already implemented exactly as their own plans
specify. Concretely: `packages/core/src/http/*` exports `DexpaceError`, `Request`, `Response`; the full gate
sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/`verify:dual-consumption`/
`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **Nothing from `src/context/` is exported from `packages/core/src/index.ts`.** Each file's exports are marked
  `@internal` and imported file-by-file by internal consumers (Phase 4c) — there is **no `src/context/index.ts`
  barrel**, per `docs/knowledge/module-organization.md:18`. The mechanical check is that
  `packages/core/etc/core.api.md` is **byte-identical** before and after this phase (Task 5), matching Phase 3a's
  gate, not Phase 3b's.
- **No shared base class between `DispatchContext`/`RequestContext`/`ExchangeContext`.** They are a discriminated
  union of plain frozen object literals (`styleguide/typescript/06` §6.5), never classes — nothing here owns
  mutable state or a lifecycle, so root rule 1's "data and functions, not objects" default applies with no
  exception to justify (contrast with 3b's `Body`, whose variants needed classes for real internal state like
  `StreamBody`'s consumed-once flag).
- **Call keys are `Symbol()`, never a string composed from trace/span ids.** Every off-chain constructor defaults
  `init.key` to a fresh `Symbol(...)` per call.
- **The three `create*` functions take a trailing `ContextInit` options object, never positional
  `instrumentation`/`key`/`operationName` parameters.** ESLint's `max-params` is 3 and counts optional and
  defaulted parameters, so a positional `createExchangeContext(request, response, operationName?,
  instrumentation?, key?)` is a 5-param lint failure. Phase 1's plan closes the escape hatch explicitly — "do not
  disable `max-params` on anything but these private [builder-internal] constructors" — and these are neither
  private nor constructors. The options object also keeps the three signatures uniform (contrast the positional
  form, which forced `operationName: string | undefined = undefined` on `createRequestContext` but
  `operationName?: string` on `promoteToRequest`).
- **`InstrumentationBundle.activeSpan`/`tracerFactory` are typed `unknown`.** Do not invent `Span`/`Tracer`
  interfaces this phase — that is deferred to Phase 7 (roadmap's Deferred Items Log). `activeSpan` is
  `undefined` rather than a no-op span *object*: with the type deferred there is no shape to make a no-op of, and
  absence is the only honest encoding. This is a knowing partial deviation from `CTX-15`'s "a no-op span" —
  logged in the design's Deviation Ledger for Phase 10, not an oversight to fix here.
- **No `contextsEqual()` utility.** Not scheduled to any phase; build only if 4b or 4c turns out to need one.
- **`ContextStore` is a plain `Map`, no locking primitive.** Node's single-threaded event loop makes every
  synchronous `Map` mutation atomic with respect to other JS execution; this satisfies `CTX-7`'s thread-safety
  requirement by construction. Do not add a mutex/semaphore.
- **The drain loop runs after every successful insert, in both `install` and `installIfAbsent`.** A single
  check-then-evict is insufficient (`CTX-12`); do not "optimize" it into one.
- **`ContextStore`'s constructor rejects `maxEntries < 1`.** This is what lets `#drain` be a bare
  `while (size > max) delete(firstKey)` with no defensive `undefined` guard inside: for any `maxEntries >= 1` the
  loop condition already proves the map is non-empty, so a guard would be unreachable code the coverage gate
  cannot exercise. Validate at the boundary instead of guarding in the loop.
- **`promoteToRequest`/`promoteToExchange` do NOT call `ContextStore.install`.** 4a satisfies only `CTX-17`'s
  negative half (constructing a dispatch context must not auto-register it); the positive half ("the first store
  entry is installed by the first promotion") needs the pipeline that owns the store handle, which is 4c. Do not
  wire the store into `context.ts` to "finish" `CTX-17` — that would give `context.ts` a dependency on `store.ts`
  and make every promotion a global side effect. The deferral is tracked in the Self-Review's `CTX-17` row.
- **`ContextStore.close()` never throws, under any input — unknown key, already-removed key, or a
  no-longer-current (intermediate) context are all well-defined no-ops** (`CTX-9`, `CTX-10`, `CTX-18`).
- Typed `Error` subclasses only (styleguide ch08); `cause` chaining on wrap-and-rethrow; `this.name =
  new.target.name` (inherited from `DexpaceError`'s constructor).
- `exactOptionalPropertyTypes: true` — optional properties are spelled `?: T | undefined`, never bare `?: T`.
- Every test file's top-of-file comment cites the `CTX-N` IDs it exercises.
- Existing lint/coverage gates apply unchanged: `max-lines-per-function` 70, `max-depth` 3, `max-params` 3,
  explicit return types on exports, 80% aggregate coverage floor (`NFR-5`).

---

## File Structure

```
packages/core/src/context/
  instrumentation.ts     # InstrumentationBundle, noopInstrumentationBundle          (Task 1)
  instrumentation.test.ts
  errors.ts               # DuplicateContextKeyError                                 (Task 2)
  errors.test.ts
  context.ts               # DispatchContext/RequestContext/ExchangeContext, create*/promote* (Task 3)
  context.test.ts
  store.ts                 # ContextStore, contextStore singleton                    (Task 4)
  store.test.ts
```

No `context/index.ts`. `docs/knowledge/module-organization.md:18` bans internal barrels outright — "Never create
internal barrels (an `index.ts` in every folder); import the specific file directly instead" — and the ban applies
regardless of whether the barrel is further re-exported. Phase 4c imports `../context/context.js` and
`../context/store.js` directly. Task 5 runs the full gate sequence — no barrel file to write.

---

### Task 1: `context/instrumentation.ts`

**Files:**
- Create: `packages/core/src/context/instrumentation.ts`
- Create: `packages/core/src/context/instrumentation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface InstrumentationBundle`, `const noopInstrumentationBundle: InstrumentationBundle`. Task 3
  imports both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/context/instrumentation.test.ts
// Exercises: CTX-14 (bundle shape), CTX-15 (no-op default: invalid sentinels, isValid/isRemote false,
// no-op span/tracer factory), CTX-20 (tracer factory safe to invoke concurrently, emits nothing)
import {describe, expect, test} from 'bun:test';
import {noopInstrumentationBundle} from './instrumentation.js';

describe('noopInstrumentationBundle (CTX-15)', () => {
  test('reserves all-zero trace/span ids and zero flags', () => {
    expect(noopInstrumentationBundle.traceId).toBe('00000000000000000000000000000000');
    expect(noopInstrumentationBundle.spanId).toBe('0000000000000000');
    expect(noopInstrumentationBundle.traceFlags).toBe(0);
    expect(noopInstrumentationBundle.traceState).toBe('');
  });

  test('is invalid and not remote', () => {
    expect(noopInstrumentationBundle.isValid).toBe(false);
    expect(noopInstrumentationBundle.isRemote).toBe(false);
  });

  // CTX-15 says "a no-op span". With `activeSpan` typed `unknown` until a real tracing adapter lands
  // (Phase 7), there is no Span shape to build a no-op instance of, so absence is the encoding. Logged as a
  // partial deviation in the design's Deviation Ledger -- revisit when the adapter defines Span.
  test('has no active span', () => {
    expect(noopInstrumentationBundle.activeSpan).toBeUndefined();
  });

  test('tracerFactory emits nothing and is safe to invoke repeatedly (CTX-20)', () => {
    expect(noopInstrumentationBundle.tracerFactory('op-a')).toBeUndefined();
    expect(noopInstrumentationBundle.tracerFactory('op-b')).toBeUndefined();
  });

  test('is frozen', () => {
    expect(Object.isFrozen(noopInstrumentationBundle)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/context/instrumentation.test.ts`
Expected: FAIL — `Cannot find module './instrumentation.js'`.

- [ ] **Step 3: Write `instrumentation.ts`**

```typescript
// packages/core/src/context/instrumentation.ts

/**
 * Correlation/instrumentation bundle every execution context carries (CTX-14). `activeSpan` and
 * `tracerFactory` are typed `unknown` rather than a Span/Tracer interface -- nothing in this phase
 * consumes either, and a real tracing adapter (deferred to Phase 7) owns their eventual shape.
 *
 * @internal
 */
export interface InstrumentationBundle {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly traceState: string;
  readonly traceIdEncoding: string;
  readonly isValid: boolean;
  readonly isRemote: boolean;
  readonly activeSpan: unknown;
  readonly tracerFactory: (operationName: string) => unknown;
}

/**
 * The disabled-tracing default (CTX-15): reserved invalid sentinels, no-op span and tracer factory. Every
 * field is constant, so call-key uniqueness (CTX-4) must not depend on any of them -- see `context.ts`'s
 * `Symbol()`-based keys.
 *
 * @internal
 */
export const noopInstrumentationBundle: InstrumentationBundle = Object.freeze({
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  traceFlags: 0,
  traceState: '',
  traceIdEncoding: 'none',
  isValid: false,
  isRemote: false,
  activeSpan: undefined,
  tracerFactory: () => undefined,
});
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/context/instrumentation.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/instrumentation.ts packages/core/src/context/instrumentation.test.ts
git commit -m "feat(core): add InstrumentationBundle shape and no-op default (CTX-14, CTX-15, CTX-20)"
```

---

### Task 2: `context/errors.ts`

**Files:**
- Create: `packages/core/src/context/errors.ts`
- Create: `packages/core/src/context/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` (`../http/errors.js`).
- Produces: `class DuplicateContextKeyError extends DexpaceError`. Task 4 (`ContextStore.installIfAbsent`) throws
  it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/context/errors.test.ts
// Exercises: CTX-8 (reject-on-duplicate insert failure, naming the key)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {DuplicateContextKeyError} from './errors.js';

describe('DuplicateContextKeyError', () => {
  test('descends from DexpaceError and names the offending key', () => {
    const key = Symbol('call-1');
    const error = new DuplicateContextKeyError(key);
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.key).toBe(key);
    expect(error.message).toContain('call-1');
  });

  test('sets name from its own constructor', () => {
    expect(new DuplicateContextKeyError(Symbol('x')).name).toBe('DuplicateContextKeyError');
  });

  test('cause chains through', () => {
    const cause = new Error('boom');
    expect(new DuplicateContextKeyError(Symbol('x'), {cause}).cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/context/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write `errors.ts`**

```typescript
// packages/core/src/context/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * `installIfAbsent` found the key already occupied (CTX-8).
 *
 * @internal
 */
export class DuplicateContextKeyError extends DexpaceError {
  readonly key: symbol;

  constructor(key: symbol, options?: ErrorOptions) {
    super(`context key already registered: ${String(key)}`, options);
    this.key = key;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/context/errors.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/errors.ts packages/core/src/context/errors.test.ts
git commit -m "feat(core): add DuplicateContextKeyError (CTX-8)"
```

---

### Task 3: `context/context.ts` — the promotion chain

**Files:**
- Create: `packages/core/src/context/context.ts`
- Create: `packages/core/src/context/context.test.ts`

**Interfaces:**
- Consumes: `Request`/`Response` (`../http/*.js`, type-only), `InstrumentationBundle`/`noopInstrumentationBundle`
  (Task 1).
- Produces: `interface DispatchContext`, `RequestContext`, `ExchangeContext`, `type ExecutionContext`,
  `interface ContextInit`; `createDispatchContext(init?)`, `createRequestContext(request, init?)`,
  `createExchangeContext(request, response, init?)`, `promoteToRequest(context, request, operationName?)`,
  `promoteToExchange(context, response)`. Task 4 imports `ExecutionContext`.
- **Every `create*` takes its optional inputs as one trailing `ContextInit` object** (see Global Constraints):
  positional forms hit `max-params` 3 at 4 and 5 parameters respectively. `createDispatchContext` accepts
  `Omit<ContextInit, 'operationName'>` — `CTX-16` puts `operationName` at the request stage, so the dispatch
  factory must not even offer the field.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/context/context.test.ts
// Exercises: CTX-1 (one-way promotion, incl. the compile-time no-promote-back check), CTX-2 (additive,
// non-mutating, carries forward instrumentation + key), CTX-3 (one shared call key across the whole
// chain), CTX-5/CTX-6 (off-chain construction, fresh key per default call at population scale, explicit
// key pinning), CTX-7 (immutable), CTX-15 (keys stay call-unique though every bundle field is identical),
// CTX-16 (operationName absent at dispatch, introduced at request, carried forward, never keyed on)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {
  createDispatchContext,
  createExchangeContext,
  createRequestContext,
  promoteToExchange,
  promoteToRequest,
} from './context.js';
import {noopInstrumentationBundle} from './instrumentation.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function aResponse(request: Request): Response {
  return Response.newBuilder().request(request).protocol(Protocol.HTTP_1_1).status(Status.of(200)).build();
}

describe('promotion chain (CTX-1, CTX-2, CTX-3)', () => {
  test('dispatch exposes exactly its expected artifacts', () => {
    const dispatch = createDispatchContext();
    expect(dispatch.kind).toBe('dispatch');
    expect(dispatch.key).toBeDefined();
    expect(dispatch.instrumentation).toBe(noopInstrumentationBundle);
  });

  test('promoting dispatch to request adds exactly the request, carrying key and instrumentation forward by reference', () => {
    const dispatch = createDispatchContext();
    const request = aRequest();
    const requestCtx = promoteToRequest(dispatch, request, 'GetWidget');

    expect(requestCtx.kind).toBe('request');
    expect(requestCtx.key).toBe(dispatch.key);
    expect(requestCtx.instrumentation).toBe(dispatch.instrumentation);
    expect(requestCtx.request).toBe(request);
    expect(requestCtx.operationName).toBe('GetWidget');
  });

  test('the source context is unchanged by promotion', () => {
    const dispatch = createDispatchContext();
    const before = {...dispatch};
    promoteToRequest(dispatch, aRequest());
    expect(dispatch).toEqual(before);
  });

  test('promoting request to exchange adds exactly the response, carrying everything else forward', () => {
    const request = aRequest();
    const requestCtx = promoteToRequest(createDispatchContext(), request, 'GetWidget');
    const response = aResponse(request);
    const exchangeCtx = promoteToExchange(requestCtx, response);

    expect(exchangeCtx.kind).toBe('exchange');
    expect(exchangeCtx.key).toBe(requestCtx.key);
    expect(exchangeCtx.instrumentation).toBe(requestCtx.instrumentation);
    expect(exchangeCtx.operationName).toBe('GetWidget');
    expect(exchangeCtx.request).toBe(request);
    expect(exchangeCtx.response).toBe(response);
  });

  test('the whole chain shares one call key across all three flavors', () => {
    const dispatch = createDispatchContext();
    const requestCtx = promoteToRequest(dispatch, aRequest());
    const exchangeCtx = promoteToExchange(requestCtx, aResponse(requestCtx.request));
    expect(requestCtx.key).toBe(dispatch.key);
    expect(exchangeCtx.key).toBe(dispatch.key);
  });
});

describe('promotion is one-way (CTX-1)', () => {
  test('no promotion function accepts an ExchangeContext, so there is no way back', () => {
    const requestCtx = promoteToRequest(createDispatchContext(), aRequest());
    const exchangeCtx = promoteToExchange(requestCtx, aResponse(requestCtx.request));

    // CTX-1's "the exchange type exposes no method promoting back" is a compile-time guarantee in this
    // design, not a runtime one: promoteToRequest/promoteToExchange are free functions typed to accept
    // only DispatchContext/RequestContext respectively, and there is no third promotion function. These
    // two @ts-expect-error lines are the assertion -- `bun run typecheck` FAILS if either promotion ever
    // widens to accept a terminal context, which a prose-only comment would not catch.
    // @ts-expect-error -- ExchangeContext is terminal; it is not a DispatchContext
    promoteToRequest(exchangeCtx, aRequest());
    // @ts-expect-error -- ExchangeContext is terminal; it is not a RequestContext
    promoteToExchange(exchangeCtx, aResponse(requestCtx.request));

    expect(exchangeCtx.kind).toBe('exchange');
  });
});

describe('off-chain construction (CTX-5, CTX-6)', () => {
  test('default construction mints a fresh, distinct key every call', () => {
    const a = createDispatchContext();
    const b = createDispatchContext();
    expect(a.key).not.toBe(b.key);
  });

  test('N default-constructed contexts across all three flavors are pairwise key-distinct', () => {
    // CTX-5's "globally distinct across the whole process and all three flavors" is a property over the
    // whole population, not just a pair -- a keying scheme that collided every Nth call would pass the
    // pairwise test above. Every bundle field is identical here (all use noopInstrumentationBundle), so
    // this is also CTX-15's "call-key derivation MUST remain call-unique even when every bundle field is
    // identical" at scale.
    const request = aRequest();
    const keys = new Set<symbol>();
    for (let i = 0; i < 1000; i += 1) {
      keys.add(createDispatchContext().key);
      keys.add(createRequestContext(request).key);
      keys.add(createExchangeContext(request, aResponse(request)).key);
    }
    expect(keys.size).toBe(3000);
  });

  test('an explicit key can be pinned so two contexts share one slot', () => {
    const key = Symbol('shared');
    const a = createDispatchContext({key});
    const b = createDispatchContext({key});
    expect(a.key).toBe(b.key);
  });

  test('an explicit instrumentation bundle is carried onto the context verbatim', () => {
    const instrumentation = {...noopInstrumentationBundle, traceId: 'a'.repeat(32), isValid: true};
    expect(createDispatchContext({instrumentation}).instrumentation).toBe(instrumentation);
  });

  test('createRequestContext and createExchangeContext also default to a fresh key per call', () => {
    const request = aRequest();
    const a = createRequestContext(request);
    const b = createRequestContext(request);
    expect(a.key).not.toBe(b.key);

    const c = createExchangeContext(request, aResponse(request));
    const d = createExchangeContext(request, aResponse(request));
    expect(c.key).not.toBe(d.key);
  });
});

describe('operationName (CTX-16)', () => {
  test('is absent at the dispatch stage', () => {
    expect('operationName' in createDispatchContext()).toBe(false);
  });

  test('defaults to undefined when not supplied at promotion', () => {
    const requestCtx = promoteToRequest(createDispatchContext(), aRequest());
    expect(requestCtx.operationName).toBeUndefined();
  });

  test('is carried forward unchanged across the request-to-exchange promotion', () => {
    const requestCtx = promoteToRequest(createDispatchContext(), aRequest(), 'GetWidget');
    const exchangeCtx = promoteToExchange(requestCtx, aResponse(requestCtx.request));
    expect(exchangeCtx.operationName).toBe('GetWidget');
  });

  test('is advisory only -- it never influences the call key', () => {
    // CTX-16: "never influencing the request, dispatch decision, or store key." Two otherwise-identical
    // promotions differing only in operationName keep their source keys; and pinning one key across two
    // different operation names still yields one slot, proving the name is not folded into it.
    const key = Symbol('shared');
    const a = promoteToRequest(createDispatchContext({key}), aRequest(), 'GetWidget');
    const b = promoteToRequest(createDispatchContext({key}), aRequest(), 'DeleteWidget');
    expect(a.key).toBe(b.key);
    expect(a.operationName).not.toBe(b.operationName);
  });
});

describe('immutability (CTX-7)', () => {
  test('every context flavor is frozen', () => {
    const dispatch = createDispatchContext();
    expect(Object.isFrozen(dispatch)).toBe(true);
    const requestCtx = promoteToRequest(dispatch, aRequest());
    expect(Object.isFrozen(requestCtx)).toBe(true);
    expect(Object.isFrozen(promoteToExchange(requestCtx, aResponse(requestCtx.request)))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/context/context.test.ts`
Expected: FAIL — `Cannot find module './context.js'`.

- [ ] **Step 3: Write `context.ts`**

```typescript
// packages/core/src/context/context.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {noopInstrumentationBundle, type InstrumentationBundle} from './instrumentation.js';

/** Before any request (CTX-1). No `operationName` -- CTX-16 introduces it at the request stage. */
export interface DispatchContext {
  readonly kind: 'dispatch';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
}

/** An outgoing request assembled (CTX-1). */
export interface RequestContext {
  readonly kind: 'request';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
}

/** A response arrived; terminal -- no further promotion exists (CTX-1). */
export interface ExchangeContext {
  readonly kind: 'exchange';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
  readonly response: Response;
}

export type ExecutionContext = DispatchContext | RequestContext | ExchangeContext;

/**
 * Optional inputs shared by the three off-chain `create*` factories. One options object rather than
 * positional parameters: `createExchangeContext` would otherwise take five, and ESLint's `max-params` is 3
 * and counts optional parameters. Every field is spelled `?: T | undefined` for
 * `exactOptionalPropertyTypes`.
 */
export interface ContextInit {
  readonly operationName?: string | undefined;
  readonly instrumentation?: InstrumentationBundle | undefined;
  readonly key?: symbol | undefined;
}

/**
 * Off-chain construction (CTX-5): `key` defaults to a fresh Symbol() per call unless pinned (CTX-6).
 * Takes `Omit<ContextInit, 'operationName'>` -- CTX-16 introduces the operation name at the request stage,
 * so the dispatch factory does not offer it.
 */
export function createDispatchContext(init: Omit<ContextInit, 'operationName'> = {}): DispatchContext {
  const {instrumentation = noopInstrumentationBundle, key = Symbol('dispatch-context')} = init;
  return Object.freeze({kind: 'dispatch', key, instrumentation});
}

/** Off-chain construction (CTX-5/6) -- see `promoteToRequest` for the normal promotion path. */
export function createRequestContext(request: Request, init: ContextInit = {}): RequestContext {
  const {
    operationName,
    instrumentation = noopInstrumentationBundle,
    key = Symbol('request-context'),
  } = init;
  return Object.freeze({kind: 'request', key, instrumentation, operationName, request});
}

/** Off-chain construction (CTX-5/6) -- see `promoteToExchange` for the normal promotion path. */
export function createExchangeContext(
  request: Request,
  response: Response,
  init: ContextInit = {},
): ExchangeContext {
  const {
    operationName,
    instrumentation = noopInstrumentationBundle,
    key = Symbol('exchange-context'),
  } = init;
  return Object.freeze({kind: 'exchange', key, instrumentation, operationName, request, response});
}

/** dispatch -> request (CTX-1/2/3): adds the request, carries key + instrumentation forward verbatim. */
export function promoteToRequest(
  context: DispatchContext,
  request: Request,
  operationName?: string,
): RequestContext {
  return Object.freeze({
    kind: 'request',
    key: context.key,
    instrumentation: context.instrumentation,
    operationName,
    request,
  });
}

/** request -> exchange (CTX-1/2/3): adds the response, carries everything else forward verbatim. */
export function promoteToExchange(context: RequestContext, response: Response): ExchangeContext {
  return Object.freeze({
    kind: 'exchange',
    key: context.key,
    instrumentation: context.instrumentation,
    operationName: context.operationName,
    request: context.request,
    response,
  });
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/context/context.test.ts`
Expected: PASS, 16 tests.

The two `@ts-expect-error` lines are invisible to `bun test` — `bun run typecheck` (Task 5) is what verifies
them. If either promotion signature ever widens to accept an `ExchangeContext`, typecheck fails with
"Unused '@ts-expect-error' directive," which is the intended alarm.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/context.ts packages/core/src/context/context.test.ts
git commit -m "feat(core): add the execution context promotion chain (CTX-1, CTX-2, CTX-3, CTX-5, CTX-6, CTX-16)"
```

---

### Task 4: `context/store.ts` — `ContextStore`

**Files:**
- Create: `packages/core/src/context/store.ts`
- Create: `packages/core/src/context/store.test.ts`

**Interfaces:**
- Consumes: `ExecutionContext` (Task 3, type-only), `DuplicateContextKeyError` (Task 2).
- Produces: `class ContextStore` with `install`, `installIfAbsent`, `get`, `close`, `clear`, `get size()`; `const
  contextStore: ContextStore` (the process-wide singleton). Phase 4c imports both from `../context/store.js`
  directly.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/context/store.test.ts
// Exercises: CTX-4 (two contexts sharing identical trace AND span id get distinct keys and both
// register), CTX-8 (install-or-replace never throws; reject-on-duplicate fails naming the key),
// CTX-9/CTX-10 (identity-conditional close, intermediate-link close is a no-op), CTX-11/CTX-12 (bounded,
// post-insert drain loop), CTX-17 (a never-promoted dispatch context leaves no entry; its close is a
// harmless no-op), CTX-18 (unknown-key lookup/close are well-defined no-ops)
import {afterEach, describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {createDispatchContext, promoteToRequest} from './context.js';
import {DuplicateContextKeyError} from './errors.js';
import {ContextStore, contextStore} from './store.js';

afterEach(() => {
  contextStore.clear();
});

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

describe('install / installIfAbsent (CTX-8)', () => {
  test('install never throws and is retrievable by key', () => {
    const context = createDispatchContext();
    contextStore.install(context);
    expect(contextStore.get(context.key)).toBe(context);
  });

  test('install unconditionally overwrites an existing occupant', () => {
    const context = createDispatchContext();
    contextStore.install(context);
    const promoted = promoteToRequest(context, aRequest());
    contextStore.install(promoted);
    expect(contextStore.get(context.key)).toBe(promoted);
  });

  test('installIfAbsent succeeds when the key is free', () => {
    const context = createDispatchContext();
    contextStore.installIfAbsent(context);
    expect(contextStore.get(context.key)).toBe(context);
  });

  test('installIfAbsent on an occupied key throws DuplicateContextKeyError naming the key', () => {
    const context = createDispatchContext();
    contextStore.installIfAbsent(context);
    const other = createDispatchContext({instrumentation: context.instrumentation, key: context.key});
    expect(() => contextStore.installIfAbsent(other)).toThrow(DuplicateContextKeyError);
  });
});

describe('call-key uniqueness under an identical bundle (CTX-4)', () => {
  test('two contexts sharing identical trace AND span id get distinct keys and both register', () => {
    // §7's own Conformance clause for CTX-4, transcribed. Both contexts carry the very same
    // noopInstrumentationBundle -- identical traceId, spanId, flags, state -- which is exactly the
    // disabled-tracing case CTX-15 warns about. Symbol() keys make them distinct anyway, so neither
    // evicts the other.
    const a = createDispatchContext();
    const b = createDispatchContext();
    expect(a.instrumentation).toBe(b.instrumentation);
    expect(a.key).not.toBe(b.key);

    contextStore.install(a);
    contextStore.install(b);
    expect(contextStore.get(a.key)).toBe(a);
    expect(contextStore.get(b.key)).toBe(b);
    expect(contextStore.size).toBe(2);
  });
});

describe('no auto-registration at construction (CTX-17)', () => {
  test('a freshly constructed dispatch context is not in the store', () => {
    const context = createDispatchContext();
    expect(contextStore.get(context.key)).toBeUndefined();
    expect(contextStore.size).toBe(0);
  });

  test('a dispatch context that is never promoted leaves no entry, and closing it is a harmless no-op', () => {
    const context = createDispatchContext();
    promoteToRequest(context, aRequest()); // promotion alone registers nothing in 4a -- see below
    expect(contextStore.size).toBe(0);
    expect(() => contextStore.close(context)).not.toThrow();
  });

  // CTX-17's other half -- "the first store entry is installed by the first promotion" -- is NOT
  // satisfied here: promoteToRequest/promoteToExchange are pure and never touch the store, so an
  // explicit contextStore.install(...) is what registers anything. That call belongs to 4c's pipeline,
  // which owns the store handle. Tracked as a deferral in this plan's Self-Review, not an omission.
});

describe('close (CTX-9, CTX-10)', () => {
  test('evicts when the closing context is the current occupant', () => {
    const context = createDispatchContext();
    contextStore.install(context);
    contextStore.close(context);
    expect(contextStore.get(context.key)).toBeUndefined();
  });

  test('closing an intermediate link already superseded by promotion is a no-op', () => {
    const dispatch = createDispatchContext();
    contextStore.install(dispatch);
    const promoted = promoteToRequest(dispatch, aRequest());
    contextStore.install(promoted); // furthest-reached link now occupies the slot

    contextStore.close(dispatch); // intermediate link -- must not evict the live promoted occupant
    expect(contextStore.get(dispatch.key)).toBe(promoted);
  });

  test('closing an unknown or already-removed key is a well-defined no-op (CTX-18)', () => {
    const context = createDispatchContext();
    expect(() => contextStore.close(context)).not.toThrow();
    contextStore.install(context);
    contextStore.close(context);
    expect(() => contextStore.close(context)).not.toThrow();
  });
});

describe('lookup (CTX-18)', () => {
  test('an unknown key returns undefined, never throws', () => {
    expect(contextStore.get(Symbol('unknown'))).toBeUndefined();
  });
});

describe('bounded drain (CTX-11, CTX-12, CTX-13)', () => {
  test('a burst of inserts past the cap converges the store to at or under the cap', () => {
    const store = new ContextStore(5);
    for (let i = 0; i < 50; i += 1) {
      store.install(createDispatchContext());
      expect(store.size).toBeLessThanOrEqual(5); // drains after every single insert, never overshoots
    }
    expect(store.size).toBeLessThanOrEqual(5);
  });

  test('installIfAbsent also drains after a successful insert', () => {
    const store = new ContextStore(2);
    for (let i = 0; i < 10; i += 1) {
      store.installIfAbsent(createDispatchContext());
    }
    expect(store.size).toBeLessThanOrEqual(2);
  });

  test('a cap below 1 is rejected at construction', () => {
    // The constructor is the only place this is checked, which is what lets #drain be a bare
    // `while (size > max)` loop with no unreachable in-loop undefined guard.
    expect(() => new ContextStore(0)).toThrow(RangeError);
    expect(() => new ContextStore(-1)).toThrow(RangeError);
    expect(() => new ContextStore(1.5)).toThrow(RangeError);
    expect(() => new ContextStore(1)).not.toThrow();
  });
});

describe('the process-wide singleton', () => {
  test('is a real ContextStore instance', () => {
    expect(contextStore).toBeInstanceOf(ContextStore);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/context/store.test.ts`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 3: Write `store.ts`**

```typescript
// packages/core/src/context/store.ts
import type {ExecutionContext} from './context.js';
import {DuplicateContextKeyError} from './errors.js';

// Backstop cap (CTX-11); a leaked context pins its whole request/response graph, including a possibly
// unread body holding a connection.
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * A bounded, keyed store of in-flight execution contexts (CTX-7..13, CTX-18, CTX-19). Thread-safety is
 * satisfied by construction: Node's single-threaded event loop means no two synchronous Map mutations
 * ever interleave, collapsing the reference's concurrent-map requirement into a plain Map.
 *
 * @internal
 */
export class ContextStore {
  readonly #entries = new Map<symbol, ExecutionContext>();
  readonly #maxEntries: number;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`maxEntries must be a positive integer, got ${maxEntries}`);
    }
    this.#maxEntries = maxEntries;
  }

  /** Install-or-replace; never throws (CTX-8). Used by promotion. */
  install(context: ExecutionContext): void {
    this.#entries.set(context.key, context);
    this.#drain();
  }

  /** Install only if absent; every other concurrent caller fails (CTX-8). */
  installIfAbsent(context: ExecutionContext): void {
    if (this.#entries.has(context.key)) {
      throw new DuplicateContextKeyError(context.key);
    }
    this.#entries.set(context.key, context);
    this.#drain();
  }

  /** Absent key returns undefined, never throws (CTX-18). */
  get(key: symbol): ExecutionContext | undefined {
    return this.#entries.get(key);
  }

  /**
   * Evicts the slot only when the current occupant IS `context` (reference identity, CTX-9). Closing an
   * intermediate link already superseded by a later promotion, or an unknown/already-removed key, is a
   * well-defined no-op (CTX-10, CTX-18).
   */
  close(context: ExecutionContext): void {
    if (this.#entries.get(context.key) === context) {
      this.#entries.delete(context.key);
    }
  }

  /** Test isolation for the process-wide singleton below -- not part of the spec's own contract. */
  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  #drain(): void {
    // CTX-12: a loop, not a single check-then-evict, so a concurrent insert burst converges to the cap.
    // CTX-13: victim selection is arbitrary -- oldest-inserted (Map iteration order) is the cheapest
    // choice, not a retention promise; callers must not rely on any particular entry surviving.
    //
    // No undefined-guard inside the loop: the constructor rejects maxEntries < 1, so `size > maxEntries`
    // proves size >= 2 and the iterator always yields. A guard here would be unreachable code the
    // coverage gate could never exercise.
    for (const oldestKey of this.#entries.keys()) {
      if (this.#entries.size <= this.#maxEntries) return;
      this.#entries.delete(oldestKey);
    }
  }
}

/** One process-wide store (CTX-4/CTX-5's "globally distinct... across the whole process"). */
export const contextStore = new ContextStore();
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/context/store.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/store.ts packages/core/src/context/store.test.ts
git commit -m "feat(core): add ContextStore and the process-wide singleton (CTX-7..13, CTX-18, CTX-19)"
```

---

### Task 5: Full gate verification

**Files:** none created — this task only runs and verifies the existing gate sequence.

**Interfaces:**
- Consumes: every preceding task.
- Produces: nothing new; verifies the whole phase is green and the public surface did not move.

There is deliberately **no `context/index.ts`**. `docs/knowledge/module-organization.md:18` bans internal
barrels ("Never create internal barrels (an `index.ts` in every folder); import the specific file directly
instead"), and the ban holds whether or not the barrel is further re-exported. Phase 4c imports
`../context/context.js` and `../context/store.js` directly.

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
! grep -rn "from 'node:" packages/core/src/
```

Expected: exit 0, no matches.

- [ ] **Step 3: Verify no internal barrel crept in**

```bash
! test -f packages/core/src/context/index.ts
```

Expected: exit 0 — `docs/knowledge/module-organization.md:18` bans internal barrels; 4c imports the specific
files directly.

- [ ] **Step 4: Verify the public API surface did not move**

Step 1 already regenerated the report via `bun run api`; this only inspects the result. Run from the repo root
— the path below is repo-relative, so a `cd packages/core` first would make git resolve
`packages/core/packages/core/etc/core.api.md` and fail on an unmatched pathspec rather than on a real surface
change.

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
git diff --exit-code packages/core/etc/core.api.md
```

Expected: **no output, exit 0.** This is the mechanical proof that nothing from `src/context/` leaked into the
published surface — matching Phase 3a's gate, not Phase 3b's (nothing in `§7` has a real public consumer until
4c). If this fails, something in `src/context/` reached `packages/core/src/index.ts` — remove the export rather
than accepting the report change.

- [ ] **Step 5: Add a changeset**

Because nothing enters the public API, this is a patch-level, no-consumer-impact change:

```bash
bun run changeset
```

Select `@dexpace/core`, choose **patch**, summary:
`Internal: execution context promotion chain and bounded store for product-spec §7 (CTX-1..20). No public API change.`

- [ ] **Step 6: Commit**

```bash
git add .changeset/
git commit -m "chore(core): verify full gate sequence for Phase 4a"
```

---

## Self-Review

**Spec coverage** — every requirement ID from the design's scope, mapped to its task:

- `CTX-1`, `CTX-2`, `CTX-3` → Task 3 (promotion functions, additive/non-mutating, shared key). The "no method
  promoting back" clause is enforced mechanically by two `@ts-expect-error` lines that fail `typecheck` if
  either promotion ever widens to accept an `ExchangeContext`.
- `CTX-4` → Task 3 (`Symbol()` keys, satisfies uniqueness without a trace-id-derived scheme) + Task 4's
  singleton (process-wide). §7's own *Conformance* clause — "two contexts with identical trace AND span id have
  differing keys and both register" — is transcribed in `store.test.ts`, since "both register" needs a store.
- `CTX-5`, `CTX-6` → Task 3 (off-chain constructors, default-fresh-key, explicit-key pinning), including a
  population-scale check that 3000 default-constructed contexts across all three flavors are pairwise
  key-distinct, not just a single pair.
- `CTX-7` → Task 3 (`Object.freeze` on every context) + Task 4 (single-thread collapse of the store's
  thread-safety requirement).
- `CTX-8` → Task 4 (`install`, `installIfAbsent`).
- `CTX-9`, `CTX-10` → Task 4 (`close`'s identity-conditional evict).
- `CTX-11`, `CTX-12`, `CTX-13` → Task 4 (`#drain`'s post-insert loop, arbitrary victim).
- `CTX-14`, `CTX-15` → Task 1 (`InstrumentationBundle`, `noopInstrumentationBundle`), **partially** — the
  "no-op span" is encoded as `activeSpan: undefined` rather than a no-op span object, because `activeSpan` is
  typed `unknown` until Phase 7 supplies a real `Span`. Carried in the design's Deviation Ledger. The
  "call-key derivation stays call-unique when every bundle field is identical" half is fully covered, by
  Task 3's 3000-context test and Task 4's CTX-4 conformance test.
- `CTX-16` → Task 3 (`operationName` absent at dispatch, introduced at request, carried forward unchanged, and
  never folded into the call key — the "advisory only" clause).
- `CTX-17` → **split; only the negative half ships in 4a.** Satisfied here: constructing a dispatch context
  never auto-registers it (`createDispatchContext` does not import `store.ts`, so this holds structurally), a
  never-promoted context leaves no store entry, and its close is a harmless no-op — all three asserted in
  `store.test.ts`. **Deferred to 4c:** the positive half, "the first store entry is installed by the first
  promotion." `promoteToRequest`/`promoteToExchange` are pure functions that never touch the store; the
  `contextStore.install(...)` call belongs to the pipeline that owns the store handle, which is 4c. This is a
  deliberate deferral, not a gap in coverage — wiring the store into `context.ts` would invert the layering
  (`context` → `store`) and make every promotion a global side effect. **4c's plan must close it.**
- `CTX-18` → Task 4 (`get` returns `undefined`, `close` no-ops on an unknown key).
- `CTX-19` → satisfied by construction: `ContextStore` holds contexts by strong `Map` reference, never
  `WeakRef`/`WeakMap`.
- `CTX-20` → Task 1 (`tracerFactory` no-op, safe to invoke repeatedly — tested twice in a row).

**Placeholder scan:** no `TBD`/`TODO`, no "add appropriate error handling." Every step has real code.

**Type consistency:** `ExecutionContext`'s three-member union (Task 3) matches what `ContextStore` (Task 4)
accepts in `install`/`installIfAbsent`/`close`. `InstrumentationBundle`'s field names (Task 1) match every field
`context.ts` reads off it (`instrumentation` passed through verbatim, never destructured/renamed). Every
`create*`/`promote*` signature in Task 3's implementation matches the calls made against it in Task 3's own
tests and Task 4's tests — `createDispatchContext(init?)` called as `createDispatchContext()`,
`createDispatchContext({key})`, `createDispatchContext({instrumentation})`, and
`createDispatchContext({instrumentation, key})`; `createRequestContext(request, init?)` and
`createExchangeContext(request, response, init?)` called with the request/response positionally and nothing
else; `promoteToRequest(context, request, operationName?)` and `promoteToExchange(context, response)`
unchanged. No drift between declaration and call sites, and no call site still passes `instrumentation` or
`key` positionally.

**Lint-gate pre-check** (the failure modes this plan's shapes were chosen to avoid):

- `max-params` 3 — the three `create*` functions take 1, 2, and 3 parameters respectively via `ContextInit`;
  `promoteToRequest` takes 3, `promoteToExchange` 2. No `eslint-disable` anywhere in this phase, consistent
  with Phase 1's rule that the disable is reserved for private builder-internal constructors.
- `max-depth` 3 — deepest nesting is `#drain`'s single `for` containing one `if`.
- `max-lines-per-function` 70 — longest function is `createExchangeContext` at well under 20 lines.
- Explicit return types on every export, including `get size(): number`.
- No unused imports: `store.test.ts` no longer imports `type DispatchContext` (the dead `contexts` array that
  was its only consumer is gone); `context.test.ts`'s `noopInstrumentationBundle` import is still used by the
  dispatch-artifacts, explicit-instrumentation, and 3000-context tests.
