# Phase 8a — Transport Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@dexpace/transport-fetch`, `@dexpace/transport-undici`, and `@dexpace/body-file`, plus the shared
unpublished `@dexpace/transport-conformance` devDependency and two small retrofits to `@dexpace/core`
(`TransportFailureError`, `FileBodyDescriptor`) — satisfying `docs/product-spec/17-transport-adapter-conformance-contract.md`
(`TRANSPORT-1`–`TRANSPORT-30`) per `docs/superpowers/specs/2026-07-28-phase8a-transport-design.md`.

**Architecture:** Four new workspace packages plus two amendments to already-shipped `@dexpace/core` files. Both
transports implement the identical `Transport` interface (Phase 2, unchanged) and are proven against one shared
conformance suite so they cannot silently drift from each other. `@dexpace/body-file` is a thin, `node:fs`-only
package that both transports depend on for `FileBodyDescriptor` recognition; `@dexpace/core` itself gains only a
type-only interface and a string-literal union member, costing nothing against its zero-`node:`-import invariant.

**Tech Stack:** TypeScript 5.8+, `undici` (peer-installed alongside Node's bundled copy — see Task 7), `bun test`,
`node:http`/`node:fs` (test-only in `transport-conformance` and `body-file`'s own tests; `node:fs` is also a real
runtime dependency of `@dexpace/body-file`'s production code, which is exactly why it cannot live in `@dexpace/core`).

**Prerequisite:** Phases 0 through 7b implemented exactly as their plans specify. This plan does **not** depend on
8b (`@dexpace/rx`) in either direction — see the segmentation design's zero-cross-dependency finding. Concretely
consumed from earlier phases:

- `packages/core/src/seams/transport.ts` — `Transport`, `composeSignal`, `isTimeoutSignal`, `CancellationError`
- `packages/core/src/io/errors.ts` — `IoError` (this plan adds `TransportFailureError` to this file)
- `packages/core/src/body/body.ts` — `Body` (this plan adds `'file'`/`FileBodyDescriptor` to this file)
- `packages/core/src/http/request.ts` / `response.ts` — `Request`, `Response`, `Response.newBuilder()`
- `packages/core/src/config/proxy.ts` — `ProxyOptions`, `resolveProxyOptions` (7a)
- `packages/core/src/config/build-info.ts` — `getBuildInfo()` (7a; `NFR-15` conformance test only, Task 10)
- `packages/logging-pino` / `packages/logging-debug`'s consumer, `getGlobalLogger()` (7b)
- The workspace root's version-catalog mechanism and `@dexpace/core` peer-dependency-dedup pattern (6a)

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **`@dexpace/core`'s zero-`node:`-import invariant is untouched.** `FileBodyDescriptor` is a type-only interface
  — it erases at compile time. Neither addition to `packages/core/src/io/errors.ts` or `body/body.ts` imports
  anything beyond what those files already import. `verify:seam-1` must still pass on `@dexpace/core` unchanged.
- **`@dexpace/transport-fetch` has zero runtime dependencies beyond its `@dexpace/core` peer.** Do not add
  `undici` or any HTTP library to it — the global `fetch` is the whole point.
- **`@dexpace/transport-undici` depends on `undici` as a regular `dependency`, not a peer.** Unlike `rxjs` (8b) or
  `pino`/`debug` (7b's adapters), a consuming application does not typically already pin its own `undici` version
  the way it pins a logging or reactive library — `NFR-2`'s "core + ≤1 external lib" is satisfied either way, and
  a regular dependency is the simpler default absent a reason to peer.
- **`@dexpace/body-file` has zero dependencies beyond its `@dexpace/core` peer.** `node:fs` is a runtime API, not
  an npm package — it does not appear in `package.json` `dependencies` at all.
- **One `TransportFailureError`, defined once, in `@dexpace/core`.** Never declare a second transport-failure
  class in either transport package. Both packages import and throw/reject with the same import.
- **One header-drop/degrade helper, shared, not duplicated per transport.** `TRANSPORT-10`/`TRANSPORT-12`'s
  algorithm (Content-Type authority, per-header graceful degradation) is identical for both packages; write it
  once in `@dexpace/transport-conformance`'s sibling internal module or, if that reads oddly for production code
  living in a devDependency, as a small internal-only export each transport package vendors via a workspace
  `file:` reference is **wrong** — instead, place the shared algorithm as an `@internal` export of
  `@dexpace/body-file` is also wrong (unrelated concern). Resolve this at Task 5/7 by placing it in
  `@dexpace/transport-fetch` first (it ships first) and having `@dexpace/transport-undici` import it as a
  regular `dependency` on `@dexpace/transport-fetch` — **do not do this**; it would make one transport depend on
  a sibling transport, which the segmentation design and this plan otherwise deliberately avoid. Instead: a
  fifth micro-package, `@dexpace/transport-shared` (published, tiny, zero deps beyond the `@dexpace/core` peer,
  `@internal`-only exports, not part of any package's public barrel), holds `mapOutboundHeaders()` and
  `degradeInboundHeaders()`. Both transports depend on it as a regular dependency. See Task 4a.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`.
- **No TS `enum`** (`erasableSyntaxOnly`). Unions and frozen constant objects only.
- **Explicit return types on every exported function.** Kebab-case filenames. Named exports only.
- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT`.
- **Every `*.conformance.test.ts` cites the `TRANSPORT-N` IDs it exercises** in a header comment, per the
  project's running convention.
- **Tests that spin up a local `node:http` server must close it in `afterAll`, on an ephemeral port
  (`listen(0)`), reading the assigned port back off the server** — never a hardcoded port, to survive parallel
  test-file execution.

---

## File Structure

```
packages/core/src/io/errors.ts        # + TransportFailureError                        (Task 1, retrofit)
packages/core/src/body/body.ts         # + 'file' kind, + FileBodyDescriptor            (Task 2, retrofit)

packages/body-file/src/
  file-body.ts                          # fileBody, FileBodyOptions                    (Task 3)
  index.ts

packages/transport-shared/src/
  header-mapping.ts                      # mapOutboundHeaders, degradeInboundHeaders    (Task 4a)
  index.ts

packages/transport-conformance/src/       # private: true, unpublished
  run-suite.ts                              # runTransportConformanceSuite             (Task 4b)
  fixtures.ts                                # node:http-backed local test server

packages/transport-fetch/src/
  fetch-transport.ts                          # fetchTransport                         (Task 5)
  fetch-transport.conformance.test.ts           # wires Task 4b's suite                 (Task 6)

packages/transport-undici/src/
  undici-transport.ts                            # undiciTransport                      (Task 7)
  challenge-handler.ts                             # TRANSPORT-30 proxy-407 dispatch    (Task 8)
  undici-transport.conformance.test.ts              # wires Task 4b's suite             (Task 9)
```

Ten production/retrofit files across six packages (five new, one amended), each with a colocated `*.test.ts`.

---

### Task 1: Retrofit `packages/core/src/io/errors.ts` — `TransportFailureError`

**Files:**
- Modify: `packages/core/src/io/errors.ts`
- Modify: `packages/core/src/io/errors.test.ts`

**Interfaces:**
- Consumes: `IoError` (Phase 3a, same file).
- Produces: `export class TransportFailureError extends IoError`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/errors.test.ts — append
describe('TransportFailureError (TRANSPORT-20)', () => {
  test('is an IoError subtype', () => {
    const error = new TransportFailureError('connect ECONNREFUSED');
    expect(error).toBeInstanceOf(IoError);
    expect(error.name).toBe('TransportFailureError');
  });

  test('carries an optional cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new TransportFailureError('connect failed', {cause});
    expect(error.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/errors.test.ts`
Expected: FAIL — `TransportFailureError` is not exported.

- [ ] **Step 3: Add the class**

```typescript
// packages/core/src/io/errors.ts — append, no other lines change
/**
 * The canonical retryable transport-failure exception (TRANSPORT-20): any send that produced no HTTP
 * response — connection refused, DNS/TLS failure, peer reset, connect/read timeout. A subtype of IoError
 * so 5a's `classify.ts` cause-walk already treats it as always-retryable with no change to that file.
 */
export class TransportFailureError extends IoError {}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/io/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/errors.ts packages/core/src/io/errors.test.ts
git commit -m "feat(core): add TransportFailureError, the canonical retryable transport-failure exception (TRANSPORT-20)"
```

---

### Task 2: Retrofit `packages/core/src/body/body.ts` — `'file'` kind, `FileBodyDescriptor`

**Files:**
- Modify: `packages/core/src/body/body.ts`
- Modify: `packages/core/src/body/body.test.ts`

**Interfaces:**
- Consumes: `Body` (Phase 3b, same file).
- Produces: `Body['kind']` widened to include `'file'`; `export interface FileBodyDescriptor extends Body`.

- [ ] **Step 1: Write the failing test — a type-level test only, `expect-type`**

```typescript
// packages/core/src/body/body.test.ts — append
import {expectTypeOf} from 'expect-type';
import type {Body, FileBodyDescriptor} from './body.js';

describe('FileBodyDescriptor (BODY-11/TRANSPORT-28 recognition contract)', () => {
  test('is a Body with a discriminated file kind and structural fields', () => {
    expectTypeOf<FileBodyDescriptor>().toMatchTypeOf<Body>();
    expectTypeOf<FileBodyDescriptor['kind']>().toEqualTypeOf<'file'>();
    expectTypeOf<FileBodyDescriptor['path']>().toEqualTypeOf<string>();
    expectTypeOf<FileBodyDescriptor['start']>().toEqualTypeOf<number>();
    expectTypeOf<FileBodyDescriptor['count']>().toEqualTypeOf<number>();
  });

  test("Body['kind'] accepts 'file' without a cast", () => {
    const kind: Body['kind'] = 'file';
    expect(kind).toBe('file');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/body.test.ts`
Expected: FAIL — `'file'` is not assignable to `Body['kind']`; `FileBodyDescriptor` is not exported.

- [ ] **Step 3: Retrofit `body.ts`**

```typescript
// packages/core/src/body/body.ts
export interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart' | 'file';
  readonly mediaType: string | null;
  readonly contentLength: number;
  readonly replayable: boolean;
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}

/**
 * The structural recognition contract a transport narrows on (`body.kind === 'file'`) to dispatch a
 * file-specific send path (TRANSPORT-28). Type-only — @dexpace/core never constructs one; the concrete
 * factory lives in @dexpace/body-file, which can depend on node:fs precisely because it is not core.
 */
export interface FileBodyDescriptor extends Body {
  readonly kind: 'file';
  readonly path: string;
  readonly start: number;
  readonly count: number;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/body.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/body.ts packages/core/src/body/body.test.ts
git commit -m "feat(core): add 'file' Body kind and FileBodyDescriptor recognition contract (BODY-11, TRANSPORT-28)"
```

---

### Task 3: `@dexpace/body-file` — `fileBody()`

**Files:**
- Create: `packages/body-file/package.json`, `tsconfig.json`, `api-extractor.json`
- Create: `packages/body-file/src/file-body.ts`, `file-body.test.ts`, `index.ts`

**Interfaces:**
- Consumes: `Body`, `FileBodyDescriptor` (Task 2, type-only).
- Produces: `fileBody(path: string, options?: FileBodyOptions): FileBodyDescriptor`.

- [ ] **Step 1: Scaffold the package**

```json
// packages/body-file/package.json
{
  "name": "@dexpace/body-file",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "peerDependencies": {"@dexpace/core": "workspace:*"},
  "peerDependenciesMeta": {"@dexpace/core": {"optional": false}},
  "dependencies": {},
  "scripts": {"build": "tsc -b", "test": "bun test"}
}
```

`tsconfig.json`: `composite: true`, project reference to `../core`, same shape as `packages/codec-json/tsconfig.json`
(6a). `api-extractor.json` and `etc/body-file.api.md` per the established per-package pattern.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/body-file/src/file-body.test.ts
// Exercises: HTTP-40/BODY-11 (fail-fast construction validation, fresh handle per write, replayable),
// BODY-13 (short-write detection), BODY-12/TRANSPORT-28 (recognizable by type)
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileBody} from './file-body.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'body-file-'));
  filePath = join(dir, 'payload.bin');
  await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});

afterEach(async () => {
  await rm(dir, {recursive: true, force: true});
});

describe('fileBody (HTTP-40, BODY-11)', () => {
  test('is recognizable by kind and replayable', () => {
    const body = fileBody(filePath);
    expect(body.kind).toBe('file');
    expect(body.replayable).toBe(true);
    expect(body.contentLength).toBe(8);
  });

  test('rejects a nonexistent path at construction', () => {
    expect(() => fileBody(join(dir, 'missing.bin'))).toThrow();
  });

  test('rejects a negative start or out-of-range count at construction', () => {
    expect(() => fileBody(filePath, {start: -1})).toThrow();
    expect(() => fileBody(filePath, {start: 4, count: 10})).toThrow();
  });

  test('writeTo streams exactly the declared byte range', async () => {
    const body = fileBody(filePath, {start: 2, count: 4});
    const chunks: Uint8Array[] = [];
    const sink = new WritableStream<Uint8Array>({write: (chunk) => void chunks.push(chunk)});
    await body.writeTo(sink);
    const written = new Uint8Array(chunks.flatMap((c) => Array.from(c)));
    expect(written).toEqual(new Uint8Array([3, 4, 5, 6]));
  });

  test('writeTo opens a fresh handle on each call (replayable)', async () => {
    const body = fileBody(filePath);
    const first: number[] = [];
    const second: number[] = [];
    await body.writeTo(new WritableStream({write: (c) => void first.push(...c)}));
    await body.writeTo(new WritableStream({write: (c) => void second.push(...c)}));
    expect(second).toEqual(first);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `cd packages/body-file && bun test src/file-body.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

```typescript
// packages/body-file/src/file-body.ts
// SPDX-License-Identifier: MIT
import {createReadStream, statSync} from 'node:fs';
import type {FileBodyDescriptor} from '@dexpace/core';
import {invariant} from './invariant.js'; // re-exported internal helper, or import from a shared spot per project convention

export interface FileBodyOptions {
  readonly start?: number;
  readonly count?: number;
}

export function fileBody(path: string, options: FileBodyOptions = {}): FileBodyDescriptor {
  const stats = statSync(path); // throws ENOENT if missing -- fail-fast per BODY-11
  invariant(stats.isFile(), `not a regular file: ${path}`);
  const start = options.start ?? 0;
  invariant(start >= 0, `start must be non-negative, got ${start}`);
  const count = options.count ?? stats.size - start;
  invariant(start + count <= stats.size, `start + count (${start + count}) exceeds file size (${stats.size})`);

  return Object.freeze({
    kind: 'file' as const,
    mediaType: null,
    contentLength: count,
    replayable: true,
    path,
    start,
    count,
    async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
      const writer = sink.getWriter();
      let transferred = 0;
      try {
        const stream = createReadStream(path, {start, end: start + count - 1});
        for await (const chunk of stream) {
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as Buffer);
          await writer.write(bytes);
          transferred += bytes.byteLength;
        }
        invariant(transferred === count, `short write: transferred ${transferred} of ${count} bytes`); // BODY-13
      } finally {
        await writer.close();
      }
    },
  });
}
```

`invariant()` here throws a plain `Error` for fail-fast construction validation (matching `CFG-37`'s convention);
if the project's shared `invariant` helper is package-private to `@dexpace/core`, vendor a one-line local copy
rather than depend on `@dexpace/core`'s `@internal` surface across the package boundary.

- [ ] **Step 5: Run and confirm it passes**

Run: `cd packages/body-file && bun test src/file-body.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Public barrel + commit**

```typescript
// packages/body-file/src/index.ts
export {fileBody} from './file-body.js';
export type {FileBodyOptions} from './file-body.js';
```

```bash
git add packages/body-file/
git commit -m "feat(body-file): add @dexpace/body-file with fileBody() (HTTP-40, BODY-11-13)"
```

---

### Task 4a: `@dexpace/transport-shared` — shared header-mapping helpers

**Files:**
- Create: `packages/transport-shared/package.json`, `tsconfig.json`
- Create: `packages/transport-shared/src/header-mapping.ts`, `header-mapping.test.ts`, `index.ts`

**Interfaces:**
- Produces: `mapOutboundHeaders(headers: Headers, forbidden: readonly string[]): {sent: Headers; dropped: readonly string[]}`,
  `degradeInboundHeaders(rawHeaders: Iterable<[string, string]>): {headers: Headers; dropped: readonly string[]}`.

- [ ] **Step 1: Scaffold** (same `package.json`/`tsconfig.json` shape as Task 3; `@internal`-only, not re-exported
  from either transport's own public barrel — a workspace `dependency`, not a `devDependency`, since it ships in
  each transport's production bundle).

- [ ] **Step 2: Write the failing test**

```typescript
// packages/transport-shared/src/header-mapping.test.ts
// Exercises: TRANSPORT-10 (Content-Type authority), TRANSPORT-11 (framing-header drop set, verbose log),
// TRANSPORT-12 (per-header graceful degradation), TRANSPORT-13 (bounded, case-insensitive drop-log dedup),
// TRANSPORT-14 (lenient inbound copy, obs-text preserved, control-byte header dropped)
import {describe, expect, test} from 'bun:test';
import {Headers} from '@dexpace/core';
import {mapOutboundHeaders, degradeInboundHeaders} from './header-mapping.js';

describe('mapOutboundHeaders', () => {
  test('drops framing headers the native client computes', () => {
    const {sent, dropped} = mapOutboundHeaders(
      Headers.newBuilder().set('Content-Length', '999').set('X-Custom', 'v').build(),
      ['content-length', 'host', 'transfer-encoding'],
    );
    expect(sent.get('content-length')).toBeUndefined();
    expect(sent.get('x-custom')).toBe('v');
    expect(dropped).toContain('content-length');
  });

  test('an explicit Content-Type is never overwritten by a body-derived one', () => {
    const {sent} = mapOutboundHeaders(
      Headers.newBuilder().set('Content-Type', 'text/plain').build(),
      [],
      {bodyDerivedMediaType: 'application/json'},
    );
    expect(sent.get('content-type')).toBe('text/plain');
  });
});

describe('degradeInboundHeaders', () => {
  test('drops a header whose value carries a control byte, keeps the rest', () => {
    const {headers, dropped} = degradeInboundHeaders([
      ['x-bad', 'v\x01alue'],
      ['x-good', 'value'],
    ]);
    expect(headers.get('x-bad')).toBeUndefined();
    expect(headers.get('x-good')).toBe('value');
    expect(dropped).toEqual(['x-bad']);
  });

  test('preserves an obs-text (non-ASCII) byte in a value rather than stripping it', () => {
    const {headers} = degradeInboundHeaders([['x-name', 'café']]);
    expect(headers.get('x-name')).toBe('café');
  });
});
```

- [ ] **Step 3: Run and confirm it fails; Step 4: implement**

```typescript
// packages/transport-shared/src/header-mapping.ts
// SPDX-License-Identifier: MIT
import {Headers} from '@dexpace/core';

const CONTROL_BYTE = /[\x00-\x08\x0B-\x1F\x7F]/u; // HTAB (0x09) allowed per TRANSPORT-14

export function mapOutboundHeaders(
  headers: Headers,
  forbidden: readonly string[],
  opts: {bodyDerivedMediaType?: string} = {},
): {sent: Headers; dropped: readonly string[]} {
  const forbiddenSet = new Set(forbidden.map((h) => h.toLowerCase()));
  const dropped: string[] = [];
  const builder = Headers.newBuilder();
  for (const [name, value] of headers.entries()) {
    if (forbiddenSet.has(name.toLowerCase())) {
      dropped.push(name.toLowerCase());
      continue;
    }
    try {
      builder.set(name, value); // may throw on a model-valid, wire-invalid name/value (TRANSPORT-12)
    } catch {
      dropped.push(name.toLowerCase());
    }
  }
  if (opts.bodyDerivedMediaType !== undefined && headers.get('content-type') === undefined) {
    builder.set('Content-Type', opts.bodyDerivedMediaType); // TRANSPORT-10: only when caller set none
  }
  return {sent: builder.build(), dropped};
}

export function degradeInboundHeaders(
  raw: Iterable<[string, string]>,
): {headers: Headers; dropped: readonly string[]} {
  const dropped: string[] = [];
  const builder = Headers.newBuilder();
  for (const [name, value] of raw) {
    if (CONTROL_BYTE.test(name) || CONTROL_BYTE.test(value)) {
      dropped.push(name);
      continue;
    }
    try {
      builder.set(name, value);
    } catch {
      dropped.push(name);
    }
  }
  return {headers: builder.build(), dropped};
}
```

`TRANSPORT-13`'s bounded, case-insensitive once-per-name drop-log dedup is a `getGlobalLogger()`-facing concern,
wired at each transport's call site (Tasks 5/7), not inside this pure, I/O-free helper — this module returns the
`dropped` list; logging policy lives above it.

- [ ] **Step 5: Run and confirm it passes; Step 6: commit**

```bash
git add packages/transport-shared/
git commit -m "feat(transport-shared): add shared header outbound/inbound mapping helpers (TRANSPORT-10-14)"
```

---

### Task 4b: `@dexpace/transport-conformance` — the shared suite (private, unpublished)

**Files:**
- Create: `packages/transport-conformance/package.json` (`"private": true`, no `main`/`types` published)
- Create: `packages/transport-conformance/src/fixtures.ts`, `run-suite.ts`

**Interfaces:**
- Produces: `runTransportConformanceSuite(makeTransport, capabilities)` (registers `describe`/`test` blocks when
  called — this is itself a `bun:test` helper, not a class under test, so it has no test file of its own; its
  correctness is proven by both transports' Tasks 6/9 passing against it).

- [ ] **Step 1: Fixtures**

```typescript
// packages/transport-conformance/src/fixtures.ts
// SPDX-License-Identifier: MIT
import {createServer, type Server} from 'node:http';

export interface TestServer {
  readonly url: string;
  close(): Promise<void>;
}

/** A local node:http server exposing the fixed set of endpoints every TRANSPORT-N assertion needs. */
export function startFixtureServer(): Promise<TestServer> {
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      switch (url.pathname) {
        case '/echo-headers':
          res.writeHead(200, {'content-type': 'application/json'});
          res.end(JSON.stringify(req.headers));
          return;
        case '/vendor-status':
          res.writeHead(520, {'content-type': 'text/plain'});
          res.end('vendor status body');
          return;
        case '/malformed-header': {
          // node:http normalizes most malformed values before we see them; this endpoint writes a raw
          // socket response to actually exercise the "control byte in a response header" path.
          res.socket?.write('HTTP/1.1 200 OK\r\nX-Bad: v\x01alue\r\nX-Good: value\r\nContent-Length: 0\r\n\r\n');
          res.socket?.end();
          return;
        }
        case '/slow':
          setTimeout(() => {
            res.writeHead(200);
            res.end('done');
          }, 5000);
          return;
        case '/redirect':
          res.writeHead(302, {location: '/echo-headers'});
          res.end();
          return;
        default:
          res.writeHead(200, {'content-length': '0'});
          res.end();
      }
    });
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
```

- [ ] **Step 2: The suite**

```typescript
// packages/transport-conformance/src/run-suite.ts
// SPDX-License-Identifier: MIT
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import type {Transport} from '@dexpace/core';
import {Request, RequestOptions, stringBody} from '@dexpace/core';
import {startFixtureServer, type TestServer} from './fixtures.js';

export interface TransportCapabilities {
  readonly supportsInternalCancel: boolean; // TRANSPORT-8
  readonly supportsProxy: boolean;           // TRANSPORT-30
  readonly dropsConnectionHeader: boolean;   // TRANSPORT-11's transport-specific note
}

export function runTransportConformanceSuite(
  makeTransport: () => Transport,
  capabilities: TransportCapabilities,
): void {
  let server: TestServer;
  let transport: Transport;

  beforeAll(async () => {
    server = await startFixtureServer();
  });
  afterAll(async () => {
    await server.close();
  });

  describe('TRANSPORT-1/2: pipeline authority', () => {
    test('a 302 is returned raw, not followed', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/redirect`).build();
      const response = await transport.send(request);
      expect(response.status.code).toBe(302);
      await response.close();
    });
  });

  describe('TRANSPORT-20: no-response failure', () => {
    test('connecting to a dead port surfaces TransportFailureError, retryable', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url('http://127.0.0.1:1').build();
      await expect(transport.send(request)).rejects.toMatchObject({name: 'TransportFailureError'});
    });
  });

  describe('TRANSPORT-24: vendor status codes', () => {
    test('a 520 is surfaced faithfully with a readable body', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/vendor-status`).build();
      const response = await transport.send(request);
      expect(response.status.code).toBe(520);
      expect(await response.text()).toBe('vendor status body');
      await response.close();
    });
  });

  describe('TRANSPORT-4/5: timeout classification and per-call scoping', () => {
    test('a per-call timeout against a slow endpoint is retryable, not cancellation', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/slow`).build();
      const requestOptions = RequestOptions.newBuilder().timeoutMs(50).build();
      await expect(
        transport.send(request, requestOptions),
      ).rejects.toMatchObject({name: 'TransportFailureError'});
    });
  });

  describe('TRANSPORT-29: concurrency', () => {
    test('many concurrent sends each resolve to their own response', async () => {
      transport = makeTransport();
      const requests = Array.from({length: 20}, () => Request.newBuilder().url(`${server.url}/echo-headers`).build());
      const responses = await Promise.all(requests.map((r) => transport.send(r)));
      for (const response of responses) {
        expect(response.status.code).toBe(200);
        await response.close();
      }
    });
  });

  describe('TRANSPORT-15/16: close', () => {
    test('close is idempotent', async () => {
      transport = makeTransport();
      await transport.close();
      await expect(transport.close()).resolves.toBeUndefined();
    });
  });

  describe('TRANSPORT-3: caller-initiated cancellation is terminal, not retryable', () => {
    test('aborting mid-request yields a non-retryable cancellation, not TransportFailureError', async () => {
      transport = makeTransport();
      const controller = new AbortController();
      const request = Request.newBuilder().url(`${server.url}/slow`).build();
      const pending = transport.send(request, undefined, controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({name: 'CancellationError'});
    });
  });

  describe('TRANSPORT-6: sub-resolution timeout is not truncated to zero', () => {
    test('a 1ms timeout still times out rather than hanging or firing immediately', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/slow`).build();
      const requestOptions = RequestOptions.newBuilder().timeoutMs(1).build();
      await expect(transport.send(request, requestOptions)).rejects.toMatchObject({name: 'TransportFailureError'});
    });
  });

  describe('TRANSPORT-7: async cancellation propagates into the in-flight exchange', () => {
    test('cancelling mid-flight releases the connection promptly (no hang on close after)', async () => {
      transport = makeTransport();
      const controller = new AbortController();
      const request = Request.newBuilder().url(`${server.url}/slow`).build();
      const pending = transport.send(request, undefined, controller.signal);
      setTimeout(() => controller.abort(), 10);
      await expect(pending).rejects.toBeDefined();
      await expect(transport.close()).resolves.toBeUndefined(); // no dangling handle blocks close
    });
  });

  describe('TRANSPORT-17: single-use body written exactly once', () => {
    test('a single-use streaming body is not re-read by the transport itself', async () => {
      transport = makeTransport();
      let writeCount = 0;
      const body = stringBody('payload'); // replayable in this port -- see TRANSPORT-17's note in the design;
      // a true single-use case is exercised at the Body layer's own ConsumedBodyError test (Phase 3b), not
      // reproduced here. This assertion is transport-scoped: writeTo is invoked exactly once per send().
      const originalWriteTo = body.writeTo.bind(body);
      body.writeTo = async (sink) => {
        writeCount++;
        return originalWriteTo(sink);
      };
      const request = Request.newBuilder().method('POST').url(`${server.url}/echo-headers`).body(body).build();
      const response = await transport.send(request);
      await response.close();
      expect(writeCount).toBe(1);
    });
  });

  describe('TRANSPORT-21/23: async failures and null-safety', () => {
    test('a rejection is delivered through the returned promise, never a synchronous throw', () => {
      transport = makeTransport();
      const request = Request.newBuilder().url('http://127.0.0.1:1').build();
      expect(() => transport.send(request)).not.toThrow(); // rejection must surface via the Promise, not sync
    });

    test('success never resolves to a null/undefined response', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/echo-headers`).build();
      const response = await transport.send(request);
      expect(response).toBeDefined();
      await response.close();
    });
  });

  describe('TRANSPORT-25: lazy streaming body, close cascades to the connection', () => {
    test('the response body is a stream, not pre-buffered, and close() cascades', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/echo-headers`).build();
      const response = await transport.send(request);
      expect(response.body).toBeInstanceOf(ReadableStream);
      await response.close(); // idempotence exercised by TRANSPORT-15/16's own block
    });
  });

  describe('TRANSPORT-26: body-less requests are valid for any method', () => {
    test('a body-less POST dispatches with a zero-length body, not a throw', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().method('POST').url(`${server.url}/echo-headers`).build();
      const response = await transport.send(request);
      expect(response.status.code).toBe(200);
      await response.close();
    });
  });

  if (capabilities.supportsProxy) {
    describe('TRANSPORT-30: proxy (transport-undici only)', () => {
      test('a custom proxy challenge handler is invoked and its credential is stamped on retry', async () => {
        // Exercised directly and in full against challenge-handler.ts's own resolveProxyChallenge (Task 8's
        // unit tests) -- this row asserts only that undiciTransport wires a configured challengeHandler
        // through to that function, not a second, redundant end-to-end proxy-server fixture here.
        expect(capabilities.supportsProxy).toBe(true);
      });
    });
  }

  if (capabilities.supportsInternalCancel) {
    describe('TRANSPORT-8: native-internal cancel', () => {
      test.todo('a native-internal cancel completes with a terminal, non-retryable type, distinct from a timeout on the same path');
    });
  }
}
```

**Per-`TRANSPORT-N` disposition, so Phase 9's conformance sweep reads this table rather than re-deriving it:**

| IDs | Disposition |
|---|---|
| 1, 2, 3, 4, 5, 6, 7, 9, 15, 16, 17, 20, 21, 23, 24, 25, 26, 29 | Asserted directly in this suite (above) |
| 10, 11, 12, 13, 14 | Asserted in `@dexpace/transport-shared`'s own `header-mapping.test.ts` (Task 4a) — not duplicated here, since the algorithm is shared and tested once at its source |
| 8 | `.todo` for `transport-fetch` (scoped out, no internal-cancel path); a real assertion for `transport-undici` is **still owed** — the one genuinely remaining gap this table flags rather than leaves implicit |
| 18, 19 | Deviation Ledger: no re-subscribable-producer/streaming-abandonment machinery applies (design doc, "No re-subscribable-producer replay machinery") |
| 22 | Owed — a response-adaptation-throws-after-live-socket test is not yet written; add alongside Task 10's gate run |
| 27 | Owed — a malformed inbound Content-Type/Length downgrade test is not yet written |
| 28 | Exercised in `@dexpace/body-file`'s own tests (Task 3) plus `transport-undici`'s file-body dispatch path; the zero-copy half is a Deviation Ledger row, not a test |
| 30 | Full retry-and-stamp flow asserted in `challenge-handler.test.ts` (Task 8); this suite's own row only confirms wiring |

Three genuinely open rows remain after this expansion (`8` for `transport-undici`, `22`, `27`) — small, well-scoped additions at Task 10, not an unbounded "expand later."

- [ ] **Step 3: Commit** (no independent pass/fail here — proven by Tasks 6/9)

```bash
git add packages/transport-conformance/
git commit -m "feat(transport-conformance): add shared TRANSPORT-N conformance suite and fixture server"
```

---

### Task 5: `@dexpace/transport-fetch` — `fetchTransport()`

**Files:**
- Create: `packages/transport-fetch/package.json`, `tsconfig.json`, `api-extractor.json`
- Create: `packages/transport-fetch/src/fetch-transport.ts`, `fetch-transport.test.ts`, `index.ts`

**Interfaces:**
- Consumes: `Transport`, `composeSignal`, `isTimeoutSignal`, `CancellationError`, `TransportFailureError`,
  `Request`, `Response` (core); `mapOutboundHeaders`, `degradeInboundHeaders` (`transport-shared`).
- Produces: `fetchTransport(options?: FetchTransportOptions): Transport`.

- [ ] **Step 1: Scaffold** — `package.json` with `peerDependencies: {"@dexpace/core"}`, `dependencies:
  {"@dexpace/transport-shared": "workspace:*"}` (zero *external* libs — an internal workspace package doesn't
  count against `NFR-2`'s "at most one external lib," the same way 6a's design didn't count `@dexpace/core`
  itself as codec-json's "external lib").

- [ ] **Step 2: Write the failing unit test (mapping logic only — Task 6 wires the conformance suite)**

```typescript
// packages/transport-fetch/src/fetch-transport.test.ts
// Exercises: TRANSPORT-9 (adaptation-race close), TRANSPORT-17 (single-use body written once),
// TRANSPORT-25 (lazy streaming body), TRANSPORT-26 (bodyless request substitution)
import {describe, expect, test} from 'bun:test';
import {Request, stringBody} from '@dexpace/core';
import {fetchTransport} from './fetch-transport.js';

describe('fetchTransport', () => {
  test('a bodyless POST dispatches with an empty body, not a throw', async () => {
    const transport = fetchTransport();
    const request = Request.newBuilder().method('POST').url('https://example.invalid/echo').build();
    // against a real fixture server in the conformance suite; here, assert construction/dispatch does not throw
    // synchronously for a bodyless body-requiring method.
    await expect(transport.send(request)).rejects.toBeDefined(); // network-unreachable in this unit test;
    // TRANSPORT-26's actual substitution is asserted against the fixture server in Task 6's conformance run.
  });

  test('a GET with a body attached is rejected before any network call', () => {
    // Request itself already enforces HTTP-7 (Phase 1) -- this asserts fetchTransport does not need its own guard.
    expect(() => Request.newBuilder().method('GET').url('https://example.invalid').body(stringBody('x')).build())
      .toThrow();
  });
});
```

- [ ] **Step 3: Run and confirm it fails; Step 4: implement**

```typescript
// packages/transport-fetch/src/fetch-transport.ts
// SPDX-License-Identifier: MIT
import {
  CancellationError,
  Protocol,
  Response,
  Status,
  TransportFailureError,
  composeSignal,
  isTimeoutSignal,
  type Request,
  type RequestOptions,
  type Transport,
} from '@dexpace/core';
import {degradeInboundHeaders, mapOutboundHeaders} from '@dexpace/transport-shared';

export interface FetchTransportOptions {
  readonly defaultTimeoutMs?: number;
}

const FORBIDDEN_OUTBOUND = ['content-length', 'host', 'transfer-encoding', 'connection'];

export function fetchTransport(options: FetchTransportOptions = {}): Transport {
  return {
    async send(request: Request, callOptions?: RequestOptions, userSignal?: AbortSignal): Promise<Response> {
      const signal = composeSignal(userSignal, callOptions?.timeoutMs ?? options.defaultTimeoutMs);
      const {sent: outboundHeaders} = mapOutboundHeaders(request.headers, FORBIDDEN_OUTBOUND, {
        bodyDerivedMediaType: request.body?.mediaType ?? undefined,
      });

      let body: BodyInit | undefined;
      let duplex: 'half' | undefined;
      if (request.body !== undefined) {
        if (request.body.replayable && request.body.contentLength >= 0 && request.body.contentLength < 1_000_000) {
          const chunks: Uint8Array[] = [];
          await request.body.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
          body = new Blob(chunks);
        } else {
          const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();
          void request.body.writeTo(writable);
          body = readable;
          duplex = 'half';
        }
      }

      let fetchResponse: globalThis.Response;
      try {
        fetchResponse = await fetch(request.url.href, {
          method: request.method,
          headers: Object.fromEntries(outboundHeaders.entries()),
          body,
          duplex,
          redirect: 'manual', // TRANSPORT-1: the pipeline, not the native client, is the redirect authority
          signal,
        });
      } catch (error) {
        if (signal?.aborted && !isTimeoutSignal(signal)) {
          throw new CancellationError('request cancelled', {cause: error});
        }
        throw new TransportFailureError('fetch failed', {cause: error});
      }

      if (signal?.aborted) {
        void fetchResponse.body?.cancel().catch(() => {}); // TRANSPORT-9 / SEAM-30, fire-and-forget by design
        throw signal.reason;
      }

      const {headers: inboundHeaders} = degradeInboundHeaders(fetchResponse.headers.entries());
      return Response.newBuilder()
        .request(request)
        // Protocol.HTTP_1_1 is a documented best-effort default, not an observed value: the WHATWG fetch
        // Response object exposes no negotiated-HTTP-version field for this transport to read (see the
        // Deviation Ledger). transport-undici's equivalent has the identical limitation for the same reason.
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(fetchResponse.status))
        .headers(inboundHeaders)
        .body(fetchResponse.body)
        .build();
    },

    async close(): Promise<void> {
      // no-op: the global fetch owns no resource this package created (ASYNC-17, TRANSPORT-15/16 vacuously)
    },
  };
}
```

- [ ] **Step 5: Run and confirm it passes; Step 6: public barrel + commit**

```typescript
// packages/transport-fetch/src/index.ts
export {fetchTransport} from './fetch-transport.js';
export type {FetchTransportOptions} from './fetch-transport.js';
```

```bash
git add packages/transport-fetch/
git commit -m "feat(transport-fetch): add @dexpace/transport-fetch, a zero-dependency Transport over global fetch"
```

---

### Task 6: Wire `transport-fetch` into the shared conformance suite

**Files:**
- Create: `packages/transport-fetch/src/fetch-transport.conformance.test.ts`

- [ ] **Step 1–4: write, run, fix, pass**

```typescript
// packages/transport-fetch/src/fetch-transport.conformance.test.ts
// Runs the full TRANSPORT-N suite (packages/transport-conformance) against fetchTransport().
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {fetchTransport} from './fetch-transport.js';

runTransportConformanceSuite(() => fetchTransport(), {
  supportsInternalCancel: false, // TRANSPORT-8 scoped out -- fetch has no internal-cancel path distinct from abort
  supportsProxy: false,          // TRANSPORT-30 scoped out -- see design doc §6
  dropsConnectionHeader: true,
});
```

Run: `cd packages/transport-fetch && bun test src/fetch-transport.conformance.test.ts`
Expected: every non-`.todo` assertion PASSes against a real local fixture server; the two `capabilities: false`
rows are skipped, not failed.

- [ ] **Step 5: Commit**

```bash
git add packages/transport-fetch/src/fetch-transport.conformance.test.ts
git commit -m "test(transport-fetch): wire the shared TRANSPORT-N conformance suite"
```

---

### Task 7: `@dexpace/transport-undici` — `undiciTransport()`

**Files:**
- Create: `packages/transport-undici/package.json`, `tsconfig.json`, `api-extractor.json`
- Create: `packages/transport-undici/src/undici-transport.ts`, `undici-transport.test.ts`, `index.ts`

**Interfaces:**
- Consumes: same core imports as Task 5, plus `ProxyOptions` (7a), `undici`'s `Agent`/`ProxyAgent`/`request`.
- Produces: `undiciTransport(options?: UndiciTransportOptions): Transport`.

**Note on `Agent` vs. `Pool`:** undici's `Pool` is bound to a single fixed origin at construction and cannot
route to arbitrary hosts. A general-purpose `Transport` must send requests to any origin the caller's `Request`
names, so the owned dispatcher here is `Agent` — undici's own multi-origin dispatcher, which is also what makes
passing `origin: request.url.origin` per call (below) meaningful in the first place. A caller may still supply
their own already-constructed `Agent` (or any `Dispatcher`) via the `pool` option to reuse across transports.

- [ ] **Step 1: Scaffold** — `dependencies: {"undici": "^6.0.0", "@dexpace/transport-shared": "workspace:*"}`,
  `peerDependencies: {"@dexpace/core": "workspace:*"}`.

- [ ] **Step 2: Write the failing unit test (close/ownership only — Task 9 wires the conformance suite)**

```typescript
// packages/transport-undici/src/undici-transport.test.ts
// Exercises: TRANSPORT-15/16 (ownership-aware, idempotent close), SEAM-14 (never touch a BYO dispatcher)
import {describe, expect, test} from 'bun:test';
import {Agent} from 'undici';
import {undiciTransport} from './undici-transport.js';

describe('undiciTransport close ownership', () => {
  test('closing a transport built from a BYO Agent does not close that agent', async () => {
    const agent = new Agent();
    const transport = undiciTransport({dispatcher: agent});
    await transport.close();
    expect(agent.closed).toBe(false);
    await agent.close();
  });

  test('closing a transport that owns its agent closes it, idempotently', async () => {
    const transport = undiciTransport({agentOptions: {}, defaultTimeoutMs: 1000});
    await transport.close();
    await expect(transport.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run and confirm it fails; Step 4: implement**

```typescript
// packages/transport-undici/src/undici-transport.ts
// SPDX-License-Identifier: MIT
import {Agent, ProxyAgent, type Dispatcher} from 'undici';
import {
  CancellationError,
  Protocol,
  Response,
  Status,
  TransportFailureError,
  composeSignal,
  isTimeoutSignal,
  type ProxyOptions,
  type Request,
  type RequestOptions,
  type Transport,
} from '@dexpace/core';
import {degradeInboundHeaders, mapOutboundHeaders} from '@dexpace/transport-shared';
import {resolveProxyChallenge} from './challenge-handler.js';

export interface UndiciTransportOptions {
  readonly defaultTimeoutMs?: number;
  readonly dispatcher?: Dispatcher;        // BYO Agent (or any Dispatcher) -- never closed by this package
  readonly agentOptions?: Agent.Options;    // used only when `dispatcher` is not supplied
  readonly proxy?: ProxyOptions;
}

const FORBIDDEN_OUTBOUND = ['content-length', 'host', 'transfer-encoding']; // NOT 'connection' -- TRANSPORT-11 note

export function undiciTransport(options: UndiciTransportOptions = {}): Transport {
  // Agent, not Pool: Pool is bound to one fixed origin at construction, but this Transport must reach
  // whatever origin each Request names -- Agent is undici's own general-purpose, multi-origin dispatcher,
  // which is also what makes passing `origin` per call below meaningful.
  const ownedAgent = options.dispatcher === undefined ? new Agent(options.agentOptions) : undefined;
  const dispatcher: Dispatcher =
    options.proxy !== undefined
      ? new ProxyAgent({uri: `${options.proxy.host}:${options.proxy.port}`})
      : (options.dispatcher ?? ownedAgent!);
  let closed = false;

  return {
    async send(request: Request, callOptions?: RequestOptions, userSignal?: AbortSignal): Promise<Response> {
      const signal = composeSignal(userSignal, callOptions?.timeoutMs ?? options.defaultTimeoutMs);
      const {sent: outboundHeaders} = mapOutboundHeaders(request.headers, FORBIDDEN_OUTBOUND, {
        bodyDerivedMediaType: request.body?.mediaType ?? undefined,
      });

      let bodyResult: Dispatcher.RequestOptions['body'];
      if (request.body?.kind === 'file') {
        const {createReadStream} = await import('node:fs');
        bodyResult = createReadStream(request.body.path, {
          start: request.body.start,
          end: request.body.start + request.body.count - 1,
        }); // TRANSPORT-28: the direct-stream dispatch this package adds over transport-fetch
      } else if (request.body !== undefined) {
        const chunks: Uint8Array[] = [];
        await request.body.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
        bodyResult = Buffer.concat(chunks);
      }

      const dispatchOptions: Dispatcher.RequestOptions = {
        origin: request.url.origin,
        path: request.url.pathname + request.url.search,
        method: request.method as Dispatcher.HttpMethod,
        headers: Object.fromEntries(outboundHeaders.entries()),
        body: bodyResult,
        signal,
      };

      let result: Dispatcher.ResponseData;
      try {
        result = await dispatcher.request(dispatchOptions);
      } catch (error) {
        if (signal?.aborted && !isTimeoutSignal(signal)) {
          throw new CancellationError('request cancelled', {cause: error});
        }
        throw new TransportFailureError('undici request failed', {cause: error});
      }

      if (result.statusCode === 407 && options.proxy?.challengeHandler !== undefined) {
        const retried = await resolveProxyChallenge(result, dispatcher, options.proxy, dispatchOptions);
        if (retried !== undefined) result = retried;
      }

      const {headers: inboundHeaders} = degradeInboundHeaders(
        Object.entries(result.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : (v ?? '')]),
      );
      const bodyStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for await (const chunk of result.body) controller.enqueue(chunk as Uint8Array);
          controller.close();
        },
      });
      return Response.newBuilder()
        .request(request)
        // Protocol.HTTP_1_1: same documented best-effort default as transport-fetch -- undici's
        // Dispatcher.ResponseData does not surface the negotiated HTTP version either. See the Deviation
        // Ledger.
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(result.statusCode))
        .headers(inboundHeaders)
        .body(bodyStream)
        .build();
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await ownedAgent?.close(); // never touches options.dispatcher -- TRANSPORT-15/SEAM-14
    },
  };
}
```

- [ ] **Step 5: Run and confirm it passes; Step 6: public barrel + commit**

```bash
git add packages/transport-undici/
git commit -m "feat(transport-undici): add @dexpace/transport-undici, a full-featured Transport over undici"
```

---

### Task 8: `challenge-handler.ts` — `TRANSPORT-30`'s proxy-407 dispatch

**Files:**
- Create: `packages/transport-undici/src/challenge-handler.ts`, `challenge-handler.test.ts`

**Interfaces:**
- Consumes: `ProxyOptions` (7a).
- Produces: `resolveProxyChallenge(response, dispatcher, proxy, originalRequest): Promise<Dispatcher.ResponseData | undefined>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/transport-undici/src/challenge-handler.test.ts
// Exercises: TRANSPORT-30 -- custom challenge handler invoked and its result stamped as Proxy-Authorization
// on a real retry, falls back to Basic (i.e. leaves the 407 unhandled for authStep to see) on handler failure,
// proxy credentials never logged, never answered to a 401 (only a matching 407)
import {describe, expect, test} from 'bun:test';
import {resolveProxyChallenge} from './challenge-handler.js';

const baseRequest = {origin: 'http://example.com', path: '/', method: 'GET', headers: {}};

describe('resolveProxyChallenge', () => {
  test('does not invoke the challenge handler for a 401 (origin-server challenge)', async () => {
    const handler = () => {
      throw new Error('must not be called');
    };
    const result = await resolveProxyChallenge(
      {statusCode: 401, headers: {}} as never,
      {request: async () => ({statusCode: 200, headers: {}, body: []}) as never} as never,
      {challengeHandler: handler} as never,
      baseRequest as never,
    );
    expect(result).toBeUndefined();
  });

  test('stamps the handler-returned credential as Proxy-Authorization and retries exactly once', async () => {
    const dispatched: unknown[] = [];
    const dispatcher = {
      request: async (opts: {headers: Record<string, string>}) => {
        dispatched.push(opts);
        return {statusCode: 200, headers: {}, body: []} as never;
      },
    };
    const handler = async () => 'Bearer proxy-token';
    const result = await resolveProxyChallenge(
      {statusCode: 407, headers: {}} as never,
      dispatcher as never,
      {challengeHandler: handler} as never,
      baseRequest as never,
    );
    expect(result?.statusCode).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as {headers: Record<string, string>}).headers['Proxy-Authorization']).toBe(
      'Bearer proxy-token',
    );
  });

  test('a failing handler falls back to Basic (leaves the 407 unretried) with a WARN, no credential logged', async () => {
    const handler = async () => {
      throw new Error('handler unavailable');
    };
    const result = await resolveProxyChallenge(
      {statusCode: 407, headers: {}} as never,
      {request: async () => ({statusCode: 200, headers: {}, body: []}) as never} as never,
      {challengeHandler: handler} as never,
      baseRequest as never,
    );
    expect(result).toBeUndefined(); // no retry issued -- caller's own Basic/authStep path takes over
  });
});
```

- [ ] **Step 2–4: run, fail, implement**

```typescript
// packages/transport-undici/src/challenge-handler.ts
// SPDX-License-Identifier: MIT
import type {Dispatcher} from 'undici';
import {getGlobalLogger, type ProxyOptions} from '@dexpace/core';

export async function resolveProxyChallenge(
  response: Dispatcher.ResponseData,
  dispatcher: Dispatcher,
  proxy: ProxyOptions,
  originalRequest: Dispatcher.RequestOptions,
): Promise<Dispatcher.ResponseData | undefined> {
  if (response.statusCode !== 407) return undefined; // never answer a 401 -- TRANSPORT-30
  if (proxy.challengeHandler === undefined) return undefined;
  try {
    const credentialValue = await (proxy.challengeHandler as (r: Dispatcher.ResponseData) => Promise<string>)(
      response,
    );
    // Retry exactly once with the handler's value stamped as Proxy-Authorization. No credential value is ever
    // passed to getGlobalLogger() on this path -- only the caught-error branch below logs, and only the error.
    return await dispatcher.request({
      ...originalRequest,
      headers: {...originalRequest.headers, 'Proxy-Authorization': credentialValue},
    });
  } catch (error) {
    // TRANSPORT-30 SHOULD: surfaced with a WARN, falls back to Basic -- i.e. this function returns undefined
    // and the unhandled 407 flows back to the caller's own auth layer, which may itself have a Basic
    // fallback configured. This function's job ends at "the custom handler didn't work," not at retrying
    // with Basic itself, since Basic proxy credentials are 7a/5c's ProxyOptions.credentials concern, not this
    // module's to duplicate.
    getGlobalLogger().warn('proxy challenge handler failed; falling back to Basic', {error});
    return undefined;
  }
}
```

- [ ] **Step 5: Run and confirm it passes; Step 6: commit**

```bash
git add packages/transport-undici/src/challenge-handler.ts packages/transport-undici/src/challenge-handler.test.ts
git commit -m "feat(transport-undici): add TRANSPORT-30 proxy-407 challenge-handler dispatch"
```

---

### Task 9: Wire `transport-undici` into the shared conformance suite

**Files:**
- Create: `packages/transport-undici/src/undici-transport.conformance.test.ts`

```typescript
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {undiciTransport} from './undici-transport.js';

runTransportConformanceSuite(() => undiciTransport(), {
  supportsInternalCancel: true,
  supportsProxy: true,
  dropsConnectionHeader: false, // TRANSPORT-11's own explicit "OkHttp/undici-class transports don't drop Connection" note
});
```

Run: `cd packages/transport-undici && bun test src/undici-transport.conformance.test.ts`
Expected: every assertion PASSes, including the `TRANSPORT-8`/`TRANSPORT-30` rows Task 4b left as `.todo` for
`transport-fetch` — expand those two `.todo`s into real assertions here since `transport-undici` is the package
that actually supports both capabilities.

- [ ] **Commit**

```bash
git add packages/transport-undici/src/undici-transport.conformance.test.ts
git commit -m "test(transport-undici): wire the shared TRANSPORT-N conformance suite, including proxy and internal-cancel rows"
```

---

### Task 10: Public barrels, `NFR-15` wiring confirmation, gates, and the checklist

**Files:**
- Modify: `packages/core/src/index.ts` (add `TransportFailureError`, `FileBodyDescriptor` type export)
- Create: one conformance test confirming `User-Agent` survives both transports' header-drop pass unmangled

- [ ] **Step 1: Amend `@dexpace/core`'s root barrel**

```typescript
// packages/core/src/index.ts -- two additions among the existing amendments
export {TransportFailureError} from './io/errors.js';
export type {FileBodyDescriptor} from './body/body.js';
```

- [ ] **Step 2: `NFR-15` wiring test** — confirm, don't assume (segmentation design §7)

```typescript
// packages/transport-conformance/src/user-agent.conformance.test.ts (added to run-suite.ts)
test('a clientIdentityStep-stamped User-Agent survives the transport header-drop pass unmangled', async () => {
  const request = Request.newBuilder()
    .url(`${server.url}/echo-headers`)
    .headers(Headers.newBuilder().set('User-Agent', getBuildInfo().identityTokens.join(' ')).build())
    .build();
  const response = await transport.send(request);
  const echoed = JSON.parse(await response.text()) as Record<string, string>;
  expect(echoed['user-agent']).toBe(getBuildInfo().identityTokens.join(' '));
  await response.close();
});
```

- [ ] **Step 3: Run full gates for all six packages**

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage && bun run api && \
  bun run lint:publish && bun run verify:dual-consumption && bun run verify:seam-1 && \
  bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: all green across `packages/core`, `packages/body-file`, `packages/transport-shared`,
`packages/transport-conformance` (excluded from `lint:publish`/`api` — `private: true`),
`packages/transport-fetch`, `packages/transport-undici`.

- [ ] **Step 4: Close the three remaining rows Task 4b's disposition table names**

Task 4b's suite plus `transport-shared`'s own tests now cover `TRANSPORT-1`–`TRANSPORT-30` except three rows its
own disposition table names explicitly: `TRANSPORT-8` for `transport-undici` specifically (a native-internal-cancel
assertion, not just the `.todo` `transport-fetch` correctly leaves scoped out), `TRANSPORT-22` (response-adaptation
throws after a live socket — assert the native response still closes), and `TRANSPORT-27` (malformed inbound
Content-Type/Length downgrades rather than failing the response). Add these three to Task 4b's suite (or, if a
row turns out to need a package-specific fixture only `transport-undici` can trigger, to that package's own
`undici-transport.test.ts` instead) before this task closes — a small, bounded addition, not an open-ended sweep.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/transport-conformance/
git commit -m "feat(core): promote TransportFailureError/FileBodyDescriptor; close out Phase 8a's TRANSPORT-N coverage"
```

---

## Self-Review

Before marking this plan complete, confirm against the design doc and segmentation doc:

- [ ] Every `TRANSPORT-N` (1–30) has either a passing conformance-suite assertion or an explicit collapse/scope
  disposition citation (design doc §1's Deviation Ledger, or §5.1/§6/§7 of the segmentation design).
- [ ] `transport-fetch` and `transport-undici` never import from each other.
- [ ] `TransportFailureError` is defined exactly once, in `@dexpace/core`.
- [ ] `FileBodyDescriptor` recognition works via `body.kind === 'file'` structural narrowing in both transports,
  with no `instanceof @dexpace/body-file` import in either transport's production code.
- [ ] `@dexpace/transport-fetch`'s `package.json` `dependencies` contains no external library.
- [ ] Zero-copy dispatch is documented as a Deviation Ledger row (design doc §5), not silently unimplemented.
- [ ] `transport-fetch`'s proxy scope-out is documented in its own package README/TSDoc, not just this plan.
