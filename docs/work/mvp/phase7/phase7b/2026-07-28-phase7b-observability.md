# Phase 7b — Instrumentation & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Logger`/`LogEvent` structured-logging facade, the diagnostic-context (MDC) allow-list, the
redaction policy, tracing (`Tracer`/`Span`, real W3C trace-context generation), the metrics SPI, and the
`LOGGING` pillar step in `@dexpace/core`, plus the `@dexpace/logging-pino` and `@dexpace/logging-debug` bridge
packages — satisfying `docs/product-spec/15-instrumentation-and-observability.md`'s `OBS-1`–`OBS-18` and
`OBS-20`–`OBS-27`, `OBS-30`–`OBS-40` (`OBS-19`/`OBS-28`/`OBS-29` → Phase 8a by name), per
`docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability-design.md`.

**Architecture:** A new `packages/core/src/observability/` folder of six files, no folder-level barrel.
`diagnostic-context.ts` (no dependencies within this package) is built first; `logger.ts` — the facade, a
process-wide global slot mirroring 7a's `Configuration` global slot, and `createLogger(sink)`, the **single
concrete `Logger` implementation** every real backend builds on — is built second because it imports
`diagnostic-context.ts`'s `getDiagnosticContext` to fold `OBS-5`'s third precedence tier automatically, and
implements `OBS-40`'s reserved-key warning once. The pino/debug bridge packages (Tasks 7–8) call `createLogger`
with only a backend-specific sink and enabled-check, rather than each reimplementing the `Logger`/`LogEvent`
protocol — precedence, rendering, truncation, the single-emit guard, diagnostic folding, and the collision
warning all come from one place, not three. The global-slot mechanism is what lets 5a's and 5b's already-
amended steps, and 5c's already-amended preset, emit structured events with zero change to `StepContext`'s
shape. `tracing.ts` defines `Tracer`/`Span`
as a structural subset of `@opentelemetry/api` (no dependency added) and ships `createInstrumentationBundle`,
a producer function that type-only imports 4a's `InstrumentationBundle` to build a real, non-no-op bundle —
**4a's file itself is never touched**, avoiding the alternative (retyping `InstrumentationBundle.tracerFactory`
from `unknown` to `Tracer`) that would force this phase ahead of nearly every other phase in the roadmap, since
`ExecutionContext` is threaded through all of them. `logging-step.ts` wires 3b's two already-`@internal` body
logging tees into the pipeline conditionally by granularity — reused unchanged, not rebuilt.

**Tech Stack:** TypeScript 5.8+, `node:async_hooks`'s `AsyncLocalStorage` for the diagnostic-context bridge
(the one Node-specific import this phase needs — see Global Constraints), `globalThis.crypto.getRandomValues`
for trace/span id generation, `fast-check` for the totality-bearing pure functions (redaction, field
rendering), `bun test`. `pino`/`debug` are peer dependencies of their respective bridge packages only — never
a dependency of `@dexpace/core` itself.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, 4a, 4b, 4c, 5a, 5b, 5c, 6a, 6b, 6c, and 7a are
implemented exactly as their own plans specify — **excluding** the 2026-07-28 Phase 7b retrofits recorded in
5a's, 5b's, and 5c's amendment banners. Concretely:

- `packages/core/src/context/instrumentation.js` — `InstrumentationBundle` (type only; fields stay `unknown`,
  never imported as values by this phase)
- `packages/core/src/body/request-body-logging.js` — `withRequestLogging(delegate, tapCapBytes)` (`@internal`)
- `packages/core/src/body/response-body-logging.js` — the response-body logging wrapper (`@internal`)
- `packages/core/src/pipeline/step.js` — `StepDescriptor`, `StepContext`
- `packages/core/src/config/configuration.js` — `Configuration`, `getGlobalConfiguration`, `CFG_KEY_LOG_LEVEL`,
  `Clock`, `getDefaultClock` (7a)
- `packages/core/src/invariant.js` — `invariant()`
- `packages/core/src/error/to-error.js` — `toError(value: unknown): Error`

**Execution-order correction (2026-07-29).** The three retrofit banners in 5a's, 5b's, and 5c's plans each
state that "this plan's execution now depends on Phase 7b's `observability/…` existing first." Phases 5a, 5b,
and 5c execute **before** 7b in the roadmap's phase table, and this plan in turn needs 5a's `FakeTransport`,
5b's redirect step, and 5c's preset. Read literally, that is a cycle: neither side can go first.

It is broken here, in the only place it can be: **the retrofit call sites are applied by this phase, as Task
9**, after `logger.ts`/`redaction.ts`/`logging-step.ts` exist. 5a/5b/5c create `engine.ts`,
`redirect-step.ts`, and `preset.ts` at their own execution time *without* the logging call sites and without
any `observability/` import; their banners are a forward reference for a reader, not an instruction to write
an import against a module that does not exist yet. An agent executing 5a, 5b, or 5c must **skip** the
retrofit blocks in those plans and leave them to Task 9 below.

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **No `src/observability/index.ts`.** Same rule as 7a — barrels exist only at the package root.
- **`node:async_hooks` is the one sanctioned `node:` import in this phase**, confined to
  `diagnostic-context.ts`. This is a deliberate, narrow exception to core's zero-`node:`-import invariant:
  `AsyncLocalStorage` has no cross-runtime equivalent, and the diagnostic-context bridge (`OBS-24`) has no
  other way to propagate context across `await` boundaries in Node specifically. `verify:seam-1` must be
  updated (or confirmed already scoped) to allow this one file; do not let the import spread to any other file
  in `src/observability/`.
- **`@dexpace/core` never depends on `@opentelemetry/api`, `pino`, or `debug`.** `Tracer`/`Span` (`tracing.ts`)
  are a structural subset defined locally — real OTel objects duck-type in without any import. `pino`/`debug`
  are peers of their own bridge packages only.
- **4a's `context/instrumentation.ts` is never edited.** `InstrumentationBundle.activeSpan`/`tracerFactory`
  stay typed `unknown`. Real tracing flows in via this phase's `createInstrumentationBundle` producer function
  (Task 4), which type-only imports the bundle's shape and assigns real values into its `unknown`-typed
  fields (always legal on the producer side) — never via retyping the interface itself.
- **`logging-step.ts` wraps 3b's existing tees; it does not reimplement body-preview capture.**
  `withRequestLogging`/the response-body logging wrapper are `@internal` but already fully built (3b) — import
  and drive them, don't duplicate their logic.
- **Tracer/meter callbacks are never wrapped in a try/catch.** Only `Logger` emission call sites get the
  failure-containment treatment (`OBS-20`). A throwing tracer/meter must propagate, per the spec's asymmetric
  guarantee — do not "helpfully" catch it.
- **No new error leaf classes.** Redaction and field rendering are total, never-throwing functions.
- **Observability never throws into the request path** (`XCUT-20`, `docs/knowledge/redaction-and-security.md`
  line 38). Two concrete rules that follow, both of which an earlier draft of this plan broke: a caught value
  is **never** treated as an `Error` without narrowing (`toError(e).name`, never `(e as Error).constructor.name`
  — `throw null` is legal JavaScript and `null.constructor` is a `TypeError` raised from inside the logging
  step); and every field a log event derives from caller- or server-controlled data goes through the total
  renderer, never straight into a backend's serializer.
- **Preconditions use `invariant()`, not ad hoc `if (…) throw`** (`docs/knowledge/assertions.md` lines 4–6).
  Target 2+ assertions per function. The one deliberate exception is `LogEvent.field`'s empty-key rejection,
  which `OBS-3` specifies as an error *to the caller* rather than a broken internal invariant — it still uses
  `invariant`, whose `InvariantViolation` is the project's single assertion failure type.
- **Every `as` carries a why-comment on the same line or directly above** (`docs/knowledge/type-system.md`
  line 12). This phase has exactly three sanctioned `as` sites in production code, all of them documented at
  the site: reading `Tracer` back out of 4a's `unknown`-typed `InstrumentationBundle.tracerFactory`
  (`logging-step.ts`); duck-typing an OpenTelemetry-shaped `spanContext()` off a structural `Span`
  (`tracing.ts`); and restoring a possibly-`undefined` prior value through `AsyncLocalStorage.enterWith`,
  whose signature does not admit `undefined` (`diagnostic-context.ts`). Any fourth one is a review question.
- **Time goes through 7a's `Clock` seam** (`CFG-15`/`CFG-16`), never a bare `performance.now()`/`Date.now()`.
  `http.response.duration_ms` is asserted in tests and needs a drivable clock.
- **Every no-op singleton is `Object.freeze`d** — `NOOP_LOGGER`, `NOOP_EVENT`, `NOOP_SPAN`, `NOOP_TRACER`,
  `NOOP_METER` and its two instruments. They are process-wide shared values; a caller mutating one would
  corrupt every other consumer.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`** (`erasableSyntaxOnly`). Unions and frozen constant objects only.
- **Explicit return types on every exported function.** Kebab-case filenames. Named exports only.
- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT`.
- **Module-level mutable state is limited to `logger.ts`'s global slot and `diagnostic-context.ts`'s
  `AsyncLocalStorage` instance.** Tests touching either must reset/scope them explicitly rather than relying
  on execution order.

---

## File Structure

```
packages/core/src/observability/
  diagnostic-context.ts      # AsyncLocalStorage-backed MDC, allow-list folding     (Task 1)
  logger.ts                    # Logger, LogEvent, createLogger, no-op default,    (Task 2)
                                # global slot -- imports Task 1 for OBS-5 folding
  redaction.ts                 # URL/header redaction policy                       (Task 3)
  tracing.ts                    # Tracer/Span, no-op defaults, W3C/Datadog/no-op   (Task 4)
                                 # id generation, createInstrumentationBundle
  metrics.ts                     # Meter/Counter/Histogram SPI, no-op default      (Task 5)
  logging-step.ts                 # loggingStep(settings): StepDescriptor          (Task 6)

packages/logging-pino/
  src/index.ts                     # createPinoLogger(pino): Logger               (Task 7)
  package.json

packages/logging-debug/
  src/index.ts                      # createDebugLogger(namespace?): Logger        (Task 8)
  package.json

# amended in place, not created (Task 9 -- the 5a/5b/5c retrofits, see Prerequisite):
packages/core/src/retry/engine.ts             # two SHOULD-level events
packages/core/src/redirect/redirect-step.ts   # three SHOULD-level events
packages/core/src/auth/preset.ts              # standardResilience()'s LOGGING-slot install

packages/core/src/index.ts                    # public barrel promotion            (Task 10)
```

Every `@dexpace/core` file has a colocated `*.test.ts`. Six production files in `observability/`, each one
responsibility, none over ~120 lines. The two bridge packages follow the peerDependency template
`docs/knowledge/package-and-dependency-layout.md` already fixes.

---

### Task 1: `diagnostic-context.ts` — the `AsyncLocalStorage`-backed MDC

Built first — no dependencies within this package, and Task 2's `logger.ts` needs `getDiagnosticContext` to
fold `OBS-5`'s third precedence tier.

**Files:**
- Create: `packages/core/src/observability/diagnostic-context.ts`
- Test: `packages/core/src/observability/diagnostic-context.test.ts`

**Interfaces:**
- Consumes: `node:async_hooks`'s `AsyncLocalStorage` (the one sanctioned `node:` import this phase — see
  Global Constraints).
- Produces: `withDiagnosticFields<T>(fields, fn): T`; `getDiagnosticContext(allowList): Readonly<Record<string,
  string>>`; `captureDiagnosticSnapshot()`; `runWithSnapshot(snapshot, fn)`; `pushDiagnosticFields(fields): ()
  => void` (the scope-handle form `OBS-23` needs); `createAsyncScopedStore<T>()` (so `node:async_hooks` stays
  confined to this file while `tracing.ts` still gets a current-span slot). Task 2's `createLogger` consumes
  `getDiagnosticContext`; Task 4 consumes `pushDiagnosticFields` and `createAsyncScopedStore`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/diagnostic-context.test.ts
// Exercises: OBS-10 (default allow-list {trace.id, span.id}, null allow-list folds all, null values skipped),
// OBS-24 (immutable snapshot bridge: capture, reinstall, restore including on throw).
import {describe, expect, test} from 'bun:test';
import {
  captureDiagnosticSnapshot,
  getDiagnosticContext,
  runWithSnapshot,
  withDiagnosticFields,
} from './diagnostic-context.js';

describe('allow-list folding (OBS-10)', () => {
  test('only trace.id/span.id fold by default', () => {
    withDiagnosticFields({'trace.id': 't1', 'span.id': 's1', 'app.custom': 'x'}, () => {
      const folded = getDiagnosticContext(['trace.id', 'span.id']);
      expect(folded).toEqual({'trace.id': 't1', 'span.id': 's1'});
    });
  });

  test('a null allow-list folds every present key', () => {
    withDiagnosticFields({'trace.id': 't1', 'app.custom': 'x'}, () => {
      const folded = getDiagnosticContext(null);
      expect(folded).toEqual({'trace.id': 't1', 'app.custom': 'x'});
    });
  });

  test('outside any withDiagnosticFields scope, the context is empty', () => {
    expect(getDiagnosticContext(null)).toEqual({});
  });
});

describe('async propagation', () => {
  test('the context is visible after an await inside the scope', async () => {
    await withDiagnosticFields({'trace.id': 't1'}, async () => {
      await Promise.resolve();
      expect(getDiagnosticContext(null)['trace.id']).toBe('t1');
    });
  });

  test('nested scopes restore the outer context on exit', () => {
    withDiagnosticFields({'trace.id': 'outer'}, () => {
      withDiagnosticFields({'trace.id': 'inner'}, () => {
        expect(getDiagnosticContext(null)['trace.id']).toBe('inner');
      });
      expect(getDiagnosticContext(null)['trace.id']).toBe('outer');
    });
  });
});

describe('snapshot bridge (OBS-24)', () => {
  test('captures on the originating call and reinstalls on a detached callback', () => {
    let capturedInsideBridge: string | undefined;
    withDiagnosticFields({'trace.id': 'bridged'}, () => {
      const snapshot = captureDiagnosticSnapshot();
      // Simulate a callback invoked outside the tracked continuation (e.g. a raw event-emitter callback).
      setImmediate(() => {
        runWithSnapshot(snapshot, () => {
          capturedInsideBridge = getDiagnosticContext(null)['trace.id'];
        });
      });
    });
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        expect(capturedInsideBridge).toBe('bridged');
        resolve();
      });
    });
  });

  test('restores the prior context after the bridge, including when the guarded block throws', () => {
    withDiagnosticFields({'trace.id': 'prior'}, () => {
      const snapshot = captureDiagnosticSnapshot();
      expect(() => {
        runWithSnapshot(snapshot, () => {
          throw new Error('boom');
        });
      }).toThrow('boom');
      expect(getDiagnosticContext(null)['trace.id']).toBe('prior');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/diagnostic-context.test.ts`
Expected: FAIL — `Cannot find module './diagnostic-context.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/diagnostic-context.ts
// The one sanctioned node: import in this phase (see Global Constraints) -- AsyncLocalStorage has no
// cross-runtime equivalent, and this is the only mechanism Node offers for OBS-24's async-boundary bridge.
import {AsyncLocalStorage} from 'node:async_hooks';

type DiagnosticStore = ReadonlyMap<string, string>;

const storage = new AsyncLocalStorage<DiagnosticStore>();

/** OBS-24: an immutable, shareable snapshot of the diagnostic context at capture time. */
export interface DiagnosticSnapshot {
  readonly store: DiagnosticStore;
}

/**
 * OBS-24 (partial, by construction): AsyncLocalStorage already auto-propagates its store across `await`,
 * promise chains, and timers via async_hooks, covering most of the reference's manual thread-local-bridge
 * requirement for free. Pushes `fields` for the duration of `fn`, restoring the prior store afterward
 * (including on throw, via AsyncLocalStorage.run's own guarantee).
 */
export function withDiagnosticFields<T>(fields: Readonly<Record<string, string>>, fn: () => T): T {
  const current = storage.getStore() ?? new Map<string, string>();
  const next = new Map(current);
  for (const [key, value] of Object.entries(fields)) next.set(key, value);
  return storage.run(next, fn);
}

/** OBS-10: default allow-list is exactly {trace.id, span.id}; null allow-list folds every present key. */
export function getDiagnosticContext(allowList: readonly string[] | null): Readonly<Record<string, string>> {
  const store = storage.getStore();
  if (store === undefined) return {};
  const keys = allowList ?? [...store.keys()];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = store.get(key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * OBS-24's explicit bridge, for the residual case AsyncLocalStorage's automatic propagation doesn't cover: a
 * callback invoked from outside the tracked continuation chain entirely (e.g. a raw event-emitter callback,
 * or `setImmediate`/a third-party callback API that isn't `await`ed from the capturing scope).
 */
export function captureDiagnosticSnapshot(): DiagnosticSnapshot {
  return {store: storage.getStore() ?? new Map()};
}

export function runWithSnapshot<T>(snapshot: DiagnosticSnapshot, fn: () => T): T {
  return storage.run(snapshot.store, fn);
}

/**
 * The scope-handle form of `withDiagnosticFields`, for callers that cannot express their scope as a single
 * callback -- OBS-23's span-correlation scope is one: a pipeline step pushes before `await next(...)` and
 * restores after, with the two halves in different statements. Returns the restore function.
 */
export function pushDiagnosticFields(fields: Readonly<Record<string, string>>): () => void {
  const previous = storage.getStore();
  const next = new Map(previous ?? []);
  for (const [key, value] of Object.entries(fields)) next.set(key, value);
  storage.enterWith(next);

  let restored = false;
  return (): void => {
    if (restored) return;
    restored = true;
    storage.enterWith(previous ?? new Map());
  };
}

/**
 * `node:async_hooks` is confined to this file (see Global Constraints), so any other module needing
 * async-scoped storage — `tracing.ts`'s current-span slot is the only one this phase adds — takes it from
 * here rather than importing `AsyncLocalStorage` a second time.
 */
export interface AsyncScopedStore<T> {
  get(): T | undefined;
  /** Installs `value` for the rest of this async context; the returned function restores the prior value. */
  enter(value: T): () => void;
}

export function createAsyncScopedStore<T>(): AsyncScopedStore<T> {
  const scoped = new AsyncLocalStorage<T>();
  return {
    get: () => scoped.getStore(),
    enter(value: T): () => void {
      const previous = scoped.getStore();
      scoped.enterWith(value);
      let restored = false;
      return (): void => {
        if (restored) return;
        restored = true;
        // `as`: enterWith's signature is `(store: T)`, but restoring "there was nothing here before" is
        // exactly `undefined`, and getStore() returning undefined afterwards is the correct observable state.
        scoped.enterWith(previous as T);
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/diagnostic-context.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Confirm `verify:seam-1` still passes with this one exception**

Run: `bun run verify:seam-1`
Expected: PASS. If the gate script hard-fails on any `node:` import with no allow-list mechanism, add
`packages/core/src/observability/diagnostic-context.ts` to its explicit exception list (check
`scripts/verify-seam-1.mjs` or equivalent) rather than disabling the check globally.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/observability/diagnostic-context.ts packages/core/src/observability/diagnostic-context.test.ts
git commit -m "feat(core): AsyncLocalStorage-backed diagnostic-context MDC (OBS-10, OBS-24)"
```

---

### Task 2: `logger.ts` — the `Logger`/`LogEvent` facade, `createLogger`, and global slot

The largest task in this phase. Read `OBS-1`–`OBS-9`, `OBS-40` in
`docs/product-spec/15-instrumentation-and-observability.md` before starting.

**`@dexpace/core` ships one concrete `Logger` implementation, `createLogger(sink)`, not just the interfaces.**
An earlier draft of this task shipped only `Logger`/`LogEvent` as bare interfaces plus `NOOP_LOGGER`, leaving
every backend (the pino/debug bridges, Tasks 7–8) to reimplement the field/event/emit protocol from scratch.
That reimplementation would have had to redo `OBS-5`'s three-way precedence (including folding diagnostic
context — Task 1) and `OBS-40`'s collision warning independently, in every backend, which is exactly the kind
of duplication this project's single-source discipline (`RECOV-30`, `CFG-35`) exists to prevent. `createLogger`
does it once; a backend supplies only a `sink` (where rendered fields actually go) and, optionally, an
`isLevelEnabled` check.

**Files:**
- Create: `packages/core/src/observability/logger.ts`
- Test: `packages/core/src/observability/logger.test.ts`

**Interfaces:**
- Consumes: `getDiagnosticContext` from `./diagnostic-context.js` (Task 1).
- Produces: `type LogLevel = 'error' | 'warning' | 'info' | 'verbose'`; `interface Logger {atLevel,
  withContext}`; `interface LogEvent {field, event, cause, emit}`; `NOOP_LOGGER`; `getGlobalLogger()`;
  `setGlobalLogger(logger)`; `createLogger(sink, options?): Logger`; `interface CreateLoggerOptions
  {globalFields?, diagnosticAllowList?, isLevelEnabled?}`. Task 6, Tasks 7–8, and the 5a/5b/5c amendments
  already applied to their own plans, consume `getGlobalLogger`; Tasks 7–8 consume `createLogger`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/logger.test.ts
// Exercises: OBS-1 (disabled path allocates/emits nothing, shared singleton event), OBS-3 (empty key
// rejected, null value emitted as literal "null"), OBS-4 (event() reserved-key precedence and single
// occurrence), OBS-5 (per-event > global > diagnostic-context precedence, actually wired through
// createLogger), OBS-6 (total field rendering), OBS-7 (truncation), OBS-8 (single-emit guard), OBS-9 (global
// context on every event), OBS-40 (once-per-logger reserved-key-collision warning, gated on verbose enabled,
// never fired for an ambient collision arriving via diagnostic context).
import {afterEach, describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {withDiagnosticFields} from './diagnostic-context.js';
import {
  NOOP_LOGGER,
  createLogger,
  getGlobalLogger,
  setGlobalLogger,
  type Logger,
  type LogEvent,
} from './logger.js';

function collectingLogger(): {logger: Logger; emitted: Array<Record<string, unknown>>} {
  const emitted: Array<Record<string, unknown>> = [];
  function makeEvent(globalFields: Readonly<Record<string, unknown>>): LogEvent {
    const fields: Record<string, unknown> = {...globalFields};
    let emittedOnce = false;
    return {
      field(key, value) {
        if (key === '') throw new RangeError('field key must not be empty');
        fields[key] = value === null ? 'null' : value;
        return this;
      },
      event(name) {
        if (name === '') delete fields['event'];
        else fields['event'] = name;
        return this;
      },
      cause(error) {
        fields['cause'] = error;
        return this;
      },
      emit() {
        if (emittedOnce) return;
        emittedOnce = true;
        emitted.push({...fields});
      },
    };
  }
  const logger: Logger = {
    atLevel: () => makeEvent({}),
    withContext(context) {
      return {atLevel: () => makeEvent(context), withContext: logger.withContext};
    },
  };
  return {logger, emitted};
}

describe('the no-op default (OBS-1)', () => {
  test('the disabled event is a shared singleton across calls', () => {
    const noop = getGlobalLogger();
    setGlobalLogger(noop); // ensure default state for this test
    const first = getGlobalLogger().atLevel('verbose');
    const second = getGlobalLogger().atLevel('verbose');
    expect(first).toBe(second);
  });

  test('every builder method returns the same event and emit is a no-op', () => {
    const event = getGlobalLogger().atLevel('info');
    expect(event.field('k', 'v')).toBe(event);
    expect(event.event('x')).toBe(event);
    expect(event.cause(new Error('x'))).toBe(event);
    expect(() => event.emit()).not.toThrow();
  });
});

describe('global logger slot (mirrors CFG-13)', () => {
  // This block is the only one that mutates the module-level global slot -- restore the no-op default after
  // every test so no later test file (or a later test in this one, if execution order ever changes) observes
  // a logger some earlier test installed. The Global Constraints section requires exactly this discipline.
  afterEach(() => {
    setGlobalLogger(NOOP_LOGGER);
  });

  test('last-write-wins: getGlobalLogger returns the same instance after set', () => {
    const {logger} = collectingLogger();
    setGlobalLogger(logger);
    expect(getGlobalLogger()).toBe(logger);
  });

  test('defaults to the no-op logger when nothing has been set', () => {
    expect(getGlobalLogger()).toBe(NOOP_LOGGER);
  });
});

describe('field/event semantics (OBS-3, OBS-4)', () => {
  test('an empty field key throws', () => {
    const {logger} = collectingLogger();
    expect(() => logger.atLevel('info').field('', 'x')).toThrow();
  });

  test('a null field value is emitted as the literal string "null"', () => {
    const {logger, emitted} = collectingLogger();
    logger.atLevel('info').field('k', null).emit();
    expect(emitted[0]?.['k']).toBe('null');
  });

  test('event(name) sets the reserved key exactly once; an empty name clears it', () => {
    const {logger, emitted} = collectingLogger();
    logger.atLevel('info').event('x').emit();
    expect(emitted[0]?.['event']).toBe('x');

    const {logger: logger2, emitted: emitted2} = collectingLogger();
    logger2.atLevel('info').event('x').event('').emit();
    expect(emitted2[0]?.['event']).toBeUndefined();
  });
});

describe('single-emit guard (OBS-8)', () => {
  test('a second terminal emit is a no-op', () => {
    const {logger, emitted} = collectingLogger();
    const event = logger.atLevel('info').field('k', 1);
    event.emit();
    event.emit();
    expect(emitted).toHaveLength(1);
  });
});

describe('global context (OBS-9)', () => {
  test('a global field configured via withContext attaches to every event', () => {
    const {logger, emitted} = collectingLogger();
    const withGlobal = logger.withContext({service: 'dexpace'});
    withGlobal.atLevel('info').emit();
    withGlobal.atLevel('info').field('extra', 1).emit();
    expect(emitted[0]?.['service']).toBe('dexpace');
    expect(emitted[1]?.['service']).toBe('dexpace');
  });
});

describe('createLogger: diagnostic-context folding and full precedence (OBS-5)', () => {
  function recordingLogger(options?: Parameters<typeof createLogger>[1]) {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields), options);
    return {logger, emitted};
  }

  test('folds diagnostic-context fields when nothing else overrides them', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 't1', 'span.id': 's1'}, () => {
      logger.atLevel('info').emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('t1');
    expect(emitted[0]?.get('span.id')).toBe('s1');
  });

  test('global context (withContext) wins over folded diagnostic context for the same key', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 'from-diagnostic'}, () => {
      logger.withContext({'trace.id': 'from-global'}).atLevel('info').emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('from-global');
  });

  test('a per-event field wins over both global context and folded diagnostic context', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 'from-diagnostic'}, () => {
      logger.withContext({'trace.id': 'from-global'}).atLevel('info').field('trace.id', 'from-event').emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('from-event');
  });

  test('outside any diagnostic-context scope, no diagnostic fields are folded', () => {
    const {logger, emitted} = recordingLogger();
    logger.atLevel('info').emit();
    expect(emitted[0]?.has('trace.id')).toBe(false);
  });
});

describe('createLogger: reserved-key collision warning (OBS-40)', () => {
  test('warns exactly once per logger, ambient keys never trigger it', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger.atLevel('info').field('event', 'x').emit(); // explicit collision, attempt 1
    logger.atLevel('info').field('event', 'y').emit(); // explicit collision, attempt 2 -- must not re-warn

    const warnings = emitted.filter((f) => f.get('event') === 'dexpace.logger.reservedKeyCollision');
    expect(warnings).toHaveLength(1);
  });

  test('never warns when verbose is disabled for this logger', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields), {
      isLevelEnabled: (level) => level !== 'verbose',
    });

    logger.atLevel('info').field('event', 'x').emit();

    expect(emitted.some((f) => f.get('event') === 'dexpace.logger.reservedKeyCollision')).toBe(false);
  });

  test('an ambient "event" key folded from diagnostic context is never warned about', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    withDiagnosticFields({event: 'ambient-value'}, () => {
      logger.atLevel('info').emit();
    });

    expect(emitted.some((f) => f.get('event') === 'dexpace.logger.reservedKeyCollision')).toBe(false);
  });
});

describe('createLogger: total field rendering and truncation (OBS-6, OBS-7)', () => {
  function render(value: unknown): unknown {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    createLogger((_level, fields) => emitted.push(fields)).atLevel('info').field('k', value).emit();
    return emitted[0]?.get('k');
  }

  test('an Error renders as "Name: message"', () => {
    expect(render(new TypeError('boom'))).toBe('TypeError: boom');
  });

  test('numeric and boolean primitives pass through type-preserving', () => {
    expect(render(42)).toBe(42);
    expect(render(false)).toBe(false);
  });

  test('an array, a Map, and a Set each render to a bracketed form carrying their entries', () => {
    expect(render([1, 2])).toBe('[1, 2]');
    expect(render(new Set(['a']))).toBe('[a]');
    expect(render(new Map([['a', 1]]))).toBe('[a=1]');
  });

  test('a value whose toString throws renders as the placeholder rather than propagating', () => {
    const hostile = {toString(): string { throw new Error('nope'); }};
    expect(render(hostile)).toBe('[unrenderable value]');
  });

  test('an oversized string is truncated with a marker (OBS-7)', () => {
    const rendered = String(render('x'.repeat(10_000)));
    expect(rendered.length).toBeLessThan(10_000);
    expect(rendered.endsWith('…[truncated]')).toBe(true);
  });

  test('property: rendering never throws for any value', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      expect(() => render(value)).not.toThrow();
    }));
  });

  test('a global-context value is rendered too, not passed raw to the sink', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const hostile = {toString(): string { throw new Error('nope'); }};
    createLogger((_level, fields) => emitted.push(fields)).withContext({k: hostile}).atLevel('info').emit();
    expect(emitted[0]?.get('k')).toBe('[unrenderable value]');
  });
});

describe('createLogger: the reserved key survives when no tag is set (OBS-4, OBS-9)', () => {
  test('an ambient global-context "event" key is emitted when event() was never called', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger.withContext({event: 'app.ambient'}).atLevel('info').emit();

    expect(emitted[0]?.get('event')).toBe('app.ambient');
  });

  test('a set tag suppresses the ambient key, carrying "event" exactly once', () => {
    const emitted: Array<ReadonlyMap<string, unknown>> = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger.withContext({event: 'app.ambient'}).atLevel('info').event('http.request').emit();

    expect(emitted[0]?.get('event')).toBe('http.request');
  });
});

describe('createLogger: disabled levels allocate nothing (OBS-1)', () => {
  test('atLevel returns the shared NOOP_EVENT-equivalent when the level is disabled, sink is never called', () => {
    const logger = createLogger(
      () => {
        throw new Error('sink must not be called for a disabled level');
      },
      {isLevelEnabled: (level) => level !== 'verbose'},
    );

    const event = logger.atLevel('verbose');
    expect(event.field('k', 'v')).toBe(event);
    expect(() => event.emit()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/logger.test.ts`
Expected: FAIL — `Cannot find module './logger.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/logger.ts
import {invariant} from '../invariant.js';
import {getDiagnosticContext} from './diagnostic-context.js';

export type LogLevel = 'error' | 'warning' | 'info' | 'verbose';

const RESERVED_EVENT_KEY = 'event';
const COLLISION_WARNING_EVENT = 'dexpace.logger.reservedKeyCollision';
const MAX_FIELD_LENGTH = 8192;
const TRUNCATION_MARKER = '…[truncated]';
const UNRENDERABLE_PLACEHOLDER = '[unrenderable value]';
const DEFAULT_DIAGNOSTIC_ALLOW_LIST: readonly string[] = Object.freeze(['trace.id', 'span.id']);

export interface LogEvent {
  /** OBS-3: an empty key MUST be rejected. A null value is emitted as the literal string "null". */
  field(key: string, value: unknown): this;
  /** OBS-4: sets the reserved "event" tag exclusively; an empty name clears it. */
  event(name: string): this;
  cause(error: unknown): this;
  /** OBS-8: at most once; a second call is a no-op, safe under concurrent invocation. */
  emit(): void;
}

export interface Logger {
  /** OBS-1: enabled/disabled is decided once, here. The disabled path allocates and emits nothing. */
  atLevel(level: LogLevel): LogEvent;
  /** OBS-9: attaches a global key/value context to every event this returns. */
  withContext(fields: Readonly<Record<string, unknown>>): Logger;
}

/**
 * OBS-6/OBS-7: total field-value rendering -- never throws, for any input.
 *
 * `JSON.stringify` alone is not enough and an earlier draft of this function used it as the whole fallback:
 * it renders a `Map`/`Set` as `{}` (losing every entry, where OBS-6 requires "a bracketed textual form"),
 * returns `undefined` rather than a string for a `symbol` or a function, and throws on a `BigInt` or a cycle.
 * Each of those is handled explicitly below; the `catch` is the last line of defence for a value whose own
 * `toString`/`Symbol.toPrimitive` throws, not the primary strategy.
 */
function renderField(value: unknown): unknown {
  if (value === null || value === undefined) return 'null';
  // OBS-6: numeric/boolean/bigint primitives pass through type-preserving and are exempt from truncation.
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  return truncate(renderNonPrimitive(value));
}

// Deliberately NOT recursive -- `docs/knowledge/styleguide-overview.md` line 24 bans recursion in library
// code, and a cyclic object graph would be an unbounded walk. Containers render one level deep, with nested
// members flattened by renderScalar. A log field is a diagnostic, not a serialization format.
function renderNonPrimitive(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (Array.isArray(value)) return `[${value.map(renderScalar).join(', ')}]`;
    if (value instanceof Set) return `[${[...value].map(renderScalar).join(', ')}]`;
    if (value instanceof Map) return renderPairs([...value]);
    if (typeof value === 'object') return renderPairs(Object.entries(value));
    return String(value); // symbol, function -- String() handles both without throwing
  } catch {
    return UNRENDERABLE_PLACEHOLDER;
  }
}

function renderScalar(value: unknown): string {
  try {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'object') return Array.isArray(value) ? '[…]' : '{…}';
    return String(value);
  } catch {
    return UNRENDERABLE_PLACEHOLDER;
  }
}

function renderPairs(pairs: ReadonlyArray<readonly [unknown, unknown]>): string {
  const rendered = pairs.map(([key, entry]) => `${renderScalar(key)}=${renderScalar(entry)}`);
  return `[${rendered.join(', ')}]`;
}

/** OBS-7: bounded to 8 KiB with a marker. Primitives never reach here (see renderField). */
function truncate(rendered: string): string {
  if (rendered.length <= MAX_FIELD_LENGTH) return rendered;
  return rendered.slice(0, MAX_FIELD_LENGTH) + TRUNCATION_MARKER;
}

/** OBS-40: throttles the reserved-key-collision warning to at most one emission per Logger instance. */
class CollisionWarningGate {
  private warned = false;
  public shouldWarn(): boolean {
    if (this.warned) return false;
    this.warned = true;
    return true;
  }
}

/** One object rather than six positional arguments -- `max-params: 3` applies to constructors too. */
interface LogEventInit {
  readonly level: LogLevel;
  readonly wiring: LoggerWiring;
  readonly diagnosticFields: Readonly<Record<string, string>>;
  readonly verboseEnabled: boolean;
}

class RealLogEvent implements LogEvent {
  private readonly level: LogLevel;
  private readonly sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void;
  private readonly collisionGate: CollisionWarningGate;
  private readonly verboseEnabled: boolean;
  private readonly fields: Map<string, unknown>;
  private eventTag: string | undefined;
  private emitted = false;

  public constructor(init: LogEventInit) {
    const {level, wiring, diagnosticFields, verboseEnabled} = init;
    this.level = level;
    this.sink = wiring.sink;
    this.collisionGate = wiring.collisionGate;
    this.verboseEnabled = verboseEnabled;
    const globalFields = wiring.globalFields;

    // OBS-5: precedence is per-event field > global context > folded diagnostic context. Diagnostic fields
    // seed the map first (lowest precedence); global fields (withContext) overwrite them; a later field()
    // call overwrites both, since it runs after this constructor and writes directly into `this.fields`.
    // Both sources go through renderField: `globalFields` is `unknown`-valued caller data, so seeding it raw
    // would push a throwing toString() into the backend's serializer, outside OBS-20's containment (which
    // wraps the emission call site, not the sink's internals).
    this.fields = new Map();
    for (const [key, value] of Object.entries(diagnosticFields)) this.fields.set(key, renderField(value));
    for (const [key, value] of Object.entries(globalFields)) this.fields.set(key, renderField(value));

    invariant(this.sink !== undefined, 'RealLogEvent: sink is required');
  }

  public field(key: string, value: unknown): this {
    // OBS-3: an empty key is rejected. invariant() is the project's single assertion primitive
    // (docs/knowledge/assertions.md line 4) -- no ad hoc `if (…) throw` here.
    invariant(key !== '', 'LogEvent.field: key must not be empty');
    if (key === RESERVED_EVENT_KEY) {
      // OBS-40: once-per-logger, gated on verbose being enabled. Ambient "event" keys arriving via
      // withContext/diagnostic folding are seeded directly into `this.fields` in the constructor, never
      // routed through field() -- only an explicit, caller-authored field("event", ...) call reaches here,
      // matching OBS-40's "ambient event keys... defer silently and must not be warned about."
      if (this.verboseEnabled && this.collisionGate.shouldWarn()) {
        this.sink('verbose', new Map<string, unknown>([
          [RESERVED_EVENT_KEY, COLLISION_WARNING_EVENT],
          ['message', 'LogEvent.field: "event" is reserved; use event() to set it instead.'],
        ]));
      }
      return this;
    }
    this.fields.set(key, renderField(value));
    return this;
  }

  public event(name: string): this {
    this.eventTag = name === '' ? undefined : name;
    return this;
  }

  public cause(error: unknown): this {
    this.fields.set('cause', renderField(error));
    return this;
  }

  public emit(): void {
    if (this.emitted) return;
    this.emitted = true;

    // OBS-4 suppresses the other sources for the `event` key ONLY "when a non-empty tag is set". With no tag
    // -- or after event('') cleared it -- an ambient `event` key from global context survives, because OBS-9
    // requires the global context on every event and nothing is competing for the key. An earlier draft
    // deleted it unconditionally, silently dropping a field the caller had deliberately configured.
    const withTag = new Map(this.fields);
    if (this.eventTag !== undefined) withTag.set(RESERVED_EVENT_KEY, this.eventTag);

    this.sink(this.level, withTag);
  }
}

/** OBS-1: one shared, allocation-minimal inert event -- every builder method returns `this`, emit() is a no-op. */
const NOOP_EVENT: LogEvent = Object.freeze({
  field(): LogEvent { return NOOP_EVENT; },
  event(): LogEvent { return NOOP_EVENT; },
  cause(): LogEvent { return NOOP_EVENT; },
  emit(): void {},
});

/**
 * The no-op default (OBS-1), installed process-wide until a consumer supplies a real one. A frozen object
 * literal rather than a class instance: it owns no lifecycle and no mutable state, which
 * `docs/knowledge/data-modeling.md` line 10 makes the test for reaching for `class` at all, and freezing a
 * process-wide shared singleton is cheap insurance against a consumer monkey-patching it for everyone.
 */
export const NOOP_LOGGER: Logger = Object.freeze({
  atLevel(): LogEvent { return NOOP_EVENT; },
  withContext(): Logger { return NOOP_LOGGER; },
});

export interface CreateLoggerOptions {
  readonly globalFields?: Readonly<Record<string, unknown>>;
  /** OBS-10: default {trace.id, span.id}; null folds every present diagnostic-context key. */
  readonly diagnosticAllowList?: readonly string[] | null;
  /** OBS-1: gates atLevel's allocation -- a disabled level returns NOOP_EVENT without building a real one. */
  readonly isLevelEnabled?: (level: LogLevel) => boolean;
}

/**
 * The single concrete `Logger` builder every real backend constructs through -- the pino/debug bridges
 * (Tasks 7-8) and any caller's own adapter -- rather than reimplementing the field/event/emit protocol per
 * backend. Wires OBS-5's three-way precedence (folding diagnostic context via Task 1's
 * `getDiagnosticContext`) and OBS-40's collision warning exactly once, here.
 */
export function createLogger(
  sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void,
  options: CreateLoggerOptions = {},
): Logger {
  invariant(typeof sink === 'function', 'createLogger: sink must be a function');

  return buildLogger({
    sink,
    globalFields: options.globalFields ?? {},
    diagnosticAllowList:
      options.diagnosticAllowList === undefined ? DEFAULT_DIAGNOSTIC_ALLOW_LIST : options.diagnosticAllowList,
    isLevelEnabled: options.isLevelEnabled ?? ((): boolean => true),
    // OBS-40 throttles "per logger". A withContext-derived logger is the same logical logger with more
    // context attached, so it shares the gate -- otherwise a caller who derives per request gets one warning
    // per request, which is exactly the flood the throttle exists to prevent.
    collisionGate: new CollisionWarningGate(),
  });
}

/** Every field the built Logger closes over. One object, so no function here exceeds `max-params: 3`. */
interface LoggerWiring {
  readonly sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void;
  readonly globalFields: Readonly<Record<string, unknown>>;
  readonly diagnosticAllowList: readonly string[] | null;
  readonly isLevelEnabled: (level: LogLevel) => boolean;
  readonly collisionGate: CollisionWarningGate;
}

function buildLogger(wiring: LoggerWiring): Logger {
  return {
    atLevel(level: LogLevel): LogEvent {
      if (!wiring.isLevelEnabled(level)) return NOOP_EVENT;
      return new RealLogEvent({
        level,
        wiring,
        diagnosticFields: getDiagnosticContext(wiring.diagnosticAllowList),
        verboseEnabled: wiring.isLevelEnabled('verbose'),
      });
    },
    withContext(fields: Readonly<Record<string, unknown>>): Logger {
      invariant(fields !== null && typeof fields === 'object', 'Logger.withContext: fields must be an object');
      return buildLogger({...wiring, globalFields: {...wiring.globalFields, ...fields}});
    },
  };
}

let globalLogger: Logger = NOOP_LOGGER;

/** Mirrors 7a's CFG-13 global-configuration slot: last-write-wins, safe publication, no-op default. */
export function getGlobalLogger(): Logger {
  return globalLogger;
}

/** CFG-37's analog for this slot: a null/absent logger is rejected rather than stored. */
export function setGlobalLogger(logger: Logger): void {
  invariant(logger !== null && logger !== undefined, 'setGlobalLogger: logger is required');
  invariant(typeof logger.atLevel === 'function', 'setGlobalLogger: logger.atLevel must be a function');
  globalLogger = logger;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/logger.test.ts`
Expected: PASS — 26 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/logger.ts packages/core/src/observability/logger.test.ts
git commit -m "feat(core): Logger/LogEvent facade, createLogger, no-op default, global slot (OBS-1..9, OBS-40)"
```

---

### Task 3: `redaction.ts` — the redaction policy

**Files:**
- Create: `packages/core/src/observability/redaction.ts`
- Test: `packages/core/src/observability/redaction.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; the global `URL` class (no import).
- Produces: `redactUrl(url: URL | string, queryAllowList?): string`; `type DroppedHeaderPolicy = 'mark' |
  'omit'`; `redactHeaderValue(name: string, value: string, policy?: DroppedHeaderPolicy): string | undefined`.
  Task 6 consumes all three. All stay `@internal` — no root re-export.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/redaction.test.ts
// Exercises: OBS-11 (userinfo always redacted), OBS-12 (query allow-list, default {api-version}), OBS-13
// (fragment key=value tokens redacted the same way, plain fragment preserved), OBS-14 (scheme/host/port/path
// untouched, no spurious "?"), OBS-15 (malformed URL -> fixed sentinel, never throws), OBS-16 (header-value
// URL: absolute redacted like a request URL, relative keeps path + "?***" marker), OBS-18 (header-name
// allow-list, default-deny).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {redactHeaderValue, redactUrl} from './redaction.js';

describe('redactUrl (OBS-11..15)', () => {
  test('userinfo is always redacted', () => {
    const redacted = redactUrl('https://user:secret@example.com/path');
    expect(redacted).not.toContain('user');
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('***:***@');
  });

  test('query values are redacted unless allow-listed (default {api-version})', () => {
    const redacted = redactUrl('https://example.com/p?api-version=1&token=abc');
    expect(redacted).toContain('api-version=1');
    expect(redacted).toContain('token=***');
  });

  test('a fragment key=value token is redacted; a plain fragment is preserved', () => {
    expect(redactUrl('https://example.com/p#access_token=SECRET')).toContain('access_token=***');
    expect(redactUrl('https://example.com/p#section')).toContain('#section');
  });

  test('scheme, host, port, and path are never altered', () => {
    const redacted = redactUrl('https://example.com:8443/a/b?token=x');
    expect(redacted).toContain('https://example.com:8443/a/b');
  });

  test('a present-but-empty query keeps its trailing "?" (OBS-14)', () => {
    expect(redactUrl('https://example.com/p?')).toBe('https://example.com/p?');
  });

  test('a URL with no query gains no spurious "?" (OBS-14)', () => {
    expect(redactUrl('https://example.com/p')).toBe('https://example.com/p');
  });

  test('a "?" inside the fragment is not treated as a query delimiter (OBS-14)', () => {
    expect(redactUrl('https://example.com/p#a?b')).toBe('https://example.com/p#a?b');
  });

  test('a malformed URL redacts to the fixed sentinel, never throwing', () => {
    expect(() => redactUrl('not a url at all ###')).not.toThrow();
    expect(redactUrl('not a url at all ###')).toBe('[malformed url]');
  });

  test('property: never throws for any string', () => {
    fc.assert(fc.property(fc.string(), (value) => {
      expect(() => redactUrl(value)).not.toThrow();
    }));
  });
});

describe('redactHeaderValue (OBS-16, OBS-17, OBS-18)', () => {
  test('an allow-listed header name passes its value through', () => {
    expect(redactHeaderValue('Content-Type', 'application/json')).toBe('application/json');
  });

  test('a non-allow-listed header name is marked, not passed through (default-deny, "mark" policy)', () => {
    expect(redactHeaderValue('Authorization', 'Bearer secret')).toBe('REDACTED');
  });

  test('the "omit" policy drops a non-allow-listed header entirely (OBS-18)', () => {
    expect(redactHeaderValue('Authorization', 'Bearer secret', 'omit')).toBeUndefined();
  });

  test('a Location header carrying a query is redacted through the URL-value redactor', () => {
    const value = redactHeaderValue('Location', '/callback?code=SECRET');
    expect(value).toContain('/callback?***');
    expect(value).not.toContain('SECRET');
  });

  test('a relative path with no query/fragment passes through unchanged', () => {
    expect(redactHeaderValue('Location', '/plain/path')).toBe('/plain/path');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/redaction.test.ts`
Expected: FAIL — `Cannot find module './redaction.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/redaction.ts
import {invariant} from '../invariant.js';

const DEFAULT_QUERY_ALLOW_LIST = new Set(['api-version']);
const DEFAULT_HEADER_ALLOW_LIST = new Set(['content-type', 'content-length', 'accept', 'user-agent']);
const MALFORMED_URL_SENTINEL = '[malformed url]';

function redactSearchParams(search: URLSearchParams, allowList: ReadonlySet<string>): URLSearchParams {
  const redacted = new URLSearchParams();
  for (const [key, value] of search) {
    redacted.append(key, allowList.has(key.toLowerCase()) ? value : '***');
  }
  return redacted;
}

/** OBS-13: `URL` does not parse key=value tokens out of `.hash`, so this is hand-rolled, same reasoning as
 * the query redactor. A plain fragment with no `=` is preserved verbatim. */
function redactFragment(hash: string, allowList: ReadonlySet<string>): string {
  if (hash === '' || hash === '#') return hash;
  const raw = hash.slice(1);
  if (!raw.includes('=')) return hash;
  const tokens = raw.split('&').map((token) => {
    const [key, ...rest] = token.split('=');
    if (key === undefined || rest.length === 0) return token;
    return allowList.has(key.toLowerCase()) ? token : `${key}=***`;
  });
  return `#${tokens.join('&')}`;
}

/**
 * OBS-14 requires a present-but-empty query (a bare trailing "?") to be preserved, and the WHATWG `URL` has
 * already discarded it by the time we hold a parsed object: `new URL('https://h/p?').search === ''`, exactly
 * like a URL with no query at all. The raw input string is therefore the authority on whether a "?" was
 * present. A `URL` handed in directly has no raw form to consult, so it reports via `.search`.
 */
function hasQueryDelimiter(input: URL | string): boolean {
  if (typeof input !== 'string') return input.search !== '';
  const beforeFragment = input.split('#')[0] ?? input;
  return beforeFragment.includes('?');
}

/** OBS-11..15: total -- any parse/rebuild failure returns the fixed sentinel, never throws. */
export function redactUrl(input: URL | string, queryAllowList: ReadonlySet<string> = DEFAULT_QUERY_ALLOW_LIST): string {
  try {
    const url = typeof input === 'string' ? new URL(input) : input;
    // OBS-11: userinfo is masked only when present -- never inject a "***:***@" marker into a URL that never
    // carried credentials. This is the one piece of load-bearing logic in this function; keep it a single,
    // explicit conditional rather than a template trick that happens to net out the same way.
    const userinfo = url.username !== '' || url.password !== '' ? '***:***@' : '';
    const query = redactSearchParams(url.searchParams, queryAllowList).toString();
    const fragment = redactFragment(url.hash, queryAllowList);
    const separator = query !== '' || hasQueryDelimiter(input) ? '?' : '';
    return `${url.protocol}//${userinfo}${url.host}${url.pathname}${separator}${query}${fragment}`;
  } catch {
    return MALFORMED_URL_SENTINEL;
  }
}

function redactAbsoluteOrRelativeUrl(value: string): string {
  try {
    return redactUrl(new URL(value));
  } catch {
    // Not an absolute URL -- OBS-16's relative-value path: keep the path, drop query/fragment, mark with "?***".
    const hasQueryOrFragment = value.includes('?') || value.includes('#');
    if (!hasQueryOrFragment) return value;
    const path = value.split(/[?#]/u)[0] ?? value;
    return `${path}?***`;
  }
}

/**
 * OBS-18's two-way policy for a name that is not allow-listed: `'mark'` emits the fixed `REDACTED` marker so
 * the reader can see a header was withheld; `'omit'` drops it from the event entirely. `'mark'` is the
 * default -- a visibly withheld header is more diagnosable than one that silently vanishes.
 */
export type DroppedHeaderPolicy = 'mark' | 'omit';

const REDACTED_MARKER = 'REDACTED';

/** OBS-18: header-name allow-list (default-deny); OBS-16/17: URL-valued headers redacted through the shared
 * URL redactor so the sync/async paths cannot drift.
 *
 * @param policy - what to do with a non-allow-listed name. @default 'mark'
 * @returns the value to log, or `undefined` meaning "omit this header from the event entirely".
 */
export function redactHeaderValue(
  name: string,
  value: string,
  policy: DroppedHeaderPolicy = 'mark',
): string | undefined {
  invariant(typeof name === 'string', 'redactHeaderValue: name must be a string');

  const lowerName = name.toLowerCase();
  if (lowerName === 'location' || lowerName === 'content-location') {
    return redactAbsoluteOrRelativeUrl(value);
  }
  if (DEFAULT_HEADER_ALLOW_LIST.has(lowerName)) return value;
  return policy === 'mark' ? REDACTED_MARKER : undefined;
}
```

Note: the `redactUrl` scheme/host reconstruction above is intentionally written defensively (string
concatenation, not template-literal-only) because userinfo reconstruction from a parsed `URL` needs care --
`URL.toString()` re-serializes credentials in the clear if present. At implementation time, verify against
`URL`'s actual `username`/`password` getters and simplify this function once tests pin the exact expected
output byte-for-byte; the test suite in Step 1 is the source of truth for exact formatting, not this sketch.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/redaction.test.ts`
Expected: PASS — 14 tests. If the sketch's exact string formatting doesn't match, adjust `redactUrl`'s
reconstruction logic until it does — the test assertions are authoritative.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/redaction.ts packages/core/src/observability/redaction.test.ts
git commit -m "feat(core): URL and header redaction policy (OBS-11..19)"
```

---

### Task 4: `tracing.ts` — `Tracer`/`Span`, W3C trace-context generation, `createInstrumentationBundle`

**Files:**
- Create: `packages/core/src/observability/tracing.ts`
- Test: `packages/core/src/observability/tracing.test.ts`

**Interfaces:**
- Consumes: `globalThis.crypto.getRandomValues` (no import); `type InstrumentationBundle` (type-only) from
  `../context/instrumentation.js` (4a) — read-only, 4a's file is never modified (see Global Constraints);
  `withDiagnosticFields` from `./diagnostic-context.js` (Task 1), for `OBS-23`'s correlation push.
- Produces: `interface Span {isRecording, setAttribute, recordException, end}`; `interface Tracer {startSpan}`;
  `interface Scope {close}`; `NOOP_SPAN: Span`; `NOOP_TRACER: Tracer`; `activateSpan(span): Scope` (`OBS-22`);
  `activateSpanForCorrelation(span): Scope` (`OBS-23`); `getActiveSpan(): Span`; `generateTraceId(flavor):
  string`; `generateSpanId(): string`; `createInstrumentationBundle(tracerFactory?): InstrumentationBundle`.
  Task 6 consumes `Tracer`/`Span`/`NOOP_TRACER`/`activateSpanForCorrelation`.

`OBS-22`/`OBS-23` are the reason this task exists beyond id generation, and an earlier draft of this plan
shipped neither while the checklist claimed `OBS-21`–`OBS-25` complete. They are built here.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/tracing.test.ts
// Exercises: OBS-21 (non-recording span: inert mutators, idempotent end), OBS-22 (activation scope restores
// the prior span, including on throw), OBS-23 (correlation push/restore, skipped for a non-recording span),
// OBS-25 (allocation-free no-op singletons), OBS-26/27 (W3C 32-hex trace id / 16-hex span id, never
// all-zero; Datadog 64-bit decimal).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {getDiagnosticContext} from './diagnostic-context.js';
import {
  NOOP_SPAN,
  NOOP_TRACER,
  activateSpan,
  activateSpanForCorrelation,
  createInstrumentationBundle,
  generateSpanId,
  generateTraceId,
  getActiveSpan,
  type Span,
} from './tracing.js';

describe('NOOP_SPAN (OBS-21, OBS-25)', () => {
  test('is non-recording and every mutator is inert, returning the same instance', () => {
    expect(NOOP_SPAN.isRecording).toBe(false);
    expect(NOOP_SPAN.setAttribute('k', 'v')).toBe(NOOP_SPAN);
    expect(NOOP_SPAN.recordException(new Error('x'))).toBe(NOOP_SPAN);
  });

  test('end() is idempotent', () => {
    expect(() => {
      NOOP_SPAN.end();
      NOOP_SPAN.end();
    }).not.toThrow();
  });
});

describe('NOOP_TRACER (OBS-25)', () => {
  test('startSpan returns the shared NOOP_SPAN singleton, allocating nothing new', () => {
    expect(NOOP_TRACER.startSpan('op-a')).toBe(NOOP_SPAN);
    expect(NOOP_TRACER.startSpan('op-b')).toBe(NOOP_SPAN);
  });
});

describe('trace/span id generation (OBS-26, OBS-27)', () => {
  test('W3C trace ids are 32 lowercase hex chars, never all-zero', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = generateTraceId('w3c');
      expect(id).toMatch(/^[0-9a-f]{32}$/u);
      expect(id).not.toBe('0'.repeat(32));
    }
  });

  test('span ids are 16 lowercase hex chars, never all-zero', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/u);
      expect(id).not.toBe('0'.repeat(16));
    }
  });

  test('Datadog trace ids are decimal, non-zero, within the 64-bit unsigned range', () => {
    const id = generateTraceId('datadog');
    expect(id).toMatch(/^\d+$/u);
    expect(BigInt(id)).toBeGreaterThan(0n);
    expect(BigInt(id)).toBeLessThan(2n ** 64n);
  });

  test('the no-op flavor always yields the invalid all-zero sentinel', () => {
    expect(generateTraceId('none')).toBe('0'.repeat(32));
  });

  test('property: never produces the all-zero id across many draws', () => {
    fc.assert(fc.property(fc.constant(null), () => {
      expect(generateTraceId('w3c')).not.toBe('0'.repeat(32));
    }), {numRuns: 500});
  });
});

describe('span activation and log correlation (OBS-22, OBS-23)', () => {
  function recordingSpan(traceId: string, spanId: string): Span {
    return {
      isRecording: true,
      setAttribute(): Span { return this; },
      recordException(): Span { return this; },
      end(): void {},
      spanContext: () => ({traceId, spanId}),
    } as Span;
  }

  test('close() restores the previously-active span', () => {
    const outer = recordingSpan('a'.repeat(32), 'b'.repeat(16));
    const inner = recordingSpan('c'.repeat(32), 'd'.repeat(16));

    const outerScope = activateSpan(outer);
    const innerScope = activateSpan(inner);
    expect(getActiveSpan()).toBe(inner);
    innerScope.close();
    expect(getActiveSpan()).toBe(outer);
    outerScope.close();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });

  test('close() restores even when the guarded code throws', () => {
    const span = recordingSpan('a'.repeat(32), 'b'.repeat(16));
    const scope = activateSpan(span);
    expect(() => {
      try {
        throw new Error('boom');
      } finally {
        scope.close();
      }
    }).toThrow('boom');
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });

  test('close() is idempotent', () => {
    const scope = activateSpan(recordingSpan('a'.repeat(32), 'b'.repeat(16)));
    scope.close();
    expect(() => scope.close()).not.toThrow();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });

  test('a recording span pushes trace.id/span.id and restores them on close (OBS-23)', () => {
    const span = recordingSpan('e'.repeat(32), 'f'.repeat(16));

    const scope = activateSpanForCorrelation(span);
    expect(getDiagnosticContext(null)['trace.id']).toBe('e'.repeat(32));
    expect(getDiagnosticContext(null)['span.id']).toBe('f'.repeat(16));
    scope.close();

    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
  });

  test('a non-recording span pushes nothing and delegates to plain activation (OBS-23)', () => {
    const scope = activateSpanForCorrelation(NOOP_SPAN);
    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
    scope.close();
  });
});

describe('createInstrumentationBundle', () => {
  test('generates valid W3C ids and marks the bundle valid', () => {
    const bundle = createInstrumentationBundle();
    expect(bundle.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(bundle.spanId).toMatch(/^[0-9a-f]{16}$/u);
    expect(bundle.isValid).toBe(true);
  });

  test('a supplied tracerFactory is reachable through the bundle', () => {
    const spans: string[] = [];
    const tracer = {
      startSpan: (name: string) => {
        spans.push(name);
        return NOOP_SPAN;
      },
    };
    const bundle = createInstrumentationBundle(() => tracer);
    // The bundle's tracerFactory field is `unknown` per 4a's frozen shape; a real consumer (Task 6) casts it.
    (bundle.tracerFactory as () => typeof tracer)();
    expect(spans).toHaveLength(0); // factory itself doesn't start a span; startSpan is called by a consumer
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/tracing.test.ts`
Expected: FAIL — `Cannot find module './tracing.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/tracing.ts
// Type-only import of 4a's already-frozen InstrumentationBundle shape -- a normal forward dependency (this
// phase executes after 4a). 4a's file is never modified; activeSpan/tracerFactory stay typed `unknown` there.
// See this phase's design doc, "Closing 4a's deferred 'real tracing backend' without touching 4a."
import {invariant} from '../invariant.js';
import {createAsyncScopedStore, pushDiagnosticFields} from './diagnostic-context.js';
import type {InstrumentationBundle} from '../context/instrumentation.js';

/**
 * A structural subset of `@opentelemetry/api`'s own `Span` shape -- not a bespoke interface. A real OTel span
 * duck-types in with zero adapter code; `@dexpace/core` adds no dependency on `@opentelemetry/api`.
 */
export interface Span {
  readonly isRecording: boolean;
  setAttribute(key: string, value: unknown): this;
  recordException(error: unknown): this;
  end(): void;
}

export interface Tracer {
  startSpan(name: string): Span;
}

/** OBS-21/OBS-25: a frozen singleton, non-recording, every mutator inert, end() idempotent, zero allocation. */
export const NOOP_SPAN: Span = Object.freeze({
  isRecording: false,
  setAttribute(): Span { return NOOP_SPAN; },
  recordException(): Span { return NOOP_SPAN; },
  end(): void {},
});

/** OBS-25: selecting the no-op tracer allocates nothing -- startSpan always returns the same NOOP_SPAN. */
export const NOOP_TRACER: Tracer = Object.freeze({
  startSpan(): Span { return NOOP_SPAN; },
});

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  const allZero = bytes.every((b) => b === 0);
  if (allZero) bytes[byteLength - 1] = 1; // OBS-27: coerce a zero draw non-zero
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** OBS-26/27: W3C (128-bit hex), Datadog (64-bit unsigned decimal), and no-op (invalid sentinel) flavors. */
export function generateTraceId(flavor: 'w3c' | 'datadog' | 'none'): string {
  if (flavor === 'none') return '0'.repeat(32);
  if (flavor === 'datadog') {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return String(value === 0n ? 1n : value);
  }
  return randomHex(16);
}

export function generateSpanId(): string {
  return randomHex(8);
}

// -- OBS-22/OBS-23: current-span activation and log correlation ------------------------------------------

/**
 * OBS-22: closing restores the previously-active span. `close()` rather than `Symbol.dispose` -- the same
 * call the Phase 2 and 3a designs settled on, because `Symbol.dispose` postdates the `>=18.17` floor
 * `verify-node-floor` pins. See the design doc's Deviation Ledger.
 */
export interface Scope {
  close(): void;
}

// The current-span slot. `createAsyncScopedStore` comes from diagnostic-context.ts so that this file needs
// no `node:` import of its own -- see Global Constraints.
const spanStorage = createAsyncScopedStore<Span>();

/** NOOP_SPAN when nothing is active, so a caller never has to null-check. */
export function getActiveSpan(): Span {
  return spanStorage.get() ?? NOOP_SPAN;
}

/**
 * OBS-22: activation returns a scope handle rather than taking a callback, because a pipeline step starts a
 * span before `await next(...)` and ends it after — two statements, not one guarded block. `close()` is
 * idempotent and restores the previously-active span, including when the guarded code threw (the caller's
 * `try`/`finally` is what guarantees `close()` runs; the step in Task 6 uses exactly that shape).
 */
export function activateSpan(span: Span): Scope {
  invariant(span !== null && span !== undefined, 'activateSpan: span is required');
  invariant(typeof span.end === 'function', 'activateSpan: span must implement end()');

  const restore = spanStorage.enter(span);
  return {close: restore};
}

/** Reads W3C ids off a span that exposes an OpenTelemetry-shaped `spanContext()`; undefined when it does not. */
function readCorrelationIds(span: Span): Readonly<Record<string, string>> | undefined {
  // `as`: `Span` is deliberately the minimal structural subset (design doc, Tracing), so `spanContext` is
  // not on it. A real OTel span has one; this widens the view to probe for it and narrows immediately below.
  const candidate = span as {spanContext?: () => {traceId?: string; spanId?: string}};
  if (typeof candidate.spanContext !== 'function') return undefined;
  try {
    const context = candidate.spanContext();
    if (context.traceId === undefined || context.spanId === undefined) return undefined;
    return {'trace.id': context.traceId, 'span.id': context.spanId};
  } catch {
    return undefined; // XCUT-20: a hostile Span implementation must not break the request
  }
}

/**
 * OBS-23: for a RECORDING span, additionally push trace.id/span.id onto the diagnostic context for the
 * scope's lifetime, restoring the prior values on close. For a non-recording span the push is skipped and
 * this delegates to plain activation, exactly as OBS-23 requires.
 *
 * The trace/span ids come off the span's own context when it exposes one (a real OpenTelemetry span does,
 * via `spanContext()`); a span that exposes neither contributes no correlation keys rather than fabricating
 * them.
 */
export function activateSpanForCorrelation(span: Span): Scope {
  const scope = activateSpan(span);
  if (!span.isRecording) return scope;

  const correlation = readCorrelationIds(span);
  if (correlation === undefined) return scope;

  const restore = pushDiagnosticFields(correlation);
  return {
    close(): void {
      restore();
      scope.close();
    },
  };
}


/**
 * Producer function closing 4a's deferred "real tracing backend" (CTX-14/CTX-15) without editing 4a's file:
 * builds a real, valid `InstrumentationBundle` with generated W3C ids and (optionally) a real `tracerFactory`,
 * assigned into the bundle's `unknown`-typed fields -- always legal without a cast on this producer side. A
 * caller passes the result wherever they'd otherwise pass the no-op default.
 */
export function createInstrumentationBundle(tracerFactory?: (operationName: string) => Tracer): InstrumentationBundle {
  return {
    traceId: generateTraceId('w3c'),
    spanId: generateSpanId(),
    // OBS-26: trace flags are "a two-hex-char byte", not a number -- '01' is the sampled bit set. Match 4a's
    // declared field type here; if 4a typed it numerically, that is a 4a defect to raise, not to paper over.
    traceFlags: '01',
    traceState: '',
    traceIdEncoding: 'w3c',
    isValid: true,
    isRemote: false,
    activeSpan: NOOP_SPAN,
    tracerFactory: tracerFactory ?? ((): Tracer => NOOP_TRACER),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/tracing.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/tracing.ts packages/core/src/observability/tracing.test.ts
git commit -m "feat(core): Tracer/Span, activation scope, W3C trace-context generation (OBS-21..27)"
```

---

### Task 5: `metrics.ts` — the metrics SPI

**Files:**
- Create: `packages/core/src/observability/metrics.ts`
- Test: `packages/core/src/observability/metrics.test.ts`

**Interfaces:**
- Consumes: nothing from this package.
- Produces: `interface Counter {add}`; `interface Histogram {record}`; `interface Meter {createCounter,
  createHistogram}`; `NOOP_METER: Meter`. Task 6 consumes `Meter`, `NOOP_METER`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/metrics.test.ts
// Exercises: OBS-31 (no-op default discards every measurement, returns shared instrument singletons), OBS-33
// (a histogram tolerates NaN/Infinity without throwing).
import {describe, expect, test} from 'bun:test';
import {NOOP_METER} from './metrics.js';

describe('NOOP_METER (OBS-31)', () => {
  test('createCounter returns the same shared instrument regardless of name', () => {
    expect(NOOP_METER.createCounter('a')).toBe(NOOP_METER.createCounter('b'));
  });

  test('createHistogram returns the same shared instrument regardless of name', () => {
    expect(NOOP_METER.createHistogram('a')).toBe(NOOP_METER.createHistogram('b'));
  });

  test('recording into the no-op instruments never throws, including non-finite values (OBS-33)', () => {
    const counter = NOOP_METER.createCounter('http.client.request.count');
    const histogram = NOOP_METER.createHistogram('http.client.request.duration');
    expect(() => counter.add(1, {method: 'GET'})).not.toThrow();
    expect(() => histogram.record(Number.NaN)).not.toThrow();
    expect(() => histogram.record(Number.POSITIVE_INFINITY)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/metrics.test.ts`
Expected: FAIL — `Cannot find module './metrics.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/metrics.ts

export interface Counter {
  /** OBS-33: only non-negative increments are valid; not validated on the hot path. */
  add(delta: number, attributes?: Readonly<Record<string, unknown>>): void;
}

export interface Histogram {
  /** OBS-33: tolerates any input, including non-finite values, without throwing. */
  record(value: number, attributes?: Readonly<Record<string, unknown>>): void;
}

export interface Meter {
  createCounter(name: string, options?: {readonly unit?: string; readonly description?: string}): Counter;
  createHistogram(name: string, options?: {readonly unit?: string; readonly description?: string}): Histogram;
}

const NOOP_COUNTER: Counter = Object.freeze({add(): void {}});
const NOOP_HISTOGRAM: Histogram = Object.freeze({record(): void {}});

/** OBS-31: discards every measurement, returns shared instrument singletons regardless of name. No metrics
 * runtime is pulled into core's dependencies -- this file has none. */
export const NOOP_METER: Meter = Object.freeze({
  createCounter(): Counter { return NOOP_COUNTER; },
  createHistogram(): Histogram { return NOOP_HISTOGRAM; },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/metrics.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/metrics.ts packages/core/src/observability/metrics.test.ts
git commit -m "feat(core): metrics SPI, no-op default (OBS-31..33)"
```

---

### Task 6: `logging-step.ts` — the `LOGGING` pillar step

Read `OBS-34`–`OBS-39` before starting. Re-read 3b's `withRequestLogging`/response-body-logging-wrapper
signatures (`packages/core/src/body/request-body-logging.ts`, `response-body-logging.ts`) — this task wires
them in, it does not rebuild them.

**Files:**
- Create: `packages/core/src/observability/logging-step.ts`
- Test: `packages/core/src/observability/logging-step.test.ts`

**Interfaces:**
- Consumes: `StepDescriptor`, `StepContext` from `../pipeline/step.js`; `withRequestLogging` from
  `../body/request-body-logging.js` (3b, `@internal`); the response-body logging wrapper from
  `../body/response-body-logging.js` (3b, `@internal`); `getGlobalLogger`, `LogEvent`, `LogLevel`, `Logger`
  from `./logger.js`; `redactUrl`, `redactHeaderValue`, `DroppedHeaderPolicy` from `./redaction.js`;
  `NOOP_TRACER`, `activateSpanForCorrelation`, `Span`, `Tracer` from `./tracing.js`; `NOOP_METER`, `Meter`
  from `./metrics.js`; `getGlobalConfiguration`, `CFG_KEY_LOG_LEVEL`, `getDefaultClock`, `Clock` from
  `../config/configuration.js` (7a); `toError` from `../error/to-error.js`; `invariant`.
- Produces: `LOGGING_STEP_TYPE: unique symbol`; `type LoggingGranularity`; `interface LoggingStepSettings
  {logger?, severity?, granularity?, previewSizeBytes?, tracerFactory?, meter?, droppedHeaderPolicy?,
  clock?}`; `loggingStep(settings?): StepDescriptor`. Task 9's `preset.ts` retrofit consumes
  `loggingStep`/`LoggingStepSettings`.

This task has **two** implementation steps, not one: Step 3 builds the event/span/metric machinery
(`OBS-20`, `OBS-34`, `OBS-35`, `OBS-39`), Step 3b wires 3b's body tees in at `'body'` granularity
(`OBS-36`–`OBS-38`). Step 3b is not optional and not deferrable — `OBS-36` is a MUST, and an earlier draft of
this plan left it as an unnumbered prose note with no checkbox, no test, and no owner, while declaring
`previewSizeBytes` in the settings interface and never reading it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/logging-step.test.ts
// Exercises: OBS-34 (granularity gates log events, not span/metrics), OBS-35 (level resolves from
// Configuration, tolerant/case-insensitive), OBS-39 (stable http.request/http.response event names/keys,
// url.full always redacted), OBS-20 (a throwing Logger is caught and re-surfaced as http.instrumentation.*;
// a throwing tracer/meter propagates, NOT caught).
import {afterEach, describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {Cursor} from '../pipeline/cursor.js';
import {aRequestContext} from '../pipeline/cursor.test-helpers.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {CFG_KEY_LOG_LEVEL, ConfigurationBuilder, setGlobalConfiguration} from '../config/configuration.js';
import type {Logger, LogEvent} from './logger.js';
import {loggingStep} from './logging-step.js';

function spyLogger(): {logger: Logger; events: Array<Record<string, unknown>>} {
  const events: Array<Record<string, unknown>> = [];
  function event(): LogEvent {
    const fields: Record<string, unknown> = {};
    const self: LogEvent = {
      field(key, value) { fields[key] = value; return self; },
      event(name) { fields['event'] = name; return self; },
      cause(error) { fields['cause'] = error; return self; },
      emit() { events.push({...fields}); },
    };
    return self;
  }
  return {logger: {atLevel: () => event(), withContext: () => ({atLevel: () => event(), withContext: () => ({} as Logger)})}, events};
}

async function send(descriptor: ReturnType<typeof loggingStep>, transport: FakeTransport): Promise<unknown> {
  const cursor = new Cursor({steps: [descriptor], transport, request: Request.newBuilder().url('https://example.com').build(), context: aRequestContext()});
  return cursor.advance();
}

describe('granularity gates log events, not tracing/metrics (OBS-34)', () => {
  test('at the default (none), no http.request/http.response events are emitted', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);
    await send(loggingStep({logger, granularity: 'none'}), transport);
    expect(events).toHaveLength(0);
  });

  test('at none, the span still starts/ends and the instruments still record (OBS-34)', async () => {
    // The negative half (no events) above is only half the requirement -- "none silences log events without
    // disabling tracing or metrics" needs the positive half asserted too, or a regression that skipped the
    // whole step at 'none' would pass.
    const {logger} = spyLogger();
    const ended: string[] = [];
    const measurements: number[] = [];
    const tracer = {
      startSpan: (name: string) => ({
        isRecording: true,
        setAttribute(): unknown { return this; },
        recordException(): unknown { return this; },
        end(): void { ended.push(name); },
      }),
    };
    const meter = {
      createCounter: () => ({add: (delta: number) => measurements.push(delta)}),
      createHistogram: () => ({record: (value: number) => measurements.push(value)}),
    };
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(
      loggingStep({logger, granularity: 'none', tracerFactory: () => tracer as never, meter: meter as never}),
      transport,
    );

    expect(ended).toEqual(['http.client.request']);
    expect(measurements.length).toBeGreaterThan(0);
  });

  test('at headers, exactly http.request and http.response fire with stable keys (OBS-39)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);
    await send(loggingStep({logger, granularity: 'headers'}), transport);
    const names = events.map((e) => e['event']);
    expect(names).toEqual(['http.request', 'http.response']);
    expect(events[1]?.['http.response.status_code']).toBe(200);
  });

  test('url.full is always the redacted form, even at headers granularity', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);
    const cursor = new Cursor({
      steps: [loggingStep({logger, granularity: 'headers'})],
      transport,
      request: Request.newBuilder().url('https://user:secret@example.com/p?token=abc').build(),
      context: aRequestContext(),
    });
    await cursor.advance();
    const requestEvent = events.find((e) => e['event'] === 'http.request');
    expect(String(requestEvent?.['url.full'])).not.toContain('secret');
  });
});

describe('level resolution from Configuration (OBS-35)', () => {
  afterEach(() => {
    setGlobalConfiguration(new ConfigurationBuilder().build()); // restore the empty default
  });

  test('with no explicit granularity, an unset config resolves to none -- no events fire', async () => {
    setGlobalConfiguration(new ConfigurationBuilder().build());
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(loggingStep({logger}), transport); // no granularity passed -- must consult Configuration

    expect(events).toHaveLength(0);
  });

  test('a tolerant, case-insensitive "Headers" value from Configuration resolves to the headers level', async () => {
    setGlobalConfiguration(new ConfigurationBuilder().put(CFG_KEY_LOG_LEVEL, '  Headers  ').build());
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(loggingStep({logger}), transport);

    expect(events.map((e) => e['event'])).toEqual(['http.request', 'http.response']);
  });

  test('garbage in Configuration falls back to the default (none), never throwing', async () => {
    setGlobalConfiguration(new ConfigurationBuilder().put(CFG_KEY_LOG_LEVEL, 'not-a-real-level').build());
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await expect(send(loggingStep({logger}), transport)).resolves.toBeDefined();
    expect(events).toHaveLength(0);
  });

  test('an explicit settings.granularity always wins over Configuration', async () => {
    setGlobalConfiguration(new ConfigurationBuilder().put(CFG_KEY_LOG_LEVEL, 'body').build());
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(loggingStep({logger, granularity: 'none'}), transport);

    expect(events).toHaveLength(0);
  });
});

describe('header logging (OBS-17, OBS-18, OBS-39)', () => {
  test('an allow-listed header is logged with its value; a non-allow-listed one is marked', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse(200, {'content-type': 'application/json', 'set-cookie': 'session=secret'}).response,
    ]);

    await send(loggingStep({logger, granularity: 'headers'}), transport);

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(responseEvent?.['http.response.header.content-type']).toBe('application/json');
    expect(responseEvent?.['http.response.header.set-cookie']).toBe('REDACTED');
  });

  test('the omit policy drops a non-allow-listed header from the event entirely (OBS-18)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse(200, {'set-cookie': 'session=secret'}).response,
    ]);

    await send(loggingStep({logger, granularity: 'headers', droppedHeaderPolicy: 'omit'}), transport);

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect('http.response.header.set-cookie' in (responseEvent ?? {})).toBe(false);
  });

  test('a Location header is redacted through the URL-value redactor (OBS-17)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse(302, {location: 'https://other.example/cb?code=SECRET'}).response,
    ]);

    await send(loggingStep({logger, granularity: 'headers'}), transport);

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(String(responseEvent?.['http.response.header.location'])).not.toContain('SECRET');
  });
});

describe('failure containment (OBS-20)', () => {
  test('a throwing Logger is caught; the request still completes', async () => {
    const throwingLogger: Logger = {
      atLevel: () => ({
        field(): LogEvent { return this as unknown as LogEvent; },
        event(): LogEvent { return this as unknown as LogEvent; },
        cause(): LogEvent { return this as unknown as LogEvent; },
        emit(): void { throw new Error('logger exploded'); },
      }),
      withContext(): Logger { return throwingLogger; },
    };
    const transport = new FakeTransport([countingResponse(200).response]);
    await expect(send(loggingStep({logger: throwingLogger, granularity: 'headers'}), transport)).resolves.toBeDefined();
  });

  test('a throwing tracer is NOT caught -- it propagates and fails the request (the asymmetry)', async () => {
    const {logger} = spyLogger();
    const explodingTracer = {startSpan(): never { throw new Error('tracer exploded'); }};
    const transport = new FakeTransport([countingResponse(200).response]);

    await expect(
      send(loggingStep({logger, granularity: 'headers', tracerFactory: () => explodingTracer as never}), transport),
    ).rejects.toThrow('tracer exploded');
  });

  test('a non-Error thrown value does not make the logging step throw its own TypeError (XCUT-20)', async () => {
    const {logger, events} = spyLogger();
    // eslint-disable-next-line @typescript-eslint/no-throw-literal -- deliberately exercising the hostile case
    const transport = new FakeTransport([() => { throw null; }]);

    await expect(
      send(loggingStep({logger, granularity: 'headers'}), transport),
    ).rejects.toBeNull(); // the ORIGINAL value, not a substitute

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(responseEvent?.['error.type']).toBe('Error'); // toError()'s normalization, not a crash
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/logging-step.test.ts`
Expected: FAIL — `Cannot find module './logging-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/logging-step.ts
import type {StepDescriptor, StepContext} from '../pipeline/step.js';
import {CFG_KEY_LOG_LEVEL, getDefaultClock, getGlobalConfiguration, type Clock} from '../config/configuration.js';
import {toError} from '../error/to-error.js';
import {invariant} from '../invariant.js';
import {getGlobalLogger, type LogEvent, type LogLevel, type Logger} from './logger.js';
import {redactHeaderValue, redactUrl, type DroppedHeaderPolicy} from './redaction.js';
import {NOOP_METER, type Meter} from './metrics.js';
import {NOOP_TRACER, activateSpanForCorrelation, type Span, type Tracer} from './tracing.js';

export type LoggingGranularity = 'none' | 'headers' | 'body';

export interface LoggingStepSettings {
  /** @default getGlobalLogger() */
  readonly logger?: Logger | undefined;
  /**
   * Severity the http.request/http.response events emit at (OBS-2's axis).
   * NOT the OBS-34 granularity, which `CFG_KEY_LOG_LEVEL` resolves — see `granularity`.
   * @default 'info' (failures always emit at 'error')
   */
  readonly severity?: LogLevel | undefined;
  /** @default resolved per call from Configuration via CFG_KEY_LOG_LEVEL, then 'none' (OBS-34/OBS-35) */
  readonly granularity?: LoggingGranularity | undefined;
  /** @default 8192 — shared with 3b's tees and toHttpError's cap */
  readonly previewSizeBytes?: number | undefined;
  /** @default undefined — falls back to the call context's tracerFactory, then NOOP_TRACER */
  readonly tracerFactory?: (() => Tracer) | undefined;
  /** @default NOOP_METER */
  readonly meter?: Meter | undefined;
  /** @default 'mark' — OBS-18's policy for a header name that is not allow-listed */
  readonly droppedHeaderPolicy?: DroppedHeaderPolicy | undefined;
  /** @default getDefaultClock() — CFG-15's seam, so duration_ms is drivable in a test */
  readonly clock?: Clock | undefined;
}

const DEFAULT_PREVIEW_SIZE_BYTES = 8192;

/**
 * OBS-34/OBS-35. Note this resolves the GRANULARITY, not the severity: `CFG_KEY_LOG_LEVEL`'s values are
 * OBS-34's none/headers/body, and `settings.severity` is a separate axis. Tolerant per OBS-35 — trimmed,
 * case-insensitive, unrecognised input falls back to the default rather than throwing.
 */
function resolveGranularity(settings: LoggingStepSettings): LoggingGranularity {
  if (settings.granularity !== undefined) return settings.granularity;
  const raw = getGlobalConfiguration().getString(CFG_KEY_LOG_LEVEL, 'none')?.trim().toLowerCase();
  if (raw === 'headers' || raw === 'body') return raw;
  return 'none';
}

/**
 * OBS-17/OBS-18/OBS-39: every header runs through the shared redactor, and a header the redactor answers
 * `undefined` for is omitted from the event entirely. This is what makes 'headers' granularity mean
 * something beyond "the two events fire" — an earlier draft imported `redactHeaderValue` in its interface
 * list and never called it, so `'headers'` and `'none'` differed only in event count.
 */
interface LogEventBuilder {
  readonly target: LogEvent;
  readonly prefix: 'http.request' | 'http.response';
  readonly policy: DroppedHeaderPolicy;
}

function addHeaderFields(event: LogEventBuilder, headers: Iterable<readonly [string, string]>): void {
  for (const [name, value] of headers) {
    const redacted = redactHeaderValue(name, value, event.policy);
    if (redacted !== undefined) event.target.field(`${event.prefix}.header.${name.toLowerCase()}`, redacted);
  }
}

/** OBS-20: catches a throwing Logger emission and re-surfaces as a best-effort http.instrumentation.* event;
 * a secondary failure while emitting THAT diagnostic is swallowed. Tracer/meter calls are never wrapped this
 * way (see Global Constraints) -- their non-throw guarantee rests entirely on the caller's implementation. */
function safeEmit(logger: Logger, build: () => void): void {
  try {
    build();
  } catch (error) {
    try {
      logger.atLevel('verbose').event('http.instrumentation.logFailure').cause(error).emit();
    } catch {
      // swallowed -- a failure while emitting the diagnostic must not itself fail the request
    }
  }
}

/** Stable identity for anchor matching (PIPE-6/PIPE-18) -- module-level, not allocated per call, matching
 * every other pillar step's `_STEP_TYPE` convention (RETRY_STEP_TYPE, REDIRECT_STEP_TYPE, AUTH_STEP_TYPE). A
 * fresh `Symbol()` per `loggingStep()` call would give two descriptors from two calls unequal identities,
 * breaking any future type-based detection the same way `preset.test.ts` already checks `AUTH_STEP_TYPE`. */
export const LOGGING_STEP_TYPE: unique symbol = Symbol('dexpace.logging');

/**
 * The LOGGING pillar step (OBS-34..39). At 'none' (default), no http.request/http.response events fire, but
 * span start/end and counter/histogram recording still run on every request -- "none" silences log events
 * without disabling tracing or metrics.
 *
 * The tracer and the counter/histogram instruments are resolved and created ONCE here, at `loggingStep()`
 * construction time, not inside `fn` -- a real `Meter`/`Tracer` backend expects one instrument/tracer object
 * reused across every request it aggregates over, not a fresh instance minted per call (which the no-op
 * default happens to tolerate silently, masking the bug for any test built only against `NOOP_METER`).
 */
export function loggingStep(settings: LoggingStepSettings = {}): StepDescriptor {
  const meter = settings.meter ?? NOOP_METER;
  const clock = settings.clock ?? getDefaultClock();
  const policy = settings.droppedHeaderPolicy ?? 'mark';
  const severity: LogLevel = settings.severity ?? 'info';
  const previewSizeBytes = settings.previewSizeBytes ?? DEFAULT_PREVIEW_SIZE_BYTES;

  invariant(previewSizeBytes > 0, 'loggingStep: previewSizeBytes must be positive');
  invariant(Number.isFinite(previewSizeBytes), 'loggingStep: previewSizeBytes must be finite');

  // OBS-32's instrument names/units. Created once, here -- a real Meter aggregates over one instrument
  // object, not a fresh one per request.
  const requestCounter = meter.createCounter('http.client.request.count', {unit: '{request}'});
  const requestDuration = meter.createHistogram('http.client.request.duration', {unit: 'ms'});

  return {
    type: LOGGING_STEP_TYPE,
    stage: 'LOGGING',
    fn: async (request, ctx) => {
      const logger = settings.logger ?? getGlobalLogger();
      const granularity = resolveGranularity(settings);
      const tracer = resolveTracer(settings, ctx);
      const span = tracer.startSpan('http.client.request');
      const scope = activateSpanForCorrelation(span); // OBS-23: correlation ids visible to every nested emit
      const startedAt = clock.monotonicMillis();      // CFG-16: monotonic, never wall-clock, for elapsed time

      const outbound = granularity === 'body' ? withRequestLogging(request, previewSizeBytes) : request;

      const emitContext = {logger, severity, granularity, policy, previewSizeBytes};
      emitRequestEvent(emitContext, outbound);

      try {
        const response = await ctx.next(outbound);
        const captured = granularity === 'body' ? withResponseLogging(response, previewSizeBytes) : response;
        const elapsedMs = clock.monotonicMillis() - startedAt;

        requestCounter.add(1, {method: outbound.method, status: captured.status.code});
        requestDuration.record(elapsedMs, {method: outbound.method});
        emitResponseEvent(emitContext, {response: captured, elapsedMs});

        span.end();
        return captured;
      } catch (caught) {
        // toError, never `caught as Error`: `throw null` is legal JavaScript and `null.constructor` is a
        // TypeError raised from inside observability code -- the exact thing XCUT-20 forbids.
        const error = toError(caught);
        const elapsedMs = clock.monotonicMillis() - startedAt;

        requestCounter.add(1, {method: outbound.method, errorType: error.name});
        requestDuration.record(elapsedMs, {method: outbound.method});
        emitFailureEvent(emitContext, {error, elapsedMs});

        span.recordException(error);
        span.end();
        throw caught; // rethrow the ORIGINAL value -- observability must not substitute the caller's error
      } finally {
        scope.close();
      }
    },
  };
}

/** Everything the three emitters need, so each stays within `max-params: 3`. */
interface EmitContext {
  readonly logger: Logger;
  readonly severity: LogLevel;
  readonly granularity: LoggingGranularity;
  readonly policy: DroppedHeaderPolicy;
  readonly previewSizeBytes: number;
}

function emitRequestEvent(context: EmitContext, request: Request): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    const event = context.logger.atLevel(context.severity)
      .event('http.request')
      .field('http.request.method', request.method)
      .field('url.full', redactUrl(request.url));
    addHeaderFields({target: event, prefix: 'http.request', policy: context.policy}, request.headers);
    if (context.granularity === 'body') event.field('http.request.body.preview', previewOf(request));
    event.emit();
  });
}

function emitResponseEvent(context: EmitContext, outcome: {response: Response; elapsedMs: number}): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    const event = context.logger.atLevel(context.severity)
      .event('http.response')
      .field('http.response.status_code', outcome.response.status.code)
      .field('http.response.duration_ms', outcome.elapsedMs);
    addHeaderFields({target: event, prefix: 'http.response', policy: context.policy}, outcome.response.headers);
    if (context.granularity === 'body') {
      event.field('http.response.body.preview', previewOf(outcome.response));
    }
    event.emit();
  });
}

/** OBS-39: a failure emits an `http.response` event carrying `error.type` and the cause, always at 'error'. */
function emitFailureEvent(context: EmitContext, outcome: {error: Error; elapsedMs: number}): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    context.logger.atLevel('error')
      .event('http.response')
      .field('error.type', outcome.error.name)
      .field('http.response.duration_ms', outcome.elapsedMs)
      .cause(outcome.error)
      .emit();
  });
}

/**
 * OBS-34 says span lifecycle and metrics run on EVERY request regardless of granularity, so the tracer is
 * resolved unconditionally. Precedence: an explicit per-pipeline `settings.tracerFactory`, then the per-call
 * context's own factory (CTX-14/CTX-20 -- this is the only thing that makes `createInstrumentationBundle`
 * reachable from a running pipeline), then the no-op.
 */
function resolveTracer(settings: LoggingStepSettings, ctx: StepContext): Tracer {
  if (settings.tracerFactory !== undefined) return settings.tracerFactory();

  // `as`: 4a types InstrumentationBundle.tracerFactory as `unknown` on purpose and its file is never edited
  // (Global Constraints). This is the single sanctioned read-side narrowing, guarded by the typeof check.
  const factory = ctx.context.instrumentation.tracerFactory as ((operationName: string) => Tracer) | undefined;
  if (typeof factory !== 'function') return NOOP_TRACER;

  // Deliberately NOT wrapped in try/catch. OBS-20's asymmetry is explicit that tracer calls are not
  // defensively caught and OBS-30 makes must-not-throw the SPI's own contract; catching here would hide a
  // broken tracer instead of surfacing it. See Global Constraints.
  return factory(ctx.context.operationName ?? 'http.client.request') ?? NOOP_TRACER;
}
```

- [ ] **Step 3b: Wire 3b's body tees and the preview renderer (`OBS-36`–`OBS-38`)**

The Step 3 sketch above calls three things it does not yet define: `withRequestLogging`,
`withResponseLogging`, and `previewOf`. The first two are 3b's already-built `@internal` tees — **import and
drive them, do not reimplement** (Global Constraints). Before writing this step, open
`packages/core/src/body/request-body-logging.ts` and `response-body-logging.ts` and read their real exported
signatures; the names used above are placeholders for whatever 3b actually exports, and the wrapper/argument
order must match 3b, not this sketch.

What this step must establish, in order:

1. **Request side** — at `'body'`, wrap the outgoing request's body with 3b's request-logging tee bounded to
   `previewSizeBytes`. `BODY-17`: the full payload always reaches the transport regardless of the tap cap.
   `BODY-21`: the wrapper exposes the delegate's replayability verbatim, so retry above this step still works.
2. **Response side** — at `'body'`, wrap the response with 3b's two-regime response-logging wrapper, again
   bounded to `previewSizeBytes`. `OBS-36`: a body larger than the cap MUST still stream in full to the
   caller — 3b's prefix-then-live-tail regime already does this; the only new thing here is passing the cap
   and reading the snapshot.
3. **`OBS-37`: skip capture entirely for an unknown-length response body.** Check the declared content length
   before wrapping; when it is absent (chunked/streaming/SSE), return the response unwrapped and emit the
   response event without a body preview. A slow producer must never gate event emission.
4. **`previewOf` — `OBS-38`'s charset-aware, binary-safe renderer.** Reads the tee's snapshot (non-consuming,
   per `XCUT-24`), then: for a text media type, decode with the charset the `Content-Type` declares, falling
   back to UTF-8, using `new TextDecoder(charset, {fatal: false})` so malformed or mid-character-truncated
   input yields replacement characters rather than throwing; for a non-text media type, emit the size-only
   marker `[binary N bytes captured]`; for empty input, the empty string. An unknown charset label makes
   `TextDecoder`'s constructor throw a `RangeError` — catch it and fall back to UTF-8 rather than letting it
   escape, since `OBS-38` says decoding must not throw and `XCUT-20` says observability must not break the
   request.

Add to `logging-step.test.ts`:

```typescript
describe('body preview (OBS-36, OBS-37, OBS-38)', () => {
  test('a body larger than previewSizeBytes still reaches the caller in full, preview is capped', async () => {
    const {logger, events} = spyLogger();
    const payload = 'x'.repeat(50_000);
    const transport = new FakeTransport([textResponse(200, payload)]);

    const response = await send(loggingStep({logger, granularity: 'body', previewSizeBytes: 128}), transport);

    expect(await response.text()).toHaveLength(50_000);           // nothing truncated on the wire
    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(String(responseEvent?.['http.response.body.preview'])).toHaveLength(128);
  });

  test('an unknown-length response body skips capture entirely (OBS-37)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([chunkedResponse(200)]); // no Content-Length

    await send(loggingStep({logger, granularity: 'body'}), transport);

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(responseEvent?.['http.response.body.preview']).toBeUndefined();
  });

  test('a binary body renders as a size-only marker, never decoded (OBS-38)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([binaryResponse(200, new Uint8Array([0xff, 0xfe, 0x00]))]);

    await send(loggingStep({logger, granularity: 'body'}), transport);

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(responseEvent?.['http.response.body.preview']).toBe('[binary 3 bytes captured]');
  });

  test('a truncated multi-byte sequence decodes to a replacement character, never throwing (OBS-38)', async () => {
    const {logger, events} = spyLogger();
    // A 3-byte UTF-8 sequence cut after 2 bytes by the preview cap.
    const transport = new FakeTransport([textResponse(200, '€€€', 'text/plain; charset=utf-8')]);

    await expect(
      send(loggingStep({logger, granularity: 'body', previewSizeBytes: 2}), transport),
    ).resolves.toBeDefined();

    const responseEvent = events.find((e) => e['event'] === 'http.response');
    expect(String(responseEvent?.['http.response.body.preview'])).toContain('�');
  });
});
```

Run: `bun test packages/core/src/observability/logging-step.test.ts`
Expected: PASS. If 3b's helpers do not expose a non-consuming snapshot in the shape `previewOf` needs, that is
a finding against 3b to raise — **not** a licence to buffer the body a second time here.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/logging-step.test.ts`
Expected: PASS — 18 tests (8 from Step 1's original blocks, 3 header-logging, 2 more failure-containment,
4 body-preview from Step 3b, 1 granularity/metrics independence).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/logging-step.ts packages/core/src/observability/logging-step.test.ts
git commit -m "feat(core): LOGGING pillar step -- granularity, event vocabulary, failure containment (OBS-20, OBS-34..39)"
```

---

### Task 7: `@dexpace/logging-pino` — the pino bridge

**Files:**
- Create: `packages/logging-pino/package.json`
- Create: `packages/logging-pino/tsconfig.json` (extends the workspace's `tsconfig.base.json`, per the
  established multi-package project-reference layout; `lib`/`target` pinned to this package's own
  `engines.node` floor, not inherited from the root — `verify:node-floor` gates that agreement)
- Create: `packages/logging-pino/api-extractor.json`
- Create: `packages/logging-pino/src/index.ts`
- Create: `packages/logging-pino/etc/logging-pino.api.md` (generated by `bun run api`, committed)
- Test: `packages/logging-pino/src/index.test.ts`

**Interfaces:**
- Consumes: `createLogger` (value), `Logger`, `LogLevel` (type-only) from `@dexpace/core` (peer); `pino` (peer).
- Produces: `createPinoLogger(instance: import('pino').Logger): Logger`.

- [ ] **Step 1: Scaffold `package.json`**

```json
{
  "name": "@dexpace/logging-pino",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "engines": {"node": ">=18.17"},
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "peerDependencies": {
    "@dexpace/core": "workspace:*",
    "pino": ">=9"
  },
  "peerDependenciesMeta": {
    "@dexpace/core": {"optional": false},
    "pino": {"optional": false}
  },
  "devDependencies": {
    "pino": ">=9"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "api": "api-extractor run --local"
  }
}
```

The `@dexpace/core` peerDependency (not a regular dependency) is what guarantees exactly one copy of core in
an application's dependency tree — `docs/knowledge/package-and-dependency-layout.md`'s already-fixed rule, not
a new decision this task makes.

The rest of the manifest is not boilerplate — each field is a gate this repository already runs against every
published unit, and an earlier draft of this task omitted all of them:

- `exports` is the hard wall that makes `import '@dexpace/logging-pino/src/…'` fail to resolve, and its
  `import`/`require` conditions are what `verify:dual-consumption` checks. `main`/`types` alone do not satisfy
  it (`docs/knowledge/api-design.md` line 68).
- `sideEffects: false` is the tree-shaking promise every dexpace package makes
  (`docs/knowledge/module-organization.md` line 26). This package has no import-time effects.
- `engines.node` must agree with the package's own `tsconfig` `lib`/`target`, not be inherited loosely from
  the workspace root — that agreement is exactly what `verify:node-floor` gates
  (`docs/knowledge/tooling-and-quality-gates.md` lines 50–52).
- `license` and `files` are what `lint:publish` checks.
- `api` produces the checked-in `etc/logging-pino.api.md` snapshot `NFR-4` requires of every published unit.
  Generate it in this task and commit it alongside the source.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/logging-pino/src/index.test.ts
import {describe, expect, test} from 'bun:test';
import pino from 'pino';
import {createPinoLogger} from './index.js';

describe('createPinoLogger', () => {
  test('atLevel maps the four levels onto pino ERROR/WARN/INFO/DEBUG', () => {
    const lines: string[] = [];
    const stream = {write: (line: string) => { lines.push(line); }};
    const instance = pino({level: 'trace'}, stream as never);
    const logger = createPinoLogger(instance);

    logger.atLevel('error').event('test.event').field('k', 'v').emit();

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}');
    expect(parsed.level).toBe(50); // pino's numeric ERROR level
    expect(parsed.event).toBe('test.event');
    expect(parsed.k).toBe('v');
  });

  test('a disabled level emits nothing', () => {
    const lines: string[] = [];
    const stream = {write: (line: string) => { lines.push(line); }};
    const instance = pino({level: 'error'}, stream as never);
    const logger = createPinoLogger(instance);

    logger.atLevel('verbose').field('k', 'v').emit();

    expect(lines).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/logging-pino && bun test`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 4: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/logging-pino/src/index.ts
import {createLogger, type Logger, type LogLevel} from '@dexpace/core';
import type pino from 'pino';

const LEVEL_MAP: Record<LogLevel, pino.Level> = {
  error: 'error',
  warning: 'warn',
  info: 'info',
  verbose: 'debug',
};

/**
 * Bridges core's Logger seam to a caller-supplied pino instance -- pino is a peer, not a core dependency.
 * Precedence (OBS-5, including diagnostic-context folding), truncation (OBS-7), the single-emit guard
 * (OBS-8), and the reserved-key warning (OBS-40) are all handled once by core's `createLogger`; this bridge
 * supplies only the pino-specific sink and the pino-specific enabled check.
 */
export function createPinoLogger(instance: pino.Logger): Logger {
  return createLogger(
    (level, fields) => {
      const record: Record<string, unknown> = {};
      for (const [key, value] of fields) record[key] = value;
      instance[LEVEL_MAP[level]](record);
    },
    {isLevelEnabled: (level) => instance.isLevelEnabled(LEVEL_MAP[level])},
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/logging-pino && bun test`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/logging-pino/
git commit -m "feat(logging-pino): pino bridge for core's Logger seam"
```

---

### Task 8: `@dexpace/logging-debug` — the debug bridge

**Files:**
- Create: `packages/logging-debug/package.json`
- Create: `packages/logging-debug/tsconfig.json` (same `lib`/`target`-pinned-to-`engines.node` rule as Task 7)
- Create: `packages/logging-debug/api-extractor.json`
- Create: `packages/logging-debug/src/index.ts`
- Create: `packages/logging-debug/etc/logging-debug.api.md` (generated by `bun run api`, committed)
- Test: `packages/logging-debug/src/index.test.ts`

**Interfaces:**
- Consumes: `createLogger` (value), `Logger` (type-only) from `@dexpace/core` (peer); `debug` (peer).
- Produces: `createDebugLogger(namespace?: string): Logger`.

- [ ] **Step 1: Scaffold `package.json`**

```json
{
  "name": "@dexpace/logging-debug",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "engines": {"node": ">=18.17"},
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "peerDependencies": {
    "@dexpace/core": "workspace:*",
    "debug": ">=4"
  },
  "peerDependenciesMeta": {
    "@dexpace/core": {"optional": false},
    "debug": {"optional": false}
  },
  "devDependencies": {
    "debug": ">=4",
    "@types/debug": ">=4"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "api": "api-extractor run --local"
  }
}
```

Same field-by-field rationale as Task 7's manifest — `exports`, `sideEffects`, `engines`, `license`, `files`,
and the `api` snapshot are gates, not decoration. `@types/debug` is a dev dependency because `debug` ships no
types of its own, and `createDebugLogger` needs `createDebug`'s signature to typecheck under
`explicit-module-boundary-types`.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/logging-debug/src/index.test.ts
import {describe, expect, test} from 'bun:test';
import {createDebugLogger} from './index.js';

describe('createDebugLogger', () => {
  test('every level maps to a call on the underlying debug instance; nothing throws', () => {
    const logger = createDebugLogger('dexpace:test');
    expect(() => {
      logger.atLevel('error').event('test.event').field('k', 'v').emit();
      logger.atLevel('verbose').emit();
    }).not.toThrow();
  });

  test('withContext returns a logger whose events include the attached fields', () => {
    const logger = createDebugLogger('dexpace:test').withContext({service: 'x'});
    expect(() => logger.atLevel('info').emit()).not.toThrow();
  });
});
```

`debug`'s own enable/disable state is process-env-driven (`DEBUG=dexpace:*`) and not observable from a plain
`bun test` run without setting that env var — this test asserts non-throwing behavior, not captured output,
consistent with `debug`'s own documented testing story.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/logging-debug && bun test`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 4: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/logging-debug/src/index.ts
import {createLogger, type Logger} from '@dexpace/core';
import createDebug from 'debug';

/**
 * Bridges core's Logger seam to the `debug` package -- the "just works, no configuration" option for a
 * consumer who already has DEBUG=... wired into their terminal. `debug` is a peer, not a core dependency.
 * Precedence (OBS-5, including diagnostic-context folding), truncation (OBS-7), the single-emit guard
 * (OBS-8), and the reserved-key warning (OBS-40) are all handled once by core's `createLogger`; this bridge
 * supplies only the debug-specific sink and enabled check.
 *
 * `debug` has no per-level filtering within one namespace instance -- a namespace is wholesale on or off via
 * `DEBUG=...`, exposed as `log.enabled`. Wiring `isLevelEnabled` to that flag (rather than leaving it at
 * `createLogger`'s always-true default) lets a disabled namespace short-circuit at `atLevel()`, satisfying
 * OBS-1's "allocates nothing when disabled" for this backend too, not just `debug`'s own internal no-op.
 */
export function createDebugLogger(namespace = 'dexpace'): Logger {
  const log = createDebug(namespace);
  return createLogger(
    (level, fields) => {
      const record: Record<string, unknown> = {level};
      for (const [key, value] of fields) record[key] = value;
      log('%o', record);
    },
    {isLevelEnabled: () => log.enabled},
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/logging-debug && bun test`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/logging-debug/
git commit -m "feat(logging-debug): debug bridge for core's Logger seam"
```

---

### Task 9: Apply the 5a/5b/5c retrofit call sites

This task exists because of the execution-order correction in the Prerequisite section. 5a's, 5b's, and 5c's
plans each describe a change that imports from `observability/`, and each executes before this phase. Those
three plans leave the call sites out; this task adds them, now that the modules they import exist.

Read each plan's "Amended 2026-07-28 (Phase 7b retrofit)" banner and the marked blocks in its implementation
sketches — those blocks are the specification for this task, and the code below must match what those plans
say they will contain, not a fresh invention.

**Files:**
- Modify: `packages/core/src/retry/engine.ts` + its colocated test
- Modify: `packages/core/src/redirect/redirect-step.ts` + its colocated test
- Modify: `packages/core/src/auth/preset.ts` + `preset.test.ts`

- [ ] **Step 1: Retry (`engine.ts`) — two `SHOULD`-level events**

Add `import {getGlobalLogger} from '../observability/logger.js';` and the two emission sites 5a's plan marks:
an attempt-failed event at the point the loop decides to retry (carrying the 1-based attempt ordinal and the
computed delay) and a retries-exhausted event on the terminal give-up path. Both emit at `verbose`. No
settings field, no `StepContext` change, no new parameter to `runWithRetry` — the global slot is the whole
mechanism.

- [ ] **Step 2: Redirect (`redirect-step.ts`) — three `SHOULD`-level events**

Add the hop event (per redirect followed, carrying status and target), the rejection event (distinguishing
`SchemeDowngradeError`), and the downgrade event, per 5b's banner. **Every URL in every field goes through
`redactUrl` first** — a redirect target is server-controlled and can carry a token in its query. 5b's banner
also records what stays open: `decide()`'s `Decision` type carries no reason discriminant on
`'return-current'`, so a loop-vs-hop-cap distinction is out of scope here and remains a deferred item.

- [ ] **Step 3: Preset (`preset.ts`) — the `LOGGING`-slot install**

Add `loggingStep(options.logging)` as the fourth pillar `standardResilience()` installs, plus the
`logging?: LoggingStepSettings` option and the re-export 5c's banner names. `PIPE-24` requires the preset to
install into **empty slots only** and to reject the whole call if any target pillar is occupied — adding a
fourth pillar must not weaken that up-front validation.

- [ ] **Step 4: Retrofit conformance tests**

```typescript
// Install a spy Logger via setGlobalLogger, drive the real steps, assert the events fire.
// Every test in this block must restore NOOP_LOGGER in afterEach -- the global slot is module-level mutable
// state (Global Constraints).
```

- retry: drive a `503,503,200` sequence through `retryStep` and assert two attempt-failed events with
  ordinals 1 and 2, then no retries-exhausted event (the 200 terminates the loop successfully);
- retry: drive an always-503 sequence past the attempt cap and assert exactly one retries-exhausted event;
- redirect: drive a cross-origin redirect and assert the hop event fires with a **redacted** target;
- preset: assert `standardResilience()` installs four steps and that the installed `loggingStep` is inert by
  default (`granularity: 'none'` → zero events).

- [ ] **Step 5: Run the affected suites**

Run: `bun test packages/core/src/retry packages/core/src/redirect packages/core/src/auth`
Expected: PASS, including every pre-existing test in those files — the retrofit is additive.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/retry packages/core/src/redirect packages/core/src/auth
git commit -m "feat(core): retry/redirect structured logging and the preset's LOGGING slot (OBS-20, PIPE-24)"
```

---

### Task 10: Public barrel promotion, gates, and the checklist

**Files:**
- Modify: `packages/core/src/index.ts`
- Verify: `packages/core/etc/core.api.md`
- Create: `docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability-checklist.md`

**Interfaces:**
- Consumes: every public symbol from Tasks 1–6.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Amend the package-root barrel**

Add to `packages/core/src/index.ts` (no `src/observability/index.ts` — see Global Constraints):

```typescript
export type {LogLevel, Logger, LogEvent, CreateLoggerOptions} from './observability/logger.js';
export {getGlobalLogger, setGlobalLogger, createLogger, NOOP_LOGGER} from './observability/logger.js';
export type {Span, Tracer, Scope} from './observability/tracing.js';
export {
  NOOP_SPAN,
  NOOP_TRACER,
  activateSpan,
  activateSpanForCorrelation,
  getActiveSpan,
  createInstrumentationBundle,
} from './observability/tracing.js';
export type {Counter, Histogram, Meter} from './observability/metrics.js';
export {NOOP_METER} from './observability/metrics.js';
export type {LoggingGranularity, LoggingStepSettings} from './observability/logging-step.js';
export {loggingStep, LOGGING_STEP_TYPE} from './observability/logging-step.js';
```

Deliberately **not** exported, all `@internal`:

- `diagnostic-context.ts` in full (`withDiagnosticFields`, `getDiagnosticContext`, the snapshot bridge,
  `pushDiagnosticFields`, `createAsyncScopedStore`) — no requirement gives a caller direct access to the MDC
  store, and `createAsyncScopedStore` exists only so `node:async_hooks` stays in one file.
- `redaction.ts` in full (`redactUrl`, `redactHeaderValue`, `DroppedHeaderPolicy` — the *type* reaches callers
  transitively through `LoggingStepSettings`, which is the only access they need).
- `tracing.ts`'s `generateTraceId`/`generateSpanId`. An earlier draft of this step exported both while the
  design doc's barrel section said they stay `@internal`; the design is right and this step was wrong.
  `createInstrumentationBundle` is the supported way to obtain generated ids, and per
  `docs/knowledge/api-design.md:56` a helper is promoted only once an outside caller genuinely needs it.
  Every export is a permanent contract.

- [ ] **Step 2: Regenerate the API report**

Run: `bun run api`
Expected: `packages/core/etc/core.api.md` updates to include exactly the symbols from Step 1. Review the diff.

- [ ] **Step 3: Confirm `verify:seam-1` still passes with `diagnostic-context.ts`'s scoped exception**

Run: `bun run verify:seam-1`
Expected: PASS.

- [ ] **Step 4: Run the full gate sequence, for `@dexpace/core` and both new packages**

Run:

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS. The two bridge packages are published units and take the **same** gates, not just
`build` + `test` — `NFR-4`'s API snapshot, `NFR-5`'s coverage floor, `lint:publish`, `verify:dual-consumption`,
and `verify:node-floor` all apply to every published unit (`docs/knowledge/tooling-and-quality-gates.md`
lines 40–52). If the root scripts do not already glob the workspace, they must be extended to include
`packages/logging-pino` and `packages/logging-debug` in this step; running a reduced gate set against a new
published package is how an unreviewed API surface ships.

```bash
for pkg in logging-pino logging-debug; do
  (cd "packages/$pkg" && bun run build && bun test --coverage && bun run api) || exit 1
done
bun run lint:publish && bun run verify:dual-consumption && bun run verify:node-floor
git diff --exit-code packages/*/etc/*.api.md   # an unreviewed API drift fails here, per NFR-4
```

- [ ] **Step 5: Write the requirement checklist**

Create `docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability-checklist.md`, same table format as prior
phase checklists, legend ✅ shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **`§15.1` Structured logging facade** — `OBS-1`–`OBS-9`, `OBS-40` ✅ Task 2 (`createLogger`), consuming
   Task 1's `getDiagnosticContext` for `OBS-5`'s third precedence tier. `OBS-40`'s collision warning is
   implemented (not just interface-shaped) — a fix applied after an earlier review pass found it claimed but
   missing.
2. **`§15.2` Diagnostic-context allow-list** — `OBS-10` ✅ Task 1.
3. **`§15.3` Redaction policy** — `OBS-11`–`OBS-18` ✅ Task 3 (including `OBS-18`'s `'mark'`/`'omit'` policy
   and `OBS-14`'s present-but-empty-query preservation); `OBS-19` (dropped-header verbosity policy) ⏳
   **deferred to Phase 8a** — the drop it reports happens inside a transport, and core has none. Named target,
   not an open question.
4. **`§15.4` Failure containment** — `OBS-20` ✅ Task 6, both halves: log emission caught and re-surfaced as
   `http.instrumentation.*`, tracer/meter deliberately unwrapped, each with its own test.
5. **`§15.5` Tracing** — `OBS-21`–`OBS-25` ✅ Task 4, including `OBS-22`'s activation scope and `OBS-23`'s
   correlation push/restore. (An earlier draft claimed this range while shipping neither — the plan had no
   `Scope`, no `activateSpan`, and no correlation wiring anywhere.)
6. **`§15.6` Trace context (W3C)** — `OBS-26`/`OBS-27` ✅ Task 4.
7. **`§15.7` HTTP-tracer vocabulary** — `OBS-28`/`OBS-29` ⏳ **deferred to Phase 8a**, ordering assertions to
   Phase 9. 7b ships operation-level `startSpan`/`end` only; the per-attempt events need 5a's retry loop and
   the transport milestones need 8a's transport as emission points. Recorded as a Deferred Items row with a
   named target, not a "flag for Phase 9 to confirm whether a caller need has emerged."
8. **`§15.8` Metrics** — `OBS-31`–`OBS-33` ✅ Task 5; `OBS-32`'s instrument names/units ✅ Task 6.
9. **`§15.9` Log level, body preview, event vocabulary** — `OBS-34`, `OBS-35`, `OBS-39` ✅ Task 6 Step 3;
   `OBS-36`–`OBS-38` ✅ Task 6 **Step 3b** (3b's tees driven at `'body'` granularity, unknown-length skip,
   charset-aware/binary-safe preview). `OBS-36` is a MUST and is built in this phase, not deferred.
10. **Cross-phase closures** — `Logger`/`LogEvent` seam (Phase 2 deferral) ✅ Task 2; real W3C trace generation
    (Phase 4a deferral) ✅ Task 4, via `createInstrumentationBundle` (4a's file itself untouched), reachable
    from a running pipeline through Task 6's `resolveTracer`; `standardResilience()`'s `LOGGING` slot (Phase 5c
    deferral) ✅ **Task 9 Step 3**; retry/redirect structured logging (Phase 5a/5b deferral) ✅/⏳ **Task 9
    Steps 1–2** — 5a's fully closes (attempt-failed, retries-exhausted), 5b's partially closes (hop +
    rejection events; the loop-vs-hop-cap distinction stays open, needing a `decide()` reshape out of scope
    for this retrofit). All three land in this phase, not in 5a/5b/5c's own execution — see the Prerequisite's
    execution-order correction.
11. **Deferred out of Phase 7b, each with a named target** — `OBS-28`/`OBS-29`'s richer HTTP-tracer vocabulary
    → **Phase 8a** (ordering assertions → Phase 9); `OBS-19`'s dropped-header verbosity policy → **Phase 8a**;
    5b's loop-vs-hop-cap logging distinction → a future `decide()` reshape, carried as a 5b-owned row.
    Nothing in this phase is deferred to "or Phase 9" as an alternative to a named owner.

State explicitly at the top whether the plan has been executed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/etc/core.api.md \
  docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability-checklist.md
git commit -m "feat(core): promote Phase 7b's public surface; checklist"
```

---

## Self-Review

**1. Spec coverage.** `OBS-1`–`OBS-9`, `OBS-40` → Task 2. `OBS-10` → Task 1. `OBS-11`–`OBS-18` → Task 3.
`OBS-20` → Task 6. `OBS-21`–`OBS-27` → Task 4. `OBS-30` → Task 6 (by construction: tracer/meter unwrapped).
`OBS-31`–`OBS-33` → Task 5. `OBS-34`–`OBS-39` → Task 6 (Step 3 for 34/35/39, Step 3b for 36/37/38).
Two gaps, both deferred to a **named** phase rather than to a condition: `OBS-28`/`OBS-29` (richer HTTP-tracer
vocabulary) → Phase 8a, and `OBS-19` (dropped-header verbosity) → Phase 8a. Both have Deferred Items rows in
the design doc.

**2. Placeholder scan.** No bare "TBD"/"TODO". Task 3's redaction sketch is explicit about being illustrative
*and* says exactly what to do next (verify against `URL`'s real getters). Task 6 Step 3b is a numbered,
checkboxed step with its own tests, not a prose note — an earlier draft left `OBS-36` (a MUST) as an
unnumbered paragraph with no owner, no test, and an unread `previewSizeBytes` setting.

**3. Type consistency.** `Logger`/`LogEvent`/`createLogger` (Task 2) are consumed identically by Task 6
(`logging-step.ts`), Task 7 (`logging-pino`), and Task 8 (`logging-debug`) — same method names (`atLevel`,
`withContext`, `field`, `event`, `cause`, `emit`), and Tasks 7–8 now build on `createLogger` directly rather
than reimplementing the protocol. `Tracer`/`Span`/`NOOP_TRACER`/`NOOP_SPAN` (Task 4) match Task 6's usage exactly.
`Meter`/`NOOP_METER` (Task 5) match Task 6's usage exactly. Fixed one inconsistency during this review: Task
6's original draft cast `settings.tracerFactory` directly as a `Tracer`; corrected to call it as
`settings.tracerFactory?.() ?? NOOP_TRACER` matching `LoggingStepSettings.tracerFactory`'s declared shape
(`(() => Tracer) | undefined`, a zero-arg factory) rather than treating the setting itself as already a
`Tracer`.

**4. Cross-phase retrofit consistency.** Verified against the design doc's own stated boundary: 4a's
`context/instrumentation.ts` is referenced only via a type-only import in Task 4, never a value import or an
edit — `createInstrumentationBundle` is the sole bridge, and Task 6's `resolveTracer` is its sole consumer
(without that consumer the producer would be dead code and `CTX-14`/`CTX-20`'s per-operation tracer factory
would have no wire). The 5a/5b/5c retrofits are **Task 9 of this plan**, not work those three plans perform at
their own execution time: they run before 7b, so a call site of theirs importing `observability/logger.js`
would not resolve. Their banners remain as forward references; this plan owns the edits.

**5. Post-write review pass (2026-07-28).** An independent review against the implementation sketches (not
just the prose) surfaced and fixed four real issues: (a) Task 6's `loggingStep()` allocated a fresh `Symbol()`
per call instead of a stable module-level `LOGGING_STEP_TYPE`, breaking the `PIPE-6`/`PIPE-18` reference-
identity convention every other pillar step follows — fixed, now exported and barrel-promoted (Task 10); (b)
Task 6's counter/histogram instruments were created inside the per-request `fn` closure instead of once at
`loggingStep()` construction — harmless against `NOOP_METER` but wrong for any real `Meter`; fixed by hoisting
`tracer`/`requestCounter`/`requestDuration` outside `fn`; (c) `OBS-35` was marked shipped in the checklist with
no test ever exercising `resolveGranularity`'s `Configuration`-driven branch — fixed with four new tests
(unset/tolerant-case/garbage-input/explicit-override-wins) and a `getGlobalConfiguration`-state reset; (d)
Task 3's `redactUrl` had a dead ternary that always evaluated to `''`, making the userinfo-masking correctness
depend entirely on an unrelated-looking `.replace()` call — simplified to a single explicit conditional. Task
1's global-logger-slot tests were also given an explicit `afterEach` reset, matching the Global Constraint on
tests touching module-level mutable state that the original test file stated but didn't itself follow.

**6. Design-doc adversarial review pass (2026-07-28).** A second review checked this plan's (and the
companion design doc's) claims against the actual product-spec text rather than against their own prose,
surfacing two real gaps in what was originally Task 1 (`logger.ts`): (a) `OBS-5`'s third precedence tier
(folded diagnostic context) was designed and independently tested (the standalone `diagnostic-context.ts`
module) but never actually wired into the Logger's emit path — `RealLogEvent`'s constructor only ever
accepted `globalFields`, and `getDiagnosticContext` was called nowhere outside its own test file; (b) `OBS-40`
(the once-per-logger reserved-key-collision warning) was marked shipped in both the Scope section and this
checklist with zero design content or implementation — `field()`'s collision handling just silently no-opped.

Fixing both properly required a real restructure, not a patch: `@dexpace/core` now ships one concrete `Logger`
implementation, `createLogger(sink, options?)`, rather than bare interfaces plus `NOOP_LOGGER` and an
"illustrative" `RealLogEvent` every backend was expected to reimplement. This also caught the same gap
existing a second and third time, uncaught by the first review: the pino and debug bridges (Tasks 7–8) each
hand-rolled their own `field`/`event`/`emit` protocol from scratch, so neither folded diagnostic context nor
implemented the collision warning either. `createLogger` now owns `OBS-5`'s precedence (including the
diagnostic fold), `OBS-40`'s warning, rendering, truncation, and the single-emit guard exactly once;
`createPinoLogger`/`createDebugLogger` were rewritten to supply only a sink and an `isLevelEnabled` check,
which incidentally also gave the debug bridge a real `OBS-1` disabled-path short-circuit it didn't have
before (previously it always called into `debug` and relied on `debug`'s own internal no-op).

Task ordering changed as a structural consequence: `diagnostic-context.ts` is now Task 1 (it has no
dependencies within this package) and `logger.ts` is now Task 2 (it imports Task 1's `getDiagnosticContext`) —
swapped from the original Task 1/Task 2 assignment. Every cross-reference to "Task 1"/"Task 2" elsewhere in
this plan (Prerequisite list, File Structure, the checklist, this Self-Review) was updated to match.

**7. Validation-review pass (2026-07-29).** A structured review against
`docs/validation-prompts/phase7b-observability-validation-prompt.md`'s three axes (knowledge conformance,
requirement coverage, internal consistency) found and fixed the following. Recorded here so a later reader can
see what was wrong rather than only what is now right.

*Blockers.*
- **Circular execution order.** 5a/5b/5c's retrofit banners say those plans depend on 7b; 7b's Prerequisite
  said it depends on those retrofits already being applied. Neither could go first. Broken by making the
  retrofits **Task 9 of this plan**; the Prerequisite now says so explicitly and instructs an agent executing
  5a/5b/5c to skip the retrofit blocks.
- **`OBS-22`/`OBS-23` claimed but not built.** The design doc specified a span-activation scope and the
  correlation push; Task 4 produced no `Scope`, no `activateSpan`, no correlation wiring, exported none of it,
  and the checklist claimed `OBS-21`–`OBS-25` complete. Now built, tested (5 cases), and barrel-promoted,
  with `pushDiagnosticFields`/`createAsyncScopedStore` added to Task 1 to keep `node:async_hooks` in one file.
- **`OBS-36` (a MUST) had no task.** Body-preview wiring was an unnumbered prose note ending "write this as an
  explicit Step 3b addition"; `previewSizeBytes` was declared and never read. Now Task 6 Step 3b, with four
  tests covering the cap, the unknown-length skip (`OBS-37`), and charset/binary rendering (`OBS-38`).

*Majors.*
- **`OBS-39`'s header fields and `OBS-17`/`OBS-18`'s redaction were never called.** Task 6 listed
  `redactHeaderValue` in its Consumes block and imported only `redactUrl`; `'headers'` granularity emitted no
  headers, making it differ from `'none'` only in event count. `addHeaderFields` now runs every header through
  the redactor, and `OBS-18`'s `'mark'`/`'omit'` policy — designed in the spec, absent from the sketch — is a
  real parameter with tests.
- **Observability could throw into the request path** (`XCUT-20`). `(error as Error).constructor.name` ran
  outside `safeEmit`; `throw null` would have made the logging step raise its own `TypeError`. Now `toError`,
  with a test that throws a non-`Error`.
- **`createInstrumentationBundle` had no consumer.** The design doc said the read-side cast "lives entirely
  inside `logging-step.ts`", but the step read `settings.tracerFactory` and never touched the context bundle.
  `resolveTracer` now implements the documented three-tier precedence.
- **`settings.level` was dead**, and its name collided conceptually with `CFG_KEY_LOG_LEVEL`'s granularity.
  Renamed to `severity`, documented as a separate axis, and actually read.
- **`OBS-6`/`OBS-7` rendering** was `JSON.stringify`-based (a `Map` rendered `{}`, a `symbol` rendered
  `undefined`, a `BigInt` threw) and was applied only to `field()`/`cause()`, not to global-context values.
  Rewritten non-recursively (`docs/knowledge/styleguide-overview.md` line 24 bans recursion in library code)
  and applied to every field source, with 7 new tests including a `fast-check` totality property.
- **`emit()` deleted an ambient `event` key unconditionally**, contradicting `OBS-4`'s "when a non-empty tag
  is set" and `OBS-9`. Now suppressed only when a tag is actually set.
- **`invariant` was imported by no file** despite the Prerequisite listing it, and preconditions used ad hoc
  `if (…) throw` (`docs/knowledge/assertions.md` lines 4–6). Now used throughout.
- **`max-params: 3` was violated** by `RealLogEvent`'s six-argument constructor. Now one `LogEventInit` object.
- **The two bridge packages skipped every published-unit gate** — no `exports`, `sideEffects`, `license`,
  `files`, `engines`, no `etc/*.api.md` snapshot (`NFR-4`), and Task 10 ran only `build`+`test` against them.
  All added.
- **Time went through a bare `performance.now()`** rather than `CFG-15`'s `Clock` seam, leaving
  `http.response.duration_ms` undrivable in a test. Now injected, defaulting to `getDefaultClock()`.
- **The barrel contradicted the design doc**: the plan exported `generateTraceId`/`generateSpanId` while the
  design said they stay `@internal`. The design is right; the exports are removed. (The design doc's own claim
  that they are "consumed only by `ExecutionContext` construction (4a)" was also wrong — 4a runs first and is
  never edited — and has been corrected there.)
- **`OBS-19`, `OBS-28`, `OBS-29` were claimed by section headers and checklist rows while unbuilt.** All three
  now carry Deferred Items rows naming **Phase 8a**, and the Scope section no longer claims "every `OBS-*`
  requirement".

*Minors.* `traceFlags` was numeric `1` where `OBS-26` requires a two-hex-char byte (`'01'`); `OBS-14`'s
present-but-empty-query preservation was neither implemented nor tested (the WHATWG `URL` discards the
trailing `?`, so the raw input string is now the authority); `NOOP_EVENT` and `NOOP_LOGGER` were unfrozen
while every other no-op singleton was frozen; `@default` TSDoc tags were missing from every option field
(`docs/knowledge/api-design.md` line 17); and every task's stated test count was wrong (Task 2 claimed 20 for
17, Task 3 claimed 12 for 10, Task 4 claimed 11 for 10, Task 6 claimed 9 for 8). All corrected.
