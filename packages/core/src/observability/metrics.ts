// SPDX-License-Identifier: MIT
// packages/core/src/observability/metrics.ts

/**
 * Counter metric instrument (OBS-31, OBS-33).
 *
 * @public
 */
export interface Counter {
  /** OBS-33: only non-negative increments are valid. */
  add(delta: number, attributes?: Readonly<Record<string, unknown>>): void;
}

/**
 * Histogram metric instrument (OBS-31, OBS-33).
 *
 * @public
 */
export interface Histogram {
  /** OBS-33: tolerates any input, including non-finite values, without throwing. */
  record(value: number, attributes?: Readonly<Record<string, unknown>>): void;
}

/**
 * Metrics provider interface (OBS-31).
 *
 * @public
 */
export interface Meter {
  createCounter(
    name: string,
    options?: {readonly unit?: string; readonly description?: string},
  ): Counter;
  createHistogram(
    name: string,
    options?: {readonly unit?: string; readonly description?: string},
  ): Histogram;
}

const NOOP_COUNTER: Counter = Object.freeze({
  add(): void {
    return;
  },
});
const NOOP_HISTOGRAM: Histogram = Object.freeze({
  record(): void {
    return;
  },
});

/**
 * Inert no-op {@link Meter} singleton (OBS-31).
 *
 * @public
 */
export const NOOP_METER: Meter = Object.freeze({
  createCounter(): Counter {
    return NOOP_COUNTER;
  },
  createHistogram(): Histogram {
    return NOOP_HISTOGRAM;
  },
});
