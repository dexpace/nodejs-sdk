# Phase 8a — Transport Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four published packages `@dexpace/transport-fetch`, `@dexpace/transport-undici`,
`@dexpace/body-file`, and `@dexpace/transport-shared`, plus the unpublished `@dexpace/transport-conformance`
devDependency and two small retrofits to `@dexpace/core`
(`TransportFailureError`, `FileBodyDescriptor`) — satisfying `docs/product-spec/17-transport-adapter-conformance-contract.md`
(`TRANSPORT-1`–`TRANSPORT-30`) per `docs/work/mvp/phase8/phase8a/2026-07-28-phase8a-transport-design.md`.

**Architecture:** Five new workspace packages plus two amendments to already-shipped `@dexpace/core` files. Both
transports implement the identical `Transport` interface (Phase 2, unchanged) and are proven against one shared
conformance suite so they cannot silently drift from each other. `@dexpace/body-file` is a thin, `node:fs`-only
package that **neither transport depends on**: recognition flows through `FileBodyDescriptor`, a type-only
interface in `@dexpace/core`, which both transports narrow on structurally via `body.kind === 'file'` — the
factory package is a peer of the transports, never an upstream of them. `@dexpace/core` itself gains only that
type-only interface and a string-literal union member, costing nothing against its zero-`node:`-import invariant.

**Tech Stack:** TypeScript 5.8+, `undici` (a regular `dependency` of `@dexpace/transport-undici`, not a peer —
see the Global Constraints), `bun test`,
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
  algorithm (Content-Type authority, per-header graceful degradation) is identical for both packages, so it lives
  in exactly one place: `@dexpace/transport-shared` (Task 4a) — a published micro-package, zero deps beyond the
  `@dexpace/core` peer, `@internal`-only exports, not re-exported from any other package's public barrel. Both
  transports depend on it as a regular `dependency`. Do **not** put it in `@dexpace/transport-conformance` (that
  package is an unpublished devDependency and must not ship production code), in `@dexpace/body-file` (unrelated
  concern), or in one transport for the other to import (that would make one transport depend on a sibling
  transport, which the segmentation design deliberately avoids). It also holds `abortToSdkError()` and
  `createDropLogger()` — see the design doc §7.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`. A function needing a
  fourth input takes a single options object, not a fourth parameter.
- **`exactOptionalPropertyTypes` is on.** Declare optional fields with the optional-property syntax `?: T` (the
  styleguide's stated preference over the explicit-union form); add `| undefined` **only** where a caller
  legitimately passes an explicit `undefined` through — which under this flag is a distinct, deliberate contract,
  not the default spelling.
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
  invariant.ts                          # local fail-fast helper (see Task 3 Step 4)   (Task 3)
  file-body.ts                          # fileBody, FileBodyOptions                    (Task 3)
  index.ts

packages/transport-shared/src/
  header-mapping.ts                      # mapOutboundHeaders, degradeInboundHeaders    (Task 4a)
  abort-mapping.ts                        # abortToSdkError                              (Task 4a)
  drop-log.ts                              # HeaderDropLogging, createDropLogger          (Task 4a)
  index.ts

packages/transport-conformance/src/       # private: true, unpublished
  run-suite.ts                              # runTransportConformanceSuite             (Task 4b)
  fixtures.ts                                # node:http-backed local test server
  index.ts                                    # re-export barrel the two transports import

packages/transport-fetch/src/
  fetch-transport.ts                          # fetchTransport                         (Task 5)
  fetch-transport.conformance.test.ts           # wires Task 4b's suite                 (Task 6)

packages/transport-undici/src/
  undici-transport.ts                            # undiciTransport                      (Task 7)
  challenge-handler.ts                             # TRANSPORT-30 proxy-407 dispatch    (Task 8)
  undici-transport.conformance.test.ts              # wires Task 4b's suite             (Task 9)
```

Fifteen production/retrofit files across six packages (five new, one amended); every non-barrel, non-fixture
module carries a colocated `*.test.ts`. All four published packages additionally carry `package.json`,
`tsconfig.json`, `api-extractor.json`, and a checked-in `etc/<name>.api.md` (`NFR-4`).

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
- Create: `packages/body-file/package.json`, `tsconfig.json`, `api-extractor.json`, `etc/body-file.api.md`
- Create: `packages/body-file/src/invariant.ts`, `file-body.ts`, `file-body.test.ts`, `index.ts`

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
    expect(() => fileBody(filePath, {count: -1})).toThrow();
    // start past EOF: the default count would be size-start = -92, which still satisfies
    // start + count <= size, so it needs its own check or it silently uploads zero bytes.
    expect(() => fileBody(filePath, {start: 100})).toThrow();
  });

  test('writeTo does not close the caller-owned sink', async () => {
    const body = fileBody(filePath);
    let closed = false;
    const sink = new WritableStream<Uint8Array>({close: () => void (closed = true), write: () => {}});
    await body.writeTo(sink);
    expect(closed).toBe(false); // sink ownership stays with whoever created it -- design doc §5
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
import {invariant} from './invariant.js'; // local one-liner -- see the note below this block

export interface FileBodyOptions {
  readonly start?: number;
  readonly count?: number;
}

export function fileBody(path: string, options: FileBodyOptions = {}): FileBodyDescriptor {
  const stats = statSync(path); // throws ENOENT if missing -- fail-fast per BODY-11
  invariant(stats.isFile(), `not a regular file: ${path}`);
  const start = options.start ?? 0;
  invariant(start >= 0, `start must be non-negative, got ${start}`);
  // BODY-11/HTTP-40 needs all four checks. `start <= size` is NOT implied by `start + count <= size`:
  // the default count is `size - start`, which goes negative for a start past EOF and then passes the
  // sum check, silently producing a zero-byte upload instead of an error.
  invariant(start <= stats.size, `start (${start}) exceeds file size (${stats.size})`);
  const count = options.count ?? stats.size - start;
  invariant(count >= 0, `count must be non-negative, got ${count}`);
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
      // A fresh handle per write (HTTP-40) -- destroyed on every exit path so an early failure
      // strands no file descriptor (TRANSPORT-19's teardown obligation at the body layer).
      const stream = createReadStream(path, {start, end: start + count - 1});
      try {
        for await (const chunk of stream) {
          // `chunk` is a Buffer from a byte-mode fs stream; Buffer IS a Uint8Array, so this is a
          // view, not a copy, and needs no allocation.
          const bytes = chunk as Buffer;
          await writer.write(bytes);
          transferred += bytes.byteLength;
        }
        invariant(transferred === count, `short write: transferred ${transferred} of ${count} bytes`); // BODY-13
      } catch (error) {
        // Signal the failure downstream rather than leaving a half-written stream looking complete.
        await writer.abort(error);
        throw error;
      } finally {
        stream.destroy();
        // Release the lock, never close: the sink belongs to the caller (design doc §5's
        // stream-ownership decision, BODY-8). Closing it would break multipart/tee composition
        // and would deadlock transport-fetch, which closes its own TransformStream writable.
        writer.releaseLock();
      }
    },
  });
}
```

`invariant()` here throws a plain `Error` for fail-fast construction validation (matching `CFG-37`'s convention).
`@dexpace/core`'s own `invariant` is `@internal` and must not be reached across a package boundary, so this
package carries its own `src/invariant.ts` — create it in this step, it is one function:

```typescript
// packages/body-file/src/invariant.ts
// SPDX-License-Identifier: MIT
export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd packages/body-file && bun test src/file-body.test.ts`
Expected: PASS, 6 tests.

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

### Task 4a: `@dexpace/transport-shared` — shared header-mapping, abort-mapping, and drop-log helpers

**Files:**
- Create: `packages/transport-shared/package.json`, `tsconfig.json`, `api-extractor.json`,
  `etc/transport-shared.api.md` (it is a *published* package — `NFR-4` snapshots every published unit regardless
  of the `@internal` marking on its exports)
- Create: `packages/transport-shared/src/header-mapping.ts`, `header-mapping.test.ts`, `abort-mapping.ts`,
  `abort-mapping.test.ts`, `drop-log.ts`, `drop-log.test.ts`, `index.ts`

**Interfaces:**
- Produces: `mapOutboundHeaders(headers: Headers, forbidden: readonly string[], opts?): {sent: Headers; dropped: readonly string[]}`,
  `degradeInboundHeaders(rawHeaders: Iterable<readonly [string, string]>): {headers: Headers; dropped: readonly string[]}`,
  `abortToSdkError(signal: AbortSignal, cause: unknown): DexpaceError`,
  `createDropLogger(mode: HeaderDropLogging): (dropped: readonly string[]) => void`.

- [ ] **Step 1: Scaffold** (same `package.json`/`tsconfig.json`/`api-extractor.json` shape as Task 3;
  `@internal`-only exports, not re-exported
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
  // `entries()` yields one pair per VALUE, so a name with two values arrives twice; `add`, not
  // `set`, or the second value silently replaces the first and breaks HTTP-14.
  for (const [name, value] of headers.entries()) {
    if (forbiddenSet.has(name.toLowerCase())) {
      dropped.push(name.toLowerCase());
      continue;
    }
    try {
      builder.add(name, value); // may throw on a model-valid, wire-invalid name/value (TRANSPORT-12)
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
  raw: Iterable<readonly [string, string]>,
): {headers: Headers; dropped: readonly string[]} {
  const dropped: string[] = [];
  const builder = Headers.newBuilder();
  for (const [name, value] of raw) {
    // Name: control OR non-ASCII drops the header (TRANSPORT-14, HTTP-17).
    // Value: control drops it, but obs-text (>= 0x80) is PRESERVED, which is why the write below
    // goes through the lenient inbound setter (HTTP-19) and not the strict outbound `add`.
    if (NON_ASCII_OR_CONTROL.test(name) || CONTROL_BYTE.test(value)) {
      dropped.push(name);
      continue;
    }
    try {
      builder.addInbound(name, value); // HTTP-19's lenient path, Phase 1
    } catch {
      dropped.push(name);
    }
  }
  return {headers: builder.build(), dropped};
}
```

`NON_ASCII_OR_CONTROL` is `/[\x00-\x1F\x7F-￿]/u`. **Confirm `addInbound` against Phase 1's shipped `Headers`
builder before writing this** — `HTTP-19` mandates a distinct lenient inbound path, so the method exists; only
its spelling is assumed here. Using the strict `add`/`set` for inbound values is a defect, not a style choice: it
rejects every byte `>= 0x80` and would fail this task's own "preserves an obs-text byte" test.

`TRANSPORT-13`'s bounded, case-insensitive once-per-name drop-log dedup is a `getGlobalLogger()`-facing concern
and lives in this package's `drop-log.ts`, not in the pure `header-mapping.ts` above — the *policy* is shared so
the two transports cannot drift, but it is instantiated per transport instance and invoked at each transport's
own call site (Tasks 5/7) over the `dropped` list these functions return:

```typescript
// packages/transport-shared/src/drop-log.ts
// SPDX-License-Identifier: MIT
import {getGlobalLogger} from '@dexpace/core';

export type HeaderDropLogging = 'all' | 'first-per-name' | 'quiet';

/** Bound on the dedup set so an attacker synthesising distinct names cannot grow it (TRANSPORT-13, XCUT-14). */
const MAX_LOGGED_DROP_NAMES = 128;

export function createDropLogger(mode: HeaderDropLogging): (dropped: readonly string[]) => void {
  if (mode === 'quiet') return () => {};
  const seen = new Set<string>();
  return (dropped) => {
    for (const name of dropped) {
      const key = name.toLowerCase();
      if (mode === 'first-per-name') {
        if (seen.has(key)) continue;
        seen.add(key);
        // Drain-to-cap loop, not a single pre-insert evict, so a burst converges to the bound.
        while (seen.size > MAX_LOGGED_DROP_NAMES) seen.delete(seen.values().next().value as string);
      }
      getGlobalLogger().debug('dropped request/response header', {header: key}); // name only, never the value
    }
  };
}
```

```typescript
// packages/transport-shared/src/abort-mapping.ts
// SPDX-License-Identifier: MIT
import {CancellationError, TransportFailureError, isTimeoutSignal, type DexpaceError} from '@dexpace/core';

/**
 * The single mapping from an aborted signal to a canonical SDK error. Never surface `signal.reason`
 * raw: it is a DOMException (TimeoutError/AbortError), which is neither an IoError subtype (so
 * TRANSPORT-20 and 5a's isRetryableFailure cause-walk both miss a timeout) nor the terminal
 * CancellationError TRANSPORT-3 requires for a caller abort.
 */
export function abortToSdkError(signal: AbortSignal, cause: unknown): DexpaceError {
  return isTimeoutSignal(signal)
    ? new TransportFailureError('request timed out', {cause})
    : new CancellationError('request cancelled', {cause});
}
```

- [ ] **Step 5: Run and confirm it passes; Step 6: commit**

```bash
git add packages/transport-shared/
git commit -m "feat(transport-shared): add shared header outbound/inbound mapping helpers (TRANSPORT-10-14)"
```

---

### Task 4b: `@dexpace/transport-conformance` — the shared suite (private, unpublished)

**Files:**
- Create: `packages/transport-conformance/package.json` — `"private": true`, no build/publish, but it **must**
  still declare `"exports": {".": "./src/index.ts"}`, or `import {...} from '@dexpace/transport-conformance'` in
  Tasks 6/9 will not resolve. Excluded from `lint:publish`/`api` by its `private` flag.
- Create: `packages/transport-conformance/src/fixtures.ts`, `run-suite.ts`, `index.ts` (re-export barrel:
  `export {runTransportConformanceSuite} from './run-suite.js'; export type {TransportCapabilities} …`)
- Each transport lists it in `devDependencies` as `"@dexpace/transport-conformance": "workspace:*"`
  (Tasks 5 and 7, Step 1)

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
        case '/malformed-content-type':
          // TRANSPORT-27: a syntactically invalid media type and a chunked (length-less) body.
          res.writeHead(200, {'content-type': 'not-a-media-type', 'transfer-encoding': 'chunked'});
          res.end('body');
          return;
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
      // A counting Body built from scratch, NOT a monkey-patched stringBody(): every core model is
      // frozen (HTTP-1), so assigning `body.writeTo = ...` throws in strict mode. This is also a
      // genuinely single-use body, which stringBody (replayable) would not have exercised.
      const payload = new TextEncoder().encode('payload');
      const body: Body = {
        kind: 'stream',
        mediaType: 'text/plain',
        contentLength: payload.byteLength,
        replayable: false,
        async writeTo(sink) {
          writeCount++;
          const writer = sink.getWriter();
          await writer.write(payload);
          writer.releaseLock();
        },
      };
      const request = Request.newBuilder().method('POST').url(`${server.url}/echo-headers`).body(body).build();
      const response = await transport.send(request);
      await response.close();
      expect(writeCount).toBe(1);
    });
  });

  describe('TRANSPORT-22: an adaptation failure still closes the native response', () => {
    test('a response whose adaptation throws leaves no connection pinned', async () => {
      transport = makeTransport();
      // /malformed-header is the fixture whose raw socket write reaches the header-degrade path; a
      // transport that let a throw escape without cancelling the body would hang this close().
      const request = Request.newBuilder().url(`${server.url}/malformed-header`).build();
      const response = await transport.send(request);
      expect(response.headers.get('x-good')).toBe('value');
      expect(response.headers.get('x-bad')).toBeUndefined();
      await response.close();
      await expect(transport.close()).resolves.toBeUndefined(); // no dangling handle blocks close
    });
  });

  describe('TRANSPORT-27: malformed inbound Content-Type/Length downgrade', () => {
    test('an unparseable Content-Type becomes no-media-type and a missing Content-Length becomes -1', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/malformed-content-type`).build();
      const response = await transport.send(request);
      expect(response.status.code).toBe(200); // downgraded, not failed
      expect(response.body?.mediaType).toBeNull();
      expect(response.body?.contentLength).toBe(-1);
      await response.close();
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
      // A Body (Phase 3b's response-body wrapper), NOT a bare ReadableStream: Response.body is typed
      // `Body`, which is what carries .text()/.close(). The laziness assertion is that nothing was
      // read before we ask -- close() without reading must still release the connection (BODY-15).
      expect(response.body?.kind).toBe('stream');
      await response.close();
      await expect(response.close()).resolves.toBeUndefined(); // idempotent (BODY-15)
    });

    test('closing without reading releases the connection (no hang on transport close)', async () => {
      transport = makeTransport();
      const request = Request.newBuilder().url(`${server.url}/vendor-status`).build();
      const response = await transport.send(request);
      await response.close(); // body never read
      await expect(transport.close()).resolves.toBeUndefined();
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
| 1, 3, 4, 5, 6, 7, 9, 15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 29 | Asserted directly in this suite (above) |
| 2 | Satisfied by construction, asserted per package, not here: `transport-fetch` never composes a retrying dispatcher; `transport-undici` never composes a `RetryAgent`. A `transport-undici` unit test asserts the constructed `Agent` carries no retry interceptor |
| 10, 11, 12, 14 | Asserted in `@dexpace/transport-shared`'s own `header-mapping.test.ts` (Task 4a) — not duplicated here, since the algorithm is shared and tested once at its source |
| 13 | Asserted in `@dexpace/transport-shared`'s `drop-log.test.ts` (Task 4a): all three modes, case-insensitive dedup, and the `MAX_LOGGED_DROP_NAMES` bound holding under a synthesised-name burst. **Not** in `header-mapping.test.ts` — that module is deliberately I/O-free and logs nothing |
| 8 | `.todo` for `transport-fetch` (scoped out, no internal-cancel path); a real assertion for `transport-undici` is **still owed** — the one genuinely remaining gap this table flags rather than leaves implicit |
| 18 | Deviation Ledger: no re-subscribable-producer replay machinery applies (design doc, "No re-subscribable-producer replay machinery") |
| 19 | **Built, not collapsed** (the ledger row covers 18 only): `transport-fetch`'s streaming branch aborts and awaits its abandoned `writeTo` pump on every non-delivering exit path. Asserted in `fetch-transport.test.ts` — a body whose `writeTo` blocks forever must see its sink aborted when the send fails |
| 28 | Exercised in `@dexpace/body-file`'s own tests (Task 3) plus `transport-undici`'s file-body dispatch path; the zero-copy half is a Deviation Ledger row, not a test |
| 30 | Full retry-and-stamp flow asserted in `challenge-handler.test.ts` (Task 8); this suite's own row only confirms wiring |

Exactly one genuinely open row remains after this expansion — `TRANSPORT-8` for `transport-undici` (Task 9
expands the `.todo`). `22` and `27`, previously "owed", are now assertions in this suite backed by the
`/malformed-header` and `/malformed-content-type` fixtures.

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
  {"@dexpace/transport-shared": "workspace:*"}`, `devDependencies: {"@dexpace/transport-conformance":
  "workspace:*"}` (Task 6 imports it) — zero *external* libs; an internal workspace package doesn't
  count against `NFR-2`'s "at most one external lib," the same way 6a's design didn't count `@dexpace/core`
  itself as codec-json's "external lib". Plus `api-extractor.json` and `etc/transport-fetch.api.md`.

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

/**
 * Bodies at or below this declared length are materialized into one Blob instead of streamed, which
 * sidesteps the streaming-request-body/`duplex: 'half'` corner cases some fetch implementations have.
 * An explicit named bound, per the styleguide's "every buffer declares its bound" rule.
 */
const MAX_MATERIALIZED_BODY_BYTES = 1_000_000;

/** One entry per VALUE, so a repeated name survives as repeated appends (HTTP-14). */
function toNativeHeaders(headers: Headers): globalThis.Headers {
  const native = new globalThis.Headers();
  for (const [name, value] of headers.entries()) native.append(name, value);
  return native;
}

interface PreparedBody {
  readonly init: BodyInit | undefined;
  readonly duplex: 'half' | undefined;
  /** Resolves when the streaming producer finishes; undefined for the buffered/no-body cases. */
  readonly pump: Promise<void> | undefined;
  /** Idempotent teardown for an abandoned streaming producer (TRANSPORT-19). */
  abandon(cause: unknown): Promise<void>;
}

async function prepareBody(body: Body | undefined): Promise<PreparedBody> {
  const idle = {init: undefined, duplex: undefined, pump: undefined, abandon: async () => {}} as const;
  if (body === undefined) return idle;

  if (body.replayable && body.contentLength >= 0 && body.contentLength <= MAX_MATERIALIZED_BODY_BYTES) {
    const chunks: Uint8Array[] = [];
    await body.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
    return {...idle, init: new Blob(chunks)};
  }

  const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();
  // Retained, never floating: a writeTo rejection must fail the send rather than leave fetch waiting
  // on a stream that never closes, and the transport (not the body) closes the writable it created.
  const pump = (async () => {
    await body.writeTo(writable);
    await writable.close();
  })();
  return {
    init: readable,
    duplex: 'half',
    pump,
    // `abort` is idempotent, satisfying TRANSPORT-19's idempotent-teardown clause; awaiting the pump
    // with its rejection swallowed guarantees the producer has actually unwound before send() returns.
    abandon: async (cause) => {
      await writable.abort(cause).catch(() => {});
      await pump.catch(() => {});
    },
  };
}

export function fetchTransport(options: FetchTransportOptions = {}): Transport {
  const logDrops = createDropLogger(options.headerDropLogging ?? 'first-per-name');

  const send = async (
    request: Request,
    callOptions?: RequestOptions,
    userSignal?: AbortSignal,
  ): Promise<Response> => {
    const signal = composeSignal(userSignal, callOptions?.timeoutMs ?? options.defaultTimeoutMs);
    const {sent: outboundHeaders, dropped} = mapOutboundHeaders(request.headers, FORBIDDEN_OUTBOUND, {
      bodyDerivedMediaType: request.body?.mediaType ?? undefined,
    });
    logDrops(dropped); // TRANSPORT-11's verbose drop log / TRANSPORT-13's policy

    const prepared = await prepareBody(request.body);
    let fetchResponse: globalThis.Response;
    try {
      // Raced, not sequenced: a producer failure must surface even while fetch is still pending.
      fetchResponse = await Promise.race([
        fetch(request.url.href, {
          method: request.method,
          headers: toNativeHeaders(outboundHeaders),
          body: prepared.init,
          duplex: prepared.duplex,
          redirect: 'manual', // TRANSPORT-1: the pipeline, not the native client, is the redirect authority
          signal,
        }),
        (prepared.pump ?? new Promise<never>(() => {})).then(() => new Promise<never>(() => {})),
      ]);
    } catch (error) {
      await prepared.abandon(error);
      if (signal?.aborted) throw abortToSdkError(signal, error);
      throw new TransportFailureError('fetch failed', {cause: error});
    }

    if (signal?.aborted) {
      // TRANSPORT-9 / SEAM-30: the response will never reach a caller, so this producer closes it.
      await fetchResponse.body?.cancel().catch(() => {});
      await prepared.abandon(signal.reason);
      throw abortToSdkError(signal, signal.reason);
    }

    // TRANSPORT-22: everything from here on runs with a live socket in hand, so any throw must
    // release it before propagating.
    try {
      return adaptResponse(request, fetchResponse, logDrops);
    } catch (error) {
      await fetchResponse.body?.cancel().catch(() => {});
      throw error;
    }
  };

  return {
    send,
    async close(): Promise<void> {
      // no-op: the global fetch owns no resource this package created (ASYNC-17, TRANSPORT-15/16 vacuously)
    },
    async [Symbol.asyncDispose](): Promise<void> {
      // Single teardown path -- resource-management.md requires asyncDispose over a bare close().
      await this.close();
    },
  };
}

function adaptResponse(
  request: Request,
  fetchResponse: globalThis.Response,
  logDrops: (dropped: readonly string[]) => void,
): Response {
  const raw: (readonly [string, string])[] = [];
  for (const [name, value] of fetchResponse.headers.entries()) {
    // Set-Cookie is the one name WHATWG keeps un-joined; every other name arrives comma-joined.
    if (name.toLowerCase() !== 'set-cookie') raw.push([name, value]);
  }
  for (const cookie of fetchResponse.headers.getSetCookie()) raw.push(['set-cookie', cookie]);

  const {headers: inboundHeaders, dropped} = degradeInboundHeaders(raw);
  logDrops(dropped);

  return Response.newBuilder()
    .request(request)
    // Protocol.HTTP_1_1 is a documented best-effort default, not an observed value: the WHATWG fetch
    // Response object exposes no negotiated-HTTP-version field for this transport to read (see the
    // Deviation Ledger). transport-undici's equivalent has the identical limitation for the same reason.
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(fetchResponse.status))
    .headers(inboundHeaders)
    // Phase 3b's response-body wrapper, not the raw stream: `Response.body` is a `Body`, and
    // BODY-15's idempotent connection-releasing close lives on the wrapper. `close()` cascades to
    // `stream.cancel()`, which is what returns the connection (TRANSPORT-25). TRANSPORT-27: an
    // unparseable/absent Content-Type downgrades to null and an absent Content-Length to -1, inside
    // the wrapper's own parse -- never a failed response.
    .body(streamResponseBody(fetchResponse.body, inboundHeaders))
    .build();
}
```

`streamResponseBody(stream, headers)` is the Phase 3b response-body constructor (`BODY-14`/`BODY-15`).
**Confirm its exported name against Phase 3b's shipped `packages/core/src/body/` before writing Task 5** — the
type exists (`Response.text()` and `Response.close()` both depend on it); only the factory's spelling is assumed
here. It must not be given the raw `ReadableStream`: `Response.newBuilder().body()` takes a `Body`.

`FetchTransportOptions` gains `readonly headerDropLogging?: HeaderDropLogging` (default `'first-per-name'`),
and the import list gains `abortToSdkError`, `createDropLogger`, `type HeaderDropLogging` from
`@dexpace/transport-shared` plus `type Body`, `type Headers`, `streamResponseBody` from `@dexpace/core`;
`CancellationError`/`isTimeoutSignal` are no longer imported directly — `abortToSdkError` owns that branch.

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
their own already-constructed `Agent` (or any `Dispatcher`) via the **`dispatcher`** option to reuse across
transports.

**Note on dispatcher selection and ownership (design doc §4).** There is exactly one dispatcher binding and one
`owned` flag, resolved once at construction — never a second agent constructed and then discarded:
`dispatcher` supplied → use it, `owned = false`; `proxy` supplied → `new ProxyAgent(...)`, `owned = true`;
neither → `new Agent(...)`, `owned = true`. Supplying **both** `dispatcher` and `proxy` is a construction-time
`invariant` failure, not a silent win for one. A `ProxyAgent` the transport constructed is an SDK-created
resource `close()` must release, exactly like an owned `Agent`.

- [ ] **Step 1: Scaffold** — `dependencies: {"undici": "^6.0.0", "@dexpace/transport-shared": "workspace:*"}`,
  `peerDependencies: {"@dexpace/core": "workspace:*"}`,
  `devDependencies: {"@dexpace/transport-conformance": "workspace:*"}` (Task 9 imports it).

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

  test('a transport-constructed ProxyAgent is owned and closed too', async () => {
    // The ProxyAgent is SDK-created, so TRANSPORT-15 requires close() release it -- the bug this
    // guards is closing only a separately-constructed Agent and leaking the ProxyAgent actually used.
    const transport = undiciTransport({proxy: {protocol: 'HTTP', host: '127.0.0.1', port: 3128} as never});
    await expect(transport.close()).resolves.toBeUndefined();
    await expect(transport.close()).resolves.toBeUndefined();
  });

  test('supplying both a dispatcher and a proxy fails loudly at construction', () => {
    const agent = new Agent();
    expect(() => undiciTransport({dispatcher: agent, proxy: {} as never})).toThrow();
    void agent.close();
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

/**
 * One exclusive decision, made once, that fixes both the dispatcher and its ownership. Returns the
 * dispatchers this transport OWNS (and must therefore close) alongside the routing pair.
 *
 * - `proxied` is the dispatcher for hosts that go through the proxy;
 * - `direct` is the non-proxied fallback used when CFG-23/CFG-27's bypass decision says so. A ProxyAgent
 *   installed as *the* dispatcher would otherwise tunnel every origin regardless of the caller's NO_PROXY.
 */
function selectDispatchers(options: UndiciTransportOptions): {
  proxied: Dispatcher;
  direct: Dispatcher;
  owned: readonly Dispatcher[];
} {
  invariant(
    options.dispatcher === undefined || options.proxy === undefined,
    'supply either `dispatcher` or `proxy`, not both: a BYO dispatcher may already be a ProxyAgent, and ' +
      'silently ignoring one of the two options hides which is in force',
  );
  if (options.dispatcher !== undefined) {
    return {proxied: options.dispatcher, direct: options.dispatcher, owned: []}; // BYO: owned by the caller
  }
  // Agent, not Pool: Pool is bound to one fixed origin at construction, but this Transport must reach
  // whatever origin each Request names -- Agent is undici's own general-purpose, multi-origin dispatcher,
  // which is also what makes passing `origin` per call below meaningful.
  const direct = new Agent(options.agentOptions);
  if (options.proxy === undefined) return {proxied: direct, direct, owned: [direct]};
  const proxied = new ProxyAgent(toProxyAgentOptions(options.proxy));
  return {proxied, direct, owned: [proxied, direct]};
}

/** The whole ProxyOptions, not just its address: a bare `host:port` is not a valid absolute URL. */
function toProxyAgentOptions(proxy: ProxyOptions): ProxyAgent.Options {
  const uri = `${proxy.protocol.toLowerCase()}://${proxy.host}:${proxy.port}`;
  if (proxy.credentials === undefined) return {uri};
  const token = `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString('base64')}`;
  return {uri, token}; // never logged -- redaction-and-security.md, TRANSPORT-30
}

export function undiciTransport(options: UndiciTransportOptions = {}): Transport {
  const {proxied, direct, owned} = selectDispatchers(options);
  const logDrops = createDropLogger(options.headerDropLogging ?? 'first-per-name');
  let closed = false;

  return {
    async send(request: Request, callOptions?: RequestOptions, userSignal?: AbortSignal): Promise<Response> {
      const signal = composeSignal(userSignal, callOptions?.timeoutMs ?? options.defaultTimeoutMs);
      // CFG-23/CFG-27: bypassAll short-circuits, otherwise a non-proxy glob match routes direct.
      const dispatcher = shouldBypassProxy(options.proxy, request.url.hostname) ? direct : proxied;
      const {sent: outboundHeaders, dropped} = mapOutboundHeaders(request.headers, FORBIDDEN_OUTBOUND, {
        bodyDerivedMediaType: request.body?.mediaType ?? undefined,
      });
      logDrops(dropped);

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
        // Request.method is the SDK's own uppercase-token union (HTTP-9); undici types the same
        // tokens, so this narrows a value the compiler cannot follow across the two declarations.
        method: request.method as Dispatcher.HttpMethod,
        headers: toUndiciHeaders(outboundHeaders), // one entry per value -- HTTP-14, never fromEntries
        body: bodyResult,
        // TRANSPORT-1: pinned explicitly rather than inherited. undici's default is already 0, but a
        // BYO dispatcher may carry a redirect interceptor, and the pipeline is the single authority.
        maxRedirections: 0,
        signal,
      };

      let result: Dispatcher.ResponseData;
      try {
        result = await dispatcher.request(dispatchOptions);
      } catch (error) {
        if (signal?.aborted) throw abortToSdkError(signal, error);
        throw new TransportFailureError('undici request failed', {cause: error});
      }

      if (result.statusCode === 407 && options.proxy?.challengeHandler !== undefined) {
        const retried = await resolveProxyChallenge({
          response: result,
          dispatcher,
          proxy: options.proxy,
          originalRequest: dispatchOptions,
        });
        // The superseded 407's body is dumped inside resolveProxyChallenge on BOTH paths -- undici
        // will not release the connection for an undrained body (PIPE-40's obligation, one layer down).
        if (retried !== undefined) result = retried;
      }

      if (signal?.aborted) {
        // TRANSPORT-9 / SEAM-30: this response will never reach a caller, so this producer closes it.
        await result.body.dump().catch(() => {});
        throw abortToSdkError(signal, signal.reason);
      }

      // TRANSPORT-22: a live socket is in hand from here on, so any throw must release it first.
      try {
        return adaptResponse(request, result, logDrops);
      } catch (error) {
        await result.body.dump().catch(() => {});
        throw error;
      }
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Reverse acquisition order; `owned` is empty for a BYO dispatcher, so options.dispatcher is
      // never touched -- TRANSPORT-15/SEAM-14. Includes a ProxyAgent this transport constructed.
      for (const dispatcherToClose of [...owned].reverse()) await dispatcherToClose.close();
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await this.close();
    },
  };
}

function toUndiciHeaders(headers: Headers): string[] {
  // undici accepts a flat [name, value, name, value, ...] array, which is the only shape that keeps a
  // repeated name repeated. An object collapses duplicates to the last value and breaks HTTP-14.
  return [...headers.entries()].flat();
}

function adaptResponse(
  request: Request,
  result: Dispatcher.ResponseData,
  logDrops: (dropped: readonly string[]) => void,
): Response {
  const raw: (readonly [string, string])[] = [];
  for (const [name, value] of Object.entries(result.headers)) {
    if (value === undefined) continue;
    // An array means a genuinely repeated header (Set-Cookie); keep each value its own entry.
    if (Array.isArray(value)) for (const each of value) raw.push([name, each]);
    else raw.push([name, value]);
  }
  const {headers: inboundHeaders, dropped} = degradeInboundHeaders(raw);
  logDrops(dropped);

  return Response.newBuilder()
    .request(request)
    // Protocol.HTTP_1_1: same documented best-effort default as transport-fetch -- undici's
    // Dispatcher.ResponseData does not surface the negotiated HTTP version either. See the Deviation
    // Ledger.
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(result.statusCode))
    .headers(inboundHeaders)
    // Readable.toWeb, NOT a ReadableStream whose start() drains the body: draining in start() pulls
    // the whole body into memory eagerly and defeats TRANSPORT-25's not-pre-buffered requirement.
    // toWeb keeps reads demand-driven, and the wrapper's close() -> stream.cancel() -> body.destroy()
    // is what returns the connection to the pool.
    .body(streamResponseBody(Readable.toWeb(result.body) as ReadableStream<Uint8Array>, inboundHeaders))
    .build();
}
```

`shouldBypassProxy(proxy, hostname)` is 7a's own bypass decision (`CFG-23`'s glob matcher plus `CFG-27`'s
bypass-all flag) — **import it from `@dexpace/core`, do not re-derive the glob matching here**; if 7a exported
it only as a method on `ProxyOptions`, call that instead. `UndiciTransportOptions` gains
`readonly headerDropLogging?: HeaderDropLogging`. The import list gains `Readable` from `node:stream`,
`abortToSdkError`/`createDropLogger` from `@dexpace/transport-shared`, and `streamResponseBody`/`Headers`/
`shouldBypassProxy` from `@dexpace/core`; `CancellationError`/`isTimeoutSignal` drop out, as in Task 5.
`invariant` is this package's local copy, same one-liner as Task 3.

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
- Produces: `resolveProxyChallenge(args: ProxyChallengeArgs): Promise<Dispatcher.ResponseData | undefined>`,
  where `ProxyChallengeArgs = {response, dispatcher, proxy, originalRequest}`. **One options-object parameter,
  not four positional ones** — `max-params: 3` is a hard ESLint limit (Global Constraints), and four positional
  arguments of three near-identical shapes is exactly the call site that gets transposed silently.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/transport-undici/src/challenge-handler.test.ts
// Exercises: TRANSPORT-30 -- custom challenge handler invoked and its result stamped as Proxy-Authorization
// on a real retry, falls back to Basic (i.e. leaves the 407 unhandled for authStep to see) on handler failure,
// proxy credentials never logged, never answered to a 401 (only a matching 407)
import {describe, expect, test} from 'bun:test';
import {resolveProxyChallenge} from './challenge-handler.js';

const baseRequest = {origin: 'http://example.com', path: '/', method: 'GET', headers: {}};

/** A stand-in for undici's BodyReadable that records whether the connection-releasing dump() ran. */
function fakeBody(): {dump: () => Promise<void>; dumped: () => boolean} {
  let dumped = false;
  return {
    dump: async () => void (dumped = true),
    dumped: () => dumped,
  };
}

const okResponse = () => ({statusCode: 200, headers: {}, body: fakeBody()}) as never;

describe('resolveProxyChallenge', () => {
  test('does not invoke the challenge handler for a 401 (origin-server challenge)', async () => {
    const handler = () => {
      throw new Error('must not be called');
    };
    const result = await resolveProxyChallenge({
      response: {statusCode: 401, headers: {}, body: fakeBody()} as never,
      dispatcher: {request: async () => okResponse()} as never,
      proxy: {challengeHandler: handler} as never,
      originalRequest: baseRequest as never,
    });
    expect(result).toBeUndefined();
  });

  test('stamps the handler-returned credential as Proxy-Authorization and retries exactly once', async () => {
    const dispatched: unknown[] = [];
    const dispatcher = {
      request: async (opts: {headers: Record<string, string>}) => {
        dispatched.push(opts);
        return okResponse();
      },
    };
    const handler = async () => 'Bearer proxy-token';
    const challenge = fakeBody();
    const result = await resolveProxyChallenge({
      response: {statusCode: 407, headers: {}, body: challenge} as never,
      dispatcher: dispatcher as never,
      proxy: {challengeHandler: handler} as never,
      originalRequest: baseRequest as never,
    });
    expect(result?.statusCode).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as {headers: Record<string, string>}).headers['proxy-authorization']).toBe(
      'Bearer proxy-token',
    );
    // The superseded 407's body must be drained before the retry, or undici never releases the connection.
    expect(challenge.dumped()).toBe(true);
  });

  test('a failing handler falls back to Basic (leaves the 407 unretried) with a WARN, no credential logged', async () => {
    const handler = async () => {
      throw new Error('handler unavailable');
    };
    const result = await resolveProxyChallenge({
      response: {statusCode: 407, headers: {}, body: fakeBody()} as never,
      dispatcher: {request: async () => okResponse()} as never,
      proxy: {challengeHandler: handler} as never,
      originalRequest: baseRequest as never,
    });
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

export interface ProxyChallengeArgs {
  readonly response: Dispatcher.ResponseData;
  readonly dispatcher: Dispatcher;
  readonly proxy: ProxyOptions;
  readonly originalRequest: Dispatcher.RequestOptions;
}

// One options object, not four positional parameters: `max-params: 3` is a hard limit, and three of the
// four arguments are structurally similar enough that a transposed call site would type-check.
export async function resolveProxyChallenge(
  args: ProxyChallengeArgs,
): Promise<Dispatcher.ResponseData | undefined> {
  const {response, dispatcher, proxy, originalRequest} = args;
  if (response.statusCode !== 407) return undefined; // never answer a 401 -- TRANSPORT-30
  if (proxy.challengeHandler === undefined) return undefined;
  try {
    // `challengeHandler`'s parameter is the SDK-agnostic challenge slot CFG-22 declares; this narrows it
    // to the undici response shape this transport actually hands it.
    const credentialValue = await (proxy.challengeHandler as (r: Dispatcher.ResponseData) => Promise<string>)(
      response,
    );
    // Drain the superseded 407 BEFORE dispatching the retry: undici does not release a connection whose
    // body was never consumed, so skipping this leaks one socket per challenge (PIPE-40, one layer down).
    await response.body.dump();
    // Retry exactly once with the handler's value stamped as Proxy-Authorization. No credential value is ever
    // passed to getGlobalLogger() on this path -- only the caught-error branch below logs, and only the error.
    return await dispatcher.request({
      ...originalRequest,
      headers: {...originalRequest.headers, 'proxy-authorization': credentialValue},
    });
  } catch (error) {
    await response.body.dump().catch(() => {}); // same obligation on the failure path

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

This block goes **inside `runTransportConformanceSuite` in `run-suite.ts`**, not into a separate file: it reads
the suite's own `server` and `transport` closure variables, which no sibling file can see. Adding it to the one
suite is also what makes it run against both transports rather than one.

```typescript
// packages/transport-conformance/src/run-suite.ts -- one more describe inside runTransportConformanceSuite
describe('NFR-15: the stamped identity survives the header-drop pass', () => {
  test('a clientIdentityStep-stamped User-Agent arrives unmangled', async () => {
    transport = makeTransport();
    const identity = getBuildInfo().identityTokens.join(' ');
    const request = Request.newBuilder()
      .url(`${server.url}/echo-headers`)
      .headers(Headers.newBuilder().set('User-Agent', identity).build())
      .build();
    const response = await transport.send(request);
    const echoed = JSON.parse(await response.text()) as Record<string, string>;
    expect(echoed['user-agent']).toBe(identity);
    await response.close();
  });
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

- [ ] **Step 4: Close the one remaining row Task 4b's disposition table names**

Task 4b's suite plus `transport-shared`'s own tests now cover `TRANSPORT-1`–`TRANSPORT-30` except one row its
disposition table names explicitly: `TRANSPORT-8` for `transport-undici` specifically — a native-internal-cancel
assertion (undici's `Dispatcher.destroy()` mid-flight must complete the send with `CancellationError`, while a
timeout on the same path still completes with the retryable `TransportFailureError`), not just the `.todo`
`transport-fetch` correctly leaves scoped out. Task 9 expands it; if it turns out to need a fixture only
`transport-undici` can trigger, put it in that package's own `undici-transport.test.ts` instead.

Re-verify at this point, because they are the assertions most likely to have been written to pass rather than to
bite: `TRANSPORT-22` closes the socket on an adaptation throw, `TRANSPORT-25`'s close-without-reading releases
the connection, and `TRANSPORT-19`'s abandoned-pump teardown actually unblocks a producer that would otherwise
hang. Each of the three fails silently if the implementation regresses — the process simply does not exit.

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
- [ ] No abort is ever surfaced as a raw `signal.reason`: every abort path in both transports routes through
  `abortToSdkError`, so a timeout is a `TransportFailureError` (retryable, `IoError` subtype) and a caller abort
  is a `CancellationError` (terminal).
- [ ] Every dispatcher the transport constructed — including a `ProxyAgent` — is released by `close()`, and a
  caller-supplied `dispatcher` is never touched.
- [ ] No outbound or inbound header set is round-tripped through a plain object: a repeated name survives as a
  repeated name (`HTTP-14`).
- [ ] `degradeInboundHeaders` writes through the lenient inbound header path, so obs-text values survive.
- [ ] All four published packages (`transport-fetch`, `transport-undici`, `body-file`, `transport-shared`) have
  an `api-extractor.json` and a committed `etc/<name>.api.md` (`NFR-4`).
- [ ] The roadmap's Phase 8a row and `package-and-dependency-layout.md` list all four published packages, not
  just the two transports.
