// SPDX-License-Identifier: MIT
// packages/core/src/observability/metrics.test.ts
// Exercises: OBS-31 (no-op default discards every measurement, returns shared instrument singletons), OBS-33
// (a histogram tolerates NaN/Infinity without throwing).
import {describe, expect, test} from 'bun:test';
import {NOOP_METER} from './metrics.js';

describe('NOOP_METER (OBS-31)', () => {
  test('createCounter returns the same shared instrument regardless of name', () => {
    expect(NOOP_METER.createCounter('a')).toBe(NOOP_METER.createCounter('b'));
  });

  test('createHistogram returns the same shared instrument regardless of name', () => {
    expect(NOOP_METER.createHistogram('a')).toBe(
      NOOP_METER.createHistogram('b'),
    );
  });

  test('recording into the no-op instruments never throws, including non-finite values (OBS-33)', () => {
    const counter = NOOP_METER.createCounter('http.client.request.count', {
      unit: '{request}',
    });
    const histogram = NOOP_METER.createHistogram(
      'http.client.request.duration',
      {unit: 'ms'},
    );
    expect(() => {
      counter.add(1, {method: 'GET'});
    }).not.toThrow();
    expect(() => {
      histogram.record(Number.NaN);
    }).not.toThrow();
    expect(() => {
      histogram.record(Number.POSITIVE_INFINITY);
    }).not.toThrow();
  });
});
