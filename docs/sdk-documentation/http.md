# The HTTP domain model

Everything in `packages/core/src/http/` follows one shape, and the shape is the point: a model is
frozen at construction and reachable only through a builder or a static factory, so
case-insensitivity, multi-value semantics, ordering, header-injection defenses, method/body legality
and total status handling are decided **once** and behave identically under every transport.

## Building and deriving

```typescript
import {Request} from '@dexpace/core';

const request = Request.newBuilder()
  .method('POST')
  .url('https://api.example.com/v1/things')
  .headers(
    Request.newBuilder().build().headers.newBuilder()
      .set('Accept', 'application/json')
      .add('X-Tag', 'a')
      .add('X-Tag', 'b')
      .build(),
  )
  .build();
```

`Request.newBuilder()` (static) starts empty. `request.newBuilder()` (instance) returns a builder
**pre-filled from that instance, deep-copying every collection** — so deriving never aliases the
source (`HTTP-3`), and mutating the derived request's headers cannot reach back into the original.

There is no public constructor on any of them (`HTTP-2`). The emitted `.d.ts` declares the
constructor `private`, so a consumer cannot construct around `build()`'s validation. A missing
required field is a `` `${name} is required` `` error from one shared helper (`HTTP-4`), never a
bespoke message per field.

**One place still leaks mutability, deliberately.** `request.url` returns a *clone* of the native
`URL` on every access, because `URL` is mutable and freezing the model cannot cascade into it
(`HTTP-5`). Reading it in a loop allocates; hoist it.

## Headers

```typescript
headers.get('content-type');   // first value, case-insensitive
headers.getAll('set-cookie');  // every value, in insertion order
headers.names();               // the names as first written
headers.entries();             // [name, value] per value, not per name
```

`HeadersBuilder` has four mutators, and the split is not cosmetic:

| Method | For |
|---|---|
| `set(name, value)` | Outbound. Replaces every existing value. `null` removes the name |
| `add(name, value)` | Outbound. Appends, preserving order |
| `setInbound` / `addInbound` | The **lenient** pair, for values a server sent |

Outbound values are validated against the strict field-value grammar: a CR, LF or NUL in a header
value is a `HeaderValidationError`, because that is header injection. Inbound values are accepted
leniently — obs-text bytes and all — because rejecting what a server actually sent would make the
client unable to read real responses. `HTTP-18`/`HTTP-48`/`HTTP-50`'s tension is exactly this, and
`docs/deviations.md` item 15 records the one case it cannot resolve: a server-issued `ETag`
containing obs-text does not round-trip, because replaying it outbound would have to pass the strict
grammar.

`HeaderName.of(raw)` is the validated name type; every accessor takes `string | HeaderName`.

## Status

`Status` is **total**. Any integer is a `Status`:

```typescript
Status.of(200).name          // 'OK'
Status.of(200).isSuccess     // true
Status.of(599).name          // undefined
Status.of(599).isRecognized  // false
Status.of(599).isServerError // true
Status.recognized(599)       // undefined
```

An unrecognized code is never an error — a server is free to invent one — but `recognized()` lets a
caller tell a vendor code from a registered one when that matters. The class predicates
(`isInformational`, `isSuccess`, `isRedirect`, `isClientError`, `isServerError`, `isError`) are
range checks and work on unrecognized codes too.

## The value types

These have no builder; a static factory is the whole surface.

| Type | Factories | Notes |
|---|---|---|
| `Status` | `of`, `recognized` | above |
| `Protocol` | `HTTP_1_1`, `HTTP_2`, `parse` | Both shipped transports always report `HTTP_1_1`: neither `fetch`'s `Response` nor undici's `ResponseData` exposes the negotiated version. A ledgered deviation, not a silent gap |
| `MediaType` | `of`, `parse` | `parse('text/plain;charset=utf-8').charset` → `'utf-8'`. `matches(pattern)` does wildcard subtype matching. **`charset` is resolved against the runtime's WHATWG encoding registry**, so an unrecognized label answers `undefined` — `parse('text/plain;charset=bogus').charset` is `undefined` (`HTTP-24`) while `parameter('charset')` still returns `'bogus'` verbatim and `render()` round-trips it (`HTTP-25`) |
| `ETag` | `parse`, `ANY` | `parse` returns `undefined` on a malformed tag rather than throwing. `isWeak`, `opaque`, `raw` |
| `HttpRange` | `bounded`, `open`, `suffix`, `parse` | `kind` discriminates the three |

## Per-call options

`RequestOptions` carries what belongs to *this* call rather than to the request:

```typescript
import {RequestOptions} from '@dexpace/core';

const options = RequestOptions.newBuilder()
  .timeoutMs(5_000)
  .maxRetries(3)
  .tags(new Map([['operation', 'listThings']]))
  .build();
```

`RequestOptions.EMPTY` is the shared no-op instance. A step reads it as `ctx.options`, and a
transport receives it as `send()`'s second argument. Both range checks are the **full** range, not
only the lower bound: `maxRetries` rejects anything that is not a non-negative integer, and
`timeoutMs` rejects zero, negatives, `Infinity` and `NaN` alike (`HTTP-35`). A fractional
`timeoutMs` is accepted — a timeout is a duration, not a count.

`auth` on the builder is the **per-call** auth tier, the highest-precedence one; see
[`auth.md`](./auth.md).

## Conditional requests

`RequestConditions` is a builder over the four conditional headers, and it applies itself:

```typescript
import {ETag, RequestConditions, type Request} from '@dexpace/core';

declare const request: Request;

const conditions = RequestConditions.newBuilder()
  .ifNoneMatch(ETag.parse('"abc"') ?? ETag.ANY)
  .ifModifiedSince(new Date(0))
  .build();

const conditioned = request.newBuilder().headers(conditions.applyTo(request.headers)).build();
```

`applyTo` returns a **new** `Headers` — it never mutates the one it is given.

## Query parameters

`QueryParams` is the one URL-manipulation surface. It is not `URLSearchParams`, and the difference is
deliberate: `URLSearchParams` re-serializes a whole query string, reorders parameters, and re-encodes
what was already encoded. `QueryParams` preserves insertion order and encodes exactly once
(`docs/work/mvp/2026-09-04-open-items-dissolution.md` J4), with RFC 3986 component encoding rather than
`application/x-www-form-urlencoded`'s — so a space becomes `%20`, not `+`, and a literal `+` becomes
`%2B`.

```typescript
import {QueryParams} from '@dexpace/core';

const params = QueryParams.newBuilder()
  .add('q', 'a b')
  .add('plus', 'c+d')
  .add('flag', null) // HTTP-28: a value-less parameter, stored as the empty string
  .build();

params.encode(); // 'q=a%20b&plus=c%2Bd&flag='
```

`add(name, null)` records a value-less parameter as a single empty string, never the text `"null"`.
A name whose value list ends up empty is dropped at `build()` so it cannot leave a phantom entry that
`has()` reports and `encode()` never emits (`HTTP-30`).

The pagination engine's query splice and the `Link`-header tokenizer are deliberately **not**
exported: publishing them would put a second URL-manipulation surface next to this one.

## Operations

`buildRequest(baseUrl, operation)` assembles a `Request` from an `OperationDescriptor` — a declarative
path template with its parameters — for callers generating clients from a service description rather
than writing builders by hand. It raises `OperationAssemblyError` on a template a parameter set
cannot satisfy.
