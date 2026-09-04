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

  test('rejects a non-finite multiplier (P2 sweep)', () => {
    expect(() =>
      retrySettings({multiplier: Number.POSITIVE_INFINITY}),
    ).toThrow();
    expect(() => retrySettings({multiplier: Number.NaN})).toThrow();
  });

  test('rejects maxAttempts below 1, never clamping to the default (RETRY-41/HTTP-35)', () => {
    expect(() => retrySettings({maxAttempts: 0})).toThrow();
    expect(() => retrySettings({maxAttempts: -3})).toThrow();
  });

  test('rejects a fractional maxAttempts -- an attempt count is integral (P2 sweep)', () => {
    expect(() => retrySettings({maxAttempts: 2.5})).toThrow();
  });

  test('accepts maxAttempts of 1, which disables retries', () => {
    expect(retrySettings({maxAttempts: 1}).maxAttempts).toBe(1);
  });
});

describe('validation: duration bounds (RECOV-34, V4/V13)', () => {
  test('accepts a delay past what ONE timer can carry (V13)', () => {
    // V4 briefly bounded these at `Clock`'s MAX_SLEEP_MS, because `Clock.sleep` rejected anything
    // larger. V13 made the clock chain timers instead, so the bound became a restriction on a
    // duration the platform CAN wait -- and it would have made RETRY-18's 365-day pacing clamp
    // (~14x one timer's reach) unconfigurable.
    const pastOneTimer = 2 ** 31;
    expect(retrySettings({initialDelayMs: pastOneTimer}).initialDelayMs).toBe(
      pastOneTimer,
    );
    expect(retrySettings({maxDelayMs: pastOneTimer}).maxDelayMs).toBe(
      pastOneTimer,
    );
    expect(retrySettings({fixedDelayMs: pastOneTimer}).fixedDelayMs).toBe(
      pastOneTimer,
    );
  });

  test("accepts RETRY-18's 365-day pacing ceiling as a configured delay (V13)", () => {
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    expect(retrySettings({maxDelayMs: oneYearMs}).maxDelayMs).toBe(oneYearMs);
  });

  test('still rejects a non-finite or negative duration', () => {
    expect(() =>
      retrySettings({initialDelayMs: Number.POSITIVE_INFINITY}),
    ).toThrow();
    expect(() => retrySettings({maxDelayMs: Number.NaN})).toThrow();
    expect(() => retrySettings({fixedDelayMs: -1})).toThrow();
  });

  test('leaves totalTimeoutMs on the same rule -- it is a budget, never a sleep', () => {
    expect(retrySettings({totalTimeoutMs: 2 ** 32}).totalTimeoutMs).toBe(
      2 ** 32,
    );
  });
});

describe('validation: the remaining fields (RECOV-34)', () => {
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
