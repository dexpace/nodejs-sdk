// SPDX-License-Identifier: MIT
// packages/core/src/context/instrumentation.ts

/**
 * Correlation/instrumentation bundle every execution context carries (CTX-14), reachable from a
 * custom step as `ctx.context.instrumentation`.
 *
 * **Two members are still typed `unknown`, and the reason this note used to give is no longer true.**
 * `activeSpan` and `tracerFactory` are `unknown` rather than a `Span`/`Tracer`. The original reason —
 * "nothing in the package consumes either yet, pending Phase 7a" — expired when Phase 7a landed
 * (`bd37a08`) and shipped `Span` and `Tracer` in `observability/tracing.ts`. That phase did not narrow
 * these two: `tracerFactory` is consumed, by `pipeline/runtime.ts:52` and
 * `observability/logging-step.ts:263`, both of which reach a `Tracer` through a cast;
 * `createInstrumentationBundle` fills `activeSpan` (`observability/tracing.ts:222`), and nothing in
 * this package reads it back.
 *
 * They stay `unknown` because narrowing a published member is a breaking change rather than a
 * maintenance edit — it widens what a caller may pass and narrows what they receive — so it belongs
 * to a deliberate version bump. Treat either as opaque until then. Every other member below is stable.
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
   * PROVISIONAL: the return type is `unknown`, and narrowing it is a version-bump decision — see this
   * interface's own note for why Phase 7a landing did not settle it.
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
