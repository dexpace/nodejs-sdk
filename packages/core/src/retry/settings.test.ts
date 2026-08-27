// SPDX-License-Identifier: MIT
// packages/core/src/retry/settings.test.ts
// Exercises: RETRY-12 (defaults), RETRY-14 (one budget, so nothing to reconcile), RETRY-27/28 (opt-in
// total timeout, 0 disables), RETRY-41 (a negative retry count is REJECTED, not clamped -- HTTP-35
// wins the MUST-vs-MUST collision), RETRY-42 (immutable after construction), RECOV-34 (construction
// validation, defensive collection copies).
import {describe, expect, test} from 'bun:test';
import {RETRYABLE_STATUSES} from './classify.js';
import {DEFAULT_RETRY_SETTINGS, retrySettings} from './settings.js';

describe('defaults (RETRY-12)', () => {
  test('ship the spec defaults', () => {
    expect(DEFAULT_RETRY_SETTINGS.initialDelayMs).toBe(200);
    expect(DEFAULT_RETRY_SETTINGS.multiplier).toBe(2);
    expect(DEFAULT_RETRY_SETTINGS.maxDelayMs).toBe(8000);
    expect(DEFAULT_RETRY_SETTINGS.jitter).toBe(0.2);
    expect(DEFAULT_RETRY_SETTINGS.maxAttempts).toBe(3);
  });

  test('the total timeout is opt-in, undefined by default (RETRY-28)', () => {
    expect(DEFAULT_RETRY_SETTINGS.totalTimeoutMs).toBeUndefined();
  });

  test('the default retryable statuses are the single-sourced set', () => {
    expect([...DEFAULT_RETRY_SETTINGS.retryableStatuses].sort()).toEqual(
      [...RETRYABLE_STATUSES].sort(),
    );
  });
});

describe('validation (RECOV-34)', () => {
  test('rejects a multiplier below 1.0', () => {
    expect(() => retrySettings({multiplier: 0.5})).toThrow();
  });

  test('rejects maxAttempts below 1, never clamping to the default (RETRY-41/HTTP-35)', () => {
    expect(() => retrySettings({maxAttempts: 0})).toThrow();
    expect(() => retrySettings({maxAttempts: -3})).toThrow();
  });

  test('accepts maxAttempts of 1, which disables retries', () => {
    expect(retrySettings({maxAttempts: 1}).maxAttempts).toBe(1);
  });

  test('rejects a jitter outside [0,1]', () => {
    expect(() => retrySettings({jitter: -0.1})).toThrow();
    expect(() => retrySettings({jitter: 1.1})).toThrow();
  });

  test('rejects negative durations', () => {
    expect(() => retrySettings({initialDelayMs: -1})).toThrow();
    expect(() => retrySettings({maxDelayMs: -1})).toThrow();
    expect(() => retrySettings({totalTimeoutMs: -1})).toThrow();
    expect(() => retrySettings({fixedDelayMs: -1})).toThrow();
  });

  test('rejects non-finite durations', () => {
    expect(() => retrySettings({initialDelayMs: Number.NaN})).toThrow();
    expect(() =>
      retrySettings({maxDelayMs: Number.POSITIVE_INFINITY}),
    ).toThrow();
  });

  test('rejects a malformed attempt header name at construction, not at the first retry', () => {
    expect(() =>
      retrySettings({attemptHeaderName: 'X-Bad\r\nInjected'}),
    ).toThrow();
    expect(() => retrySettings({attemptHeaderName: ''})).toThrow();
  });

  test('accepts a valid attempt header name', () => {
    expect(
      retrySettings({attemptHeaderName: 'X-Attempt'}).attemptHeaderName,
    ).toBe('X-Attempt');
  });

  test('a total timeout of zero is legal and means unbounded (RETRY-27)', () => {
    expect(retrySettings({totalTimeoutMs: 0}).totalTimeoutMs).toBe(0);
  });
});

describe('immutability (RETRY-42, RECOV-34)', () => {
  test('the status set is defensively copied, so later caller mutation cannot change policy', () => {
    const caller = new Set([500]);
    const settings = retrySettings({retryableStatuses: caller});
    caller.add(404);
    expect(settings.retryableStatuses.has(404)).toBe(false);
  });

  test('the returned settings object is frozen', () => {
    const settings = retrySettings();
    expect(Object.isFrozen(settings)).toBe(true);
  });

  test('DEFAULT_RETRY_SETTINGS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RETRY_SETTINGS)).toBe(true);
  });
});
