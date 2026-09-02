# Phase 3b — Body Lifecycle — Design

**Status:** Draft, approved for planning. Validation review 2026-07-28 returned BLOCKED; all findings applied
except **D1** (changeset bump: major vs 0.x-minor) and **D2** (three Phase-1/3a symbol names unverifiable on the
planning branch), both open in the roadmap's "Open Findings — Phase 3b Validation Review (2026-07-28)".

**Purpose:** Implement the request/response body lifecycle — body production and replayability, materialize-once,
response single-use/close, the lazy parsed-response wrapper, request/response body-logging tees, and bounded
error-body buffering — on top of a tested and frozen Phase 3a. This is the second half of Phase 3 of the
[v1 roadmap](../../2026-07-23-nodejs-sdk-v1-roadmap-design.md).

**Scope:** every requirement in `docs/product-spec/06-request-and-response-body-lifecycle.md` — `BODY-1` through
`BODY-37`, `HTTP-36` through `HTTP-52` — is dispositioned here, except the file-backed-body cluster
(`HTTP-40`/`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`), deferred to Phase 8 (see "Explicitly Out of Scope").

**Governing documents:** `docs/product-spec/06-request-and-response-body-lifecycle.md` (normative, cited by ID
throughout), `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md` §3.1, `docs/work/mvp/phase3/phase3a/2026-07-24-phase3a-io-contracts-design.md`
(the frozen surface this phase builds on and, in one place, retrofits), `docs/work/mvp/2026-07-25-checkpoint-scaffold-through-phase3a.md`
(the two-level error-hierarchy rule this phase's error tree follows), and `docs/work/mvp/phase1/2026-07-23-phase1-core-http-domain-model-design.md`
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
| HTTP-39 / BODY-10 | MUST | Exact-length verification in `StreamBody.writeTo` — a counting adapter over the sink; on a declared `contentLength >= 0`, a stream that ends short raises `EndOfStreamError(delivered, declared)`. **Not** Phase 3a's `writeAll`/`SourceContractViolationError`: those live on `BufferedSink`/`BufferedSource`, which this phase's global constraint forbids importing. A `contentLength < -1` is rejected at construction (`IO-3`) |
| HTTP-38 / BODY-35 | MUST | Body factories classify replayability by source; form-urlencoded body always replayable, `x-www-form-urlencoded` encoding |
| BODY-4, BODY-5 | MUST | 📄 Contract-obligation-only — `replayable` and idempotency-gated re-send are *consulted* by Phase 5's retry/redirect/auth. This phase guarantees the property is correct; it does not implement consultation |
| HTTP-41 / BODY-14 | MUST | `Response.body: ReadableStream<Uint8Array> \| null` — same reference returned on repeat access, not a replay |
| HTTP-41 / BODY-15, HTTP-43 | MUST | `Response.close()` — idempotent, forwards to body, releases connection whether or not body was read |
| HTTP-41 / BODY-16 | MUST | `Response.text()`/`bytes()` close the body in a finally-style guarantee, releasing the reader lock before the cancel so `close()` cannot trip `cancel()`-on-a-locked-stream |
| HTTP-42 | MUST | `text()` charset from declared media type, fallback UTF-8 |
| HTTP-44, HTTP-45 | MUST | `TypedResponse<T>` — raw fields without touching body, parse-once memoized (success and failure), concurrent-first-call serialization via a shared in-flight promise |
| BODY-17, BODY-18, BODY-19, BODY-21, BODY-37 | MUST | `withRequestLogging` tee decorator over `Body` — a self-contained tee reusing only `ByteQueue`, **not** Phase 3a's `TeeSink` class (whose `ByteQueue`-and-count signature does not compose with `writeTo`'s chunk-shaped sink; see the section below) |
| BODY-20 | SHOULD | Partial-failure snapshot returns bytes mirrored up to the failure |
| BODY-22, BODY-23, BODY-24, BODY-27, BODY-28 | MUST | Response-body logging wrapper, two regimes (fits-cap capture vs. exceeds-cap prefix+tail), shared close-once guard |
| BODY-25 | MUST | Implemented: a zero-length delegate chunk raises `SourceContractViolationError`, matching `RetentionWindow` under the identically-worded `IO-17`. `ReadableStreamDefaultReader.read()` carries no requested count, so the clause has no *literal* analog — but a response body reaches both this tee and `BufferedSource`, and the tolerant reading made the same upstream succeed or fail depending only on which wrapper it passed through. Ledger entry withdrawn (review finding, 2026-08-24) |
| BODY-26 | MUST | `LoggedResponseBody.error(): Error \| null` — the drain failure is cached in the wrapper's closure; `read()` re-throws it on every call, `snapshot()` returns the partial bytes without throwing, and `error()` surfaces it **without triggering a drain** |
| BODY-29 | SHOULD | `LoggedResponseBody.contentLength` — the captured size in the fits-cap regime, the delegate's declared length otherwise (the capture is only a bounded prefix) |
| HTTP-52 / BODY-30, BODY-31 | MUST | `toHttpError(response)` — 1 MiB fixed cap, 4xx/5xx only, buffering inside the response's own close-guaranteeing scope |
| BODY-32 | MUST | The two byte-capped capture operations this phase ships — `withRequestLogging(_, tapCapBytes)` and `withResponseLogging(_, capBytes)` — reject a negative cap at construction and silently clamp it to the platform's max single-array size. The capless-snapshot clause is inherited: every `snapshot()` here delegates to Phase 3a's `ByteQueue.snapshot()`, which already raises `AllocationLimitError` over the platform max (`IO-9`) |
| BODY-33 | SHOULD | Non-consuming error-body preview from a fresh peek view |
| BODY-34 | MUST | One shared preview-size cap threaded through **both logging tees** — request-side tee-capture and response-side drain-on-first-access take the same value. `toHttpError`'s 1 MiB error-body cap is a *separate*, `HTTP-52`-fixed constant, not the preview cap: `HTTP-52` mandates its value, so it cannot be the configurable shared one. This phase ships the parameter on both tees; Phase 7 supplies the single config value that feeds them |

## The Body Model

```typescript
interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart';
  readonly mediaType: string | undefined;
  readonly contentLength: number;      // -1 = unknown
  readonly replayable: boolean;
  /** Writes every byte, then closes `sink`. The sink is the body's to close; the caller only supplies it. */
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
```

**Absence is `undefined`, not `null`.** `styleguide/typescript/03-the-type-system.md` requires `undefined`
throughout the interior and admits `null` only where an external contract forces it. `mediaType` has no such
contract, so it is `string | undefined`, matching Phase 1's convention everywhere else in the domain model. The
one carve-out in this phase is `Response.body: ReadableStream<Uint8Array> | null`, which mirrors WHATWG `fetch`
deliberately (see "Response Body"); `TypedResponse.reason` follows `Response.reasonPhrase`'s `string | undefined`
rather than re-converting it to `null`.

**`writeTo` closes the sink it is given.** Every variant does (`writeAllBytes`' `finally`, `pipeTo`'s default
`preventClose: false`, `MultipartBody`'s outer `finally`), so this is a contract, not an accident — which is why
`MultipartBody` hands each part a non-closing adapter over the shared writer instead of the writer itself.

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
  caller-supplied, caller-owned; documented in the class's TSDoc, not inferred). When the caller declares a
  `contentLength >= 0`, `writeTo` counts forwarded bytes and raises `EndOfStreamError(delivered, declared)` if the
  stream ends short (`HTTP-39`/`BODY-10`) — `pipeTo` alone would send a truncated body silently. A
  `contentLength < -1` is rejected at construction (`IO-3`).
- `MultipartBody` — composite. `replayable` iff every part is (`BODY-2`); a single shared framing routine computes
  both `contentLength` and the bytes `writeTo` emits, so they cannot drift (`HTTP-51`). The `parts` array is
  defensively copied at construction — `readonly MultipartPart[]` is a compile-time view only, and a caller who
  mutated the array they passed would desynchronize the already-computed `contentLength`/`replayable` from the
  bytes `writeTo` emits, which is the exact drift `HTTP-51` exists to prevent (`HTTP-1`, `XCUT-15`). Boundary
  generated via `crypto.getRandomValues` (Web Crypto — portable, same rationale as `sdk-design/10`'s
  SHA-256-via-`crypto.subtle` deviation). A caller-supplied boundary is validated against RFC 2046's grammar and
  rejected otherwise (`MultipartBoundaryError`). Part-header parameter values are quoted/escaped so an embedded
  CR/LF or quote cannot break the framing.

  **`HTTP-3` requires a builder here.** `HTTP-3` names "the multipart body" in its enumerated list of
  builder-based models that MUST expose a `newBuilder()`-style derivation, and Phase 1 could not satisfy it
  because `MultipartBody` did not exist yet. So `MultipartBody` ships a `MultipartBodyBuilder` (static
  `MultipartBody.newBuilder()` plus an instance `newBuilder()` pre-populated with the current parts and boundary,
  copying the parts list), and `HTTP-2`'s "never a public field-wise constructor" is honored by keeping every
  body class's constructor out of the public barrel: the barrel exports the factory functions and the *types*,
  not the concrete classes. See "Public Barrel".
- No `FileBody` — see "Explicitly Out of Scope."

**`materialize(body: Body): Promise<Body>`** — a free function (`10.1`, matching Phase 3a's `factories.ts`
pattern), not a `Body` method. Returns the same instance unchanged if already `replayable`; otherwise calls
`body.writeTo(...)` once into a collector and returns a fresh `ByteArrayBody`. `materialize` itself holds no
consumed-once state — the guard belongs to whichever single-use `Body` variant is being drained (`StreamBody`,
below), since `writeTo` can be called directly without going through `materialize` at all, and the guard must
protect that path too. `StreamBody`'s guard is a boolean flag checked and set before its `writeTo`'s first
`await` — Node's single-threaded event loop collapses the reference's atomic-CAS requirement into this, correctly,
*only* because the check-and-flip precedes any suspension point (the established deviation from
`sdk-design-nodejs/06`; violating the ordering reintroduces the race `BODY-3` exists to prevent). A non-replayable
`MultipartBody` needs no guard of its own: it is non-replayable exactly when it contains a non-replayable part, and
that part's own guard fires on the composite's second `writeTo`, propagating up uncaught — composition is
sufficient, no redundant guard needed at the composite level.

## Response Body

```typescript
class Response {
  readonly body: ReadableStream<Uint8Array> | null;   // single-use (BODY-14)
  text(): Promise<string>;      // BODY-16, HTTP-42
  bytes(): Promise<Uint8Array>; // BODY-16
  close(): Promise<void>;       // BODY-15, HTTP-43 — the only teardown interface; see below
}
```

**Teardown is `close()` only — no `[Symbol.asyncDispose]`.** This design was written assuming the checkpoint's §5.4
fix (floor bump to the first Node release exposing `Symbol.dispose`/`Symbol.asyncDispose`, plus the matching `lib`
entry) had already landed as a prerequisite. It had not: at implementation time `engines.node` was still `">=18.17"`
and `tsconfig.base.json`'s `lib` was `["ES2022", "DOM", "DOM.AsyncIterable"]`, with none of Phase 2's `Transport` or
Phase 3a's `ByteQueue`/`BufferedSource`/`BufferedSink`/`RetentionWindow` carrying the symbol. Shipping it on
`Response` alone would have meant:

- **A run-time trap on the declared floor.** `Symbol.asyncDispose` evaluates to `undefined` below Node 18.18, so the
  computed key binds the method to the string `"undefined"` — precisely the failure Phase 3a's design named when it
  declined the symbol, and it fails silently at run time, not at build time.
- **A broken published `.d.ts`.** The symbol's *type* reaches this package only through a dev-only global. A consumer
  compiling against the built package on the same `lib` this repo declares gets
  `TS2550: Property 'asyncDispose' does not exist on type 'SymbolConstructor'`. No gate covers this —
  `verify:dual-consumption` runs `node`, not `tsc`.
- **An inconsistent taxonomy.** Two of seven resource-owning classes would have it and five would not.

So this phase keeps Phase 3a's shipped decision, and both `Response` and the response-body logging wrapper assert the
absence rather than leaving it implicit. Adding it back is checkpoint §5.4's job, in one pass across all seven owners,
once the floor actually moves. Ledgered below. `Body` itself never needed it: no variant in this phase owns a
closeable resource (`StreamBody` is explicitly caller-owned, per `BODY-8`).

Mirrors the `writeTo` decision: the public surface is the platform `ReadableStream`, not an internal wrapper.
`text()`/`bytes()` drain the reader with a plain manual chunk-accumulate-and-concatenate loop — **no `io/`
import at all**. `http/` stays exactly as dependency-free of `io/` as Phase 1 left it; pulling `ByteQueue` in here
for what's a five-line loop would create a Phase-1-reaches-into-Phase-3a edge with nothing to show for it.
`text()` decodes with `TextDecoder` using the charset from `Headers.get('content-type')` parsed via `MediaType`,
falling back to UTF-8 (`HTTP-42`). `BufferedSource`/`BufferedSink`/`TeeSink` are not reused here or anywhere in
this phase — their constructors bind to a `ReadableStreamDefaultReader`/`WritableStreamDefaultWriter` and their
`write`/`read` signatures are `ByteQueue`-and-count shaped, which doesn't fit `Body.writeTo`'s chunk-shaped
`WritableStream<Uint8Array>` or a raw `ReadableStream<Uint8Array>` without rewriting Phase 3a's frozen,
already-tested surface — off the table. `io/`'s first real consumer is instead the two logging tees below, both
in `body/`, which already legitimately depends on `io/` with no cycle risk (`io/` depends on nothing in `body/`).
**Reader-lock discipline — the one non-obvious constraint in this section.** `ReadableStream.cancel()` rejects
with `TypeError` when the stream is locked, and that check runs *before* the state check: reading a stream to
`{done: true}` does **not** release its reader's lock. So `bytes()` must call `reader.releaseLock()` as the first
statement of its `finally`, before `await this.close()` — otherwise the `finally` rejects and replaces the
successfully-read value, turning every `bytes()`/`text()` call into a `TypeError`. `close()` itself must likewise
tolerate a body locked by an *external* consumer, since `BODY-15` forbids assuming the body was read: a caller who
took `response.body.getReader()` and then calls `close()` must still get the connection released, not a
`TypeError`. The same rule governs `toHttpError`'s buffering loop and the response-logging wrapper's
`closeDelegate`.

Repeated `.body` access
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
  readonly reason: string | undefined;
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
interface LoggedBody extends Body {
  snapshot(): Uint8Array;              // BODY-19 — a copy of the tap, never a handle onto it (BODY-37)
  materialize(): Promise<LoggedBody>;  // BODY-21 — still logged, now replayable, same tap cap
}

function withRequestLogging(delegate: Body, tapCapBytes: number): LoggedBody;
```

`materialize()` is a member here, not the free `materialize(body)`, because `BODY-21` requires the materialized
form to stay wrapped and keep its tap cap — `Body` itself has no such member, so the return type cannot be
`Body & {snapshot()}`. A negative `tapCapBytes` is rejected at construction and the cap is clamped to the
platform's max single-array size (`BODY-32`).

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

**Response-body logging wrapper (`BODY-22`–`29`):**

```typescript
interface LoggedResponseBody {   // close() only — same reason as Response, above
  read(): Promise<ReadableStream<Uint8Array>>;
  snapshot(): Uint8Array;              // non-consuming; partial bytes even after a failed drain (BODY-26)
  error(): Error | null;               // the cached drain failure, WITHOUT triggering a drain (BODY-26)
  readonly contentLength: number;      // captured size iff fits-cap, else the delegate's declared (BODY-29)
  close(): Promise<void>;
}

function withResponseLogging(delegate: ReadableStream<Uint8Array>, capBytes: number): LoggedResponseBody;
```

Wraps the raw `ReadableStream<Uint8Array>` before it reaches
`Response.body`. Also self-contained for the same reason — `BufferedSource`'s reader-bound constructor and
cursor/view machinery solve a more general N-view problem this wrapper doesn't have. Uses a `ByteQueue` for the
captured prefix, its own `ReadableStreamDefaultReader` loop, and its own close-once boolean. Lazy — drains only on
first `read()`/`snapshot()`, serialized so the upstream is read exactly once. `error()` deliberately does **not**
drain (`BODY-26`): it reports only what a drain that already ran observed. Two regimes:

- Fits the cap (EOF before the cap, `BODY-23`) — capture entirely, close the delegate, serve every later read as a
  fresh non-consuming view.
- Exceeds the cap (`BODY-24`) — buffer only the prefix, delegate stays open, exactly one more read is allowed
  (replays the prefix, then continues from the live tail); a second read after that fails.

The exceeds-cap tail stream pulls one chunk per `pull()` rather than looping inside `start()`, so backpressure
reaches the delegate and the *un*captured tail is never materialized in memory — an eager `start()` loop would
buffer the whole remainder of exactly the oversized bodies the cap exists to keep off the heap.

A drain failure is cached rather than propagated-and-forgotten (`BODY-26`): `read()` re-throws it on every call,
`snapshot()` returns the bytes captured before it without throwing, and `error()` returns it. Partial capture is
never silently presented as a complete body.

Delegate `close()` is called at most once across every close path (the wrapper's own close and the one-shot
tail's close share one close-once guard, `BODY-27`) — a plain boolean, the same single-thread collapse as
`materialize`'s guard, not a CAS. As with `Response.close()`, the reader's lock is released before the delegate
is cancelled: `ReadableStream.cancel()` rejects with `TypeError` on a locked stream, and a `finally`-scoped close
that trips this turns every successful read into a rejection.

## Bounded Error-Body Buffering (`toHttpError`)

```typescript
function toHttpError(response: Response): Promise<HttpStatusError | null>;
```

A free function, not a `Response` method — keeps `Response` itself ignorant of status semantics. Returns `null`
for any status outside 400–599 (`BODY-31`, using `HTTP-11`'s classification — *not* a bare `code < 400`, which
would sweep a non-standard 6xx that `HTTP-10` requires `Status.of` to accept into the error path and consume a
body `BODY-31` says must be returned intact); otherwise buffers at most a fixed 1 MiB cap of the body, re-serves
it as a replayable `ByteArrayBody`-backed body on the returned error, and drops anything beyond the cap.
Buffering happens inside the original response's own close-guaranteeing scope, so a buffer-allocation failure
still releases the connection (`HTTP-52`/`BODY-30`) — and that scope releases the body reader's lock before
closing, per the `Response.close()` note above. Preview reads (`BODY-33`) are non-consuming, from a fresh peek
view — `null` for no body, empty for exhausted.

The 1 MiB cap here is **not** `BODY-34`'s shared preview-size cap: `HTTP-52` fixes its value, so it cannot be the
configurable one. `BODY-34`'s single shared cap covers the two logging tees, which take it as a parameter this
phase and receive one config value from Phase 7.

## Error Tree — Flattened, Including a Phase 3a Retrofit

The checkpoint (`2026-07-25-checkpoint-scaffold-through-phase3a.md` §5.2) required flattening
`DexpaceError → DomainModelError → Leaf` to `DexpaceError → Leaf` because the corpus caps custom error hierarchies
at two levels. Phase 3a's `IoError` tier (`DexpaceError → IoError → EndOfStreamError`, etc.) is the identical
shape and was not caught by that review — an oversight, not a sanctioned exception, since nothing in `§5.2` or
elsewhere in the checkpoint names `IoError` as exempt. This phase fixes both in one pass rather than shipping a
third instance of the same violation:

```
DexpaceError                                    (Phase 2 root)
├── DomainModelError                            (Phase 1 — checkpoint §5.2 has NOT run; still a
│   └── RequiredFieldError, HeaderValidationError, …   class tier. See the note below the diagram)
├── CancellationError, OperationAssemblyError     (Phase 2, already flat)
├── IoError                                       (Phase 3a — unchanged; already a flat leaf, used bare
│                                                    at 4 sites in buffered-source/-sink.ts, tee-sink.ts
│                                                    for generic io-layer failures)
├── EndOfStreamError, SourceContractViolationError,
│   ClosedResourceError, AllocationLimitError     (Phase 3a — retrofit: `extends IoError` becomes
│                                                    `extends DexpaceError`, sibling of IoError not its
│                                                    child; zero changes to the 3 files above)
├── ConsumedBodyError                             (3b, new — BODY-3 second write on a single-use body)
├── MultipartBoundaryError                        (3b, new — HTTP-51 invalid caller boundary)
└── HttpStatusError                               (3b, new — BODY-30/31)
```

**The Phase 1 tier is still three deep.** This section assumed checkpoint §5.2 had already removed
`DomainModelError` as a class tier. It has not run, so after this phase's retrofit the taxonomy is *mixed*:
`DexpaceError → EndOfStreamError` is two levels while `DexpaceError → DomainModelError → RequiredFieldError` is
still three. That is strictly better than before — the `io/` leaves no longer add a *second* independent violation —
but it is a real residual, and it is deliberately **not** fixed here: removing `DomainModelError` deletes a class
exported from the public barrel that consumers can `instanceof`, which is a breaking API change belonging to
checkpoint §5.2, not to a body-lifecycle phase. Ledgered below and owned by the checkpoint (roadmap finding E2).

A second checkpoint item lives in the same file and should be done in the same pass: §5.3 requires every error
leaf to carry its identifying inputs as sanitized `readonly` fields, and it was applied to two of the ten Phase 1
leaves and stopped (roadmap finding E3). Whoever opens `http/errors.ts` for the flattening is already touching
every class E3 names.

Grouping is restored the way the checkpoint prescribed, and lands on the lighter of its two sanctioned options:
an exported type-guard union per category (`isIoError(e): e is IoError | EndOfStreamError | ...`, `isBodyError(e):
e is ConsumedBodyError | MultipartBoundaryError`) rather than a `kind` discriminant field on `DexpaceError` — the
guard needs no constructor-signature change on any existing leaf across three already-written phases, where a
discriminant field would. `HttpStatusError` carries
`readonly status: number` and the buffered body as fields, not only interpolated into `.message` (the checkpoint's
§5.3 sanitized-`readonly`-fields pattern, applied to this phase's own new error rather than re-litigated).

## Public Barrel — Resolves Phase 3a's Open Promotion Question

Phase 3a's design doc left open whether `§5` would be promoted to the public barrel, contingent on how `§6` shaped
`writeTo`. Taking the platform `WritableStream` type (above) answers it: **`io/` stays `@internal` indefinitely**
— nothing in this phase's public surface requires it.

What *does* go public, for the first time since Phase 2: the `Body` interface, the *types* of its concrete
variants and their factory functions, `MultipartPart`, `MultipartBodyBuilder`, `materialize`, `TypedResponse`,
`HttpStatusError`/`toHttpError`, and the error leaves a caller can actually trigger and
needs to catch — `ConsumedBodyError` (double-write on a single-use body), `MultipartBoundaryError` (an invalid
caller-supplied boundary), and `FormBodyValidationError` (a form field that cannot be rendered) — matching Phase 1's
precedent that domain-model validation errors are public, not internal. `formUrlEncodedBody`'s input widened past
this design's `ReadonlyMap<string, string>` during implementation, which brings `FormUrlEncodedInput` and
`FormUrlEncodedValue` public alongside it; both are ledgered below.

**Every public symbol carries a TSDoc block**, including each member of each exported class and interface.
`api-extractor` records an undocumented reachable member as `(undocumented)` in the committed report, so the
enforcement point is mechanical: `packages/core/etc/core.api.md` must contain zero occurrences of that marker, and
`bun run api` fails CI on any drift. It is also the gate for `HTTP-2`: a `constructor(...)` line appearing under a
class the barrel exports **as a value** means a public field-wise constructor escaped the builder, and the private
constructor plus its `createX` friend hook is what keeps it out. The logging tees and `toHttpError`'s internals stay `@internal` (unwired until Phase 7).

**Two consequences a barrel edit alone won't enforce.** First, the concrete body *classes* are exported as types
only, never as values: exporting the class exposes `new ByteArrayBody(...)` as a public field-wise constructor,
which `HTTP-2` forbids and which duplicates the factory functions for no stated need (`NFR-3`,
`api-design.md`'s "default to unexported"). Second, `ConsumedBodyError`, `MultipartBoundaryError`, and
`isBodyError` must **not** carry `@internal` in their TSDoc — `api-extractor` strips `@internal` symbols from the
rollup and reports an error when one is reachable from the entry point, so tagging them internal and then
promoting them makes the gate either fail or silently omit them from the report diff this phase expects to grow.

`api-extractor`'s report changes for the first time since Phase 2's own addition — this phase needs a changeset,
and it is a **major** bump, not minor: `RequestBuilder.body`'s parameter narrows from `unknown` to
`Body | undefined`, and `api-design.md` classes a narrowed parameter type as breaking. The "unknown accepted
nothing usable" argument is false — `.body('x')` compiled before and does not now.

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
  errors.ts                  # ConsumedBodyError, MultipartBoundaryError, FormBodyValidationError
  write-body.ts              # withBodyWriter — the one writer scope every variant shares
  media-type-safety.ts       # header-safety validation for a Body's media type
  freeze-body.ts             # freezeBody — HTTP-1's freeze, single-sourced
  index.ts                   # barrel — Body/variants/factories/TypedResponse/HttpStatusError/ConsumedBodyError/
                              # MultipartBoundaryError/FormBodyValidationError re-exported from src/index.ts;
                              # logging tees stay internal-only
```

The last three files are not in this design's original plan; each earned its place during implementation and is
ledgered below. They exist as named modules rather than inlined code for the same reason `io/limits.ts`'s
`assertAllocatable` does: each encodes a rule applied at four or five call sites, and a rule applied in five shapes
is a rule that drifts.

Also modifies (not creates): `packages/core/src/http/request.ts` and `response.ts` (real body types replace
Phase 1's `unknown` placeholder; `Response` gains `text()`/`bytes()`/`close()`), a new
`packages/core/src/http/charset.ts` (`HTTP-42`'s charset resolution, shared by `Response.text()` and
`HttpStatusError.preview()`), and `packages/core/src/io/errors.ts` (the flattening retrofit above).

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| `StreamBody` always single-use, no mark/reset replay path | `BODY-9` (SHOULD) | Node's `ReadableStream` has no generic mark/reset; a caller wanting replay materializes first or uses `ByteArrayBody` |
| `Body` as independent classes implementing a shared structural interface, no common base class | none — styleguide-mandated | `styleguide/typescript/06` §6.4 bans `extends` for anything but `Error` |
| `writeTo(sink: WritableStream<Uint8Array>)` over Phase 3a's internal `BufferedSink` | `sdk-design/03` §3.1's sketch | Keeps `io/` `@internal` indefinitely; costs each `Body` variant hand-rolled `TextEncoder` writes instead of typed helpers, which is cheap given how simple each variant is |
| Both logging tees are new, self-contained implementations, not built on Phase 3a's `TeeSink`/`BufferedSource` | none — forced by the `writeTo` decision above | `TeeSink`/`BufferedSource`/`BufferedSink` are reader/writer-bound with `ByteQueue`-and-count-shaped signatures; `Body.writeTo`'s chunk-shaped `WritableStream<Uint8Array>` doesn't compose with them without rewriting Phase 3a's frozen surface. Only `ByteQueue` (pure in-memory, unbound to a stream shape) is reused |
| Phase 3a's `IoError` tier flattened in this phase, not in 3a itself | phase-boundary discipline (each phase's own frozen surface) | The checkpoint's `§5.2` fix for `DomainModelError` missed the identically-shaped `IoError` tier; carrying the inconsistency forward into a fourth phase was judged worse than a scoped retrofit here |
| Logging tees and `toHttpError`'s preview machinery shipped `@internal`, unwired to any `Logger` | none — matches Phase 2's `Serde<T>` precedent | No `Logger`/config surface exists until Phase 7 |
| `BODY-34`'s shared preview cap covers the two logging tees only, not `toHttpError` | `BODY-34` (MUST), read literally as "all three" | `HTTP-52` *fixes* the error-body cap at 1 MiB, so it cannot also be the configurable shared value. The two capture sites `BODY-34` actually names — request-side tee and response-side drain — do share one cap |
| Concrete `Body` classes exported from the public barrel as types only, never as values | none — required by `HTTP-2` | Exporting the class as a value publishes a field-wise constructor, which `HTTP-2` forbids; the factory functions are the sanctioned construction path and the classes remain usable as type annotations |
| `close()` only, no `[Symbol.asyncDispose]`, on `Response` and `LoggedResponseBody` | this design's own §"Response Body", which assumed checkpoint §5.4 had landed | The checkpoint has not run: `engines.node` is still `">=18.17"` and `lib` carries no `esnext.disposable`. Below Node 18.18 the computed key evaluates to `undefined` and binds the method to the string `"undefined"`; and the symbol's type reaches this package only through a dev-only global, so a consumer compiling against the published `.d.ts` on this repo's own declared `lib` fails with `TS2550`. Two of seven resource owners would have carried it. Matches Phase 3a's shipped decision; **owned by checkpoint §5.4**, to be added to all seven at once |
| Phase 1's `DomainModelError` tier left three-deep while `io/`'s leaves are flattened | checkpoint §5.2, which this design's error-tree diagram assumed had already run | Removing `DomainModelError` deletes a barrel-exported class consumers can `instanceof` — a breaking API change that belongs to the checkpoint, not to a body phase. The residual is a *mixed* taxonomy, strictly better than the two independent violations that preceded it. **Owned by checkpoint §5.2** |
| `write-body.ts` — one shared `withBodyWriter` scope for all five variants | this design's File Layout, which had each variant close its own sink | The naive `try { … } finally { await writer.close() }` is wrong twice: closing an already-errored writer rejects with `TypeError`, and a throwing `finally` *replaces* the in-flight exception, destroying the real cause (`RECOV-12`) — which also declassifies the failure for `RETRY-2`'s cause-chain walk. Aborting rather than closing on failure additionally tells the transport the message is broken, where a clean close would signal a complete body that was never written |
| `media-type-safety.ts` — `Body.mediaType` validated as header-safe at construction | none — closes a `HTTP-51` header-injection hole this design did not anticipate | `mediaType` is interpolated verbatim into a multipart part header, so a CR/LF in it can append arbitrary headers, close the header block, and forge a closing boundary — while the shared framing routine keeps the declared length consistent with the corrupted bytes. Uses the same predicate as outbound header-value validation (`HTTP-26`). `headerSafeMediaType` is the inbound counterpart: `HTTP-19` lets a received `content-type` carry obs-text that `HTTP-18` forbids outbound, so `HttpStatusError.body()` drops it rather than raising from an accessor on an error object |
| `freeze-body.ts` — every `Body` variant frozen at construction | this design, which specified no freeze | `readonly` is erased at run time, so a caller could reassign `contentLength` after construction and desynchronize the value a transport stamps into `Content-Length` from the bytes `writeTo` emits. That is the same drift `HTTP-51` makes `MultipartBody` share one framing routine to prevent and `HTTP-1`/`XCUT-15` make it defensively copy its parts for — left open one level up. Matches the `Object.freeze(this)` step every `packages/core/src/http/` model already performs |
| `http/charset.ts` — `HTTP-42`'s charset resolution extracted and shared | this design, which put the charset logic inside `Response.text()` | `HttpStatusError.preview()` needs the identical resolve-then-fall-back-to-UTF-8 rule (`BODY-33`), and two copies of a fallback chain drift. Named `decodeBodyText`, **not** `decodeText`: `io/text-codec.ts`'s `decodeText` deliberately implements true ISO-8859-1 and sets `ignoreBOM` for per-fragment decoding (`IO-13`, `SSE-12`), while this one delegates to `TextDecoder`'s windows-1252 mapping and consumes a leading BOM, which is right for a whole message body. The two are not interchangeable and the names now say so |
| `FormBodyValidationError` public, and `formUrlEncodedBody` accepts `FormUrlEncodedInput`/`FormUrlEncodedValue` | this design's `formUrlEncodedBody(params: ReadonlyMap<string, string>)` | A field value that is neither a primitive nor `null` cannot be rendered; dropping it silently puts an incomplete body on the wire, so it is raised naming the key. Widening the input to `QueryParams`, a map, a record, or entry pairs reuses Phase 1's `QueryParams` encoder rather than a second hand-rolled one, which is also what makes the `+`-for-space rule single-sourced (`HTTP-38`/`BODY-35`) |
| `StringBody.mediaType` defaults to `text/plain; charset=utf-8`; `StringBody.text` and `FormUrlEncodedBody.params` are public fields | this design, which defaulted `mediaType` to `undefined` and exposed neither field | The default states the encoding `writeTo` actually emits instead of leaving a text body with no declared type. The two readable fields are the non-destructive way to inspect a body a caller already holds — the alternative is draining it, which for a `Body` is the one thing an inspection must not do |
| `Response.close()` memoized on a promise rather than a boolean flag | this design's `#closed = false` sketch | A flag set before the `await` reports a FAILED release as success to every later caller, over a connection that was never released. Handing every caller the same promise propagates the failure on every path while still cancelling at most once — the shape `BufferedSink.close()` already settled on for `IO-5`/`IO-41` |
| `TypedResponse`'s raw fields are getters, not constructor-assigned `readonly` fields | this design's class sketch | Same observable surface; delegating to the wrapped `Response` keeps the two from being able to disagree. `value()` additionally wraps the parse in an `async` IIFE so a parser that throws *synchronously* is still memoized — a bare `??=` never completes the assignment in that case and re-runs the handler against a single-use body whose bytes are gone, which `HTTP-44` forbids |
| `assertCount` hoisted into `io/limits.ts`, and `TeeSink.write` gained it | Phase 3a's frozen surface | `IO-3`'s guard existed as three byte-for-byte copies (`byte-queue.ts`, `buffered-source.ts`, `buffered-sink.ts`) and `TeeSink` — the fourth size-taking surface — had none, so a negative count reached it and was rejected only indirectly, by whichever `ByteQueue` call happened to run first, and not at all on its `count === 0` and short-source early returns. Behavior-preserving for the three that had it |
| `BODY-25`'s zero-chunk check applied on the exceeds-cap tail path too, not only in `drainOnce` | the first implementation of this design's two-regime wrapper | A rule enforced in one regime and not the other makes the same violating upstream pass or fail depending only on how big the body happened to be |
| `MultipartBody.writeTo` verifies the bytes it writes against its own declared `contentLength` | this design, which treated the shared framing routine as sufficient | The shared routine keeps the *framing* consistent but takes each part's own `contentLength` on trust — and `MultipartPart.body` is the `@public` `Body` interface, so a caller-supplied implementation can report one length and write another. Measured drift on a one-part body: declared 59, written 63. A bounded writer now refuses a chunk that would carry the message past the declared total (early, for the reason `StreamBody.#writeExactly` checks early) and a short total raises inside the writer scope so the sink is aborted rather than cleanly closed |
| A caller-supplied multipart boundary is validated for grammar only, not for non-appearance in part content | `HTTP-51`'s "caller-boundary validation", read as covering RFC 2046's full sender obligation | RFC 2046 puts two duties on the sender: a `bchars`-valid delimiter, and one that appears in no part. Only the first is checkable here — a `StreamBody` part's bytes do not exist until the write, so a scan would be a *partial* check that reads as complete, which is worse than a stated limitation. Mitigated where it matters: the default boundary is 32 random characters from Web Crypto and is generated unless the caller opts out, and both entry points now document the obligation a caller-supplied delimiter carries. A caller who supplies a guessable boundary alongside attacker-influenced part content can have that content forge a closing delimiter |
| `Response.bytes()`/`text()` and `toHttpError` acquire the body reader *inside* the try | the first implementation, which acquired it above | `getReader()` itself throws a `TypeError` when an external consumer already holds the lock, and `BODY-15` forbids assuming the body was never touched — so the one failure `BODY-16`'s close guarantee most needs to cover was the one that skipped the close entirely and held the connection |
| The request-logging tee closes the primary sink when a delegate resolves without closing the adapter | none — closes a hole in this design's own decorator | `Body.writeTo`'s contract is that the body closes the sink it was given, and this wrapper is the only place that takes a writer on behalf of someone else's `Body`. A delegate that just resolves would strand the caller's sink open and locked with nothing thrown to notice it by |
| A foreign primitive source that over-reports its transferred count raises `SourceContractViolationError`, not `EndOfStreamError` | Phase 3a's `factories.ts`, which left the over-report direction to `ByteQueue.takeBytes` | It surfaced as `end of stream: delivered 2 of 99 bytes` — reporting a foreign source's broken accounting as an exhausted stream, which is the exact confusion `IO-17` forbids. The under-report direction already had `assertDrained`; the file's own comment claimed both were covered |
| New blocking gate `verify:consumer-types` | none — this is the gate whose absence let the `Symbol.asyncDispose` defect ship | It compiles a throwaway consumer against the built `.d.ts` using the `lib`/`target` read from `tsconfig.base.json`, with `types: []`. `typecheck` passes on dev-only ambient globals, `build` emits regardless, `api` only compares a report, `lint:publish` checks resolution and export shape rather than whether declarations resolve, and `verify:dual-consumption` runs `node`, not `tsc`. Verified to fail on the reintroduced defect and pass once reverted |

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `BODY-N`/`HTTP-N` IDs it exercises.

**Assertion density (`styleguide/typescript/05` §5.7, Rule 8):** `invariant` postconditions on every function
that computes a derived value — `materialize` (`bytes.length === total`), `computeContentLength` (result is `-1`
or `>= trailer.length`), `drainOnce` (`captured.size <= capBytes`), `toHttpError`'s buffer loop
(`total <= ERROR_BODY_CAP_BYTES`) — and `invariant` preconditions on the two cap parameters. A phase averaging
zero assertions per function does not meet the corpus minimum of two.

**Property tests** (`fast-check`; the corpus requires one for every serializer and invariant-bearing function).
Each is a real step in the plan's corresponding task, not an aspiration recorded only here:

- `materialize` under concurrent first callers — exactly one caller drains and returns the materialized body;
  every other observes `ConsumedBodyError` (`BODY-3`). Note this is *not* "every caller observes the same
  result": the guard lives on `StreamBody`, so the losers fail loudly rather than sharing the winner's outcome.
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
