# Phase 5b — Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the redirect-following pillar step in `@dexpace/core` — status/method eligibility, cross-origin
comparison and the credential-suppression marker, the pure per-hop decision function, scheme-downgrade and
loop/hop-cap guarding, and the pillar adapter plus its bundled marker-stripping safety net — satisfying
`docs/product-spec/10-redirect-handling.md` (`REDIR-1`–`REDIR-*`), per
`docs/work/mvp/phase5/phase5b/2026-07-26-phase5b-redirect-design.md`, and closing the roadmap's `PIPE-40` deferred item.

> **Amended 2026-07-28 (Phase 7b retrofit):** Task 6's `redirect-step.ts` gains three `SHOULD`-level structured
> log events via `getGlobalLogger()` — a hop event, a rejection event distinguishing `SchemeDowngradeError`
> from other `'fail'` causes, and a downgrade event on an *opted-in* HTTPS→HTTP hop (7b's amendment names all
> three) — narrow blast radius, only this file's own emission points. Every URL field goes through
> `redactUrl()`, and every emission site is wrapped in `emitQuietly()`, per `REDIR-28`/`XCUT-19` and
> `OBS-20`/`XCUT-20` respectively. **Partial closure only:** `decide()`'s `Decision` type has no reason
> discriminant on `'return-current'`, so a genuine "loop-detected" vs. "hop-cap-exceeded" vs. "normal
> termination" distinction is NOT covered here — reshaping `Decision` for that is out of scope for this
> retrofit (a `SHOULD`, not a `MUST`, and 5b's `decide.test.ts` asserts the current shape throughout); the
> malformed-Location event of `REDIR-28` is deferred with it, for the same reason.
>
> **Applied by Phase 7b, not by this plan (corrected 2026-07-29).** Phase 5b executes *before* Phase 7b, so a
> call site here importing `observability/logger.js` or `observability/redaction.js` would not resolve at this
> plan's own execution time — and 7b needs 5b's redirect step for its own retrofit conformance test, so the
> earlier "5b now depends on 7b first" wording was a cycle. **An agent executing this plan must skip the Phase
> 7b retrofit blocks in Task 6** and build `redirect-step.ts` without any `observability/` import; Phase 7b's
> plan Task 9 adds the three emission sites afterwards. See
> `docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability.md`'s Prerequisite and Task 9.

**Architecture:** A new `packages/core/src/redirect/` folder of seven files. `decide.ts` is a pure function — no
I/O, no clock, no side effects beyond the `Request` value it returns — that resolves one hop's outcome from a
`Response`, the in-flight `Request`, the seed origin, the visited set, and settings. `redirect-step.ts` is a thin
imperative loop around it: re-drive via `ctx.fork()` on every dispatch (never `ctx.next()`, since the step may
re-drive an unknown number of times), closing each discarded intermediate response and returning the final one
open. `strip-marker-step.ts` bundles a second, independent `POST_AUTH` guard alongside the pillar step via
`withRedirect()`, so the cross-origin marker never reaches the wire even with no auth step installed (5c ships
later). **No async-side mirror** — unlike 5a's retry engine, the async standard pipeline follows no redirects at
all, so this phase ships one adapter, not two.

**Tech Stack:** TypeScript 5.8+, native `URL`, `fast-check` for the three invariant-bearing pure functions,
`bun test`. No new runtime dependencies. No `node:` imports — all of `URL`, `Headers`, and the platform's
`ReadableStream` are already used elsewhere in `@dexpace/core` without one.

**Prerequisite:** This plan assumes Phases 0–4c and 5a are implemented exactly as their plans specify. Concretely:

- `packages/core/src/http/method.js` — `type Method`, `isIdempotent(method)`
- `packages/core/src/http/headers.js` — `Headers` (static `newBuilder()`; instance `get(name): string | undefined`,
  `getAll(name): readonly string[]`, `has(name)`, `names(): readonly string[]`, `newBuilder()`),
  `HeadersBuilder.add(name, value)` (`HTTP-14`, appends), `HeadersBuilder.set(name, value: string | null)` (a
  `null` value removes the header; a non-null value REPLACES any existing entry — the same call already
  implements "clear inbound copy, then set"), and `HeadersBuilder.setInbound(name, value)` — the **lenient**
  sibling (`HTTP-19`) that permits obs-text bytes `>= 0x80` while still rejecting control characters.
  **Response fixtures in tests MUST be built with `setInbound`**, not `set`: `set` is the outbound-strict path
  and rejects any non-ASCII byte, so a fuzzed `Location`/`WWW-Authenticate` value would throw inside the
  fixture rather than reaching the code under test
- `packages/core/src/http/request.js` — `Request` (`method`, `url: URL` — **a fresh `URL` instance every call**,
  never the same object twice, so callers should read it once into a local — `headers`, `body: Body | undefined`,
  `newBuilder()`), `RequestBuilder` (`.method()`, `.url(url: string | URL)` — **confirm the `URL` overload
  exists**; `buildFollowRequest` (Task 5) passes a `URL` object where the tests pass strings, so if the builder
  is string-only, pass `target.href` there — `.headers()`, `.body(body: Body | undefined)`, `.build()`)
- `packages/core/src/http/response.js` — `Response` (static `newBuilder()`; instance `status: Status`, `headers`,
  `newBuilder()` (`HTTP-3`), `close(): Promise<void>`, idempotent; **frozen** — never assign a spy onto it),
  `ResponseBuilder` (`.request()`, `.protocol()`, `.status()`, `.headers()`, `.body(body: Body | null)`, `.build()`)
- `packages/core/src/http/status.js` — `Status.of(code)`, `status.code`
- `packages/core/src/http/protocol.js` — `Protocol.HTTP_1_1` (test fixtures only)
- `packages/core/src/http/errors.js` — `DexpaceError`
- `packages/core/src/body/body.js` — `Body` (`replayable: boolean`)
- `packages/core/src/body/simple-bodies.js` — `stringBody(text)` (replayable) and
  `packages/core/src/body/stream-body.js` — `streamBody(stream, mediaType, length)` (single-use). Test fixtures
  only; **confirm both module paths and factory names against 3b's plan before writing Task 5's test** — they
  are the only 3b symbols this phase touches and neither is exercised elsewhere in 5a
- `packages/core/src/invariant.js` — `invariant()`
- `packages/core/src/pipeline/step.js` — `Step`, `StepContext` (`next`, `fork?: () => Next`, `context`,
  `signal?: AbortSignal | undefined`, `options?: RequestOptions | undefined` — the last two are 5a's Task 1
  amendment; this phase reads only `signal`), `StepDescriptor`, and the `Stage` union. **Task 7 hard-depends on
  `'POST_AUTH'` being a member of that union** (4c's inert post-pillar extension slot, per `PIPE-3`). Confirm
  the exact spelling in `packages/core/src/pipeline/stage.ts` before Task 7; if 4c named it differently, use
  4c's name — the requirement is only that the slot sits *inside* `AUTH` and *outside* `SEND`
- `packages/core/src/pipeline/cursor.js` — `class Cursor` with the `{steps, transport, request, context, signal?}`
  constructor bag and `advance(): Promise<Response>` (Tasks 6/7 tests drive steps through it directly, as 5a's
  `retry-step.test.ts` does). Match 5a's call shape rather than the one sketched here if the two disagree
- `packages/core/src/pipeline/builder.js` — `class PipelineBuilder` with `append(descriptor): this`,
  `build(): Runtime`, and `Runtime.steps` — the read-only ordered step view `PIPE-25` requires, which Task 7's
  `withRedirect` test reads
- `packages/core/src/observability/logger.js` (Phase 7b) — `getGlobalLogger()`, `type Logger`, `type LogLevel`
  (`'error' | 'warning' | 'info' | 'verbose'`) — Task 6 only
- `packages/core/src/observability/redaction.js` (Phase 7b) — `redactUrl(url: URL | string): string`, total
  (never throws, `[malformed url]` sentinel on failure) — Task 6 only
- `packages/core/src/testing/fake-transport.js` — `class FakeTransport implements Transport`, `countingResponse(status, request?): {response, cancelCount}`, `.sendCount`, `.calls` (5a's `@internal` test double, reused unchanged)

**One assumption to confirm before Task 6.** Every close assertion below observes `countingResponse()`'s
`cancelCount()` on a response that was rebuilt via `response.newBuilder().headers(...).build()` (to attach a
`Location`). That only works if `ResponseBuilder` carries the **same body instance** through the copy rather
than re-wrapping it. Check `packages/core/src/http/response.ts` first: if the rebuild produces a different
body, attach `Location` by passing pre-built headers into `countingResponse()`'s own construction instead of
rebuilding after the fact — do not weaken the assertion.

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **Nothing from `src/redirect/` is exported from `packages/core/src/index.ts`, and the folder gets no
  `index.ts`.** Same "not yet" disposition 5a's retry folder shipped with: 5c's public-barrel-promotion task is
  the first point any pillar-authoring surface goes public, alongside `authStep`/`standardResilience`. The
  mechanical check is that `packages/core/etc/core.api.md` is byte-identical before and after this phase (Task 8).
- **No `node:` imports anywhere in `packages/core`.** Redirect resolution uses only the global `URL` and
  `Headers`/`ReadableStream` seams already established. `verify:seam-1` enforces this.
- **No new error leaf for settings validation.** `redirectSettings()`'s validation (a caller passing
  `maxHops: -1`) is a programmer error per `docs/knowledge/error-handling.md`'s split, so it uses `invariant()` —
  same call 5a's `retrySettings()` made. Do not add a `RedirectSettingsError`. `NonReplayableBodyError` and
  `SchemeDowngradeError` ARE new leaves — they are the two *operational* failures a caller can legitimately hit
  mid-redirect, not a construction-time misconfiguration.
- **`Response` instances are `Object.freeze`d.** Observe close through `FakeTransport`'s `countingResponse()`
  helper (5a), never by patching `response.close`.
- **ESLint limits are hard: `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.** See "Plan-time
  signature decisions" below — three of the design doc's prose signatures are adjusted to fit this, with no
  behavior change.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`.** Kebab-case filenames. Named exports only. Explicit return types on every exported function.
- **Tests must survive any order and parallel execution.** `decide()` and `codes.ts`/`cross-origin.ts` hold zero
  module-level mutable state.

### Plan-time signature decisions

The design doc's prose gives `decide()` five positional parameters and `isEligibleByCode()` four — both exceed
the codebase's `max-params: 3` rule that 4c and 5a already established structurally (`runWithRetry(request,
dispatch, config)`, three). Three signatures are adjusted here, each a mechanical bundling with no behavior
change; each is called out again at its task below:

1. `decide(response, currentRequest, seedOrigin, visited, settings)` → `decide(response, context, settings)`,
   where `context: RedirectContext` bundles `{currentRequest, seedOrigin, visited, redirectsFollowed}`.
2. `isEligibleByCode(status, method, allowed, allow303)` → `isEligibleByCode(status, method, eligibility)`, where
   `eligibility: CodeEligibility` is `{allowedMethods, allow303}` — a `RedirectSettings` value satisfies this
   structurally, so callers pass `settings` directly without constructing a separate object.
3. An internal helper in `decide.ts`, `buildFollowRequest(current, target, status, crossOrigin)` in the design
   doc's implied shape, is written here as `buildFollowRequest(current, plan)` with `plan: FollowPlan =
   {target, status, crossOrigin}`.
4. `redirectStep(settings: RedirectSettings)` and `withRedirect(builder, settings: RedirectSettings)` in the
   design doc become `redirectStep(overrides?: Partial<RedirectSettings>)` and `withRedirect(builder,
   overrides?: Partial<RedirectSettings>)`, each calling `redirectSettings(overrides)` internally. This is not
   cosmetic: `docs/knowledge/api-design.md`'s rule that "the whole options object and every field within it
   must be optional and `readonly`, so a zero-config call works and a caller can override one field without
   restating the rest" makes the design doc's all-required form non-conformant. `redirectStep()` with no
   argument must yield the spec defaults.

Also, `RedirectCondition` and `RedirectPredicate` are defined in `settings.ts` (Task 4) rather than `decide.ts`
(Task 5) as the design doc's prose groups them — purely so `settings.ts`'s `RedirectSettings.predicate` field can
reference `RedirectPredicate` without a forward reference to a file that doesn't exist until the next task.
`decide.ts` imports both from `./settings.js` and defines only its own `Decision` return type locally.

---

## File Structure

```
packages/core/src/redirect/
  errors.ts                # NonReplayableBodyError, SchemeDowngradeError                    (Task 1)
  codes.ts                 # REDIR-1..7  status/method eligibility                            (Task 2)
  cross-origin.ts          # REDIR-11    origin comparison + credential-suppression marker    (Task 3)
  settings.ts               # RedirectSettings + RedirectCondition/RedirectPredicate + validation (Task 4)
  decide.ts                 # the pure per-hop decision function                              (Task 5)
  redirect-step.ts          # pillar adapter, stage 'REDIRECT', closes PIPE-40                 (Task 6)
  strip-marker-step.ts      # POST_AUTH guard + withRedirect() bundling helper                 (Task 7)
```

Every file has a colocated `*.test.ts`. Seven production files, each one responsibility, none over ~120 lines.

---

### Task 1: `errors.ts` — the two operational failure leaves

**Files:**
- Create: `packages/core/src/redirect/errors.ts`
- Test: `packages/core/src/redirect/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` from `../http/errors.js`.
- Produces: `class NonReplayableBodyError extends DexpaceError`; `class SchemeDowngradeError extends
  DexpaceError`. Task 5 (`decide.ts`) throws both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/errors.test.ts
import {describe, expect, test} from 'bun:test';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';

describe('NonReplayableBodyError', () => {
  test('names the target URL and mentions replayability', () => {
    const error = new NonReplayableBodyError('https://example.com/next');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NonReplayableBodyError');
    expect(error.message).toContain('https://example.com/next');
    expect(error.message.toLowerCase()).toContain('replayable');
  });
});

describe('SchemeDowngradeError', () => {
  test('names both the current and target URLs', () => {
    const error = new SchemeDowngradeError('https://example.com/a', 'http://example.com/b');
    expect(error.name).toBe('SchemeDowngradeError');
    expect(error.message).toContain('https://example.com/a');
    expect(error.message).toContain('http://example.com/b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/errors.ts
import {DexpaceError} from '../http/errors.js';

/** REDIR-*: the redirect wants to re-send a body that cannot be replayed. */
export class NonReplayableBodyError extends DexpaceError {
  constructor(targetUrl: string) {
    super(`cannot follow redirect to '${targetUrl}': request body is not replayable`);
  }
}

/** REDIR-*: an HTTPS-to-HTTP hop, rejected unless RedirectSettings.allowSchemeDowngrade is set. */
export class SchemeDowngradeError extends DexpaceError {
  constructor(fromUrl: string, toUrl: string) {
    super(`redirect from '${fromUrl}' to '${toUrl}' would downgrade HTTPS to HTTP`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/errors.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/redirect/errors.ts packages/core/src/redirect/errors.test.ts
git commit -m "feat(core): redirect error leaves -- non-replayable body, scheme downgrade"
```

---

### Task 2: `codes.ts` — recognized codes and eligibility

**Files:**
- Create: `packages/core/src/redirect/codes.ts`
- Test: `packages/core/src/redirect/codes.test.ts`

**Interfaces:**
- Consumes: `Method` from `../http/method.js`.
- Produces: `REDIRECT_STATUSES: ReadonlySet<number>`; `DEFAULT_ALLOWED_METHODS: ReadonlySet<Method>`;
  `isRecognizedRedirect(status: number): boolean`; `interface CodeEligibility {allowedMethods, allow303}`;
  `isEligibleByCode(status: number, method: Method, eligibility: CodeEligibility): boolean`. Task 4 imports
  `DEFAULT_ALLOWED_METHODS`; Task 5 imports `isRecognizedRedirect` and `isEligibleByCode`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/codes.test.ts
// Exercises: REDIR-1 (recognized set is exactly {301,302,303,307,308}; 300/304/305 never auto-followed),
// REDIR-2/3 (301/302/307/308 gated on method membership, default {GET,HEAD}), REDIR-4 (303 gated only on
// allow303, independent of method), any non-3xx/non-recognized-3xx status is not "recognized".
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {DEFAULT_ALLOWED_METHODS, REDIRECT_STATUSES, isEligibleByCode, isRecognizedRedirect} from './codes.js';

describe('isRecognizedRedirect', () => {
  test('301, 302, 303, 307, 308 are recognized', () => {
    for (const code of [301, 302, 303, 307, 308]) expect(isRecognizedRedirect(code)).toBe(true);
  });

  test('300, 304, 305 are never recognized (REDIR-1)', () => {
    for (const code of [300, 304, 305]) expect(isRecognizedRedirect(code)).toBe(false);
  });

  test('non-3xx statuses are not recognized', () => {
    for (const code of [200, 404, 500]) expect(isRecognizedRedirect(code)).toBe(false);
  });

  test('the exported set and the predicate are the same source', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 599}), (code) => {
        expect(isRecognizedRedirect(code)).toBe(REDIRECT_STATUSES.has(code));
      }),
    );
  });
});

describe('isEligibleByCode', () => {
  const eligibility = {allowedMethods: DEFAULT_ALLOWED_METHODS, allow303: false};

  test('301/302/307/308 are eligible for GET/HEAD, the default allowed set', () => {
    for (const status of [301, 302, 307, 308]) {
      expect(isEligibleByCode(status, 'GET', eligibility)).toBe(true);
      expect(isEligibleByCode(status, 'HEAD', eligibility)).toBe(true);
    }
  });

  test('301/302/307/308 are NOT eligible for a method outside the allowed set (REDIR-2)', () => {
    for (const status of [301, 302, 307, 308]) {
      expect(isEligibleByCode(status, 'POST', eligibility)).toBe(false);
    }
  });

  test('a caller-widened allowed set makes POST eligible', () => {
    const widened = {allowedMethods: new Set(['GET', 'HEAD', 'POST'] as const), allow303: false};
    expect(isEligibleByCode(301, 'POST', widened)).toBe(true);
  });

  test('303 is never eligible by default, regardless of method (REDIR-4)', () => {
    expect(isEligibleByCode(303, 'GET', eligibility)).toBe(false);
    expect(isEligibleByCode(303, 'POST', eligibility)).toBe(false);
  });

  test('303 is eligible once opted in, regardless of method', () => {
    const opted = {allowedMethods: DEFAULT_ALLOWED_METHODS, allow303: true};
    expect(isEligibleByCode(303, 'DELETE', opted)).toBe(true);
  });

  test('303 ignores the allowed-methods set entirely', () => {
    const empty = {allowedMethods: new Set<'GET'>(), allow303: true};
    expect(isEligibleByCode(303, 'POST', empty)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/codes.test.ts`
Expected: FAIL — `Cannot find module './codes.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/codes.ts
import type {Method} from '../http/method.js';

/** REDIR-1: 300/304/305 are deliberately excluded -- 305 in particular must never redirect to a
 *  server-chosen proxy. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export const DEFAULT_ALLOWED_METHODS: ReadonlySet<Method> = new Set(['GET', 'HEAD']);

export function isRecognizedRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

export interface CodeEligibility {
  readonly allowedMethods: ReadonlySet<Method>;
  readonly allow303: boolean;
}

/**
 * REDIR-2/3/4: 301/302/307/308 are eligible only when the method is in `allowedMethods` -- method and
 * body are preserved when followed, deliberately no automatic POST-to-GET rewrite. 303 is eligible only
 * when opted in via `allow303`, independent of method -- when followed it is always re-issued as GET with
 * the body dropped (decide.ts's job, not this predicate's).
 */
export function isEligibleByCode(status: number, method: Method, eligibility: CodeEligibility): boolean {
  if (status === 303) return eligibility.allow303;
  return eligibility.allowedMethods.has(method);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/codes.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/redirect/codes.ts packages/core/src/redirect/codes.test.ts
git commit -m "feat(core): redirect status/method eligibility (REDIR-1..4)"
```

---

### Task 3: `cross-origin.ts` — origin comparison and the credential-suppression marker

**Files:**
- Create: `packages/core/src/redirect/cross-origin.ts`
- Test: `packages/core/src/redirect/cross-origin.test.ts`

**Interfaces:**
- Consumes: `Headers` from `../http/headers.js`.
- Produces: `interface Origin {scheme, host, port}`; `originOf(url: URL): Origin`; `isCrossOrigin(seedOrigin:
  Origin, target: URL): boolean`; `CROSS_ORIGIN_MARKER_HEADER: string`; `withCrossOriginMarker(headers: Headers):
  Headers`; `clearCrossOriginMarker(headers: Headers): Headers`; `hasCrossOriginMarker(headers: Headers):
  boolean`. Task 5 imports `originOf`/`isCrossOrigin`/`withCrossOriginMarker`/`clearCrossOriginMarker`; Task 7
  imports `clearCrossOriginMarker`; Phase 5c imports `hasCrossOriginMarker`/`clearCrossOriginMarker` unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/cross-origin.test.ts
// Exercises: REDIR-11 (scheme/host(case-insensitive)/effective-port-only comparison against a fixed seed,
// never the previous hop; the marker header is cleared-then-conditionally-set, never forgeable via an
// inbound copy).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers} from '../http/headers.js';
import {
  CROSS_ORIGIN_MARKER_HEADER,
  clearCrossOriginMarker,
  hasCrossOriginMarker,
  isCrossOrigin,
  originOf,
  withCrossOriginMarker,
} from './cross-origin.js';

describe('originOf / isCrossOrigin', () => {
  const seed = originOf(new URL('https://example.com/a'));

  test('identical scheme/host/port is same-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com/b?x=1#y'))).toBe(false);
  });

  test('a differing path/query/fragment alone is never cross-origin', () => {
    fc.assert(
      fc.property(fc.webPath(), fc.string(), (path, fragment) => {
        const target = new URL(`https://example.com${path}`);
        target.hash = fragment.replaceAll(/[^\w-]/gu, '');
        expect(isCrossOrigin(seed, target)).toBe(false);
      }),
    );
  });

  test('host comparison is case-insensitive', () => {
    expect(isCrossOrigin(seed, new URL('https://EXAMPLE.com/b'))).toBe(false);
  });

  test('a differing host is cross-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://evil.example/b'))).toBe(true);
  });

  test('a differing scheme is cross-origin even on the same host', () => {
    expect(isCrossOrigin(seed, new URL('http://example.com/b'))).toBe(true);
  });

  test('an explicit default port equals an omitted one', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com:443/b'))).toBe(false);
  });

  test('a non-default port is cross-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com:8443/b'))).toBe(true);
  });

  test('comparison is against the SEED, not a previous hop', () => {
    // simulates: seed(example.com) -> hop1(other.example, cross-origin) -> hop2(example.com again)
    const hop2Target = new URL('https://example.com/final');
    expect(isCrossOrigin(seed, hop2Target)).toBe(false); // back to seed's own origin: same-origin
  });
});

describe('the cross-origin marker', () => {
  test('withCrossOriginMarker sets the header to 1', () => {
    const headers = withCrossOriginMarker(Headers.newBuilder().build());
    expect(hasCrossOriginMarker(headers)).toBe(true);
    expect(headers.get(CROSS_ORIGIN_MARKER_HEADER)).toBe('1');
  });

  test('withCrossOriginMarker clears a forged inbound copy before setting its own', () => {
    const forged = Headers.newBuilder().add(CROSS_ORIGIN_MARKER_HEADER, 'anything').build();
    const marked = withCrossOriginMarker(forged);
    expect(marked.getAll(CROSS_ORIGIN_MARKER_HEADER)).toEqual(['1']);
  });

  test('clearCrossOriginMarker removes it', () => {
    const marked = withCrossOriginMarker(Headers.newBuilder().build());
    expect(hasCrossOriginMarker(clearCrossOriginMarker(marked))).toBe(false);
  });

  test('clearCrossOriginMarker is idempotent when already absent', () => {
    const bare = Headers.newBuilder().build();
    expect(hasCrossOriginMarker(clearCrossOriginMarker(bare))).toBe(false);
  });

  test('hasCrossOriginMarker is false when never set', () => {
    expect(hasCrossOriginMarker(Headers.newBuilder().build())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/cross-origin.test.ts`
Expected: FAIL — `Cannot find module './cross-origin.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/cross-origin.ts
import type {Headers} from '../http/headers.js';

export interface Origin {
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
}

const DEFAULT_PORT_BY_SCHEME: ReadonlyMap<string, number> = new Map([
  ['http:', 80],
  ['https:', 443],
]);

function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return DEFAULT_PORT_BY_SCHEME.get(url.protocol.toLowerCase()) ?? 0;
}

export function originOf(url: URL): Origin {
  return {scheme: url.protocol.toLowerCase(), host: url.hostname.toLowerCase(), port: effectivePort(url)};
}

/**
 * REDIR-11: scheme/host(case-insensitive)/effective-port comparison against the SEED request's origin --
 * never the previous hop -- so a same-origin sub-redirect on a foreign host cannot re-expose the credential
 * a cross-origin hop already stripped. `new URL(...).origin` never performs DNS resolution, unlike
 * `java.net.URL.equals()`'s hostname-resolution trap the JVM reference has to work around.
 */
export function isCrossOrigin(seedOrigin: Origin, target: URL): boolean {
  const targetOrigin = originOf(target);
  return (
    targetOrigin.scheme !== seedOrigin.scheme ||
    targetOrigin.host !== seedOrigin.host ||
    targetOrigin.port !== seedOrigin.port
  );
}

/**
 * REDIR-11/AUTH-29: a real header, not an in-process marker -- a redirect re-issue always builds a fresh
 * `Request`, and so does 5a's optional attempt-stamping if it sits between redirect and auth; a header
 * survives that intermediate copy because stamping explicitly preserves headers, while an identity-keyed
 * signal (e.g. a `WeakSet<Request>`) would not.
 */
export const CROSS_ORIGIN_MARKER_HEADER = 'x-dexpace-internal-redirect-cross-origin';

/** `HeadersBuilder.set` with a non-null value already replaces any existing entry -- clear-then-set in one call. */
export function withCrossOriginMarker(headers: Headers): Headers {
  return headers.newBuilder().set(CROSS_ORIGIN_MARKER_HEADER, '1').build();
}

/** Idempotent -- clearing an already-absent header is a no-op. */
export function clearCrossOriginMarker(headers: Headers): Headers {
  return headers.newBuilder().set(CROSS_ORIGIN_MARKER_HEADER, null).build();
}

export function hasCrossOriginMarker(headers: Headers): boolean {
  return headers.has(CROSS_ORIGIN_MARKER_HEADER);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/cross-origin.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/redirect/cross-origin.ts packages/core/src/redirect/cross-origin.test.ts
git commit -m "feat(core): seed-relative cross-origin comparison and the credential-suppression marker (REDIR-11)"
```

---

### Task 4: `settings.ts` — validated policy, the condition/predicate types

**Files:**
- Create: `packages/core/src/redirect/settings.ts`
- Test: `packages/core/src/redirect/settings.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `Method` from `../http/method.js`; `Response` from
  `../http/response.js`; `DEFAULT_ALLOWED_METHODS` from `./codes.js`.
- Produces: `interface RedirectCondition {response, redirectsFollowed, visited}`; `type RedirectPredicate =
  (condition: Readonly<RedirectCondition>) => boolean`; `interface RedirectSettings {maxHops, allowedMethods,
  allow303, allowSchemeDowngrade, locationHeader, predicate?}`; `DEFAULT_REDIRECT_SETTINGS: RedirectSettings`;
  `redirectSettings(overrides?: Partial<RedirectSettings>): RedirectSettings`. Task 5 consumes all of it; Tasks 6
  and 7 consume `RedirectSettings`/`redirectSettings`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/settings.test.ts
// Exercises: defaults (maxHops 3, allowedMethods {GET,HEAD}, allow303 false, allowSchemeDowngrade false,
// locationHeader 'Location'), construction validation, immutability, maxHops: 0 accepted as an ordinary value
// (no special branch -- decide.ts's hop-cap gate is what makes it behave as "disabled").
import {describe, expect, test} from 'bun:test';
import {DEFAULT_ALLOWED_METHODS} from './codes.js';
import {DEFAULT_REDIRECT_SETTINGS, redirectSettings} from './settings.js';

describe('defaults', () => {
  test('ship the spec defaults', () => {
    expect(DEFAULT_REDIRECT_SETTINGS.maxHops).toBe(3);
    expect(DEFAULT_REDIRECT_SETTINGS.allow303).toBe(false);
    expect(DEFAULT_REDIRECT_SETTINGS.allowSchemeDowngrade).toBe(false);
    expect(DEFAULT_REDIRECT_SETTINGS.locationHeader).toBe('Location');
    expect([...DEFAULT_REDIRECT_SETTINGS.allowedMethods].sort()).toEqual([...DEFAULT_ALLOWED_METHODS].sort());
  });

  test('no predicate by default', () => {
    expect(DEFAULT_REDIRECT_SETTINGS.predicate).toBeUndefined();
  });
});

describe('validation', () => {
  test('rejects a negative maxHops', () => {
    expect(() => redirectSettings({maxHops: -1})).toThrow();
  });

  test('accepts maxHops of 0 as an ordinary value, not a special case', () => {
    expect(redirectSettings({maxHops: 0}).maxHops).toBe(0);
  });

  test('rejects a non-finite maxHops', () => {
    expect(() => redirectSettings({maxHops: Number.NaN})).toThrow();
    expect(() => redirectSettings({maxHops: Number.POSITIVE_INFINITY})).toThrow();
  });

  test('rejects a blank locationHeader', () => {
    expect(() => redirectSettings({locationHeader: ''})).toThrow();
  });

  test('accepts a caller-supplied predicate', () => {
    const predicate = () => true;
    expect(redirectSettings({predicate}).predicate).toBe(predicate);
  });
});

describe('immutability', () => {
  test('the allowed-methods set is defensively copied', () => {
    const caller = new Set(['GET'] as const);
    const settings = redirectSettings({allowedMethods: caller});
    caller.add('POST');
    expect(settings.allowedMethods.has('POST')).toBe(false);
  });

  test('the returned settings object is frozen', () => {
    expect(Object.isFrozen(redirectSettings())).toBe(true);
  });

  test('DEFAULT_REDIRECT_SETTINGS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_REDIRECT_SETTINGS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/settings.test.ts`
Expected: FAIL — `Cannot find module './settings.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/settings.ts
import type {Method} from '../http/method.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import {DEFAULT_ALLOWED_METHODS} from './codes.js';

/** The snapshot a configured predicate is offered (REDIR-*): allocated for every recognized 3xx, even one
 *  with no usable Location. */
export interface RedirectCondition {
  readonly response: Response;
  readonly redirectsFollowed: number;
  readonly visited: ReadonlySet<string>;
}

/** MUST fully override the built-in code/method eligibility decision -- see decide.ts's own note on scope. */
export type RedirectPredicate = (condition: Readonly<RedirectCondition>) => boolean;

export interface RedirectSettings {
  readonly maxHops: number;
  readonly allowedMethods: ReadonlySet<Method>;
  readonly allow303: boolean;
  readonly allowSchemeDowngrade: boolean;
  readonly locationHeader: string;
  readonly predicate?: RedirectPredicate | undefined;
}

export const DEFAULT_REDIRECT_SETTINGS: RedirectSettings = Object.freeze({
  maxHops: 3,
  allowedMethods: DEFAULT_ALLOWED_METHODS,
  allow303: false,
  allowSchemeDowngrade: false,
  locationHeader: 'Location',
});

/**
 * Builds validated, frozen redirect settings. Invalid values are PROGRAMMER errors, same split 5a's
 * `retrySettings()` applied -- `invariant()`, not a new error leaf.
 *
 * `maxHops: 0` needs no special branch here or anywhere downstream: decide.ts's hop-cap gate applies
 * uniformly to every value, and a 0-hop budget simply fails it on the first follow attempt.
 *
 * `Object.freeze` is SHALLOW (`docs/knowledge/data-modeling.md`), and it does not disarm `Set.prototype.add`
 * at all -- so the `allowedMethods` guarantee `REDIR-26` actually asks for is the defensive COPY below
 * (mutating the caller's collection afterwards cannot change policy), not a frozen set. The `ReadonlySet`
 * type is what keeps SDK-internal code from writing to it. Do not try to "fix" this with a frozen `Set`.
 */
export function redirectSettings(overrides?: Partial<RedirectSettings>): RedirectSettings {
  const merged = {...DEFAULT_REDIRECT_SETTINGS, ...overrides};
  invariant(
    Number.isFinite(merged.maxHops) && merged.maxHops >= 0,
    `redirect maxHops must be a finite number >= 0, got ${merged.maxHops}`,
  );
  invariant(merged.locationHeader.trim().length > 0, 'redirect locationHeader must not be blank');
  return Object.freeze({...merged, allowedMethods: new Set(merged.allowedMethods)});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/settings.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/redirect/settings.ts packages/core/src/redirect/settings.test.ts
git commit -m "feat(core): validated, frozen redirect settings"
```

---

### Task 5: `decide.ts` — the pure per-hop decision

The largest single function in this phase. Read "Plan-time signature decisions" above before starting —
`decide()` takes a bundled `context` object, not five positional arguments.

**Files:**
- Create: `packages/core/src/redirect/decide.ts`
- Test: `packages/core/src/redirect/decide.test.ts`

**Interfaces:**
- Consumes: `Method` from `../http/method.js`; `Request` from `../http/request.js`; `Response` from
  `../http/response.js`; `Headers` from `../http/headers.js`; `isEligibleByCode`, `isRecognizedRedirect` from
  `./codes.js`; `Origin`, `isCrossOrigin`, `withCrossOriginMarker`, `clearCrossOriginMarker` from
  `./cross-origin.js`; `NonReplayableBodyError`, `SchemeDowngradeError` from `./errors.js`; `RedirectCondition`,
  `RedirectSettings` from `./settings.js`.
- Produces: `interface RedirectContext {currentRequest, seedOrigin, visited, redirectsFollowed}`; `type Decision
  = {kind:'follow', nextRequest, crossOrigin} | {kind:'return-current'} | {kind:'fail', error}`;
  `decide(response: Response, context: RedirectContext, settings: RedirectSettings): Decision`. Task 6 consumes
  `RedirectContext` and `decide`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/decide.test.ts
// Exercises every numbered step of decide()'s contract: fast path (non-3xx), snapshot/predicate consultation
// (even with no usable Location), Location resolution (relative/absolute/malformed/userinfo-stripping,
// no re-encoding), loop detection, hop cap (incl. maxHops: 0), scheme-downgrade guard, header construction
// (Authorization always stripped, Cookie/Proxy-Authorization stripped only cross-origin, marker
// cleared-then-conditionally-set, Content-* stripped + method forced to GET only for 303), body-replayability
// gating (303 exempt).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Protocol} from '../http/protocol.js';
import {Status} from '../http/status.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import {originOf} from './cross-origin.js';
import {decide, type RedirectContext} from './decide.js';
import {redirectSettings} from './settings.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';

interface RequestOpts {
  readonly method?: 'GET' | 'POST';
  readonly url?: string;
  readonly headers?: Headers;
  readonly body?: ReturnType<typeof stringBody>;
}

function aRequest(opts: RequestOpts = {}): Request {
  const builder = Request.newBuilder()
    .method(opts.method ?? 'GET')
    .url(opts.url ?? 'https://example.com/a')
    .headers(opts.headers ?? Headers.newBuilder().build());
  return opts.body === undefined ? builder.build() : builder.body(opts.body).build();
}

// `setInbound`, not `set`: these are RESPONSE headers, and the outbound-strict `set` rejects every non-ASCII
// byte -- which would make the totality property test below throw inside its own fixture (HTTP-19).
function aResponse(status: number, location?: string, extraHeaders?: Headers): Response {
  let headers = extraHeaders ?? Headers.newBuilder().build();
  if (location !== undefined) headers = headers.newBuilder().setInbound('Location', location).build();
  return Response.newBuilder()
    .request(aRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(headers)
    .body(null)
    .build();
}

function contextFor(request: Request, overrides?: Partial<RedirectContext>): RedirectContext {
  return {
    currentRequest: request,
    seedOrigin: originOf(request.url),
    visited: new Set([request.url.href]),
    redirectsFollowed: 0,
    ...overrides,
  };
}

describe('fast path', () => {
  test('a non-3xx status returns-current without consulting anything', () => {
    const decision = decide(aResponse(200), contextFor(aRequest()), redirectSettings());
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('300/304/305 are never followed even with a Location header', () => {
    for (const status of [300, 304, 305]) {
      const decision = decide(
        aResponse(status, 'https://example.com/b'),
        contextFor(aRequest()),
        redirectSettings(),
      );
      expect(decision).toEqual({kind: 'return-current'});
    }
  });
});

describe('predicate override', () => {
  test('a configured predicate REPLACES code/method eligibility', () => {
    const settings = redirectSettings({predicate: () => true});
    const decision = decide(aResponse(301, 'https://example.com/b'), contextFor(aRequest({method: 'POST'})), settings);
    expect(decision.kind).toBe('follow');
  });

  test('a predicate is consulted even with no usable Location', () => {
    let observed = false;
    const settings = redirectSettings({
      predicate: (condition) => {
        observed = true;
        expect(condition.redirectsFollowed).toBe(0);
        return true;
      },
    });
    const decision = decide(aResponse(301), contextFor(aRequest()), settings);
    expect(observed).toBe(true);
    expect(decision).toEqual({kind: 'return-current'}); // still no Location to follow to
  });

  test('a predicate saying no wins over an otherwise-eligible code/method', () => {
    const settings = redirectSettings({predicate: () => false});
    const decision = decide(aResponse(301, 'https://example.com/b'), contextFor(aRequest({method: 'GET'})), settings);
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('the condition snapshot is a defensive COPY -- a predicate cannot poison loop detection', () => {
    const live = new Set(['https://example.com/a']);
    const settings = redirectSettings({
      predicate: (condition) => {
        // A predicate that casts the readonly type away and tries to pre-seed the visited set.
        (condition.visited as Set<string>).add('https://example.com/b');
        return true;
      },
    });
    const context = contextFor(aRequest(), {visited: live});
    const decision = decide(aResponse(302, 'https://example.com/b'), context, settings);

    expect(decision.kind).toBe('follow'); // the injected entry did NOT reach the live set, so /b is unvisited
    expect(live.has('https://example.com/b')).toBe(false);
  });
});

describe('Location resolution', () => {
  test('a relative Location resolves against the current request URL', () => {
    const decision = decide(aResponse(302, '/next'), contextFor(aRequest({url: 'https://example.com/a/b'})), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.url.href).toBe('https://example.com/next');
  });

  test('an absolute Location is used as-is', () => {
    const decision = decide(aResponse(302, 'https://other.example/x'), contextFor(aRequest()), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.url.href).toBe('https://other.example/x');
  });

  test('userinfo embedded in the Location is dropped unconditionally', () => {
    const decision = decide(aResponse(302, 'https://user:pass@other.example/x'), contextFor(aRequest()), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.username).toBe('');
      expect(decision.nextRequest.url.password).toBe('');
    }
  });

  test('an already-encoded path/query is never re-encoded', () => {
    const decision = decide(
      aResponse(302, 'https://example.com/a%2Fb?q=x%26y'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.pathname).toBe('/a%2Fb');
      expect(decision.nextRequest.url.search).toBe('?q=x%26y');
    }
  });

  test('a missing Location returns-current', () => {
    expect(decide(aResponse(302), contextFor(aRequest()), redirectSettings())).toEqual({kind: 'return-current'});
  });

  test('an unparseable absolute Location returns-current rather than throwing', () => {
    // A malformed ABSOLUTE form is the narrow case `new URL(raw, base)` actually throws on.
    expect(decide(aResponse(302, 'http://['), contextFor(aRequest()), redirectSettings())).toEqual({
      kind: 'return-current',
    });
  });

  test('an unsupported scheme is returned unfollowed, never dispatched', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'mailto:a@b.c']) {
      expect(decide(aResponse(302, raw), contextFor(aRequest()), redirectSettings())).toEqual({
        kind: 'return-current',
      });
    }
  });

  test('garbage that parses as a RELATIVE reference is followed, percent-encoded -- not treated as malformed', () => {
    // Documents WHATWG `URL` behavior deliberately: with a base supplied, a non-URL string is a relative
    // reference, not a parse failure. The server said to go there, so we go there.
    const decision = decide(aResponse(302, ' not a url'), contextFor(aRequest()), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.url.href).toBe('https://example.com/not%20a%20url');
  });

  test('property: decide() never throws for arbitrary garbage in Location', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        // Strip only what the LENIENT inbound header validator rejects: C0 controls except HTAB, plus DEL.
        // obs-text (>= 0x80) is legal on an inbound value and must reach decide() unfiltered.
        const sanitized = raw.replaceAll(/[\u0000-\u0008\u000A-\u001F\u007F]/gu, '');
        expect(() =>
          decide(aResponse(302, sanitized), contextFor(aRequest()), redirectSettings()),
        ).not.toThrow();
      }),
    );
  });
});

describe('loop detection', () => {
  test('a Location matching an already-visited URI returns-current', () => {
    const context = contextFor(aRequest({url: 'https://example.com/a'}), {
      visited: new Set(['https://example.com/a', 'https://example.com/b']),
    });
    expect(decide(aResponse(302, 'https://example.com/b'), context, redirectSettings())).toEqual({
      kind: 'return-current',
    });
  });
});

describe('hop cap', () => {
  test('following would exceed maxHops -> return-current', () => {
    const context = contextFor(aRequest(), {redirectsFollowed: 3});
    const decision = decide(aResponse(302, 'https://example.com/b'), context, redirectSettings({maxHops: 3}));
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('maxHops: 0 fails on the very first follow attempt', () => {
    const decision = decide(aResponse(302, 'https://example.com/b'), contextFor(aRequest()), redirectSettings({maxHops: 0}));
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('property: loop/hop-cap bounds every synthetic chain regardless of length', () => {
    fc.assert(
      fc.property(fc.integer({min: 0, max: 50}), fc.integer({min: 1, max: 10}), (followed, maxHops) => {
        const context = contextFor(aRequest(), {redirectsFollowed: followed});
        const decision = decide(
          aResponse(302, 'https://example.com/never-visited-before'),
          context,
          redirectSettings({maxHops}),
        );
        if (followed + 1 > maxHops) expect(decision).toEqual({kind: 'return-current'});
      }),
    );
  });
});

describe('scheme-downgrade guard', () => {
  test('HTTPS to HTTP is rejected by default', () => {
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('fail');
    if (decision.kind === 'fail') expect(decision.error).toBeInstanceOf(SchemeDowngradeError);
  });

  test('HTTPS to HTTP is permitted when allowSchemeDowngrade is set', () => {
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a'})),
      redirectSettings({allowSchemeDowngrade: true}),
    );
    expect(decision.kind).toBe('follow');
  });

  test('HTTP to HTTPS is never a downgrade', () => {
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(aRequest({url: 'http://example.com/a'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
  });

  test('the guard is keyed to the CURRENT hop scheme, not the seed', () => {
    // seed is http, current hop is already https (a prior upgrade) -- a further downgrade off THIS hop must
    // still be caught even though the seed itself was http.
    const context: RedirectContext = {
      currentRequest: aRequest({url: 'https://example.com/mid'}),
      seedOrigin: originOf(new URL('http://example.com/a')),
      visited: new Set(['http://example.com/a', 'https://example.com/mid']),
      redirectsFollowed: 1,
    };
    const decision = decide(aResponse(302, 'http://example.com/b'), context, redirectSettings());
    expect(decision.kind).toBe('fail');
  });
});

describe('body replayability gate', () => {
  test('a method-preserving redirect with a non-replayable body fails', () => {
    const oneShot = streamBody(new ReadableStream<Uint8Array>({start: (c) => c.close()}), null, 0);
    const request = Request.newBuilder().method('POST').url('https://example.com/a').body(oneShot).build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allowedMethods: new Set(['GET', 'HEAD', 'POST'])}),
    );
    expect(decision.kind).toBe('fail');
    if (decision.kind === 'fail') expect(decision.error).toBeInstanceOf(NonReplayableBodyError);
  });

  test('a method-preserving redirect with a replayable body follows, body preserved', () => {
    const request = Request.newBuilder().method('POST').url('https://example.com/a').body(stringBody('x')).build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allowedMethods: new Set(['GET', 'HEAD', 'POST'])}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.body).toBeDefined();
  });

  test('303 is exempt from the replayability gate -- its body is dropped, not checked', () => {
    const oneShot = streamBody(new ReadableStream<Uint8Array>({start: (c) => c.close()}), null, 0);
    const request = Request.newBuilder().method('POST').url('https://example.com/a').body(oneShot).build();
    const decision = decide(
      aResponse(303, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allow303: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.body).toBeUndefined();
  });
});

describe('header construction', () => {
  test('Authorization is stripped unconditionally, even same-origin', () => {
    const headers = Headers.newBuilder().add('Authorization', 'Bearer x').build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(aResponse(302, 'https://example.com/b'), contextFor(request), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.headers.get('Authorization')).toBeUndefined();
  });

  test('Cookie and Proxy-Authorization survive a same-origin hop', () => {
    const headers = Headers.newBuilder().add('Cookie', 'a=b').add('Proxy-Authorization', 'y').build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(aResponse(302, 'https://example.com/b'), contextFor(request), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Cookie')).toBe('a=b');
      expect(decision.nextRequest.headers.get('Proxy-Authorization')).toBe('y');
    }
  });

  test('Cookie and Proxy-Authorization are stripped on a cross-origin hop', () => {
    const headers = Headers.newBuilder().add('Cookie', 'a=b').add('Proxy-Authorization', 'y').build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(aResponse(302, 'https://evil.example/b'), contextFor(request), redirectSettings());
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Cookie')).toBeUndefined();
      expect(decision.nextRequest.headers.get('Proxy-Authorization')).toBeUndefined();
    }
  });

  test('the cross-origin marker is set only on a cross-origin follow', () => {
    const sameOrigin = decide(aResponse(302, 'https://example.com/b'), contextFor(aRequest()), redirectSettings());
    const crossOrigin = decide(aResponse(302, 'https://evil.example/b'), contextFor(aRequest()), redirectSettings());
    expect(sameOrigin.kind === 'follow' && sameOrigin.crossOrigin).toBe(false);
    expect(crossOrigin.kind === 'follow' && crossOrigin.crossOrigin).toBe(true);
  });

  test('a 303 rebuild strips every Content-* header case-insensitively and forces GET', () => {
    const headers = Headers.newBuilder()
      .add('content-type', 'application/json')
      .add('Content-Length', '3')
      .add('X-Other', 'kept')
      .build();
    const request = aRequest({method: 'POST', url: 'https://example.com/a', headers});
    const decision = decide(
      aResponse(303, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allow303: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.method).toBe('GET');
      expect(decision.nextRequest.headers.get('Content-Type')).toBeUndefined();
      expect(decision.nextRequest.headers.get('Content-Length')).toBeUndefined();
      expect(decision.nextRequest.headers.get('X-Other')).toBe('kept');
    }
  });

  test('a 301/302/307/308 follow preserves the original method', () => {
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(
        aRequest({method: 'POST', url: 'https://example.com/a', headers: Headers.newBuilder().build(), body: stringBody('x')}),
      ),
      redirectSettings({allowedMethods: new Set(['GET', 'HEAD', 'POST'])}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') expect(decision.nextRequest.method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/decide.test.ts`
Expected: FAIL — `Cannot find module './decide.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/decide.ts
import type {Headers} from '../http/headers.js';
import type {Method} from '../http/method.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {isEligibleByCode, isRecognizedRedirect} from './codes.js';
import {clearCrossOriginMarker, isCrossOrigin, withCrossOriginMarker, type Origin} from './cross-origin.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';
import type {RedirectCondition, RedirectSettings} from './settings.js';

export interface RedirectContext {
  readonly currentRequest: Request;
  readonly seedOrigin: Origin;
  readonly visited: ReadonlySet<string>;
  readonly redirectsFollowed: number;
}

export type Decision =
  | {readonly kind: 'follow'; readonly nextRequest: Request; readonly crossOrigin: boolean}
  | {readonly kind: 'return-current'}
  | {readonly kind: 'fail'; readonly error: Error};

const RETURN_CURRENT: Decision = {kind: 'return-current'};

/** The only schemes this SDK will re-issue a request against. Anything else -- `javascript:`, `data:`,
 *  `file:`, `mailto:` -- is an "unsupported scheme" the spec requires be returned unfollowed, NOT dispatched. */
const FOLLOWABLE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Resolves relative-or-absolute per RFC 3986 via WHATWG `URL`; never re-encodes; strips userinfo. Total.
 *
 * Two things WHATWG `URL` does NOT do for us, both handled explicitly here:
 *
 * 1. **It almost never throws when a base is supplied.** `new URL(' not a url', 'https://example.com/a')`
 *    does not fail -- it resolves to `https://example.com/not%20a%20url`, percent-encoding the spaces, because
 *    any string that is not a valid absolute URL is treated as a relative reference. So the `catch` below is a
 *    genuine but NARROW path (a malformed absolute form such as `http://[` still throws); it is not the
 *    general "garbage in the Location header" guard it might look like. Garbage that parses as a relative
 *    reference is followed, which is correct per RFC 3986 -- the server said so.
 * 2. **It happily parses schemes we must never dispatch against.** `new URL('javascript:alert(1)', base)`
 *    succeeds, and the scheme-downgrade guard would wave it through (the target is not `http:`). The
 *    `FOLLOWABLE_SCHEMES` check is what makes "an unsupported scheme is returned unfollowed" true.
 */
function resolveLocation(raw: string | undefined, base: URL): URL | null {
  if (raw === undefined || raw.trim() === '') return null;
  try {
    const resolved = new URL(raw, base);
    if (!FOLLOWABLE_SCHEMES.has(resolved.protocol.toLowerCase())) return null;
    resolved.username = '';
    resolved.password = '';
    return resolved;
  } catch {
    return null;
  }
}

function stripContentHeaders(headers: Headers): Headers {
  let builder = headers.newBuilder();
  for (const name of headers.names()) {
    if (name.toLowerCase().startsWith('content-')) builder = builder.set(name, null);
  }
  return builder.build();
}

/** Authorization always stripped; Cookie/Proxy-Authorization stripped only cross-origin; marker
 *  cleared-then-conditionally-set, so a forged/stale inbound copy can never survive a hop that shouldn't carry it. */
function nextHopHeaders(headers: Headers, crossOrigin: boolean): Headers {
  let builder = headers.newBuilder().set('Authorization', null);
  if (crossOrigin) builder = builder.set('Cookie', null).set('Proxy-Authorization', null);
  const cleared = clearCrossOriginMarker(builder.build());
  return crossOrigin ? withCrossOriginMarker(cleared) : cleared;
}

interface FollowPlan {
  readonly target: URL;
  readonly status: number;
  readonly crossOrigin: boolean;
}

function buildFollowRequest(current: Request, plan: FollowPlan): Request {
  const {target, status, crossOrigin} = plan;
  const is303 = status === 303;
  const method: Method = is303 ? 'GET' : current.method;
  let headers = nextHopHeaders(current.headers, crossOrigin);
  if (is303) headers = stripContentHeaders(headers);
  const builder = current.newBuilder().url(target).method(method).headers(headers);
  return is303 ? builder.body(undefined).build() : builder.build();
}

/**
 * The per-hop redirect decision (REDIR-*). Pure -- no I/O, no header-mutation side effects beyond the
 * returned `nextRequest` value.
 *
 * Step order: (1) fast path for a non-recognized status; (2) snapshot (defensively copied) +
 * predicate/code-eligibility check -- a recognized 3xx is always offered to a configured predicate, even with
 * no usable Location; (3) Location resolution, including the followable-scheme gate; (4) loop detection;
 * (5) hop cap; (6) scheme-downgrade guard, keyed to the CURRENT hop's scheme, not the seed; (7)
 * body-replayability gate (303 exempt); (8) cross-origin determination and header construction for the next hop.
 *
 * The predicate override (step 2) is read as scoped to code/method eligibility only -- it does not bypass
 * steps 4-7's wire-safety invariants, which are unconditional `MUST`s elsewhere in the governing spec, not
 * "should I follow this kind of redirect" policy. See the design doc's Deviation Ledger for the full
 * reasoning; if this reading is wrong, the fix is narrow: gate steps 4 onward behind the predicate's answer.
 */
export function decide(response: Response, context: RedirectContext, settings: RedirectSettings): Decision {
  if (!isRecognizedRedirect(response.status.code)) return RETURN_CURRENT;

  const {currentRequest, seedOrigin, visited, redirectsFollowed} = context;
  // The snapshot is defensively COPIED, not merely typed `ReadonlySet`: `visited` is the redirect step's own
  // live cycle-detection set, and a predicate that casts the readonly type away could otherwise poison loop
  // detection for the rest of the call.
  const condition: RedirectCondition = {response, redirectsFollowed, visited: new Set(visited)};
  const eligible =
    settings.predicate !== undefined
      ? settings.predicate(condition)
      : isEligibleByCode(response.status.code, currentRequest.method, settings);
  if (!eligible) return RETURN_CURRENT;

  const currentUrl = currentRequest.url;
  const target = resolveLocation(response.headers.get(settings.locationHeader), currentUrl);
  if (target === null) return RETURN_CURRENT;
  if (visited.has(target.href)) return RETURN_CURRENT;
  if (redirectsFollowed + 1 > settings.maxHops) return RETURN_CURRENT;

  const currentScheme = currentUrl.protocol.toLowerCase();
  const targetScheme = target.protocol.toLowerCase();
  if (currentScheme === 'https:' && targetScheme === 'http:' && !settings.allowSchemeDowngrade) {
    return {kind: 'fail', error: new SchemeDowngradeError(currentUrl.href, target.href)};
  }

  const status = response.status.code;
  if (status !== 303 && currentRequest.body !== undefined && !currentRequest.body.replayable) {
    return {kind: 'fail', error: new NonReplayableBodyError(target.href)};
  }

  const crossOrigin = isCrossOrigin(seedOrigin, target);
  return {kind: 'follow', nextRequest: buildFollowRequest(currentRequest, {target, status, crossOrigin}), crossOrigin};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/decide.test.ts`
Expected: PASS — 31 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `decide()` is 3 params; every helper (`resolveLocation`, `stripContentHeaders`,
`nextHopHeaders`, `buildFollowRequest`) is 1-2 params and well under the depth/length caps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/redirect/decide.ts packages/core/src/redirect/decide.test.ts
git commit -m "feat(core): the pure per-hop redirect decision (REDIR-1..24)"
```

---

### Task 6: `redirect-step.ts` — the pillar adapter, closing `PIPE-40`

**Files:**
- Create: `packages/core/src/redirect/redirect-step.ts`
- Test: `packages/core/src/redirect/redirect-step.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `Request` from `../http/request.js`; `StepDescriptor` from
  `../pipeline/step.js`; `originOf` from `./cross-origin.js`; `decide`, `RedirectContext` from `./decide.js`;
  `redirectSettings`, `RedirectSettings` from `./settings.js`.
- Produces: `REDIRECT_STEP_TYPE: symbol`; `redirectStep(overrides?: Partial<RedirectSettings>):
  StepDescriptor`. Task 7's `withRedirect()` installs it alongside the guard step; 5c's preset installs it
  unmodified.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/redirect-step.test.ts
// Exercises: PIPE-15/36 (stage baked into the descriptor, fresh fork() per hop, never ctx.next()), PIPE-40
// (the 2-hop conformance clause: wire-send count, per-hop close, final response left open), the cancellation
// placement -- a signal aborted mid-chain returns the CURRENT (undispatched-onward) response open rather
// than closing it and re-driving.
import {afterEach, describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {getGlobalLogger, setGlobalLogger, type Logger} from '../observability/logger.js';
import {Cursor} from '../pipeline/cursor.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {aRequestContext} from '../pipeline/cursor.test-helpers.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {REDIRECT_STEP_TYPE, redirectStep} from './redirect-step.js';

const SEED = Request.newBuilder().url('https://example.com/start').build();

function runThrough(descriptor: StepDescriptor, transport: FakeTransport, signal?: AbortSignal): Promise<unknown> {
  const cursor = new Cursor({steps: [descriptor], transport, request: SEED, context: aRequestContext(), signal});
  return cursor.advance();
}

// FakeTransport doesn't itself set Location -- decide() reads it off Response.headers, so a scripted 3xx
// entry must carry one explicitly.
function withLocation(response: Response, location: string): Response {
  // setInbound: a Location is an inbound (response) header -- see the prerequisite note on the strict/lenient split.
  return response.newBuilder().headers(response.headers.newBuilder().setInbound('Location', location).build()).build();
}

describe('redirectStep', () => {
  test('is pinned to the REDIRECT pillar stage (PIPE-36)', () => {
    const descriptor = redirectStep();
    expect(descriptor.stage).toBe('REDIRECT');
    expect(descriptor.type).toBe(REDIRECT_STEP_TYPE);
  });

  test('closes PIPE-40: two chained 301s then a 200', async () => {
    const first = countingResponse(301);
    const second = countingResponse(301);
    const third = countingResponse(200);
    const hop1 = withLocation(first.response, 'https://example.com/mid');
    const hop2 = withLocation(second.response, '/final'); // relative, resolved against /mid
    const transport = new FakeTransport([hop1, hop2, third.response]);

    const response = await runThrough(redirectStep(), transport);

    expect(transport.sendCount).toBe(3);
    expect(first.cancelCount()).toBe(1);
    expect(second.cancelCount()).toBe(1);
    expect(third.cancelCount()).toBe(0); // left open for the caller
    expect(response).toBe(third.response);
  });

  test('a non-redirect response is returned open, untouched, on the very first hop', async () => {
    const only = countingResponse(200);
    const transport = new FakeTransport([only.response]);

    const response = await runThrough(redirectStep(), transport);

    expect(transport.sendCount).toBe(1);
    expect(only.cancelCount()).toBe(0);
    expect(response).toBe(only.response);
  });

  test('a loop is detected and the loop response returned open, not thrown', async () => {
    const loopHop = countingResponse(301);
    const located = withLocation(loopHop.response, 'https://example.com/start');
    const transport = new FakeTransport([located]);

    const response = await runThrough(redirectStep(), transport);

    expect(response).toBe(located); // Location === seed URL -> visited hit -> return-current, unclosed
  });

  test('an already-aborted signal returns the first hop response open, never dispatching a second', async () => {
    const controller = new AbortController();
    controller.abort();
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'https://example.com/next');
    const never = countingResponse(200);
    const transport = new FakeTransport([located, never.response]);

    const response = await runThrough(redirectStep(), transport, controller.signal);

    expect(transport.sendCount).toBe(1); // the first hop always dispatches; the second never does
    expect(response).toBe(located); // returned open -- the caller owns it
    expect(hop.cancelCount()).toBe(0);
  });

  test('a throwing predicate closes the current response before the error propagates (REDIR-22b)', async () => {
    const hop = countingResponse(301);
    const located = withLocation(hop.response, 'https://example.com/next');
    const transport = new FakeTransport([located]);
    const boom = new Error('predicate exploded');
    const step = redirectStep({
      predicate: () => {
        throw boom;
      },
    });

    await expect(runThrough(step, transport)).rejects.toBe(boom);

    expect(hop.cancelCount()).toBe(1); // decideOrClose closed it -- the hop's body is not leaked
  });
});
```

The observability retrofit's own two properties get their own block. Field *names* are deliberately not
asserted here — 7b's design fixes no vocabulary for the `SHOULD`-level retry/redirect events, so pinning
strings would just couple two plans together. What is asserted is what can silently break the request path:
containment (`OBS-20`/`XCUT-20`) and the fact that an opted-in downgrade emits at all (`REDIR-15`).

```typescript
describe("redirectStep's observability retrofit", () => {
  const original = getGlobalLogger();
  afterEach(() => setGlobalLogger(original)); // never leave the process-global logger swapped

  test('a throwing logger cannot break the redirect (OBS-20/XCUT-20)', async () => {
    setGlobalLogger({
      atLevel: () => {
        throw new Error('logger exploded');
      },
      withContext: () => getGlobalLogger(),
    } as unknown as Logger);
    const hop = countingResponse(301);
    const final = countingResponse(200);
    const transport = new FakeTransport([withLocation(hop.response, 'https://example.com/next'), final.response]);

    const response = await runThrough(redirectStep(), transport);

    expect(response).toBe(final.response); // the redirect completed normally despite every emission failing
    expect(hop.cancelCount()).toBe(1);
  });

  test('an opted-in HTTPS->HTTP downgrade is surfaced at warning level (REDIR-15)', async () => {
    const levels: string[] = [];
    setGlobalLogger({
      atLevel: (level: string) => {
        levels.push(level);
        return {field: () => event, event: () => event, cause: () => event, emit: () => undefined};
      },
      withContext: () => getGlobalLogger(),
    } as unknown as Logger);
    const event: unknown = undefined; // self-referential stub; see note below
    const hop = countingResponse(301);
    const final = countingResponse(200);
    const transport = new FakeTransport([withLocation(hop.response, 'http://example.com/next'), final.response]);

    await runThrough(redirectStep({allowSchemeDowngrade: true}), transport);

    expect(levels).toContain('warning'); // the downgrade event; the hop event is 'verbose'
  });
});
```

The `event` stub above is written as a self-returning chainable in the real file (declare it as a `const`
object literal whose `field`/`event`/`cause` return `event` and whose `emit` returns `undefined`, then close
over it) — the sketch's ordering is illustrative, not literal. If 7b ships a reusable fake logger in
`observability/`, prefer that over hand-rolling this stub.

`aRequestContext()` is 4c's existing cursor-test helper (already reused by 5a's `retry-step.test.ts`). If it is
not a shared file, construct a `RequestContext` inline instead — do not create a cross-`*.test.ts` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/redirect-step.test.ts`
Expected: FAIL — `Cannot find module './redirect-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/redirect-step.ts
// Amended 2026-07-28 (Phase 7b retrofit): three getGlobalLogger() call sites below, every URL field through
// redactUrl() and every emission through emitQuietly(). Narrow blast radius -- only this file's own emission
// points; no other phase depends on them. See
// docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability-design.md's "Amendments to 5a and 5b" section.
import {getGlobalLogger, type Logger} from '../observability/logger.js';
import {redactUrl} from '../observability/redaction.js';
import {invariant} from '../invariant.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {originOf} from './cross-origin.js';
import {decide, type Decision, type RedirectContext} from './decide.js';
import {redirectSettings, type RedirectSettings} from './settings.js';

/** Stable identity for pillar-slot occupancy and anchor matching (PIPE-6/PIPE-18). */
export const REDIRECT_STEP_TYPE: unique symbol = Symbol('dexpace.redirect');

/**
 * OBS-20/XCUT-20: observability MUST NOT throw into the request path. Every emission site in this file routes
 * through here, matching the containment discipline 7b's design states for `logging-step.ts` "and the two
 * amended retry/redirect logging call sites" -- a failed emission re-surfaces as a best-effort
 * `http.instrumentation.*` event, with a second-level swallow if that also throws.
 */
function emitQuietly(emit: (logger: Logger) => void): void {
  try {
    emit(getGlobalLogger());
  } catch {
    try {
      getGlobalLogger().atLevel('verbose').event('http.instrumentation.error').field('source', 'redirect').emit();
    } catch {
      // Second-level swallow: an instrumentation failure must never replace the redirect's own outcome.
    }
  }
}

/**
 * REDIR-22(b): if deciding or building the follow-up throws, the current response MUST be closed before the
 * error propagates. `decide()` is pure except that it invokes `settings.predicate`, which is caller code and
 * may throw; without this guard that hop's body leaks.
 */
async function decideOrClose(
  response: Response,
  context: RedirectContext,
  settings: RedirectSettings,
): Promise<Decision> {
  try {
    return decide(response, context, settings);
  } catch (error) {
    await response.close();
    throw error;
  }
}

/**
 * The REDIRECT pillar step (PIPE-36: stage baked into the returned descriptor, not subclassable).
 *
 * Every dispatch, including the first, goes through a fresh `ctx.fork()` -- never `ctx.next()` -- since the
 * step may need to re-drive the downstream chain an unknown number of times and `next()`'s single-invocation
 * guard would trip on the second hop (PIPE-15).
 *
 * Response lifecycle: a discarded intermediate response is closed before the next hop's dispatch; the final
 * response -- whichever hop `decide()` settles on -- is returned OPEN, the caller's to close. A throw out of
 * the decision itself closes the current response first (`decideOrClose`, REDIR-22(b)). The cancellation
 * check sits in the `follow` branch, evaluated BEFORE closing that hop's response and re-driving: this is the
 * only placement under which "return the current response, open" is meaningful, since `return-current` and
 * `fail` already have their own disposition by the time this check would run.
 */
export function redirectStep(overrides?: Partial<RedirectSettings>): StepDescriptor {
  const settings = redirectSettings(overrides);
  return {
    type: REDIRECT_STEP_TYPE,
    stage: 'REDIRECT',
    fn: async (seedRequest, ctx) => {
      const {fork, signal} = ctx;
      invariant(fork !== undefined, 'redirectStep must occupy the REDIRECT pillar stage');
      const seedOrigin = originOf(seedRequest.url);
      const visited = new Set<string>([seedRequest.url.href]);
      let request: Request = seedRequest;
      let redirectsFollowed = 0;

      for (;;) {
        const response = await fork()(request);
        const context: RedirectContext = {currentRequest: request, seedOrigin, visited, redirectsFollowed};
        const decision = await decideOrClose(response, context, settings);

        if (decision.kind === 'return-current') return response;
        if (decision.kind === 'fail') {
          // Phase 7b retrofit: a SHOULD-level rejection event, distinguishing the one cleanly-typed case
          // (scheme downgrade) from everything else. NOT closing the full "loop vs. hop-cap vs. normal
          // termination" distinction for 'return-current' above -- decide()'s Decision type carries no reason
          // discriminant for that case, and reshaping it (Task 5) to add one is out of scope for this narrow
          // retrofit. Left as an explicit, documented gap -- see this plan's amendment banner.
          await response.close();
          emitQuietly((logger) =>
            logger.atLevel('verbose').event('redirect.rejected').field('reason', decision.error.name).emit(),
          );
          throw decision.error;
        }
        if (signal?.aborted === true) return response;

        // `Request.url` hands back a FRESH `URL` every access (see Prerequisites) -- read each once.
        const fromUrl = request.url;
        const toUrl = decision.nextRequest.url;

        // REDIR-15: an opted-in HTTPS->HTTP downgrade MUST be surfaced observably -- the `allowSchemeDowngrade`
        // flag is the opt-in, not the surfacing. Derived here by comparing the two hops' schemes rather than
        // returned by `decide()`, so the `follow` variant keeps the shape decide.test.ts asserts throughout.
        // This is 7b's third amended 5b event ("a downgrade event ... if the settings permit it at all").
        if (fromUrl.protocol === 'https:' && toUrl.protocol === 'http:') {
          emitQuietly((logger) =>
            logger.atLevel('warning').event('redirect.downgrade')
              .field('from', redactUrl(fromUrl)).field('to', redactUrl(toUrl)).emit(),
          );
        }

        // Phase 7b retrofit: a SHOULD-level hop event, fired once per redirect followed. URLs go through
        // `redactUrl` (REDIR-28, XCUT-19): a raw `href` would put userinfo and query-string secrets straight
        // into the log line. Same function 7b's `loggingStep` uses for `url.full` -- one policy, no drift.
        emitQuietly((logger) =>
          logger.atLevel('verbose').event('redirect.hop')
            .field('from', redactUrl(fromUrl))
            .field('to', redactUrl(toUrl))
            .field('crossOrigin', decision.crossOrigin)
            .emit(),
        );

        await response.close();
        visited.add(toUrl.href);
        redirectsFollowed += 1;
        request = decision.nextRequest;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/redirect-step.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. The `fn` closure is one `for` loop at ~45 lines (comments excluded) and depth 2 —
`emitQuietly` and `decideOrClose` are hoisted out of it precisely so it stays under the caps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/redirect/redirect-step.ts packages/core/src/redirect/redirect-step.test.ts
git commit -m "feat(core): the REDIRECT pillar step, closing PIPE-40"
```

---

### Task 7: `strip-marker-step.ts` — the independent guard + `withRedirect()`

**Files:**
- Create: `packages/core/src/redirect/strip-marker-step.ts`
- Test: `packages/core/src/redirect/strip-marker-step.test.ts`

**Interfaces:**
- Consumes: `StepDescriptor` from `../pipeline/step.js`; `clearCrossOriginMarker` from `./cross-origin.js`;
  `PipelineBuilder` from `../pipeline/builder.js`; `redirectStep` from `./redirect-step.js`; `RedirectSettings`
  from `./settings.js`.
- Produces: `STRIP_MARKER_STEP_TYPE: symbol`; `stripCrossOriginMarkerStep(): StepDescriptor` (stage
  `'POST_AUTH'`, non-pillar); `withRedirect(builder: PipelineBuilder, overrides?: Partial<RedirectSettings>):
  PipelineBuilder`. 5c's preset calls `withRedirect()` rather than the bare `redirectStep()`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/redirect/strip-marker-step.test.ts
// Exercises: the guard unconditionally clears the marker and calls ctx.next() (ordinary step, no fork);
// withRedirect() installs BOTH the pillar step and the guard onto a builder in one call.
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Protocol} from '../http/protocol.js';
import {Status} from '../http/status.js';
import {Headers} from '../http/headers.js';
import {Cursor} from '../pipeline/cursor.js';
import {PipelineBuilder} from '../pipeline/builder.js';
import {aRequestContext} from '../pipeline/cursor.test-helpers.js';
import {CROSS_ORIGIN_MARKER_HEADER, withCrossOriginMarker} from './cross-origin.js';
import {REDIRECT_STEP_TYPE} from './redirect-step.js';
import {STRIP_MARKER_STEP_TYPE, stripCrossOriginMarkerStep, withRedirect} from './strip-marker-step.js';
import {FakeTransport} from '../testing/fake-transport.js';

function aResponse(): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .headers(Headers.newBuilder().build())
    .body(null)
    .build();
}

describe('stripCrossOriginMarkerStep', () => {
  test('occupies POST_AUTH and is not a pillar step', () => {
    const descriptor = stripCrossOriginMarkerStep();
    expect(descriptor.stage).toBe('POST_AUTH');
    expect(descriptor.type).toBe(STRIP_MARKER_STEP_TYPE);
  });

  test('unconditionally clears a marker present on the request, then calls next', async () => {
    const marked = Request.newBuilder()
      .url('https://example.com')
      .headers(withCrossOriginMarker(Headers.newBuilder().build()))
      .build();
    const transport = new FakeTransport([aResponse()]);
    const cursor = new Cursor({
      steps: [stripCrossOriginMarkerStep()],
      transport,
      request: marked,
      context: aRequestContext(),
    });

    await cursor.advance();

    expect(transport.calls[0]?.request.headers.get(CROSS_ORIGIN_MARKER_HEADER)).toBeUndefined();
  });

  test('is a no-op when the marker is already absent', async () => {
    const bare = Request.newBuilder().url('https://example.com').build();
    const transport = new FakeTransport([aResponse()]);
    const cursor = new Cursor({steps: [stripCrossOriginMarkerStep()], transport, request: bare, context: aRequestContext()});

    await cursor.advance();

    expect(transport.calls[0]?.request.headers.has(CROSS_ORIGIN_MARKER_HEADER)).toBe(false);
  });
});

describe('withRedirect', () => {
  test('installs both the pillar step and the guard onto the builder', () => {
    const runtime = withRedirect(new PipelineBuilder(new FakeTransport([aResponse()]))).build();
    const types = runtime.steps.map((step) => step.type);
    expect(types).toContain(REDIRECT_STEP_TYPE);
    expect(types).toContain(STRIP_MARKER_STEP_TYPE);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/redirect/strip-marker-step.test.ts`
Expected: FAIL — `Cannot find module './strip-marker-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/redirect/strip-marker-step.ts
import type {PipelineBuilder} from '../pipeline/builder.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {clearCrossOriginMarker} from './cross-origin.js';
import {redirectStep} from './redirect-step.js';
import type {RedirectSettings} from './settings.js';

export const STRIP_MARKER_STEP_TYPE: unique symbol = Symbol('dexpace.redirect.strip-marker');

/**
 * The independent safety net (REDIR-11/AUTH-29): a pipeline with no auth step -- including today's
 * redirect-only pipeline, since 5c has not shipped yet -- would otherwise forward the internal marker to the
 * transport. Unconditional clear, ordinary single-invocation step (no `fork` needed -- it never re-drives).
 */
export function stripCrossOriginMarkerStep(): StepDescriptor {
  return {
    type: STRIP_MARKER_STEP_TYPE,
    stage: 'POST_AUTH',
    fn: async (request, ctx) => ctx.next(request.newBuilder().headers(clearCrossOriginMarker(request.headers)).build()),
  };
}

/**
 * Installs `redirectStep()` and its bundled guard together, so a caller reaching for redirect support gets
 * the safety net without needing to know the marker exists. A caller who installs `redirectStep()` directly
 * against the builder's lower-level API is responsible for installing the guard too.
 */
export function withRedirect(builder: PipelineBuilder, overrides?: Partial<RedirectSettings>): PipelineBuilder {
  return builder.append(redirectStep(overrides)).append(stripCrossOriginMarkerStep());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/redirect/strip-marker-step.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/redirect/strip-marker-step.ts packages/core/src/redirect/strip-marker-step.test.ts
git commit -m "feat(core): independent POST_AUTH marker guard + withRedirect() bundling"
```

---

### Task 8: Gates, the unchanged API report, and the checklist

**Files:**
- Verify unchanged: `packages/core/etc/core.api.md`
- Verify unchanged: `packages/core/src/index.ts`
- Create: `docs/work/mvp/phase5/phase5b/2026-07-26-phase5b-redirect-checklist.md`

**Interfaces:**
- Consumes: every symbol from Tasks 1–7.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Confirm nothing leaked into the public barrel**

Run: `git diff --exit-code packages/core/etc/core.api.md packages/core/src/index.ts`
Expected: no output, exit 0. `src/redirect/` stays internal until 5c's public-barrel-promotion task.

- [ ] **Step 2: Confirm no `node:` import crept in**

Run: `bun run verify:seam-1`
Expected: PASS.

- [ ] **Step 3: Run the full gate sequence**

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS.

- [ ] **Step 4: Write the requirement checklist**

Create `docs/work/mvp/phase5/phase5b/2026-07-26-phase5b-redirect-checklist.md`, same format as
`2026-07-26-phase5a-retry-checklist.md` — `| ID | Level | Requirement gist | Status | Where |` tables, legend ✅
shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **Recognized codes and eligibility** — `REDIR-1`–`REDIR-4` ✅ Task 2.
2. **Cross-origin comparison and the marker** — `REDIR-11` ✅ Task 3; the marker's independent-of-auth guard ✅
   Task 7.
3. **The per-hop decision** — Location resolution/userinfo-stripping/no-re-encoding ✅ Task 5; unsupported-scheme
   rejection (`http:`/`https:` only) ✅ Task 5; loop detection ✅ Task 5; hop cap incl. `maxHops: 0` ✅ Tasks 4/5;
   scheme-downgrade guard ✅ Task 5; header hygiene (Authorization/Cookie/Proxy-Authorization) ✅ Task 5;
   body-replayability gate ✅ Task 5; predicate override, scoped per the Deviation Ledger, with a defensively
   copied condition snapshot ✅ Task 5.
4. **The pillar adapter** — `PIPE-15`/`PIPE-36` ✅ Task 6; response lifecycle (close-intermediate,
   return-final-open, **close-on-throw-out-of-`decide()`** per `REDIR-22`(b)) ✅ Task 6; cancellation ✅ Task 6.
5. **`PIPE-40`** — ✅ **Resolved in Task 6** (2-hop `FakeTransport` conformance test).
6. **Observability (`REDIR-15`/`REDIR-28`, `XCUT-19`/`XCUT-20`)** — permitted-downgrade event surfaced
   observably ✅ Task 6; hop and rejection events ✅ Task 6; all URL fields through `redactUrl()` ✅ Task 6; all
   emissions contained so observability cannot throw into the request path ✅ Task 6.
7. **Deferred out of Phase 5b** — `AUTH-29`'s marker-*consumption* side → 5c; the loop-detected and
   malformed-Location log events (`REDIR-18`/`REDIR-28`) → open, both blocked on a reason discriminant
   `decide()`'s `'return-current'` variant does not carry, a reshape out of the 7b retrofit's scope; the
   predicate-scope judgment call (see Deviation Ledger) → re-confirm at Phase 9's conformance sweep.

State explicitly at the top whether the plan has been executed, matching the Phase 5a checklist's convention.

- [ ] **Step 5: Commit**

```bash
git add docs/work/mvp/phase5/phase5b/2026-07-26-phase5b-redirect-checklist.md
git commit -m "docs: Phase 5b requirement checklist"
```

---

## Self-Review

**Spec coverage.** Walked every section of `2026-07-26-phase5b-redirect-design.md`:

| Spec section | Task |
|---|---|
| Module layout | 1–7 |
| Recognized codes and eligibility (`codes.ts`) | 2 |
| Cross-origin comparison and the marker (`cross-origin.ts`) | 3 |
| Scheme-downgrade guard | 5 |
| Settings (`settings.ts`) | 4 |
| The per-hop decision (`decide.ts`) | 5 |
| Adapter: the pillar step (`redirect-step.ts`) | 6 |
| Guard step (`strip-marker-step.ts`) | 7 |
| Errors (`errors.ts`) | 1 |
| Testing — `PIPE-40`, property tests, negative space | 5, 6 |
| Deviation Ledger, deferred items | 8 |

No gaps.

**Placeholder scan.** No "TBD"/"implement later"/"similar to Task N" language anywhere above; every code step
carries complete, runnable content.

**Type consistency.** `RedirectContext` (Task 5) is constructed identically in Task 6's loop
(`{currentRequest: request, seedOrigin, visited, redirectsFollowed}`) — same field names, same order of
construction. `Decision`'s three variants (`follow`/`return-current`/`fail`) are matched exhaustively in Task 6's
`if` chain (no `default`/`assertNever` needed since there's no discriminated-union `switch`, but every branch is
covered and the type checker would flag a missed variant on `decision.nextRequest`/`decision.error` access).
`RedirectSettings` (Task 4) is passed as `eligibility: CodeEligibility` (Task 2) structurally, without an
adapter — `settings.allowedMethods`/`settings.allow303` satisfy `CodeEligibility`'s shape directly. `redirectStep`
(Task 6) and `withRedirect` (Task 7) both accept `overrides?: Partial<RedirectSettings>`, spelled identically.

**Known rough edge, deliberately left.** Task 6's test imports `aRequestContext()` from a shared cursor-test
helper, following 5a's `retry-step.test.ts` precedent; the step under it says to inline a `RequestContext`
instead if that helper turns out to be file-local to 4c's own test file — same caveat 5a's plan already carried
forward.
