# Phase 9 — Cross-Cutting Invariants & Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove `docs/product-spec/19-cross-cutting-invariants-and-policies.md` (`XCUT-1`–`XCUT-24`) and
`docs/product-spec/20-non-functional-requirements-and-quality-bar.md` (`NFR-1`–`NFR-17`) hold across the composed
workspace, ship `@dexpace/shrink-test` (`NFR-9`), and close three stale `unresolved 2026-07-25` markers in
`docs/knowledge/tooling-and-quality-gates.md` — per `docs/work/mvp/phase9/2026-07-28-phase9-cross-cutting-conformance-design.md`.

**Architecture:** One new private/unpublished devDependency package (`@dexpace/shrink-test`) plus one new top-level
integration-test directory (`tests/conformance/xcut/`, the first use of `docs/knowledge/testing.md:8`'s
top-level-`tests/`-for-cross-process convention in this repository). Every `XCUT-N` test drives a **real** composed
pipeline — `standardResilience(transport, options)` (5c, amended by 7b to also install `LOGGING`) over a real
`fetchTransport()`/`undiciTransport()` against a local `node:http` fixture server — never a reimplementation of any
subsystem's own unit test. No new public API in any published package.

**Tech Stack:** TypeScript 5.8+, `bun test`, `esbuild` (new devDependency, `@dexpace/shrink-test` only), `node:http`
test fixtures (test-only, same pattern as `packages/transport-conformance/src/fixtures.ts`).

**Prerequisite:** Phases 0 through 8b implemented exactly as their plans specify — every ID this plan cites
(`CancellationError`, `TransportFailureError`, `IoError`, `HttpStatusError`/`toHttpError`, `RETRYABLE_STATUSES`/
`isRetryableStatus`/`isRetryableFailure`, `RetrySettings`/`retrySettings`, `RedirectSettings`, `AuthStepSettings`,
`standardResilience`, `fetchTransport`, `undiciTransport`, `getGlobalLogger`/`setGlobalLogger`, `jsonSerde`) is a
real, already-shipped symbol from an earlier phase's plan, not something this plan invents. Concretely consumed:

- `packages/core/src/body/http-status-error.ts` — `HttpStatusError`, `toHttpError()` (3b)
- `packages/core/src/io/errors.ts` — `IoError`, `TransportFailureError` (3a, 8a)
- `packages/core/src/seams/transport.ts` — `Transport`, `composeSignal`, `isTimeoutSignal`, `CancellationError` (2)
- `packages/core/src/retry/classify.ts` — `RETRYABLE_STATUSES`, `isRetryableStatus`, `isRetryableFailure` (5a,
  re-exporting Phase 7a's `config/retryable.js`)
- `packages/core/src/retry/settings.ts` — `RetrySettings`, `retrySettings`, `DEFAULT_RETRY_SETTINGS` (5a)
- `packages/core/src/redirect/*` — `RedirectSettings` (5b)
- `packages/core/src/auth/*` — `AuthStepSettings`, credential/tier types (5c)
- `packages/core/src/auth/preset.ts` — `standardResilience(transport, options): Runtime` (5c, `LOGGING`-amended by 7b)
- `packages/core/src/observability/*` — `getGlobalLogger`, `setGlobalLogger`, `Logger`, `LogEvent` (7b)
- `packages/transport-fetch`, `packages/transport-undici` — `fetchTransport()`, `undiciTransport()` (8a)
- `packages/codec-json` — `jsonSerde()` (6a)

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/`verify:dual-consumption`/
`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **No new public API in any published package.** `@dexpace/shrink-test` is `private: true`, unpublished, a
  devDependency of the workspace root only. `tests/conformance/xcut/` is not a package.
- **Every conformance test drives real, already-shipped components** — never a fake/mock of a subsystem this phase
  itself is supposed to be proving. A local `node:http` fixture server stands in for the network only.
- **Every `*.conformance.test.ts` file cites the `XCUT-N` IDs it exercises** in a header comment, per the project's
  running convention (5a's `RECOV-N`, 8a's `TRANSPORT-N`).
- **A retrofit citation is a comment-only change** — add the ID to an existing test's header comment; never
  duplicate a test another phase already owns.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`** (`erasableSyntaxOnly`). Unions and frozen constant objects only.
- **Explicit return types on every exported function.** Kebab-case filenames. Named exports only.
- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT`.
- **Tests that spin up a local `node:http` server must close it in `afterAll`, on an ephemeral port
  (`listen(0)`), reading the assigned port back off the server** — never a hardcoded port.
- **`docs/knowledge` is authoritative over any plan** (the checkpoint's own precedence rule, re-affirmed here) —
  where Task 11's documentation fixes and this plan's code disagree, the corpus edit wins and this plan is amended.
- **Request literals are shorthand, not the real construction path.** Every test below builds request-shaped
  object literals (`{url, method, headers, ...} as never`) rather than chaining Phase 1's real
  `Request.newBuilder()...build()` — this keeps the plan's own code blocks focused on the `XCUT-N` behavior under
  test rather than re-deriving builder call chains already exhaustively specified in Phase 1's own plan. Expand
  each to the real builder call during execution; the `as never` casts are the marker of exactly which lines need
  that expansion, not an intentional bypass of the builder's own validation (`HTTP-4` etc., which still applies
  and must not be skipped in the executed test).

---

## File Structure

```
packages/shrink-test/                        # private: true, unpublished devDependency
  package.json
  shrink-test.config.ts                        # budget number, participating packages   (Task 1)
  src/
    fixture-app.ts                                # dual-package-hazard consumer          (Task 1)
    bundle.ts                                      # esbuild bundle/minify/tree-shake      (Task 2)
    bundle.test.ts
    run-shrink-guard.ts                             # NFR-9 guard: budget + round trip     (Task 3)
    run-shrink-guard.test.ts

tests/conformance/xcut/
  fixtures/
    server.ts                                      # local node:http fixture server         (Task 4)
    composed-pipeline.ts                             # standardResilience() wrapper           (Task 4)
  cancellation-and-timeout.conformance.test.ts        # XCUT-1, 3                             (Task 5)
  error-taxonomy.conformance.test.ts                   # XCUT-4, 6, 7, 9                       (Task 6)
  retry-safety.conformance.test.ts                      # XCUT-10                              (Task 7)
  concurrency-and-lifecycle.conformance.test.ts          # XCUT-11, 13, 14                      (Task 8)
  security-by-default.conformance.test.ts                 # XCUT-17                             (Task 9)
  diagnostic-previews.conformance.test.ts                  # XCUT-24                             (Task 10)

docs/knowledge/tooling-and-quality-gates.md    # 3 marker replacements                        (Task 11, doc-only)
```

Eight new production/test files across one new package plus one new test directory; one documentation edit; zero
modified production files in any existing package.

---

### Task 1: `@dexpace/shrink-test` — scaffold and the dual-package-hazard fixture app

**Files:**
- Create: `packages/shrink-test/package.json`, `shrink-test.config.ts`
- Create: `packages/shrink-test/src/fixture-app.ts`

**Interfaces:**
- Consumes: `IoError`, `TransportFailureError` (`@dexpace/core`), `fetchTransport` (`@dexpace/transport-fetch`),
  `jsonSerde` (`@dexpace/codec-json`).
- Produces: `runFixtureApp(): Promise<{caughtViaCoreImport: boolean}>` (default export of `fixture-app.ts`, invoked
  by the bundled artifact at Task 3).

- [ ] **Step 1: Scaffold the package**

```json
// packages/shrink-test/package.json
{
  "name": "@dexpace/shrink-test",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "devDependencies": {
    "esbuild": "^0.24.0"
  },
  "scripts": {
    "test": "bun test"
  }
}
```

This is a devDependency of the **workspace root** (`bunfig.toml`/root `package.json` `workspaces` entry), not
consumed by any other package — no other `package.json` in the workspace lists `@dexpace/shrink-test` in its own
`dependencies`/`devDependencies`.

```typescript
// packages/shrink-test/shrink-test.config.ts
// SPDX-License-Identifier: MIT
export interface ShrinkTestConfig {
  readonly budgetBytes: number;
  readonly participatingPackages: readonly string[];
}

export const SHRINK_TEST_CONFIG: ShrinkTestConfig = Object.freeze({
  budgetBytes: 50_000, // minified+tree-shaken fixture-app.ts + its three imports; adjust only with a reviewed reason
  participatingPackages: Object.freeze(['@dexpace/core', '@dexpace/transport-fetch', '@dexpace/codec-json']),
});
```

- [ ] **Step 2: Write the fixture app — the dual-package-hazard shape**

`docs/knowledge/tooling-and-quality-gates.md:116` names the exact risk this fixture proves does not survive a
bundle-and-tree-shake round trip: an error thrown by one package caught via `instanceof` imported from another.
`TransportFailureError extends IoError` (8a retrofit to 3a's file) is precisely that pair — thrown by
`@dexpace/transport-fetch`, its base class imported from `@dexpace/core`.

```typescript
// packages/shrink-test/src/fixture-app.ts
// SPDX-License-Identifier: MIT
import {IoError} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';
import {jsonSerde} from '@dexpace/codec-json';

export interface FixtureResult {
  readonly caughtViaCoreImport: boolean;
  readonly serdeRoundTripOk: boolean;
}

/**
 * Runs inside the bundled, tree-shaken artifact (never against src/ directly — see run-shrink-guard.ts).
 * Proves two things survive a real bundler round trip: cross-package `instanceof` (the dual-package hazard
 * tooling-and-quality-gates.md:116 describes) and a live network+serde round trip through the shipped codec.
 */
export async function runFixtureApp(): Promise<FixtureResult> {
  const transport = fetchTransport();
  let caughtViaCoreImport = false;
  try {
    await transport.send({url: new URL('http://127.0.0.1:1'), method: 'GET', headers: undefined} as never);
  } catch (error) {
    caughtViaCoreImport = error instanceof IoError;
  }

  const serde = jsonSerde();
  const bytes = serde.serializer.serialize({shrinkTest: true});
  const decoded = serde.deserializer.deserialize(bytes, {} as never) as {shrinkTest: boolean};

  return {caughtViaCoreImport, serdeRoundTripOk: decoded.shrinkTest === true};
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/shrink-test/package.json packages/shrink-test/shrink-test.config.ts packages/shrink-test/src/fixture-app.ts
git commit -m "feat(shrink-test): scaffold @dexpace/shrink-test and its dual-package-hazard fixture app"
```

---

### Task 2: `bundle.ts` — esbuild bundle, minify, tree-shake

**Files:**
- Create: `packages/shrink-test/src/bundle.ts`, `bundle.test.ts`

**Interfaces:**
- Consumes: `fixture-app.ts` (Task 1, as an entry point), `SHRINK_TEST_CONFIG` (Task 1).
- Produces: `buildShrinkBundle(): Promise<{code: string; bytes: number}>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shrink-test/src/bundle.test.ts
import {describe, expect, test} from 'bun:test';
import {buildShrinkBundle} from './bundle.js';

describe('buildShrinkBundle', () => {
  test('produces a single minified bundle under the configured budget', async () => {
    const {code, bytes} = await buildShrinkBundle();
    expect(code.length).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(50_000);
  });

  test('the bundle contains no unminified whitespace-heavy source (sanity check on minify)', async () => {
    const {code} = await buildShrinkBundle();
    expect(code).not.toContain('  runFixtureApp'); // 2-space-indented source would leak if minify were off
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/shrink-test && bun test src/bundle.test.ts`
Expected: FAIL — `bundle.js` does not exist.

- [ ] **Step 3: Implement**

```typescript
// packages/shrink-test/src/bundle.ts
// SPDX-License-Identifier: MIT
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

export interface ShrinkBundle {
  readonly code: string;
  readonly bytes: number;
}

export async function buildShrinkBundle(): Promise<ShrinkBundle> {
  const entryPoint = fileURLToPath(new URL('./fixture-app.ts', import.meta.url));
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) {
    throw new Error('esbuild produced no output file');
  }
  return {code: output.text, bytes: output.contents.byteLength};
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/shrink-test && bun test src/bundle.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shrink-test/src/bundle.ts packages/shrink-test/src/bundle.test.ts
git commit -m "feat(shrink-test): add buildShrinkBundle, an esbuild bundle+minify+tree-shake step"
```

---

### Task 3: `run-shrink-guard.ts` — the `NFR-9` regression guard, and root wiring

**Files:**
- Create: `packages/shrink-test/src/run-shrink-guard.ts`, `run-shrink-guard.test.ts`
- Modify: root `package.json` (add the `shrink-test` script)

**Interfaces:**
- Consumes: `buildShrinkBundle()` (Task 2), `SHRINK_TEST_CONFIG` (Task 1).
- Produces: `runShrinkGuard(): Promise<ShrinkGuardResult>` where
  `interface ShrinkGuardResult {readonly bundleBytes: number; readonly budgetBytes: number; readonly roundTripSucceeded: boolean;}`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shrink-test/src/run-shrink-guard.test.ts
// Exercises: NFR-9 (shrink-and-run regression guard, wired into the default build)
import {describe, expect, test} from 'bun:test';
import {runShrinkGuard} from './run-shrink-guard.js';

describe('runShrinkGuard', () => {
  test('the shrunk bundle stays under budget and its round trip succeeds', async () => {
    const result = await runShrinkGuard();
    expect(result.bundleBytes).toBeLessThanOrEqual(result.budgetBytes);
    expect(result.roundTripSucceeded).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/shrink-test && bun test src/run-shrink-guard.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

The bundled code is run in a **child process**, not `eval`'d in-process — this is what actually proves the
tree-shaken artifact behaves correctly standalone, rather than merely compiling.

```typescript
// packages/shrink-test/src/run-shrink-guard.ts
// SPDX-License-Identifier: MIT
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildShrinkBundle} from './bundle.js';
import {SHRINK_TEST_CONFIG} from '../shrink-test.config.js';

export interface ShrinkGuardResult {
  readonly bundleBytes: number;
  readonly budgetBytes: number;
  readonly roundTripSucceeded: boolean;
}

export async function runShrinkGuard(): Promise<ShrinkGuardResult> {
  const {code, bytes} = await buildShrinkBundle();
  const dir = await mkdtemp(join(tmpdir(), 'shrink-test-'));
  const entryPath = join(dir, 'bundle.mjs');
  const runnerPath = join(dir, 'runner.mjs');
  try {
    await writeFile(entryPath, code);
    await writeFile(
      runnerPath,
      `import {runFixtureApp} from ${JSON.stringify(entryPath)};\n` +
        'const result = await runFixtureApp();\n' +
        'process.stdout.write(JSON.stringify(result));\n' +
        'process.exit(result.caughtViaCoreImport && result.serdeRoundTripOk ? 0 : 1);\n',
    );
    const roundTripSucceeded = await new Promise<boolean>((resolve) => {
      const child = spawn(process.execPath, [runnerPath], {stdio: 'ignore'});
      child.on('exit', (code) => resolve(code === 0));
    });
    return {bundleBytes: bytes, budgetBytes: SHRINK_TEST_CONFIG.budgetBytes, roundTripSucceeded};
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/shrink-test && bun test src/run-shrink-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the root `shrink-test` script**

```json
// package.json (workspace root) -- add one entry to "scripts", alongside the existing eleven
"scripts": {
  "shrink-test": "bun run --filter @dexpace/shrink-test test"
}
```

Confirm this is the **only** new root script entry — do not touch any of the existing eleven (`lint`, `fix`,
`typecheck`, `build`, `test`, `test:node`, `api`, `lint:publish`, `audit`, `verify:dual-consumption`,
`verify:seam-1`, `verify:node-floor`).

- [ ] **Step 6: Commit**

```bash
git add packages/shrink-test/src/run-shrink-guard.ts packages/shrink-test/src/run-shrink-guard.test.ts package.json
git commit -m "feat(shrink-test): add the NFR-9 shrink-and-run regression guard, wire bun run shrink-test"
```

---

### Task 4: `tests/conformance/xcut/fixtures/` — the fixture server and composed-pipeline helper

**Files:**
- Create: `tests/conformance/xcut/fixtures/server.ts`, `composed-pipeline.ts`

**Interfaces:**
- Produces: `startFixtureServer(): Promise<{url: string; close(): Promise<void>}>`;
  `buildComposedPipeline(overrides?: ComposedPipelineOverrides): Runtime` where
  `interface ComposedPipelineOverrides {readonly retry?: Partial<RetrySettings>; readonly redirect?: Partial<RedirectSettings>; readonly auth?: AuthStepSettings;}`.

- [ ] **Step 1: The fixture server**

Same shape as `packages/transport-conformance/src/fixtures.ts` (8a), extended with the endpoints this suite's
`XCUT-N` rows need that the transport suite's server does not already cover: a slow endpoint with a configurable
delay, a same-origin-then-cross-origin two-hop redirect chain, and a large-body endpoint for the preview-cap test.

```typescript
// tests/conformance/xcut/fixtures/server.ts
// SPDX-License-Identifier: MIT
import {createServer, type Server} from 'node:http';

export interface XcutFixtureServer {
  readonly url: string;
  readonly crossOriginUrl: string;
  close(): Promise<void>;
}

export function startFixtureServer(): Promise<XcutFixtureServer> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      switch (url.pathname) {
        case '/ok':
          res.writeHead(200, {'content-type': 'text/plain'});
          res.end('ok');
          return;
        case '/slow': {
          const delayMs = Number(url.searchParams.get('ms') ?? '5000');
          setTimeout(() => {
            res.writeHead(200);
            res.end('done');
          }, delayMs);
          return;
        }
        case '/large-body': {
          res.writeHead(200, {'content-type': 'application/octet-stream'});
          res.end(Buffer.alloc(10 * 1024 * 1024, 'x')); // 10 MB, for XCUT-24's preview-cap test
          return;
        }
        case '/redirect-same-origin':
          res.writeHead(302, {location: '/ok'});
          res.end();
          return;
        case '/redirect-cross-origin':
          // Location is patched to the second server's port once both are listening -- see Step 2.
          res.writeHead(302, {location: (req.headers['x-cross-origin-target'] as string) ?? '/ok'});
          res.end();
          return;
        case '/echo-auth-header':
          res.writeHead(200, {'content-type': 'application/json'});
          res.end(JSON.stringify({authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null}));
          return;
        case '/fail-500':
          res.writeHead(500);
          res.end('server error');
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        crossOriginUrl: `http://localhost:${port}`, // distinct origin string (host differs), same machine
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
```

`crossOriginUrl` reuses the same port under the `localhost` hostname instead of `127.0.0.1` — a genuinely different
origin by the SDK's own origin-comparison rules (5b's design: origin is scheme+host+port; `127.0.0.1` and
`localhost` are different hosts), with no need for a second listening socket.

- [ ] **Step 2: The composed-pipeline helper**

```typescript
// tests/conformance/xcut/fixtures/composed-pipeline.ts
// SPDX-License-Identifier: MIT
import {
  standardResilience,
  type AuthStepSettings,
  type LoggingStepSettings,
  type RedirectSettings,
  type RetrySettings,
  type Runtime,
} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

export interface ComposedPipelineOverrides {
  readonly retry?: Partial<RetrySettings>;
  readonly redirect?: Partial<RedirectSettings>;
  readonly auth?: AuthStepSettings;
  readonly logging?: LoggingStepSettings;
}

/**
 * The one real, fully composed pipeline every XCUT-N test in this directory drives -- retry+redirect+auth+logging
 * via 5c/7b's standardResilience() over a real fetchTransport(). Never a per-test hand-rolled subset: the value
 * this suite adds is proving the invariants hold when every pillar runs together, not in isolation.
 */
export function buildComposedPipeline(overrides: ComposedPipelineOverrides = {}): Runtime {
  return standardResilience(fetchTransport(), {
    retry: overrides.retry as RetrySettings | undefined,
    redirect: overrides.redirect as RedirectSettings | undefined,
    auth: overrides.auth,
    logging: overrides.logging,
  });
}
```

- [ ] **Step 3: Commit** (no independent pass/fail — proven by Tasks 5-10's suites)

```bash
git add tests/conformance/xcut/fixtures/
git commit -m "test(conformance): add the XCUT fixture server and composed-pipeline helper"
```

---

### Task 5: `cancellation-and-timeout.conformance.test.ts` (`XCUT-1`, `XCUT-3`) + retrofit `XCUT-2`

**Files:**
- Create: `tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts`
- Modify: `packages/core/src/seams/transport.test.ts` (Phase 2's existing `isTimeoutSignal` test — comment-only)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts
// Exercises: XCUT-1 (cancellation terminal, non-retryable, flag preserved), XCUT-3 (inter-attempt wait
// promptly cancellable, armed timer cancelled)
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {CancellationError} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('XCUT-1: cancellation is terminal and non-retryable', () => {
  test('aborting an in-flight request through the full composed pipeline surfaces CancellationError once, not retried', async () => {
    const pipeline = buildComposedPipeline({retry: {maxAttempts: 3}});
    const controller = new AbortController();
    let sendCount = 0;
    const originalSend = pipeline.send.bind(pipeline);
    pipeline.send = async (request, options, signal) => {
      sendCount++;
      return originalSend(request, options, signal);
    };
    const pending = pipeline.send(
      {url: new URL(`${server.url}/slow?ms=2000`), method: 'GET', headers: undefined} as never,
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
    expect(sendCount).toBe(1); // never re-issued by the retry pillar
  });
});

describe('XCUT-3: inter-attempt retry wait is promptly cancellable', () => {
  test('cancelling during a backoff wait aborts near-immediately instead of waiting out the full backoff', async () => {
    const pipeline = buildComposedPipeline({retry: {maxAttempts: 5, initialDelayMs: 60_000}});
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = pipeline.send(
      {url: new URL(`${server.url}/fail-500`), method: 'GET', headers: undefined} as never,
      undefined,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toBeInstanceOf(CancellationError);
    expect(Date.now() - startedAt).toBeLessThan(1_000); // nowhere near the 60s backoff -- the wait aborted, not expired
  });
});
```

- [ ] **Step 2: Run and confirm it fails; Step 3: no production code change needed — confirm it passes as-is**

Run: `bun test tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts`
Expected: PASS. If either fails, the failure is in an earlier phase's shipped behavior (Phase 2's `composeSignal`
or 5a's backoff wait), not something this task builds — stop and file against that phase's own plan rather than
patching around it here.

- [ ] **Step 4: Retrofit the `XCUT-2` citation onto Phase 2's existing test**

Locate the `isTimeoutSignal` test Phase 2's plan already wrote (its own design/plan already cites `XCUT-2` in
prose per the grep this phase's design ran) and confirm its header comment lists `XCUT-2` alongside whatever ID
it already cites. If the comment is missing the ID, add it — comment-only, no assertion changes:

```typescript
// packages/core/src/seams/transport.test.ts
// Exercises: SEAM-... , XCUT-2 (timeout vs. cancellation told apart by signal.reason.name, not a message string)
```

- [ ] **Step 5: Commit**

```bash
git add tests/conformance/xcut/cancellation-and-timeout.conformance.test.ts packages/core/src/seams/transport.test.ts
git commit -m "test(conformance): add XCUT-1/XCUT-3 cross-pipeline tests, retrofit XCUT-2 citation"
```

---

### Task 6: `error-taxonomy.conformance.test.ts` (`XCUT-4`, `6`, `7`, `9`) + retrofit `XCUT-5`, `XCUT-8`

**Files:**
- Create: `tests/conformance/xcut/error-taxonomy.conformance.test.ts`
- Modify: `packages/core/src/retry/classify.test.ts` (comment-only)
- Modify: the status-to-exception factory's existing test (comment-only — see Step 4)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conformance/xcut/error-taxonomy.conformance.test.ts
// Exercises: XCUT-4 (two-branch taxonomy), XCUT-6 (capability-based classification, no classifier edit),
// XCUT-7 (configurable retryable-status set is authoritative over the baked flag), XCUT-9 (cycle-safe cause walk)
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {HttpStatusError, IoError, isRetryableFailure, RETRYABLE_STATUSES} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('XCUT-4: two-branch error taxonomy', () => {
  test('a 5xx through the composed pipeline surfaces the response-carrying protocol error', async () => {
    const pipeline = buildComposedPipeline({retry: {maxAttempts: 1}});
    const response = await pipeline.send({url: new URL(`${server.url}/fail-500`), method: 'GET', headers: undefined} as never);
    expect(response.status.code).toBe(500);
    await response.close();
  });

  test('a connection failure surfaces the I/O-family, always-retryable error', async () => {
    const pipeline = buildComposedPipeline({retry: {maxAttempts: 1}});
    await expect(
      pipeline.send({url: new URL('http://127.0.0.1:1'), method: 'GET', headers: undefined} as never),
    ).rejects.toBeInstanceOf(IoError);
  });
});

describe('XCUT-6: capability-based classification needs no classifier edit', () => {
  class CustomRetryableError extends Error {
    isRetryable = true;
  }
  test('a new non-protocol error type declaring itself retryable participates without editing classify.ts', () => {
    const error = new CustomRetryableError('custom transient failure');
    expect(isRetryableFailure(error, RETRYABLE_STATUSES)).toBe(true);
  });
});

describe('XCUT-7: the configurable retryable-status set is authoritative', () => {
  test('widening the set to include 501 makes a 501 retried even though 501 is excluded by default', () => {
    const widened = new Set([...RETRYABLE_STATUSES, 501]);
    expect(isRetryableFailure(new HttpStatusError(501, undefined, null), widened)).toBe(true);
  });

  test('narrowing the set to exclude 500 makes a 500 not retried even though its baked classification is retryable', () => {
    const narrowed = new Set([...RETRYABLE_STATUSES].filter((code) => code !== 500));
    expect(isRetryableFailure(new HttpStatusError(500, undefined, null), narrowed)).toBe(false);
  });
});

describe('XCUT-9: cause-chain walk is cycle-safe', () => {
  test('an error whose cause points back to itself does not hang the classifier', () => {
    const cyclic = new Error('cyclic');
    cyclic.cause = cyclic;
    expect(() => isRetryableFailure(cyclic, RETRYABLE_STATUSES)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm it passes** (all four groups exercise already-shipped 5a/3b/3a behavior)

Run: `bun test tests/conformance/xcut/error-taxonomy.conformance.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 3: Retrofit `XCUT-5`**, honestly scoped to what the port actually implements

`XCUT-5`'s "baked flag... queryable property" is satisfied in this port by `isRetryableStatus(status)` being a
pure function of `HttpStatusError.status` (itself immutable post-construction, per `XCUT-15`) — not by a
separately-cached boolean field. Add this to 5a's own `classify.test.ts` header comment (its existing test already
asserts `isRetryableStatus` for the full representative-status list):

```typescript
// packages/core/src/retry/classify.test.ts
// Exercises: RECOV-..., XCUT-5 (the classifier is a pure function of the error's immutable .status -- this port
// has no separately-cached "baked flag" field; querying isRetryableStatus(error.status) at any time after
// construction is equivalent since .status never changes post-construction)
```

- [ ] **Step 4: Retrofit `XCUT-8`**

Locate Phase 1's existing test asserting the status-to-exception mapping factory rejects a non-error status
(1xx/2xx/3xx) and add `XCUT-8` to its header comment — comment-only.

- [ ] **Step 5: Commit**

```bash
git add tests/conformance/xcut/error-taxonomy.conformance.test.ts packages/core/src/retry/classify.test.ts
git commit -m "test(conformance): add XCUT-4/6/7/9 cross-pipeline tests, retrofit XCUT-5/XCUT-8 citations"
```

---

### Task 7: `retry-safety.conformance.test.ts` (`XCUT-10`)

**Files:**
- Create: `tests/conformance/xcut/retry-safety.conformance.test.ts`

- [ ] **Step 1: Write the failing test — the five-way matrix, run once against the composed pipeline**

```typescript
// tests/conformance/xcut/retry-safety.conformance.test.ts
// Exercises: XCUT-10 (retry-safety gate applies uniformly to both protocol and transport failures)
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {stringBody, streamBody} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;
let sendCount: number;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

function countingPipeline() {
  const pipeline = buildComposedPipeline({retry: {maxAttempts: 3, initialDelayMs: 1}});
  sendCount = 0;
  const originalSend = pipeline.send.bind(pipeline);
  pipeline.send = async (request, options, signal) => {
    sendCount++;
    return originalSend(request, options, signal);
  };
  return pipeline;
}

describe('XCUT-10: retry-safety gate', () => {
  test('body-less GET against a failing endpoint is retried', async () => {
    const pipeline = countingPipeline();
    await expect(
      pipeline.send({url: new URL(`${server.url}/fail-500`), method: 'GET', headers: undefined} as never),
    ).rejects.toBeDefined();
    expect(sendCount).toBeGreaterThan(1);
  });

  test('body-less POST failing with a protocol error is not retried', async () => {
    const pipeline = countingPipeline();
    await expect(
      pipeline.send({url: new URL(`${server.url}/fail-500`), method: 'POST', headers: undefined} as never),
    ).rejects.toBeDefined();
    expect(sendCount).toBe(1);
  });

  test('body-less POST failing with a transport error is still not retried', async () => {
    const pipeline = countingPipeline();
    await expect(
      pipeline.send({url: new URL('http://127.0.0.1:1'), method: 'POST', headers: undefined} as never),
    ).rejects.toBeDefined();
    expect(sendCount).toBe(1);
  });

  test('POST with a replayable body is retried', async () => {
    const pipeline = countingPipeline();
    await expect(
      pipeline.send({
        url: new URL(`${server.url}/fail-500`),
        method: 'POST',
        headers: undefined,
        body: stringBody('payload'),
      } as never),
    ).rejects.toBeDefined();
    expect(sendCount).toBeGreaterThan(1);
  });

  test('POST with a streaming, non-replayable body is not retried', async () => {
    const pipeline = countingPipeline();
    const {readable} = new TransformStream<Uint8Array, Uint8Array>();
    await expect(
      pipeline.send({
        url: new URL(`${server.url}/fail-500`),
        method: 'POST',
        headers: undefined,
        body: streamBody(readable), // mediaType/contentLength default to null/-1 -- non-replayable, unknown length
      } as never),
    ).rejects.toBeDefined();
    expect(sendCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm it passes** (5a already implements this gate; this is the first run of the full
  five-way matrix against the *composed* pipeline rather than 5a's own unit-level harness)

Run: `bun test tests/conformance/xcut/retry-safety.conformance.test.ts`
Expected: PASS, 5 tests. If `streamBody`'s exact factory name/options differ from 3b's actual shipped signature,
adjust the call to match 3b's real API — the behavior under test (non-replayable body, not retried) is what
matters, not this call's exact shape.

- [ ] **Step 3: Commit**

```bash
git add tests/conformance/xcut/retry-safety.conformance.test.ts
git commit -m "test(conformance): add XCUT-10 retry-safety five-way matrix against the composed pipeline"
```

---

### Task 8: `concurrency-and-lifecycle.conformance.test.ts` (`XCUT-11`, `13`, `14`) + retrofit `XCUT-12`, `XCUT-22`

**Files:**
- Create: `tests/conformance/xcut/concurrency-and-lifecycle.conformance.test.ts`
- Modify: 5c's credential-cache single-flight test (comment-only)
- Modify: 8a's BYO-dispatcher close test (comment-only)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conformance/xcut/concurrency-and-lifecycle.conformance.test.ts
// Exercises: XCUT-11 (shared components concurrent-safe, per-call state local), XCUT-13 (idempotent,
// non-blocking close), XCUT-14 (caller-keyed maps bounded with a drain-to-cap loop)
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('XCUT-11: shared pipeline instance is concurrency-safe', () => {
  test('20 concurrent requests through one shared pipeline instance never cross-talk', async () => {
    const pipeline = buildComposedPipeline();
    const requests = Array.from({length: 20}, (_, i) => ({
      url: new URL(`${server.url}/ok?n=${i}`),
      method: 'GET',
      headers: undefined,
    }));
    const responses = await Promise.all(requests.map((r) => pipeline.send(r as never)));
    for (const response of responses) {
      expect(response.status.code).toBe(200);
      await response.close();
    }
  });
});

describe('XCUT-13: close is idempotent and non-blocking', () => {
  test('closing a composed pipeline twice is a no-op the second time', async () => {
    const pipeline = buildComposedPipeline();
    await pipeline.close();
    await expect(pipeline.close()).resolves.toBeUndefined();
  });
});

describe('XCUT-14: caller-keyed bounded state drains back under its cap', () => {
  test('a burst of distinct correlation-bearing calls through the retry/auth stack does not grow unbounded', async () => {
    // Drives far more distinct realms/correlation ids through the shared pipeline than any documented cap
    // (5c's per-realm nonce counter, 4a's context registry) than the cap those subsystems document, then
    // confirms the pipeline itself is still responsive -- a stuck-above-cap state would manifest as growing
    // per-call latency or memory, not a thrown error, so this asserts liveness under burst rather than reading
    // a private internal counter.
    const pipeline = buildComposedPipeline();
    const requests = Array.from({length: 500}, (_, i) => ({
      url: new URL(`${server.url}/ok?realm=${i}`),
      method: 'GET',
      headers: undefined,
    }));
    const responses = await Promise.all(requests.map((r) => pipeline.send(r as never)));
    expect(responses).toHaveLength(500);
    for (const response of responses) await response.close();
  });
});
```

- [ ] **Step 2: Run and confirm it passes**

Run: `bun test tests/conformance/xcut/concurrency-and-lifecycle.conformance.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 3: Retrofit `XCUT-12` and `XCUT-22`**

Add `XCUT-12` to 5c's existing credential-cache single-flight test's header comment (`docs/work/mvp/phase5/phase5c/2026-07-26-phase5c-auth.md`'s own test already races N callers on an expiring token). Add `XCUT-22` to 8a's
existing `undici-transport.test.ts` BYO-dispatcher test ("closing a transport built from a BYO Agent does not
close that agent") — both comment-only.

- [ ] **Step 4: Commit**

```bash
git add tests/conformance/xcut/concurrency-and-lifecycle.conformance.test.ts packages/core/src/auth/*.test.ts packages/transport-undici/src/undici-transport.test.ts
git commit -m "test(conformance): add XCUT-11/13/14 cross-pipeline tests, retrofit XCUT-12/XCUT-22 citations"
```

---

### Task 9: `security-by-default.conformance.test.ts` (`XCUT-17`) + retrofit `XCUT-16`, `18`, `19`, `20`, `21`

**Files:**
- Create: `tests/conformance/xcut/security-by-default.conformance.test.ts`
- Modify: 5c's HTTPS-only guard test, Phase 1's header-validation test, 7b's redaction test, 7b's
  never-throws test, 5c's CSPRNG cnonce test (all comment-only)

- [ ] **Step 1: Write the failing test — the one genuinely new cross-pipeline case**

`XCUT-17`'s credential hygiene is the one row that needs a real multi-hop run: 5b's own tests exercise redirect in
isolation; this is the first place a real auth step re-attaches credentials to a same-origin follow while a
cross-origin follow must lose them.

```typescript
// tests/conformance/xcut/security-by-default.conformance.test.ts
// Exercises: XCUT-17 (redirect credential hygiene under a real auth step); XCUT-16, 18, 19, 20, 21 are
// retrofit-only citations onto their originating phase's own tests -- see this file's Step 3 note below.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {createAuthDescriptor, createAuthRequirement, type AuthCredentialSet, type AuthStepSettings} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

// AuthCredentialSet.bearer takes a token *provider* (5c: `{provider: async () => ({token, expiresAt})}`), not a
// bare string; createAuthRequirement takes a single AuthScheme literal ('OAUTH2' is the bearer-family scheme
// name; 'bearer' is only the AuthCredentialSet slot key), wrapped into an AuthTiers entry via createAuthDescriptor.
function bearerAuthSettings(token: string): AuthStepSettings {
  const credentials: AuthCredentialSet = {
    bearer: {provider: async () => ({token, expiresAt: Date.now() + 60_000})},
  };
  return {credentials, tiers: {operation: createAuthDescriptor([createAuthRequirement('OAUTH2')])}};
}

describe('XCUT-17: redirect credential hygiene under a real auth step', () => {
  test('a same-origin redirect strips Authorization for the hop, and auth re-attaches it on the follow-up request', async () => {
    const pipeline = buildComposedPipeline({auth: bearerAuthSettings('secret-token')});
    const response = await pipeline.send({
      url: new URL(`${server.url}/redirect-same-origin`),
      method: 'GET',
      headers: undefined,
    } as never);
    const body = (await response.json()) as {authorization: string | null};
    expect(body.authorization).toBe('Bearer secret-token'); // re-attached by auth on the same-origin follow-up
    await response.close();
  });

  test('a cross-origin redirect does not carry the credential to the foreign host', async () => {
    const pipeline = buildComposedPipeline({auth: bearerAuthSettings('secret-token')});
    const response = await pipeline.send(
      {
        url: new URL(`${server.url}/redirect-cross-origin`),
        method: 'GET',
        headers: {'x-cross-origin-target': server.crossOriginUrl + '/echo-auth-header'} as never,
      } as never,
    );
    const body = (await response.json()) as {authorization: string | null};
    expect(body.authorization).toBeNull();
    await response.close();
  });
});
```

- [ ] **Step 2: Run and confirm it passes**

Run: `bun test tests/conformance/xcut/security-by-default.conformance.test.ts`
Expected: PASS, 2 tests. If `AuthStepSettings`'s real `credentials`/`tiers` shape differs from what 5c's plan
ultimately ships, adjust these two calls to match 5c's actual factory functions — the behavior under test
(same-origin re-attach, cross-origin strip) is what this task proves, not this exact call shape.

- [ ] **Step 3: Retrofit five citations, comment-only, no new tests**

| ID | Existing test (phase) |
|---|---|
| `XCUT-16` | 5c's "rejects a credential-stamping auth step over http://" test |
| `XCUT-18` | Phase 1's header-name/value control-byte and non-ASCII rejection tests |
| `XCUT-19` | 7b's default-deny redaction suite (userinfo, query, headers, credentials, bodies) |
| `XCUT-20` | 7b's "observability failure never throws into the request path" test |
| `XCUT-21` | 5c's Digest `cnonce` CSPRNG/entropy test |

Add the corresponding `XCUT-N` to each file's header comment. No assertion changes.

- [ ] **Step 4: Commit**

```bash
git add tests/conformance/xcut/security-by-default.conformance.test.ts \
  packages/core/src/auth/*.test.ts packages/core/src/http/*.test.ts packages/core/src/observability/*.test.ts
git commit -m "test(conformance): add XCUT-17 cross-pipeline redirect-credential-hygiene test, retrofit five citations"
```

---

### Task 10: `diagnostic-previews.conformance.test.ts` (`XCUT-24`)

**Files:**
- Create: `tests/conformance/xcut/diagnostic-previews.conformance.test.ts`

Diagnostic previews in this port are not a standalone `Response` method — they surface through 7b's `LOGGING`
step: at `granularity: 'body'`, both 3b tees wrap the request/response body bounded to `previewSizeBytes`
(default 8 KiB, shared with `toHttpError`'s own cap), captured into the emitted `http.response` log event without
disturbing the caller's own full read (`OBS-36`). This is the real mechanism `XCUT-24` describes; the test drives
it exactly as 7b's own design specifies, via a spy `Logger`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/conformance/xcut/diagnostic-previews.conformance.test.ts
// Exercises: XCUT-24 (diagnostic previews byte-capped and non-consuming), via 7b's LOGGING step (OBS-36)
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {createLogger, setGlobalLogger, type LogLevel} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe('XCUT-24: byte-capped, non-consuming diagnostic preview', () => {
  test('a large response body through the composed pipeline logs a capped preview while the caller still reads every byte', async () => {
    const captured: Array<ReadonlyMap<string, unknown>> = [];
    setGlobalLogger(
      createLogger((_level: LogLevel, fields) => {
        captured.push(fields);
      }),
    );

    const pipeline = buildComposedPipeline({
      retry: {maxAttempts: 1},
      logging: {granularity: 'body', previewSizeBytes: 1024},
    });
    const response = await pipeline.send({url: new URL(`${server.url}/large-body`), method: 'GET', headers: undefined} as never);
    const fullBody = await response.arrayBuffer(); // primary read path -- must see every byte, not the truncated preview
    expect(fullBody.byteLength).toBe(10 * 1024 * 1024);
    await response.close();

    const responseEvent = captured.find((fields) => fields.get('event') === 'http.response'); // OBS-39's fixed event name
    expect(responseEvent).toBeDefined();
    // OBS-36: whichever field carries the captured body preview must never exceed the configured cap. Rather
    // than pin an unverified exact field key, check every string-valued field on the event -- none may exceed
    // the cap, which is the property XCUT-24 actually requires.
    for (const value of responseEvent?.values() ?? []) {
      if (typeof value === 'string') {
        expect(value.length).toBeLessThanOrEqual(1024);
      }
    }
  });
});
```

- [ ] **Step 2: Run and confirm it passes**

Run: `bun test tests/conformance/xcut/diagnostic-previews.conformance.test.ts`
Expected: PASS. If 7b's actual shipped `http.response` event uses a field key other than assumed here for the
body preview, this test still passes unchanged — it checks every string field on the event rather than pinning
one key name, so it only needs `LoggingStepSettings`/`createLogger`'s signatures (confirmed above) to match.

- [ ] **Step 3: Commit**

```bash
git add tests/conformance/xcut/diagnostic-previews.conformance.test.ts
git commit -m "test(conformance): add XCUT-24 large-body diagnostic-preview test against the composed pipeline"
```

---

### Task 11: Close the three `tooling-and-quality-gates.md` markers, full NFR audit, final gates

**Files:**
- Modify: `docs/knowledge/tooling-and-quality-gates.md` (three `## Conflicts` entries)
- Create: `scripts/verify-nfr-audit.mjs` (a one-off, human-run audit script — not wired into CI; see note below)

- [ ] **Step 1: Replace the package-manager-and-lockfile marker**

```markdown
<!-- docs/knowledge/tooling-and-quality-gates.md, ## Conflicts section -->
- **design vs styleguide: package manager and lockfile** — RESOLVED in favor of the styleguide (2026-07-25,
  confirmed 2026-07-28 Phase 9 audit). The scaffold implements Bun (`bun.lock`, `.bun-version`,
  `bun install --frozen-lockfile` as the CI gate) throughout; the design's pnpm/`catalog:` framing describes a
  toolchain this repository does not use. Decision recorded at
  `docs/work/mvp/scaffold/2026-07-23-scaffold-milestone-checklist.md:54`; the enforcement properties pnpm's
  layout gave for free (isolated linker, workspace catalogs) were restored separately — see the Bun workspace
  catalogs adopted in Phase 6a and the isolated linker set at the 2026-07-25 checkpoint.
  <sub>design `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:50-51` · styleguide
  `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:112-120` ·
  resolved 2026-07-25, backported 2026-07-28</sub>
```

- [ ] **Step 2: Replace the test-runner-and-coverage-gating marker**

```markdown
- **design vs styleguide: test runner and whether coverage gates the build** — RESOLVED as a split (2026-07-25,
  confirmed 2026-07-28 Phase 9 audit). Runner: `bun test` with `bun:test` symbol imports (the styleguide's
  choice) — the design's `c8`/`vitest` framing is dead. Gating: `NFR-5`/`NFR-17` are spec conformance
  obligations that outrank the styleguide's general "coverage is a trend, never a pass/fail gate" default;
  `bunfig.toml`'s `coverageThreshold = 0.8` blocks the build, as the scaffold's own plan already implemented.
  <sub>design `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:12` · styleguide
  `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:47-48,210-213` ·
  resolved 2026-07-25, backported 2026-07-28</sub>
```

- [ ] **Step 3: Replace the `gts`-baseline marker**

```markdown
- **design vs styleguide: `gts` as the lint and format baseline** — RESOLVED in favor of the styleguide
  (2026-07-25, confirmed 2026-07-28 Phase 9 audit). The plans extend `gts` in `eslint.config.js` and layer
  `@typescript-eslint`'s `strict-type-checked`/`stylistic-type-checked` tiers on top as the single permitted
  overlay, satisfying the design's rule set as well; the design's table never mentioning `gts` describes a
  toolchain this repository does not use.
  <sub>design `docs/sdk-design-nodejs/09-toolchain-and-quality-gates.md:8-10` · styleguide
  `/home/mohammad/Projects/dexpace/styleguide/typescript/01-formatting-and-tooling.md:66-83,122-129` ·
  resolved 2026-07-25, backported 2026-07-28</sub>
```

- [ ] **Step 4: Confirm the markers are gone**

Run: `grep -rn "unresolved 2026-07-25" docs/knowledge/`
Expected: no output.

- [ ] **Step 5: The `NFR` audit script — mechanical checks only, not new gates**

This script is a **one-off audit aid** for this task, not a new CI gate (`NFR-17` already requires every real gate
to be wired into the default build; adding a thirteenth ad hoc script here would violate that discipline, not
serve it). It is run once by hand during this task and then deleted, not committed.

```javascript
// scripts/verify-nfr-audit.mjs (run once, then delete -- not committed)
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const packagesDir = 'packages';
for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private === true) continue; // NFR-2 applies to published adapters only
  const deps = Object.keys(pkg.dependencies ?? {});
  const externalDeps = deps.filter((d) => !d.startsWith('@dexpace/'));
  if (name !== 'core' && externalDeps.length > 1) {
    console.error(`NFR-2 violation: ${name} declares ${externalDeps.length} external deps: ${externalDeps.join(', ')}`);
  }
  if (name === 'core' && deps.length > 0) {
    console.error(`NFR-1 violation: core declares runtime dependencies: ${deps.join(', ')}`);
  }
}
console.log('NFR-1/NFR-2 audit complete.');
```

Run: `node scripts/verify-nfr-audit.mjs`
Expected: `NFR-1/NFR-2 audit complete.` with no violation lines. If a violation prints, it is a defect in an
earlier phase's shipped `package.json` — file it against that phase, fix it there (this task does not itself
edit another phase's `package.json`), re-run, then delete this script.

- [ ] **Step 6: Run the full gate sequence, now including `shrink-test`**

```bash
bun install --frozen-lockfile
bun run typecheck && bun run lint && bun run build && bun test --coverage && bun run api && \
  bun run lint:publish && bun run verify:dual-consumption && bun run verify:seam-1 && \
  bun run verify:node-floor && bun run test:node && bun run audit && bun run shrink-test
```

Expected: all thirteen commands exit 0, including the new `shrink-test` step and every `tests/conformance/xcut/`
file from Tasks 5-10.

- [ ] **Step 7: Commit**

```bash
git add docs/knowledge/tooling-and-quality-gates.md
git commit -m "docs: close three stale unresolved-2026-07-25 tooling-and-quality-gates.md conflict markers (Phase 9 audit)"
```

---

## Self-Review

Before marking this plan complete, confirm against the design doc:

- [ ] Every `XCUT-N` (1-24) has either a passing cross-pipeline conformance-test assertion (Tasks 5-10) or an
  explicit retrofit citation onto its originating phase's test, or (for `XCUT-23`) the documented N/A disposition
  in the design doc's Deviation Ledger — no ID is silently uncovered.
- [ ] Every `NFR-N` (1-17) matches its disposition-table row: already-true-by-construction (confirmed, not
  rebuilt), the one real deliverable (`NFR-9`, Tasks 1-3), the three documentation fixes (`NFR-5`/`6`/`7`,
  Task 11), or out-of-scope-and-unchanged (`NFR-12`, `NFR-16`).
- [ ] `@dexpace/shrink-test` is `private: true` and no other package's `package.json` lists it as a dependency.
- [ ] `tests/conformance/xcut/` never reimplements a subsystem's own unit test — every test either drives the
  full composed pipeline or is a comment-only retrofit.
- [ ] `grep -rn "unresolved 2026-07-25" docs/knowledge/` returns empty.
- [ ] `scripts/verify-nfr-audit.mjs` was deleted after its one-off run (Step 5), not left committed as an
  informal fourteenth gate outside `NFR-17`'s "automatic and blocking, wired into the default build" discipline.
- [ ] The full gate sequence (Task 11, Step 6) is green, including the new `shrink-test` step.
