// SPDX-License-Identifier: MIT
// packages/core/src/observability/tracing.ts
import {invariant} from '../invariant.js';
import {
  createAsyncScopedStore,
  pushDiagnosticFields,
} from './diagnostic-context.js';
import type {InstrumentationBundle} from '../context/instrumentation.js';

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

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  const allZero = bytes.every(b => b === 0);
  if (allZero) bytes[byteLength - 1] = 1;
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates a trace identifier for the requested flavor (OBS-26, OBS-27).
 *
 * @param flavor - 'w3c', 'datadog', or 'none'.
 * @returns the formatted trace id.
 *
 * @internal
 */
export function generateTraceId(flavor: 'w3c' | 'datadog' | 'none'): string {
  if (flavor === 'none') return '0'.repeat(32);
  if (flavor === 'datadog') {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return String(value === 0n ? 1n : value);
  }
  return randomHex(16);
}

/**
 * Generates a W3C span identifier (16 lowercase hex characters) (OBS-26, OBS-27).
 *
 * @returns 16-hex span id.
 *
 * @internal
 */
export function generateSpanId(): string {
  return randomHex(8);
}

/**
 * Handle representing an active span scope (OBS-22).
 *
 * @public
 */
export interface Scope {
  close(): void;
}

const spanStorage = createAsyncScopedStore<Span>();

/**
 * Returns the currently active span, or {@link NOOP_SPAN} if none is active.
 *
 * @public
 */
export function getActiveSpan(): Span {
  return spanStorage.get() ?? NOOP_SPAN;
}

/**
 * Activates `span` for the current async context (OBS-22).
 *
 * @param span - the span to activate.
 * @returns a {@link Scope} handle whose `close()` restores the previous span.
 *
 * @public
 */
export function activateSpan(span: Span): Scope {
  invariant(
    (span as unknown) !== null && (span as unknown) !== undefined,
    'activateSpan: span is required',
  );
  invariant(
    typeof span.end === 'function',
    'activateSpan: span must implement end()',
  );

  const restore = spanStorage.enter(span);
  return {close: restore};
}

/** Extracts trace.id and span.id from OpenTelemetry-compatible spanContext() if present. */
function readCorrelationIds(
  span: Span,
): Readonly<Record<string, string>> | undefined {
  try {
    const context = span.spanContext?.();
    if (
      context === undefined ||
      typeof context.traceId !== 'string' ||
      typeof context.spanId !== 'string'
    ) {
      return undefined;
    }
    return {'trace.id': context.traceId, 'span.id': context.spanId};
  } catch {
    return undefined;
  }
}

/**
 * Activates `span` and correlates it with the diagnostic context if recording (OBS-23).
 *
 * @param span - the span to activate and correlate.
 * @returns a {@link Scope} handle.
 *
 * @public
 */
export function activateSpanForCorrelation(span: Span): Scope {
  const scope = activateSpan(span);
  if (!span.isRecording) return scope;

  const correlation = readCorrelationIds(span);
  if (correlation === undefined) return scope;

  const restore = pushDiagnosticFields(correlation);
  let closed = false;
  return {
    close(): void {
      if (closed) return;
      closed = true;
      restore();
      scope.close();
    },
  };
}

/**
 * Builds a populated {@link InstrumentationBundle} with generated W3C IDs and tracer factory.
 *
 * @param tracerFactory - optional custom tracer factory.
 * @returns a valid {@link InstrumentationBundle}.
 *
 * @public
 */
export function createInstrumentationBundle(
  tracerFactory?: (operationName: string) => Tracer,
): InstrumentationBundle {
  return {
    traceId: generateTraceId('w3c'),
    spanId: generateSpanId(),
    traceFlags: 1,
    traceState: '',
    traceIdEncoding: 'w3c',
    isValid: true,
    isRemote: false,
    activeSpan: NOOP_SPAN,
    tracerFactory: tracerFactory ?? ((): Tracer => NOOP_TRACER),
  };
}
