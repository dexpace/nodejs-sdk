# Phase 3a — I/O Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the byte-streaming primitives in `@dexpace/core` — `ByteQueue`, `RetentionWindow`,
`BufferedSource` (with peek/slice views), `BufferedSink`, `TeeSink`, `writeAll`, and the `IO-30` factories —
satisfying `product-spec/05-i-o-contracts.md` (`IO-1`–`IO-42`), per
`docs/superpowers/specs/2026-07-24-phase3a-io-contracts-design.md`.

**Architecture:** A new `packages/core/src/io/` folder, layered strictly one way:
`limits`/`errors` → `byte-queue` → `retention-window` → `buffered-source`/`buffered-sink` → `tee-sink`/`pump` →
`factories`. `ByteQueue` is a synchronous FIFO data structure (a linked list of `Uint8Array` chunks);
`BufferedSource`/`BufferedSink` are async classes over Web Streams readers/writers. **Nothing in this phase
enters the public package barrel** — every export is `@internal`, and `api-extractor`'s committed report must come
back byte-identical.

**Tech Stack:** TypeScript 5.8+, Web Streams (`ReadableStream`/`WritableStream`, already available via the `DOM`
lib entry Phase 2 added), `TextDecoder`/`TextEncoder`, `bun test` + `fast-check` for property tests, `mitata` for
one committed baseline bench. No new runtime dependencies — `SEAM-1` untouched.

**Prerequisite:** This plan assumes Phases 0, 1, and 2 are already implemented exactly as their own plans
specify. Concretely: `packages/core/src/http/*` and `packages/core/src/seams/*` exist,
`packages/core/src/http/errors.ts` exports `DexpaceError` as the taxonomy root, `packages/core/src/index.ts`
exports the Phase 1 + Phase 2 public surface, `tsconfig.base.json` has `"lib": ["ES2022", "DOM"]`, and the full
gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/`verify:dual-consumption`/
`verify:seam-1`/`audit`) plus the `node-floor-conformance` CI job are green on `main`.

## Global Constraints

- **Nothing from `src/io/` is exported from `packages/core/src/index.ts`.** Every file exports through
  `src/io/index.ts` for internal use only, and every exported symbol carries an `@internal` TSDoc tag. The
  mechanical check is that `packages/core/etc/core.api.md` is **byte-identical** before and after this phase
  (Task 13). Phase 3b decides what, if anything, gets promoted.
- **No new runtime dependencies.** `@dexpace/core`'s `dependencies` stays `{}` (`SEAM-1`). `mitata` is added to
  the workspace-root `devDependencies` only.
- **No `node:` imports anywhere in `src/io/`.** Core stays runtime-agnostic; `IO-16`'s "host-native byte-stream
  bridge" is `ReadableStream`/`WritableStream`, not `node:stream`. Node interop is the consumer's
  `Readable.fromWeb()` call, at their edge.
- **No `AbortSignal`, no timer, no timeout anywhere in `src/io/`.** `IO-40` (MUST) assigns deadlines to the
  transport that owns the socket. This deliberately overrides styleguide 9.5; do not "fix" it by adding a signal
  parameter.
- **No `Symbol.dispose`/`Symbol.asyncDispose`.** `close()` is the only teardown method. The symbol postdates the
  `engines.node >= 18.17` floor and TypeScript does not polyfill it for a declaring library — the computed key
  would silently become the string `"undefined"` at run time. Matches Phase 2's `Transport`.
- **No retention cap, no buffering cap, in this phase.** §5 bounds nothing; every cap the product spec mandates
  (`BODY-19`, `BODY-30`/`HTTP-52`, `BODY-34`) sits in §6 and belongs to Phase 3b. Do not add a
  `maxRetainedBytes` option.
- `END_OF_STREAM` is the exported constant `-1`. Never write the literal `-1` at a call site.
- Typed `Error` subclasses only (styleguide ch08); `cause` chaining on wrap-and-rethrow; `this.name =
  new.target.name`. `IoError extends DexpaceError` (Phase 2's root). Argument-validation failures use
  `invariant`, not the typed tree (`IO-3` permits this explicitly). One deliberate exception:
  charset-label rejection (`decoderFor` in Task 7, `encodeText` in Task 9) throws `IoError` instead, so
  the sink and the tee refuse a label identically and the platform's `RangeError` chains as `cause` —
  `invariant` carries neither.
- **An I/O error message never includes buffer contents.** These buffers carry request and response bodies —
  credentials, tokens, PII (styleguide 8.8). Error messages carry counts and limits, never bytes.
- `exactOptionalPropertyTypes: true` — optional properties are spelled `?: T | undefined`, never bare `?: T`.
- `fast-check` property tests are mandatory (styleguide 11.5) for `ByteQueue`, `readUtf8Line`,
  `readString`/`writeString`, view independence, and `TeeSink`.
- Every test file's top-of-file comment cites the `IO-N` IDs it exercises.
- Existing lint/coverage gates apply unchanged: `max-lines-per-function` 70, `max-depth` 3, `max-params` 3,
  explicit return types on exports, 80% aggregate coverage floor (`NFR-5`).
- **Not built this phase:** `IO-30`'s provider-resolution half, `IO-31`–`IO-36`, `IO-39` (no registry exists);
  `IO-38` (not applicable). Do not add speculative registry or worker-safety code.

---

## File Structure

```
packages/core/src/io/
  limits.ts                  # END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH            (Task 1)
  limits.test.ts
  errors.ts                  # IoError tree                                     (Task 1)
  errors.test.ts
  byte-queue.ts              # ByteQueue                                        (Tasks 2, 3, 4)
  byte-queue.test.ts
  byte-queue.property.test.ts
  retention-window.ts        # Cursor, RetentionWindow                          (Task 5)
  retention-window.test.ts
  buffered-source.ts         # BufferedSource (root + views)                    (Tasks 6, 7, 8, 12)
  buffered-source.test.ts
  buffered-source.text.test.ts
  buffered-source.views.test.ts
  buffered-sink.ts           # BufferedSink, latin1 encode                      (Tasks 9, 12)
  buffered-sink.test.ts
  tee-sink.ts                # TeeSink                                          (Task 10)
  tee-sink.test.ts
  pump.ts                    # writeAll                                         (Task 11)
  pump.test.ts
  factories.ts               # IO-30 factory half                               (Task 13)
  factories.test.ts
  index.ts                   # internal barrel — NOT re-exported publicly       (Task 13)
  byte-queue.bench.ts        # mitata baseline                                  (Task 13)
  test-support/
    fake-stream.ts           # FakeReadableStream / FakeWritableStream          (Task 5)

packages/core/tsconfig.build.json   # MODIFY: exclude src/io/test-support/**    (Task 5)
package.json                        # MODIFY: add mitata devDependency          (Task 13)
```

`SourceView` from the spec's layout is realized as the **same `BufferedSource` class** constructed through a
private view factory, not a second class. The two differ only in injected state (their cursor, their byte limit,
and whether they own the window). A second class would need either inheritance — which styleguide 6.4 permits
only for `Error` hierarchies — or a duplicated set of ten delegating read methods. One class with two
construction paths is neither.

---

### Task 1: `limits.ts` and `errors.ts`

**Files:**
- Create: `packages/core/src/io/limits.ts`
- Create: `packages/core/src/io/limits.test.ts`
- Create: `packages/core/src/io/errors.ts`
- Create: `packages/core/src/io/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` from `../http/errors.js` (Phase 2, Task 3).
- Produces: `END_OF_STREAM: -1`, `MAX_BYTE_ARRAY_LENGTH: number`, and the classes `IoError`,
  `EndOfStreamError`, `SourceContractViolationError`, `ClosedResourceError`, `AllocationLimitError`. Every later
  task imports these by exact name.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/io/limits.test.ts
// Exercises: IO-1 (the end-of-stream sentinel), IO-9 (maximum single-array allocation)
import {describe, expect, test} from 'bun:test';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';

describe('limits', () => {
  test('END_OF_STREAM is the -1 sentinel IO-1 specifies', () => {
    expect(END_OF_STREAM).toBe(-1);
  });

  test('MAX_BYTE_ARRAY_LENGTH is a positive safe integer', () => {
    expect(Number.isSafeInteger(MAX_BYTE_ARRAY_LENGTH)).toBe(true);
    expect(MAX_BYTE_ARRAY_LENGTH).toBeGreaterThan(0);
  });

  test('a Uint8Array of MAX_BYTE_ARRAY_LENGTH is at or under what the host actually allows', () => {
    // The constant is deliberately conservative across V8 and JavaScriptCore. This asserts we did not
    // pick a number the current host cannot honor; the RangeError backstop in ByteQueue covers hosts
    // whose real ceiling is lower still.
    expect(MAX_BYTE_ARRAY_LENGTH).toBeLessThanOrEqual(2 ** 32 - 1);
  });
});
```

```typescript
// packages/core/src/io/errors.test.ts
// Exercises: IO-4/IO-11/IO-12/IO-15 (EndOfStreamError), IO-17 (SourceContractViolationError),
// IO-24/IO-42 (ClosedResourceError), IO-9 (AllocationLimitError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  SourceContractViolationError,
} from './errors.js';

describe('IoError tree', () => {
  test('IoError descends from DexpaceError', () => {
    expect(new IoError('boom')).toBeInstanceOf(DexpaceError);
  });

  test('every leaf descends from IoError', () => {
    expect(new EndOfStreamError(3, 8)).toBeInstanceOf(IoError);
    expect(new SourceContractViolationError('zero read')).toBeInstanceOf(IoError);
    expect(new ClosedResourceError('BufferedSource')).toBeInstanceOf(IoError);
    expect(new AllocationLimitError(9, 8)).toBeInstanceOf(IoError);
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
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd packages/core && bun test src/io/limits.test.ts src/io/errors.test.ts`
Expected: FAIL — `Cannot find module './limits.js'`.

- [ ] **Step 3: Write `limits.ts`**

```typescript
// packages/core/src/io/limits.ts

/**
 * End-of-stream sentinel returned by every read (IO-1).
 *
 * The numeric protocol is kept spec-literal rather than modelled as `number | undefined`, because IO-2
 * (a zero-count read returns 0 and must NOT report end-of-stream) and, later, BODY-25 ("EOF is signaled
 * only by the explicit sentinel") both reason over it.
 *
 * @internal
 */
export const END_OF_STREAM = -1;

/**
 * Largest byte count this package will attempt to materialize as one contiguous `Uint8Array` (IO-9).
 *
 * Deliberately conservative. Core is runtime-agnostic, so `node:buffer`'s constant is unavailable; V8 and
 * JavaScriptCore disagree on the real ceiling and both have moved it, and rule 12.6 forbids probing at
 * import time. 2 GiB − 1 is at or below every supported host's limit. Callers that exceed it get an
 * actionable `AllocationLimitError` rather than a low-level allocation crash; a `RangeError` backstop at
 * the allocation site covers any host whose real ceiling is lower still.
 *
 * @internal
 */
export const MAX_BYTE_ARRAY_LENGTH = 2 ** 31 - 1;
```

- [ ] **Step 4: Write `errors.ts`**

```typescript
// packages/core/src/io/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * Root of the I/O error tree (product-spec §5).
 *
 * Error messages in this tree carry counts and limits, never buffer contents — these buffers hold request
 * and response bodies, which routinely contain credentials and PII (styleguide 8.8).
 *
 * @internal
 */
export class IoError extends DexpaceError {}

/**
 * A source ended before delivering the requested number of bytes (IO-11, IO-12, IO-15), or a sink write
 * found fewer bytes in its source buffer than requested (IO-4).
 *
 * @internal
 */
export class EndOfStreamError extends IoError {
  readonly delivered: number;
  readonly requested: number;

  constructor(delivered: number, requested: number, options?: ErrorOptions) {
    super(`end of stream: delivered ${delivered} of ${requested} bytes`, options);
    this.delivered = delivered;
    this.requested = requested;
  }
}

/**
 * A foreign source violated the read protocol — most commonly by returning zero bytes for a positive
 * requested count, which IO-17 requires be raised rather than tolerated as end-of-stream or spun on.
 *
 * @internal
 */
export class SourceContractViolationError extends IoError {}

/**
 * A closed source, sink, buffer, or view was used (IO-42), or a view outlived the parent that invalidated
 * it (IO-22). Distinct from `EndOfStreamError` by requirement — IO-24 demands a closed view fail loudly
 * with a state error rather than looking like a normal exhaustion.
 *
 * @internal
 */
export class ClosedResourceError extends IoError {
  readonly resource: string;

  constructor(resource: string, options?: ErrorOptions) {
    super(`${resource} is closed`, options);
    this.resource = resource;
  }
}

/**
 * A materialization would exceed the maximum single-array allocation (IO-9). The message points at the
 * streaming alternative, as IO-9 requires.
 *
 * @internal
 */
export class AllocationLimitError extends IoError {
  readonly requested: number;
  readonly limit: number;

  constructor(requested: number, limit: number, options?: ErrorOptions) {
    super(
      `cannot materialize ${requested} bytes as one array (limit ${limit}); stream the body instead`,
      options,
    );
    this.requested = requested;
    this.limit = limit;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/limits.test.ts src/io/errors.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/io/limits.ts packages/core/src/io/limits.test.ts \
        packages/core/src/io/errors.ts packages/core/src/io/errors.test.ts
git commit -m "feat(core): add I/O limits and error taxonomy (IO-1, IO-9, IO-17, IO-24, IO-42)"
```

---

### Task 2: `ByteQueue` — read/write core

**Files:**
- Create: `packages/core/src/io/byte-queue.ts`
- Create: `packages/core/src/io/byte-queue.test.ts`

**Interfaces:**
- Consumes: `END_OF_STREAM` from `./limits.js`, `EndOfStreamError` from `./errors.js` (Task 1); `invariant`
  from `../invariant.js` (Phase 1).
- Produces: `class ByteQueue` with `get size(): number`, `writeBytes(bytes: Uint8Array): void`,
  `read(dest: ByteQueue, count: number): number`, `write(src: ByteQueue, count: number): void`. Tasks 3, 4, 5,
  6, 9, 10, 11 and 13 all use these exact signatures.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/byte-queue.test.ts
// Exercises: IO-1 (tail-append, transferred count, EOF sentinel), IO-2 (zero-count read),
// IO-3 (negative count rejected before any I/O), IO-4 (exact head removal, no partial write),
// IO-7 (FIFO buffer that is simultaneously source and sink)
import {describe, expect, test} from 'bun:test';
import {ByteQueue} from './byte-queue.js';
import {EndOfStreamError} from './errors.js';
import {END_OF_STREAM} from './limits.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const drain = (queue: ByteQueue): number[] => [...queue.snapshot()];

describe('ByteQueue read/write (IO-1, IO-2, IO-3, IO-4, IO-7)', () => {
  test('starts empty', () => {
    expect(new ByteQueue().size).toBe(0);
  });

  test('IO-7: bytes written through the sink surface read back through the source surface in order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    source.writeBytes(bytes(4, 5));
    const dest = new ByteQueue();
    expect(source.read(dest, 5)).toBe(5);
    expect(drain(dest)).toEqual([1, 2, 3, 4, 5]);
    expect(source.size).toBe(0);
  });

  test('IO-1: read appends to the TAIL of a non-empty destination, never overwriting', () => {
    const dest = new ByteQueue();
    dest.writeBytes(bytes(9, 9));
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    expect(source.read(dest, 2)).toBe(2);
    expect(drain(dest)).toEqual([9, 9, 1, 2]);
  });

  test('IO-1: read never returns more than requested, and returns at least 1 when not exhausted', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4));
    const dest = new ByteQueue();
    expect(source.read(dest, 2)).toBe(2);
    expect(source.size).toBe(2);
  });

  test('IO-1: read of a partial source returns what it has, then END_OF_STREAM', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    const dest = new ByteQueue();
    expect(source.read(dest, 8)).toBe(2);
    expect(source.read(dest, 8)).toBe(END_OF_STREAM);
  });

  test('IO-2: a zero-count read returns 0 on a non-empty source', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1));
    expect(source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-2: a zero-count read returns 0 — NOT end-of-stream — on an exhausted source', () => {
    expect(new ByteQueue().read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-3: a negative count is rejected before any transfer', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    expect(() => source.read(dest, -1)).toThrow('count must be a non-negative integer, got -1');
    expect(source.size).toBe(3);
    expect(dest.size).toBe(0);
  });

  test('IO-4: write removes exactly the requested count from the source HEAD, in order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    dest.write(source, 3);
    expect(source.size).toBe(0);
    expect(drain(dest)).toEqual([1, 2, 3]);
  });

  test('IO-4: writing more than the source holds throws instead of writing partially', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    expect(() => dest.write(source, 4)).toThrow(EndOfStreamError);
    expect(source.size).toBe(3);
    expect(dest.size).toBe(0);
  });

  test('IO-3: write rejects a negative count', () => {
    expect(() => new ByteQueue().write(new ByteQueue(), -2)).toThrow(
      'count must be a non-negative integer, got -2',
    );
  });

  test('writeBytes copies, so mutating the caller input afterwards does not change the queue', () => {
    const input = bytes(1, 2, 3);
    const queue = new ByteQueue();
    queue.writeBytes(input);
    input[0] = 99;
    expect(drain(queue)).toEqual([1, 2, 3]);
  });

  test('a transfer that straddles chunk boundaries preserves order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    source.writeBytes(bytes(3, 4));
    source.writeBytes(bytes(5, 6));
    const dest = new ByteQueue();
    expect(source.read(dest, 3)).toBe(3);
    expect(drain(dest)).toEqual([1, 2, 3]);
    expect(source.size).toBe(3);
    const rest = new ByteQueue();
    expect(source.read(rest, 3)).toBe(3);
    expect(drain(rest)).toEqual([4, 5, 6]);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts`
Expected: FAIL — `Cannot find module './byte-queue.js'`.

- [ ] **Step 3: Write `byte-queue.ts`**

`snapshot()` is included here as a minimal stub only because the tests above use it to inspect contents; Task 3
replaces it with the full `IO-8`/`IO-9` implementation.

```typescript
// packages/core/src/io/byte-queue.ts
import {invariant} from '../invariant.js';
import {EndOfStreamError} from './errors.js';
import {END_OF_STREAM} from './limits.js';

/**
 * One node in the queue's chunk list. `bytes` is never mutated after the node is linked in, which is what
 * makes zero-copy `subarray` transfers between queues safe; `start` is the first byte not yet consumed.
 */
interface Chunk {
  readonly bytes: Uint8Array;
  start: number;
  next: Chunk | undefined;
}

/**
 * A FIFO byte queue that is simultaneously a source and a sink (IO-7).
 *
 * Synchronous throughout: pure memory has nothing to wait for, so making it async would allocate a Promise
 * on the SDK's hottest data structure (styleguide 15.4) and force every downstream synchronous consumer to
 * become async for no I/O reason. `BufferedSource`/`BufferedSink` are the async surfaces.
 *
 * Not safe for concurrent use (IO-37); callers serialize access.
 *
 * @internal
 */
export class ByteQueue {
  #head: Chunk | undefined = undefined;
  #tail: Chunk | undefined = undefined;
  #size = 0;

  /** Bytes currently held (IO-7). */
  get size(): number {
    return this.#size;
  }

  /**
   * Append an independent copy of `bytes` to the tail. The copy is what lets IO-30's byte-array-wrapping
   * factory promise that mutating the caller's input afterwards does not change the source.
   */
  writeBytes(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.#append(bytes.slice());
  }

  /**
   * Move up to `count` bytes from this queue's head onto `dest`'s tail (IO-1).
   *
   * Returns the number transferred: at least 1 when `count` is positive and the queue is not exhausted,
   * exactly 0 when `count` is 0, `END_OF_STREAM` at end, and never more than requested.
   */
  read(dest: ByteQueue, count: number): number {
    assertCount(count);
    // IO-2 is checked BEFORE exhaustion, deliberately: a zero-count read returns 0 even on an exhausted
    // queue, and must never collapse to END_OF_STREAM. Reordering these two lines breaks IO-2.
    if (count === 0) return 0;
    if (this.#size === 0) return END_OF_STREAM;
    const take = Math.min(count, this.#size);
    this.#moveTo(dest, take);
    return take;
  }

  /**
   * Move exactly `count` bytes from `src`'s head onto this queue's tail (IO-4). Fails rather than
   * transferring a partial amount when `src` holds fewer.
   */
  write(src: ByteQueue, count: number): void {
    assertCount(count);
    if (src.#size < count) throw new EndOfStreamError(src.#size, count);
    src.#moveTo(this, count);
  }

  /** Replaced in Task 3 by the full IO-8/IO-9 implementation. */
  snapshot(): Uint8Array {
    const out = new Uint8Array(this.#size);
    let at = 0;
    for (let chunk = this.#head; chunk !== undefined; chunk = chunk.next) {
      const slice = chunk.bytes.subarray(chunk.start);
      out.set(slice, at);
      at += slice.length;
    }
    return out;
  }

  /** Caller owns the source-side size accounting; `#dropHead` deliberately does not touch `#size`. */
  #moveTo(dest: ByteQueue, count: number): void {
    let remaining = count;
    while (remaining > 0) {
      const head = this.#head;
      invariant(head !== undefined, 'byte-queue underflow during move');
      const take = Math.min(head.bytes.length - head.start, remaining);
      dest.#append(head.bytes.subarray(head.start, head.start + take));
      head.start += take;
      remaining -= take;
      if (head.start === head.bytes.length) this.#dropHead();
    }
    this.#size -= count;
  }

  #append(bytes: Uint8Array): void {
    const chunk: Chunk = {bytes, start: 0, next: undefined};
    if (this.#tail === undefined) this.#head = chunk;
    else this.#tail.next = chunk;
    this.#tail = chunk;
    this.#size += bytes.length;
  }

  #dropHead(): void {
    const head = this.#head;
    invariant(head !== undefined, 'byte-queue drop with no head');
    this.#head = head.next;
    if (this.#head === undefined) this.#tail = undefined;
  }
}

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${count}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/byte-queue.ts packages/core/src/io/byte-queue.test.ts
git commit -m "feat(core): add ByteQueue read/write core (IO-1, IO-2, IO-3, IO-4, IO-7)"
```

---

### Task 3: `ByteQueue` — snapshot, copyTo, takeBytes, skip, clear

**Files:**
- Modify: `packages/core/src/io/byte-queue.ts`
- Modify: `packages/core/src/io/byte-queue.test.ts`

**Interfaces:**
- Consumes: Task 2's `ByteQueue`; `AllocationLimitError` and `MAX_BYTE_ARRAY_LENGTH` from Task 1.
- Produces: `snapshot(): Uint8Array`, `copyTo(dest: ByteQueue, offset: number, count?: number): void`,
  `takeBytes(count: number): Uint8Array`, `skip(count: number): number`, `clear(): void`. Task 5's
  `RetentionWindow` uses `skip` and `takeBytes`; Tasks 6–13 use `snapshot` and `takeBytes`.

- [ ] **Step 1: Add the failing tests**

Append to `packages/core/src/io/byte-queue.test.ts`:

```typescript
describe('ByteQueue views and materialization (IO-8, IO-9, IO-10)', () => {
  test('IO-8: snapshot does not consume or mutate', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    expect([...queue.snapshot()]).toEqual([1, 2, 3]);
    expect(queue.size).toBe(3);
  });

  test('IO-8: a snapshot is independent of later mutations, in both directions', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    const first = queue.snapshot();
    queue.writeBytes(bytes(4));
    expect([...first]).toEqual([1, 2, 3]);
    first[0] = 99;
    expect([...queue.snapshot()]).toEqual([1, 2, 3, 4]);
  });

  test('IO-9: materializing past the limit fails with an actionable error, not an allocation crash', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    expect(() => queue.takeBytes(MAX_BYTE_ARRAY_LENGTH + 1)).toThrow(AllocationLimitError);
  });

  test('IO-10: copyTo copies a window without consuming or mutating the source', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4, 5));
    const dest = new ByteQueue();
    source.copyTo(dest, 1, 3);
    expect([...dest.snapshot()]).toEqual([2, 3, 4]);
    expect(source.size).toBe(5);
  });

  test('IO-10: copyTo defaults to offset-through-end', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4));
    const dest = new ByteQueue();
    source.copyTo(dest, 2);
    expect([...dest.snapshot()]).toEqual([3, 4]);
  });

  test('IO-10: copyTo rejects an out-of-range window', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    expect(() => source.copyTo(new ByteQueue(), 2, 5)).toThrow('copy window 2..7 exceeds size 3');
    expect(() => source.copyTo(new ByteQueue(), -1)).toThrow(
      'offset must be a non-negative integer, got -1',
    );
  });

  test('IO-10: clear discards every byte', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    queue.clear();
    expect(queue.size).toBe(0);
    expect([...queue.snapshot()]).toEqual([]);
  });

  test('takeBytes consumes exactly the requested count', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3, 4));
    expect([...queue.takeBytes(2)]).toEqual([1, 2]);
    expect(queue.size).toBe(2);
  });

  test('takeBytes past the end throws rather than returning short', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2));
    expect(() => queue.takeBytes(3)).toThrow(EndOfStreamError);
  });

  test('skip discards from the head and returns how many it discarded', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3, 4));
    expect(queue.skip(2)).toBe(2);
    expect([...queue.snapshot()]).toEqual([3, 4]);
    expect(queue.skip(9)).toBe(2);
    expect(queue.size).toBe(0);
  });
});
```

Extend the import line at the top of the file:

```typescript
import {AllocationLimitError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';
```

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts`
Expected: FAIL — `queue.takeBytes is not a function`.

- [ ] **Step 3: Replace the stub `snapshot` and add the new methods**

In `byte-queue.ts`, extend the imports:

```typescript
import {AllocationLimitError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';
```

Replace the stub `snapshot()` from Task 2 with these five methods:

```typescript
  /**
   * A fresh, independent copy of the current contents, without consuming or mutating (IO-8). Later
   * mutations do not affect a returned snapshot, and vice versa.
   */
  snapshot(): Uint8Array {
    return this.#materialize(0, this.#size);
  }

  /**
   * Copy the window `[offset, offset + count)` into `dest` WITHOUT consuming or mutating this queue
   * (IO-10). `count` defaults to "from offset through end". An out-of-range window is rejected.
   */
  copyTo(dest: ByteQueue, offset: number, count?: number): void {
    invariant(
      Number.isInteger(offset) && offset >= 0,
      `offset must be a non-negative integer, got ${offset}`,
    );
    const length = count ?? this.#size - offset;
    assertCount(length);
    invariant(
      offset + length <= this.#size,
      `copy window ${offset}..${offset + length} exceeds size ${this.#size}`,
    );
    if (length === 0) return;
    dest.#append(this.#materialize(offset, length));
  }

  /** Consume and return exactly `count` bytes, failing rather than returning short. */
  takeBytes(count: number): Uint8Array {
    assertCount(count);
    if (count > this.#size) throw new EndOfStreamError(this.#size, count);
    const out = this.#materialize(0, count);
    this.#discard(count);
    return out;
  }

  /** Discard up to `count` bytes from the head; returns how many were actually discarded. */
  skip(count: number): number {
    assertCount(count);
    const dropped = Math.min(count, this.#size);
    this.#discard(dropped);
    return dropped;
  }

  /** Discard every byte (IO-10). */
  clear(): void {
    this.#head = undefined;
    this.#tail = undefined;
    this.#size = 0;
  }

  /**
   * Copy `count` bytes starting `offset` from the head into one contiguous array (IO-9-bounded).
   *
   * Parameter order matches `copyTo(dest, offset, count)` deliberately: two adjacent `number`s in
   * opposite orders across two methods is exactly the transposition hazard styleguide 5.5 names.
   */
  #materialize(offset: number, count: number): Uint8Array {
    if (count > MAX_BYTE_ARRAY_LENGTH) throw new AllocationLimitError(count, MAX_BYTE_ARRAY_LENGTH);
    const out = allocate(count);
    let skip = offset;
    let at = 0;
    for (let chunk = this.#head; chunk !== undefined && at < count; chunk = chunk.next) {
      const available = chunk.bytes.length - chunk.start;
      if (skip >= available) {
        skip -= available;
        continue;
      }
      const from = chunk.start + skip;
      const take = Math.min(available - skip, count - at);
      out.set(chunk.bytes.subarray(from, from + take), at);
      at += take;
      skip = 0;
    }
    return out;
  }

  #discard(count: number): void {
    let remaining = count;
    while (remaining > 0) {
      const head = this.#head;
      invariant(head !== undefined, 'byte-queue underflow during discard');
      const take = Math.min(head.bytes.length - head.start, remaining);
      head.start += take;
      remaining -= take;
      if (head.start === head.bytes.length) this.#dropHead();
    }
    this.#size -= count;
  }
```

Add this module-level helper beside `assertCount`:

```typescript
/**
 * IO-9's backstop. The eager `MAX_BYTE_ARRAY_LENGTH` check is deliberately conservative, so a host whose
 * real ceiling is lower would otherwise surface a raw `RangeError` — exactly the "low-level allocation
 * crash" IO-9 exists to prevent.
 */
function allocate(count: number): Uint8Array {
  try {
    return new Uint8Array(count);
  } catch (e: unknown) {
    if (e instanceof RangeError) {
      throw new AllocationLimitError(count, MAX_BYTE_ARRAY_LENGTH, {cause: e});
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/byte-queue.ts packages/core/src/io/byte-queue.test.ts
git commit -m "feat(core): add ByteQueue snapshot, copyTo, takeBytes, skip, clear (IO-8, IO-9, IO-10)"
```

---

### Task 4: `ByteQueue` — close semantics and property tests

**Files:**
- Modify: `packages/core/src/io/byte-queue.ts`
- Modify: `packages/core/src/io/byte-queue.test.ts`
- Create: `packages/core/src/io/byte-queue.property.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 3's `ByteQueue`.
- Produces: `close(): void` and `get closed(): boolean`.

- [ ] **Step 1: Add the failing close tests**

Append to `packages/core/src/io/byte-queue.test.ts`:

```typescript
describe('ByteQueue close (IO-41, IO-42)', () => {
  test('IO-41: close is idempotent — a second close does not throw', () => {
    const queue = new ByteQueue();
    queue.close();
    expect(() => queue.close()).not.toThrow();
    expect(queue.closed).toBe(true);
  });

  test('IO-42: a purely in-memory buffer stays readable and writable after close', () => {
    // IO-42 carves this out explicitly, and Phase 3b depends on it: snapshot-after-close is how
    // post-mortem body logging works. Making an in-memory buffer throw here is one of the two
    // directions IO-42 names as the porter's trap; the other is Task 6's stream-backed source, which
    // MUST reject after close.
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    queue.close();
    expect([...queue.snapshot()]).toEqual([1, 2, 3]);
    expect(() => queue.writeBytes(bytes(4))).not.toThrow();
    expect(queue.read(new ByteQueue(), 1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts`
Expected: FAIL — `queue.close is not a function`.

- [ ] **Step 3: Add `close()` and `closed` to `byte-queue.ts`**

Add the field beside the others:

```typescript
  #closed = false;
```

Add these two members:

```typescript
  /** Whether `close()` has been called. */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Mark this queue closed (IO-41 — idempotent, the underlying resource released at most once).
   *
   * Deliberately leaves the read/write surface usable: IO-42 exempts a purely in-memory buffer so that
   * snapshot-after-close body logging still works. A queue owns no external resource, so there is nothing
   * else to release here. Invalidating derived views is `RetentionWindow`'s job, not this class's — views
   * are cursors over a window, never over a bare queue.
   */
  close(): void {
    this.#closed = true;
  }
```

- [ ] **Step 4: Write the property tests**

```typescript
// packages/core/src/io/byte-queue.property.test.ts
// Exercises: IO-7 (FIFO order across arbitrary chunk splits), IO-8 (snapshot independence),
// IO-10 (copyTo is non-consuming)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {ByteQueue} from './byte-queue.js';

const chunks = fc.array(fc.uint8Array({maxLength: 32}), {maxLength: 16});

describe('ByteQueue properties', () => {
  test('IO-7: writing arbitrary chunks then reading back preserves byte order exactly', () => {
    fc.assert(
      fc.property(chunks, (input) => {
        const queue = new ByteQueue();
        for (const chunk of input) queue.writeBytes(chunk);
        const expected = input.flatMap((chunk) => [...chunk]);
        expect(queue.size).toBe(expected.length);
        expect([...queue.snapshot()]).toEqual(expected);
      }),
    );
  });

  test('IO-7: reading in arbitrary increments yields the same bytes as reading all at once', () => {
    fc.assert(
      fc.property(chunks, fc.array(fc.integer({min: 0, max: 8}), {maxLength: 32}), (input, steps) => {
        const source = new ByteQueue();
        for (const chunk of input) source.writeBytes(chunk);
        const expected = input.flatMap((chunk) => [...chunk]);

        const dest = new ByteQueue();
        for (const step of steps) source.read(dest, step);
        source.read(dest, source.size);

        expect([...dest.snapshot()]).toEqual(expected);
      }),
    );
  });

  test('IO-8: a snapshot is unaffected by later writes', () => {
    fc.assert(
      fc.property(chunks, fc.uint8Array({maxLength: 16}), (input, later) => {
        const queue = new ByteQueue();
        for (const chunk of input) queue.writeBytes(chunk);
        const before = queue.snapshot();
        const expected = [...before];
        queue.writeBytes(later);
        expect([...before]).toEqual(expected);
      }),
    );
  });

  test('IO-10: copyTo never changes the source size', () => {
    fc.assert(
      fc.property(chunks, fc.integer({min: 0, max: 16}), (input, offset) => {
        const source = new ByteQueue();
        for (const chunk of input) source.writeBytes(chunk);
        fc.pre(offset <= source.size);
        const sizeBefore = source.size;
        source.copyTo(new ByteQueue(), offset);
        expect(source.size).toBe(sizeBefore);
      }),
    );
  });
});
```

- [ ] **Step 5: Run all `ByteQueue` tests**

Run: `cd packages/core && bun test src/io/byte-queue.test.ts src/io/byte-queue.property.test.ts`
Expected: PASS, 24 unit tests + 4 property tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/io/byte-queue.ts packages/core/src/io/byte-queue.test.ts \
        packages/core/src/io/byte-queue.property.test.ts
git commit -m "feat(core): add ByteQueue close semantics and property tests (IO-41, IO-42)"
```

---

### Task 5: `RetentionWindow` and the fake-stream test support

**Files:**
- Create: `packages/core/src/io/test-support/fake-stream.ts`
- Create: `packages/core/src/io/retention-window.ts`
- Create: `packages/core/src/io/retention-window.test.ts`
- Modify: `packages/core/tsconfig.build.json`

**Interfaces:**
- Consumes: `ByteQueue` (Tasks 2–4), `ClosedResourceError`/`SourceContractViolationError` (Task 1).
- Produces: `interface Cursor { at: number }`; `class RetentionWindow` with `constructor(reader:
  ReadableStreamDefaultReader<Uint8Array> | undefined)`, `get pulledThrough(): number`, `get
  retainedBytes(): number`, `get closed(): boolean`, `register(at: number): Cursor`, `release(cursor:
  Cursor): void`, `pullThrough(offset: number): Promise<boolean>`, `readInto(cursor: Cursor, dest:
  ByteQueue, count: number): number`, `peekBytes(cursor: Cursor, count: number): Uint8Array`,
  `assertUsable(): void`, `close(): void`. Also
  `fakeReadableStream(chunks: readonly Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array>` and
  `collectingWritableStream(): {stream: WritableStream<Uint8Array>; written: () => Uint8Array; isClosed: ()
  => boolean}` from test-support. Tasks 6, 7, 8, 12, 13 use all of these.

- [ ] **Step 1: Write the test-support fakes**

```typescript
// packages/core/src/io/test-support/fake-stream.ts
// Test-only. Excluded from the build (tsconfig.build.json) and never exported from any barrel.
// Styleguide 11.3: fake your own interfaces rather than reaching for mock.module.

/** A readable stream that yields exactly the chunks given, at exactly those boundaries. */
export function fakeReadableStream(
  chunks: readonly Uint8Array[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    cancel(): void {
      onCancel?.();
    },
    pull(controller): void {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) controller.enqueue(chunk);
    },
  });
}

/** A readable stream that violates the read protocol by yielding an empty chunk (drives IO-17). */
export function protocolViolatingStream(): ReadableStream<Uint8Array> {
  return fakeReadableStream([new Uint8Array(0)]);
}

/** A writable stream that accumulates everything written, for asserting the wire payload. */
export function collectingWritableStream(): {
  stream: WritableStream<Uint8Array>;
  written: () => Uint8Array;
  isClosed: () => boolean;
} {
  const parts: Uint8Array[] = [];
  let closed = false;
  const stream = new WritableStream<Uint8Array>({
    write(chunk): void {
      parts.push(chunk.slice());
    },
    close(): void {
      closed = true;
    },
  });
  const written = (): Uint8Array => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return {stream, written, isClosed: () => closed};
}

/** A writable stream whose first write rejects, for asserting failure-path behavior. */
export function failingWritableStream(message: string): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(): never {
      throw new Error(message);
    },
  });
}
```

- [ ] **Step 2: Exclude test-support from the build**

In `packages/core/tsconfig.build.json`, add `"src/io/test-support/**"` to the existing `exclude` array, beside
the `**/*.test.ts` entry it already has:

```jsonc
  "exclude": ["**/*.test.ts", "**/*.bench.ts", "src/io/test-support/**"]
```

- [ ] **Step 3: Write the failing test**

```typescript
// packages/core/src/io/retention-window.test.ts
// Exercises: IO-19/IO-20 (non-consuming views), IO-22 (parent close invalidates views),
// IO-23 (mutually independent cursors), IO-24 (closed view fails loudly, distinct from EOF)
import {describe, expect, test} from 'bun:test';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError} from './errors.js';
import {RetentionWindow} from './retention-window.js';
import {fakeReadableStream} from './test-support/fake-stream.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const windowOver = (...chunks: Uint8Array[]): RetentionWindow =>
  new RetentionWindow(fakeReadableStream(chunks).getReader());

describe('RetentionWindow', () => {
  test('pullThrough pulls until the requested logical offset is available', async () => {
    const window = windowOver(bytes(1, 2), bytes(3, 4));
    expect(await window.pullThrough(3)).toBe(true);
    expect(window.pulledThrough).toBeGreaterThanOrEqual(3);
  });

  test('pullThrough returns false once the stream is exhausted', async () => {
    const window = windowOver(bytes(1, 2));
    expect(await window.pullThrough(5)).toBe(false);
    expect(window.pulledThrough).toBe(2);
  });

  test('readInto advances only the cursor it is given', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const first = window.register(0);
    const second = window.register(0);
    await window.pullThrough(4);

    const dest = new ByteQueue();
    expect(window.readInto(first, dest, 2)).toBe(2);
    expect(first.at).toBe(2);
    expect(second.at).toBe(0);
  });

  test('IO-23: two cursors read the same bytes independently', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const first = window.register(0);
    const second = window.register(0);
    await window.pullThrough(3);

    const a = new ByteQueue();
    const b = new ByteQueue();
    window.readInto(first, a, 3);
    window.readInto(second, b, 3);
    expect([...a.snapshot()]).toEqual([1, 2, 3]);
    expect([...b.snapshot()]).toEqual([1, 2, 3]);
  });

  test('bytes behind the slowest cursor are trimmed, bytes at or ahead of it are retained', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const fast = window.register(0);
    const slow = window.register(0);
    await window.pullThrough(4);

    window.readInto(fast, new ByteQueue(), 4);
    expect(window.retainedBytes).toBe(4); // slow still needs all four

    window.readInto(slow, new ByteQueue(), 4);
    expect(window.retainedBytes).toBe(0); // nobody needs them now
  });

  test('releasing a cursor lets the head trim forward', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const fast = window.register(0);
    const slow = window.register(0);
    await window.pullThrough(4);
    window.readInto(fast, new ByteQueue(), 4);

    window.release(slow);
    expect(window.retainedBytes).toBe(0);
  });

  test('peekBytes materializes without advancing the cursor', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const cursor = window.register(0);
    await window.pullThrough(3);
    expect([...window.peekBytes(cursor, 2)]).toEqual([1, 2]);
    expect(cursor.at).toBe(0);
  });

  test('IO-22/IO-24: after close, any cursor use throws ClosedResourceError, not an EOF', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const cursor = window.register(0);
    await window.pullThrough(3);
    window.close();

    expect(() => window.assertUsable()).toThrow(ClosedResourceError);
    expect(() => window.readInto(cursor, new ByteQueue(), 1)).toThrow(ClosedResourceError);
  });

  test('IO-41: close is idempotent', () => {
    const window = windowOver(bytes(1));
    window.close();
    expect(() => window.close()).not.toThrow();
  });
});
```

- [ ] **Step 4: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/retention-window.test.ts`
Expected: FAIL — `Cannot find module './retention-window.js'`.

- [ ] **Step 5: Write `retention-window.ts`**

```typescript
// packages/core/src/io/retention-window.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, SourceContractViolationError} from './errors.js';

/**
 * A reader's position, as a logical offset into the whole stream. Two cursors over one window are
 * mutually independent (IO-23): advancing one never moves another.
 *
 * @internal
 */
export interface Cursor {
  at: number;
}

/**
 * The shared buffer behind a `BufferedSource` and all of its peek/slice views.
 *
 * Bytes are retained from `min(all live cursors)` forward and trimmed as the slowest cursor advances, so
 * with no views outstanding retention collapses to the read size. There is deliberately **no cap** here:
 * §5 bounds nothing, and every cap the product spec mandates (BODY-19, BODY-30/HTTP-52, BODY-34) sits in
 * §6 and belongs to Phase 3b. A cap at this layer would bound the spread between the fastest and slowest
 * cursor, which in the divergent case stops a view reaching the end and partially fails IO-19's MUST.
 *
 * Owns the stream reader, so a view — which owns no reader — can still pull through its parent's source.
 *
 * @internal
 */
export class RetentionWindow {
  readonly #queue = new ByteQueue();
  readonly #cursors = new Set<Cursor>();
  readonly #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #retainedFrom = 0;
  #pulledThrough = 0;
  #exhausted = false;
  #closed = false;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array> | undefined) {
    this.#reader = reader;
    this.#exhausted = reader === undefined;
  }

  /** Logical offset one past the last byte pulled from the stream. */
  get pulledThrough(): number {
    return this.#pulledThrough;
  }

  /** Bytes currently held because some cursor may still need them. */
  get retainedBytes(): number {
    return this.#queue.size;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Register a new cursor at a logical offset (IO-23 — its own cursor, independent of every other). */
  register(at: number): Cursor {
    this.assertUsable();
    const cursor: Cursor = {at};
    this.#cursors.add(cursor);
    return cursor;
  }

  /**
   * Drop a cursor and let the retained head trim forward (IO-22 — releasing a view neither closes the
   * parent nor moves the parent's cursor).
   */
  release(cursor: Cursor): void {
    this.#cursors.delete(cursor);
    if (!this.#closed) this.#trim();
  }

  /**
   * Pull from the stream until `offset` bytes are available, or the stream ends. Returns false at end.
   */
  async pullThrough(offset: number): Promise<boolean> {
    this.assertUsable();
    while (this.#pulledThrough < offset && !this.#exhausted) {
      await this.#pullOnce();
      this.assertUsable();
    }
    return this.#pulledThrough >= offset;
  }

  /** Move up to `count` already-pulled bytes onto `dest`, advancing only `cursor`. */
  readInto(cursor: Cursor, dest: ByteQueue, count: number): number {
    this.assertUsable();
    const take = Math.min(count, this.#pulledThrough - cursor.at);
    if (take <= 0) return 0;
    this.#queue.copyTo(dest, cursor.at - this.#retainedFrom, take);
    cursor.at += take;
    this.#trim();
    return take;
  }

  /** Materialize up to `count` already-pulled bytes without advancing `cursor` (IO-19, IO-20). */
  peekBytes(cursor: Cursor, count: number): Uint8Array {
    this.assertUsable();
    const take = Math.min(count, this.#pulledThrough - cursor.at);
    if (take <= 0) return new Uint8Array(0);
    const staging = new ByteQueue();
    this.#queue.copyTo(staging, cursor.at - this.#retainedFrom, take);
    return staging.snapshot();
  }

  /** IO-24: a closed window fails loudly with a state error, never as a normal EOF. */
  assertUsable(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSource');
  }

  /**
   * IO-41: idempotent. IO-22: invalidates every outstanding view, so a later read from one fails loudly
   * rather than returning stale bytes.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#cursors.clear();
    this.#queue.clear();
    this.#queue.close();
    // The reader lock must be released even if the stream already errored; a rejection here would
    // otherwise become an unhandled rejection on a teardown path.
    void this.#reader?.cancel().catch(() => undefined);
  }

  async #pullOnce(): Promise<void> {
    invariant(this.#reader !== undefined, 'pull on a window with no reader');
    const {done, value} = await this.#reader.read();
    if (done === true) {
      this.#exhausted = true;
      return;
    }
    invariant(value !== undefined, 'stream delivered no value without signalling done');
    if (value.length === 0) {
      // IO-17: a zero-length delivery for an outstanding read is a source-contract violation, never
      // end-of-stream and never something to spin on.
      throw new SourceContractViolationError('source delivered 0 bytes without signalling end of stream');
    }
    this.#queue.writeBytes(value);
    this.#pulledThrough += value.length;
  }

  /** Drop everything no live cursor can still reach. */
  #trim(): void {
    const low = this.#lowestCursor();
    const drop = low - this.#retainedFrom;
    if (drop <= 0) return;
    this.#queue.skip(drop);
    this.#retainedFrom = low;
  }

  #lowestCursor(): number {
    let low = this.#pulledThrough;
    for (const cursor of this.#cursors) low = Math.min(low, cursor.at);
    return low;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/retention-window.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/io/retention-window.ts packages/core/src/io/retention-window.test.ts \
        packages/core/src/io/test-support/fake-stream.ts packages/core/tsconfig.build.json
git commit -m "feat(core): add RetentionWindow cursor machinery (IO-19, IO-22, IO-23, IO-24)"
```

---

### Task 6: `BufferedSource` — core reads

**Files:**
- Create: `packages/core/src/io/buffered-source.ts`
- Create: `packages/core/src/io/buffered-source.test.ts`

**Interfaces:**
- Consumes: `ByteQueue`, `RetentionWindow`/`Cursor`, `END_OF_STREAM`, `EndOfStreamError`,
  `ClosedResourceError`.
- Produces: `class BufferedSource` with `static overStream(stream: ReadableStream<Uint8Array>):
  BufferedSource`, `static overBytes(bytes: Uint8Array): BufferedSource`, `read(dest: ByteQueue, count:
  number): Promise<number>`, `exhausted(): Promise<boolean>`, `readByte(): Promise<number>`,
  `readBytes(): Promise<Uint8Array>`, `readExactly(count: number): Promise<Uint8Array>`, `skip(count:
  number): Promise<void>`, `close(): Promise<void>`, `get closed(): boolean`. Tasks 7, 8, 11, 12, 13 extend
  and use this class.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/buffered-source.test.ts
// Exercises: IO-1 (read protocol), IO-2 (zero-count read), IO-3 (negative count),
// IO-11 (exhausted, single-byte read, remaining-bytes read), IO-12 (exact-count read),
// IO-15 (skip), IO-41 (idempotent close), IO-42 (stream-backed rejects after close),
// IO-6 (wrapper owns the caller's stream)
import {describe, expect, test} from 'bun:test';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM} from './limits.js';
import {fakeReadableStream} from './test-support/fake-stream.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

describe('BufferedSource core reads', () => {
  test('IO-1: read appends to the destination tail and returns the transferred count', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const dest = new ByteQueue();
    dest.writeBytes(bytes(9));
    expect(await source.read(dest, 2)).toBe(2);
    expect([...dest.snapshot()]).toEqual([9, 1, 2]);
  });

  test('IO-1: read returns END_OF_STREAM once exhausted', async () => {
    const source = sourceOver(bytes(1));
    const dest = new ByteQueue();
    expect(await source.read(dest, 4)).toBe(1);
    expect(await source.read(dest, 4)).toBe(END_OF_STREAM);
  });

  test('IO-2: a zero-count read returns 0 on a fresh source', async () => {
    const source = sourceOver(bytes(1));
    expect(await source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-2: a zero-count read returns 0 — not END_OF_STREAM — on an exhausted source', async () => {
    const source = sourceOver();
    expect(await source.read(new ByteQueue(), 4)).toBe(END_OF_STREAM);
    expect(await source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-3: a negative count is rejected before any I/O', async () => {
    const source = sourceOver(bytes(1, 2));
    await expect(source.read(new ByteQueue(), -1)).rejects.toThrow(
      'count must be a non-negative integer, got -1',
    );
  });

  test('IO-11: exhausted() is false while bytes remain and true once they do not', async () => {
    const source = sourceOver(bytes(1));
    expect(await source.exhausted()).toBe(false);
    await source.readBytes();
    expect(await source.exhausted()).toBe(true);
  });

  test('IO-11: readByte returns the next byte, then fails at end', async () => {
    const source = sourceOver(bytes(7));
    expect(await source.readByte()).toBe(7);
    await expect(source.readByte()).rejects.toThrow(EndOfStreamError);
  });

  test('IO-11: readBytes returns all remaining bytes, and empty when already exhausted', async () => {
    const source = sourceOver(bytes(1, 2), bytes(3));
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
    expect([...(await source.readBytes())]).toEqual([]);
  });

  test('IO-12: readExactly returns exactly the requested count across chunk boundaries', async () => {
    const source = sourceOver(bytes(1), bytes(2, 3), bytes(4));
    expect([...(await source.readExactly(3))]).toEqual([1, 2, 3]);
  });

  test('IO-12: readExactly fails rather than returning a short result', async () => {
    const source = sourceOver(bytes(1, 2));
    await expect(source.readExactly(3)).rejects.toThrow(EndOfStreamError);
  });

  test('IO-15: skip advances past exactly the requested count', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4));
    await source.skip(2);
    expect([...(await source.readBytes())]).toEqual([3, 4]);
  });

  test('IO-15: skip fails when fewer bytes remain', async () => {
    const source = sourceOver(bytes(1, 2));
    await expect(source.skip(3)).rejects.toThrow(EndOfStreamError);
  });

  test('IO-15: skip(0) is a no-op, even at and after end of stream', async () => {
    const source = sourceOver(bytes(1));
    await source.skip(0);
    await source.readBytes();
    await source.skip(0);
    expect(await source.exhausted()).toBe(true);
  });

  test('IO-41: close is idempotent', async () => {
    const source = sourceOver(bytes(1));
    await source.close();
    await source.close();
    expect(source.closed).toBe(true);
  });

  test('IO-42: a stream-backed source REJECTS reads after close', async () => {
    // The opposite direction from ByteQueue, which stays readable. IO-42 names both as the
    // inconsistency porters get wrong; both directions are asserted, here and in Task 4.
    const source = sourceOver(bytes(1, 2));
    await source.close();
    await expect(source.read(new ByteQueue(), 1)).rejects.toThrow(ClosedResourceError);
    await expect(source.readBytes()).rejects.toThrow(ClosedResourceError);
  });

  test('overBytes wraps a byte array as an independent copy', async () => {
    const input = bytes(1, 2, 3);
    const source = BufferedSource.overBytes(input);
    input[0] = 99;
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-6: closing the source cancels the caller stream it took ownership of', async () => {
    let cancelled = false;
    const source = BufferedSource.overStream(
      fakeReadableStream([bytes(1)], () => {
        cancelled = true;
      }),
    );
    await source.close();
    expect(cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/buffered-source.test.ts`
Expected: FAIL — `Cannot find module './buffered-source.js'`.

- [ ] **Step 3: Write `buffered-source.ts`**

```typescript
// packages/core/src/io/buffered-source.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from './byte-queue.js';
import {AllocationLimitError, ClosedResourceError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';
import {RetentionWindow, type Cursor} from './retention-window.js';

/**
 * A buffered, non-blocking byte source over a `ReadableStream<Uint8Array>` (IO-11–IO-24).
 *
 * Peek and slice views are instances of this same class over the same `RetentionWindow`, differing only in
 * their cursor, their byte budget, and whether they own the window. A second class would need either
 * inheritance — which styleguide 6.4 reserves for `Error` hierarchies — or ten duplicated delegating
 * methods.
 *
 * Takes no `AbortSignal` and imposes no timeout: IO-40 assigns deadlines and prompt cancellation of
 * blocked I/O to the transport that owns the real socket. Not safe for concurrent use (IO-37).
 *
 * @internal
 */
export class BufferedSource {
  readonly #window: RetentionWindow;
  readonly #cursor: Cursor;
  readonly #ownsWindow: boolean;
  readonly #limit: number;
  #closed = false;

  private constructor(window: RetentionWindow, cursor: Cursor, ownsWindow: boolean, limit: number) {
    this.#window = window;
    this.#cursor = cursor;
    this.#ownsWindow = ownsWindow;
    this.#limit = limit;
  }

  /** Wrap a caller-supplied stream (IO-30). */
  static overStream(stream: ReadableStream<Uint8Array>): BufferedSource {
    const window = new RetentionWindow(stream.getReader());
    return new BufferedSource(window, window.register(0), true, Number.POSITIVE_INFINITY);
  }

  /** Wrap a byte array as an independent copy (IO-30). */
  static overBytes(bytes: Uint8Array): BufferedSource {
    const copy = bytes.slice();
    return BufferedSource.overStream(
      new ReadableStream<Uint8Array>({
        start(controller): void {
          if (copy.length > 0) controller.enqueue(copy);
          controller.close();
        },
      }),
    );
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Read up to `count` bytes onto `dest`'s tail (IO-1, IO-2, IO-3). */
  async read(dest: ByteQueue, count: number): Promise<number> {
    assertCount(count);
    this.#assertOpen();
    // IO-2 before any exhaustion determination — a zero-count read is 0, never END_OF_STREAM.
    if (count === 0) return 0;
    const want = Math.min(count, this.#remainingBudget());
    if (want <= 0) return END_OF_STREAM;
    const available = await this.#window.pullThrough(this.#cursor.at + 1);
    if (!available) return END_OF_STREAM;
    return this.#window.readInto(this.#cursor, dest, want);
  }

  /** True exactly when no more bytes are available (IO-11). */
  async exhausted(): Promise<boolean> {
    this.#assertOpen();
    if (this.#remainingBudget() <= 0) return true;
    return !(await this.#window.pullThrough(this.#cursor.at + 1));
  }

  /** The next byte, or a failure at end of stream (IO-11). */
  async readByte(): Promise<number> {
    const [value] = await this.readExactly(1);
    invariant(value !== undefined, 'readExactly(1) returned an empty array');
    return value;
  }

  /** Every remaining byte; empty when already exhausted (IO-11). */
  async readBytes(): Promise<Uint8Array> {
    this.#assertOpen();
    const staging = new ByteQueue();
    while ((await this.read(staging, READ_CHUNK)) !== END_OF_STREAM) {
      // Drain to exhaustion; `read` already bounds each transfer and advances the cursor.
    }
    return staging.snapshot();
  }

  /** Exactly `count` bytes, or a failure — never a short result (IO-12). */
  async readExactly(count: number): Promise<Uint8Array> {
    assertCount(count);
    this.#assertOpen();
    // IO-9: refuse eagerly with an actionable error. Routing this through ByteQueue would raise
    // EndOfStreamError instead, since takeBytes checks its size before it ever tries to allocate.
    if (count > MAX_BYTE_ARRAY_LENGTH) {
      throw new AllocationLimitError(count, MAX_BYTE_ARRAY_LENGTH);
    }
    const staging = new ByteQueue();
    while (staging.size < count) {
      const read = await this.read(staging, count - staging.size);
      if (read === END_OF_STREAM) throw new EndOfStreamError(staging.size, count);
    }
    return staging.takeBytes(count);
  }

  /** Advance past exactly `count` bytes; `skip(0)` is a no-op even at end of stream (IO-15). */
  async skip(count: number): Promise<void> {
    assertCount(count);
    this.#assertOpen();
    if (count === 0) return;
    const staging = new ByteQueue();
    let skipped = 0;
    while (skipped < count) {
      const read = await this.read(staging, count - skipped);
      if (read === END_OF_STREAM) throw new EndOfStreamError(skipped, count);
      skipped += read;
      staging.clear();
    }
  }

  /**
   * IO-41: idempotent. A view releases only its own cursor and never closes its parent or moves the
   * parent's cursor (IO-22); the owning source closes the window, which invalidates every outstanding
   * view.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#ownsWindow) this.#window.close();
    else this.#window.release(this.#cursor);
    return Promise.resolve();
  }

  /** IO-42: a stream-backed source rejects reads after close, unlike an in-memory `ByteQueue`. */
  #assertOpen(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSource');
    this.#window.assertUsable();
  }

  #remainingBudget(): number {
    return this.#limit === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : this.#limit;
  }
}

/** How much a bulk drain asks for per iteration. Not a retention bound — `read` transfers, never buffers. */
const READ_CHUNK = 16 * 1024;

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${count}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/buffered-source.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/buffered-source.ts packages/core/src/io/buffered-source.test.ts
git commit -m "feat(core): add BufferedSource core reads (IO-1, IO-2, IO-3, IO-11, IO-12, IO-15, IO-41, IO-42)"
```

---

### Task 7: `BufferedSource` — text and line reads

**Files:**
- Modify: `packages/core/src/io/buffered-source.ts`
- Create: `packages/core/src/io/buffered-source.text.test.ts`

**Interfaces:**
- Consumes: Task 6's `BufferedSource`, Task 5's `RetentionWindow`.
- Produces: `readUtf8(count?: number): Promise<string>`, `readString(charset: string, count?: number):
  Promise<string>`, `readUtf8Line(): Promise<string | undefined>`, and one new `RetentionWindow` accessor,
  `availableFrom(cursor: Cursor): number`. Task 13's factories and Phase 6's SSE reader use these exact
  signatures.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/buffered-source.text.test.ts
// Exercises: IO-13 (UTF-8 and explicit-charset decode), IO-14 (line reads: \n and \r\n terminators,
// lone \r stays content, final unterminated line returned as-is, undefined when exhausted first)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from './buffered-source.js';
import {fakeReadableStream} from './test-support/fake-stream.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

/** Split `bytes` at the given cut points, so a terminator can straddle a chunk boundary. */
function chunkAt(bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] {
  const bounded = [...new Set(cuts.filter((c) => c > 0 && c < bytes.length))].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let previous = 0;
  for (const cut of bounded) {
    out.push(bytes.subarray(previous, cut));
    previous = cut;
  }
  out.push(bytes.subarray(previous));
  return out;
}

describe('BufferedSource text reads (IO-13)', () => {
  test('readUtf8 decodes non-ASCII text', async () => {
    expect(await sourceOver(utf8('héllo ☃')).readUtf8()).toBe('héllo ☃');
  });

  test('readUtf8 decodes across a chunk boundary that splits a multi-byte character', async () => {
    const encoded = utf8('☃');
    const source = sourceOver(encoded.subarray(0, 1), encoded.subarray(1));
    expect(await source.readUtf8()).toBe('☃');
  });

  test('readString decodes an explicit non-UTF-8 charset', async () => {
    // 0xE9 is é in ISO-8859-1 and invalid alone in UTF-8 — so this only passes if the charset is honored.
    const source = sourceOver(Uint8Array.from([0x68, 0xe9]));
    expect(await source.readString('iso-8859-1')).toBe('hé');
  });

  test('readString rejects an unknown charset label', async () => {
    await expect(sourceOver(utf8('x')).readString('not-a-charset')).rejects.toThrow(
      'unsupported charset: not-a-charset',
    );
  });
});

describe('BufferedSource line reads (IO-14)', () => {
  test('splits on \\n and consumes the terminator', async () => {
    const source = sourceOver(utf8('one\ntwo\n'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
    expect(await source.readUtf8Line()).toBeUndefined();
  });

  test('treats \\r\\n as a terminator and strips both bytes', async () => {
    const source = sourceOver(utf8('one\r\ntwo\r\n'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
  });

  test('keeps a lone \\r not followed by \\n as line content', async () => {
    const source = sourceOver(utf8('a\rb\n'));
    expect(await source.readUtf8Line()).toBe('a\rb');
  });

  test('returns a final unterminated line as-is', async () => {
    const source = sourceOver(utf8('one\ntwo'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
    expect(await source.readUtf8Line()).toBeUndefined();
  });

  test('returns undefined when exhausted before any byte', async () => {
    expect(await sourceOver().readUtf8Line()).toBeUndefined();
  });

  test('returns an empty string for an empty line', async () => {
    const source = sourceOver(utf8('\nx\n'));
    expect(await source.readUtf8Line()).toBe('');
    expect(await source.readUtf8Line()).toBe('x');
  });

  test('property: lines round-trip across adversarial chunk boundaries', async () => {
    // IO-14's rationale calls out surviving slice-window boundaries; hand-picked examples miss the case
    // where \r and \n land in different chunks, so the cut points are generated.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[a-z \r]*$/), {maxLength: 8}),
        fc.constantFrom('\n', '\r\n'),
        fc.array(fc.integer({min: 0, max: 64}), {maxLength: 8}),
        async (lines, terminator, cuts) => {
          const encoded = utf8(lines.map((line) => `${line}${terminator}`).join(''));
          const source = BufferedSource.overStream(fakeReadableStream(chunkAt(encoded, cuts)));

          const read: string[] = [];
          for (;;) {
            const line = await source.readUtf8Line();
            if (line === undefined) break;
            read.push(line);
          }
          // A line-content trailing \r merges with an appended \n into \r\n and is stripped by the
          // reader; with a \r\n terminator only the terminator's own \r is stripped, so a content \r
          // survives. The oracle mirrors exactly that rule.
          const expected = lines.map((line) =>
            terminator === '\n' ? line.replace(/\r$/, '') : line,
          );
          expect(read).toEqual(expected);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/buffered-source.text.test.ts`
Expected: FAIL — `source.readUtf8 is not a function`.

- [ ] **Step 3: Add the text methods to `buffered-source.ts`**

Add these four methods to the class, after `readExactly`:

```typescript
  /** Decode `count` bytes (or every remaining byte) as UTF-8 (IO-13). */
  async readUtf8(count?: number): Promise<string> {
    return this.readString('utf-8', count);
  }

  /** Decode `count` bytes (or every remaining byte) with an explicit charset (IO-13). */
  async readString(charset: string, count?: number): Promise<string> {
    this.#assertOpen();
    const decoder = decoderFor(charset);
    const raw = count === undefined ? await this.readBytes() : await this.readExactly(count);
    return decoder.decode(raw);
  }

  /**
   * The next line as UTF-8, with its terminator consumed (IO-14).
   *
   * Both `\n` and `\r\n` terminate. A lone `\r` not followed by `\n` stays line content, which falls out
   * of scanning only for `\n`. Returns the final unterminated line as-is, and `undefined` when the source
   * is exhausted before any byte — `undefined` rather than the spec's language-agnostic "null", per
   * styleguide 3.5.
   *
   * Scans with a NON-CONSUMING peek before reading, deliberately. Reading first and pushing back the
   * over-read cannot work: every read advances this cursor and `RetentionWindow.readInto` then trims the
   * queue head to the slowest cursor, so the bytes past the terminator are already discarded by the time
   * anything could rewind over them. Peeking leaves the cursor still, so the bytes stay retained, and the
   * subsequent `readExactly` consumes exactly the line plus its terminator.
   */
  async readUtf8Line(): Promise<string | undefined> {
    this.#assertOpen();
    const at = await this.#scanForNewline();
    if (at === END_OF_STREAM) {
      const rest = await this.readBytes();
      return rest.length === 0 ? undefined : new TextDecoder('utf-8').decode(rest);
    }
    const line = await this.readExactly(at + 1);
    const end = at > 0 && line[at - 1] === CARRIAGE_RETURN ? at - 1 : at;
    return new TextDecoder('utf-8').decode(line.subarray(0, end));
  }

  /**
   * Offset of the next `\n` relative to this cursor, or `END_OF_STREAM` if the source ends first.
   * Never advances the cursor. Retention grows by one line's length, which is what IO-14 requires and
   * all it requires.
   */
  async #scanForNewline(): Promise<number> {
    let searched = 0;
    for (;;) {
      const available = Math.min(this.#window.availableFrom(this.#cursor), this.#remainingBudget());
      if (available > searched) {
        const scanned = this.#window.peekBytes(this.#cursor, available);
        const found = scanned.indexOf(NEWLINE, searched);
        if (found >= 0) return found;
        searched = scanned.length;
      }
      if (searched >= this.#remainingBudget()) return END_OF_STREAM;
      if (!(await this.#window.pullThrough(this.#cursor.at + searched + 1))) return END_OF_STREAM;
    }
  }
```

Add these module-level helpers beside `assertCount`:

```typescript
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

function decoderFor(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset);
  } catch (e: unknown) {
    // A charset label reaching this layer is internal, so this is an argument error, not boundary
    // data. Phase 3b's HTTP-42 owns the "unknown declared charset falls back to UTF-8" rule.
    throw new IoError(`unsupported charset: ${charset}`, {cause: e});
  }
}
```

Add `IoError` to the imports from `./errors.js`, and add this accessor to `RetentionWindow` in
`retention-window.ts` so `#scanForNewline` can tell how much is already pulled without triggering a pull:

```typescript
  /** How many pulled bytes sit at or ahead of `cursor`. Does not pull and does not advance. */
  availableFrom(cursor: Cursor): number {
    this.assertUsable();
    return Math.max(0, this.#pulledThrough - cursor.at);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/buffered-source.text.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/buffered-source.ts packages/core/src/io/retention-window.ts \
        packages/core/src/io/buffered-source.text.test.ts
git commit -m "feat(core): add BufferedSource text and line reads (IO-13, IO-14)"
```

---

### Task 8: `BufferedSource` — peek and slice views

**Files:**
- Modify: `packages/core/src/io/buffered-source.ts`
- Create: `packages/core/src/io/buffered-source.views.test.ts`

**Interfaces:**
- Consumes: Tasks 6 and 7's `BufferedSource`.
- Produces: `peek(): BufferedSource`, `slice(offset: number, count: number): BufferedSource`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/buffered-source.views.test.ts
// Exercises: IO-19 (peek is non-consuming over the whole remaining source), IO-20 (bounded slice),
// IO-21 (lazy offset overflow, eager negative rejection), IO-22 (closing a slice does not close the
// parent; closing the parent invalidates slices), IO-23 (independence, additive composition),
// IO-24 (reading a closed slice is a state error, distinct from EOF)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from './buffered-source.js';
import {ClosedResourceError} from './errors.js';
import {fakeReadableStream} from './test-support/fake-stream.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

describe('BufferedSource views', () => {
  test('IO-19: reads from a peek do not advance the original cursor', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const peek = source.peek();
    expect([...(await peek.readBytes())]).toEqual([1, 2, 3]);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-20: a slice exposes at most count bytes starting offset ahead', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4, 5));
    const slice = source.slice(1, 3);
    expect([...(await slice.readBytes())]).toEqual([2, 3, 4]);
  });

  test('IO-20: reading past the window behaves as end-of-window, and never advances the parent', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    expect([...(await slice.readBytes())]).toEqual([1, 2]);
    expect([...(await slice.readBytes())]).toEqual([]);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-21: an offset past the source size succeeds at construction and reads as empty', async () => {
    const source = sourceOver(bytes(1, 2));
    const slice = source.slice(100, 4);
    expect([...(await slice.readBytes())]).toEqual([]);
  });

  test('IO-21: a negative offset or count is rejected eagerly at construction', () => {
    const source = sourceOver(bytes(1, 2));
    expect(() => source.slice(-1, 2)).toThrow('offset must be a non-negative integer, got -1');
    expect(() => source.slice(0, -2)).toThrow('count must be a non-negative integer, got -2');
  });

  test('IO-22: closing a slice neither closes the parent nor advances its cursor', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await slice.readBytes();
    await slice.close();
    expect(source.closed).toBe(false);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-22: closing the parent invalidates outstanding slices', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await source.close();
    await expect(slice.readBytes()).rejects.toThrow(ClosedResourceError);
  });

  test('IO-24: reading an explicitly closed slice fails loudly, distinct from a normal EOF', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await slice.close();
    await expect(slice.readBytes()).rejects.toThrow(ClosedResourceError);
  });

  test('IO-23: two slices of one source have independent cursors and budgets', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4));
    const first = source.slice(0, 2);
    const second = source.slice(2, 2);
    expect([...(await second.readBytes())]).toEqual([3, 4]);
    expect([...(await first.readBytes())]).toEqual([1, 2]);
  });

  test('IO-23: a slice of a slice composes offsets additively and caps at the outer remainder', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4, 5, 6));
    const outer = source.slice(1, 4); // 2,3,4,5
    const inner = outer.slice(1, 10); // starts at 3, capped to 3 bytes: 3,4,5
    expect([...(await inner.readBytes())]).toEqual([3, 4, 5]);
  });

  test('property: an arbitrary slice reads exactly the bytes at its window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({minLength: 1, maxLength: 64}),
        fc.integer({min: 0, max: 64}),
        fc.integer({min: 0, max: 64}),
        async (data, offset, count) => {
          const source = BufferedSource.overStream(fakeReadableStream([data]));
          const slice = source.slice(offset, count);
          const expected = [...data.subarray(offset, offset + count)];
          expect([...(await slice.readBytes())]).toEqual(expected);
        },
      ),
    );
  });

  test('property: no view read advances any other view or the parent', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({minLength: 1, maxLength: 32}), async (data) => {
        const source = BufferedSource.overStream(fakeReadableStream([data]));
        const first = source.peek();
        const second = source.peek();
        await first.readBytes();
        expect([...(await second.readBytes())]).toEqual([...data]);
        expect([...(await source.readBytes())]).toEqual([...data]);
      }),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/buffered-source.views.test.ts`
Expected: FAIL — `source.peek is not a function`.

- [ ] **Step 3: Add `peek` and `slice` to `buffered-source.ts`**

Add these two methods to the class, after `skip`:

```typescript
  /**
   * A non-consuming view over the whole remaining source (IO-19). Reads from it never advance this
   * source's cursor.
   *
   * Deliberately uncapped: §5 bounds nothing, and every buffering cap the product spec mandates lives in
   * §6 (Phase 3b). See `RetentionWindow` for why a cap here would partially fail IO-19.
   */
  peek(): BufferedSource {
    this.#assertOpen();
    return new BufferedSource(
      this.#window,
      this.#window.register(this.#cursor.at),
      false,
      this.#remainingBudget(),
    );
  }

  /**
   * A non-consuming, length-bounded view exposing at most `count` bytes starting `offset` ahead of this
   * cursor (IO-20).
   *
   * Offset overflow is detected LAZILY — an offset past the source size constructs fine and surfaces as
   * an empty read (IO-21) — because callers may slice speculatively before the body length is known. A
   * negative offset or count is rejected eagerly. A slice of a slice composes additively and caps at the
   * outer slice's remaining budget (IO-23).
   */
  slice(offset: number, count: number): BufferedSource {
    invariant(
      Number.isInteger(offset) && offset >= 0,
      `offset must be a non-negative integer, got ${offset}`,
    );
    assertCount(count);
    this.#assertOpen();
    const budget = Math.max(0, Math.min(count, this.#remainingBudget() - offset));
    return new BufferedSource(
      this.#window,
      this.#window.register(this.#cursor.at + offset),
      false,
      budget,
    );
  }
```

Replace `#remainingBudget()` from Task 6 — the budget must now shrink as a view reads:

```typescript
  #remainingBudget(): number {
    if (this.#limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.#limit - (this.#cursor.at - this.#startedAt));
  }
```

Add the `#startedAt` field and set it in the constructor:

```typescript
  readonly #startedAt: number;

  private constructor(window: RetentionWindow, cursor: Cursor, ownsWindow: boolean, limit: number) {
    this.#window = window;
    this.#cursor = cursor;
    this.#ownsWindow = ownsWindow;
    this.#limit = limit;
    this.#startedAt = cursor.at;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/buffered-source.views.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole source suite to confirm no regression**

Run: `cd packages/core && bun test src/io/`
Expected: PASS, every test from Tasks 1–8.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/io/buffered-source.ts packages/core/src/io/buffered-source.views.test.ts
git commit -m "feat(core): add BufferedSource peek and slice views (IO-19, IO-20, IO-21, IO-22, IO-23, IO-24)"
```

---

### Task 9: `BufferedSink`

**Files:**
- Create: `packages/core/src/io/buffered-sink.ts`
- Create: `packages/core/src/io/buffered-sink.test.ts`

**Interfaces:**
- Consumes: `ByteQueue`, `ClosedResourceError`, `IoError`.
- Produces: `class BufferedSink` with `static overStream(stream: WritableStream<Uint8Array>): BufferedSink`,
  `write(src: ByteQueue, count: number): Promise<void>`, `writeUtf8(text: string): Promise<void>`,
  `writeString(text: string, charset: string): Promise<void>`, `flush(): Promise<BufferedSink>`,
  `emit(): Promise<BufferedSink>`, `close(): Promise<void>`, `get closed(): boolean`. Tasks 10, 11, 12, 13
  use these.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/buffered-sink.test.ts
// Exercises: IO-4 (exact head removal, no partial write), IO-5 (flush, closeable),
// IO-13 (symmetric write-side encodings), IO-18 (emit vs flush), IO-41 (idempotent close),
// IO-42 (rejects after close), IO-6 (wrapper owns the caller's stream)
import {describe, expect, test} from 'bun:test';
import {BufferedSink} from './buffered-sink.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import {collectingWritableStream} from './test-support/fake-stream.js';

const queueOf = (...values: number[]): ByteQueue => {
  const queue = new ByteQueue();
  queue.writeBytes(Uint8Array.from(values));
  return queue;
};

describe('BufferedSink', () => {
  test('IO-4: write removes exactly the requested count from the source head', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const source = queueOf(1, 2, 3, 4);
    await sink.write(source, 3);
    await sink.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect(source.size).toBe(1);
  });

  test('IO-4: writing more than the source holds throws and transfers nothing', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const source = queueOf(1, 2);
    await expect(sink.write(source, 3)).rejects.toThrow(EndOfStreamError);
    await sink.close();
    expect([...written()]).toEqual([]);
    expect(source.size).toBe(2);
  });

  test('IO-13: writeUtf8 encodes non-ASCII text symmetrically with the read side', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.writeUtf8('héllo ☃');
    await sink.close();
    expect(new TextDecoder('utf-8').decode(written())).toBe('héllo ☃');
  });

  test('IO-13: writeString encodes ISO-8859-1', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.writeString('hé', 'iso-8859-1');
    await sink.close();
    expect([...written()]).toEqual([0x68, 0xe9]);
  });

  test('IO-13: writeString rejects a code point ISO-8859-1 cannot represent', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await expect(sink.writeString('☃', 'iso-8859-1')).rejects.toThrow(
      'code point 9731 is not representable in iso-8859-1',
    );
  });

  test('IO-13: writeString rejects a charset the write side cannot encode', async () => {
    // TextEncoder is UTF-8-only and SEAM-1 forbids an encoding dependency, so the write side covers
    // exactly UTF-8 and ISO-8859-1. Anything else throws rather than silently re-encoding as UTF-8.
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await expect(sink.writeString('x', 'shift_jis')).rejects.toThrow(
      'unsupported write charset: shift_jis (only utf-8 and iso-8859-1 can be encoded)',
    );
  });

  test('IO-18: flush and emit both return the sink for chaining', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    expect(await sink.emit()).toBe(sink);
    expect(await sink.flush()).toBe(sink);
    await sink.close();
  });

  test('IO-41: close is idempotent', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    await sink.close();
    expect(sink.closed).toBe(true);
  });

  test('IO-42: write, flush, and emit all reject after close', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    await expect(sink.write(queueOf(1), 1)).rejects.toThrow(ClosedResourceError);
    await expect(sink.flush()).rejects.toThrow(ClosedResourceError);
    await expect(sink.emit()).rejects.toThrow(ClosedResourceError);
  });

  test('IO-6: closing the sink closes the caller stream it took ownership of', async () => {
    const {stream, isClosed} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    await sink.close();
    expect(isClosed()).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/buffered-sink.test.ts`
Expected: FAIL — `Cannot find module './buffered-sink.js'`.

- [ ] **Step 3: Write `buffered-sink.ts`**

```typescript
// packages/core/src/io/buffered-sink.ts
import {invariant} from '../invariant.js';
import type {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, IoError} from './errors.js';

/**
 * A buffered byte sink over a `WritableStream<Uint8Array>` (IO-4, IO-5, IO-13, IO-18).
 *
 * Takes no `AbortSignal` and imposes no timeout (IO-40). Not safe for concurrent use (IO-37).
 *
 * @internal
 */
export class BufferedSink {
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  #closed = false;

  private constructor(writer: WritableStreamDefaultWriter<Uint8Array>) {
    this.#writer = writer;
  }

  /** Wrap a caller-supplied stream (IO-30). */
  static overStream(stream: WritableStream<Uint8Array>): BufferedSink {
    return new BufferedSink(stream.getWriter());
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Remove exactly `count` bytes from `src`'s head and push them downstream (IO-4). Fails rather than
   * writing a partial amount when `src` holds fewer.
   */
  async write(src: ByteQueue, count: number): Promise<void> {
    assertCount(count);
    this.#assertOpen();
    if (count === 0) return;
    // takeBytes raises EndOfStreamError when the source is short, before anything reaches the wire.
    const payload = src.takeBytes(count);
    await this.#writer.write(payload);
  }

  /** Encode and write UTF-8 text (IO-13). */
  async writeUtf8(text: string): Promise<void> {
    return this.writeString(text, 'utf-8');
  }

  /**
   * Encode and write text with an explicit charset (IO-13).
   *
   * The write side supports UTF-8 and ISO-8859-1 only. `TextEncoder` is UTF-8-only — there is no
   * `TextEncoder('iso-8859-1')` — and SEAM-1 forbids an encoding dependency, so full symmetry with the
   * read side is not reachable. These are the two encodings HTTP needs, and IO-13's own conformance note
   * names ISO-8859-1. Any other label throws rather than silently re-encoding as UTF-8, which would
   * corrupt the bytes on the wire.
   */
  async writeString(text: string, charset: string): Promise<void> {
    this.#assertOpen();
    await this.#writer.write(encodeText(text, charset));
  }

  /** IO-18: a full force-out toward the destination. */
  async flush(): Promise<BufferedSink> {
    this.#assertOpen();
    await this.#writer.ready;
    return this;
  }

  /** IO-18: a cheap one-level handoff, distinguished from `flush`. */
  async emit(): Promise<BufferedSink> {
    this.#assertOpen();
    return Promise.resolve(this);
  }

  /** IO-5, IO-41: closeable and idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#writer.close();
  }

  /** IO-42: a stream-backed sink rejects writes, flushes, and emits after close. */
  #assertOpen(): void {
    if (this.#closed) throw new ClosedResourceError('BufferedSink');
  }
}

/**
 * The single source of truth for write-side encoding (IO-13).
 *
 * Exported because `TeeSink` must mirror the exact bytes this sink will emit. A second copy there would
 * be two implementations of one encoding rule, free to drift — the same DRY hazard that had the RFC 3986
 * encoder extracted in Phase 2. Keeping the charset *rejection* here too means `TeeSink` cannot
 * accidentally accept a label the primary would refuse.
 *
 * ISO-8859-1 is a direct code-point-to-byte map for 0–255; anything above is not representable.
 */
export function encodeText(text: string, charset: string): Uint8Array {
  const normalized = charset.toLowerCase();
  if (normalized === 'utf-8' || normalized === 'utf8') return new TextEncoder().encode(text);
  if (normalized !== 'iso-8859-1' && normalized !== 'latin1') {
    throw new IoError(
      `unsupported write charset: ${charset} (only utf-8 and iso-8859-1 can be encoded)`,
    );
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new IoError(`code point ${code} is not representable in ${charset}`);
    }
    out[i] = code;
  }
  return out;
}

function assertCount(count: number): void {
  invariant(
    Number.isInteger(count) && count >= 0,
    `count must be a non-negative integer, got ${count}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/buffered-sink.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/buffered-sink.ts packages/core/src/io/buffered-sink.test.ts
git commit -m "feat(core): add BufferedSink (IO-4, IO-5, IO-13, IO-18, IO-41, IO-42)"
```

---

### Task 10: `TeeSink`

**Files:**
- Create: `packages/core/src/io/tee-sink.ts`
- Create: `packages/core/src/io/tee-sink.test.ts`

**Interfaces:**
- Consumes: `BufferedSink` (Task 9), `ByteQueue`, `IoError`.
- Produces: `class TeeSink` with `constructor(primary: BufferedSink, tapLimit?: number)`, `write(src:
  ByteQueue, count: number): Promise<void>`, `writeUtf8(text: string): Promise<void>`, `writeString(text:
  string, charset: string): Promise<void>`, `snapshot(): Uint8Array`, `flush(): Promise<TeeSink>`,
  `emit(): Promise<TeeSink>`, `close(): Promise<void>`, `get buffer(): never`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/tee-sink.test.ts
// Exercises: IO-25 (mirror into a tap AND forward the full untruncated payload),
// IO-26 (tap capacity limit; unbounded default; a limit of 0 mirrors nothing),
// IO-27 (mirror BEFORE forwarding; staging cleared even on a failed write),
// IO-28 (no direct backing-buffer handle), IO-29 (flush/close/emit forward to the primary only),
// IO-42 (write after close rejects with the source intact)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSink} from './buffered-sink.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError} from './errors.js';
import {TeeSink} from './tee-sink.js';
import {collectingWritableStream, failingWritableStream} from './test-support/fake-stream.js';

const queueOf = (bytes: Uint8Array): ByteQueue => {
  const queue = new ByteQueue();
  queue.writeBytes(bytes);
  return queue;
};

describe('TeeSink', () => {
  test('IO-25: the primary receives the full payload and the tap mirrors it', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect([...tee.snapshot()]).toEqual([1, 2, 3]);
  });

  test('IO-26: past the tap limit the tap stops copying but the primary still gets everything', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 2);
    await tee.write(queueOf(Uint8Array.from([1, 2, 3, 4, 5])), 5);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
    expect([...tee.snapshot()]).toEqual([1, 2]);
  });

  test('IO-26: a limit of 0 mirrors nothing and forwards everything', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream), 0);
    await tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
    expect([...tee.snapshot()]).toEqual([]);
  });

  test('IO-26: the default limit mirrors everything', async () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(new Uint8Array(10_000).fill(7)), 10_000);
    await tee.close();
    expect(tee.snapshot().length).toBe(10_000);
  });

  test('IO-27: a failed primary write still captures the attempted bytes in the tap', async () => {
    const tee = new TeeSink(BufferedSink.overStream(failingWritableStream('primary down')));
    await expect(tee.write(queueOf(Uint8Array.from([1, 2, 3])), 3)).rejects.toThrow('primary down');
    await Promise.resolve();
    expect([...tee.snapshot()]).toEqual([1, 2, 3]);
  });

  test('IO-27: a write following a FAILED write does not prepend the failed write\'s bytes', async () => {
    // The staging buffer is per-call, so this holds structurally — but the assertion has to actually
    // drive the failure path to prove it, which is why the first sink is the failing one.
    const failing = new TeeSink(BufferedSink.overStream(failingWritableStream('primary down')));
    await expect(failing.write(queueOf(Uint8Array.from([1, 2])), 2)).rejects.toThrow('primary down');

    const {stream, written} = collectingWritableStream();
    const good = new TeeSink(BufferedSink.overStream(stream));
    await good.write(queueOf(Uint8Array.from([3])), 1);
    await good.close();
    expect([...written()]).toEqual([3]);
  });

  test('IO-27: consecutive successful writes concatenate without duplication or reordering', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2])), 2);
    await tee.write(queueOf(Uint8Array.from([3])), 1);
    await tee.close();
    expect([...written()]).toEqual([1, 2, 3]);
  });

  test('IO-28: there is no direct backing-buffer handle', () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    expect(() => tee.buffer).toThrow(
      'TeeSink exposes no backing buffer; use the typed write methods',
    );
  });

  test('IO-29: close forwards to the primary and leaves the tap intact for later snapshotting', async () => {
    const {stream, written} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.write(queueOf(Uint8Array.from([1, 2])), 2);
    await tee.close();
    expect([...written()]).toEqual([1, 2]);
    expect([...tee.snapshot()]).toEqual([1, 2]);
  });

  test('IO-42: write after close rejects and leaves the source intact', async () => {
    const {stream} = collectingWritableStream();
    const tee = new TeeSink(BufferedSink.overStream(stream));
    await tee.close();
    const source = queueOf(Uint8Array.from([1, 2]));
    await expect(tee.write(source, 2)).rejects.toThrow(ClosedResourceError);
    expect(source.size).toBe(2);
    expect([...tee.snapshot()]).toEqual([]);
  });

  test('IO-25 property: the primary always receives the exact concatenation of every written byte', async () => {
    // The single most important property in §5: logging never reduces the wire body, whatever the cap.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({maxLength: 32}), {maxLength: 8}),
        fc.integer({min: 0, max: 64}),
        async (writes, tapLimit) => {
          const {stream, written} = collectingWritableStream();
          const tee = new TeeSink(BufferedSink.overStream(stream), tapLimit);
          for (const chunk of writes) await tee.write(queueOf(chunk), chunk.length);
          await tee.close();

          const expected = writes.flatMap((chunk) => [...chunk]);
          expect([...written()]).toEqual(expected);
          expect(tee.snapshot().length).toBe(Math.min(tapLimit, expected.length));
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/tee-sink.test.ts`
Expected: FAIL — `Cannot find module './tee-sink.js'`.

- [ ] **Step 3: Write `tee-sink.ts`**

```typescript
// packages/core/src/io/tee-sink.ts
import {invariant} from '../invariant.js';
import {encodeText, type BufferedSink} from './buffered-sink.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, IoError} from './errors.js';

/**
 * A sink that mirrors written bytes into a bounded in-memory tap while forwarding the full, untruncated
 * payload to its primary (IO-25–IO-29).
 *
 * Built as a plain `BufferedSink` decorator rather than on `TransformStream`, which `sdk-design/03` §3.1
 * sketches: a `TransformStream`'s own queueing and backpressure semantics muddy IO-27's
 * mirror-before-forward ordering, the clause most easily gotten wrong. §3.1's substantive point — that
 * the platform's `ReadableStream.tee()` solves a different problem (duplicating a *readable* for two
 * consumers, not mirroring a *sink's* writes) — is why no platform primitive is used at all.
 *
 * The tap has no cap by default. §5 bounds nothing; BODY-19 and BODY-34 set the real cap in Phase 3b.
 *
 * @internal
 */
export class TeeSink {
  readonly #primary: BufferedSink;
  readonly #tap = new ByteQueue();
  readonly #tapLimit: number;

  constructor(primary: BufferedSink, tapLimit: number = Number.POSITIVE_INFINITY) {
    invariant(tapLimit >= 0, `tapLimit must be non-negative, got ${tapLimit}`);
    this.#primary = primary;
    this.#tapLimit = tapLimit;
  }

  /**
   * IO-28: a raw buffer write would reach only the tap or only the primary and silently corrupt the wire
   * body, so no such handle exists.
   */
  get buffer(): never {
    throw new IoError('TeeSink exposes no backing buffer; use the typed write methods');
  }

  /** Mirror into the tap, then forward the full payload to the primary (IO-25, IO-27). */
  async write(src: ByteQueue, count: number): Promise<void> {
    // IO-42: reject before consuming from `src` or touching the tap, so a caller that catches the
    // rejection still holds its bytes — matching BufferedSink, which rejects before takeBytes.
    if (this.#primary.closed) throw new ClosedResourceError('TeeSink');
    const staging = new ByteQueue();
    staging.write(src, count);
    // IO-27: mirror BEFORE forwarding, so a failed primary write still captures the attempted bytes.
    this.#mirror(staging);
    // IO-27: staging is drained by the forward, so a later write cannot prepend stale bytes; the
    // `finally` guarantees that holds even when the primary throws.
    try {
      await this.#primary.write(staging, count);
    } finally {
      staging.clear();
    }
  }

  /** Mirror and forward UTF-8 text (IO-25). */
  async writeUtf8(text: string): Promise<void> {
    return this.writeString(text, 'utf-8');
  }

  /**
   * Mirror and forward text with an explicit charset (IO-25).
   *
   * Encodes once, through the sink's own `encodeText`, then routes the bytes down the normal `write`
   * path. That guarantees the tap mirrors exactly the bytes the primary emits — not a UTF-8 re-encoding
   * of them — and that an unsupported charset is refused identically on both sides.
   */
  async writeString(text: string, charset: string): Promise<void> {
    const encoded = new ByteQueue();
    encoded.writeBytes(encodeText(text, charset));
    return this.write(encoded, encoded.size);
  }

  /** A non-consuming copy of the tap's contents. */
  snapshot(): Uint8Array {
    return this.#tap.snapshot();
  }

  /** IO-29: forwards to the PRIMARY only, leaving the tap intact. */
  async flush(): Promise<TeeSink> {
    await this.#primary.flush();
    return this;
  }

  /** IO-29: forwards to the PRIMARY only, leaving the tap intact. */
  async emit(): Promise<TeeSink> {
    await this.#primary.emit();
    return this;
  }

  /** IO-29: forwards to the PRIMARY only; the tap survives for later snapshotting. */
  async close(): Promise<void> {
    await this.#primary.close();
  }

  /** IO-26: copy until the cap is reached, then stop copying while the payload still forwards. */
  #mirror(staging: ByteQueue): void {
    const room = this.#tapLimit - this.#tap.size;
    if (room <= 0) return;
    staging.copyTo(this.#tap, 0, Math.min(room, staging.size));
  }
}

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/tee-sink.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/tee-sink.ts packages/core/src/io/tee-sink.test.ts
git commit -m "feat(core): add TeeSink (IO-25, IO-26, IO-27, IO-28, IO-29)"
```

---

### Task 11: `writeAll` pump

**Files:**
- Create: `packages/core/src/io/pump.ts`
- Create: `packages/core/src/io/pump.test.ts`

**Interfaces:**
- Consumes: `BufferedSource` (Tasks 6–8), `BufferedSink` (Task 9), `ByteQueue`, `END_OF_STREAM`,
  `SourceContractViolationError`.
- Produces: `writeAll(source: BufferedSource, sink: BufferedSink): Promise<number>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/pump.test.ts
// Exercises: IO-17 (pump to exhaustion, terminate only on the EOF sentinel, raise a zero-read for a
// positive request as a source-contract violation)
import {describe, expect, test} from 'bun:test';
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {SourceContractViolationError} from './errors.js';
import {writeAll} from './pump.js';
import {
  collectingWritableStream,
  fakeReadableStream,
  protocolViolatingStream,
} from './test-support/fake-stream.js';

describe('writeAll (IO-17)', () => {
  test('pumps the source to exhaustion and returns the total transferred', async () => {
    const source = BufferedSource.overStream(
      fakeReadableStream([Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])]),
    );
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);

    expect(await writeAll(source, sink)).toBe(5);
    await sink.close();
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
  });

  test('an already-exhausted source transfers zero and does not hang', async () => {
    const source = BufferedSource.overStream(fakeReadableStream([]));
    const {stream} = collectingWritableStream();
    expect(await writeAll(source, BufferedSink.overStream(stream))).toBe(0);
  });

  test('a source returning zero bytes for a positive request is a contract violation', async () => {
    // Never tolerated as end-of-stream, and never spun on forever — a misbehaving foreign source must
    // fail loudly rather than hang or truncate a body.
    const source = BufferedSource.overStream(protocolViolatingStream());
    const {stream} = collectingWritableStream();
    await expect(writeAll(source, BufferedSink.overStream(stream))).rejects.toThrow(
      SourceContractViolationError,
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/pump.test.ts`
Expected: FAIL — `Cannot find module './pump.js'`.

- [ ] **Step 3: Write `pump.ts`**

```typescript
// packages/core/src/io/pump.ts
import type {BufferedSink} from './buffered-sink.js';
import type {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {END_OF_STREAM} from './limits.js';

/** How much the pump asks for per iteration. */
const PUMP_CHUNK = 16 * 1024;

/**
 * Pump `source` to exhaustion into `sink` and return the total bytes transferred (IO-17).
 *
 * Terminates only on the end-of-stream sentinel. A zero-byte read for a non-zero requested count is a
 * source-contract violation raised by the source itself — never tolerated here as end-of-stream, and
 * never spun on.
 *
 * @internal
 */
export async function writeAll(source: BufferedSource, sink: BufferedSink): Promise<number> {
  const staging = new ByteQueue();
  let total = 0;
  for (;;) {
    const read = await source.read(staging, PUMP_CHUNK);
    if (read === END_OF_STREAM) return total;
    await sink.write(staging, staging.size);
    total += read;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/pump.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/io/pump.ts packages/core/src/io/pump.test.ts
git commit -m "feat(core): add writeAll pump (IO-17)"
```

---

### Task 12: `IO-16` host-native stream bridges

**Files:**
- Modify: `packages/core/src/io/buffered-source.ts`
- Modify: `packages/core/src/io/buffered-sink.ts`
- Modify: `packages/core/src/io/buffered-source.test.ts`
- Modify: `packages/core/src/io/buffered-sink.test.ts`

**Interfaces:**
- Consumes: Tasks 6–9.
- Produces: `BufferedSource.toReadableStream(): ReadableStream<Uint8Array>` and
  `BufferedSink.toWritableStream(): WritableStream<Uint8Array>`.

- [ ] **Step 1: Add the failing tests**

Append to `packages/core/src/io/buffered-source.test.ts`:

```typescript
describe('BufferedSource host-native bridge (IO-16)', () => {
  test('toReadableStream yields the remaining bytes', async () => {
    const source = sourceOver(bytes(1, 2), bytes(3));
    const collected: number[] = [];
    for await (const chunk of source.toReadableStream()) collected.push(...chunk);
    expect(collected).toEqual([1, 2, 3]);
  });

  test('closing the bridge closes the owning source', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const stream = source.toReadableStream();
    await stream.cancel();
    expect(source.closed).toBe(true);
  });
});
```

Append to `packages/core/src/io/buffered-sink.test.ts`:

```typescript
describe('BufferedSink host-native bridge (IO-16)', () => {
  test('toWritableStream forwards written chunks', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const bridge = sink.toWritableStream();
    const writer = bridge.getWriter();
    await writer.write(Uint8Array.from([1, 2]));
    await writer.close();
    expect([...written()]).toEqual([1, 2]);
  });

  test('closing the bridge closes the sink', async () => {
    const {stream} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);
    const writer = sink.toWritableStream().getWriter();
    await writer.close();
    expect(sink.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd packages/core && bun test src/io/buffered-source.test.ts src/io/buffered-sink.test.ts`
Expected: FAIL — `source.toReadableStream is not a function`.

- [ ] **Step 3: Add the bridge to `buffered-source.ts`**

```typescript
  /**
   * A read-only host-native byte-stream bridge (IO-16). Closing the bridge closes the owning source.
   *
   * For this port the host-native byte stream IS `ReadableStream` — that is `sdk-design/03` §3.1's whole
   * premise, and it keeps core free of any `node:` import. A consumer wanting a Node `Readable` calls
   * `Readable.fromWeb()` at their own edge.
   */
  toReadableStream(): ReadableStream<Uint8Array> {
    const source = this;
    return new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        const staging = new ByteQueue();
        const read = await source.read(staging, BRIDGE_CHUNK);
        if (read === END_OF_STREAM) {
          controller.close();
          await source.close();
          return;
        }
        controller.enqueue(staging.snapshot());
      },
      async cancel(): Promise<void> {
        await source.close();
      },
    });
  }
```

Add the constant beside `READ_CHUNK`:

```typescript
const BRIDGE_CHUNK = 16 * 1024;
```

- [ ] **Step 4: Add the bridge to `buffered-sink.ts`**

```typescript
  /**
   * A writable host-native byte-stream bridge (IO-16). Closing the bridge closes the sink.
   */
  toWritableStream(): WritableStream<Uint8Array> {
    const sink = this;
    return new WritableStream<Uint8Array>({
      async write(chunk): Promise<void> {
        const staging = new ByteQueue();
        staging.writeBytes(chunk);
        await sink.write(staging, staging.size);
      },
      async close(): Promise<void> {
        await sink.close();
      },
      async abort(): Promise<void> {
        await sink.close();
      },
    });
  }
```

Change the `ByteQueue` import in `buffered-sink.ts` from a type-only import to a value import, since the bridge
now constructs one:

```typescript
import {ByteQueue} from './byte-queue.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test src/io/buffered-source.test.ts src/io/buffered-sink.test.ts`
Expected: PASS, 19 + 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/io/buffered-source.ts packages/core/src/io/buffered-sink.ts \
        packages/core/src/io/buffered-source.test.ts packages/core/src/io/buffered-sink.test.ts
git commit -m "feat(core): add Web Streams host-native bridges (IO-16)"
```

---

### Task 13: Factories, internal barrel, bench, and full gate verification

**Files:**
- Create: `packages/core/src/io/factories.ts`
- Create: `packages/core/src/io/factories.test.ts`
- Create: `packages/core/src/io/index.ts`
- Create: `packages/core/src/io/byte-queue.bench.ts`
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: every preceding task.
- Produces: `newByteQueue()`, `bufferedSourceOverStream(stream)`, `bufferedSourceOverBytes(bytes)`,
  `bufferedSinkOverStream(stream)`, `bufferedSourceOverPrimitive(source)`,
  `bufferedSinkOverPrimitive(sink)`, the `PrimitiveSource`/`PrimitiveSink` interfaces, and the
  `src/io/index.ts` internal barrel. Phase 3b imports from `./io/index.js`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/io/factories.test.ts
// Exercises: IO-30 (factory half — fresh, independent, empty buffers; stream, byte-array, and
// foreign-primitive wrapping; the byte-array source is an independent copy), IO-17 (a primitive
// source returning 0 for a positive request fails loudly)
import {describe, expect, test} from 'bun:test';
import {SourceContractViolationError} from './errors.js';
import {
  bufferedSinkOverPrimitive,
  bufferedSinkOverStream,
  bufferedSourceOverBytes,
  bufferedSourceOverPrimitive,
  bufferedSourceOverStream,
  newByteQueue,
} from './factories.js';
import {collectingWritableStream, fakeReadableStream} from './test-support/fake-stream.js';

describe('IO-30 factories', () => {
  test('two buffers are distinct and both empty', () => {
    const first = newByteQueue();
    const second = newByteQueue();
    expect(first).not.toBe(second);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
  });

  test('buffers are independent — writing to one does not affect the other', () => {
    const first = newByteQueue();
    const second = newByteQueue();
    first.writeBytes(Uint8Array.from([1, 2]));
    expect(second.size).toBe(0);
  });

  test('wrapping a byte array then mutating the input leaves the source unchanged', async () => {
    const input = Uint8Array.from([1, 2, 3]);
    const source = bufferedSourceOverBytes(input);
    input[0] = 99;
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('wrapping a caller stream produces a readable source', async () => {
    const source = bufferedSourceOverStream(fakeReadableStream([Uint8Array.from([7, 8])]));
    expect([...(await source.readBytes())]).toEqual([7, 8]);
  });

  test('wrapping a caller stream produces a writable sink', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = bufferedSinkOverStream(stream);
    await sink.writeUtf8('hi');
    await sink.close();
    expect(new TextDecoder().decode(written())).toBe('hi');
  });

  test('wrapping a foreign primitive source supplies the typed reads', async () => {
    const backing = newByteQueue();
    backing.writeBytes(Uint8Array.from([1, 2, 3]));
    const source = bufferedSourceOverPrimitive({
      read: (dest, count) => backing.read(dest, count),
    });
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-17: a primitive source returning 0 for a positive request fails loudly', async () => {
    const source = bufferedSourceOverPrimitive({read: () => 0});
    await expect(source.readBytes()).rejects.toThrow(SourceContractViolationError);
  });

  test('wrapping a foreign primitive sink supplies the typed writes', async () => {
    const collected = newByteQueue();
    const sink = bufferedSinkOverPrimitive({
      write: (src, count) => {
        collected.write(src, count);
      },
    });
    await sink.writeUtf8('hi');
    await sink.close();
    expect(new TextDecoder().decode(collected.snapshot())).toBe('hi');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/io/factories.test.ts`
Expected: FAIL — `Cannot find module './factories.js'`.

- [ ] **Step 3: Write `factories.ts`**

```typescript
// packages/core/src/io/factories.ts
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {SourceContractViolationError} from './errors.js';
import {END_OF_STREAM} from './limits.js';

/**
 * IO-30's factory half. Named free functions rather than a namespace object, so the module stays
 * tree-shakeable (styleguide 10.1, 15.9).
 *
 * IO-30's provider-*resolution* half — install precedence, idempotent install, caching, warning,
 * de-duplication, and the IO-31–IO-36 rules it defers to — is deliberately not built. There is one
 * implementation, always present, requiring no installation call; `sdk-design/03` §3.1 derives this in
 * full, and it is the same permanent simplification as SEAM-5–SEAM-10.
 *
 * @internal
 */

/** A fresh, independent, empty buffer (IO-30). */
export function newByteQueue(): ByteQueue {
  return new ByteQueue();
}

/** Wrap a caller stream as a buffered source (IO-30). */
export function bufferedSourceOverStream(stream: ReadableStream<Uint8Array>): BufferedSource {
  return BufferedSource.overStream(stream);
}

/** Wrap a byte array as a buffered source over an independent copy (IO-30). */
export function bufferedSourceOverBytes(bytes: Uint8Array): BufferedSource {
  return BufferedSource.overBytes(bytes);
}

/** Wrap a caller stream as a buffered sink (IO-30). */
export function bufferedSinkOverStream(stream: WritableStream<Uint8Array>): BufferedSink {
  return BufferedSink.overStream(stream);
}

/**
 * The raw read protocol of IO-1 — append up to `count` bytes to `dest`'s tail, return the number
 * transferred or `END_OF_STREAM` — with none of the typed reads, views, or line semantics. What a
 * "foreign primitive" source implements.
 */
export interface PrimitiveSource {
  read(dest: ByteQueue, count: number): Promise<number> | number;
}

/** The raw write protocol of IO-4 — remove exactly `count` bytes from `src`'s head, push downstream. */
export interface PrimitiveSink {
  write(src: ByteQueue, count: number): Promise<void> | void;
}

/** How much the primitive-source adapter asks for per pull. */
const PRIMITIVE_CHUNK = 16 * 1024;

/** Wrap a foreign primitive source with the typed buffered surface (IO-30). */
export function bufferedSourceOverPrimitive(source: PrimitiveSource): BufferedSource {
  const staging = new ByteQueue();
  return BufferedSource.overStream(
    new ReadableStream<Uint8Array>({
      async pull(controller): Promise<void> {
        const read = await source.read(staging, PRIMITIVE_CHUNK);
        if (read === END_OF_STREAM) {
          controller.close();
          return;
        }
        if (read === 0) {
          // IO-17: a zero-byte read for a positive request is a source-contract violation — never
          // tolerated as end-of-stream, never spun on.
          throw new SourceContractViolationError(
            'foreign source returned 0 bytes for a positive request',
          );
        }
        controller.enqueue(staging.takeBytes(read));
      },
    }),
  );
}

/** Wrap a foreign primitive sink with the typed buffered surface (IO-30). */
export function bufferedSinkOverPrimitive(sink: PrimitiveSink): BufferedSink {
  return BufferedSink.overStream(
    new WritableStream<Uint8Array>({
      async write(chunk): Promise<void> {
        const staging = new ByteQueue();
        staging.writeBytes(chunk);
        await sink.write(staging, staging.size);
      },
    }),
  );
}
```

- [ ] **Step 4: Write the internal barrel**

```typescript
// packages/core/src/io/index.ts
// Internal barrel for product-spec §5 (IO-1–IO-42).
//
// NOTHING here is re-exported from packages/core/src/index.ts. Every symbol is @internal, kept out of
// the api-extractor surface so Phase 3b can promote deliberately (styleguide 10.3) — or not at all, if
// it shapes BODY-1's write-to-sink around the platform's WritableStream instead of BufferedSink.
export {BufferedSink} from './buffered-sink.js';
export {BufferedSource} from './buffered-source.js';
export {ByteQueue} from './byte-queue.js';
export {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  SourceContractViolationError,
} from './errors.js';
export {
  bufferedSinkOverPrimitive,
  bufferedSinkOverStream,
  bufferedSourceOverBytes,
  bufferedSourceOverPrimitive,
  bufferedSourceOverStream,
  newByteQueue,
  type PrimitiveSink,
  type PrimitiveSource,
} from './factories.js';
export {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';
export {writeAll} from './pump.js';
export {RetentionWindow, type Cursor} from './retention-window.js';
export {TeeSink} from './tee-sink.js';
```

- [ ] **Step 5: Add `mitata` and write the baseline bench**

Add one line to the root `package.json` `devDependencies`, keeping every existing entry:

```jsonc
    "mitata": "^1",
```

```typescript
// packages/core/src/io/byte-queue.bench.ts
// Baseline only — no optimization has been applied and none is justified yet (styleguide 15.1, 15.6:
// do not tune ahead of a profile). This exists so Phases 6 and 8 inherit a regression floor on the
// SDK's hottest data structure. mitata measures a warm JIT in isolation, not end-to-end throughput.
import {bench, run} from 'mitata';
import {ByteQueue} from './byte-queue.js';

const SMALL = new Uint8Array(64).fill(1);
const LARGE = new Uint8Array(64 * 1024).fill(1);

bench('ByteQueue writeBytes x1000 small chunks (warm-JIT, not end-to-end)', () => {
  const queue = new ByteQueue();
  for (let i = 0; i < 1000; i += 1) queue.writeBytes(SMALL);
});

bench('ByteQueue write-then-read round trip, 64 KiB (warm-JIT, not end-to-end)', () => {
  const source = new ByteQueue();
  source.writeBytes(LARGE);
  source.read(new ByteQueue(), source.size);
});

bench('ByteQueue snapshot of 64 KiB (warm-JIT, not end-to-end)', () => {
  const queue = new ByteQueue();
  queue.writeBytes(LARGE);
  queue.snapshot();
});

await run();
```

- [ ] **Step 6: Install and run the bench once to confirm it executes**

```bash
bun install
cd packages/core && bun run src/io/byte-queue.bench.ts
```

Expected: mitata prints a table of three benchmarks. Record no numbers in the repo — this is a baseline
harness, not a claim.

- [ ] **Step 7: Run the full gate sequence**

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
bun run audit
```

Expected: all exit 0. Coverage at or above the 80% aggregate floor (`NFR-5`).

- [ ] **Step 8: Verify the public API surface did not move**

```bash
git diff --exit-code packages/core/etc/core.api.md
```

Expected: **no output, exit 0.** This is the mechanical proof that nothing from `src/io/` leaked into the
published surface. If this fails, something in `src/io/` reached `packages/core/src/index.ts` — remove the
export rather than accepting the report change.

- [ ] **Step 9: Verify no `node:` import crept into core**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
! grep -rn "from 'node:" packages/core/src/
```

Expected: exit 0 with no matches. `IO-16`'s bridge is Web Streams; a `node:stream` import would break
runtime-agnosticism.

- [ ] **Step 10: Add a changeset**

Because nothing enters the public API, this is a patch-level, no-consumer-impact change:

```bash
bun run changeset
```

Select `@dexpace/core`, choose **patch**, and use the summary:
`Internal: byte-streaming primitives for product-spec §5 (IO-1–IO-42). No public API change.`

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/io/factories.ts packages/core/src/io/factories.test.ts \
        packages/core/src/io/index.ts packages/core/src/io/byte-queue.bench.ts \
        package.json bun.lock .changeset/
git commit -m "feat(core): add IO-30 factories, internal barrel, and ByteQueue baseline bench"
```

---

## Self-Review

**Spec coverage** — every requirement ID in the design's disposition table, mapped to its task:

- IO-1, IO-2 → Task 2 (`ByteQueue`), Task 6 (`BufferedSource`); the IO-2-before-exhaustion ordering is
  commented at both sites and asserted on both a fresh and an exhausted source.
- IO-3 → Tasks 2, 6, 9 via `assertCount`/`invariant`, asserted to reject before any transfer.
- IO-4 → Task 2 (`ByteQueue.write`), Task 9 (`BufferedSink.write`).
- IO-5, IO-18 → Task 9 (`flush`/`emit`/`close`).
- IO-6 → Tasks 6 and 9: `overStream` wrappers own the caller's stream — close cancels/closes it,
  asserted with the fakes' cancel/close spies; the IO-16 bridges (Task 12) close their owning
  source/sink, asserted there.
- IO-7 → Task 2, plus the Task 4 order-preservation property test.
- IO-8, IO-10 → Task 3, plus Task 4 property tests for snapshot independence and non-consuming `copyTo`.
- IO-9 → Task 1's constant and `AllocationLimitError`, Task 3's `#materialize` check plus the `RangeError`
  backstop in `allocate`.
- IO-11, IO-12, IO-15 → Task 6.
- IO-13 → Task 7 (read side, both UTF-8 and ISO-8859-1), Task 9 (write side, with the bounded-charset
  deviation stated in code and spec).
- IO-14 → Task 7, including the adversarial chunk-boundary property test.
- IO-16 → Task 12, both directions, with close-propagation asserted.
- IO-17 → Task 11, including the zero-read contract violation; the violation is detected in Task 5's
  `#pullOnce`.
- IO-19, IO-20, IO-21, IO-23 → Task 8, with two property tests.
- IO-22, IO-24 → Task 5 (`RetentionWindow.close`) and Task 8 (parent-close invalidation, closed-slice read).
- IO-25–IO-29 → Task 10, including the wire-payload-never-reduced property test.
- IO-30 factory half → Task 13 (fresh buffer, stream and byte-array sources, stream sink, and the
  foreign-primitive `PrimitiveSource`/`PrimitiveSink` wrappers); resolution half, IO-31–IO-36, IO-39 →
  not built, stated in `factories.ts`'s TSDoc.
- IO-37 → satisfied by the event-loop model; noted in `ByteQueue` and `BufferedSource` TSDoc.
- IO-38 → not applicable; no code, per the spec's ledger.
- IO-40 → enforced by absence: no `AbortSignal`, no timer anywhere in `src/io/`, stated in Global
  Constraints and in both async classes' TSDoc.
- IO-41, IO-42 → Task 4 (`ByteQueue`, the exempt direction), Task 6 (`BufferedSource`, the rejecting
  direction), Task 9 (`BufferedSink`), Task 10 (`TeeSink` rejects before consuming from the source);
  both IO-42 directions asserted, as the design requires.

**Design-decision coverage:** the four locked decisions each have an enforcement point — the sync/async split
is structural (Tasks 2 and 6); uncapped retention is stated in `RetentionWindow`'s TSDoc and in Global
Constraints with an explicit "do not add a `maxRetainedBytes` option"; internal-only surface is enforced by
Task 13 Step 8's byte-identical `core.api.md` check; `close()`-only teardown is stated in Global Constraints
with the `Symbol.asyncDispose` failure mode explained.

**Placeholder scan:** no "TBD"/"TODO"/"implement later" strings. Every step contains complete, runnable code
including every error path its tests exercise. The one value the design left open — `MAX_BYTE_ARRAY_LENGTH` —
is resolved in Task 1 Step 3 to `2 ** 31 - 1` with the reasoning in TSDoc, as the design's "confirmed at plan
time" instruction required.

**Type consistency:** cross-checked across tasks. `ByteQueue`'s `read(dest, count): number` /
`write(src, count): void` / `writeBytes` / `snapshot` / `copyTo` / `takeBytes` / `skip` / `clear` / `close`
are used with those exact signatures by `RetentionWindow` (Task 5), `BufferedSource` (Tasks 6–8, 12),
`BufferedSink` (Tasks 9, 12), `TeeSink` (Task 10), and `writeAll` (Task 11). `RetentionWindow`'s
`register`/`release`/`pullThrough`/`readInto`/`peekBytes`/`availableFrom`/`assertUsable`/`close` match every
`BufferedSource` call site, with `availableFrom` added in the same task that first calls it (Task 7).
`encodeText` is defined once in `buffered-sink.ts` (Task 9) and imported by `tee-sink.ts` (Task 10), so the
write-side charset rules and their rejection message have a single source. `END_OF_STREAM` is
imported from `./limits.js` at every comparison site and the literal `-1` appears nowhere. `IoError` is
imported into `buffered-source.ts` in Task 7 and `tee-sink.ts` in Task 10, both from `./errors.js`.
`BufferedSink`'s `ByteQueue` import changes from type-only to value in Task 12, which is called out in that
task's Step 4.

**Known gaps, deliberately deferred** (matching the spec's own out-of-scope list): every buffering cap
(`BODY-19`, `BODY-30`/`HTTP-52`, `BODY-34`) → Phase 3b; `MultipartBody` and the `Request`/`Response` real
body type → Phase 3b; promotion of any §5 type into the public barrel → Phase 3b or later;
`Symbol.asyncDispose` → whenever the `engines.node` floor moves.
