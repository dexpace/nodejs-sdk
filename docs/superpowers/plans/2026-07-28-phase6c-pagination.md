# Phase 6c — Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the pagination engine in `@dexpace/core` — `Page`/`PageInfo`, the strategy contract, the item- and
page-level views, the page cap, the verbatim query splice, the three built-in strategies, and the fetcher-based
front-end — satisfying `product-spec/12-pagination.md` (`PAGE-1`–`PAGE-36`) per
`docs/superpowers/specs/2026-07-28-phase6c-pagination-design.md`.

**Architecture:** A new `packages/core/src/pagination/` folder of eight independent files with no folder-level
barrel. Both consumption views are `async function*` generators over one drive routine, which is why `PAGE-6`'s
laziness and most of §12.9's async-engine requirements need no machinery at all — **the async generator is the
engine**. The engine takes a `Transport`, so a bare transport, a `FakeTransport`, or 4c's `Runtime` all work
unchanged.

**Tech Stack:** TypeScript 5.8+, `bun test`, `fast-check` for the two query-splice invariants, native
`SuppressedError`, platform `URL`. No new runtime dependencies. No `node:` imports.

**Prerequisite:** Phases 0 through **5c** implemented as their plans specify. **6a and 6b are deliberately *not*
prerequisites** — `§12`'s preamble declares the engine serde-agnostic and nothing in `§12` touches SSE, so this
phase imports nothing either of them produces. 6c is listed last in the segmentation design because it is the
segment most coupled to *earlier* phases (4c's `Runtime`, 5a's `FakeTransport`, 3b's `Response` body), not
because it depends on its siblings; it can execute alone. One consequence for Task 11's closing gate: drop
`verify:sse-37` from the command if 6b has not run, since the script will not exist. This phase consumes:

- `packages/core/src/http/request.js` — `Request` (`method`, `url: URL`, `headers`, `body`, `newBuilder()`),
  `RequestBuilder` (`url(u)`, `build()`)
- `packages/core/src/http/response.js` — `Response` (`request`, `status: Status`, `headers: Headers`,
  `body: ReadableStream<Uint8Array> | null`, `close(): Promise<void>` idempotent, `text()`)
- `packages/core/src/http/headers.js` — `Headers.get(name): string | undefined`,
  `Headers.getAll(name): readonly string[]` (case-insensitive)
- `packages/core/src/http/status.js` — `Status`
- `packages/core/src/http/query-params.js` — the RFC 3986 component encoder behind `QueryParams`
  (Task 1 exports it `@internal` if Phase 1 kept it module-private)
- `packages/core/src/http/request-options.js` — `RequestOptions`, `RequestOptions.EMPTY`
- `packages/core/src/http/errors.js` — `DexpaceError`
- `packages/core/src/io/errors.js` — `IoError` (tests only: Tasks 6 and 7 use it as the stand-in transport and
  close failure, because `PAGE-28` requires the *original* cause to surface and a bare `Error` would not prove
  that no pagination-flavoured wrapper was introduced)
- `packages/core/src/seams/transport.js` — `Transport` (`send(request, options?, signal?): Promise<Response>`)
- `packages/core/src/testing/fake-transport.js` — `FakeTransport`, `countingResponse()` (`@internal`, from 5a)
- `packages/core/src/invariant.js` — `invariant()`

The full gate sequence is green on `main`.

## Global Constraints

- **SPDX header, line 1 of every new file:** `// SPDX-License-Identifier: MIT`.
- **No `node:` imports in `packages/core`.** `URL` is a platform global.
- **No folder-level barrel in `src/pagination/`** (`docs/knowledge/module-organization.md:18`).
- **No serde import anywhere under `src/pagination/`.** `§12`'s preamble declares the engine serde-agnostic; the
  cursor strategy takes a caller-supplied extractor instead. There is no `Serde`, `Schema`, or
  `@dexpace/codec-json` reference in this phase.
- **Exactly one RFC 3986 component encoder in this codebase.** `PAGE-22` restates `HTTP-29`; reuse Phase 1's
  function, never restate the rule. Two encoders that drift is worse than one shared one.
- **`URLSearchParams` is forbidden in `src/pagination/`.** It re-serializes the whole query on every mutation,
  reordering and re-encoding untouched parameters (`PAGE-21`) and encoding space as `+` rather than `%20`
  (`HTTP-29`). Task 2's tests exist to catch a re-introduction.
- **Error hierarchy stays two levels.** `PaginationError` sits directly under `DexpaceError`.
- **`undefined`, never `null`, for absence** (styleguide 3.5). `PAGE-4`'s "null/absent next-request" is
  `undefined` here.

---

### Task 1: `PaginationError` and the shared component encoder

**Files:**
- Create: `packages/core/src/pagination/errors.ts`
- Create: `packages/core/src/pagination/errors.test.ts`
- Modify: `packages/core/src/http/query-params.ts` (export the component encoder/decoder `@internal`)
- Modify: `packages/core/src/http/query-params.test.ts` (append the direct-export tests)

**Interfaces:**
- Consumes: `DexpaceError`.
- Produces: `class PaginationError extends DexpaceError`;
  `function encodeQueryComponent(value: string): string` and `function decodeQueryComponent(value: string):
  string`, both `@internal`, from `../http/query-params.js`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/errors.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-9 (cap validated at construction), PAGE-14 (re-iteration fails loudly).
import {expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {PaginationError} from './errors.js';

test('sits directly under DexpaceError (two-level tree)', () => {
  expect(new PaginationError('x')).toBeInstanceOf(DexpaceError);
});

test('name identifies the leaf in a stack trace', () => {
  expect(new PaginationError('x').name).toBe('PaginationError');
});

test('chains a cause when given one', () => {
  const backing = new Error('root');
  expect(new PaginationError('x', {cause: backing}).cause).toBe(backing);
});
```

Append to `packages/core/src/http/query-params.test.ts`:

```typescript
import {decodeQueryComponent, encodeQueryComponent} from './query-params.js';

// PAGE-22 restates HTTP-29's rule. These assertions pin the shared function so the pagination splice can rely
// on it instead of restating the rule and drifting.
test('the component encoder is directly reachable and follows RFC 3986 (HTTP-29, reused by PAGE-22)', () => {
  expect(encodeQueryComponent('a b')).toBe('a%20b');
  expect(encodeQueryComponent('a+b')).toBe('a%2Bb');
  expect(encodeQueryComponent('a/b')).toBe('a%2Fb');
  expect(encodeQueryComponent('a=b')).toBe('a%3Db');
  expect(encodeQueryComponent('a*b')).toBe('a%2Ab');
  expect(encodeQueryComponent('AZaz09-._~')).toBe('AZaz09-._~');
});

test('the component decoder treats a literal + as data, not a space (HTTP-29, PAGE-22)', () => {
  expect(decodeQueryComponent('a+b')).toBe('a+b');
  expect(decodeQueryComponent('a%20b')).toBe('a b');
  expect(decodeQueryComponent('a%2Bb')).toBe('a+b');
});

test('the decoder falls back to raw text on malformed percent-encoding (HTTP-31)', () => {
  expect(decodeQueryComponent('a%zzb')).toBe('a%zzb');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun test src/pagination/errors.test.ts src/http/query-params.test.ts`
Expected: FAIL — `Cannot find module './errors.js'`, and `encodeQueryComponent is not exported`.

- [ ] **Step 3: Write the error leaf**

```typescript
// packages/core/src/pagination/errors.ts
// SPDX-License-Identifier: MIT
import {DexpaceError} from '../http/errors.js';

/**
 * A misuse or precondition failure of the pagination engine: a non-positive page cap at construction
 * (PAGE-9), or a second iterator on the single-use page-level view (PAGE-14).
 *
 * Not used for transport, parse, or close failures — those propagate as whatever the underlying layer raised,
 * because PAGE-28 requires the *original* cause to surface rather than a pagination-flavored wrapper.
 */
export class PaginationError extends DexpaceError {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'PaginationError';
  }
}
```

- [ ] **Step 4: Export the component encoder**

In `packages/core/src/http/query-params.ts`, promote the module-private percent-encode/decode helpers to named
exports. Do **not** change their behavior — this is an export-visibility change only, and the tests in Step 1 pin
the existing semantics. Add the marking:

```typescript
/**
 * @internal
 * RFC 3986 component encoding (HTTP-29): space → `%20` (never `+`), literal `+` → `%2B`, everything outside
 * the unreserved set `A–Z a–z 0–9 - . _ ~` percent-encoded.
 *
 * Exported so `src/pagination/query-splice.ts` can reuse it. `PAGE-22` restates this exact rule, and two
 * encoders in one codebase is a drift bug waiting to happen — there is exactly one.
 */
export function encodeQueryComponent(value: string): string { /* existing body */ }

/**
 * @internal
 * RFC 3986 component decoding (HTTP-29/HTTP-31): a literal `+` reads back as `+`, `%20` as a space, and
 * malformed percent-encoding falls back to raw text rather than throwing.
 */
export function decodeQueryComponent(value: string): string { /* existing body */ }
```

If Phase 1 implemented the rule inline inside `QueryParams.encode()` rather than as a helper, extract it into
these two functions first and have `encode()`/`parse()` call them, so there is still exactly one implementation.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun test src/pagination/errors.test.ts src/http/query-params.test.ts`
Expected: all pass. The pre-existing `QueryParams` tests must still pass unchanged — if any fail, the extraction
in Step 4 changed behavior and must be reverted and redone.

- [ ] **Step 6: Verify the api report is unchanged**

Run: `cd packages/core && bun run build && bun run api -- --local && git diff --exit-code etc/core.api.md`
Expected: exit 0 — `@internal` exports do not reach the public report. If the report changed, the `@internal`
marking is missing.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pagination/errors.ts packages/core/src/pagination/errors.test.ts packages/core/src/http/query-params.ts packages/core/src/http/query-params.test.ts
git commit -m "feat(core): add PaginationError and expose the shared RFC 3986 component codec (PAGE-22)"
```

---

### Task 2: The verbatim query splice

**Files:**
- Create: `packages/core/src/pagination/query-splice.ts`
- Create: `packages/core/src/pagination/query-splice.test.ts`
- Create: `packages/core/src/pagination/query-splice.property.test.ts`

**Interfaces:**
- Consumes: `encodeQueryComponent`, `decodeQueryComponent` from `../http/query-params.js`.
- Produces: `function spliceQueryParam(url: URL, name: string, value: string | undefined): URL`;
  `function readQueryParam(url: URL, name: string): string | undefined`. Both `@internal`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/query-splice.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-21 (verbatim splice, untargeted params byte-for-byte), PAGE-22 (RFC 3986 component encoding,
// literal + is data), PAGE-23 (replace-first / append / remove, order preserved), PAGE-24 (non-query components
// preserved exactly).
import {expect, test} from 'bun:test';
import {readQueryParam, spliceQueryParam} from './query-splice.js';

const at = (href: string) => new URL(href);
const query = (url: URL) => url.search.replace(/^\?/, '');

test('untargeted parameters survive byte-for-byte, order preserved (PAGE-21)', () => {
  const out = spliceQueryParam(at('https://h/p?flag&filter=a:b&page=1'), 'page', '2');
  expect(query(out)).toBe('flag&filter=a:b&page=2');
});

test('a value-less flag stays value-less', () => {
  const out = spliceQueryParam(at('https://h/p?flag&page=1'), 'page', '2');
  expect(query(out)).toContain('flag&');
  expect(query(out)).not.toContain('flag=');
});

test('reserved characters in untargeted values are not rewritten (PAGE-21)', () => {
  const out = spliceQueryParam(at('https://h/p?a=x:y/z&page=1'), 'page', '2');
  expect(query(out)).toBe('a=x:y/z&page=2');
});

test('a newly-set value uses RFC 3986 component encoding (PAGE-22)', () => {
  expect(query(spliceQueryParam(at('https://h/p'), 'q', 'a b'))).toBe('q=a%20b');
  expect(query(spliceQueryParam(at('https://h/p'), 'token', 'a+b/c='))).toBe('token=a%2Bb%2Fc%3D');
});

test('reading decodes with the same semantics — a literal + reads back as + (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?q=a+b'), 'q')).toBe('a+b');
  expect(readQueryParam(at('https://h/p?q=a%20b'), 'q')).toBe('a b');
});

test('a value-less flag reads as the empty string, an absent name as undefined (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?flag'), 'flag')).toBe('');
  expect(readQueryParam(at('https://h/p?flag'), 'other')).toBeUndefined();
});

test('reading takes the first match when a name repeats (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?page=1&page=9'), 'page')).toBe('1');
});

test('setting replaces the first occurrence in place and drops later duplicates (PAGE-23)', () => {
  expect(query(spliceQueryParam(at('https://h/p?page=1&sort=asc&page=9'), 'page', '2'))).toBe(
    'page=2&sort=asc',
  );
});

test('setting an absent parameter appends it (PAGE-23)', () => {
  expect(query(spliceQueryParam(at('https://h/p?sort=asc'), 'page', '2'))).toBe('sort=asc&page=2');
});

test('setting undefined removes the parameter entirely (PAGE-23)', () => {
  expect(query(spliceQueryParam(at('https://h/p?page=1&sort=asc'), 'page', undefined))).toBe('sort=asc');
});

test('removing the only parameter leaves an empty query', () => {
  expect(query(spliceQueryParam(at('https://h/p?page=1'), 'page', undefined))).toBe('');
});

test('setting on a URL with no query at all creates one', () => {
  expect(query(spliceQueryParam(at('https://h/p'), 'page', '2'))).toBe('page=2');
});

test('every non-query component is preserved exactly (PAGE-24)', () => {
  const source = at('https://user:pw@host.example:8443/deep/path?page=1&keep=yes#frag');
  const out = spliceQueryParam(source, 'page', '2');
  expect(out.protocol).toBe(source.protocol);
  expect(out.username).toBe(source.username);
  expect(out.password).toBe(source.password);
  expect(out.hostname).toBe(source.hostname);
  expect(out.port).toBe(source.port);
  expect(out.pathname).toBe(source.pathname);
  expect(out.hash).toBe(source.hash);
  expect(query(out)).toBe('page=2&keep=yes');
});

test('the input URL is not mutated', () => {
  const source = at('https://h/p?page=1');
  spliceQueryParam(source, 'page', '2');
  expect(query(source)).toBe('page=1');
});

test('URLSearchParams-style canonicalization does NOT happen (PAGE-21)', () => {
  // URLSearchParams would rewrite `a b` to `a+b` and re-encode `:`; the splice leaves both alone.
  const out = spliceQueryParam(at('https://h/p?msg=a%20b&path=x:y&page=1'), 'page', '2');
  expect(query(out)).toBe('msg=a%20b&path=x:y&page=2');
});

test('the WHATWG query encode set is the one boundary of byte-for-byte preservation (PAGE-21)', () => {
  // Assigning to `URL.search` percent-encodes C0 controls, space, " # < > and (on special schemes) ' — so an
  // untargeted segment carrying one of those raw is rewritten. Every such character is one RFC 3986 already
  // requires to be encoded in a query, so the only inputs affected were already non-conformant. Pinned here so
  // the boundary is known rather than discovered, and recorded in the Deviation Ledger.
  const out = spliceQueryParam(at('https://h/p?tag=<raw>&page=1'), 'page', '2');
  expect(query(out)).toBe('tag=%3Craw%3E&page=2');

  // Everything RFC 3986 permits raw in a query survives untouched — which is the case that actually matters.
  const safe = spliceQueryParam(at('https://h/p?f=a:b/c!d$e(f)*g,h;i@j&page=1'), 'page', '2');
  expect(query(safe)).toBe('f=a:b/c!d$e(f)*g,h;i@j&page=2');
});

test('stray empty segments are skipped, matching HTTP-31 query parsing', () => {
  expect(query(spliceQueryParam(at('https://h/p?a=1&&b=2&page=1'), 'page', '2'))).toBe('a=1&b=2&page=2');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/query-splice.test.ts`
Expected: FAIL — `Cannot find module './query-splice.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/query-splice.ts
// SPDX-License-Identifier: MIT
import {decodeQueryComponent, encodeQueryComponent} from '../http/query-params.js';

/**
 * Rewrite one query parameter, splicing the raw query string rather than re-rendering it (PAGE-21–PAGE-24).
 *
 * **Why not `URLSearchParams`.** It re-serializes the *entire* query through its own canonical encoding on
 * every mutation: untouched parameters get reordered and re-encoded (against PAGE-21's byte-for-byte rule), and
 * a space becomes `+` rather than the `%20` this port standardizes on (HTTP-29).
 *
 * **Why not `QueryParams`.** Same problem in a different costume — `encode()` re-renders the whole query from
 * the parsed model. `QueryParams` is the right tool for *building* a query and the wrong one for *splicing* one.
 * Only the component *encoder* is shared, which is the part PAGE-22 and HTTP-29 genuinely agree on.
 *
 * Passing `undefined` removes the parameter. Setting replaces the first occurrence in place and drops later
 * duplicates — the single-value convention paging parameters follow. Everything else is copied byte-for-byte.
 *
 * @internal
 */
export function spliceQueryParam(url: URL, name: string, value: string | undefined): URL {
  const encodedName = encodeQueryComponent(name);
  const segments = splitQuery(url.search);

  const out: string[] = [];
  let replaced = false;

  for (const segment of segments) {
    if (nameOf(segment) !== encodedName) {
      out.push(segment); // byte-for-byte, untouched
      continue;
    }
    if (replaced) continue; // PAGE-23: later duplicates are dropped
    replaced = true;
    if (value !== undefined) out.push(`${encodedName}=${encodeQueryComponent(value)}`);
  }

  if (!replaced && value !== undefined) {
    out.push(`${encodedName}=${encodeQueryComponent(value)}`);
  }

  // Rebuilding through `URL` preserves scheme, userinfo, host, port, path, and fragment exactly (PAGE-24);
  // only `search` is assigned.
  const next = new URL(url.href);
  next.search = out.length === 0 ? '' : `?${out.join('&')}`;
  return next;
}

/**
 * Read one query parameter with the same RFC 3986 semantics the splice writes (PAGE-22).
 *
 * A literal `+` reads back as `+`, `%20` as a space, a value-less flag as the empty string, and an absent name
 * as `undefined`. First match wins.
 *
 * @internal
 */
export function readQueryParam(url: URL, name: string): string | undefined {
  const encodedName = encodeQueryComponent(name);
  for (const segment of splitQuery(url.search)) {
    if (nameOf(segment) !== encodedName) continue;
    const eq = segment.indexOf('=');
    return eq === -1 ? '' : decodeQueryComponent(segment.slice(eq + 1));
  }
  return undefined;
}

/**
 * Split a raw query into `&`-separated segments, dropping the leading `?` and any stray empty segments.
 *
 * Dropping empty segments (`?a=1&&b=2` → two segments) is not a byte-for-byte violation to apologize for — it
 * is the same leniency `HTTP-31` already mandates for query *parsing*, "stray `&` is skipped." Doing something
 * different here would put two disagreeing readings of the same query string in one codebase.
 */
function splitQuery(search: string): string[] {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  return raw.length === 0 ? [] : raw.split('&').filter((segment) => segment.length > 0);
}

/** The raw (still-encoded) name of a segment. A value-less flag is all name. */
function nameOf(segment: string): string {
  const eq = segment.indexOf('=');
  return eq === -1 ? segment : segment.slice(0, eq);
}
```

**One caveat on `next.search = ...`, and it is a real one.** This is the single place a platform API touches the
query, and it is *not* inert: the WHATWG URL query setter runs the query percent-encode set over whatever it is
given — C0 controls, space, `"`, `#`, `<`, `>`, and (on special schemes, which includes `https:`) `'`. The
targeted parameter is unaffected, because `encodeQueryComponent` has already encoded every one of those. But an
**untargeted** segment carrying a raw `<` comes back as `%3C`, which is a byte-for-byte change `PAGE-21` did not
ask for.

This is bounded and deliberate rather than an oversight, for two reasons: every character in that set is one
RFC 3986 already requires to be percent-encoded inside a query, so the only inputs affected are queries that
were already non-conformant, and the setter's rewrite moves them toward conformance rather than away; and the
only way to avoid it entirely is to stop returning a `URL` and hand back a string, which would push the same
problem onto every caller instead of solving it. Step 4's test pins the exact behavior so it stays a known
boundary rather than a surprise, and the Deviation Ledger records it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/query-splice.test.ts`
Expected: 17 pass, 0 fail.

- [ ] **Step 5: Write the property tests**

```typescript
// packages/core/src/pagination/query-splice.property.test.ts
// SPDX-License-Identifier: MIT
import {test} from 'bun:test';
import fc from 'fast-check';
import {readQueryParam, spliceQueryParam} from './query-splice.js';

/**
 * Segment names and values drawn from characters a real server actually sends, including hostile ones.
 *
 * The alphabet deliberately excludes `"`, `#`, `<`, `>`, and `'`: those sit in the WHATWG query percent-encode
 * set, so assigning to `URL.search` rewrites them and byte-for-byte preservation genuinely does not hold. That
 * boundary is pinned by its own named test above rather than being smuggled into a property that would then
 * fail for a reason unrelated to the splice logic this property exists to check.
 */
const rawSegment = fc
  .tuple(fc.stringMatching(/^[a-z]{1,6}$/), fc.stringMatching(/^[a-zA-Z0-9:%._~-]{0,10}$/))
  .map(([name, value]) => `${name}=${value}`);

test('every untargeted segment survives the splice byte-for-byte (PAGE-21)', () => {
  fc.assert(
    fc.property(fc.array(rawSegment, {maxLength: 6}), fc.string({minLength: 1}), (segments, newValue) => {
      const untargeted = segments.filter((s) => !s.startsWith('page='));
      const url = new URL(`https://h/p?${[...untargeted, 'page=1'].join('&')}`);
      const out = spliceQueryParam(url, 'page', newValue);
      const outSegments = out.search.replace(/^\?/, '').split('&');
      return untargeted.every((segment, index) => outSegments[index] === segment);
    }),
  );
});

test('write-then-read is the identity for any value (PAGE-22)', () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      const url = spliceQueryParam(new URL('https://h/p?a=1&b=2'), 'cursor', value);
      return readQueryParam(url, 'cursor') === value;
    }),
  );
});
```

Run: `cd packages/core && bun test src/pagination/query-splice.property.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pagination/query-splice.ts packages/core/src/pagination/query-splice.test.ts packages/core/src/pagination/query-splice.property.test.ts
git commit -m "feat(core): add the verbatim query splice, rejecting URLSearchParams (PAGE-21-24)"
```

---

### Task 3: `Page` and `PageInfo`

**Files:**
- Create: `packages/core/src/pagination/page.ts`
- Create: `packages/core/src/pagination/page.test.ts`

**Interfaces:**
- Consumes: `Response`, `Request`, `Status`, `Headers` from `../http/`.
- Produces: `interface PageInfo<T> {readonly items: readonly T[]; readonly nextRequest: Request | undefined}`;
  `function pageInfo<T>(items: readonly T[], nextRequest?: Request): PageInfo<T>`;
  `class Page<T> {constructor(response: Response, items: readonly T[]); readonly items: readonly T[];
  readonly status: Status; readonly headers: Headers; readonly request: Request; close(): Promise<void>}`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/page.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-2 (items and metadata survive close; items never null), PAGE-3 (one owned response, closed
// exactly once), PAGE-4 (PageInfo shape, undefined next-request is the end signal).
import {expect, test} from 'bun:test';
import {Page, pageInfo} from './page.js';

function fakeResponse(): {response: Parameters<typeof makePage>[0]; closes: () => number} {
  let closeCount = 0;
  const response = {
    status: {code: 200},
    headers: {get: (n: string) => (n.toLowerCase() === 'x-total' ? '42' : undefined)},
    request: {method: 'GET'},
    async close(): Promise<void> {
      closeCount += 1;
    },
  } as unknown as Parameters<typeof makePage>[0];
  return {response, closes: () => closeCount};
}

const makePage = <T,>(response: ConstructorParameters<typeof Page<T>>[0], items: readonly T[]) =>
  new Page(response, items);

test('items and derived metadata remain readable after close (PAGE-2)', async () => {
  const {response} = fakeResponse();
  const page = makePage(response, [1, 2, 3]);
  await page.close();
  expect(page.items).toEqual([1, 2, 3]);
  expect(page.status.code).toBe(200);
  expect(page.headers.get('X-Total')).toBe('42');
  expect(page.request).toBeDefined();
});

test('items are never null and are frozen (PAGE-2)', () => {
  const {response} = fakeResponse();
  const page = makePage(response, []);
  expect(page.items).toEqual([]);
  expect(Object.isFrozen(page.items)).toBe(true);
});

test('the items list is defensively copied from the caller (PAGE-2)', () => {
  const {response} = fakeResponse();
  const supplied = [1, 2];
  const page = makePage(response, supplied);
  supplied.push(3);
  expect(page.items).toEqual([1, 2]);
});

test('close releases the owned response exactly once, and is idempotent (PAGE-3)', async () => {
  const {response, closes} = fakeResponse();
  const page = makePage(response, [1]);
  await page.close();
  await page.close();
  await page.close();
  expect(closes()).toBe(1);
});

test('pageInfo with no next request signals end of stream (PAGE-4)', () => {
  expect(pageInfo([1, 2]).nextRequest).toBeUndefined();
});

test('pageInfo carries items plus a next request, both frozen (PAGE-4)', () => {
  const next = {method: 'GET'} as never;
  const info = pageInfo([1], next);
  expect(info.items).toEqual([1]);
  expect(info.nextRequest).toBe(next);
  expect(Object.isFrozen(info)).toBe(true);
});

test('an empty items list with a next request is a valid non-terminal page (PAGE-4)', () => {
  const next = {method: 'GET'} as never;
  const info = pageInfo([], next);
  expect(info.items).toEqual([]);
  expect(info.nextRequest).toBe(next);
});

test('await using releases the page, where the runtime supports it (PAGE-3, PAGE-12)', async () => {
  const {response, closes} = fakeResponse();
  const page = makePage(response, [1]);

  if (typeof Symbol.asyncDispose !== 'symbol') {
    // The declared floor (Node 18.17) predates the symbol; close() is the supported path there. Asserted rather
    // than skipped so this still means something on the verify:node-floor runner.
    expect(page[Symbol.asyncDispose as unknown as symbol]).toBeUndefined();
    await page.close();
    expect(closes()).toBe(1);
    return;
  }

  {
    await using scoped = page;
    expect(scoped.items).toEqual([1]);
  }
  expect(closes()).toBe(1);

  // Dispose delegates to close, so it inherits Response.close()'s idempotence rather than adding a second guard.
  await page.close();
  expect(closes()).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/page.test.ts`
Expected: FAIL — `Cannot find module './page.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/page.ts
// SPDX-License-Identifier: MIT
import type {Headers} from '../http/headers.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {Status} from '../http/status.js';
import {invariant} from '../invariant.js';

/**
 * A pagination strategy's parse output: the items on this page plus the request that fetches the next one
 * (PAGE-4).
 *
 * `nextRequest === undefined` is the **single, exclusive** end-of-stream signal the engine recognizes. A
 * strategy must never signal termination by throwing or through a side channel, and an empty `items` list
 * paired with a defined `nextRequest` is a perfectly valid non-terminal page.
 */
export interface PageInfo<T> {
  readonly items: readonly T[];
  readonly nextRequest: Request | undefined;
}

/** Construct a frozen {@link PageInfo}. Omit `nextRequest` to signal end of stream. */
export function pageInfo<T>(items: readonly T[], nextRequest?: Request): PageInfo<T> {
  return Object.freeze({items: Object.freeze([...items]), nextRequest});
}

/**
 * One page of results, owning exactly one underlying response (PAGE-2, PAGE-3).
 *
 * State is split by lifetime, which is the whole point of the type: the materialized item list and the derived
 * status, headers, and originating request are captured at construction and **remain readable after close** —
 * only the raw body and its connection become invalid. Reading `page.status` after `await page.close()` is
 * supported, not a bug.
 *
 * Whoever pulls a page owns closing it. A component that hands a caller a live page — a first-page fetcher, for
 * instance — must **not** close the response itself; ownership transfers to the page.
 *
 * A class rather than a frozen object because it owns a resource with a lifecycle and an idempotent close,
 * which is `styleguide/typescript/06` §6.3's test for a class.
 */
export class Page<T> {
  readonly items: readonly T[];
  readonly status: Status;
  readonly headers: Headers;
  readonly request: Request;
  // `#private` rather than the styleguide's default `private` (styleguide 6.6): `Page` is a *published* type
  // holding a live connection, and `private` is compile-time-only — a consumer could reach the response through
  // bracket access and close or re-read it behind the engine's back, breaking PAGE-3's single-owner rule and
  // PAGE-27's close-exactly-once. Runtime unreachability is the requirement here, not just encapsulation.
  readonly #response: Response;

  constructor(response: Response, items: readonly T[]) {
    invariant(response !== undefined, 'a Page must own a response (PAGE-3)');
    invariant(items !== undefined, 'a Page’s items must never be null (PAGE-2)');

    this.#response = response;
    // Captured now, so they outlive the response (PAGE-2). Copied so a caller's later mutation cannot reach in.
    this.items = Object.freeze([...items]);
    this.status = response.status;
    this.headers = response.headers;
    this.request = response.request;
  }

  /**
   * Release the underlying response's body and connection (PAGE-3).
   *
   * Idempotent, by delegation: Phase 3b's `Response.close()` is already close-once, so this adds no second
   * guard that could disagree with it.
   */
  async close(): Promise<void> {
    await this.#response.close();
  }
}

export interface Page<T> {
  /**
   * Scoped teardown for `await using`, delegating to {@link Page.close}.
   *
   * `PAGE-12` requires consumers of the page-level view to be *told* to wrap it in a scoped/auto-close
   * construct, and this is that construct. `styleguide/typescript/13` §13.1–13.2 wants it independently: a
   * resource-owning class should offer disposal rather than a bare `close()`, and where a `close()` remains,
   * dispose delegates to it.
   *
   * **Optional, and deliberately so.** `Symbol.asyncDispose` landed in Node 18.18, one patch past this
   * package's declared `>=18.17` floor — the version `verify:node-floor` pins — and TypeScript does not
   * polyfill the well-known symbol for a library that *declares* the method, so the computed key silently
   * becomes the string `"undefined"` at run time. Typing it non-optional would promise support the floor cannot
   * honor. `close()` therefore remains the supported teardown on every runtime. Same treatment as 6b's
   * `SseStream`; both become unconditional when `engines.node` moves past 18.18.
   */
  [Symbol.asyncDispose]?: () => Promise<void>;
}

// Guarded install — see the note above. A no-op on a runtime without the symbol, rather than a property whose
// key is the literal string "undefined".
if (typeof Symbol.asyncDispose === 'symbol') {
  Object.defineProperty(Page.prototype, Symbol.asyncDispose, {
    value: function asyncDispose(this: Page<unknown>): Promise<void> {
      return this.close();
    },
    writable: true,
    configurable: true,
  });
}
```

**`lib` check, once for the phase.** Naming `Symbol.asyncDispose` in a type position needs `esnext.disposable`
on the TypeScript `lib` list (`styleguide/typescript/13` §13.1). If 6b already added it to `tsconfig.base.json`,
nothing to do; if 6b has not run, add `"lib": ["es2023", "esnext.disposable"]` to `compilerOptions` and re-run
`bun run typecheck`. This changes only which types are visible — it emits nothing and does not move
`engines.node`, which stays `>=18.17`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/page.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/page.ts packages/core/src/pagination/page.test.ts
git commit -m "feat(core): add Page and PageInfo with lifetime-split state (PAGE-2/3/4)"
```

---

### Task 4: The strategy contract

**Files:**
- Create: `packages/core/src/pagination/strategy.ts`
- Create: `packages/core/src/pagination/strategy.test.ts`

**Interfaces:**
- Consumes: `PageInfo` from `./page.js`; `Request`, `Response` from `../http/`.
- Produces: `interface PaginationStrategy<T> {parse(response: Response, template: Request): Promise<PageInfo<T>>}`.

- [ ] **Step 1: Write the failing type-level test**

```typescript
// packages/core/src/pagination/strategy.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-5 (strategy contract). Pure type declarations, so the assertions are expect-type only
// (styleguide 11.6) and fire under `bun run typecheck`, not under `bun test`.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {PageInfo} from './page.js';
import type {PaginationStrategy} from './strategy.js';

test('parse returns a promise — a synchronous body read does not exist in this runtime (PAGE-5)', () => {
  expectTypeOf<PaginationStrategy<number>['parse']>().returns.toEqualTypeOf<Promise<PageInfo<number>>>();
});

test('parse receives the response and the original request template (PAGE-5)', () => {
  expectTypeOf<PaginationStrategy<number>['parse']>().parameters.toBeArray();
});

test('a strategy is generic in its item type, not in a codec (PAGE-5, §12 serde-agnostic)', () => {
  expectTypeOf<PaginationStrategy<{id: string}>>().not.toBeAny();
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd packages/core && bun test src/pagination/strategy.test.ts && cd ../.. && bun run typecheck`
Expected: `bun run typecheck` FAILS — the module does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/strategy.ts
// SPDX-License-Identifier: MIT
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {PageInfo} from './page.js';

/**
 * A stateless parser turning one response into that page's items plus the next page's request (PAGE-5).
 *
 * **On `template`.** The glossary calls this "the original request template," but the engine passes the request
 * that produced *this* response — i.e. it advances with the walk. That is deliberate and is what the built-in
 * strategies need: `cursorStrategy` splices the new cursor onto the request actually just executed, so a walk
 * accumulates one cursor parameter rather than re-deriving page N's URL from page 1's every time. Read the
 * parameter as "the request to derive the next one from," and use `response.request` when you specifically want
 * the executed request's own URL (`pageNumberStrategy` does).
 *
 * **Contract obligations on implementors** — none of these can be enforced by the type system, so they are
 * stated here and covered by the engine's own tests:
 *
 * - **Read the body at most once.** The body is single-use. The engine hands you the response exactly once and
 *   never reads the body itself, so it is entirely yours — but only once.
 * - **Do not retain the response or its body past the call.** The engine closes the response as soon as `parse`
 *   resolves, so a retained body is already dead; holding one produces an intermittent failure rather than a
 *   clean one.
 * - **Do not close or mutate the response.** Lifecycle ownership belongs to the engine.
 * - **Be immutable and safe to share.** One strategy instance may drive several concurrent walks. Keep no
 *   per-call state on `this`.
 * - **Never signal termination by throwing.** Return `pageInfo(items)` with no next request. A throw means a
 *   genuine parse failure, and the engine treats it as one (PAGE-13).
 *
 * **Why `parse` is asynchronous.** `PAGE-5` says a strategy must read what it needs "synchronously inside
 * parse." This runtime has no synchronous body read — the bytes may not have arrived — so the literal reading
 * is unimplementable. Every enforceable part of the requirement's intent survives the promise, as listed above.
 * Do not "fix" this back to a synchronous signature; it cannot work.
 */
export interface PaginationStrategy<T> {
  parse(response: Response, template: Request): Promise<PageInfo<T>>;
}
```

- [ ] **Step 4: Run typecheck to verify it passes**

Run: `cd packages/core && bun test src/pagination/strategy.test.ts && cd ../.. && bun run typecheck`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/strategy.ts packages/core/src/pagination/strategy.test.ts
git commit -m "feat(core): add the PaginationStrategy contract with async parse (PAGE-5)"
```

---

### Task 5: `Paginator` — the drive routine and the two views

**Files:**
- Create: `packages/core/src/pagination/paginator.ts`
- Create: `packages/core/src/pagination/paginator.test.ts`

**Interfaces:**
- Consumes: `Page`, `PageInfo` from `./page.js`; `PaginationStrategy` from `./strategy.js`; `PaginationError`
  from `./errors.js`; `Transport` from `../seams/transport.js`; `Request`, `RequestOptions` from `../http/`;
  `FakeTransport` from `../testing/fake-transport.js` (tests only).
- Produces: `interface PaginatorInit<T>`; `class Paginator<T> {constructor(init: PaginatorInit<T>);
  items(): AsyncIterable<T>; pages(): AsyncIterable<Page<T>>}`.

- [ ] **Step 1: Write the failing test — laziness, ordering, and the cap**

```typescript
// packages/core/src/pagination/paginator.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-1 (both views over one walk, server order across boundaries), PAGE-6 (page-lazy, zero
// exchanges before the first probe), PAGE-7 (forward-only, idempotent end probes), PAGE-8 (independent
// iterations), PAGE-9/PAGE-10 (cap), PAGE-36 (options on every page).
import {expect, test} from 'bun:test';
import {RequestOptions} from '../http/request-options.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {pageInfo} from './page.js';
import {Paginator} from './paginator.js';
import {PaginationError} from './errors.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';

/** Three pages of two items each, then end. Reads a page number off a header the FakeTransport stamps. */
function threePageStrategy(): PaginationStrategy<string> {
  return {
    async parse(response: Response, template: Request) {
      const page = Number(response.headers.get('X-Page') ?? '1');
      const items = [`p${String(page)}i1`, `p${String(page)}i2`];
      if (page >= 3) return pageInfo(items);
      const next = template.newBuilder().url(new URL(`https://api.test/items?page=${String(page + 1)}`)).build();
      return pageInfo(items, next);
    },
  };
}

/** A server that never advances: every page reports another page after it. */
function neverEndingStrategy(): PaginationStrategy<string> {
  return {
    async parse(_response: Response, template: Request) {
      return pageInfo(['x'], template);
    },
  };
}

function transportOf(pages: number): FakeTransport {
  return new FakeTransport(
    Array.from({length: pages}, (_unused, index) =>
      countingResponse({status: 200, headers: {'X-Page': String(index + 1)}, body: '{}'}),
    ),
  );
}

/**
 * A `Request` stand-in carrying the two members the engine and the strategies actually touch: `url`, and a
 * `newBuilder()` chain for `PAGE-23`'s swap-only-the-URL rewrite.
 *
 * `newBuilder()` is not optional here — `threePageStrategy` below calls it on every non-terminal page, so a bare
 * `{url}` cast would fail on the first parse with `template.newBuilder is not a function`, in every test in this
 * file that walks more than one page.
 */
const requestAt = (href: string): Request =>
  ({
    url: new URL(href),
    newBuilder() {
      let target = new URL(href);
      return {
        url(next: URL) {
          target = next;
          return this;
        },
        build: () => requestAt(target.href),
      };
    },
  }) as unknown as Request;

const initialRequest = (): Request => requestAt('https://api.test/items?page=1');

test('the item view flattens all pages in server order (PAGE-1)', async () => {
  const paginator = new Paginator({
    transport: transportOf(3),
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const seen: string[] = [];
  for await (const item of paginator.items()) seen.push(item);
  expect(seen).toEqual(['p1i1', 'p1i2', 'p2i1', 'p2i2', 'p3i1', 'p3i2']);
});

test('the page view yields exactly three pages with their own status and headers (PAGE-1)', async () => {
  const paginator = new Paginator({
    transport: transportOf(3),
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const pages = [];
  for await (const page of paginator.pages()) pages.push(page);
  expect(pages).toHaveLength(3);
  expect(pages.map((p) => p.headers.get('X-Page'))).toEqual(['1', '2', '3']);
  expect(pages[0]?.status.code).toBe(200);
});

test('constructing the paginator and obtaining the iterator trigger zero exchanges (PAGE-6)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const iterable = paginator.items();
  const iterator = iterable[Symbol.asyncIterator]();
  expect(transport.sendCount).toBe(0);

  await iterator.next();
  expect(transport.sendCount).toBe(1);
});

test('exactly one exchange occurs per page consumed (PAGE-6)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  for await (const _page of paginator.pages()) {
    /* drain */
  }
  expect(transport.sendCount).toBe(3);
});

test('no exchange happens past the terminal page, and end probes are idempotent (PAGE-7)', async () => {
  const transport = transportOf(3);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const iterator = paginator.items()[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) {
    /* drain */
  }
  expect((await iterator.next()).done).toBe(true);
  expect((await iterator.next()).done).toBe(true);
  expect(transport.sendCount).toBe(3);
});

test('two independent iterations each drive a full fetch sequence with equal results (PAGE-8)', async () => {
  const transport = transportOf(6);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
  });
  const first: string[] = [];
  for await (const item of paginator.items()) first.push(item);
  const second: string[] = [];
  for await (const item of paginator.items()) second.push(item);
  expect(second).toEqual(first);
  expect(transport.sendCount).toBe(6);
});

test('the cap stops a non-advancing server at exactly N exchanges (PAGE-9)', async () => {
  const transport = transportOf(10);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: neverEndingStrategy(),
    maxPages: 4,
  });
  for await (const _page of paginator.pages()) {
    /* drain */
  }
  expect(transport.sendCount).toBe(4);
});

test.each([0, -1, 1.5, Number.NaN])(
  'a cap of %p is rejected at construction, not lazily (PAGE-9)',
  (maxPages) => {
    expect(
      () =>
        new Paginator({
          transport: transportOf(1),
          initialRequest: initialRequest(),
          strategy: threePageStrategy(),
          maxPages: maxPages as number,
        }),
    ).toThrow(PaginationError);
  },
);

test('the default cap is effectively unbounded (PAGE-10)', async () => {
  const transport = transportOf(500);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: neverEndingStrategy(),
  });
  let count = 0;
  for await (const _page of paginator.pages()) {
    count += 1;
    if (count === 400) break;
  }
  expect(count).toBe(400);
});

test('per-call options reach every page exchange, not just the first (PAGE-36)', async () => {
  const transport = transportOf(3);
  // Deliberately NOT `RequestOptions.EMPTY`. The failure PAGE-36 guards is an engine that honours the caller's
  // options on page 1 and falls back to the default on pages 2..N — and against `EMPTY` that bug is invisible,
  // because the substituted default IS `EMPTY`. A distinctive instance makes the identity assertion bite.
  // (Use whichever HTTP-3 `newBuilder()` setter Phase 1 actually shipped; the only thing that matters here is
  // that `options !== RequestOptions.EMPTY`.)
  const options = RequestOptions.EMPTY.newBuilder().timeout(1_234).build();
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: threePageStrategy(),
    options,
  });
  for await (const _page of paginator.pages()) {
    /* drain */
  }
  expect(transport.sentOptions).toHaveLength(3);
  expect(transport.sentOptions.every((o) => o === options)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/paginator.test.ts`
Expected: FAIL — `Cannot find module './paginator.js'`.

If `FakeTransport` does not expose `sendCount` or `sentOptions`, add them there — 5a built it as the shared
`@internal` double precisely so later phases could extend it, and wire-send counting is already in its charter.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/paginator.ts
// SPDX-License-Identifier: MIT
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {invariant} from '../invariant.js';
import {PaginationError} from './errors.js';
import {Page} from './page.js';
import type {PaginationStrategy} from './strategy.js';

export interface PaginatorInit<T> {
  /**
   * Any `Transport` — a raw one, a `FakeTransport`, or 4c's `Runtime` (which implements `Transport`, so a
   * full resilience pipeline drops in unchanged). The engine is transport-agnostic by §12's own mandate.
   */
  readonly transport: Transport;
  readonly initialRequest: Request;
  readonly strategy: PaginationStrategy<T>;
  /** Maximum exchanges. Counts pages, not items. Unbounded when omitted (PAGE-10). */
  readonly maxPages?: number;
  /** Applied to **every** page exchange, not just the first (PAGE-36). */
  readonly options?: RequestOptions;
  readonly signal?: AbortSignal;
}

/**
 * Turns a paginated endpoint into a lazy stream of items or of whole pages (PAGE-1).
 *
 * Holds only frozen configuration and is safe to share; each call to {@link items} or {@link pages} builds a
 * fresh walk with its own counter and cursor, so two iterations drive two full fetch sequences (PAGE-8). That
 * is a property of generators, not bookkeeping performed here.
 *
 * **Laziness is free** (PAGE-6): a generator body does not run until its first `.next()`, so constructing this
 * object, calling `items()`, and taking its iterator all trigger zero exchanges.
 *
 * **Cancellation race** (PAGE-33), inherent and worth knowing: if `signal` aborts *before* the transport
 * delivers a response, that response never reaches this engine and releasing it is the transport's
 * responsibility — cancelling a walk cannot reach into a response it was never handed. Conversely, a page
 * request already dispatched may still complete after the abort; when it does, this engine closes and discards
 * that response rather than yielding it.
 */
export class Paginator<T> {
  // `#private` rather than `private` (styleguide 6.6 defaults to `private`): this is a published class, so the
  // config bag must be unreachable via bracket access from consumer code, not merely compile-time-hidden.
  // It is the class's ONLY field — PAGE-8 requires the engine to hold immutable configuration and nothing else.
  readonly #init: PaginatorInit<T>;

  constructor(init: PaginatorInit<T>) {
    // PAGE-9: fail fast at construction, not lazily on the first fetch, so a misconfiguration surfaces at the
    // call site that caused it.
    if (init.maxPages !== undefined && (!Number.isInteger(init.maxPages) || init.maxPages <= 0)) {
      throw new PaginationError(
        `maxPages must be a positive integer; received ${String(init.maxPages)}`,
      );
    }
    this.#init = Object.freeze({...init});

    invariant(this.#init.transport !== undefined, 'Paginator requires a transport');
    invariant(this.#init.initialRequest !== undefined, 'Paginator requires an initialRequest');
    invariant(this.#init.strategy !== undefined, 'Paginator requires a strategy');
  }

  /**
   * Every item across every page, flattened in server order (PAGE-1).
   *
   * **Each page is closed before any of its items are yielded** (PAGE-11), after the items are copied. The
   * items survive close (PAGE-2), so this costs nothing — and it means abandoning iteration mid-page can never
   * strand a response, regardless of how long the consumer takes.
   *
   * Note this is deliberately *not* the ordering `sdk-design-nodejs/07` §7.1's illustrative snippet shows. That
   * snippet closes in a `finally` after yielding, which holds the response open for the whole item walk; it
   * passes PAGE-11's stated conformance test anyway, which is exactly why the ordering is called out here.
   *
   * Re-iterable, unlike {@link pages}: PAGE-14 scopes single-use to the page-level view, and PAGE-8 requires
   * independent iterations to work.
   */
  items(): AsyncIterable<T> {
    const walk = this.#walk.bind(this);
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        for await (const page of walk()) {
          const items = page.items;
          await page.close();
          yield* items;
        }
      },
    };
  }

  /**
   * Whole pages, each exposing per-page status, headers, and originating request (PAGE-1).
   *
   * Auto-closing (PAGE-12): the previous page is closed as the consumer advances, and the currently held page
   * is closed at exhaustion or on abandonment via the generator's `finally` — which the runtime drives
   * automatically when a `for await` loop exits early through `break`, `return`, or a throw.
   *
   * **Consume this inside a scoped construct** (PAGE-12, MUST). A `for await` loop is one — it drives
   * `.return()` on every exit path, including `break` and `throw`, so the held page is always released. Driving
   * the iterator by hand is the case to be careful with: if you call `[Symbol.asyncIterator]()` yourself and
   * then abandon it without calling `.return()`, the generator never resumes, its `finally` never runs, and the
   * page it is holding stays open until the process exits. Either stay in a `for await`, or bind the pages you
   * pull with `await using` (see {@link Page}), or call `.return()` on the iterator yourself.
   *
   * Single-use (PAGE-14) — **per view, not per paginator**. A second `[Symbol.asyncIterator]()` on *this*
   * returned view fails loudly rather than silently restarting the walk. Calling `pages()` again is the
   * sanctioned recovery path PAGE-14 itself names ("a caller restarts pagination by requesting a fresh view
   * from the engine"), so it returns a new, independent view. Guarding `pages()` too would make the engine
   * stateful, which PAGE-8 forbids ("the engine itself MUST hold only immutable configuration and be safe to
   * share") and would break two concurrent callers sharing one `Paginator`.
   */
  pages(): AsyncIterable<Page<T>> {
    const walk = this.#walk.bind(this);
    let iteratorTaken = false;
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<Page<T>> => {
        // PAGE-14 governs obtaining the *iterator*, not calling pages(), and guarding only the method would
        // leave the exact hole the requirement names: `for await` calls Symbol.asyncIterator afresh each time,
        // so iterating one returned view twice would silently restart the entire walk. 6b's SseStream guards at
        // this same level, for the same reason.
        if (iteratorTaken) {
          throw new PaginationError(
            'the page-level view is single-use; its iterator may be obtained at most once',
          );
        }
        iteratorTaken = true;
        return walk()[Symbol.asyncIterator]();
      },
    };
  }

  /** The one drive routine both views share. */
  async *#walk(): AsyncGenerator<Page<T>> {
    const {transport, strategy, initialRequest, maxPages, options, signal} = this.#init;
    let request: Request | undefined = initialRequest;
    let fetched = 0;
    let held: Page<T> | undefined;

    try {
      while (request !== undefined) {
        // PAGE-9: the cap counts exchanges, and stops the walk even when the strategy still reports a next
        // request.
        if (maxPages !== undefined && fetched >= maxPages) return;

        const response = await transport.send(request, options, signal);
        fetched += 1;

        const info = await parseOrClose(strategy, response, request);

        // PAGE-4: parse must always return a well-formed result and must never signal termination through a
        // side channel. A strategy that returns nothing is a programmer error, so it crashes at the fault
        // rather than silently ending the walk as if the server had run out of pages.
        invariant(info !== undefined, 'PaginationStrategy.parse must return a PageInfo, never undefined');
        invariant(info.items !== undefined, 'PageInfo.items must never be null or absent (PAGE-2)');

        // PAGE-26/PAGE-33: an abort that landed while this exchange was in flight means the page must be
        // dropped AND closed rather than delivered.
        if (signal?.aborted === true) {
          await closeQuietly(response);
          return;
        }

        // PAGE-12: release the previous page as the consumer advances.
        if (held !== undefined) await held.close();
        held = new Page(response, info.items);
        request = info.nextRequest;
        yield held;
      }
    } catch (primary: unknown) {
      // The walk itself failed — a transport rejection, or a parse failure already wrapped by `parseOrClose`.
      // Release before propagating, and keep the walk's failure primary if the release also fails (PAGE-15):
      // a bare `finally` would let the close error replace the cause the caller actually needs to see.
      const stranded = held;
      held = undefined; // so the `finally` below does not attempt a second close on the same page
      if (stranded !== undefined) {
        try {
          await stranded.close();
        } catch (closeError: unknown) {
          throw new SuppressedError(
            primary,
            closeError,
            'the pagination walk failed and releasing the current page also failed',
          );
        }
      }
      throw primary;
    } finally {
      // Covers exhaustion, an early `break`, and a consumer throw — the runtime calls `.return()` on the
      // generator, which runs this block (PAGE-12, PAGE-27, PAGE-32). No error is in flight on these paths, so
      // a close failure here surfaces on its own, which is what PAGE-15 asks for.
      if (held !== undefined) await held.close();
    }
  }
}

/**
 * PAGE-13: if `parse` rejects, the page was never constructed, so nothing else will close this response — do it
 * inline on the exceptional path. A close failure must not mask the parse failure: parse error primary, close
 * error suppressed.
 */
async function parseOrClose<T>(
  strategy: PaginationStrategy<T>,
  response: Response,
  template: Request,
): Promise<Awaited<ReturnType<PaginationStrategy<T>['parse']>>> {
  try {
    return await strategy.parse(response, template);
  } catch (parseError: unknown) {
    try {
      await response.close();
    } catch (closeError: unknown) {
      throw new SuppressedError(
        parseError,
        closeError,
        'pagination parse failed and releasing the response also failed',
      );
    }
    throw parseError;
  }
}

/** PAGE-26: on an already-settled cancellation path, a close error is swallowed — nothing is left to report to. */
async function closeQuietly(response: Response): Promise<void> {
  try {
    await response.close();
  } catch {
    // Deliberately swallowed: the walk has already ended and there is no in-flight result to attach this to.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/paginator.test.ts`
Expected: all pass (13 cases counting the `test.each` expansion).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/paginator.ts packages/core/src/pagination/paginator.test.ts
git commit -m "feat(core): add the Paginator drive routine and both views (PAGE-1/6-12/36)"
```

---

### Task 6: Lifecycle — close-once, close-before-yield, and failure suppression

**Files:**
- Create: `packages/core/src/pagination/lifecycle.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: no new API — this is `PAGE-11`, `PAGE-13`, `PAGE-14`, `PAGE-15`, and `PAGE-27`'s evidence.

The design's whole `PAGE-11` erratum turns on an ordering the appendix-B conformance test does not check. This
task writes the test that does.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/lifecycle.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-11 (close BEFORE yielding items — the assertion appendix B does not make), PAGE-12
// (close-on-abandon), PAGE-13 (parse failure closes inline, close error suppressed), PAGE-14 (single-use page
// view), PAGE-15 (close errors surface), PAGE-27 (exactly once on every path).
import {expect, test} from 'bun:test';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {IoError} from '../io/errors.js';
import {PaginationError} from './errors.js';
import {pageInfo} from './page.js';
import {Paginator} from './paginator.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';

const initialRequest = (): Request =>
  ({url: new URL('https://api.test/items?page=1')} as unknown as Request);

function twoPageStrategy(): PaginationStrategy<string> {
  return {
    async parse(response: Response, template: Request) {
      const page = Number(response.headers.get('X-Page') ?? '1');
      const items = [`p${String(page)}a`, `p${String(page)}b`, `p${String(page)}c`];
      return page >= 2 ? pageInfo(items) : pageInfo(items, template);
    },
  };
}

function transportOf(pages: number, onClose?: (index: number) => void): FakeTransport {
  return new FakeTransport(
    Array.from({length: pages}, (_unused, index) =>
      countingResponse({
        status: 200,
        headers: {'X-Page': String(index + 1)},
        body: '{}',
        onCancel: () => onClose?.(index),
      }),
    ),
  );
}

test('the item view closes a page BEFORE yielding any of its items (PAGE-11)', async () => {
  const events: string[] = [];
  const transport = transportOf(2, (index) => events.push(`close:${String(index)}`));
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  for await (const item of paginator.items()) {
    events.push(`item:${item}`);
  }

  // The close for page 0 must precede every one of its items. Under the design doc's illustrative snippet
  // (close in a `finally`, after `yield*`) this assertion fails while PAGE-11's own checklist test still passes.
  expect(events.indexOf('close:0')).toBeLessThan(events.indexOf('item:p1a'));
  expect(events.indexOf('close:1')).toBeLessThan(events.indexOf('item:p2a'));
});

test('taking one item and stopping closes that page and fetches no second page (PAGE-11)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, (index) => closed.push(index));
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  for await (const _item of paginator.items()) break;

  expect(closed).toEqual([0]);
  expect(transport.sendCount).toBe(1);
});

test('breaking out of the page view closes the held page (PAGE-12)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, (index) => closed.push(index));
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  for await (const _page of paginator.pages()) break;

  expect(closed).toEqual([0]);
});

test('advancing the page view closes the previous page (PAGE-12)', async () => {
  const closed: number[] = [];
  const transport = transportOf(2, (index) => closed.push(index));
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  const seen = [];
  for await (const page of paginator.pages()) seen.push(page);

  expect(seen).toHaveLength(2);
  expect(closed).toEqual([0, 1]);
});

test('a second pages() call returns a fresh, independent view — the restart PAGE-14 names', async () => {
  // PAGE-14's own recovery clause: "a caller restarts pagination by requesting a fresh view from the engine."
  // Guarding pages() itself would block that path AND make the engine stateful, which PAGE-8 forbids.
  const transport = transportOf(4);
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  const first = [];
  for await (const page of paginator.pages()) first.push(page.items[0]);
  const second = [];
  for await (const page of paginator.pages()) second.push(page.items[0]);

  expect(second).toEqual(first);
  expect(transport.sendCount).toBe(4);
});

test('the page view is single-use at the ITERATOR level too (PAGE-14)', async () => {
  // The guard that matters. `for await` calls Symbol.asyncIterator afresh every time, so a view guarded only at
  // the pages() level would let a second loop over the *same* view silently restart the whole walk — the exact
  // "silently restart" PAGE-14 forbids, and invisible to the test above.
  const transport = transportOf(2);
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});
  const view = paginator.pages();

  for await (const _page of view) {
    /* drain */
  }
  const sendsAfterFirstPass = transport.sendCount;

  // `[Symbol.asyncIterator]()` throws synchronously, which `for await` inside an async IIFE turns into a
  // rejection — so assert on the promise, not with a synchronous `toThrow`.
  await expect(
    (async () => {
      for await (const _page of view) {
        /* must not restart */
      }
    })(),
  ).rejects.toBeInstanceOf(PaginationError);
  expect(transport.sendCount).toBe(sendsAfterFirstPass);
});

test('a transport failure surfaces the original cause, unwrapped (PAGE-28)', async () => {
  const transportFailure = new IoError('connection reset');
  const transport = {
    send: () => Promise.reject(transportFailure),
  } as unknown as FakeTransport;
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  let caught: unknown;
  try {
    for await (const _page of paginator.pages()) {
      /* never reached */
    }
  } catch (e: unknown) {
    caught = e;
  }

  // No pagination-flavored wrapper: PAGE-28 wants the cause the caller can actually act on.
  expect(caught).toBe(transportFailure);
  expect(caught).not.toBeInstanceOf(PaginationError);
});

test('a walk failure keeps priority over a failing release of the held page (PAGE-15, PAGE-28)', async () => {
  // Page 1 is delivered and held; page 2's fetch fails. Releasing page 1 then fails too. The transport failure
  // is what the caller needs; the close failure rides along as suppressed. A bare `finally` would invert this.
  const transportFailure = new IoError('connection reset');
  const closeFailure = new IoError('close failed');
  let sends = 0;
  const transport = {
    send: () => {
      sends += 1;
      if (sends > 1) return Promise.reject(transportFailure);
      return Promise.resolve(
        countingResponse({
          status: 200,
          headers: {'X-Page': '1'},
          body: '{}',
          onCancel: () => {
            throw closeFailure;
          },
        }),
      );
    },
  } as unknown as FakeTransport;
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  let caught: unknown;
  try {
    for await (const _page of paginator.pages()) {
      /* advance to the failing second fetch */
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SuppressedError);
  expect((caught as SuppressedError).error).toBe(transportFailure);
  expect((caught as SuppressedError).suppressed).toBe(closeFailure);
});

test('a parse failure closes the response inline and propagates the parse error (PAGE-13)', async () => {
  const boom = new Error('malformed page');
  const closed: number[] = [];
  const transport = transportOf(1, (index) => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse(): Promise<never> {
        return Promise.reject(boom);
      },
    },
  });

  let caught: unknown;
  try {
    for await (const _page of paginator.pages()) {
      /* never reached */
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(boom);
  expect(closed).toEqual([0]);
});

test('a close failure during a parse failure is suppressed, not masking (PAGE-13)', async () => {
  const parseFailure = new Error('malformed page');
  const closeFailure = new IoError('close failed');
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {},
      body: '{}',
      onCancel: () => {
        throw closeFailure;
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse(): Promise<never> {
        return Promise.reject(parseFailure);
      },
    },
  });

  let caught: unknown;
  try {
    for await (const _page of paginator.pages()) {
      /* never reached */
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SuppressedError);
  expect((caught as SuppressedError).error).toBe(parseFailure);
  expect((caught as SuppressedError).suppressed).toBe(closeFailure);
});

test('a close error while releasing a held page surfaces rather than being swallowed (PAGE-15)', async () => {
  const closeFailure = new IoError('close failed');
  const transport = new FakeTransport([
    countingResponse({
      status: 200,
      headers: {'X-Page': '1'},
      body: '{}',
      onCancel: () => {
        throw closeFailure;
      },
    }),
  ]);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: {
      parse: () => Promise.resolve(pageInfo(['only'])),
    },
  });

  let caught: unknown;
  try {
    for await (const _page of paginator.pages()) {
      /* drain to exhaustion, where the held page is released */
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBe(closeFailure);
});

test.each([
  [
    'full drain of the page view',
    async (paginator: Paginator<string>) => {
      for await (const _page of paginator.pages()) {
        /* drain */
      }
    },
  ],
  [
    'full drain of the item view',
    async (paginator: Paginator<string>) => {
      for await (const _item of paginator.items()) {
        /* drain */
      }
    },
  ],
  [
    'early break from the page view',
    async (paginator: Paginator<string>) => {
      for await (const _page of paginator.pages()) break;
    },
  ],
  [
    'consumer throws mid-iteration',
    async (paginator: Paginator<string>) => {
      try {
        for await (const _page of paginator.pages()) throw new Error('consumer blew up');
      } catch {
        /* expected */
      }
    },
  ],
])('every response closes exactly once: %s (PAGE-27)', async (_name, drive) => {
  const closeCounts = new Map<number, number>();
  const transport = transportOf(2, (index) => {
    closeCounts.set(index, (closeCounts.get(index) ?? 0) + 1);
  });
  const paginator = new Paginator({transport, initialRequest: initialRequest(), strategy: twoPageStrategy()});

  await drive(paginator);

  for (const count of closeCounts.values()) {
    expect(count).toBe(1);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/lifecycle.test.ts`
Expected: FAIL — `countingResponse` does not accept an `onCancel` hook.

5a's design names `countingResponse()`'s `ReadableStream` `cancel()` hook as the **only** sanctioned way to
observe a close (instances are `Object.freeze`d, so a spy assignment throws). Add the `onCancel` option to
`countingResponse` in `packages/core/src/testing/fake-transport.ts`, invoked from that existing `cancel()` hook.
Do not add a second observation mechanism.

- [ ] **Step 3: Run again after extending the double**

Run: `cd packages/core && bun test src/pagination/lifecycle.test.ts`
Expected: all pass. If the first `PAGE-11` test fails, the item view is closing *after* yielding — re-read
Task 5's `items()` and the design's erratum before "fixing" the test.

- [ ] **Step 4: Prove the PAGE-11 test is load-bearing**

Temporarily rewrite `items()`'s loop body to the design doc's snippet ordering:

```typescript
        try {
          yield* page.items;
        } finally {
          await page.close();
        }
```

Run: `cd packages/core && bun test src/pagination/lifecycle.test.ts`
Expected: the `close BEFORE yielding` test **fails**, while "taking one item and stopping" still **passes** —
which is the whole point of the erratum. Restore the correct ordering and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/lifecycle.test.ts packages/core/src/testing/fake-transport.ts
git commit -m "test(core): pin close-before-yield ordering and close-once across all paths (PAGE-11/13/15/27)"
```

---

### Task 7: Cancellation and the no-recursion guarantee

**Files:**
- Create: `packages/core/src/pagination/cancellation.test.ts`

**Interfaces:**
- Consumes: Task 5's `Paginator`.
- Produces: no new API — `PAGE-25`, `PAGE-26`, `PAGE-31`, and `PAGE-33`'s evidence.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/cancellation.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-25 (the signal reaches every exchange and halts the walk), PAGE-26 (page-granular
// cancellation; a fetched-but-undelivered page is dropped AND closed), PAGE-31 (no per-page recursion),
// PAGE-33 (a response that arrives after the abort is closed and discarded).
import {expect, test} from 'bun:test';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {pageInfo} from './page.js';
import {Paginator} from './paginator.js';
import type {PaginationStrategy} from './strategy.js';
import type {Request} from '../http/request.js';

const initialRequest = (): Request =>
  ({url: new URL('https://api.test/items?page=1')} as unknown as Request);

const endless = (): PaginationStrategy<string> => ({
  parse: (_response, template) => Promise.resolve(pageInfo(['x'], template)),
});

function transportOf(pages: number, onClose?: (index: number) => void): FakeTransport {
  return new FakeTransport(
    Array.from({length: pages}, (_unused, index) =>
      countingResponse({status: 200, headers: {}, body: '{}', onCancel: () => onClose?.(index)}),
    ),
  );
}

test('the signal is threaded into every page exchange (PAGE-25)', async () => {
  const controller = new AbortController();
  const transport = transportOf(5);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    maxPages: 3,
    signal: controller.signal,
  });
  for await (const _page of paginator.pages()) {
    /* drain */
  }
  expect(transport.sentSignals).toHaveLength(3);
  expect(transport.sentSignals.every((s) => s === controller.signal)).toBe(true);
});

test('aborting mid-walk stops the walk at the next page boundary (PAGE-25, PAGE-26)', async () => {
  const controller = new AbortController();
  const transport = transportOf(10);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    signal: controller.signal,
  });

  let delivered = 0;
  for await (const _page of paginator.pages()) {
    delivered += 1;
    if (delivered === 2) controller.abort();
  }

  // Page 3's exchange may already have been dispatched, but nothing beyond it is.
  expect(delivered).toBe(2);
  expect(transport.sendCount).toBeLessThanOrEqual(3);
});

test('a page fetched after the abort is closed and discarded, never yielded (PAGE-26, PAGE-33)', async () => {
  const controller = new AbortController();
  const closed: number[] = [];
  const transport = transportOf(10, (index) => closed.push(index));
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    signal: controller.signal,
  });

  const delivered = [];
  for await (const page of paginator.pages()) {
    delivered.push(page);
    if (delivered.length === 1) controller.abort();
  }

  // Whatever was fetched is closed — the delivered page by the generator's finally, any post-abort page by the
  // drop path. No response is left open.
  expect(closed.length).toBe(transport.sendCount);
});

test('thousands of immediately-resolved pages complete without stack growth (PAGE-31)', async () => {
  const PAGES = 5000;
  const transport = transportOf(PAGES);
  const paginator = new Paginator({
    transport,
    initialRequest: initialRequest(),
    strategy: endless(),
    maxPages: PAGES,
  });

  let count = 0;
  for await (const _page of paginator.pages()) count += 1;

  // A `for await` loop is iterative by construction — the engine structurally cannot recurse per page, which
  // is PAGE-31's own sanctioned escape from building a trampoline.
  expect(count).toBe(PAGES);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/cancellation.test.ts`
Expected: FAIL — `FakeTransport` has no `sentSignals`. Add it alongside `sentOptions` from Task 5.

- [ ] **Step 3: Run again after extending the double**

Run: `cd packages/core && bun test src/pagination/cancellation.test.ts`
Expected: 4 pass, 0 fail. The 5000-page test should complete in well under a second; if it throws
`RangeError: Maximum call stack size exceeded`, the drive routine recursed and must be rewritten as a loop.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/pagination/cancellation.test.ts packages/core/src/testing/fake-transport.ts
git commit -m "test(core): pin page-granular cancellation and the no-recursion guarantee (PAGE-25/26/31/33)"
```

---

### Task 8: The RFC 8288 link-header tokenizer

**Files:**
- Create: `packages/core/src/pagination/link-header.ts`
- Create: `packages/core/src/pagination/link-header.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface LinkValue {readonly target: string; readonly rel: readonly string[]}`;
  `function parseLinkHeader(value: string): readonly LinkValue[]`;
  `function findNextLink(headerValues: readonly string[]): string | undefined`. Both `@internal`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/link-header.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-18 (RFC 5988/8288 link-value parsing — commas inside <> or quotes do not split, quoted-pair
// escapes, quoted/unquoted rel, multi-token rel, case-insensitive `next`), PAGE-20 (multiple header instances).
import {expect, test} from 'bun:test';
import {findNextLink, parseLinkHeader} from './link-header.js';

test('a simple rel=next is found', () => {
  expect(findNextLink(['</p?page=2>; rel="next"'])).toBe('/p?page=2');
});

test('an unquoted rel works (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel=next'])).toBe('/p?page=2');
});

test('rel matching is case-insensitive (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="NEXT"'])).toBe('/p?page=2');
});

test('a multi-token rel containing next matches (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="prev next last"'])).toBe('/p?page=2');
});

test('a tab-separated multi-token rel matches (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="prev\tnext"'])).toBe('/p?page=2');
});

test('the FIRST link-value whose rel contains next wins (PAGE-18)', () => {
  expect(findNextLink(['</a>; rel="next", </b>; rel="next"'])).toBe('/a');
});

test('rel=prev and rel=last decoys are skipped (PAGE-18)', () => {
  expect(findNextLink(['</a>; rel="prev", </b>; rel="last", </c>; rel="next"'])).toBe('/c');
});

test('a comma inside the angle-bracketed URL does not split link-values (PAGE-18)', () => {
  expect(findNextLink(['</p?ids=1,2,3>; rel="next"'])).toBe('/p?ids=1,2,3');
});

test('a comma inside a quoted parameter value does not split link-values (PAGE-18)', () => {
  const parsed = parseLinkHeader('</a>; title="one, two"; rel="next", </b>; rel="prev"');
  expect(parsed).toHaveLength(2);
  expect(parsed[0]?.target).toBe('/a');
});

test('a quoted-pair escape is honored (PAGE-18)', () => {
  const parsed = parseLinkHeader('</a>; title="say \\"hi\\", ok"; rel="next"');
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.rel).toContain('next');
});

test('no Link header means end of stream (PAGE-18)', () => {
  expect(findNextLink([])).toBeUndefined();
});

test('a Link header with no rel=next means end of stream (PAGE-18)', () => {
  expect(findNextLink(['</a>; rel="prev"'])).toBeUndefined();
});

test('multiple separate Link header instances are normalized by concatenation (PAGE-20)', () => {
  expect(findNextLink(['</a>; rel="last"', '</b>; rel="next"'])).toBe('/b');
});

test('an empty header set maps to no next link (PAGE-20)', () => {
  expect(findNextLink([''])).toBeUndefined();
});

test('surrounding whitespace is tolerated', () => {
  expect(findNextLink(['  < /p?page=2 > ;  rel = "next"  '.replace(/ (?=[/>])|(?<=<) /g, '')])).toBe(
    '/p?page=2',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/link-header.test.ts`
Expected: FAIL — `Cannot find module './link-header.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/link-header.ts
// SPDX-License-Identifier: MIT

export interface LinkValue {
  /** The raw target inside the angle brackets, unresolved. */
  readonly target: string;
  /** The `rel` tokens, lowercased and split on whitespace. Empty when the link-value carried no `rel`. */
  readonly rel: readonly string[];
}

/**
 * Parse an RFC 5988/8288 `Link` header into its link-values (PAGE-18).
 *
 * A regular expression is the wrong tool here and a hand-rolled scanner is the right one, because the
 * separator rules are context-sensitive in two directions at once: a comma splits link-values **only** outside
 * both angle brackets and quoted strings, and a semicolon splits parameters under the same condition. A quoted
 * string additionally supports quoted-pair escapes (`\"`), so quote tracking cannot be a simple toggle.
 *
 * @internal
 */
export function parseLinkHeader(value: string): readonly LinkValue[] {
  const out: LinkValue[] = [];
  for (const raw of splitTopLevel(value, ',')) {
    const parsed = parseOne(raw);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/**
 * The first target whose `rel` contains the token `next`, case-insensitively (PAGE-18).
 *
 * Multiple `Link` header instances are normalized by concatenation before parsing (PAGE-20), which is exactly
 * what the RFC's own list semantics allow. An empty header set maps to no next link.
 *
 * @internal
 */
export function findNextLink(headerValues: readonly string[]): string | undefined {
  const combined = headerValues.filter((v) => v.trim().length > 0).join(', ');
  if (combined.length === 0) return undefined;
  for (const link of parseLinkHeader(combined)) {
    if (link.rel.includes('next')) return link.target;
  }
  return undefined;
}

function parseOne(raw: string): LinkValue | undefined {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('<');
  const close = trimmed.indexOf('>', open + 1);
  if (open === -1 || close === -1) return undefined;

  const target = trimmed.slice(open + 1, close).trim();
  const rel: string[] = [];

  for (const parameter of splitTopLevel(trimmed.slice(close + 1), ';')) {
    const eq = parameter.indexOf('=');
    if (eq === -1) continue;
    if (parameter.slice(0, eq).trim().toLowerCase() !== 'rel') continue;
    // `rel` may be quoted or unquoted, and a quoted value may list several whitespace-separated types.
    rel.push(...unquote(parameter.slice(eq + 1).trim()).toLowerCase().split(/[\s]+/).filter((t) => t.length > 0));
  }

  return {target, rel: Object.freeze(rel)};
}

/** Split on `separator` only at depth zero — outside `<...>` and outside a quoted string. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inAngle = false;
  let inQuotes = false;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (inQuotes && char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && char === '<') inAngle = true;
    else if (!inQuotes && char === '>') inAngle = false;

    if (char === separator && !inAngle && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.filter((part) => part.trim().length > 0);
}

/** Strip surrounding double quotes and unescape quoted pairs. */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/link-header.test.ts`
Expected: 15 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/link-header.ts packages/core/src/pagination/link-header.test.ts
git commit -m "feat(core): add the RFC 8288 link-value tokenizer (PAGE-18/20)"
```

---

### Task 9: The three built-in strategies

**Files:**
- Create: `packages/core/src/pagination/strategies.ts`
- Create: `packages/core/src/pagination/strategies.test.ts`

**Interfaces:**
- Consumes: `pageInfo`, `PageInfo` from `./page.js`; `PaginationStrategy` from `./strategy.js`;
  `spliceQueryParam`, `readQueryParam` from `./query-splice.js`; `findNextLink` from `./link-header.js`.
- Produces: `function cursorStrategy<T>(init: {extract: (response: Response) => Promise<{items: readonly T[];
  cursor: string | null}>; parameterName?: string}): PaginationStrategy<T>`;
  `function pageNumberStrategy<T>(init: {extract: (response: Response) => Promise<readonly T[]>;
  parameterName?: string; startPage?: number}): PaginationStrategy<T>`;
  `function linkHeaderStrategy<T>(init: {extract: (response: Response) => Promise<readonly T[]>;
  headerName?: string}): PaginationStrategy<T>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/strategies.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-16 (cursor: single body read, null OR empty ends, configurable parameter), PAGE-17
// (page-number: empty items ends, start-page fallback on absent/empty/garbage, configurable name and start),
// PAGE-18/19/20 (link header: rel=next, RFC 3986 reference resolution, query-only reference preserves the path,
// unresolvable target ends the stream without throwing).
import {expect, test} from 'bun:test';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {cursorStrategy, linkHeaderStrategy, pageNumberStrategy} from './strategies.js';

const template = (href: string): Request =>
  ({
    url: new URL(href),
    newBuilder() {
      let target = new URL(href);
      return {
        url(next: URL) {
          target = next;
          return this;
        },
        build: () => ({url: target}) as unknown as Request,
      };
    },
  }) as unknown as Request;

const response = (init: {url?: string; headers?: Record<string, readonly string[]>}): Response =>
  ({
    request: {url: new URL(init.url ?? 'https://api.test/repo/issues?page=1')},
    headers: {
      get: (name: string) => init.headers?.[name.toLowerCase()]?.[0],
      getAll: (name: string) => init.headers?.[name.toLowerCase()] ?? [],
    },
  }) as unknown as Response;

// ---- cursor (PAGE-16) ----

test('a cursor sets the configured query parameter on the next request (PAGE-16)', async () => {
  let reads = 0;
  const strategy = cursorStrategy<string>({
    extract: async () => {
      reads += 1;
      return {items: ['a'], cursor: 'c'};
    },
  });
  const info = await strategy.parse(response({}), template('https://api.test/items'));
  expect(info.nextRequest?.url.search).toBe('?cursor=c');
  expect(reads).toBe(1);
});

test('the cursor parameter name is configurable (PAGE-16)', async () => {
  const strategy = cursorStrategy<string>({
    extract: () => Promise.resolve({items: ['a'], cursor: 'c'}),
    parameterName: 'after',
  });
  const info = await strategy.parse(response({}), template('https://api.test/items'));
  expect(info.nextRequest?.url.search).toBe('?after=c');
});

test.each([null, ''])('a %p cursor ends the stream (PAGE-16)', async (cursor) => {
  const strategy = cursorStrategy<string>({
    extract: () => Promise.resolve({items: ['a'], cursor}),
  });
  const info = await strategy.parse(response({}), template('https://api.test/items'));
  expect(info.nextRequest).toBeUndefined();
  expect(info.items).toEqual(['a']);
});

// ---- page number (PAGE-17) ----

test('the first page with no parameter advances to start+1 (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({url: 'https://api.test/items'}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?page=2');
});

test('an empty items list ends the stream, defensively (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({extract: () => Promise.resolve([])});
  const info = await strategy.parse(
    response({url: 'https://api.test/items?page=4'}),
    template('https://api.test/items?page=4'),
  );
  expect(info.nextRequest).toBeUndefined();
});

test('the current page comes from the EXECUTED request, not the template (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({url: 'https://api.test/items?page=7'}),
    template('https://api.test/items?page=1'),
  );
  expect(info.nextRequest?.url.search).toBe('?page=8');
});

test.each(['', 'garbage', '1.5', '-3'])(
  'a %p page value falls back to the start page (PAGE-17)',
  async (value) => {
    const strategy = pageNumberStrategy<string>({extract: () => Promise.resolve(['a'])});
    const info = await strategy.parse(
      response({url: `https://api.test/items?page=${value}`}),
      template('https://api.test/items'),
    );
    expect(info.nextRequest?.url.search).toBe('?page=2');
  },
);

test('the parameter name and start page are configurable, supporting 0-based servers (PAGE-17)', async () => {
  const strategy = pageNumberStrategy<string>({
    extract: () => Promise.resolve(['a']),
    parameterName: 'offset',
    startPage: 0,
  });
  const info = await strategy.parse(
    response({url: 'https://api.test/items'}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.search).toBe('?offset=1');
});

// ---- link header (PAGE-18/19/20) ----

test('an absolute rel=next target is used as-is (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({headers: {link: ['<https://other.test/x?page=2>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.href).toBe('https://other.test/x?page=2');
});

test('a query-only reference preserves the base path and replaces only the query (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({
      url: 'https://api.test/repo/issues?page=1',
      headers: {link: ['<?page=2>; rel="next"']},
    }),
    template('https://api.test/repo/issues?page=1'),
  );
  // RFC 2396 would drop the last path segment here; RFC 3986 (and WHATWG URL) does not.
  expect(info.nextRequest?.url.pathname).toBe('/repo/issues');
  expect(info.nextRequest?.url.search).toBe('?page=2');
});

test('a relative path reference resolves against the response URL (PAGE-19)', async () => {
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({url: 'https://api.test/repo/issues?page=1', headers: {link: ['<../pulls>; rel="next"']}}),
    template('https://api.test/repo/issues'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/pulls');
});

test('an unresolvable target ends the stream rather than throwing (PAGE-19)', async () => {
  // Picking this fixture takes care. With a base supplied, WHATWG `URL` resolves almost *anything* as a
  // relative reference rather than failing — `ht!tp://%%%` has no valid scheme, so it parses happily as a path
  // and yields a defined next request, which would make this test assert nothing. A genuinely unparseable
  // target needs a valid scheme and a broken authority, so the absolute-URL path is taken and fails: `http://[`
  // opens an IPv6 literal that never closes.
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({headers: {link: ['<http://[>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest).toBeUndefined();
  expect(info.items).toEqual(['a']);
});

test('the fixture above really is unparseable — the guard is not vacuous (PAGE-19)', () => {
  expect(() => new URL('http://[', 'https://api.test/items')).toThrow();
  // And the near-miss that does NOT throw, pinned so nobody "simplifies" the fixture back to it later.
  expect(() => new URL('ht!tp://%%%', 'https://api.test/items')).not.toThrow();
});

test('no Link header ends the stream (PAGE-18)', async () => {
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(response({}), template('https://api.test/items'));
  expect(info.nextRequest).toBeUndefined();
});

test('the header name is configurable (PAGE-18)', async () => {
  const strategy = linkHeaderStrategy<string>({
    extract: () => Promise.resolve(['a']),
    headerName: 'X-Links',
  });
  const info = await strategy.parse(
    response({headers: {'x-links': ['</next>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/next');
});

test('two separate Link header instances are both considered (PAGE-20)', async () => {
  const strategy = linkHeaderStrategy<string>({extract: () => Promise.resolve(['a'])});
  const info = await strategy.parse(
    response({headers: {link: ['</a>; rel="last"', '</b>; rel="next"']}}),
    template('https://api.test/items'),
  );
  expect(info.nextRequest?.url.pathname).toBe('/b');
});

test('one strategy instance is safe across two concurrent walks (PAGE-5)', async () => {
  const strategy = pageNumberStrategy<string>({extract: () => Promise.resolve(['a'])});
  const [first, second] = await Promise.all([
    strategy.parse(response({url: 'https://api.test/items?page=1'}), template('https://api.test/items')),
    strategy.parse(response({url: 'https://api.test/items?page=9'}), template('https://api.test/items')),
  ]);
  expect(first.nextRequest?.url.search).toBe('?page=2');
  expect(second.nextRequest?.url.search).toBe('?page=10');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/strategies.test.ts`
Expected: FAIL — `Cannot find module './strategies.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/strategies.ts
// SPDX-License-Identifier: MIT
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {findNextLink} from './link-header.js';
import {pageInfo, type PageInfo} from './page.js';
import {readQueryParam, spliceQueryParam} from './query-splice.js';
import type {PaginationStrategy} from './strategy.js';

/** Build the next request by swapping only the URL, preserving method, headers, and body (PAGE-23). */
function withUrl(template: Request, url: URL): Request {
  return template.newBuilder().url(url).build();
}

/**
 * Cursor/continuation-token pagination (PAGE-16).
 *
 * `extract` reads items and the next cursor from **one** read of the response body. It is caller-supplied
 * rather than codec-driven because §12 requires the engine to be serde-agnostic: naming a `Serde` here would
 * couple pagination to a wire format it has no business knowing about. A caller using `@dexpace/codec-json`
 * simply closes over it inside `extract`.
 *
 * A `null` **or empty** cursor ends the stream — both, because a server returning `""` for "no more pages" is
 * common enough that treating it as a real cursor produces an infinite walk.
 */
export function cursorStrategy<T>(init: {
  extract: (response: Response) => Promise<{items: readonly T[]; cursor: string | null}>;
  parameterName?: string;
}): PaginationStrategy<T> {
  const parameterName = init.parameterName ?? 'cursor';
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const {items, cursor} = await init.extract(response);
      if (cursor === null || cursor.length === 0) return pageInfo(items);
      return pageInfo(items, withUrl(template, spliceQueryParam(template.url, parameterName, cursor)));
    },
  });
}

/**
 * Page-number pagination (PAGE-17).
 *
 * An empty items list ends the stream **before** any arithmetic runs — defensive against servers that keep
 * returning an empty page past the end instead of signalling termination, which would otherwise walk forever.
 *
 * The current page comes from the *executed* request's query, not the template's, because the template never
 * changes across the walk. An absent, empty, or non-numeric value falls back to `startPage`; `startPage: 0`
 * supports 0-based servers.
 */
export function pageNumberStrategy<T>(init: {
  extract: (response: Response) => Promise<readonly T[]>;
  parameterName?: string;
  startPage?: number;
}): PaginationStrategy<T> {
  const parameterName = init.parameterName ?? 'page';
  const startPage = init.startPage ?? 1;
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const items = await init.extract(response);
      if (items.length === 0) return pageInfo(items);

      const raw = readQueryParam(response.request.url, parameterName);
      const parsed = raw === undefined || raw.length === 0 ? Number.NaN : Number(raw);
      const current = Number.isInteger(parsed) && parsed >= 0 ? parsed : startPage;

      const nextUrl = spliceQueryParam(template.url, parameterName, String(current + 1));
      return pageInfo(items, withUrl(template, nextUrl));
    },
  });
}

/**
 * `Link`-header pagination (PAGE-18, PAGE-19, PAGE-20).
 *
 * The target resolves as an RFC 3986 reference against the originating response's URL. WHATWG `URL` gets the
 * query-only (`?page=2`) case right natively — it preserves the base path and replaces only the query, where
 * RFC 2396's older rule would drop the last path segment.
 *
 * A target that cannot resolve into a valid URL is **end-of-stream, not an error** (PAGE-19). That is why the
 * `URL` constructor's throw is caught and converted here — one of the few places in this codebase where
 * swallowing an exception is the specified behavior rather than a smell.
 */
export function linkHeaderStrategy<T>(init: {
  extract: (response: Response) => Promise<readonly T[]>;
  headerName?: string;
}): PaginationStrategy<T> {
  const headerName = init.headerName ?? 'Link';
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const items = await init.extract(response);
      const target = findNextLink(response.headers.getAll(headerName));
      if (target === undefined) return pageInfo(items);

      let resolved: URL;
      try {
        resolved = new URL(target, response.request.url);
      } catch {
        return pageInfo(items); // PAGE-19: unresolvable means end of stream, never an error.
      }
      return pageInfo(items, withUrl(template, resolved));
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/strategies.test.ts`
Expected: all pass (about 21 cases counting the `test.each` expansions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/strategies.ts packages/core/src/pagination/strategies.test.ts
git commit -m "feat(core): add cursor, page-number, and Link-header strategies (PAGE-16-20)"
```

---

### Task 10: The fetcher-based front-end

**Files:**
- Create: `packages/core/src/pagination/fetchers.ts`
- Create: `packages/core/src/pagination/fetchers.test.ts`

**Interfaces:**
- Consumes: `Page` from `./page.js`; `PaginationError` from `./errors.js`.
- Produces: `interface PagingOptions {nextLink?: string; continuationToken?: string; [key: string]: unknown}`;
  `interface FetcherPage<T> {readonly page: Page<T>; readonly nextLink?: string; readonly
  continuationToken?: string}`; `function paginateWithFetchers<T>(init: {...}): AsyncIterable<Page<T>>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/pagination/fetchers.test.ts
// SPDX-License-Identifier: MIT
// Exercises: PAGE-34 (first fetcher runs once; next keys off nextLink with token fallback; blank link or
// undefined page terminates; a fetcher builds a page it does not close), PAGE-35 (one shared mutable options
// instance threaded through every call).
import {expect, test} from 'bun:test';
import {Page} from './page.js';
import {PaginationError} from './errors.js';
import {paginateWithFetchers, type PagingOptions} from './fetchers.js';
import type {Response} from '../http/response.js';

function fakePage<T>(items: readonly T[], onClose: () => void): Page<T> {
  const response = {
    status: {code: 200},
    headers: {get: () => undefined},
    request: {},
    async close(): Promise<void> {
      onClose();
    },
  } as unknown as Response;
  return new Page(response, items);
}

test('the first fetcher runs exactly once and the next keys off nextLink (PAGE-34)', async () => {
  let firstCalls = 0;
  const nextLinks: string[] = [];
  const iterable = paginateWithFetchers<string>({
    first: () => {
      firstCalls += 1;
      return Promise.resolve({page: fakePage(['a'], () => undefined), nextLink: '/p2'});
    },
    next: (link) => {
      nextLinks.push(link);
      return Promise.resolve({page: fakePage(['b'], () => undefined)});
    },
  });

  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);

  expect(firstCalls).toBe(1);
  expect(nextLinks).toEqual(['/p2']);
  expect(seen).toEqual(['a', 'b']);
});

test('the continuation token is used only when no next link is present — link wins (PAGE-34)', async () => {
  const keys: string[] = [];
  let nextCalls = 0;
  const iterable = paginateWithFetchers<string>({
    // Page 1 offers BOTH a link and a token; the link must win.
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => undefined),
        nextLink: '/link',
        continuationToken: 'tok',
      }),
    next: (key) => {
      keys.push(key);
      nextCalls += 1;
      // Page 2 offers only a token, so that is what page 3 keys off. Page 3 offers neither, ending the walk.
      return nextCalls === 1
        ? Promise.resolve({page: fakePage(['b'], () => undefined), continuationToken: 'tok2'})
        : Promise.resolve({page: fakePage(['c'], () => undefined)});
    },
  });

  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);

  expect(keys).toEqual(['/link', 'tok2']);
  expect(seen).toEqual(['a', 'b', 'c']);
});

test.each([undefined, '', '   '])(
  'a %p next link with no fallback token ends the stream (PAGE-34)',
  async (nextLink) => {
    const iterable = paginateWithFetchers<string>({
      first: () => Promise.resolve({page: fakePage(['a'], () => undefined), nextLink}),
      next: () => {
        throw new Error('must not be called');
      },
    });
    const seen = [];
    for await (const page of iterable) seen.push(page.items[0]);
    expect(seen).toEqual(['a']);
  },
);

test('an undefined first page yields an empty stream (PAGE-34)', async () => {
  const iterable = paginateWithFetchers<string>({
    first: () => Promise.resolve(undefined),
    next: () => {
      throw new Error('must not be called');
    },
  });
  const seen = [];
  for await (const page of iterable) seen.push(page);
  expect(seen).toEqual([]);
});

test('an undefined page from the next fetcher ends the stream (PAGE-34)', async () => {
  const iterable = paginateWithFetchers<string>({
    first: () => Promise.resolve({page: fakePage(['a'], () => undefined), nextLink: '/p2'}),
    next: () => Promise.resolve(undefined),
  });
  const seen = [];
  for await (const page of iterable) seen.push(page.items[0]);
  expect(seen).toEqual(['a']);
});

test('the same mutable options instance is threaded through every fetcher call (PAGE-35)', async () => {
  const received: PagingOptions[] = [];
  const iterable = paginateWithFetchers<string>({
    first: (options) => {
      received.push(options);
      options.custom = 'stashed';
      return Promise.resolve({page: fakePage(['a'], () => undefined), nextLink: '/p2'});
    },
    next: (_link, options) => {
      received.push(options);
      return Promise.resolve({page: fakePage(['b'], () => undefined)});
    },
  });

  for await (const _page of iterable) {
    /* drain */
  }

  expect(received[0]).toBe(received[1]);
  expect(received[1]?.custom).toBe('stashed');
});

test('pages are closed as the consumer advances and at exhaustion (PAGE-3, PAGE-12)', async () => {
  const closed: string[] = [];
  const iterable = paginateWithFetchers<string>({
    first: () => Promise.resolve({page: fakePage(['a'], () => closed.push('a')), nextLink: '/p2'}),
    next: () => Promise.resolve({page: fakePage(['b'], () => closed.push('b'))}),
  });

  for await (const _page of iterable) {
    /* drain */
  }

  expect(closed).toEqual(['a', 'b']);
});

test('the cap bounds a fetcher pair that never terminates, fetching nothing extra (PAGE-9)', async () => {
  const closed: string[] = [];
  let calls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () => Promise.resolve({page: fakePage(['a'], () => closed.push('a')), nextLink: '/loop'}),
    next: () => {
      calls += 1;
      const label = `x${String(calls)}`;
      return Promise.resolve({page: fakePage([label], () => closed.push(label)), nextLink: '/loop'});
    },
    maxPages: 3,
  });

  let delivered = 0;
  for await (const _page of iterable) delivered += 1;

  expect(delivered).toBe(3);
  // Three pages delivered means the fetcher ran twice, not three times: the third call would produce a fourth
  // page the cap forbids delivering, and a page fetched but never delivered is a page nobody closes.
  expect(calls).toBe(2);
  // Every page that was fetched was also closed — no leak on the capped path.
  expect(closed.sort()).toEqual(['a', 'x1', 'x2']);
});

test('the fetcher view is single-use at the iterator level, and does not re-run first() (PAGE-14, PAGE-34)', async () => {
  let firstCalls = 0;
  const iterable = paginateWithFetchers<string>({
    first: () => {
      firstCalls += 1;
      return Promise.resolve({page: fakePage(['a'], () => undefined)});
    },
    next: () => {
      throw new Error('must not be called');
    },
  });

  for await (const _page of iterable) {
    /* drain */
  }

  await expect(
    (async () => {
      for await (const _page of iterable) {
        /* must not restart */
      }
    })(),
  ).rejects.toBeInstanceOf(PaginationError);
  // PAGE-34 says the first-page fetcher runs exactly once. Without the guard a second loop would run it again.
  expect(firstCalls).toBe(1);
});

test('a throwing fetcher releases the held page, keeping its own failure primary (PAGE-15)', async () => {
  const fetcherFailure = new Error('page 2 fetch blew up');
  const closeFailure = new Error('close failed');
  const iterable = paginateWithFetchers<string>({
    first: () =>
      Promise.resolve({
        page: fakePage(['a'], () => {
          throw closeFailure;
        }),
        nextLink: '/p2',
      }),
    next: () => Promise.reject(fetcherFailure),
  });

  let caught: unknown;
  try {
    for await (const _page of iterable) {
      /* advance to the failing fetch */
    }
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SuppressedError);
  expect((caught as SuppressedError).error).toBe(fetcherFailure);
  expect((caught as SuppressedError).suppressed).toBe(closeFailure);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/pagination/fetchers.test.ts`
Expected: FAIL — `Cannot find module './fetchers.js'`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/pagination/fetchers.ts
// SPDX-License-Identifier: MIT
import {invariant} from '../invariant.js';
import {PaginationError} from './errors.js';
import type {Page} from './page.js';

/**
 * A mutable bag threaded through **every** fetcher call in one walk (PAGE-35).
 *
 * The same instance is passed each time, so a custom retriever can stash cursor or auth state between pages.
 * Cross-call mutation visibility is the *point*, not a hazard to defend against — it is documented here rather
 * than designed away. Single-consumer; needs no synchronization.
 */
export interface PagingOptions {
  nextLink?: string;
  continuationToken?: string;
  [key: string]: unknown;
}

/** What a fetcher returns: a page it built and does not close, plus how to reach the one after it. */
export interface FetcherPage<T> {
  readonly page: Page<T>;
  readonly nextLink?: string;
  readonly continuationToken?: string;
}

export interface FetcherPaginationInit<T> {
  /** Called exactly once, at the start of the walk. Return `undefined` for an empty stream. */
  first: (options: PagingOptions) => Promise<FetcherPage<T> | undefined>;
  /**
   * Called with the previous page's next link, or — only when no link was present — its continuation token.
   * Return `undefined` to end the stream.
   */
  next: (key: string, options: PagingOptions) => Promise<FetcherPage<T> | undefined>;
  /** Maximum pages delivered. Unbounded when omitted. */
  maxPages?: number;
}

/**
 * Drive pagination from caller-supplied per-page fetchers instead of a strategy (PAGE-34).
 *
 * **Ownership**: each fetcher builds a {@link Page} that owns its response and must **not** close it —
 * ownership transfers to the page, and this engine closes it as the consumer advances and at exhaustion. A
 * fetcher that throws *before* building the page still owns whatever response it opened; this engine never saw
 * it and has no handle with which to close it.
 *
 * **Next link wins** over the continuation token. A blank or whitespace-only link with no fallback token ends
 * the stream, as does an `undefined` return from either fetcher — an `undefined` first page yields an empty
 * stream rather than an error.
 *
 * **Single-use** (PAGE-14). This is a page-level view, so its iterator may be obtained at most once; a second
 * `for await` over the same returned value throws rather than silently restarting. Without the guard a second
 * loop would re-run `first()`, breaking PAGE-34's "exactly once" and double-consuming the walk. Call
 * `paginateWithFetchers()` again for a fresh walk — the same restart path `Paginator.pages()` offers.
 */
export function paginateWithFetchers<T>(init: FetcherPaginationInit<T>): AsyncIterable<Page<T>> {
  if (init.maxPages !== undefined && (!Number.isInteger(init.maxPages) || init.maxPages <= 0)) {
    throw new PaginationError(`maxPages must be a positive integer; received ${String(init.maxPages)}`);
  }
  invariant(typeof init.first === 'function', 'paginateWithFetchers requires a first-page fetcher');
  invariant(typeof init.next === 'function', 'paginateWithFetchers requires a next-page fetcher');

  let iteratorTaken = false;

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Page<T>> {
      if (iteratorTaken) {
        throw new PaginationError(
          'the fetcher pagination view is single-use; its iterator may be obtained at most once',
        );
      }
      iteratorTaken = true;

      const options: PagingOptions = {};
      let held: Page<T> | undefined;
      let delivered = 0;

      try {
        let current = await init.first(options);

        while (current !== undefined) {
          if (held !== undefined) await held.close();
          held = current.page;
          delivered += 1;
          yield held;

          // PAGE-9: stop *before* fetching the page that would exceed the cap. Checking at the top of the loop
          // instead is subtly wrong twice over: it calls the next-page fetcher one extra time, and the page
          // that fetcher returns is never assigned to `held`, so the `finally` below cannot close it and its
          // response leaks. The strategy-based engine gets this right by checking before `transport.send`;
          // here the fetch happens at the bottom of the loop, so the check has to move with it.
          if (init.maxPages !== undefined && delivered >= init.maxPages) return;

          const key = nextKey(current);
          if (key === undefined) return;
          current = await init.next(key, options);
        }
      } catch (primary: unknown) {
        // A fetcher threw. Release the held page before propagating, keeping the fetcher's failure primary if
        // the release also fails — same shape as `Paginator.#walk`, deliberately, so the two engines cannot
        // drift on suppression ordering.
        const stranded = held;
        held = undefined;
        if (stranded !== undefined) {
          try {
            await stranded.close();
          } catch (closeError: unknown) {
            throw new SuppressedError(
              primary,
              closeError,
              'a pagination fetcher failed and releasing the current page also failed',
            );
          }
        }
        throw primary;
      } finally {
        if (held !== undefined) await held.close();
      }
    },
  };
}

/** PAGE-34: the next link wins; the continuation token is a fallback only when no usable link is present. */
function nextKey<T>(page: FetcherPage<T>): string | undefined {
  const link = page.nextLink?.trim();
  if (link !== undefined && link.length > 0) return link;
  const token = page.continuationToken?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && bun test src/pagination/fetchers.test.ts`
Expected: all pass (13 cases counting the `test.each` expansion).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pagination/fetchers.ts packages/core/src/pagination/fetchers.test.ts
git commit -m "feat(core): add the fetcher-based pagination front-end (PAGE-34/35)"
```

---

### Task 11: Public barrel, roadmap close-out, and the Phase 6 gate

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/index.public.test.ts` (append)
- Modify: `packages/core/etc/core.api.md` (regenerated)
- Create: `.changeset/phase6c-pagination.md`
- Modify: `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`
- Modify: `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` (the `PAGE-11` erratum note)

**Interfaces:**
- Consumes: everything above.
- Produces: Phase 6's completed public surface.

- [ ] **Step 1: Write the failing barrel test**

Append to `packages/core/src/index.public.test.ts`:

```typescript
test('the pagination surface is publicly importable', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'Paginator',
    'Page',
    'pageInfo',
    'cursorStrategy',
    'pageNumberStrategy',
    'linkHeaderStrategy',
    'paginateWithFetchers',
    'PaginationError',
  ]) {
    expect(barrel).toHaveProperty(name);
  }
});

test('the URL-manipulation internals stay private — one public query surface, not two', async () => {
  const barrel = await import('./index.js');
  for (const name of ['spliceQueryParam', 'readQueryParam', 'parseLinkHeader', 'findNextLink']) {
    expect(barrel).not.toHaveProperty(name);
  }
});

test('nothing under src/pagination/ imports serde (§12: the engine is serde-agnostic)', async () => {
  const {readdirSync, readFileSync} = await import('node:fs');
  for (const name of readdirSync('src/pagination').filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(`src/pagination/${name}`, 'utf8');
    expect(source).not.toContain('serde');
    expect(source).not.toContain('codec-json');
  }
});

test('nothing under src/pagination/ uses URLSearchParams (PAGE-21)', async () => {
  const {readdirSync, readFileSync} = await import('node:fs');
  for (const name of readdirSync('src/pagination').filter((f) => f.endsWith('.ts'))) {
    expect(readFileSync(`src/pagination/${name}`, 'utf8')).not.toContain('URLSearchParams');
  }
});
```

Two caveats on the last two assertions.

`node:fs` in a test file is permitted — the zero-`node:` invariant governs shipped source under `src/`, and
`verify:seam-1` checks the built output, not the test tree. If the project's lint rule does not carve out
`*.test.ts`, move these two assertions into a `scripts/` check rather than weakening the rule.

More importantly, `readdirSync('src/pagination')` is **relative to the process working directory**, so it only
resolves under `cd packages/core && bun test` and silently throws under a repo-root `bun test` — which is what
Task 11 Step 7's gate runs. Anchor it to the module instead:

```typescript
const paginationDir = new URL('./pagination/', import.meta.url);
const names = readdirSync(paginationDir).filter((f) => f.endsWith('.ts'));
const sourceOf = (name: string) => readFileSync(new URL(name, paginationDir), 'utf8');
```

A guard that quietly does not run in CI is worse than no guard, because it reads as coverage.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/index.public.test.ts`
Expected: FAIL — the barrel has none of the pagination names.

- [ ] **Step 3: Add the exports**

Append to `packages/core/src/index.ts`:

```typescript
// Pagination (Phase 6c). The query splice and link tokenizer stay internal: publishing them would put a second
// URL-manipulation surface next to Phase 1's QueryParams, which is the confusion the one-encoder rule avoids.
export {Page, pageInfo} from './pagination/page.js';
export type {PageInfo} from './pagination/page.js';
export type {PaginationStrategy} from './pagination/strategy.js';
export {Paginator} from './pagination/paginator.js';
export type {PaginatorInit} from './pagination/paginator.js';
export {cursorStrategy, linkHeaderStrategy, pageNumberStrategy} from './pagination/strategies.js';
export {paginateWithFetchers} from './pagination/fetchers.js';
export type {FetcherPage, FetcherPaginationInit, PagingOptions} from './pagination/fetchers.js';
export {PaginationError} from './pagination/errors.js';
```

- [ ] **Step 4: Regenerate the api report and write the changeset**

Run: `cd packages/core && bun run build && bun run api -- --local`
Expected: `etc/core.api.md` gains the pagination surface and nothing from `query-splice.ts` or `link-header.ts`.

```markdown
<!-- .changeset/phase6c-pagination.md -->
---
'@dexpace/core': minor
---

Add the pagination engine: `Paginator` with item- and page-level views, `Page`/`PageInfo`, the
`PaginationStrategy` contract, the cursor / page-number / Link-header built-in strategies, and
`paginateWithFetchers()`. Transport-agnostic and serde-agnostic; a 4c `Runtime` drops in as the transport
unchanged.
```

- [ ] **Step 5: Write the `PAGE-11` erratum — in _both_ documents that carry the wrong ordering**

`docs/knowledge/pagination.md` reproduces the same close-after-yield claim in its Reference section, directly
beside the correct close-before-yield MUST in its Rules section. The knowledge corpus is the standing
tie-breaker every later phase consults, so an erratum that lands only in `sdk-design-nodejs/07` leaves the
contradiction live exactly where the next phase will look. Both get amended; the knowledge note's `## Conflicts`
section is the structural home for a Rules-vs-Reference disagreement.

Append to §7.1 of `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md`, immediately after the
item-level generator snippet:

```markdown
> **Erratum (Phase 6c, 2026-07-28).** The snippet above illustrates JavaScript's automatic
> `.return()`-on-abandon — which is the point it is making, and which is correct. It is **not** a model for
> close *ordering*: `PAGE-11` (MUST) requires each page to be closed *before* any of its items are yielded,
> after the items are copied, so a slow consumer cannot hold a response open for the length of an item walk.
> The shipped implementation copies, closes, then yields. Note that the snippet's ordering still passes
> `PAGE-11`'s own stated conformance test, which is why this is recorded here rather than silently corrected —
> the checklist is weaker than the requirement.
```

Then confirm `docs/knowledge/pagination.md` carries the same correction: an `## Conflicts` entry naming the
Rules-vs-Reference disagreement, `PAGE-11` as the governing side, and `lifecycle.test.ts`'s ordering assertion as
the proof — plus an inline "**Erratum (Phase 6c)**" marker on the Reference bullet itself, so a reader who only
skims that section still sees it. (This was written during the 2026-07-28 plans review; verify it is present
rather than re-adding it.)

- [ ] **Step 6: Close out the roadmap rows**

In `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`:

- Mark the `PAGE-11` erratum row **Resolved in Phase 6c**, pointing at the erratum text above and at
  `lifecycle.test.ts`'s ordering assertion as the mechanical proof.
- Mark the `PAGE-5` "synchronously inside parse" row **Resolved in Phase 6c (re-expressed)**, pointing at
  `strategy.ts`'s TSDoc contract obligations.
- Mark the collapsed-disposition row's 6c half satisfied, pointing at the Phase 6c design's
  `PAGE-25`–`PAGE-33` table.
- Update the Phase 6 split row's status: all three sub-phases now have a design **and** a plan.

- [ ] **Step 7: Run the full gate**

Run: `cd /home/mohammad/Projects/dexpace/nodejs-sdk && bun install && bun run typecheck && bun run lint && bun run build && bun test --coverage && bun run api && bun run lint:publish && bun run verify:dual-consumption && bun run verify:seam-1 && bun run verify:sse-37 && bun run verify:node-floor && bun run test:node && bun run audit`
Expected: every command exits 0. **Do not claim Phase 6 is complete on any other basis** — paste the failing
command's output instead if one does not.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index.public.test.ts packages/core/etc/core.api.md .changeset/phase6c-pagination.md docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md
git commit -m "feat(core): promote the pagination surface and close Phase 6 (PAGE-1-36)"
```

---

## Deviation Ledger Additions (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Item view closes **before** yielding items | `sdk-design-nodejs/07` §7.1's snippet | `PAGE-11` (MUST) requires close-before-yield. The snippet holds the response open for the whole item walk and still passes appendix B's own test, which is why the erratum is written into `sdk-design-nodejs/07` rather than the change being made silently |
| `PaginationStrategy.parse` is asynchronous | `PAGE-5`'s "synchronously inside parse" | No synchronous body read exists in this runtime. Single-use body, no retention, no close, no mutate, and strategy immutability are all preserved and separately tested |
| No caller-supplied executor mode | `PAGE-29` | The consumer's own `for await` loop is the scheduling authority; there is no transport callback thread to relieve |
| No trampoline | `PAGE-31` (SHOULD) | Satisfied by the requirement's own escape clause — a `for await` loop is iterative and structurally cannot recurse per page. Proven by a 5000-page test |
| No executor-rejection path | `PAGE-30` | Vacuous without an executor |
| One engine, not a blocking one and an async one | `§12.9`'s framing | One async primitive in this runtime. `PAGE-6` explicitly anticipates a port where "invoking a walk method is itself the consumption trigger" |
| `items()` is re-iterable while `pages()` is single-use | `PAGE-14` | `PAGE-14` scopes single-use to the page-level view; `PAGE-8` requires independent iterations to work. The asymmetry is in the spec, not introduced here |
| The two-outstanding-pages buffer is one held page, not a look-ahead slot | `PAGE-12` | An async iterator has no separate `hasNext()` probe to strand a prefetched page — a pull either delivers a page or ends. The generator's `finally` covers the one window that does exist |
| Byte-for-byte query preservation yields to the WHATWG query percent-encode set | `PAGE-21` | Assigning to `URL.search` encodes C0 controls, space, `"`, `#`, `<`, `>`, and `'`. Every one is a character RFC 3986 already requires to be encoded inside a query, so only already-non-conformant inputs are affected and the rewrite moves them toward conformance. Avoiding it entirely would mean returning a string instead of a `URL`, pushing the problem onto every caller. Pinned by a named test rather than left to be discovered |
| `PAGE-12`'s "up to two live pages, wrap in a scoped construct" is discharged as documentation plus `await using` | `PAGE-12` | Only one page is ever live here (a page is assigned to `held` before it is yielded), so the reference's two-page window does not open. The residual hazard is a hand-driven iterator abandoned without `.return()`, which no engine can defend against — hence the MUST-level *telling* the requirement actually asks for, on `pages()`' TSDoc, plus `Page`'s optional `[Symbol.asyncDispose]` |
| `[Symbol.asyncDispose]` on `Page` is optional and runtime-guarded, not an `implements AsyncDisposable` | `styleguide/typescript/13` §13.1–13.2 | The symbol landed in Node 18.18, one patch past the declared `>=18.17` floor that `verify:node-floor` pins, and TypeScript does not polyfill it for a declaring library. `close()` stays the supported path everywhere; dispose delegates to it. Unconditional once the floor moves. Identical treatment to 6b's `SseStream` |
