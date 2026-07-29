# Phase 6b — Server-Sent Events — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the SSE subsystem — the WHATWG line/field grammar as a state machine, the immutable
`SseEvent` value, the resource-owning single-pass stream facade, and the typed adapter — satisfying
`docs/product-spec/13-server-sent-events-and-streaming.md` (`SSE-1`–`SSE-41`). Second of the three sub-phases the
[Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) splits Phase 6 into: 6a (serde, `§14`),
**6b** (this document, SSE), 6c (pagination, `§12`).

**Governing documents:** `docs/product-spec/13-server-sent-events-and-streaming.md` (normative, cited by ID
throughout), `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.2 (Node-port mapping — hand-rolled
grammar, `EventSource` rejected, async-generator idiom), `docs/knowledge/sse-streaming.md`, the Phase 3a design
(`BufferedSource`, `IoError`), the Phase 3b design (`Response.body`, `Response.close()`), and the Phase 4b design
(`Outcome<T>`, the union idiom this phase's mapper outcome mirrors). Styleguide: `styleguide/typescript/`
chapters 03, 06, 08, 09, 11, 12, 13.

**Solo-brainstorm note.** Drafted with the user away from keyboard, `docs/knowledge/` as standing tie-breaker.
6b shares no types with 6a or 6c — `SSE-37` (MUST) forbids the only coupling that could exist, and this phase
enforces that mechanically rather than by review (see "Enforcing `SSE-37`").

## Scope

6b ships the parser, the event value, the facade, and the typed adapter. **No serde, at all** — the typed
adapter takes a caller-supplied mapper function and never touches a `Serde`, a `Schema`, or `@dexpace/codec-json`.
No reconnection, no last-event-id continuity, no done-sentinel convention (`SSE-38`, `SSE-37`); those are the
caller's, by explicit design.

## Requirement Coverage

| ID | Level | Where |
|---|---|---|
| SSE-1 | MUST | `SseParser` — blank line dispatches; per-block accumulators reset |
| SSE-2 | MUST | `SseLineReader` — LF, CR, and CRLF, CRLF as one terminator, lone CR terminates by itself |
| SSE-3 | MUST | First-colon split; no colon → whole line is the name with an empty value |
| SSE-4 | MUST | Present-but-empty recorded as `''` **and** counted as field-seen, distinct from absent |
| SSE-5 | MUST | Exactly one leading `U+0020` stripped after the colon; further spaces preserved |
| SSE-6 | MUST | Leading `:` is a comment; latest-wins; counts as field-seen |
| SSE-7 | MUST | Only `id`/`event`/`data`/`retry` interpreted; anything else discarded, setting no state |
| SSE-8 | MUST | Consecutive `data` accumulates into an ordered list; never joined at this layer |
| SSE-9 | MUST | An `id` containing `U+0000` is ignored entirely — no set, no field-seen, no overwrite |
| SSE-10 | MUST | `event` raw, latest-wins, absent when unsent — never defaulted to `message` |
| SSE-11 | MUST | `retry` accepted only for all-ASCII-digits within the documented cap; otherwise ignored |
| SSE-12 | MUST | One leading BOM consumed via non-consuming lookahead; a later BOM survives as data |
| SSE-13 | MUST | Permissive dispatch — any of five fields set emits; a no-field block is skipped |
| SSE-14, SSE-15 | MUST | EOF dispatches a pending block; the end sentinel is stable across repeated pulls |
| SSE-16 | MUST | Only the BOM-consumed flag persists; no last-event-id buffer exists |
| SSE-17 | MUST | The reader never closes its source — ownership starts at the facade |
| SSE-18 | MUST | Re-expressed for the event loop — see "Collapsed Requirements" |
| SSE-19 | MAY | Configurable `maxLineBytes`, **off by default**; documented divergence |
| SSE-20 | MUST | `SseEvent` frozen, `data` defensively copied on construction and on copy-with |
| SSE-21, SSE-22 | SHOULD | `sseEventsEqual()`, `sseEventToString()`, `isSseEventEmpty()` |
| SSE-23–SSE-28 | MUST | `SseStream` — one owned resource, exactly-once close, single-pass, idempotent close |
| SSE-29, SSE-30 | MUST | Mid-stream failure releases before propagating with the close error suppressed; automatic clean-terminal release failure is reported out-of-band and swallowed, explicit `close()` propagates |
| SSE-31 | MUST | Re-expressed for the event loop, but **not** collapsed — see below |
| SSE-32 | MUST | `sseStreamFrom(response)` binds lifecycle to the body, throws on a bodyless response |
| SSE-33–SSE-36 | MUST | `typedSseStream(stream, mapper)` — `(eventName, joinedData)`, Value/Skip/Done, lazy per-element, release-before-propagate on a throwing mapper |
| SSE-37 | MUST | Mechanically enforced import assertion — see below |
| SSE-38 | MUST | Mechanically enforced alongside `SSE-37` — the same build script scans for a `Last-Event-ID` write, a `reconnect` identifier, or a `fetch(` call under `src/sse/` |
| SSE-39 | MUST | Pull-based, 1:1 source polls per consumer pull, no read-ahead |
| SSE-40 | SHOULD | The facade *is* the lazy single-pass view; one reader instance per stream |
| SSE-41 | MAY | Deferred to Phase 8 (`@dexpace/rx`) — roadmap row already filed |

## Finding: 3a's `readUtf8Line()` cannot be used for SSE

`sdk-design-nodejs/07` §7.2 says the parser operates "over the same `BufferedSource` line-reading primitive from
§3.1." That primitive is not usable as-is. Phase 3a's design fixes `readUtf8Line()`'s contract as *"treats both
`\n` and `\r\n` as terminators, **keeps a lone `\r` as line content**"* (`IO-14`). `SSE-2` (MUST) requires the
opposite: *"a lone CR terminates a line by itself."* Feeding SSE through `readUtf8Line()` would silently merge two
events whenever a server used bare-CR terminators — parsing `data: 1\rdata: 2\r\r` as one line instead of four.

Two ways out were considered:

1. **Widen `readUtf8Line()`** with a terminator-mode parameter. Rejected: it reshapes a frozen Phase 3a surface
   for exactly one consumer, and `IO-14`'s lone-CR-as-content rule is itself normative — it is not a bug to fix.
2. **6b owns its own line framing.** Chosen. `src/sse/line-reader.ts` reads bytes from a `BufferedSource` and does
   its own CR/LF/CRLF framing, including the cross-chunk case a naive splitter gets wrong: a `\r` ending one chunk
   whose `\n` begins the next must resolve to **one** terminator, which requires holding the `\r` until the next
   byte is known (or EOF is reached).

`BufferedSource` is still used, for two things it does better than a raw reader: `peek()` gives `SSE-12`'s
non-consuming BOM lookahead directly, and its `close()` is already idempotent and already rejects subsequent
reads — which is most of `SSE-27` and `SSE-28` for free rather than reimplemented.

## The Parser

```typescript
/** SSE's own end-of-stream sentinel — not 3a's `END_OF_STREAM`, which is `read()`'s `-1`. */
const SSE_END: unique symbol;

/** @internal */
class SseLineReader {
  constructor(source: BufferedSource, maxLineBytes?: number);
  nextLine(): Promise<string | typeof SSE_END>;
}

/** @internal */
class SseParser {
  constructor(source: BufferedSource, options?: {maxLineBytes?: number});
  next(): Promise<SseEvent | typeof SSE_END>;
}
```

**Three details of 3a's surface shape the reader, and getting any of them wrong is silent.**
`BufferedSource` has no public constructor — instances come from `BufferedSource.overStream(stream)` /
`overBytes(bytes)`, and `overStream` takes the `ReadableStream` itself, not a reader. `readByte()` is typed
`Promise<number>` and **rejects** with `EndOfStreamError` when the source is spent (`IO-11`); it has no
`undefined` result, so the reader probes `exhausted()` *before* each read rather than testing the read's value.
And `readBytes()` takes no count — it drains everything — so `SSE-12`'s confirmed three-byte BOM consume is
`readExactly(3)`.

`SseParser` is a class, not a generator, because `SSE-15`/`SSE-16` require observable state (the end sentinel
must stay stable across repeated pulls; the BOM-consumed flag must persist) and `SSE-17` requires it to *not* own
its source — a generator's `finally` would make non-ownership the harder thing to guarantee, which is backwards.
The generator lives one layer up, in the facade, where ownership actually belongs.

Per-block accumulator state is five fields plus a `sawAnyField` boolean. `SSE-13`'s permissive dispatch is that
boolean, and `SSE-9`'s NUL rule is the one case that deliberately does **not** set it.

`SSE-11`'s "documented cap" for `retry`: `Number.MAX_SAFE_INTEGER` (2^53−1 ms). Chosen over the reference's
signed-64-bit because it is the largest integer JavaScript represents exactly — beyond it, parsing would silently
round, which is the wrapping `SSE-11` forbids. A value with more digits than that is ignored, not clamped.

`SSE-19`'s cap is offered as `maxLineBytes` and is **off by default**, matching the reference's own absence of a
cap so a port swap does not change behavior. The unbounded-memory exposure to an untrusted server is documented on
the option, with the recommendation to set it for any stream whose origin is not fully trusted.

## `SseEvent`

```typescript
interface SseEvent {
  readonly id: string | undefined;
  readonly event: string | undefined;
  readonly data: readonly string[];
  readonly comment: string | undefined;
  readonly retryMs: number | undefined;
}
```

A frozen plain object with a frozen `data` array, not a class: there is no lifecycle, no invariant to enforce past
construction, and no behavior — `styleguide/typescript/06` §6.3's test for "data structure, not object." `SSE-21`'s
structural equality and `SSE-22`'s emptiness predicate are therefore free functions (`sseEventsEqual`,
`isSseEventEmpty`, `sseEventToString`), not methods. `undefined`, not `null`, for absence — styleguide 3.5, and
the same choice 3a made for `readUtf8Line()`.

`SSE-20`'s defensive copy is `Object.freeze(data.slice())` at construction. There is no copy-with operation in
this phase: no requirement asks for one, and nothing in 6b or a later phase mutates an event.

`makeSseEvent` is the one construction point, so it is where the two field constraints the grammar enforces are
asserted (`docs/knowledge/assertions.md:6-9`): a `retryMs` that is a non-negative safe integer (`SSE-11`) and an
`id` free of `U+0000` (`SSE-9`). Both are positive-and-negative-space checks on a programmer error rather than a
stream condition — the parser is the only production caller and it already filters both, so a violation here
means the filter broke, which is exactly what an `invariant` is for.

## The Facade

```typescript
interface SseStreamOptions {
  readonly onReleaseFailure?: (error: unknown) => void;
}

interface SseStreamFromOptions extends SseStreamOptions {
  readonly maxLineBytes?: number;
  readonly signal?: AbortSignal;
}

class SseStream implements AsyncIterable<SseEvent> {
  constructor(parser: SseParser, resource: SseResource, options?: SseStreamOptions);
  [Symbol.asyncIterator](): AsyncIterator<SseEvent>;
  close(): Promise<void>;
}

function sseStreamFrom(response: Response, options?: SseStreamFromOptions): SseStream;
```

**Cancellation is an `AbortSignal`, as every long-running operation's is** (`docs/knowledge/api-design.md:34`,
`docs/knowledge/concurrency-and-async.md:18`). For a pull-based stream the abort *action* is a close, so the
signal adds a trigger rather than a code path: an iterator between pulls then ends cleanly (`SSE-27`) and one
blocked in a read surfaces `IoError` (`SSE-31`), both releasing exactly once. The listener is registered by
`sseStreamFrom`, not by the constructor, because a constructor may only assign its arguments to fields
(`docs/knowledge/data-modeling.md:24`).

The facade owns exactly one closeable resource and closes it exactly once across every termination path
(`SSE-23`). Three flags carry the whole lifecycle: `iteratorTaken` (`SSE-26`'s single-pass rule), `closed`
(`SSE-27`), and `released` (`SSE-28`'s idempotence). All three are plain booleans — the single-threaded event loop
makes a CAS unnecessary, the same collapse 3b applied to its close-once guards.

`SSE-30`'s swallow-vs-propagate split is the subtle one and is implemented as an explicit parameter on the
internal release routine, not inferred from context:

- Release on a **clean automatic terminal** (natural end-of-stream, a mapper's Done) with no error in flight —
  a failing close is reported out-of-band and swallowed. Turning it into a throw would discard events the
  consumer already received, which is the specific harm `SSE-30` names.
- Release on an **explicit `close()`** — a failing close propagates. The caller asked; the caller hears.
- Release with **an error already in flight** (`SSE-29`, `SSE-36`) — the primary error propagates with the close
  failure attached via native `SuppressedError`, the same mechanism 5a uses.

> **`SuppressedError` is blocked on a cross-phase decision, and 6b does not get to make it.**
> `plans/2026-07-25-phase4b-recovery-chain.md:24-48` establishes that `SuppressedError` is a V8 global from the
> full Explicit Resource Management proposal, absent on every 18.x runtime — Node backported
> `Symbol.dispose`/`Symbol.asyncDispose` alone — while `engines.node` is `">=18.17"` and `verify:node-floor`
> pins exactly that. `esnext.disposable` supplies the *type* only, so the construction type-checks, passes
> `bun test`, and then throws `ReferenceError` on the floor runner. The open options are raising
> `engines.node` or adding a runtime-guarded `suppress(primary, secondary)` helper; whichever lands must land
> across 4b, 5a, 6a, 6b and 6c together. Everything this section says about *which* error stays primary is
> unaffected by that choice — only the construction call is.

"Out-of-band" is a `Logger` concern and no `Logger` exists until Phase 7. 6b's release routine takes an optional
`onReleaseFailure?: (error: unknown) => void` callback, defaulting to a no-op, so Phase 7 wires a real logger in
without reshaping the facade. This is the same "mechanism now, wiring later" pattern 3b used for its logging tees.

`SSE-32`'s bodyless-response case throws `SseStreamError` (new, flat under `DexpaceError`) rather than returning
an empty stream — a bodyless SSE response is a server or caller mistake, and silently yielding zero events would
hide it. A second flat leaf, `SseLineTooLongError`, carries `SSE-19`'s opt-in cap; it exists only when a caller
set `maxLineBytes`, and it is a distinct type from `SseStreamError` because it is neither caller misuse nor a
server-shape problem but a deliberate policy trip.

**`sseStreamFrom` owns two things and must release both.** `SSE-23` says the facade owns *one* closeable
resource, and the obvious reading — hand it the `Response` — is wrong here: the function also builds a
`BufferedSource`, which takes a **reader lock** on `response.body`. Cancelling a `ReadableStream` that still has
a locked reader throws `TypeError`, so releasing only the response would fail against a real `Response` while
passing against any close-counting test double. `sseStreamFrom` therefore bundles the two into one `SseResource`
released in reverse acquisition order — source, then response — with both closes always attempted and the first
failure kept primary. `docs/knowledge/sse-streaming.md:84` states the obligation as "the facade's `finally` must
invoke `response.body.cancel()` exactly once," and closing the source is what actually reaches that call.

## Disposal

`SseStream` owns a resource and exposes `close()`, which is the shape `styleguide/typescript/13` §13.1 tells a
class *not* to make its primary teardown interface, with §13.2 prescribing `[Symbol.asyncDispose]` delegating to
the legacy `close()`. Phases 2 and 3a deferred this with the explicit escape clause *"costs nothing today since
no §5 type is public."* 6b is where that stops being true: `SseStream` is published.

The deferral is therefore **partially** discharged rather than reversed. `Symbol.asyncDispose` landed in Node
18.18 and this package's declared floor is 18.17 — the exact version `verify:node-floor` pins — and TypeScript
does not polyfill the well-known symbol for a library *declaring* the method, so the computed key silently
becomes the string `"undefined"` at run time. So:

- the disposal member is **installed at run time only when the symbol exists**, via a guarded
  `Object.defineProperty` on the prototype, and simply does not exist below 18.18;
- it is **typed as optional**, because typing it non-optional would promise `await using` support the floor
  cannot honor;
- **`close()` remains the supported teardown on every runtime**, and dispose delegates to it, so there is one
  release path and it inherits close's idempotence rather than adding a second guard.

One consequence to state plainly, because it is easy to write a test that cannot compile: an optional
`[Symbol.asyncDispose]` means `SseStream` is not an `AsyncDisposable`, and `await using` requires one. So
`await using stream = sseStreamFrom(...)` does **not** type-check under this design — a stream typed as *maybe*
disposable is not disposable. The member is callable directly, and that is what the test exercises; the
statement form arrives with the floor move, not before it.

Promoting this to an unconditional `implements AsyncDisposable` is a one-line change gated on `engines.node`
moving past 18.18; the roadmap's deferred-items row now says so instead of claiming no public resource type
exists. Naming `Symbol.asyncDispose` in a type position also requires `esnext.disposable` on the TypeScript
`lib` list, which the plan checks before relying on it.

## The Typed Adapter

```typescript
type MapperOutcome<T> =
  | {readonly kind: 'value'; readonly value: T}
  | {readonly kind: 'skip'}
  | {readonly kind: 'done'};

type SseMapper<T> = (eventName: string | undefined, joinedData: string) => MapperOutcome<T>;

function typedSseStream<T>(stream: SseStream, mapper: SseMapper<T>): AsyncIterable<T>;
```

**`MapperOutcome<T>` is a sibling of 4b's `Outcome<T>`, not a third variant on it.** The segmentation design flagged
this as 6b's own decision. `Outcome<T>` is a two-branch success/failure union threaded through the recovery chain;
adding a `skip`/`done` pair to it would force every existing `fold` call site in `src/recovery/` to handle two
variants that can never occur there. Same union idiom, same styleguide pattern, separate type — reuse of the
*shape*, which is what `sdk-design-nodejs/07` §7.2 actually argues for.

The union is closed, so the adapter's `switch` closes with `default: return assertNever(outcome)`
(`docs/knowledge/data-modeling.md:16`) — a fourth outcome added later must be a compile error here, not a
silently dropped event.

`SSE-33`'s joining (`data.join('\n')`, `''` when empty) happens here and only here — `SSE-8` is explicit that the
parser must not join. `SSE-35`'s laziness is a plain `async function*`: the mapper runs inside the loop body, so a
consumer taking one element decodes exactly one event. `SSE-34`'s Skip drains inside the same pull, which is the
one sanctioned exception to `SSE-39`'s 1:1 rule ("only as many as needed to produce one element").

**`SSE-36`'s release-then-propagate belongs to the adapter, not to the facade.** A mapper throw looks like it
should ride the facade's existing catch, and it does not: that catch only sees failures raised by the facade's
*own* pull of the parser. A throw from the adapter's loop body unwinds by calling the facade iterator's
`return()`, which runs the facade's **quiet** release — the path `SSE-30` requires to swallow a close failure.
Left there, the close error would be swallowed exactly where `SSE-36` says to attach it. So the adapter wraps
the mapper call itself, releases through the facade's public `close()` (explicit-close semantics), and attaches
any close failure as suppressed; the facade's later `return()` finds the resource already released and does
nothing (`SSE-28`).

## Enforcing `SSE-37`

`SSE-37` (MUST) is an architectural invariant — no serialization dependency reaches the parser or the facade —
and the reference proves it structurally (its `sdk-core` carries zero serde dependency). This port cannot lean on
that: 6a puts the serde seam in the *same package*. So the invariant becomes a mechanical check rather than a
property of the module graph:

`scripts/verify-sse-37.mjs` walks every file under `packages/core/src/sse/` and fails the build if any import
specifier resolves into `../serde/`, `../seams/serde.js`, or `@dexpace/codec-json`. It runs in the same CI job as
the existing `verify:seam-1` check. Without it, `SSE-37` degrades to a review convention that one convenient
import quietly breaks.

The same script carries `SSE-38` (no auto-reconnect, no `Last-Event-ID` header), because that invariant has the
same shape and the same weakness: it is violated by *adding* something helpful, and nothing in the type system
would flag it. The script scans for a `Last-Event-ID` write, a `reconnect` identifier, and a `fetch(` call. A
literal scan is crude, and deliberately so — the requirement is "this code path does not exist," which is exactly
what a literal scan tests.

## Collapsed Requirements

Phase 9's sweep reads this table rather than re-deriving it.

| ID | Disposition |
|---|---|
| `SSE-18` — one reader driven from one thread at a time | **Re-expressed.** There are no threads. The portable hazard survives as *overlapping un-awaited `next()` promises*, which is reachable and would interleave the parser's accumulator writes. The parser is documented single-consumer and the facade enforces it structurally: `SSE-26`'s single-pass iterator means only one iterator ever drives one parser, so the misuse requires reaching past the facade to a `@internal` type |
| `SSE-31` — cross-thread `close()` | **Re-expressed, not collapsed.** "Close from another thread" becomes "close while a `read()` promise is pending," which is genuinely reachable on one event loop. Both branches are real and both need tests: a close observed *between* pulls ends iteration cleanly, and a close that tears the source down *during* a pending read surfaces as a read failure. The latter falls out of Web Streams — `releaseLock()` on a reader with a pending read rejects it — and the implementation maps that rejection to `IoError` so callers see one failure shape rather than a bare `TypeError` |
| `SSE-41` — reactive adapter | **Deferred to Phase 8** (`@dexpace/rx`), roadmap row filed. 6b ships `SSE-39`'s pull-based surface, which is the thing the reactive view would wrap |

## Reused, Not Rebuilt

| Surface | From | Why |
|---|---|---|
| `BufferedSource` (`overStream`, `exhausted`, `readByte`, `readExactly`, `peek`, `close`) | 3a | `peek()` is `SSE-12`'s lookahead; `close()` is already idempotent and already rejects later reads, covering most of `SSE-27`/`SSE-28`. `exhausted()` — not a sentinel from `readByte()` — is how end of stream is detected, because `readByte()` rejects rather than returning one |
| `IoError` | 3a | Every read-path failure surfaces as one shape, including the torn-down-mid-read case |
| `SuppressedError` usage pattern | 5a | `SSE-29`/`SSE-36`'s "close failure attached to the primary" is the identical mechanism — **and inherits 5a's unresolved blocker**, see below |
| `Response.body` / `Response.close()` | 3b | `sseStreamFrom` binds to them; it does not reach for a transport — which is also half of why `SSE-38` holds by construction |
| The `kind`-discriminated union idiom | 4b | `MapperOutcome<T>` mirrors `Outcome<T>`'s shape without extending its type |

## File Layout

```
packages/core/src/sse/
  event.ts          # SseEvent, SseEventFields, makeSseEvent, sseEventsEqual,
                    # isSseEventEmpty, sseEventToString                              (SSE-20–SSE-22)
  line-reader.ts    # SSE_END, SseLineReader, SseLineTooLongError                    (SSE-2, SSE-12, SSE-19)
  parser.ts         # SseParser — field grammar, dispatch, EOF                       (SSE-1, SSE-3–SSE-16)
  stream.ts         # SseResource, SseStreamOptions, SseStreamFromOptions,
                    # SseStream, sseStreamFrom                                       (SSE-23–SSE-32)
  typed.ts          # MapperOutcome, mapperValue, MAPPER_SKIP, MAPPER_DONE,
                    # SseMapper, typedSseStream                                      (SSE-33–SSE-36)
  errors.ts         # SseStreamError
```

`SseLineTooLongError` lives beside the only thing that raises it rather than in `errors.ts`: the cap is the line
reader's own policy, and a caller who never sets `maxLineBytes` can never see the type. `SSE_END` likewise stays
with the reader that defines the sentinel.

No folder barrel (`docs/knowledge/module-organization.md:18`).

## Public Barrel

Promoted — values: `sseStreamFrom`, `SseStream`, `typedSseStream`, `mapperValue`, `MAPPER_SKIP`, `MAPPER_DONE`,
`makeSseEvent`, `sseEventsEqual`, `isSseEventEmpty`, `sseEventToString`, `SseStreamError`,
`SseLineTooLongError`. Types: `SseEvent`, `SseEventFields`, `SseResource`, `SseStreamOptions`,
`SseStreamFromOptions`, `MapperOutcome`, `SseMapper`.

A caller consuming an SSE endpoint needs all of them, and unlike 5a's pillar-step surface there is no later
sub-phase that might reshape them — 6c never touches SSE. The three that are less obvious: `makeSseEvent` is
how a test or a fake produces an event without reaching for the `@internal` parser; `mapperValue`/`MAPPER_SKIP`/
`MAPPER_DONE` are the only sanctioned way to build a `MapperOutcome`, since the union's members are frozen
literals a caller should not hand-roll; and `SseLineTooLongError` is catchable only by the caller who opted into
`maxLineBytes`, so withholding it would leave that caller matching on a message.

Kept `@internal`: `SseParser`, `SseLineReader`. They are driven only through the facade, and publishing them
would publish a way to violate `SSE-17`'s non-ownership contract by accident.

## Testing

`bun test`; `fast-check` for the two invariants below. Notable cases:

- Each terminator (`\n`, `\r`, `\r\n`) and all three mixed in one stream, yielding identical events —
  including a `\r` deliberately placed at the final byte of one source chunk with its `\n` at the start of the
  next, which is the framing bug this phase's own line reader exists to avoid.
- A close-counting resource driven through all six termination paths (clean end, explicit close, partial consume,
  mid-stream failure, mapper throw, mapper Done), asserting exactly one release each (`SSE-23`).
- Close between pulls (clean end) and close during a pending read (`IoError`), separately (`SSE-31`).
- A source-poll counter asserting 1:1 with consumer pulls, plus a Skip-heavy stream asserting the typed layer
  polls only as far as the next yieldable element (`SSE-39`).
- **Property:** any sequence of events round-trips through a serializer→parser pair, for arbitrary field values
  excluding NUL in `id`.
- **Property:** splitting one fixed byte stream at every possible chunk boundary yields the same event sequence
  every time — the chunk-independence guarantee the line reader's carry buffer exists to provide.
- The line reader's *own* end sentinel staying stable across repeated pulls, and a CRLF-terminated stream
  emitting no trailing empty line. Both are masked by the parser's `#ended` guard if only tested through the
  parser — and a reader that answers `''` forever is an infinite supply of dispatch boundaries.
- `sseStreamFrom` reaching the response body's `cancel()` hook, not merely a close counter: the `BufferedSource`
  holds the reader lock, so a facade that closes only the response would fail against a real `Response` while
  passing against a double.
- The disposal member releasing exactly once where the runtime has `Symbol.asyncDispose`, and being absent (with
  `close()` still working) where it does not. Invoked directly, **not** via `await using` — the optional member
  is not an `AsyncDisposable`, so the statement form would not compile.
- Aborting an `sseStreamFrom` signal releasing the response exactly once and letting an idle iterator end
  cleanly on its next pull.
- The `SSE-37`/`SSE-38` detector's own negative cases: a TSDoc *documenting* the absence of reconnection, and a
  commented-out serde import, are both non-violations.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| SSE line framing is 6b's own, not 3a's `readUtf8Line()` | `sdk-design-nodejs/07` §7.2 | `IO-14` keeps a lone `\r` as line content; `SSE-2` requires it to terminate. Both are normative; they are simply different framings for different jobs |
| `retry` cap is `Number.MAX_SAFE_INTEGER` | `SSE-11` (reference uses signed 64-bit ms) | The largest exactly-representable integer in JavaScript; beyond it, parsing rounds silently, which is the wrapping `SSE-11` forbids |
| `maxLineBytes` off by default | `SSE-19` (MAY) | Matches the reference's own no-cap behavior so a port swap changes nothing; the exposure is documented on the option |
| `MapperOutcome<T>` is a separate type from `Outcome<T>` | `sdk-design-nodejs/07` §7.2's "reused rather than re-invented" | The *idiom* is reused; extending the recovery chain's union would force every existing `fold` site to handle unreachable variants |
| `SSE-37` and `SSE-38` enforced by a build script, not by module-graph structure | `SSE-37`, `SSE-38` | The reference gets it free from package boundaries; this port puts serde in the same package, so the invariant needs a mechanical guard or it is only a convention. The script strips comments before the `SSE-38` marker scan and skips `*.test.ts` for markers only — a gate that failed on a TSDoc *documenting* the absence of reconnection would be deleted rather than obeyed |
| `[Symbol.asyncDispose]` on `SseStream` is optional and runtime-guarded, not an `implements AsyncDisposable` | `styleguide/typescript/13` §13.1–13.2 | The symbol postdates the declared `>=18.17` floor that `verify:node-floor` pins, and TypeScript does not polyfill it for a declaring library. `close()` stays the supported path everywhere; dispose delegates to it. Cost: `await using` does not type-check against an optional member. Unconditional once the floor moves past 18.18 |
| Byte-at-a-time line framing via `readByte()` | `docs/knowledge/performance.md:16-17` | `readByte()` is `readExactly(1)` underneath, so framing allocates per byte on the parse path. Deferred deliberately on the guide's own terms (`performance.md:4,24` — no micro-fix before a profile names the bottleneck) and recorded so Phase 10 revisits it with a `*.bench.ts` instead of rediscovering it. A bulk-`read()` framing is the fix if a profile calls for one; no observable contract changes |
| `SSE-29`/`SSE-36` construct a native `SuppressedError` | `NFR-10` / the declared `>=18.17` floor | Not 6b's deviation to take or reverse — inherited from the cross-phase blocker at `plans/2026-07-25-phase4b-recovery-chain.md:24-48`, which must resolve across 4b/5a/6a/6b/6c together. Listed here so Phase 10 sees 6b in that set |
