---
"@dexpace/core": minor
"@dexpace/logging-pino": minor
"@dexpace/logging-debug": minor
---

Add the instrumentation and observability subsystem (Phase 7b):
- The `Logger` / `LogEvent` structured logging facade and `createLogger` builder, with zero-allocation `NOOP_LOGGER`, four severity levels, 4-tier precedence folding, safe total field rendering with 8 KiB truncation, at-most-once single emission, and global logger slot (`getGlobalLogger`/`setGlobalLogger`).
- AsyncLocalStorage-backed diagnostic context (MDC) allow-list filtering (`trace.id`, `span.id`).
- Redaction policy for URLs and headers with default-deny allow-listing.
- OpenTelemetry-compatible tracing SPI (`Tracer`, `Span`, `SpanContext`, `Scope`, `activateSpan`, `activateSpanForCorrelation`) and W3C Trace Context generation (`createInstrumentationBundle`).
- Metrics SPI (`Counter`, `Histogram`, `Meter`, `NOOP_METER`).
- The `LOGGING` pillar step (`loggingStep`, `LOGGING_STEP_TYPE`) with configurable granularity (`none`, `headers`, `body`), bounded body previews, asymmetric `OBS-20` failure containment, and installation into `standardResilience()`.
- Adapter packages: `@dexpace/logging-pino` and `@dexpace/logging-debug`.
