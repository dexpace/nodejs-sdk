// SPDX-License-Identifier: MIT
// packages/core/src/context/instrumentation.test.ts
// Exercises: CTX-14 (bundle shape), CTX-15 (no-op default: invalid sentinels, isValid/isRemote false,
// no-op span/tracer factory), CTX-20 (tracer factory safe to invoke concurrently, emits nothing)
import {describe, expect, test} from 'bun:test';
import {NOOP_SPAN} from '../observability/span.js';
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

  // CTX-15 says "a no-op span", and it means an object: the requirement lists the no-op span beside the
  // no-op tracer factory, and `createInstrumentationBundle` has always used `NOOP_SPAN` for the ENABLED
  // bundle (`observability/tracing.ts`). Phase 4a shipped `undefined` here because no `Span` type existed
  // yet and recorded the gap as a partial deviation; `Span`/`NOOP_SPAN` landed in Phase 7b, so the reason
  // expired and the two bundles no longer disagree. Identity, not shape: a caller narrowing `unknown` may
  // compare against the exported singleton.
  test('carries the no-op span singleton, not undefined', () => {
    expect(noopInstrumentationBundle.activeSpan).toBe(NOOP_SPAN);
  });

  test('tracerFactory emits nothing and is safe to invoke repeatedly (CTX-20)', () => {
    expect(noopInstrumentationBundle.tracerFactory('op-a')).toBeUndefined();
    expect(noopInstrumentationBundle.tracerFactory('op-b')).toBeUndefined();
  });

  test('is frozen', () => {
    expect(Object.isFrozen(noopInstrumentationBundle)).toBe(true);
  });
});
