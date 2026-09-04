// SPDX-License-Identifier: MIT
// packages/core/src/observability/span.ts

// The inert half of the tracing surface: the span/tracer shapes (OBS-21, OBS-23) and the two no-op
// singletons (OBS-25) that need nothing else in the package to exist.
//
// This module exists to break an import cycle, not to introduce a layer. `tracing.ts` needs
// `InstrumentationBundle` from `context/instrumentation.ts` to type `createInstrumentationBundle`, and
// `context/instrumentation.ts` needs `NOOP_SPAN` for CTX-15's disabled-tracing default. Holding both in
// `tracing.ts` closes a cycle that `bun run verify:import-cycles` rejects -- type-only edges count there,
// deliberately -- and that gate's own message prescribes this fix: move the shared declaration into a
// module both sides can import. So this file imports nothing, and `tracing.ts` re-exports every name
// below, which is why no existing import path changed.
//
// Line comments, and deliberately none of them writes out the internal-marker JSDoc tag. Two traps stack
// at the top of a module: a leading `/** */` block binds to the first declaration below it rather than to
// the file, and gts turns on `stripInternal`, whose test is a plain substring scan of EVERY leading comment
// range of a declaration -- line comments included, doc block or not. So a module header that merely
// MENTIONS that tag deletes `SpanContext` from the emitted `.d.ts` while `tsc` stays silent; the failure
// surfaces one package later, as an unresolved name inside core's own `dist/`. Measured twice on the way
// to this wording. If this note is ever reworded, rebuild and check `dist/observability/span.d.ts` still
// declares all four names.

/**
 * Contextual metadata identifying a trace and span in distributed tracing (OBS-23, OBS-26).
 *
 * @public
 */
export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags?: number | undefined;
  readonly traceState?: string | undefined;
}

/**
 * A structural subset of `@opentelemetry/api`'s own `Span` shape (OBS-21, OBS-23).
 *
 * @public
 */
export interface Span {
  readonly isRecording: boolean;
  setAttribute(key: string, value: unknown): this;
  recordException(error: unknown): this;
  end(): void;
  spanContext?(): SpanContext | undefined;
}

/**
 * Tracing facade interface for creating spans.
 *
 * @public
 */
export interface Tracer {
  startSpan(name: string): Span;
}

/**
 * Inert no-op {@link Span} singleton (OBS-21, OBS-25).
 *
 * @public
 */
export const NOOP_SPAN: Span = Object.freeze({
  isRecording: false,
  setAttribute(): Span {
    return NOOP_SPAN;
  },
  recordException(): Span {
    return NOOP_SPAN;
  },
  end(): void {
    return;
  },
  spanContext(): SpanContext {
    return {traceId: '0'.repeat(32), spanId: '0'.repeat(16)};
  },
});

/**
 * Inert no-op {@link Tracer} singleton (OBS-25).
 *
 * @public
 */
export const NOOP_TRACER: Tracer = Object.freeze({
  startSpan(): Span {
    return NOOP_SPAN;
  },
});
