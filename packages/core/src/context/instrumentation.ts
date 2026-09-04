// SPDX-License-Identifier: MIT
// packages/core/src/context/instrumentation.ts

/**
 * Correlation/instrumentation bundle every execution context carries (CTX-14), reachable from a
 * custom step as `ctx.context.instrumentation`.
 *
 * **Two members are provisional.** `activeSpan` and `tracerFactory` are typed `unknown` rather than a
 * Span/Tracer interface because nothing in the package consumes either yet, and the real tracing
 * adapter — Phase 7a — owns their eventual shape. They are published as `unknown` deliberately, not
 * accidentally: narrowing them later to a concrete Span/Tracer type is a widening of what a caller
 * may pass and a narrowing of what they receive, so code that reads either today should treat it as
 * opaque and re-check when 7a lands. Every other member below is stable.
 *
 * @public
 */
export interface InstrumentationBundle {
  /** W3C trace-id, 32 lower-case hex characters. All-zero when tracing is disabled (CTX-15). */
  readonly traceId: string;
  /** W3C span-id, 16 lower-case hex characters. All-zero when tracing is disabled (CTX-15). */
  readonly spanId: string;
  /** W3C trace-flags byte; bit 0 is the sampled flag. `0` when tracing is disabled. */
  readonly traceFlags: number;
  /** W3C tracestate header value, verbatim. Empty when tracing is disabled. */
  readonly traceState: string;
  /** How `traceId`/`spanId` are encoded; `'none'` when tracing is disabled (CTX-15). */
  readonly traceIdEncoding: string;
  /** Whether this bundle carries a usable trace context. `false` for the disabled default (CTX-15). */
  readonly isValid: boolean;
  /** Whether the trace context was propagated in from a caller rather than started locally. */
  readonly isRemote: boolean;
  /**
   * The span this call runs inside, or `undefined` when tracing is disabled.
   *
   * PROVISIONAL: typed `unknown` pending Phase 7a's tracing adapter — see this interface's own note.
   */
  readonly activeSpan: unknown;
  /**
   * Returns the tracer to open `operationName`'s span from — a **tracer**, not a started span. Every
   * consumer in this package narrows the result and calls `startSpan()` on it itself
   * (`packages/core/src/pipeline/runtime.ts:52-57`, `observability/logging-step.ts:263-269`), and
   * `createInstrumentationBundle` supplies a `(operationName: string) => Tracer`
   * (`observability/tracing.ts:212,223`). A no-op returning `undefined` when tracing is disabled;
   * both consumers substitute `NOOP_TRACER` for that `undefined`.
   *
   * PROVISIONAL: the return type is `unknown` pending Phase 7a's tracing adapter — see this
   * interface's own note.
   *
   * @param operationName - the operation whose span the returned tracer will be asked to start.
   * @returns the tracer for that operation, or `undefined` when tracing is disabled.
   */
  readonly tracerFactory: (operationName: string) => unknown;
}

/**
 * The disabled-tracing default (CTX-15): reserved invalid sentinels, no-op span and tracer factory. Every
 * field is constant, so call-key uniqueness (CTX-4) must not depend on any of them — see `context.ts`'s
 * `Symbol()`-based keys.
 *
 * @internal
 */
export const noopInstrumentationBundle: InstrumentationBundle = Object.freeze({
  traceId: '00000000000000000000000000000000',
  spanId: '0000000000000000',
  traceFlags: 0,
  traceState: '',
  traceIdEncoding: 'none',
  isValid: false,
  isRemote: false,
  activeSpan: undefined,
  tracerFactory: () => undefined,
});
