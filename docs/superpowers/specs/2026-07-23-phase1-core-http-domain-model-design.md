# Phase 1 — Core HTTP Domain Model — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the immutable, transport-agnostic HTTP domain model — Request, Response, Headers, Status,
MediaType, Protocol, QueryParams, RequestOptions, and the conditional-request helpers (ETag, HttpRange,
RequestConditions) — as the first piece of real domain code in `@dexpace/core`. This is Phase 1 of the
[v1 roadmap](./2026-07-23-nodejs-sdk-v1-roadmap-design.md), building on the toolchain the
[scaffold milestone](./2026-07-23-scaffold-milestone-design.md) established.

**Scope:** Full `product-spec/04-core-http-domain-model.md` (HTTP-3 through HTTP-53, both MUST and SHOULD level) in
one phase, including the conditional-request helpers (HTTP-48/49/50) — they're small and self-contained, and
nothing later depends on deferring them, so splitting them into a separate spec would only add a second brainstorm
cycle for no isolation benefit.

**Governing documents:** `docs/product-spec/04-core-http-domain-model.md` (normative requirements, cited by ID
throughout), `docs/sdk-design-nodejs/04-domain-model-construction.md` (the TS construction approach this design
follows), `docs/product-spec/03-pluggable-seams-and-extension-model.md` §3.8 (SEAM-29, the shared Builder
contract) and `docs/product-spec/02-architectural-principles.md` (SEAM-1/SEAM-2). Styleguide:
`styleguide/typescript/06-classes-and-data-modeling.md`, `08-error-handling.md`, `11-testing.md`.

## Foundational Decision: Classes + Builders, Not Plain Objects

Styleguide 6.3 defaults to `interface` + free functions, reserving classes for stateful lifecycle resources.
Request/Response/etc. have no lifecycle, so the default would push toward plain frozen objects (6.9). This design
deliberately overrides that default and follows `sdk-design-nodejs/04`'s class-based approach instead, for two
reasons:

1. **HTTP-3's `newBuilder()`-style derivation is a builder-shaped requirement**, and SEAM-29 mandates a shared
   `Builder<T>` contract (`build(): T`) generic composition helpers can accept. Moving to plain objects doesn't
   just swap a keyword — it requires re-deriving how every one of HTTP-3/4/5/7/34/35 and SEAM-29 gets satisfied
   without a class, across every domain type in this phase, and SEAM-29 becomes inapplicable rather than
   satisfied.
2. **TypeScript's structural typing lets any object literal shaped like `interface Request {...}` bypass
   construction entirely** — `build()`'s validation (HTTP-4's required-field checks, HTTP-7's reject-body-on-GET
   rule) never runs. A concrete class with `#private` fields forces construction through `RequestBuilder.build()`;
   there is no way to spell out a same-shaped object literal that satisfies the class type. This does not fully
   close the hole (deliberate reflection abuse — e.g. `Object.create(Request.prototype)` — could still forge an
   instance), but it closes the accidental path, which plain objects leave wide open.

`#private` (not styleguide's default `private`) is not itself a deviation — styleguide 6.7 already carves out
"a library whose internals must stay unreachable even by reflective access," which is exactly this case.

**Recorded deviation:** the residual structural-typing bypass (deliberate reflection abuse) is an acknowledged,
unfixable-in-TypeScript limitation, to be listed in `sdk-design-nodejs/10-deliberate-deviations-from-the-
reference-contract.md` when that phase is reached.

## Validation Approach

Explicit invariant/predicate functions, not zod, throughout this phase. Zod (styleguide ch10) targets parsing
untrusted boundary input (JSON, config); this phase validates already-typed values against character-class and
structural rules (control-character checks, RFC 3986 percent-encoding, quoted-string parsing) that zod isn't
built for. Styleguide 6.8 explicitly permits "explicit invariants" as the alternative to zod.

## File Layout

All in `@dexpace/core`, new folder `packages/core/src/http/`:

```
src/http/
  builder.ts              # Builder<T> interface (SEAM-29) + requireField() helper
  errors.ts                # RequiredFieldError + typed validation error subclasses
  headers.ts               # Headers class + HeadersBuilder
  media-type.ts            # MediaType value type (parse/of factories, no builder)
  status.ts                 # Status value type
  protocol.ts               # Protocol value type
  method.ts                  # Method + idempotency classification
  query-params.ts          # QueryParams class + QueryParamsBuilder
  request.ts                 # Request class + RequestBuilder
  response.ts                # Response class + ResponseBuilder
  request-options.ts       # RequestOptions class + RequestOptionsBuilder
  etag.ts                    # ETag helper
  http-range.ts              # HttpRange helper
  request-conditions.ts    # If-* conditional-request aggregator
  index.ts                    # barrel — the one front door (API design ch10)
```

## Construction & Immutability Pattern

Shared plumbing in `builder.ts`:
- `interface Builder<T> { build(): T }` — structural, satisfies SEAM-29 with no explicit `implements`.
- `requireField<T>(value: T | null | undefined, name: string): T` — throws `RequiredFieldError` with message
  `` `${name} is required` `` (single-sourced so HTTP-4's field-named errors can't drift between models).

Per builder-based model (Request, Response, Headers, QueryParams, RequestOptions, RequestConditions,
MultipartBody):
- The class holds `#private` fields only; only the class is exported, never a bare structural interface.
- `newBuilder()` returns a pre-filled builder that defensive-copies every collection (arrays via spread,
  header/query maps via `new Map(...)`) — never aliasing the source instance's internals (HTTP-3).
- The builder's `build()` validates (`requireField` plus model-specific checks like HTTP-7) then constructs;
  the constructor itself only assigns.
- `Object.freeze` is applied once, inside the constructor — not re-copied per getter call, since the instance
  never changes after construction. Nested collections are frozen independently; freeze is shallow and is never
  relied on to cascade (HTTP-5).

Value types with no builder (`MediaType`, `Status`, `Protocol`, the typed header-name type, `ETag`, `HttpRange`)
are reconstructed via static factories (`MediaType.parse(...)`, `Status.of(code)`) instead, per HTTP-3's own
carve-out for value-based types.

## Component Design

### Headers (`headers.ts`)

Dual-`Map` design: a lower-cased-key → value-array map for case-insensitive lookup/mutation/equality, and a
lower-cased-key → original-casing map for wire emission — satisfies HTTP-13 directly (case-insensitive storage,
original casing preserved for the wire). Multi-value semantics: `add` appends, `set` replaces the whole list,
per-name insertion order preserved (HTTP-14); setting a value to `null` removes the header entirely (HTTP-15);
distinct-name insertion order preserved overall (HTTP-16).

Validation is two separate predicate sets:
- **Outbound** (caller-set) names: reject blank, C0 control/DEL, non-ASCII; surrounding whitespace trimmed before
  validation (HTTP-17). Outbound values: reject C0/DEL except HTAB, reject non-ASCII (HTTP-18).
- **Inbound** (response) values: relax the non-ASCII rule (obs-text ≥0x80 permitted) while still rejecting
  control characters; inbound names remain strictly validated (HTTP-19).

Error messages never echo the offending value verbatim; an echoed name escapes control characters — enforced by
`HeaderValidationError`'s constructor doing the redaction, not left to each call site (HTTP-20).

A typed header-name abstraction (in `headers.ts` or its own file if it grows) compares/hashes by case-folded form
while preserving original casing for wire emission, interoperates with the string-keyed API, and enforces the
same name validation as HTTP-17 (HTTP-21); it may intern instances process-wide, first casing wins (HTTP-22, MAY).

### MediaType (`media-type.ts`)

Static `parse()`/`of()` factories only, no builder. Lower-cases type/subtype/param-keys, preserves param-value
case; equality is case-insensitive on type/subtype/keys, case-sensitive on values (HTTP-23). `charset` resolves
case-insensitively, returns `null` (never throws) when absent or unknown (HTTP-24).

Parsing must respect quoted-strings (a `;`/`=` inside quotes is not a separator), split each parameter on its
first `=` only, strip quotes, unescape quoted-pairs; rendering emits a value bare when it's a valid token and
quoted-and-escaped otherwise, so `parse(render(x)) === x` (HTTP-25) — a property test, not hand-picked examples.
Parsing rejects blank input, requires non-empty type/subtype around a single `/`, and requires each parameter to
contain `=` with non-empty key and value (HTTP-53). Construction rejects any control character (C0 except HTAB,
plus DEL) or non-ASCII byte anywhere, using the same predicate as outbound header-value validation (HTTP-26).
Wildcard matching permits a wildcard type only with a wildcard subtype — bare `*/*` — with a wildcard in either
position matching any value (HTTP-27).

### Protocol (`protocol.ts`)

Canonical lowercase wire form (`http/1.1`, `http/2`); case-insensitive, locale-invariant parse accepting the
canonical forms plus `HTTP/2`/`HTTP/2.0` aliases; throws on an unrecognized identifier (HTTP-33).

### QueryParams (`query-params.ts`)

Class + `QueryParamsBuilder`. Names are case-**sensitive** (unlike Headers), insertion order preserved, multiple
values supported, a value-less parameter (`?flag`) models as a single empty-string value distinct from an absent
name (HTTP-28).

Encoding: RFC 3986 percent-encoding, not `application/x-www-form-urlencoded` — space → `%20` (never `+`), literal
`+` → `%2B`, `/` → `%2F`, `*` → `%2A`, encoding everything outside the unreserved set `A–Z a–z 0–9 - . _ ~`,
preserving insertion order, one repeated-name emission per value, no leading `?`, empty when empty (HTTP-29/32).

Equality is order-sensitive — two instances equal iff they encode identically; a name whose value list is empty
is dropped at build time so it can't leave a phantom contains-true entry invisible to `encode` (HTTP-30). Parsing
is the asymmetric case: lenient, never throws — null/blank query → empty, leading `?` tolerated, a segment with
no `=` or a trailing `=` → empty-string value, stray `&` skipped, malformed percent-encoding falls back to raw
text (HTTP-31). Encode and parse are kept as two clearly separate functions, not one shared "codec" abstraction,
because their strictness is deliberately asymmetric.

### Status (`status.ts`)

Total function of the integer code — `Status.of(code)` never throws: a canonical named instance for recognized
codes, a raw-code/unnamed instance for unrecognized ones (so vendor codes like nginx 499 or Cloudflare 520-526
survive faithfully). A separate `isRecognized()` lookup lets callers distinguish the two (HTTP-10). Range
classification as derived getters — `isInformational`/`isSuccess`/`isRedirect`/`isClientError`/`isServerError`/
`isError` (HTTP-11). Equality by numeric code only; name never participates (HTTP-12).

### Method (`method.ts`)

Idempotent set `{GET, HEAD, OPTIONS, PUT, DELETE}` as the single source both the (future) retry allow-list and
the inherent replay-safety gate derive from; each method's wire token equals its uppercase name (HTTP-9).

### Request, Response, URL (`request.ts`, `response.ts`)

**Request:** method, target URL, headers (non-null, possibly empty), optional body — operational knobs
(timeout/retries) live outside the wire model entirely, in `RequestOptions` (HTTP-6). `RequestBuilder.build()`
rejects a non-null body on any method whose classification forbids one — GET, HEAD, TRACE, CONNECT — failing at
construction rather than deferring to a transport (HTTP-7). With no method set, `build()` defaults to GET only if
no body is present; a body with no method fails, reporting the missing method rather than defaulting to GET first
and then tripping the no-body-on-GET rule (HTTP-8).

URL equality/hashing must not perform blocking work or DNS resolution: compared by textual external form only;
request equality otherwise compares method, headers, and body by value (HTTP-46). Building a request from a
malformed URL string or non-absolute URI fails with an argument error carrying the offending input (HTTP-47).

**Response:** the originating request, negotiated protocol, status, an optional reason phrase, headers
(non-null, possibly empty), an optional body (HTTP-6, second half).

### RequestOptions (`request-options.ts`)

Per-call operational overrides that are explicitly *not* part of the wire form: at minimum a per-call timeout, a
per-call max-retries, and opaque string-keyed tags — every field defaults to a null/empty "use the default"
sentinel, with a canonical `RequestOptions.EMPTY` "override nothing" instance. Tags are defensively copied at
build (HTTP-34).

The builder rejects a non-null timeout that is zero or negative (`null` itself is accepted — it means "no
override"); rejects a negative max-retries; **accepts** a max-retries of `0`, meaning "disable retries for this
call" (HTTP-35). Zero and null are deliberately different states here — worth an explicit code comment at the
validation site, since the two are easy to conflate by accident.

### Conditional-Request Helpers (`etag.ts`, `http-range.ts`, `request-conditions.ts`)

**ETag:** models strong (`"opaque"`), weak (`W/"opaque"`), and the any-singleton (`*`); validates permitted
etagc characters (rejecting a literal quote, control chars, DEL; permitting obs-text); rejects an empty strong
opaque, permits an empty weak opaque; round-trips its raw form; rejects unterminated forms; returns absent (not
an error) for blank input (HTTP-48).

**HttpRange:** validated factories for a bounded range (rejecting negative offset / non-positive length,
detecting overflow), a suffix range, and an open-ended range; supports only the `bytes` unit and a single range
(rejecting multi-range commas); stores the parsed value verbatim (HTTP-49).

**RequestConditions** (the aggregator): emits `If-Match`/`If-None-Match` as one comma-separated header, emits
`If-Modified-Since`/`If-Unmodified-Since` as RFC 1123 dates; is idempotent when applied — uses `set`, never `add`,
so reapplying doesn't duplicate; enforces that the any-tag (`*`) is mutually exclusive with concrete entity-tags,
collapsing repeated `*` to one (HTTP-50).

## Error Handling

Typed `Error` subclasses per styleguide ch08 (mandatory `cause` chaining on rethrow, `catch (e: unknown)` then
narrow at boundaries) — no bare `throw new Error(...)` anywhere in this phase:

- `RequiredFieldError` (shared, `builder.ts`) — the single source for HTTP-4's field-named errors.
- `HeaderValidationError` — performs the HTTP-20 redaction in its own constructor, not left to call sites.
- `MediaTypeParseError`, `UrlConstructionError`, `RequestOptionsValidationError`, `EtagParseError`,
  `HttpRangeValidationError` — one per parse/validate boundary, named after what specifically failed.

## Testing

`bun test`, colocated `*.test.ts` per file. `fast-check` property tests wherever the spec itself demands a
round-trip or algebraic invariant, rather than hand-picked examples:

- `MediaType`: `parse(render(x)) === x` — literally spec-mandated by HTTP-25.
- `QueryParams`: encode/parse round-trip, RFC 3986 percent-encoding invariants.
- `Headers`: case-fold invariants — any casing resolves to the same stored entry.
- `Request`: URL textual-equality invariants — equality never triggers network access.

Every test file cites the `HTTP-N`/`SEAM-N` requirement IDs it exercises in a comment, starting the traceability
convention Phase 9's conformance pass (`appendix-b-conformance-test-checklist.md`) will need — establishing this
now avoids retrofitting citations onto every test later. The 80% aggregate coverage floor from the scaffold
milestone (`NFR-5`) applies unchanged; `api-extractor`'s committed report grows to cover every newly-exported
class and function in this phase.
