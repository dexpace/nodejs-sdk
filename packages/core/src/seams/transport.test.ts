// SPDX-License-Identifier: MIT
// packages/core/src/seams/transport.test.ts
// Exercises: SEAM-18's residual (composeSignal is the per-call-options-threading helper's cancellation half),
// XCUT-2 (timeout vs. caller-cancellation told apart by signal.reason.name, not a message string).
// No stub Transport is constructed — neither composeSignal nor isTimeoutSignal takes or returns one.
import {describe, expect, test} from 'bun:test';
import {
  composeSignal,
  isTimeoutSignal,
  CancellationError,
} from './transport.js';

describe('composeSignal', () => {
  test('returns undefined when neither input is supplied', () => {
    expect(composeSignal()).toBeUndefined();
  });

  test('returns the user signal itself when only a user signal is supplied', () => {
    const controller = new AbortController();
    expect(composeSignal(controller.signal)).toBe(controller.signal);
  });

  test('returns a timeout signal when only a timeout is supplied', () => {
    const signal = composeSignal(undefined, 20);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('composes both into a distinct signal that aborts when either input fires', () => {
    const controller = new AbortController();
    const combined = composeSignal(controller.signal, 20);
    expect(combined).toBeInstanceOf(AbortSignal);
    expect(combined).not.toBe(controller.signal);

    controller.abort(new CancellationError('cancelled by caller'));
    expect(combined?.aborted).toBe(true);
  });
});

describe('isTimeoutSignal', () => {
  test('reports true for a fired AbortSignal.timeout()', async () => {
    const signal = AbortSignal.timeout(5);
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, {once: true});
    });
    expect(isTimeoutSignal(signal)).toBe(true);
  });

  test('reports false for a fired caller-initiated CancellationError abort', () => {
    const controller = new AbortController();
    controller.abort(new CancellationError('cancelled by caller'));
    expect(isTimeoutSignal(controller.signal)).toBe(false);
  });

  test('reports false for a signal that never aborted', () => {
    expect(isTimeoutSignal(new AbortController().signal)).toBe(false);
  });
});
