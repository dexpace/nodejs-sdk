// SPDX-License-Identifier: MIT
// packages/core/src/context/instrumentation.ts

/**
 * Correlation/instrumentation bundle every execution context carries (CTX-14). `activeSpan` and
 * `tracerFactory` are typed `unknown` rather than a Span/Tracer interface — nothing in this phase
 * consumes either, and a real tracing adapter (deferred to Phase 7) owns their eventual shape.
 *
 * @internal
 */
export interface InstrumentationBundle {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly traceState: string;
  readonly traceIdEncoding: string;
  readonly isValid: boolean;
  readonly isRemote: boolean;
  readonly activeSpan: unknown;
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
