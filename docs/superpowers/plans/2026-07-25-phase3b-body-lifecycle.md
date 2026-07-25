# Phase 3b — Body Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the request/response body lifecycle in `@dexpace/core` — the `Body` model, `materialize()`,
`Request`/`Response`'s real body types, `TypedResponse<T>`, request/response body-logging tees, and bounded
error-body buffering — satisfying `product-spec/06-request-and-response-body-lifecycle.md` (`BODY-1`–`BODY-37`,
`HTTP-36`–`HTTP-52`, minus the file-backed-body cluster deferred to Phase 8), per
`docs/superpowers/specs/2026-07-25-phase3b-body-lifecycle-design.md`.

**Architecture:** A new `packages/core/src/body/` folder plus surgical retrofits to two already-shipped files:
`packages/core/src/io/errors.ts` (flattening a leftover 3-tier error shape) and `packages/core/src/http/request.ts`
/ `response.ts` (replacing Phase 1's `unknown` body placeholder with real types). `Body` is a discriminated union
of independent classes — no shared base class, since `styleguide/typescript/06` §6.4 bans `extends` for anything
but `Error`. `Body.writeTo` and `Response.body` are both platform-native (`WritableStream<Uint8Array>` /
`ReadableStream<Uint8Array>`), so nothing from Phase 3a's `io/` is promoted; the two logging tees are
self-contained, reusing only `ByteQueue`.

**Tech Stack:** TypeScript 5.8+, Web Streams, `TextEncoder`/`TextDecoder`, Web Crypto (`crypto.getRandomValues`,
already relied on elsewhere per `sdk-design-nodejs/10`'s SHA-256-via-`crypto.subtle` precedent), `bun test`. No
new runtime dependencies — `SEAM-1` untouched.

**Prerequisite:** This plan assumes Phases 0, 1, 2, and 3a are already implemented exactly as their own plans
specify, **and** the checkpoint (`docs/superpowers/plans/2026-07-25-checkpoint-scaffold-through-phase3a.md`) has
signed off — concretely: `packages/core/src/http/*`, `seams/*`, `io/*` exist; `DexpaceError` is the flat taxonomy
root with `DomainModelError` already removed as a class tier (checkpoint §5.2); `engines.node` and `tsconfig.base.json`
`lib` are already bumped for `Symbol.dispose`/`Symbol.asyncDispose` (checkpoint §5.4), and `Transport` plus every
Phase 3a resource-owning class already implement it; the full gate sequence is green on `main`.

## Global Constraints

- **No new runtime dependencies.** `@dexpace/core`'s `dependencies` stays `{}` (`SEAM-1`).
- **No `node:` imports anywhere in `src/`**, including `src/body/`. `crypto.getRandomValues`/`TextEncoder`/
  `TextDecoder`/Web Streams are platform globals, not `node:` imports.
- **`FileBody` is out of scope.** Do not add a file-backed body variant — deferred to Phase 8 (roadmap's Deferred
  Items Log), because it needs `node:fs`.
- **`Body.writeTo` takes `WritableStream<Uint8Array>`, never Phase 3a's internal `BufferedSink`.** `Response.body`
  is `ReadableStream<Uint8Array> | null`, never `BufferedSource`. Nothing from `packages/core/src/io/` is imported
  by `packages/core/src/http/*` — the two logging tees in `body/` are `io/`'s only new consumers this phase, via
  `ByteQueue` alone (never `BufferedSource`/`BufferedSink`/`TeeSink` — their constructors bind to a stream
  reader/writer and their `write`/`read` methods are `ByteQueue`-and-count shaped, incompatible with the
  chunk-shaped `WritableStream<Uint8Array>`/`ReadableStream<Uint8Array>` this phase's public types use).
- **No shared `Body` base class.** Every variant is an independent class *implementing* the `Body` interface.
  `styleguide/typescript/06-classes-and-data-modeling.md` §6.4 permits `extends` only for `Error`.
- **The consumed-once guard lives on the single-use `Body` variant (`StreamBody`), not on `materialize()`.**
  `materialize()` holds no state of its own; the boolean flag is checked and set before `StreamBody.writeTo`'s
  first `await` (Node's single-thread collapse of the reference's atomic-CAS requirement — violating the ordering
  reintroduces the race `BODY-3` exists to prevent).
- **The 1 MiB error-body cap (`HTTP-52`/`BODY-30`) is fixed, not configurable.** Do not add a parameter for it.
- **Error tree stays flat.** New leaves (`ConsumedBodyError`, `MultipartBoundaryError`) `extends DexpaceError`
  directly. The `io/errors.ts` retrofit (Task 1) changes the four `IO-*` leaves' `extends IoError` to `extends
  DexpaceError`; `IoError` itself is **not removed** — it stays a directly-usable flat leaf (used bare at 4 sites
  across `buffered-source.ts`/`buffered-sink.ts`/`tee-sink.ts`), so those three files need zero changes. Grouping
  is restored via exported type-guard unions (`isIoError`, `isBodyError`), never a reintroduced class tier or a
  `kind` field on existing leaves (would touch every constructor across 3 already-written phases).
- Typed `Error` subclasses only (styleguide ch08); `cause` chaining on wrap-and-rethrow; `this.name =
  new.target.name` (inherited from `DexpaceError`'s constructor — no leaf needs to set it itself).
- Every resource-owning class implements `[Symbol.asyncDispose]` delegating to `close()` (checkpoint §5.4,
  already in force): `Response`, the response-body-logging wrapper. `Body` itself does not — no variant in this
  phase owns a closeable resource (`StreamBody` is explicitly caller-owned, `BODY-8`).
- `exactOptionalPropertyTypes: true` — optional properties are spelled `?: T | undefined`, never bare `?: T`.
- Every test file's top-of-file comment cites the `BODY-N`/`HTTP-N` IDs it exercises.
- Existing lint/coverage gates apply unchanged: `max-lines-per-function` 70, `max-depth` 3, `max-params` 3,
  explicit return types on exports, 80% aggregate coverage floor (`NFR-5`).

---

## File Structure

```
packages/core/src/body/
  body.ts                     # Body interface, kind union                         (Task 2)
  errors.ts                   # ConsumedBodyError, MultipartBoundaryError, isBodyError (Task 2)
  errors.test.ts
  simple-bodies.ts            # ByteArrayBody, StringBody, FormUrlEncodedBody       (Task 3)
  simple-bodies.test.ts
  stream-body.ts               # StreamBody                                         (Task 4)
  stream-body.test.ts
  materialize.ts               # materialize()                                      (Task 5)
  materialize.test.ts
  multipart-body.ts            # MultipartBody, framing, boundary gen/validation     (Task 6)
  multipart-body.test.ts
  typed-response.ts            # TypedResponse<T>                                    (Task 9)
  typed-response.test.ts
  request-body-logging.ts      # withRequestLogging                                  (Task 10)
  request-body-logging.test.ts
  response-body-logging.ts     # withResponseLogging                                 (Task 11)
  response-body-logging.test.ts
  http-status-error.ts         # HttpStatusError, toHttpError                        (Task 12)
  http-status-error.test.ts
  index.ts                     # internal-facing barrel (superset of the public one) (Task 13)

packages/core/src/io/errors.ts        # MODIFY: flatten the 4 IO-* leaves            (Task 1)
packages/core/src/io/errors.test.ts   # MODIFY
packages/core/src/io/index.ts         # MODIFY: add isIoError                        (Task 1)
packages/core/src/http/request.ts     # MODIFY: real Body type                       (Task 7)
packages/core/src/http/request.test.ts # MODIFY
packages/core/src/http/response.ts    # MODIFY: real body, text/bytes/close          (Task 8)
packages/core/src/http/response.test.ts # MODIFY
packages/core/src/index.ts            # MODIFY: promote the new public surface       (Task 13)
```

---

### Task 1: Retrofit — flatten `io/errors.ts`'s leftover 3-tier shape

**Files:**
- Modify: `packages/core/src/io/errors.ts`
- Modify: `packages/core/src/io/errors.test.ts`
- Modify: `packages/core/src/io/index.ts`

**Interfaces:**
- Consumes: `DexpaceError` (`http/errors.js`, Phase 2).
- Produces: `EndOfStreamError`, `SourceContractViolationError`, `ClosedResourceError`, `AllocationLimitError` now
  `extends DexpaceError` directly (siblings of `IoError`, not its children). `IoError` itself is unchanged code,
  just no longer anyone's parent. New: `isIoError(error): error is IoError | EndOfStreamError |
  SourceContractViolationError | ClosedResourceError | AllocationLimitError`. Every later task that imports
  `IoError` (none in this phase touch it) is unaffected.

- [ ] **Step 1: Write the failing test**

Replace the import block and the `describe('IoError tree', ...)` block in `packages/core/src/io/errors.test.ts`.

Old import:

```typescript
import {DexpaceError} from '../http/errors.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  SourceContractViolationError,
} from './errors.js';
```

New import:

```typescript
import {DexpaceError} from '../http/errors.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  isIoError,
  SourceContractViolationError,
} from './errors.js';
```

Replace the `describe('IoError tree', ...)` block (keep `IoError descends from DexpaceError` — still true; replace
`every leaf descends from IoError` — no longer true; keep the remaining tests unchanged; add `isIoError` coverage):

```typescript
describe('IoError tree', () => {
  test('IoError descends from DexpaceError', () => {
    expect(new IoError('boom')).toBeInstanceOf(DexpaceError);
  });

  test('every leaf descends from DexpaceError directly, not through IoError (Phase 3b retrofit)', () => {
    expect(new EndOfStreamError(3, 8)).toBeInstanceOf(DexpaceError);
    expect(new EndOfStreamError(3, 8)).not.toBeInstanceOf(IoError);
    expect(new SourceContractViolationError('zero read')).toBeInstanceOf(DexpaceError);
    expect(new ClosedResourceError('BufferedSource')).toBeInstanceOf(DexpaceError);
    expect(new AllocationLimitError(9, 8)).toBeInstanceOf(DexpaceError);
  });

  test('each error sets name from its own constructor', () => {
    expect(new EndOfStreamError(3, 8).name).toBe('EndOfStreamError');
    expect(new ClosedResourceError('ByteQueue').name).toBe('ClosedResourceError');
  });

  test('EndOfStreamError names delivered-of-requested as typed fields and in the message', () => {
    const error = new EndOfStreamError(3, 8);
    expect(error.delivered).toBe(3);
    expect(error.requested).toBe(8);
    expect(error.message).toBe('end of stream: delivered 3 of 8 bytes');
  });

  test('ClosedResourceError names the resource and is distinct from end-of-stream', () => {
    const error = new ClosedResourceError('BufferedSource');
    expect(error.message).toBe('BufferedSource is closed');
    expect(error).not.toBeInstanceOf(EndOfStreamError);
  });

  test('AllocationLimitError points at streaming alternatives', () => {
    const error = new AllocationLimitError(5_000, 4_000);
    expect(error.requested).toBe(5_000);
    expect(error.limit).toBe(4_000);
    expect(error.message).toBe(
      'cannot materialize 5000 bytes as one array (limit 4000); stream the body instead',
    );
  });

  test('cause chains through', () => {
    const cause = new RangeError('array too large');
    expect(new AllocationLimitError(5, 4, {cause}).cause).toBe(cause);
  });

  test('isIoError groups every leaf, including bare IoError, without a class tier', () => {
    expect(isIoError(new IoError('x'))).toBe(true);
    expect(isIoError(new EndOfStreamError(1, 2))).toBe(true);
    expect(isIoError(new SourceContractViolationError('x'))).toBe(true);
    expect(isIoError(new ClosedResourceError('x'))).toBe(true);
    expect(isIoError(new AllocationLimitError(1, 2))).toBe(true);
    expect(isIoError(new DexpaceError('other'))).toBe(false);
    expect(isIoError(new Error('plain'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/errors.test.ts`
Expected: FAIL — `isIoError is not a function` (or a type error at import resolution).

- [ ] **Step 3: Retrofit `errors.ts`**

Change the four classes' `extends` clause (leave `IoError`'s own declaration untouched):

```typescript
export class EndOfStreamError extends DexpaceError {
  // ... constructor unchanged
}

export class SourceContractViolationError extends DexpaceError {}

export class ClosedResourceError extends DexpaceError {
  // ... constructor unchanged
}

export class AllocationLimitError extends DexpaceError {
  // ... constructor unchanged
}
```

Append at the end of the file:

```typescript
/**
 * Groups every leaf in this file, including bare `IoError`, without reintroducing a class tier between
 * them and `DexpaceError` — the corpus caps custom error hierarchies at two levels. Retrofits Phase 3a's
 * shape, where the four leaves extended `IoError` (a 3-tier chain the checkpoint's `DomainModelError` fix
 * should also have caught and didn't).
 *
 * @internal
 */
export function isIoError(
  error: unknown,
): error is IoError | EndOfStreamError | SourceContractViolationError | ClosedResourceError | AllocationLimitError {
  return (
    error instanceof IoError ||
    error instanceof EndOfStreamError ||
    error instanceof SourceContractViolationError ||
    error instanceof ClosedResourceError ||
    error instanceof AllocationLimitError
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/io/errors.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add `isIoError` to the internal barrel**

In `packages/core/src/io/index.ts`, the existing errors export block already lists `IoError` among the four
leaves — add `isIoError` to that same list:

```typescript
export {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  isIoError,
  SourceContractViolationError,
} from './errors.js';
```

- [ ] **Step 6: Run the full existing `io/` and `http/` suites plus typecheck**

```bash
cd packages/core && bun test src/io/ src/http/ && cd .. && bun run typecheck
```

Expected: both exit 0. Nothing in `buffered-source.ts`/`buffered-sink.ts`/`tee-sink.ts` referenced `IoError`'s
parent — they throw `new IoError(...)` directly, which still resolves to the same class.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/io/errors.ts packages/core/src/io/errors.test.ts packages/core/src/io/index.ts
git commit -m "refactor(core): flatten io/errors.ts's leftover 3-tier shape (retrofit)"
```

---

### Task 2: `Body` interface and `body/errors.ts`

**Files:**
- Create: `packages/core/src/body/body.ts`
- Create: `packages/core/src/body/errors.ts`
- Create: `packages/core/src/body/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` (`../http/errors.js`).
- Produces: `interface Body` (`kind`, `mediaType`, `contentLength`, `replayable`, `writeTo`). `class
  ConsumedBodyError extends DexpaceError`, `class MultipartBoundaryError extends DexpaceError`, `function
  isBodyError`. Every later body/ task imports `Body` from this file; Tasks 4 and 6 import the two error classes.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/errors.test.ts
// Exercises: BODY-3 (ConsumedBodyError), HTTP-51 (MultipartBoundaryError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {ConsumedBodyError, isBodyError, MultipartBoundaryError} from './errors.js';

describe('body errors', () => {
  test('ConsumedBodyError descends from DexpaceError and names the body kind', () => {
    const error = new ConsumedBodyError('stream');
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.bodyKind).toBe('stream');
    expect(error.message).toContain('stream');
  });

  test('MultipartBoundaryError descends from DexpaceError and names the offending boundary', () => {
    const error = new MultipartBoundaryError('bad boundary');
    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.boundary).toBe('bad boundary');
  });

  test('isBodyError groups both leaves without a class tier', () => {
    expect(isBodyError(new ConsumedBodyError('stream'))).toBe(true);
    expect(isBodyError(new MultipartBoundaryError('x'))).toBe(true);
    expect(isBodyError(new DexpaceError('other'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write `body.ts`**

```typescript
// packages/core/src/body/body.ts

/**
 * A request body (HTTP-36/BODY-1). Produces bytes on demand via a single `writeTo` call, reports its
 * media type (nullable) and content length (-1 = unknown), and exposes replayability -- true only when
 * writing more than once yields byte-for-byte identical output.
 *
 * No shared base class: `styleguide/typescript/06` §6.4 permits `extends` only for `Error`. Every variant
 * is an independent class implementing this interface (a discriminated union over `kind`, per §6.5).
 *
 * `writeTo` takes the platform `WritableStream<Uint8Array>`, not Phase 3a's internal `BufferedSink` --
 * this is the choice that keeps `packages/core/src/io/` out of the public barrel indefinitely.
 */
export interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart';
  readonly mediaType: string | null;
  readonly contentLength: number;
  readonly replayable: boolean;
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
```

- [ ] **Step 4: Write `errors.ts`**

```typescript
// packages/core/src/body/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * A single-use body's second write (BODY-3). `bodyKind` names which Body variant refused the write.
 *
 * @internal
 */
export class ConsumedBodyError extends DexpaceError {
  readonly bodyKind: string;

  constructor(bodyKind: string, options?: ErrorOptions) {
    super(`${bodyKind} body already consumed -- single-use bodies cannot be written twice`, options);
    this.bodyKind = bodyKind;
  }
}

/**
 * A caller-supplied multipart boundary violates RFC 2046's grammar (HTTP-51).
 *
 * @internal
 */
export class MultipartBoundaryError extends DexpaceError {
  readonly boundary: string;

  constructor(boundary: string, options?: ErrorOptions) {
    super(`invalid multipart boundary: ${JSON.stringify(boundary)}`, options);
    this.boundary = boundary;
  }
}

/**
 * Groups both leaves without a class tier (checkpoint §5.2's prescribed remedy, reused here from the
 * start rather than retrofitted later).
 *
 * @internal
 */
export function isBodyError(error: unknown): error is ConsumedBodyError | MultipartBoundaryError {
  return error instanceof ConsumedBodyError || error instanceof MultipartBoundaryError;
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/errors.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/body/body.ts packages/core/src/body/errors.ts packages/core/src/body/errors.test.ts
git commit -m "feat(core): add Body interface and body-layer error taxonomy (BODY-1, BODY-3, HTTP-51)"
```

---

### Task 3: `body/simple-bodies.ts` — `ByteArrayBody`, `StringBody`, `FormUrlEncodedBody`

**Files:**
- Create: `packages/core/src/body/simple-bodies.ts`
- Create: `packages/core/src/body/simple-bodies.test.ts`

**Interfaces:**
- Consumes: `Body` (Task 2).
- Produces: `class ByteArrayBody`, `class StringBody`, `class FormUrlEncodedBody`, each `implements Body`; free
  functions `byteArrayBody(bytes, mediaType?)`, `stringBody(text, mediaType?)`,
  `formUrlEncodedBody(params)`. Task 5 (`materialize`), Task 6 (`MultipartBody` parts), Task 12
  (`HttpStatusError.body()`) all construct via `byteArrayBody`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/simple-bodies.test.ts
// Exercises: HTTP-36/BODY-1 (mediaType, contentLength, replayable, writeTo), HTTP-38/BODY-35 (replayable
// by source; form-urlencoded uses "+" for space, distinct from RFC 3986 query encoding)
import {describe, expect, test} from 'bun:test';
import {byteArrayBody, formUrlEncodedBody, stringBody} from './simple-bodies.js';

async function drain(body: {writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: (chunk) => void chunks.push(chunk)}));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe('ByteArrayBody', () => {
  test('reports kind, mediaType, contentLength, and is always replayable', () => {
    const body = byteArrayBody(Uint8Array.from([1, 2, 3]), 'application/octet-stream');
    expect(body.kind).toBe('byte-array');
    expect(body.mediaType).toBe('application/octet-stream');
    expect(body.contentLength).toBe(3);
    expect(body.replayable).toBe(true);
  });

  test('defaults mediaType to null', () => {
    expect(byteArrayBody(Uint8Array.from([1])).mediaType).toBeNull();
  });

  test('writeTo emits the exact bytes, twice, byte-for-byte identical (BODY-1)', async () => {
    const body = byteArrayBody(Uint8Array.from([9, 8, 7]));
    expect([...(await drain(body))]).toEqual([9, 8, 7]);
    expect([...(await drain(body))]).toEqual([9, 8, 7]);
  });

  test('holds an independent copy -- mutating the caller array afterwards does not change it', async () => {
    const input = Uint8Array.from([1, 2, 3]);
    const body = byteArrayBody(input);
    input[0] = 99;
    expect([...(await drain(body))]).toEqual([1, 2, 3]);
  });
});

describe('StringBody', () => {
  test('encodes UTF-8 and reports the byte length, not the character length', () => {
    const body = stringBody('héllo');
    expect(body.contentLength).toBe(6); // "é" is 2 bytes in UTF-8
    expect(body.replayable).toBe(true);
  });

  test('writeTo emits the UTF-8 bytes', async () => {
    expect(new TextDecoder().decode(await drain(stringBody('hi')))).toBe('hi');
  });
});

describe('FormUrlEncodedBody (HTTP-38/BODY-35)', () => {
  test('mediaType is fixed and the body is always replayable', () => {
    const body = formUrlEncodedBody(new Map([['a', 'b']]));
    expect(body.mediaType).toBe('application/x-www-form-urlencoded');
    expect(body.replayable).toBe(true);
  });

  test('encodes space as "+" rather than "%20"', async () => {
    const body = formUrlEncodedBody(new Map([['q', 'a b']]));
    expect(new TextDecoder().decode(await drain(body))).toBe('q=a+b');
  });

  test('joins multiple params with "&", preserving insertion order', async () => {
    const body = formUrlEncodedBody(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    expect(new TextDecoder().decode(await drain(body))).toBe('a=1&b=2');
  });

  test('percent-encodes reserved characters in keys and values', async () => {
    const body = formUrlEncodedBody(new Map([['a&b', 'c=d']]));
    expect(new TextDecoder().decode(await drain(body))).toBe('a%26b=c%3Dd');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/simple-bodies.test.ts`
Expected: FAIL — `Cannot find module './simple-bodies.js'`.

- [ ] **Step 3: Write `simple-bodies.ts`**

```typescript
// packages/core/src/body/simple-bodies.ts
import type {Body} from './body.js';

async function writeAllBytes(sink: WritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = sink.getWriter();
  try {
    await writer.write(bytes);
  } finally {
    await writer.close();
  }
}

/** A replayable body backed by an in-memory byte array (BODY-35). */
export class ByteArrayBody implements Body {
  readonly kind = 'byte-array' as const;
  readonly mediaType: string | null;
  readonly contentLength: number;
  readonly replayable = true;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array, mediaType: string | null = null) {
    this.#bytes = bytes.slice(); // independent copy -- caller mutation afterwards must not change this
    this.mediaType = mediaType;
    this.contentLength = this.#bytes.length;
  }

  writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    return writeAllBytes(sink, this.#bytes);
  }
}

/** A replayable body backed by a UTF-8-encoded string (BODY-35). */
export class StringBody implements Body {
  readonly kind = 'string' as const;
  readonly mediaType: string | null;
  readonly contentLength: number;
  readonly replayable = true;
  readonly #bytes: Uint8Array;

  constructor(text: string, mediaType: string | null = null) {
    this.#bytes = new TextEncoder().encode(text);
    this.mediaType = mediaType;
    this.contentLength = this.#bytes.length;
  }

  writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    return writeAllBytes(sink, this.#bytes);
  }
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

/** A replayable x-www-form-urlencoded body -- "+" for space, distinct from RFC 3986 query encoding (BODY-35). */
export class FormUrlEncodedBody implements Body {
  readonly kind = 'form-urlencoded' as const;
  readonly mediaType = 'application/x-www-form-urlencoded';
  readonly contentLength: number;
  readonly replayable = true;
  readonly #bytes: Uint8Array;

  constructor(params: ReadonlyMap<string, string>) {
    const encoded = [...params.entries()]
      .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
      .join('&');
    this.#bytes = new TextEncoder().encode(encoded);
    this.contentLength = this.#bytes.length;
  }

  writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    return writeAllBytes(sink, this.#bytes);
  }
}

export function byteArrayBody(bytes: Uint8Array, mediaType: string | null = null): ByteArrayBody {
  return new ByteArrayBody(bytes, mediaType);
}

export function stringBody(text: string, mediaType: string | null = null): StringBody {
  return new StringBody(text, mediaType);
}

export function formUrlEncodedBody(params: ReadonlyMap<string, string>): FormUrlEncodedBody {
  return new FormUrlEncodedBody(params);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/simple-bodies.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/simple-bodies.ts packages/core/src/body/simple-bodies.test.ts
git commit -m "feat(core): add ByteArrayBody, StringBody, FormUrlEncodedBody (BODY-1, BODY-35, HTTP-38)"
```

---

### Task 4: `body/stream-body.ts` — `StreamBody`

**Files:**
- Create: `packages/core/src/body/stream-body.ts`
- Create: `packages/core/src/body/stream-body.test.ts`

**Interfaces:**
- Consumes: `Body` (Task 2), `ConsumedBodyError` (Task 2).
- Produces: `class StreamBody implements Body`, `function streamBody(stream, mediaType?, contentLength?)`. Task 5
  (`materialize`) and Task 10's tests both construct one.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/stream-body.test.ts
// Exercises: BODY-9 (always single-use -- no generic mark/reset on Node's ReadableStream), BODY-3
// (second write fails loudly and is race-safe), BODY-8 (caller's stream is not force-closed -- read to
// natural exhaustion via pipeTo)
import {describe, expect, test} from 'bun:test';
import {ConsumedBodyError} from './errors.js';
import {streamBody} from './stream-body.js';

function readableOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function collectingSink(): {sink: WritableStream<Uint8Array>; written: () => Uint8Array} {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({write: (chunk) => void chunks.push(chunk)});
  return {
    sink,
    written: () => {
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return out;
    },
  };
}

describe('StreamBody', () => {
  test('is always single-use, regardless of declared length (BODY-9)', () => {
    expect(streamBody(readableOf([1, 2]), null, 2).replayable).toBe(false);
  });

  test('reports the caller-supplied mediaType and contentLength', () => {
    const body = streamBody(readableOf([1]), 'application/octet-stream', 1);
    expect(body.mediaType).toBe('application/octet-stream');
    expect(body.contentLength).toBe(1);
  });

  test('defaults contentLength to -1 (unknown)', () => {
    expect(streamBody(readableOf([1])).contentLength).toBe(-1);
  });

  test('writeTo forwards the exact bytes', async () => {
    const {sink, written} = collectingSink();
    await streamBody(readableOf([1, 2], [3])).writeTo(sink);
    expect([...written()]).toEqual([1, 2, 3]);
  });

  test('a second write throws ConsumedBodyError (BODY-3)', async () => {
    const body = streamBody(readableOf([1]));
    await body.writeTo(collectingSink().sink);
    expect(body.writeTo(collectingSink().sink)).rejects.toThrow(ConsumedBodyError);
  });

  test('concurrent first writes: exactly one proceeds, the other rejects (BODY-3 race-safety)', async () => {
    const body = streamBody(readableOf([1, 2, 3]));
    const results = await Promise.allSettled([
      body.writeTo(collectingSink().sink),
      body.writeTo(collectingSink().sink),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/stream-body.test.ts`
Expected: FAIL — `Cannot find module './stream-body.js'`.

- [ ] **Step 3: Write `stream-body.ts`**

```typescript
// packages/core/src/body/stream-body.ts
import {ConsumedBodyError} from './errors.js';
import type {Body} from './body.js';

/**
 * A single-use body backed by a caller-supplied stream. Always single-use (BODY-9: Node's ReadableStream
 * has no generic mark/reset, ledgered as narrower than BODY-9's SHOULD). Does not close or cancel the
 * caller's stream -- writeTo reads it to natural exhaustion via pipeTo, leaving cancellation ownership
 * with the caller (BODY-8).
 */
export class StreamBody implements Body {
  readonly kind = 'stream' as const;
  readonly mediaType: string | null;
  readonly contentLength: number;
  readonly replayable = false;
  readonly #stream: ReadableStream<Uint8Array>;
  #consumed = false;

  constructor(stream: ReadableStream<Uint8Array>, mediaType: string | null = null, contentLength = -1) {
    this.#stream = stream;
    this.mediaType = mediaType;
    this.contentLength = contentLength;
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    if (this.#consumed) throw new ConsumedBodyError('stream');
    this.#consumed = true; // set before the first await -- BODY-3's race-safety guard
    await this.#stream.pipeTo(sink);
  }
}

export function streamBody(
  stream: ReadableStream<Uint8Array>,
  mediaType: string | null = null,
  contentLength = -1,
): StreamBody {
  return new StreamBody(stream, mediaType, contentLength);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/stream-body.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/stream-body.ts packages/core/src/body/stream-body.test.ts
git commit -m "feat(core): add StreamBody (BODY-3, BODY-8, BODY-9)"
```

---

### Task 5: `body/materialize.ts`

**Files:**
- Create: `packages/core/src/body/materialize.ts`
- Create: `packages/core/src/body/materialize.test.ts`

**Interfaces:**
- Consumes: `Body` (Task 2), `byteArrayBody` (Task 3).
- Produces: `function materialize(body: Body): Promise<Body>`. Task 10's `LoggedBody.materialize()` calls this.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/materialize.test.ts
// Exercises: BODY-3/HTTP-37 (materialize-once)
import {describe, expect, test} from 'bun:test';
import {byteArrayBody} from './simple-bodies.js';
import {materialize} from './materialize.js';
import {streamBody} from './stream-body.js';

function readableOf(...bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

async function drainBody(body: {writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('materialize', () => {
  test('returns an already-replayable body unchanged', async () => {
    const body = byteArrayBody(Uint8Array.from([1, 2]));
    expect(await materialize(body)).toBe(body);
  });

  test('drains a single-use body into a fresh replayable ByteArrayBody', async () => {
    const materialized = await materialize(streamBody(readableOf(1, 2, 3)));
    expect(materialized.replayable).toBe(true);
    expect(materialized.kind).toBe('byte-array');
    expect([...(await drainBody(materialized))]).toEqual([1, 2, 3]);
  });

  test('the materialized body is writable more than once, byte-for-byte identical', async () => {
    const materialized = await materialize(streamBody(readableOf(9, 8)));
    expect([...(await drainBody(materialized))]).toEqual([9, 8]);
    expect([...(await drainBody(materialized))]).toEqual([9, 8]);
  });

  test('preserves the original mediaType', async () => {
    const materialized = await materialize(streamBody(readableOf(1), 'text/plain'));
    expect(materialized.mediaType).toBe('text/plain');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/materialize.test.ts`
Expected: FAIL — `Cannot find module './materialize.js'`.

- [ ] **Step 3: Write `materialize.ts`**

```typescript
// packages/core/src/body/materialize.ts
import {byteArrayBody} from './simple-bodies.js';
import type {Body} from './body.js';

/**
 * Returns `body` unchanged if already replayable; otherwise drains its single write into a fresh
 * replayable ByteArrayBody, after which the original is treated as consumed (BODY-3/HTTP-37).
 *
 * Holds no state of its own -- the consumed-once guard lives on whichever single-use Body variant is
 * being drained (e.g. StreamBody), since writeTo can be called directly without going through
 * materialize, and the guard must protect that path too.
 */
export async function materialize(body: Body): Promise<Body> {
  if (body.replayable) return body;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const collector = new WritableStream<Uint8Array>({
    write: (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
    },
  });
  await body.writeTo(collector);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return byteArrayBody(bytes, body.mediaType);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/materialize.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/materialize.ts packages/core/src/body/materialize.test.ts
git commit -m "feat(core): add materialize() (BODY-3, HTTP-37)"
```

---

### Task 6: `body/multipart-body.ts` — `MultipartBody`

**Files:**
- Create: `packages/core/src/body/multipart-body.ts`
- Create: `packages/core/src/body/multipart-body.test.ts`

**Interfaces:**
- Consumes: `Body` (Task 2), `MultipartBoundaryError` (Task 2), `byteArrayBody`/`stringBody` (Task 3, tests
  only), `streamBody` (Task 4, tests only).
- Produces: `interface MultipartPart {name, filename?, body}`, `class MultipartBody implements Body`, `function
  multipartBody(parts, boundary?)`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/multipart-body.test.ts
// Exercises: BODY-2 (composite replayability, unknown-length collapse), HTTP-51 (shared framing routine,
// boundary generation/validation, header quoting)
import {describe, expect, test} from 'bun:test';
import {MultipartBoundaryError} from './errors.js';
import {multipartBody} from './multipart-body.js';
import {byteArrayBody, stringBody} from './simple-bodies.js';
import {streamBody} from './stream-body.js';

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({start: (c) => c.close()});
}

function oneByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Uint8Array.from([1]));
      c.close();
    },
  });
}

async function drain(body: {writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>}): Promise<string> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(out);
}

describe('MultipartBody (BODY-2, HTTP-51)', () => {
  test('replayable when every part is replayable', () => {
    expect(multipartBody([{name: 'a', body: stringBody('x')}]).replayable).toBe(true);
  });

  test('not replayable when any part is not', () => {
    const body = multipartBody([
      {name: 'a', body: stringBody('x')},
      {name: 'b', body: streamBody(oneByteStream())},
    ]);
    expect(body.replayable).toBe(false);
  });

  test('declared length collapses to -1 if any part length is unknown (BODY-2)', () => {
    expect(multipartBody([{name: 'a', body: streamBody(emptyStream())}]).contentLength).toBe(-1);
  });

  test('declared length equals the bytes actually written when every part length is known', async () => {
    const body = multipartBody([{name: 'a', body: stringBody('hello')}], 'FIXEDBOUNDARY');
    const rendered = await drain(body);
    expect(new TextEncoder().encode(rendered).length).toBe(body.contentLength);
  });

  test('frames one part with boundary, headers, body, and a CRLF-terminated trailer', async () => {
    const rendered = await drain(multipartBody([{name: 'field', body: stringBody('value')}], 'B'));
    expect(rendered).toBe('--B\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--B--\r\n');
  });

  test('includes filename and Content-Type when the part has them', async () => {
    const rendered = await drain(
      multipartBody(
        [{name: 'file', filename: 'a.txt', body: byteArrayBody(Uint8Array.from([1]), 'text/plain')}],
        'B',
      ),
    );
    expect(rendered).toContain('filename="a.txt"');
    expect(rendered).toContain('Content-Type: text/plain\r\n');
  });

  test('quotes/escapes a quote or backslash in a part name, and strips embedded CR/LF (HTTP-51)', async () => {
    const rendered = await drain(multipartBody([{name: 'a"b\\c\r\nd', body: stringBody('x')}], 'B'));
    expect(rendered).toContain('name="a\\"b\\\\cd"');
  });

  test('a valid caller-supplied boundary is accepted', () => {
    expect(() => multipartBody([{name: 'a', body: stringBody('x')}], 'valid-boundary_1')).not.toThrow();
  });

  test('an invalid caller-supplied boundary throws MultipartBoundaryError', () => {
    expect(() => multipartBody([{name: 'a', body: stringBody('x')}], 'trailing space ')).toThrow(
      MultipartBoundaryError,
    );
    expect(() => multipartBody([{name: 'a', body: stringBody('x')}], '')).toThrow(MultipartBoundaryError);
  });

  test('an unsupplied boundary is generated and spec-valid', () => {
    const body = multipartBody([{name: 'a', body: stringBody('x')}]);
    expect(body.mediaType).toMatch(/^multipart\/form-data; boundary=dexpace-[A-Za-z0-9]{32}$/);
  });

  test('two generated boundaries differ', () => {
    const a = multipartBody([{name: 'a', body: stringBody('x')}]);
    const b = multipartBody([{name: 'a', body: stringBody('x')}]);
    expect(a.mediaType).not.toBe(b.mediaType);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/multipart-body.test.ts`
Expected: FAIL — `Cannot find module './multipart-body.js'`.

- [ ] **Step 3: Write `multipart-body.ts`**

```typescript
// packages/core/src/body/multipart-body.ts
import {MultipartBoundaryError} from './errors.js';
import type {Body} from './body.js';

export interface MultipartPart {
  readonly name: string;
  readonly filename?: string | undefined;
  readonly body: Body;
}

const BOUNDARY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// RFC 2046 bchars grammar: 1-70 chars, last char not a space.
const BOUNDARY_PATTERN = /^[A-Za-z0-9'()+_,\-./:=? ]{1,69}[A-Za-z0-9'()+_,\-./:=?]$/;
const SINGLE_CHAR_BOUNDARY_PATTERN = /^[A-Za-z0-9'()+_,\-./:=?]$/;
const CRLF = new TextEncoder().encode('\r\n');

function generateBoundary(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let boundary = 'dexpace-';
  for (const byte of bytes) boundary += BOUNDARY_CHARS[byte % BOUNDARY_CHARS.length];
  return boundary;
}

function validateBoundary(boundary: string): void {
  const valid =
    boundary.length === 1 ? SINGLE_CHAR_BOUNDARY_PATTERN.test(boundary) : BOUNDARY_PATTERN.test(boundary);
  if (!valid) throw new MultipartBoundaryError(boundary);
}

// Escapes a quote/backslash so it cannot break the quoted-string grammar, and strips CR/LF outright so
// they can never break the header framing (HTTP-51).
function quoteParam(value: string): string {
  return value.replace(/[\\"]/g, (ch) => `\\${ch}`).replace(/[\r\n]/g, '');
}

// The shared framing routine HTTP-51 requires: both computeContentLength and writeTo call this for every
// part, so the declared length and the written bytes cannot drift.
function renderPartHeader(part: MultipartPart, boundary: string): Uint8Array {
  let header = `--${boundary}\r\n`;
  header += `Content-Disposition: form-data; name="${quoteParam(part.name)}"`;
  if (part.filename !== undefined) header += `; filename="${quoteParam(part.filename)}"`;
  header += '\r\n';
  if (part.body.mediaType !== null) header += `Content-Type: ${part.body.mediaType}\r\n`;
  header += '\r\n';
  return new TextEncoder().encode(header);
}

function trailerBytes(boundary: string): Uint8Array {
  return new TextEncoder().encode(`--${boundary}--\r\n`);
}

function computeContentLength(parts: readonly MultipartPart[], boundary: string): number {
  let total = 0;
  for (const part of parts) {
    if (part.body.contentLength === -1) return -1; // BODY-2: any unknown part collapses the whole
    total += renderPartHeader(part, boundary).length + part.body.contentLength + CRLF.length;
  }
  return total + trailerBytes(boundary).length;
}

// Wraps a locked writer as a WritableStream whose close() does not close the real sink -- multiple parts
// share one underlying writer, and only the outer writeTo's own finally block closes it.
function nonClosingSink(writer: WritableStreamDefaultWriter<Uint8Array>): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: async (chunk) => {
      await writer.write(chunk);
    },
  });
}

/**
 * A composite body (BODY-2, HTTP-51). Replayable iff every part is; declared length collapses to unknown
 * if any part's length is unknown. Boundary generated via Web Crypto (portable) unless the caller
 * supplies one, validated against RFC 2046's grammar.
 */
export class MultipartBody implements Body {
  readonly kind = 'multipart' as const;
  readonly mediaType: string;
  readonly contentLength: number;
  readonly replayable: boolean;
  readonly #parts: readonly MultipartPart[];
  readonly #boundary: string;

  constructor(parts: readonly MultipartPart[], boundary?: string) {
    if (boundary !== undefined) validateBoundary(boundary);
    this.#boundary = boundary ?? generateBoundary();
    this.#parts = parts;
    this.mediaType = `multipart/form-data; boundary=${this.#boundary}`;
    this.replayable = parts.every((part) => part.body.replayable);
    this.contentLength = computeContentLength(parts, this.#boundary);
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    const writer = sink.getWriter();
    try {
      for (const part of this.#parts) {
        await writer.write(renderPartHeader(part, this.#boundary));
        await part.body.writeTo(nonClosingSink(writer));
        await writer.write(CRLF);
      }
      await writer.write(trailerBytes(this.#boundary));
    } finally {
      await writer.close();
    }
  }
}

export function multipartBody(parts: readonly MultipartPart[], boundary?: string): MultipartBody {
  return new MultipartBody(parts, boundary);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/multipart-body.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/multipart-body.ts packages/core/src/body/multipart-body.test.ts
git commit -m "feat(core): add MultipartBody (BODY-2, HTTP-51)"
```

---

### Task 7: Retrofit — `Request`'s real body type

**Files:**
- Modify: `packages/core/src/http/request.ts`
- Modify: `packages/core/src/http/request.test.ts`

**Interfaces:**
- Consumes: `Body` (Task 2, type-only), `stringBody` (Task 3, tests only).
- Produces: `Request.body: Body | undefined` (was `unknown`). `Request.equals` unchanged (still reference
  equality on `#body`). Task 8 does not depend on this task.

- [ ] **Step 1: Write the failing test — replace the placeholder body values**

In `packages/core/src/http/request.test.ts`, add the import and replace every `.body('x')` call with
`.body(stringBody('x'))`:

```typescript
import {stringBody} from '../body/simple-bodies.js';
```

```typescript
describe('method/body legality (HTTP-7)', () => {
  test('rejects a body on GET, HEAD, TRACE, CONNECT', () => {
    for (const method of ['GET', 'HEAD', 'TRACE', 'CONNECT'] as const) {
      expect(() => Request.newBuilder().method(method).url('https://example.com').body(stringBody('x')).build())
        .toThrow(RequestBodyNotAllowedError);
    }
  });

  test('accepts a body on POST/PUT/DELETE/PATCH/OPTIONS', () => {
    expect(() =>
      Request.newBuilder().method('POST').url('https://example.com').body(stringBody('x')).build(),
    ).not.toThrow();
  });

  test('clearing the body succeeds even on a body-forbidden method', () => {
    const request = Request.newBuilder()
      .method('GET')
      .url('https://example.com')
      .body(stringBody('x'))
      .body(undefined)
      .build();
    expect(request.body).toBeUndefined();
  });
});

describe('method defaulting (HTTP-8)', () => {
  test('defaults to GET when neither method nor body is set', () => {
    const request = Request.newBuilder().url('https://example.com').build();
    expect(request.method).toBe('GET');
  });

  test('fails naming the missing method when a body is set with no method', () => {
    expect(() => Request.newBuilder().url('https://example.com').body(stringBody('x')).build()).toThrow(
      'method is required',
    );
  });
});
```

The remaining `describe` blocks (`required fields`, `URL equality`, `malformed URL`, `newBuilder derivation`) are
unchanged — none of them touch `body`.

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/request.test.ts`
Expected: FAIL — a type error (`.body('x')` no longer matches once Step 3 lands) or, before Step 3, an unused
import warning; run this after Step 3 in practice since TypeScript checks the whole file. Proceed to Step 3.

- [ ] **Step 3: Retrofit `request.ts`**

```typescript
import type {Body} from '../body/body.js';
```

Change `#body`, the constructor parameter, the `body` getter, and `RequestBuilder`'s field/method from `unknown`
to `Body | undefined`:

```typescript
export class Request {
  readonly #method: Method;
  readonly #url: URL;
  readonly #headers: Headers;
  readonly #body: Body | undefined;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  constructor(method: Method, url: URL, headers: Headers, body: Body | undefined) {
    this.#method = method;
    this.#url = url;
    this.#headers = headers;
    this.#body = body;
    Object.freeze(this);
  }

  // ... static newBuilder / newBuilder / method / url / headers getters unchanged ...

  get body(): Body | undefined {
    return this.#body;
  }

  equals(other: Request): boolean {
    return (
      this.#method === other.#method &&
      this.#url.href === other.#url.href &&
      this.#headers.equals(other.#headers) &&
      this.#body === other.#body
    );
  }
}

export class RequestBuilder implements Builder<Request> {
  #method: Method | undefined;
  #url: URL | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: Body | undefined;

  // ... method/url/headers setters unchanged ...

  body(body: Body | undefined): this {
    this.#body = body;
    return this;
  }

  // ... build() unchanged ...
}
```

Every other line in the file (imports of `Method`/`Headers`/errors, `build()`'s logic) is unchanged.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/request.test.ts`
Expected: PASS — `12 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/request.ts packages/core/src/http/request.test.ts
git commit -m "refactor(core): Request.body is now the real Body type, not unknown"
```

---

### Task 8: Retrofit — `Response`'s real body, `text()`/`bytes()`/`close()`

**Files:**
- Modify: `packages/core/src/http/response.ts`
- Modify: `packages/core/src/http/response.test.ts`

**Interfaces:**
- Consumes: `MediaType` (`./media-type.js`, Phase 1).
- Produces: `Response.body: ReadableStream<Uint8Array> | null` (was `unknown`), `Response.bytes(): Promise<Uint8Array>`,
  `Response.text(): Promise<string>`, `Response.close(): Promise<void>`, `Response[Symbol.asyncDispose]():
  Promise<void>`. **Deliberate asymmetry with Task 7:** `Request.body` uses `Body | undefined` (matching Phase
  1's existing "absent = undefined" convention everywhere else in the domain model); `Response.body` uses
  `ReadableStream<Uint8Array> | null` (matching the WHATWG `fetch` `Response.body` convention this design
  deliberately mirrors). Not an inconsistency to "fix."

- [ ] **Step 1: Write the failing test**

Replace `packages/core/src/http/response.test.ts` in full:

```typescript
// packages/core/src/http/response.test.ts
// Exercises: HTTP-6 (required fields), HTTP-41/BODY-14 (single-use body, same reference on repeat
// access), HTTP-41/BODY-15, HTTP-43 (idempotent close, releases the connection whether or not the body
// was read), HTTP-16-body/BODY-16 (convenience readers close in a finally-style guarantee), HTTP-42
// (charset default and UTF-8 fallback)
import {describe, expect, test} from 'bun:test';
import {Headers} from './headers.js';
import {Protocol} from './protocol.js';
import {Request} from './request.js';
import {Response} from './response.js';
import {Status} from './status.js';

function baseRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function readableOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function baseResponse(
  body: ReadableStream<Uint8Array> | null = null,
  headers: Headers = Headers.newBuilder().build(),
): Response {
  return Response.newBuilder()
    .request(baseRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .headers(headers)
    .body(body)
    .build();
}

describe('required fields', () => {
  test('throws naming request when missing', () => {
    expect(() => Response.newBuilder().protocol(Protocol.HTTP_1_1).status(Status.of(200)).build()).toThrow(
      'request is required',
    );
  });

  test('throws naming protocol when missing', () => {
    expect(() => Response.newBuilder().request(baseRequest()).status(Status.of(200)).build()).toThrow(
      'protocol is required',
    );
  });

  test('throws naming status when missing', () => {
    expect(() => Response.newBuilder().request(baseRequest()).protocol(Protocol.HTTP_1_1).build()).toThrow(
      'status is required',
    );
  });
});

describe('construction', () => {
  test('carries the originating request, protocol, status, headers, and an optional reason phrase', () => {
    const request = baseRequest();
    const response = Response.newBuilder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .reasonPhrase('OK')
      .build();

    expect(response.request.equals(request)).toBe(true);
    expect(response.protocol.equals(Protocol.HTTP_1_1)).toBe(true);
    expect(response.status.equals(Status.of(200))).toBe(true);
    expect(response.reasonPhrase).toBe('OK');
  });

  test('reason phrase is optional, body defaults to null', () => {
    const response = Response.newBuilder()
      .request(baseRequest())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(204))
      .build();
    expect(response.reasonPhrase).toBeUndefined();
    expect(response.body).toBeNull();
  });
});

describe('newBuilder derivation', () => {
  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = baseResponse();
    original.newBuilder().status(Status.of(500)).build();
    expect(original.status.code).toBe(200);
  });
});

describe('body (HTTP-41/BODY-14)', () => {
  test('repeated access returns the same reference, not a replay', () => {
    const stream = readableOf('x');
    const response = baseResponse(stream);
    expect(response.body).toBe(stream);
    expect(response.body).toBe(response.body);
  });
});

describe('bytes/text (BODY-16, HTTP-42)', () => {
  test('bytes() reads the whole body', async () => {
    const response = baseResponse(readableOf('hello'));
    expect(new TextDecoder().decode(await response.bytes())).toBe('hello');
  });

  test('bytes() on a null body returns empty', async () => {
    expect(await baseResponse(null).bytes()).toEqual(new Uint8Array(0));
  });

  test('text() defaults to UTF-8 when no content-type is declared', async () => {
    expect(await baseResponse(readableOf('héllo')).text()).toBe('héllo');
  });

  test('text() uses the declared charset', async () => {
    const bytes = Uint8Array.from([0x68, 0xe9]); // "hé" in ISO-8859-1
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        c.enqueue(bytes);
        c.close();
      },
    });
    const headers = Headers.newBuilder().add('content-type', 'text/plain;charset=iso-8859-1').build();
    expect(await baseResponse(stream, headers).text()).toBe('hé');
  });

  test('text() falls back to UTF-8 when the declared charset is unrecognized', async () => {
    const headers = Headers.newBuilder().add('content-type', 'text/plain;charset=bogus-charset').build();
    expect(await baseResponse(readableOf('ok'), headers).text()).toBe('ok');
  });

  test('bytes() closes the response even though the read succeeded', async () => {
    const response = baseResponse(readableOf('x'));
    await response.bytes();
    await expect(response.close()).resolves.toBeUndefined(); // idempotent, already closed
  });
});

describe('close (HTTP-41/BODY-15, HTTP-43)', () => {
  test('is idempotent', async () => {
    const response = baseResponse(readableOf('x'));
    await response.close();
    await response.close();
  });

  test('releases the connection even when the body was never read', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    await baseResponse(stream).close();
    expect(cancelled).toBe(true);
  });

  test('[Symbol.asyncDispose] delegates to close()', async () => {
    const response = baseResponse(readableOf('x'));
    await response[Symbol.asyncDispose]();
    await expect(response.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/response.test.ts`
Expected: FAIL — type errors against the still-`unknown`-typed `body`, and missing `bytes`/`text`/`close`/
`Symbol.asyncDispose` members.

- [ ] **Step 3: Rewrite `response.ts`**

```typescript
// packages/core/src/http/response.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import type {Headers} from './headers.js';
import {MediaType} from './media-type.js';
import type {Protocol} from './protocol.js';
import type {Request} from './request.js';
import type {Status} from './status.js';

export class Response {
  readonly #request: Request;
  readonly #protocol: Protocol;
  readonly #status: Status;
  readonly #reasonPhrase: string | undefined;
  readonly #headers: Headers;
  readonly #body: ReadableStream<Uint8Array> | null;
  // Not `readonly` -- Object.freeze(this) below only freezes normal properties, never #private fields,
  // so this can still track close state after construction (BODY-15, HTTP-43).
  #closed = false;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  constructor(
    request: Request,
    protocol: Protocol,
    status: Status,
    reasonPhrase: string | undefined,
    headers: Headers,
    body: ReadableStream<Uint8Array> | null,
  ) {
    this.#request = request;
    this.#protocol = protocol;
    this.#status = status;
    this.#reasonPhrase = reasonPhrase;
    this.#headers = headers;
    this.#body = body;
    Object.freeze(this);
  }

  static newBuilder(): ResponseBuilder {
    return new ResponseBuilder();
  }

  newBuilder(): ResponseBuilder {
    return new ResponseBuilder()
      .request(this.#request)
      .protocol(this.#protocol)
      .status(this.#status)
      .reasonPhrase(this.#reasonPhrase)
      .headers(this.#headers)
      .body(this.#body);
  }

  get request(): Request {
    return this.#request;
  }

  get protocol(): Protocol {
    return this.#protocol;
  }

  get status(): Status {
    return this.#status;
  }

  get reasonPhrase(): string | undefined {
    return this.#reasonPhrase;
  }

  get headers(): Headers {
    return this.#headers;
  }

  /** Single-use (BODY-14) -- the same reference every call, never a replay. */
  get body(): ReadableStream<Uint8Array> | null {
    return this.#body;
  }

  /** Reads the whole body as bytes, closing the response whether or not the read succeeds (BODY-16). */
  async bytes(): Promise<Uint8Array> {
    if (this.#body === null) {
      await this.close();
      return new Uint8Array(0);
    }
    const reader = this.#body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    } finally {
      await this.close();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  /** Reads the whole body as text, defaulting to the media type's charset then UTF-8 (HTTP-42). */
  async text(): Promise<string> {
    const bytes = await this.bytes();
    try {
      return new TextDecoder(this.#charset()).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // HTTP-42: unrecognized charset also falls back
    }
  }

  #charset(): string {
    const contentType = this.#headers.get('content-type');
    if (contentType === undefined) return 'utf-8';
    try {
      return MediaType.parse(contentType).charset ?? 'utf-8';
    } catch {
      return 'utf-8';
    }
  }

  /** Idempotent; releases the underlying connection whether or not the body was read (BODY-15, HTTP-43). */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#body?.cancel();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

export class ResponseBuilder implements Builder<Response> {
  #request: Request | undefined;
  #protocol: Protocol | undefined;
  #status: Status | undefined;
  #reasonPhrase: string | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: ReadableStream<Uint8Array> | null = null;

  request(request: Request): this {
    this.#request = request;
    return this;
  }

  protocol(protocol: Protocol): this {
    this.#protocol = protocol;
    return this;
  }

  status(status: Status): this {
    this.#status = status;
    return this;
  }

  reasonPhrase(reasonPhrase: string | undefined): this {
    this.#reasonPhrase = reasonPhrase;
    return this;
  }

  headers(headers: Headers): this {
    this.#headers = headers;
    return this;
  }

  body(body: ReadableStream<Uint8Array> | null): this {
    this.#body = body;
    return this;
  }

  build(): Response {
    const request = requireField(this.#request, 'request');
    const protocol = requireField(this.#protocol, 'protocol');
    const status = requireField(this.#status, 'status');
    return new Response(request, protocol, status, this.#reasonPhrase, this.#headers, this.#body);
  }
}
```

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/response.test.ts`
Expected: PASS — `16 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/response.ts packages/core/src/http/response.test.ts
git commit -m "feat(core): Response gets a real body, text()/bytes()/close() (BODY-14..16, HTTP-42/43)"
```

---

### Task 9: `body/typed-response.ts` — `TypedResponse<T>`

**Files:**
- Create: `packages/core/src/body/typed-response.ts`
- Create: `packages/core/src/body/typed-response.test.ts`

**Interfaces:**
- Consumes: `Response` (`../http/response.js`, Task 8), `Headers`/`Request`/`Status` (type-only, `../http/*.js`).
- Produces: `class TypedResponse<T>` with `status`, `headers`, `protocol: string`, `reason: string | null`,
  `request`, `value(): Promise<T>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/typed-response.test.ts
// Exercises: HTTP-44 (raw fields without touching the body, parse-once memoized including failure),
// HTTP-45 (concurrent first callers serialized to one parse run)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {TypedResponse} from './typed-response.js';

function readableOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

function baseResponse(body: ReadableStream<Uint8Array> | null = null): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .reasonPhrase('OK')
    .body(body)
    .build();
}

describe('TypedResponse', () => {
  test('exposes raw fields without touching the body', () => {
    const response = baseResponse(readableOf('untouched'));
    const typed = new TypedResponse(response, async (r) => r.text());
    expect(typed.status.code).toBe(200);
    expect(typed.protocol).toBe('http/1.1');
    expect(typed.reason).toBe('OK');
    expect(response.body?.locked).toBe(false);
  });

  test('parses on first value() call and memoizes the result', async () => {
    let calls = 0;
    const typed = new TypedResponse(baseResponse(readableOf('x')), async () => {
      calls += 1;
      return 'parsed';
    });
    expect(await typed.value()).toBe('parsed');
    expect(await typed.value()).toBe('parsed');
    expect(calls).toBe(1);
  });

  test('memoizes a thrown failure -- every later call re-throws the same error, parse never re-runs', async () => {
    let calls = 0;
    const failure = new Error('parse failed');
    const typed = new TypedResponse(baseResponse(readableOf('x')), async () => {
      calls += 1;
      throw failure;
    });
    await expect(typed.value()).rejects.toBe(failure);
    await expect(typed.value()).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  test('concurrent first callers share one in-flight parse (HTTP-45)', async () => {
    let calls = 0;
    const typed = new TypedResponse(baseResponse(readableOf('x')), async () => {
      calls += 1;
      await Promise.resolve();
      return 'value';
    });
    const [a, b] = await Promise.all([typed.value(), typed.value()]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/typed-response.test.ts`
Expected: FAIL — `Cannot find module './typed-response.js'`.

- [ ] **Step 3: Write `typed-response.ts`**

```typescript
// packages/core/src/body/typed-response.ts
import type {Headers} from '../http/headers.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {Status} from '../http/status.js';

/**
 * A lazy typed-response wrapper (HTTP-44/45). Exposes raw fields without touching the body; parses `T` at
 * most once on first `value()` call, memoizing success or thrown failure so every later call returns or
 * re-throws the same outcome without re-running `parse` or re-reading the single-use body.
 */
export class TypedResponse<T> {
  readonly status: Status;
  readonly headers: Headers;
  readonly protocol: string;
  readonly reason: string | null;
  readonly request: Request;
  readonly #response: Response;
  readonly #parse: (response: Response) => Promise<T>;
  #inFlight: Promise<T> | undefined;

  constructor(response: Response, parse: (response: Response) => Promise<T>) {
    this.#response = response;
    this.#parse = parse;
    this.status = response.status;
    this.headers = response.headers;
    this.protocol = response.protocol.token;
    this.reason = response.reasonPhrase ?? null;
    this.request = response.request;
  }

  /**
   * Parses on first call; every later call, including a concurrent overlapping one, awaits the same
   * in-flight promise rather than re-running `parse` (HTTP-45). The promise is cached before the first
   * `await`, so two calls issued in the same synchronous turn already share it.
   */
  value(): Promise<T> {
    this.#inFlight ??= this.#parse(this.#response);
    return this.#inFlight;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/typed-response.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/typed-response.ts packages/core/src/body/typed-response.test.ts
git commit -m "feat(core): add TypedResponse<T> (HTTP-44, HTTP-45)"
```

---

### Task 10: `body/request-body-logging.ts` — `withRequestLogging`

**Files:**
- Create: `packages/core/src/body/request-body-logging.ts`
- Create: `packages/core/src/body/request-body-logging.test.ts`

**Interfaces:**
- Consumes: `ByteQueue` (`../io/byte-queue.js`, Phase 3a), `Body` (Task 2), `materialize` (Task 5).
- Produces: `interface LoggedBody extends Body {snapshot(), materialize()}`, `function
  withRequestLogging(delegate, tapCapBytes): LoggedBody`. `@internal` — not exported from
  `packages/core/src/index.ts` (Task 13).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/request-body-logging.test.ts
// Exercises: BODY-17 (mirror + forward the full untruncated payload), BODY-18 (tap clears at the start
// of every write), BODY-19 (tap cap, full payload unaffected), BODY-20 (partial-failure snapshot), BODY-21
// (replayable/materialize pass through, preserving the tap), BODY-37 (no backing-buffer escape hatch)
import {describe, expect, test} from 'bun:test';
import {withRequestLogging} from './request-body-logging.js';
import {byteArrayBody} from './simple-bodies.js';
import {streamBody} from './stream-body.js';

function collectingSink(): {sink: WritableStream<Uint8Array>; written: () => Uint8Array} {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({write: (c) => void chunks.push(c)});
  return {
    sink,
    written: () => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
  };
}

describe('withRequestLogging', () => {
  test('forwards the full payload untruncated regardless of the tap cap (BODY-17, BODY-19)', async () => {
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([1, 2, 3, 4, 5])), 2);
    const {sink, written} = collectingSink();
    await logged.writeTo(sink);
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
    expect([...logged.snapshot()]).toEqual([1, 2]);
  });

  test('the tap clears at the start of every write (BODY-18)', async () => {
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([9, 9])), 10);
    await logged.writeTo(collectingSink().sink);
    await logged.writeTo(collectingSink().sink);
    expect([...logged.snapshot()]).toEqual([9, 9]); // not [9, 9, 9, 9]
  });

  test('a tap cap of 0 mirrors nothing while still forwarding everything', async () => {
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([1, 2])), 0);
    const {sink, written} = collectingSink();
    await logged.writeTo(sink);
    expect([...written()]).toEqual([1, 2]);
    expect(logged.snapshot().length).toBe(0);
  });

  test('a partial write failure still leaves the bytes mirrored up to that point (BODY-20)', async () => {
    const failing = new WritableStream<Uint8Array>({
      write: (_chunk, controller) => {
        controller.error(new Error('boom'));
      },
    });
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([1, 2, 3])), 10);
    await expect(logged.writeTo(failing)).rejects.toThrow();
    expect(logged.snapshot().length).toBeGreaterThan(0);
  });

  test('replayable passes through the delegate verbatim (BODY-21)', () => {
    expect(withRequestLogging(byteArrayBody(Uint8Array.from([1])), 10).replayable).toBe(true);
    const singleUse = withRequestLogging(streamBody(new ReadableStream({start: (c) => c.close()})), 10);
    expect(singleUse.replayable).toBe(false);
  });

  test('materialize() returns a still-logged, now-replayable wrapper preserving the tap (BODY-21)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([7, 7]));
        controller.close();
      },
    });
    const logged = withRequestLogging(streamBody(stream), 10);
    expect(logged.replayable).toBe(false);

    const materialized = await logged.materialize();
    expect(materialized.replayable).toBe(true);
    expect(typeof materialized.snapshot).toBe('function');

    const {sink, written} = collectingSink();
    await materialized.writeTo(sink);
    expect([...written()]).toEqual([7, 7]);
    expect([...materialized.snapshot()]).toEqual([7, 7]);
  });

  test('exposes no direct handle onto the tap buffer -- snapshot is the only read path (BODY-37)', () => {
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([1])), 10);
    expect(Object.keys(logged)).not.toContain('tap');
    expect(Object.keys(logged)).not.toContain('buffer');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/request-body-logging.test.ts`
Expected: FAIL — `Cannot find module './request-body-logging.js'`.

- [ ] **Step 3: Write `request-body-logging.ts`**

```typescript
// packages/core/src/body/request-body-logging.ts
import {ByteQueue} from '../io/byte-queue.js';
import type {Body} from './body.js';
import {materialize} from './materialize.js';

export interface LoggedBody extends Body {
  /** A copy of the tap's current contents -- at most tapCapBytes of the most recent write (BODY-19). */
  snapshot(): Uint8Array;
  /** Materializes the delegate while preserving the logging wrapper and the tap (BODY-21). */
  materialize(): Promise<LoggedBody>;
}

/**
 * Mirrors up to tapCapBytes of each writeTo call into an internal tap while forwarding the full,
 * untruncated payload to the primary sink (BODY-17). The tap clears at the start of every write so a
 * retry against a replayable delegate does not accumulate stale bytes (BODY-18). No handle onto the tap's
 * backing buffer is exposed -- snapshot() is the only way to read it (BODY-37). `@internal` -- unwired
 * until Phase 7 supplies a Logger to drive it.
 */
export function withRequestLogging(delegate: Body, tapCapBytes: number): LoggedBody {
  const tap = new ByteQueue();

  function wrap(inner: Body): LoggedBody {
    return {
      kind: inner.kind,
      mediaType: inner.mediaType,
      contentLength: inner.contentLength,
      get replayable() {
        return inner.replayable;
      },
      async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
        tap.clear(); // BODY-18
        const writer = sink.getWriter();
        const tapped = new WritableStream<Uint8Array>({
          write: async (chunk) => {
            if (tap.size < tapCapBytes) {
              const room = tapCapBytes - tap.size;
              tap.writeBytes(room >= chunk.length ? chunk : chunk.subarray(0, room));
            }
            await writer.write(chunk); // BODY-19: the full payload always reaches the primary
          },
          close: async () => {
            await writer.close();
          },
        });
        await inner.writeTo(tapped);
      },
      snapshot(): Uint8Array {
        return tap.snapshot();
      },
      materialize: async () => wrap(await materialize(inner)),
    };
  }

  return wrap(delegate);
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/request-body-logging.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/request-body-logging.ts packages/core/src/body/request-body-logging.test.ts
git commit -m "feat(core): add withRequestLogging tee (BODY-17..21, BODY-37)"
```

---

### Task 11: `body/response-body-logging.ts` — `withResponseLogging`

**Files:**
- Create: `packages/core/src/body/response-body-logging.ts`
- Create: `packages/core/src/body/response-body-logging.test.ts`

**Interfaces:**
- Consumes: `ByteQueue` (`../io/byte-queue.js`, Phase 3a).
- Produces: `interface LoggedResponseBody {read(), snapshot(), close(), [Symbol.asyncDispose]()}`, `function
  withResponseLogging(delegate, capBytes): LoggedResponseBody`. `@internal` — not exported from
  `packages/core/src/index.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/response-body-logging.test.ts
// Exercises: BODY-22 (lazy, drain-once), BODY-23 (fits-cap: full capture, repeatable non-consuming
// reads), BODY-24 (exceeds-cap: prefix+tail once, second read fails), BODY-27 (close-once shared guard),
// BODY-28 (captured buffer survives close)
import {describe, expect, test} from 'bun:test';
import {withResponseLogging} from './response-body-logging.js';

function readableOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('withResponseLogging', () => {
  test('nothing is captured until read() is called (BODY-22 laziness)', () => {
    expect(withResponseLogging(readableOf([1, 2, 3]), 100).snapshot().length).toBe(0);
  });

  test('fits-cap: fully captures, and every later read() is a fresh non-consuming view (BODY-23)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3]);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3]);
    expect([...logged.snapshot()]).toEqual([1, 2, 3]);
  });

  test('exceeds-cap: replays the prefix then the live tail, consumer receives the complete body (BODY-24)', async () => {
    const logged = withResponseLogging(readableOf([1, 2], [3, 4, 5]), 3);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3, 4, 5]);
    expect([...logged.snapshot()]).toEqual([1, 2, 3]); // only the prefix up to the cap is retained
  });

  test('exceeds-cap: a second read() throws (BODY-24)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3, 4]), 1);
    await logged.read();
    await expect(logged.read()).rejects.toThrow();
  });

  test('close is idempotent and shared across the wrapper close and tail completion (BODY-27)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    await readAll(await logged.read());
    await logged.close();
    await logged.close();
  });

  test('the captured buffer survives close -- snapshot still works after (BODY-28)', async () => {
    const logged = withResponseLogging(readableOf([1, 2]), 100);
    await readAll(await logged.read());
    await logged.close();
    expect([...logged.snapshot()]).toEqual([1, 2]);
  });

  test('[Symbol.asyncDispose] delegates to close()', async () => {
    await withResponseLogging(readableOf([1]), 100)[Symbol.asyncDispose]();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/response-body-logging.test.ts`
Expected: FAIL — `Cannot find module './response-body-logging.js'`.

- [ ] **Step 3: Write `response-body-logging.ts`**

```typescript
// packages/core/src/body/response-body-logging.ts
import {ByteQueue} from '../io/byte-queue.js';

export interface LoggedResponseBody {
  /**
   * Returns a stream serving the body. Lazy -- nothing is read from the delegate until the first call
   * (BODY-22). Fits-cap regime: every call, including calls after the first, returns a fresh
   * non-consuming view over the captured bytes (BODY-23). Exceeds-cap regime: exactly one call is
   * allowed; a second throws (BODY-24).
   */
  read(): Promise<ReadableStream<Uint8Array>>;
  /** Non-consuming; reflects whatever has been captured so far. */
  snapshot(): Uint8Array;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Wraps a raw response body stream (BODY-22..29). `@internal` -- unwired until Phase 7 supplies a Logger.
 */
export function withResponseLogging(delegate: ReadableStream<Uint8Array>, capBytes: number): LoggedResponseBody {
  const captured = new ByteQueue();
  let regime: 'undrained' | 'fits' | 'exceeds' = 'undrained';
  let exceedsRegimeConsumed = false;
  let pendingTailChunk: Uint8Array | undefined;
  let closed = false;
  let drainStarted: Promise<void> | undefined;
  const reader = delegate.getReader();

  async function closeDelegate(): Promise<void> {
    if (closed) return;
    closed = true;
    try {
      reader.releaseLock();
    } catch {
      // already released by a completed read loop
    }
    await delegate.cancel().catch(() => {}); // BODY-28: a close failure must not be reported as a drain error
  }

  async function drainOnce(): Promise<void> {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) {
        regime = 'fits';
        await closeDelegate();
        return;
      }
      if (captured.size + value.length <= capBytes) {
        captured.writeBytes(value);
        continue;
      }
      const room = capBytes - captured.size;
      if (room > 0) captured.writeBytes(value.subarray(0, room));
      pendingTailChunk = value.subarray(room);
      regime = 'exceeds';
      return;
    }
  }

  function drain(): Promise<void> {
    drainStarted ??= drainOnce();
    return drainStarted;
  }

  function tailStream(): ReadableStream<Uint8Array> {
    const prefix = captured.snapshot();
    const firstTailChunk = pendingTailChunk;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        if (prefix.length > 0) controller.enqueue(prefix);
        if (firstTailChunk !== undefined && firstTailChunk.length > 0) controller.enqueue(firstTailChunk);
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        await closeDelegate();
        controller.close();
      },
    });
  }

  return {
    async read(): Promise<ReadableStream<Uint8Array>> {
      await drain();
      if (regime === 'fits') {
        const bytes = captured.snapshot();
        return new ReadableStream<Uint8Array>({
          start(controller) {
            if (bytes.length > 0) controller.enqueue(bytes);
            controller.close();
          },
        });
      }
      if (exceedsRegimeConsumed) {
        throw new Error('response body already consumed past the buffered prefix (BODY-24)');
      }
      exceedsRegimeConsumed = true;
      return tailStream();
    },
    snapshot(): Uint8Array {
      return captured.snapshot();
    },
    close: closeDelegate,
    [Symbol.asyncDispose]: closeDelegate,
  };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/response-body-logging.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/response-body-logging.ts packages/core/src/body/response-body-logging.test.ts
git commit -m "feat(core): add withResponseLogging, two-regime response body wrapper (BODY-22..29)"
```

---

### Task 12: `body/http-status-error.ts` — `HttpStatusError`, `toHttpError`

**Files:**
- Create: `packages/core/src/body/http-status-error.ts`
- Create: `packages/core/src/body/http-status-error.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` (`../http/errors.js`), `Response` (`../http/response.js`, Task 8), `Body` (Task 2,
  type-only), `byteArrayBody` (Task 3).
- Produces: `class HttpStatusError extends DexpaceError` with `status`, `body(): Body | undefined`,
  `preview(charset?): string | null`; `function toHttpError(response): Promise<HttpStatusError | null>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/http-status-error.test.ts
// Exercises: HTTP-52/BODY-30 (1 MiB cap, replayable re-serve, buffered inside close-guaranteeing scope),
// BODY-31 (4xx/5xx only, no-body response returned unchanged), BODY-33 (non-consuming preview)
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {toHttpError} from './http-status-error.js';

function readableOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (c) => {
      c.enqueue(bytes);
      c.close();
    },
  });
}

function responseWith(
  status: number,
  body: ReadableStream<Uint8Array> | null,
  headers: Headers = Headers.newBuilder().build(),
): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(headers)
    .body(body)
    .build();
}

describe('toHttpError (BODY-31)', () => {
  test('returns null for a non-error response', async () => {
    expect(await toHttpError(responseWith(200, null))).toBeNull();
    expect(await toHttpError(responseWith(304, null))).toBeNull();
  });

  test('returns an HttpStatusError for 4xx and 5xx', async () => {
    expect(await toHttpError(responseWith(404, null))).not.toBeNull();
    expect(await toHttpError(responseWith(500, null))).not.toBeNull();
  });
});

describe('HttpStatusError (HTTP-52/BODY-30)', () => {
  test('carries the status', async () => {
    expect((await toHttpError(responseWith(404, null)))?.status).toBe(404);
  });

  test('buffers the body and re-serves it as a replayable, independently readable Body', async () => {
    const bytes = new TextEncoder().encode('not found');
    const error = await toHttpError(responseWith(404, readableOf(bytes)));
    const body = error?.body();
    expect(body?.replayable).toBe(true);

    const chunks: Uint8Array[] = [];
    await body?.writeTo(new WritableStream({write: (c) => void chunks.push(c)}));
    expect(new TextDecoder().decode(chunks[0])).toBe('not found');

    const chunksAgain: Uint8Array[] = [];
    await error?.body()?.writeTo(new WritableStream({write: (c) => void chunksAgain.push(c)}));
    expect(new TextDecoder().decode(chunksAgain[0])).toBe('not found');
  });

  test('drops bytes beyond the 1 MiB cap but still drains and closes the connection', async () => {
    const big = new Uint8Array(2 * 1024 * 1024).fill(65);
    const error = await toHttpError(responseWith(500, readableOf(big)));
    expect(error?.body()?.contentLength).toBe(1024 * 1024);
  });

  test('when the response has no body, the error carries an undefined body and null preview (BODY-31)', async () => {
    const error = await toHttpError(responseWith(500, null));
    expect(error?.body()).toBeUndefined();
    expect(error?.preview()).toBeNull();
  });

  test('preview is non-consuming and repeatable (BODY-33)', async () => {
    const error = await toHttpError(responseWith(500, readableOf(new TextEncoder().encode('boom'))));
    expect(error?.preview()).toBe('boom');
    expect(error?.preview()).toBe('boom');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/body/http-status-error.test.ts`
Expected: FAIL — `Cannot find module './http-status-error.js'`.

- [ ] **Step 3: Write `http-status-error.ts`**

```typescript
// packages/core/src/body/http-status-error.ts
import {DexpaceError} from '../http/errors.js';
import type {Response} from '../http/response.js';
import type {Body} from './body.js';
import {byteArrayBody} from './simple-bodies.js';

const ERROR_BODY_CAP_BYTES = 1024 * 1024; // 1 MiB, HTTP-52/BODY-30 -- fixed, not configurable

/** A 4xx/5xx response turned into an exception (HTTP-52/BODY-30, BODY-31). */
export class HttpStatusError extends DexpaceError {
  readonly status: number;
  readonly #bodyBytes: Uint8Array | undefined;
  readonly #mediaType: string | null;

  constructor(status: number, bodyBytes: Uint8Array | undefined, mediaType: string | null, options?: ErrorOptions) {
    super(`HTTP ${status}`, options);
    this.status = status;
    this.#bodyBytes = bodyBytes;
    this.#mediaType = mediaType;
  }

  /**
   * The buffered error body, re-served as a replayable Body -- readable independently and repeatably
   * after the transport connection was released (BODY-30). Undefined when there was no body.
   */
  body(): Body | undefined {
    return this.#bodyBytes === undefined ? undefined : byteArrayBody(this.#bodyBytes, this.#mediaType);
  }

  /** Non-consuming preview from the buffered copy (BODY-33). Null for no body. */
  preview(charset = 'utf-8'): string | null {
    if (this.#bodyBytes === undefined) return null;
    return new TextDecoder(charset).decode(this.#bodyBytes);
  }
}

/**
 * Turns a 4xx/5xx response into an HttpStatusError, buffering at most 1 MiB of the body inside the
 * response's own close-guaranteeing scope (HTTP-52/BODY-30). Returns null for a non-error response
 * (BODY-31) -- the caller keeps the response, body intact.
 */
export async function toHttpError(response: Response): Promise<HttpStatusError | null> {
  if (response.status.code < 400) return null;
  const mediaType = response.headers.get('content-type') ?? null;
  try {
    if (response.body === null) return new HttpStatusError(response.status.code, undefined, mediaType);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (total >= ERROR_BODY_CAP_BYTES) continue; // keep draining to release the connection; drop the bytes
      const room = ERROR_BODY_CAP_BYTES - total;
      const piece = value.length > room ? value.subarray(0, room) : value;
      chunks.push(piece);
      total += piece.length;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new HttpStatusError(response.status.code, bytes, mediaType);
  } finally {
    await response.close();
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/body/http-status-error.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/http-status-error.ts packages/core/src/body/http-status-error.test.ts
git commit -m "feat(core): add HttpStatusError, toHttpError (HTTP-52, BODY-30, BODY-31, BODY-33)"
```

---

### Task 13: Internal barrel, public barrel, and full gate verification

**Files:**
- Create: `packages/core/src/body/index.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: every preceding task.
- Produces: `packages/core/src/body/index.ts` (internal-facing, includes the two logging tees), and the
  promotion of `Body`, its variants/factories, `MultipartPart`, `materialize`, `TypedResponse`, `HttpStatusError`/
  `toHttpError`, `ConsumedBodyError`/`MultipartBoundaryError`/`isBodyError` into `packages/core/src/index.ts`.

- [ ] **Step 1: Write `body/index.ts`**

```typescript
// packages/core/src/body/index.ts
// Internal-facing barrel for product-spec §6. Everything except the two logging tees is also promoted to
// packages/core/src/index.ts (Step 2) -- this file is the superset a future in-tree consumer (e.g. Phase
// 7's pipeline) imports from directly.
export type {Body} from './body.js';
export {ConsumedBodyError, isBodyError, MultipartBoundaryError} from './errors.js';
export {HttpStatusError, toHttpError} from './http-status-error.js';
export {materialize} from './materialize.js';
export {multipartBody, MultipartBody, type MultipartPart} from './multipart-body.js';
export {withRequestLogging, type LoggedBody} from './request-body-logging.js';
export {withResponseLogging, type LoggedResponseBody} from './response-body-logging.js';
export {
  byteArrayBody,
  ByteArrayBody,
  formUrlEncodedBody,
  FormUrlEncodedBody,
  stringBody,
  StringBody,
} from './simple-bodies.js';
export {streamBody, StreamBody} from './stream-body.js';
export {TypedResponse} from './typed-response.js';
```

- [ ] **Step 2: Promote the public surface**

Append to `packages/core/src/index.ts` (after Phase 2's seam exports, which stay unchanged):

```typescript
// Deliberately NOT `export * from './body/index.js';` — that barrel also carries withRequestLogging/
// withResponseLogging, internal until Phase 7 supplies a Logger to drive them. Naming each public export
// here instead keeps that boundary enforced at the barrel, not by convention.
export type {Body} from './body/body.js';
export {ConsumedBodyError, isBodyError, MultipartBoundaryError} from './body/errors.js';
export {HttpStatusError, toHttpError} from './body/http-status-error.js';
export {materialize} from './body/materialize.js';
export {multipartBody, MultipartBody, type MultipartPart} from './body/multipart-body.js';
export {
  byteArrayBody,
  ByteArrayBody,
  formUrlEncodedBody,
  FormUrlEncodedBody,
  stringBody,
  StringBody,
} from './body/simple-bodies.js';
export {streamBody, StreamBody} from './body/stream-body.js';
export {TypedResponse} from './body/typed-response.js';
```

- [ ] **Step 3: Run the full gate sequence**

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

- [ ] **Step 4: Verify no `node:` import crept in**

```bash
! grep -rn "from 'node:" packages/core/src/
```

Expected: exit 0, no matches.

- [ ] **Step 5: Verify the public API surface changed, and only as expected**

```bash
cd packages/core && bun run api
git diff packages/core/etc/core.api.md
```

Expected: a **non-empty** diff (unlike Phase 3a's byte-identical gate) — hand-confirm it adds exactly: `Body`,
`ByteArrayBody`/`byteArrayBody`, `StringBody`/`stringBody`, `FormUrlEncodedBody`/`formUrlEncodedBody`,
`StreamBody`/`streamBody`, `MultipartBody`/`multipartBody`/`MultipartPart`, `materialize`, `TypedResponse`,
`HttpStatusError`/`toHttpError`, `ConsumedBodyError`/`MultipartBoundaryError`/`isBodyError`, and `Response`'s new
`bytes`/`text`/`close`/`[Symbol.asyncDispose]` members. Confirm it does **not** add anything from `src/io/` or
either logging tee.

- [ ] **Step 6: Add a changeset**

```bash
bun run changeset
```

Select `@dexpace/core`, choose **minor** (new public API, no breaking change — `Request.body`'s type narrowed
from `unknown` to `Body | undefined` and `Response.body`'s from `unknown` to `ReadableStream<Uint8Array> | null`
are not breaking for any real caller, since `unknown` accepted nothing usable before), summary:
`Add the request/response body model: Body variants, materialize(), TypedResponse, HttpStatusError. Request.body
and Response.body are now real types instead of unknown.`

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/body/index.ts packages/core/src/index.ts packages/core/etc/core.api.md .changeset/
git commit -m "feat(core): promote the body-lifecycle public surface, verify full gate sequence"
```

---

## Self-Review

**Spec coverage** — every requirement ID from the design's disposition table, mapped to its task:

- `HTTP-36`/`BODY-1` → Task 2 (`Body` interface), Task 3 (simple bodies' concrete `writeTo`).
- `BODY-2`, `HTTP-51` → Task 6 (`MultipartBody`).
- `BODY-3`/`HTTP-37` → Task 4 (`StreamBody`'s guard), Task 5 (`materialize`).
- `BODY-8` → Task 4 (`StreamBody`'s TSDoc + `pipeTo`, which never cancels the source).
- `BODY-9` → Task 4, ledgered (always single-use, no mark/reset).
- `HTTP-39`/`BODY-10` → satisfied by `pipeTo`'s own exact-transfer semantics inside Task 4; no separate exact-copy
  primitive needed since Task 4 doesn't hand-roll a copy loop.
- `HTTP-38`/`BODY-35` → Task 3 (replayability by source, form encoding).
- `BODY-4`, `BODY-5` → contract-obligation-only, noted in the design's disposition table; no task builds
  consultation (Phase 5's job).
- `HTTP-41`/`BODY-14`, `BODY-15`, `HTTP-43` → Task 8 (`Response.body`, `close`).
- `HTTP-16-body`/`BODY-16` → Task 8 (`bytes`/`text`'s `finally`).
- `HTTP-42` → Task 8 (`#charset`, fallback in `text`).
- `HTTP-44`, `HTTP-45` → Task 9 (`TypedResponse`).
- `BODY-17`–`19`, `21`, `37` → Task 10.
- `BODY-20` → Task 10 (partial-failure snapshot test).
- `BODY-22`–`29` → Task 11.
- `HTTP-52`/`BODY-30`, `BODY-31` → Task 12.
- `BODY-32` → not separately tested as a standalone byte-capped-snapshot primitive; `toHttpError`'s own cap
  loop (Task 12) is the one byte-capped snapshot this phase builds, and its cap-clamping behavior (drop beyond
  cap, never over-allocate) is covered by the "drops bytes beyond the 1 MiB cap" test. No general-purpose
  snapshot utility is built standalone, so `BODY-32`'s negative-cap/capless-snapshot clauses don't apply to a
  primitive this phase ships.
- `BODY-33` → Task 12 (`preview`).
- `BODY-34` → satisfied by construction: `toHttpError`'s cap is fixed (not user-configurable, so nothing to
  desynchronize), and the two logging tees (Tasks 10, 11) each take their own `capBytes` parameter — Phase 7 is
  responsible for threading one shared value through all three when it wires a real `Logger`/config; this phase
  ships the parameter, not the wiring.
- Error-tree flattening (checkpoint retrofit) → Task 1.
- `Request`/`Response` real body types → Tasks 7, 8.
- `FileBody` → explicitly out of scope, logged in the roadmap.

**Placeholder scan:** no `TBD`/`TODO`, no "add appropriate error handling," no bare "write tests for the above."
Every step has real code. The one deliberately-partial item (`BODY-32`'s standalone-primitive clauses) is stated
as N/A with a reason, not silently dropped.

**Type consistency:** `Body`'s `kind` union (`'byte-array' | 'string' | 'stream' | 'form-urlencoded' |
'multipart'`) matches every variant's `readonly kind = '...' as const` across Tasks 3, 4, 6. `writeTo(sink:
WritableStream<Uint8Array>): Promise<void>` is identical across every `Body` implementer (Tasks 3, 4, 6) and every
wrapper (Task 10). `Response.body`'s type (`ReadableStream<Uint8Array> | null`) matches Task 9's `TypedResponse`
constructor parameter and Task 11/12's consumption of it. `materialize`'s return type (`Promise<Body>`) matches
Task 10's `LoggedBody.materialize()` return type (`Promise<LoggedBody>`, a narrowing — `LoggedBody extends Body`).
`ConsumedBodyError`/`MultipartBoundaryError` names match between Task 2's definition, Task 4/6's throw sites, and
Task 13's barrel exports.
