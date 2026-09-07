# observability

## Rules
- The request-logging wrapper MUST mirror the exact bytes the wrapped body's single write produces into an internal tap while forwarding those same bytes to the transport sink, consuming the upstream exactly once; the full payload MUST always reach the transport regardless of any tap cap (BODY-17).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- The request-logging tap MUST be cleared at the start of every write so a post-write snapshot reflects only the most recent attempt, and retries against a replayable delegate MUST NOT accumulate in the tap (BODY-18).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- The request-logging tap MUST be bounded by a configurable cap; once reached, further bytes stop being copied into the tap while the full payload continues to the transport (BODY-19).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- If the wrapped write fails partway, the snapshot SHOULD return the bytes mirrored up to the failure (BODY-20).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- The request-logging wrapper MUST expose the delegate's replayability verbatim, and its materialize-once MUST return a wrapper around the delegate's replayable form, preserving the tap cap (BODY-21).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- The request-logging tee MUST NOT expose a direct writable-buffer handle that bypasses the primary sink, restating IO-28 at the body layer (BODY-37).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:34-34` · high · sha:c2bf15dc8a06</sub>
- The response-logging wrapper MUST drain the delegate at most once, lazily, on first access (read/snapshot/exception query), buffering up to a configurable byte cap, with concurrent first accesses serialized so the upstream is read exactly once via a once-latch/mutex that does not pin the carrier thread (BODY-22).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:38-38` · high · sha:c2bf15dc8a06</sub>
- When the whole response body fits within the cap, the wrapper MUST capture it entirely, close the delegate, and thereafter serve every read as a fresh non-consuming view — fully repeatable, with each read succeeding independently (BODY-23).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:39-39` · high · sha:c2bf15dc8a06</sub>
- When the response body exceeds the cap, the wrapper MUST buffer only the prefix, leave the delegate open, and serve the next read as a single-use stream that first replays the captured prefix then continues from the still-live tail so the consumer receives the complete body; a second read in this regime MUST fail (BODY-24).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:40-40` · high · sha:c2bf15dc8a06</sub>
- A delegate read returning zero bytes for a positive requested count MUST be treated as a stream-contract violation, never end-of-stream; EOF is signaled only by the explicit sentinel (BODY-25).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:41-41` · high · sha:c2bf15dc8a06</sub>
- A failure during the response-body drain MUST NOT silently truncate — the wrapper retains bytes read before the failure and caches the error such that reads re-throw it every call, snapshot returns the partial bytes without throwing, and an exception-query accessor surfaces the cached error without triggering a drain (BODY-26).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:41-41` · high · sha:c2bf15dc8a06</sub>
- The response-logging wrapper MUST close the delegate at most once across all close paths, routing the wrapper's own close and the one-shot tail's close through a single shared close-once guard, because some transport streams throw on double-close; if the delegate's close throws it MUST still be marked closed (BODY-27).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:42-42` · high · sha:c2bf15dc8a06</sub>
- On the fits-cap path, a close failure after a successful full capture MUST NOT be reported as a drain error nor prevent serving the captured body, and the captured in-memory buffer MUST survive the wrapper's close so post-mortem snapshot logging still works (BODY-28).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:42-42` · high · sha:c2bf15dc8a06</sub>
- Reported content length SHOULD be the captured size only when the response body was fully captured, otherwise the delegate's declared length (BODY-29).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:42-42` · high · sha:c2bf15dc8a06</sub>
- The never-breaks-the-caller guarantee is asymmetric: log-emission failures are caught and swallowed, while tracing and metrics calls are not defensively wrapped, so a port must either honor the SPI contract that those callbacks never throw or add its own guards.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:3-3` · high · sha:1b678eca176d</sub>
- When the requested log level is disabled, obtaining a log event and calling its builder methods and terminal emit must allocate nothing and produce no output, with enabled/disabled decided once at event-creation time and a shared inert event returned for the disabled case.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:7-7` · high · sha:1b678eca176d</sub>
- A field key must be rejected when empty, and a null field value must not be dropped but must be emitted as the literal string "null".
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:9-9` · high · sha:1b678eca176d</sub>
- Calling event(name) sets an authoritative categorisation tag under the reserved key "event"; an empty name clears the tag, and when a non-empty tag is set, any "event" key from global context, folded diagnostic context, or a per-event field must be suppressed so the emitted event carries "event" exactly once, because JSON appenders would otherwise produce invalid duplicate-key output.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:10-10` · high · sha:1b678eca176d</sub>
- When the same field key is contributed by more than one source, precedence must be per-event field over global context over folded diagnostic context, and a key must appear at most once in the emitted output.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:11-11` · high · sha:1b678eca176d</sub>
- Field-value rendering must be total and never throw: throwables render as "SimpleClassName: message", arrays/collections/maps as a bracketed textual form, numeric/boolean/char primitives pass through type-preserving, and if a value's own string conversion throws, the facade substitutes a diagnostic placeholder.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:12-12` · high · sha:1b678eca176d</sub>
- A rendered field value should be truncated to a bounded maximum (reference 8 KiB) with a truncation marker, with primitives exempt from truncation.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:13-13` · high · sha:1b678eca176d</sub>
- A single log event must be emitted at most once — a second terminal emit must be a no-op — and this guard must be correct under concurrent invocation, though field/tag/cause accumulation need not itself be thread-safe.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:14-14` · high · sha:1b678eca176d</sub>
- A global key/value context configured on the logger must attach to every event (subject to per-event/global/diagnostic-context precedence), and for hot-path efficiency the implementation should reference the caller-supplied context rather than deep-copying it per event.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:15-15` · high · sha:1b678eca176d</sub>
- A once-per-logger diagnostic should warn when a caller sets a per-event field colliding with the reserved "event" key, throttled to at most one emission per logger and gated on the verbose level being enabled, while ambient "event" keys from global/diagnostic context defer silently and must not be warned about.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:16-16` · high · sha:1b678eca176d</sub>
- A transport dropping a caller-set request header it cannot encode should surface the drop with a configurable verbosity policy offering at least WARN every occurrence, WARN the first drop per header name then verbose, or verbose only, defaulting to once-per-header-name.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:32-32` · high · sha:1b678eca176d</sub>
- Emitting log events around a request must not fail the request: every log-emission site must catch any exception and re-surface it as a best-effort http.instrumentation.* diagnostic, with a secondary failure while emitting that diagnostic swallowed, whereas tracer and metrics calls are not defensively wrapped so a throwing tracer or meter will propagate and can fail the request.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:36-36` · high · sha:1b678eca176d</sub>
- A Span must expose a recording flag; when non-recording, all mutators must be inert and end() a no-op, and end() (success and error variants) must be idempotent.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:40-40` · high · sha:1b678eca176d</sub>
- Activating a span as current must return a scope handle that, when closed, restores the previously-active span; the scope must be closeable from a try/using construct and must restore even when the guarded code throws.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:41-41` · high · sha:1b678eca176d</sub>
- Activating a span for log correlation must push the trace id and span id onto the thread-local diagnostic context (keys trace.id, span.id) for the scope's lifetime and restore each to its prior value (or remove) on close; for a non-recording span the push is skipped and activation delegates to plain current-span activation.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:42-42` · high · sha:1b678eca176d</sub>
- Thread-local diagnostic context must be bridgeable across async thread boundaries via an immutable snapshot: capture on the originating thread, reinstall on the executing thread for a block's duration, and restore the prior context afterward including on exception.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:43-43` · high · sha:1b678eca176d</sub>
- Tracing abstractions must provide allocation-free no-op defaults used when tracing is disabled — a no-op tracer returning a shared no-op span, a no-op span whose current-scope is cached, a no-op instrumentation context with all-invalid sentinels, and a no-op HTTP-tracer/factory — and selecting a no-op path must not allocate per call.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:44-44` · high · sha:1b678eca176d</sub>
- Trace-id generation must support at least a W3C flavour (128-bit as 32 lowercase hex), a Datadog flavour (64-bit unsigned decimal), and a no-op flavour yielding the invalid sentinel, and must not produce the reserved all-zero id, coercing a zero draw to non-zero.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:49-49` · high · sha:1b678eca176d</sub>
- The SDK should provide an HTTP-shaped tracer vocabulary richer than start/end — operation started/succeeded/failed, per-attempt started/failed with next-delay/retries-exhausted, and transport milestones (URL resolved, connection acquired, request sent with byte count, response headers received, response received with byte count) — with every method defaulting to a no-op so adding an event is non-breaking.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:53-53` · high · sha:1b678eca176d</sub>
- HTTP-tracer lifecycle ordering must hold operationStarted once at the start, operationSucceeded and operationFailed mutually exclusive and each firing once at the end, attempt events may fire multiple times, and retries-exhausted (when it fires) is immediately followed by operationFailed with the same throwable, with one tracer instance corresponding 1:1 to a single logical operation.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:54-54` · high · sha:1b678eca176d</sub>
- Tracer and HTTP-tracer callbacks must be safe to invoke concurrently and from transport threads and must not throw from any callback, and metrics instruments must likewise be safe to call concurrently and must not throw, since the runtime does not defensively catch these callbacks and a violation breaks the caller's request.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:55-55` · high · sha:1b678eca176d</sub>
- The metrics SPI must expose a Meter manufacturing at least a monotonic integer counter and a floating-point histogram, each accepting per-measurement key/value attributes; the default Meter must be a no-op that discards every measurement and returns shared instrument singletons, and the core must not pull a metrics runtime into its dependencies.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:59-59` · high · sha:1b678eca176d</sub>
- A monotonic counter must document that only non-negative increments are valid, with the core instrument not validating on the hot path, and a histogram must tolerate any input without throwing, delegating non-finite-value handling to concrete adapters.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:61-61` · high · sha:1b678eca176d</sub>
- HTTP logging granularity must be selectable across at least none, headers-only, and headers-plus-body, defaulting to none; at none, request/response log events must not be emitted and body capture occurs only at the body level, while span lifecycle and metric recording run on every request independent of the log level.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:65-65` · high · sha:1b678eca176d</sub>
- A log-level value should be resolvable from layered configuration (explicit override, then environment variable, then normalized system property, then default) with tolerant case-insensitive, whitespace-trimmed parsing, falling back to a caller-supplied default (itself defaulting to "none"), and the SDK must not bake in a default config key name.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:66-66` · high · sha:1b678eca176d</sub>
- Under body logging, body capture must be bounded to a configurable preview size (reference default 8 KiB) and must not buffer the whole body — a body larger than the cap must still stream in full to the caller by replaying the captured prefix then continuing from the live tail, with only the preview occupying memory.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:67-67` · high · sha:1b678eca176d</sub>
- For unknown-length (streaming/chunked) response bodies, the async logging path should skip body capture entirely and stream the body unwrapped, so a slow producer cannot block the completion thread.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:68-68` · high · sha:1b678eca176d</sub>
- A captured body preview should be charset-aware for text (decoding with the media type's charset, falling back to UTF-8) and binary-safe for non-text (a size-only marker such as "[binary N bytes captured]"), decoding must not throw on malformed/truncated input (yielding replacement characters), and empty input yields an empty preview.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:69-69` · high · sha:1b678eca176d</sub>
- The emitted structured event names and field keys must be stable, at minimum events http.request and http.response carrying http.request.method, url.full (redacted), http.response.status_code, http.response.duration_ms, and content-length/header fields, with a failure emitting an http.response event with error.type and the throwable cause, and url.full must always be the redacted URL.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:70-70` · high · sha:1b678eca176d</sub>
- Diagnostic/preview reads of caller- or server-controlled payloads (error-body snapshots, request/response body log previews) must be byte-capped and should be non-consuming, never materializing an unbounded payload into memory nor disturbing the primary read path the consumer will use.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:53` · high · sha:d6123be82c9e</sub>

## Constraints

## Conclusions
- The observability design intent is that observability is always safe (never leaks secrets), always cheap when disabled (no hot-path allocation), and never breaks the caller.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:3-3` · high · sha:1b678eca176d</sub>
- The logging facade uses `Logger`/`LogEvent` structural interfaces with one shared, allocation-minimal no-op default installed process-wide until a consumer supplies a real one, implemented as a single frozen object whose methods all return `this` and whose terminal `emit()` is a no-op.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:3-6` · high · sha:35281a426195</sub>
- `@dexpace/logging-pino` and `@dexpace/logging-debug` are the two reference logging bridges, chosen because `pino` is the dominant high-throughput structured-JSON logger fitting the SDK's field/structured-event model and `debug` is the zero-configuration option most Node engineers already have wired into their terminal output.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:6-11` · high · sha:35281a426195</sub>
- The `Tracer`/`Span` seam for W3C Trace Context is defined as a structural subset of `@opentelemetry/api`'s own `Tracer`/`Span` shapes rather than a bespoke interface, because Node's tracing ecosystem has largely converged on that one dominant API, allowing zero-adapter-code compatibility with applications already running OpenTelemetry auto-instrumentation with no dependency added to `@dexpace/core`.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:13-19` · high · sha:35281a426195</sub>

## Reference
- The observability subsystem comprises a zero-allocation structured-logging facade, a credential-scrubbing redaction policy, a diagnostic-context (MDC) allow-list, W3C-Trace-Context-compliant tracing, an HTTP-shaped tracer vocabulary, and a metrics SPI with an inert no-op default.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:3-3` · high · sha:1b678eca176d</sub>
- The logging facade exposes exactly four severity levels — ERROR, WARNING, INFO, VERBOSE — mapped onto the backend's ERROR, WARN, INFO, and most-verbose/DEBUG levels.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:8-8` · high · sha:1b678eca176d</sub>
- An instrumentation/trace context exposes W3C-compliant identifiers (a trace id, a 16-lowercase-hex-char span id, trace flags as a two-hex-char byte, a trace-state list) plus validity/remoteness flags, with reserved invalid sentinels of a 32-hex-zero trace id, 16-hex-zero span id, trace flags "00", and empty trace-state; an all-zero trace/span id is treated as invalid.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:48-48` · high · sha:1b678eca176d</sub>
- The default HTTP instrumentation should emit a request counter named http.client.request.count (unit {request}) and a latency histogram named http.client.request.duration (unit ms), tagged with method and either status code (success) or error type (failure), following OpenTelemetry semantic conventions and UCUM unit symbols.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:60-60` · high · sha:1b678eca176d</sub>
- The diagnostic-context (MDC) allow-list is the set of thread-local logging-context keys folded into an SDK log event, defaulting to `{trace.id, span.id}`, preventing arbitrary application context from leaking into SDK-owned events.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:25` · high · sha:f0b3d2058626</sub>
- W3C Trace Context is the interoperable trace-correlation format the instrumentation context complies with, comprising trace id, span id, trace flags, and trace state, with reserved all-zero invalid sentinels.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:71` · high · sha:f0b3d2058626</sub>
- The instrumentation conformance suite verifies a disabled level allocates and emits nothing, returning a shared inert event (OBS-1); four levels map to the backend (OBS-2); an empty key is rejected with a null value rendered as literal `null` (OBS-3); the reserved `event` tag is emitted exactly once with empty clearing it (OBS-4); field > global > diagnostic-context precedence holds with one occurrence per key (OBS-5); total rendering falls back to a placeholder on a throwing string conversion (OBS-6); bounded truncation exempts primitives (OBS-7); a single-emit guard is correct under races (OBS-8); global context appears on every event (OBS-9); and reserved-key collision is warned once per logger (OBS-40).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:39` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies the diagnostic-context allow-list defaults to `{trace.id, span.id}`, a null allow-list folds all keys, and null values are skipped (OBS-10).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:40` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies URL userinfo is always redacted (OBS-11); query values are redacted unless allow-listed with atomic multi-value handling (OBS-12); fragment key=value pairs are scrubbed while a plain fragment is preserved (OBS-13); scheme/host/port/path are preserved with no spurious `?` from a fragment `?` (OBS-14); a malformed URL redacts to `[malformed url]` and never throws (OBS-15); header-value URLs are redacted with a path-kept `?***` fallback (OBS-16); Location/Content-Location headers are redacted via the shared policy (OBS-17); header-name allow-listing is default-deny (OBS-18); and a dropped-header verbosity policy exists (OBS-19).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:41` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies logging failures are caught and re-emitted as `http.instrumentation.*` events while tracer/meter throws propagate (OBS-20).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:42` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies the span recording flag and idempotent end (OBS-21); a scope restores the prior span on close including on throw (OBS-22); a log-correlation scope pushes/restores trace.id/span.id and is skipped for non-recording spans (OBS-23); an async MDC bridge saves/installs/restores context including on throw (OBS-24); and allocation-free no-op tracing defaults (OBS-25).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:43` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies W3C identifiers use all-zero invalid sentinels (OBS-26), W3C/Datadog/no-op id generation never produces all-zero ids (OBS-27), an HTTP-tracer vocabulary has default no-ops (OBS-28), lifecycle ordering includes exhausted-then-failed pairing (OBS-29), and tracer/meter callbacks are concurrent-safe and never throw (OBS-30).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:44` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies a meter yields a monotonic counter plus histogram with attributes with a no-op default discarding metrics and no metrics runtime pulled in (OBS-31), OpenTelemetry-convention names/units are used (OBS-32), and a counter accepts only non-negative values while a histogram tolerates any input (OBS-33).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:45` · high · sha:0451cc7f3bb4</sub>
- The instrumentation conformance suite verifies log level none/headers/body operate with span and metrics running independent of level (OBS-34), a layered tolerant level resolution has no baked-in key (OBS-35), a bounded body preview still streams the full body to the caller (OBS-36), async skips capture for unknown-length bodies (OBS-37), a charset-aware/binary-safe preview never throws (OBS-38), and stable event names/keys are used with redacted url.full (OBS-39).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:46` · high · sha:0451cc7f3bb4</sub>
- Redaction is implemented directly against the global `URL` class, using userinfo stripping, allow-listed query-parameter redaction via `url.searchParams`, and manual hand-rolled fragment-token redaction since `URL` does not parse `key=value` tokens out of `url.hash`.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:19-22` · high · sha:35281a426195</sub>

## Conflicts

## Superseded
