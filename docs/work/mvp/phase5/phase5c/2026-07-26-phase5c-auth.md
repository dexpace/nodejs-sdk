# Phase 5c — Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the authentication layer in `@dexpace/core` — the scheme-agnostic descriptor/resolver model, the
credential types, the RFC 7235 challenge parser, the Basic/Digest/static-key stamping handlers, the bearer token
cache, the single AUTH pillar step, `PipelineBuilder.seedFrom()`, and the standard-resilience preset — satisfying
`docs/product-spec/11-authentication.md` (`AUTH-1`–`AUTH-38`), per
`docs/work/mvp/phase5/phase5c/2026-07-26-phase5c-auth-design.md`. Also closes `PIPE-35`'s `seedFrom`, `AUTH-29`'s
marker-consumption side (5b produced the marker), `PIPE-24`/`PIPE-39`'s preset, and public-barrel promotion of
the pillar-authoring surface.

> **Amended 2026-07-28 (Phase 7b retrofit):** `standardResilience()` (Task 16) now installs a fourth step,
> `loggingStep(options.logging)`, into the previously-empty `LOGGING` slot — this task's own doc comment
> already named "Phase 7" as the phase that would ship it. Narrow blast radius: nothing outside `preset.ts`
> and its own test depends on this change.
>
> **Applied by Phase 7b, not by this plan (corrected 2026-07-29).** Phase 5c executes *before* Phase 7b, so
> `preset.ts` importing `observability/logging-step.js` would not resolve at this plan's own execution time —
> and 7b needs 5c's preset to amend, so the earlier "5c now depends on 7b first" wording was a cycle.
> **An agent executing this plan must skip the Phase 7b retrofit blocks in Task 16**: build
> `standardResilience()` installing the three pillars that exist by then (redirect, retry, auth), leaving
> `LOGGING` empty. Phase 7b's plan Task 9 installs the fourth. See
> `docs/work/mvp/phase7/phase7b/2026-07-28-phase7b-observability.md`'s Prerequisite and Task 9.

**Architecture:** A new `packages/core/src/auth/` folder of fifteen files, plus one amendment to
`packages/core/src/pipeline/builder.ts`. The descriptor/resolver half (`scheme.ts`/`requirement.ts`/
`descriptor.ts`/`resolve.ts`) is pure data shapes and pure functions, no classes. The stamping half
(`basic.ts`/`digest.ts`/`static-key.ts`/`composing-handler.ts`) is a small strategy-pattern family behind one
`ChallengeHandler` interface. `bearer-cache.ts` is the one piece of real mutable state — a single-flight,
three-zone async cache per configured `TokenProvider`. `auth-step.ts` is the single AUTH pillar step: one
pluggable 401-reaction extension point (`challengeHook`) with a scheme-dependent default body, not three
competing mechanisms. `preset.ts` wires all three resilience pillars (5a's `retryStep`, 5b's `withRedirect`,
this phase's `authStep`) into one `Runtime` via `seedFrom`'s sibling, a fresh `PipelineBuilder`.

**Tech Stack:** TypeScript 5.8+, `globalThis.crypto.subtle` (SHA-256) and `globalThis.crypto.getRandomValues()`
(client nonce) — never `node:crypto`, to keep `@dexpace/core` portable to browsers/Deno/Cloudflare Workers.
`globalThis.btoa` (Basic stamping) — a global in Node 18.5+, Bun, Deno, and every browser, so no `node:buffer`
import either. A hand-rolled, dependency-free MD5 (`md5.ts`) since Web Crypto deliberately excludes it.
`fast-check` for the challenge parser and nonce-count invariants. `bun test`.

**Prerequisite:** This plan assumes Phases 0–4c, 5a, and 5b are implemented exactly as their plans specify.
Concretely, in addition to 5a's prerequisite list (`Method`, `Request`, `Headers`, `Response`, `Status`,
`Protocol`, `DexpaceError`, `IoError`, `HttpStatusError`/`toHttpError`, `Transport`/`CancellationError`,
`Outcome`/`success`/`failure`/`fold`, `Step`/`StepContext`/`Next`/`StepDescriptor`, `Cursor`/`CursorInit`,
`invariant`/`assertNever`, `FakeTransport`/`countingResponse`):

- `packages/core/src/pipeline/builder.ts` — `class PipelineBuilder` (`constructor(transport)`, `append(descriptor):
  this`, **`appendAll(descriptors: readonly StepDescriptor[]): this`** — 4c Task 5, `PIPE-38`; Task 15's
  `seedFrom('flatten')` consumes it — and `build(): Runtime`)
- `packages/core/src/pipeline/errors.ts` — `PillarCollisionError` (4c Task 2; Task 15's test asserts on it)
- `packages/core/src/invariant.ts` — `invariant` **and `assertNever`** (the latter added in 4b Task 1 for
  `Outcome<T>`'s `fold()`; Task 14 uses it to close its `AuthScheme` switches)
- `packages/core/src/pipeline/runtime.ts` — `class Runtime implements Transport` (`get steps(): readonly
  StepDescriptor[]`, `send()`, `close()`)
- `packages/core/src/retry/retry-step.ts` — `retryStep(options?: RetryStepOptions): StepDescriptor` (5a)
- `packages/core/src/redirect/settings.ts` — `RedirectSettings` (5b)
- `packages/core/src/redirect/strip-marker-step.ts` — `withRedirect(builder: PipelineBuilder, overrides？:
  Partial<RedirectSettings>): PipelineBuilder` (5b — installs `redirectStep()` + the `POST_AUTH` marker guard
  together)
- `packages/core/src/redirect/cross-origin.ts` — `CROSS_ORIGIN_MARKER_HEADER`, `hasCrossOriginMarker(headers):
  boolean`, `clearCrossOriginMarker(headers): Headers` (5b — imported unchanged, never redeclared)
- `packages/core/src/body/body.js` — `Body` (`replayable: boolean`)
- `packages/core/src/http/headers.js` — `HeadersBuilder.set(name, value)` (outbound-strict: rejects every
  non-ASCII byte) **and `setInbound(name, value)`** (lenient, permits obs-text `>= 0x80` per `HTTP-19`).
  Response fixtures below build `WWW-Authenticate`/`Proxy-Authenticate` with `setInbound`, since those are
  inbound headers and a real server may send obs-text in a `realm`.

**One assumption to confirm before Task 14.** Close assertions observe `countingResponse()`'s `cancelCount()`
on a response rebuilt via `response.newBuilder().headers(...).build()`. That only holds if `ResponseBuilder`
carries the **same body instance** through the copy. Check `packages/core/src/http/response.ts` first; if the
rebuild re-wraps the body, pass the challenge headers into `countingResponse()`'s own construction instead of
rebuilding after the fact, rather than weakening the assertion.

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **`packages/core/src/index.ts` gains new exports THIS phase — the one exception to every prior phase's "not
  yet."** Two groups are promoted (Task 16):
  1. **The pillar-authoring surface:** `Stage`, `STAGE_ORDER`, `PILLAR_STAGES`, `StepDescriptor`, `StepContext`,
     `Next`, `PipelineBuilder`, `Runtime`, `retryStep`, `redirectStep`, `authStep`, `standardResilience`.
  2. **Everything those functions' signatures name**, because a promoted function whose parameter type is
     `@internal` is an API a caller cannot call. `authStep(settings: AuthStepSettings)` and
     `standardResilience(transport, options: StandardResilienceOptions)` transitively require
     `AuthStepSettings`, `StandardResilienceOptions`, `AuthCredentialSet` (+ `BasicCredential`,
     `DigestCredential`, `BearerCredential`, `ApiKeyCredentialConfig`), `ChallengeHook`, `AuthTiers`,
     `AuthDescriptor`, `AuthRequirement`, `AuthScheme`, `DigestAlgorithm`, `BearerToken`, `TokenProvider`,
     `ApiKeyCredential`, `NameKeyCredential`, `RetryStepOptions`, `RedirectSettings`, `LoggingStepSettings`,
     plus the factories `createAuthDescriptor`, `createAuthRequirement`, `createBearerToken` and the three
     error leaves. **`ApiKeyCredential`/`NameKeyCredential` carry `#key` private fields, which makes them
     NOMINAL** — no object literal is assignable, so without the exported constructors the `API_KEY` scheme is
     unreachable from outside the package entirely. `AuthDescriptor` likewise must come from
     `createAuthDescriptor` (`AUTH-3` validates and freezes there); hand-forging the interface bypasses it.
  Everything else in `src/auth/` — the challenge parser, `md5.ts`, the Basic/Digest/composing handlers, the
  bearer cache — stays `@internal`. The mechanical check is `packages/core/etc/core.api.md`'s diff, reviewed by
  hand at Task 16 (not required to be empty this phase, unlike every prior one); `api-extractor` reporting an
  `ae-forgotten-export` for any symbol reachable from the entry point means group 2 is still incomplete.
- **No `node:` imports anywhere in `packages/core`.** SHA-256 and the client nonce use `globalThis.crypto`;
  Basic stamping uses `globalThis.btoa`. `verify:seam-1` enforces this.
- **No new error leaf for construction-time caller misconfiguration.** `AUTH-3`'s empty-`AuthDescriptor`
  rejection and `AUTH-6`'s all-tiers-absent case are PROGRAMMER errors under `docs/knowledge/error-handling.md`'s
  split — a caller who builds an empty descriptor or calls `resolveAuthRequirement` with no tier configured has
  a bug, not an operational failure — so both use `invariant()`, the same call 5a's `retrySettings()` and 5b's
  `redirectSettings()` made. **This corrects the design doc's own text**, which says "`ArgumentError` reused
  from earlier phases" — no such class exists in any prior phase's plan; this is a plan-time fix, not a
  deviation from working code. `AuthResolutionError` (the design's one genuinely new *operational* leaf) is
  reserved for the case a caller DID configure a tier but none of its listed schemes has a matching credential
  (`AUTH-4`), and for a null/pre-expired `TokenProvider` result (`AUTH-35`) — both are runtime facts about
  external input, not a construction-time bug.
- **`Response` instances are `Object.freeze`d.** Observe close through `FakeTransport`'s `countingResponse()`
  (5a), never a spy on `response.close`.
- **ESLint limits are hard: `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.** See "Plan-time
  signature decisions" below.
- **`exactOptionalPropertyTypes` is on.** No TS `enum`. Kebab-case filenames. Named exports only (classes are
  the one exception already established for `ApiKeyCredential`/`NameKeyCredential`, matching `HttpStatusError`'s
  precedent). Explicit return types on every exported function.
- **Digest's nonce counter is a synchronous read-increment-write with no `await` between the two.** Node/Bun
  have no preemptive thread interleaving mid-statement, so this is safe without a lock — same collapse 5a
  documented for `BODY-3` and this phase's own `bearer-cache.ts` single-flight check.
- **Tests must survive any order and parallel execution.** `bearer-cache.ts` is the only stateful class in this
  phase; every test constructs its own instance.

### Plan-time decisions

1. **`AuthCredentialSet`, referenced by `AuthStepSettings.credentials` in the design doc, is not defined
   anywhere in the design doc or the knowledge corpus.** It is designed here, in `auth-step.ts` (Task 14), as
   the concrete shape carrying the actual username/password/provider/credential material per scheme, and the
   source `resolveAuthRequirement`'s `availableSchemes` is derived from. See Task 14 for the shape and the
   `availableSchemesOf()` function that derives it.
2. **`decide()`-style multi-positional signatures are bundled to satisfy `max-params: 3`**, same discipline
   5b's plan applied: `resolveAuthRequirement(tiers, availableSchemes)` (2, already compliant),
   `parseChallenges(headerValue)` (1, already compliant) — no design-doc signature in this phase actually
   exceeds 3, unlike 5b's `decide()`/`isEligibleByCode()`, so no bundling is needed here. Verified per-task below.
3. **`ChallengeHandler` is defined in `challenge.ts` (Task 7), not `composing-handler.ts`** as the design doc's
   prose section headings might suggest — `basic.ts` and `digest.ts` (Tasks 9–10) both implement it and must be
   built before `composing-handler.ts` (Task 12), so the interface has to live somewhere already built by Task
   9. `challenge.ts` already owns the `Challenge` type `ChallengeHandler.canHandle`/`stamp` operate on, so this
   is a natural, minimal-surprise home, not an arbitrary relocation.
4. **`auth-step.ts`'s default handler list is built from `settings.credentials`, not from zero-argument
   `digestHandler()`/`basicHandler()` calls** as the design doc's shorthand `default = [digestHandler(),
   basicHandler()]` literally reads. Both handlers need a username/password to do anything; `auth-step.ts`
   constructs them from `settings.credentials.digest`/`.basic` when present, digest-first, matching "callers
   order stronger schemes first." See Task 14.

---

## File Structure

```
packages/core/src/auth/
  errors.ts                # AuthResolutionError, PlaintextCredentialError, DigestChallengeUnsupportedError (Task 1)
  scheme.ts                 # AUTH-1     AuthScheme union                                    (Task 2)
  requirement.ts             # AUTH-2     AuthRequirement factory + equality                  (Task 3)
  descriptor.ts              # AUTH-3     AuthDescriptor factory                               (Task 4)
  resolve.ts                 # AUTH-4..7  resolveAuthRequirement()                             (Task 5)
  credential.ts              # AUTH-8..11 BearerToken, ApiKeyCredential, NameKeyCredential, TokenProvider (Task 6)
  challenge.ts                # AUTH-12..13 parseChallenges(), ChallengeHandler                 (Task 7)
  md5.ts                      # AUTH-15..17 self-contained MD5 (no npm dependency)               (Task 8)
  basic.ts                    # AUTH-14    Basic handler                                        (Task 9)
  digest.ts                   # AUTH-15..22 Digest handler + bounded nonce-count store          (Task 10)
  static-key.ts                # AUTH-26    API-key / name-key stamping                          (Task 11)
  composing-handler.ts         # AUTH-23..25 ordered delegation over Basic/Digest                 (Task 12)
  bearer-cache.ts               # AUTH-34..37 single-flight, three-zone token cache               (Task 13)
  auth-step.ts                  # AUTH-27..33 pillar adapter, one per-scheme dispatch table       (Task 14)
  preset.ts                     # PIPE-24/39 standard-resilience preset                          (Task 16)
packages/core/src/pipeline/
  builder.ts                    # amended: PipelineBuilder.seedFrom()  (PIPE-35)                 (Task 15)
```

Every production file has a colocated `*.test.ts`.

---

### Task 1: `errors.ts` — the three operational failure leaves

**Files:**
- Create: `packages/core/src/auth/errors.ts`
- Test: `packages/core/src/auth/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` from `../http/errors.js`; `AuthScheme` — **forward-declared as `string` here**; Task
  2 is where the real `AuthScheme` union is born, so this file types its fields as `readonly string[]` rather
  than importing a type that doesn't exist yet, and Task 5 (`resolve.ts`) passes `AuthScheme[]` values into a
  `readonly string[]`-typed parameter, which TypeScript accepts (a union of string literals is assignable to
  `string`).
- Produces: `class AuthResolutionError extends DexpaceError` (constructor takes a plain `message: string`, plus
  static factory `AuthResolutionError.unsatisfiable(required, available)`); `class PlaintextCredentialError
  extends DexpaceError`; `class DigestChallengeUnsupportedError extends DexpaceError`. Task 5 uses
  `AuthResolutionError.unsatisfiable`; Task 13 (`bearer-cache.ts`) constructs `AuthResolutionError` directly for
  `AUTH-35`; Task 14 (`auth-step.ts`) uses `PlaintextCredentialError`; Task 12
  (`composing-handler.ts`)/Task 14 may use `DigestChallengeUnsupportedError` at a lower-level API (not surfaced
  by `authStep()` itself, which leaves a 401 unchanged either way).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/errors.test.ts
import {describe, expect, test} from 'bun:test';
import {AuthResolutionError, DigestChallengeUnsupportedError, PlaintextCredentialError} from './errors.js';

describe('AuthResolutionError', () => {
  test('a plain message constructs directly', () => {
    const error = new AuthResolutionError('token provider returned an expired token');
    expect(error.name).toBe('AuthResolutionError');
    expect(error.message).toContain('expired');
  });

  test('unsatisfiable() names both the required and available schemes', () => {
    const error = AuthResolutionError.unsatisfiable(['BASIC', 'DIGEST'], ['API_KEY']);
    expect(error.message).toContain('BASIC');
    expect(error.message).toContain('DIGEST');
    expect(error.message).toContain('API_KEY');
  });

  test('unsatisfiable() also carries them as indexable fields, not only as prose (AUTH-6)', () => {
    const error = AuthResolutionError.unsatisfiable(['BASIC', 'DIGEST'], ['API_KEY']);
    expect(error.requiredSchemes).toEqual(['BASIC', 'DIGEST']); // preference order preserved
    expect(error.availableSchemes).toEqual(['API_KEY']);
  });
});

describe('PlaintextCredentialError', () => {
  test('names the step and the resolved scheme', () => {
    const error = new PlaintextCredentialError('authStep', 'BASIC');
    expect(error.message).toContain('authStep');
    expect(error.message).toContain('BASIC');
  });

  test('carries them as fields too (error-handling.md:44)', () => {
    const error = new PlaintextCredentialError('authStep', 'BASIC');
    expect(error.stepName).toBe('authStep');
    expect(error.scheme).toBe('BASIC');
  });
});

describe('DigestChallengeUnsupportedError', () => {
  test('names the rejected algorithm and qop', () => {
    const error = new DigestChallengeUnsupportedError('MD4', 'auth-int');
    expect(error.message).toContain('MD4');
    expect(error.message).toContain('auth-int');
  });

  test('tolerates an absent algorithm/qop', () => {
    const error = new DigestChallengeUnsupportedError(undefined, undefined);
    expect(error).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * AUTH-4 (unsatisfiable resolved tier) and AUTH-35 (null/pre-expired TokenProvider result).
 *
 * The scheme lists are `readonly` FIELDS, not only interpolated prose. AUTH-6 requires the error to "carry
 * both the required schemes in preference order and the available schemes", and
 * `docs/knowledge/error-handling.md:44` is explicit that "structured identifying fields belong on the error
 * object itself, not only embedded in the message string, so a log aggregator can index them without parsing
 * prose" (`:6`: they must "survive serialization and appear in structured logs"). They are absent on the
 * AUTH-35 construction path, which carries no scheme lists.
 */
export class AuthResolutionError extends DexpaceError {
  readonly requiredSchemes: readonly string[] | undefined;
  readonly availableSchemes: readonly string[] | undefined;

  constructor(message: string, requiredSchemes?: readonly string[], availableSchemes?: readonly string[]) {
    super(message);
    this.requiredSchemes = requiredSchemes;
    this.availableSchemes = availableSchemes;
  }

  static unsatisfiable(requiredSchemes: readonly string[], availableSchemes: readonly string[]): AuthResolutionError {
    return new AuthResolutionError(
      `no requirement is satisfiable; required one of [${requiredSchemes.join(', ')}], available: [${availableSchemes.join(', ')}]`,
      [...requiredSchemes],
      [...availableSchemes],
    );
  }
}

/** AUTH-28: a credential would be sent over a non-HTTPS URL. Step name and scheme are fields as well as
 *  message text, for the same error-handling.md:6/:44 reason as AuthResolutionError above. */
export class PlaintextCredentialError extends DexpaceError {
  readonly stepName: string;
  readonly scheme: string;

  constructor(stepName: string, scheme: string) {
    super(`${stepName} refuses to send a ${scheme} credential over a non-HTTPS URL`);
    this.stepName = stepName;
    this.scheme = scheme;
  }
}

/** Every configured Digest handler declined a challenge -- unsupported algorithm/qop combination. */
export class DigestChallengeUnsupportedError extends DexpaceError {
  readonly algorithm: string | undefined;
  readonly qop: string | undefined;

  constructor(algorithm: string | undefined, qop: string | undefined) {
    super(`no configured Digest handler supports algorithm=${algorithm ?? '(default)'} qop=${qop ?? '(none)'}`);
    this.algorithm = algorithm;
    this.qop = qop;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/errors.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/errors.ts packages/core/src/auth/errors.test.ts
git commit -m "feat(core): auth error leaves -- resolution, plaintext credential, digest-unsupported"
```

---

### Task 2: `scheme.ts` — the recognized scheme set

**Files:**
- Create: `packages/core/src/auth/scheme.ts`
- Test: `packages/core/src/auth/scheme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type AuthScheme = 'OAUTH2' | 'API_KEY' | 'BASIC' | 'DIGEST' | 'NO_AUTH'`; `AUTH_SCHEMES: readonly
  AuthScheme[]` (for test enumeration and any future validation, not otherwise consumed downstream). Tasks 3–14
  all import `AuthScheme`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/scheme.test.ts
// Exercises: AUTH-1 (the recognized set is exactly these five; NO_AUTH is a sentinel, not a wire scheme).
import {describe, expect, test} from 'bun:test';
import {AUTH_SCHEMES, type AuthScheme} from './scheme.js';

describe('AUTH_SCHEMES', () => {
  test('is exactly the five recognized schemes', () => {
    expect([...AUTH_SCHEMES].sort()).toEqual(['API_KEY', 'BASIC', 'DIGEST', 'NO_AUTH', 'OAUTH2']);
  });

  test('every member type-checks as AuthScheme', () => {
    const check: readonly AuthScheme[] = AUTH_SCHEMES;
    expect(check.length).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/scheme.test.ts`
Expected: FAIL — `Cannot find module './scheme.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/scheme.ts

/**
 * AUTH-1: the recognized auth scheme set. NO_AUTH is a distinct sentinel meaning "may run anonymously / skip
 * credential stamping," not a wire scheme -- no TypeScript `enum` (erasableSyntaxOnly bars it, same call 4c/5a
 * already made for `Stage`).
 */
export type AuthScheme = 'OAUTH2' | 'API_KEY' | 'BASIC' | 'DIGEST' | 'NO_AUTH';

// `as const` is what earns the CONSTANT_CASE: docs/knowledge/naming-conventions.md:14 reserves that casing for
// values that are "deeply immutable", testing each by asking whether a field could change after construction.
// A bare `readonly AuthScheme[]` annotation is a compile-time claim only -- the array is still mutable at
// runtime through a cast -- so it would have to stay lowerCamelCase.
export const AUTH_SCHEMES = ['OAUTH2', 'API_KEY', 'BASIC', 'DIGEST', 'NO_AUTH'] as const satisfies readonly AuthScheme[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/scheme.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/scheme.ts packages/core/src/auth/scheme.test.ts
git commit -m "feat(core): the recognized AuthScheme set (AUTH-1)"
```

---

### Task 3: `requirement.ts` — `AuthRequirement`

**Files:**
- Create: `packages/core/src/auth/requirement.ts`
- Test: `packages/core/src/auth/requirement.test.ts`

**Interfaces:**
- Consumes: `AuthScheme` from `./scheme.js`.
- Produces: `interface AuthRequirement {scheme, scopes, params}`; `createAuthRequirement(scheme, scopes?,
  params?): AuthRequirement`; `authRequirementsEqual(a, b): boolean`. Task 4 (`descriptor.ts`) and Task 5
  (`resolve.ts`) consume all three.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/requirement.test.ts
// Exercises: AUTH-2 (frozen data shape, defensive copies of scopes/params, value equality).
import {describe, expect, test} from 'bun:test';
import {authRequirementsEqual, createAuthRequirement} from './requirement.js';

describe('createAuthRequirement', () => {
  test('defaults scopes to empty and params to an empty map', () => {
    const requirement = createAuthRequirement('BASIC');
    expect(requirement.scopes).toEqual([]);
    expect(requirement.params.size).toBe(0);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(createAuthRequirement('BASIC'))).toBe(true);
  });

  test('defensively copies the scopes array', () => {
    const scopes = ['read'];
    const requirement = createAuthRequirement('OAUTH2', scopes);
    scopes.push('write');
    expect(requirement.scopes).toEqual(['read']);
  });

  test('defensively copies the params map', () => {
    const params = new Map([['tenant', 'a']]);
    const requirement = createAuthRequirement('OAUTH2', [], params);
    params.set('tenant', 'b');
    expect(requirement.params.get('tenant')).toBe('a');
  });
});

describe('authRequirementsEqual', () => {
  test('true for identical scheme/scopes/params, regardless of construction order', () => {
    const a = createAuthRequirement('OAUTH2', ['read', 'write'], new Map([['tenant', 'x']]));
    const b = createAuthRequirement('OAUTH2', ['read', 'write'], new Map([['tenant', 'x']]));
    expect(authRequirementsEqual(a, b)).toBe(true);
  });

  test('false for a differing scheme', () => {
    expect(authRequirementsEqual(createAuthRequirement('BASIC'), createAuthRequirement('DIGEST'))).toBe(false);
  });

  test('false for differing scopes', () => {
    const a = createAuthRequirement('OAUTH2', ['read']);
    const b = createAuthRequirement('OAUTH2', ['write']);
    expect(authRequirementsEqual(a, b)).toBe(false);
  });

  test('false for differing params', () => {
    const a = createAuthRequirement('OAUTH2', [], new Map([['tenant', 'x']]));
    const b = createAuthRequirement('OAUTH2', [], new Map([['tenant', 'y']]));
    expect(authRequirementsEqual(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/requirement.test.ts`
Expected: FAIL — `Cannot find module './requirement.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/requirement.ts
import type {AuthScheme} from './scheme.js';

/** AUTH-2: a frozen data shape plus a pure equality function -- same "data and functions, not objects" call
 *  4a/4c already made for context types and Stage. */
export interface AuthRequirement {
  readonly scheme: AuthScheme;
  /** Meaningful only for OAUTH2; preserved verbatim, never inspected by resolution itself. */
  readonly scopes: readonly string[];
  readonly params: ReadonlyMap<string, string>;
}

export function createAuthRequirement(
  scheme: AuthScheme,
  scopes: readonly string[] = [],
  params: ReadonlyMap<string, string> = new Map(),
): AuthRequirement {
  // `Object.freeze` is SHALLOW (docs/knowledge/data-modeling.md:42: a frozen value object "must hold only
  // primitives or already-frozen/ReadonlyArray values, never a mutable object that would remain writable
  // after freezing"). A `new Map(params)` satisfies AUTH-2's literal clause -- caller-side mutation after
  // construction cannot reach the stored value -- but leaves the map itself writable behind the
  // `ReadonlyMap` type, so the freeze would advertise an immutability the params half does not have.
  // Freezing the entry tuples and rebuilding the Map from them on read is not worth it for a value this
  // small and this rarely read; instead the copy is made once here and NO code in this package ever
  // re-casts `AuthRequirement['params']` back to `Map` (AUTH-2 also forbids resolution inspecting params at
  // all), which is what makes the ReadonlyMap type honest in practice.
  return Object.freeze({scheme, scopes: Object.freeze([...scopes]), params: new Map(params)});
}

function scopesEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((scope, index) => scope === b[index]);
}

function paramsEqual(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

export function authRequirementsEqual(a: AuthRequirement, b: AuthRequirement): boolean {
  return a.scheme === b.scheme && scopesEqual(a.scopes, b.scopes) && paramsEqual(a.params, b.params);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/requirement.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/requirement.ts packages/core/src/auth/requirement.test.ts
git commit -m "feat(core): AuthRequirement -- frozen data shape + value equality (AUTH-2)"
```

---

### Task 4: `descriptor.ts` — `AuthDescriptor`

**Files:**
- Create: `packages/core/src/auth/descriptor.ts`
- Test: `packages/core/src/auth/descriptor.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `AuthRequirement` from `./requirement.js`.
- Produces: `interface AuthDescriptor {requirements, allowsAnonymous}`; `createAuthDescriptor(requirements):
  AuthDescriptor`. Task 5 (`resolve.ts`) and Task 14 (`auth-step.ts`, via `AuthStepSettings`/`AuthTiers`) consume
  both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/descriptor.test.ts
// Exercises: AUTH-3 (non-empty, immutable, ordered; empty list rejected as a programmer error, not a typed
// AuthResolutionError -- see Global Constraints' correction of the design doc's "reused ArgumentError" note).
import {describe, expect, test} from 'bun:test';
import {createAuthDescriptor} from './descriptor.js';
import {createAuthRequirement} from './requirement.js';

describe('createAuthDescriptor', () => {
  test('preserves requirement order', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('DIGEST'), createAuthRequirement('BASIC')]);
    expect(descriptor.requirements.map((r) => r.scheme)).toEqual(['DIGEST', 'BASIC']);
  });

  test('allowsAnonymous is true iff any requirement is NO_AUTH', () => {
    expect(createAuthDescriptor([createAuthRequirement('NO_AUTH')]).allowsAnonymous).toBe(true);
    expect(createAuthDescriptor([createAuthRequirement('BASIC')]).allowsAnonymous).toBe(false);
    expect(
      createAuthDescriptor([createAuthRequirement('BASIC'), createAuthRequirement('NO_AUTH')]).allowsAnonymous,
    ).toBe(true);
  });

  test('rejects an empty requirement list (AUTH-3) -- a programmer error, not AuthResolutionError', () => {
    expect(() => createAuthDescriptor([])).toThrow();
  });

  test('is frozen, including the requirements array', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.requirements)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/descriptor.test.ts`
Expected: FAIL — `Cannot find module './descriptor.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/descriptor.ts
import {invariant} from '../invariant.js';
import type {AuthRequirement} from './requirement.js';

/** AUTH-3: non-empty, immutable, ordered (preference order). */
export interface AuthDescriptor {
  readonly requirements: readonly AuthRequirement[];
  readonly allowsAnonymous: boolean;
}

/**
 * AUTH-3: an empty list is a PROGRAMMER error -- a caller assembling zero requirements has a bug, not an
 * operational failure -- so it uses `invariant()`, not a new error leaf (Global Constraints).
 */
export function createAuthDescriptor(requirements: readonly AuthRequirement[]): AuthDescriptor {
  invariant(requirements.length > 0, 'AuthDescriptor requires at least one AuthRequirement');
  return Object.freeze({
    requirements: Object.freeze([...requirements]),
    allowsAnonymous: requirements.some((requirement) => requirement.scheme === 'NO_AUTH'),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/descriptor.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/descriptor.ts packages/core/src/auth/descriptor.test.ts
git commit -m "feat(core): AuthDescriptor -- non-empty, ordered requirement list (AUTH-3)"
```

---

### Task 5: `resolve.ts` — tier selection

**Files:**
- Create: `packages/core/src/auth/resolve.ts`
- Test: `packages/core/src/auth/resolve.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `AuthScheme` from `./scheme.js`; `AuthRequirement` from
  `./requirement.js`; `AuthDescriptor` from `./descriptor.js`; `AuthResolutionError` from `./errors.js`.
- Produces: `interface AuthTiers {perCall?, operation?, client?}`; `resolveAuthRequirement(tiers,
  availableSchemes): AuthRequirement`. Task 14 (`auth-step.ts`) consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/resolve.test.ts
// Exercises: AUTH-4 (perCall ?? operation ?? client, first PRESENT wins, no fallthrough on failure), AUTH-5
// (first requirement whose scheme is NO_AUTH or in availableSchemes wins), AUTH-6 (all tiers absent is a
// programmer error), AUTH-7 (pure function, no hidden state).
import {describe, expect, test} from 'bun:test';
import {createAuthDescriptor} from './descriptor.js';
import {AuthResolutionError} from './errors.js';
import {createAuthRequirement} from './requirement.js';
import {resolveAuthRequirement} from './resolve.js';

describe('tier selection (AUTH-4)', () => {
  test('perCall wins when present, even if operation/client are also present', () => {
    const requirement = resolveAuthRequirement(
      {
        perCall: createAuthDescriptor([createAuthRequirement('BASIC')]),
        operation: createAuthDescriptor([createAuthRequirement('DIGEST')]),
        client: createAuthDescriptor([createAuthRequirement('API_KEY')]),
      },
      new Set(['BASIC', 'DIGEST', 'API_KEY']),
    );
    expect(requirement.scheme).toBe('BASIC');
  });

  test('operation wins over client when perCall is absent', () => {
    const requirement = resolveAuthRequirement(
      {operation: createAuthDescriptor([createAuthRequirement('DIGEST')]), client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
      new Set(['DIGEST', 'API_KEY']),
    );
    expect(requirement.scheme).toBe('DIGEST');
  });

  test('a lower tier is NEVER consulted once a higher one is present, even if unsatisfiable', () => {
    expect(() =>
      resolveAuthRequirement(
        {
          perCall: createAuthDescriptor([createAuthRequirement('DIGEST')]),
          client: createAuthDescriptor([createAuthRequirement('BASIC')]),
        },
        new Set(['BASIC']), // would satisfy client's tier, but perCall is present and DIGEST isn't available
      ),
    ).toThrow(AuthResolutionError);
  });
});

describe('within-descriptor selection (AUTH-5)', () => {
  test('the first requirement whose scheme is available wins, in preference order', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('OAUTH2'), createAuthRequirement('BASIC')]);
    const requirement = resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
    expect(requirement.scheme).toBe('BASIC');
  });

  test('NO_AUTH always wins regardless of availableSchemes', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH'), createAuthRequirement('BASIC')]);
    const requirement = resolveAuthRequirement({client: descriptor}, new Set());
    expect(requirement.scheme).toBe('NO_AUTH');
  });

  test('an unsatisfiable descriptor throws AuthResolutionError naming both schemes', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('DIGEST')]);
    try {
      resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthResolutionError);
      expect((error as Error).message).toContain('DIGEST');
      expect((error as Error).message).toContain('BASIC');
    }
  });
});

describe('AUTH-6: all tiers absent', () => {
  test('is a programmer error, not AuthResolutionError', () => {
    expect(() => resolveAuthRequirement({}, new Set())).toThrow();
    expect(() => resolveAuthRequirement({}, new Set())).not.toThrow(AuthResolutionError);
  });
});

describe('AUTH-7: purity', () => {
  test('the same inputs always resolve to an equal requirement', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const first = resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
    const second = resolveAuthRequirement({client: descriptor}, new Set(['BASIC']));
    expect(first).toBe(second); // same object identity -- resolve() picks from the existing descriptor, builds nothing new
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/resolve.ts
import {invariant} from '../invariant.js';
import type {AuthDescriptor} from './descriptor.js';
import {AuthResolutionError} from './errors.js';
import type {AuthRequirement} from './requirement.js';
import type {AuthScheme} from './scheme.js';

export interface AuthTiers {
  readonly perCall?: AuthDescriptor | undefined;
  readonly operation?: AuthDescriptor | undefined;
  readonly client?: AuthDescriptor | undefined;
}

/**
 * AUTH-4/AUTH-5/AUTH-7: a pure function over three optional tiers, no class, no hidden state. Tier selection
 * is `perCall ?? operation ?? client`, the FIRST PRESENT one -- not a fallthrough on failure: if the selected
 * tier is unsatisfiable, `AuthResolutionError` is thrown naming it; a lower tier is never consulted.
 *
 * AUTH-6: all tiers absent is a PROGRAMMER error (a caller forgot to configure anything), so it uses
 * `invariant()`, not `AuthResolutionError` -- see Global Constraints' correction of the design doc's assumed
 * `ArgumentError`.
 */
export function resolveAuthRequirement(tiers: AuthTiers, availableSchemes: ReadonlySet<AuthScheme>): AuthRequirement {
  const descriptor = tiers.perCall ?? tiers.operation ?? tiers.client;
  invariant(descriptor !== undefined, 'resolveAuthRequirement: at least one auth tier must be configured');

  const match = descriptor.requirements.find(
    (requirement) => requirement.scheme === 'NO_AUTH' || availableSchemes.has(requirement.scheme),
  );
  if (match === undefined) {
    const requiredSchemes = descriptor.requirements.map((requirement) => requirement.scheme);
    throw AuthResolutionError.unsatisfiable(requiredSchemes, [...availableSchemes]);
  }
  return match;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/resolve.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/resolve.ts packages/core/src/auth/resolve.test.ts
git commit -m "feat(core): auth tier resolution (AUTH-4..7)"
```

---

### Task 6: `credential.ts` — `BearerToken`, `ApiKeyCredential`, `NameKeyCredential`, `TokenProvider`

**Files:**
- Create: `packages/core/src/auth/credential.ts`
- Test: `packages/core/src/auth/credential.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`.
- Produces: `interface BearerToken {token, expiresAt}`; `createBearerToken(token, expiresAt?): BearerToken`;
  `bearerTokensEqual(a, b): boolean`; `isBearerTokenExpired(token, nowMs, marginMs): boolean`; `class
  ApiKeyCredential` (`constructor(key)`, `get key()`, redacted `toString`/inspect); `class NameKeyCredential`
  (`constructor(name, key)`, `name`, `get key()`, redacted `toString`/inspect); `type TokenProvider = () =>
  Promise<BearerToken>`. Task 11 (`static-key.ts`) consumes `ApiKeyCredential`/`NameKeyCredential`; Task 13
  (`bearer-cache.ts`) consumes `BearerToken`/`isBearerTokenExpired`/`TokenProvider`; Task 14 (`auth-step.ts`)
  consumes all of it.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/credential.test.ts
// Exercises: AUTH-8 (BearerToken is value-equal; ApiKeyCredential/NameKeyCredential are reference-equal via
// bare `===`, no equals() override), AUTH-9 (blank rejected as a programmer error), AUTH-10 (expiry math:
// undefined never locally expires; expired iff nowMs+marginMs > expiresAt).
import {describe, expect, test} from 'bun:test';
import {
  ApiKeyCredential,
  NameKeyCredential,
  bearerTokensEqual,
  createBearerToken,
  isBearerTokenExpired,
} from './credential.js';

describe('BearerToken', () => {
  test('value equality over token + expiry', () => {
    const a = createBearerToken('t', 1000);
    const b = createBearerToken('t', 1000);
    expect(bearerTokensEqual(a, b)).toBe(true);
  });

  test('differing token or expiry is not equal', () => {
    expect(bearerTokensEqual(createBearerToken('a'), createBearerToken('b'))).toBe(false);
    expect(bearerTokensEqual(createBearerToken('t', 1), createBearerToken('t', 2))).toBe(false);
  });

  test('rejects a blank or whitespace-only token (AUTH-9)', () => {
    expect(() => createBearerToken('')).toThrow();
    expect(() => createBearerToken('   ')).toThrow();
  });

  test('undefined expiresAt never locally expires (AUTH-10)', () => {
    const token = createBearerToken('t');
    expect(isBearerTokenExpired(token, Number.MAX_SAFE_INTEGER, 0)).toBe(false);
  });

  test('expired iff nowMs + marginMs > expiresAt (AUTH-10)', () => {
    const token = createBearerToken('t', 1000);
    expect(isBearerTokenExpired(token, 999, 0)).toBe(false);
    expect(isBearerTokenExpired(token, 1000, 0)).toBe(false); // exactly at expiry, not yet past it
    expect(isBearerTokenExpired(token, 1001, 0)).toBe(true);
    expect(isBearerTokenExpired(token, 900, 200)).toBe(true); // margin pushes it over
  });
});

describe('ApiKeyCredential (AUTH-8)', () => {
  test('two instances with identical fields are NOT equal -- reference identity only', () => {
    expect(new ApiKeyCredential('secret') === new ApiKeyCredential('secret')).toBe(false);
  });

  test('toString and inspect redact the key', () => {
    const credential = new ApiKeyCredential('super-secret');
    expect(credential.toString()).not.toContain('super-secret');
    expect(String(credential)).not.toContain('super-secret');
  });

  test('rejects a blank or whitespace-only key (AUTH-9)', () => {
    expect(() => new ApiKeyCredential('')).toThrow();
    expect(() => new ApiKeyCredential('   ')).toThrow();
  });

  test('.key exposes the real value for legitimate internal use', () => {
    expect(new ApiKeyCredential('secret').key).toBe('secret');
  });
});

describe('NameKeyCredential (AUTH-8)', () => {
  test('two instances with identical fields are NOT equal', () => {
    expect(new NameKeyCredential('n', 'k') === new NameKeyCredential('n', 'k')).toBe(false);
  });

  test('toString redacts the key but names the name', () => {
    const credential = new NameKeyCredential('x-api-key', 'super-secret');
    expect(credential.toString()).toContain('x-api-key');
    expect(credential.toString()).not.toContain('super-secret');
  });

  test('rejects a blank or whitespace-only name or key (AUTH-9)', () => {
    expect(() => new NameKeyCredential('', 'k')).toThrow();
    expect(() => new NameKeyCredential('n', '')).toThrow();
    expect(() => new NameKeyCredential('  ', 'k')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/credential.test.ts`
Expected: FAIL — `Cannot find module './credential.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/credential.ts
import {invariant} from '../invariant.js';

/** AUTH-8: value equality over token + expiry -- a frozen data object, same shape as AuthRequirement. */
export interface BearerToken {
  readonly token: string;
  /** Epoch ms; `undefined` means "never locally expires" (AUTH-10). */
  readonly expiresAt: number | undefined;
}

export function createBearerToken(token: string, expiresAt?: number): BearerToken {
  invariant(token.trim().length > 0, 'bearer token must not be blank'); // AUTH-9
  return Object.freeze({token, expiresAt});
}

export function bearerTokensEqual(a: BearerToken, b: BearerToken): boolean {
  return a.token === b.token && a.expiresAt === b.expiresAt;
}

/** AUTH-10: expired iff a finite expiry is set and nowMs + marginMs strictly exceeds it. */
export function isBearerTokenExpired(token: BearerToken, nowMs: number, marginMs: number): boolean {
  return token.expiresAt !== undefined && nowMs + marginMs > token.expiresAt;
}

// No `as unique symbol` cast: TypeScript rejects `unique symbol` in a type assertion (TS1335). A `const`
// initialized directly by a `Symbol.for()` call already gets the `unique symbol` type, which is what makes it
// usable as a computed member name below.
const INSPECT: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * AUTH-8: needs REFERENCE equality ("two instances with identical fields are NOT equal") -- a class with a
 * private field and no `equals` override, so `===` already gives the required semantics for free.
 *
 * `#key`, not `private key`, is the one deliberate exception to `docs/knowledge/data-modeling.md:20`'s
 * `private`-by-default rule, and `:22` requires this justification be written down: AUTH-8's redaction is a
 * RUNTIME-privacy requirement, not a compile-time one. `private` is erased, leaving the secret reachable via
 * `credential['key']`, `Object.keys`, `JSON.stringify`, and a default `util.inspect` -- exactly the accidental
 * leak paths the redacted `toString`/inspect exist to close. `#key` is genuinely unreachable, and the
 * nominality it induces is load-bearing besides: it is what stops a caller substituting an object literal for
 * a validated credential.
 */
export class ApiKeyCredential {
  readonly #key: string;

  constructor(key: string) {
    invariant(key.trim().length > 0, 'ApiKeyCredential key must not be blank'); // AUTH-9
    this.#key = key;
  }

  get key(): string {
    return this.#key;
  }

  toString(): string {
    return 'ApiKeyCredential{key=***}';
  }

  [INSPECT](): string {
    return this.toString();
  }
}

/** `#key` for the same runtime-privacy reason as `ApiKeyCredential` above; `name` is non-secret (AUTH-8
 *  permits it visible) so it stays an ordinary public field. */
export class NameKeyCredential {
  readonly name: string;
  readonly #key: string;

  constructor(name: string, key: string) {
    invariant(name.trim().length > 0, 'NameKeyCredential name must not be blank'); // AUTH-9
    invariant(key.trim().length > 0, 'NameKeyCredential key must not be blank'); // AUTH-9
    this.name = name;
    this.#key = key;
  }

  get key(): string {
    return this.#key;
  }

  toString(): string {
    return `NameKeyCredential{name=${this.name}, key=***}`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

/**
 * AUTH-11: a plain async function type, no class. A throwing/rejecting provider propagates and is never
 * cached -- bearer-cache.ts simply doesn't catch around the call.
 *
 * The options bag is the cancellation contract. A token fetch is external I/O on the request path, and
 * `docs/knowledge/concurrency-and-async.md:44` is explicit that "a signal accepted at the top of a call chain
 * must be passed through every layer down to the actual I/O primitive; a signal that stops at the first
 * function is decoration." 5a Task 1 already exposes the call's signal as `StepContext.signal`, so the step
 * has one to pass; without this parameter a hung provider pins the auth step, every retry attempt nested
 * under it, and the whole request, with no way for the caller to abort. The parameter is optional so a
 * provider that does not care can still be written `async () => token`.
 *
 * A provider SHOULD combine the supplied signal with its own deadline
 * (`AbortSignal.any([signal, AbortSignal.timeout(ms)])`, per `concurrency-and-async.md:26`) rather than
 * waiting unbounded on its identity provider.
 */
export type TokenProvider = (options?: {readonly signal?: AbortSignal | undefined}) => Promise<BearerToken>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/credential.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/credential.ts packages/core/src/auth/credential.test.ts
git commit -m "feat(core): bearer/API-key/name-key credential types (AUTH-8..11)"
```

---

### Task 7: `challenge.ts` — the RFC 7235 challenge parser + `ChallengeHandler`

The second-largest function in this phase, after `auth-step.ts`. Total by construction (`AUTH-13`): never
throws for any input.

**Files:**
- Create: `packages/core/src/auth/challenge.ts`
- Test: `packages/core/src/auth/challenge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Challenge {scheme, params}`; `interface DigestUriContext {method, requestTarget}`;
  `interface ChallengeHandler {canHandle(challenge): boolean; stamp(challenge, isProxy, request?): Promise<string>;
  rank?(challenge): number}` (Plan-time decision 3: lives here, not `composing-handler.ts`, so Tasks 9 and 10 can
  implement it before Task 12 exists; see the three plan-time notes inline with the interface below for why
  `stamp` is async, optionally takes a `request`, and why `rank` exists); `parseChallenges(headerValue): readonly
  Challenge[]`. Tasks 9, 10, 12, 14 all consume `Challenge`/`ChallengeHandler`/`DigestUriContext`; Task 14
  consumes `parseChallenges`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/challenge.test.ts
// Exercises: AUTH-12 (scheme/param names lower-cased, values verbatim), AUTH-13 (total: blank -> [], malformed
// recovers at the next top-level comma, unterminated quote ends at EOF, params before a malformed tail kept),
// the multi-challenge/comma-ambiguity case that is the whole reason this parser can't be `.split(',')`.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {parseChallenges} from './challenge.js';

describe('a single challenge', () => {
  test('scheme and param names are lower-cased; values are verbatim', () => {
    const [challenge] = parseChallenges('BASIC Realm="MixedCase"');
    expect(challenge?.scheme).toBe('basic');
    expect(challenge?.params.get('realm')).toBe('MixedCase');
  });

  test('a bare scheme with no params gets an empty parameter map', () => {
    const [challenge] = parseChallenges('NTLM');
    expect(challenge?.scheme).toBe('ntlm');
    expect(challenge?.params.size).toBe(0);
  });

  test('a token68 value is recorded under the synthetic key', () => {
    const [challenge] = parseChallenges('Negotiate a87421000492aa874209af8bc028');
    expect(challenge?.scheme).toBe('negotiate');
    // AUTH-12 names this key literally as 'token68'.
    expect(challenge?.params.get('token68')).toBe('a87421000492aa874209af8bc028');
  });
});

describe('multiple comma-separated challenges', () => {
  test('a top-level comma between two DIFFERENT auth-params of the SAME challenge does not start a new one', () => {
    const challenges = parseChallenges('Digest realm="a", nonce="n", qop="auth"');
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.params.get('realm')).toBe('a');
    expect(challenges[0]?.params.get('nonce')).toBe('n');
    expect(challenges[0]?.params.get('qop')).toBe('auth');
  });

  test('two distinct challenges are both recovered, each with its own params', () => {
    const challenges = parseChallenges('Basic realm="a", Digest realm="b", nonce="n"');
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).toEqual({scheme: 'basic', params: new Map([['realm', 'a']])});
    expect(challenges[1]?.scheme).toBe('digest');
    expect(challenges[1]?.params.get('realm')).toBe('b');
    expect(challenges[1]?.params.get('nonce')).toBe('n');
  });

  test('a comma INSIDE a quoted value never splits the challenge', () => {
    const [challenge] = parseChallenges('Digest realm="a, b", nonce="n"');
    expect(challenge?.params.get('realm')).toBe('a, b');
    expect(challenge?.params.get('nonce')).toBe('n');
  });
});

describe('quoted-string handling', () => {
  test('a backslash escape is unquoted', () => {
    const [challenge] = parseChallenges(String.raw`Digest realm="a\"b"`);
    expect(challenge?.params.get('realm')).toBe('a"b');
  });

  test('an unterminated quoted string terminates at end-of-input (AUTH-13)', () => {
    const [challenge] = parseChallenges('Digest realm="abc');
    expect(challenge?.params.get('realm')).toBe('abc');
  });
});

describe('totality and recovery (AUTH-13)', () => {
  test('blank input yields an empty list', () => {
    expect(parseChallenges('')).toEqual([]);
    expect(parseChallenges('   ')).toEqual([]);
  });

  test('a malformed segment recovers at the next top-level comma, keeping prior params', () => {
    const challenges = parseChallenges('Digest realm="a", =bad, Basic realm="b"');
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).toEqual({scheme: 'digest', params: new Map([['realm', 'a']])});
    expect(challenges[1]).toEqual({scheme: 'basic', params: new Map([['realm', 'b']])});
  });

  test('property: never throws for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(() => parseChallenges(raw)).not.toThrow();
      }),
    );
  });

  test('property: a well-formed single challenge round-trips scheme + one param exactly', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{1,10}$/u),
        fc.stringMatching(/^[a-zA-Z0-9 ]{0,20}$/u),
        (scheme, value) => {
          const [challenge] = parseChallenges(`${scheme} realm="${value}"`);
          expect(challenge?.scheme).toBe(scheme.toLowerCase());
          expect(challenge?.params.get('realm')).toBe(value);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/challenge.test.ts`
Expected: FAIL — `Cannot find module './challenge.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/challenge.ts

/** AUTH-12: scheme + a lower-cased-key parameter map, verbatim unquoted values. */
export interface Challenge {
  readonly scheme: string;
  readonly params: ReadonlyMap<string, string>;
}

/**
 * Plan-time decision 3: lives here (not composing-handler.ts) so basic.ts/digest.ts can implement it before
 * composing-handler.ts exists.
 *
 * Plan-time correction (stamp is async): the design doc's prose gives `stamp()` a synchronous `string` return.
 * That cannot hold once Digest's SHA-256/SHA-256-sess algorithms are implemented (Task 10) -- they compute
 * HA1/HA2/response via `crypto.subtle.digest()`, which is asynchronous, and there is no synchronous Web Crypto
 * API to fall back to. `stamp()` returns `Promise<string>` here; Basic's implementation (Task 9) simply
 * resolves immediately.
 *
 * Plan-time addition (optional `rank`): AUTH-16 requires Digest to prefer "the earliest match in a configured
 * preference list, not wire order" when a server offers MULTIPLE separate Digest challenges differing only by
 * algorithm (RFC 7616 anticipates this as a discovery mechanism). `canHandle`/`stamp` alone can't express an
 * ordering PREFERENCE among several challenges a handler could equally satisfy -- only a yes/no per challenge.
 * `rank` is optional (default 0, meaning "no preference") so Basic (Task 9, one scheme, no algorithm variants)
 * never needs to implement it; `composing-handler.ts` (Task 12) uses it as a secondary sort key, after handler
 * configuration order.
 *
 * Plan-time addition (optional `request` on `stamp`): Digest's response computation (Task 10) needs the
 * request's METHOD and request-target (digest-uri) for HA2 -- `challenge`/`isProxy` alone carry neither. The
 * third parameter is optional so Basic's already-written 2-argument call sites (Task 9) stay valid (TypeScript
 * permits calling an interface method without a trailing optional argument); Digest's `stamp()` asserts it is
 * present via `invariant()`, since Digest structurally cannot proceed without it.
 */
export interface DigestUriContext {
  readonly method: string;
  readonly requestTarget: string;
}

export interface ChallengeHandler {
  canHandle(challenge: Challenge): boolean;
  /** Returns the header VALUE only -- the caller (auth-step.ts) picks Authorization vs Proxy-Authorization. */
  stamp(challenge: Challenge, isProxy: boolean, request?: DigestUriContext): Promise<string>;
  /** Lower is more preferred among multiple challenges this handler can satisfy. Default: 0 (no preference). */
  rank?(challenge: Challenge): number;
}

/**
 * AUTH-12 names this key literally: "a token68 value recorded under the synthetic parameter key 'token68'".
 * An earlier draft used `'__token68__'` to avoid colliding with a real auth-param of the same name; that is a
 * deviation from a MUST with a spelled-out value, and Phase 9's conformance sweep reads AUTH-12 verbatim, so
 * the requirement's own spelling wins. A genuine `token68=...` auth-param does not exist in RFC 7235's grammar
 * (token68 is positional, never `name=value`), so the collision the `__` guarded against cannot occur.
 */
const TOKEN68_KEY = 'token68';
const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/u;
const TOKEN68_CHAR = /[A-Za-z0-9\-._~+/]/u;

interface Scanner {
  readonly text: string;
  pos: number;
}

function skipSpaces(s: Scanner): void {
  while (s.pos < s.text.length && (s.text[s.pos] === ' ' || s.text[s.pos] === '\t')) s.pos += 1;
}

function readToken(s: Scanner): string {
  const start = s.pos;
  while (s.pos < s.text.length && TOKEN_CHAR.test(s.text[s.pos] ?? '')) s.pos += 1;
  return s.text.slice(start, s.pos);
}

function readToken68Tail(s: Scanner): string {
  const start = s.pos;
  while (s.pos < s.text.length) {
    const ch = s.text[s.pos] ?? '';
    if (TOKEN68_CHAR.test(ch) || ch === '=') {
      s.pos += 1;
      continue;
    }
    break;
  }
  return s.text.slice(start, s.pos);
}

/** Honors backslash escapes (AUTH-13). An unterminated string ends at end-of-input rather than throwing. */
function readQuotedString(s: Scanner): string {
  s.pos += 1; // opening quote, already confirmed present by the caller
  let value = '';
  while (s.pos < s.text.length) {
    const ch = s.text[s.pos];
    if (ch === '\\' && s.pos + 1 < s.text.length) {
      value += s.text[s.pos + 1];
      s.pos += 2;
      continue;
    }
    if (ch === '"') {
      s.pos += 1;
      return value;
    }
    value += ch;
    s.pos += 1;
  }
  return value;
}

/** Consumes (without capturing) up to the next top-level comma, honoring quote depth -- the recovery path for
 *  a malformed segment (AUTH-13). */
function skipToNextTopLevelComma(s: Scanner): void {
  let inQuotes = false;
  while (s.pos < s.text.length) {
    const ch = s.text[s.pos];
    if (inQuotes) {
      if (ch === '\\' && s.pos + 1 < s.text.length) {
        s.pos += 2;
        continue;
      }
      if (ch === '"') inQuotes = false;
      s.pos += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      s.pos += 1;
      continue;
    }
    if (ch === ',') {
      s.pos += 1;
      return;
    }
    s.pos += 1;
  }
}

function peekIsParamAssignment(text: string, fromPos: number): boolean {
  let i = fromPos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
  return text[i] === '=';
}

function readValue(s: Scanner): string {
  return s.text[s.pos] === '"' ? readQuotedString(s) : readToken(s);
}

interface MutableChallenge {
  readonly scheme: string;
  readonly params: Map<string, string>;
}

/** Reads one `name=value` pair into `current`'s param map. Caller has already confirmed the '=' follows. */
function readParamInto(s: Scanner, name: string, current: MutableChallenge): void {
  skipSpaces(s);
  s.pos += 1; // '='
  skipSpaces(s);
  current.params.set(name.toLowerCase(), readValue(s));
  skipSpaces(s);
  if (s.text[s.pos] === ',') s.pos += 1;
}

/** Reads the optional token68-or-first-param tail immediately following a freshly-read scheme name. */
function readSchemeTail(s: Scanner, current: MutableChallenge): void {
  skipSpaces(s);
  if (s.pos >= s.text.length || s.text[s.pos] === ',') return;
  const savedPos = s.pos;
  const maybeName = readToken(s);
  if (maybeName !== '' && peekIsParamAssignment(s.text, s.pos)) {
    readParamInto(s, maybeName, current);
    return;
  }
  s.pos = savedPos;
  const token68 = readToken68Tail(s);
  if (token68 !== '') current.params.set(TOKEN68_KEY, token68);
  skipSpaces(s);
  if (s.text[s.pos] === ',') s.pos += 1;
}

/**
 * AUTH-12/AUTH-13: parses RFC 7235 WWW-Authenticate/Proxy-Authenticate values. Total by construction -- blank
 * input yields `[]`; a malformed segment recovers at the next top-level comma via a quote-depth-tracked scan,
 * never a naive `.split(',')`, which would break on a quoted value containing a comma; params parsed before a
 * malformed tail are kept.
 */
export function parseChallenges(headerValue: string): readonly Challenge[] {
  const challenges: MutableChallenge[] = [];
  const s: Scanner = {text: headerValue, pos: 0};

  for (;;) {
    skipSpaces(s);
    if (s.pos >= s.text.length) break;
    if (s.text[s.pos] === ',') {
      s.pos += 1;
      continue;
    }

    const token = readToken(s);
    if (token === '') {
      skipToNextTopLevelComma(s);
      continue;
    }

    if (peekIsParamAssignment(s.text, s.pos)) {
      const current = challenges.at(-1);
      if (current === undefined) {
        skipToNextTopLevelComma(s);
        continue;
      }
      readParamInto(s, token, current);
      continue;
    }

    const current: MutableChallenge = {scheme: token.toLowerCase(), params: new Map()};
    challenges.push(current);
    readSchemeTail(s, current);
  }

  return challenges.map((entry) => Object.freeze({scheme: entry.scheme, params: entry.params}));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/challenge.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `parseChallenges` itself is 1 param, one loop; every helper (`readParamInto`, `readSchemeTail`,
`skipToNextTopLevelComma`, etc.) is 1-3 params and well under the depth/length caps.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth/challenge.ts packages/core/src/auth/challenge.test.ts
git commit -m "feat(core): total RFC 7235 challenge parser (AUTH-12..13)"
```

---

### Task 8: `md5.ts` — self-contained MD5

Web Crypto's `subtle.digest()` deliberately excludes MD5 (excluded from the standard on security grounds), and
RFC 7616 Digest still requires MD5/MD5-sess for interop with servers that haven't adopted SHA-256 — hence a
small, dependency-free, hand-rolled implementation (RFC 1321).

**Files:**
- Create: `packages/core/src/auth/md5.ts`
- Test: `packages/core/src/auth/md5.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `md5(message: Uint8Array): Uint8Array` (16-byte digest); `toHex(bytes: Uint8Array): string`. Task 10
  (`digest.ts`) consumes both.

- [ ] **Step 1: Write the failing test**

The four expected digests below are RFC 1321's own test vectors, independently re-verified with `hashlib.md5`
before writing this plan (`python3 -c "import hashlib; print(hashlib.md5(b'abc').hexdigest())"` etc.) rather than
quoted from memory.

```typescript
// packages/core/src/auth/md5.test.ts
// Exercises: AUTH-15..17 (MD5 correctness against RFC 1321's own test vectors).
import {describe, expect, test} from 'bun:test';
import {md5, toHex} from './md5.js';

function md5Hex(input: string): string {
  return toHex(md5(new TextEncoder().encode(input)));
}

describe('md5 (RFC 1321 test vectors)', () => {
  test('the empty string', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  test('"abc"', () => {
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  test('"message digest"', () => {
    expect(md5Hex('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0');
  });

  test('the lowercase alphabet, exercising a multi-block input', () => {
    expect(md5Hex('abcdefghijklmnopqrstuvwxyz')).toBe('c3fcd3d76192e4007dfb496cca67e13b');
  });

  test('toHex pads each byte to two lower-case hex digits', () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/md5.test.ts`
Expected: FAIL — `Cannot find module './md5.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/md5.ts

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;

// `/*#__PURE__*/`, because this is a top-level CALL, and `docs/knowledge/performance.md:48` is explicit that
// "modules must do no work at import time, since a top-level call is a side effect the bundler must preserve
// and this pins the module in the bundle." `@dexpace/core` declares `"sideEffects": false` and
// `@dexpace/shrink-test` asserts a post-tree-shake bundle budget; without the annotation a bundler cannot
// prove these 64 Math.sin calls are pure, so md5.ts (and its table) is retained by every consumer that
// imports anything transitively reaching it -- including one that never touches Digest.
// Deeply immutable via the freeze, which is what earns the CONSTANT_CASE (naming-conventions.md:14).
const CONSTANTS: readonly number[] = /*#__PURE__*/ Object.freeze(
  Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0),
);

function leftRotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** RFC 1321 §3.1: pad to a multiple of 64 bytes with a single 0x80, zeros, then the original bit length. */
function pad(message: Uint8Array): Uint8Array {
  const bitLength = BigInt(message.length) * 8n;
  const paddingLength = (((56 - ((message.length + 1) % 64)) % 64) + 64) % 64;
  const result = new Uint8Array(message.length + 1 + paddingLength + 8);
  result.set(message);
  result[message.length] = 0x80;
  new DataView(result.buffer).setBigUint64(result.length - 8, bitLength, true);
  return result;
}

function roundFunction(i: number, b: number, c: number, d: number): number {
  if (i < 16) return (b & c) | (~b & d);
  if (i < 32) return (d & b) | (~d & c);
  if (i < 48) return b ^ c ^ d;
  return c ^ (b | ~d);
}

function messageIndex(i: number): number {
  if (i < 16) return i;
  if (i < 32) return (5 * i + 1) % 16;
  if (i < 48) return (3 * i + 5) % 16;
  return (7 * i) % 16;
}

interface State {
  a: number;
  b: number;
  c: number;
  d: number;
}

function processBlock(words: readonly number[], state: State): State {
  let {a, b, c, d} = state;
  for (let i = 0; i < 64; i += 1) {
    const f = (roundFunction(i, b, c, d) + a + (CONSTANTS[i] ?? 0) + (words[messageIndex(i)] ?? 0)) >>> 0;
    a = d;
    d = c;
    c = b;
    b = (b + leftRotate(f, SHIFTS[i] ?? 0)) >>> 0;
  }
  return {a: (state.a + a) >>> 0, b: (state.b + b) >>> 0, c: (state.c + c) >>> 0, d: (state.d + d) >>> 0};
}

/** AUTH-15..17: RFC 1321 MD5, hand-rolled because Web Crypto excludes it. Pure -- no shared state, safe for
 *  concurrent invocation. */
export function md5(message: Uint8Array): Uint8Array {
  const data = pad(message);
  const view = new DataView(data.buffer);
  let state: State = {a: 0x67452301, b: 0xefcdab89, c: 0x98badcfe, d: 0x10325476};

  for (let chunkStart = 0; chunkStart < data.length; chunkStart += 64) {
    const words = Array.from({length: 16}, (_, i) => view.getUint32(chunkStart + i * 4, true));
    state = processBlock(words, state);
  }

  const digest = new Uint8Array(16);
  const outView = new DataView(digest.buffer);
  outView.setUint32(0, state.a, true);
  outView.setUint32(4, state.b, true);
  outView.setUint32(8, state.c, true);
  outView.setUint32(12, state.d, true);
  return digest;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/md5.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `processBlock` is 2 params, one loop; `md5` is 1 param, one loop calling the per-block helper.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth/md5.ts packages/core/src/auth/md5.test.ts
git commit -m "feat(core): self-contained, dependency-free MD5 (AUTH-15..17)"
```

---

### Task 9: `basic.ts` — the Basic handler

**Files:**
- Create: `packages/core/src/auth/basic.ts`
- Test: `packages/core/src/auth/basic.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `Challenge`, `ChallengeHandler` from `./challenge.js`.
- Produces: `basicHandler(username: string, password: string): ChallengeHandler`. Task 14 (`auth-step.ts`)
  constructs this from `settings.credentials.basic` (Plan-time decision 4).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/basic.test.ts
// Exercises: AUTH-14 ('Basic ' + base64(UTF-8(username:password)), computed once; accepts a basic challenge
// case-insensitively; whitespace-only credentials are PERMITTED -- RFC 7617's laxer rule, deliberately
// different from the credential types' stricter non-blank check in credential.ts).
import {describe, expect, test} from 'bun:test';
import {basicHandler} from './basic.js';

describe('basicHandler', () => {
  test('produces "Basic " + base64(UTF-8(username:password))', async () => {
    const handler = basicHandler('Aladdin', 'open sesame');
    const value = await handler.stamp({scheme: 'basic', params: new Map()}, false);
    expect(value).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  test('handles non-ASCII credentials via UTF-8 encoding', async () => {
    const handler = basicHandler('üser', 'päss');
    const value = await handler.stamp({scheme: 'basic', params: new Map()}, false);
    expect(value.startsWith('Basic ')).toBe(true);
    expect(value).not.toBe('Basic ' + btoa('üser:päss')); // a naive Latin1 btoa would differ from UTF-8 encoding
  });

  test('canHandle accepts "basic" case-insensitively (challenge.scheme is already lower-cased by parseChallenges)', () => {
    const handler = basicHandler('u', 'p');
    expect(handler.canHandle({scheme: 'basic', params: new Map()})).toBe(true);
    expect(handler.canHandle({scheme: 'digest', params: new Map()})).toBe(false);
  });

  test('whitespace-only credentials are permitted (RFC 7617, laxer than credential.ts)', () => {
    expect(() => basicHandler(' ', ' ')).not.toThrow();
  });

  test('a truly empty username or password is rejected', () => {
    expect(() => basicHandler('', 'p')).toThrow();
    expect(() => basicHandler('u', '')).toThrow();
  });

  test('the encoded value is computed once, at construction', async () => {
    const handler = basicHandler('u', 'p');
    const first = await handler.stamp({scheme: 'basic', params: new Map()}, false);
    const second = await handler.stamp({scheme: 'basic', params: new Map()}, true);
    expect(first).toBe(second); // isProxy doesn't change the VALUE -- auth-step.ts picks the header name
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/basic.test.ts`
Expected: FAIL — `Cannot find module './basic.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/basic.ts
import {invariant} from '../invariant.js';
import type {Challenge, ChallengeHandler} from './challenge.js';

function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * AUTH-14: 'Basic ' + base64(UTF-8(username:password)), computed once at construction and cached on the
 * closure -- "computed once" is the point of caching it, not a performance nicety.
 *
 * Validates non-blank-but-whitespace-permitted credentials per RFC 7617's laxer rule -- deliberately NOT the
 * stricter `.trim().length > 0` check `credential.ts`'s types use; a caller intentionally using a
 * whitespace-only password (unusual, but RFC 7617-legal) is not rejected here.
 */
export function basicHandler(username: string, password: string): ChallengeHandler {
  invariant(username.length > 0, 'Basic username must not be empty');
  invariant(password.length > 0, 'Basic password must not be empty');
  const value = `Basic ${toBase64Utf8(`${username}:${password}`)}`;

  return {
    canHandle: (challenge: Challenge): boolean => challenge.scheme === 'basic',
    stamp: (): Promise<string> => Promise.resolve(value),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/basic.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/basic.ts packages/core/src/auth/basic.test.ts
git commit -m "feat(core): Basic challenge handler (AUTH-14)"
```

---

### Task 10: `digest.ts` — the Digest handler + nonce-count store

The largest file in this phase. `computeDigestResponse` and `NonceCountStore` are exported alongside the
`digestHandler()` factory specifically so they can be unit-tested directly with FIXED inputs — `digestHandler()`
itself always generates a fresh, cryptographically random client nonce (AUTH-20), so its own `stamp()` output is
never deterministic across runs and cannot be asserted against a fixed expected hash end-to-end.

The four expected hashes below (MD5, MD5-sess, SHA-256, and the no-`qop` MD5 variant) were independently
computed with Python's `hashlib` before writing this plan — not quoted from memory — using RFC 2617/7616's own
example credentials (`Mufasa` / `testrealm@host.com` / `Circle Of Life`, method `GET`, uri `/dir/index.html`).

**Files:**
- Create: `packages/core/src/auth/digest.ts`
- Test: `packages/core/src/auth/digest.test.ts`

**Interfaces:**
- Consumes: `invariant` from `../invariant.js`; `Challenge`, `ChallengeHandler`, `DigestUriContext` from
  `./challenge.js`; `md5`, `toHex` from `./md5.js`.
- Produces: `type DigestAlgorithm = 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess'`; `interface DigestOptions
  {algorithmPreference?}`; `class NonceCountStore` (`next(nonce): number`); `interface DigestComputationInput
  {algorithm, realm, nonce, qop, useUtf8, method, uri, username, password, cnonce, nc}`;
  `computeDigestResponse(input): Promise<string>`; `digestHandler(username, password, options？): ChallengeHandler`.
  Task 12 (`composing-handler.ts`) and Task 14 (`auth-step.ts`) consume `digestHandler`; Task 14 also consumes
  `DigestAlgorithm`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/digest.test.ts
// Exercises: AUTH-15 (exactly {MD5, MD5-sess, SHA-256, SHA-256-sess}, qop=auth or absent, declines auth-int
// and unsupported algorithms), AUTH-16 (satisfiability: scheme/realm/nonce/qop/algorithm), AUTH-17
// (HA1/HA2/response per RFC 7616/2069, verified against locally-computed vectors), AUTH-18/19 (nonce count:
// starts at 1, increments only on nonce reuse, 8 lower-case hex digits, bounded eviction), AUTH-20 (client
// nonce from crypto.getRandomValues, >=128 bits), AUTH-21 (UTF-8 vs ISO-8859-1 by charset), AUTH-22
// (cnonce/nc/qop emitted only when qop negotiated), AUTH-25 (Authorization vs Proxy-Authorization is the
// CALLER's job -- stamp() returns only the value).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import type {Challenge} from './challenge.js';
import {NonceCountStore, computeDigestResponse, digestHandler} from './digest.js';

const REALM = 'testrealm@host.com';
const NONCE = 'dcd98b7102dd2f0e8b11d0f600bfb0c093';
const CNONCE = '0a4f113b';
const NC = '00000001';

function digestChallenge(params: Record<string, string>): Challenge {
  return {scheme: 'digest', params: new Map(Object.entries(params))};
}

describe('computeDigestResponse (verified against RFC 2617/7616 vectors)', () => {
  test('MD5, qop=auth', async () => {
    const response = await computeDigestResponse({
      algorithm: 'MD5', realm: REALM, nonce: NONCE, qop: true, useUtf8: true,
      method: 'GET', uri: '/dir/index.html', username: 'Mufasa', password: 'Circle Of Life',
      cnonce: CNONCE, nc: NC,
    });
    expect(response).toBe('6629fae49393a05397450978507c4ef1');
  });

  test('MD5, no qop (RFC 2069 form)', async () => {
    const response = await computeDigestResponse({
      algorithm: 'MD5', realm: REALM, nonce: NONCE, qop: false, useUtf8: true,
      method: 'GET', uri: '/dir/index.html', username: 'Mufasa', password: 'Circle Of Life',
      cnonce: CNONCE, nc: NC,
    });
    expect(response).toBe('670fd8c2df070c60b045671b8b24ff02');
  });

  test('MD5-sess, qop=auth', async () => {
    const response = await computeDigestResponse({
      algorithm: 'MD5-sess', realm: REALM, nonce: NONCE, qop: true, useUtf8: true,
      method: 'GET', uri: '/dir/index.html', username: 'Mufasa', password: 'Circle Of Life',
      cnonce: CNONCE, nc: NC,
    });
    expect(response).toBe('8e3825c57e897f5a0dec6c2d4e5059d0');
  });

  test('SHA-256, qop=auth', async () => {
    const response = await computeDigestResponse({
      algorithm: 'SHA-256', realm: REALM, nonce: NONCE, qop: true, useUtf8: true,
      method: 'GET', uri: '/dir/index.html', username: 'Mufasa', password: 'Circle Of Life',
      cnonce: CNONCE, nc: NC,
    });
    expect(response).toBe('5abdd07184ba512a22c53f41470e5eea7dcaa3a93a59b630c13dfe0a5dc6e38b');
  });
});

describe('NonceCountStore (AUTH-18/19)', () => {
  test('starts at 1 for a first-seen nonce', () => {
    expect(new NonceCountStore().next('n1')).toBe(1);
  });

  test('increments only on reuse of the SAME nonce', () => {
    const store = new NonceCountStore();
    expect(store.next('n1')).toBe(1);
    expect(store.next('n2')).toBe(1); // a different nonce -- starts fresh, does not inherit n1's count
    expect(store.next('n1')).toBe(2);
    expect(store.next('n1')).toBe(3);
  });

  test('property: a fixed nonce produces a strictly increasing sequence', () => {
    const store = new NonceCountStore();
    fc.assert(
      fc.property(fc.integer({min: 1, max: 200}), (calls) => {
        const fresh = new NonceCountStore();
        let previous = 0;
        for (let i = 0; i < calls; i += 1) {
          const count = fresh.next('fixed');
          expect(count).toBeGreaterThan(previous);
          previous = count;
        }
      }),
    );
  });

  test('bounded at 1024 entries, oldest evicted first (AUTH-19)', () => {
    const store = new NonceCountStore();
    for (let i = 0; i < 1024; i += 1) store.next(`nonce-${i}`);
    store.next('nonce-1024'); // 1025th distinct nonce -- evicts 'nonce-0'
    expect(store.next('nonce-0')).toBe(1); // evicted -- starts over, not 2
  });

  test('drains back UNDER the cap after every admit, not one victim per insert (AUTH-19/XCUT-14)', () => {
    // The distinguishing case for drain-to-cap vs pre-insert check-then-evict: a long run of fresh
    // server-chosen nonces. A single-victim-per-insert store stays pinned at (or above) the bound forever
    // without converging; the loop must leave the map at exactly the cap after each admit.
    const store = new NonceCountStore();
    for (let i = 0; i < 4096; i += 1) {
      store.next(`burst-${i}`);
      expect(store.size).toBeLessThanOrEqual(1024);
    }
    expect(store.size).toBe(1024);
  });
});

describe('digestHandler', () => {
  test('canHandle accepts a well-formed Digest challenge', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth'}))).toBe(true);
  });

  test('canHandle rejects a non-Digest scheme', () => {
    expect(digestHandler('u', 'p').canHandle({scheme: 'basic', params: new Map()})).toBe(false);
  });

  test('canHandle rejects a missing realm or nonce', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.canHandle(digestChallenge({nonce: NONCE}))).toBe(false);
    expect(handler.canHandle(digestChallenge({realm: REALM}))).toBe(false);
  });

  test('canHandle declines an auth-int-only qop (AUTH-15)', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth-int'}))).toBe(false);
  });

  test('canHandle declines an unsupported algorithm (AUTH-15)', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD4'}))).toBe(false);
  });

  test('canHandle defaults to MD5 when algorithm is absent', () => {
    const handler = digestHandler('u', 'p', {algorithmPreference: ['MD5']});
    expect(handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE}))).toBe(true);
  });

  test('canHandle honors a caller-restricted algorithm preference', () => {
    const handler = digestHandler('u', 'p', {algorithmPreference: ['SHA-256']});
    expect(handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD5'}))).toBe(false);
  });

  test('rank reflects preference-list order, for composing-handler.ts to sort by', () => {
    const handler = digestHandler('u', 'p', {algorithmPreference: ['SHA-256', 'MD5']});
    const sha = handler.rank?.(digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'SHA-256'}));
    const md5Rank = handler.rank?.(digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD5'}));
    expect(sha).toBeLessThan(md5Rank ?? Number.POSITIVE_INFINITY);
  });

  test('stamp() produces a well-formed Digest header value, qop negotiated', async () => {
    const handler = digestHandler('Mufasa', 'Circle Of Life');
    const challenge = digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth'});
    const value = await handler.stamp(challenge, false, {method: 'GET', requestTarget: '/dir/index.html'});
    expect(value.startsWith('Digest ')).toBe(true);
    expect(value).toContain('username="Mufasa"');
    expect(value).toContain(`realm="${REALM}"`);
    expect(value).toContain('qop=auth');
    expect(value).toMatch(/nc=[0-9a-f]{8}/u);
    expect(value).toMatch(/response="[0-9a-f]+"/u);
  });

  test('stamp() echoes the challenge opaque back, quoted (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth', opaque: '5ccc069c403ebaf9f0171e9517f40e41'});
    const value = await handler.stamp(challenge, false, {method: 'GET', requestTarget: '/x'});
    expect(value).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  test('stamp() omits opaque entirely when the challenge carried none (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const value = await handler.stamp(digestChallenge({realm: REALM, nonce: NONCE}), false, {
      method: 'GET',
      requestTarget: '/x',
    });
    expect(value).not.toContain('opaque');
  });

  test('stamp() omits cnonce/nc/qop when the challenge negotiated no qop (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({realm: REALM, nonce: NONCE});
    const value = await handler.stamp(challenge, false, {method: 'GET', requestTarget: '/x'});
    expect(value).not.toContain('qop=');
    expect(value).not.toContain('cnonce=');
    expect(value).not.toContain('nc=');
  });

  test('two successive stamp() calls against the SAME nonce increment nc (AUTH-18)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth'});
    const request = {method: 'GET', requestTarget: '/x'};
    const first = await handler.stamp(challenge, false, request);
    const second = await handler.stamp(challenge, false, request);
    expect(first).toContain('nc=00000001');
    expect(second).toContain('nc=00000002');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/digest.test.ts`
Expected: FAIL — `Cannot find module './digest.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/digest.ts
import {invariant} from '../invariant.js';
import type {Challenge, ChallengeHandler, DigestUriContext} from './challenge.js';
import {md5, toHex} from './md5.js';

/** AUTH-15: exactly these four are supported. */
export type DigestAlgorithm = 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';

// `as const`, not a bare `readonly` annotation, so the CONSTANT_CASE is honest -- see the note on
// `AUTH_SCHEMES` in scheme.ts (naming-conventions.md:14).
const SUPPORTED_ALGORITHMS = ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess'] as const satisfies readonly DigestAlgorithm[];
const DEFAULT_ALGORITHM_PREFERENCE = ['SHA-256-sess', 'SHA-256', 'MD5-sess', 'MD5'] as const satisfies readonly DigestAlgorithm[];
const NONCE_COUNT_LIMIT = 1024;

export interface DigestOptions {
  /** Preferred-first order; also the acceptable set -- an algorithm absent from this list is declined. */
  readonly algorithmPreference?: readonly DigestAlgorithm[] | undefined;
}

function baseAlgorithm(algorithm: DigestAlgorithm): 'MD5' | 'SHA-256' {
  return algorithm.startsWith('MD5') ? 'MD5' : 'SHA-256';
}

/** AUTH-21: ISO-8859-1 is a byte-for-byte code-point copy for the codebook this parser accepts. */
function encodeLatin1(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) bytes[i] = input.codePointAt(i) ?? 0;
  return bytes;
}

async function hashHex(base: 'MD5' | 'SHA-256', input: string, useUtf8: boolean): Promise<string> {
  const bytes = useUtf8 ? new TextEncoder().encode(input) : encodeLatin1(input);
  if (base === 'MD5') return toHex(md5(bytes));
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)));
}

/**
 * AUTH-18/19: nc starts at 1 per nonce, increments only on reuse, low-32-bits-on-overflow, bounded at 1024
 * entries with insertion-order eviction -- `Map` iteration order is insertion order, so the oldest key is
 * `keys().next().value` and no separate LRU structure is needed.
 *
 * The eviction is an insert-then-DRAIN-IN-A-LOOP, not a pre-insert check-then-evict:
 * `docs/knowledge/concurrency-and-async.md:84` (XCUT-14) requires a caller/server-keyed map to "drain back
 * under the cap after each insert using a loop rather than a single pre-insert check-then-evict, so a
 * concurrent insert burst converges to the bound." The key space here is the SERVER's -- it picks the nonces
 * -- and a single pre-insert evict removes at most one entry per insert, so a burst that admits N new nonces
 * leaves the map above the cap and never climbs back down. AUTH-19 words the same thing as "drained back
 * under the cap AFTER admitting a nonce."
 */
export class NonceCountStore {
  private readonly counts = new Map<string, number>();

  /** Exposed so the bound itself is assertable -- otherwise "drained back under the cap" is untestable
   *  except by the indirect "an evicted nonce restarts at 1" probe. @internal */
  get size(): number {
    return this.counts.size;
  }

  next(nonce: string): number {
    const current = this.counts.get(nonce);
    const count = current === undefined ? 1 : (current + 1) >>> 0;
    this.counts.set(nonce, count);

    while (this.counts.size > NONCE_COUNT_LIMIT) {
      const oldest = this.counts.keys().next().value;
      if (oldest === undefined) break;
      // Never evict the entry just admitted -- it is the live nonce this call is answering with.
      if (oldest === nonce) break;
      this.counts.delete(oldest);
    }

    return count;
  }
}

function formatNonceCount(count: number): string {
  return count.toString(16).padStart(8, '0');
}

/** AUTH-20: >=128 bits from a CSPRNG, never Math.random(). */
function generateClientNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

interface ParsedDigestChallenge {
  readonly algorithm: DigestAlgorithm;
  readonly realm: string;
  readonly nonce: string;
  readonly qop: boolean;
  readonly useUtf8: boolean;
  /** AUTH-22 names `opaque` in the must-quote list, which only makes sense if it is emitted: RFC 7616 requires
   *  the client return the server's opaque value unchanged, and servers that bind state to it reject a request
   *  without it. Absent when the challenge carried none. */
  readonly opaque: string | undefined;
}

/** AUTH-16: satisfiable iff scheme is digest, realm+nonce present, qop absent or containing "auth", and the
 *  algorithm (default MD5) is in the caller's configured preference/acceptable list. */
function parseDigestChallenge(
  challenge: Challenge,
  preference: readonly DigestAlgorithm[],
): ParsedDigestChallenge | undefined {
  if (challenge.scheme !== 'digest') return undefined;
  const realm = challenge.params.get('realm');
  const nonce = challenge.params.get('nonce');
  if (realm === undefined || nonce === undefined) return undefined;

  const qopRaw = challenge.params.get('qop');
  const qop = qopRaw !== undefined;
  if (qop && !qopRaw.split(',').some((entry) => entry.trim().toLowerCase() === 'auth')) return undefined;

  const algorithmRaw = challenge.params.get('algorithm');
  const algorithm =
    algorithmRaw === undefined
      ? 'MD5'
      : SUPPORTED_ALGORITHMS.find((candidate) => candidate.toLowerCase() === algorithmRaw.toLowerCase());
  if (algorithm === undefined || !preference.includes(algorithm)) return undefined;

  const useUtf8 = (challenge.params.get('charset') ?? '').toLowerCase() === 'utf-8';
  return {algorithm, realm, nonce, qop, useUtf8, opaque: challenge.params.get('opaque')};
}

export interface DigestComputationInput {
  readonly algorithm: DigestAlgorithm;
  readonly realm: string;
  readonly nonce: string;
  readonly qop: boolean;
  readonly useUtf8: boolean;
  readonly method: string;
  readonly uri: string;
  readonly username: string;
  readonly password: string;
  readonly cnonce: string;
  readonly nc: string;
}

/**
 * AUTH-17: HA1/HA2/response per RFC 7616/2069. Exported (and bundled into a single object parameter) so it can
 * be unit-tested directly against fixed, verified vectors -- `digestHandler()`'s own `stamp()` always generates
 * a fresh random cnonce (AUTH-20) and so can never be asserted against a fixed expected hash end-to-end.
 */
export async function computeDigestResponse(input: DigestComputationInput): Promise<string> {
  const base = baseAlgorithm(input.algorithm);
  const ha1Plain = await hashHex(base, `${input.username}:${input.realm}:${input.password}`, input.useUtf8);
  const ha1 = input.algorithm.endsWith('-sess')
    ? await hashHex(base, `${ha1Plain}:${input.nonce}:${input.cnonce}`, input.useUtf8)
    : ha1Plain;
  const ha2 = await hashHex(base, `${input.method}:${input.uri}`, input.useUtf8);
  const responseInput = input.qop
    ? `${ha1}:${input.nonce}:${input.nc}:${input.cnonce}:auth:${ha2}`
    : `${ha1}:${input.nonce}:${ha2}`;
  return hashHex(base, responseInput, input.useUtf8);
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

interface HeaderValueParams {
  readonly username: string;
  readonly info: ParsedDigestChallenge;
  readonly uri: string;
  readonly response: string;
  readonly cnonce: string;
  readonly nc: string;
}

/** AUTH-17: quotes/escapes realm/nonce/uri/username/response/cnonce; leaves qop/nc/algorithm unquoted, full
 *  algorithm spelling; emits cnonce/nc/qop only when qop was negotiated (AUTH-22). */
function buildHeaderValue(params: HeaderValueParams): string {
  const {username, info, uri, response, cnonce, nc} = params;
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(info.realm)}`,
    `nonce=${quote(info.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${info.algorithm}`,
    `response=${quote(response)}`,
  ];
  // AUTH-22: `opaque` is quoted and echoed back verbatim when the challenge carried one. RFC 7616 requires the
  // client return it unchanged; a server that binds session state to it rejects a request that omits it.
  if (info.opaque !== undefined) parts.push(`opaque=${quote(info.opaque)}`);
  if (info.qop) parts.push('qop=auth', `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  return `Digest ${parts.join(', ')}`;
}

/** AUTH-15..22: the Digest challenge handler. Cryptographic primitives split across md5.ts (MD5/MD5-sess) and
 *  Web Crypto (SHA-256/SHA-256-sess); the per-nonce counter is the one piece of mutable state, safe without a
 *  lock since nothing awaits between its read and write (same collapse 5a documented for BODY-3). */
export function digestHandler(username: string, password: string, options?: DigestOptions): ChallengeHandler {
  invariant(username.trim().length > 0, 'Digest username must not be blank');
  invariant(password.trim().length > 0, 'Digest password must not be blank');
  const preference = options?.algorithmPreference ?? DEFAULT_ALGORITHM_PREFERENCE;
  const nonceCounts = new NonceCountStore();

  return {
    canHandle: (challenge: Challenge): boolean => parseDigestChallenge(challenge, preference) !== undefined,

    rank: (challenge: Challenge): number => {
      const parsed = parseDigestChallenge(challenge, preference);
      return parsed === undefined ? Number.MAX_SAFE_INTEGER : preference.indexOf(parsed.algorithm);
    },

    stamp: async (challenge: Challenge, _isProxy: boolean, request?: DigestUriContext): Promise<string> => {
      const info = parseDigestChallenge(challenge, preference);
      invariant(info !== undefined, 'digestHandler.stamp called with a challenge canHandle() would reject');
      invariant(request !== undefined, 'digestHandler.stamp requires a DigestUriContext (method + requestTarget)');

      const cnonce = generateClientNonce();
      const nc = info.qop ? formatNonceCount(nonceCounts.next(info.nonce)) : '';
      const response = await computeDigestResponse({
        algorithm: info.algorithm,
        realm: info.realm,
        nonce: info.nonce,
        qop: info.qop,
        useUtf8: info.useUtf8,
        method: request.method,
        uri: request.requestTarget,
        username,
        password,
        cnonce,
        nc,
      });
      return buildHeaderValue({username, info, uri: request.requestTarget, response, cnonce, nc});
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/digest.test.ts`
Expected: PASS — 22 tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `computeDigestResponse` and `buildHeaderValue` each take one bundled object parameter;
`digestHandler`'s three closures (`canHandle`/`rank`/`stamp`) are each 1-3 params and well under the length cap.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth/digest.ts packages/core/src/auth/digest.test.ts
git commit -m "feat(core): Digest challenge handler -- MD5/MD5-sess/SHA-256/SHA-256-sess (AUTH-15..22)"
```

---

### Task 11: `static-key.ts` — API-key / name-key stamping

**Files:**
- Create: `packages/core/src/auth/static-key.ts`
- Test: `packages/core/src/auth/static-key.test.ts`

**Interfaces:**
- Consumes: `ApiKeyCredential`, `NameKeyCredential` from `./credential.js`.
- Produces: `interface StaticKeyOptions {headerName?, prefix?}`; `interface StaticKeyStamp {headerName,
  headerValue}`; `stampStaticKey(credential, options?): StaticKeyStamp`. Task 14 (`auth-step.ts`) consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/static-key.test.ts
// Exercises: AUTH-26 (uniform over ApiKeyCredential/NameKeyCredential; default header Authorization;
// prefix + one space when set; stateless -- no challenge involved).
import {describe, expect, test} from 'bun:test';
import {ApiKeyCredential, NameKeyCredential} from './credential.js';
import {stampStaticKey} from './static-key.js';

describe('stampStaticKey', () => {
  test('defaults to the Authorization header, no prefix', () => {
    const stamp = stampStaticKey(new ApiKeyCredential('secret'));
    expect(stamp.headerName).toBe('Authorization');
    expect(stamp.headerValue).toBe('secret');
  });

  test('applies a configured prefix with exactly one separating space', () => {
    const stamp = stampStaticKey(new ApiKeyCredential('secret'), {prefix: 'Bearer'});
    expect(stamp.headerValue).toBe('Bearer secret');
  });

  test('honors a configured header name', () => {
    const stamp = stampStaticKey(new NameKeyCredential('x-api-key', 'secret'), {headerName: 'X-Api-Key'});
    expect(stamp.headerName).toBe('X-Api-Key');
    expect(stamp.headerValue).toBe('secret');
  });

  test('treats NameKeyCredential uniformly with ApiKeyCredential -- only .key is read, not .name', () => {
    const stamp = stampStaticKey(new NameKeyCredential('ignored-here', 'secret'));
    expect(stamp.headerValue).toBe('secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/static-key.test.ts`
Expected: FAIL — `Cannot find module './static-key.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/static-key.ts
import type {ApiKeyCredential, NameKeyCredential} from './credential.js';

export interface StaticKeyOptions {
  readonly headerName?: string | undefined;
  readonly prefix?: string | undefined;
}

export interface StaticKeyStamp {
  readonly headerName: string;
  readonly headerValue: string;
}

/** AUTH-26: uniform over both credential shapes -- only NameKeyCredential's `.name` is name-only metadata for
 *  logging (credential.ts's redacted toString), never consulted here. Stateless; no challenge involved. */
export function stampStaticKey(
  credential: ApiKeyCredential | NameKeyCredential,
  options?: StaticKeyOptions,
): StaticKeyStamp {
  const headerName = options?.headerName ?? 'Authorization';
  const headerValue = options?.prefix === undefined ? credential.key : `${options.prefix} ${credential.key}`;
  return {headerName, headerValue};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/static-key.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/static-key.ts packages/core/src/auth/static-key.test.ts
git commit -m "feat(core): static API-key / name-key stamping (AUTH-26)"
```

---

### Task 12: `composing-handler.ts` — ordered delegation

**Files:**
- Create: `packages/core/src/auth/composing-handler.ts`
- Test: `packages/core/src/auth/composing-handler.test.ts`

**Interfaces:**
- Consumes: `Challenge`, `ChallengeHandler`, `DigestUriContext` from `./challenge.js`.
- Produces: `interface ComposingHandler {stamp(challenges, isProxy, request?): Promise<string | undefined>}`;
  `composingHandler(handlers): ComposingHandler`. Task 14 (`auth-step.ts`) consumes both.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/composing-handler.test.ts
// Exercises: AUTH-23 (ordered handler list, defensively copied), AUTH-24 ("first handler" precedence over
// wire-order challenge position), AUTH-25 (returns the value half only -- no header-name decision here),
// the rank-based tie-break introduced for AUTH-16 (Plan-time addition on ChallengeHandler).
import {describe, expect, test} from 'bun:test';
import type {Challenge, ChallengeHandler} from './challenge.js';
import {composingHandler} from './composing-handler.js';

function fakeHandler(scheme: string, value: string, rank = 0): ChallengeHandler {
  return {
    canHandle: (challenge: Challenge): boolean => challenge.scheme === scheme,
    stamp: async (): Promise<string> => value,
    rank: (): number => rank,
  };
}

describe('composingHandler', () => {
  test('delegates to the first CONFIGURED handler that can satisfy any offered challenge', async () => {
    const handler = composingHandler([fakeHandler('digest', 'digest-value'), fakeHandler('basic', 'basic-value')]);
    const challenges: readonly Challenge[] = [
      {scheme: 'basic', params: new Map()},
      {scheme: 'digest', params: new Map()},
    ];
    // basic appears FIRST on the wire, but digest's HANDLER is configured first -- handler order wins.
    expect(await handler.stamp(challenges, false)).toBe('digest-value');
  });

  test('returns undefined when no handler can satisfy any offered challenge', async () => {
    const handler = composingHandler([fakeHandler('digest', 'x')]);
    expect(await handler.stamp([{scheme: 'basic', params: new Map()}], false)).toBeUndefined();
  });

  test('within one handler satisfying multiple challenges, rank breaks the tie', async () => {
    const digestLike: ChallengeHandler = {
      canHandle: (challenge) => challenge.scheme === 'digest',
      stamp: async (challenge) => `value-for-${challenge.params.get('algorithm') ?? 'default'}`,
      rank: (challenge) => (challenge.params.get('algorithm') === 'SHA-256' ? 0 : 1),
    };
    const handler = composingHandler([digestLike]);
    const challenges: readonly Challenge[] = [
      {scheme: 'digest', params: new Map([['algorithm', 'MD5']])},
      {scheme: 'digest', params: new Map([['algorithm', 'SHA-256']])},
    ];
    expect(await handler.stamp(challenges, false)).toBe('value-for-SHA-256');
  });

  test('a handler with no rank() defaults to 0 and does not crash the sort', async () => {
    const handler = composingHandler([fakeHandler('basic', 'v')]); // fakeHandler always sets rank -- test the truly-absent case
    const noRank: ChallengeHandler = {canHandle: () => true, stamp: async () => 'no-rank-value'};
    const withNoRank = composingHandler([noRank]);
    expect(await withNoRank.stamp([{scheme: 'anything', params: new Map()}], false)).toBe('no-rank-value');
    expect(await handler.stamp([{scheme: 'basic', params: new Map()}], false)).toBe('v');
  });

  test('defensively copies the handler list at construction', async () => {
    const handlers = [fakeHandler('basic', 'v1')];
    const handler = composingHandler(handlers);
    handlers.push(fakeHandler('digest', 'v2'));
    // even though 'digest' was pushed after construction, the composing handler shouldn't see it
    expect(await handler.stamp([{scheme: 'digest', params: new Map()}], false)).toBeUndefined();
  });

  test('passes isProxy and the request context through to the winning handler', async () => {
    let observedIsProxy: boolean | undefined;
    let observedRequest: {method: string; requestTarget: string} | undefined;
    const spy: ChallengeHandler = {
      canHandle: () => true,
      stamp: async (_challenge, isProxy, request) => {
        observedIsProxy = isProxy;
        observedRequest = request;
        return 'v';
      },
    };
    const handler = composingHandler([spy]);
    await handler.stamp([{scheme: 'x', params: new Map()}], true, {method: 'GET', requestTarget: '/y'});
    expect(observedIsProxy).toBe(true);
    expect(observedRequest).toEqual({method: 'GET', requestTarget: '/y'});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/composing-handler.test.ts`
Expected: FAIL — `Cannot find module './composing-handler.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/composing-handler.ts
import type {Challenge, ChallengeHandler, DigestUriContext} from './challenge.js';

export interface ComposingHandler {
  stamp(challenges: readonly Challenge[], isProxy: boolean, request?: DigestUriContext): Promise<string | undefined>;
}

interface Candidate {
  readonly handlerIndex: number;
  readonly rank: number;
  readonly handler: ChallengeHandler;
  readonly challenge: Challenge;
}

function collectCandidates(handlers: readonly ChallengeHandler[], challenges: readonly Challenge[]): Candidate[] {
  const candidates: Candidate[] = [];
  handlers.forEach((handler, handlerIndex) => {
    for (const challenge of challenges) {
      if (handler.canHandle(challenge)) candidates.push({handlerIndex, rank: handler.rank?.(challenge) ?? 0, handler, challenge});
    }
  });
  return candidates;
}

/** AUTH-24: handler CONFIGURATION order is the primary key -- "the first handler" wins regardless of where its
 *  satisfiable challenge sits on the wire; `rank` (Plan-time addition, see challenge.ts) is the secondary key,
 *  for AUTH-16's algorithm-preference-over-wire-order requirement within a single handler. */
function bestCandidate(candidates: readonly Candidate[]): Candidate | undefined {
  return [...candidates].sort((a, b) => a.handlerIndex - b.handlerIndex || a.rank - b.rank)[0];
}

/**
 * AUTH-23..25: an ordered list of handlers (Basic, Digest -- callers order stronger schemes first),
 * defensively copied at construction. Delegates to the best candidate among every offered challenge any
 * handler can satisfy; returns `undefined` -- meaning "no replacement" -- when none can.
 */
export function composingHandler(handlers: readonly ChallengeHandler[]): ComposingHandler {
  const configured = [...handlers];
  return {
    stamp: async (challenges, isProxy, request): Promise<string | undefined> => {
      const candidate = bestCandidate(collectCandidates(configured, challenges));
      if (candidate === undefined) return undefined;
      return candidate.handler.stamp(candidate.challenge, isProxy, request);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/composing-handler.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/composing-handler.ts packages/core/src/auth/composing-handler.test.ts
git commit -m "feat(core): composing handler -- ordered delegation over Basic/Digest (AUTH-23..25)"
```

---

### Task 13: `bearer-cache.ts` — single-flight, three-zone token cache

**Files:**
- Create: `packages/core/src/auth/bearer-cache.ts`
- Test: `packages/core/src/auth/bearer-cache.test.ts`

**Interfaces:**
- Consumes: `InvariantViolation` from `../invariant.js`; `BearerToken`, `isBearerTokenExpired`, `TokenProvider`
  from `./credential.js`; `AuthResolutionError` from `./errors.js`.
- Produces: `interface BearerFetch {provider, marginMs, nowMs, signal}`; `class BearerTokenCache`
  (`stamp(fetchOptions): Promise<BearerToken>`, `refreshNow(fetchOptions): Promise<BearerToken>`,
  `evict(rejectedHeaderValue): void`). Task 14 (`auth-step.ts`) consumes all three.
  The four fetch parameters are bundled into `BearerFetch` rather than passed positionally: `max-params: 3`
  is hard, and `function-design.md:22` requires an options object at three or more parameters anyway.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/bearer-cache.test.ts
// Exercises: AUTH-34 (fresh-zone hot-path read, no refresh), AUTH-35 (null/expired provider result throws and
// is never cached; a rejecting provider propagates and is never cached), AUTH-37 (expiring-but-valid zone:
// stale value returned, background refresh fired, a FAILED background refresh non-fatal and not an unhandled
// rejection; expired/missing zone: single-flight await, concurrent callers coalesce to exactly one provider
// invocation).
//
// Every `nowMs` below is injected, and the cache validates fetched tokens against that SAME injected clock --
// so `expiresAt` values are small synthetic epochs, not wall-clock instants. A cache that reached for
// `Date.now()` internally would reject every one of these tokens.
import {describe, expect, test} from 'bun:test';
import {BearerTokenCache, type BearerFetch} from './bearer-cache.js';
import {AuthResolutionError} from './errors.js';
import {createBearerToken, type TokenProvider} from './credential.js';

function providerReturning(token: ReturnType<typeof createBearerToken>): {provider: TokenProvider; calls: number[]} {
  const calls: number[] = [];
  const provider: TokenProvider = async () => {
    calls.push(calls.length + 1);
    return token;
  };
  return {provider, calls};
}

/** The four fetch parameters are bundled (`BearerFetch`); this keeps the call sites readable. */
function fetchWith(provider: TokenProvider, marginMs: number, nowMs: number): BearerFetch {
  return {provider, marginMs, nowMs, signal: undefined};
}

describe('BearerTokenCache', () => {
  test('a fresh cached token is returned without invoking the provider (AUTH-34)', async () => {
    const cache = new BearerTokenCache();
    const fresh = providerReturning(createBearerToken('t1', 10_000));
    await cache.stamp(fetchWith(fresh.provider, 1000, 0)); // primes the cache
    let invoked = false;
    const spy: TokenProvider = async () => {
      invoked = true;
      return createBearerToken('unused', 10_000);
    };
    const result = await cache.stamp(fetchWith(spy, 1000, 0)); // nowMs=0, expiresAt=10000, margin=1000 -- not expiring
    expect(result.token).toBe('t1');
    expect(invoked).toBe(false);
  });

  test('expiring-but-valid: returns the stale token AND fires a background refresh', async () => {
    const cache = new BearerTokenCache();
    const initial = providerReturning(createBearerToken('t1', 1000));
    await cache.stamp(fetchWith(initial.provider, 500, 0)); // primes: expiresAt=1000, nowMs=0, margin=500 -- not yet expiring

    const refreshed = providerReturning(createBearerToken('t2', 5000));
    // nowMs=900: expiring (900+500>1000) but not expired (900>1000 false)
    const result = await cache.stamp(fetchWith(refreshed.provider, 500, 900));
    expect(result.token).toBe('t1'); // stale value returned immediately
    // A macrotask boundary (not a fixed number of microtask hops) guarantees the fire-and-forget refresh's
    // whole then/finally chain has drained, regardless of exactly how many microtask ticks it takes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const after = await cache.stamp(
      fetchWith(async () => {
        throw new Error('should not be called -- refresh already cached t2');
      }, 500, 900),
    );
    expect(after.token).toBe('t2');
  });

  test('expired/missing: awaits a fresh fetch', async () => {
    const cache = new BearerTokenCache();
    // The FETCHED token must itself be valid at the injected `nowMs` -- a provider handing back an
    // already-expired token is AUTH-35's rejection case, covered separately below.
    const {provider, calls} = providerReturning(createBearerToken('t1', 10_000));
    const result = await cache.stamp(fetchWith(provider, 0, 5000)); // nothing cached -- straight to the provider
    expect(result.token).toBe('t1');
    expect(calls).toHaveLength(1);
  });

  test('a FAILING background refresh is non-fatal and never becomes an unhandled rejection (AUTH-37)', async () => {
    const cache = new BearerTokenCache();
    await cache.stamp(fetchWith(providerReturning(createBearerToken('t1', 1000)).provider, 500, 0)); // primes

    const failing: TokenProvider = () => Promise.reject(new Error('refresh backend down'));
    // expiring-but-valid: stamps t1, refresh fails in the background
    const result = await cache.stamp(fetchWith(failing, 500, 900));
    expect(result.token).toBe('t1'); // the still-valid token was already stamped -- the failure changes nothing

    // Drain the microtask queue past the fire-and-forget chain; an unhandled rejection would surface here.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // t1 is still cached and still served -- a failed refresh must not evict what it failed to replace.
    const after = await cache.stamp(
      fetchWith(async () => {
        throw new Error('should not be called -- t1 is still cached and still valid at this nowMs');
      }, 0, 900),
    );
    expect(after.token).toBe('t1');
  });

  test('concurrent expired/missing callers coalesce to exactly one provider invocation (single-flight)', async () => {
    let resolveProvider: ((token: ReturnType<typeof createBearerToken>) => void) | undefined;
    let invocations = 0;
    const provider: TokenProvider = () => {
      invocations += 1;
      return new Promise((resolve) => {
        resolveProvider = resolve;
      });
    };
    const cache = new BearerTokenCache();

    const first = cache.stamp(fetchWith(provider, 0, 0));
    const second = cache.stamp(fetchWith(provider, 0, 0));
    expect(invocations).toBe(1); // the second caller coalesced onto the first's in-flight fetch

    resolveProvider?.(createBearerToken('t1', 10_000));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.token).toBe('t1');
    expect(secondResult.token).toBe('t1');
  });

  test('the call signal is threaded to the provider (concurrency-and-async.md:44)', async () => {
    let observed: AbortSignal | undefined;
    const controller = new AbortController();
    const provider: TokenProvider = async (options) => {
      observed = options?.signal;
      return createBearerToken('t1', 10_000);
    };
    const cache = new BearerTokenCache();

    await cache.stamp({provider, marginMs: 0, nowMs: 0, signal: controller.signal});

    expect(observed).toBe(controller.signal);
  });

  test('a null provider result throws AuthResolutionError (AUTH-35)', async () => {
    const cache = new BearerTokenCache();
    // A plain-JS caller can hand back null regardless of TokenProvider's non-nullable return type; AUTH-35
    // requires a RUNTIME guard, so the cast is the point of the test, not a workaround.
    const nullish = (async () => null) as unknown as TokenProvider;
    await expect(cache.stamp(fetchWith(nullish, 0, 0))).rejects.toBeInstanceOf(AuthResolutionError);
  });

  test('an already-expired provider result throws and is never cached (AUTH-35)', async () => {
    const cache = new BearerTokenCache();
    const alreadyExpired: TokenProvider = async () => createBearerToken('t1', -1); // expiresAt in the past
    await expect(cache.stamp(fetchWith(alreadyExpired, 0, 1000))).rejects.toBeInstanceOf(AuthResolutionError);

    const {provider: recovers, calls} = providerReturning(createBearerToken('t2', 10_000));
    const result = await cache.stamp(fetchWith(recovers, 0, 1000));
    expect(result.token).toBe('t2');
    expect(calls).toHaveLength(1); // the earlier rejection left nothing cached to short-circuit this call
  });

  test('a rejecting provider propagates and is never cached', async () => {
    const cache = new BearerTokenCache();
    const boom = new Error('network down');
    const failing: TokenProvider = () => Promise.reject(boom);
    await expect(cache.stamp(fetchWith(failing, 0, 0))).rejects.toBe(boom);

    const {provider: recovers} = providerReturning(createBearerToken('t1', 10_000));
    const result = await cache.stamp(fetchWith(recovers, 0, 0));
    expect(result.token).toBe('t1'); // no stale rejection cached -- this call fetches cleanly
  });

  describe('refreshNow (AUTH-37: the post-eviction path awaits a GENUINELY fresh fetch)', () => {
    test('does NOT coalesce onto a fetch that was already in flight', async () => {
      // The exact hazard: a background refresh started BEFORE the 401 came back. AUTH-11 permits a provider
      // that caches internally, so that older fetch can resolve to the very token the server rejected. A
      // `stamp()` here would coalesce onto it and re-send the rejected token; `refreshNow()` must not.
      const cache = new BearerTokenCache();
      const resolvers: ((token: ReturnType<typeof createBearerToken>) => void)[] = [];
      let invocations = 0;
      const provider: TokenProvider = () => {
        invocations += 1;
        return new Promise((resolve) => {
          resolvers.push(resolve);
        });
      };

      const stale = cache.stamp(fetchWith(provider, 0, 0)); // starts fetch #1 and parks it in flight
      expect(invocations).toBe(1);

      const fresh = cache.refreshNow(fetchWith(provider, 0, 0));
      expect(invocations).toBe(2); // a SECOND provider call, not a handle on the first

      resolvers[0]?.(createBearerToken('rejected-token', 10_000));
      resolvers[1]?.(createBearerToken('genuinely-fresh', 10_000));
      await stale;
      expect((await fresh).token).toBe('genuinely-fresh');
    });

    test('caches its result like any other fetch', async () => {
      const cache = new BearerTokenCache();
      const {provider, calls} = providerReturning(createBearerToken('t1', 10_000));
      await cache.refreshNow(fetchWith(provider, 0, 0));
      const again = await cache.stamp(
        fetchWith(async () => {
          throw new Error('should not refetch -- refreshNow() populated the cache');
        }, 0, 0),
      );
      expect(again.token).toBe('t1');
      expect(calls).toHaveLength(1);
    });
  });

  describe('evict', () => {
    test('evicts only when the header value matches the exact cached token', async () => {
      const cache = new BearerTokenCache();
      await cache.stamp(fetchWith(providerReturning(createBearerToken('t1', 10_000)).provider, 0, 0));
      cache.evict('Bearer some-other-token');
      const result = await cache.stamp(
        fetchWith(async () => {
          throw new Error('should not refetch -- non-matching evict() must not have cleared the cache');
        }, 0, 0),
      );
      expect(result.token).toBe('t1');
    });

    test('a matching evict() forces the next call to refetch', async () => {
      const cache = new BearerTokenCache();
      await cache.stamp(fetchWith(providerReturning(createBearerToken('t1', 10_000)).provider, 0, 0));
      cache.evict('Bearer t1');
      const {provider, calls} = providerReturning(createBearerToken('t2', 10_000));
      const result = await cache.stamp(fetchWith(provider, 0, 0));
      expect(result.token).toBe('t2');
      expect(calls).toHaveLength(1);
    });

    test('is a no-op when nothing is cached', () => {
      expect(() => new BearerTokenCache().evict('Bearer anything')).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/bearer-cache.test.ts`
Expected: FAIL — `Cannot find module './bearer-cache.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/bearer-cache.ts
import {InvariantViolation} from '../invariant.js';
import {type BearerToken, type TokenProvider, isBearerTokenExpired} from './credential.js';
import {AuthResolutionError} from './errors.js';

/**
 * AUTH-34/35/37: the async three-zone policy, unconditionally -- this port has one Promise-only pipeline
 * execution model (4c), so AUTH-34's "non-blocking hot-path read of a valid cached token" is the fresh-zone
 * branch of this same state machine, not a second code path (same collapse 5a documented for RETRY-28).
 *
 * Single-flight is a plain field, not a lock -- Node/Bun's single-threaded event loop means the only hazard is
 * two logical calls both observing "no in-flight fetch" before either sets `#inFlight`, and that cannot happen
 * because nothing awaits between the check and the assignment in `#refresh` (same synchronous-guard collapse
 * as Digest's nonce counter).
 */
export interface BearerFetch {
  readonly provider: TokenProvider;
  readonly marginMs: number;
  /** Injected clock reading -- see the note on `refresh` below for why this is never `Date.now()` in here. */
  readonly nowMs: number;
  /** The call's cancellation, threaded to the provider's I/O (concurrency-and-async.md:20,44). */
  readonly signal: AbortSignal | undefined;
}

export class BearerTokenCache {
  private cached: BearerToken | undefined;
  private inFlight: Promise<BearerToken> | undefined;

  async stamp(fetchOptions: BearerFetch): Promise<BearerToken> {
    const {marginMs, nowMs} = fetchOptions;
    if (this.cached !== undefined) {
      const expiring = isBearerTokenExpired(this.cached, nowMs, marginMs);
      if (!expiring) return this.cached; // fresh zone: stamp, no refresh
      const expired = isBearerTokenExpired(this.cached, nowMs, 0); // AUTH-35: no margin at fetch time
      if (!expired) {
        const stillValid = this.cached;
        // Expiring-but-valid zone: fire-and-forget. AUTH-37 makes a failed background refresh non-fatal
        // BECAUSE a valid token was already stamped -- which means an OPERATIONAL rejection must be swallowed
        // here. A bare `void this.refresh(...)` would leave it unhandled, and Node's default
        // unhandledRejection policy terminates the process (the same hazard 5b's design flags for its own
        // cleanup path). The catch is NARROWED rather than blanket, per error-handling.md:24: an
        // InvariantViolation is a programmer error and error-handling.md:36 requires it crash loudly, so it is
        // rethrown out-of-band instead of being absorbed into "the backend was down."
        void this.refresh(fetchOptions).catch((error: unknown) => {
          if (error instanceof InvariantViolation) throw error;
          return undefined;
        });
        return stillValid;
      }
    }
    return this.refresh(fetchOptions); // expired/missing zone: await a fresh single-flight fetch
  }

  /**
   * AUTH-37's post-eviction path: a GENUINELY fresh fetch, bypassing the single-flight coalescing.
   *
   * `stamp()` is not a substitute. It routes through `refresh`, which returns an already-in-flight promise --
   * and that fetch may have started BEFORE the 401 arrived. AUTH-11 explicitly permits a provider that
   * "caches/refreshes internally", so such a fetch can resolve to the very token the server just rejected and
   * re-cache it, which is precisely the outcome AUTH-37's "so the retry never re-sends the rejected token"
   * forbids. Only the eviction-driven challenge path uses this; everywhere else coalescing is what AUTH-34/37
   * want.
   */
  refreshNow(fetchOptions: BearerFetch): Promise<BearerToken> {
    this.inFlight = undefined; // drop any pre-401 fetch's claim on this slot before starting a new one
    return this.refresh(fetchOptions);
  }

  /**
   * `nowMs` is threaded in rather than read from `Date.now()` here: `stamp()` already takes an injected clock,
   * and a refresh that validated against the ambient wall clock while its caller reasoned about an injected one
   * would reject every token in any test that drives time synthetically -- and, worse, would be a second,
   * invisible clock in production code the caller cannot control.
   */
  private refresh(fetchOptions: BearerFetch): Promise<BearerToken> {
    if (this.inFlight !== undefined) return this.inFlight; // coalesce concurrent expiring/missing callers
    const pending = fetchOptions
      .provider({signal: fetchOptions.signal})
      .then((token: BearerToken | null | undefined) => {
        // `token` is widened at this ONE boundary on purpose. `TokenProvider`'s declared return type is
        // non-nullable, so comparing the un-widened value against null trips
        // `@typescript-eslint/no-unnecessary-condition` from the strict-type-checked tier -- but AUTH-35
        // requires a runtime guard, because a plain-JS caller (or a mis-typed `any` boundary) can hand back
        // null regardless of what the type says. Widening states that intent instead of suppressing the rule.
        if (token === null || token === undefined || isBearerTokenExpired(token, fetchOptions.nowMs, 0)) {
          throw new AuthResolutionError('token provider returned a null or already-expired token'); // AUTH-35
        }
        this.cached = token;
        return token;
      })
      .finally(() => {
        this.inFlight = undefined; // never cache a rejection (AUTH-11/35) -- it already propagates untouched
      });
    this.inFlight = pending;
    return pending;
  }

  evict(rejectedHeaderValue: string): void {
    if (this.cached !== undefined && `Bearer ${this.cached.token}` === rejectedHeaderValue) {
      this.cached = undefined;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/bearer-cache.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/bearer-cache.ts packages/core/src/auth/bearer-cache.test.ts
git commit -m "feat(core): single-flight, three-zone bearer token cache (AUTH-34..37)"
```

---

### Task 14: `auth-step.ts` — the AUTH pillar step

The integration point for every piece built in Tasks 1–13. Read Plan-time decision 1 (`AuthCredentialSet`) and
4 (default handler construction) again before starting.

**Files:**
- Create: `packages/core/src/auth/auth-step.ts`
- Test: `packages/core/src/auth/auth-step.test.ts`
- Modify: `packages/core/src/http/request-options.ts` (+ its test) — the `auth?: AuthDescriptor` per-call field
  (see the scoping note below)

**Interfaces:**
- Consumes: `invariant` **and `assertNever`** from `../invariant.js` (the latter closes the two exhaustive
  `AuthScheme` switches — see the note at `preemptiveStamp`); `Request` from `../http/request.js`; `Response` from
  `../http/response.js`; `StepDescriptor` from `../pipeline/step.js`; `clearCrossOriginMarker`,
  `hasCrossOriginMarker` from `../redirect/cross-origin.js` (5b, imported unchanged); `basicHandler` from
  `./basic.js`; `BearerTokenCache` from `./bearer-cache.js`; `Challenge`, `ChallengeHandler`, `parseChallenges`
  from `./challenge.js`; `composingHandler`, `ComposingHandler` from `./composing-handler.js`; `ApiKeyCredential`,
  `NameKeyCredential`, `TokenProvider` from `./credential.js`; `DigestAlgorithm`, `digestHandler` from
  `./digest.js`; `PlaintextCredentialError` from `./errors.js`; `resolveAuthRequirement`, `AuthTiers` from
  `./resolve.js`; `AuthScheme` from `./scheme.js`; `stampStaticKey` from `./static-key.js`.
- Produces: `interface AuthCredentialSet {basic?, digest?, bearer?, apiKey?}` (Plan-time decision 1);
  `availableSchemesOf(credentials): ReadonlySet<AuthScheme>`; `type ChallengeHook = (response, request) =>
  Promise<Request | undefined>`; `interface AuthStepSettings {credentials, tiers, handlers?, challengeHook?,
  bearerMarginMs?}`; `AUTH_STEP_TYPE: symbol`; `authStep(settings): StepDescriptor`; the amended
  `RequestOptions.auth?: AuthDescriptor` (Step 3b). Task 16 (`preset.ts`) consumes `authStep`; Task 16's joint
  conformance test consumes `AuthStepSettings`/`AuthCredentialSet`; Task 16's api-report step picks up the one
  new `RequestOptions` member.

**Scoping note on `AuthStepSettings.tiers` (revised 2026-07-28, planning review).** The original plan-time note
fixed all three tiers at `authStep()` construction because no phase exposed a per-call source. That changed with
5a Task 1's `StepContext` amendment: `PIPE-17` requires the caller's per-call `RequestOptions` to be readable by
any step, and `StepContext.options` now delivers it. This task therefore also amends `RequestOptions` (Phase 1,
`http/request-options.ts`) with one optional field, `auth?: AuthDescriptor` — builder method `.auth(descriptor)`,
no validation beyond the type (any constructed `AuthDescriptor` is already valid by `AUTH-3`). The import is
type-only and cycle-free: `descriptor.ts` → `requirement.ts` → `scheme.ts` import nothing from `http/`.

The step resolves per call against effective tiers — `ctx.options?.auth` present replaces the `perCall` slot,
else `settings.tiers` is used as configured. `resolveAuthRequirement`'s `perCall ?? operation ?? client` logic
(AUTH-4/5/6/7) is untouched; the `perCall` tier simply gains a genuinely per-call source. The `operation` tier
still has no distinct source (no per-operation layer exists in this roadmap) — that residue stays in the
roadmap's Deferred Items Log. `AuthDescriptor` is already public surface transitively via `AuthStepSettings`,
so `core.api.md` widens by exactly one `RequestOptions` member (Task 16's report step picks it up).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/auth-step.test.ts
// Exercises: AUTH-27 (exactly one AUTH-stage descriptor), AUTH-28 (HTTPS guard, NO_AUTH exempt), AUTH-29
// (cross-origin marker skips the guard and stamping, clears the header, forwards credential-free -- AND
// declines to answer a challenge on that hop, so the credential cannot re-enter via the 401), AUTH-25 (a 407
// is answered from Proxy-Authenticate into Proxy-Authorization), AUTH-30
// (401+WWW-Authenticate invokes the hook; replacement re-drives exactly once via a fresh fork()), AUTH-31
// (non-replayable replacement body surfaces the original 401 unchanged, untouched), AUTH-32 (a throwing hook
// closes the 401 before propagating), AUTH-33 (no WWW-Authenticate, or hook yields nothing -> unchanged),
// AUTH-36 (OAUTH2's default hook evicts the exact rejected token and re-stamps), AUTH-4 (a per-call
// RequestOptions.auth descriptor overrides the configured perCall tier, via ctx.options).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Protocol} from '../http/protocol.js';
import {Status} from '../http/status.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import {Cursor} from '../pipeline/cursor.js';
import {aRequestContext} from '../pipeline/cursor.test-helpers.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {ApiKeyCredential} from './credential.js';
import {createAuthDescriptor} from './descriptor.js';
import {PlaintextCredentialError} from './errors.js';
import {createAuthRequirement} from './requirement.js';
import {AUTH_STEP_TYPE, authStep, type AuthCredentialSet} from './auth-step.js';

function runThrough(descriptor: StepDescriptor, transport: FakeTransport, request: Request): Promise<unknown> {
  const cursor = new Cursor({steps: [descriptor], transport, request, context: aRequestContext()});
  return cursor.advance();
}

function aRequest(url = 'https://example.com/a'): Request {
  return Request.newBuilder().url(url).build();
}

function tiersFor(scheme: 'BASIC' | 'DIGEST' | 'OAUTH2' | 'API_KEY' | 'NO_AUTH') {
  return {client: createAuthDescriptor([createAuthRequirement(scheme)])};
}

describe('authStep', () => {
  test('is pinned to the AUTH pillar stage (AUTH-27)', () => {
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});
    expect(descriptor.stage).toBe('AUTH');
    expect(descriptor.type).toBe(AUTH_STEP_TYPE);
  });

  test('NO_AUTH stamps nothing and never triggers the HTTPS guard, even over plain HTTP', async () => {
    const response = countingResponse(200);
    const transport = new FakeTransport([response.response]);
    const descriptor = authStep({credentials: {}, tiers: tiersFor('NO_AUTH')});

    await runThrough(descriptor, transport, aRequest('http://example.com/a'));

    expect(transport.calls[0]?.request.headers.get('Authorization')).toBeUndefined();
  });

  test('API_KEY stamps preemptively via the configured header/prefix', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret'), headerName: 'X-Api-Key', prefix: undefined},
    };
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});

    await runThrough(descriptor, transport, aRequest());

    expect(transport.calls[0]?.request.headers.get('X-Api-Key')).toBe('secret');
  });

  test('a credentialed scheme over plain HTTP throws PlaintextCredentialError (AUTH-28)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {apiKey: {credential: new ApiKeyCredential('secret')}};
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});

    await expect(runThrough(descriptor, transport, aRequest('http://example.com/a'))).rejects.toBeInstanceOf(
      PlaintextCredentialError,
    );
    expect(transport.sendCount).toBe(0);
  });

  test('BASIC/DIGEST never stamp preemptively -- the outbound request carries no Authorization', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    await runThrough(descriptor, transport, aRequest());

    expect(transport.calls[0]?.request.headers.get('Authorization')).toBeUndefined();
  });

  test('AUTH-29: a cross-origin-marked request skips the guard and stamping, marker cleared', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {apiKey: {credential: new ApiKeyCredential('secret')}};
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});
    const marked = Request.newBuilder()
      .url('http://example.com/a') // plain HTTP -- would normally trip the guard, but the marker skips it
      .headers(Headers.newBuilder().add('x-dexpace-internal-redirect-cross-origin', '1').build())
      .build();

    await runThrough(descriptor, transport, marked);

    const sent = transport.calls[0]?.request;
    expect(sent?.headers.get('Authorization')).toBeUndefined();
    expect(sent?.headers.has('x-dexpace-internal-redirect-cross-origin')).toBe(false);
  });

  test('AUTH-29: a cross-origin-marked request does NOT answer a challenge either -- no credential via the 401', async () => {
    // The suppression covers the whole hop. Answering the challenge here would stamp exactly the credential
    // the outbound pass declined to send, onto the server-chosen foreign host, over a URL whose HTTPS guard
    // was skipped -- the precise leak AUTH-29 exists to prevent.
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const transport = new FakeTransport([challenged, countingResponse(200).response]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});
    const marked = Request.newBuilder()
      .url('http://evil.example/a')
      .headers(Headers.newBuilder().add('x-dexpace-internal-redirect-cross-origin', '1').build())
      .build();

    const response = await runThrough(descriptor, transport, marked);

    expect(transport.sendCount).toBe(1); // no re-drive was attempted
    expect(response).toBe(challenged); // returned unchanged and unclosed -- the caller owns it
    expect(the401.cancelCount()).toBe(0);
  });

  test('a 407 is answered from Proxy-Authenticate into Proxy-Authorization (AUTH-25)', async () => {
    const the407 = countingResponse(407);
    const challenged = the407.response
      .newBuilder()
      .headers(the407.response.headers.newBuilder().setInbound('Proxy-Authenticate', 'Basic realm="p"').build())
      .build();
    const success = countingResponse(200);
    const transport = new FakeTransport([challenged, success.response]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    await runThrough(descriptor, transport, aRequest());

    expect(transport.sendCount).toBe(2);
    expect(transport.calls[1]?.request.headers.get('Proxy-Authorization')?.startsWith('Basic ')).toBe(true);
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBeUndefined();
  });

  test('a 401 without WWW-Authenticate is returned unchanged (AUTH-33)', async () => {
    const the401 = countingResponse(401);
    const transport = new FakeTransport([the401.response]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport, aRequest());

    expect(response).toBe(the401.response);
    expect(transport.sendCount).toBe(1);
  });

  test('a 401 with a Basic challenge re-drives exactly once with the stamped Authorization', async () => {
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const success = countingResponse(200);
    const transport = new FakeTransport([challenged, success.response]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport, aRequest());

    expect(transport.sendCount).toBe(2);
    expect(transport.calls[1]?.request.headers.get('Authorization')?.startsWith('Basic ')).toBe(true);
    expect(response).toBe(success.response);
  });

  // AUTH-31 with the DEFAULT hook: the fast path decides before the hook runs, so no token is evicted and no
  // replacement is built only to be discarded. The observable contract is identical either way.
  test('a non-replayable body surfaces the original 401 unchanged, unclosed, without running the hook (AUTH-31)', async () => {
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const transport = new FakeTransport([challenged]);
    const credentials: AuthCredentialSet = {basic: {username: 'u', password: 'p'}};
    const oneShot = streamBody(new ReadableStream<Uint8Array>({start: (c) => c.close()}), null, 0);
    const request = Request.newBuilder().method('POST').url('https://example.com/a').body(oneShot).build();
    const descriptor = authStep({credentials, tiers: tiersFor('BASIC')});

    const response = await runThrough(descriptor, transport, request);

    expect(response).toBe(challenged);
    expect(transport.sendCount).toBe(1); // no replacement dispatch was attempted
  });

  test('a throwing challengeHook closes the 401 before propagating (AUTH-32)', async () => {
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const transport = new FakeTransport([challenged]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'),
      challengeHook: async () => {
        throw new Error('hook exploded');
      },
    });

    await expect(runThrough(descriptor, transport, aRequest())).rejects.toThrow('hook exploded');
    expect(the401.cancelCount()).toBe(1);
  });

  test('a caller-supplied challengeHook takes precedence over the scheme default', async () => {
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const success = countingResponse(200);
    const transport = new FakeTransport([challenged, success.response]);
    let hookInvoked = false;
    const descriptor = authStep({
      credentials: {basic: {username: 'u', password: 'p'}},
      tiers: tiersFor('BASIC'),
      challengeHook: async (_response, request) => {
        hookInvoked = true;
        return request.newBuilder().headers(request.headers.newBuilder().set('Authorization', 'Custom xyz').build()).build();
      },
    });

    await runThrough(descriptor, transport, aRequest());

    expect(hookInvoked).toBe(true);
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe('Custom xyz');
  });

  test('OAUTH2 default hook evicts the exact rejected token and re-stamps (AUTH-36)', async () => {
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Bearer realm="x"').build())
      .build();
    const success = countingResponse(200);
    const transport = new FakeTransport([challenged, success.response]);
    let calls = 0;
    const credentials: AuthCredentialSet = {
      bearer: {
        provider: async () => {
          calls += 1;
          return {token: `t${calls}`, expiresAt: Date.now() + 60_000};
        },
      },
    };
    const descriptor = authStep({credentials, tiers: tiersFor('OAUTH2')});

    await runThrough(descriptor, transport, aRequest());

    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe('Bearer t1');
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe('Bearer t2'); // evicted t1, fetched fresh
    expect(calls).toBe(2);
  });

  test('AUTH-28 is re-applied to a challenge replacement that carries a credential', async () => {
    // The outbound guard is SKIPPED for NO_AUTH, and nothing constrains a caller hook to preserve the URL --
    // so without a second guard a hook answering a challenge stamps a credential straight over plaintext.
    const the401 = countingResponse(401);
    const challenged = the401.response
      .newBuilder()
      .headers(the401.response.headers.newBuilder().setInbound('WWW-Authenticate', 'Basic realm="x"').build())
      .build();
    const transport = new FakeTransport([challenged, countingResponse(200).response]);
    const descriptor = authStep({
      credentials: {},
      tiers: tiersFor('NO_AUTH'), // outbound guard skipped entirely
      challengeHook: async (_response, request) =>
        request.newBuilder().headers(request.headers.newBuilder().set('Authorization', 'Basic c3B5').build()).build(),
    });

    await expect(runThrough(descriptor, transport, aRequest('http://example.com/a'))).rejects.toBeInstanceOf(
      PlaintextCredentialError,
    );
    expect(transport.sendCount).toBe(1); // the replacement never reached the wire
    expect(the401.cancelCount()).toBe(1); // and the 401 was closed before the throw, not leaked
  });

  test('a per-call RequestOptions.auth descriptor overrides the configured perCall tier (AUTH-4)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const credentials: AuthCredentialSet = {
      apiKey: {credential: new ApiKeyCredential('secret'), headerName: 'X-Api-Key', prefix: undefined},
    };
    // Configured tiers resolve to API_KEY; the per-call descriptor demands NO_AUTH and must win.
    const descriptor = authStep({credentials, tiers: tiersFor('API_KEY')});
    const options = RequestOptions.newBuilder()
      .auth(createAuthDescriptor([createAuthRequirement('NO_AUTH')]))
      .build();
    const cursor = new Cursor({steps: [descriptor], transport, request: aRequest(), context: aRequestContext(), options});

    await cursor.advance();

    expect(transport.calls[0]?.request.headers.get('X-Api-Key')).toBeUndefined();
  });
});
```

The per-call test additionally imports `RequestOptions` from `../http/request-options.js`.

`aRequestContext()` follows the same shared-helper caveat as 5a's and 5b's test suites: inline a `RequestContext`
instead if the helper turns out to be file-local to 4c's own test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/auth-step.test.ts`
Expected: FAIL — `Cannot find module './auth-step.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/auth-step.ts
import {assertNever, invariant} from '../invariant.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {clearCrossOriginMarker, hasCrossOriginMarker} from '../redirect/cross-origin.js';
import {basicHandler} from './basic.js';
import {BearerTokenCache} from './bearer-cache.js';
import type {Challenge, ChallengeHandler} from './challenge.js';
import {parseChallenges} from './challenge.js';
import {composingHandler, type ComposingHandler} from './composing-handler.js';
import type {ApiKeyCredential, NameKeyCredential, TokenProvider} from './credential.js';
import type {DigestAlgorithm} from './digest.js';
import {digestHandler} from './digest.js';
import type {AuthDescriptor} from './descriptor.js';
import {PlaintextCredentialError} from './errors.js';
import {resolveAuthRequirement, type AuthTiers} from './resolve.js';
import type {AuthScheme} from './scheme.js';
import {stampStaticKey} from './static-key.js';

// -- Plan-time decision 1: AuthCredentialSet, not defined anywhere in the design doc or knowledge corpus. --

export interface BasicCredential {
  readonly username: string;
  readonly password: string;
}

export interface DigestCredential {
  readonly username: string;
  readonly password: string;
  readonly algorithmPreference?: readonly DigestAlgorithm[] | undefined;
}

export interface BearerCredential {
  readonly provider: TokenProvider;
  readonly marginMs?: number | undefined;
}

export interface ApiKeyCredentialConfig {
  readonly credential: ApiKeyCredential | NameKeyCredential;
  readonly headerName?: string | undefined;
  readonly prefix?: string | undefined;
}

export interface AuthCredentialSet {
  readonly basic?: BasicCredential | undefined;
  readonly digest?: DigestCredential | undefined;
  readonly bearer?: BearerCredential | undefined;
  readonly apiKey?: ApiKeyCredentialConfig | undefined;
}

export function availableSchemesOf(credentials: AuthCredentialSet): ReadonlySet<AuthScheme> {
  const schemes = new Set<AuthScheme>();
  if (credentials.basic !== undefined) schemes.add('BASIC');
  if (credentials.digest !== undefined) schemes.add('DIGEST');
  if (credentials.bearer !== undefined) schemes.add('OAUTH2');
  if (credentials.apiKey !== undefined) schemes.add('API_KEY');
  return schemes;
}

// -- Plan-time decision 4: the default handler list is built from `credentials`, digest-first. --

function buildDefaultHandlers(
  credentials: AuthCredentialSet,
  configured: readonly ChallengeHandler[] | undefined,
): readonly ChallengeHandler[] {
  if (configured !== undefined) return configured;
  const handlers: ChallengeHandler[] = [];
  if (credentials.digest !== undefined) {
    handlers.push(digestHandler(credentials.digest.username, credentials.digest.password, {
      algorithmPreference: credentials.digest.algorithmPreference,
    }));
  }
  if (credentials.basic !== undefined) handlers.push(basicHandler(credentials.basic.username, credentials.basic.password));
  return handlers;
}

export type ChallengeHook = (response: Response, request: Request) => Promise<Request | undefined>;

export interface AuthStepSettings {
  readonly credentials: AuthCredentialSet;
  /**
   * The operation/client tiers, fixed at construction. The perCall slot may additionally be supplied per
   * call via `RequestOptions.auth` (AUTH-4), which wins over any perCall value configured here -- see the
   * task's scoping note.
   */
  readonly tiers: AuthTiers;
  readonly handlers?: readonly ChallengeHandler[] | undefined;
  readonly challengeHook?: ChallengeHook | undefined;
  /**
   * Refresh margin ahead of a bearer token's expiry.
   * @default 30_000 (AUTH-34's "default 30 seconds")
   */
  readonly bearerMarginMs?: number | undefined;
  /**
   * Wall-clock source for bearer expiry evaluation, injected so the three-zone policy is testable through the
   * step and not only through `BearerTokenCache` directly. Reading `Date.now()` here would be the SECOND,
   * uncontrollable clock the Deviation Ledger already rejects inside `#refresh` -- `bearer-cache.ts` takes an
   * injected `nowMs` precisely so its one caller can supply a controllable one, and this is that caller.
   * (`docs/knowledge/testing.md:36,42`: a unit test uses no real clock; prefer injecting clocks as parameters.)
   * Phase 7a's `Clock` seam may replace this field once it exists; until then the local hook keeps 5c free of a
   * forward dependency.
   * @default Date.now
   */
  readonly now?: (() => number) | undefined;
}

/** AUTH-4: a per-call descriptor (RequestOptions.auth, via StepContext.options) overrides the perCall slot. */
function effectiveTiers(configured: AuthTiers, perCall: AuthDescriptor | undefined): AuthTiers {
  return perCall === undefined ? configured : {...configured, perCall};
}

export const AUTH_STEP_TYPE: unique symbol = Symbol('dexpace.auth');

function requireHttps(url: URL, scheme: AuthScheme): void {
  if (url.protocol.toLowerCase() !== 'https:') throw new PlaintextCredentialError('authStep', scheme); // AUTH-28
}

interface StampContext {
  readonly scheme: AuthScheme;
  readonly credentials: AuthCredentialSet;
  readonly bearerCache: BearerTokenCache;
  readonly marginMs: number;
  readonly nowMs: number;
  readonly signal: AbortSignal | undefined;
}

function withHeader(request: Request, name: string, value: string): Request {
  return request.newBuilder().headers(request.headers.newBuilder().set(name, value).build()).build();
}

/**
 * OAUTH2/API_KEY stamp preemptively (no server round-trip needed); BASIC/DIGEST/NO_AUTH never do.
 *
 * An exhaustive `switch` closing on `assertNever`, not an if-chain: `AuthScheme` is a closed discriminant, and
 * `docs/knowledge/data-modeling.md:38` bans an if-chain over one because "an if-chain gives no exhaustiveness
 * guarantee and silently falls through when a variant is added" -- and the value that would fall through here
 * is a credential-stamping decision.
 */
async function preemptiveStamp(request: Request, context: StampContext): Promise<Request> {
  switch (context.scheme) {
    case 'OAUTH2': {
      invariant(context.credentials.bearer !== undefined, 'resolved OAUTH2 but no bearer credential configured');
      const token = await context.bearerCache.stamp({
        provider: context.credentials.bearer.provider,
        marginMs: context.credentials.bearer.marginMs ?? context.marginMs,
        nowMs: context.nowMs,
        signal: context.signal,
      });
      return withHeader(request, 'Authorization', `Bearer ${token.token}`);
    }
    case 'API_KEY': {
      invariant(context.credentials.apiKey !== undefined, 'resolved API_KEY but no apiKey credential configured');
      const {headerName, headerValue} = stampStaticKey(context.credentials.apiKey.credential, context.credentials.apiKey);
      return withHeader(request, headerName, headerValue);
    }
    case 'BASIC':
    case 'DIGEST':
    case 'NO_AUTH':
      return request; // challenge-driven, or no credential at all -- nothing to stamp on the outbound pass
    default:
      return assertNever(context.scheme);
  }
}

interface ChallengeSelection {
  readonly value: string;
  readonly isProxy: boolean;
}

/**
 * AUTH-25: which of the two challenge headers actually carried the challenge decides which of the two
 * `Authorization` headers the answer goes into. A 401 is answered from `WWW-Authenticate`; a 407 from
 * `Proxy-Authenticate`. Reading only the header that matches the status keeps the pairing honest -- a 401
 * carrying a stray `Proxy-Authenticate` must not produce a `Proxy-Authorization`, and vice versa.
 */
function pickChallengeHeader(response: Response): ChallengeSelection | undefined {
  if (response.status.code === 401) {
    const www = response.headers.get('WWW-Authenticate');
    return www === undefined ? undefined : {value: www, isProxy: false};
  }
  const proxy = response.headers.get('Proxy-Authenticate');
  return proxy === undefined ? undefined : {value: proxy, isProxy: true};
}

interface DefaultHookContext {
  readonly scheme: AuthScheme;
  readonly credentials: AuthCredentialSet;
  readonly bearerCache: BearerTokenCache;
  readonly composing: ComposingHandler;
  readonly marginMs: number;
  readonly nowMs: number;
  readonly signal: AbortSignal | undefined;
}

async function oauth2ChallengeHook(
  request: Request,
  selection: ChallengeSelection,
  context: DefaultHookContext,
): Promise<Request | undefined> {
  invariant(context.credentials.bearer !== undefined, 'resolved OAUTH2 but no bearer credential configured');
  const headerName = selection.isProxy ? 'Proxy-Authorization' : 'Authorization';
  const rejected = request.headers.get(headerName);
  if (rejected === undefined) return undefined; // AUTH-36: no Authorization on the rejected request -> unchanged
  const challenges: readonly Challenge[] = parseChallenges(selection.value);
  if (!challenges.some((challenge) => challenge.scheme === 'bearer')) return undefined;

  context.bearerCache.evict(rejected);
  // AUTH-37's last clause: "The post-eviction challenge path MUST await a GENUINELY FRESH fetch so the retry
  // never re-sends the rejected token." Plain `stamp()` is not enough -- it routes through `#refresh`, which
  // coalesces onto an already-in-flight fetch. That fetch may have started BEFORE this 401 came back, and
  // AUTH-11 explicitly permits a provider that "caches/refreshes internally", so it can resolve to the very
  // token the server just rejected (and re-cache it). `refreshNow()` bypasses the coalescing for exactly this
  // one path; every other caller still coalesces, which is what AUTH-34/37 want everywhere else.
  //
  // Same margin resolution as the preemptive path -- a second, quietly-different default here would mean the
  // refresh triggered by a 401 used a different expiry policy than the stamp that produced the 401.
  const token = await context.bearerCache.refreshNow({
    provider: context.credentials.bearer.provider,
    marginMs: context.credentials.bearer.marginMs ?? context.marginMs,
    nowMs: context.nowMs,
    signal: context.signal,
  });
  return withHeader(request, headerName, `Bearer ${token.token}`);
}

async function basicDigestChallengeHook(
  request: Request,
  selection: ChallengeSelection,
  context: DefaultHookContext,
): Promise<Request | undefined> {
  const challenges = parseChallenges(selection.value);
  const requestTarget = `${request.url.pathname}${request.url.search}`;
  const value = await context.composing.stamp(challenges, selection.isProxy, {method: request.method, requestTarget});
  if (value === undefined) return undefined;
  const headerName = selection.isProxy ? 'Proxy-Authorization' : 'Authorization';
  return withHeader(request, headerName, value);
}

/** The scheme-dependent default hook body (AUTH-30's generic contract governs invocation; this decides WHAT
 *  each resolved scheme does with a parsed challenge). API_KEY/NO_AUTH never react (AUTH-33's "no replacement"). */
async function defaultChallengeHook(response: Response, request: Request, context: DefaultHookContext): Promise<Request | undefined> {
  const selection = pickChallengeHeader(response);
  if (selection === undefined) return undefined;

  // Exhaustive switch + assertNever, not an if-chain (docs/knowledge/data-modeling.md:38): a sixth AuthScheme
  // added later must not silently inherit the BASIC/DIGEST branch's credential-stamping behaviour.
  switch (context.scheme) {
    case 'OAUTH2':
      return oauth2ChallengeHook(request, selection, context);
    case 'BASIC':
    case 'DIGEST':
      return basicDigestChallengeHook(request, selection, context);
    case 'API_KEY':
    case 'NO_AUTH':
      return undefined; // static/absent credentials have no reactive behaviour (AUTH-30's default-hook wording)
    default:
      return assertNever(context.scheme);
  }
}

/**
 * AUTH-27..33: the single AUTH pillar step -- one pluggable challenge-reaction extension point
 * (`challengeHook`) with a scheme-dependent default body, not three competing mechanisms. Nested inside both
 * redirect (5b) and retry (5a) per "redirect wraps retry wraps auth" -- every dispatch, including the first,
 * goes through a fresh `ctx.fork()`, since the step may drive the downstream chain a second time on a
 * challenge response and `next()`'s single-invocation guard would trip on that second drive.
 *
 * Both challenge statuses are handled: a 401 is answered from `WWW-Authenticate` into `Authorization`, a 407
 * from `Proxy-Authenticate` into `Proxy-Authorization` (AUTH-25). A cross-origin-marked hop answers neither.
 *
 * The `@throws` tags below are required, not decorative: this is a barrel-exported symbol, and both
 * `docs/knowledge/error-handling.md:52` and `documentation.md:24` require every public operation to declare
 * the failure modes a caller would reasonably act on. Both classes are exported from the barrel alongside this
 * function so `instanceof` narrowing actually works (`error-handling.md:20` bans duck-typing on `.message`).
 *
 * @throws {@link PlaintextCredentialError} when the resolved scheme would attach a credential over a
 *   non-HTTPS URL (AUTH-28) -- on the outbound pass and again on a challenge replay. Recover by fixing the
 *   endpoint's scheme; retrying will not help.
 * @throws {@link AuthResolutionError} when the selected tier lists no scheme with a matching configured
 *   credential (AUTH-4/AUTH-6), or when the token provider returns a null/already-expired token (AUTH-35).
 *   The first is a configuration fault; the second is transient and the next request retries the fetch.
 *
 * @example
 * ```ts
 * const runtime = new PipelineBuilder(transport)
 *   .append(authStep({
 *     credentials: {bearer: {provider: async ({signal} = {}) => fetchToken({signal})}},
 *     tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
 *   }))
 *   .build();
 * ```
 */
export function authStep(settings: AuthStepSettings): StepDescriptor {
  const bearerCache = new BearerTokenCache();
  const availableSchemes = availableSchemesOf(settings.credentials);
  const composing = composingHandler(buildDefaultHandlers(settings.credentials, settings.handlers));
  const bearerMarginMs = settings.bearerMarginMs ?? 30_000;
  const now = settings.now ?? Date.now;

  return {
    type: AUTH_STEP_TYPE,
    stage: 'AUTH',
    fn: async (seedRequest, ctx) => {
      const {fork} = ctx;
      invariant(fork !== undefined, 'authStep must occupy the AUTH pillar stage');

      const requirement = resolveAuthRequirement(effectiveTiers(settings.tiers, ctx.options?.auth), availableSchemes);
      const scheme = requirement.scheme;
      // One clock read per hop, threaded into every expiry evaluation this hop performs, so the preemptive
      // stamp and a challenge-driven refresh cannot disagree about "now" mid-call.
      const nowMs = now();
      // The caller's cancellation, threaded to the token fetch -- the only external I/O this step performs.
      // A signal that stops at the first function is decoration (concurrency-and-async.md:44).
      const {signal} = ctx;

      // AUTH-29: cross-origin check first; the marker is cleared unconditionally before either branch, so it
      // can never survive into a substituted request built by the stamping/no-op logic below.
      const crossOrigin = hasCrossOriginMarker(seedRequest.headers);
      const cleared = seedRequest.newBuilder().headers(clearCrossOriginMarker(seedRequest.headers)).build();

      let outbound: Request;
      if (crossOrigin) {
        outbound = cleared; // skip the HTTPS guard and preemptive stamping entirely
      } else {
        if (scheme !== 'NO_AUTH') requireHttps(cleared.url, scheme); // AUTH-28
        outbound = await preemptiveStamp(cleared, {
          scheme,
          credentials: settings.credentials,
          bearerCache,
          marginMs: bearerMarginMs,
          nowMs,
          signal,
        });
      }

      const response = await fork()(outbound);
      const status = response.status.code;
      if (status !== 401 && status !== 407) return response; // the ordinary non-challenge path

      // AUTH-29, second half: the marker suppresses credential stamping for the WHOLE hop, not just the
      // outbound pass. Reacting to a challenge here would stamp exactly the credential the cross-origin
      // branch above declined to send -- onto the server-chosen foreign host, over a URL whose HTTPS guard
      // was deliberately skipped. The challenge is the caller's to handle, so the response is returned
      // untouched and unclosed.
      if (crossOrigin) return response;

      const selection = pickChallengeHeader(response);
      if (selection === undefined) return response; // AUTH-33: no matching challenge header -> unchanged, no hook

      // AUTH-31, fast path: the shipped default hooks preserve the request body verbatim, so a non-replayable
      // body already decides the outcome -- surface the 401 unchanged WITHOUT running the hook, rather than
      // letting it evict a cached token and fetch a replacement that is then thrown away. A caller-supplied
      // hook may legitimately substitute a different (replayable) body, so it is still offered the challenge
      // and gated on its actual result below.
      const bodyIsOneShot = outbound.body !== undefined && !outbound.body.replayable;
      if (settings.challengeHook === undefined && bodyIsOneShot) return response;

      const hookContext: DefaultHookContext = {
        scheme,
        credentials: settings.credentials,
        bearerCache,
        composing,
        marginMs: bearerMarginMs,
        nowMs,
        signal,
      };
      const hook = settings.challengeHook ?? ((res: Response, req: Request) => defaultChallengeHook(res, req, hookContext));

      let replacement: Request | undefined;
      try {
        replacement = await hook(response, outbound);
      } catch (error) {
        await response.close(); // AUTH-32
        throw error;
      }
      if (replacement === undefined) return response; // AUTH-33: hook yielded nothing -> unchanged

      if (replacement.body !== undefined && !replacement.body.replayable) return response; // AUTH-31, uniformly

      // AUTH-28 again, on the replay path. The outbound guard above is NOT sufficient here: it is skipped
      // entirely for NO_AUTH, and nothing constrains a caller-supplied hook to preserve the request URL. The
      // replay is by definition "a request path where a credential will be attached", and AUTH-28 says "ANY"
      // such path -- so a hook that answers a challenge over plaintext must fail here rather than on the wire.
      // Guarded on the replacement actually carrying a credential header, so a hook that legitimately returns
      // a credential-free replacement (mirroring the cross-origin branch) is not blocked. The 401 is closed
      // before the throw for the same reason AUTH-32 closes it on a hook throw -- this path is past the point
      // where the caller still owns the response, so propagating unclosed would leak the body.
      if (replacement.headers.has('Authorization') || replacement.headers.has('Proxy-Authorization')) {
        try {
          requireHttps(replacement.url, scheme);
        } catch (error) {
          await response.close();
          throw error;
        }
      }

      await response.close();
      return fork()(replacement); // AUTH-30: exactly once, no nested re-challenge on this drive
    },
  };
}
```

- [ ] **Step 3b: Amend `RequestOptions` with the per-call `auth` field**

In `packages/core/src/http/request-options.ts`: add a `readonly #auth: AuthDescriptor | undefined` field, a
`get auth(): AuthDescriptor | undefined` accessor, and an `auth(descriptor: AuthDescriptor)` builder method,
mirroring the existing `timeoutMs`/`maxRetries` pattern exactly (constructor parameter, `EMPTY` leaves it
`undefined`). Type-only import: `import type {AuthDescriptor} from '../auth/descriptor.js';` — no cycle,
`descriptor.ts`'s chain (`requirement.ts`, `scheme.ts`) imports nothing from `http/`. No validation beyond the
type: any constructed `AuthDescriptor` is already valid per `AUTH-3`.

Append to `packages/core/src/http/request-options.test.ts`:

```typescript
describe('per-call auth descriptor (AUTH-4)', () => {
  test('EMPTY carries no auth descriptor', () => {
    expect(RequestOptions.EMPTY.auth).toBeUndefined();
  });

  test('the builder stores and the accessor returns the same descriptor instance', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH')]);
    expect(RequestOptions.newBuilder().auth(descriptor).build().auth).toBe(descriptor);
  });
});
```

(with `createAuthDescriptor`/`createAuthRequirement` imported from `../auth/descriptor.js` /
`../auth/requirement.js`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/auth-step.test.ts packages/core/src/http/request-options.test.ts`
Expected: PASS — 16 auth-step tests plus the two new request-options tests.

- [ ] **Step 5: Verify the ESLint limits hold**

Run: `bun run lint`
Expected: PASS. `preemptiveStamp`/`oauth2ChallengeHook`/`basicDigestChallengeHook`/`defaultChallengeHook` are
each 2-3 params via bundled context objects; the pillar `fn` closure is under 70 lines.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/auth/auth-step.ts packages/core/src/auth/auth-step.test.ts \
  packages/core/src/http/request-options.ts packages/core/src/http/request-options.test.ts
git commit -m "feat(core): the AUTH pillar step -- one challenge hook, scheme-dependent default (AUTH-27..33)"
```

---

### Task 15: `PipelineBuilder.seedFrom()` (`PIPE-35`)

**Plan-time necessity: `Runtime` gains a `transport` getter.** The design doc's module layout lists only
`builder.ts` as amended, but `seedFrom(runtime, 'flatten')` must "reuse runtime's transport as the new builder's
transport" (the design's own words), and 4c's `Runtime` (`packages/core/src/pipeline/runtime.ts`) exposes no way
to read its private `#transport` field — only `get steps()`. Without it, flatten mode cannot be implemented at
all. This task adds a two-line `get transport(): Transport` accessor to `Runtime` alongside the `builder.ts`
amendment — a structural requirement, not scope creep.

**Files:**
- Modify: `packages/core/src/pipeline/runtime.ts` (add `get transport()`)
- Modify: `packages/core/src/pipeline/builder.ts` (add `static seedFrom()`)
- Test: `packages/core/src/pipeline/builder.test.ts`

**Interfaces:**
- Consumes: `Runtime` (4c, plus this task's `transport` getter); `Transport` from `../seams/transport.js`;
  `PILLAR_STAGES`/`STAGE_ORDER` (4c, already used internally by `append`).
- Produces: `Runtime.transport: Transport` (getter); `PipelineBuilder.seedFrom(runtime, mode): PipelineBuilder`
  (static). Task 16 (`preset.ts`) does NOT consume this directly — the preset always starts from
  `new PipelineBuilder(transport)` (`PIPE-24`'s "empty slots only") — but `seedFrom` is what a caller reaches for
  to layer the preset onto an already-customized builder, per the design doc's own cross-reference.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pipeline/builder.test.ts (new describe block appended to the existing file from 4c Task 5)
// Exercises: PIPE-35 (explicit, non-defaulted mode; 'flatten' re-buckets seeded steps and reuses the seeded
// runtime's own transport as the new builder's terminal; 'nest' treats the seeded runtime as an opaque
// Transport, so its own steps run in a SEPARATE, inner cursor pass; flatten's pillar-collision rules apply
// exactly as any other append sequence would).
import {describe, expect, test} from 'bun:test';
import {createRequestContext, type ExecutionContext} from '../context/context.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import type {Transport} from '../seams/transport.js';
import {PipelineBuilder} from './builder.js';
import {PillarCollisionError} from './errors.js';
import type {StepDescriptor} from './step.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

class RecordingTransport implements Transport {
  readonly calls: Request[] = [];
  async send(request: Request): Promise<Response> {
    this.calls.push(request);
    return Response.newBuilder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .headers(request.headers)
      .body(null)
      .build();
  }
  async close(): Promise<void> {}
}

function probeStep(type: symbol, stage: StepDescriptor['stage'], order: string[], label: string): StepDescriptor {
  return {
    type,
    stage,
    fn: async (request, ctx) => {
      order.push(label);
      return ctx.next(request); // a plain pass-through probe never needs to re-drive, so next() suffices
    },
  };
}

describe('PipelineBuilder.seedFrom (PIPE-35)', () => {
  test('flatten: seeded steps run in the SAME pass as newly appended ones, reusing the original transport', async () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const seeded = new PipelineBuilder(transport)
      .append(probeStep(Symbol('a'), 'LOGGING', order, 'seeded'))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'flatten')
      .append(probeStep(Symbol('b'), 'SERDE', order, 'appended'))
      .build();

    await runtime.send(aRequest());

    expect(order).toEqual(['seeded', 'appended']); // one combined STAGE_ORDER pass
    expect(transport.calls).toHaveLength(1); // the ORIGINAL transport is the terminal -- not `seeded` itself
  });

  test('flatten: pillar-collision rules apply exactly as any other append sequence', () => {
    const transport = new RecordingTransport();
    const retryType = Symbol('retry-a');
    // Neither fn body below ever runs -- append() throws synchronously before build()/send() would invoke them.
    const seeded = new PipelineBuilder(transport)
      .append({type: retryType, stage: 'RETRY', fn: async (request, ctx) => ctx.next(request)})
      .build();

    expect(() =>
      PipelineBuilder.seedFrom(seeded, 'flatten').append({
        type: Symbol('retry-b'),
        stage: 'RETRY',
        fn: async (request, ctx) => ctx.next(request),
      }),
    ).toThrow(PillarCollisionError);
  });

  test('nest: the seeded runtime is an opaque Transport -- its steps run in a separate, inner pass', async () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const seeded = new PipelineBuilder(transport)
      .append(probeStep(Symbol('inner'), 'LOGGING', order, 'inner'))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'nest')
      .append(probeStep(Symbol('outer'), 'LOGGING', order, 'outer'))
      .build();

    await runtime.send(aRequest());

    expect(order).toEqual(['outer', 'inner']); // outer builder's own step runs BEFORE the nested runtime's
    expect(transport.calls).toHaveLength(1); // still exactly one wire send at the bottom
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/pipeline/builder.test.ts`
Expected: FAIL — `seedFrom is not a function`.

- [ ] **Step 3: Add `Runtime.transport`**

In `packages/core/src/pipeline/runtime.ts`, add alongside the existing `get steps()`:

```typescript
  get transport(): Transport {
    return this.#transport;
  }
```

- [ ] **Step 4: Add `PipelineBuilder.seedFrom()`**

In `packages/core/src/pipeline/builder.ts`, add the static method below. **No new import is needed** —
`builder.ts` already has `import {Runtime} from './runtime.js'` (4c uses it as a value in `build()`), and
adding a second `import type {Runtime}` from the same module would be a duplicate-identifier error.

```typescript
  /**
   * PIPE-35: explicit, non-defaulted `mode` -- "make the choice explicit, never accidental." `flatten`
   * re-buckets every seeded descriptor by its own stage (pillar-collision rules apply exactly as `append`
   * already enforces) and reuses `runtime`'s own transport as the new builder's terminal, so seeded and
   * newly-appended steps run in the SAME cursor pass. `nest` constructs a fresh builder whose transport IS
   * `runtime` itself, treated as an opaque `Transport` -- `Runtime implements Transport` already makes this
   * possible with zero adapter code -- so the new builder's own steps run once, outside `runtime`'s already-
   * flattened loops.
   */
  static seedFrom(runtime: Runtime, mode: 'flatten' | 'nest'): PipelineBuilder {
    if (mode === 'flatten') return new PipelineBuilder(runtime.transport).appendAll(runtime.steps);
    return new PipelineBuilder(runtime);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/src/pipeline/builder.test.ts`
Expected: PASS — every pre-existing 4c test plus the 3 new ones.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pipeline/runtime.ts packages/core/src/pipeline/builder.ts packages/core/src/pipeline/builder.test.ts
git commit -m "feat(core): PipelineBuilder.seedFrom() -- explicit flatten/nest composition (PIPE-35)"
```

---

### Task 16: `preset.ts` — the standard-resilience preset, the joint conformance test, and public-barrel promotion

This is the first point a caller can assemble a genuinely working pipeline. It also closes the two items 5b's
own Deferred Items table routed here: `PIPE-2`'s "auth executes per redirect hop" clause and `AUTH-29`'s
marker-*consumption* side.

**Files:**
- Create: `packages/core/src/auth/preset.ts`
- Test: `packages/core/src/auth/preset.test.ts`
- Modify: `packages/core/src/index.ts`
- Verify (not required byte-identical this phase, unlike every prior one): `packages/core/etc/core.api.md`

**Interfaces:**
- Consumes: `Transport` from `../seams/transport.js`; `PipelineBuilder` from `../pipeline/builder.js`; `Runtime`
  from `../pipeline/runtime.js`; `retryStep`, `RetryStepOptions` from `../retry/retry-step.js` (5a); `withRedirect`
  from `../redirect/strip-marker-step.js` (5b — installs `redirectStep()` + its `POST_AUTH` guard together, not
  the bare step); `RedirectSettings` from `../redirect/settings.js` (5b); `authStep`, `AuthStepSettings` from
  `./auth-step.js`; `createAuthDescriptor` from `./descriptor.js`; `createAuthRequirement` from
  `./requirement.js`.
- Produces: `interface StandardResilienceOptions {retry?, redirect?, auth?}`; `standardResilience(transport,
  options?): Runtime`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/preset.test.ts
// Exercises: PIPE-24 ("installs into empty slots only" -- true by construction, always starts from a fresh
// PipelineBuilder), PIPE-39 (installs exactly the three pillars that exist), and jointly with 5b: PIPE-2's
// "auth executes per redirect hop, not once for the whole call" and AUTH-29's marker-consumption side.
import {describe, expect, test} from 'bun:test';
import {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {PipelineBuilder} from '../pipeline/builder.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {withRedirect} from '../redirect/strip-marker-step.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {createAuthDescriptor} from './descriptor.js';
import {createAuthRequirement} from './requirement.js';
// Phase 7b retrofit: loggingStep's settings type, for the inert-by-default assertion below.
import type {Logger} from '../observability/logger.js';
import {standardResilience, type StandardResilienceOptions} from './preset.js';
import {AUTH_STEP_TYPE} from './auth-step.js';

function withLocation(response: Response, location: string): Response {
  return response.newBuilder().headers(response.headers.newBuilder().setInbound('Location', location).build()).build();
}

function bearerOptions(): StandardResilienceOptions {
  return {
    auth: {
      credentials: {bearer: {provider: async () => ({token: 'tok', expiresAt: Date.now() + 60_000})}},
      tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
    },
  };
}

describe('standardResilience', () => {
  test('installs exactly the three pillars that exist, into a fresh builder (PIPE-24/39)', () => {
    const runtime = standardResilience(new FakeTransport([countingResponse(200).response]), bearerOptions());
    const types = runtime.steps.map((step) => step.type);
    expect(types).toContain(AUTH_STEP_TYPE);
    // Phase 7b retrofit: redirectStep + its POST_AUTH guard + retryStep + authStep + loggingStep.
    expect(types).toHaveLength(5);
  });

  test('the installed loggingStep is inert by default (Phase 7b retrofit)', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const counter = {emitted: 0};
    const logger: Logger = {
      atLevel: () => ({
        field(): ReturnType<Logger['atLevel']> { return this; },
        event(): ReturnType<Logger['atLevel']> { return this; },
        cause(): ReturnType<Logger['atLevel']> { return this; },
        emit(): void { counter.emitted += 1; },
      }),
      withContext(): Logger { return logger; },
    };
    const runtime = standardResilience(transport, {...bearerOptions(), logging: {logger}});

    await runtime.send(Request.newBuilder().url('https://example.com').build());

    expect(counter.emitted).toBe(0); // default granularity 'none' emits no http.request/http.response events
  });

  test('NO_AUTH is the default when no auth option is supplied', async () => {
    const transport = new FakeTransport([countingResponse(200).response]);
    const runtime = standardResilience(transport);
    await runtime.send(Request.newBuilder().url('https://example.com').build());
    expect(transport.calls[0]?.request.headers.get('Authorization')).toBeUndefined();
  });

  test('joint conformance (PIPE-2 + AUTH-29): credential absent on the cross-origin hop, restamped on return to same-origin', async () => {
    const seedHop = countingResponse(302);
    const crossOriginHop = countingResponse(302);
    const finalHop = countingResponse(200);
    const toCrossOrigin = withLocation(seedHop.response, 'https://evil.example/mid');
    const backToSeedOrigin = withLocation(crossOriginHop.response, 'https://example.com/final');
    const transport = new FakeTransport([toCrossOrigin, backToSeedOrigin, finalHop.response]);

    const runtime = standardResilience(transport, bearerOptions());
    const response = await runtime.send(Request.newBuilder().url('https://example.com/start').build());

    expect(transport.calls).toHaveLength(3);
    expect(transport.calls[0]?.request.headers.get('Authorization')).toBe('Bearer tok'); // seed: same-origin, stamped
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBeUndefined(); // cross-origin: suppressed (AUTH-29)
    expect(transport.calls[2]?.request.headers.get('Authorization')).toBe('Bearer tok'); // back to same-origin: re-stamped (PIPE-2)
    expect(response).toBe(finalHop.response);
  });

  test('neither the redirect guard nor the marker check alone is sufficient -- both are independently necessary', async () => {
    // A minimal fake AUTH-stage step that IGNORES the cross-origin marker entirely and always stamps --
    // standing in for "what would happen if 5c's marker check were removed." With THIS step installed instead
    // of the real authStep(), the credential leaks onto the cross-origin hop, proving the marker actually
    // suppresses something observable rather than headers merely happening to come out empty.
    const leakyAuthStep: StepDescriptor = {
      type: Symbol('leaky-auth'),
      stage: 'AUTH',
      fn: async (request, ctx) => {
        const stamped = request.newBuilder().headers(request.headers.newBuilder().set('Authorization', 'Bearer leaked').build()).build();
        return ctx.next(stamped);
      },
    };
    const seedHop = countingResponse(302);
    const toCrossOrigin = withLocation(seedHop.response, 'https://evil.example/mid');
    const transport = new FakeTransport([toCrossOrigin, countingResponse(200).response]);

    const runtime = withRedirect(new PipelineBuilder(transport)).append(leakyAuthStep).build();
    await runtime.send(Request.newBuilder().url('https://example.com/start').build());

    // 5b's own redirect-step.ts already strips Authorization unconditionally on every re-issue (REDIR-7), so
    // this variant demonstrates the OTHER half: a leaky auth step re-attaches a credential redirect just
    // stripped, proving 5b's stripping alone is not sufficient either -- both layers are independently load-bearing.
    expect(transport.calls[1]?.request.headers.get('Authorization')).toBe('Bearer leaked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/auth/preset.test.ts`
Expected: FAIL — `Cannot find module './preset.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/auth/preset.ts
import {PipelineBuilder} from '../pipeline/builder.js';
import type {Runtime} from '../pipeline/runtime.js';
import type {RedirectSettings} from '../redirect/settings.js';
import {withRedirect} from '../redirect/strip-marker-step.js';
import {retryStep, type RetryStepOptions} from '../retry/retry-step.js';
import type {Transport} from '../seams/transport.js';
import {authStep, type AuthStepSettings} from './auth-step.js';
import {createAuthDescriptor} from './descriptor.js';
import {createAuthRequirement} from './requirement.js';
// Phase 7b retrofit: the LOGGING pillar step this preset previously left unfilled.
import {loggingStep, type LoggingStepSettings} from '../observability/logging-step.js';

export interface StandardResilienceOptions {
  readonly retry?: RetryStepOptions | undefined;
  readonly redirect?: Partial<RedirectSettings> | undefined;
  /** Required if any credential tier is configured; defaults to a NO_AUTH-only tier otherwise. */
  readonly auth?: AuthStepSettings | undefined;
  /** Phase 7b retrofit. Defaults to `loggingStep()`'s own defaults (granularity 'none' -- inert). */
  readonly logging?: LoggingStepSettings | undefined;
}

// Built lazily rather than as a top-level `const NO_AUTH_SETTINGS = {...createAuthDescriptor(...)}`: a
// module-scope factory call is import-time work a bundler must preserve (performance.md:48), and it would pin
// descriptor.ts/requirement.ts into every bundle that imports the preset. The allocation is per-call but the
// preset is constructed once per client, not per request.
function noAuthSettings(): AuthStepSettings {
  return {
    credentials: {},
    tiers: {client: createAuthDescriptor([createAuthRequirement('NO_AUTH')])},
  };
}

/**
 * PIPE-24/39: installs exactly the four resilience pillars that exist as of the 2026-07-28 Phase 7b retrofit
 * (redirect, retry, auth, logging), in redirect-then-retry-then-auth-then-logging order, into a FRESH
 * `PipelineBuilder` -- "installs into empty slots only" is therefore true by construction, with no runtime
 * check needed. `LOGGING` was left empty at 5c's original execution ("ships in Phase 7"); this retrofit fills
 * it once 7b exists, exactly the "narrow follow-up amendment, not a redesign" 5c's own original comment
 * anticipated. `SERDE` stays empty: it remains reserved with no shipped behavior anywhere in this roadmap's
 * current scope. A caller wanting to layer this preset onto an already-customized builder reaches for
 * `PipelineBuilder.seedFrom(runtime, 'nest' | 'flatten')` (Task 15) instead of this function growing a
 * "skip occupied slots" branch.
 *
 * `standardResilience()` itself only assembles the pipeline; the failures below surface from the returned
 * runtime's `send()`, and are documented here because this factory is where a caller chooses the auth
 * configuration that determines whether they can occur at all.
 *
 * @throws {@link PlaintextCredentialError} from `send()` when a credentialed scheme meets a non-HTTPS URL
 *   (AUTH-28).
 * @throws {@link AuthResolutionError} from `send()` when no configured credential satisfies the resolved
 *   auth tier (AUTH-4/AUTH-6) or a token provider misbehaves (AUTH-35).
 *
 * @example
 * ```ts
 * const client = standardResilience(transport, {
 *   auth: {
 *     credentials: {apiKey: {credential: new ApiKeyCredential(process.env.API_KEY ?? '')}},
 *     tiers: {client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
 *   },
 * });
 * const response = await client.send(Request.newBuilder().url('https://api.example.com/v1/things').build());
 * ```
 */
export function standardResilience(transport: Transport, options: StandardResilienceOptions = {}): Runtime {
  const builder = new PipelineBuilder(transport);
  return withRedirect(builder, options.redirect)
    .append(retryStep(options.retry))
    .append(authStep(options.auth ?? noAuthSettings()))
    .append(loggingStep(options.logging))
    .build();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/auth/preset.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Public-barrel promotion**

In `packages/core/src/index.ts`, add (following the file's existing `export {X, Y} from './path.js';`
convention established since Phase 1):

```typescript
// -- Group 1: the pillar-authoring surface. --
// `Stage` lives in stage.ts alongside STAGE_ORDER/PILLAR_STAGES (4c Task 1) -- NOT in step.ts.
export type {Stage} from './pipeline/stage.js';
export type {StepContext, Next, StepDescriptor} from './pipeline/step.js';
export {STAGE_ORDER, PILLAR_STAGES} from './pipeline/stage.js';
export {PipelineBuilder} from './pipeline/builder.js';
export {Runtime} from './pipeline/runtime.js';
export {retryStep} from './retry/retry-step.js';
export {redirectStep} from './redirect/redirect-step.js';
export {authStep} from './auth/auth-step.js';
export {standardResilience} from './auth/preset.js';

// -- Group 2: everything Group 1's signatures name. A promoted function whose parameter type is @internal is
//    an API a caller cannot call; api-extractor also reports each omission as ae-forgotten-export. --
export type {RetryStepOptions} from './retry/retry-step.js';
export type {RedirectSettings} from './redirect/settings.js';
export type {LoggingStepSettings} from './observability/logging-step.js'; // Phase 7b retrofit
export type {StandardResilienceOptions} from './auth/preset.js';
export type {
  ApiKeyCredentialConfig,
  AuthCredentialSet,
  AuthStepSettings,
  BasicCredential,
  BearerCredential,
  ChallengeHook,
  DigestCredential,
} from './auth/auth-step.js';
export type {AuthTiers} from './auth/resolve.js';
export type {AuthScheme} from './auth/scheme.js';
export type {DigestAlgorithm} from './auth/digest.js';
// Factories, not bare interfaces: AUTH-3 validates and freezes in createAuthDescriptor, and
// ApiKeyCredential/NameKeyCredential are NOMINAL (they carry `#key`), so no caller-side object literal is
// assignable. Without these, API_KEY auth is unreachable from outside the package.
export type {AuthDescriptor} from './auth/descriptor.js';
export {createAuthDescriptor} from './auth/descriptor.js';
export type {AuthRequirement} from './auth/requirement.js';
export {createAuthRequirement} from './auth/requirement.js';
export type {BearerToken, TokenProvider} from './auth/credential.js';
export {ApiKeyCredential, NameKeyCredential, createBearerToken} from './auth/credential.js';
export {AuthResolutionError, DigestChallengeUnsupportedError, PlaintextCredentialError} from './auth/errors.js';
```

**Also strip the now-wrong `@internal` TSDoc tags.** 4c marked `PipelineBuilder`, `Runtime`, `Cursor`'s
public-facing types, and `StepDescriptor` `@internal` precisely because they were not exported yet. Promoting
them while the tag remains makes `lint:publish`/api-extractor flag a documented-internal symbol reachable from
the public entry point. Remove `@internal` from exactly the symbols in the export list above — and from nothing
else; `Cursor`, `PipelineBuilder`'s private helpers, and 5a/5b's step internals keep theirs.

Everything else under `packages/core/src/auth/` — `challenge.ts`, `md5.ts`, `basic.ts`, `digest.ts`'s handler
internals (`NonceCountStore`, `computeDigestResponse`), `composing-handler.ts`, `bearer-cache.ts`,
`static-key.ts` — stays internal. A caller configures auth by *building* an `AuthStepSettings` value from the
Group 2 factories and passing it to `authStep()`/`standardResilience()`, never by constructing handler
internals directly. `redirectStep` is promoted alongside (it is equally part of the authoring surface and 5b
shipped before this phase closes), but 5b's `withRedirect`/`stripCrossOriginMarkerStep`/the marker functions
stay internal — a caller reaches for `redirectStep` directly only if composing a custom pipeline by hand;
`standardResilience()` remains the recommended path for the common case.

**Smoke-check the promotion is actually usable** before moving to Step 6: from a scratch file importing *only*
from `@dexpace/core`'s entry point, construct
`standardResilience(transport, {auth: {credentials: {apiKey: {credential: new ApiKeyCredential('k')}}, tiers: {client: createAuthDescriptor([createAuthRequirement('API_KEY')])}}})`
and typecheck it. If any symbol in that expression is unreachable, Group 2 is incomplete — that expression is
the minimum a caller needs to use the phase's headline feature.

- [ ] **Step 6: Regenerate and review the API report**

Run: `bun run api`
Expected: `packages/core/etc/core.api.md` gains entries for exactly the Group 1 + Group 2 symbols listed above,
and exactly one amended existing entry: `RequestOptions` gains the `auth?: AuthDescriptor` member from Task 14
Step 3b. Review the diff by hand; this is the one phase where the API report is expected to change.

**Zero `ae-forgotten-export` warnings is the pass condition.** api-extractor emits one for every type reachable
from an exported signature that is not itself exported — so a warning naming `RetryStepOptions`,
`AuthCredentialSet`, `DigestAlgorithm`, or similar means Group 2 is missing an entry, not that the warning
should be suppressed. Do NOT silence one by narrowing a signature to an inline structural type: that trades a
named, documentable contract for an anonymous one and hides the same surface from the snapshot that
`NFR-4`/`tooling-and-quality-gates.md:40` exist to gate.

- [ ] **Step 7: Run the full gate sequence**

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/auth/preset.ts packages/core/src/auth/preset.test.ts packages/core/src/index.ts packages/core/etc/core.api.md
git commit -m "feat(core): standard-resilience preset + public pillar-authoring barrel (PIPE-24/35/39)"
```

---

### Task 17: Final gates and the requirement checklist

**Files:**
- Verify: full gate sequence (already run at the end of Task 16; re-run here to confirm nothing regressed from
  the barrel edit's review)
- Create: `docs/work/mvp/phase5/phase5c/2026-07-26-phase5c-auth-checklist.md`

**Interfaces:**
- Consumes: every symbol from Tasks 1–16.
- Produces: a green gate run and the requirement checklist Phase 9's conformance sweep reads.

- [ ] **Step 1: Confirm no `node:` import crept in**

Run: `bun run verify:seam-1`
Expected: PASS. `globalThis.crypto`/`globalThis.btoa` are the only "crypto-shaped" imports anywhere in
`src/auth/`.

- [ ] **Step 2: Run the full gate sequence one more time**

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage \
  && bun run api && bun run lint:publish && bun run verify:dual-consumption \
  && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: every gate PASS. `test:node` matters specifically here: `globalThis.crypto.subtle.digest`,
`globalThis.crypto.getRandomValues`, and `globalThis.btoa` must all behave identically under Node and Bun.

- [ ] **Step 3: Write the requirement checklist**

Create `docs/work/mvp/phase5/phase5c/2026-07-26-phase5c-auth-checklist.md`, same format as
`2026-07-26-phase5a-retry-checklist.md`/`2026-07-26-phase5b-redirect-checklist.md` — `| ID | Level |
Requirement gist | Status | Where |` tables, legend ✅ shipped / 🚫 never built / ⏳ deferred / N/A.

Sections and their sources:

1. **Descriptor/resolver model** — `AUTH-1` ✅ Task 2; `AUTH-2` ✅ Task 3; `AUTH-3` ✅ Task 4 (via `invariant()`,
   not the design doc's assumed `ArgumentError` — see Global Constraints); `AUTH-4`–`AUTH-7` ✅ Task 5.
2. **Credentials** — `AUTH-8`–`AUTH-10` ✅ Task 6; `AUTH-11` ✅ Tasks 6 + 13 (errors propagate uncached, and
   `TokenProvider` takes `{signal}` so the call's cancellation reaches the fetch — Deviation Ledger).
3. **Challenge parsing** — `AUTH-12` ✅ Task 7 (synthetic key `'token68'`, the requirement's own spelling);
   `AUTH-13` ✅ Task 7.
4. **Stamping handlers** — `AUTH-14` ✅ Task 9; `AUTH-15`–`AUTH-18`, `AUTH-20`–`AUTH-22` ✅ Tasks 8, 10
   (`AUTH-22` includes echoing the challenge's `opaque` back, quoted); `AUTH-19` ✅ Task 10 (bounded at 1024
   and **drained to the cap in a loop after admitting**, per XCUT-14 — not a pre-insert single evict);
   `AUTH-23`–`AUTH-25` ✅ Task 12; `AUTH-26` ✅ Task 11.
5. **The AUTH pillar step** — `AUTH-27` ✅ Task 14; `AUTH-28` ✅ Task 14 (**both paths**: the outbound pass and
   again on a challenge replacement that carries a credential header — the outbound guard alone is skipped for
   `NO_AUTH` and cannot see a hook-substituted URL); `AUTH-29` ✅ Task 14 (both halves: the outbound
   suppression AND the challenge-reaction suppression), joint conformance test ✅ Task 16;
   `AUTH-30`–`AUTH-33` ✅ Task 14; `AUTH-38` (SHOULD — guard/hook failures delivered through the async channel)
   ✅ Task 14, satisfied structurally: the step's `fn` is `async`, so a `PlaintextCredentialError` or a hook
   throw becomes a rejected promise rather than a synchronous throw, with no separate code path needed.
6. **Bearer cache** — `AUTH-34`/`AUTH-37` ✅ Task 13 (one unified policy, not two — see the Deviation Ledger
   below; AUTH-37's post-eviction "genuinely fresh fetch" clause is `refreshNow()`, which bypasses the
   single-flight coalescing so the retry cannot re-send the rejected token); `AUTH-35` ✅ Task 13; `AUTH-36`
   ✅ Task 14.
7. **`PIPE-35` seedFrom** — ✅ Task 15.
8. **`PIPE-24`/`PIPE-39` preset** — ✅ Task 16.
9. **`PIPE-2`'s redirect-hop half** — ✅ **Resolved in Task 16** (joint conformance test, jointly with 5b).
10. **Public-barrel promotion** — ✅ Task 16, **both groups**: the pillar-authoring surface and the auth
    configuration surface its signatures name. Record in the checklist that the pass condition is a caller
    building a working `AuthStepSettings` importing only from the package entry point — not merely that
    `authStep` appears in `core.api.md`.
11. **Deferred out of Phase 5c** — `standardResilience()` gaining a `LOGGING` step → **resolved 2026-07-28,
    Phase 7b retrofit** (Task 16, this document); re-verification of
    "Basic/Digest never preemptively stamp" against reference fixtures → Phase 9; `DigestChallengeUnsupportedError`
    consumer confirmation → see Deviation Ledger note below; a per-**operation** `AuthTiers` source → unscoped
    future work (the `perCall` and `client` tiers both have real sources as of Task 14); AUTH-37's
    "log-and-continue" logging half for a failed background refresh → Phase 7b, where a `Logger` first exists.

State explicitly at the top whether the plan has been executed, matching the Phase 5a/5b checklists' convention.

- [ ] **Step 4: Commit**

```bash
git add docs/work/mvp/phase5/phase5c/2026-07-26-phase5c-auth-checklist.md
git commit -m "docs: Phase 5c requirement checklist"
```

---

## Deviation Ledger (for Phase 10)

Reproduced from the design doc, plus every plan-time correction this plan itself introduced:

| Deviation | Reference / design-doc behavior | Justification |
|---|---|---|
| One bearer strategy (three-zone async), not two | Reference ships a sync single-flight strategy and a separate async strategy | Same reasoning as 5a's `RETRY-28` collapse — one `Promise`-only execution model |
| `AUTH-31`'s replayability gate applied uniformly | Reference applies it on the sync auth step only, SHOULD extend to async | One unified step leaves exactly one place to apply it |
| Basic/Digest never stamp preemptively | Not explicitly stated either way in the spec; inferred from AUTH-14/23-25's exclusively challenge-driven phrasing | Digest cannot stamp before seeing `realm`/`nonce`; flagged for Phase 9 re-verification |
| `AUTH-3`/`AUTH-6` use `invariant()`, not `ArgumentError` | Design doc's prose says "`ArgumentError` reused from earlier phases" | **No such class exists in any prior phase's plan** — this is a plan-time correction, not a deviation from working code. `invariant()` matches 5a/5b's identical treatment of construction-time caller misconfiguration |
| `AuthCredentialSet` designed at plan time (Task 14) | Referenced by `AuthStepSettings.credentials` but never defined in the design doc or knowledge corpus | Necessary to make `authStep()`/`resolveAuthRequirement`'s `availableSchemes` concrete; shape chosen to mirror each scheme's actual wire needs |
| `ChallengeHandler.stamp` returns `Promise<string>`, not `string`; gains an optional third `request` parameter and an optional `rank` method | Design doc's prose gives `stamp(challenge, isProxy): string` | SHA-256 needs `crypto.subtle.digest()` (async); Digest's HA2 needs the request method/target, which `challenge`/`isProxy` don't carry; `rank` is needed for AUTH-16's algorithm-preference-over-wire-order requirement across multiple offered Digest challenges. All three are additive and optional/backward-compatible with Basic's simpler implementation |
| `auth-step.ts`'s default handler list is built from `settings.credentials`, not zero-argument `digestHandler()`/`basicHandler()` calls | Design doc's shorthand: `handlers?: ...; default = [digestHandler(), basicHandler()]` | Both handlers need a username/password to do anything; the shorthand omits where those come from |
| `Runtime` gains a `transport` getter | Design doc's module layout lists only `builder.ts` as amended for `seedFrom` | `seedFrom(runtime, 'flatten')` structurally cannot reuse the seeded runtime's transport without reading it |
| Module-layout drift: no `token-provider.ts`; `errors.ts` added; `AuthStepSettings` gains `bearerMarginMs` and `now` | Design doc's layout lists `token-provider.ts` as its own file (AUTH-11), lists no `errors.ts`, and gives `AuthStepSettings` four members | `TokenProvider` is a two-line type over `BearerToken` and belongs beside it in `credential.ts` (`module-organization.md:42`, one concept per file — a provider type and the token it returns are one concept). `errors.ts` is where the design's own "Error Types" section lands, matching 4c's `pipeline/errors.ts` precedent. `bearerMarginMs` surfaces AUTH-34's "configurable refresh margin" (default 30s); `now` is the injected clock, its own row above. File count is unchanged at fifteen |
| `BearerTokenCache.refresh` validates the fetched token against the caller-injected `nowMs`, not `Date.now()` | Design doc's snippet calls `Date.now()` inside `#refresh` while `stamp()` takes an injected clock | Two clocks in one state machine: a caller (or test) driving time synthetically would have every fetched token rejected as expired, and production code could not control the second clock at all |
| `AuthStepSettings.now` — the injected clock reaches all the way up to the step, not just the cache | Design doc (and this plan's own first draft) reads `Date.now()` directly inside `auth-step.ts` | The row above is only half a fix. `auth-step.ts` is the cache's ONLY caller, so an ambient `Date.now()` there is exactly the "second, invisible clock the caller cannot control" that row rejects — it makes every expiry/margin/three-zone boundary untestable through the step, which is why the original tests had to write `Date.now() + 60_000`. `docs/knowledge/testing.md:36` bans real-clock reads in a unit test outright. Phase 7a's `Clock` seam may supersede the field; a local hook avoids a forward dependency until then |
| The background refresh's rejection is swallowed with a NARROWED `.catch`, rethrowing `InvariantViolation` | Design doc's snippet uses a bare `void this.#refresh(provider)` | `AUTH-37` makes a failed background refresh non-fatal *because a valid token was already stamped* — a bare `void` leaves the rejection unhandled, which terminates the process under Node's default policy. But a blanket catch also absorbs programmer errors, and `error-handling.md:24` requires a deliberately-ignored error be "narrowed to the one expected error type" while `:36` requires an `invariant` violation crash loudly. AUTH-37's "log-and-continue" half is deferred to 7b, which is where a `Logger` first exists |
| `TokenProvider` takes `{signal}`; the call's `AbortSignal` is threaded from `StepContext.signal` to the fetch | Design doc's `TokenProvider = () => Promise<BearerToken>` accepts no cancellation | A token fetch is external I/O on the request path. `concurrency-and-async.md:44`: "a signal accepted at the top of a call chain must be passed through every layer down to the actual I/O primitive; a signal that stops at the first function is decoration." 5a Task 1 already exposes `StepContext.signal`, so one is available; without the parameter a hung provider pins the auth step, every retry nested under it, and the whole request, uncancellable |
| `BearerTokenCache.refreshNow()` — the post-eviction path bypasses single-flight coalescing | Design doc's `oauth2ChallengeHook` calls plain `stamp()` after `evict()` | `AUTH-37`'s final clause: "The post-eviction challenge path MUST await a genuinely fresh fetch so the retry never re-sends the rejected token." `evict()` clears the cached token but not `#inFlight`, so `stamp()` can coalesce onto a fetch that started BEFORE the 401 — and `AUTH-11` explicitly permits a provider that "caches/refreshes internally", so that fetch can resolve to (and re-cache) the very token the server just rejected. Neither the design doc nor this plan's first draft mentioned the clause |
| `AUTH-28`'s HTTPS guard is re-applied to a challenge replacement carrying a credential header | Design doc guards the outbound pass only | `AUTH-28` says "on ANY request path where a credential will be attached". The outbound guard is skipped entirely for `NO_AUTH`, and nothing constrains a caller-supplied `challengeHook` to preserve the request URL — so a hook answering a challenge (the documented use case, e.g. a custom OAuth2 grant) could stamp over plaintext. Guarded on the replacement actually carrying `Authorization`/`Proxy-Authorization`, so a deliberately credential-free replacement still passes |
| `NonceCountStore` drains to the cap in a loop after admitting, not one victim before each insert | Design doc: "drained under the cap with a simple insertion-order eviction" | `concurrency-and-async.md:84` (XCUT-14) requires a server-keyed map "drain back under the cap after each insert **using a loop rather than a single pre-insert check-then-evict**, so a concurrent insert burst converges to the bound", and AUTH-19 words it as draining "after admitting a nonce". A single pre-insert evict removes at most one entry per insert and never converges under a burst of fresh server nonces |
| The token68 synthetic key is `'token68'`, not `'__token68__'` | Design doc uses `'__token68__'` to avoid a name collision | `AUTH-12` spells the key literally, and Phase 9's conformance sweep reads it verbatim. RFC 7235's token68 is positional, never `name=value`, so the collision the `__` guarded against cannot arise |
| `AuthResolutionError`/`PlaintextCredentialError` carry their identifying data as `readonly` fields, not only interpolated prose | Design doc's Error Types section describes only what each error "carries" in its message | `error-handling.md:6`/`:44` require identifying inputs as fields so they "survive serialization and appear in structured logs" and a log aggregator can index them "without parsing prose". `DigestChallengeUnsupportedError` already did this, so the file was inconsistent with itself |
| The public barrel promotes the auth CONFIGURATION surface, not only `authStep`/`standardResilience` | Design doc keeps "the credential types … handlers" `@internal` while promoting the two functions | A promoted function whose parameter types are `@internal` is an API a caller cannot call. `ApiKeyCredential`/`NameKeyCredential` carry `#key`, making them *nominal* — no object literal substitutes — so `API_KEY` auth was unreachable from outside the package entirely, and `AuthDescriptor` must come from `createAuthDescriptor` because that is where AUTH-3 validates and freezes. api-extractor also reports each omission as `ae-forgotten-export`, failing Task 16's own `api`/`lint:publish` gates. Handler internals (challenge parser, MD5, Basic/Digest/composing, bearer cache) stay internal as designed |
| `AUTH-31`'s gate has a pre-hook fast path when no caller hook is configured | Design doc gates only on the hook's returned replacement | The shipped default hooks preserve the request body verbatim, so a one-shot body already decides the outcome; running the hook first would evict a cached token and fetch a replacement only to discard it. A caller-supplied hook may legitimately substitute a replayable body, so it is still offered the challenge and gated on its actual result |
| Only the `operation` tier lacks a distinct source; `perCall` and `client` both have one | Design doc's `AuthTiers {perCall, operation, client}` implies three genuinely different lookup sources | `perCall` is genuinely per-call, sourced from `RequestOptions.auth` via `StepContext.options` (Task 14, matching the design doc's own §"Per-call tier override"); `client` is `authStep()`'s construction-time config. Only `operation` has no source, because no phase in this roadmap ships a per-operation layer — that residue is the Deferred Items row below, not a divergence in `resolveAuthRequirement`'s AUTH-4..7 logic, which is unchanged |
| No async-variant preset | Reference's async standard pipeline (retry+instrumentation+caller-supplied scheduler) | 4c already dispositioned one `Promise`-only execution model |
| `standardResilience()` installed only REDIRECT/RETRY/AUTH at original execution, not LOGGING | Design doc notes the reference preset also includes instrumentation | **Resolved 2026-07-28** — Phase 7b retrofit (Task 16) adds `loggingStep()` once 7b exists; no longer a live gap |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Deferred from | Target | Reason |
|---|---|---|---|
| `standardResilience()` gains a `LOGGING` pillar step | Phase 5c design | **Resolved 2026-07-28 (Phase 7b retrofit)** | Task 16 now installs `loggingStep()`; see this plan's amendment banner |
| Re-verification of "Basic/Digest never preemptively stamp" against reference fixtures | Phase 5c design | Phase 9 (conformance sweep) | Flagged as an interpretation, not a certainty |
| `DigestChallengeUnsupportedError` — confirm whether any caller-facing API needs it, or cut it | Phase 5c design | This plan (see note) | **Not cut** — kept as a `@internal`-tier leaf for a lower-level API consumer (a caller constructing `composingHandler`/`digestHandler` directly, bypassing `authStep()`); `authStep()` itself never throws it, matching the design's own framing. If Phase 9's conformance sweep finds no such consumer, cut it then |
| True per-call/per-operation `AuthTiers` via `ExecutionContext` | This plan (Task 14's scoping note) | Unscoped future work | No phase in the current roadmap wires this; `AuthStepSettings.tiers` is one static value until it does |

---

## Self-Review

**Spec coverage.** Walked every section of `2026-07-26-phase5c-auth-design.md`:

| Spec section | Task |
|---|---|
| How this doc was produced / alignment with 5b | N/A (process notes, not implementation) |
| Module layout | 1–16 |
| Descriptor/resolver model (`scheme.ts`/`requirement.ts`/`descriptor.ts`/`resolve.ts`) | 2–5 |
| Credentials (`credential.ts`/`token-provider.ts`) | 6 |
| Challenge parsing (`challenge.ts`) | 7 |
| Stamping handlers (`basic.ts`/`digest.ts`/`md5.ts`/`static-key.ts`/`composing-handler.ts`) | 8, 9, 10, 11, 12 |
| The AUTH pillar step (`auth-step.ts`) | 14 |
| `PipelineBuilder.seedFrom()` | 15 |
| The standard-resilience preset (`preset.ts`) | 16 |
| Public-barrel promotion | 16 |
| Error types | 1 |
| Testing — joint conformance, property tests, negative space | 7, 8, 10, 13, 16 |
| Deviation Ledger, Deferred Items | 17, plus this document's own Deviation Ledger above |
| Alignment with 5b's shipped design (marker + "everything else checked") | Consumed unchanged throughout (Tasks 3, 14) |

No gaps.

**Placeholder scan.** No "TBD"/"implement later"/"similar to Task N" language anywhere above; every code step
carries complete, runnable content, including a hand-rolled MD5 with RFC-1321-verified test vectors and a
Digest response computation verified against locally-computed (not memorized) RFC 2617/7616-style vectors.

**Type consistency.** `ChallengeHandler` (Task 7) is implemented identically by `basicHandler()` (Task 9) and
`digestHandler()` (Task 10) and consumed identically by `composingHandler()` (Task 12) and `authStep()`'s
`buildDefaultHandlers()` (Task 14) — same three members (`canHandle`, `stamp`, optional `rank`) throughout.
`AuthCredentialSet` (Task 14) is the one shape referenced by `availableSchemesOf()`, `buildDefaultHandlers()`,
`preemptiveStamp()`, and both default-hook helpers — all in Task 14, spelled identically. `DigestUriContext`
(Task 7) is produced by `basicDigestChallengeHook()` (Task 14) and consumed by `composingHandler.stamp()` (Task
12) and `digestHandler().stamp()` (Task 10) with the same two fields (`method`, `requestTarget`) throughout.
`AuthTiers`/`resolveAuthRequirement` (Task 5) is consumed by `AuthStepSettings.tiers` (Task 14) and by
`noAuthSettings()`/`bearerOptions()` in Task 16's preset and test — all constructed via `createAuthDescriptor`/
`createAuthRequirement` (Tasks 3–4), never a hand-built object literal that could drift from the frozen shape.

**Known rough edge, deliberately left.** Tasks 6, 14, and 16 import `aRequestContext()` (Task 14, 16's `Cursor`-
based tests) or reuse 4c's cursor-test helper — same caveat 5a's and 5b's plans already carried forward:
inline a `RequestContext` instead if that helper turns out to be file-local to 4c's own test file rather than a
shared one.

---
---
---
---
---
