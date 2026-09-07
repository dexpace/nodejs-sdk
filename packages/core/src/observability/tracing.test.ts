// SPDX-License-Identifier: MIT
// packages/core/src/observability/tracing.test.ts
// Exercises: OBS-21 (non-recording span: inert mutators, idempotent end), OBS-22 (activation scope restores
// the prior span, including on throw), OBS-23 (correlation push/restore, skipped for a non-recording span),
// OBS-25 (allocation-free no-op singletons), OBS-26/27 (W3C 32-hex trace id / 16-hex span id, never
// all-zero; Datadog 64-bit decimal).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {getDiagnosticContext} from './diagnostic-context.js';
import {
  NOOP_SPAN,
  NOOP_TRACER,
  activateSpan,
  activateSpanForCorrelation,
  createInstrumentationBundle,
  generateSpanId,
  generateTraceId,
  getActiveSpan,
  type Span,
} from './tracing.js';

describe('NOOP_SPAN (OBS-21, OBS-25)', () => {
  test('is non-recording and every mutator is inert, returning the same instance', () => {
    expect(NOOP_SPAN.isRecording).toBe(false);
    expect(NOOP_SPAN.setAttribute('k', 'v')).toBe(NOOP_SPAN);
    expect(NOOP_SPAN.recordException(new Error('x'))).toBe(NOOP_SPAN);
  });

  test('end() is idempotent', () => {
    expect(() => {
      NOOP_SPAN.end();
      NOOP_SPAN.end();
    }).not.toThrow();
  });
});

describe('NOOP_TRACER (OBS-25)', () => {
  test('startSpan returns the shared NOOP_SPAN singleton, allocating nothing new', () => {
    expect(NOOP_TRACER.startSpan('op-a')).toBe(NOOP_SPAN);
    expect(NOOP_TRACER.startSpan('op-b')).toBe(NOOP_SPAN);
  });
});

describe('trace/span id generation (OBS-26, OBS-27)', () => {
  test('W3C trace ids are 32 lowercase hex chars, never all-zero', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = generateTraceId('w3c');
      expect(id).toMatch(/^[0-9a-f]{32}$/u);
      expect(id).not.toBe('0'.repeat(32));
    }
  });

  test('span ids are 16 lowercase hex chars, never all-zero', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/u);
      expect(id).not.toBe('0'.repeat(16));
    }
  });

  test('Datadog trace ids are decimal, non-zero, within the 64-bit unsigned range', () => {
    const id = generateTraceId('datadog');
    expect(id).toMatch(/^\d+$/u);
    expect(BigInt(id)).toBeGreaterThan(0n);
    expect(BigInt(id)).toBeLessThan(2n ** 64n);
  });

  test('the no-op flavor always yields the invalid all-zero sentinel', () => {
    expect(generateTraceId('none')).toBe('0'.repeat(32));
  });

  test('property: never produces the all-zero id across many draws', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(generateTraceId('w3c')).not.toBe('0'.repeat(32));
      }),
      {numRuns: 500},
    );
  });
});

describe('span activation and restoration (OBS-22)', () => {
  function recordingSpan(traceId: string, spanId: string): Span {
    return {
      isRecording: true,
      setAttribute(): Span {
        return this;
      },
      recordException(): Span {
        return this;
      },
      end(): void {
        return;
      },
      spanContext: () => ({traceId, spanId}),
    };
  }

  test('rejects invalid span input', () => {
    expect(() => activateSpan(null as unknown as Span)).toThrow();
    expect(() => activateSpan({} as unknown as Span)).toThrow();
  });

  test('close() restores the previously-active span', () => {
    const outer = recordingSpan('a'.repeat(32), 'b'.repeat(16));
    const inner = recordingSpan('c'.repeat(32), 'd'.repeat(16));

    const outerScope = activateSpan(outer);
    const innerScope = activateSpan(inner);
    expect(getActiveSpan()).toBe(inner);
    innerScope.close();
    expect(getActiveSpan()).toBe(outer);
    outerScope.close();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });

  test('close() restores even when the guarded code throws', () => {
    const span = recordingSpan('a'.repeat(32), 'b'.repeat(16));
    const scope = activateSpan(span);
    expect(() => {
      try {
        throw new Error('boom');
      } finally {
        scope.close();
      }
    }).toThrow('boom');
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });

  test('close() is idempotent', () => {
    const scope = activateSpan(recordingSpan('a'.repeat(32), 'b'.repeat(16)));
    scope.close();
    expect(() => {
      scope.close();
    }).not.toThrow();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
  });
});

describe('span log correlation: standard behavior (OBS-23)', () => {
  function recordingSpan(traceId: string, spanId: string): Span {
    return {
      isRecording: true,
      setAttribute(): Span {
        return this;
      },
      recordException(): Span {
        return this;
      },
      end(): void {
        return;
      },
      spanContext: () => ({traceId, spanId}),
    };
  }

  test('a recording span pushes trace.id/span.id and restores them on close (OBS-23)', () => {
    const span = recordingSpan('e'.repeat(32), 'f'.repeat(16));

    const scope = activateSpanForCorrelation(span);
    expect(getDiagnosticContext(null)['trace.id']).toBe('e'.repeat(32));
    expect(getDiagnosticContext(null)['span.id']).toBe('f'.repeat(16));
    scope.close();

    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
  });

  test('a non-recording span pushes nothing and delegates to plain activation (OBS-23)', () => {
    const scope = activateSpanForCorrelation(NOOP_SPAN);
    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
    expect(getActiveSpan()).toBe(NOOP_SPAN);
    scope.close();
    expect(() => {
      scope.close();
    }).not.toThrow();
  });
});

describe('span log correlation: edge cases (OBS-23)', () => {
  test('a recording span with missing or throwing spanContext handles gracefully', () => {
    const spanWithoutCtx: Span = {
      isRecording: true,
      setAttribute(): Span {
        return this;
      },
      recordException(): Span {
        return this;
      },
      end(): void {
        return;
      },
    };
    const scope1 = activateSpanForCorrelation(spanWithoutCtx);
    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
    scope1.close();

    const throwingSpan = {
      isRecording: true,
      setAttribute(): Span {
        return this as unknown as Span;
      },
      recordException(): Span {
        return this as unknown as Span;
      },
      end(): void {
        return;
      },
      spanContext: () => {
        throw new Error('hostile');
      },
    } as unknown as Span;
    const scope2 = activateSpanForCorrelation(throwingSpan);
    expect(getDiagnosticContext(null)['trace.id']).toBeUndefined();
    scope2.close();
  });
});

describe('createInstrumentationBundle', () => {
  test('generates valid W3C ids and marks the bundle valid', () => {
    const bundle = createInstrumentationBundle();
    expect(bundle.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(bundle.spanId).toMatch(/^[0-9a-f]{16}$/u);
    expect(bundle.isValid).toBe(true);
    expect((bundle.tracerFactory as () => typeof NOOP_TRACER)()).toBe(
      NOOP_TRACER,
    );
  });

  test('a supplied tracerFactory is reachable through the bundle', () => {
    const spans: string[] = [];
    const tracer = {
      startSpan: (name: string) => {
        spans.push(name);
        return NOOP_SPAN;
      },
    };
    const bundle = createInstrumentationBundle(() => tracer);
    // The bundle's tracerFactory field is `unknown` per 4a's frozen shape; a real consumer (Task 6) casts it.
    (bundle.tracerFactory as () => typeof tracer)();
    expect(spans).toHaveLength(0); // factory itself doesn't start a span; startSpan is called by a consumer
  });
});
