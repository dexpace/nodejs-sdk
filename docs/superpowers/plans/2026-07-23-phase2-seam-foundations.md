# Phase 2 — Seam Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the seam *contracts* in `@dexpace/core` — `Transport`, `Serde<T>`, and `buildRequest()` /
`OperationDescriptor` — that later phases' pipelines, resilience layer, and concrete adapters build on, per
`docs/superpowers/specs/2026-07-23-phase2-seam-foundations-design.md`.

**Architecture:** Three new interfaces/functions in a new `packages/core/src/seams/` folder, plus two small
retrofits to Phase 1's `src/http/` folder (`encodeRfc3986Component` extraction, a new `DexpaceError` taxonomy
root). `Transport` and `buildRequest()` are final shapes and go through the public barrel; `Serde<T>` is
provisional (SEAM-21 will reshape it in Phase 6) and is deliberately kept out of the public barrel and the
api-extractor surface.

**Tech Stack:** TypeScript 5.8+, `bun test` + `fast-check` for the one property test, `expect-type` for `Serde<T>`'s
type-level test, no new runtime dependencies (SEAM-1 unaffected — everything new here is a dev dependency).

**Prerequisite:** This plan assumes Phase 0 (scaffold) and Phase 1 (core HTTP domain model) are already
implemented exactly as their own plans specify — `packages/core/src/http/{builder,errors,method,status,protocol,
media-type,headers,query-params,request,response,request-options,etag,http-range,request-conditions,index}.ts`
all exist, `packages/core/src/index.ts` is `export * from './http/index.js';`, and the full Phase 0/1 gate sequence
(`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/`verify:dual-consumption`/`verify:seam-1`/
`audit`) is green on `main`.

## Global Constraints

- `tsconfig.base.json`'s `lib` becomes `["ES2022", "DOM"]` (was `["ES2022"]`) — the public seam surface now uses
  `AbortSignal`/`AbortController`/`DOMException`, and those must resolve from a declared lib, not incidentally
  from `@types/bun`'s ambient globals.
- `engines.node` stays `>=18.17"` (set in Phase 1), but it is now load-bearing for a *runtime API*:
  `AbortSignal.any()` landed in exactly Node 18.17.0. CI must run the *built artifact* against the declared
  minimum Node version — this residual was explicitly pulled forward from Phase 3 to this phase (NFR-10/NFR-17).
- `expect-type` is added to the workspace-root `devDependencies` — dev-only, so **SEAM-1** (`@dexpace/core`'s
  `dependencies: {}`) is untouched.
- **`Serde<T>` MUST NOT be exported from `packages/core/src/index.ts`.** It is defined in `seams/serde.ts`,
  re-exported from `seams/index.ts` for internal use only, and marked `@internal` in TSDoc. `Transport` and
  `buildRequest()`/`OperationDescriptor` have no such restriction — their shapes are final and go through the
  public barrel normally.
- `exactOptionalPropertyTypes: true` (Phase 0) means every optional interface property is spelled `?: T |
  undefined`, never a bare `?: T` — continuing Phase 1's convention, now extended to optional *properties* for the
  first time (`OperationDescriptor`). `body?: unknown` is the one exception: `unknown` already includes
  `undefined`, so no `| undefined` suffix is needed there.
- Typed `Error` subclasses only (styleguide ch08), `cause` chaining on wrap-and-rethrow, `this.name =
  new.target.name`. `DexpaceError` is the **new taxonomy root**, replacing `DomainModelError`'s previous role as
  root — `DomainModelError extends DexpaceError` now, but every Phase 1 leaf keeps its behavior and its
  `instanceof DomainModelError` narrowing unchanged; this is additive, not a rename.
- `encodeRfc3986Component()` lives in `src/http/rfc3986.ts`, **not** `src/seams/`, so the dependency graph stays
  one-directional: `seams/` imports from `http/`, never the reverse.
- `fast-check` property tests are mandatory (styleguide 11.5) for `buildRequest()` — it is an assembler/serializer.
- Every test file's top-of-file comment cites the `SEAM-N`/`HTTP-N` IDs it exercises.
- **Not built this phase** (see the spec's disposition table for why): `SEAM-5`–`SEAM-10`, `SEAM-18`'s bridge
  machinery, a `FakeTransport` test double, the `Logger`/`LogEvent` seam, `SEAM-30`'s cleanup implementation,
  `SEAM-14`'s close *behavior*, `SEAM-12`'s concurrency conformance test, the byte-stream provider, concrete
  `Serde`/`Transport` implementations, and `SEAM-28`'s optional operation-identifier field on
  `OperationDescriptor` (a MAY; deliberately omitted — it would be an additive optional property, so adding it in
  a later phase is non-breaking). Do not add speculative code for any of these.
- Same lint/coverage gates as Phase 0/1 apply unchanged (`max-lines-per-function` 70, `max-depth` 3, `max-params`
  3, explicit return types, 80% coverage floor).

---

## File Structure

```
packages/core/src/http/
  rfc3986.ts                 # encodeRfc3986Component() — extracted from query-params.ts (Task 2)
  rfc3986.test.ts
  errors.ts                  # MODIFY: add DexpaceError root above DomainModelError (Task 3)
  errors.test.ts             # MODIFY: add DexpaceError coverage
  query-params.ts            # MODIFY: import encodeRfc3986Component instead of its own copy (Task 2)
  index.ts                   # MODIFY: export DexpaceError (Task 3)

packages/core/src/seams/
  transport.ts                # Transport, composeSignal(), isTimeoutSignal(), CancellationError (Task 4)
  transport.test.ts
  serde.ts                    # Serde<T> (Task 5)
  serde.test.ts
  operation.ts                 # OperationDescriptor, buildRequest(), OperationAssemblyError (Task 6)
  operation.test.ts
  index.ts                      # barrel — internal-facing, includes Serde<T> (Task 7)

packages/core/src/index.ts   # MODIFY: add named seam exports, Serde<T> deliberately excluded (Task 7)
scripts/verify-node-floor.mjs # new CI-only smoke script (Task 7)
.github/workflows/ci.yml     # MODIFY: add node-floor-conformance job (Task 7)
package.json                  # MODIFY: add expect-type devDependency (Task 1), verify:node-floor script (Task 7)
tsconfig.base.json            # MODIFY: lib gains "DOM" (Task 1)
eslint.config.js              # MODIFY: no-restricted-globals guard for lib.dom name collisions (Task 1)
```

---

### Task 1: Toolchain prerequisites — DOM lib, `expect-type`

**Files:**
- Modify: `tsconfig.base.json`
- Modify: `package.json` (root)
- Modify: `eslint.config.js` (root overlay)

**Interfaces:**
- Consumes: nothing.
- Produces: a workspace where `AbortSignal`/`AbortController`/`DOMException` resolve from a declared `lib`
  entry, and `expect-type` is installed for Task 5's type-level test. No runtime code changes.

- [ ] **Step 1: Add `"DOM"` to `tsconfig.base.json`'s `lib`**

Open `tsconfig.base.json` and change:

```jsonc
    "lib": ["ES2022"],
```

to:

```jsonc
    "lib": ["ES2022", "DOM"],
```

- [ ] **Step 2: Add `expect-type` to the root `package.json`'s `devDependencies`**

Add one line, keeping the existing entries:

```jsonc
  "devDependencies": {
    "gts": "^7",
    "typescript": "^5.8",
    "typescript-eslint": "^8",
    "@types/bun": "latest",
    "fast-check": "^3",
    "expect-type": "^1",
    "@eslint-community/eslint-plugin-eslint-comments": "^4",
    "@microsoft/api-extractor": "^7",
    "publint": "^0.2",
    "@arethetypeswrong/cli": "^0.16",
    "@changesets/cli": "^2"
  },
```

- [ ] **Step 3: Guard against `lib.dom` global name collisions in `eslint.config.js`**

`lib.dom` declares global `Request`, `Response`, and `Headers` types — the same names as core's own exported
classes. After Step 1, a core file that forgets an import no longer fails to compile; it silently type-checks
against the DOM global instead. `lib.dom` also admits browser-only globals (`window`, `document`) that the spec
bans by review. Make both bans mechanical (this traces to styleguide ch04's shadowing rule — never reuse a name
already bound by a built-in): add to the `rules` block of the existing `eslint.config.js` overlay:

```javascript
      'no-restricted-globals': [
        'error',
        {name: 'Request', message: 'lib.dom global — import Request from src/http/request.js instead.'},
        {name: 'Response', message: 'lib.dom global — import Response from src/http/response.js instead.'},
        {name: 'Headers', message: 'lib.dom global — import Headers from src/http/headers.js instead.'},
        {name: 'window', message: 'Browser-only global; @dexpace/core is runtime-agnostic.'},
        {name: 'document', message: 'Browser-only global; @dexpace/core is runtime-agnostic.'},
      ],
```

An imported `Request`/`Response`/`Headers` binding shadows the global, so correctly-importing files are
unaffected; only a bare, unimported reference — exactly the bug this guards against — is flagged.

- [ ] **Step 4: Install and re-run the existing gates to confirm nothing regresses**

```bash
bun install
bun run typecheck
bun run lint
```

Expected: both exit 0. If `typecheck` reports a duplicate-identifier or incompatible-global error between
`@types/bun`'s ambient web globals and `lib.dom`'s, that is exactly the mismatch this toolchain fact exists to
catch (see the spec's Toolchain prerequisites section) — resolve by trusting `lib.dom` as authoritative; do not
suppress the error with a type-cast workaround.

- [ ] **Step 5: Commit**

```bash
git add tsconfig.base.json package.json eslint.config.js bun.lock
git commit -m "chore(core): add DOM lib, expect-type devDependency, and DOM-global lint guard for Phase 2 seam surface"
```

---

### Task 2: Retrofit — shared RFC 3986 encoder

**Files:**
- Create: `packages/core/src/http/rfc3986.ts`
- Create: `packages/core/src/http/rfc3986.test.ts`
- Modify: `packages/core/src/http/query-params.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeRfc3986Component(value: string): string`. Task 6 (`buildRequest`) imports this by exact name
  for path-segment encoding; `query-params.ts`'s `encode()` method now calls it too, in place of its former
  private copy.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/rfc3986.test.ts
// Exercises: HTTP-29 (RFC 3986 percent-encoding, not application/x-www-form-urlencoded) — the shared encoder
// used by QueryParams (HTTP-29/32) and buildRequest's path-segment encoding (SEAM-27)
import {describe, expect, test} from 'bun:test';
import {encodeRfc3986Component} from './rfc3986.js';

describe('encodeRfc3986Component', () => {
  test('encodes space as %20, never +', () => {
    expect(encodeRfc3986Component('a b')).toBe('a%20b');
  });

  test('encodes a literal + as %2B', () => {
    expect(encodeRfc3986Component('c+d')).toBe('c%2Bd');
  });

  test('encodes / as %2F', () => {
    expect(encodeRfc3986Component('a/b')).toBe('a%2Fb');
  });

  test("encodes the characters encodeURIComponent leaves unescaped but RFC 3986 doesn't: ! * ' ( )", () => {
    expect(encodeRfc3986Component("!*'()")).toBe('%21%2A%27%28%29');
  });

  test('leaves the unreserved set untouched: A-Z a-z 0-9 - . _ ~', () => {
    const unreserved = 'AZaz09-._~';
    expect(encodeRfc3986Component(unreserved)).toBe(unreserved);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/rfc3986.test.ts`
Expected: FAIL — `Cannot find module './rfc3986.js'`.

- [ ] **Step 3: Write `rfc3986.ts`**

```typescript
// packages/core/src/http/rfc3986.ts
export function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/rfc3986.test.ts`
Expected: PASS — `5 pass, 0 fail`.

- [ ] **Step 5: Update `query-params.ts` to use the shared encoder**

Remove the private `percentEncodeComponent` function from `query-params.ts` (the one defined at the top of the
file, above the `QueryParams` class), add the import, and update the one call site inside `encode()`:

```typescript
// top of query-params.ts — replace the existing `import type {Builder} from './builder.js';` line and the
// now-removed percentEncodeComponent function with:
import type {Builder} from './builder.js';
import {encodeRfc3986Component} from './rfc3986.js';
```

```typescript
  // inside QueryParams.encode() — replace both percentEncodeComponent(...) calls:
  encode(): string {
    const parts: string[] = [];
    for (const name of this.#insertionOrder) {
      const encodedName = encodeRfc3986Component(name);
      for (const value of this.#valuesByName.get(name) ?? []) {
        parts.push(`${encodedName}=${encodeRfc3986Component(value)}`);
      }
    }
    return parts.join('&');
  }
```

`safeDecodeComponent` (the lenient parser-side helper) is untouched — it isn't part of this retrofit, since
parsing's leniency is deliberately asymmetric to encoding's strictness (per the Phase 1 design).

- [ ] **Step 6: Run the full Phase 1 QueryParams suite to confirm nothing regressed**

Run: `cd packages/core && bun test src/http/query-params.test.ts src/http/rfc3986.test.ts`
Expected: PASS — all of Phase 1's existing `query-params.test.ts` assertions still pass unchanged (they test
observable behavior, not the internal function name), plus the 5 new `rfc3986.test.ts` cases.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/http/rfc3986.ts packages/core/src/http/rfc3986.test.ts \
        packages/core/src/http/query-params.ts
git commit -m "refactor(core): extract encodeRfc3986Component, shared by QueryParams and buildRequest (HTTP-29)"
```

---

### Task 3: Retrofit — `DexpaceError` taxonomy root

**Files:**
- Modify: `packages/core/src/http/errors.ts`
- Modify: `packages/core/src/http/errors.test.ts`
- Modify: `packages/core/src/http/index.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `class DexpaceError extends Error` (new root); `DomainModelError` now `extends DexpaceError` instead
  of `extends Error`. Task 4 (`CancellationError`) and Task 6 (`OperationAssemblyError`) both extend
  `DexpaceError` directly, as siblings of `DomainModelError`, not descendants of it.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/http/errors.test.ts` (it already imports `RequiredFieldError` from Task 1 of Phase
1 — add `DexpaceError` and `DomainModelError` to that same import line):

```typescript
// Exercises: the Phase 2 retrofit — DexpaceError as the taxonomy root above DomainModelError
describe('DexpaceError', () => {
  test('sets name to the concrete subclass name', () => {
    const error = new DexpaceError('boom');
    expect(error.name).toBe('DexpaceError');
  });

  test('DomainModelError is a DexpaceError, and every existing leaf still narrows by DomainModelError', () => {
    const error = new RequiredFieldError('url');
    expect(error).toBeInstanceOf(DomainModelError);
    expect(error).toBeInstanceOf(DexpaceError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/errors.test.ts`
Expected: FAIL — `DexpaceError is not defined` (or similar — the import will also fail to resolve the new name).

- [ ] **Step 3: Update `errors.ts`**

Replace the existing `DomainModelError` class definition:

```typescript
export class DomainModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
```

with:

```typescript
/**
 * Root of the SDK's error taxonomy — the "anything this SDK threw" catch-all. Every error the SDK raises
 * extends this class. `this.name = new.target.name` makes each subclass report its own class name in stack
 * traces without restating it.
 */
export class DexpaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Base of the domain-model construction failures — Phase 1's leaf classes hang here, unchanged. */
export class DomainModelError extends DexpaceError {}
```

If Phase 1's `DomainModelError` already carries a TSDoc block, keep that block in place of the one-liner above —
the class body change (`extends DexpaceError`, empty body) is the only mandatory edit to it.

Every other class in the file (`RequiredFieldError`, `HeaderValidationError`, `MediaTypeParseError`, etc.) is
unchanged — they all still `extends DomainModelError`, which now sits one level below `DexpaceError` instead of
directly below `Error`.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/errors.test.ts`
Expected: PASS — every pre-existing Phase 1 `errors.test.ts` case still passes (narrowing by `DomainModelError`
is unaffected), plus the 2 new cases.

- [ ] **Step 5: Export `DexpaceError` from the http barrel**

In `packages/core/src/http/index.ts`, add `DexpaceError` to the existing errors export block:

```typescript
export {
  DexpaceError,
  DomainModelError,
  RequiredFieldError,
  HeaderValidationError,
  MediaTypeParseError,
  ProtocolParseError,
  UrlConstructionError,
  RequestOptionsValidationError,
  EtagParseError,
  HttpRangeValidationError,
  RequestConditionsValidationError,
  RequestBodyNotAllowedError,
} from './errors.js';
```

- [ ] **Step 6: Run the full existing suite plus typecheck**

```bash
cd packages/core && bun test && cd .. && bun run typecheck
```

Expected: both exit 0 — nothing in Phase 1's tree depended on `DomainModelError extends Error` directly.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/http/errors.ts packages/core/src/http/errors.test.ts packages/core/src/http/index.ts
git commit -m "refactor(core): introduce DexpaceError as the error taxonomy root above DomainModelError"
```

---

### Task 4: `Transport`, `composeSignal`, `isTimeoutSignal`, `CancellationError`

**Files:**
- Create: `packages/core/src/seams/transport.ts`
- Create: `packages/core/src/seams/transport.test.ts`

**Interfaces:**
- Consumes: `Request` (`../http/request.js`), `Response` (`../http/response.js`), `RequestOptions`
  (`../http/request-options.js`), `DexpaceError` (`../http/errors.js`, Task 3).
- Produces: `interface Transport { send(...): Promise<Response>; close(): Promise<void>; }`;
  `composeSignal(userSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined`;
  `isTimeoutSignal(signal: AbortSignal): boolean`; `class CancellationError extends DexpaceError`. Task 7's
  barrel re-exports all four by these exact names.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/seams/transport.test.ts
// Exercises: SEAM-18's residual (composeSignal is the per-call-options-threading helper's cancellation half),
// XCUT-2 (timeout vs. caller-cancellation told apart by signal.reason.name, not a message string).
// No stub Transport is constructed — neither composeSignal nor isTimeoutSignal takes or returns one.
import {describe, expect, test} from 'bun:test';
import {composeSignal, isTimeoutSignal, CancellationError} from './transport.js';

describe('composeSignal', () => {
  test('returns undefined when neither input is supplied', () => {
    expect(composeSignal()).toBeUndefined();
  });

  test('returns the user signal itself when only a user signal is supplied', () => {
    const controller = new AbortController();
    expect(composeSignal(controller.signal)).toBe(controller.signal);
  });

  test('returns a timeout signal when only a timeout is supplied', () => {
    const signal = composeSignal(undefined, 20);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('composes both into a distinct signal that aborts when either input fires', () => {
    const controller = new AbortController();
    const combined = composeSignal(controller.signal, 20);
    expect(combined).toBeInstanceOf(AbortSignal);
    expect(combined).not.toBe(controller.signal);

    controller.abort(new CancellationError('cancelled by caller'));
    expect(combined?.aborted).toBe(true);
  });
});

describe('isTimeoutSignal', () => {
  test('reports true for a fired AbortSignal.timeout()', async () => {
    const signal = AbortSignal.timeout(5);
    await new Promise((resolve) => signal.addEventListener('abort', resolve, {once: true}));
    expect(isTimeoutSignal(signal)).toBe(true);
  });

  test('reports false for a fired caller-initiated CancellationError abort', () => {
    const controller = new AbortController();
    controller.abort(new CancellationError('cancelled by caller'));
    expect(isTimeoutSignal(controller.signal)).toBe(false);
  });

  test('reports false for a signal that never aborted', () => {
    expect(isTimeoutSignal(new AbortController().signal)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/seams/transport.test.ts`
Expected: FAIL — `Cannot find module './transport.js'`.

- [ ] **Step 3: Write `transport.ts`**

```typescript
// packages/core/src/seams/transport.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {RequestOptions} from '../http/request-options.js';
import {DexpaceError} from '../http/errors.js';

/**
 * The single async HTTP transport seam — SEAM-11 (sync) and SEAM-16 (async) collapse into one
 * `Promise<Response>` contract; SEAM-17's canonical async pivot is native `Promise`, so there is no second
 * async ecosystem to bridge.
 */
export interface Transport {
  /**
   * MUST be safe for concurrent calls; all per-request state confined to locals or the returned promise
   * graph — never instance fields on the transport (SEAM-12; conformance test is Phase 8's, once a real
   * transport exists to fire concurrent requests through).
   *
   * MUST NOT pre-buffer the response body — the caller owns reading and closing it (SEAM-11; the streaming
   * body type arrives in Phase 3, but the obligation binds every implementation from day one).
   *
   * Aborting `signal` while the call is in flight SHOULD be treated as a best-effort request to abort the
   * underlying exchange and release its transport resources — sockets, descriptors (SEAM-13).
   *
   * A `signal` abort that fires *after* the returned promise has resolved MUST NOT close the already-delivered
   * response body — the caller still owns closing it, even when discarding the value (SEAM-16). Do not wire an
   * unconditional `abort` listener that cancels the body.
   *
   * After the underlying fetch resolves, check whether `signal` already fired before delivering the response;
   * if so, cancel the response body instead of resolving. That cleanup path MUST be awaited or given
   * `.catch(() => {})` — an unhandled rejection there crashes the process under Node's default
   * `unhandledRejection` policy (SEAM-30; implemented by Phase 8's real adapters).
   *
   * Per-call `options` MUST be threaded through to the underlying client, never silently dropped. A transport
   * that ignores `options` MUST behave identically to the no-options call (SEAM-18's one surviving,
   * non-bridge-specific obligation).
   */
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>;

  /**
   * MUST be idempotent, release only resources the transport itself created, and never touch a
   * caller-supplied client/executor (SEAM-14). A lightweight transport with nothing to release MAY implement
   * this as a no-op: `async close(): Promise<void> {}`. The signature is locked from this phase on — adding a
   * required method to a published seam later is a breaking change; only the *behavior* waits for Phase 8.
   *
   * Behavior of `send()` after `close()` has resolved is unspecified at the seam level (SEAM-15); each Phase 8
   * adapter picks a mode (throw vs. rejected promise) and documents it.
   */
  close(): Promise<void>;
}

/**
 * Wraps `AbortSignal.timeout(ms)` and `AbortSignal.any([...])` into the one signal a `Transport.send()` call
 * should honor. Returns `undefined` when neither input is supplied, so a transport can pass the result straight
 * to `fetch` without a branch. Reusable by Phase 5's retry logic.
 */
export function composeSignal(userSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const timeoutSignal = timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;

  if (userSignal !== undefined && timeoutSignal !== undefined) {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  return userSignal ?? timeoutSignal;
}

/**
 * True when `signal` was aborted by `AbortSignal.timeout()`. Checks the structured `reason.name` field rather
 * than `reason instanceof DOMException` — `instanceof` is realm-bound, so a signal created inside a `node:vm`
 * context or a worker would fail the check even though it is a genuine timeout (XCUT-2: told apart by a
 * structured field on ambient state, not by matching a message string).
 */
export function isTimeoutSignal(signal: AbortSignal): boolean {
  const reason = signal.reason as {name?: unknown} | null | undefined;
  return typeof reason === 'object' && reason !== null && reason.name === 'TimeoutError';
}

/** Thrown for an explicit caller-initiated abort of an in-flight `Transport.send()` call. */
export class CancellationError extends DexpaceError {}
```

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/seams/transport.test.ts`
Expected: PASS — `7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/seams/transport.ts packages/core/src/seams/transport.test.ts
git commit -m "feat(core): add Transport, composeSignal, isTimeoutSignal, CancellationError (SEAM-11/12/13/14/15/16/17/18/30)"
```

---

### Task 5: `Serde<T>` (provisional, internal-only)

**Files:**
- Create: `packages/core/src/seams/serde.ts`
- Create: `packages/core/src/seams/serde.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Serde<T> { readonly mediaType: string; serialize(value: T): unknown; deserialize(data:
  unknown): T; }`. Task 7's `seams/index.ts` re-exports it for internal use; it is **never** re-exported from
  `packages/core/src/index.ts` (see Global Constraints).

- [ ] **Step 1: Write `serde.ts`**

There is no runtime logic to TDD here — `Serde<T>` is a pure type declaration, and the spec is explicit that
only a type-level `expectTypeOf` check exists for it (styleguide 11.6: no runtime logic to unit-test). Write the
interface directly:

```typescript
// packages/core/src/seams/serde.ts
/**
 * @internal
 * Provisional. `deserialize(data: unknown): T` with `T` inferred from the instance is exactly the
 * erased/inferred generic SEAM-21 forbids ("deserialization MUST require an explicit runtime type token").
 * Phase 6's type-witness mechanism will change this interface's shape — do not export this from
 * `packages/core/src/index.ts`.
 */
export interface Serde<T> {
  readonly mediaType: string;
  serialize(value: T): unknown;
  deserialize(data: unknown): T;
}
```

- [ ] **Step 2: Write the type-level test**

```typescript
// packages/core/src/seams/serde.test.ts
// Exercises: SEAM-19 (mediaType required, never defaulted) — a compile-time check only (styleguide 11.6);
// `bun test` executes this file but does not typecheck it (its transpiler strips types without checking them).
// The assertions only actually fire under `bun run typecheck` — see Step 3.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Serde} from './serde.js';

test('mediaType is a required, non-optional string', () => {
  expectTypeOf<Serde<string>>().toHaveProperty('mediaType').toEqualTypeOf<string>();
});

test("deserialize's return type is bound to the instance's T", () => {
  expectTypeOf<Serde<number>['deserialize']>().returns.toEqualTypeOf<number>();
});

test("serialize's parameter type is bound to the instance's T", () => {
  expectTypeOf<Serde<boolean>['serialize']>().parameter(0).toEqualTypeOf<boolean>();
});

test('an implementation without mediaType is rejected (negative case, styleguide 11.6)', () => {
  // @ts-expect-error -- SEAM-19: mediaType is required and never defaulted; omitting it must not compile
  const missingMediaType: Serde<string> = {
    serialize: (value: string): unknown => value,
    deserialize: (data: unknown): string => String(data),
  };
  void missingMediaType;
});
```

- [ ] **Step 3: Run `bun test` (executes, does not typecheck) and then `bun run typecheck` (actually validates the assertions)**

```bash
cd packages/core && bun test src/seams/serde.test.ts
cd /home/mohammad/Projects/dexpace/nodejs-sdk && bun run typecheck
```

Expected: `bun test` reports `4 pass, 0 fail` (the callbacks execute with no runtime assertions to fail);
`bun run typecheck` exits 0, which is the step that actually proves the `expectTypeOf` chains and the
`@ts-expect-error` negative case type-check. If you
want to see this tripwire fail on purpose once (to confirm it's load-bearing), temporarily change
`toEqualTypeOf<string>()` to `toEqualTypeOf<number>()`, re-run `bun run typecheck`, confirm it now fails, then
revert.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/seams/serde.ts packages/core/src/seams/serde.test.ts
git commit -m "feat(core): add provisional internal-only Serde<T> (SEAM-19; SEAM-21 deferred to Phase 6)"
```

---

### Task 6: `OperationDescriptor`, `buildRequest()`, `OperationAssemblyError`

**Files:**
- Create: `packages/core/src/seams/operation.ts`
- Create: `packages/core/src/seams/operation.test.ts`

**Interfaces:**
- Consumes: `Request`/`RequestBuilder` (`../http/request.js`), `Headers` (type-only, `../http/headers.js`),
  `QueryParams` (type-only, `../http/query-params.js`), `Method` (type-only, `../http/method.js`),
  `UrlConstructionError`/`DexpaceError` (`../http/errors.js`), `encodeRfc3986Component` (`../http/rfc3986.js`,
  Task 2).
- Produces: `interface OperationDescriptor {...}`; `function buildRequest(baseUrl: string | URL, operation:
  OperationDescriptor): Request`; `class OperationAssemblyError extends DexpaceError` (carries the offending
  `parameterName` as a structured `readonly` field, styleguide ch08). Task 7's barrel and the public barrel both
  re-export `buildRequest`, `OperationDescriptor`, and `OperationAssemblyError` by these exact names.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/seams/operation.test.ts
// Exercises: SEAM-26 (the four projections default to empty), SEAM-27 (buildRequest's encoding and base-URL
// composition rules), reusing HTTP-29's encodeRfc3986Component for path-segment encoding.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {buildRequest, OperationAssemblyError, type OperationDescriptor} from './operation.js';
import {UrlConstructionError} from '../http/errors.js';
import {QueryParams} from '../http/query-params.js';
import {Headers} from '../http/headers.js';

describe('SEAM-26: a parameterless GET overriding only method+path', () => {
  test('assembles a well-formed request with empty headers and no query', () => {
    const request = buildRequest('https://api.example.com', {method: 'GET', pathTemplate: '/pets'});
    expect(request.method).toBe('GET');
    expect(request.url.href).toBe('https://api.example.com/pets');
    expect(request.headers.names()).toEqual([]);
    expect(request.body).toBeUndefined();
  });
});

describe('SEAM-27: worked example', () => {
  test('host/c?sig=.. + /pets assembles to host/c/pets?sig=..&<opquery>', () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('limit', '10').build(),
    };
    const request = buildRequest('https://host/c?sig=abc', operation);
    expect(request.url.pathname).toBe('/c/pets');
    expect(request.url.search).toBe('?sig=abc&limit=10');
  });
});

describe('SEAM-27: base-URL composition rules', () => {
  test('a trailing slash on the base normalizes to one separator', () => {
    const request = buildRequest('https://host/c/', {method: 'GET', pathTemplate: '/pets'});
    expect(request.url.pathname).toBe('/c/pets');
  });

  test('an empty operation path leaves the base untouched', () => {
    const request = buildRequest('https://host/c', {method: 'GET', pathTemplate: ''});
    expect(request.url.pathname).toBe('/c');
  });

  test('an existing base query is preserved with the operation query appended after it', () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('a', '1').build(),
    };
    const request = buildRequest('https://host/c?existing=yes', operation);
    expect(request.url.search).toBe('?existing=yes&a=1');
  });

  test("a dangling separator on the base query is dropped before appending (SEAM-27's parenthetical)", () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('a', '1').build(),
    };
    const request = buildRequest('https://host/c?existing=yes&', operation);
    expect(request.url.search).toBe('?existing=yes&a=1');
  });

  test('a fragment-bearing base is rejected', () => {
    expect(() => buildRequest('https://host/c#frag', {method: 'GET', pathTemplate: '/pets'})).toThrow(
      UrlConstructionError,
    );
  });

  test('a malformed base is rejected', () => {
    expect(() => buildRequest('::bad', {method: 'GET', pathTemplate: '/pets'})).toThrow(UrlConstructionError);
  });

  test('a missing placeholder value throws OperationAssemblyError', () => {
    expect(() => buildRequest('https://host', {method: 'GET', pathTemplate: '/pets/{id}'})).toThrow(
      OperationAssemblyError,
    );
  });
});

describe('operation headers and body projections are threaded through', () => {
  test('supplied headers and body appear on the built request', () => {
    const headers = Headers.newBuilder().add('X-Trace', 'abc').build();
    const request = buildRequest('https://host', {
      method: 'POST',
      pathTemplate: '/pets',
      headers,
      body: {name: 'Fido'},
    });
    expect(request.headers.get('x-trace')).toBe('abc');
    expect(request.body).toEqual({name: 'Fido'});
  });
});

describe('SEAM-27: dot-segment path-param values are rejected, not silently normalized away', () => {
  // "." and ".." survive RFC 3986 encoding (both are unreserved), and the WHATWG URL parser treats "%2E" the
  // same as "." when it normalizes dot segments — so no encoding can keep them literal. A value of ".." would
  // otherwise rewrite the path (/things/.. → /), the same injection class SEAM-27's %2F rule exists to stop.
  test('a path-param value of "." throws OperationAssemblyError', () => {
    expect(() =>
      buildRequest('https://host', {method: 'GET', pathTemplate: '/things/{id}', pathParams: {id: '.'}}),
    ).toThrow(OperationAssemblyError);
  });

  test('a path-param value of ".." throws OperationAssemblyError', () => {
    expect(() =>
      buildRequest('https://host', {method: 'GET', pathTemplate: '/things/{id}', pathParams: {id: '..'}}),
    ).toThrow(OperationAssemblyError);
  });
});

describe('a path-param value containing / is encoded, not split (property)', () => {
  test('holds for arbitrary generated path-param values', () => {
    fc.assert(
      fc.property(
        // "." and ".." are excluded here because buildRequest rejects them by design — the two example tests
        // above pin that behavior; every other string must survive as exactly one path segment.
        fc.string({minLength: 1, maxLength: 20}).filter((s) => s !== '.' && s !== '..'),
        (value) => {
          const request = buildRequest('https://host', {
            method: 'GET',
            pathTemplate: '/things/{id}',
            pathParams: {id: value},
          });
          const segments = request.url.pathname.split('/').filter((segment) => segment !== '');
          expect(segments.length).toBe(2);
          expect(segments[0]).toBe('things');
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/seams/operation.test.ts`
Expected: FAIL — `Cannot find module './operation.js'`.

- [ ] **Step 3: Write `operation.ts`**

```typescript
// packages/core/src/seams/operation.ts
import {Request} from '../http/request.js';
import type {Headers} from '../http/headers.js';
import type {QueryParams} from '../http/query-params.js';
import type {Method} from '../http/method.js';
import {UrlConstructionError, DexpaceError} from '../http/errors.js';
import {encodeRfc3986Component} from '../http/rfc3986.js';

/**
 * Thrown when `buildRequest()` cannot assemble a request from its descriptor: a `{name}` placeholder in
 * `pathTemplate` has no value in `pathParams`, or a supplied value is a dot segment (`.`/`..`) that the WHATWG
 * URL parser would normalize into a path rewrite instead of keeping as one literal segment.
 */
export class OperationAssemblyError extends DexpaceError {
  /** The path parameter the failure is about — a structured field so log aggregators need not parse the message. */
  readonly parameterName: string;

  constructor(message: string, parameterName: string) {
    super(message);
    this.parameterName = parameterName;
  }
}

/**
 * The operation-input projection SEAM-26 requires: a method and path template are always required, the four
 * remaining projections default to empty when omitted. `?: T | undefined` (not a bare `?: T`) is required under
 * `exactOptionalPropertyTypes` so a generator that spreads a partial object or assigns every field including the
 * empty ones can pass `undefined` explicitly without a type error.
 */
export interface OperationDescriptor {
  readonly method: Method;
  readonly pathTemplate: string;
  readonly pathParams?: Readonly<Record<string, string>> | undefined;
  readonly query?: QueryParams | undefined;
  readonly headers?: Headers | undefined;
  readonly body?: unknown;
}

const PATH_PARAM_RE = /\{([^{}]+)\}/g;

function parseBaseUrl(baseUrl: string | URL): URL {
  if (baseUrl instanceof URL) return new URL(baseUrl.href);
  try {
    return new URL(baseUrl);
  } catch (e: unknown) {
    throw new UrlConstructionError(`malformed or non-absolute base URL: ${baseUrl}`, {cause: e});
  }
}

function normalizeBaseUrl(baseUrl: string | URL): URL {
  const parsed = parseBaseUrl(baseUrl);
  if (parsed.hash !== '') {
    throw new UrlConstructionError(`base URL must not include a fragment: ${parsed.href}`);
  }
  return parsed;
}

function substitutePathParams(template: string, pathParams: Readonly<Record<string, string>> | undefined): string {
  return template.replace(PATH_PARAM_RE, (_match, name: string) => {
    const value = pathParams?.[name];
    if (value === undefined) {
      throw new OperationAssemblyError(`missing value for path parameter "${name}"`, name);
    }
    // "." and ".." are RFC 3986 unreserved, so they survive encoding — and the WHATWG URL parser treats "%2E"
    // the same as "." during dot-segment normalization, so percent-encoding cannot keep them literal either.
    // Rejection is the only lossless option: silently forwarding ".." would let a path value rewrite the path.
    if (value === '.' || value === '..') {
      throw new OperationAssemblyError(`path parameter "${name}" must not be a dot segment ("." or "..")`, name);
    }
    return encodeRfc3986Component(value);
  });
}

function composePath(basePath: string, substitutedTemplate: string): string {
  if (substitutedTemplate === '') return basePath;
  const normalizedTemplate = substitutedTemplate.startsWith('/') ? substitutedTemplate : `/${substitutedTemplate}`;
  const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${trimmedBase}${normalizedTemplate}`;
}

function composeQuery(baseSearch: string, operationQuery: QueryParams | undefined): string {
  const rawBaseQuery = baseSearch.startsWith('?') ? baseSearch.slice(1) : baseSearch;
  // SEAM-27: the base query's dangling separator is dropped before the operation query is appended.
  const baseQueryPart = rawBaseQuery.replace(/&+$/, '');
  const operationQueryPart = operationQuery?.encode() ?? '';
  return [baseQueryPart, operationQueryPart].filter((part) => part !== '').join('&');
}

/**
 * Projects an {@link OperationDescriptor} onto a base URL, producing a well-formed {@link Request}. Path
 * placeholders are substituted through {@link encodeRfc3986Component}, so a placeholder value containing `/` is
 * encoded (`%2F`), never split into an extra path segment (SEAM-27). Dot-segment values (`.`, `..`) are rejected
 * outright — the WHATWG URL parser treats `%2E` the same as `.`, so no encoding can keep them literal.
 *
 * @throws OperationAssemblyError when a `{name}` placeholder has no value in `pathParams`, or a supplied value
 *   is a dot segment (`.`/`..`) — fix the descriptor; no request was assembled.
 * @throws UrlConstructionError when `baseUrl` is malformed, non-absolute, or carries a fragment — supply a
 *   clean absolute base URL.
 */
export function buildRequest(baseUrl: string | URL, operation: OperationDescriptor): Request {
  const base = normalizeBaseUrl(baseUrl);
  const substitutedPath = substitutePathParams(operation.pathTemplate, operation.pathParams);

  const target = new URL(base.href);
  target.pathname = composePath(base.pathname, substitutedPath);
  target.search = composeQuery(base.search, operation.query);

  const requestBuilder = Request.newBuilder().method(operation.method).url(target);
  if (operation.headers !== undefined) requestBuilder.headers(operation.headers);
  if (operation.body !== undefined) requestBuilder.body(operation.body);
  return requestBuilder.build();
}
```

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/seams/operation.test.ts`
Expected: PASS — `13 pass, 0 fail` (the property test runs 100 generated cases by default under one `it`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/seams/operation.ts packages/core/src/seams/operation.test.ts
git commit -m "feat(core): add OperationDescriptor and buildRequest (SEAM-26/27), reusing HTTP-29's encoder"
```

---

### Task 7: Barrels, CI Node-floor conformance, and full gate verification

**Files:**
- Create: `packages/core/src/seams/index.ts`
- Modify: `packages/core/src/index.ts`
- Create: `scripts/verify-node-floor.mjs`
- Modify: `package.json` (root — add `verify:node-floor` script)
- Modify: `.github/workflows/ci.yml` (add `node-floor-conformance` job)

**Interfaces:**
- Consumes: every symbol produced by Tasks 2–6.
- Produces: nothing new — this task wires the front doors, proves `Serde<T>` cannot leak into the public
  surface, and proves the built artifact actually runs `AbortSignal.any()` on the declared Node floor.

- [ ] **Step 1: Write `packages/core/src/seams/index.ts`**

This is the *internal-facing* seams barrel — it includes `Serde<T>`, unlike the package's public entry point.

```typescript
// packages/core/src/seams/index.ts
export type {Transport} from './transport.js';
export {composeSignal, isTimeoutSignal, CancellationError} from './transport.js';
export type {Serde} from './serde.js';
export type {OperationDescriptor} from './operation.js';
export {buildRequest, OperationAssemblyError} from './operation.js';
```

- [ ] **Step 2: Update the package's public barrel — named exports only, `Serde<T>` deliberately excluded**

Read the current `packages/core/src/index.ts` (Phase 1 left it as `export * from './http/index.js';`) and
replace its content:

```typescript
// packages/core/src/index.ts
export * from './http/index.js';

// Deliberately NOT `export * from './seams/index.js';` — that barrel also carries the internal-only,
// provisional Serde<T> (SEAM-21 will reshape it in Phase 6). Naming each public export here instead keeps
// Serde<T> unreachable from the package's public entry point and out of the api-extractor surface.
export type {Transport} from './seams/transport.js';
export {composeSignal, isTimeoutSignal, CancellationError} from './seams/transport.js';
export type {OperationDescriptor} from './seams/operation.js';
export {buildRequest, OperationAssemblyError} from './seams/operation.js';
```

- [ ] **Step 3: Run the full local gate sequence against real Phase 2 code**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun test --coverage
```

Expected: every command exits 0. `bun test --coverage` should show every new file in `packages/core/src/seams/`
and `packages/core/src/http/rfc3986.ts` at or near 100%.

- [ ] **Step 4: Regenerate the API report and confirm `Serde` is absent from it**

```bash
cd packages/core && bun run api:local
grep -c 'Serde' etc/core.api.md
```

Expected: `api:local` rewrites `etc/core.api.md` with `Transport`, `composeSignal`, `isTimeoutSignal`,
`CancellationError`, `OperationDescriptor`, `buildRequest`, `OperationAssemblyError`, and `DexpaceError` added to
the Phase 1 surface. The `grep` count must be `0` — if `Serde` appears anywhere in the report, Step 2 leaked it
(most likely via an accidental `export * from './seams/index.js'`); fix the leak before continuing.

- [ ] **Step 5: Verify the API-compatibility gate is green**

Run: `cd packages/core && bun run api:ci`
Expected: exits 0 — the report just regenerated in Step 4 matches what's on disk.

- [ ] **Step 6: Write the Node-floor conformance script**

```javascript
// scripts/verify-node-floor.mjs
import assert from 'node:assert/strict';
import {composeSignal} from '@dexpace/core';

const controller = new AbortController();
const combined = composeSignal(controller.signal, 50);

assert.ok(
  combined instanceof AbortSignal,
  'composeSignal() must return an AbortSignal when both a user signal and a timeout are supplied',
);
assert.notEqual(
  combined,
  controller.signal,
  'the combined signal must be a distinct AbortSignal.any() result, not the raw user signal',
);

console.log(`node-floor check passed: AbortSignal.any() resolved correctly on Node ${process.version}`);
```

This forces the two-signal branch of `composeSignal()` — the one that calls `AbortSignal.any()`, the API that
landed in exactly Node 18.17.0, the repo's declared floor.

- [ ] **Step 7: Add the script to root `package.json`'s `scripts`**

```jsonc
    "verify:node-floor": "node scripts/verify-node-floor.mjs"
```

- [ ] **Step 8: Run it locally to prove the script logic works**

```bash
bun run build
node scripts/verify-node-floor.mjs
```

Expected: exits 0, prints the `node-floor check passed` line. This only proves the script is correct — it does
not prove Node-floor conformance unless your local `node` happens to be pinned to 18.17.0; that enforcement is
CI's job, wired next.

- [ ] **Step 9: Add the `node-floor-conformance` CI job**

Add a second job to `.github/workflows/ci.yml`, alongside the existing `ci` job:

```yaml
  node-floor-conformance:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Install (frozen lockfile)
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - uses: actions/setup-node@v4
        with:
          node-version: 18.17.0

      - name: Verify the built artifact against the declared minimum Node version (NFR-10/NFR-17)
        run: node scripts/verify-node-floor.mjs
```

`actions/setup-node@v4` prepends its pinned Node to `PATH` for the remaining steps in the job, so the final step
runs under literal Node 18.17.0 — not whatever version Bun bundles internally, and not the runner's default.
`needs: ci` keeps this job from wasting CI minutes chasing a Node-floor failure when the main gate sequence is
already broken.

- [ ] **Step 10: Run the remaining Phase 0/1 gates**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
bun run lint:publish
bun run verify:dual-consumption
bun run verify:seam-1
bun run audit
```

Expected: all four exit 0.

- [ ] **Step 11: Add a changeset**

Run: `bunx changeset`

Pick `@dexpace/core`, a **minor** bump (new public API on a `0.x` line), and a summary such as
`Add seam foundations: Transport, buildRequest/OperationDescriptor, and the DexpaceError taxonomy root.`

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/seams/index.ts packages/core/src/index.ts packages/core/etc/core.api.md \
        scripts/verify-node-floor.mjs package.json .github/workflows/ci.yml .changeset/
git commit -m "feat(core): wire Phase 2 public barrel, Node-floor CI conformance, and verify all toolchain gates"
```

---

## Self-Review

**Spec coverage** (every requirement ID in `docs/superpowers/specs/2026-07-23-phase2-seam-foundations-design.md`'s
disposition table, mapped to the task implementing it):

- SEAM-11/SEAM-16 (collapsed) → Task 4, `Transport.send(): Promise<Response>` structurally covers the
  non-null-completion halves; the *behavioral* halves — no pre-buffering (SEAM-11) and a late cancel never
  closing an already-delivered body (SEAM-16) — are TSDoc obligations on `send()`, inherited by Phase 8.
- SEAM-12 (concurrency contract obligation) → Task 4, TSDoc on `Transport.send()`; conformance test deferred to
  Phase 8 per the spec's own disposition.
- SEAM-13 (best-effort abort of the in-flight exchange on cancellation) → Task 4, TSDoc obligation on `send()`.
- SEAM-14 (`close()` shape locked, behavior deferred) → Task 4, `Transport.close(): Promise<void>`.
- SEAM-15 (post-close behavior) → Task 4, `close()` TSDoc states it is unspecified at the seam level and each
  Phase 8 adapter documents its chosen mode.
- SEAM-17 (canonical `Promise` pivot) → Task 4, satisfied structurally, no code needed beyond the interface.
- SEAM-18 (residual: options threading survives; the bridge itself is never built) → Task 4, TSDoc obligation on
  `send()`; `composeSignal`/`isTimeoutSignal` are the reusable cancellation primitives, not the bridge.
- SEAM-19 (`Serde<T>` required, undefaulted `mediaType`) → Task 5.
- SEAM-21 (deferred to Phase 6) → Task 5's `@internal` marker and exclusion from the public barrel (Task 7) is
  exactly the mechanism that keeps this deferral non-breaking.
- SEAM-26 (`OperationDescriptor`, four projections default to empty) → Task 6, tested directly.
- SEAM-27 (`buildRequest()` encoding + base-URL composition) → Task 6, every conformance note from the spec has
  its own test case, including the requirement's parenthetical dangling-separator drop and the dot-segment
  rejection ("." / ".." values throw rather than being silently normalized away by the WHATWG URL parser).
- SEAM-30 (contract obligation only) → Task 4, TSDoc on `send()`; implementation deferred to Phase 8.
- SEAM-5–10, SEAM-18's bridge machinery → never built, confirmed absent from every task's file list.
- XCUT-2 (timeout vs. cancellation, told apart by `signal.reason.name`) → Task 4, `isTimeoutSignal` + its two
  distinguishing test cases.
- HTTP-29 retrofit (shared RFC 3986 encoder) → Task 2.
- NFR-10/NFR-17 residual (pulled forward from Phase 3) → Task 7, the `node-floor-conformance` CI job.

**Placeholder scan:** no "TBD"/"TODO"/"implement later" strings; every step contains complete, runnable code,
including every validation branch and error path each test exercises.

**Type consistency:** cross-checked exported names/signatures across tasks — `encodeRfc3986Component` (Task 2) is
imported by that exact name in both `query-params.ts` (Task 2) and `operation.ts` (Task 6); `DexpaceError` (Task
3) is the base class `CancellationError` (Task 4) and `OperationAssemblyError` (Task 6) both extend —
`CancellationError` inherits the `(message: string, options?: ErrorOptions)` constructor unchanged, while
`OperationAssemblyError` declares its own `(message: string, parameterName: string)` constructor to carry the
offending parameter as a structured `readonly` field;
`Request.newBuilder().method(...).url(...).headers(...).body(...).build()` (Task 6)
matches Phase 1 Task 9's `RequestBuilder` exactly; `Headers`/`QueryParams`/`Method` types (Task 6) match their
Phase 1 definitions with no renaming.

**Known gap, deliberately deferred:** the same list as the spec's own "Explicitly Out of Scope" section —
`Logger`/`LogEvent` (Phase 7), `FakeTransport` (first phase that tests against `Transport`, likely Phase 4),
`SEAM-30`'s cleanup implementation and `SEAM-14`'s close behavior (both Phase 8), `SEAM-12`'s concurrency
conformance test (Phase 8), the byte-stream provider implementation (Phase 3), `SEAM-21`'s type-witness mechanism
and concrete `Serde`/`Transport` implementations (Phases 6 and 8 respectively), and `SEAM-28`'s optional
operation identifier (a MAY — additive optional field, non-breaking to add whenever instrumentation needs it).
