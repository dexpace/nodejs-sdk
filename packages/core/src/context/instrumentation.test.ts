// SPDX-License-Identifier: MIT
// packages/core/src/context/instrumentation.test.ts
// Exercises: CTX-14 (bundle shape), CTX-15 (no-op default: invalid sentinels, isValid/isRemote false,
// no-op span/tracer factory), CTX-20 (tracer factory safe to invoke concurrently, emits nothing)
import {describe, expect, test} from 'bun:test';
import {noopInstrumentationBundle} from './instrumentation.js';

describe('noopInstrumentationBundle (CTX-15)', () => {
  test('reserves all-zero trace/span ids and zero flags', () => {
    expect(noopInstrumentationBundle.traceId).toBe(
      '00000000000000000000000000000000',
    );
    expect(noopInstrumentationBundle.spanId).toBe('0000000000000000');
    expect(noopInstrumentationBundle.traceFlags).toBe(0);
    expect(noopInstrumentationBundle.traceState).toBe('');
  });

  test('names its trace-id encoding flavor', () => {
    // CTX-14 requires the flavor field; CTX-15 fixes no sentinel for it, so the disabled bundle says
    // 'none' rather than claiming an encoding it never produced ids in.
    expect(noopInstrumentationBundle.traceIdEncoding).toBe('none');
  });

  test('is invalid and not remote', () => {
    expect(noopInstrumentationBundle.isValid).toBe(false);
    expect(noopInstrumentationBundle.isRemote).toBe(false);
  });

  // CTX-15 says "a no-op span". With `activeSpan` typed `unknown` until a real tracing adapter lands
  // (Phase 7), there is no Span shape to build a no-op instance of, so absence is the encoding. Logged as a
  // partial deviation in the design's Deviation Ledger -- revisit when the adapter defines Span.
  test('has no active span', () => {
    expect(noopInstrumentationBundle.activeSpan).toBeUndefined();
  });

  test('tracerFactory emits nothing and is safe to invoke repeatedly (CTX-20)', () => {
    expect(noopInstrumentationBundle.tracerFactory('op-a')).toBeUndefined();
    expect(noopInstrumentationBundle.tracerFactory('op-b')).toBeUndefined();
  });

  test('is frozen', () => {
    expect(Object.isFrozen(noopInstrumentationBundle)).toBe(true);
  });
});
