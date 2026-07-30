# Phase 8b — Async-Runtime Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@dexpace/rx`, exposing Phase 6's `SseStream`/`typedSseStream` and `Paginator` as RxJS `Observable`s,
per `docs/superpowers/specs/2026-07-28-phase8b-async-runtime-design.md`. Satisfies the non-collapsed subset of
`docs/product-spec/18-asynchronous-runtime-adapter-contract.md` and `SSE-41`.

**Architecture:** One thin package. The bridge logic itself is RxJS's own native `from(asyncIterable)` — this
plan's job is to prove that primitive satisfies every `ASYNC-21`/`ASYNC-6`/`ASYNC-13` clause with a conformance
suite, ship four one-line named wrapper functions over it, and document the single-subscription (SSE) vs.
cold/repeatable (pagination) asymmetry precisely.

**Tech Stack:** TypeScript 5.8+, `rxjs` ^7.8 (peer dependency), `bun test`. No `node:` imports.

**Prerequisite:** Phases 0 through 7b implemented exactly as their plans specify, plus Phase 6b (`SseStream`,
`typedSseStream`) and Phase 6c (`Paginator`, `Page`). This plan does not depend on 8a (`transport-fetch`/
`transport-undici`) in either direction — the segmentation design's zero-cross-dependency finding, confirmed
again by this phase's own design doc §1. Concretely consumed:

- `packages/core/src/sse/sse-stream.ts` — `SseStream`
- `packages/core/src/sse/typed.ts` — `typedSseStream`, `SseMapper`, `MapperOutcome`
- `packages/core/src/pagination/paginator.ts` — `Paginator`, `Page`

The full gate sequence (`typecheck`/`lint`/`build`/`test --coverage`/`api`/`lint:publish`/
`verify:dual-consumption`/`verify:seam-1`/`verify:node-floor`/`test:node`/`audit`) is green on `main`.

## Global Constraints

- **Do not hand-write an `AsyncIterable`-to-`Observable` pull loop.** Use RxJS's own `from()`. The whole point of
  this plan's Task 1 is proving that primitive already does the right thing, not replacing it.
- **`rxjs` is a peer dependency, not a regular one.** A consuming application very likely pins its own RxJS
  version; a bundled copy risks the same dual-package-hazard class `@dexpace/core`'s peer-dedup guard exists to
  prevent for `Observable`/`Subscription` identity.
- **No new `Error` subclass.** Every error `@dexpace/rx`'s surface can produce originates from the wrapped
  `AsyncIterable` and passes through unmodified.
- **`sseEvents$`/`typedSse$` must document single-subscription behavior in their own TSDoc**, not only in the
  design doc — a caller reading the function signature must see the restriction before hitting it at runtime.
- **No RxJS scheduler operators (`observeOn`, `subscribeOn`, etc.) anywhere in this package's own production
  code.** Introducing one would reintroduce the `AsyncLocalStorage`-propagation gap the design doc's §3
  deliberately keeps out of scope — that is a caller's decision to make downstream of this package's output, not
  this package's to make for them.
- **ESLint limits are hard:** `max-params: 3`, `max-depth: 3`, `max-lines-per-function: 70`.
- **`exactOptionalPropertyTypes` is on.** No optional-typed field lacks `| undefined`.
- **No TS `enum`.** Named exports only. Kebab-case filenames.
- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT`.

---

## File Structure

```
packages/rx/
  package.json                                  # peerDependencies: {"@dexpace/core", "rxjs": "^7.8.0"}
  tsconfig.json
  api-extractor.json
  etc/rx.api.md
  src/
    from-async-iterable.conformance.test.ts       # proves RxJS's from() satisfies ASYNC-6/13/21     (Task 1)
    sse.ts                                          # sseEvents$, typedSse$                          (Task 2)
    pagination.ts                                    # pageItems$, pages$                            (Task 3)
    index.ts                                          # public barrel                                (Task 4)
```

Three production files (one of them a conformance suite that is itself the specification, per the design doc's
§4), each with its own colocated assertions.

---

### Task 1: Conformance suite — proving RxJS's `from()` satisfies `ASYNC-6`/`ASYNC-13`/`ASYNC-21`

**Files:**
- Create: `packages/rx/src/from-async-iterable.conformance.test.ts`

**Interfaces:**
- Consumes: `from` (rxjs).
- Produces: no production export — this is the proof the rest of the package's one-liners rely on.

- [ ] **Step 1: Scaffold the package** — `package.json` with `peerDependencies: {"@dexpace/core": "workspace:*",
  "rxjs": "^7.8.0"}`, `dependencies: {}`; `tsconfig.json` composite, project reference to `../core`.

- [ ] **Step 2: Write the conformance suite**

```typescript
// packages/rx/src/from-async-iterable.conformance.test.ts
// SPDX-License-Identifier: MIT
// Exercises: ASYNC-21 (poll-once-per-demand under a synchronous subscriber, complete on end-of-source,
// propagate a source error as an error signal), ASYNC-13 (no wrapper exception around a thrown value),
// ASYNC-6 (unsubscribe reaches the source's .return() exactly once).
// This suite tests RxJS's from() against a hand-built async generator test double, deliberately not
// SseStream/Paginator, to isolate "does RxJS satisfy the contract" from "does 6b/6c's own close discipline
// work" (already proven in their own test suites).
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, from, toArray} from 'rxjs';

async function* countTo(n: number, onReturn?: () => void): AsyncGenerator<number> {
  try {
    for (let i = 1; i <= n; i++) yield i;
  } finally {
    onReturn?.();
  }
}

describe('from(asyncIterable) — ASYNC-21', () => {
  test('polls the source once per emission under a synchronous subscriber', async () => {
    let pulls = 0;
    async function* spy(): AsyncGenerator<number> {
      for (let i = 1; i <= 3; i++) {
        pulls++;
        yield i;
      }
    }
    const values = await firstValueFrom(from(spy()).pipe(toArray()));
    expect(values).toEqual([1, 2, 3]);
    expect(pulls).toBe(3); // never pulled ahead of what was emitted
  });

  test('completes the Observable when the source generator returns', async () => {
    const values = await firstValueFrom(from(countTo(2)).pipe(toArray()));
    expect(values).toEqual([1, 2]);
  });

  test('a source throw surfaces via the error channel with the original value, unwrapped', async () => {
    async function* throwing(): AsyncGenerator<number> {
      yield 1;
      throw new RangeError('boom');
    }
    const errors: unknown[] = [];
    await new Promise<void>((resolve) => {
      from(throwing()).subscribe({
        next: () => {},
        error: (err) => {
          errors.push(err);
          resolve();
        },
      });
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as RangeError).message).toBe('boom'); // ASYNC-13: not wrapped in an RxJS-internal type
  });
});

describe('from(asyncIterable) — ASYNC-6', () => {
  test('unsubscribing mid-stream calls the generator\'s .return() exactly once', async () => {
    let returns = 0;
    const generator = countTo(5, () => {
      returns++;
    });
    await new Promise<void>((resolve) => {
      const subscription = from(generator).subscribe({
        next: (value) => {
          if (value === 2) {
            subscription.unsubscribe();
            // allow the microtask queue to settle the generator's finally block
            setTimeout(resolve, 10);
          }
        },
      });
    });
    expect(returns).toBe(1);
  });
});
```

- [ ] **Step 3: Run**

Run: `cd packages/rx && bun test src/from-async-iterable.conformance.test.ts`
Expected: PASS. **If any assertion fails against the installed RxJS version**, do not proceed to Task 2/3 with a
silent gap — write the minimal wrapping `Observable` needed to close exactly that failing clause (per the design
doc §1's stated fallback policy), scoped narrowly, and document it as a Deviation Ledger addition in this
plan's Self-Review.

- [ ] **Step 4: Commit**

```bash
git add packages/rx/package.json packages/rx/tsconfig.json packages/rx/src/from-async-iterable.conformance.test.ts
git commit -m "test(rx): prove RxJS's from(asyncIterable) satisfies ASYNC-6/13/21 before building on it"
```

---

### Task 2: `sse.ts` — `sseEvents$`, `typedSse$`

**Files:**
- Create: `packages/rx/src/sse.ts`, `sse.test.ts`

**Interfaces:**
- Consumes: `SseStream`, `typedSseStream`, `SseMapper` (`@dexpace/core`, Phase 6b).
- Produces: `sseEvents$(stream: SseStream): Observable<SseEvent>`, `typedSse$<T>(stream: SseStream, mapper:
  SseMapper<T>): Observable<T>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/rx/src/sse.test.ts
// Exercises: SSE-41 (reactive adapter), SSE-26 (single-pass — a second subscription fails loudly, inherited
// from SseStream unmodified, not reimplemented)
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, toArray} from 'rxjs';
import {sseEvents$} from './sse.js';
import {makeSseStreamFixture} from './test-support/sse-fixture.js'; // colocated test helper building a real
// SseStream over an in-memory ReadableStream<Uint8Array> byte fixture, reusing 6b's own test fixtures if exported
// for testing, or a minimal local equivalent if not.

describe('sseEvents$', () => {
  test('emits every parsed SseEvent in order and completes at end-of-stream', async () => {
    const stream = makeSseStreamFixture('data: one\n\ndata: two\n\n');
    const events = await firstValueFrom(sseEvents$(stream).pipe(toArray()));
    expect(events.map((e) => e.data)).toEqual([['one'], ['two']]);
  });

  test('a second subscription fails loudly (SSE-26, inherited)', async () => {
    const stream = makeSseStreamFixture('data: one\n\n');
    const observable = sseEvents$(stream);
    await firstValueFrom(observable.pipe(toArray()));
    await expect(firstValueFrom(observable.pipe(toArray()))).rejects.toBeDefined();
  });

  test('unsubscribing mid-stream closes the underlying SseStream', async () => {
    const stream = makeSseStreamFixture('data: one\n\ndata: two\n\ndata: three\n\n');
    let closeCalled = false;
    const originalClose = stream.close.bind(stream);
    stream.close = async () => {
      closeCalled = true;
      await originalClose();
    };
    const subscription = sseEvents$(stream).subscribe();
    subscription.unsubscribe();
    await new Promise((r) => setTimeout(r, 10));
    expect(closeCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails; Step 3: implement**

```typescript
// packages/rx/src/sse.ts
// SPDX-License-Identifier: MIT
import {from, type Observable} from 'rxjs';
import {typedSseStream, type SseEvent, type SseMapper, type SseStream} from '@dexpace/core';

/**
 * Bridges an SseStream to an Observable (SSE-41). Single-subscription: SseStream wraps an already-open,
 * single-use HTTP response body (BODY-14) and is itself single-pass (SSE-26) -- a second `subscribe()` call
 * reaches SseStream's own "obtaining an iterator succeeds at most once" guard and fails loudly, exactly as
 * subscribing to it twice directly would. This is not a new restriction; it is SseStream's existing contract
 * surfacing through the bridge unchanged.
 */
export function sseEvents$(stream: SseStream): Observable<SseEvent> {
  return from(stream);
}

/** As `sseEvents$`, but running the typed mapper (SSE-33-36) before emission. Same single-subscription note. */
export function typedSse$<T>(stream: SseStream, mapper: SseMapper<T>): Observable<T> {
  return from(typedSseStream(stream, mapper));
}
```

- [ ] **Step 4: Run and confirm it passes; Step 5: commit**

```bash
git add packages/rx/src/sse.ts packages/rx/src/sse.test.ts
git commit -m "feat(rx): add sseEvents\$/typedSse\$, the reactive SSE adapter (SSE-41)"
```

---

### Task 3: `pagination.ts` — `pageItems$`, `pages$`

**Files:**
- Create: `packages/rx/src/pagination.ts`, `pagination.test.ts`

**Interfaces:**
- Consumes: `Paginator`, `Page` (`@dexpace/core`, Phase 6c).
- Produces: `pageItems$<T>(paginator: Paginator<T>): Observable<T>`, `pages$<T>(paginator: Paginator<T>):
  Observable<Page<T>>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/rx/src/pagination.test.ts
// Exercises: pagination as a cold, repeatable Observable (contrast with sse.test.ts's single-subscription case)
import {describe, expect, test} from 'bun:test';
import {firstValueFrom, toArray} from 'rxjs';
import {Paginator} from '@dexpace/core';
import {pageItems$, pages$} from './pagination.js';
import {makeFakeTransport, makeCursorStrategyFixture} from './test-support/pagination-fixture.js';

describe('pageItems$/pages$', () => {
  test('emits every item across all pages, in order', async () => {
    const paginator = new Paginator({
      transport: makeFakeTransport(['page1', 'page2']),
      initialRequest: makeCursorStrategyFixture().initialRequest,
      strategy: makeCursorStrategyFixture().strategy,
    });
    const items = await firstValueFrom(pageItems$(paginator).pipe(toArray()));
    expect(items.length).toBeGreaterThan(0);
  });

  test('is cold and repeatable: two subscriptions each drive a fresh fetch sequence', async () => {
    const transport = makeFakeTransport(['page1', 'page2']);
    const paginator = new Paginator({
      transport,
      initialRequest: makeCursorStrategyFixture().initialRequest,
      strategy: makeCursorStrategyFixture().strategy,
    });
    const observable = pageItems$(paginator);
    await firstValueFrom(observable.pipe(toArray()));
    await firstValueFrom(observable.pipe(toArray())); // second subscribe must not throw (contrast: sse.test.ts)
    expect(transport.sendCallCount).toBeGreaterThan(2); // both walks actually re-fetched
  });
});
```

`makeFakeTransport`/`makeCursorStrategyFixture` are small local test-support helpers built over 5a's
`FakeTransport` (reused per its own "not built speculatively" precedent) and 6c's cursor strategy shape; if 6c
exports test-only fixtures already, import those instead of duplicating.

- [ ] **Step 2: Run and confirm it fails; Step 3: implement**

```typescript
// packages/rx/src/pagination.ts
// SPDX-License-Identifier: MIT
import {from, type Observable} from 'rxjs';
import type {Page, Paginator} from '@dexpace/core';

/** Cold, repeatable: Paginator.items() constructs a fresh generator (hence a fresh fetch sequence) per call. */
export function pageItems$<T>(paginator: Paginator<T>): Observable<T> {
  return from({[Symbol.asyncIterator]: () => paginator.items()[Symbol.asyncIterator]()});
}

/** As `pageItems$`, yielding whole pages instead of individual items. */
export function pages$<T>(paginator: Paginator<T>): Observable<Page<T>> {
  return from({[Symbol.asyncIterator]: () => paginator.pages()[Symbol.asyncIterator]()});
}
```

The wrapper object literal (rather than passing `paginator.items()` directly to `from()`) is deliberate: it
defers calling `.items()`/`.pages()` until each `subscribe()` actually requests an iterator, which is what makes
the Observable re-invoke `Paginator`'s fresh-generator-per-call behavior on a second subscription rather than
reusing the first call's already-exhausted generator. Confirm this against Task 3's own "cold and repeatable"
test — if `from()`'s async-iterable overload turns out to eagerly call `[Symbol.asyncIterator]()` once at
`from()`-construction time rather than per-subscribe, this wrapper needs to become a small factory-based
`Observable` constructed with the RxJS `new Observable<T>(subscriber => { ... })` low-level constructor instead,
calling `paginator.items()` freshly inside that callback. Verify, don't assume — this is exactly the kind of
subtlety Task 1's conformance suite exists to catch, and this test is effectively a second, `Paginator`-specific
instance of the same question.

- [ ] **Step 4: Run and confirm it passes; Step 5: commit**

```bash
git add packages/rx/src/pagination.ts packages/rx/src/pagination.test.ts
git commit -m "feat(rx): add pageItems\$/pages\$, cold and repeatable per Paginator's fresh-generator-per-call design"
```

---

### Task 4: Public barrel, gates, and the checklist

**Files:**
- Create: `packages/rx/src/index.ts`

- [ ] **Step 1: Barrel**

```typescript
// packages/rx/src/index.ts
export {sseEvents$, typedSse$} from './sse.js';
export {pageItems$, pages$} from './pagination.js';
```

- [ ] **Step 2: Run full gates**

```bash
bun run typecheck && bun run lint && bun run build && bun test --coverage && bun run api && \
  bun run lint:publish && bun run verify:dual-consumption && bun run verify:seam-1 && \
  bun run verify:node-floor && bun run test:node && bun run audit
```

Expected: all green for `packages/rx`.

- [ ] **Step 3: Commit**

```bash
git add packages/rx/src/index.ts
git commit -m "feat(rx): promote public barrel for @dexpace/rx"
```

---

## Self-Review

- [ ] Task 1's conformance suite passed against the installed RxJS version with no fallback needed — or, if a
  fallback was needed, it is scoped to exactly the failing clause and recorded in this section as a Deviation
  Ledger addition to the design doc.
- [ ] `sseEvents$`/`typedSse$`'s single-subscription behavior and `pageItems$`/`pages$`'s cold/repeatable
  behavior are both documented in their own TSDoc, not only in this plan.
- [ ] No RxJS scheduler operator appears anywhere in `packages/rx/src/*.ts` (excluding tests).
- [ ] `packages/rx/package.json` lists `rxjs` as a `peerDependency`, never a regular `dependency`.
- [ ] Neither `sse.ts` nor `pagination.ts` imports anything from `@dexpace/transport-fetch`, `@dexpace/transport-undici`,
  or `@dexpace/body-file` — confirming the segmentation design's zero-cross-dependency finding held in the actual
  implementation, not only in the design.
