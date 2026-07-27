# Phase 1 — Core HTTP Domain Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the immutable HTTP domain model (Request, Response, Headers, Status, MediaType, Protocol,
QueryParams, RequestOptions, ETag, HttpRange, RequestConditions) in `@dexpace/core`, satisfying `product-spec/04`
(HTTP-3 through HTTP-53) and SEAM-29.

**Architecture:** Every builder-based model is a class with `#private` fields, a `private` (TS) constructor,
`newBuilder()` returning a defensive-copying pre-filled builder, and `build()` doing validation-then-construct.
Value types with no builder (`Status`, `MediaType`, `Protocol`) are frozen classes reconstructed via static
factories. All state frozen once, at construction — never re-copied per getter call.

**Tech Stack:** TypeScript 5.8+, `bun test` + `fast-check` for property tests, no runtime dependencies (SEAM-1).

## Global Constraints

- Every domain class: `#private` fields (real runtime privacy — styleguide 6.7's own carve-out), only the class
  exported, never a bare structural `interface`.
- `Object.freeze(this)` once, at the end of every constructor. Nested mutable collections (arrays, `Map`s) frozen
  independently — `Object.freeze` is shallow, never relied on to cascade.
- Builder pattern: `newBuilder()` instance method returns a pre-filled builder that **defensive-copies** every
  collection (arrays via spread, `Map`-backed state via `new Map(...)`) — never aliases the source.
- All required-field validation goes through the shared `requireField()` helper (Task 1) — never a bespoke
  `if (!x) throw`.
- Typed `Error` subclasses only (styleguide ch08) — no bare `throw new Error(...)`. Every subclass sets
  `this.name = new.target.name`. Wrap-and-rethrow always passes `{ cause }`.
- 70-line function cap, `max-depth` 3, `max-params` 3 (from the scaffold's lint config) — apply to every method.
  ESLint's `max-params` counts **constructor** parameters too, and several domain types have wire models with
  more than three fields (`Response` has six per HTTP-6, `HttpRange` five, `Request`/`RequestConditions`/`ETag`
  four). Neither `product-spec/04` nor `sdk-design-nodejs/04` mandates a *positional* constructor signature — the
  constructor is `private` builder-internal plumbing, called once by its own `build()`/factory and never at a
  public call site — so rather than churn the shape into an options bag with no observable benefit, each such
  constructor carries a `// eslint-disable-next-line max-params -- ...` with a reason. This is exactly the
  "narrow, documented, re-enable-conditioned exception" **NFR-7** permits (and the `require-description` rule the
  scaffold wires makes the reason mandatory). Do not disable `max-params` on anything but these private
  constructors; ordinary methods and free functions stay under three.
- Explicit return types on every exported function/method (styleguide 5.11).
- `bun test`, colocated `*.test.ts`. `fast-check` property tests are **mandatory** (not optional) for every
  codec/parser/serializer per styleguide 11.5 — this phase has four: `MediaType` parse/render, `QueryParams`
  encode/parse, `Headers` case-fold, `Request` URL equality.
- Every test file's top-of-file comment cites the `HTTP-N`/`SEAM-N` IDs it exercises.
- No `zod` in this phase — construction-time invariants on already-typed values use explicit predicate functions
  (styleguide 6.8's "or explicit invariants" allowance).
- **`NFR-13` starts here:** every new source file (production and test) opens with the SPDX header
  `// SPDX-License-Identifier: MIT` on line 1. A review convention, not a mechanical gate, per the spec's own
  framing — the scaffold's deferral row targets "Phase 1 onward", and this is the phase where real files begin.
  Applies equally to every later phase's new files without each plan restating it.

---

## File Structure

```
packages/core/src/http/
  builder.ts                # Builder<T> interface (SEAM-29) + requireField()
  errors.ts                  # DomainModelError root + every leaf error class
  ascii-validation.ts         # shared HTAB+printable-ASCII predicate (HTTP-18, reused by HTTP-26)
  method.ts                   # Method union + idempotency classification (HTTP-9)
  status.ts                    # Status class (HTTP-10/11/12)
  protocol.ts                  # Protocol class (HTTP-33)
  media-type.ts                # MediaType class (HTTP-23..27, HTTP-53)
  headers.ts                    # Headers class + HeadersBuilder + HeaderName (HTTP-13..22)
  query-params.ts               # QueryParams class + QueryParamsBuilder (HTTP-28..32)
  request.ts                     # Request class + RequestBuilder (HTTP-6..9, HTTP-46/47)
  response.ts                    # Response class + ResponseBuilder (HTTP-6)
  request-options.ts             # RequestOptions class + RequestOptionsBuilder (HTTP-34/35)
  etag.ts                          # ETag class (HTTP-48)
  http-range.ts                    # HttpRange class (HTTP-49)
  request-conditions.ts            # RequestConditions class + Builder (HTTP-50)
  index.ts                          # barrel — the one front door
```

Each `.ts` file above gets a colocated `.test.ts`. `index.ts`'s only job is re-exporting; it has no test of its own
(Task 15 verifies it via the toolchain gates instead).

---

### Task 1: Shared plumbing — Builder contract, requireField, error taxonomy

**Files:**
- Create: `packages/core/src/http/builder.ts`
- Create: `packages/core/src/http/builder.test.ts`
- Create: `packages/core/src/http/errors.ts`
- Create: `packages/core/src/http/errors.test.ts`

**Interfaces:**
- Produces: `interface Builder<T> { build(): T }`; `requireField<T>(value: T | null | undefined, name: string): T`;
  `class DomainModelError extends Error`; leaf classes `RequiredFieldError`, `HeaderValidationError`,
  `MediaTypeParseError`, `ProtocolParseError`, `UrlConstructionError`, `RequestOptionsValidationError`,
  `EtagParseError`, `HttpRangeValidationError`, `RequestConditionsValidationError` — every later task imports
  these by these exact names.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/http/errors.test.ts
// Exercises: HTTP-4 (field-named errors), HTTP-20 (no value echo, escaped name)
import {describe, expect, test} from 'bun:test';
import {RequiredFieldError, HeaderValidationError} from './errors.js';

describe('RequiredFieldError', () => {
  test('message names the missing field', () => {
    const error = new RequiredFieldError('url');
    expect(error.message).toBe('url is required');
    expect(error.name).toBe('RequiredFieldError');
  });
});

describe('HeaderValidationError', () => {
  test('never echoes the offending value', () => {
    const error = new HeaderValidationError('name', 'X-Trace', 'secret-token-value');
    expect(error.message).not.toContain('secret-token-value');
  });

  test('escapes control characters in an echoed name', () => {
    const error = new HeaderValidationError('name', 'a\rb', undefined);
    expect(error.message).not.toContain('\r');
    expect(error.message).toContain('\\r');
  });
});
```

```typescript
// packages/core/src/http/builder.test.ts
// Exercises: SEAM-29 (shared Builder contract), HTTP-4 (requireField single-sourcing)
import {describe, expect, test} from 'bun:test';
import {requireField} from './builder.js';
import {RequiredFieldError} from './errors.js';

describe('requireField', () => {
  test('returns the value when present', () => {
    expect(requireField('https://example.com', 'url')).toBe('https://example.com');
  });

  test('throws RequiredFieldError naming the field when null', () => {
    expect(() => requireField(null, 'url')).toThrow(RequiredFieldError);
    expect(() => requireField(null, 'url')).toThrow('url is required');
  });

  test('throws RequiredFieldError naming the field when undefined', () => {
    expect(() => requireField(undefined, 'status')).toThrow('status is required');
  });
});
```

- [ ] **Step 2: Run and confirm both fail**

Run: `cd packages/core && bun test src/http/errors.test.ts src/http/builder.test.ts`
Expected: FAIL — `Cannot find module './errors.js'` / `./builder.js`.

- [ ] **Step 3: Write `errors.ts`**

```typescript
// packages/core/src/http/errors.ts
export class DomainModelError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RequiredFieldError extends DomainModelError {
  constructor(fieldName: string) {
    super(`${fieldName} is required`);
  }
}

function escapeControlChars(input: string): string {
  return input.replace(/[\x00-\x1f\x7f]/g, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\\x0d/g, '\\r')
    .replace(/\\x0a/g, '\\n');
}

export class HeaderValidationError extends DomainModelError {
  constructor(kind: 'name' | 'value', offendingName: string, _offendingValue: string | undefined) {
    super(`invalid header ${kind}: ${escapeControlChars(offendingName)}`);
  }
}

export class MediaTypeParseError extends DomainModelError {}
export class ProtocolParseError extends DomainModelError {}
export class UrlConstructionError extends DomainModelError {}
export class RequestOptionsValidationError extends DomainModelError {}
export class EtagParseError extends DomainModelError {}
export class HttpRangeValidationError extends DomainModelError {}
export class RequestConditionsValidationError extends DomainModelError {}
```

`_offendingValue` is accepted but never interpolated into the message — that's HTTP-20's "never echo the
offending value" enforced by the constructor's own shape, not by caller discipline.

- [ ] **Step 4: Write `builder.ts`**

```typescript
// packages/core/src/http/builder.ts
import {RequiredFieldError} from './errors.js';

export interface Builder<T> {
  build(): T;
}

export function requireField<T>(value: T | null | undefined, fieldName: string): T {
  if (value === null || value === undefined) {
    throw new RequiredFieldError(fieldName);
  }
  return value;
}
```

- [ ] **Step 5: Run and confirm both pass**

Run: `cd packages/core && bun test src/http/errors.test.ts src/http/builder.test.ts`
Expected: PASS — `7 pass, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http/builder.ts packages/core/src/http/builder.test.ts \
        packages/core/src/http/errors.ts packages/core/src/http/errors.test.ts
git commit -m "feat(core): add shared Builder contract, requireField, and error taxonomy"
```

---

### Task 2: Method and idempotency classification

**Files:**
- Create: `packages/core/src/http/method.ts`
- Create: `packages/core/src/http/method.test.ts`

**Interfaces:**
- Produces: `type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH'`;
  `isIdempotent(method: Method): boolean`; `isBodyForbidden(method: Method): boolean`;
  `methodWireToken(method: Method): string`. Task 9 (`Request`) imports `isBodyForbidden` and `methodWireToken`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/method.test.ts
// Exercises: HTTP-9 (idempotency classification, uppercase wire token)
import {describe, expect, test} from 'bun:test';
import {isIdempotent, isBodyForbidden, methodWireToken, type Method} from './method.js';

describe('isIdempotent', () => {
  test('GET, HEAD, OPTIONS, PUT, DELETE are idempotent', () => {
    const idempotent: Method[] = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];
    for (const method of idempotent) expect(isIdempotent(method)).toBe(true);
  });

  test('POST, PATCH, CONNECT, TRACE are not idempotent', () => {
    const notIdempotent: Method[] = ['POST', 'PATCH', 'CONNECT', 'TRACE'];
    for (const method of notIdempotent) expect(isIdempotent(method)).toBe(false);
  });
});

describe('isBodyForbidden', () => {
  test('GET, HEAD, TRACE, CONNECT forbid a body', () => {
    const forbidden: Method[] = ['GET', 'HEAD', 'TRACE', 'CONNECT'];
    for (const method of forbidden) expect(isBodyForbidden(method)).toBe(true);
  });

  test('POST, PUT, DELETE, PATCH, OPTIONS allow a body', () => {
    const allowed: Method[] = ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
    for (const method of allowed) expect(isBodyForbidden(method)).toBe(false);
  });
});

describe('methodWireToken', () => {
  test('equals the uppercase method name for every method', () => {
    const all: Method[] = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH'];
    for (const method of all) expect(methodWireToken(method)).toBe(method.toUpperCase());
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/method.test.ts`
Expected: FAIL — `Cannot find module './method.js'`.

- [ ] **Step 3: Write `method.ts`**

```typescript
// packages/core/src/http/method.ts
export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'CONNECT' | 'OPTIONS' | 'TRACE' | 'PATCH';

const IDEMPOTENT_METHODS: ReadonlySet<Method> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const BODY_FORBIDDEN_METHODS: ReadonlySet<Method> = new Set(['GET', 'HEAD', 'TRACE', 'CONNECT']);

export function isIdempotent(method: Method): boolean {
  return IDEMPOTENT_METHODS.has(method);
}

export function isBodyForbidden(method: Method): boolean {
  return BODY_FORBIDDEN_METHODS.has(method);
}

export function methodWireToken(method: Method): string {
  return method;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/method.test.ts`
Expected: PASS — `4 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/method.ts packages/core/src/http/method.test.ts
git commit -m "feat(core): add Method type and idempotency classification (HTTP-9)"
```

---

### Task 3: Status

**Files:**
- Create: `packages/core/src/http/status.ts`
- Create: `packages/core/src/http/status.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `class Status` with `static of(code: number): Status`, `get code(): number`,
  `get name(): string | undefined`, `get isRecognized(): boolean`, `get isInformational/isSuccess/isRedirect/
  isClientError/isServerError/isError(): boolean`, `equals(other: Status): boolean`. Task 10 (`Response`) consumes
  `Status.of` and the `Status` type.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/status.test.ts
// Exercises: HTTP-10 (total function, never throws), HTTP-11 (range classification), HTTP-12 (code-only equality)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Status} from './status.js';

describe('Status.of', () => {
  test('maps a known code to a named canonical instance', () => {
    const status = Status.of(200);
    expect(status.code).toBe(200);
    expect(status.name).toBe('OK');
    expect(status.isRecognized).toBe(true);
  });

  test('maps an unrecognized code to a raw, unnamed instance without throwing', () => {
    const status = Status.of(599);
    expect(status.code).toBe(599);
    expect(status.name).toBeUndefined();
    expect(status.isRecognized).toBe(false);
  });

  test('never throws for any integer code, per the total-function property', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 999}), (code) => {
        expect(() => Status.of(code)).not.toThrow();
      }),
    );
  });
});

describe('range classification', () => {
  test.each([
    [100, 'isInformational'],
    [200, 'isSuccess'],
    [301, 'isRedirect'],
    [404, 'isClientError'],
    [500, 'isServerError'],
  ] as const)('code %i sets %s', (code, flag) => {
    expect(Status.of(code)[flag]).toBe(true);
  });

  test('400-599 are isError', () => {
    expect(Status.of(404).isError).toBe(true);
    expect(Status.of(500).isError).toBe(true);
    expect(Status.of(200).isError).toBe(false);
  });
});

describe('equals', () => {
  test('two Status values are equal iff their codes are equal, name does not participate', () => {
    expect(Status.of(200).equals(Status.of(200))).toBe(true);
    expect(Status.of(599).equals(Status.of(599))).toBe(true); // both unnamed, same code
    expect(Status.of(200).equals(Status.of(201))).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/status.test.ts`
Expected: FAIL — `Cannot find module './status.js'`.

- [ ] **Step 3: Write `status.ts`**

```typescript
// packages/core/src/http/status.ts
export class Status {
  static readonly #known = new Map<number, Status>();

  readonly #code: number;
  readonly #name: string | undefined;

  private constructor(code: number, name: string | undefined) {
    this.#code = code;
    this.#name = name;
    Object.freeze(this);
  }

  static #register(code: number, name: string): void {
    Status.#known.set(code, new Status(code, name));
  }

  static {
    Status.#register(200, 'OK');
    Status.#register(201, 'Created');
    Status.#register(204, 'No Content');
    Status.#register(301, 'Moved Permanently');
    Status.#register(302, 'Found');
    Status.#register(304, 'Not Modified');
    Status.#register(400, 'Bad Request');
    Status.#register(401, 'Unauthorized');
    Status.#register(403, 'Forbidden');
    Status.#register(404, 'Not Found');
    Status.#register(409, 'Conflict');
    Status.#register(429, 'Too Many Requests');
    Status.#register(500, 'Internal Server Error');
    Status.#register(502, 'Bad Gateway');
    Status.#register(503, 'Service Unavailable');
  }

  static of(code: number): Status {
    return Status.#known.get(code) ?? new Status(code, undefined);
  }

  get code(): number {
    return this.#code;
  }

  get name(): string | undefined {
    return this.#name;
  }

  get isRecognized(): boolean {
    return this.#name !== undefined;
  }

  get isInformational(): boolean {
    return this.#code >= 100 && this.#code <= 199;
  }

  get isSuccess(): boolean {
    return this.#code >= 200 && this.#code <= 299;
  }

  get isRedirect(): boolean {
    return this.#code >= 300 && this.#code <= 399;
  }

  get isClientError(): boolean {
    return this.#code >= 400 && this.#code <= 499;
  }

  get isServerError(): boolean {
    return this.#code >= 500 && this.#code <= 599;
  }

  get isError(): boolean {
    return this.#code >= 400 && this.#code <= 599;
  }

  equals(other: Status): boolean {
    return this.#code === other.#code;
  }
}
```

The private (TS) constructor is only reachable from within the class body — `static #register` and the
`static {}` initialization block both count as "within the class body," so they can call it; nothing outside
this file can.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/status.test.ts`
Expected: PASS — `10 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/status.ts packages/core/src/http/status.test.ts
git commit -m "feat(core): add Status value type (HTTP-10/11/12)"
```

---

### Task 4: Protocol

**Files:**
- Create: `packages/core/src/http/protocol.ts`
- Create: `packages/core/src/http/protocol.test.ts`

**Interfaces:**
- Consumes: `ProtocolParseError` from `errors.ts` (Task 1).
- Produces: `class Protocol` with static constants `Protocol.HTTP_1_1`, `Protocol.HTTP_2`, `static parse(raw:
  string): Protocol`, `get token(): string`, `equals(other: Protocol): boolean`. Task 10 (`Response`) consumes
  `Protocol`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/protocol.test.ts
// Exercises: HTTP-33 (canonical lowercase wire form, case-insensitive alias parsing)
import {describe, expect, test} from 'bun:test';
import {Protocol} from './protocol.js';
import {ProtocolParseError} from './errors.js';

describe('Protocol.parse', () => {
  test('parses the canonical lowercase forms', () => {
    expect(Protocol.parse('http/1.1').token).toBe('http/1.1');
    expect(Protocol.parse('http/2').token).toBe('http/2');
  });

  test('accepts the HTTP/2 and HTTP/2.0 aliases case-insensitively', () => {
    expect(Protocol.parse('HTTP/2').token).toBe('http/2');
    expect(Protocol.parse('HTTP/2.0').token).toBe('http/2');
    expect(Protocol.parse('Http/1.1').token).toBe('http/1.1');
  });

  test('throws ProtocolParseError on an unrecognized identifier', () => {
    expect(() => Protocol.parse('ftp/1.0')).toThrow(ProtocolParseError);
  });
});

describe('equals', () => {
  test('two protocols with the same token are equal', () => {
    expect(Protocol.parse('HTTP/2').equals(Protocol.HTTP_2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/protocol.test.ts`
Expected: FAIL — `Cannot find module './protocol.js'`.

- [ ] **Step 3: Write `protocol.ts`**

```typescript
// packages/core/src/http/protocol.ts
import {ProtocolParseError} from './errors.js';

export class Protocol {
  readonly #token: string;

  private constructor(token: string) {
    this.#token = token;
    Object.freeze(this);
  }

  static readonly HTTP_1_1 = new Protocol('http/1.1');
  static readonly HTTP_2 = new Protocol('http/2');

  static parse(raw: string): Protocol {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'http/1.1') return Protocol.HTTP_1_1;
    if (normalized === 'http/2' || normalized === 'http/2.0') return Protocol.HTTP_2;
    throw new ProtocolParseError(`unrecognized protocol: ${raw}`);
  }

  get token(): string {
    return this.#token;
  }

  equals(other: Protocol): boolean {
    return this.#token === other.#token;
  }
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/protocol.test.ts`
Expected: PASS — `5 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/protocol.ts packages/core/src/http/protocol.test.ts
git commit -m "feat(core): add Protocol value type (HTTP-33)"
```

---

### Task 5: Shared ASCII validation predicate + MediaType

**Files:**
- Create: `packages/core/src/http/ascii-validation.ts`
- Create: `packages/core/src/http/ascii-validation.test.ts`
- Create: `packages/core/src/http/media-type.ts`
- Create: `packages/core/src/http/media-type.test.ts`

**Interfaces:**
- Consumes: `MediaTypeParseError` from `errors.ts` (Task 1).
- Produces: `hasForbiddenOutboundByte(value: string): boolean` (Task 7, Headers, reuses this for HTTP-18's
  identical predicate). `class MediaType` with `static of(type: string, subtype: string, parameters?:
  ReadonlyMap<string, string>): MediaType`, `static parse(raw: string): MediaType`, `get type/subtype(): string`,
  `parameter(key: string): string | undefined`, `get charset(): string | undefined`, `render(): string`,
  `matches(pattern: MediaType): boolean`, `equals(other: MediaType): boolean`.

- [ ] **Step 1: Write the failing test for the shared predicate**

```typescript
// packages/core/src/http/ascii-validation.test.ts
// Exercises: HTTP-18 (outbound value grammar: HTAB + printable ASCII 0x20-0x7E only)
import {describe, expect, test} from 'bun:test';
import {hasForbiddenOutboundByte} from './ascii-validation.js';

describe('hasForbiddenOutboundByte', () => {
  test('accepts HTAB and printable ASCII', () => {
    expect(hasForbiddenOutboundByte('a\tb')).toBe(false);
    expect(hasForbiddenOutboundByte('printable ASCII 0x20-0x7E')).toBe(false);
  });

  test('rejects CR/LF and other control characters', () => {
    expect(hasForbiddenOutboundByte('a\r\nb')).toBe(true);
    expect(hasForbiddenOutboundByte('a\0b')).toBe(true);
  });

  test('rejects non-ASCII bytes', () => {
    expect(hasForbiddenOutboundByte('vålue')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/ascii-validation.test.ts`
Expected: FAIL — `Cannot find module './ascii-validation.js'`.

- [ ] **Step 3: Write `ascii-validation.ts`**

```typescript
// packages/core/src/http/ascii-validation.ts
export function hasForbiddenOutboundByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const allowed = code === 0x09 || (code >= 0x20 && code <= 0x7e);
    if (!allowed) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/ascii-validation.test.ts`
Expected: PASS — `3 pass, 0 fail`.

- [ ] **Step 5: Write the failing tests for MediaType**

```typescript
// packages/core/src/http/media-type.test.ts
// Exercises: HTTP-23 (case rules), HTTP-24 (charset never throws), HTTP-25/HTTP-53 (parse/render round-trip),
// HTTP-26 (forbidden bytes), HTTP-27 (wildcard matching)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {MediaType} from './media-type.js';
import {MediaTypeParseError} from './errors.js';

describe('MediaType.parse', () => {
  test('lower-cases type, subtype, and parameter keys; preserves parameter value case', () => {
    const mediaType = MediaType.parse('Application/JSON;Charset=UTF-8');
    expect(mediaType.type).toBe('application');
    expect(mediaType.subtype).toBe('json');
    expect(mediaType.parameter('charset')).toBe('UTF-8');
  });

  test('rejects blank input', () => {
    expect(() => MediaType.parse('')).toThrow(MediaTypeParseError);
    expect(() => MediaType.parse('   ')).toThrow(MediaTypeParseError);
  });

  test('rejects an empty type or subtype', () => {
    expect(() => MediaType.parse('/json')).toThrow(MediaTypeParseError);
    expect(() => MediaType.parse('application/')).toThrow(MediaTypeParseError);
  });

  test('rejects a parameter with no "=" or an empty key/value', () => {
    expect(() => MediaType.parse('text/plain;charset')).toThrow(MediaTypeParseError);
    expect(() => MediaType.parse('text/plain;=utf-8')).toThrow(MediaTypeParseError);
  });

  test('respects quoted-strings when splitting parameters', () => {
    const mediaType = MediaType.parse('text/plain;boundary="a;b=c"');
    expect(mediaType.parameter('boundary')).toBe('a;b=c');
  });
});

describe('charset', () => {
  test('resolves case-insensitively', () => {
    expect(MediaType.parse('text/plain;CHARSET=utf-8').charset).toBe('utf-8');
  });

  test('is undefined, never throws, when absent or unknown', () => {
    expect(MediaType.parse('text/plain').charset).toBeUndefined();
  });
});

describe('construction rejects forbidden bytes (HTTP-26)', () => {
  test('rejects a control character or non-ASCII byte in type/subtype/params', () => {
    expect(() => MediaType.of('text', 'plain\r\n')).toThrow(MediaTypeParseError);
    expect(() => MediaType.of('text', 'plain', new Map([['name', 'vålue']]))).toThrow(MediaTypeParseError);
  });
});

describe('wildcard matching (HTTP-27)', () => {
  test('a bare */* matches anything', () => {
    expect(MediaType.parse('application/json').matches(MediaType.parse('*/*'))).toBe(true);
  });

  test('a wildcard in either position matches any value there', () => {
    expect(MediaType.parse('application/json').matches(MediaType.parse('application/*'))).toBe(true);
    expect(MediaType.parse('application/json').matches(MediaType.parse('*/json'))).toBe(true);
    expect(MediaType.parse('application/json').matches(MediaType.parse('text/*'))).toBe(false);
  });
});

describe('parse(render(x)) === x round-trip (HTTP-25)', () => {
  test('holds for generated type/subtype/parameter combinations', () => {
    const tokenArb = fc.stringMatching(/^[a-z][a-z0-9]{0,9}$/);
    const valueArb = fc.string({minLength: 0, maxLength: 12}).filter((s) => /^[\x20-\x7e]*$/.test(s));
    // A *dictionary* of parameters (not a single pair) is deliberate: multiple params force `render` to emit
    // separators between quoted values, and `valueArb` admits backslash/quote/semicolon (all in 0x20-0x7e), so
    // this exercises the quote/escape state machine in `splitRespectingQuotes` — a single-param generator would
    // never place a separator after a value ending in an escaped backslash, the exact case that round-trips wrong
    // without correct escape tracking.
    fc.assert(
      fc.property(tokenArb, tokenArb, fc.dictionary(tokenArb, valueArb, {maxKeys: 4}), (type, subtype, params) => {
        const original = MediaType.of(type, subtype, new Map(Object.entries(params)));
        const restored = MediaType.parse(original.render());
        expect(restored.equals(original)).toBe(true);
      }),
    );
  });
});
```

- [ ] **Step 6: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/media-type.test.ts`
Expected: FAIL — `Cannot find module './media-type.js'`.

- [ ] **Step 7: Write `media-type.ts`**

```typescript
// packages/core/src/http/media-type.ts
import {MediaTypeParseError} from './errors.js';
import {hasForbiddenOutboundByte} from './ascii-validation.js';

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function splitRespectingQuotes(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === separator && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function validateNoForbiddenBytes(value: string): void {
  if (hasForbiddenOutboundByte(value)) {
    throw new MediaTypeParseError(`media type contains a forbidden character (${value.length} chars)`);
  }
}

function renderParameterValue(value: string): string {
  if (TOKEN_RE.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export class MediaType {
  readonly #type: string;
  readonly #subtype: string;
  readonly #parameters: ReadonlyMap<string, string>;

  private constructor(type: string, subtype: string, parameters: ReadonlyMap<string, string>) {
    this.#type = type;
    this.#subtype = subtype;
    this.#parameters = parameters;
    Object.freeze(this);
  }

  static of(type: string, subtype: string, parameters: ReadonlyMap<string, string> = new Map()): MediaType {
    validateNoForbiddenBytes(type);
    validateNoForbiddenBytes(subtype);
    const normalized = new Map<string, string>();
    for (const [key, value] of parameters) {
      validateNoForbiddenBytes(key);
      validateNoForbiddenBytes(value);
      normalized.set(key.toLowerCase(), value);
    }
    return new MediaType(type.toLowerCase(), subtype.toLowerCase(), Object.freeze(normalized));
  }

  static parse(raw: string): MediaType {
    if (raw.trim() === '') throw new MediaTypeParseError('media type cannot be blank');

    const segments = splitRespectingQuotes(raw, ';');
    const typeSubtype = segments[0]?.trim() ?? '';
    const slashIndex = typeSubtype.indexOf('/');
    if (slashIndex <= 0 || slashIndex === typeSubtype.length - 1) {
      throw new MediaTypeParseError(`media type requires non-empty type and subtype: ${raw}`);
    }

    const type = typeSubtype.slice(0, slashIndex);
    const subtype = typeSubtype.slice(slashIndex + 1);
    const parameters = MediaType.#parseParameters(segments.slice(1), raw);
    return MediaType.of(type, subtype, parameters);
  }

  static #parseParameters(segments: readonly string[], raw: string): Map<string, string> {
    const parameters = new Map<string, string>();
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed === '') continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0 || eqIndex === trimmed.length - 1) {
        throw new MediaTypeParseError(`malformed parameter in media type: ${raw}`);
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      parameters.set(key, value);
    }
    return parameters;
  }

  get type(): string {
    return this.#type;
  }

  get subtype(): string {
    return this.#subtype;
  }

  parameter(key: string): string | undefined {
    return this.#parameters.get(key.toLowerCase());
  }

  get charset(): string | undefined {
    return this.parameter('charset');
  }

  render(): string {
    let result = `${this.#type}/${this.#subtype}`;
    for (const [key, value] of this.#parameters) {
      result += `; ${key}=${renderParameterValue(value)}`;
    }
    return result;
  }

  matches(pattern: MediaType): boolean {
    const typeMatches = pattern.#type === '*' || pattern.#type === this.#type;
    const subtypeMatches = pattern.#subtype === '*' || pattern.#subtype === this.#subtype;
    return typeMatches && subtypeMatches;
  }

  equals(other: MediaType): boolean {
    if (this.#type !== other.#type || this.#subtype !== other.#subtype) return false;
    if (this.#parameters.size !== other.#parameters.size) return false;
    for (const [key, value] of this.#parameters) {
      if (other.#parameters.get(key) !== value) return false;
    }
    return true;
  }
}
```

- [ ] **Step 8: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/media-type.test.ts`
Expected: PASS — `11 pass, 0 fail` (the property test runs 100 generated cases by default under one `it`).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/http/ascii-validation.ts packages/core/src/http/ascii-validation.test.ts \
        packages/core/src/http/media-type.ts packages/core/src/http/media-type.test.ts
git commit -m "feat(core): add MediaType value type and shared ASCII validation predicate (HTTP-23..27, HTTP-53)"
```

---

### Task 6: Headers — core storage (no validation yet)

**Files:**
- Create: `packages/core/src/http/headers.ts`
- Create: `packages/core/src/http/headers.test.ts`

**Interfaces:**
- Consumes: `Builder<T>`/`requireField` (Task 1).
- Produces: `class Headers` with `newBuilder(): HeadersBuilder`; `class HeadersBuilder implements Builder<Headers>`
  with `add(name: string, value: string): this`, `set(name: string, value: string | null): this`, `build():
  Headers`; `Headers.newBuilder(): HeadersBuilder` (static entry point). `get(name): string | undefined`,
  `getAll(name): ReadonlyArray<string>`, `has(name): boolean`, `names(): ReadonlyArray<string>`, `entries():
  ReadonlyArray<readonly [string, string]>`, `equals(other: Headers): boolean`. Task 9 (`Request`) and Task 10
  (`Response`) both consume `Headers`/`HeadersBuilder`. Task 7 extends this same file with validation — do not
  rename any of the above before Task 7 lands.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/headers.test.ts
// Exercises: HTTP-13 (case-insensitive storage), HTTP-14 (multi-value add/set), HTTP-15 (null removes),
// HTTP-16 (insertion order), HTTP-3 (newBuilder derivation doesn't alias), HTTP-5 (no live-builder leak)
import {describe, expect, test} from 'bun:test';
import {Headers} from './headers.js';

describe('case-insensitive storage', () => {
  test('a name added under one casing resolves under any other', () => {
    const headers = Headers.newBuilder().add('Content-Type', 'text/plain').build();
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('CONTENT-TYPE')).toBe('text/plain');
    expect(headers.has('cOnTeNt-TyPe')).toBe(true);
  });

  test('folds using an ASCII-only rule, not a locale-sensitive one', () => {
    const headers = Headers.newBuilder().add('X-Trace-I', 'v').build();
    expect(headers.has('x-trace-i')).toBe(true);
  });
});

describe('multi-value semantics', () => {
  test('add appends, set replaces the whole list', () => {
    const headers = Headers.newBuilder().add('X-Tag', 'a').add('X-Tag', 'b').build();
    expect(headers.getAll('X-Tag')).toEqual(['a', 'b']);

    const replaced = headers.newBuilder().set('X-Tag', 'c').build();
    expect(replaced.getAll('X-Tag')).toEqual(['c']);
  });
});

describe('null removes', () => {
  test('setting a header value to null removes it entirely', () => {
    const headers = Headers.newBuilder().add('X-Tag', 'a').set('X-Tag', null).build();
    expect(headers.has('X-Tag')).toBe(false);
  });
});

describe('insertion order', () => {
  test('distinct names iterate in insertion order', () => {
    const headers = Headers.newBuilder().add('X-First', '1').add('X-Second', '2').add('X-Third', '3').build();
    expect(headers.names()).toEqual(['X-First', 'X-Second', 'X-Third']);
  });
});

describe('newBuilder derivation', () => {
  test('mutating a derived builder does not affect the original', () => {
    const original = Headers.newBuilder().add('X-Tag', 'a').build();

    original.newBuilder().add('X-Tag', 'b').build();

    expect(original.getAll('X-Tag')).toEqual(['a']);
  });

  test('a previously-returned snapshot is unchanged after the source builder mutates further', () => {
    const builder = Headers.newBuilder().add('X-Tag', 'a');
    const first = builder.build();
    builder.add('X-Tag', 'b');
    const second = builder.build();

    expect(first.getAll('X-Tag')).toEqual(['a']);
    expect(second.getAll('X-Tag')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/headers.test.ts`
Expected: FAIL — `Cannot find module './headers.js'`.

- [ ] **Step 3: Write `headers.ts`**

```typescript
// packages/core/src/http/headers.ts
import type {Builder} from './builder.js';

export class Headers {
  readonly #valuesByLowerName: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly #originalCasingByLowerName: ReadonlyMap<string, string>;
  readonly #insertionOrder: ReadonlyArray<string>;

  constructor(
    valuesByLowerName: ReadonlyMap<string, ReadonlyArray<string>>,
    originalCasingByLowerName: ReadonlyMap<string, string>,
    insertionOrder: ReadonlyArray<string>,
  ) {
    this.#valuesByLowerName = valuesByLowerName;
    this.#originalCasingByLowerName = originalCasingByLowerName;
    this.#insertionOrder = insertionOrder;
    Object.freeze(this);
  }

  static newBuilder(): HeadersBuilder {
    return new HeadersBuilder();
  }

  newBuilder(): HeadersBuilder {
    const builder = new HeadersBuilder();
    for (const lowerName of this.#insertionOrder) {
      const originalName = this.#originalCasingByLowerName.get(lowerName) ?? lowerName;
      for (const value of this.#valuesByLowerName.get(lowerName) ?? []) {
        builder.add(originalName, value);
      }
    }
    return builder;
  }

  get(name: string): string | undefined {
    return this.#valuesByLowerName.get(name.toLowerCase())?.[0];
  }

  getAll(name: string): ReadonlyArray<string> {
    return this.#valuesByLowerName.get(name.toLowerCase()) ?? [];
  }

  has(name: string): boolean {
    return this.#valuesByLowerName.has(name.toLowerCase());
  }

  names(): ReadonlyArray<string> {
    return this.#insertionOrder.map((lowerName) => this.#originalCasingByLowerName.get(lowerName) ?? lowerName);
  }

  entries(): ReadonlyArray<readonly [string, string]> {
    const result: Array<readonly [string, string]> = [];
    for (const lowerName of this.#insertionOrder) {
      const originalName = this.#originalCasingByLowerName.get(lowerName) ?? lowerName;
      for (const value of this.#valuesByLowerName.get(lowerName) ?? []) {
        result.push([originalName, value]);
      }
    }
    return result;
  }

  equals(other: Headers): boolean {
    if (this.#insertionOrder.length !== other.#insertionOrder.length) return false;
    for (const lowerName of this.#insertionOrder) {
      const mine = this.#valuesByLowerName.get(lowerName) ?? [];
      const theirs = other.#valuesByLowerName.get(lowerName) ?? [];
      if (mine.length !== theirs.length || mine.some((v, i) => v !== theirs[i])) return false;
    }
    return true;
  }
}

export class HeadersBuilder implements Builder<Headers> {
  readonly #valuesByLowerName = new Map<string, string[]>();
  readonly #originalCasingByLowerName = new Map<string, string>();
  readonly #insertionOrder: string[] = [];

  add(name: string, value: string): this {
    const lowerName = name.toLowerCase();
    if (!this.#valuesByLowerName.has(lowerName)) {
      this.#insertionOrder.push(lowerName);
      this.#originalCasingByLowerName.set(lowerName, name);
      this.#valuesByLowerName.set(lowerName, []);
    }
    this.#valuesByLowerName.get(lowerName)?.push(value);
    return this;
  }

  set(name: string, value: string | null): this {
    const lowerName = name.toLowerCase();
    if (value === null) {
      this.#valuesByLowerName.delete(lowerName);
      this.#originalCasingByLowerName.delete(lowerName);
      const index = this.#insertionOrder.indexOf(lowerName);
      if (index !== -1) this.#insertionOrder.splice(index, 1);
      return this;
    }
    if (!this.#valuesByLowerName.has(lowerName)) this.#insertionOrder.push(lowerName);
    this.#originalCasingByLowerName.set(lowerName, name);
    this.#valuesByLowerName.set(lowerName, [value]);
    return this;
  }

  build(): Headers {
    const frozenValues = new Map<string, ReadonlyArray<string>>();
    for (const [lowerName, values] of this.#valuesByLowerName) {
      frozenValues.set(lowerName, Object.freeze([...values]));
    }
    return new Headers(
      Object.freeze(frozenValues),
      Object.freeze(new Map(this.#originalCasingByLowerName)),
      Object.freeze([...this.#insertionOrder]),
    );
  }
}
```

The `Headers` constructor is deliberately not `private` here (unlike `Status`/`Protocol`) because `HeadersBuilder.build()` — a *different* class — must be able to construct one; TypeScript has no "friend class" concept. It stays unexported from the module's *public* surface indirectly: only `Headers` and `HeadersBuilder` are exported from `index.ts` (Task 15), and nothing else in the codebase calls `new Headers(...)` directly — that discipline is enforced by review, not the compiler, and is worth a one-line comment at the constructor site saying so.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd packages/core && bun test src/http/headers.test.ts`
Expected: PASS — `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/headers.ts packages/core/src/http/headers.test.ts
git commit -m "feat(core): add Headers core storage (HTTP-13/14/15/16, HTTP-3/5 derivation and immutability)"
```

---

### Task 7: Headers validation, outbound/inbound asymmetry, and typed HeaderName

**Files:**
- Modify: `packages/core/src/http/ascii-validation.ts` (add two predicates)
- Modify: `packages/core/src/http/ascii-validation.test.ts` (add their tests)
- Modify: `packages/core/src/http/headers.ts` (validate `add`/`set`, add `addInbound`/`setInbound`, add
  `HeaderName`)
- Modify: `packages/core/src/http/headers.test.ts` (add validation tests)

**Interfaces:**
- Consumes: `hasForbiddenOutboundByte` (Task 5), `HeaderValidationError` (Task 1).
- Produces: two new predicates `hasForbiddenNameByte(value: string): boolean` and
  `hasForbiddenInboundValueByte(value: string): boolean`; `HeadersBuilder.addInbound(name: string, value: string):
  this` and `setInbound(name: string, value: string | null): this`; `class HeaderName` with `static of(raw:
  string): HeaderName`, `get raw(): string`, `get lowerCased(): string`, `equals(other: HeaderName): boolean`.
  `add`/`set` now validate and trim the name — their signatures are unchanged, but they can now throw.

- [ ] **Step 1: Write the failing tests for the two new predicates**

```typescript
// append to packages/core/src/http/ascii-validation.test.ts
// Exercises: HTTP-17 (outbound name: no HTAB exception), HTTP-19 (inbound value: permits obs-text)
import {hasForbiddenNameByte, hasForbiddenInboundValueByte} from './ascii-validation.js';

describe('hasForbiddenNameByte', () => {
  test('rejects HTAB, unlike the value predicate', () => {
    expect(hasForbiddenNameByte('a\tb')).toBe(true);
  });

  test('rejects CR/LF, NUL, DEL, and non-ASCII', () => {
    expect(hasForbiddenNameByte('a\r\nb')).toBe(true);
    expect(hasForbiddenNameByte('a\0b')).toBe(true);
    expect(hasForbiddenNameByte('héader')).toBe(true);
  });

  test('accepts ordinary printable ASCII', () => {
    expect(hasForbiddenNameByte('X-Trace')).toBe(false);
  });
});

describe('hasForbiddenInboundValueByte', () => {
  test('permits obs-text (bytes >= 0x80)', () => {
    expect(hasForbiddenInboundValueByte('café')).toBe(false);
  });

  test('still rejects control characters', () => {
    expect(hasForbiddenInboundValueByte('a\r\nb')).toBe(true);
    expect(hasForbiddenInboundValueByte('a\0b')).toBe(true);
  });

  test('permits HTAB', () => {
    expect(hasForbiddenInboundValueByte('a\tb')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `cd packages/core && bun test src/http/ascii-validation.test.ts`
Expected: FAIL — `hasForbiddenNameByte is not a function` (or similar).

- [ ] **Step 3: Add the two predicates to `ascii-validation.ts`**

Append to the existing file:

```typescript
export function hasForbiddenNameByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || code > 0x7e) return true;
  }
  return false;
}

export function hasForbiddenInboundValueByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f && code !== 0x09;
    const isDel = code === 0x7f;
    if (isControl || isDel) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run and confirm the predicate tests pass**

Run: `cd packages/core && bun test src/http/ascii-validation.test.ts`
Expected: PASS — `9 pass, 0 fail`.

- [ ] **Step 5: Write the failing tests for Headers validation**

Append to `packages/core/src/http/headers.test.ts`:

```typescript
// Exercises: HTTP-17 (outbound name validation + trim), HTTP-18 (outbound value validation),
// HTTP-19 (inbound leniency), HTTP-20 (no value echo, escaped name), HTTP-21/22 (typed HeaderName)
import {HeaderName} from './headers.js';

describe('outbound name validation (HTTP-17)', () => {
  test('rejects a blank name', () => {
    expect(() => Headers.newBuilder().add('', 'v')).toThrow();
  });

  test('rejects a name with CR/LF or NUL', () => {
    expect(() => Headers.newBuilder().add('a\r\nb', 'v')).toThrow();
    expect(() => Headers.newBuilder().add('a\0b', 'v')).toThrow();
  });

  test('rejects a non-ASCII name', () => {
    expect(() => Headers.newBuilder().add('héader', 'v')).toThrow();
  });

  test('trims surrounding whitespace and stores the trimmed form', () => {
    const headers = Headers.newBuilder().add('  X-Trace  ', 'v').build();
    expect(headers.names()).toEqual(['X-Trace']);
  });
});

describe('outbound value validation (HTTP-18)', () => {
  test('rejects CR/LF and NUL in a value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'a\r\nb')).toThrow();
    expect(() => Headers.newBuilder().add('X-Tag', 'a\0b')).toThrow();
  });

  test('rejects a non-ASCII value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'vålue')).toThrow();
  });

  test('accepts HTAB in a value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'a\tb')).not.toThrow();
  });
});

describe('inbound leniency (HTTP-19)', () => {
  test('permits a non-ASCII (obs-text) inbound value that outbound would reject', () => {
    const headers = Headers.newBuilder().addInbound('Content-Disposition', 'café').build();
    expect(headers.get('content-disposition')).toBe('café');
  });

  test('still rejects a control character in an inbound value', () => {
    expect(() => Headers.newBuilder().addInbound('X-Tag', 'a\r\nb')).toThrow();
  });

  test('inbound names remain strictly validated', () => {
    expect(() => Headers.newBuilder().addInbound('héader', 'v')).toThrow();
  });
});

describe('error messages never leak (HTTP-20)', () => {
  test('a rejected value never appears in the thrown message', () => {
    try {
      Headers.newBuilder().add('X-Tag', 'secret-value-abc\r\n');
      throw new Error('expected add() to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-value-abc');
    }
  });

  test('a rejected name with an embedded CR appears escaped, not raw', () => {
    try {
      Headers.newBuilder().add('a\rb', 'v');
      throw new Error('expected add() to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('\r');
      expect((e as Error).message).toContain('\\r');
    }
  });
});

describe('HeaderName (HTTP-21/22)', () => {
  test('compares by case-folded form while preserving original casing', () => {
    const a = HeaderName.of('Content-Type');
    const b = HeaderName.of('content-type');
    expect(a.equals(b)).toBe(true);
    expect(a.raw).toBe('Content-Type');
  });

  test('interns by lower-cased form, first casing wins', () => {
    const first = HeaderName.of('X-Trace');
    const second = HeaderName.of('x-trace');
    expect(second.raw).toBe('X-Trace');
  });

  test('enforces the same name validation as HTTP-17', () => {
    expect(() => HeaderName.of('a\r\nb')).toThrow();
  });
});
```

- [ ] **Step 6: Run and confirm the new tests fail**

Run: `cd packages/core && bun test src/http/headers.test.ts`
Expected: FAIL — validation isn't wired yet, so several `.toThrow()` assertions fail; `HeaderName` doesn't exist.

- [ ] **Step 7: Update `headers.ts`**

Add the import and replace `HeadersBuilder`'s `add`/`set`, adding `addInbound`/`setInbound` and the `HeaderName`
class:

```typescript
// add to the top of headers.ts, alongside the existing `Builder` import
import {HeaderValidationError} from './errors.js';
import {hasForbiddenNameByte, hasForbiddenOutboundByte, hasForbiddenInboundValueByte} from './ascii-validation.js';

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || hasForbiddenNameByte(trimmed)) {
    throw new HeaderValidationError('name', name, undefined);
  }
  return trimmed;
}

function validateOutboundValue(name: string, value: string): void {
  if (hasForbiddenOutboundByte(value)) {
    throw new HeaderValidationError('value', name, value);
  }
}

function validateInboundValue(name: string, value: string): void {
  if (hasForbiddenInboundValueByte(value)) {
    throw new HeaderValidationError('value', name, value);
  }
}
```

Replace the `HeadersBuilder.add` and `.set` methods (from Task 6) with these, and add the two inbound siblings:

```typescript
  add(name: string, value: string): this {
    const trimmedName = validateName(name);
    validateOutboundValue(trimmedName, value);
    return this.#append(trimmedName, value);
  }

  set(name: string, value: string | null): this {
    const trimmedName = validateName(name);
    if (value !== null) validateOutboundValue(trimmedName, value);
    return this.#replace(trimmedName, value);
  }

  addInbound(name: string, value: string): this {
    const trimmedName = validateName(name);
    validateInboundValue(trimmedName, value);
    return this.#append(trimmedName, value);
  }

  setInbound(name: string, value: string | null): this {
    const trimmedName = validateName(name);
    if (value !== null) validateInboundValue(trimmedName, value);
    return this.#replace(trimmedName, value);
  }

  #append(name: string, value: string): this {
    const lowerName = name.toLowerCase();
    if (!this.#valuesByLowerName.has(lowerName)) {
      this.#insertionOrder.push(lowerName);
      this.#originalCasingByLowerName.set(lowerName, name);
      this.#valuesByLowerName.set(lowerName, []);
    }
    this.#valuesByLowerName.get(lowerName)?.push(value);
    return this;
  }

  #replace(name: string, value: string | null): this {
    const lowerName = name.toLowerCase();
    if (value === null) {
      this.#valuesByLowerName.delete(lowerName);
      this.#originalCasingByLowerName.delete(lowerName);
      const index = this.#insertionOrder.indexOf(lowerName);
      if (index !== -1) this.#insertionOrder.splice(index, 1);
      return this;
    }
    if (!this.#valuesByLowerName.has(lowerName)) this.#insertionOrder.push(lowerName);
    this.#originalCasingByLowerName.set(lowerName, name);
    this.#valuesByLowerName.set(lowerName, [value]);
    return this;
  }
```

`#append`/`#replace` are the old `add`/`set` bodies from Task 6, renamed to private helpers and shared by both
the outbound and inbound public methods — the only difference between outbound and inbound is *which value
validator runs first*; the storage logic is identical, so it's factored out once rather than duplicated four
ways.

Append the `HeaderName` class at the end of the file:

```typescript
export class HeaderName {
  static readonly #interned = new Map<string, HeaderName>();

  readonly #raw: string;
  readonly #lower: string;

  private constructor(raw: string, lower: string) {
    this.#raw = raw;
    this.#lower = lower;
    Object.freeze(this);
  }

  static of(raw: string): HeaderName {
    const trimmed = validateName(raw);
    const lower = trimmed.toLowerCase();
    const existing = HeaderName.#interned.get(lower);
    if (existing !== undefined) return existing;
    const created = new HeaderName(trimmed, lower);
    HeaderName.#interned.set(lower, created);
    return created;
  }

  get raw(): string {
    return this.#raw;
  }

  get lowerCased(): string {
    return this.#lower;
  }

  equals(other: HeaderName): boolean {
    return this.#lower === other.#lower;
  }
}
```

- [ ] **Step 8: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/headers.test.ts src/http/ascii-validation.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/http/ascii-validation.ts packages/core/src/http/ascii-validation.test.ts \
        packages/core/src/http/headers.ts packages/core/src/http/headers.test.ts
git commit -m "feat(core): add Headers validation (outbound/inbound split) and typed HeaderName (HTTP-17..22)"
```

---

### Task 8: QueryParams

**Files:**
- Create: `packages/core/src/http/query-params.ts`
- Create: `packages/core/src/http/query-params.test.ts`

**Interfaces:**
- Consumes: `Builder<T>` (Task 1).
- Produces: `class QueryParams` with `static newBuilder(): QueryParamsBuilder`, `newBuilder(): QueryParamsBuilder`,
  `get(name): string | undefined`, `getAll(name): ReadonlyArray<string>`, `has(name): boolean`, `encode():
  string`, `static parse(raw: string | null | undefined): QueryParams`, `equals(other: QueryParams): boolean`.
  `class QueryParamsBuilder implements Builder<QueryParams>` with `add(name: string, value: string | null): this`.
  Task 9 (`Request`) consumes `QueryParams`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/query-params.test.ts
// Exercises: HTTP-28 (case-sensitive, multi-value, value-less param), HTTP-29/32 (RFC 3986 encoding),
// HTTP-30 (order-sensitive equality, empty-list dropped), HTTP-31 (lenient parse)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {QueryParams} from './query-params.js';

describe('case-sensitive names and multi-value (HTTP-28)', () => {
  test('page and Page are distinct names', () => {
    const params = QueryParams.newBuilder().add('page', '1').add('Page', '2').build();
    expect(params.get('page')).toBe('1');
    expect(params.get('Page')).toBe('2');
  });

  test('a value-less parameter models as a single empty-string value', () => {
    const params = QueryParams.newBuilder().add('flag', null).build();
    expect(params.get('flag')).toBe('');
    expect(params.has('flag')).toBe(true);
  });

  test('an absent name returns undefined from get, false from has', () => {
    const params = QueryParams.newBuilder().build();
    expect(params.get('missing')).toBeUndefined();
    expect(params.has('missing')).toBe(false);
  });
});

describe('RFC 3986 encoding (HTTP-29/32)', () => {
  test('space encodes as %20, never +; literal + encodes as %2B', () => {
    const params = QueryParams.newBuilder().add('q', 'a b').add('plus', 'c+d').build();
    expect(params.encode()).toBe('q=a%20b&plus=c%2Bd');
  });

  test('reserved characters / and * are percent-encoded', () => {
    const params = QueryParams.newBuilder().add('path', 'a/b').add('star', 'a*b').build();
    expect(params.encode()).toBe('path=a%2Fb&star=a%2Ab');
  });

  test('is empty when there are no params', () => {
    expect(QueryParams.newBuilder().build().encode()).toBe('');
  });
});

describe('order-sensitive equality (HTTP-30)', () => {
  test('two instances are equal iff they encode identically', () => {
    const a = QueryParams.newBuilder().add('x', '1').add('y', '2').build();
    const b = QueryParams.newBuilder().add('x', '1').add('y', '2').build();
    const reordered = QueryParams.newBuilder().add('y', '2').add('x', '1').build();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(reordered)).toBe(false);
  });
});

describe('lenient parsing (HTTP-31)', () => {
  test('null/blank query parses to empty', () => {
    expect(QueryParams.parse(null).encode()).toBe('');
    expect(QueryParams.parse('').encode()).toBe('');
    expect(QueryParams.parse('   ').encode()).toBe('');
  });

  test('tolerates a leading ?', () => {
    expect(QueryParams.parse('?a=1').get('a')).toBe('1');
  });

  test('a segment with no = or a trailing = yields an empty-string value', () => {
    expect(QueryParams.parse('flag').get('flag')).toBe('');
    expect(QueryParams.parse('flag=').get('flag')).toBe('');
  });

  test('a stray & is skipped rather than producing a phantom entry', () => {
    const params = QueryParams.parse('a=1&&b=2');
    expect(params.getAll('')).toEqual([]);
    expect(params.get('a')).toBe('1');
    expect(params.get('b')).toBe('2');
  });

  test('malformed percent-encoding falls back to raw text instead of throwing', () => {
    expect(() => QueryParams.parse('a=%zz')).not.toThrow();
    expect(QueryParams.parse('a=%zz').get('a')).toBe('%zz');
  });
});

describe('parse(x.encode()) round-trip (HTTP-29/31 as inverses)', () => {
  test('holds for arbitrary generated name/value pairs', () => {
    fc.assert(
      fc.property(fc.string({minLength: 1, maxLength: 15}), fc.string({maxLength: 15}), (name, value) => {
        const original = QueryParams.newBuilder().add(name, value).build();
        const restored = QueryParams.parse(original.encode());
        expect(restored.equals(original)).toBe(true);
      }),
    );
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/query-params.test.ts`
Expected: FAIL — `Cannot find module './query-params.js'`.

- [ ] **Step 3: Write `query-params.ts`**

```typescript
// packages/core/src/http/query-params.ts
import type {Builder} from './builder.js';

function percentEncodeComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class QueryParams {
  readonly #valuesByName: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly #insertionOrder: ReadonlyArray<string>;

  constructor(valuesByName: ReadonlyMap<string, ReadonlyArray<string>>, insertionOrder: ReadonlyArray<string>) {
    this.#valuesByName = valuesByName;
    this.#insertionOrder = insertionOrder;
    Object.freeze(this);
  }

  static newBuilder(): QueryParamsBuilder {
    return new QueryParamsBuilder();
  }

  newBuilder(): QueryParamsBuilder {
    const builder = new QueryParamsBuilder();
    for (const name of this.#insertionOrder) {
      for (const value of this.#valuesByName.get(name) ?? []) builder.add(name, value);
    }
    return builder;
  }

  static parse(raw: string | null | undefined): QueryParams {
    const builder = new QueryParamsBuilder();
    if (raw === null || raw === undefined || raw.trim() === '') return builder.build();

    const withoutLeadingMark = raw.startsWith('?') ? raw.slice(1) : raw;
    for (const segment of withoutLeadingMark.split('&')) {
      if (segment === '') continue;
      const eqIndex = segment.indexOf('=');
      const rawName = eqIndex === -1 ? segment : segment.slice(0, eqIndex);
      const rawValue = eqIndex === -1 ? '' : segment.slice(eqIndex + 1);
      builder.add(safeDecodeComponent(rawName), safeDecodeComponent(rawValue));
    }
    return builder.build();
  }

  get(name: string): string | undefined {
    return this.#valuesByName.get(name)?.[0];
  }

  getAll(name: string): ReadonlyArray<string> {
    return this.#valuesByName.get(name) ?? [];
  }

  has(name: string): boolean {
    return this.#valuesByName.has(name);
  }

  encode(): string {
    const parts: string[] = [];
    for (const name of this.#insertionOrder) {
      const encodedName = percentEncodeComponent(name);
      for (const value of this.#valuesByName.get(name) ?? []) {
        parts.push(`${encodedName}=${percentEncodeComponent(value)}`);
      }
    }
    return parts.join('&');
  }

  equals(other: QueryParams): boolean {
    return this.encode() === other.encode();
  }
}

export class QueryParamsBuilder implements Builder<QueryParams> {
  readonly #valuesByName = new Map<string, string[]>();
  readonly #insertionOrder: string[] = [];

  add(name: string, value: string | null): this {
    const actualValue = value ?? '';
    if (!this.#valuesByName.has(name)) {
      this.#insertionOrder.push(name);
      this.#valuesByName.set(name, []);
    }
    this.#valuesByName.get(name)?.push(actualValue);
    return this;
  }

  build(): QueryParams {
    const valuesByName = new Map<string, ReadonlyArray<string>>();
    const insertionOrder: string[] = [];
    for (const name of this.#insertionOrder) {
      const values = this.#valuesByName.get(name) ?? [];
      if (values.length === 0) continue; // HTTP-30: an empty value list is dropped at build time
      valuesByName.set(name, Object.freeze([...values]));
      insertionOrder.push(name);
    }
    return new QueryParams(Object.freeze(valuesByName), Object.freeze(insertionOrder));
  }
}
```

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/query-params.test.ts`
Expected: PASS — `13 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/query-params.ts packages/core/src/http/query-params.test.ts
git commit -m "feat(core): add QueryParams (HTTP-28..32)"
```

---

### Task 9: Request, RequestBuilder, and URL equality

**Files:**
- Modify: `packages/core/src/http/errors.ts` (add `RequestBodyNotAllowedError`)
- Modify: `packages/core/src/http/errors.test.ts` (add its test)
- Create: `packages/core/src/http/request.ts`
- Create: `packages/core/src/http/request.test.ts`

**Interfaces:**
- Consumes: `Builder`/`requireField` (Task 1), `Method`/`isBodyForbidden` (Task 2), `Headers` (Task 6/7),
  `UrlConstructionError`/`RequiredFieldError`/`RequestBodyNotAllowedError` (Task 1, this task).
- Produces: `class Request` with `static newBuilder(): RequestBuilder`, `newBuilder(): RequestBuilder`, `get
  method/url/headers/body()`, `equals(other: Request): boolean`. Request's `body` is typed `unknown` — the real
  body lifecycle (streams, replayability) is Phase 3's I/O-contracts work; this phase only needs "present or
  absent" to satisfy HTTP-7/8, not a wire representation. Task 10 (`Response`) consumes `Request` (a response
  carries its originating request).

- [ ] **Step 1: Write the failing test for the new error**

Append to `packages/core/src/http/errors.test.ts`:

```typescript
import {RequestBodyNotAllowedError} from './errors.js';

describe('RequestBodyNotAllowedError', () => {
  test('names the offending method', () => {
    const error = new RequestBodyNotAllowedError('GET');
    expect(error.message).toContain('GET');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/errors.test.ts`
Expected: FAIL — `RequestBodyNotAllowedError is not a constructor` (or similar).

- [ ] **Step 3: Add the error class to `errors.ts`**

```typescript
export class RequestBodyNotAllowedError extends DomainModelError {
  constructor(method: string) {
    super(`method ${method} does not allow a request body`);
  }
}
```

- [ ] **Step 4: Run and confirm the error test passes**

Run: `cd packages/core && bun test src/http/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for Request**

```typescript
// packages/core/src/http/request.test.ts
// Exercises: HTTP-6 (required fields), HTTP-7 (body/method legality), HTTP-8 (GET default / missing method),
// HTTP-9 (method), HTTP-46 (textual URL equality, no DNS), HTTP-47 (malformed URL), HTTP-3/5 (derivation,
// immutability)
import {describe, expect, test} from 'bun:test';
import {Request} from './request.js';
import {Headers} from './headers.js';
import {RequiredFieldError, UrlConstructionError, RequestBodyNotAllowedError} from './errors.js';

describe('required fields (HTTP-6, HTTP-4)', () => {
  test('build() throws naming url when no URL is set', () => {
    expect(() => Request.newBuilder().method('GET').build()).toThrow(RequiredFieldError);
    expect(() => Request.newBuilder().method('GET').build()).toThrow('url is required');
  });
});

describe('method/body legality (HTTP-7)', () => {
  test('rejects a body on GET, HEAD, TRACE, CONNECT', () => {
    for (const method of ['GET', 'HEAD', 'TRACE', 'CONNECT'] as const) {
      expect(() => Request.newBuilder().method(method).url('https://example.com').body('x').build())
        .toThrow(RequestBodyNotAllowedError);
    }
  });

  test('accepts a body on POST/PUT/DELETE/PATCH/OPTIONS', () => {
    expect(() => Request.newBuilder().method('POST').url('https://example.com').body('x').build()).not.toThrow();
  });

  test('clearing the body succeeds even on a body-forbidden method', () => {
    const request = Request.newBuilder().method('GET').url('https://example.com').body('x').body(undefined).build();
    expect(request.body).toBeUndefined();
  });
});

describe('method defaulting (HTTP-8)', () => {
  test('defaults to GET when neither method nor body is set', () => {
    const request = Request.newBuilder().url('https://example.com').build();
    expect(request.method).toBe('GET');
  });

  test('fails naming the missing method when a body is set with no method', () => {
    expect(() => Request.newBuilder().url('https://example.com').body('x').build())
      .toThrow('method is required');
  });
});

describe('URL equality (HTTP-46)', () => {
  test('two requests to the same textual URL are equal', () => {
    const a = Request.newBuilder().url('https://example.com/a').build();
    const b = Request.newBuilder().url('https://example.com/a').build();
    expect(a.equals(b)).toBe(true);
  });

  test('textually different URLs are not equal, with no network access', () => {
    const a = Request.newBuilder().url('https://example.com/a').build();
    const b = Request.newBuilder().url('https://example.com/b').build();
    expect(a.equals(b)).toBe(false);
  });
});

describe('malformed URL (HTTP-47)', () => {
  test('throws UrlConstructionError naming the offending input', () => {
    expect(() => Request.newBuilder().url('::bad').build()).toThrow(UrlConstructionError);
    expect(() => Request.newBuilder().url('relative/path').build()).toThrow(UrlConstructionError);
  });
});

describe('newBuilder derivation and immutability (HTTP-3/5)', () => {
  test('the returned URL cannot be used to mutate the request', () => {
    const request = Request.newBuilder().url('https://example.com/a').build();
    request.url.pathname = '/hacked';
    expect(request.url.pathname).toBe('/a');
  });

  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = Request.newBuilder().url('https://example.com/a').build();
    original.newBuilder().url('https://example.com/b').build();
    expect(original.url.href).toBe('https://example.com/a');
  });
});
```

- [ ] **Step 6: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/request.test.ts`
Expected: FAIL — `Cannot find module './request.js'`.

- [ ] **Step 7: Write `request.ts`**

```typescript
// packages/core/src/http/request.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import {UrlConstructionError, RequestBodyNotAllowedError} from './errors.js';
import {type Method, isBodyForbidden} from './method.js';
import {Headers} from './headers.js';

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch (e: unknown) {
    throw new UrlConstructionError(`malformed or non-absolute URL: ${raw}`, {cause: e});
  }
}

export class Request {
  readonly #method: Method;
  readonly #url: URL;
  readonly #headers: Headers;
  readonly #body: unknown;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  constructor(method: Method, url: URL, headers: Headers, body: unknown) {
    this.#method = method;
    this.#url = url;
    this.#headers = headers;
    this.#body = body;
    Object.freeze(this);
  }

  static newBuilder(): RequestBuilder {
    return new RequestBuilder();
  }

  newBuilder(): RequestBuilder {
    return new RequestBuilder().method(this.#method).url(this.#url).headers(this.#headers).body(this.#body);
  }

  get method(): Method {
    return this.#method;
  }

  // returns a fresh URL every call — the native URL class is mutable, so returning #url directly
  // would let a caller mutate this "immutable" request through it (HTTP-5).
  get url(): URL {
    return new URL(this.#url.href);
  }

  get headers(): Headers {
    return this.#headers;
  }

  get body(): unknown {
    return this.#body;
  }

  equals(other: Request): boolean {
    return (
      this.#method === other.#method &&
      this.#url.href === other.#url.href && // textual external form only — no DNS resolution (HTTP-46)
      this.#headers.equals(other.#headers) &&
      this.#body === other.#body
    );
  }
}

export class RequestBuilder implements Builder<Request> {
  #method: Method | undefined;
  #url: URL | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: unknown;

  method(method: Method): this {
    this.#method = method;
    return this;
  }

  url(url: string | URL): this {
    this.#url = url instanceof URL ? new URL(url.href) : parseUrl(url);
    return this;
  }

  headers(headers: Headers): this {
    this.#headers = headers;
    return this;
  }

  body(body: unknown): this {
    this.#body = body;
    return this;
  }

  build(): Request {
    const url = requireField(this.#url, 'url');

    if (this.#method === undefined) {
      if (this.#body !== undefined) requireField(undefined, 'method');
      return new Request('GET', url, this.#headers, this.#body);
    }

    if (this.#body !== undefined && isBodyForbidden(this.#method)) {
      throw new RequestBodyNotAllowedError(this.#method);
    }

    return new Request(this.#method, url, this.#headers, this.#body);
  }
}
```

`requireField(undefined, 'method')` in the no-method-but-has-body branch reuses the same shared helper from Task
1 rather than a bespoke throw — it always throws for an `undefined` input, so this line exists purely to get
`RequiredFieldError`'s exact `` `${name} is required` `` message without duplicating it.

- [ ] **Step 8: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/request.test.ts`
Expected: PASS — `12 pass, 0 fail`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/http/errors.ts packages/core/src/http/errors.test.ts \
        packages/core/src/http/request.ts packages/core/src/http/request.test.ts
git commit -m "feat(core): add Request, RequestBuilder, and URL equality (HTTP-6..9, HTTP-46/47)"
```

---

### Task 10: Response

**Files:**
- Create: `packages/core/src/http/response.ts`
- Create: `packages/core/src/http/response.test.ts`

**Interfaces:**
- Consumes: `Builder`/`requireField` (Task 1), `Status` (Task 3), `Protocol` (Task 4), `Headers` (Task 6/7),
  `Request` (Task 9).
- Produces: `class Response` with `static newBuilder(): ResponseBuilder`, `newBuilder(): ResponseBuilder`, `get
  request/protocol/status/reasonPhrase/headers/body()`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/response.test.ts
// Exercises: HTTP-6 (response's required fields: request, protocol, status)
import {describe, expect, test} from 'bun:test';
import {Response} from './response.js';
import {Request} from './request.js';
import {Protocol} from './protocol.js';
import {Status} from './status.js';
import {RequiredFieldError} from './errors.js';

function baseRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

describe('required fields', () => {
  test('throws naming request when missing', () => {
    expect(() => Response.newBuilder().protocol(Protocol.HTTP_1_1).status(Status.of(200)).build())
      .toThrow('request is required');
  });

  test('throws naming protocol when missing', () => {
    expect(() => Response.newBuilder().request(baseRequest()).status(Status.of(200)).build())
      .toThrow('protocol is required');
  });

  test('throws naming status when missing', () => {
    expect(() => Response.newBuilder().request(baseRequest()).protocol(Protocol.HTTP_1_1).build())
      .toThrow('status is required');
  });
});

describe('construction', () => {
  test('carries the originating request, protocol, status, headers, and an optional reason phrase/body', () => {
    const request = baseRequest();
    const response = Response.newBuilder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .reasonPhrase('OK')
      .body('payload')
      .build();

    expect(response.request.equals(request)).toBe(true);
    expect(response.protocol.equals(Protocol.HTTP_1_1)).toBe(true);
    expect(response.status.equals(Status.of(200))).toBe(true);
    expect(response.reasonPhrase).toBe('OK');
    expect(response.body).toBe('payload');
  });

  test('reason phrase and body are optional', () => {
    const response = Response.newBuilder().request(baseRequest()).protocol(Protocol.HTTP_1_1).status(Status.of(204)).build();
    expect(response.reasonPhrase).toBeUndefined();
    expect(response.body).toBeUndefined();
  });
});

describe('newBuilder derivation', () => {
  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = Response.newBuilder().request(baseRequest()).protocol(Protocol.HTTP_1_1).status(Status.of(200)).build();
    original.newBuilder().status(Status.of(500)).build();
    expect(original.status.code).toBe(200);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/response.test.ts`
Expected: FAIL — `Cannot find module './response.js'`.

- [ ] **Step 3: Write `response.ts`**

```typescript
// packages/core/src/http/response.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import type {Request} from './request.js';
import type {Protocol} from './protocol.js';
import type {Status} from './status.js';
import {Headers} from './headers.js';

export class Response {
  readonly #request: Request;
  readonly #protocol: Protocol;
  readonly #status: Status;
  readonly #reasonPhrase: string | undefined;
  readonly #headers: Headers;
  readonly #body: unknown;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  constructor(
    request: Request,
    protocol: Protocol,
    status: Status,
    reasonPhrase: string | undefined,
    headers: Headers,
    body: unknown,
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

  get body(): unknown {
    return this.#body;
  }
}

export class ResponseBuilder implements Builder<Response> {
  #request: Request | undefined;
  #protocol: Protocol | undefined;
  #status: Status | undefined;
  #reasonPhrase: string | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: unknown;

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

  body(body: unknown): this {
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

`Request` is safe to store and return by reference here (unlike the native `URL` in Task 9) — `Request` is
already `Object.freeze`d and its own `url` getter defensively clones, so nothing reachable from a `Request`
instance can mutate it.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/response.test.ts`
Expected: PASS — `7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/response.ts packages/core/src/http/response.test.ts
git commit -m "feat(core): add Response and ResponseBuilder (HTTP-6)"
```

---

### Task 11: RequestOptions

**Files:**
- Create: `packages/core/src/http/request-options.ts`
- Create: `packages/core/src/http/request-options.test.ts`

**Interfaces:**
- Consumes: `Builder` (Task 1), `RequestOptionsValidationError` (Task 1).
- Produces: `class RequestOptions` with static `RequestOptions.EMPTY`, `static newBuilder():
  RequestOptionsBuilder`, `newBuilder(): RequestOptionsBuilder`, `get timeoutMs/maxRetries(): number |
  undefined`, `tag(key: string): string | undefined`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/request-options.test.ts
// Exercises: HTTP-34 (EMPTY sentinel, defensive tag copy), HTTP-35 (timeout/maxRetries validation)
import {describe, expect, test} from 'bun:test';
import {RequestOptions} from './request-options.js';
import {RequestOptionsValidationError} from './errors.js';

describe('RequestOptions.EMPTY', () => {
  test('has null timeout, null max-retries, empty tags', () => {
    expect(RequestOptions.EMPTY.timeoutMs).toBeUndefined();
    expect(RequestOptions.EMPTY.maxRetries).toBeUndefined();
    expect(RequestOptions.EMPTY.tag('anything')).toBeUndefined();
  });
});

describe('timeout validation (HTTP-35)', () => {
  test('rejects zero or negative timeout', () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(0)).toThrow(RequestOptionsValidationError);
    expect(() => RequestOptions.newBuilder().timeoutMs(-1)).toThrow(RequestOptionsValidationError);
  });

  test('accepts a null (undefined) timeout — no override', () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(undefined).build()).not.toThrow();
  });

  test('accepts a positive timeout', () => {
    expect(RequestOptions.newBuilder().timeoutMs(5000).build().timeoutMs).toBe(5000);
  });
});

describe('maxRetries validation (HTTP-35)', () => {
  test('rejects a negative maxRetries', () => {
    expect(() => RequestOptions.newBuilder().maxRetries(-1)).toThrow(RequestOptionsValidationError);
  });

  test('accepts 0, meaning "disable retries for this call"', () => {
    expect(RequestOptions.newBuilder().maxRetries(0).build().maxRetries).toBe(0);
  });
});

describe('tags are defensively copied at build (HTTP-34)', () => {
  test('a built options is unaffected by later mutation of the source map', () => {
    const source = new Map([['env', 'prod']]);
    const options = RequestOptions.newBuilder().tags(source).build();
    source.set('env', 'mutated');
    expect(options.tag('env')).toBe('prod');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/request-options.test.ts`
Expected: FAIL — `Cannot find module './request-options.js'`.

- [ ] **Step 3: Write `request-options.ts`**

```typescript
// packages/core/src/http/request-options.ts
import type {Builder} from './builder.js';
import {RequestOptionsValidationError} from './errors.js';

export class RequestOptions {
  readonly #timeoutMs: number | undefined;
  readonly #maxRetries: number | undefined;
  readonly #tags: ReadonlyMap<string, string>;

  constructor(timeoutMs: number | undefined, maxRetries: number | undefined, tags: ReadonlyMap<string, string>) {
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = maxRetries;
    this.#tags = tags;
    Object.freeze(this);
  }

  static readonly EMPTY = new RequestOptions(undefined, undefined, Object.freeze(new Map()));

  static newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder();
  }

  newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder().timeoutMs(this.#timeoutMs).maxRetries(this.#maxRetries).tags(this.#tags);
  }

  get timeoutMs(): number | undefined {
    return this.#timeoutMs;
  }

  get maxRetries(): number | undefined {
    return this.#maxRetries;
  }

  tag(key: string): string | undefined {
    return this.#tags.get(key);
  }
}

export class RequestOptionsBuilder implements Builder<RequestOptions> {
  #timeoutMs: number | undefined;
  #maxRetries: number | undefined;
  readonly #tags = new Map<string, string>();

  timeoutMs(value: number | undefined): this {
    if (value !== undefined && value <= 0) {
      throw new RequestOptionsValidationError(`timeout must be positive, got ${value}`);
    }
    this.#timeoutMs = value;
    return this;
  }

  maxRetries(value: number | undefined): this {
    if (value !== undefined && value < 0) {
      throw new RequestOptionsValidationError(`maxRetries must not be negative, got ${value}`);
    }
    this.#maxRetries = value;
    return this;
  }

  tags(entries: ReadonlyMap<string, string>): this {
    for (const [key, value] of entries) this.#tags.set(key, value);
    return this;
  }

  build(): RequestOptions {
    return new RequestOptions(this.#timeoutMs, this.#maxRetries, Object.freeze(new Map(this.#tags)));
  }
}
```

Zero and `undefined` are deliberately different states in `maxRetries`: `undefined` means "use the default,"
`0` means "disable retries for this call" — the validation only rejects negative values, so `0` passes through
untouched. Same shape of distinction the `timeoutMs` guard makes for `null`/`undefined` vs. an actual zero.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/request-options.test.ts`
Expected: PASS — `9 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/request-options.ts packages/core/src/http/request-options.test.ts
git commit -m "feat(core): add RequestOptions (HTTP-34/35)"
```

---

### Task 12: ETag

**Files:**
- Create: `packages/core/src/http/etag.ts`
- Create: `packages/core/src/http/etag.test.ts`

**Interfaces:**
- Consumes: `EtagParseError` (Task 1).
- Produces: `class ETag` with `static ANY`, `static parse(raw: string): ETag | undefined`, `get isWeak/isAny():
  boolean`, `get opaque(): string | undefined`, `get raw(): string`. Task 14 (`RequestConditions`) consumes
  `ETag`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/etag.test.ts
// Exercises: HTTP-48 (strong/weak/any forms, etagc validation, round-trip, absent-for-blank)
import {describe, expect, test} from 'bun:test';
import {ETag} from './etag.js';
import {EtagParseError} from './errors.js';

describe('ETag.parse', () => {
  test('parses a strong ETag', () => {
    const etag = ETag.parse('"abc123"');
    expect(etag?.isWeak).toBe(false);
    expect(etag?.opaque).toBe('abc123');
  });

  test('parses a weak ETag', () => {
    const etag = ETag.parse('W/"abc123"');
    expect(etag?.isWeak).toBe(true);
    expect(etag?.opaque).toBe('abc123');
  });

  test('parses the any singleton', () => {
    const etag = ETag.parse('*');
    expect(etag?.isAny).toBe(true);
  });

  test('rejects a literal quote, control chars, or DEL inside the opaque tag', () => {
    expect(() => ETag.parse('"a"b"')).toThrow(EtagParseError);
    expect(() => ETag.parse('"a\r\nb"')).toThrow(EtagParseError);
  });

  test('permits obs-text inside the opaque tag', () => {
    expect(() => ETag.parse('"café"')).not.toThrow();
  });

  test('rejects an empty strong opaque tag', () => {
    expect(() => ETag.parse('""')).toThrow(EtagParseError);
  });

  test('permits an empty weak opaque tag', () => {
    expect(() => ETag.parse('W/""')).not.toThrow();
  });

  test('round-trips its raw form', () => {
    expect(ETag.parse('"abc123"')?.raw).toBe('"abc123"');
  });

  test('rejects an unterminated form', () => {
    expect(() => ETag.parse('"abc123')).toThrow(EtagParseError);
  });

  test('returns absent, not an error, for blank input', () => {
    expect(ETag.parse('')).toBeUndefined();
    expect(ETag.parse('   ')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/etag.test.ts`
Expected: FAIL — `Cannot find module './etag.js'`.

- [ ] **Step 3: Write `etag.ts`**

```typescript
// packages/core/src/http/etag.ts
import {EtagParseError} from './errors.js';

function hasForbiddenEtagcByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const allowed = code === 0x21 || (code >= 0x23 && code <= 0x7e) || code >= 0x80;
    if (!allowed) return true;
  }
  return false;
}

export class ETag {
  readonly #raw: string;
  readonly #opaque: string | undefined;
  readonly #weak: boolean;
  readonly #any: boolean;

  // eslint-disable-next-line max-params -- private, factory-internal; the four ETag facets are a fixed shape (HTTP-48)
  private constructor(raw: string, opaque: string | undefined, weak: boolean, any: boolean) {
    this.#raw = raw;
    this.#opaque = opaque;
    this.#weak = weak;
    this.#any = any;
    Object.freeze(this);
  }

  static readonly ANY = new ETag('*', undefined, false, true);

  static parse(raw: string): ETag | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    if (trimmed === '*') return ETag.ANY;

    const weak = trimmed.startsWith('W/');
    const quotedPart = weak ? trimmed.slice(2) : trimmed;
    if (quotedPart.length < 2 || !quotedPart.startsWith('"') || !quotedPart.endsWith('"')) {
      throw new EtagParseError(`unterminated or malformed ETag: ${raw}`);
    }

    const opaque = quotedPart.slice(1, -1);
    if (!weak && opaque === '') throw new EtagParseError('a strong ETag opaque tag must not be empty');
    if (hasForbiddenEtagcByte(opaque)) {
      throw new EtagParseError('ETag opaque tag contains a forbidden character');
    }
    return new ETag(trimmed, opaque, weak, false);
  }

  get isWeak(): boolean {
    return this.#weak;
  }

  get isAny(): boolean {
    return this.#any;
  }

  get opaque(): string | undefined {
    return this.#opaque;
  }

  get raw(): string {
    return this.#raw;
  }
}
```

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/etag.test.ts`
Expected: PASS — `10 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/etag.ts packages/core/src/http/etag.test.ts
git commit -m "feat(core): add ETag helper (HTTP-48)"
```

---

### Task 13: HttpRange

**Files:**
- Create: `packages/core/src/http/http-range.ts`
- Create: `packages/core/src/http/http-range.test.ts`

**Interfaces:**
- Consumes: `HttpRangeValidationError` (Task 1).
- Produces: `class HttpRange` with `static bounded(start: number, length: number): HttpRange`, `static suffix(
  suffixLength: number): HttpRange`, `static open(start: number): HttpRange`, `static parse(raw: string):
  HttpRange`, `get kind(): 'bounded' | 'suffix' | 'open'`, `get start/length/suffixLength(): number | undefined`,
  `get raw(): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/http-range.test.ts
// Exercises: HTTP-49 (bounded/suffix/open factories, bytes-only, single-range, verbatim storage)
import {describe, expect, test} from 'bun:test';
import {HttpRange} from './http-range.js';
import {HttpRangeValidationError} from './errors.js';

describe('bounded()', () => {
  test('rejects a negative offset', () => {
    expect(() => HttpRange.bounded(-1, 10)).toThrow(HttpRangeValidationError);
  });

  test('rejects a non-positive length', () => {
    expect(() => HttpRange.bounded(0, 0)).toThrow(HttpRangeValidationError);
    expect(() => HttpRange.bounded(0, -5)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid bounded range', () => {
    const range = HttpRange.bounded(0, 500);
    expect(range.kind).toBe('bounded');
    expect(range.start).toBe(0);
    expect(range.length).toBe(500);
  });
});

describe('suffix()', () => {
  test('rejects a non-positive suffix length', () => {
    expect(() => HttpRange.suffix(0)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid suffix range', () => {
    const range = HttpRange.suffix(500);
    expect(range.kind).toBe('suffix');
    expect(range.suffixLength).toBe(500);
  });
});

describe('open()', () => {
  test('rejects a negative start', () => {
    expect(() => HttpRange.open(-1)).toThrow(HttpRangeValidationError);
  });

  test('constructs a valid open-ended range', () => {
    const range = HttpRange.open(9500);
    expect(range.kind).toBe('open');
    expect(range.start).toBe(9500);
  });
});

describe('parse()', () => {
  test('parses a bounded range and stores the raw text verbatim', () => {
    const range = HttpRange.parse('bytes=0-499');
    expect(range.kind).toBe('bounded');
    expect(range.start).toBe(0);
    expect(range.length).toBe(500);
    expect(range.raw).toBe('bytes=0-499');
  });

  test('parses a suffix range', () => {
    const range = HttpRange.parse('bytes=-500');
    expect(range.kind).toBe('suffix');
    expect(range.suffixLength).toBe(500);
  });

  test('parses an open-ended range', () => {
    const range = HttpRange.parse('bytes=9500-');
    expect(range.kind).toBe('open');
    expect(range.start).toBe(9500);
  });

  test('supports only the bytes unit', () => {
    expect(() => HttpRange.parse('items=0-4')).toThrow(HttpRangeValidationError);
  });

  test('rejects a multi-range comma', () => {
    expect(() => HttpRange.parse('bytes=0-499,600-999')).toThrow(HttpRangeValidationError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/http-range.test.ts`
Expected: FAIL — `Cannot find module './http-range.js'`.

- [ ] **Step 3: Write `http-range.ts`**

```typescript
// packages/core/src/http/http-range.ts
import {HttpRangeValidationError} from './errors.js';

type RangeKind = 'bounded' | 'suffix' | 'open';

function validateNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new HttpRangeValidationError(`${label} must not be negative, got ${value}`);
  }
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new HttpRangeValidationError(`${label} must be positive, got ${value}`);
  }
}

export class HttpRange {
  readonly #kind: RangeKind;
  readonly #start: number | undefined;
  readonly #length: number | undefined;
  readonly #suffixLength: number | undefined;
  readonly #raw: string;

  // eslint-disable-next-line max-params -- private, factory-internal; range facets are a fixed shape (HTTP-49)
  private constructor(
    kind: RangeKind,
    start: number | undefined,
    length: number | undefined,
    suffixLength: number | undefined,
    raw: string,
  ) {
    this.#kind = kind;
    this.#start = start;
    this.#length = length;
    this.#suffixLength = suffixLength;
    this.#raw = raw;
    Object.freeze(this);
  }

  static bounded(start: number, length: number): HttpRange {
    validateNonNegative(start, 'range start');
    validatePositive(length, 'range length');
    const end = start + length - 1;
    if (!Number.isSafeInteger(end)) throw new HttpRangeValidationError(`range overflows: ${start}-${end}`);
    return new HttpRange('bounded', start, length, undefined, `bytes=${start}-${end}`);
  }

  static suffix(suffixLength: number): HttpRange {
    validatePositive(suffixLength, 'suffix length');
    return new HttpRange('suffix', undefined, undefined, suffixLength, `bytes=-${suffixLength}`);
  }

  static open(start: number): HttpRange {
    validateNonNegative(start, 'range start');
    return new HttpRange('open', start, undefined, undefined, `bytes=${start}-`);
  }

  static parse(raw: string): HttpRange {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('bytes=')) {
      throw new HttpRangeValidationError(`only the bytes unit is supported: ${raw}`);
    }

    const spec = trimmed.slice('bytes='.length);
    if (spec.includes(',')) throw new HttpRangeValidationError(`multi-range is not supported: ${raw}`);

    const dashIndex = spec.indexOf('-');
    if (dashIndex === -1) throw new HttpRangeValidationError(`malformed range: ${raw}`);

    const startPart = spec.slice(0, dashIndex);
    const endPart = spec.slice(dashIndex + 1);

    if (startPart === '') {
      const suffixLength = Number(endPart);
      validatePositive(suffixLength, 'suffix length');
      return new HttpRange('suffix', undefined, undefined, suffixLength, trimmed);
    }

    const start = Number(startPart);
    validateNonNegative(start, 'range start');
    if (endPart === '') return new HttpRange('open', start, undefined, undefined, trimmed);

    const end = Number(endPart);
    const length = end - start + 1;
    validatePositive(length, 'range length');
    return new HttpRange('bounded', start, length, undefined, trimmed);
  }

  get kind(): RangeKind {
    return this.#kind;
  }

  get start(): number | undefined {
    return this.#start;
  }

  get length(): number | undefined {
    return this.#length;
  }

  get suffixLength(): number | undefined {
    return this.#suffixLength;
  }

  get raw(): string {
    return this.#raw;
  }
}
```

`raw` stores the *parsed* input verbatim (HTTP-49) — `parse()` keeps the original `trimmed` text as-is, while
the three direct factories (`bounded`/`suffix`/`open`, which have no original wire text to preserve) synthesize
a canonical one instead. That's a deliberate asymmetry, not an inconsistency.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/http-range.test.ts`
Expected: PASS — `12 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/http-range.ts packages/core/src/http/http-range.test.ts
git commit -m "feat(core): add HttpRange helper (HTTP-49)"
```

---

### Task 14: RequestConditions aggregator

**Files:**
- Create: `packages/core/src/http/request-conditions.ts`
- Create: `packages/core/src/http/request-conditions.test.ts`

**Interfaces:**
- Consumes: `Builder`/`RequestConditionsValidationError` (Task 1), `ETag` (Task 12), `Headers` (Task 6/7).
- Produces: `class RequestConditions` with `static newBuilder(): RequestConditionsBuilder`, `applyTo(headers:
  Headers): Headers`. `class RequestConditionsBuilder implements Builder<RequestConditions>` with `ifMatch(etag:
  ETag): this`, `ifNoneMatch(etag: ETag): this`, `ifModifiedSince(date: Date): this`,
  `ifUnmodifiedSince(date: Date): this`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/http/request-conditions.test.ts
// Exercises: HTTP-50 (comma-joined If-Match/If-None-Match, RFC 1123 dates, idempotent apply, any-tag exclusivity)
import {describe, expect, test} from 'bun:test';
import {RequestConditions, RequestConditionsBuilder} from './request-conditions.js';
import {ETag} from './etag.js';
import {Headers} from './headers.js';
import {RequestConditionsValidationError} from './errors.js';

// `ETag.parse` returns `ETag | undefined` (undefined only for blank input, per HTTP-48). These tests always pass
// a concrete tag, so this helper narrows without a non-null assertion — `no-non-null-assertion` is on at error
// under strictTypeChecked, and it lints test files too, so a bare `etag('"a"')` would fail the lint gate.
function etag(raw: string): ETag {
  const parsed = ETag.parse(raw);
  if (parsed === undefined) throw new Error(`test fixture is not a valid ETag: ${raw}`);
  return parsed;
}

describe('If-Match / If-None-Match emission', () => {
  test('emits multiple ETags as one comma-separated header', () => {
    const conditions = RequestConditions.newBuilder()
      .ifMatch(etag('"a"'))
      .ifMatch(etag('"b"'))
      .build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Match')).toBe('"a", "b"');
  });
});

describe('date emission', () => {
  test('emits If-Modified-Since as an RFC 1123 date', () => {
    const conditions = RequestConditions.newBuilder().ifModifiedSince(new Date('2015-10-21T07:28:00Z')).build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Modified-Since')).toBe('Wed, 21 Oct 2015 07:28:00 GMT');
  });
});

describe('idempotent apply', () => {
  test('applying the same conditions twice does not duplicate the header', () => {
    const conditions = RequestConditions.newBuilder().ifMatch(etag('"a"')).build();
    const once = conditions.applyTo(Headers.newBuilder().build());
    const twice = conditions.applyTo(once);
    expect(twice.getAll('If-Match')).toEqual(['"a"']);
  });
});

describe('any-tag mutual exclusivity', () => {
  test('collapses repeated * to one', () => {
    const conditions = RequestConditions.newBuilder().ifMatch(ETag.ANY).ifMatch(ETag.ANY).build();
    const headers = conditions.applyTo(Headers.newBuilder().build());
    expect(headers.get('If-Match')).toBe('*');
  });

  test('rejects mixing * with a concrete ETag', () => {
    const builder = new RequestConditionsBuilder().ifMatch(ETag.ANY);
    expect(() => builder.ifMatch(etag('"a"'))).toThrow(RequestConditionsValidationError);
  });

  test('rejects adding * after a concrete ETag', () => {
    const builder = new RequestConditionsBuilder().ifMatch(etag('"a"'));
    expect(() => builder.ifMatch(ETag.ANY)).toThrow(RequestConditionsValidationError);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `cd packages/core && bun test src/http/request-conditions.test.ts`
Expected: FAIL — `Cannot find module './request-conditions.js'`.

- [ ] **Step 3: Write `request-conditions.ts`**

```typescript
// packages/core/src/http/request-conditions.ts
import type {Builder} from './builder.js';
import {RequestConditionsValidationError} from './errors.js';
import {ETag} from './etag.js';
import {Headers} from './headers.js';

function addEtag(list: ReadonlyArray<ETag>, etag: ETag, headerName: string): ReadonlyArray<ETag> {
  if (etag.isAny) {
    if (list.some((e) => !e.isAny)) {
      throw new RequestConditionsValidationError(`${headerName}: '*' cannot combine with a concrete ETag`);
    }
    return [ETag.ANY];
  }
  if (list.some((e) => e.isAny)) {
    throw new RequestConditionsValidationError(`${headerName}: cannot add a concrete ETag alongside '*'`);
  }
  return [...list, etag];
}

function toRfc1123(date: Date): string {
  return date.toUTCString();
}

export class RequestConditions {
  readonly #ifMatch: ReadonlyArray<ETag>;
  readonly #ifNoneMatch: ReadonlyArray<ETag>;
  readonly #ifModifiedSince: Date | undefined;
  readonly #ifUnmodifiedSince: Date | undefined;

  // eslint-disable-next-line max-params -- private, builder-internal; the four conditional facets are fixed (HTTP-50)
  constructor(
    ifMatch: ReadonlyArray<ETag>,
    ifNoneMatch: ReadonlyArray<ETag>,
    ifModifiedSince: Date | undefined,
    ifUnmodifiedSince: Date | undefined,
  ) {
    this.#ifMatch = ifMatch;
    this.#ifNoneMatch = ifNoneMatch;
    this.#ifModifiedSince = ifModifiedSince;
    this.#ifUnmodifiedSince = ifUnmodifiedSince;
    Object.freeze(this);
  }

  static newBuilder(): RequestConditionsBuilder {
    return new RequestConditionsBuilder();
  }

  applyTo(headers: Headers): Headers {
    let builder = headers.newBuilder();
    if (this.#ifMatch.length > 0) {
      builder = builder.set('If-Match', this.#ifMatch.map((e) => e.raw).join(', '));
    }
    if (this.#ifNoneMatch.length > 0) {
      builder = builder.set('If-None-Match', this.#ifNoneMatch.map((e) => e.raw).join(', '));
    }
    if (this.#ifModifiedSince !== undefined) {
      builder = builder.set('If-Modified-Since', toRfc1123(this.#ifModifiedSince));
    }
    if (this.#ifUnmodifiedSince !== undefined) {
      builder = builder.set('If-Unmodified-Since', toRfc1123(this.#ifUnmodifiedSince));
    }
    return builder.build();
  }
}

export class RequestConditionsBuilder implements Builder<RequestConditions> {
  #ifMatch: ReadonlyArray<ETag> = [];
  #ifNoneMatch: ReadonlyArray<ETag> = [];
  #ifModifiedSince: Date | undefined;
  #ifUnmodifiedSince: Date | undefined;

  ifMatch(etag: ETag): this {
    this.#ifMatch = addEtag(this.#ifMatch, etag, 'If-Match');
    return this;
  }

  ifNoneMatch(etag: ETag): this {
    this.#ifNoneMatch = addEtag(this.#ifNoneMatch, etag, 'If-None-Match');
    return this;
  }

  ifModifiedSince(date: Date): this {
    this.#ifModifiedSince = date;
    return this;
  }

  ifUnmodifiedSince(date: Date): this {
    this.#ifUnmodifiedSince = date;
    return this;
  }

  build(): RequestConditions {
    return new RequestConditions(this.#ifMatch, this.#ifNoneMatch, this.#ifModifiedSince, this.#ifUnmodifiedSince);
  }
}
```

`Date.prototype.toUTCString()` already emits exactly the RFC 1123 form (`Wed, 21 Oct 2015 07:28:00 GMT`) — no
hand-rolled date formatting needed.

**Known edge, deferred:** `applyTo` writes the tags through `Headers`' *outbound* `set`, which rejects obs-text
(bytes ≥ 0x80) per HTTP-18. HTTP-48 *permits* obs-text inside an ETag's opaque tag, so a conditional request that
replays a server-issued ETag containing obs-text (a legitimate conditional-GET/PUT flow) would throw here. The
spec text in scope does not resolve the HTTP-18-vs-HTTP-50 tension, and no test exercises it, so this phase keeps
the strict outbound path rather than guessing. Flagged for Phase 10 (Deviation Reconciliation) to settle against
the full spec — either a relaxed emit path for replayed ETags, or an explicit documented deviation.

- [ ] **Step 4: Run and confirm everything passes**

Run: `cd packages/core && bun test src/http/request-conditions.test.ts`
Expected: PASS — `7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http/request-conditions.ts packages/core/src/http/request-conditions.test.ts
git commit -m "feat(core): add RequestConditions aggregator (HTTP-50)"
```

---

### Task 15: Public barrel and full gate verification

**Files:**
- Create: `packages/core/src/http/index.ts`
- Modify: `packages/core/src/index.ts` (the placeholder `ping()` barrel from Phase 0 — re-export the `http` module
  from it, or replace it; either way this is the package's real public surface now)

**Interfaces:**
- Consumes: every class/function/type produced by Tasks 1–14.
- Produces: nothing new — this task's job is wiring the front door and proving the toolchain gates from Phase 0
  still pass against real domain code, not real domain code passing them just via a hand-run `bun test`.

- [ ] **Step 1: Write `packages/core/src/http/index.ts`**

```typescript
// packages/core/src/http/index.ts
export type {Builder} from './builder.js';
export {requireField} from './builder.js';
export {
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
export type {Method} from './method.js';
export {isIdempotent, isBodyForbidden, methodWireToken} from './method.js';
export {Status} from './status.js';
export {Protocol} from './protocol.js';
export {MediaType} from './media-type.js';
export {Headers, HeadersBuilder, HeaderName} from './headers.js';
export {QueryParams, QueryParamsBuilder} from './query-params.js';
export {Request, RequestBuilder} from './request.js';
export {Response, ResponseBuilder} from './response.js';
export {RequestOptions, RequestOptionsBuilder} from './request-options.js';
export {ETag} from './etag.js';
export {HttpRange} from './http-range.js';
export {RequestConditions, RequestConditionsBuilder} from './request-conditions.js';
```

`ascii-validation.ts`'s predicates are deliberately **not** re-exported here — they're internal implementation
helpers `headers.ts` and `media-type.ts` share, not part of the package's public domain-model surface.

- [ ] **Step 2: Update the package's top-level entry point and retire the Phase 0 placeholder**

Read the current `packages/core/src/index.ts` (the Phase 0 stub) and replace its content:

```typescript
// packages/core/src/index.ts
export * from './http/index.js';
```

This replaces Phase 0's placeholder `ping()` export entirely — it was only ever there to prove the toolchain,
and Phase 1 is the first real domain code the toolchain gates against.

Removing `ping` leaves two Phase 0 artifacts dangling, both of which reference it by name and would fail a gate
later in this task if left as-is. Handle both now:

**(a) Delete the Phase 0 unit test** — `packages/core/src/index.test.ts` tests `ping()`, which no longer exists,
so it would fail `bun test` at Step 3:

Run: `git rm packages/core/src/index.test.ts`

The barrel `index.ts` is pure re-export with no logic of its own to test (see the File Structure note); the real
tests are the colocated `src/http/*.test.ts` files from Tasks 1–14.

**(b) Retarget the dual-consumption smoke script** — `scripts/verify-dual-consumption.mjs` (from the scaffold
milestone) hard-imports `{ping}` and asserts `ping() === 'pong'`; with `ping` gone it would throw
`SyntaxError: … does not provide an export named 'ping'` at Step 6. Rewrite it to exercise a real Phase 1 export
instead — `Status` is a good pick: it has a static factory and needs no construction ceremony, so the smoke test
stays a one-liner that proves an external plain-JS consumer can resolve and *run* built domain code:

```javascript
// scripts/verify-dual-consumption.mjs
import assert from 'node:assert/strict';
import {Status} from '@dexpace/core';

assert.equal(Status.of(200).code, 200);
assert.equal(Status.of(200).name, 'OK');
console.log('dual-consumption check passed: plain Node import resolved and executed @dexpace/core');
```

It stays deliberately plain JavaScript, run with plain `node` (not `bun`/`ts-node`), for the same reason the
scaffold gave: it is the concrete proof that a consumer with no TypeScript toolchain and no Bun can import and run
the built package.

- [ ] **Step 3: Run the full local gate sequence from Phase 0 against real code**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun test --coverage
```

Expected: every command exits 0. `bun test --coverage` should show every new file in `packages/core/src/http/`
at or near 100% — if any file is conspicuously low, a branch (an error path, an edge case) has no test and needs
one added back in the relevant task before continuing.

- [ ] **Step 4: Regenerate the API report**

Run: `cd packages/core && bun run api:local`
Expected: `etc/core.api.md` is rewritten with the full Phase 1 public surface — every exported class, method, and
free function from Task 15's barrel. Open it and confirm nothing from `ascii-validation.ts` or any internal
helper (`splitRespectingQuotes`, `addEtag`, `toRfc1123`, etc.) appears — only what `index.ts` actually exports.

- [ ] **Step 5: Verify the API-compatibility gate is green**

Run: `cd packages/core && bun run api:ci`
Expected: exits 0 — the report just regenerated in Step 4 matches what's on disk (nothing to diff yet, since
Step 4 just wrote it).

- [ ] **Step 6: Run the remaining Phase 0 gates**

```bash
cd /home/mohammad/Projects/dexpace/nodejs-sdk
bun run lint:publish
bun run verify:dual-consumption
bun run verify:seam-1
bun run audit
```

Expected: all four exit 0. `verify:seam-1` matters more now than it did in Phase 0 — this phase added real
logic and it would be easy to reach for a small utility library (a date-formatting helper, a URL library) without
thinking of it as "a dependency"; the gate exists precisely to catch that reflex.

- [ ] **Step 7: Add a changeset**

Phase 1 is the first *consumer-facing* surface `@dexpace/core` ships — the scaffold wired `changesets` precisely
so a change like this carries a version/changelog entry (no changeset was created in Phase 0, correctly, since the
`ping` stub was infrastructure). Create one now:

Run: `bunx changeset`

Pick `@dexpace/core`, a **minor** bump (new public API on a `0.x` line), and a summary such as
`Add the core HTTP domain model (Request, Response, Headers, Status, MediaType, Protocol, QueryParams,
RequestOptions, ETag, HttpRange, RequestConditions).` This writes a markdown file under `.changeset/`.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/http/ packages/core/src/index.ts packages/core/etc/core.api.md \
        scripts/verify-dual-consumption.mjs .changeset/
git rm --cached --ignore-unmatch packages/core/src/index.test.ts
git commit -m "feat(core): wire Phase 1 public barrel and verify all toolchain gates against real domain code"
```

The `git rm` in Step 2(a) already staged the `index.test.ts` deletion; the line above is a harmless no-op if so,
and a safety net if the staging was reset. `git add packages/core/src/http/` stages every Task 1–14 source and
test file in one shot.

---

## Self-Review

**Spec coverage** (every `HTTP-N`/`SEAM-N` ID cited in
`docs/superpowers/specs/2026-07-23-phase1-core-http-domain-model-design.md`, mapped to the task that implements
it): HTTP-3/4/5 (construction/immutability/derivation) → every task, pattern established in Task 1 and repeated
throughout. HTTP-6/7/8/9 → Task 9 (Request) + Task 2 (Method). HTTP-46/47 → Task 9. HTTP-10/11/12 → Task 3.
HTTP-13..22 → Tasks 6–7. HTTP-23..27, HTTP-53 → Task 5. HTTP-28..32 → Task 8. HTTP-33 → Task 4. HTTP-34/35 → Task
11. HTTP-48 → Task 12. HTTP-49 → Task 13. HTTP-50 → Task 14. SEAM-29 → Task 1 (`Builder<T>`). SEAM-1 → verified,
not implemented, by Task 15 Step 6 (`verify:seam-1` from the scaffold plan) — this phase adds zero runtime
dependencies to `@dexpace/core`; confirm this holds in Step 6 rather than assuming it.

**Placeholder scan:** no "TBD"/"TODO"/"implement later" strings; every step contains complete, runnable code —
including every validation branch and error path a test exercises.

**Type consistency:** cross-checked exported names and signatures across tasks — `Headers.newBuilder()` (Task 6)
is consumed with that exact name by `Request`/`Response`/`RequestConditions` (Tasks 9, 10, 14); `Method`/
`isBodyForbidden`/`methodWireToken` (Task 2) match their usage in `Request` (Task 9) exactly; `requireField`
(Task 1) keeps the same `<T>(value: T | null | undefined, fieldName: string): T` signature everywhere it's
called (Tasks 9, 10); `ETag.isAny`/`ETag.raw` (Task 12) match their usage in `RequestConditions` (Task 14).

**Known gap, deliberately deferred:** `RequestBuilder`/`ResponseBuilder`/`HeadersBuilder`/etc. do not yet
implement the `MultipartBody` model HTTP-3 lists among "each builder-based model" — multipart bodies depend on
the body-lifecycle contracts (`product-spec/06-request-and-response-body-lifecycle.md`), which are Phase 3's
scope per the roadmap, not this phase's. `Request`/`Response`'s `body: unknown` is an intentional placeholder
until then (see Task 9's Interfaces note).
