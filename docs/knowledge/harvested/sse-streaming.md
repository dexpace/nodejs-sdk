# sse-streaming

## Rules
- The SSE stream MUST be parsed line by line with a blank line acting as the event-dispatch boundary, collapsing accumulated fields into exactly one event and resetting per-event accumulators for the next block.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:9-9` · high · sha:dd401a407f5d</sub>
- SSE line termination MUST recognize LF, CR, and CRLF, treating CRLF as a single terminator with terminators stripped, and a lone CR terminates a line by itself.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:10-10` · high · sha:dd401a407f5d</sub>
- A non-comment SSE line MUST be split at its first colon into field name and value, with no colon yielding the whole line as the field name with empty value, and a trailing colon yielding an empty value.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:11-11` · high · sha:dd401a407f5d</sub>
- An SSE field present with an empty value MUST be recorded with the empty string as value and count as a field seen, distinct from the field being absent, and a port MUST NOT collapse present-but-empty into absent.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:12-12` · high · sha:dd401a407f5d</sub>
- Extracting an SSE field value or comment text MUST strip exactly one leading U+0020 SPACE immediately after the colon if present, while further leading spaces are preserved.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:13-13` · high · sha:dd401a407f5d</sub>
- An SSE line whose first character is a colon MUST be treated as a comment whose text is captured latest-wins within a block, and a comment counts as a field seen so a comment-only block dispatches.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:14-14` · high · sha:dd401a407f5d</sub>
- Only the SSE field names id, event, data, and retry MUST be interpreted; any other field name MUST be silently discarded, setting no state and causing no dispatch.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:15-15` · high · sha:dd401a407f5d</sub>
- Consecutive data fields within an SSE block MUST accumulate in wire order into an ordered list of raw per-line values, with the parser not joining them since joining is deferred to the typed layer.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:16-16` · high · sha:dd401a407f5d</sub>
- An SSE id value containing a U+0000 NUL MUST be ignored entirely, not setting the id, not counting as a field seen, and not overwriting a valid id already seen in the same block, while a valid id is stored verbatim with latest-wins semantics.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:17-17` · high · sha:dd401a407f5d</sub>
- The SSE event field MUST be stored raw with latest-wins semantics and surfaced as absent/null when no event field was sent, and MUST NOT be defaulted to "message".
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:18-18` · high · sha:dd401a407f5d</sub>
- An SSE retry value MUST be accepted only if it consists solely of ASCII digits 0-9, with a sign, embedded non-digit, empty value, or value exceeding the maximum representable millisecond magnitude causing the field to be ignored, and a port MUST pick a documented cap and reject beyond it rather than wrap.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:19-19` · high · sha:dd401a407f5d</sub>
- A single leading UTF-8 BOM at the very start of an SSE stream MUST be consumed once using non-consuming lookahead so a non-BOM prefix is left intact, and any BOM appearing later in the stream MUST be preserved as ordinary data.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:20-20` · high · sha:dd401a407f5d</sub>
- SSE dispatch MUST be permissive, emitting an event whenever any of the five tracked fields (id, event, data, comment, retry) was set in the block, while a block in which no field was set MUST be skipped.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:24-24` · high · sha:dd401a407f5d</sub>
- At end-of-stream, if SSE fields have accumulated but no terminating blank line was seen, the parser MUST dispatch the pending event, if no field accumulated it MUST signal end, and a final line without a terminator at EOF is returned as content.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:25-25` · high · sha:dd401a407f5d</sub>
- The SSE reader's next() MUST return an end-of-stream sentinel exactly when the source is exhausted with no pending dispatchable fields, and MUST continue to report end on subsequent calls.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:26-26` · high · sha:dd401a407f5d</sub>
- The SSE reader MUST be single-pass and stateful such that only the "BOM already consumed" flag persists across calls; the last-event-id is NOT carried forward, and a port MUST NOT maintain a WHATWG-style persistent last-event-id buffer inside the parser.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:30-30` · high · sha:dd401a407f5d</sub>
- The SSE reader MUST NOT own or close the underlying byte source; source lifecycle is the caller's responsibility, with resource ownership introduced only by the stream facade.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:31-31` · high · sha:dd401a407f5d</sub>
- A single SSE reader instance MUST be driven from one thread at a time, as the parser offers no thread-safety for concurrent next() calls, and a port MAY leave the parser non-thread-safe.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:32-32` · high · sha:dd401a407f5d</sub>
- A parsed SSE event MUST be immutable and hold a defensively-copied, read-only data list so neither the caller's originally-supplied list nor later mutations can reach inside a constructed event, and any copy-with-changes operation MUST likewise copy the data list.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:37-37` · high · sha:dd401a407f5d</sub>
- The SSE streaming facade MUST own exactly one closeable resource and MUST close it exactly once across the stream's whole life regardless of termination path (clean end, explicit close, use-block exit, partial consume, or mid-stream failure).
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:45-45` · high · sha:dd401a407f5d</sub>
- On reader end-of-stream during iteration, the SSE facade MUST both terminate the iterator cleanly and release the resource, so a fully-consumed stream needs no explicit close (SSE-24).
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:46-46` · high · sha:dd401a407f5d</sub>
- A partial consume of the SSE stream MUST NOT strand the resource; closing after reading only some events MUST release it (SSE-25).
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:47-47` · high · sha:dd401a407f5d</sub>
- The SSE streaming facade MUST be single-pass such that obtaining an iterator succeeds at most once, and a second attempt MUST fail loudly.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:48-48` · high · sha:dd401a407f5d</sub>
- After close, requesting an iterator from the SSE facade MUST fail loudly, and an in-flight iterator MUST observe the closed state and end cleanly on its next pull, with neither path reading from the torn-down resource.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:49-49` · high · sha:dd401a407f5d</sub>
- The SSE facade's close() MUST be idempotent such that only the first call propagates to the owned resource, and this MUST hold even after an automatic release on a terminal/failure path.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:50-50` · high · sha:dd401a407f5d</sub>
- A mid-stream SSE reader failure MUST release the resource before the error propagates, and if releasing itself fails while an error is in flight, that release failure MUST be attached to the primary error as a suppressed/secondary throwable.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:51-51` · high · sha:dd401a407f5d</sub>
- A release failure on an automatic clean-terminal SSE path MUST NOT be turned into a thrown result that discards delivered events but instead reported out-of-band and swallowed, while a release failure during an explicit close() MUST propagate.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:52-52` · high · sha:dd401a407f5d</sub>
- The SSE facade's close() MUST be safe to call from a different thread than the one iterating, with the closed state guarded atomically; a close observed between pulls ends iteration cleanly, while a close that tears the resource down during an in-flight blocked read surfaces as a read failure, and the resource is released exactly once either way.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:53-53` · high · sha:dd401a407f5d</sub>
- The convenience that opens an SSE stream over an HTTP response MUST bind the stream's lifecycle to the response body, so closing the stream closes the response, and MUST fail loudly if the response has no body.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:54-54` · high · sha:dd401a407f5d</sub>
- The typed SSE adapter MUST invoke the mapper with (event-name, joined-data) where event-name is the raw event field (absent/null if omitted) and joined-data is the data lines joined with a single newline (empty string when no data), and MUST yield the mapper's decoded value.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:58-58` · high · sha:dd401a407f5d</sub>
- The typed SSE adapter MUST honor the mapper's three outcomes: a value is yielded, a Skip silently drops the event and advances without surfacing to the consumer, and a Done ends iteration cleanly and closes the stream without yielding a model for the sentinel event.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:59-59` · high · sha:dd401a407f5d</sub>
- Typed SSE decoding MUST be lazy and per-element, running the mapper only when the consumer pulls the next element, so a partial consume decodes only the events taken.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:60-60` · high · sha:dd401a407f5d</sub>
- A typed SSE mapper that throws MUST propagate the exception to the consumer's pull but MUST first release the underlying resource, and a resulting release failure MUST be attached to the mapper error as suppressed.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:61-61` · high · sha:dd401a407f5d</sub>
- Reconnection and last-event-id continuity MUST remain the caller's responsibility: the SSE subsystem surfaces the retry hint and each event's raw id but MUST NOT auto-reconnect, MUST NOT persist a last-event-id across events, and MUST NOT set a reconnect request header, though a callback listener contract MAY be offered with no-op default hooks not auto-driven by core.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:66-66` · high · sha:dd401a407f5d</sub>
- SSE event delivery MUST be pull-based with no eager read-ahead, advancing the source only when the consumer requests the next event so a blocking source read is the backpressure mechanism and no unbounded internal buffer accumulates; a reactive/async adapter MUST preserve this by polling the source at most once per unit of downstream demand.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:67-67` · high · sha:dd401a407f5d</sub>
- The non-blocking scheduled-delay primitive must complete after the requested delay without blocking a thread, must complete immediately for a zero delay, must reject a negative delay, and cancelling the returned future must cancel the underlying scheduled task so no scheduler thread is held.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:39-39` · high · sha:f1bf00174456</sub>
- Every bridge and facade overload that accepts per-call request options must thread those options into the wrapped send so per-request overrides survive the async boundary, rather than being dropped by the SPI's options-ignoring default overload.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:40-40` · high · sha:f1bf00174456</sub>
- Once a Response has been delivered to the caller through the future, cancelling that future must not close the Response body — the caller owns closing it even when discarding it — which is distinct from the rule that the adapter closes only a value the future never delivered.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:41-41` · high · sha:f1bf00174456</sub>
- An adapter exposing a streaming source (SSE) as a reactive stream must honor downstream backpressure by polling the source at most once per unit of demand, must complete on end-of-source, must propagate a source exception as an error signal while not swallowing fatal errors, must not close the caller-owned source on any termination, and must treat the source as single-subscriber (a fresh source per subscription).
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:42-42` · high · sha:f1bf00174456</sub>
- Async transport implementations must be safe for concurrent calls from multiple threads, with all per-call mutable state confined to the returned future's completion graph.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:43-43` · high · sha:f1bf00174456</sub>
- The SSE stream facade's `finally` block must invoke `response.body.cancel()` exactly once regardless of which termination path (clean end-of-stream, explicit break, or mid-stream parse failure) triggered it.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:56-59` · high · sha:d546f9973c4e</sub>

## Constraints
- The SSE parser MAY accept arbitrarily long lines/values with no built-in size cap in the reference implementation, which is a potential unbounded-memory surface for untrusted servers; a port MAY add a configurable cap and reject/truncate oversized lines while documenting the divergence.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:33-33` · high · sha:dd401a407f5d</sub>
- Core SSE parsing/streaming MUST remain format- and API-agnostic with no built-in done-sentinel, no error-envelope recognition, and no serialization dependency; in the reference implementation, sdk-core carries zero serialization dependency, making this a hard architectural invariant.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:65-65` · high · sha:dd401a407f5d</sub>

## Conclusions
- The SSE subsystem deliberately owns no reconnection policy, no last-event-id continuity, and no per-API sentinel conventions, leaving those to caller-supplied code.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:3-3` · high · sha:dd401a407f5d</sub>
- The SSE spec includes deliberate deviations from strict WHATWG behavior (comment exposure, permissive dispatch, EOF partial-dispatch), and a port aiming for parity MUST replicate them or offer a strict-WHATWG mode.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:5-5` · high · sha:dd401a407f5d</sub>
- The SSE event SHOULD provide structural value semantics: equality/hash over all five fields and a stable string form.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:38-38` · high · sha:dd401a407f5d</sub>
- The SSE event SHOULD expose an is-empty predicate true only when all five fields are unset/empty, and because a comment counts as content, a comment-only event SHOULD report non-empty.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:39-39` · high · sha:dd401a407f5d</sub>
- Sequence/iterable convenience views over a raw SSE source SHOULD be lazy, single-pass, and propagate read exceptions at the offending pull, SHOULD reuse one reader instance to preserve per-stream BOM-consumption state, and MUST NOT be invoked twice on the same source.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:68-68` · high · sha:dd401a407f5d</sub>
- A reactive SSE adapter MAY catch only recoverable exceptions and let the runtime's fatal/VM error family escape rather than routing it through the error channel, and MAY leave source lifecycle to the caller; a port SHOULD apply its own runtime's fatal/non-fatal split and document source ownership.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:69-69` · high · sha:dd401a407f5d</sub>
- The port rejects the browser's native `EventSource` as the SSE building block for three reasons: it auto-reconnects contrary to the requirement that reconnection remain the caller's responsibility, it is GET-only with no custom-header support, and it does not exist in Node without a polyfill package.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:48-52` · high · sha:d546f9973c4e</sub>
- `@dexpace/core` hand-implements the WHATWG SSE line/field grammar as a small synchronous state machine operating over the `BufferedSource` line-reading primitive, exposed as an `AsyncGenerator<SseEvent>` using the same async-generator idiom as pagination.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:52-56` · high · sha:d546f9973c4e</sub>

## Reference
- The SSE subsystem parses a byte stream into discrete events following the WHATWG SSE line/field grammar, exposes each event as an immutable value, and layers a resource-owning, single-pass, lazily-decoding streaming facade whose lifecycle is bound to the underlying HTTP response.
  <sub>spec · `docs/product-spec/13-server-sent-events-and-streaming.md:3-3` · high · sha:dd401a407f5d</sub>
- Backpressure is flow control in which a consumer's demand governs how fast a producer is polled, and in the SDK the blocking source read is the backpressure mechanism for SSE.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:9` · high · sha:f0b3d2058626</sub>
- Dispatch (SSE) is the framing act, triggered by a blank line, of collapsing the fields accumulated since the previous boundary into one Server-Sent Event.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:27` · high · sha:f0b3d2058626</sub>
- A live tail is, on the SSE / body-preview exceeds-cap path, the still-open delegate source retained after the prefix was captured, carrying the un-buffered remainder and readable exactly once.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:33` · high · sha:f0b3d2058626</sub>
- The SSE conformance suite verifies blank-line dispatch with fresh per-block accumulators (SSE-1), LF/CR/CRLF terminator handling (SSE-2), first-colon field splitting with colon-less/trailing-colon empty value (SSE-3), present-but-empty distinct from absent (SSE-4), single-space value stripping (SSE-5), comment capture counting as content (SSE-6), unknown fields discarded (SSE-7), multi-`data` accumulation as a list (SSE-8), NUL-bearing id ignored (SSE-9), absent `event` not defaulted to `message` (SSE-10), digit-only `retry` with overflow rejection (SSE-11), and start-only BOM strip with mid-stream BOM preserved (SSE-12).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:20` · high · sha:0451cc7f3bb4</sub>
- The SSE conformance suite verifies permissive dispatch of id-/retry-/comment-only blocks with no-field blocks skipped (SSE-13), EOF partial dispatch (SSE-14), a stable end sentinel (SSE-15), no persistent last-event-id (SSE-16), the reader not owning the source (SSE-17), a single-thread reader contract (SSE-18), and unbounded lines accepted or a documented cap (SSE-19).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:21` · high · sha:0451cc7f3bb4</sub>
- The SSE conformance suite verifies an immutable event with defensively-copied data (SSE-20), value equality over five fields (SSE-21), and an is-empty predicate treating a comment as non-empty (SSE-22).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:22` · high · sha:0451cc7f3bb4</sub>
- The SSE conformance suite verifies the facade closes the owned resource exactly once across clean end, explicit close, use-block, and partial consume/mid-stream failure (SSE-23/24/25); a single-pass iterator (SSE-26); post-close iterator failure with in-flight ends cleanly (SSE-27); idempotent close (SSE-28); mid-stream failure releases before propagating with a suppressed close error (SSE-29); auto-terminal release failure swallowed versus explicit close propagating (SSE-30); cross-thread close (SSE-31); and response-opening convenience binds lifecycle and rejects a bodyless response (SSE-32).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:23` · high · sha:0451cc7f3bb4</sub>
- The SSE conformance suite verifies the typed adapter's mapper receives event-name and newline-joined data (SSE-33), Value/Skip/Done are honored (SSE-34), lazy per-element decode occurs (SSE-35), and a mapper throw releases the resource first (SSE-36).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:24` · high · sha:0451cc7f3bb4</sub>
- The SSE conformance suite verifies the core holds no sentinel/error/serde convention (SSE-37), no auto-reconnect or last-event-id header exists (SSE-38), delivery is pull-based with one poll per demand (SSE-39), lazy single-pass convenience views reuse one reader (SSE-40), and reactive fatal/non-fatal split with source-ownership is documented (SSE-41).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:25` · high · sha:0451cc7f3bb4</sub>
- The SSE typed adapter's Skip/Done/Value outcomes reuse the same `Outcome`-shaped discriminated union introduced for the pipeline layer rather than being re-invented.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:59-61` · high · sha:d546f9973c4e</sub>

## Conflicts

## Superseded
