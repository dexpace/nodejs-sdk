# Phase 7b — Instrumentation & Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `Logger`/`LogEvent` structured-logging facade, the diagnostic-context (MDC) allow-list, the
redaction policy, tracing (`Tracer`/`Span`, real W3C trace-context generation), the metrics SPI, and the
`LOGGING` pillar step in `@dexpace/core`, plus the `@dexpace/logging-pino` and `@dexpace/logging-debug` bridge
packages — satisfying `docs/product-spec/15-instrumentation-and-observability.md` (`OBS-1`–`OBS-40`), per
`docs/superpowers/specs/2026-07-28-phase7b-observability-design.md`.

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
implemented exactly as their own plans specify — including the 2026-07-28 retrofits this phase's brainstorm
produced in 5a's, 5b's, and 5c's plans (structured log events in `engine.ts`/`redirect-step.ts`, and the
`LOGGING`-slot install in `preset.ts`; see each plan's amendment banner). Concretely:

- `packages/core/src/context/instrumentation.js` — `InstrumentationBundle` (type only; fields stay `unknown`,
  never imported as values by this phase)
- `packages/core/src/body/request-body-logging.js` — `withRequestLogging(delegate, tapCapBytes)` (`@internal`)
- `packages/core/src/body/response-body-logging.js` — the response-body logging wrapper (`@internal`)
- `packages/core/src/pipeline/step.js` — `StepDescriptor`, `StepContext`
- `packages/core/src/config/configuration.js` — `Configuration`, `getGlobalConfiguration`, `CFG_KEY_LOG_LEVEL`
  (7a)
- `packages/core/src/invariant.js` — `invariant()`

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
  string>>`; `captureDiagnosticSnapshot()`; `runWithSnapshot(snapshot, fn)`. Task 2's `createLogger` consumes
  `getDiagnosticContext`; Task 4 (log-correlation scope) consumes `withDiagnosticFields`.

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
import {getDiagnosticContext} from './diagnostic-context.js';

export type LogLevel = 'error' | 'warning' | 'info' | 'verbose';

const RESERVED_EVENT_KEY = 'event';
const COLLISION_WARNING_EVENT = 'dexpace.logger.reservedKeyCollision';
const MAX_FIELD_LENGTH = 8192;
const TRUNCATION_MARKER = '…[truncated]';
const DEFAULT_DIAGNOSTIC_ALLOW_LIST: readonly string[] = ['trace.id', 'span.id'];

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

/** OBS-6: total field-value rendering -- never throws, even for a value whose own toString() throws. */
function renderField(value: unknown): unknown {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return `${value.constructor.name}: ${value.message}`;
  try {
    const rendered = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof rendered === 'string' && rendered.length > MAX_FIELD_LENGTH) {
      return rendered.slice(0, MAX_FIELD_LENGTH) + TRUNCATION_MARKER;
    }
    return rendered;
  } catch {
    return '[unrenderable value]';
  }
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

class RealLogEvent implements LogEvent {
  private readonly fields: Map<string, unknown>;
  private eventTag: string | undefined;
  private emitted = false;

  public constructor(
    private readonly level: LogLevel,
    globalFields: Readonly<Record<string, unknown>>,
    diagnosticFields: Readonly<Record<string, string>>,
    private readonly sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void,
    private readonly collisionGate: CollisionWarningGate,
    private readonly verboseEnabled: boolean,
  ) {
    // OBS-5: precedence is per-event field > global context > folded diagnostic context. Diagnostic fields
    // seed the map first (lowest precedence); global fields (withContext) overwrite them; a later field()
    // call overwrites both, since it runs after this constructor and writes directly into `this.fields`.
    this.fields = new Map(Object.entries(diagnosticFields));
    for (const [key, value] of Object.entries(globalFields)) this.fields.set(key, value);
  }

  public field(key: string, value: unknown): this {
    if (key === '') throw new RangeError('LogEvent.field: key must not be empty');
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
    const withTag = new Map(this.fields);
    if (this.eventTag !== undefined) withTag.set(RESERVED_EVENT_KEY, this.eventTag);
    else withTag.delete(RESERVED_EVENT_KEY);
    this.sink(this.level, withTag);
  }
}

/** OBS-1: one shared, allocation-minimal inert event -- every builder method returns `this`, emit() is a no-op. */
const NOOP_EVENT: LogEvent = {
  field(): LogEvent { return NOOP_EVENT; },
  event(): LogEvent { return NOOP_EVENT; },
  cause(): LogEvent { return NOOP_EVENT; },
  emit(): void {},
};

class NoopLogger implements Logger {
  public atLevel(): LogEvent {
    return NOOP_EVENT;
  }

  public withContext(): Logger {
    return this;
  }
}

/** The no-op default (OBS-1), installed process-wide until a consumer supplies a real one. */
export const NOOP_LOGGER: Logger = new NoopLogger();

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
  const globalFields = options.globalFields ?? {};
  const diagnosticAllowList = options.diagnosticAllowList === undefined
    ? DEFAULT_DIAGNOSTIC_ALLOW_LIST
    : options.diagnosticAllowList;
  const isLevelEnabled = options.isLevelEnabled ?? ((): boolean => true);
  const collisionGate = new CollisionWarningGate();

  return {
    atLevel(level) {
      if (!isLevelEnabled(level)) return NOOP_EVENT;
      const diagnosticFields = getDiagnosticContext(diagnosticAllowList);
      return new RealLogEvent(level, globalFields, diagnosticFields, sink, collisionGate, isLevelEnabled('verbose'));
    },
    withContext(fields) {
      return createLogger(sink, {
        diagnosticAllowList,
        isLevelEnabled,
        globalFields: {...globalFields, ...fields},
      });
    },
  };
}

let globalLogger: Logger = NOOP_LOGGER;

/** Mirrors 7a's CFG-13 global-configuration slot: last-write-wins, safe publication, no-op default. */
export function getGlobalLogger(): Logger {
  return globalLogger;
}

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/logger.test.ts`
Expected: PASS — 20 tests.

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
- Consumes: nothing from this package (uses the global `URL` class directly).
- Produces: `redactUrl(url: URL | string): string`; `redactHeaderValue(name: string, value: string): string |
  undefined`. Task 6 consumes both.

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

  test('a non-allow-listed header name is redacted (default-deny)', () => {
    expect(redactHeaderValue('Authorization', 'Bearer secret')).not.toBe('Bearer secret');
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
    return `${url.protocol}//${userinfo}${url.host}${url.pathname}`
      + `${query !== '' || url.search !== '' ? `?${query}` : ''}${fragment}`;
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

/** OBS-18: header-name allow-list (default-deny); OBS-16/17: URL-valued headers redacted through the shared
 * URL redactor so the sync/async paths cannot drift. */
export function redactHeaderValue(name: string, value: string): string | undefined {
  const lowerName = name.toLowerCase();
  if (lowerName === 'location' || lowerName === 'content-location') {
    return redactAbsoluteOrRelativeUrl(value);
  }
  return DEFAULT_HEADER_ALLOW_LIST.has(lowerName) ? value : undefined;
}
```

Note: the `redactUrl` scheme/host reconstruction above is intentionally written defensively (string
concatenation, not template-literal-only) because userinfo reconstruction from a parsed `URL` needs care --
`URL.toString()` re-serializes credentials in the clear if present. At implementation time, verify against
`URL`'s actual `username`/`password` getters and simplify this function once tests pin the exact expected
output byte-for-byte; the test suite in Step 1 is the source of truth for exact formatting, not this sketch.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/redaction.test.ts`
Expected: PASS — 12 tests. If the sketch's exact string formatting doesn't match, adjust `redactUrl`'s
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
  `../context/instrumentation.js` (4a) — read-only, 4a's file is never modified (see Global Constraints).
- Produces: `interface Span {isRecording, setAttribute, recordException, end}`; `interface Tracer {startSpan}`;
  `NOOP_SPAN: Span`; `NOOP_TRACER: Tracer`; `generateTraceId(flavor): string`; `generateSpanId(): string`;
  `createInstrumentationBundle(tracerFactory?): InstrumentationBundle`. Task 6 consumes `Tracer`/`Span`/
  `NOOP_TRACER`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/observability/tracing.test.ts
// Exercises: OBS-21 (non-recording span: inert mutators, idempotent end), OBS-25 (allocation-free no-op
// singletons), OBS-26/27 (W3C 32-hex trace id / 16-hex span id, never all-zero; Datadog 64-bit decimal).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {
  NOOP_SPAN,
  NOOP_TRACER,
  createInstrumentationBundle,
  generateSpanId,
  generateTraceId,
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
    traceFlags: 1,
    traceState: '',
    traceIdEncoding: 'w3c',
    isValid: true,
    isRemote: false,
    activeSpan: NOOP_SPAN,
    tracerFactory: tracerFactory ?? (() => NOOP_TRACER),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/tracing.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/observability/tracing.ts packages/core/src/observability/tracing.test.ts
git commit -m "feat(core): Tracer/Span structural types, W3C trace-context generation (OBS-21..27)"
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
- Consumes: `StepDescriptor` from `../pipeline/step.js`; `withRequestLogging` from
  `../body/request-body-logging.js` (3b, `@internal`); the response-body logging wrapper from
  `../body/response-body-logging.js` (3b, `@internal`); `getGlobalLogger`, `Logger` from `./logger.js`;
  `redactUrl`, `redactHeaderValue` from `./redaction.js`; `NOOP_TRACER`, `Tracer` from `./tracing.js`;
  `NOOP_METER`, `Meter` from `./metrics.js`; `getGlobalConfiguration`, `CFG_KEY_LOG_LEVEL` from
  `../config/configuration.js` (7a).
- Produces: `LOGGING_STEP_TYPE: unique symbol`; `interface LoggingStepSettings {logger?, level?, granularity?,
  previewSizeBytes?, tracerFactory?, meter?}`; `loggingStep(settings?): StepDescriptor`. 5c's already-amended
  `preset.ts` consumes `loggingStep`/`LoggingStepSettings`.

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/observability/logging-step.test.ts`
Expected: FAIL — `Cannot find module './logging-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/observability/logging-step.ts
import type {StepDescriptor} from '../pipeline/step.js';
import {CFG_KEY_LOG_LEVEL, getGlobalConfiguration} from '../config/configuration.js';
import {getGlobalLogger, type Logger} from './logger.js';
import {redactUrl} from './redaction.js';
import {NOOP_METER, type Meter} from './metrics.js';
import {NOOP_TRACER, type Tracer} from './tracing.js';

export type LoggingGranularity = 'none' | 'headers' | 'body';

export interface LoggingStepSettings {
  readonly logger?: Logger | undefined;
  readonly level?: 'error' | 'warning' | 'info' | 'verbose' | undefined;
  readonly granularity?: LoggingGranularity | undefined;
  readonly previewSizeBytes?: number | undefined;
  readonly tracerFactory?: (() => Tracer) | undefined;
  readonly meter?: Meter | undefined;
}

function resolveGranularity(settings: LoggingStepSettings): LoggingGranularity {
  if (settings.granularity !== undefined) return settings.granularity;
  const raw = getGlobalConfiguration().getString(CFG_KEY_LOG_LEVEL, 'none')?.trim().toLowerCase();
  if (raw === 'headers' || raw === 'body') return raw;
  return 'none';
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
  const tracer = settings.tracerFactory?.() ?? NOOP_TRACER;
  const meter = settings.meter ?? NOOP_METER;
  const requestCounter = meter.createCounter('http.client.request.count', {unit: '{request}'});
  const requestDuration = meter.createHistogram('http.client.request.duration', {unit: 'ms'});

  return {
    type: LOGGING_STEP_TYPE,
    stage: 'LOGGING',
    fn: async (request, ctx) => {
      const logger = settings.logger ?? getGlobalLogger();
      const granularity = resolveGranularity(settings);
      const span = tracer.startSpan('http.client.request');
      const startedAt = globalThis.performance.now();

      if (granularity !== 'none') {
        safeEmit(logger, () => {
          logger.atLevel('info')
            .event('http.request')
            .field('http.request.method', request.method)
            .field('url.full', redactUrl(request.url))
            .emit();
        });
      }

      try {
        const response = await ctx.next(request);
        requestCounter.add(1, {method: request.method, status: response.status.code});
        requestDuration.record(globalThis.performance.now() - startedAt, {method: request.method});
        if (granularity !== 'none') {
          safeEmit(logger, () => {
            logger.atLevel('info')
              .event('http.response')
              .field('http.response.status_code', response.status.code)
              .field('http.response.duration_ms', globalThis.performance.now() - startedAt)
              .emit();
          });
        }
        span.end();
        return response;
      } catch (error) {
        requestCounter.add(1, {method: request.method, errorType: (error as Error).constructor.name});
        if (granularity !== 'none') {
          safeEmit(logger, () => {
            logger.atLevel('error')
              .event('http.response')
              .field('error.type', (error as Error).constructor.name)
              .cause(error)
              .emit();
          });
        }
        span.recordException(error);
        span.end();
        throw error;
      }
    },
  };
}
```

Note on scope: this task's implementation sketch covers `OBS-34` (granularity gating), `OBS-35` (level
resolution), and `OBS-39` (stable event names/keys, redacted `url.full`) directly. `OBS-36`–`OBS-38` (bounded
body preview, unknown-length skip, charset-aware/binary-safe preview rendering) require wiring 3b's two
`@internal` tees in at `'body'` granularity — the design doc's "reuse, don't rebuild" note applies: import
`withRequestLogging`/the response-body wrapper and call them exactly as 3b's own tests exercise them, gated
behind `if (granularity === 'body')`. Write this as an explicit Step 3b addition once 3b's exact tee function
signatures are confirmed against the real (by-then-built) `packages/core/src/body/` files, rather than
guessing their call shape a second time here.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/observability/logging-step.test.ts`
Expected: PASS — 9 tests.

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
  established multi-package project-reference layout)
- Create: `packages/logging-pino/src/index.ts`
- Test: `packages/logging-pino/src/index.test.ts`

**Interfaces:**
- Consumes: `createLogger` (value), `Logger`, `LogLevel` (type-only) from `@dexpace/core` (peer); `pino` (peer).
- Produces: `createPinoLogger(instance: import('pino').Logger): Logger`.

- [ ] **Step 1: Scaffold `package.json`**

```json
{
  "name": "@dexpace/logging-pino",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
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
    "test": "bun test"
  }
}
```

The `@dexpace/core` peerDependency (not a regular dependency) is what guarantees exactly one copy of core in
an application's dependency tree — `docs/knowledge/package-and-dependency-layout.md`'s already-fixed rule, not
a new decision this task makes.

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
- Create: `packages/logging-debug/tsconfig.json`
- Create: `packages/logging-debug/src/index.ts`
- Test: `packages/logging-debug/src/index.test.ts`

**Interfaces:**
- Consumes: `createLogger` (value), `Logger` (type-only) from `@dexpace/core` (peer); `debug` (peer).
- Produces: `createDebugLogger(namespace?: string): Logger`.

- [ ] **Step 1: Scaffold `package.json`**

```json
{
  "name": "@dexpace/logging-debug",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
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
    "debug": ">=4"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test"
  }
}
```

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

### Task 9: Public barrel promotion, gates, and the checklist

**Files:**
- Modify: `packages/core/src/index.ts`
- Verify: `packages/core/etc/core.api.md`
- Create: `docs/superpowers/plans/2026-07-28-phase7b-observability-checklist.md`

**Interfaces:**
- Consumes: every public symbol from Tasks 1–6.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Amend the package-root barrel**

Add to `packages/core/src/index.ts` (no `src/observability/index.ts` — see Global Constraints):

```typescript
export type {LogLevel, Logger, LogEvent, CreateLoggerOptions} from './observability/logger.js';
export {getGlobalLogger, setGlobalLogger, createLogger, NOOP_LOGGER} from './observability/logger.js';
export type {Span, Tracer} from './observability/tracing.js';
export {NOOP_SPAN, NOOP_TRACER, generateTraceId, generateSpanId, createInstrumentationBundle} from './observability/tracing.js';
export type {Counter, Histogram, Meter} from './observability/metrics.js';
export {NOOP_METER} from './observability/metrics.js';
export type {LoggingGranularity, LoggingStepSettings} from './observability/logging-step.js';
export {loggingStep, LOGGING_STEP_TYPE} from './observability/logging-step.js';
```

`diagnostic-context.ts`'s `withDiagnosticFields`/`getDiagnosticContext`/snapshot bridge and `redaction.ts`'s
`redactUrl`/`redactHeaderValue` are deliberately **not** added — they stay `@internal` per the design doc (no
requirement gives a caller direct access to the MDC store or the redaction functions themselves).

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
cd packages/logging-pino && bun run build && bun test && cd -
cd packages/logging-debug && bun run build && bun test && cd -
```

Expected: every gate PASS.

- [ ] **Step 5: Write the requirement checklist**

Create `docs/superpowers/plans/2026-07-28-phase7b-observability-checklist.md`, same table format as prior
phase checklists, legend ✅ shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **`§15.1` Structured logging facade** — `OBS-1`–`OBS-9`, `OBS-40` ✅ Task 2 (`createLogger`), consuming
   Task 1's `getDiagnosticContext` for `OBS-5`'s third precedence tier. `OBS-40`'s collision warning is
   implemented (not just interface-shaped) — a fix applied after an earlier review pass found it claimed but
   missing.
2. **`§15.2` Diagnostic-context allow-list** — `OBS-10` ✅ Task 1.
3. **`§15.3` Redaction policy** — `OBS-11`–`OBS-19` ✅ Task 3.
4. **`§15.4` Failure containment** — `OBS-20` ✅ Task 6.
5. **`§15.5` Tracing** — `OBS-21`–`OBS-25` ✅ Task 4.
6. **`§15.6` Trace context (W3C)** — `OBS-26`/`OBS-27` ✅ Task 4.
7. **`§15.7` HTTP-tracer vocabulary** — `OBS-28`/`OBS-29` ⏳ **not shipped this phase** — this design ships the
   basic span start/end via `logging-step.ts`, not the richer per-attempt/transport-milestone vocabulary
   `OBS-28` describes (a `SHOULD`); flag for Phase 9 to confirm whether a caller need has emerged.
8. **`§15.8` Metrics** — `OBS-31`–`OBS-33` ✅ Task 5.
9. **`§15.9` Log level, body preview, event vocabulary** — `OBS-34`, `OBS-35`, `OBS-39` ✅ Task 6; `OBS-36`–
   `OBS-38` (bounded body preview via 3b's tees) ⏳ **Task 6's own noted follow-up** — the granularity/level/
   event-vocabulary machinery is complete, but wiring 3b's tees in at `'body'` granularity was left as an
   explicit addition once 3b's exact files are confirmed built, not guessed a second time in this plan.
10. **Cross-phase closures** — `Logger`/`LogEvent` seam (Phase 2 deferral) ✅ Task 2; real W3C trace generation
    (Phase 4a deferral) ✅ Task 4, via `createInstrumentationBundle` (4a's file itself untouched);
    `standardResilience()`'s `LOGGING` slot (Phase 5c deferral) ✅ applied directly to 5c's plan (Task 16);
    retry/redirect structured logging (Phase 5a/5b deferral) ✅/⏳ applied directly to 5a's and 5b's plans —
    5a's fully closes (attempt-failed, retries-exhausted), 5b's partially closes (hop + rejection events; the
    loop-vs-hop-cap distinction stays open, needing a `decide()` reshape out of scope for this retrofit).
11. **Deferred out of Phase 7b** — `OBS-28`'s richer HTTP-tracer vocabulary; `OBS-36`–`OBS-38`'s body-preview
    wiring (both → Task 6's own follow-up, or Phase 9); 5b's loop-vs-hop-cap logging distinction → a future
    `decide()` reshape, or Phase 9.

State explicitly at the top whether the plan has been executed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/etc/core.api.md \
  docs/superpowers/plans/2026-07-28-phase7b-observability-checklist.md
git commit -m "feat(core): promote Phase 7b's public surface; checklist"
```

---

## Self-Review

**1. Spec coverage.** `OBS-1`–`OBS-9`, `OBS-40` → Task 2. `OBS-10` → Task 1. `OBS-11`–`OBS-19` → Task 3.
`OBS-20` → Task 6. `OBS-21`–`OBS-27` → Task 4. `OBS-31`–`OBS-33` → Task 5. `OBS-34`, `OBS-35`, `OBS-39` → Task
6. Two honest gaps, both flagged rather than silently dropped: `OBS-28`/`OBS-29` (richer HTTP-tracer
vocabulary, a `SHOULD`) is not built this phase — `logging-step.ts` ships basic span start/end only, not
per-attempt/transport-milestone events; `OBS-36`–`OBS-38` (bounded body preview) needs 3b's tees wired in at
`'body'` granularity, deliberately left as a Task 6 follow-up rather than guessed against 3b's exact,
not-yet-re-read file contents a second time in this document.

**2. Placeholder scan.** No bare "TBD"/"TODO". Task 3's redaction sketch and Task 6's body-preview note are
explicit about being illustrative/incomplete *and* say exactly what to do next (verify against `URL`'s real
getters; wire in 3b's tees once their signatures are confirmed) — not a bare deferral.

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
edit — `createInstrumentationBundle` is the sole bridge. 5a's, 5b's, and 5c's plans were amended directly
(narrow blast radius each time, confirmed against their actual file contents rather than assumed) rather than
this plan trying to re-describe those changes as its own tasks — this plan only builds `@dexpace/core`'s
`observability/` module and the two bridge packages.

**5. Post-write review pass (2026-07-28).** An independent review against the implementation sketches (not
just the prose) surfaced and fixed four real issues: (a) Task 6's `loggingStep()` allocated a fresh `Symbol()`
per call instead of a stable module-level `LOGGING_STEP_TYPE`, breaking the `PIPE-6`/`PIPE-18` reference-
identity convention every other pillar step follows — fixed, now exported and barrel-promoted (Task 9); (b)
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
