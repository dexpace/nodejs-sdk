---
'@dexpace/core': minor
---

Add the Server-Sent Events subsystem for product-spec §13 (`SSE-1`–`SSE-41`). The public surface is
`sseStreamFrom()` and the `SseStream` facade it returns, `typedSseStream()` with the `MapperOutcome<T>`
union and its `mapperValue()` / `MAPPER_SKIP` / `MAPPER_DONE` constructors, the `SseEvent` value with
`makeSseEvent()` / `sseEventsEqual()` / `sseEventToString()` / `isSseEventEmpty()`, and two error leaves,
`SseStreamError` and `SseLineTooLongError`.

Pull-based with no read-ahead (`SSE-39`): one consumer pull drives at most one parse, and nothing is
buffered speculatively. No reconnection and no `Last-Event-ID` continuity (`SSE-38`) — both remain the
caller's responsibility, and both are now gate-enforced rather than merely documented.

The line reader and the parser stay internal. They are driven only through the facade, and publishing them
would publish a way to violate `SSE-17`'s non-ownership contract by accident: neither closes the
`BufferedSource` it reads, because lifecycle belongs to `SseStream` alone.

What landed under `packages/core/src/sse/`: `event.ts` (the frozen value and its operations),
`line-reader.ts` (byte-level line framing plus the opt-in cap), `parser.ts` (the field grammar and
dispatch rules), `stream.ts` (the resource-owning facade and `sseStreamFrom()`), `typed.ts` (the mapper
adapter), and `errors.ts`. Outside the package: `scripts/verify-sse-37.mjs` with its own test, a CI step
that runs it, and `test/node-conformance/sse.test.mjs`.

Four design calls worth recording:

- **SSE frames its own lines rather than reusing `BufferedSource.readUtf8Line()`.** Phase 3a's primitive
  treats `\n` and `\r\n` as terminators but keeps a lone `\r` as line *content* (`IO-14`); `SSE-2`
  requires the opposite, where a lone CR terminates a line by itself. Both contracts are normative for
  their own subsystem, so reshaping the frozen Phase 3a surface for one consumer was the wrong trade. The
  duplication is deliberate and recorded at `docs/open-items.md` §I2 so Phase 10's deviation review does
  not read it as accidental. The awkward case it exists to get right is a `\r` ending one chunk whose `\n`
  begins the next: the pending CR is held until the following byte — or EOF — is known, so the pair
  resolves to a single terminator.
- **`SSE-37`/`SSE-38` are enforced by a script, not by a type.** Nothing in the type system would catch
  somebody "helpfully" adding a reconnect loop or a `Last-Event-ID` header, so `verify:sse-37` scans
  `src/sse/` for serde imports and for reconnection markers. It scans **comments-stripped** source on
  purpose: the requirement forbids the code path, not the documentation of its absence, and "this
  subsystem never reconnects; that is the caller's job" is the single most likely sentence to appear in a
  TSDoc there. A gate that fails on its own requirement's explanation is a gate the next person deletes
  instead of the comment.
- **`[Symbol.asyncDispose]` is installed at run time, not declared on the class.** The declared
  `engines.node` floor is `>=20.3` and the symbol landed in Node 20.4, where a computed key that evaluates
  to `undefined` binds the method to the string `"undefined"` instead — wrong, silent, and only at run
  time. Declaring the member would also break consumers compiling the published `.d.ts` on a plain
  `ES2023` lib. `SseStream` therefore installs it behind a `typeof Symbol.asyncDispose === 'symbol'`
  guard, matching `Response` (`HTTP-38`). Recorded at §I3; it becomes an unconditional `implements
  AsyncDisposable` when the floor moves past 20.4. Note that Phase 6c's `Page` resolves the same question
  the other way — see that changeset.
- **`MapperOutcome<T>` is a sibling of Phase 4b's `Outcome<T>`, not a third variant on it.** `Outcome<T>`
  is a two-branch success/failure union threaded through the recovery chain; widening it with `skip` and
  `done` would force every `fold` call site in `src/recovery/` to handle variants that can never occur
  there. What `sdk-design-nodejs/07` §7.2 asks to reuse is the *idiom* — a `kind`-discriminated union over
  frozen literals.

Limits worth knowing at the call site:

- **The line cap is opt-in and off by default** (`SSE-19`), matching the reference's own absence of a cap.
  Set `maxLineBytes` to bound memory against a server that never sends a terminator; exceeding it raises
  `SseLineTooLongError`, which carries `limitBytes` as a field so a log aggregator indexes it without
  parsing the message.
- **`signal` adds a trigger, not a code path.** Aborting closes the stream, which is all the cancellation
  a pull-based reader needs: an iterator sitting *between* pulls ends cleanly (`SSE-27`), and one blocked
  *in* a read surfaces an `IoError` (`SSE-31`). Both paths release the owned resource exactly once.
- **A release failure on a clean terminal path is swallowed and reported out-of-band** (`SSE-30`), because
  throwing would discard events already delivered. `onReleaseFailure` receives it and defaults to a no-op;
  Phase 7 wires a real `Logger` there without reshaping the class. An explicit `close()` still propagates.
- **A bodyless response is rejected rather than yielding an empty stream** (`SSE-32`). It is a server or
  caller mistake, and silently producing zero events would hide it behind a successful-looking loop that
  does nothing.
- **`SSE-41`'s reactive `Observable` view is not here.** It is a MAY, and the roadmap scopes §18's
  async-runtime adapters to Phase 8b (`@dexpace/rx`). Deferral recorded at §I1. `SSE-21`'s hash-equality
  clause has no JavaScript analogue; value equality ships as `sseEventsEqual()` (§I4).
