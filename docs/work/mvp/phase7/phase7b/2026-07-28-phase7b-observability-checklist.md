# Phase 7b — Instrumentation & Observability — Checklist

**Status: EXECUTED.** Every ✅ below names code and tests that exist on this branch, not a plan step. Verified
against `docs/product-spec/15-instrumentation-and-observability.md` over every requirement ID (`OBS-1` through `OBS-40`),
plus Task 1 through Task 10 deliverables, package builds, and API reports.

**Legend:** ✅ Implemented and tested — 🚫 Not built (permanent simplification, named reason) — ⏳ Deferred
(named target phase) — N/A Not applicable in this port.

## 15.1 Structured Logging Facade

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-1 | MUST | Zero-overhead no-op default; disabled levels allocate nothing and produce no output | ✅ | `observability/logger.ts`: `NOOP_LOGGER`, `NOOP_EVENT`, `createLogger` short-circuits disabled levels before building event; asserted in `logger.test.ts` |
| OBS-2 | MUST | Four severity levels (`error`, `warning`, `info`, `verbose`) | ✅ | `observability/logger.ts`: `LogLevel` union type and facade level mappings; asserted in `logger.test.ts` |
| OBS-3 | MUST | Fluent `LogEvent` builder; rejected empty keys; null rendered as string "null" | ✅ | `observability/logger.ts`: `RealLogEvent.field`, non-empty key invariant, `renderField` converts null/undefined to "null"; asserted in `logger.test.ts` |
| OBS-4 | MUST | Reserved "event" tag key exclusively managed via `.event()`; empty string clears tag | ✅ | `observability/logger.ts`: `RealLogEvent.event` sets `eventTag` or clears; `.field("event", ...)` guarded and throttled; asserted in `logger.test.ts` |
| OBS-5 | MUST | Precedence: per-event fields > global context > diagnostic context | ✅ | `observability/logger.ts`: folded in order diagnosticContext → globalFields → per-event fields; asserted in `logger.test.ts` |
| OBS-6 | MUST | Total field rendering; never throws; numbers/booleans/bigints type-preserving; hostile `toString`/`toPrimitive` guarded | ✅ | `observability/logger.ts`: `renderField`, `renderNonPrimitive`, `renderScalar`, `fast-check` property tests in `logger.test.ts` |
| OBS-7 | SHOULD | String field values capped at 8 KiB with `…[truncated]` marker; UTF-16 surrogate pair boundary safe | ✅ | `observability/logger.ts`: `truncate()` at 8192 chars avoiding surrogate splitting; primitives exempt; asserted in `logger.test.ts` |
| OBS-8 | MUST | Single-emission guarantee per `LogEvent`; subsequent `.emit()` calls are no-ops | ✅ | `observability/logger.ts`: `RealLogEvent.emitted` boolean flag; asserted in `logger.test.ts` |
| OBS-9 | MUST | `Logger.withContext` adds immutable context to all derived loggers | ✅ | `observability/logger.ts`: `withContext` returns new logger with merged `globalFields`; asserted in `logger.test.ts` |
| OBS-40 | SHOULD | Collision warning for `.field("event", ...)` throttled to at most once per logger at verbose | ✅ | `observability/logger.ts`: `CollisionWarningGate` emits at most once at `verbose`; asserted in `logger.test.ts` |

## 15.2 Diagnostic Context Allow-List

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-10 | MUST | AsyncLocalStorage diagnostic context with default allow-list (`trace.id`, `span.id`); null allow-list folds all; null values skipped | ✅ | `observability/diagnostic-context.ts`: `withDiagnosticFields`, `getDiagnosticContext`, `DEFAULT_DIAGNOSTIC_ALLOW_LIST`, prototype-safe mapping; asserted in `diagnostic-context.test.ts` |

## 15.3 Redaction Policy

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-11 | MUST | Userinfo in URLs is always scrubbed to `***:***@` | ✅ | `observability/redaction.ts`: `redactUrl` replaces user/password; asserted in `redaction.test.ts` |
| OBS-12 | MUST | Query parameters scrubbed unless allow-listed; default allow-list is `{'api-version'}`; names and encoding preserved | ✅ | `observability/redaction.ts`: `redactQueryString` with case-insensitive name matching; asserted in `redaction.test.ts` |
| OBS-13 | MUST | Fragment tokens in `key=value` format scrubbed; plain text fragments preserved | ✅ | `observability/redaction.ts`: `redactFragment` matches `k=v` pairs; asserted in `redaction.test.ts` |
| OBS-14 | MUST | Scheme, host, port, path untouched; no spurious `?` added; `?` in fragment not confused with query delimiter | ✅ | `observability/redaction.ts`: structured URL parsing and delimiter preservation; asserted in `redaction.test.ts` |
| OBS-15 | MUST | Total URL redaction: malformed URLs redact to `[malformed url]`, never throws | ✅ | `observability/redaction.ts`: try-catch fallback, fast-check property-tested across all strings in `redaction.test.ts` |
| OBS-16 | MUST | Header values containing URLs are redacted (absolute as URL, relative keeps path + `?***`) | ✅ | `observability/redaction.ts`: `redactAbsoluteOrRelativeUrl`; asserted in `redaction.test.ts` |
| OBS-17 | MUST | Sensitive headers scrubbed; Location and Content-Location redacted as URLs | ✅ | `observability/redaction.ts`: `redactHeaderValue` with default-deny allow-list and URL detection; asserted in `redaction.test.ts` |
| OBS-18 | MUST | Configurable dropped header policy (`mark` with `REDACTED` vs `omit` dropping header) | ✅ | `observability/redaction.ts`: `DroppedHeaderPolicy` support in `redactHeaderValue`; asserted in `redaction.test.ts` |
| OBS-19 | SHOULD | Dropped-header verbosity policy (WARN-every / WARN-first-per-name / verbose-only) for transport encoding drops | ⏳ | **Phase 8a**: Requires concrete `fetch` transport capable of detecting unencodable headers |

## 15.4 Failure Containment

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-20 | MUST | Failure containment: logger exceptions and body-drain errors caught and surfaced as `http.instrumentation.logFailure` at verbose; tracer and meter exceptions propagate | ✅ | `observability/logging-step.ts` (`safeEmit`, `captureResponseBody`), `retry/engine.ts`, `redirect/redirect-step.ts`; asserted in `logging-step.test.ts` |

## 15.5 Tracing & Context (W3C)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-21 | MUST | Tracing SPI: `Span`, `Tracer`, `Scope`, `NOOP_SPAN`, `NOOP_TRACER`; non-recording span inert with idempotent `end()` | ✅ | `observability/tracing.ts`: `Span`, `Tracer`, `NOOP_SPAN`, `NOOP_TRACER`; asserted in `tracing.test.ts` |
| OBS-22 | MUST | `activateSpan` sets ambient span and restores previous on scope close, including on exception | ✅ | `observability/tracing.ts`: `activateSpan` using `createAsyncScopedStore`; asserted in `tracing.test.ts` |
| OBS-23 | MUST | `activateSpanForCorrelation` binds `trace.id` / `span.id` into diagnostic context for recording spans via `spanContext()` | ✅ | `observability/tracing.ts`: updates MDC and active span scope; asserted in `tracing.test.ts` |
| OBS-24 | MUST | Thread-local diagnostic context bridged across async boundaries via immutable snapshot (`withDiagnosticFields`) | ✅ | `observability/diagnostic-context.ts`: `withDiagnosticFields`, `pushDiagnosticFields`; asserted in `diagnostic-context.test.ts` |
| OBS-25 | MUST | Allocation-free no-op defaults used when tracing is disabled | ✅ | `observability/tracing.ts`: `NOOP_TRACER`, `NOOP_SPAN`; asserted in `tracing.test.ts` |
| OBS-26 | MUST | W3C-compliant identifiers: 32-hex trace id, 16-hex span id, flags, state, invalid all-zero sentinels | ✅ | `observability/tracing.ts`: `generateTraceId`, `generateSpanId`, `SpanContext`; asserted in `tracing.test.ts` |
| OBS-27 | MUST | Trace-id generation: W3C, Datadog (64-bit decimal), no-op sentinels; all-zero draws coerced non-zero | ✅ | `observability/tracing.ts`: `generateTraceId`, `createInstrumentationBundle`; asserted in `tracing.test.ts` |
| OBS-28 | SHOULD | Richer HTTP-tracer vocabulary (operation, per-attempt, and transport milestones) | ⏳ | **Phase 8a**: Interface + transport milestones wired with `fetch` transport |
| OBS-29 | MUST | HTTP-tracer lifecycle ordering contract (operationStarted, per-attempt, retries-exhausted, operationFailed/Succeeded) | ⏳ | **Phase 8a / Phase 9**: Lifecycle ordering verification with transport adapter |
| OBS-30 | MUST | Tracer and metrics callbacks must not throw; throwing tracer/meter propagates | ✅ | `observability/tracing.ts`, `observability/metrics.ts`, `observability/logging-step.ts`; asserted in `logging-step.test.ts` |

## 15.6 Metrics SPI

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-31 | MUST | Metrics SPI: `Counter`, `Histogram`, `Meter`, `NOOP_METER`; zero external dependencies | ✅ | `observability/metrics.ts`: `NOOP_METER`, `NOOP_COUNTER`, `NOOP_HISTOGRAM`; asserted in `metrics.test.ts` |
| OBS-32 | SHOULD | Semconv naming (`http.client.request.count`, `http.client.request.duration`) with method, status, errorType attributes | ✅ | `observability/logging-step.ts`: counter and histogram tagged with method and status/errorType; asserted in `logging-step.test.ts` |
| OBS-33 | MUST | Counter documents non-negative increments; Histogram tolerates all inputs without throwing | ✅ | `observability/metrics.ts`: `Counter`, `Histogram`, `NOOP_HISTOGRAM`; asserted in `metrics.test.ts` |

## 15.7 LOGGING Pillar Step & Event Vocabulary

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| OBS-34 | MUST | HTTP logging granularity (`none`, `headers`, `body`); span and metrics run independently of log level | ✅ | `observability/logging-step.ts`: `LoggingGranularity`, spans and metrics recorded under all granularities; asserted in `logging-step.test.ts` |
| OBS-35 | SHOULD | Ambient granularity resolution from Configuration `CFG_KEY_LOG_LEVEL` | ✅ | `observability/logging-step.ts`: `resolveGranularity` reads configuration key; asserted in `logging-step.test.ts` |
| OBS-36 | MUST | Request/response body preview capture bounded to preview size (default 8 KiB), non-buffering, size field emitted | ✅ | `observability/logging-step.ts`: `prepareRequestBody`, `captureResponseBody`, `http.request.body.size`, `http.response.body.size`; asserted in `logging-step.test.ts` |
| OBS-37 | SHOULD | Unknown-length response body skips capture; live stream delivered untouched | ✅ | `observability/logging-step.ts`: `captureResponseBody` skips when `content-length` missing; asserted in `logging-step.test.ts` |
| OBS-38 | SHOULD | Text bodies decoded safely with charset fallback; binary bodies rendered as `[binary N bytes captured]` | ✅ | `observability/logging-step.ts`: `isTextMediaType`, `decodeBodyText`, replacement on truncated multi-byte; asserted in `logging-step.test.ts` |
| OBS-39 | MUST | Structured event names `http.request` and `http.response` with standard field hierarchy and redacted `url.full` | ✅ | `observability/logging-step.ts`: `emitRequestEvent`, `emitResponseEvent`, `emitFailureEvent`; asserted in `logging-step.test.ts` |

## 15.8 Adapter Packages

| Package | Purpose | Status | Where |
|---|---|---|---|
| `@dexpace/logging-pino` | Pino logging adapter wrapping `pino` instance | ✅ | `packages/logging-pino/src/pino-logger.ts` |
| `@dexpace/logging-debug` | Debug logging adapter wrapping `debug` factory or debugger | ✅ | `packages/logging-debug/src/debug-logger.ts` |

## 15.9 Subsystem Retrofits

| Subsystem | Events Emitted | Status | Where |
|---|---|---|---|
| Retry Engine | `http.retry.delayOverrideFailed`, `http.retry.attemptFailed`, `http.retry.exhausted` (contained per OBS-20) | ✅ | `packages/core/src/retry/engine.ts` |
| Redirect Step | `http.redirect.hop`, `http.redirect.downgradePermitted`, `http.redirect.rejected` (contained per OBS-20) | ✅ | `packages/core/src/redirect/redirect-step.ts` |
| Standard Resilience Preset | `loggingStep` installed into `standardResilience` pipeline with options pass-through | ✅ | `packages/core/src/auth/preset.ts` |
