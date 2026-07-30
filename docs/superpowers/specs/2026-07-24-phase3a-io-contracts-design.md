# Phase 3a — I/O Contracts — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the byte-streaming primitives — `ByteQueue`, `BufferedSource`/`BufferedSink`, the
non-consuming peek/slice views, `TeeSink`, the pump, and the provider factories — that Phase 3b's bodies, Phase 6's
SSE and serde, and Phase 8's transports all read and write through. This is the first half of Phase 3 of the
[v1 roadmap](./2026-07-23-nodejs-sdk-v1-roadmap-design.md), building on Phase 2's seam contracts.

**Scope:** every requirement in `docs/product-spec/05-i-o-contracts.md` — `IO-1` through `IO-42`, both MUST and
SHOULD level — is dispositioned here. Most are implemented; three groups are deliberately not built and one is not
applicable, each with a stated reason in the table below. "Dispositioned in full" is the claim, not "implemented in
full."

**Governing documents:** `docs/product-spec/05-i-o-contracts.md` (normative, cited by ID throughout),
`docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md` §3.1 (the Web Streams mapping this design follows),
and `docs/superpowers/specs/2026-07-23-phase2-seam-foundations-design.md` (the `DexpaceError` root and the
barrel-as-enforcement-point precedent this phase reuses). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 10, 11, 12, 13, 15.

## Why Phase 3 Is Split

The roadmap's Phase 3 carries roughly 79 normative IDs — `IO-1`–`IO-42` from product-spec §5, plus `BODY-1`–`BODY-37`
and `HTTP-36`–`HTTP-52` from §6. Phase 1 carried about 50; Phase 2 shipped interfaces only, so nothing behavioral
could be tested there at all. Every ID here is real behavior with a real conformance test.

The two halves have a clean one-way dependency: §5 is byte primitives with zero HTTP knowledge, §6 is the body
lifecycle built entirely on top of them. So Phase 3 executes as two spec/plan cycles:

- **Phase 3a (this document)** — product-spec §5, `IO-1`–`IO-42`.
- **Phase 3b** — product-spec §6, `BODY-*` and `HTTP-36`–`HTTP-52`, starting against a tested and frozen 3a.

The roadmap's phase *number* stays 3; the sub-phases are the unit of execution. Splitting means 3b's design
decisions are made against a surface that exists and is tested, rather than one still being shaped underneath them.

## Explicitly Out of Scope

Deferred to **Phase 3b**, all already tracked in the roadmap's Deferred Items Log:

- `MultipartBody` (deferred out of Phase 1) — a §6 body model, not a §5 primitive.
- The `Request`/`Response` real body type, currently Phase 1's `unknown` placeholder.
- Every buffering **cap**: `BODY-19`'s configurable tap cap, `BODY-30`/`HTTP-52`'s 1 MiB error-body cap, and
  `BODY-34`'s single shared preview-size configuration. See "Retention is uncapped in §5" below — this is a
  deliberate placement, not an omission.

The roadmap's existing log row "Byte-stream provider implementation (`ByteQueue`, `BufferedSource`/`Sink`,
`TeeSink`) → Phase 3" splits accordingly: the implementation is 3a, the caps and body wiring are 3b.

## Requirement Disposition

Every `IO-N`, and how this phase discharges it.

| ID | Level | Disposition |
|---|---|---|
| IO-1, IO-2 | MUST | `ByteQueue.read` / `BufferedSource.read` — tail-append, transferred count, `0` for a 0-count read, `END_OF_STREAM` at end |
| IO-3 | MUST | `invariant` on every size-taking method, before any transfer |
| IO-4 | MUST | `BufferedSink.write` / `ByteQueue.write` — exact head removal, `EndOfStreamError` rather than a partial write |
| IO-5, IO-18 | MUST / SHOULD | `flush()` and `emit()` on the sink surface; both no-ops returning `this` on a pure in-memory sink |
| IO-6 | MUST | Wrapper ownership — `BufferedSource.close()` cancels the reader, releasing the caller's stream; `BufferedSink.close()` closes the caller's stream; the IO-16 bridges close their owning source/sink. Wrapping a byte array owns no external resource |
| IO-7–IO-10 | MUST / SHOULD | `ByteQueue` — FIFO source+sink, non-consuming `snapshot()`/`copyTo()`, `clear()`, `AllocationLimitError` |
| IO-11, IO-12, IO-14, IO-15 | MUST | `BufferedSource` typed reads, line reads, exact reads, skip |
| IO-13 | MUST | Read side fully general via `TextDecoder` (`BufferedSource`); **write side bounded to UTF-8 and ISO-8859-1** (`BufferedSink`) — `TextEncoder` is UTF-8-only and `SEAM-1` forbids an encoding dependency, so the "symmetric write-side encodings" clause is only partly satisfiable. Ledgered |
| IO-16 | SHOULD | `toReadableStream()` / `toWritableStream()` — see "Host-native means Web Streams" |
| IO-17 | MUST | `writeAll()` in `pump.ts`; a zero-read for a positive request raises `SourceContractViolationError` |
| IO-19–IO-24 | MUST | `peek()` / `slice()` as cursors over a shared `RetentionWindow` |
| IO-25–IO-29 | MUST | `TeeSink` as a `BufferedSink` decorator |
| IO-30 (factory half) | MUST | Named free functions in `factories.ts` |
| IO-30 (resolution half), IO-31–IO-36, IO-39 | MUST / SHOULD | **Not built** — no registry exists; same class as `SEAM-5`–`SEAM-10`. `IO-30` defers provider resolution to `IO-31`–`IO-36`, which are `SEAM-5`–`SEAM-10`'s precedence, idempotence, caching, warning, and de-dup rules restated for the I/O provider; with one always-present implementation there is nothing to resolve |
| IO-37 | MUST | Satisfied by the event-loop model outright |
| IO-38 | MUST | **Not applicable** — no instance in this layer crosses a worker boundary at all (see below) |
| IO-40 | MUST | No timeout, and no `AbortSignal`, anywhere in this layer |
| IO-41, IO-42 | MUST | Idempotent close everywhere; post-close rejection on stream-backed surfaces, with `ByteQueue`'s carve-out honored |

## Foundational Decision: Sync `ByteQueue`, Async `Buffered*`

§5 is a transcription of a *blocking* byte-stream contract — `IO-11` says `exhausted()` "may block waiting on an
upstream source." Node has no blocking reads. But `IO-7` requires a buffer that is simultaneously a source and a
sink, and a pure in-memory buffer has nothing to wait for.

Forcing one shape onto both is the trap. A uniform async `Source`/`Sink` interface makes `ByteQueue` return an
already-resolved promise on every read — a Promise allocation on the hottest data structure in the SDK, against
styleguide 15.4 — and turns every downstream synchronous consumer (charset decode, SSE line splitting) async for no
I/O reason.

So the surface splits by what actually waits:

```typescript
// ByteQueue — pure memory, synchronous (IO-7–IO-10)
class ByteQueue {
  read(dest: ByteQueue, count: number): number;
  write(src: ByteQueue, count: number): void;
  snapshot(): Uint8Array;
  copyTo(dest: ByteQueue, offset: number, count?: number): void;
  get size(): number;
}

// BufferedSource — wraps a stream reader, asynchronous (IO-11–IO-24)
class BufferedSource {
  read(dest: ByteQueue, count: number): Promise<number>;
  readExactly(count: number): Promise<Uint8Array>;
  readUtf8Line(): Promise<string | undefined>;
  peek(): BufferedSource;
  slice(offset: number, count: number): BufferedSource;
}
```

`IO-7`'s "simultaneously a source and a sink" is satisfied by `ByteQueue`'s own synchronous surface, not by making
it implement an async interface it has no use for. This also matches styleguide 6.3's split: `BufferedSource` is a
stateful lifecycle resource and is a class for that reason; `ByteQueue` is a data structure.

Recorded as a deviation from the reference's shape (not its behavior) in the ledger below.

## Retention Is Uncapped in §5

`sdk-design/03` §3.1 already fixes the mechanism: peek and slice are "thin cursors over the same `ByteQueue` rather
than re-reading the underlying stream." The consequence §3.1 does not spell out is that the `ByteQueue` stops being
a pure FIFO. Bytes must be retained from `min(all live cursors)` forward, so an outstanding view pins everything the
parent has already read past.

That looks like an unbounded buffer, which styleguide 9.12 and 13.6 forbid — and `IO-19`'s peek is "over the whole
remaining source," which on a chunked response body is genuinely unbounded. The obvious fix, a `maxRetainedBytes`
cap on `BufferedSource`, was considered and **rejected**.

It was rejected because it is a real conformance loss for no gain in placement. Such a cap does not bound how far a
view may read; it bounds the *spread* between the fastest and slowest cursor (`max(pulled) − min(cursor)`). A view
reading in lockstep with its parent accrues nothing; a view racing ahead while the parent sits still accrues the
whole body. In that divergent case the view cannot reach the end, so `IO-19`'s MUST is partially unsatisfied — and
`sdk-design/03` §3.1 independently commits to satisfying "the behavioral contract — `IO-1` through `IO-42`," so it
would be a deviation from the port's own design document too.

And the placement is wrong. **Every buffering cap the product spec mandates sits in §6, not §5**: `BODY-19`'s tap
cap, `BODY-30`/`HTTP-52`'s 1 MiB error-body cap, `BODY-34`'s shared preview-size configuration. §5 is left unbounded
deliberately — it is a primitive, and the policy belongs at the layer facing untrusted input.

So §5 stays literally conformant and uncapped, and the caps land in 3b where the spec already requires them. This
costs nothing in safety: every in-SDK consumer of `peek()` is bounded by construction — 3b's bodies by
`BODY-19`/`BODY-30`/`BODY-34`, Phase 6's SSE reads per line. The residual exposure is an *external* caller reaching
for `peek()` directly, which is mitigated by TSDoc and, decisively, by this phase publishing nothing at all (below).

## Nothing Enters the Public Barrel

Every type in this phase lives in `packages/core/src/io/` and exports from `src/io/index.ts` for internal use. **None
reaches `packages/core/src/index.ts`.** All are marked `@internal`.

This follows styleguide 10.3 ("export the least; start private and promote deliberately") and reuses Phase 2's
enforcement point: what is not in the package barrel is not API, and can be reshaped later with no changeset. Phase 2
used exactly this lever to keep `Serde<T>` reshapeable for Phase 6.

Three reasons it is right here specifically:

1. **Nothing outside the SDK can use these types until 3b exists.** There is no body layer yet, so there is no
   supported path by which a consumer would obtain a `BufferedSource`.
2. **3b has a real choice that publication would foreclose.** `BODY-1` says a request body produces bytes "via a
   single write-to-sink operation" — if 3b shapes that as `writeTo(sink: BufferedSink)`, §5 leaks into the public
   surface; if it shapes it as `writeTo(sink: WritableStream<Uint8Array>)`, using the platform type, §5 never
   surfaces at all. That decision belongs to 3b, made against a real consumer.
3. **Freezing 42 requirements' worth of shape into `api-extractor` before one consumer exists is premature.**

The mechanical consequence is a test in its own right: `api-extractor`'s committed report must come back
**byte-identical** after this phase. An unchanged report is machine-checked proof that the internal-only decision
held.

## Teardown Is `close()`, Not `Symbol.asyncDispose`

Styleguide 13.2 mandates that owned resources implement `Symbol.dispose`/`Symbol.asyncDispose`, and 13.1 requires
`esnext.disposable` in `lib`. `IO-5` and `IO-41` mandate a closeable, idempotent `close()`. 13.2 explicitly sanctions
carrying both — "make `[Symbol.dispose]` delegate to it so there is one teardown path."

The blocker is the runtime floor. `engines.node` is `">=18.17"`, and `Symbol.asyncDispose` shipped in Node well
after 18.17.0. TypeScript does **not** polyfill the symbol for a library *declaring* the method — it only injects
`__addDisposableResource` helpers at `using` call sites. So on Node 18.17 the computed key `[Symbol.asyncDispose]`
evaluates to `undefined` and the method binds to the string key `"undefined"`: wrong, silent, and only at run time.

Phase 2 declined `Symbol.asyncDispose` on `Transport` for the adjacent reason (an ES2022-plus `lib` requirement in
the public surface). This phase follows that precedent, so the SDK has one teardown idiom rather than two.
Consumers cannot write `await using` against these types — which costs nothing today, since these types are not
public. Revisit when the floor moves.

**Prerequisite:** the `actions/setup-node@18.17` CI conformance step, which the roadmap pulled forward into Phase 2.
This decision rests on that floor being real, and a floor that is load-bearing for a runtime API fails at run time,
not at build time.

## File Layout

Dependency direction is strictly downward; no cycles (12.5).

```
packages/core/src/io/
  limits.ts            # MAX_BYTE_ARRAY_LENGTH (IO-9), END_OF_STREAM (IO-1)
  errors.ts            # IoError tree, rooted at Phase 2's DexpaceError
  byte-queue.ts        # ByteQueue — sync FIFO source+sink   (IO-7–IO-10, IO-41/42)
  retention-window.ts  # pulled-byte window + cursor set      (IO-19–IO-23 mechanics)
  buffered-source.ts   # BufferedSource + SourceView          (IO-1–IO-3, IO-11–IO-16, IO-19–IO-24)
  buffered-sink.ts     # BufferedSink                         (IO-4–IO-5, IO-18, IO-41/42)
  tee-sink.ts          # TeeSink                              (IO-25–IO-29)
  pump.ts              # writeAll                             (IO-17)
  factories.ts         # provider factories                   (IO-30, factory half)
  index.ts             # internal barrel — NOT re-exported from src/index.ts
  byte-queue.bench.ts  # mitata baseline, no optimization     (styleguide 15.6)
  test-support/        # fake streams; excluded from the build
```

`SourceView` colocates with `BufferedSource` rather than taking its own file. A view *is* a source over the same
window, and `peek()`/`slice()` return one, so separate files would import each other — a cycle. Colocation removes
it without an interface-indirection layer, and 12.3 groups by feature, which this is.

## Component Design

### `limits.ts`

`END_OF_STREAM = -1`. The spec-literal numeric protocol is kept rather than an idiomatic `number | undefined`,
because `IO-2` (a 0-count read returns `0` and must *not* report EOF) and, later, `BODY-25` ("EOF is signaled only
by the explicit sentinel") both reason over the numeric protocol. The surface is internal, so the idiomatic-TS cost
is nil.

`MAX_BYTE_ARRAY_LENGTH` for `IO-9` needs care. Core is runtime-agnostic, so `node:buffer`'s constant is off-limits;
V8 and JavaScriptCore disagree on the real ceiling and both have moved it; and 12.6 forbids probing at import time.
Two mechanisms, each earning its place:

- a conservative named constant, giving the eager and actionable refusal `IO-9` asks for, and
- a `RangeError` → `AllocationLimitError` conversion around the allocation itself, as a backstop for any runtime
  whose real ceiling is lower than the constant.

**The constant's value is confirmed at plan time**, and its TSDoc records which runtimes it was chosen against.

### `byte-queue.ts` — `ByteQueue`

A linked list of `Uint8Array` chunks with a head offset, per `sdk-design/03` §3.1. Synchronous throughout.

- `read` appends to the destination's **tail** and returns the transferred count (`IO-1`), returns `0` for a 0-count
  read even on an exhausted queue (`IO-2`), and `END_OF_STREAM` at end.
- `write` removes exactly `count` from the source's **head**, failing rather than writing short (`IO-4`).
- `snapshot()` returns a fresh, independent copy without consuming or mutating (`IO-8`).
- `copyTo(dest, offset, count?)` defaults to offset-through-end, rejects out-of-range windows, and leaves the source
  size unchanged (`IO-10`).
- `clear()` discards every byte (`IO-10`).
- `close()` is idempotent (`IO-41`) and, per `IO-42`'s explicit carve-out, leaves the in-memory read/write surface
  usable — so 3b's snapshot-after-close body logging works — while invalidating every slice derived from it.

No segment pooling in v1. 13.6 would oblige bounding such a pool, and 15.10 forbids the cleverness without a
measurement; neither exists yet.

### `retention-window.ts` — `RetentionWindow`

The mechanism behind `IO-19`–`IO-23`. Holds the pulled-byte `ByteQueue`, a `retainedFrom` logical offset, and a
`Set` of cursors — the parent plus every live view. Each cursor is a logical offset into the stream.

After every read the window trims its head to `min(cursors)`, so with no views outstanding retention collapses to
the read size. Uncapped, per the placement decision above.

- View creation registers a cursor; view close unregisters it and triggers a trim, **without** closing the parent or
  moving the parent's cursor (`IO-22`).
- A slice of a slice composes offsets additively and caps at the outer slice's remaining budget (`IO-23`).
- Parent close invalidates every cursor, so a later view read throws `ClosedResourceError` — loud, and distinct from
  EOF by requirement (`IO-22`, `IO-24`).

### `buffered-source.ts` — `BufferedSource` + `SourceView`

Wraps a `ReadableStreamDefaultReader<Uint8Array>` and owns one `RetentionWindow`. Async surface:

- `read`, `exhausted()`, `readByte()`, `readBytes()` (`IO-11`).
- `readExactly(count)` — all-or-nothing, `EndOfStreamError` on a short source, never a short result (`IO-12`).
- `readUtf8`/`readString(charset)` via `TextDecoder`, symmetric with the sink's write-side encodings (`IO-13`).
- `readUtf8Line()` — treats both `\n` and `\r\n` as terminators, keeps a lone `\r` as line content, returns the
  final unterminated line as-is (`IO-14`).
- `skip(count)` — exact, `EndOfStreamError` if fewer remain, and `skip(0)` a no-op even at or after EOF (`IO-15`).
- `peek()` and `slice(offset, count)` — offset overflow detected lazily, negative offset or count rejected eagerly
  (`IO-19`–`IO-21`).
- `close()` — idempotent, releases the reader lock, and **rejects** reads afterwards. That is the opposite direction
  from `ByteQueue`, and `IO-42` names both as the inconsistency porters get wrong.

`readUtf8Line()` returns `string | undefined`, not `null`. The spec's "returning null" is language-agnostic phrasing;
styleguide 3.5 mandates `undefined` for absence with conversion at the boundary, and this surface is internal.

**Host-native means Web Streams.** `IO-16`'s "host-native byte-stream bridge" is `toReadableStream()` /
`toWritableStream()`, not a `node:stream` bridge. For this port the host-native byte stream *is* `ReadableStream` —
that is §3.1's entire premise. Core therefore imports no `node:` module and stays runtime-agnostic; Node interop
lives at the consumer's edge via `Readable.fromWeb()`, exactly where §3.1 puts it. Closing the bridge closes the
owning source, per `IO-16`.

**No `AbortSignal`, anywhere.** `IO-40` (MUST) forbids this layer imposing its own read/write timeout and assigns
deadlines and prompt cancellation of blocked I/O to the transport that owns the real socket. That collides with
styleguide 9.5 ("make cancellation part of the signature"). The spec wins; the collision is narrow, since 9.5 targets
APIs that own external I/O and this in-memory layer explicitly does not. Ledgered below.

### `buffered-sink.ts` — `BufferedSink`

Wraps a `WritableStreamDefaultWriter<Uint8Array>`.

- `write(src, count)` takes exactly `count` from the source's head, failing rather than writing partially (`IO-4`).
- `writeUtf8`/`writeString(charset)` mirror the read-side encodings (`IO-13`) — within a bounded charset set, see
  below.
- `flush()` forces out; `emit()` is the cheap one-level handoff (`IO-18`). Both are no-ops returning `this` on a
  pure in-memory sink.
- `close()` is idempotent (`IO-5`, `IO-41`) and rejects writes, flushes, and emits afterwards (`IO-42`).

**The write side supports UTF-8 and ISO-8859-1 only.** `IO-13` asks for "symmetric write-side encodings," but the
platform cannot deliver symmetry: `TextDecoder` accepts any charset label, while `TextEncoder` is **UTF-8-only** —
there is no `TextEncoder('iso-8859-1')` — and `SEAM-1`'s zero-runtime-dependency invariant rules out an encoding
library to close the gap. So the read side decodes whatever `TextDecoder` supports, and the write side encodes
UTF-8 via `TextEncoder` plus ISO-8859-1 via a five-line hand-rolled encoder (code points 0–255 map to bytes;
anything above throws). Any other label throws rather than silently re-encoding as UTF-8, which would corrupt bytes
on the wire.

ISO-8859-1 is not an arbitrary choice: `IO-13`'s own conformance note names it as the non-UTF-8 charset to
round-trip, and it and UTF-8 are the only encodings HTTP realistically needs. Ledgered below as a bounded
deviation.

The reference's `writeUtf8(begin, end)` substring-range overload is not ported: `writeUtf8(text.slice(a, b))`
at the call site is the idiomatic equivalent, and the copy the JVM overload avoids is a JVM-specific
`String` internals concern with no JS analogue. Folded into the same ledger row.

### `tee-sink.ts` — `TeeSink`

Mirrors written bytes into a bounded in-memory tap while forwarding the full, untruncated payload to its primary
sink (`IO-25`).

- Tap capacity limit, defaulting to `Number.POSITIVE_INFINITY` so no comparison ever trips — `IO-26`'s "effectively
  unbounded" default, spelled as a value rather than as a large magic number. A limit of `0` is honored distinctly:
  it mirrors nothing while still forwarding everything (`IO-26`).
- Mirrors **before** forwarding, so a failed primary write still captures the attempted bytes, and clears its
  staging buffer even on a failed write so a later write cannot prepend stale bytes (`IO-27`).
- Exposes no direct backing-buffer handle — attempting it fails, directing the caller at the typed write methods,
  because a raw buffer write would reach only the tap or only the primary and silently corrupt the wire body
  (`IO-28`).
- Its own `flush`/`close`/`emit` forward to the **primary only**, leaving the tap intact for later snapshotting
  (`IO-29`).

**Departure from §3.1's phrasing, not its substance.** §3.1 sketches this as "built on `TransformStream` with a
side-channel tap buffer." A plain `BufferedSink` decorator holding a primary plus a tap `ByteQueue` is simpler and
satisfies `IO-25`–`IO-29` directly, whereas a `TransformStream`'s own queueing and backpressure semantics muddy
`IO-27`'s mirror-before-forward ordering — the one clause most easily gotten wrong. §3.1's substantive point, that
the platform's `ReadableStream.tee()` solves a different problem (duplicating a *readable* for two consumers, not
mirroring a *sink's* writes), is untouched and remains the reason no platform primitive is used.

`IO-26`'s effectively-unbounded default is the spec mandating no cap, consistent with the placement decision above:
3b's `BODY-19`/`BODY-34` set the real one when it wraps this.

### `pump.ts` — `writeAll(source, sink)`

Pumps the source to exhaustion into the sink and returns the total transferred, terminating only on
`END_OF_STREAM`. When pumping a foreign source, a read returning `0` for a non-zero requested count raises
`SourceContractViolationError` — never tolerated as EOF, never spun on (`IO-17`).

### `factories.ts`

`IO-30`'s factory half, as named free functions (10.1 — named exports only, no default bag): a fresh empty buffer, a
buffered source over a caller stream, a buffered source over a byte array, a buffered sink over a caller stream, and
the typed wrapping of a foreign primitive source or sink — "foreign primitive" meaning a value that implements the
raw read/write protocol of `IO-1`/`IO-4` but carries none of the typed reads, views, or line semantics, which the
wrapper supplies. Every buffer is fresh, independent, and empty; the byte-array source holds an independent copy, so
mutating the caller's input afterwards does not change it.

`IO-30`'s provider-*resolution* half — install precedence, idempotent install, caching, warning, de-duplication,
"the same rules as `SEAM-5`–`SEAM-10`" — is not built. There is no registry; `sdk-design/03` §3.1 derives this in
full.

## Error Handling

Rooted at Phase 2's `DexpaceError`, with one new intermediate:

```
DexpaceError                          (Phase 2)
├── DomainModelError                  (Phase 1 tree, unchanged)
├── CancellationError                 (Phase 2)
├── OperationAssemblyError            (Phase 2)
└── IoError                           (Phase 3a)
    ├── EndOfStreamError              IO-11/12/15, and IO-4's short source
    ├── SourceContractViolationError  IO-17 — a foreign source returned 0 for a positive request
    ├── ClosedResourceError           IO-24/IO-42 — distinct from EOF, by requirement
    └── AllocationLimitError          IO-9 — message points at streaming alternatives
```

`EndOfStreamError` carries `delivered` and `requested` as typed context fields (8.1). `IO-4`'s short-source write is
the same delivered-of-requested shape, so it reuses that class rather than earning its own.

**Programmer errors go through `invariant` (5.6, 8.7), not the typed tree** — `IO-3`'s negative counts, `IO-21`'s
eagerly-rejected negative offset or count, and `IO-10`'s out-of-range window. `IO-3` explicitly permits this: "a
port MAY use whichever argument-error type is idiomatic." `IO-28`'s attempt to reach the tee's backing buffer
throws `IoError` instead: the refusal must carry the "use the typed write methods" redirect as an ordinary
catchable message, and a `never`-typed getter body reads cleaner as a throw than as an assertion call.
Charset-label rejection (`readString`/`writeString`) also uses `IoError`, so the sink and tee refuse a label
identically and the platform's `RangeError` chains as `cause`.

Conventions carried from Phases 1 and 2: `cause` on every rethrow (8.2), `this.name = new.target.name`, no bare
`throw new Error(...)`.

One rule specific to this layer: **an I/O error message never includes buffer contents.** These buffers carry
request and response bodies — credentials, tokens, PII. Styleguide 8.8 is context-yes-secrets-no, and this is the
layer where the temptation to dump the offending bytes into the message is strongest.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| Sync `ByteQueue` / async `Buffered*` split | §5's blocking contract | Node has no blocking reads; a uniform async shape costs a Promise allocation per in-memory read (15.4) |
| `close()` only, no `Symbol.asyncDispose` | styleguide 13.1/13.2 | `Symbol.asyncDispose` postdates the `engines.node >=18.17` floor; matches Phase 2's `Transport` precedent |
| No `AbortSignal` on the §5 surface | styleguide 9.5 | `IO-40` (MUST) assigns deadlines to the transport that owns the socket |
| `TeeSink` as a sink decorator | `sdk-design/03` §3.1 phrasing | `TransformStream` queueing muddies `IO-27`'s mirror-before-forward ordering; §3.1's substantive point is untouched |
| `IO-30` resolution half, `IO-39` not built | product-spec §5.6 | No registry exists — same class as `SEAM-5`–`SEAM-10` |
| `IO-38` not applicable | product-spec §5.4 | The requirement is about a close on one thread invalidating a slice being read on another, so it presupposes an instance can reach a second thread. None can. **Class instances are not structured-cloneable at all** — `postMessage`/`structuredClone` preserve neither prototypes nor `#private` fields, so a `ByteQueue` or `BufferedSource` sent to a worker arrives as a plain object with no methods and no close state to observe. `BufferedSource` is doubly excluded: a `ReadableStreamDefaultReader` is neither cloneable nor transferable. A raw `ArrayBuffer` *can* be transferred, but it carries no close state and derives no slices, so the hazard has no subject |
| Write-side charsets limited to UTF-8 and ISO-8859-1 | `IO-13`'s "symmetric write-side encodings" | `TextEncoder` is UTF-8-only and `SEAM-1` forbids an encoding dependency. Read side stays fully general via `TextDecoder`; the write side covers the two encodings HTTP needs, and `IO-13`'s own conformance note names ISO-8859-1 as the non-UTF-8 case. Any other label throws rather than silently corrupting bytes. The `writeUtf8(begin, end)` substring-range overload is subsumed by `String.prototype.slice` at the call site |

## Testing

`bun test`, colocated `*.test.ts` (11.1), every file citing the `IO-N` IDs it exercises in a top-of-file comment —
continuing the traceability convention Phase 1 established for Phase 9's conformance pass.

**Property tests are mandatory here, not optional.** Styleguide 11.5 names codecs, parsers, serializers, and
invariant-bearing functions, and §5 is almost nothing else:

- **`ByteQueue`** — write-then-read preserves byte order across arbitrary chunk splits (`IO-7`); a snapshot is
  unaffected by later mutation and vice versa (`IO-8`); `copyTo` leaves the source size unchanged (`IO-10`).
- **`readUtf8Line`** — arbitrary text with mixed `\n`, `\r\n`, and lone-`\r` splits and rejoins identically
  (`IO-14`). Chunk boundaries are generated **adversarially**, so a terminator straddling two stream chunks is
  covered; `IO-14`'s own rationale calls out surviving slice-window boundaries, and that is exactly the case
  hand-picked examples miss.
- **`readString`/`writeString`** — round-trip through UTF-8 and through ISO-8859-1 (`IO-13`, whose conformance note
  names a non-UTF-8 charset explicitly).
- **View independence** — N views at arbitrary offsets and counts each read the same bytes a direct read at that
  window would, and no view's read advances another's cursor (`IO-19`, `IO-20`, `IO-23`).
- **`TeeSink`** — for arbitrary write sequences and arbitrary tap caps, the primary receives the exact concatenation
  of every written byte. This is the single most important property in §5: it is the invariant that logging never
  reduces the wire body.

**Conformance example tests**, one per *Conformance:* clause §5 writes for itself — roughly a dozen — transcribed as
direct tests rather than paraphrased, continuing Phase 2's convention.

**Negative space and cleanup** (11.9, 13.9):

- Double-close throws nothing and closes the underlying resource at most once (`IO-41`).
- Closing a stream-backed wrapper cancels/closes the caller stream it took ownership of (`IO-6`),
  asserted with a cancel/close spy on the fake streams.
- Read-after-close **rejects** on a stream-backed source but **succeeds** on `ByteQueue`'s snapshot path. `IO-42`
  names both directions as the trap, so both get an assertion.
- Closing a parent invalidates outstanding slices loudly, with `ClosedResourceError` rather than EOF (`IO-22`,
  `IO-24`).
- `afterEach` closes what the test opened.

**Fakes, not mocks** (11.3): a `FakeReadableStream` yielding caller-chosen chunk boundaries and able to inject a
protocol violation — zero bytes returned for a positive request — to drive `IO-17`. Our own interface, so
`mock.module` stays out of it.

**Determinism** (11.8) is free here: `IO-40` means this layer owns no timer, and every stream under test is built
from an in-memory array. No fake clocks, no I/O flakiness.

**No type-level tests.** 11.6 requires them for public generics and conditional types; this phase publishes neither.
Stated rather than manufactured.

**One committed bench** — `byte-queue.bench.ts` (`mitata`), baseline only. No optimization and no 15.10 ledger notes,
because 15.1 and 15.6 forbid tuning ahead of a profile. It exists so Phases 6 and 8 inherit a regression floor on
the SDK's hottest data structure.

**Two mechanical gates:** the 80% aggregate coverage floor (`NFR-5`) is unchanged, and `api-extractor`'s committed
report must come back **byte-identical** — nothing in this phase enters the public surface, so an unchanged report
is machine-checked proof the internal-only decision held.
