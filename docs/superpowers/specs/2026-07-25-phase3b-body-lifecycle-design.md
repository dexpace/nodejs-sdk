# Phase 3b — Body Lifecycle — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the request/response body lifecycle — body production and replayability, materialize-once,
response single-use/close, the lazy parsed-response wrapper, request/response body-logging tees, and bounded
error-body buffering — on top of a tested and frozen Phase 3a. This is the second half of Phase 3 of the
[v1 roadmap](./2026-07-23-nodejs-sdk-v1-roadmap-design.md).

**Scope:** every requirement in `docs/product-spec/06-request-and-response-body-lifecycle.md` — `BODY-1` through
`BODY-37`, `HTTP-36` through `HTTP-52` — is dispositioned here, except the file-backed-body cluster
(`HTTP-40`/`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`), deferred to Phase 8 (see "Explicitly Out of Scope").

**Governing documents:** `docs/product-spec/06-request-and-response-body-lifecycle.md` (normative, cited by ID
throughout), `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md` §3.1, `docs/superpowers/specs/2026-07-24-phase3a-io-contracts-design.md`
(the frozen surface this phase builds on and, in one place, retrofits), `docs/superpowers/plans/2026-07-25-checkpoint-scaffold-through-phase3a.md`
(the two-level error-hierarchy rule this phase's error tree follows), and `docs/superpowers/specs/2026-07-23-phase1-core-http-domain-model-design.md`
(the `Request`/`Response` classes whose `unknown` body placeholder this phase replaces). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 10, 11, 12, 13, 15.

## Explicitly Out of Scope

**`FileBody` (`HTTP-40`/`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`) — deferred to Phase 8.** A file-backed body needs
`node:fs` (a fresh handle per write, a zero-copy transfer path) — `@dexpace/core` has had zero `node:` imports
since the scaffold, mechanically re-verified every phase since, and `sdk-design-nodejs/10` (Deliberate Deviations)
does not address this gap. Rather than carve an exception into core now, this is deferred to Phase 8 — already
scoped by this roadmap as "the most Node-specific judgment calls" — where the right home (a carve-out in core, a
separate package, or a generic caller-supplied-stream-factory shape) gets decided deliberately. Logged in the
roadmap's Deferred Items Log.

Everything else in `§6` ships in this phase.

## Requirement Disposition

| ID | Level | Disposition |
|---|---|---|
| HTTP-36 / BODY-1 | MUST | `Body` interface — `mediaType`, `contentLength` (-1 unknown), `replayable`, `writeTo(sink)` |
| BODY-2, HTTP-51 | MUST / SHOULD | `MultipartBody` — composite replayability, shared framing routine drives both length and bytes, RFC-2046-valid boundary, caller-boundary validation, header quoting/escaping |
| BODY-3 / HTTP-37 | MUST | `materialize(body)` free function; boolean consumed-once guard checked before first `await` |
| BODY-8 | MUST | Stream-ownership rule stated per variant in `stream-body.ts`'s TSDoc — `StreamBody.writeTo` does not close the caller's stream (single-use, caller-supplied, caller-owned) |
| BODY-9 | SHOULD | **Not fully met** — no generic `ReadableStream` mark/reset on Node; `StreamBody` is always single-use. Ledgered |
| HTTP-39 / BODY-10 | MUST | Exact-length copy in `writeTo`'s pump path (reuses Phase 3a's `writeAll`/`SourceContractViolationError` machinery) |
| HTTP-38 / BODY-35 | MUST | Body factories classify replayability by source; form-urlencoded body always replayable, `x-www-form-urlencoded` encoding |
| BODY-4, BODY-5 | MUST | 📄 Contract-obligation-only — `replayable` and idempotency-gated re-send are *consulted* by Phase 5's retry/redirect/auth. This phase guarantees the property is correct; it does not implement consultation |
| HTTP-41 / BODY-14 | MUST | `Response.body: ReadableStream<Uint8Array> \| null` — same reference returned on repeat access, not a replay |
| HTTP-41 / BODY-15, HTTP-43 | MUST | `Response.close()` — idempotent, forwards to body, releases connection whether or not body was read |
| HTTP-16-body / BODY-16 | MUST | `Response.text()`/`bytes()` close the body in a finally-style guarantee |
| HTTP-42 | MUST | `text()` charset from declared media type, fallback UTF-8 |
| HTTP-44, HTTP-45 | MUST | `TypedResponse<T>` — raw fields without touching body, parse-once memoized (success and failure), concurrent-first-call serialization via a shared in-flight promise |
| BODY-17, BODY-18, BODY-19, BODY-21, BODY-37 | MUST | `withRequestLogging` tee decorator over `Body`, built on Phase 3a's `TeeSink` |
| BODY-20 | SHOULD | Partial-failure snapshot returns bytes mirrored up to the failure |
| BODY-22–BODY-29 | MUST | Response-body logging wrapper, two regimes (fits-cap capture vs. exceeds-cap prefix+tail), shared close-once guard |
| HTTP-52 / BODY-30, BODY-31 | MUST | `toHttpError(response)` — 1 MiB fixed cap, 4xx/5xx only, buffering inside the response's own close-guaranteeing scope |
| BODY-32 | MUST | Byte-capped snapshot ops reject negative cap, clamp to platform max, capless snapshot fails loudly over platform max |
| BODY-33 | SHOULD | Non-consuming error-body preview from a fresh peek view |
| BODY-34 | MUST | One shared preview-size cap threaded through both logging tees and `toHttpError` |

## The Body Model

```typescript
interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart';
  readonly mediaType: string | null;
  readonly contentLength: number;      // -1 = unknown
  readonly replayable: boolean;
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
```

**No base class.** `styleguide/typescript/06-classes-and-data-modeling.md` §6.4 sanctions `extends` for `Error`
only, enforced by `@typescript-eslint/no-extraneous-class` plus review. An abstract `Body` class with
`ByteArrayBody extends Body` subclasses would violate that outright. Instead this is `§6.5`'s pattern: a
discriminated union (`kind` as the literal discriminant) over independent classes, each *implementing* the shared
structural `Body` interface — composition, never inheritance. This matches Phase 1's `Request`/`Response`
precedent (concrete classes, `#private` fields for the runtime-immutability guarantee `HTTP-1`/`SEAM-29` need)
without reintroducing a class hierarchy `§6.4` forbids.

**`writeTo` takes a platform `WritableStream<Uint8Array>`, not Phase 3a's internal `BufferedSink`.** This is the
decision Phase 3a's design doc named as "3b's real choice." Taking the platform type means Phase 3a's `io/`
surface (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) never has to leave `@internal` — nothing about `Body`'s
public shape forces its promotion. The cost is that `Body` implementations reach for `TextEncoder`/manual byte
copying instead of `BufferedSink`'s typed write helpers; every variant here is simple enough that this costs
nothing.

**Variants:**

- `ByteArrayBody`, `StringBody`, `FormUrlEncodedBody` — always `replayable: true` (`BODY-35`). Trivial `writeTo`.
- `StreamBody` — wraps a caller `ReadableStream<Uint8Array>`. Always `replayable: false` (`BODY-9` ledgered below).
  `writeTo` does not close the caller's stream (`BODY-8`'s ownership decision for this variant — single-use,
  caller-supplied, caller-owned; documented in the class's TSDoc, not inferred).
- `MultipartBody` — composite. `replayable` iff every part is (`BODY-2`); a single shared framing routine computes
  both `contentLength` and the bytes `writeTo` emits, so they cannot drift (`HTTP-51`). Boundary generated via
  `crypto.getRandomValues` (Web Crypto — portable, same rationale as `sdk-design/10`'s SHA-256-via-`crypto.subtle`
  deviation). A caller-supplied boundary is validated against RFC 2046's grammar and rejected otherwise
  (`MultipartBoundaryError`). Part-header parameter values are quoted/escaped so an embedded CR/LF or quote cannot
  break the framing.
- No `FileBody` — see "Explicitly Out of Scope."

**`materialize(body: Body): Promise<Body>`** — a free function (`10.1`, matching Phase 3a's `factories.ts`
pattern), not a `Body` method. Returns the same instance unchanged if already `replayable`; otherwise drains
`writeTo`'s output exactly once into a fresh `ByteArrayBody` and marks the original consumed. The consumed-once
guard is a boolean flag checked and set before the function's first `await` — Node's single-threaded event loop
collapses the reference's atomic-CAS requirement into this, correctly, *only* because the check-and-flip precedes
any suspension point (the established deviation from `sdk-design-nodejs/06`; violating the ordering reintroduces
the race `BODY-3` exists to prevent).

## Response Body

```typescript
class Response {
  readonly body: ReadableStream<Uint8Array> | null;   // single-use (BODY-14)
  text(): Promise<string>;      // BODY-16, HTTP-42
  bytes(): Promise<Uint8Array>; // BODY-16
  close(): Promise<void>;       // BODY-15, HTTP-43
}
```

Mirrors the `writeTo` decision: the public surface is the platform `ReadableStream`, not an internal wrapper.
`text()`/`bytes()` drain the reader manually into Phase 3a's `ByteQueue` (`writeBytes`/`snapshot()` — the one `io/`
primitive that is pure in-memory data, not bound to a stream reader/writer shape) and decode with `TextDecoder`
using the charset from `Headers.get('content-type')` parsed via `MediaType`, falling back to UTF-8
(`HTTP-42`). `BufferedSource`/`BufferedSink`/`TeeSink` are *not* reused here or anywhere in this phase — their
constructors bind to a `ReadableStreamDefaultReader`/`WritableStreamDefaultWriter` and their `write`/`read`
signatures are `ByteQueue`-and-count shaped, which doesn't fit `Body.writeTo`'s chunk-shaped
`WritableStream<Uint8Array>` or a raw `ReadableStream<Uint8Array>` without rewriting Phase 3a's frozen,
already-tested surface — off the table. `io/` therefore still gets no new consumer this phase beyond `ByteQueue`;
`BufferedSource`'s typed/line reads get their first real consumer in Phase 6 (SSE). Repeated `.body` access
returns the same stream reference by construction (`BODY-14`'s "not a replay" clause needs no separate guard).
`close()` is idempotent, forwards to the body, and releases the connection whether or not the body was ever read
(`BODY-15`, `HTTP-43`).

## `TypedResponse<T>` — the Lazy Parsed-Response Wrapper

```typescript
class TypedResponse<T> {
  constructor(response: Response, parse: (response: Response) => Promise<T>);
  readonly status: Status;
  readonly headers: Headers;
  readonly protocol: string;
  readonly reason: string | null;
  readonly request: Request;
  value(): Promise<T>;
}
```

In scope for this phase — `HTTP-44`/`HTTP-45` are `§6` IDs, not `§14` (serde), and need nothing from the
not-yet-built concrete `Serde`. Raw fields are exposed without touching the body. `value()` parses on first call
and memoizes the outcome — success or thrown failure — so every later call returns or re-throws the same result
without re-running `parse` or re-reading the single-use body. Concurrent first callers are serialized by caching
the in-flight `Promise` before the first `await`, so every overlapping caller awaits the same promise rather than
triggering a second `parse` run; this is the async analog of `RETRY`/`materialize`'s pre-`await` guard, not a
mutex, since Node has no thread to pin.

Phase 6 later supplies a concrete `Serde<T>` plus type-witness that produces the `parse` callback; `TypedResponse`
itself is agnostic to what produces `T`.

## Logging Tees

Both are `@internal` and unwired — mechanism ships now because the IDs are `§6` and squarely this phase's job, but
nothing constructs one until Phase 7 supplies a `Logger`/config to drive it. Same reasoning as Phase 2 shipping
`Serde<T>`'s interface with no concrete implementation, and distinct from the existing "Logger/LogEvent seam →
Phase 7" deferral row, which is about the *seam*, not this machinery.

**Request-body logging tee (`BODY-17`–`21`, `37`):**

```typescript
function withRequestLogging(delegate: Body, tapCapBytes: number): Body & { snapshot(): Uint8Array };
```

A `Body` decorator (composition, consistent with "no base class" above) — a **new, self-contained tee**, not a
reuse of Phase 3a's `TeeSink` class. `TeeSink`'s constructor takes a `BufferedSink` and its `write(src: ByteQueue,
count: number)` is `ByteQueue`-and-count shaped; `Body.writeTo` hands it a chunk-shaped
`WritableStream<Uint8Array>`. The two don't compose without rewriting `TeeSink`'s already-frozen, tested signature,
so this wrapper builds its own small adapter stream instead: it constructs a fresh `WritableStream<Uint8Array>`
whose `write(chunk)` handler mirrors up to `tapCapBytes` of each chunk into an internal `ByteQueue` tap (`BODY-19`)
before forwarding the full chunk unchanged to the real sink's writer, and passes that adapter to
`delegate.writeTo`. Same behavioral contract `BODY-17`/`IO-25`–`29` describe, independent implementation — the tap
clears (`ByteQueue.clear()`) at the start of every `writeTo` call (`BODY-18` — a retry against a replayable
delegate does not accumulate stale bytes), the full payload always reaches the primary sink regardless of the cap
(`BODY-19`), `replayable` and `materialize()` pass through to the delegate verbatim (`BODY-21`), and there is no
writable-buffer escape hatch (`BODY-37`, restating Phase 3a's `IO-28` at this layer) — `snapshot()` is the only
way to read the tap.

**Response-body logging wrapper (`BODY-22`–`29`):** wraps the raw `ReadableStream<Uint8Array>` before it reaches
`Response.body`. Also self-contained for the same reason — `BufferedSource`'s reader-bound constructor and
cursor/view machinery solve a more general N-view problem this wrapper doesn't have. Uses a `ByteQueue` for the
captured prefix, its own `ReadableStreamDefaultReader` loop, and its own close-once boolean. Lazy — drains only on
first `read()`/`snapshot()`/exception-query, serialized so the upstream is read exactly once. Two regimes:

- Fits the cap (EOF before the cap, `BODY-23`) — capture entirely, close the delegate, serve every later read as a
  fresh non-consuming view.
- Exceeds the cap (`BODY-24`) — buffer only the prefix, delegate stays open, exactly one more read is allowed
  (replays the prefix, then continues from the live tail); a second read after that fails.

Delegate `close()` is called at most once across every close path (the wrapper's own close and the one-shot
tail's close share one close-once guard, `BODY-27`) — a plain boolean, the same single-thread collapse as
`materialize`'s guard, not a CAS.

## Bounded Error-Body Buffering (`toHttpError`)

```typescript
function toHttpError(response: Response): Promise<HttpStatusError | null>;
```

A free function, not a `Response` method — keeps `Response` itself ignorant of status semantics. Returns `null`
for a non-4xx/5xx response (`BODY-31`); otherwise buffers at most a fixed 1 MiB cap of the body, re-serves it as a
replayable `ByteArrayBody`-backed body on the returned error, and drops anything beyond the cap. Buffering happens
inside the original response's own close-guaranteeing scope, so a buffer-allocation failure still releases the
connection (`HTTP-52`/`BODY-30`). Preview reads (`BODY-33`) are non-consuming, from a fresh peek view — `null` for
no body, empty for exhausted. The preview-size cap (`BODY-34`) is one constructor/call parameter threaded through
both logging tees and this function, not three independent caps.

## Error Tree — Flattened, Including a Phase 3a Retrofit

The checkpoint (`2026-07-25-checkpoint-scaffold-through-phase3a.md` §5.2) required flattening
`DexpaceError → DomainModelError → Leaf` to `DexpaceError → Leaf` because the corpus caps custom error hierarchies
at two levels. Phase 3a's `IoError` tier (`DexpaceError → IoError → EndOfStreamError`, etc.) is the identical
shape and was not caught by that review — an oversight, not a sanctioned exception, since nothing in `§5.2` or
elsewhere in the checkpoint names `IoError` as exempt. This phase fixes both in one pass rather than shipping a
third instance of the same violation:

```
DexpaceError                                    (Phase 2 root)
├── RequiredFieldError, HeaderValidationError, …  (Phase 1, flattened per checkpoint §5.2)
├── CancellationError, OperationAssemblyError     (Phase 2, already flat)
├── EndOfStreamError, SourceContractViolationError,
│   ClosedResourceError, AllocationLimitError     (Phase 3a — flattened here, io/errors.ts retrofit)
├── ConsumedBodyError                             (3b, new — BODY-3 second write on a single-use body)
├── MultipartBoundaryError                        (3b, new — HTTP-51 invalid caller boundary)
└── HttpStatusError                               (3b, new — BODY-30/31)
```

Grouping is restored the way the checkpoint prescribed: a `readonly kind: 'domain-model' | 'cancellation' |
'operation-assembly' | 'io' | 'body' | 'http-status'` discriminant on `DexpaceError`, or per-category type guards
(`isIoError`, etc.) where a caller needs one — never a reintroduced class tier. `HttpStatusError` carries
`readonly status: number` and the buffered body as fields, not only interpolated into `.message` (the checkpoint's
§5.3 sanitized-`readonly`-fields pattern, applied to this phase's own new error rather than re-litigated).

## Public Barrel — Resolves Phase 3a's Open Promotion Question

Phase 3a's design doc left open whether `§5` would be promoted to the public barrel, contingent on how `§6` shaped
`writeTo`. Taking the platform `WritableStream` type (above) answers it: **`io/` stays `@internal` indefinitely**
— nothing in this phase's public surface requires it.

What *does* go public, for the first time since Phase 2: the `Body` interface, its concrete variants and factory
functions, `TypedResponse`, `HttpStatusError`, and the two new error leaves a caller can actually trigger and
needs to catch — `ConsumedBodyError` (double-write on a single-use body) and `MultipartBoundaryError` (an invalid
caller-supplied boundary) — matching Phase 1's precedent that domain-model validation errors are public, not
internal. The logging tees and `toHttpError`'s internals stay `@internal` (unwired until Phase 7).
`api-extractor`'s report changes for the first time since Phase 2's own addition — this phase needs a changeset,
unlike Phase 3a's byte-identical gate.

## File Layout

```
packages/core/src/body/
  body.ts                    # Body interface, kind union
  simple-bodies.ts           # ByteArrayBody, StringBody, FormUrlEncodedBody
  stream-body.ts             # StreamBody
  multipart-body.ts          # MultipartBody, shared framing routine, boundary generation/validation
  materialize.ts             # materialize(body)
  typed-response.ts          # TypedResponse<T>
  request-body-logging.ts    # withRequestLogging tee decorator (@internal)
  response-body-logging.ts   # response-body logging wrapper, two regimes (@internal)
  http-status-error.ts       # HttpStatusError, toHttpError()
  errors.ts                  # ConsumedBodyError, MultipartBoundaryError
  index.ts                   # barrel — Body/variants/factories/TypedResponse/HttpStatusError/ConsumedBodyError/
                              # MultipartBoundaryError re-exported from src/index.ts; logging tees stay internal-only
```

Also modifies (not creates): `packages/core/src/http/request.ts` and `response.ts` (real body types replace
Phase 1's `unknown` placeholder; `Response` gains `text()`/`bytes()`/`close()`), and `packages/core/src/io/errors.ts`
(the flattening retrofit above).

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| `StreamBody` always single-use, no mark/reset replay path | `BODY-9` (SHOULD) | Node's `ReadableStream` has no generic mark/reset; a caller wanting replay materializes first or uses `ByteArrayBody` |
| `Body` as independent classes implementing a shared structural interface, no common base class | none — styleguide-mandated | `styleguide/typescript/06` §6.4 bans `extends` for anything but `Error` |
| `writeTo(sink: WritableStream<Uint8Array>)` over Phase 3a's internal `BufferedSink` | `sdk-design/03` §3.1's sketch | Keeps `io/` `@internal` indefinitely; costs each `Body` variant hand-rolled `TextEncoder` writes instead of typed helpers, which is cheap given how simple each variant is |
| Both logging tees are new, self-contained implementations, not built on Phase 3a's `TeeSink`/`BufferedSource` | none — forced by the `writeTo` decision above | `TeeSink`/`BufferedSource`/`BufferedSink` are reader/writer-bound with `ByteQueue`-and-count-shaped signatures; `Body.writeTo`'s chunk-shaped `WritableStream<Uint8Array>` doesn't compose with them without rewriting Phase 3a's frozen surface. Only `ByteQueue` (pure in-memory, unbound to a stream shape) is reused |
| Phase 3a's `IoError` tier flattened in this phase, not in 3a itself | phase-boundary discipline (each phase's own frozen surface) | The checkpoint's `§5.2` fix for `DomainModelError` missed the identically-shaped `IoError` tier; carrying the inconsistency forward into a fourth phase was judged worse than a scoped retrofit here |
| Logging tees and `toHttpError`'s preview machinery shipped `@internal`, unwired to any `Logger` | none — matches Phase 2's `Serde<T>` precedent | No `Logger`/config surface exists until Phase 7 |

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `BODY-N`/`HTTP-N` IDs it exercises.

**Property tests:**

- `materialize` under concurrent first callers — exactly one drain, every other caller observes the same
  materialized result (`BODY-3`).
- `MultipartBody` — boundary/framing round-trip for arbitrary part sets; declared length always equals bytes
  written (`HTTP-51`); a header value containing CR/LF or a quote is always escaped in the output.
- Response-body logging — for arbitrary (cap, body-size) pairs, the fits-cap and exceeds-cap regimes each hold
  (`BODY-23`/`BODY-24`), and the consumer always receives every byte of the body regardless of which regime
  triggers (`BODY-34`'s "the consumer still receives every byte" clause).
- Request-body logging tee — for arbitrary write sequences and tap caps, the primary sink always receives the
  exact concatenation of every written byte, independent of the tap (reusing Phase 3a's `TeeSink` property-test
  shape at this layer).

**Conformance example tests** transcribed directly from each `§6` *Conformance:* clause, continuing Phase 2/3a's
convention.

**Negative space:** double-close on `Response` and on both logging wrappers; write-after-consumed on a single-use
body (`ConsumedBodyError`); read-after-`toHttpError`-cap on the buffered error body.

**Mechanical gates:** the 80% aggregate coverage floor (`NFR-5`) unchanged; `api-extractor`'s report is expected
to **change** this phase (first time since Phase 2) — the checklist verifies the diff contains exactly the new
public surface named above and nothing else, with a changeset committed alongside.

## Deferred Items Produced by This Phase

Already logged in the roadmap's Deferred Items Log: `FileBody` (`HTTP-40`/`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`)
→ Phase 8.
