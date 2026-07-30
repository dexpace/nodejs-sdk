# Phase 7a — Configuration & Platform Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the layered `Configuration` model, the `Clock` seam, the proxy model, RFC 1123 dates, UUID
generation, deep equality, the retryability classifier, the build/runtime version descriptor, and the
client-identity header step in `@dexpace/core` — satisfying `docs/product-spec/16-configuration.md`
(`CFG-1`–`CFG-38`), `NFR-15`, and appendix C's `RECOV-33`, per
`docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md`.

**Architecture:** A new `packages/core/src/config/` folder of nine independent files, no folder-level barrel
(every public symbol re-exports from the existing package-root `packages/core/src/index.ts` instead). Every
file is pure — no I/O beyond the injected env/property source functions `Configuration` accepts, and no
`node:` imports anywhere. A build-time codegen script (`scripts/gen-version.mjs`) writes
`src/generated/version.ts` from `package.json` before the `tsc` build runs, so the SDK's own version is a
compiled-in string literal, never a runtime file read.

**Tech Stack:** TypeScript 5.8+, `globalThis.crypto.getRandomValues` (UUID and — later, in 7b — trace-id
generation), `fast-check` for the four totality-bearing pure functions, `bun test`. No new runtime
dependencies — `SEAM-1` untouched. No `node:` imports — core's zero-`node:` invariant, mechanically enforced
since the scaffold, still holds.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, 4a, 4b, 4c, and 5a are implemented exactly as their
plans specify (5a's plan was amended 2026-07-28 to consume this phase's `Clock`, RFC 1123 parser, and
retryable-status classifier — see that plan's amendment banner; this phase does not depend on 5a's own
retry-specific files, only on 4c's pipeline-authoring surface for Task 9). Concretely:

- `packages/core/src/pipeline/step.js` — `StepDescriptor`, `StepContext`
- `packages/core/src/invariant.js` — `invariant()`, `assertNever()`
- `packages/core/src/index.ts` — the package's single public barrel (amended by every phase since Phase 1)
- `package.json` — a `version` field this phase's codegen script reads

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **No `src/config/index.ts`.** `docs/knowledge/module-organization.md:18` bans internal (per-folder) barrels
  outright — only `packages/core/src/index.ts`, the package root, is a barrel. Every public symbol from this
  phase is re-exported there directly, pointing at its concrete file (Task 9).
- **No `node:` imports anywhere in `packages/core`.** `randomUuid` uses `globalThis.crypto.getRandomValues`
  (not `node:crypto`); the RFC 1123 parser is hand-written; the env source delegates to `process.env` only
  inside `Configuration.default()`'s production wiring, which reads an ambient global, not a `node:` module.
  `verify:seam-1` enforces this.
- **No new error leaf classes.** Every invalid-input path in this phase is either a programmer error (uses
  `invariant()`, throwing `InvariantViolation` per `docs/knowledge/error-handling.md`'s split) or a total,
  never-throwing function returning `null`/a caller-supplied default (`CFG-5`–`CFG-7`, `CFG-24`, `CFG-25`).
  Do not add a `ConfigurationError` or similar.
- **`Date.parse`/`new Date(string)` are banned in `http-date.ts`.** Same reasoning as 5a's `pacing.ts`: JS
  date-string parsing is permissive and non-standardized across engines, which is the opposite of a total
  parser's contract. Hand-written with explicit field range validation, ported from 5a's original private
  parser (Task 2 below performs that extraction).
- **The `Clock` seam is the single wait/time primitive.** No separate blocking-sleep/async-delay pair — see
  the design doc's Deviation Ledger. `sleep(ms, signal?)` rejects a negative `ms`, resolves promptly at `0`,
  and rejects with the signal's abort reason (not a bare rejection) when cancelled mid-wait.
- **`ProxyOptions` and `resolveProxyOptions` are types and resolution logic only.** No concrete `Transport`
  consumes them this phase — that waits for Phase 8. Do not wire a fake "proxy-aware fetch" in for
  demonstration; it would be dead code with no real consumer and no requirement asking for it.
- **`clientIdentityStep` is not installed by `standardResilience()`.** It targets a non-pillar pre/post slot
  the preset doesn't manage; adding it to the preset is an explicit deferred item (Phase 9 or a future preset
  revision), not part of this plan.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`** (`erasableSyntaxOnly`). Unions and frozen constant objects only.
- **Explicit return types on every exported function.** Kebab-case filenames. Named exports only.
- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT` (`NFR-13`, binding since
  Phase 1's plan).
- **Tests must survive any order and parallel execution.** `Configuration`'s global slot and the client-identity
  step's `getBuildInfo()` cache are the only module-level mutable state in this phase; tests that touch either
  must reset it (`setGlobalConfiguration`/re-import isolation) rather than relying on execution order.

---

## File Structure

```
packages/core/src/config/
  clock.ts                 # Clock, defaultClock                          (Task 1)
  http-date.ts              # formatHttpDate, parseHttpDate                (Task 2)
  retryable.ts              # RETRYABLE_STATUSES, isRetryableStatus        (Task 3)
  identifiers.ts             # randomUuid                                  (Task 4)
  equality.ts                # deepEqual, deepHash                        (Task 5)
  configuration.ts            # Configuration, ConfigurationBuilder,       (Task 6)
                               # global slot, CFG-14 key constants
  proxy.ts                     # ProxyOptions, shouldBypassProxy,          (Task 7)
                               # resolveProxyOptions
  build-info.ts                 # BuildInfo, getBuildInfo                 (Task 8)
  client-identity-step.ts        # clientIdentityStep                     (Task 9)

packages/core/src/generated/
  version.ts                      # generated by scripts/gen-version.mjs  (Task 8)

packages/core/scripts/
  gen-version.mjs                   # prebuild codegen                    (Task 8)
```

Every file has a colocated `*.test.ts` except `generated/version.ts` (generated, not hand-written) and
`scripts/gen-version.mjs` (exercised indirectly by Task 8's own test asserting the generated output shape).
Nine production files, each one responsibility, none over ~100 lines.

---

### Task 1: `clock.ts` — the `Clock` seam

**Files:**
- Create: `packages/core/src/config/clock.ts`
- Test: `packages/core/src/config/clock.test.ts`

**Interfaces:**
- Consumes: nothing from this package.
- Produces: `interface Clock {now(): number; monotonic(): number; sleep(ms: number, signal?: AbortSignal):
  Promise<void>}`; `defaultClock: Clock`. 5a's (amended) `engine.ts`/`retry-step.ts` and Task 9 below consume
  both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/clock.test.ts
// Exercises: CFG-15 (three operations, shared default), CFG-16 (monotonic non-decreasing, meaningful only
// relative to itself), CFG-17 (sleep rejects negative, resolves promptly at zero, honors cancellation).
import {describe, expect, test} from 'bun:test';
import {defaultClock} from './clock.js';

describe('defaultClock', () => {
  test('now() returns a plausible wall-clock epoch millisecond value', () => {
    const before = Date.now();
    const value = defaultClock.now();
    const after = Date.now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  test('monotonic() is non-decreasing across two readings', () => {
    const first = defaultClock.monotonic();
    const second = defaultClock.monotonic();
    expect(second).toBeGreaterThanOrEqual(first);
  });

  test('sleep(0) resolves promptly', async () => {
    const start = defaultClock.monotonic();
    await defaultClock.sleep(0);
    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('sleep(negative) rejects', async () => {
    await expect(defaultClock.sleep(-1)).rejects.toBeDefined();
  });

  test('sleep honors an already-aborted signal, rejecting with the abort reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(defaultClock.sleep(10_000, controller.signal)).rejects.toThrow('cancelled');
  });

  test('sleep honors cancellation mid-wait, resolving the race promptly rather than after the full delay', async () => {
    const controller = new AbortController();
    const start = defaultClock.monotonic();
    const pending = defaultClock.sleep(60_000, controller.signal);
    queueMicrotask(() => controller.abort(new Error('cancelled')));

    await expect(pending).rejects.toThrow('cancelled');
    expect(defaultClock.monotonic() - start).toBeLessThan(50);
  });

  test('a real wait elapses at least the requested duration', async () => {
    const start = defaultClock.monotonic();
    await defaultClock.sleep(20);
    expect(defaultClock.monotonic() - start).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/clock.test.ts`
Expected: FAIL — `Cannot find module './clock.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/clock.ts

/**
 * CFG-15: an injectable seam for wall-clock instant, monotonic elapsed-time measurement, and a cancellable
 * wait. One primitive for the JVM reference's blocking-sleep/scheduled-async-delay pair (CFG-15/17 vs. 18) --
 * Node has no carrier threads to distinguish "block this one" from "schedule that one" against, and every
 * timer is already non-blocking.
 */
export interface Clock {
  /** Wall-clock epoch milliseconds. MAY move backwards; MUST NOT be used for elapsed-time math (CFG-16). */
  now(): number;
  /** Monotonic elapsed-time counter (CFG-16). Absolute value is meaningless -- only differences between two
   * readings are. */
  monotonic(): number;
  /**
   * Resolves after `ms` milliseconds, or rejects with `signal`'s abort reason if it fires first (CFG-17).
   * Rejects synchronously for a negative `ms`; resolves promptly (no timer scheduled) for `ms <= 0`.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms < 0) return Promise.reject(new RangeError(`Clock.sleep: ms must be non-negative, got ${ms}`));
  if (signal?.aborted === true) return Promise.reject(signal.reason as unknown);
  if (ms === 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const settle = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as unknown);
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

/** The platform-backed default (CFG-15's "a shared platform-backed default MUST be provided"). */
export const defaultClock: Clock = {
  now: () => Date.now(),
  monotonic: () => globalThis.performance.now(),
  sleep,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/clock.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/clock.ts packages/core/src/config/clock.test.ts
git commit -m "feat(core): Clock seam -- wall-clock, monotonic, cancellable sleep"
```

---

### Task 2: `http-date.ts` — RFC 1123 format and parse

**Files:**
- Create: `packages/core/src/config/http-date.ts`
- Test: `packages/core/src/config/http-date.test.ts`

**Interfaces:**
- Consumes: nothing from this package.
- Produces: `formatHttpDate(epochMs: number): string`; `parseHttpDate(raw: string): number | null`. 5a's
  (amended) `pacing.ts` consumes `parseHttpDate`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/http-date.test.ts
// Exercises: CFG-29 (canonical formatting), CFG-30 (tolerant parsing -- case-insensitive month, zone
// aliases, informational weekday), CFG-31 (strict on the rest -- blank input, missing comma both fail).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {formatHttpDate, parseHttpDate} from './http-date.js';

describe('formatHttpDate', () => {
  test('renders the canonical form with a zero-padded day, in UTC', () => {
    const epochMs = Date.UTC(1994, 10, 6, 8, 49, 37);
    expect(formatHttpDate(epochMs)).toBe('Sun, 06 Nov 1994 08:49:37 GMT');
  });

  test('single-digit days are zero-padded', () => {
    const epochMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(formatHttpDate(epochMs)).toBe('Thu, 01 Jan 2026 00:00:00 GMT');
  });
});

describe('parseHttpDate tolerance (CFG-30)', () => {
  test('month names are case-insensitive', () => {
    const canonical = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Thu, 01 JAN 2026 00:00:10 GMT')).toBe(canonical);
    expect(parseHttpDate('Thu, 01 jan 2026 00:00:10 GMT')).toBe(canonical);
  });

  test('GMT, UTC, +0000, and +00:00 all normalize to the same instant', () => {
    const gmt = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 UTC')).toBe(gmt);
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +0000')).toBe(gmt);
    expect(parseHttpDate('Thu, 01 Jan 2026 00:00:10 +00:00')).toBe(gmt);
  });

  test('the weekday token is informational only, even when wrong', () => {
    const correct = parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT');
    expect(parseHttpDate('Mon, 01 Jan 2026 00:00:10 GMT')).toBe(correct);
  });

  test('a single-digit day is tolerated', () => {
    expect(parseHttpDate('Thu, 1 Jan 2026 00:00:10 GMT')).toBe(parseHttpDate('Thu, 01 Jan 2026 00:00:10 GMT'));
  });
});

describe('parseHttpDate strictness (CFG-31)', () => {
  test('blank input fails', () => {
    expect(parseHttpDate('')).toBeNull();
  });

  test('a missing comma after the weekday fails', () => {
    expect(parseHttpDate('Mon 01 Jan 2024 00:00:00 GMT')).toBeNull();
  });

  test('an out-of-range field is rejected, not silently rolled over', () => {
    expect(parseHttpDate('Thu, 32 Jan 2026 00:00:10 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Jan 2026 24:00:10 GMT')).toBeNull();
    expect(parseHttpDate('Thu, 01 Foo 2026 00:00:10 GMT')).toBeNull();
  });

  test('property: never throws for any string', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(() => parseHttpDate(value)).not.toThrow();
      }),
    );
  });

  test('property: a formatted instant round-trips through parse', () => {
    fc.assert(
      fc.property(fc.integer({min: 0, max: 4_102_444_800_000}), (epochMs) => {
        const truncated = Math.floor(epochMs / 1000) * 1000;
        expect(parseHttpDate(formatHttpDate(truncated))).toBe(truncated);
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/http-date.test.ts`
Expected: FAIL — `Cannot find module './http-date.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/http-date.ts

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HTTP_DATE =
  /^(?:[A-Za-z]{3,9},\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UTC|\+00:?00)$/u;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * CFG-29: the canonical RFC 1123 HTTP-date form, always UTC, e.g. "Sun, 06 Nov 1994 08:49:37 GMT".
 */
export function formatHttpDate(epochMs: number): string {
  const date = new Date(epochMs);
  const weekday = WEEKDAYS[date.getUTCDay()];
  const day = pad2(date.getUTCDate());
  const month = MONTHS[date.getUTCMonth()]?.replace(/^./u, (c) => c.toUpperCase());
  const year = date.getUTCFullYear();
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  return `${weekday}, ${day} ${month} ${year} ${time} GMT`;
}

/**
 * CFG-30/CFG-31: a hand-written RFC 1123 parser, never `Date.parse` -- JS date-string parsing is permissive
 * and non-standardized across engines, the opposite of a total parser's contract. Tolerant of an
 * informational weekday (stripped, not validated -- CFG-30), a single-digit day, and case-insensitive
 * month/zone tokens (GMT/UTC/+0000/+00:00 all normalize to zero offset). Strict on the rest: blank input and
 * a missing post-weekday comma both fail (CFG-31); every field is range-checked so an out-of-range value is
 * REJECTED rather than silently rolled over by `Date.UTC` into a valid but wrong instant.
 */
export function parseHttpDate(raw: string): number | null {
  const match = HTTP_DATE.exec(raw);
  if (match === null) return null;
  const day = Number(match[1] ?? '');
  const month = MONTHS.indexOf((match[2] ?? '').toLowerCase());
  const year = Number(match[3] ?? '');
  const hour = Number(match[4] ?? '');
  const minute = Number(match[5] ?? '');
  const second = Number(match[6] ?? '');
  if (month < 0 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return null;
  return Date.UTC(year, month, day, hour, minute, second);
}
```

Note: the `HTTP_DATE` regex and range-check logic here are the same grammar 5a's original `pacing.ts` used
(that private copy is deleted by 5a's already-amended plan, which now imports `parseHttpDate` from this file).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/http-date.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/http-date.ts packages/core/src/config/http-date.test.ts
git commit -m "feat(core): RFC 1123 HTTP-date format and total tolerant parse"
```

---

### Task 3: `retryable.ts` — the shared retryability classifier

**Files:**
- Create: `packages/core/src/config/retryable.ts`
- Test: `packages/core/src/config/retryable.test.ts`

**Interfaces:**
- Consumes: nothing from this package.
- Produces: `RETRYABLE_STATUSES: ReadonlySet<number>`; `isRetryableStatus(code: number): boolean`. 5a's
  (amended) `classify.ts` re-exports both unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/retryable.test.ts
// Exercises: CFG-35 (exactly 408, 429, and 5xx except 501/505 are retryable; this exact set is a hard
// contract where implemented).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {RETRYABLE_STATUSES, isRetryableStatus} from './retryable.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/retryable.test.ts`
Expected: FAIL — `Cannot find module './retryable.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/retryable.ts

function buildRetryableStatuses(): ReadonlySet<number> {
  const codes = new Set<number>([408, 429]);
  for (let code = 500; code <= 599; code += 1) {
    // 501 Not Implemented and 505 HTTP Version Not Supported mean the server cannot fulfill the request
    // regardless of how many times it is asked.
    if (code !== 501 && code !== 505) codes.add(code);
  }
  return codes;
}

/**
 * CFG-35: the single retryable-status definition. `Object.freeze` does not seal a `Set`'s internal slots, so
 * a frozen `Set` would be a misleading no-op -- typed `ReadonlySet` instead, same treatment as Phase 1's
 * `IDEMPOTENT_METHODS`. 5a's retry engine re-exports this exact set rather than defining its own.
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = buildRetryableStatuses();

export function isRetryableStatus(code: number): boolean {
  return RETRYABLE_STATUSES.has(code);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/retryable.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/retryable.ts packages/core/src/config/retryable.test.ts
git commit -m "feat(core): shared retryability classifier (CFG-35)"
```

---

### Task 4: `identifiers.ts` — non-blocking UUID generation

**Files:**
- Create: `packages/core/src/config/identifiers.ts`
- Test: `packages/core/src/config/identifiers.test.ts`

**Interfaces:**
- Consumes: `globalThis.crypto.getRandomValues` (the runtime-floor primitive, no import).
- Produces: `randomUuid(): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/identifiers.test.ts
// Exercises: CFG-32 (type-4 UUID, correct RFC 4122 layout -- version 4, IETF variant; concurrency-safe; a
// large batch has no collisions).
import {describe, expect, test} from 'bun:test';
import {randomUuid} from './identifiers.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('randomUuid', () => {
  test('produces the correct RFC 4122 version-4/IETF-variant layout', () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  test('a large batch has no collisions', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) seen.add(randomUuid());
    expect(seen.size).toBe(10_000);
  });

  test('concurrent generation produces distinct, well-formed ids', () => {
    const ids = Array.from({length: 100}, () => randomUuid());
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/identifiers.test.ts`
Expected: FAIL — `Cannot find module './identifiers.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/identifiers.ts

/**
 * CFG-32: a non-blocking, non-cryptographic (despite the CSPRNG source -- callers MUST NOT rely on
 * unpredictability) type-4 UUID. `globalThis.crypto.getRandomValues` is core's already-fixed cross-runtime
 * primitive (no `node:crypto` import), with no shared mutable state, so concurrent calls are safe by
 * construction.
 */
export function randomUuid(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // IETF variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/identifiers.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/identifiers.ts packages/core/src/config/identifiers.test.ts
git commit -m "feat(core): non-blocking type-4 UUID generation (CFG-32)"
```

---

### Task 5: `equality.ts` — deep value equality and hashing

**Files:**
- Create: `packages/core/src/config/equality.ts`
- Test: `packages/core/src/config/equality.test.ts`

**Interfaces:**
- Consumes: nothing from this package.
- Produces: `deepEqual(a: unknown, b: unknown): boolean`; `deepHash(value: unknown): number`. `@internal` —
  no root-barrel export (see Global Constraints).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/equality.test.ts
// Exercises: CFG-33 (content-based array comparison, recursion into nested arrays, null-safety, hash
// consistency), CFG-34 (NaN equals NaN, +0 !== -0 for numeric arrays; a typed array is never equal to a
// plain array of the same numeric values).
import {describe, expect, test} from 'bun:test';
import {deepEqual, deepHash} from './equality.js';

describe('deepEqual', () => {
  test('primitives compare by ordinary equality', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  test('arrays compare element-by-element, including nested arrays', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, [2, 3]], [1, [2, 4]])).toBe(false);
  });

  test('two nulls are equal; null hashes to zero', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepHash(null)).toBe(0);
  });

  test('NaN equals NaN in a numeric array', () => {
    expect(deepEqual([Number.NaN], [Number.NaN])).toBe(true);
  });

  test('+0 does not equal -0 in a numeric array', () => {
    expect(deepEqual([0], [-0])).toBe(false);
  });

  test('a typed numeric array is never equal to a plain array of the same values', () => {
    expect(deepEqual(new Float64Array([1, 2]), [1, 2])).toBe(false);
  });

  test('equals and hashCode are mutually consistent for equal values', () => {
    const a = [1, {x: 2}, [3, 4]];
    const b = [1, {x: 2}, [3, 4]];
    expect(deepEqual(a, b)).toBe(true);
    expect(deepHash(a)).toBe(deepHash(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/equality.test.ts`
Expected: FAIL — `Cannot find module './equality.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/equality.ts

function isNumericArrayLike(value: unknown): value is ArrayLike<number> {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function sameKind(a: unknown, b: unknown): boolean {
  const aTyped = ArrayBuffer.isView(a);
  const bTyped = ArrayBuffer.isView(b);
  if (aTyped !== bTyped) return false;
  if (aTyped && bTyped) return Object.getPrototypeOf(a) === Object.getPrototypeOf(b);
  return true;
}

/**
 * CFG-33/CFG-34: content-based equality. Arrays (plain or typed) compare element-by-element, recursing for
 * nested arrays; `NaN` equals `NaN` and `+0`/`-0` are distinct, matching `Object.is` per element rather than
 * `===`; a typed array and a plain array of the same numeric values are never equal (CFG-34's "object array
 * vs. primitive array" distinction). Null-safe: two `null`/`undefined` values are equal to each other.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  if (isNumericArrayLike(a) && isNumericArrayLike(b)) {
    if (!sameKind(a, b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i];
      const right = b[i];
      if (typeof left === 'number' && typeof right === 'number') {
        if (!Object.is(left, right)) return false;
      } else if (!deepEqual(left, right)) {
        return false;
      }
    }
    return true;
  }
  return Object.is(a, b);
}

/** CFG-33: `deepHash(null) === 0`; consistent with `deepEqual` for every equal pair this module compares. */
export function deepHash(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (isNumericArrayLike(value)) {
    let hash = 17;
    for (let i = 0; i < value.length; i += 1) {
      const element = value[i];
      const elementHash = typeof element === 'number' ? Object.is(element, -0) ? 1 : element : deepHash(element);
      hash = (hash * 31 + Number(elementHash)) | 0;
    }
    return hash;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    return hash;
  }
  return 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/equality.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/equality.ts packages/core/src/config/equality.test.ts
git commit -m "feat(core): deep value equality and hashing (CFG-33/CFG-34)"
```

---

### Task 6: `configuration.ts` — the layered `Configuration` model

The largest task in this phase. Read `CFG-1`–`CFG-14`, `CFG-37`, `CFG-38` in
`docs/product-spec/16-configuration.md` before starting.

**Files:**
- Create: `packages/core/src/config/configuration.ts`
- Test: `packages/core/src/config/configuration.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`.
- Produces: `type SourceFn = (key: string) => string | undefined`; `interface Configuration {getString,
  getRawProperty, getInt, getBoolean, getDuration, derive}`; `class ConfigurationBuilder {put, remove,
  withEnvSource, withPropertySource, build}`; `getGlobalConfiguration()`; `setGlobalConfiguration(config)`;
  key constants `CFG_KEY_MAX_RETRY_ATTEMPTS`, `CFG_KEY_LOG_LEVEL`, `CFG_KEY_HTTP_PROXY`,
  `CFG_KEY_HTTPS_PROXY`, `CFG_KEY_NO_PROXY`. Task 7 consumes `Configuration`/key constants; 7b (a later phase)
  consumes `CFG_KEY_LOG_LEVEL`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/configuration.test.ts
// Exercises: CFG-1 (four-tier-collapsed-to-three precedence), CFG-2 (empty env treated as absent), CFG-3
// (normalized property key), CFG-4 (raw accessor, no normalization), CFG-5/CFG-6/CFG-7 (never-throw typed
// accessors), CFG-8 (immutable, defensive copy), CFG-9 (copy-on-write derive), CFG-10 (remove drops only the
// override layer), CFG-11 (substitutable env/property seams), CFG-13 (global slot, last-write-wins), CFG-37
// (fail-fast on null/absent required arguments), CFG-38 (typed accessors use the full layered lookup).
import {describe, expect, test} from 'bun:test';
import {
  ConfigurationBuilder,
  getGlobalConfiguration,
  setGlobalConfiguration,
} from './configuration.js';

describe('layered precedence (CFG-1, CFG-2)', () => {
  test('override wins over env, env wins over default', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource((key) => (key === 'X' ? 'from-env' : undefined))
      .put('X', 'from-override')
      .build();
    expect(config.getString('X', 'from-default')).toBe('from-override');
  });

  test('removing the override falls through to env', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource((key) => (key === 'X' ? 'from-env' : undefined))
      .put('X', 'from-override')
      .build()
      .derive((builder) => builder.remove('X'));
    expect(config.getString('X', 'from-default')).toBe('from-env');
  });

  test('an empty environment value is treated as absent, falling through to the default', () => {
    const config = new ConfigurationBuilder().withEnvSource(() => '').build();
    expect(config.getString('X', 'from-default')).toBe('from-default');
  });

  test('with nothing set, the default is returned', () => {
    const config = new ConfigurationBuilder().build();
    expect(config.getString('X', 'from-default')).toBe('from-default');
    expect(config.getString('X')).toBeUndefined();
  });
});

describe('property normalization (CFG-3, CFG-4)', () => {
  test('the normalizing accessor looks up the dotted-lowercase form', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource((key) => (key === 'max.retry.attempts' ? '5' : undefined))
      .build();
    expect(config.getString('MAX_RETRY_ATTEMPTS')).toBe('5');
  });

  test('the raw accessor preserves casing and does not normalize', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource((key) => (key === 'https.proxyHost' ? 'proxy.example.com' : undefined))
      .build();
    expect(config.getRawProperty('https.proxyHost')).toBe('proxy.example.com');
    expect(config.getString('https.proxyHost')).toBeUndefined();
  });
});

describe('typed accessors (CFG-5, CFG-6, CFG-7, CFG-38)', () => {
  test('getInt never throws; returns the default for a missing or unparseable value', () => {
    const missing = new ConfigurationBuilder().build();
    expect(missing.getInt('X', 42)).toBe(42);

    const unparseable = new ConfigurationBuilder().put('X', 'not-a-number').build();
    expect(unparseable.getInt('X', 42)).toBe(42);
  });

  test('getInt resolves through the layered lookup, not just the override map', () => {
    const config = new ConfigurationBuilder().withEnvSource(() => '7').build();
    expect(config.getInt('X', 0)).toBe(7);
  });

  test('a negative integer is valid and returned as-is', () => {
    const config = new ConfigurationBuilder().put('X', '-5').build();
    expect(config.getInt('X', 0)).toBe(-5);
  });

  test('getBoolean is strict: only true/false, case-insensitive', () => {
    const config = new ConfigurationBuilder().put('X', 'TRUE').build();
    expect(config.getBoolean('X', false)).toBe(true);
    for (const value of ['1', '0', 'yes', 'no', 'on', 'off']) {
      const cfg = new ConfigurationBuilder().put('X', value).build();
      expect(cfg.getBoolean('X', false)).toBe(false);
    }
  });

  test('getDuration accepts ISO-8601, shorthand, and bare-number-milliseconds; rejects negatives', () => {
    const iso = new ConfigurationBuilder().put('X', 'PT5S').build();
    expect(iso.getDuration('X', 0)).toBe(5000);
    const shorthand = new ConfigurationBuilder().put('X', '500ms').build();
    expect(shorthand.getDuration('X', 0)).toBe(500);
    const bare = new ConfigurationBuilder().put('X', '1000').build();
    expect(bare.getDuration('X', 0)).toBe(1000);
    const negative = new ConfigurationBuilder().put('X', 'PT-5S').build();
    expect(negative.getDuration('X', 99)).toBe(99);
  });
});

describe('immutability and derivation (CFG-8, CFG-9, CFG-11)', () => {
  test('mutating the builder after build() does not alter the built instance', () => {
    const builder = new ConfigurationBuilder().put('X', 'original');
    const config = builder.build();
    builder.put('X', 'mutated-after-build');
    expect(config.getString('X')).toBe('original');
  });

  test('derive leaves the receiver unchanged and shares inherited sources by reference', () => {
    const base = new ConfigurationBuilder()
      .withEnvSource((key) => (key === 'Y' ? 'env-y' : undefined))
      .put('X', 'base')
      .build();
    const derived = base.derive((builder) => builder.put('X', 'derived'));

    expect(base.getString('X')).toBe('base');
    expect(derived.getString('X')).toBe('derived');
    expect(derived.getString('Y')).toBe('env-y');
  });

  test('env and property sources are substitutable seams', () => {
    const calls: string[] = [];
    const config = new ConfigurationBuilder()
      .withEnvSource((key) => {
        calls.push(key);
        return undefined;
      })
      .build();
    config.getString('SOME_KEY');
    expect(calls).toEqual(['SOME_KEY']);
  });
});

describe('global configuration slot (CFG-13)', () => {
  test('defaults to an empty configuration', () => {
    setGlobalConfiguration(new ConfigurationBuilder().build());
    expect(getGlobalConfiguration().getString('X', 'default')).toBe('default');
  });

  test('last-write-wins: the getter returns the same instance after set', () => {
    const config = new ConfigurationBuilder().put('X', 'set').build();
    setGlobalConfiguration(config);
    expect(getGlobalConfiguration()).toBe(config);
  });
});

describe('fail-fast validation (CFG-37)', () => {
  test('put rejects a null/absent key or value', () => {
    const builder = new ConfigurationBuilder();
    expect(() => builder.put(undefined as unknown as string, 'v')).toThrow();
    expect(() => builder.put('k', undefined as unknown as string)).toThrow();
  });

  test('remove rejects a null/absent key', () => {
    const builder = new ConfigurationBuilder();
    expect(() => builder.remove(undefined as unknown as string)).toThrow();
  });

  test('a lookup default of undefined is accepted, not rejected', () => {
    const config = new ConfigurationBuilder().build();
    expect(() => config.getString('X', undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/configuration.test.ts`
Expected: FAIL — `Cannot find module './configuration.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/configuration.ts
import {invariant} from '../invariant.js';

export type SourceFn = (key: string) => string | undefined;

const ISO_DURATION = /^p(?:(\d+)d)?(?:t(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?)?$/iu;
const SHORTHAND_DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/iu;
const BARE_NUMBER = /^\d+(?:\.\d+)?$/u;

function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '.');
}

function parseDurationMs(raw: string): number | null {
  const bare = BARE_NUMBER.exec(raw);
  if (bare !== null) return Number(bare[1] ?? bare[0]);

  const shorthand = SHORTHAND_DURATION.exec(raw);
  if (shorthand !== null) {
    const value = Number(shorthand[1]);
    const unit = (shorthand[2] ?? '').toLowerCase();
    const perUnit: Record<string, number> = {ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000};
    return value * (perUnit[unit] ?? Number.NaN);
  }

  const iso = ISO_DURATION.exec(raw);
  if (iso !== null) {
    const days = Number(iso[1] ?? 0);
    const hours = Number(iso[2] ?? 0);
    const minutes = Number(iso[3] ?? 0);
    const seconds = Number(iso[4] ?? 0);
    return days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
  }
  return null;
}

export interface Configuration {
  getString(key: string, fallback?: string): string | undefined;
  getRawProperty(key: string, fallback?: string): string | undefined;
  getInt(key: string, fallback: number): number;
  getBoolean(key: string, fallback: boolean): boolean;
  getDuration(key: string, fallback: number): number;
  derive(mutate: (builder: ConfigurationBuilder) => void): Configuration;
}

class ConfigurationImpl implements Configuration {
  public constructor(
    private readonly overrides: ReadonlyMap<string, string>,
    private readonly envSource: SourceFn,
    private readonly propertySource: SourceFn,
  ) {}

  public getString(key: string, fallback?: string): string | undefined {
    const override = this.overrides.get(key);
    if (override !== undefined) return override;
    const env = this.envSource(key);
    if (env !== undefined && env !== '') return env;
    const property = this.propertySource(normalizePropertyKey(key));
    if (property !== undefined) return property;
    return fallback;
  }

  public getRawProperty(key: string, fallback?: string): string | undefined {
    return this.propertySource(key) ?? fallback;
  }

  public getInt(key: string, fallback: number): number {
    const raw = this.getString(key);
    if (raw === undefined) return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) ? value : fallback;
  }

  public getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.getString(key)?.toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  }

  public getDuration(key: string, fallback: number): number {
    const raw = this.getString(key);
    if (raw === undefined) return fallback;
    const parsed = parseDurationMs(raw);
    return parsed === null || Number.isNaN(parsed) || parsed < 0 ? fallback : parsed;
  }

  public derive(mutate: (builder: ConfigurationBuilder) => void): Configuration {
    const builder = new ConfigurationBuilder(new Map(this.overrides), this.envSource, this.propertySource);
    mutate(builder);
    return builder.build();
  }
}

/** CFG-12: single-threaded use only; the immutability guarantee applies to the built `Configuration`. */
export class ConfigurationBuilder {
  public constructor(
    private overrides: Map<string, string> = new Map(),
    private envSource: SourceFn = () => undefined,
    private propertySource: SourceFn = () => undefined,
  ) {}

  public put(key: string, value: string): this {
    invariant(key !== undefined && key !== null, 'ConfigurationBuilder.put: key is required');
    invariant(value !== undefined && value !== null, 'ConfigurationBuilder.put: value is required');
    this.overrides.set(key, value);
    return this;
  }

  public remove(key: string): this {
    invariant(key !== undefined && key !== null, 'ConfigurationBuilder.remove: key is required');
    this.overrides.delete(key);
    return this;
  }

  public withEnvSource(fn: SourceFn): this {
    this.envSource = fn;
    return this;
  }

  public withPropertySource(fn: SourceFn): this {
    this.propertySource = fn;
    return this;
  }

  /** CFG-8: the override map is defensively copied so later builder mutation cannot alter this instance. */
  public build(): Configuration {
    return new ConfigurationImpl(new Map(this.overrides), this.envSource, this.propertySource);
  }
}

export const CFG_KEY_MAX_RETRY_ATTEMPTS = 'DEXPACE_MAX_RETRY_ATTEMPTS';
export const CFG_KEY_LOG_LEVEL = 'DEXPACE_LOG_LEVEL';
export const CFG_KEY_HTTP_PROXY = 'HTTP_PROXY';
export const CFG_KEY_HTTPS_PROXY = 'HTTPS_PROXY';
export const CFG_KEY_NO_PROXY = 'NO_PROXY';

let globalConfiguration: Configuration = new ConfigurationBuilder().build();

/** CFG-13: process-wide slot, last-write-wins, defaults to an empty configuration. */
export function getGlobalConfiguration(): Configuration {
  return globalConfiguration;
}

export function setGlobalConfiguration(config: Configuration): void {
  invariant(config !== undefined && config !== null, 'setGlobalConfiguration: config is required');
  globalConfiguration = config;
}
```

Production default wiring — `Configuration.default()` — is added in Task 7 alongside `resolveProxyOptions`,
since both need `process.env` as their real env source and Task 7 is where that wiring is first exercised
end-to-end. If you want a standalone `Configuration.default()` export sooner, add
`export const productionConfiguration = (): Configuration => new ConfigurationBuilder().withEnvSource((key) =>
process.env[key]).build();` to this file now instead — either placement satisfies `CFG-11`'s "production
defaults MUST delegate to the platform environment."

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/configuration.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/configuration.ts packages/core/src/config/configuration.test.ts
git commit -m "feat(core): layered Configuration model (CFG-1..14, CFG-37, CFG-38)"
```

---

### Task 7: `proxy.ts` — the proxy model and resolution

**Files:**
- Create: `packages/core/src/config/proxy.ts`
- Test: `packages/core/src/config/proxy.test.ts`

**Interfaces:**
- Consumes: `Configuration`, `CFG_KEY_HTTP_PROXY`, `CFG_KEY_HTTPS_PROXY`, `CFG_KEY_NO_PROXY` from
  `./configuration.js`.
- Produces: `interface ProxyOptions {type, host, port, nonProxyHosts, credentials?, challengeHandler?,
  bypassAll, toString()}`; `shouldBypassProxy(options: ProxyOptions, host: string): boolean`;
  `resolveProxyOptions(config: Configuration): ProxyOptions | null`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/proxy.test.ts
// Exercises: CFG-22 (immutable, credential-masking toString), CFG-23 (glob bypass, case-insensitive,
// full-string match), CFG-24 (env-only resolution -- HTTPS_PROXY preferred over HTTP_PROXY, never throws),
// CFG-25 (explicit port required, in range), CFG-27 (a bare "*" is bypass-all, not a literal entry).
import {describe, expect, test} from 'bun:test';
import {ConfigurationBuilder} from './configuration.js';
import {resolveProxyOptions, shouldBypassProxy} from './proxy.js';

describe('shouldBypassProxy (CFG-23)', () => {
  const options = {
    type: 'http' as const,
    host: 'proxy.example.com',
    port: 8080,
    nonProxyHosts: ['*.internal.example.com'],
    bypassAll: false,
  };

  test('a glob matches subdomains case-insensitively', () => {
    expect(shouldBypassProxy(options, 'API.internal.example.com')).toBe(true);
  });

  test('a glob does not match the apex domain', () => {
    expect(shouldBypassProxy(options, 'internal.example.com')).toBe(false);
  });

  test('bypass-all short-circuits regardless of the glob list', () => {
    expect(shouldBypassProxy({...options, bypassAll: true}, 'anything.example.com')).toBe(true);
  });
});

describe('resolveProxyOptions (CFG-24, CFG-25, CFG-27)', () => {
  function configWithEnv(env: Record<string, string | undefined>) {
    return new ConfigurationBuilder().withEnvSource((key) => env[key]).build();
  }

  test('HTTPS_PROXY is preferred over HTTP_PROXY', () => {
    const config = configWithEnv({
      HTTPS_PROXY: 'https://secure.example.com:9090',
      HTTP_PROXY: 'http://plain.example.com:8080',
    });
    const options = resolveProxyOptions(config);
    expect(options?.host).toBe('secure.example.com');
    expect(options?.port).toBe(9090);
  });

  test('a proxy URL with no port is invalid, resolving to null', () => {
    const config = configWithEnv({HTTPS_PROXY: 'https://example.com'});
    expect(resolveProxyOptions(config)).toBeNull();
  });

  test('no proxy configured resolves to null', () => {
    expect(resolveProxyOptions(configWithEnv({}))).toBeNull();
  });

  test('malformed proxy configuration never throws', () => {
    const config = configWithEnv({HTTPS_PROXY: 'not a url at all'});
    expect(() => resolveProxyOptions(config)).not.toThrow();
    expect(resolveProxyOptions(config)).toBeNull();
  });

  test('a bare "*" in NO_PROXY resolves to bypass-all (null, routes directly)', () => {
    const config = configWithEnv({HTTPS_PROXY: 'https://example.com:8080', NO_PROXY: '*'});
    expect(resolveProxyOptions(config)).toBeNull();
  });
});

describe('ProxyOptions credential masking (CFG-22)', () => {
  test('toString masks credentials', () => {
    const options = {
      type: 'http' as const,
      host: 'proxy.example.com',
      port: 8080,
      nonProxyHosts: [],
      credentials: {username: 'user', password: 'secret'},
      bypassAll: false,
      toString(): string {
        return `http://***:***@proxy.example.com:8080`;
      },
    };
    expect(options.toString()).not.toContain('secret');
    expect(options.toString()).not.toContain('user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/proxy.test.ts`
Expected: FAIL — `Cannot find module './proxy.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/proxy.ts
import type {Configuration} from './configuration.js';
import {CFG_KEY_HTTPS_PROXY, CFG_KEY_HTTP_PROXY, CFG_KEY_NO_PROXY} from './configuration.js';

export interface ProxyCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * CFG-22: immutable proxy configuration. Ships as a type + resolution logic only this phase -- no concrete
 * `Transport` consumes it until Phase 8, mirroring Phase 2's `Serde<T>`-before-`codec-json` precedent.
 */
export interface ProxyOptions {
  readonly type: 'http' | 'socks4' | 'socks5';
  readonly host: string;
  readonly port: number;
  readonly nonProxyHosts: readonly RegExp[] | readonly string[];
  readonly credentials?: ProxyCredentials | undefined;
  readonly challengeHandler?: unknown;
  readonly bypassAll: boolean;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\]/gu, '\\$&');
  const withWildcards = escaped.replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${withWildcards}$`, 'iu');
}

/** CFG-23: bypass-all short-circuits; otherwise true iff `host` matches any configured glob, case-insensitive. */
export function shouldBypassProxy(
  options: Pick<ProxyOptions, 'bypassAll' | 'nonProxyHosts'>,
  host: string,
): boolean {
  if (options.bypassAll) return true;
  return options.nonProxyHosts.some((pattern) => {
    const regex = pattern instanceof RegExp ? pattern : globToRegExp(pattern);
    return regex.test(host);
  });
}

function parsePort(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
}

function parseProxyUrl(raw: string): {host: string; port: number; credentials?: ProxyCredentials} | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const port = parsePort(url.port);
  if (port === null || url.hostname === '') return null;
  const credentials = url.username !== ''
    ? {username: decodeURIComponent(url.username), password: decodeURIComponent(url.password)}
    : undefined;
  return {host: url.hostname, port, credentials};
}

function resolveNonProxyHosts(config: Configuration): {bypassAll: boolean; hosts: readonly string[]} {
  // CFG-26 collapses the same way CFG-24 does: no system-properties tier exists in Node to prefer over the
  // environment variable, so a single Configuration.getString lookup (env, comma-separated) is the whole
  // resolution -- there is no second, pipe-separated source to reconcile against.
  const raw = config.getString(CFG_KEY_NO_PROXY);
  if (raw === undefined) return {bypassAll: false, hosts: []};
  const tokens = raw.split(',').map((token) => token.trim()).filter((token) => token !== '');
  if (tokens.length === 1 && tokens[0] === '*') return {bypassAll: true, hosts: []};
  return {bypassAll: false, hosts: tokens};
}

/**
 * CFG-24: env-only resolution (Node has no system-properties layer to prefer first) -- HTTPS_PROXY preferred
 * over HTTP_PROXY, parsed as `scheme://user:pass@host:port`. CFG-25: an absent/invalid port is a hard reject,
 * no default-port guessing. CFG-27: a bare "*" NO_PROXY value is bypass-all, returned as `null` so the caller
 * routes directly. Total: never throws on malformed input.
 */
export function resolveProxyOptions(config: Configuration): ProxyOptions | null {
  const {bypassAll, hosts} = resolveNonProxyHosts(config);
  if (bypassAll) return null;

  const httpsProxy = config.getString(CFG_KEY_HTTPS_PROXY);
  const httpProxy = config.getString(CFG_KEY_HTTP_PROXY);
  const raw = httpsProxy ?? httpProxy;
  if (raw === undefined) return null;

  const parsed = parseProxyUrl(raw);
  if (parsed === null) return null;

  return {
    type: 'http',
    host: parsed.host,
    port: parsed.port,
    nonProxyHosts: hosts,
    credentials: parsed.credentials,
    bypassAll: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/proxy.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/proxy.ts packages/core/src/config/proxy.test.ts
git commit -m "feat(core): proxy model and env-only resolution (CFG-22..28)"
```

---

### Task 8: Build-time version codegen and `build-info.ts`

**Files:**
- Create: `packages/core/scripts/gen-version.mjs`
- Create: `packages/core/src/generated/version.ts` (generated by the script; commit the initial run's output)
- Create: `packages/core/src/config/build-info.ts`
- Test: `packages/core/src/config/build-info.test.ts`
- Modify: `packages/core/package.json` (add a `prebuild` script invoking `gen-version.mjs` ahead of `tsc`)

**Interfaces:**
- Consumes: `SDK_VERSION` from `../generated/version.js`.
- Produces: `interface BuildInfo {sdkVersion, runtimeIdentity, identityTokens}`; `getBuildInfo(): BuildInfo`.
  Task 9 consumes `getBuildInfo`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/build-info.test.ts
// Exercises: CFG-36 (version and runtime identity resolved once, non-blank "unknown" fallback, a default
// ordered [sdkToken, runtimeToken] identity-token list with every token non-blank), NFR-15 (the version is
// never the placeholder on a build that ran its codegen step).
import {describe, expect, test} from 'bun:test';
import {getBuildInfo} from './build-info.js';
import {SDK_VERSION} from '../generated/version.js';

describe('getBuildInfo', () => {
  test('sdkVersion matches the generated build-time constant, never the placeholder (NFR-15)', () => {
    expect(getBuildInfo().sdkVersion).toBe(SDK_VERSION);
    expect(getBuildInfo().sdkVersion).not.toBe('unknown');
  });

  test('runtimeIdentity is a non-blank string', () => {
    expect(getBuildInfo().runtimeIdentity.length).toBeGreaterThan(0);
  });

  test('identityTokens is ordered [sdkToken, runtimeToken], every token non-blank', () => {
    const {identityTokens} = getBuildInfo();
    expect(identityTokens).toHaveLength(2);
    for (const token of identityTokens) {
      expect(token.length).toBeGreaterThan(0);
    }
    expect(identityTokens[0]).toContain(SDK_VERSION);
  });

  test('resolves once and is stable across calls', () => {
    expect(getBuildInfo()).toEqual(getBuildInfo());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/build-info.test.ts`
Expected: FAIL — `Cannot find module './build-info.js'` (and `../generated/version.js` does not exist yet).

- [ ] **Step 3: Write the codegen script**

```javascript
#!/usr/bin/env node
// packages/core/scripts/gen-version.mjs
// Writes src/generated/version.ts as a plain string-literal constant from package.json's version field, so
// @dexpace/core never needs a runtime package.json read (which would require import.meta.url/node:fs tricks
// unavailable on the browser/Workers half of core's runtime floor). Run before every build; the output is
// committed so a `bun test` run without a fresh build still has a real (if stale) version, never "unknown".
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.join(scriptDir, '..', 'package.json');
const outputPath = path.join(scriptDir, '..', 'src', 'generated', 'version.ts');

const {version} = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const contents = `// SPDX-License-Identifier: MIT
// Generated by scripts/gen-version.mjs from package.json -- do not edit by hand.
export const SDK_VERSION = ${JSON.stringify(version)};
`;

writeFileSync(outputPath, contents);
```

Note: this script itself runs under Node at build time (a `devDependencies`-only, non-shipped script), so its
own use of `node:fs`/`node:url`/`node:path` does not violate `@dexpace/core`'s zero-`node:`-import invariant —
that invariant covers the package's shipped runtime source under `src/`, not its build tooling.

- [ ] **Step 4: Run the script once and commit its output**

Run: `node packages/core/scripts/gen-version.mjs`
Expected: creates `packages/core/src/generated/version.ts` containing `export const SDK_VERSION = "0.1.0";`
(or whatever `package.json`'s current `version` is).

- [ ] **Step 5: Write `build-info.ts`**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/build-info.ts
import {SDK_VERSION} from '../generated/version.js';

export interface BuildInfo {
  readonly sdkVersion: string;
  readonly runtimeIdentity: string;
  readonly identityTokens: readonly string[];
}

interface ProcessLike {
  readonly version?: string;
  readonly platform?: string;
}
interface NavigatorLike {
  readonly userAgent?: string;
}
interface DenoLike {
  readonly version?: {readonly deno?: string};
}

/**
 * CFG-36: feature-detected, never throwing. Node/Bun-compat mode reads `process.version`/`process.platform`;
 * browsers/Workers read `navigator.userAgent`; Deno reads `Deno.version`; anything else falls back to the
 * non-blank literal "unknown" -- never an empty string, per CFG-36's own wording.
 */
function detectRuntimeIdentity(): string {
  const proc = (globalThis as {process?: ProcessLike}).process;
  if (proc?.version !== undefined) return `node/${proc.version.replace(/^v/u, '')}`;

  const deno = (globalThis as {Deno?: DenoLike}).Deno;
  if (deno?.version?.deno !== undefined) return `deno/${deno.version.deno}`;

  const nav = (globalThis as {navigator?: NavigatorLike}).navigator;
  if (nav?.userAgent !== undefined && nav.userAgent !== '') return nav.userAgent;

  return 'unknown';
}

let cached: BuildInfo | undefined;

/** CFG-36: resolved once at first access, cached thereafter. */
export function getBuildInfo(): BuildInfo {
  if (cached === undefined) {
    const sdkVersion = SDK_VERSION.length > 0 ? SDK_VERSION : 'unknown';
    const runtimeIdentity = detectRuntimeIdentity();
    cached = {
      sdkVersion,
      runtimeIdentity,
      identityTokens: [`dexpace-sdk/${sdkVersion}`, runtimeIdentity],
    };
  }
  return cached;
}
```

- [ ] **Step 6: Wire the codegen script into the package build**

Modify `packages/core/package.json`'s `scripts` block, adding a `prebuild` entry that runs before `build`:

```json
{
  "scripts": {
    "prebuild": "node scripts/gen-version.mjs",
    "build": "tsc -b"
  }
}
```

npm/Bun run `prebuild` automatically before `build` by lifecycle-script convention, so `bun run build` always
regenerates `src/generated/version.ts` from the current `package.json` version first.

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test packages/core/src/config/build-info.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/scripts/gen-version.mjs packages/core/src/generated/version.ts \
  packages/core/src/config/build-info.ts packages/core/src/config/build-info.test.ts packages/core/package.json
git commit -m "feat(core): build-time version codegen and BuildInfo descriptor (CFG-36, NFR-15)"
```

---

### Task 9: `client-identity-step.ts` — `RECOV-33`, closing `NFR-15`

**Files:**
- Create: `packages/core/src/config/client-identity-step.ts`
- Test: `packages/core/src/config/client-identity-step.test.ts`

**Interfaces:**
- Consumes: `StepDescriptor` from `../pipeline/step.js`; `getBuildInfo` from `./build-info.js`.
- Produces: `interface ClientIdentitySettings {headerName?, tokens?, mode?}`;
  `clientIdentityStep(settings?: ClientIdentitySettings): StepDescriptor`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/config/client-identity-step.test.ts
// Exercises: RECOV-33 (Append mode joins tokens with spaces, appends after the FIRST existing value, an
// empty first value is treated as absent so no leading space is emitted; Replace mode overwrites; an empty
// or blank-joining token list is a no-op, never emitting a blank/whitespace-only header), plus the
// configurable header-name/tokens/mode this design adds on top.
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import type {StepContext} from '../pipeline/step.js';
import {clientIdentityStep} from './client-identity-step.js';

const BASE_REQUEST = Request.newBuilder().url('https://example.com').build();

async function runStep(
  descriptor: ReturnType<typeof clientIdentityStep>,
  request = BASE_REQUEST,
): Promise<Request> {
  let seen: Request | undefined;
  const next = async (r: Request): Promise<Request> => {
    seen = r;
    return r;
  };
  await descriptor.fn(request, {next} as unknown as StepContext);
  return seen ?? request;
}

describe('clientIdentityStep', () => {
  test('append mode sets the sole value when the header is absent', async () => {
    const step = clientIdentityStep({tokens: ['sdk/1.0', 'node/20']});
    const result = await runStep(step);
    expect(result.headers.get('User-Agent')).toBe('sdk/1.0 node/20');
  });

  test('append mode composes onto the first existing value AND preserves every other value (RECOV-33)', async () => {
    const headers = Headers.newBuilder().add('User-Agent', 'existing-agent').add('User-Agent', 'second').build();
    const request = BASE_REQUEST.newBuilder().headers(headers).build();
    const step = clientIdentityStep({tokens: ['sdk/1.0']});

    const result = await runStep(step, request);

    // .get() only returns the first value -- the multi-value case is only caught by asserting getAll().
    expect(result.headers.getAll('User-Agent')).toEqual(['existing-agent sdk/1.0', 'second']);
  });

  test('replace mode overwrites all existing values', async () => {
    const headers = Headers.newBuilder().add('User-Agent', 'existing-agent').build();
    const request = BASE_REQUEST.newBuilder().headers(headers).build();
    const step = clientIdentityStep({tokens: ['sdk/1.0'], mode: 'replace'});

    const result = await runStep(step, request);

    expect(result.headers.get('User-Agent')).toBe('sdk/1.0');
  });

  test('an empty token list is a no-op, emitting no header', async () => {
    const step = clientIdentityStep({tokens: []});
    const result = await runStep(step);
    expect(result.headers.get('User-Agent')).toBeUndefined();
  });

  test('a header name is configurable for a second identity line', async () => {
    const step = clientIdentityStep({headerName: 'X-Client-Info', tokens: ['app/2.0']});
    const result = await runStep(step);
    expect(result.headers.get('X-Client-Info')).toBe('app/2.0');
  });

  test('defaults to User-Agent with the build/runtime identity tokens', async () => {
    const step = clientIdentityStep();
    const result = await runStep(step);
    expect(result.headers.get('User-Agent')?.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/config/client-identity-step.test.ts`
Expected: FAIL — `Cannot find module './client-identity-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// SPDX-License-Identifier: MIT
// packages/core/src/config/client-identity-step.ts
import type {HeadersBuilder} from '../http/headers.js';
import type {Request} from '../http/request.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {getBuildInfo} from './build-info.js';

export interface ClientIdentitySettings {
  readonly headerName?: string | undefined;
  readonly tokens?: readonly string[] | undefined;
  readonly mode?: 'append' | 'replace' | undefined;
}

const CLIENT_IDENTITY_STEP_TYPE: unique symbol = Symbol('dexpace.client-identity');

function composeAppend(existingFirst: string | undefined, joined: string): string {
  return existingFirst === undefined || existingFirst === '' ? joined : `${existingFirst} ${joined}`;
}

/**
 * RECOV-33's Append mode composes onto the FIRST existing value while preserving every OTHER pre-existing
 * value untouched -- `HeadersBuilder` has no "replace just the first value" primitive, only `set` (replace
 * ALL values) and `add` (append one more), so this rebuilds the full value list explicitly: clear the
 * header, add the composed first value, then re-add every other original value in order. Replace mode has no
 * such concern -- it legitimately overwrites everything, so a plain `set` suffices there.
 */
function buildHeaders(
  request: Request,
  headerName: string,
  mode: 'append' | 'replace',
  joined: string,
): HeadersBuilder {
  const builder = request.headers.newBuilder();
  if (mode === 'replace') return builder.set(headerName, joined);

  const existingValues = request.headers.getAll(headerName);
  if (existingValues.length === 0) return builder.set(headerName, joined);

  const [first, ...rest] = existingValues;
  let next = builder.set(headerName, null).add(headerName, composeAppend(first, joined));
  for (const value of rest) next = next.add(headerName, value);
  return next;
}

/**
 * RECOV-33: composes configured tokens into a single space-separated header value. Append mode (default)
 * appends after the FIRST existing value, treating an empty first value as absent (no leading space), and
 * preserves every other pre-existing value untouched (`buildHeaders` above); Replace mode overwrites every
 * existing value. An empty or blank-joining token list is a no-op -- never emits a blank/whitespace-only
 * header. Default header is "User-Agent" (CFG-36's tokens are explicitly "for User-Agent-style composition"),
 * default tokens are `getBuildInfo().identityTokens` -- this closes NFR-15. Not a pillar step -- `stage` is
 * fixed to `'PRE_REDIRECT'`, 4c's outermost slot (runs once per top-level call, before
 * REDIRECT/RETRY/AUTH/LOGGING/SERDE even start), not one of `PILLAR_STAGES`. `StepDescriptor.stage` is a
 * required field (4c's `step.ts`); omitting it is a type error, not an optional default.
 */
export function clientIdentityStep(settings: ClientIdentitySettings = {}): StepDescriptor {
  const headerName = settings.headerName ?? 'User-Agent';
  const mode = settings.mode ?? 'append';

  return {
    type: CLIENT_IDENTITY_STEP_TYPE,
    stage: 'PRE_REDIRECT',
    fn: async (request: Request, ctx) => {
      const tokens = settings.tokens ?? getBuildInfo().identityTokens;
      const joined = tokens.join(' ').trim();
      if (joined === '') return ctx.next(request);

      const headers = buildHeaders(request, headerName, mode, joined).build();
      return ctx.next(request.newBuilder().headers(headers).build());
    },
  };
}
```

The test's `descriptor.fn(request, {next} as unknown as StepContext)` call shape assumes `StepDescriptor.fn`
takes `(request, ctx)` with `ctx.next` as the continuation, matching 4c's `Step`/`StepContext` shape. If 4c's
actual `StepContext` names this differently (check `packages/core/src/pipeline/step.ts` once it exists), adapt
both the implementation and the test's stub to the real member name — do not invent a second continuation
convention.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/config/client-identity-step.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/client-identity-step.ts packages/core/src/config/client-identity-step.test.ts
git commit -m "feat(core): client-identity header step (RECOV-33), closes NFR-15"
```

---

### Task 10: Public barrel promotion, gates, and the checklist

**Files:**
- Modify: `packages/core/src/index.ts`
- Verify: `packages/core/etc/core.api.md`
- Create: `docs/superpowers/plans/2026-07-28-phase7a-configuration-checklist.md`

**Interfaces:**
- Consumes: every public symbol from Tasks 1–9.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Amend the package-root barrel**

Add to `packages/core/src/index.ts` (do **not** create `src/config/index.ts` — see Global Constraints):

```typescript
export type {Clock} from './config/clock.js';
export {defaultClock} from './config/clock.js';
export {formatHttpDate, parseHttpDate} from './config/http-date.js';
export {isRetryableStatus, RETRYABLE_STATUSES} from './config/retryable.js';
export {randomUuid} from './config/identifiers.js';
export type {Configuration, SourceFn} from './config/configuration.js';
export {
  ConfigurationBuilder,
  getGlobalConfiguration,
  setGlobalConfiguration,
  CFG_KEY_MAX_RETRY_ATTEMPTS,
  CFG_KEY_LOG_LEVEL,
  CFG_KEY_HTTP_PROXY,
  CFG_KEY_HTTPS_PROXY,
  CFG_KEY_NO_PROXY,
} from './config/configuration.js';
export type {ProxyOptions, ProxyCredentials} from './config/proxy.js';
export {resolveProxyOptions, shouldBypassProxy} from './config/proxy.js';
export type {BuildInfo} from './config/build-info.js';
export {getBuildInfo} from './config/build-info.js';
export type {ClientIdentitySettings} from './config/client-identity-step.js';
export {clientIdentityStep} from './config/client-identity-step.js';
```

`config/equality.ts`'s `deepEqual`/`deepHash` are deliberately **not** added — they stay `@internal` per the
design doc (no requirement gives a caller direct access to them through the SDK's public API).

- [ ] **Step 2: Regenerate the API report**

Run: `bun run api`
Expected: `packages/core/etc/core.api.md` updates to include every symbol from Step 1. Unlike 5a's Task 12
(which asserted a byte-identical report because nothing was promoted), this phase's report is **expected to
change** — review the diff and confirm it contains exactly the symbols listed in Step 1, nothing more.

- [ ] **Step 3: Confirm no `node:` import crept in**

Run: `bun run verify:seam-1`
Expected: PASS. (`gen-version.mjs` is a build script, not shipped `src/` code, and is exempt — see Task 8's
note.)

- [ ] **Step 4: Run the full gate sequence**

Run:

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS.

- [ ] **Step 5: Write the requirement checklist**

Create `docs/superpowers/plans/2026-07-28-phase7a-configuration-checklist.md`, same `| ID | Level |
Requirement gist | Status | Where |` table format as prior phase checklists (e.g.
`2026-07-24-phase3a-io-contracts-checklist.md`), legend ✅ shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **`§16.1` Layered lookup** — `CFG-1`–`CFG-4`, `CFG-38` ✅ Task 6.
2. **`§16.2` Never-throw typed accessors** — `CFG-5`–`CFG-7` ✅ Task 6.
3. **`§16.3` Immutability and derivation** — `CFG-8`–`CFG-14`, `CFG-37` ✅ Task 6.
4. **`§16.4` Clock and async primitives** — `CFG-15`–`CFG-17` ✅ Task 1; `CFG-18`–`CFG-21` N/A (no JVM-style
   executor/scheduled-future vocabulary in this port — see the design doc's Deviation Ledger).
5. **`§16.5` Proxy model** — `CFG-22`–`CFG-28` ✅ Task 7 (types + resolution only; concrete `Transport`
   consumption ⏳ Phase 8).
6. **`§16.6` Dates, identifiers, equality** — `CFG-29`–`CFG-31` ✅ Task 2; `CFG-32` ✅ Task 4; `CFG-33`/`CFG-34`
   ✅ Task 5; `CFG-35` ✅ Task 3; `CFG-36` ✅ Task 8.
7. **`NFR-15`** ✅ Tasks 8 and 9 jointly (the descriptor and the step that stamps it).
8. **Appendix C `RECOV-33`** ✅ Task 9.
9. **Cross-phase retrofits** — 5a's plan/design amended (`Clock`, RFC 1123 parser, retryable-status classifier
   single-sourcing) directly, 2026-07-28, ahead of 5a's own execution.
10. **Deferred out of Phase 7a** — `ProxyOptions.challengeHandler` protocol → Phase 8; whether
    `clientIdentityStep` joins `standardResilience()`'s default install list → Phase 9 or a future preset
    revision.

State explicitly at the top whether the plan has been executed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/index.ts packages/core/etc/core.api.md \
  docs/superpowers/plans/2026-07-28-phase7a-configuration-checklist.md
git commit -m "feat(core): promote Phase 7a's public surface; checklist"
```

---

## Self-Review

**1. Spec coverage.** `CFG-1`–`CFG-14`, `CFG-37`, `CFG-38` → Task 6. `CFG-15`–`CFG-17` → Task 1 (`CFG-18`–
`CFG-21` N/A, no executor vocabulary in this port). `CFG-22`–`CFG-28` → Task 7. `CFG-29`–`CFG-31` → Task 2.
`CFG-32` → Task 4. `CFG-33`/`CFG-34` → Task 5. `CFG-35` → Task 3. `CFG-36` → Task 8. `NFR-15` → Tasks 8+9.
`RECOV-33` → Task 9. Every requirement in the design doc's scope has a task. The three 5a retrofits (`Clock`,
RFC 1123 parser, retryable-status classifier) are applied directly to 5a's already-written plan/design, not a
task in this plan, since they're edits to another phase's document rather than production code this phase
ships.

**2. Placeholder scan.** No "TBD"/"TODO"/"implement later" anywhere. Task 6's note about
`Configuration.default()`'s production wiring gives a concrete, complete alternative rather than deferring —
fixed by stating the exact code either way.

**3. Type consistency.** `ConfigurationBuilder`/`Configuration` (Task 6) are consumed by Task 7 with matching
method names (`getString`, `derive`). `getBuildInfo(): BuildInfo` (Task 8) is consumed by Task 9 with the same
signature. `ProxyOptions`'s field names (Task 7) match the design doc's
`host`/`port`/`nonProxyHosts`/`credentials`/`bypassAll` throughout. Fixed two issues during this review: Task 9's
`StepDescriptor` was missing its required `stage` field entirely (`packages/core/src/pipeline/step.ts`'s
`StepDescriptor.stage: Stage` is not optional — checked directly against 4c's plan) — added `stage:
'PRE_REDIRECT'`, 4c's outermost non-pillar slot, since `clientIdentityStep` runs once per top-level call and
isn't one of the five reserved pillars. Also confirmed `ctx.next(request): Promise<Response>` (not `ctx.fork`,
which only exists for pillar-stage steps per `PILLAR_STAGES`) is the correct continuation for a plain
request-rewriting step, matching `Step`'s actual signature in 4c's plan.

**4. Post-write review pass (2026-07-28).** An independent review against the implementation sketches (not
just the prose) found a real `RECOV-33` (MUST) violation in Task 9: Append mode composed a single value and
called `headers.newBuilder().set(headerName, value)`, which replaces ALL existing values for that header —
silently dropping any pre-existing value beyond the first, contradicting RECOV-33's explicit "preserving all
other pre-existing values" clause. The task's own test for this exact scenario only asserted `.get()` (first
value only), so the bug shipped with a passing suite. Fixed: `buildHeaders()` now explicitly clears the header
and rebuilds it (composed-first-value, then every other original value in order) rather than relying on
`.set()`'s full-replace semantics; the test now asserts `.getAll()` against both values.
