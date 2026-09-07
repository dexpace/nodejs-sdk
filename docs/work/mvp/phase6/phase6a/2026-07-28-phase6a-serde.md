# Phase 6a — Serde Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the serialization seam in `@dexpace/core` — the reshaped `Serde`/`Serializer`/`Deserializer` SPI
(closing `SEAM-21`), `Tristate<T>`, two serde error leaves, `serdeBody()`, and the two response handlers — plus the
workspace's first second package, `@dexpace/codec-json`, satisfying
`product-spec/14-serialization-serde.md` (`SERDE-1`–`SERDE-30`) per
`docs/work/mvp/phase6/phase6a/2026-07-28-phase6a-serde-design.md`.

**Architecture:** A new `packages/core/src/serde/` folder of five independent files with no folder-level barrel,
plus one modified file in `src/seams/` (Phase 2's provisional `Serde<T>` is reshaped in place) and one new file in
`src/body/`. The witness is a caller-supplied schema value (`{parse(input: unknown): T}`), so nothing in core
implements or depends on a schema library. A second package, `packages/codec-json/`, wraps
`JSON.parse`/`JSON.stringify` and imports core only through its **public** entry point — which is what forces the
seam's barrel promotion.

**Tech Stack:** TypeScript 5.8+, `bun test`, `fast-check` for the encode/decode round-trip invariant (Task 10
Step 5 — one property test, and `packages/codec-json/package.json` must declare `fast-check` for it to resolve),
`expect-type` for the type-level assertions, `api-extractor` (now two reports). No new runtime dependencies in
either package — `SEAM-1` untouched. No `node:` imports anywhere in either package.

> ### ⛔ BLOCKED on one cross-phase decision — Task 5's close-failure path
>
> **`SuppressedError` is not available on the declared runtime floor.** Task 5's `closingAfter` helper builds a
> `SuppressedError` to keep a decode failure primary when `response.close()` also fails. `SuppressedError` is a
> V8 global from the full Explicit Resource Management proposal and is **absent on every 18.x runtime**; adding
> `esnext.disposable` to `lib` supplies the *type* only. So it type-checks, passes `bun test` on a modern local
> runtime, and then throws `ReferenceError: SuppressedError is not defined` at call time on the floor — the
> exact `NFR-10` trap `docs/knowledge/tooling-and-quality-gates.md:60-61` describes. Task 13 Step 8's
> `bun run verify:node-floor` and `bun run test:node` would both fail.
>
> This is **the same open decision Phase 4b records** at `plans/2026-07-25-phase4b-recovery-chain.md:22-47`,
> which names Phases 5a, 6b and 6c as the other sites. **6a is a fifth site** — add it there. Whichever option
> lands must land in all five:
>
> - **(a) Raise `engines.node`** past the first release shipping Explicit Resource Management. Consumer-visible
>   breaking change, and the checkpoint forbids unsanctioned floor moves. Confirm the exact release first.
> - **(b) A runtime-guarded `suppress(primary, secondary)` helper** in `packages/core/src/`, using native
>   `SuppressedError` when `globalThis.SuppressedError` exists and attaching a `suppressed` property otherwise.
>   Changes Task 5's `expect(caught).toBeInstanceOf(SuppressedError)` assertion to assert the primary's type and
>   its `suppressed` property instead.
>
> Everything else in this plan is executable; only Task 5's `closingAfter` and its two close-failure tests wait
> on the decision. Do not substitute a bare `finally { await response.close() }` as a workaround — that lets a
> close failure replace the decode failure, which is the defect `closingAfter` exists to prevent.
>
> **Second open decision, non-blocking: assertion density.** This phase ships one `invariant()` call (Task 6)
> across roughly fifteen functions, against `docs/knowledge/assertions.md:6-7`'s 2-per-function module average.
> Phase 4b raised the identical gap at `plans/2026-07-25-phase4b-recovery-chain.md:49-51`; both phases must
> resolve it the same way or the codebase ends up half-migrated, which
> `docs/knowledge/styleguide-overview.md:32-33` forbids outright.

**Prerequisite:** This plan assumes Phases 0, 1, 2, 3a, 3b, 4a, 4b, 4c, 5a, 5b, and 5c are implemented exactly as
their plans specify. **6b (SSE) and 6c (Pagination) are not prerequisites and this plan is not a prerequisite for
them** — the segmentation design cuts the three so they share no types, and `SSE-37` plus `§12`'s serde-agnostic
preamble forbid the only couplings that could exist. The 6a → 6b → 6c order is convenience (6a scaffolds the
second package and reshapes an already-published seam, so it is the one worth paying for first), not dependency;
any of the three may execute alone. Concretely, this phase consumes:

- `packages/core/src/http/errors.js` — `DexpaceError`
- `packages/core/src/http/response.js` — `Response` (`status: Status`, `headers: Headers`,
  `body: ReadableStream<Uint8Array> | null`, `close(): Promise<void>` idempotent, `text()`, `bytes()`)
- `packages/core/src/http/status.js` — `Status.of(code)`, `status.code`, `status.isSuccess`,
  `status.isClientError`, `status.isServerError`
- `packages/core/src/http/headers.js` — `Headers.get(name): string | undefined` (case-insensitive)
- `packages/core/src/io/errors.js` — `IoError`
- `packages/core/src/body/body.js` — `interface Body` (`kind`, `mediaType`, `contentLength`, `replayable`,
  `writeTo(sink)`)
- `packages/core/src/body/simple-bodies.js` — `ByteArrayBody` (constructor takes `(bytes: Uint8Array, mediaType:
  string | null)`)
- `packages/core/src/body/http-status-error.js` — `HttpStatusError`, `toHttpError(response): Promise<HttpStatusError | null>`
- `packages/core/src/seams/serde.ts` — the provisional `Serde<T>` this phase replaces
- `packages/core/src/invariant.js` — `invariant()`, `assertNever()`
- `packages/core/etc/core.api.md` — the api-extractor report, which **changes** this phase

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT` (`NFR-13`, per Phase 1's plan).
- **No `node:` imports in `packages/core` or `packages/codec-json`.** Core's zero-`node:` invariant is
  mechanically enforced since the scaffold; codec-json inherits it (`JSON`, `TextEncoder`, `TextDecoder`, and Web
  Streams are all platform globals).
- **No folder-level barrel in `src/serde/`.** `docs/knowledge/module-organization.md:18` bans internal barrels.
  Public promotion happens by named re-export from `packages/core/src/index.ts` only.
- **Error hierarchy stays two levels.** `DexpaceError → leaf`. Do **not** introduce a `SerdeError` base class —
  the checkpoint's §5.2 cap is why 3b retrofitted `IoError`'s tier away. Grouping is an exported type guard.
- **`Serde.mediaType` is a required, non-optional `string`.** There is no format-agnostic fallback constant
  anywhere on the body-construction path (`SERDE-2`).
- **Both packages' `package.json` `dependencies` field is a hard-committed `{}`.** The scaffold's CI check is
  generalized to cover both in Task 8.
- **Library builds use plain `tsc`, never `Bun.build`** (`styleguide/typescript-bun/08`).
- **Every new class/interface is `Object.freeze`d or `readonly` throughout.** No mutable serde state
  (`SERDE-29`).
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`. `max-params`
  **counts optional parameters**, so `(a, b, c, d?)` is four and errors. Phase 1 reserves the `eslint-disable`
  for private builder-internal constructors only — nothing in this phase qualifies. Three functions here would
  have breached it in a naive shape and are built as options-object forms instead: `foldTristate`,
  `decodeResponse`, `decodeSuccessResponse`.
- **`exactOptionalPropertyTypes` is on.** Every optional field is declared `?: T | undefined`, never bare
  `?: T` — and an assignment whose right-hand side may be `undefined` (`this.status = options?.status`) needs
  the field's declared type to include `undefined`, or it is a compile error `bun test` will not catch.
- **`DexpaceError` already sets `this.name = new.target.name`** (Phase 2,
  `plans/2026-07-23-phase2-seam-foundations.md:352-356`). Subclasses must **not** restate it —
  `docs/knowledge/error-handling.md:8-9` makes that explicit, and a hardcoded string becomes a lie on rename.
- **Every `as` carries a why-comment** (`docs/knowledge/type-system.md:12-13`), in implementation and test code
  alike.

---

### Task 1: Serde error leaves

**Files:**
- Create: `packages/core/src/serde/errors.ts`
- Create: `packages/core/src/serde/errors.test.ts`

**Interfaces:**
- Consumes: `DexpaceError` from `packages/core/src/http/errors.js`.
- Produces: `class SerializationError extends DexpaceError`, `class DeserializationError extends DexpaceError`
  (constructor `(message: string, options?: {cause?: unknown; status?: number; etag?: string | null; location?:
  string | null})`), `function isSerdeError(e: unknown): e is SerializationError | DeserializationError`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/serde/errors.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-9 (stable SDK type, cause chained), SERDE-10 (directional subtypes off one root),
// SERDE-11 (unchecked — nothing to assert in JS, documented), SERDE-28 (status/etag/location as fields).
import {expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {DeserializationError, SerializationError, isSerdeError} from './errors.js';

test('both leaves extend DexpaceError directly (two-level tree)', () => {
  expect(new SerializationError('x')).toBeInstanceOf(DexpaceError);
  expect(new DeserializationError('x')).toBeInstanceOf(DexpaceError);
  // The tree is flat: neither is an instance of the other.
  expect(new SerializationError('x')).not.toBeInstanceOf(DeserializationError);
});

test('cause is chained, not swallowed', () => {
  const backing = new Error('JSON.parse blew up');
  const error = new DeserializationError('decode failed', {cause: backing});
  expect(error.cause).toBe(backing);
});

test('isSerdeError groups both directions and rejects everything else', () => {
  expect(isSerdeError(new SerializationError('x'))).toBe(true);
  expect(isSerdeError(new DeserializationError('x'))).toBe(true);
  expect(isSerdeError(new DexpaceError('x'))).toBe(false);
  expect(isSerdeError(new Error('x'))).toBe(false);
  expect(isSerdeError(null)).toBe(false);
});

test('DeserializationError carries status/etag/location as readable fields, not only in the message', () => {
  const error = new DeserializationError('304 Not Modified: body not decoded', {
    status: 304,
    etag: 'W/"abc"',
    location: null,
  });
  expect(error.status).toBe(304);
  expect(error.etag).toBe('W/"abc"');
  expect(error.location).toBeNull();
});

test('the optional fields default to null/undefined rather than throwing', () => {
  const error = new DeserializationError('plain');
  expect(error.status).toBeUndefined();
  expect(error.etag).toBeNull();
  expect(error.location).toBeNull();
});

test('name is set so a stack trace identifies the leaf', () => {
  expect(new SerializationError('x').name).toBe('SerializationError');
  expect(new DeserializationError('x').name).toBe('DeserializationError');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/serde/errors.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/serde/errors.ts
// SPDX-License-Identifier: MIT
import {DexpaceError} from '../http/errors.js';

/** Options accepted by both serde error leaves. */
export interface SerdeErrorOptions {
  readonly cause?: unknown;
  /** HTTP status, present only when the error was raised by a status-aware response handler (SERDE-28). */
  readonly status?: number | undefined;
  /** `ETag` of the originating response, preserved so conditional-request context survives (SERDE-28). */
  readonly etag?: string | null | undefined;
  /** `Location` of the originating response, preserved so redirect context survives (SERDE-28). */
  readonly location?: string | null | undefined;
}

/**
 * A write-path serde failure: an unencodable value, or a codec failure while encoding (SERDE-10).
 *
 * Sits directly under {@link DexpaceError} — the error tree is deliberately two levels deep, so there is no
 * `SerdeError` base class. Use {@link isSerdeError} to catch both directions at once.
 */
export class SerializationError extends DexpaceError {
  // Declared `T | undefined` rather than `status?: number`: `exactOptionalPropertyTypes` is on, and the
  // constructor assigns a possibly-undefined value. The key must exist either way — a reader checking
  // `'status' in error` should get a straight answer.
  readonly status: number | undefined;
  readonly etag: string | null;
  readonly location: string | null;

  constructor(message: string, options?: SerdeErrorOptions) {
    super(message, {cause: options?.cause});
    // No `this.name = ...` here: DexpaceError's constructor already does `this.name = new.target.name`.
    this.status = options?.status;
    this.etag = options?.etag ?? null;
    this.location = options?.location ?? null;
  }
}

/**
 * A read-path serde failure: malformed input, a shape mismatch, a wire `null` into a non-null target
 * (SERDE-13), a missing response body, or a non-decodable status (SERDE-10, SERDE-27, SERDE-28).
 *
 * A genuine stream failure is **not** this type — it propagates as `IoError`, unwrapped (SERDE-12).
 */
export class DeserializationError extends DexpaceError {
  /** See {@link SerializationError.status} for why this is `| undefined` and not an optional property. */
  readonly status: number | undefined;
  readonly etag: string | null;
  readonly location: string | null;

  constructor(message: string, options?: SerdeErrorOptions) {
    super(message, {cause: options?.cause});
    // No `this.name = ...`: DexpaceError's `new.target.name` covers it.
    this.status = options?.status;
    this.etag = options?.etag ?? null;
    this.location = options?.location ?? null;
  }
}

/**
 * Type guard grouping both serde directions, so a caller can catch one category without a base class
 * (SERDE-9/SERDE-10). Same mechanism as Phase 3b's `isIoError`/`isBodyError`.
 */
export function isSerdeError(e: unknown): e is SerializationError | DeserializationError {
  return e instanceof SerializationError || e instanceof DeserializationError;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/serde/errors.test.ts`
Expected: PASS — 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/serde/errors.ts packages/core/src/serde/errors.test.ts
git commit -m "feat(core): add SerializationError, DeserializationError, isSerdeError (SERDE-9/10/11)"
```

---

### Task 2: The reshaped seam — `Schema`, `Serializer`, `Deserializer`, `Serde`

**Files:**
- Modify: `packages/core/src/seams/serde.ts` (full replacement of Phase 2's provisional `Serde<T>`)
- Modify: `packages/core/src/seams/serde.test.ts` (full replacement — Phase 2's assertions describe the old shape)
- Modify: `packages/core/src/seams/index.ts` (export the four new names, drop `Serde<T>`'s `@internal` marking)

**Interfaces:**
- Consumes: nothing at runtime — this task is pure type declarations.
- Produces: `interface Schema<T> {parse(input: unknown): T}`; `interface Serializer` with
  `serializeToString(value: unknown): string`, `serialize(value: unknown): Uint8Array`,
  `serializeInto(value: unknown, target: Uint8Array, offset?: number):
  number`, `serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>`;
  `interface Deserializer` with `deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T` and
  `deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>, typeName?: string): Promise<T>`;
  `interface Serde {readonly mediaType: string; readonly serializer: Serializer; readonly deserializer:
  Deserializer}`.

- [ ] **Step 1: Write the failing type-level test**

There is no runtime logic here — these are pure type declarations, so the test is `expect-type` only
(`styleguide/typescript/11` §11.6). Replace the file's whole contents:

```typescript
// packages/core/src/seams/serde.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-1 (one bundle, one encoder, one decoder), SERDE-2 (mediaType required, never optional),
// SERDE-5 (decode takes an explicit schema witness — SEAM-21), SERDE-6 (parametric targets via combinators).
// `bun test` executes this file but does not typecheck it; the assertions only fire under `bun run typecheck`.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Deserializer, Schema, Serde, Serializer} from './serde.js';

test('Serde bundles exactly one serializer and one deserializer for one media type', () => {
  expectTypeOf<Serde>().toHaveProperty('mediaType').toEqualTypeOf<string>();
  expectTypeOf<Serde>().toHaveProperty('serializer').toEqualTypeOf<Serializer>();
  expectTypeOf<Serde>().toHaveProperty('deserializer').toEqualTypeOf<Deserializer>();
});

test('Serde is not generic — a bundle is per-format, not per-payload-type', () => {
  // If `Serde` still took a type parameter this line would not compile.
  expectTypeOf<Serde>().not.toBeAny();
});

test("decode's return type is driven by the schema argument, not by the bundle", () => {
  type Decoded = ReturnType<Deserializer['deserialize']>;
  // Unconstrained call site infers `unknown`; the constrained one below is the real assertion.
  expectTypeOf<Decoded>().toBeUnknown();

  const decode = (d: Deserializer, s: Schema<{id: number}>) => d.deserialize(new Uint8Array(), s);
  expectTypeOf(decode).returns.toEqualTypeOf<{id: number}>();
});

test('a parametric target needs no special carrier — the schema is a combinator over element schemas', () => {
  const decodeMany = (d: Deserializer, s: Schema<readonly {id: number}[]>) =>
    d.deserialize(new Uint8Array(), s);
  expectTypeOf(decodeMany).returns.toEqualTypeOf<readonly {id: number}[]>();
});

test('serializeInto returns a byte count and accepts an optional offset', () => {
  expectTypeOf<Serializer['serializeInto']>().returns.toEqualTypeOf<number>();
  expectTypeOf<Serializer['serializeInto']>().parameter(2).toEqualTypeOf<number | undefined>();
});

test('all four SEAM-20 allocation profiles are present, including the fresh-string one', () => {
  expectTypeOf<Serializer['serializeToString']>().returns.toEqualTypeOf<string>();
  expectTypeOf<Serializer['serialize']>().returns.toEqualTypeOf<Uint8Array>();
  expectTypeOf<Serializer>().toHaveProperty('serializeTo');
  expectTypeOf<Serializer>().toHaveProperty('serializeInto');
});

test('the stream profiles take platform stream types, never a core-internal io type', () => {
  expectTypeOf<Serializer['serializeTo']>().parameter(1).toEqualTypeOf<WritableStream<Uint8Array>>();
  expectTypeOf<Deserializer['deserializeFrom']>().parameter(0).toEqualTypeOf<ReadableStream<Uint8Array>>();
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd packages/core && bun test src/seams/serde.test.ts && cd ../.. && bun run typecheck`
Expected: `bun test` reports passes (the callbacks have no runtime assertions); `bun run typecheck` **FAILS** —
`Serde` still takes a type argument and has no `serializer`/`deserializer` properties.

- [ ] **Step 3: Write the implementation**

Replace `packages/core/src/seams/serde.ts` entirely:

```typescript
// packages/core/src/seams/serde.ts
// SPDX-License-Identifier: MIT

/**
 * The runtime type witness a decode operation requires (SERDE-5, closing SEAM-21).
 *
 * TypeScript erases types completely — there is no runtime class token to reflect over, so an erased generic
 * cannot be recovered the way a JVM port recovers one. Instead the caller supplies a *value* that already
 * carries the same information: a schema. This interface is deliberately structural and minimal so that Zod,
 * Valibot, ArkType, effect/schema, and anything following the community "Standard Schema" convention satisfy it
 * without an adapter. `@dexpace/core` defines this shape and depends on none of them (SEAM-1).
 *
 * Because TypeScript infers `T` from the schema's own generic parameter, the compile-time type and the runtime
 * witness are one artifact, not two things kept in sync by convention.
 */
export interface Schema<T> {
  parse(input: unknown): T;
}

/**
 * The encode half of a {@link Serde} (SERDE-3, SERDE-4).
 *
 * No method takes a {@link Schema} — encoding has the value in hand and needs no witness.
 */
export interface Serializer {
  /**
   * Encode to a freshly allocated string.
   *
   * One of `SEAM-20`'s four allocation profiles. A codec whose wire form is not textual (CBOR, protobuf) throws
   * a {@link SerializationError} from this method rather than inventing a lossy rendering.
   */
  serializeToString(value: unknown): string;

  /** Encode to a freshly allocated buffer. */
  serialize(value: unknown): Uint8Array;

  /**
   * Encode into a caller-owned buffer at `offset` (default 0), returning the number of bytes written.
   *
   * Throws a plain `RangeError` — **not** a serde error, and with no chained cause — when `offset` is out of
   * range or the payload does not fit (SERDE-4). Bytes before `offset` are left untouched, and the buffer is
   * never resized, reallocated, or otherwise taken ownership of.
   */
  serializeInto(value: unknown, target: Uint8Array, offset?: number): number;

  /**
   * Encode into a caller-owned sink, writing the payload fully.
   *
   * Does **not** close, abort, or otherwise take ownership of `sink` — the caller opened it and the caller
   * closes it (SERDE-3).
   */
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>;
}

/**
 * The decode half of a {@link Serde} (SERDE-5, SERDE-6, SERDE-13).
 *
 * `typeName` is an optional diagnostic label, never a witness: a structural schema value carries no reliable
 * name, so when a wire `null` is decoded into a non-null target the implementation names the target from this
 * label, falling back to `'the target type'`.
 *
 * **Contract obligation on implementors (SERDE-13).** A wire `null` decoded into a non-null target MUST throw
 * `DeserializationError` naming that target, on *every* entry point, and MUST NOT return a `null` that flows
 * through the non-null result and detonates at some later field access. Enforce it before delegating to the
 * schema — a schema library may or may not reject a bare `null`, and may or may not name the target when it
 * does. Core cannot enforce this for you: `decodeResponse` streams bytes straight into
 * {@link Deserializer.deserializeFrom} and never holds a parsed value to inspect, and core owning a parser
 * would violate SEAM-1.
 */
export interface Deserializer {
  deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T;

  /**
   * Decode from a caller-owned source, reading to EOF.
   *
   * Does **not** cancel or otherwise take ownership of `source` — the caller closes it (SERDE-3).
   */
  deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>, typeName?: string): Promise<T>;
}

/**
 * The SDK's format-agnostic serialization seam: one encoder, one decoder, and one declared wire media type,
 * acquired through a single reference (SERDE-1).
 *
 * Not generic in a payload type. A bundle is per-*format*, not per-*type* — the payload type arrives as a
 * {@link Schema} parameter of each decode call, so one `jsonSerde()` instance serves every DTO in an
 * application.
 *
 * `mediaType` is required and non-optional so a body built from a value plus a serde can never fall back to a
 * format-agnostic default `Content-Type` (SERDE-2).
 */
export interface Serde {
  readonly mediaType: string;
  readonly serializer: Serializer;
  readonly deserializer: Deserializer;
}
```

- [ ] **Step 4: Update the seams barrel**

In `packages/core/src/seams/index.ts`, replace the `Serde` line with:

```typescript
export type {Deserializer, Schema, Serde, Serializer} from './serde.js';
```

- [ ] **Step 5: Run typecheck to verify it passes**

Run: `cd packages/core && bun test src/seams/serde.test.ts && cd ../.. && bun run typecheck`
Expected: both green. If you want to confirm the assertions are load-bearing, temporarily change
`toEqualTypeOf<string>()` on `mediaType` to `toEqualTypeOf<number>()`, re-run `bun run typecheck`, confirm it
fails, then revert.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/seams/serde.ts packages/core/src/seams/serde.test.ts packages/core/src/seams/index.ts
git commit -m "feat(core)!: reshape Serde into a schema-witness SPI, closing SEAM-21 (SERDE-1/2/5/6)"
```

---

### Task 3: `Tristate<T>` and its helpers

**Files:**
- Create: `packages/core/src/serde/tristate.ts`
- Create: `packages/core/src/serde/tristate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Tristate<T>`; `const TRISTATE_BRAND: unique symbol`; `function absent(): Tristate<never>`;
  `function nullValue(): Tristate<never>`; `function present<T>(value: NonNullable<T>): Tristate<T>`;
  `function ofNullable<T>(value: T | null | undefined): Tristate<T>`;
  `interface TristateBranches<T, R> {readonly onAbsent: () => R; readonly onNull: () => R; readonly onPresent:
  (value: T) => R}`; `function foldTristate<T, R>(t: Tristate<T>, branches: TristateBranches<T, R>): R`;
  `function valueOrNull<T>(t: Tristate<T>): T | null`; `function isAbsent`/`isNull`/`isPresent`;
  `function isTristate`; `function tristateToString`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/serde/tristate.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-14 (three states, Present-of-null unrepresentable), SERDE-18 (helpers, ofNullable never
// yields Absent), SERDE-30 (stable identity-free string form).
import {expect, test} from 'bun:test';
import {
  absent,
  foldTristate,
  isAbsent,
  isNull,
  isPresent,
  isTristate,
  nullValue,
  ofNullable,
  present,
  tristateToString,
  valueOrNull,
} from './tristate.js';

test('exactly three states, discriminated by kind', () => {
  expect(absent().kind).toBe('absent');
  expect(nullValue().kind).toBe('null');
  expect(present(42).kind).toBe('present');
});

test('Present carries its value', () => {
  const t = present({id: 7});
  expect(isPresent(t) ? t.value : undefined).toEqual({id: 7});
});

test('predicates are mutually exclusive', () => {
  expect([isAbsent(absent()), isNull(absent()), isPresent(absent())]).toEqual([true, false, false]);
  expect([isAbsent(nullValue()), isNull(nullValue()), isPresent(nullValue())]).toEqual([false, true, false]);
  expect([isAbsent(present(1)), isNull(present(1)), isPresent(present(1))]).toEqual([false, false, true]);
});

test('ofNullable maps null and undefined to Null, never to Absent', () => {
  expect(ofNullable(null).kind).toBe('null');
  expect(ofNullable(undefined).kind).toBe('null');
  expect(ofNullable('x').kind).toBe('present');
});

test('foldTristate dispatches all three branches', () => {
  const label = <T,>(t: ReturnType<typeof ofNullable<T>> | ReturnType<typeof absent>) =>
    foldTristate(t, {
      onAbsent: () => 'A',
      onNull: () => 'N',
      onPresent: (v) => `P:${String(v)}`,
    });
  expect(label(absent())).toBe('A');
  expect(label(nullValue())).toBe('N');
  expect(label(present('hi'))).toBe('P:hi');
});

test('valueOrNull collapses both empty branches to null', () => {
  expect(valueOrNull(absent())).toBeNull();
  expect(valueOrNull(nullValue())).toBeNull();
  expect(valueOrNull(present(5))).toBe(5);
});

test('sentinels have a stable, identity-free string form (SERDE-30)', () => {
  expect(tristateToString(absent())).toBe('Absent');
  expect(tristateToString(nullValue())).toBe('Null');
  expect(tristateToString(present(3))).toBe('Present(3)');
  // Two separately constructed sentinels render identically — no identity hash leaks.
  expect(tristateToString(absent())).toBe(tristateToString(absent()));
});

test('values are frozen — a Tristate cannot be mutated after construction', () => {
  // `as {kind: string}`: deliberately widening away `readonly` and the literal type to prove the *runtime*
  // freeze, which the type system alone cannot demonstrate.
  const t = present(1) as {kind: string};
  expect(() => {
    t.kind = 'absent';
  }).toThrow();
});

test('isTristate accepts only branded values — truth table', () => {
  // A custom type guard needs the full table, not just the happy case (docs/knowledge/testing.md:34).
  expect([isTristate(absent()), isTristate(nullValue()), isTristate(present(1))]).toEqual([true, true, true]);
  expect([
    isTristate(null),
    isTristate(undefined),
    isTristate({}),
    isTristate({kind: 'absent'}),
    isTristate('absent'),
    isTristate(0),
    isTristate([]),
  ]).toEqual([false, false, false, false, false, false, false]);
});
```

- [ ] **Step 2: Write the failing type-level test**

Append to the same file:

```typescript
import {expectTypeOf} from 'expect-type';
import type {Tristate} from './tristate.js';

test('Present of null does not type-check — the illegal fourth state is unrepresentable (SERDE-14)', () => {
  expectTypeOf<Parameters<typeof present<string>>[0]>().toEqualTypeOf<string>();
  // `NonNullable<string | null>` is `string`, so `present<string | null>(null)` is rejected by the compiler.
  expectTypeOf<Parameters<typeof present<string | null>>[0]>().toEqualTypeOf<string>();
});

test('Absent and Null are assignable to any parameterization (SERDE-14 covariance)', () => {
  expectTypeOf(absent()).toMatchTypeOf<Tristate<number>>();
  expectTypeOf(nullValue()).toMatchTypeOf<Tristate<{deep: string}>>();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/core && bun test src/serde/tristate.test.ts`
Expected: FAIL — `Cannot find module './tristate.js'`.

- [ ] **Step 4: Write the implementation**

```typescript
// packages/core/src/serde/tristate.ts
// SPDX-License-Identifier: MIT

/**
 * Branding symbol. A wire codec recognizes a {@link Tristate} by this key rather than by structural shape, so a
 * caller DTO that happens to carry a `kind` field is never mistaken for one.
 *
 * Exported because `@dexpace/codec-json` — a *separate package* — needs it. That is also why
 * `@dexpace/codec-json` declares `@dexpace/core` as a `peerDependency`: two copies of core in one dependency
 * tree would mean two distinct symbols, and the codec would silently stop recognizing a caller's Tristate
 * values — emitting a key the caller asked to omit.
 */
export const TRISTATE_BRAND: unique symbol = Symbol.for('@dexpace/core.Tristate');

/**
 * The PATCH three-state type: a key missing from the wire, a key present with an explicit `null`, or a key
 * present with a value (SERDE-14).
 *
 * A discriminated union over frozen object literals, never a class hierarchy
 * (`styleguide/typescript/06` §6.4/§6.5) — the same pattern as `Body`'s `kind` union and `Outcome<T>`.
 *
 * The illegal fourth state (Present of `null`) is unrepresentable *at the type level*, because
 * {@link present} takes `NonNullable<T>`. That is strictly earlier than a construction-time runtime rejection.
 */
export type Tristate<T> =
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'absent'}
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'null'}
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'present'; readonly value: T};

const ABSENT = Object.freeze({[TRISTATE_BRAND]: true, kind: 'absent'} as const);
const NULL = Object.freeze({[TRISTATE_BRAND]: true, kind: 'null'} as const);

/** The key was absent from the wire — a PATCH server reads this as "leave unchanged". */
export function absent(): Tristate<never> {
  return ABSENT;
}

/**
 * The key was present with an explicit wire `null` — a PATCH server reads this as "clear".
 *
 * Named `nullValue`, not `null`, because `null` is a reserved word.
 */
export function nullValue(): Tristate<never> {
  return NULL;
}

/** The key was present with a value. `value` cannot be `null` or `undefined` (SERDE-14). */
export function present<T>(value: NonNullable<T>): Tristate<T> {
  return Object.freeze({[TRISTATE_BRAND]: true, kind: 'present', value} as const);
}

/**
 * Map a nullable value into a Tristate. Never yields Absent (SERDE-18) — a caller holding a `T | null` has by
 * definition observed the field, so "missing" is not one of the outcomes available to it.
 */
export function ofNullable<T>(value: T | null | undefined): Tristate<T> {
  // `as NonNullable<T>`: the two nullish cases returned above, so the compiler's `T | null | undefined` is
  // narrower than it can prove for an unresolved `T`. No runtime check is possible on an erased type parameter.
  return value === null || value === undefined ? NULL : present<T>(value as NonNullable<T>);
}

/** The three branches {@link foldTristate} dispatches to. */
export interface TristateBranches<T, R> {
  readonly onAbsent: () => R;
  readonly onNull: () => R;
  readonly onPresent: (value: T) => R;
}

/**
 * Exhaustive three-way dispatch (SERDE-18).
 *
 * Named `foldTristate`, not `fold`, because `Outcome<T>` (Phase 4b) already owns a `fold` in this codebase.
 * Both land in the same public barrel eventually; two different `fold`s exported from one entry point would be
 * an ambiguity a caller has to resolve at every import site.
 *
 * The branches travel in one object rather than as three trailing parameters: positionally this is a
 * four-parameter function, and ESLint's `max-params: 3` counts them all. It also reads better — three bare
 * arrow arguments in a row are indistinguishable at the call site.
 */
export function foldTristate<T, R>(tristate: Tristate<T>, branches: TristateBranches<T, R>): R {
  switch (tristate.kind) {
    case 'absent':
      return branches.onAbsent();
    case 'null':
      return branches.onNull();
    case 'present':
      return branches.onPresent(tristate.value);
  }
}

/** Collapse both empty branches to `null` (SERDE-18). Lossy by design — use {@link foldTristate} to distinguish. */
export function valueOrNull<T>(tristate: Tristate<T>): T | null {
  return tristate.kind === 'present' ? tristate.value : null;
}

/** True when the key was missing from the wire — "leave unchanged" (SERDE-18). */
export function isAbsent<T>(
  tristate: Tristate<T>,
): tristate is {readonly [TRISTATE_BRAND]: true; readonly kind: 'absent'} {
  return tristate.kind === 'absent';
}

/** True when the key carried an explicit wire `null` — "clear" (SERDE-18). */
export function isNull<T>(
  tristate: Tristate<T>,
): tristate is {readonly [TRISTATE_BRAND]: true; readonly kind: 'null'} {
  return tristate.kind === 'null';
}

/**
 * True when the key carried a value, narrowing so `.value` is reachable without a second check (SERDE-18).
 *
 * All three predicates narrow, so a caller can branch on any of them; they are not a mix of narrowing and
 * plain-boolean forms.
 */
export function isPresent<T>(
  tristate: Tristate<T>,
): tristate is {readonly [TRISTATE_BRAND]: true; readonly kind: 'present'; readonly value: T} {
  return tristate.kind === 'present';
}

/** True when `value` was produced by this module — the codec's recognition test (SERDE-15/SERDE-19). */
export function isTristate(value: unknown): value is Tristate<unknown> {
  return typeof value === 'object' && value !== null && TRISTATE_BRAND in value;
}

/** Stable, identity-free rendering for logs and assertions (SERDE-30). */
export function tristateToString<T>(tristate: Tristate<T>): string {
  return foldTristate(tristate, {
    onAbsent: () => 'Absent',
    onNull: () => 'Null',
    onPresent: (value) => `Present(${String(value)})`,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test src/serde/tristate.test.ts && cd ../.. && bun run typecheck`
Expected: 11 pass, 0 fail; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/serde/tristate.ts packages/core/src/serde/tristate.test.ts
git commit -m "feat(core): add Tristate<T> with type-level Present-of-null exclusion (SERDE-14/18/30)"
```

---

### Task 4: `serdeBody()` — media type as default `Content-Type`

**Files:**
- Create: `packages/core/src/body/serde-body.ts`
- Create: `packages/core/src/body/serde-body.test.ts`

**Interfaces:**
- Consumes: `Serde` from `../seams/serde.js`; `Body` from `./body.js`; `ByteArrayBody` from `./simple-bodies.js`;
  `SerializationError` from `../serde/errors.js`.
- Produces: `function serdeBody(value: unknown, serde: Serde, mediaType?: string): Body`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/body/serde-body.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-2 (serde's declared media type is the default Content-Type; never a format-agnostic
// constant), SERDE-9 (an encode failure surfaces as the SDK type with the original chained).
import {expect, test} from 'bun:test';
import type {Serde} from '../seams/serde.js';
import {SerializationError} from '../serde/errors.js';
import {serdeBody} from './serde-body.js';

const fakeSerde = (mediaType: string, encode: (value: unknown) => Uint8Array): Serde => ({
  mediaType,
  serializer: {
    serialize: encode,
    serializeToString: () => {
      throw new Error('unused');
    },
    serializeInto: () => {
      throw new Error('unused');
    },
    serializeTo: () => {
      throw new Error('unused');
    },
  },
  deserializer: {
    deserialize: () => {
      throw new Error('unused');
    },
    deserializeFrom: () => {
      throw new Error('unused');
    },
  },
});

const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("media type defaults to the serde's declared type", () => {
  const body = serdeBody({a: 1}, fakeSerde('application/json', encodeJson));
  expect(body.mediaType).toBe('application/json');
});

test('a non-JSON serde stamps its own type, never a format-agnostic constant', () => {
  const body = serdeBody({a: 1}, fakeSerde('application/cbor', encodeJson));
  expect(body.mediaType).toBe('application/cbor');
  expect(body.mediaType).not.toBe('application/octet-stream');
});

test('an explicit media type overrides the default', () => {
  const body = serdeBody({a: 1}, fakeSerde('application/json', encodeJson), 'application/merge-patch+json');
  expect(body.mediaType).toBe('application/merge-patch+json');
});

test('the body is eagerly encoded, so it is replayable and has a known length', () => {
  const body = serdeBody({a: 1}, fakeSerde('application/json', encodeJson));
  expect(body.replayable).toBe(true);
  expect(body.contentLength).toBe(new TextEncoder().encode('{"a":1}').length);
});

test('the encoded bytes reach the sink', async () => {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  await serdeBody({a: 1}, fakeSerde('application/json', encodeJson)).writeTo(sink);
  const joined = chunks.reduce((acc, c) => acc + new TextDecoder().decode(c), '');
  expect(joined).toBe('{"a":1}');
});

test('an encode failure surfaces as SerializationError with the original chained', () => {
  const boom = new Error('circular');
  const broken = fakeSerde('application/json', () => {
    throw boom;
  });
  let caught: unknown;
  try {
    serdeBody({a: 1}, broken);
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SerializationError);
  expect((caught as SerializationError).cause).toBe(boom);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/body/serde-body.test.ts`
Expected: FAIL — `Cannot find module './serde-body.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/body/serde-body.ts
// SPDX-License-Identifier: MIT
import type {Serde} from '../seams/serde.js';
import {SerializationError} from '../serde/errors.js';
import type {Body} from './body.js';
import {ByteArrayBody} from './simple-bodies.js';

/**
 * Build a request body from a value plus a {@link Serde}, defaulting `Content-Type` to the serde's own declared
 * wire media type (SERDE-2).
 *
 * There is deliberately **no** format-agnostic fallback on this path. `Serde.mediaType` is a required,
 * non-optional field, so a serde cannot fail to declare one, and this function never substitutes
 * `application/octet-stream` — a non-JSON serde silently stamping a JSON content type is exactly the failure
 * SERDE-2 exists to prevent.
 *
 * Encoding is eager, which makes the body `replayable` (retry re-sends it) and gives it a known
 * `contentLength`. A streaming, non-replayable variant is deliberately not offered: a body that cannot be
 * replayed cannot survive a retry or a redirect, and every serde payload this SDK builds is small enough to
 * buffer.
 */
export function serdeBody(value: unknown, serde: Serde, mediaType?: string): Body {
  let bytes: Uint8Array;
  try {
    bytes = serde.serializer.serialize(value);
  } catch (e: unknown) {
    throw new SerializationError('failed to encode the request body', {cause: e});
  }
  return new ByteArrayBody(bytes, mediaType ?? serde.mediaType);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/body/serde-body.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/body/serde-body.ts packages/core/src/body/serde-body.test.ts
git commit -m "feat(core): add serdeBody() defaulting Content-Type to the serde's media type (SERDE-2)"
```

---

### Task 5: `decodeResponse()` — the streaming response handler

**Files:**
- Create: `packages/core/src/serde/response-handlers.ts`
- Create: `packages/core/src/serde/response-handlers.test.ts`

**Interfaces:**
- Consumes: `Response` from `../http/response.js`; `Deserializer`, `Schema` from `../seams/serde.js`;
  `DeserializationError` from `./errors.js`; `IoError` from `../io/errors.js`.
- Produces: `interface DecodeTarget<T> {readonly schema: Schema<T>; readonly typeName?: string | undefined}`;
  `function decodeResponse<T>(response: Response, deserializer: Deserializer, target: DecodeTarget<T>):
  Promise<T>`.

**Why the third parameter is an object.** `(response, deserializer, schema, typeName?)` is four positional
parameters and `max-params: 3` counts the optional one, so the naive shape is a lint error at Task 7's gate. The
schema and its diagnostic label describe one thing — the decode target — so they travel together.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/serde/response-handlers.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-27 (stream through the deserializer without materializing, close on every path, missing body
// names the target, codec failure wrapped with cause, genuine I/O error propagates unwrapped), SERDE-12.
import {expect, test} from 'bun:test';
import {IoError} from '../io/errors.js';
import type {Deserializer, Schema} from '../seams/serde.js';
import {DeserializationError} from './errors.js';
import {decodeResponse} from './response-handlers.js';

interface Dto {
  readonly id: number;
}

const dtoSchema: Schema<Dto> = {
  parse(input: unknown): Dto {
    if (typeof input !== 'object' || input === null || typeof (input as Dto).id !== 'number') {
      throw new Error('not a Dto');
    }
    return input as Dto;
  },
};

/** A deserializer that reads the source to EOF and JSON-parses it. Never cancels the source. */
const jsonish: Deserializer = {
  deserialize<T>(data: Uint8Array, schema: Schema<T>): T {
    return schema.parse(JSON.parse(new TextDecoder().decode(data)));
  },
  async deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>): Promise<T> {
    const reader = source.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value);
    }
    const text = chunks.map((c) => new TextDecoder().decode(c)).join('');
    return schema.parse(JSON.parse(text));
  },
};

function bodyOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function failingBody(error: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
}

/** Minimal close-counting stand-in for `Response`. Only the fields the handler touches. */
function fakeResponse(body: ReadableStream<Uint8Array> | null): {
  response: Parameters<typeof decodeResponse>[0];
  closes: () => number;
} {
  let closeCount = 0;
  const response = {
    body,
    async close(): Promise<void> {
      closeCount += 1;
    },
  } as unknown as Parameters<typeof decodeResponse>[0];
  return {response, closes: () => closeCount};
}

test('a valid body decodes to the typed value and the response closes exactly once', async () => {
  const {response, closes} = fakeResponse(bodyOf('{"id":7}'));
  await expect(decodeResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'})).resolves.toEqual({id: 7});
  expect(closes()).toBe(1);
});

test('a missing body throws DeserializationError naming the target, and still closes', async () => {
  const {response, closes} = fakeResponse(null);
  const promise = decodeResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'});
  await expect(promise).rejects.toBeInstanceOf(DeserializationError);
  await expect(promise).rejects.toThrow(/Dto/);
  expect(closes()).toBe(1);
});

test('a missing body with no typeName falls back to a documented label', async () => {
  const {response} = fakeResponse(null);
  await expect(decodeResponse(response, jsonish, {schema: dtoSchema})).rejects.toThrow(/the target type/);
});

test('a codec/shape failure is wrapped as DeserializationError with the original chained', async () => {
  const {response, closes} = fakeResponse(bodyOf('{"id":"not-a-number"}'));
  let caught: unknown;
  try {
    await decodeResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'});
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DeserializationError);
  expect((caught as DeserializationError).cause).toBeInstanceOf(Error);
  expect(closes()).toBe(1);
});

test('a genuine stream failure propagates unwrapped as IoError (SERDE-12)', async () => {
  const ioFailure = new IoError('socket reset');
  const {response, closes} = fakeResponse(failingBody(ioFailure));
  let caught: unknown;
  try {
    await decodeResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'});
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBe(ioFailure);
  expect(caught).not.toBeInstanceOf(DeserializationError);
  expect(closes()).toBe(1);
});

/** A response whose close always rejects, for the two suppression cases below. */
function failingCloseResponse(body: ReadableStream<Uint8Array> | null, closeFailure: unknown) {
  return {
    body,
    close(): Promise<void> {
      return Promise.reject(closeFailure);
    },
  } as unknown as Parameters<typeof decodeResponse>[0];
}

test('a close failure does NOT mask the decode failure — decode primary, close suppressed', async () => {
  // A bare `finally { await response.close() }` would replace the DeserializationError with the close error,
  // telling the caller their socket died when in fact their payload was malformed. Every other close path in
  // Phase 6 (6b's release split, 6c's parseOrClose) preserves the primary; this one must too.
  const closeFailure = new IoError('close failed');
  let caught: unknown;
  try {
    await decodeResponse(failingCloseResponse(bodyOf('{"id":"not-a-number"}'), closeFailure), jsonish, {
      schema: dtoSchema,
      typeName: 'Dto',
    });
  } catch (e: unknown) {
    caught = e;
  }
  // `as SuppressedError`: narrowed by the `toBeInstanceOf` above, which the compiler cannot follow.
  // NOTE: these three assertions change shape if the cross-phase `SuppressedError` decision lands on the
  // runtime-guarded `suppress()` helper — see this plan's ⛔ banner.
  expect(caught).toBeInstanceOf(SuppressedError);
  expect((caught as SuppressedError).error).toBeInstanceOf(DeserializationError);
  expect((caught as SuppressedError).suppressed).toBe(closeFailure);
});

test('a close failure on the SUCCESS path surfaces plainly — it is the only failure there is', async () => {
  const closeFailure = new IoError('close failed');
  await expect(
    decodeResponse(failingCloseResponse(bodyOf('{"id":7}'), closeFailure), jsonish, {
      schema: dtoSchema,
      typeName: 'Dto',
    }),
  ).rejects.toBe(closeFailure);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/serde/response-handlers.test.ts`
Expected: FAIL — `Cannot find module './response-handlers.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/serde/response-handlers.ts
// SPDX-License-Identifier: MIT
import type {Response} from '../http/response.js';
import {IoError} from '../io/errors.js';
import type {Deserializer, Schema} from '../seams/serde.js';
import {DeserializationError} from './errors.js';

const UNNAMED_TARGET = 'the target type';

/**
 * Run `work`, then close `response` — on every path, but **without letting a close failure eat the real one**.
 *
 * A bare `finally { await response.close() }` looks equivalent and is not: when `close()` rejects while an error
 * is already in flight, the `finally`'s rejection *replaces* it, and the caller is told their connection dropped
 * when in fact their payload was malformed. So:
 *
 * - work threw, close succeeded → the work error propagates
 * - work threw, close also threw → the work error stays **primary**, the close error attaches as `suppressed`
 * - work succeeded, close threw → the close error propagates; it is the only failure there is
 *
 * The same primary-plus-suppressed shape 6b's release routine and 6c's `parseOrClose` use, deliberately, so the
 * ordering cannot drift between the three subsystems.
 */
async function closingAfter<T>(response: Response, work: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (primary: unknown) {
    try {
      await response.close();
    } catch (closeError: unknown) {
      throw new SuppressedError(primary, closeError, 'the decode failed and releasing the response also failed');
    }
    throw primary;
  }
  await response.close();
  return result;
}

/** What to decode into: the runtime witness, plus the optional label that names it in an error message. */
export interface DecodeTarget<T> {
  readonly schema: Schema<T>;
  readonly typeName?: string | undefined;
}

/**
 * Decode a response body directly through a {@link Deserializer} into the schema's type (SERDE-27).
 *
 * The live body stream is handed to the deserializer — **this function never buffers it**. Whether the codec
 * on the other side buffers is the codec's business: `@dexpace/codec-json` must, because `JSON.parse` has no
 * incremental form, and that limitation is recorded in the phase's Deviation Ledger.
 *
 * The response is closed on every path — success, missing body, codec failure, and stream failure alike — so no
 * path can strand the connection, and a close failure never displaces the failure that actually matters.
 *
 * Failure routing follows SERDE-12: only malformed-input and shape-mismatch failures are wrapped as
 * {@link DeserializationError} with the original chained; a genuine stream failure (`IoError`) propagates
 * untouched, because re-wrapping it would tell a caller their payload was malformed when their socket dropped.
 */
export async function decodeResponse<T>(
  response: Response,
  deserializer: Deserializer,
  target: DecodeTarget<T>,
): Promise<T> {
  const label = target.typeName ?? UNNAMED_TARGET;
  return closingAfter(response, async () => {
    const body = response.body;
    if (body === null) {
      throw new DeserializationError(`response carried no body to decode into ${label}`);
    }
    try {
      return await deserializer.deserializeFrom(body, target.schema, target.typeName);
    } catch (e: unknown) {
      if (e instanceof IoError || e instanceof DeserializationError) throw e;
      throw new DeserializationError(`failed to decode the response body into ${label}`, {cause: e});
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/serde/response-handlers.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/serde/response-handlers.ts packages/core/src/serde/response-handlers.test.ts
git commit -m "feat(core): add decodeResponse() streaming handler closing on every path (SERDE-27/12)"
```

---

### Task 6: `decodeSuccessResponse()` — the status-aware handler

**Files:**
- Modify: `packages/core/src/serde/response-handlers.ts` (append)
- Modify: `packages/core/src/serde/response-handlers.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 5 produced, plus `toHttpError` and `HttpStatusError` from
  `../body/http-status-error.js`, and `Status` from `../http/status.js`.
- Produces: `function decodeSuccessResponse<T>(response: Response, deserializer: Deserializer, target:
  DecodeTarget<T>): Promise<T>` — the same three-parameter shape as `decodeResponse`, for the same
  `max-params: 3` reason.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/serde/response-handlers.test.ts`:

```typescript
import {HttpStatusError} from '../body/http-status-error.js';
import {Status} from '../http/status.js';
import {decodeSuccessResponse} from './response-handlers.js';

/**
 * Adds the status/header surface `decodeSuccessResponse` reads, on top of the Task 5 stand-in.
 *
 * `text()`/`bytes()` are present because the 4xx/5xx branch delegates to 3b's real `toHttpError()`, which
 * buffers a bounded copy of the error body — a stand-in carrying only `status`/`headers`/`body`/`close` would
 * fail inside `toHttpError`, not inside the code under test, and the resulting error would be misleading.
 * Both read the same `body` stream once, matching the real `Response`'s single-use discipline.
 */
function fakeStatusResponse(
  code: number,
  body: ReadableStream<Uint8Array> | null,
  headers: Readonly<Record<string, string>> = {},
): {response: Parameters<typeof decodeSuccessResponse>[0]; closes: () => number} {
  let closeCount = 0;
  const drain = async (): Promise<Uint8Array> => {
    if (body === null) return new Uint8Array();
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value);
    }
    reader.releaseLock();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  const response = {
    status: Status.of(code),
    headers: {get: (name: string) => headers[name.toLowerCase()]},
    body,
    bytes: drain,
    text: async () => new TextDecoder().decode(await drain()),
    async close(): Promise<void> {
      closeCount += 1;
    },
  } as unknown as Parameters<typeof decodeSuccessResponse>[0];
  return {response, closes: () => closeCount};
}

test('2xx decodes the body', async () => {
  const {response, closes} = fakeStatusResponse(200, bodyOf('{"id":1}'));
  await expect(decodeSuccessResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'})).resolves.toEqual({id: 1});
  expect(closes()).toBe(1);
});

test('500 throws the mapped HTTP error, not a decode of the error payload as the success type', async () => {
  const {response, closes} = fakeStatusResponse(500, bodyOf('{"error":"boom"}'));
  await expect(decodeSuccessResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'})).rejects.toBeInstanceOf(
    HttpStatusError,
  );
  // SERDE-27's close-on-every-path covers this branch too, even though the close happens inside `toHttpError`.
  // Asserting it here is what keeps that delegation honest if 3b's implementation ever changes.
  expect(closes()).toBe(1);
});

test('a non-canonical 599 is treated as a server error, not as an "other" status', async () => {
  const {response, closes} = fakeStatusResponse(599, bodyOf('nope'));
  await expect(decodeSuccessResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'})).rejects.toBeInstanceOf(
    HttpStatusError,
  );
  expect(closes()).toBe(1);
});

test('304 closes and raises a status-leading DeserializationError preserving ETag/Location', async () => {
  const {response, closes} = fakeStatusResponse(304, null, {etag: 'W/"v1"', location: '/next'});
  let caught: unknown;
  try {
    await decodeSuccessResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'});
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DeserializationError);
  const error = caught as DeserializationError;
  expect(error.message.startsWith('304')).toBe(true);
  expect(error.status).toBe(304);
  expect(error.etag).toBe('W/"v1"');
  expect(error.location).toBe('/next');
  expect(closes()).toBe(1);
});

test('a 1xx is also an "other" status, closed and reported, never decoded', async () => {
  const {response, closes} = fakeStatusResponse(102, bodyOf('{"id":1}'));
  await expect(decodeSuccessResponse(response, jsonish, {schema: dtoSchema, typeName: 'Dto'})).rejects.toBeInstanceOf(
    DeserializationError,
  );
  expect(closes()).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/serde/response-handlers.test.ts`
Expected: FAIL — `decodeSuccessResponse is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/serde/response-handlers.ts`:

```typescript
import {toHttpError} from '../body/http-status-error.js';

/**
 * Decode only on success; map failure statuses instead of decoding them (SERDE-28).
 *
 * - **2xx** — delegates to {@link decodeResponse}.
 * - **4xx/5xx** — delegates to Phase 3b's `toHttpError()`, which buffers a bounded in-memory copy of the error
 *   body inside the response's own close-guaranteeing scope, at the shared 1 MiB cap (`BODY-30`/`HTTP-52`).
 *   There is deliberately no second cap here: §14 points at that one explicitly, and a second would drift.
 * - **anything else** (1xx, an unfollowed 3xx such as 304) — closes the response and raises a
 *   {@link DeserializationError} whose message leads with the status code, carrying `ETag` and `Location` as
 *   readable fields so conditional and redirect context survives the closed response.
 *
 * Decoding an error payload as the success type is the failure mode this function exists to prevent: it
 * produces a shape mismatch that blames the caller's schema for the server's 500.
 */
export async function decodeSuccessResponse<T>(
  response: Response,
  deserializer: Deserializer,
  target: DecodeTarget<T>,
): Promise<T> {
  const status = response.status;

  if (status.isSuccess) {
    return decodeResponse(response, deserializer, target);
  }

  if (status.isClientError || status.isServerError) {
    const httpError = await toHttpError(response);
    // `toHttpError` returns null only for a non-4xx/5xx response, which this branch has already excluded.
    invariant(httpError !== null, 'toHttpError returned null for a 4xx/5xx response');
    throw httpError;
  }

  const etag = response.headers.get('ETag') ?? null;
  const location = response.headers.get('Location') ?? null;
  // Routed through the same helper as `decodeResponse` rather than a `try { throw } finally { close }`: if the
  // close fails here too, the status error must stay primary, not be replaced by it.
  return closingAfter(response, () =>
    Promise.reject(
      new DeserializationError(
        `${String(status.code)}: response status is not decodable into ${target.typeName ?? UNNAMED_TARGET}`,
        {status: status.code, etag, location},
      ),
    ),
  );
}
```

Add `import {invariant} from '../invariant.js';` to the file's import block.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/serde/response-handlers.test.ts`
Expected: 12 pass, 0 fail (Task 5's seven plus these five).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/serde/response-handlers.ts packages/core/src/serde/response-handlers.test.ts
git commit -m "feat(core): add decodeSuccessResponse() reusing toHttpError's shared cap (SERDE-28)"
```

---

### Task 7: Promote the seam to the public barrel

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/etc/core.api.md` (regenerated, not hand-edited)
- Create: `.changeset/phase6a-serde-seam.md`

**Interfaces:**
- Consumes: every export from Tasks 1–6.
- Produces: the public surface `@dexpace/codec-json` imports in Task 8 onward.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/index.public.test.ts — append to the existing public-surface test file
test('the serde seam is publicly importable, because a separate codec package must reach it', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'absent',
    'nullValue',
    'present',
    'ofNullable',
    'foldTristate',
    'valueOrNull',
    'isAbsent',
    'isNull',
    'isPresent',
    'isTristate',
    'tristateToString',
    'TRISTATE_BRAND',
    'SerializationError',
    'DeserializationError',
    'isSerdeError',
    'serdeBody',
    'decodeResponse',
    'decodeSuccessResponse',
  ]) {
    expect(barrel).toHaveProperty(name);
  }
});

test('io/ is still not public — 3b froze that decision and 6a does not reopen it', async () => {
  const barrel = await import('./index.js');
  for (const name of ['ByteQueue', 'BufferedSource', 'BufferedSink', 'TeeSink']) {
    expect(barrel).not.toHaveProperty(name);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/index.public.test.ts`
Expected: FAIL — the barrel has none of the serde names.

- [ ] **Step 3: Add the exports**

Append to `packages/core/src/index.ts`:

```typescript
// Serde seam (Phase 6a). Public because `@dexpace/codec-json` is a separate package and can reach core only
// through this entry point — see SEAM-21's closure in the Phase 6a design.
export type {Deserializer, Schema, Serde, Serializer} from './seams/serde.js';
export {DeserializationError, isSerdeError, SerializationError} from './serde/errors.js';
export type {SerdeErrorOptions} from './serde/errors.js';
export {
  absent,
  foldTristate,
  isAbsent,
  isNull,
  isPresent,
  isTristate,
  nullValue,
  ofNullable,
  present,
  TRISTATE_BRAND,
  tristateToString,
  valueOrNull,
} from './serde/tristate.js';
export type {Tristate} from './serde/tristate.js';
export {decodeResponse, decodeSuccessResponse} from './serde/response-handlers.js';
export type {DecodeTarget} from './serde/response-handlers.js';
export type {TristateBranches} from './serde/tristate.js';
export {serdeBody} from './body/serde-body.js';
```

- [ ] **Step 4: Regenerate the api-extractor report**

Run: `cd packages/core && bun run build && bun run api -- --local`
Expected: `etc/core.api.md` gains the serde surface. **Read the diff** — it is the mechanical proof of what went
public. If anything from `src/io/` appears, stop: 3b froze `io/` as permanently internal and something has leaked.

- [ ] **Step 5: Write the changeset**

```markdown
<!-- .changeset/phase6a-serde-seam.md -->
---
'@dexpace/core': minor
---

Add the serde seam: `Serde`/`Serializer`/`Deserializer` now take an explicit schema witness (closing `SEAM-21`),
plus `Tristate<T>`, `SerializationError`/`DeserializationError`, `serdeBody()`, `decodeResponse()`, and
`decodeSuccessResponse()`.
```

- [ ] **Step 6: Run the full gate**

Run: `cd /home/mohammad/Projects/dexpace/nodejs-sdk && bun run typecheck && bun run lint && bun run build && bun test && bun run api && bun run verify:seam-1 && bun run verify:dual-consumption`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.public.test.ts packages/core/etc/core.api.md .changeset/phase6a-serde-seam.md
git commit -m "feat(core)!: promote the serde seam to the public barrel (SEAM-21)"
```

---

### Task 8: Scaffold `@dexpace/codec-json` — the workspace's second package

This is where three Phase-0 deferrals come due: `NFR-2`, `NFR-14`, and the peer-dependency dual-package guard.
They were logged against Phase 8 on the assumption that a transport adapter would be the first second package;
`codec-json` gets there first.

**Files:**
- Create: `packages/codec-json/package.json`
- Create: `packages/codec-json/tsconfig.json`
- Create: `packages/codec-json/api-extractor.json`
- Create: `packages/codec-json/src/index.ts`
- Create: `packages/codec-json/README.md`
- Modify: `package.json` (workspace root — add the `catalog` block)
- Modify: `tsconfig.json` (workspace root — add the project reference)
- Modify: `scripts/verify-seam-1.mjs` (generalize from core-only to every package)

**Interfaces:**
- Consumes: `@dexpace/core`'s public barrel (Task 7).
- Produces: an installable, buildable, empty-but-valid package that later tasks fill in.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/verify-seam-1.test.mjs — new file
// Exercises: SEAM-1 / NFR-1 (no runtime dependencies in any shipped package), and the peer-dependency rule
// from sdk-design-nodejs/02 §2 that guards the dual-package hazard.
import {test, expect} from 'bun:test';
import {readdirSync, readFileSync} from 'node:fs';

const PACKAGES = readdirSync('packages');

test('every package declares an empty dependencies object', () => {
  for (const name of PACKAGES) {
    const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
    expect(manifest.dependencies ?? {}).toEqual({});
  }
});

test('every non-core package declares @dexpace/core as a peer, never a regular dependency', () => {
  for (const name of PACKAGES.filter((n) => n !== 'core')) {
    const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'));
    expect(manifest.peerDependencies?.['@dexpace/core']).toBeDefined();
    expect(manifest.peerDependenciesMeta?.['@dexpace/core']).toBeDefined();
  }
});
```

Note: this test file lives in `scripts/` and runs under the root `bun test`, so `node:fs` is permitted here —
the zero-`node:` invariant governs `packages/*/src`, not build tooling.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test scripts/verify-seam-1.test.mjs`
Expected: FAIL — `packages/codec-json` does not exist, so the second test vacuously passes but the directory read
shows only `core`. Add a temporary assertion `expect(PACKAGES).toContain('codec-json')` to make the failure
explicit, then remove it once Step 3 lands.

- [ ] **Step 3: Write the package manifest**

```json
{
  "name": "@dexpace/codec-json",
  "version": "0.0.0",
  "description": "Reference JSON wire codec for the dexpace SDK: JSON.parse/JSON.stringify plus Tristate wiring and schema decode glue.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": {"node": ">=18.17"},
  "dependencies": {},
  "peerDependencies": {"@dexpace/core": "workspace:*"},
  "peerDependenciesMeta": {"@dexpace/core": {"optional": false}},
  "devDependencies": {
    "@dexpace/core": "workspace:*",
    "typescript": "catalog:",
    "@microsoft/api-extractor": "catalog:",
    "fast-check": "catalog:"
  },
  "scripts": {
    "build": "tsc -b",
    "api": "api-extractor run"
  }
}
```

`@dexpace/core` appears in **both** `peerDependencies` (the shipped contract, guaranteeing one copy in a
consumer's tree) and `devDependencies` (so the workspace resolves it locally for build and test). That pairing is
the standard shape and is what `sdk-design-nodejs/02` §2 prescribes.

`fast-check` is a `devDependency` here, not only at the root: Task 10 Step 5 ships
`src/json-serde.property.test.ts` in *this* package, and under the monorepo's isolated linker
(`docs/knowledge/tooling-and-quality-gates.md:64`) an undeclared import does not resolve. Under a hoisted layout
it would resolve by accident, which is the same failure one release later.

- [ ] **Step 4: Add the root catalog (`NFR-14`)**

Add to the workspace-root `package.json`:

```json
{
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": {
      "typescript": "5.8.3",
      "@microsoft/api-extractor": "7.52.1",
      "expect-type": "1.2.1",
      "fast-check": "3.23.2"
    }
  }
}
```

Then change `packages/core/package.json`'s `devDependencies` entries for those four to `"catalog:"` so no version
string is restated per package. **Verify the installed Bun supports catalogs before relying on this:**

Run: `bun --version`
Expected: `1.2.0` or later. If it is older, do **not** invent a workaround silently — declare the four tools in the
root `devDependencies` only, leave them out of member manifests entirely, and add a Deviation Ledger row saying
`NFR-14` is satisfied by root-only declaration rather than by a catalog, with the Bun version that forced it.

Run: `bun install`
Expected: `bun.lock` updates and resolves both packages with a single `@dexpace/core` entry.

- [ ] **Step 5: Write the tsconfig and project reference**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "target": "<copy verbatim from packages/core/tsconfig.json>",
    "lib": ["<copy verbatim from packages/core/tsconfig.json>"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"],
  "references": [{"path": "../core"}]
}
```

**`target`/`lib` are restated here, not inherited.** `docs/knowledge/tooling-and-quality-gates.md:51` requires
each package's `lib`/`target` to be pinned to *its own* declared `engines.node` floor rather than inherited from
the root's editor-tooling config — and this package declares `"engines": {"node": ">=18.17"}` of its own.
Inheriting is how a symbol newer than the floor type-checks cleanly and then throws at call time on the floor
runtime (`tooling-and-quality-gates.md:60-61`), which is exactly the `SuppressedError` trap in this plan's ⛔
banner. Copy the two values from `packages/core/tsconfig.json`; if they differ from what core declares, stop —
one of the two packages is wrong.

Add `{"path": "./packages/codec-json"}` to the root `tsconfig.json`'s `references` array.

- [ ] **Step 6: Write the api-extractor config and a placeholder entry point**

`packages/codec-json/api-extractor.json` — copy `packages/core/api-extractor.json` verbatim and change
`mainEntryPointFilePath` to `<projectFolder>/dist/index.d.ts` and `reportFileName` to `codec-json.api.md`.

```typescript
// packages/codec-json/src/index.ts
// SPDX-License-Identifier: MIT

/**
 * `@dexpace/codec-json` — the reference wire codec.
 *
 * Wraps `JSON.parse`/`JSON.stringify`. Depends on nothing beyond a `@dexpace/core` peer: schema validation is
 * the caller's, supplied as a `Schema<T>` value at each decode call.
 */
export {};
```

- [ ] **Step 7: Write the package README**

`docs/knowledge/documentation.md:28-31` makes this a condition of publishing, not a nicety: every publishable
package ships a README whose top gets a new engineer from zero to one working call in about 30 seconds — one
sentence on what it is, the install line, one runnable example, links out for the rest.

````markdown
<!-- packages/codec-json/README.md -->
# @dexpace/codec-json

The reference JSON wire codec for the dexpace SDK — `JSON.parse`/`JSON.stringify` behind the `Serde` seam, with
PATCH tri-state semantics wired in by default. Zero dependencies beyond a `@dexpace/core` peer.

```sh
bun add @dexpace/codec-json @dexpace/core
```

```typescript
import {decodeResponse, serdeBody} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';
import {z} from 'zod';                     // any schema library works — this package depends on none

const serde = jsonSerde();
const User = z.object({id: z.number(), name: z.string()});

const body = serdeBody({name: 'ada'}, serde);            // Content-Type: application/json
const user = await decodeResponse(response, serde.deserializer, {schema: User, typeName: 'User'});
```

The schema you pass is both the runtime witness and the source of the static type — there is no separate type
argument to keep in sync. See the SDK docs for `Tristate` PATCH fields (`tristate()` / `tristateObject()`) and
for the unknown-field policy, which is your schema's decision, not this codec's.
````

- [ ] **Step 8: Generalize the SEAM-1 verifier**

In `scripts/verify-seam-1.mjs`, replace the hard-coded `packages/core/package.json` read with a loop over
`readdirSync('packages')`, asserting `dependencies` is `{}` for every package and additionally asserting the
peer-dependency pair for every non-core package. Keep the existing failure message format.

- [ ] **Step 9: Run the gate**

Run: `bun install && bun run typecheck && bun run build && bun test scripts/verify-seam-1.test.mjs && bun run verify:seam-1`
Expected: all green; `packages/codec-json/dist/index.js` exists.

- [ ] **Step 10: Commit**

```bash
git add packages/codec-json package.json tsconfig.json bun.lock scripts/verify-seam-1.mjs scripts/verify-seam-1.test.mjs packages/core/package.json
git commit -m "build: scaffold @dexpace/codec-json with peer-dep dedup and a version catalog (NFR-2/NFR-14)"
```

---

### Task 9: `jsonSerde()` — the encode side

**Files:**
- Create: `packages/codec-json/src/json-serde.ts`
- Create: `packages/codec-json/src/json-serde.test.ts`
- Modify: `packages/codec-json/src/index.ts`

**Interfaces:**
- Consumes: `Serde`, `Serializer`, `SerializationError` from `@dexpace/core`.
- Produces: `function jsonSerde(options?: JsonSerdeOptions): Serde`, `interface JsonSerdeOptions {readonly
  tristate?: boolean}`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/codec-json/src/json-serde.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-1 (round-trip through one bundle), SERDE-2 (declared media type), SERDE-3 (never closes a
// caller stream), SERDE-4 (offset, byte count, RangeError with no cause), SERDE-9 (library error never escapes),
// SERDE-25 (fresh instance per call), SEAM-20 (all four allocation profiles).
import {expect, test} from 'bun:test';
import {SerializationError} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

test('declares application/json as its wire media type', () => {
  expect(jsonSerde().mediaType).toBe('application/json');
});

test('each call returns a fresh, frozen bundle (SERDE-25)', () => {
  const a = jsonSerde();
  const b = jsonSerde();
  expect(a).not.toBe(b);
  expect(Object.isFrozen(a)).toBe(true);
});

test('serialize encodes to UTF-8 JSON bytes', () => {
  const bytes = jsonSerde().serializer.serialize({id: 1, name: 'ünïcode'});
  expect(new TextDecoder().decode(bytes)).toBe('{"id":1,"name":"ünïcode"}');
});

test('serializeToString is the fresh-string allocation profile SEAM-20 requires', () => {
  const serde = jsonSerde();
  expect(serde.serializer.serializeToString({id: 1, name: 'ünïcode'})).toBe('{"id":1,"name":"ünïcode"}');
  // The string and byte profiles are two views of one encoding, not two encoders that can drift.
  expect(new TextEncoder().encode(serde.serializer.serializeToString({a: 1}))).toEqual(
    serde.serializer.serialize({a: 1}),
  );
});

test('an unencodable value throws SerializationError, never the library type (SERDE-9)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let caught: unknown;
  try {
    jsonSerde().serializer.serialize(cyclic);
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SerializationError);
  expect((caught as SerializationError).cause).toBeInstanceOf(TypeError);
});

test('serializeInto honors an offset, returns the byte count, and leaves the prefix untouched (SERDE-4)', () => {
  const target = new Uint8Array(64).fill(0xaa);
  const written = jsonSerde().serializer.serializeInto({a: 1}, target, 10);
  const expected = new TextEncoder().encode('{"a":1}');
  expect(written).toBe(expected.length);
  expect(target.slice(10, 10 + written)).toEqual(expected);
  expect(target.slice(0, 10)).toEqual(new Uint8Array(10).fill(0xaa));
});

test('serializeInto with no offset writes at 0', () => {
  const target = new Uint8Array(32);
  const written = jsonSerde().serializer.serializeInto({a: 1}, target);
  expect(target.slice(0, written)).toEqual(new TextEncoder().encode('{"a":1}'));
});

test('a payload that does not fit throws a plain RangeError with no cause (SERDE-4)', () => {
  const target = new Uint8Array(3);
  let caught: unknown;
  try {
    jsonSerde().serializer.serializeInto({a: 1}, target);
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RangeError);
  expect(caught).not.toBeInstanceOf(SerializationError);
  expect((caught as RangeError).cause).toBeUndefined();
});

test('an out-of-range offset throws RangeError', () => {
  expect(() => jsonSerde().serializer.serializeInto({a: 1}, new Uint8Array(32), -1)).toThrow(RangeError);
  expect(() => jsonSerde().serializer.serializeInto({a: 1}, new Uint8Array(32), 99)).toThrow(RangeError);
});

test('serializeTo writes fully and never closes the caller-owned sink (SERDE-3)', async () => {
  let closed = false;
  const chunks: string[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      closed = true;
    },
  });
  await jsonSerde().serializer.serializeTo({a: 1}, sink);
  expect(chunks.join('')).toBe('{"a":1}');
  expect(closed).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/codec-json && bun test src/json-serde.test.ts`
Expected: FAIL — `Cannot find module './json-serde.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/codec-json/src/json-serde.ts
// SPDX-License-Identifier: MIT
import {
  DeserializationError,
  SerializationError,
  type Deserializer,
  type Schema,
  type Serde,
  type Serializer,
} from '@dexpace/core';

export interface JsonSerdeOptions {
  /**
   * Install the `Tristate` PATCH wiring (SERDE-19). Defaults to `true`: without it, Absent and Null are
   * indistinguishable on the wire, which silently turns "leave unchanged" into "clear".
   *
   * Set to `false` **only** when the caller has already installed equivalent wiring. Never silent — the caller
   * has to name it.
   */
  readonly tristate?: boolean;
}

const ENCODER = new TextEncoder();
const MEDIA_TYPE = 'application/json';

function encodeToText(value: unknown, replacer: ((key: string, value: unknown) => unknown) | undefined): string {
  try {
    // `?? 'null'`: JSON.stringify returns `undefined` (not a string) for a top-level undefined/function/symbol
    // and for a top-level Absent the replacer has already turned into null. Emitting the JSON null literal is
    // the only representable answer for a byte- or string-producing profile.
    return JSON.stringify(value, replacer) ?? 'null';
  } catch (e: unknown) {
    throw new SerializationError('failed to encode value as JSON', {cause: e});
  }
}

function encodeToBytes(value: unknown, replacer: ((key: string, value: unknown) => unknown) | undefined): Uint8Array {
  return ENCODER.encode(encodeToText(value, replacer));
}

function makeSerializer(replacer: ((key: string, value: unknown) => unknown) | undefined): Serializer {
  return Object.freeze({
    serializeToString(value: unknown): string {
      return encodeToText(value, replacer);
    },

    serialize(value: unknown): Uint8Array {
      return encodeToBytes(value, replacer);
    },

    serializeInto(value: unknown, target: Uint8Array, offset = 0): number {
      if (!Number.isInteger(offset) || offset < 0 || offset > target.length) {
        throw new RangeError(`offset ${String(offset)} is out of range for a buffer of ${String(target.length)} bytes`);
      }
      const bytes = encodeToBytes(value, replacer);
      if (bytes.length > target.length - offset) {
        throw new RangeError(
          `encoded payload of ${String(bytes.length)} bytes does not fit in ${String(target.length - offset)} available bytes`,
        );
      }
      target.set(bytes, offset);
      return bytes.length;
    },

    async serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void> {
      const writer = sink.getWriter();
      try {
        await writer.write(encodeToBytes(value, replacer));
      } finally {
        // Release the lock, never close: the sink is caller-owned (SERDE-3).
        writer.releaseLock();
      }
    },
  });
}
```

Leave `makeDeserializer` and `jsonSerde` for Task 10 — this task's tests only exercise the encode side, and the
file will not compile without them. To keep the task independently green, add a minimal stub now and replace it
in Task 10:

```typescript
function makeDeserializer(): Deserializer {
  return Object.freeze({
    deserialize<T>(_data: Uint8Array, _schema: Schema<T>, _typeName?: string): T {
      throw new DeserializationError('not implemented until Task 10');
    },
    deserializeFrom<T>(_source: ReadableStream<Uint8Array>, _schema: Schema<T>, _typeName?: string): Promise<T> {
      return Promise.reject(new DeserializationError('not implemented until Task 10'));
    },
  });
}

/**
 * A behaviour-neutral stand-in for the Tristate replacer, replaced in Task 11.
 *
 * Not `undefined`: `useTristate ? undefined : undefined` is a lint error (`no-unnecessary-condition`) and reads
 * as a typo. A passthrough keeps this task independently green and lint-clean while making the seam Task 11
 * fills obvious.
 */
const PASSTHROUGH_REPLACER = (_key: string, value: unknown): unknown => value;

/** Build a fresh JSON {@link Serde} (SERDE-1, SERDE-2, SERDE-25). */
export function jsonSerde(options?: JsonSerdeOptions): Serde {
  const useTristate = options?.tristate ?? true;
  // Task 11 swaps PASSTHROUGH_REPLACER for the real `tristateReplacer`. Until then the option is accepted but
  // has no observable effect, which is why SERDE-19's proof lives in Task 11's tests, not this task's.
  const replacer = useTristate ? PASSTHROUGH_REPLACER : undefined;
  return Object.freeze({
    mediaType: MEDIA_TYPE,
    serializer: makeSerializer(replacer),
    deserializer: makeDeserializer(),
  });
}
```

- [ ] **Step 4: Export from the package barrel**

Replace `packages/codec-json/src/index.ts`'s `export {}` with:

```typescript
export {jsonSerde} from './json-serde.js';
export type {JsonSerdeOptions} from './json-serde.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/codec-json && bun test src/json-serde.test.ts`
Expected: 10 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/codec-json/src/json-serde.ts packages/codec-json/src/json-serde.test.ts packages/codec-json/src/index.ts
git commit -m "feat(codec-json): add jsonSerde() encode side with offset-honoring buffer profile (SERDE-1/2/3/4)"
```

---

### Task 10: `jsonSerde()` — the decode side

**Files:**
- Modify: `packages/codec-json/src/json-serde.ts` (replace the Task 9 stub)
- Modify: `packages/codec-json/src/json-serde.test.ts` (append)

**Interfaces:**
- Consumes: Task 9's module.
- Produces: a working `Deserializer` on the bundle `jsonSerde()` returns.

- [ ] **Step 1: Write the failing test**

Append to `packages/codec-json/src/json-serde.test.ts`:

```typescript
import {DeserializationError, type Schema} from '@dexpace/core';
import {IoError} from '@dexpace/core';

interface Dto {
  readonly id: number;
}

const dtoSchema: Schema<Dto> = {
  parse(input: unknown): Dto {
    if (typeof input !== 'object' || input === null || typeof (input as Dto).id !== 'number') {
      throw new Error('not a Dto');
    }
    return input as Dto;
  },
};

const bytes = (text: string) => new TextEncoder().encode(text);

const streamOf = (text: string) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(text));
      controller.close();
    },
  });

test('decode runs the schema over the parsed value (SERDE-5)', () => {
  expect(jsonSerde().deserializer.deserialize(bytes('{"id":3}'), dtoSchema, 'Dto')).toEqual({id: 3});
});

test('a parametric target is just a combinator schema — no carrier type exists (SERDE-6)', () => {
  const arraySchema: Schema<readonly Dto[]> = {
    parse: (input) => (input as unknown[]).map((e) => dtoSchema.parse(e)),
  };
  expect(jsonSerde().deserializer.deserialize(bytes('[{"id":1},{"id":2}]'), arraySchema)).toEqual([
    {id: 1},
    {id: 2},
  ]);
});

test('malformed JSON throws DeserializationError with the library error chained (SERDE-9)', () => {
  let caught: unknown;
  try {
    jsonSerde().deserializer.deserialize(bytes('{not json'), dtoSchema, 'Dto');
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DeserializationError);
  expect((caught as DeserializationError).cause).toBeInstanceOf(SyntaxError);
});

test('a schema rejection throws DeserializationError naming the target (SERDE-9)', () => {
  expect(() => jsonSerde().deserializer.deserialize(bytes('{"id":"x"}'), dtoSchema, 'Dto')).toThrow(/Dto/);
});

test('a wire null into a non-null target fails naming the target, on every entry point (SERDE-13)', async () => {
  expect(() => jsonSerde().deserializer.deserialize(bytes('null'), dtoSchema, 'Dto')).toThrow(
    DeserializationError,
  );
  expect(() => jsonSerde().deserializer.deserialize(bytes('null'), dtoSchema, 'Dto')).toThrow(/Dto/);
  await expect(jsonSerde().deserializer.deserializeFrom(streamOf('null'), dtoSchema, 'Dto')).rejects.toThrow(
    /Dto/,
  );
});

test('the null rejection falls back to a documented label when no typeName is given', () => {
  expect(() => jsonSerde().deserializer.deserialize(bytes('null'), dtoSchema)).toThrow(/the target type/);
});

test('deserializeFrom reads to EOF across multiple chunks and never cancels the source (SERDE-3)', async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes('{"id"'));
      controller.enqueue(bytes(':42}'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(jsonSerde().deserializer.deserializeFrom(source, dtoSchema, 'Dto')).resolves.toEqual({id: 42});
  expect(cancelled).toBe(false);
});

test('a genuine stream failure propagates unwrapped (SERDE-12)', async () => {
  const failure = new IoError('socket reset');
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });
  let caught: unknown;
  try {
    await jsonSerde().deserializer.deserializeFrom(source, dtoSchema, 'Dto');
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBe(failure);
});

test('a UTF-8 payload split mid-multi-byte-character across chunks decodes correctly', async () => {
  const full = bytes('{"id":1,"n":"ü"}');
  const split = full.indexOf(0xc3); // the first byte of "ü"
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(full.slice(0, split + 1));
      controller.enqueue(full.slice(split + 1));
      controller.close();
    },
  });
  const looseSchema: Schema<{id: number; n: string}> = {parse: (i) => i as {id: number; n: string}};
  await expect(jsonSerde().deserializer.deserializeFrom(source, looseSchema)).resolves.toEqual({
    id: 1,
    n: 'ü',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/codec-json && bun test src/json-serde.test.ts`
Expected: FAIL — every new test hits `not implemented until Task 10`.

- [ ] **Step 3: Write the implementation**

Replace the Task 9 stub in `packages/codec-json/src/json-serde.ts`:

```typescript
const UNNAMED_TARGET = 'the target type';

function decodeText<T>(text: string, schema: Schema<T>, typeName: string | undefined): T {
  const target = typeName ?? UNNAMED_TARGET;

  let parsed: unknown;
  try {
    // `as unknown`: JSON.parse is typed `any`, which would silently infect everything downstream. The cast
    // narrows *away* from `any`, the one direction the type-system chapter asks for at a boundary.
    parsed = JSON.parse(text) as unknown;
  } catch (e: unknown) {
    throw new DeserializationError(`malformed JSON while decoding ${target}`, {cause: e});
  }

  // SERDE-13, checked here rather than delegated: a schema library may or may not reject a bare null, and may
  // or may not name the target when it does. Checking in the codec makes the behavior uniform across every
  // entry point and every schema library a caller might supply.
  if (parsed === null) {
    throw new DeserializationError(`wire null cannot be decoded into the non-null target ${target}`);
  }

  try {
    return schema.parse(parsed);
  } catch (e: unknown) {
    throw new DeserializationError(`value does not match the schema for ${target}`, {cause: e});
  }
}

function makeDeserializer(): Deserializer {
  return Object.freeze({
    deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T {
      return decodeText(new TextDecoder().decode(data), schema, typeName);
    },

    async deserializeFrom<T>(
      source: ReadableStream<Uint8Array>,
      schema: Schema<T>,
      typeName?: string,
    ): Promise<T> {
      // `text` accumulates the WHOLE body before parsing, and is deliberately uncapped.
      //
      // SERDE-27 asks a decoder not to materialize the body. `JSON.parse` has no incremental form, so this
      // codec cannot honor that — a limitation of the format, not of the seam: `decodeResponse` hands over the
      // live stream and never buffers, and a codec with a streaming parser satisfies SERDE-27 fully behind this
      // same interface. Recorded in the phase's Deviation Ledger.
      //
      // No byte cap: truncating a legitimate large payload is a worse failure than the memory it would save,
      // and a caller who needs a bound imposes it on the transport, where the whole response is bounded at once.
      //
      // A streaming decoder keeps multi-byte characters intact across chunk boundaries; decoding each chunk
      // independently would corrupt any character split across two reads.
      const decoder = new TextDecoder('utf-8');
      const reader = source.getReader();
      let text = '';
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          if (value !== undefined) text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
      } finally {
        // Release the lock, never cancel: the source is caller-owned (SERDE-3). A stream failure surfaces from
        // `read()` and propagates unwrapped (SERDE-12) — it is not caught here.
        reader.releaseLock();
      }
      return decodeText(text, schema, typeName);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/codec-json && bun test src/json-serde.test.ts`
Expected: 19 pass, 0 fail.

- [ ] **Step 5: Add the round-trip property test**

```typescript
// packages/codec-json/src/json-serde.property.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-1 (the bundle's own serializer and deserializer round-trip each other).
import {test} from 'bun:test';
import fc from 'fast-check';
import type {Schema} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

const identity = <T,>(): Schema<T> => ({parse: (input) => input as T});

test('serialize → deserialize is the identity for any JSON value except null', () => {
  fc.assert(
    fc.property(
      fc.jsonValue().filter((v) => v !== null),
      (value) => {
        const serde = jsonSerde();
        const decoded = serde.deserializer.deserialize(serde.serializer.serialize(value), identity());
        return JSON.stringify(decoded) === JSON.stringify(value);
      },
    ),
  );
});
```

Run: `cd packages/codec-json && bun test src/json-serde.property.test.ts`
Expected: PASS. (`null` is excluded because `SERDE-13` makes decoding a bare `null` an error by design.)

- [ ] **Step 6: Commit**

```bash
git add packages/codec-json/src/json-serde.ts packages/codec-json/src/json-serde.test.ts packages/codec-json/src/json-serde.property.test.ts
git commit -m "feat(codec-json): add the decode side with uniform wire-null rejection (SERDE-5/6/9/12/13)"
```

---

### Task 11: The `Tristate` encode replacer

**Files:**
- Create: `packages/codec-json/src/tristate-replacer.ts`
- Create: `packages/codec-json/src/tristate-replacer.test.ts`
- Modify: `packages/codec-json/src/json-serde.ts` (wire the replacer into `jsonSerde`)

**Interfaces:**
- Consumes: `isTristate`, `Tristate` from `@dexpace/core`.
- Produces: `function tristateReplacer(this: unknown, key: string, value: unknown): unknown`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/codec-json/src/tristate-replacer.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-15 (Absent omits the key, Null emits a wire null, Present emits the value),
// SERDE-19 (installed by default; opt-out is explicit), SERDE-20 (top-level and array-element degradation).
import {expect, test} from 'bun:test';
import {absent, nullValue, present} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

const encode = (value: unknown, tristate = true) =>
  new TextDecoder().decode(jsonSerde({tristate}).serializer.serialize(value));

test('Absent omits the key entirely (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: absent()})).toBe('{"name":"a"}');
});

test('Null emits the key with a wire null (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: nullValue()})).toBe('{"name":"a","nickname":null}');
});

test('Present emits the key with the encoded inner value (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: present('bee')})).toBe('{"name":"a","nickname":"bee"}');
});

test('a Present carrying an object encodes the object, not the wrapper', () => {
  expect(encode({at: present({deep: 1})})).toBe('{"at":{"deep":1}}');
});

test('the wiring is on by default (SERDE-19)', () => {
  expect(new TextDecoder().decode(jsonSerde().serializer.serialize({x: absent()}))).toBe('{}');
});

test('opting out is explicit, and then Absent and Null become indistinguishable (SERDE-19)', () => {
  const out = encode({x: absent()}, false);
  // Without the wiring the raw union shape leaks — which is exactly why the option must be named, never silent.
  expect(out).not.toBe('{}');
});

test('a top-level Absent or Null degrades to a wire null rather than throwing (SERDE-20)', () => {
  expect(encode(absent())).toBe('null');
  expect(encode(nullValue())).toBe('null');
});

test('an array-element Absent emits null rather than shifting or dropping the element (SERDE-20)', () => {
  expect(encode([present(1), absent(), nullValue()])).toBe('[1,null,null]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/codec-json && bun test src/tristate-replacer.test.ts`
Expected: FAIL — Absent currently serializes as its raw union shape.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/codec-json/src/tristate-replacer.ts
// SPDX-License-Identifier: MIT
import {isTristate} from '@dexpace/core';

/**
 * `JSON.stringify` replacer implementing PATCH three-state semantics (SERDE-15).
 *
 * Absent → the key is omitted entirely (a PATCH server reads that as "leave unchanged").
 * Null → the key is emitted with a wire `null` ("clear").
 * Present → the key is emitted with the inner value.
 *
 * Returning `undefined` from a replacer makes `JSON.stringify` drop the key — the exact mechanism this
 * requirement needs, built into the language. Two positions cannot drop anything, so SERDE-20's degradation
 * applies there: a **top-level** value and an **array element** both render `null` for Absent rather than
 * throwing or, worse, silently shifting an array's indices.
 *
 * `this` is the object currently being serialized; `key` is `''` at the top level and a numeric string inside
 * an array. Both facts are how the two degradation positions are detected.
 */
export function tristateReplacer(this: unknown, key: string, value: unknown): unknown {
  if (!isTristate(value)) return value;

  if (value.kind === 'present') return value.value;

  const atTopLevel = key === '';
  const insideArray = Array.isArray(this);
  if (value.kind === 'absent' && !atTopLevel && !insideArray) return undefined;

  return null;
}
```

- [ ] **Step 4: Wire it into `jsonSerde`**

In `packages/codec-json/src/json-serde.ts`, replace the Task 9 placeholder line

```typescript
const replacer = useTristate ? PASSTHROUGH_REPLACER : undefined;
```

with

```typescript
const replacer = useTristate ? tristateReplacer : undefined;
```

and delete `PASSTHROUGH_REPLACER` — nothing else references it.

and add `import {tristateReplacer} from './tristate-replacer.js';`.

**Note on `JSON.stringify`'s top-level replacer call:** `JSON.stringify(x, replacer)` invokes the replacer once
with `key === ''` and `this` set to a synthetic wrapper `{'': x}`, *before* descending. The implementation above
relies on that, which is why the top-level Absent case renders `null` rather than producing `undefined` (which
`JSON.stringify` would turn into the return value `undefined`, not the string `'null'`). The
`?? 'null'` fallback already present in `encodeToBytes` is a second belt on the same behavior.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/codec-json && bun test`
Expected: all tests pass, including Task 9's and Task 10's.

- [ ] **Step 6: Commit**

```bash
git add packages/codec-json/src/tristate-replacer.ts packages/codec-json/src/tristate-replacer.test.ts packages/codec-json/src/json-serde.ts
git commit -m "feat(codec-json): add the Tristate replacer with top-level/array degradation (SERDE-15/19/20)"
```

---

### Task 12: The `tristate()` decode combinator

**Files:**
- Create: `packages/codec-json/src/tristate-schema.ts`
- Create: `packages/codec-json/src/tristate-schema.test.ts`
- Modify: `packages/codec-json/src/index.ts`

**Interfaces:**
- Consumes: `Schema`, `Tristate`, `absent`, `nullValue`, `present` from `@dexpace/core`.
- Produces: `function tristate<T>(inner: Schema<T>): Schema<Tristate<T>>`;
  `function tristateObject<S extends Record<string, Schema<unknown>>>(shape: S): Schema<...>` — see below.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/codec-json/src/tristate-schema.test.ts
// SPDX-License-Identifier: MIT
// Exercises: SERDE-16 (missing → Absent, explicit null → Null, value → Present with element type preserved),
// SERDE-17 (a missing key resolves to Absent via the combinator's own default, not a JSON.parse reviver).
import {expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Schema, Tristate} from '@dexpace/core';
import {tristate, tristateObject} from './tristate-schema.js';

const numberSchema: Schema<number> = {
  parse(input: unknown): number {
    if (typeof input !== 'number') throw new Error('not a number');
    return input;
  },
};

const stringSchema: Schema<string> = {
  parse(input: unknown): string {
    if (typeof input !== 'string') throw new Error('not a string');
    return input;
  },
};

const MISSING = Symbol.for('@dexpace/codec-json.missing');

test('an explicit null decodes to Null (SERDE-16)', () => {
  expect(tristate(numberSchema).parse(null).kind).toBe('null');
});

test('a present value decodes to Present with the inner schema applied (SERDE-16)', () => {
  const decoded = tristate(numberSchema).parse(5);
  // Assert the fields directly. Spreading `decoded` into its own expectation (`{...decoded, kind: 'present'}`)
  // would be a tautology that passes for any input.
  expect(decoded.kind).toBe('present');
  expect(decoded.kind === 'present' ? decoded.value : undefined).toBe(5);
});

test('the inner schema still rejects a wrong-typed present value', () => {
  expect(() => tristate(numberSchema).parse('5')).toThrow();
});

test('the missing sentinel decodes to Absent (SERDE-17)', () => {
  expect(tristate(numberSchema).parse(MISSING).kind).toBe('absent');
});

test('tristateObject maps a missing key to Absent and a present key through the field schema (SERDE-17)', () => {
  const schema = tristateObject({age: numberSchema});
  expect(schema.parse({}).age.kind).toBe('absent');
  expect(schema.parse({age: null}).age.kind).toBe('null');
  const present = schema.parse({age: 30}).age;
  expect(present.kind === 'present' ? present.value : undefined).toBe(30);
});

test('tristateObject leaves non-tristate keys untouched', () => {
  const schema = tristateObject({age: numberSchema});
  expect(schema.parse({age: 1, other: 'kept'}).age.kind).toBe('present');
});

test('tristateObject preserves each field\'s element type through the mapped return (SERDE-16)', () => {
  // `tristateObject`'s return is a mapped-plus-conditional type built behind an `as never`, so a runtime test
  // cannot catch an inference regression here — only `expectTypeOf` can (docs/knowledge/testing.md:30).
  const parsed = tristateObject({age: numberSchema, name: stringSchema}).parse({});
  expectTypeOf(parsed.age).toEqualTypeOf<Tristate<number>>();
  expectTypeOf(parsed.name).toEqualTypeOf<Tristate<string>>();
  // A key the shape never named stays `unknown`, not `Tristate<unknown>`.
  expectTypeOf(parsed.somethingElse).toBeUnknown();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/codec-json && bun test src/tristate-schema.test.ts`
Expected: FAIL — `Cannot find module './tristate-schema.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/codec-json/src/tristate-schema.ts
// SPDX-License-Identifier: MIT
import {absent, nullValue, present, type Schema, type Tristate} from '@dexpace/core';

/**
 * The sentinel a caller passes for "this key was not on the wire."
 *
 * `SERDE-17` is the awkward half of Tristate decoding: a `JSON.parse` reviver runs bottom-up per key and never
 * fires for a key that is *absent*, so the raw JSON layer structurally cannot tell Absent from Null. The
 * reference resolves this one layer up, in the codec's field-default machinery; this port resolves it one layer
 * up too, in the schema combinator — {@link tristateObject} looks the key up on the parsed object and feeds this
 * sentinel to the field's schema when it is missing.
 */
export const MISSING: unique symbol = Symbol.for('@dexpace/codec-json.missing');

/** Wrap a schema so it decodes the three PATCH states (SERDE-16). */
export function tristate<T>(inner: Schema<T>): Schema<Tristate<T>> {
  return {
    parse(input: unknown): Tristate<T> {
      if (input === MISSING || input === undefined) return absent();
      if (input === null) return nullValue();
      // `as NonNullable<T>`: the null and undefined branches returned above, so the value cannot be nullish —
      // a fact the compiler cannot derive through `inner.parse`'s unconstrained `T`.
      return present<T>(inner.parse(input) as NonNullable<T>);
    },
  };
}

/**
 * Build an object schema whose named fields decode as Tristate, feeding {@link MISSING} for keys the wire
 * omitted (SERDE-17).
 *
 * Keys not named in `shape` pass through untouched, so this composes with a caller's own schema for the rest of
 * the DTO rather than replacing it.
 */
export function tristateObject<S extends Record<string, Schema<unknown>>>(
  shape: S,
): Schema<{[K in keyof S]: Tristate<S[K] extends Schema<infer T> ? T : never>} & Record<string, unknown>> {
  const fields = Object.entries(shape).map(([key, inner]) => [key, tristate(inner)] as const);
  return {
    parse(input: unknown) {
      if (typeof input !== 'object' || input === null) {
        throw new TypeError('tristateObject expects an object');
      }
      // `as Record<string, unknown>`: the guard above established it is a non-null object; TypeScript narrows
      // to `object`, which is not indexable.
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {...source};
      for (const [key, schema] of fields) {
        out[key] = schema.parse(key in source ? source[key] : MISSING);
      }
      // `as never`: the declared return is a mapped-plus-conditional type the compiler cannot see this loop
      // building key by key. The type-level test below is what actually checks it — no runtime test can.
      return out as never;
    },
  };
}
```

- [ ] **Step 4: Export from the package barrel**

Append to `packages/codec-json/src/index.ts`:

```typescript
export {MISSING, tristate, tristateObject} from './tristate-schema.js';
export {tristateReplacer} from './tristate-replacer.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/codec-json && bun test src/tristate-schema.test.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add packages/codec-json/src/tristate-schema.ts packages/codec-json/src/tristate-schema.test.ts packages/codec-json/src/index.ts
git commit -m "feat(codec-json): add the tristate() decode combinator resolving Absent one layer up (SERDE-16/17)"
```

---

### Task 13: Cross-package guard + collapsed-requirement conformance + close-out

**Files:**
- Create: `packages/codec-json/src/cross-package.test.ts`
- Create: `packages/codec-json/src/conformance.test.ts`
- Create: `packages/codec-json/etc/codec-json.api.md` (generated)
- Create: `.changeset/phase6a-codec-json.md`
- Modify: `docs/work/mvp/2026-07-23-nodejs-sdk-v1-roadmap-design.md` (mark the three retargeted rows
  resolved)

**Interfaces:**
- Consumes: everything above.
- Produces: no new API — this task is the phase's evidence.

- [ ] **Step 1: Write the dual-package-hazard guard**

```typescript
// packages/codec-json/src/cross-package.test.ts
// SPDX-License-Identifier: MIT
// Guards the dual-package hazard sdk-design-nodejs/02 §2 describes. A `Tristate` constructed in @dexpace/core
// must be recognized by codec-json's replacer. Two non-identical copies of core in one tree would mean two
// distinct brand symbols and a silently wrong wire payload — a key emitted that the caller asked to omit.
import {expect, test} from 'bun:test';
import {absent, nullValue, present, TRISTATE_BRAND, isTristate} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

test('the brand symbol is registry-global, so two copies of core still agree', () => {
  expect(TRISTATE_BRAND).toBe(Symbol.for('@dexpace/core.Tristate'));
});

test('a Tristate constructed in core is recognized by codec-json', () => {
  expect(isTristate(absent())).toBe(true);
  expect(isTristate(present(1))).toBe(true);
});

test('a core-constructed Tristate round-trips through the codec with PATCH semantics intact', () => {
  const encoded = new TextDecoder().decode(
    jsonSerde().serializer.serialize({keep: absent(), clear: nullValue(), set: present('v')}),
  );
  expect(encoded).toBe('{"clear":null,"set":"v"}');
});

test('a caller object that merely has a kind field is not mistaken for a Tristate', () => {
  const decoy = {kind: 'absent'};
  expect(isTristate(decoy)).toBe(false);
  expect(new TextDecoder().decode(jsonSerde().serializer.serialize({x: decoy}))).toBe(
    '{"x":{"kind":"absent"}}',
  );
});
```

- [ ] **Step 2: Write the collapsed-requirement conformance tests**

These requirements are satisfied by construction — no code in this repo implements them. The tests **are** the
coverage, and Phase 9's sweep reads them as the evidence.

```typescript
// packages/codec-json/src/conformance.test.ts
// SPDX-License-Identifier: MIT
// Exercises the requirements the Phase 6a design dispositions as satisfied-by-construction: SERDE-21 (no
// cross-shape coercion), SERDE-22 (representation-preserving conversions still bind), SERDE-24 (ISO-8601
// dates round-trip), SERDE-29 (a bundle is safe to share once configured).
import {expect, test} from 'bun:test';
import type {Schema} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

const numberSchema: Schema<number> = {
  parse: (i) => {
    if (typeof i !== 'number') throw new Error('not a number');
    return i;
  },
};
const intSchema: Schema<number> = {
  parse: (i) => {
    if (!Number.isInteger(i)) throw new Error('not an integer');
    return i as number;
  },
};
const boolSchema: Schema<boolean> = {
  parse: (i) => {
    if (typeof i !== 'boolean') throw new Error('not a boolean');
    return i;
  },
};
const stringSchema: Schema<string> = {
  parse: (i) => {
    if (typeof i !== 'string') throw new Error('not a string');
    return i;
  },
};

const decode = <T,>(json: string, schema: Schema<T>) =>
  jsonSerde().deserializer.deserialize(new TextEncoder().encode(json), schema, 'Target');

test.each([
  ['string → integer', '"5"', intSchema],
  ['string → float', '"1.5"', numberSchema],
  ['string → boolean', '"true"', boolSchema],
  ['empty string → integer', '""', intSchema],
  ['empty string → float', '""', numberSchema],
  ['empty string → boolean', '""', boolSchema],
  ['float → integer (lossy narrowing)', '1.5', intSchema],
  ['boolean → integer', 'true', intSchema],
  ['integer → boolean', '1', boolSchema],
  ['boolean → float', 'true', numberSchema],
  ['integer → string', '5', stringSchema],
])('SERDE-21: %s is rejected, never silently reshaped', (_name, json, schema) => {
  expect(() => decode(json, schema)).toThrow();
});

test('SERDE-22: an integer binds to a float target (JavaScript has one numeric type)', () => {
  expect(decode('5', numberSchema)).toBe(5);
});

test('SERDE-22: an empty string binds to a textual target', () => {
  expect(decode('""', stringSchema)).toBe('');
});

test('SERDE-24: a Date encodes as ISO-8601 and round-trips to the same instant', () => {
  const instant = new Date('2026-07-28T12:34:56.789Z');
  const encoded = new TextDecoder().decode(jsonSerde().serializer.serialize({at: instant}));
  expect(encoded).toBe('{"at":"2026-07-28T12:34:56.789Z"}');
  const dateSchema: Schema<{at: Date}> = {parse: (i) => ({at: new Date((i as {at: string}).at)})};
  expect(decode(encoded, dateSchema).at.getTime()).toBe(instant.getTime());
});

test('SERDE-29: one bundle serves many concurrent operations without cross-talk', async () => {
  const serde = jsonSerde();
  const identity: Schema<unknown> = {parse: (i) => i};
  const results = await Promise.all(
    Array.from({length: 200}, (_, i) =>
      Promise.resolve(serde.deserializer.deserialize(serde.serializer.serialize({i}), identity)),
    ),
  );
  expect(results).toEqual(Array.from({length: 200}, (_, i) => ({i})));
});
```

- [ ] **Step 3: Run both suites**

Run: `cd packages/codec-json && bun test`
Expected: all pass.

- [ ] **Step 4: Generate the second api-extractor report**

Run: `cd packages/codec-json && bun run build && bun run api -- --local`
Expected: `packages/codec-json/etc/codec-json.api.md` is created, listing `jsonSerde`, `JsonSerdeOptions`,
`MISSING`, `tristate`, `tristateObject`, `tristateReplacer` — and nothing else.

- [ ] **Step 5: Document `SERDE-23`'s delegation in the codec's TSDoc**

`SERDE-23` (SHOULD — ignore unknown/unexpected fields so a server can add backward-compatible fields ahead of a
client model update) is the one requirement this port satisfies by *delegation* rather than by code: whether an
extra wire key is stripped or rejected is a property of the caller's schema, and core overriding it would defeat
the point of caller-supplied schemas. Say so where a caller will actually read it — append to `jsonSerde`'s
TSDoc in `packages/codec-json/src/json-serde.ts`:

```typescript
/**
 * ...
 *
 * **Unknown wire fields (SERDE-23).** This codec does not strip or reject them — that is your schema's
 * decision. Prefer the permissive default (Zod's `.parse()` strips unknown keys; `.strict()` rejects them), so
 * a server adding a backward-compatible field does not break clients that have not been regenerated yet. If you
 * opt into a strict schema, you are opting out of that forward compatibility deliberately.
 */
```

- [ ] **Step 6: Write the changeset**

```markdown
<!-- .changeset/phase6a-codec-json.md -->
---
'@dexpace/codec-json': minor
---

Initial release: `jsonSerde()`, the `Tristate` PATCH replacer (on by default), and the `tristate()` /
`tristateObject()` decode combinators. Depends on nothing beyond a `@dexpace/core` peer.
```

- [ ] **Step 7: Close out the roadmap rows**

In `docs/work/mvp/2026-07-23-nodejs-sdk-v1-roadmap-design.md`, mark these Deferred-Items-Log rows'
target column **Resolved in Phase 6a**, adding one sentence of evidence each:

- `NFR-2` — codec half closed; `packages/codec-json` ships with `dependencies: {}` and zero external libraries.
- `NFR-14` — the root `catalog` block is the single source of version truth (or the documented Bun-version
  fallback from Task 8 Step 4).
- Peer-dependency dedup — `codec-json` declares the peer + meta, `scripts/verify-seam-1.mjs` asserts it for every
  non-core package, and `cross-package.test.ts` proves the brand survives the boundary.
- `Concrete Serde implementation (@dexpace/codec-json)` and `SEAM-21` — both closed.

Do **not** mark `NFR-8`/`NFR-9` resolved here. `NFR-8` names "the runtime-wired SPI seams … (serde)" and "the
Tristate type" among the surfaces a shipped keep-configuration must cover, and both are created in this phase —
but the keep-config and its shrink-and-run guard are one workspace-wide deliverable.
`plans/2026-07-28-phase9-cross-cutting-conformance.md` ships `@dexpace/shrink-test` and already lists
`@dexpace/codec-json` and `jsonSerde` in `participatingPackages` and its fixture app. 6a's only obligation is
that both surfaces stay reachable through the public barrels, which Task 7 and Task 13 Step 1 prove. Record the
deferral against Phase 9 by name so a Phase 9 sweep does not read two MUSTs as dropped.

- [ ] **Step 8: Run the full gate**

Run: `cd /home/mohammad/Projects/dexpace/nodejs-sdk && bun install && bun run typecheck && bun run lint && bun run build && bun test --coverage && bun run api && bun run lint:publish && bun run verify:dual-consumption && bun run verify:seam-1 && bun run verify:node-floor && bun run test:node && bun run audit`
Expected: every command exits 0. **Do not claim the phase is done on any other basis** — paste the failing
command's output instead if one does not.

- [ ] **Step 9: Commit**

```bash
git add packages/codec-json .changeset docs/work/mvp/2026-07-23-nodejs-sdk-v1-roadmap-design.md
git commit -m "test(codec-json): guard the dual-package hazard and the collapsed SERDE requirements (SERDE-21/22/24/29)"
```

---

## Deviation Ledger Additions (for Phase 10)

Append these to the running ledger when this phase completes:

| Deviation | Against | Reason |
|---|---|---|
| No generic type carrier / `TypeRef` type exists | `SERDE-6`, `SERDE-8` | The schema is both runtime witness and static type, produced by one caller statement; nothing is erased that needs reconstructing |
| No codec-configuration surface (coercion policy, unknown-field policy, date format) | `SERDE-21`–`SERDE-26` | `JSON.parse`/`JSON.stringify` expose no such knobs and there is no engine object to copy or mutate; strictness lives in the caller's schema, one layer up |
| `SERDE-23` satisfied by delegation, not enforcement | `SERDE-23` (SHOULD) | Core cannot override a caller's schema strictness without defeating the point of caller-supplied schemas. Documented as a recommendation in the codec's TSDoc |
| `Serde` is not generic in a payload type | Phase 2's provisional `Serde<T>` | A bundle is per-format, not per-type, once the witness is a decode parameter — which is what `SERDE-1` says |
| `SERDE-7`'s reified/inline decode helper is not shipped | `SERDE-7` | TypeScript has no reified generics; the schema parameter is already mandatory on every decode entry point, so there is no less-typed path for a helper to route away from |
| No serde-specific error base class; two flat leaves under `DexpaceError` plus an `isSerdeError` guard | `SEAM-23`, `SERDE-9`/`SERDE-10` ("both of the common serde exception root") | The checkpoint's §5.2 two-level cap is why 3b retrofitted `IoError`'s tier away; a `SerdeError` base would be the third instance of the banned shape. `DexpaceError` is the common root and `isSerdeError` is the catch-one-category mechanism, so the requirement's intent holds and its structure does not |
| `@dexpace/codec-json` buffers the whole decoded body before parsing, with no byte cap | `SERDE-27` ("without first materializing the whole body as a string/byte array") | `JSON.parse` has no incremental form. `decodeResponse` itself never buffers, so the seam honors the requirement and this one codec cannot; a streaming-parser codec satisfies it behind the same interface. A cap is deliberately not imposed — truncating a legitimate large payload is worse than the memory it saves |
| `foldTristate` and both response handlers take an options object where the reference's shape would be positional | `docs/knowledge/function-design.md:22-23` vs `max-params: 3` (recorded corpus conflict) | Four positional parameters is a lint error; the corpus's prose rule and its own enforcement threshold disagree by one, and this phase follows the enforcement threshold, as 4b's `fold` did |
