// SPDX-License-Identifier: MIT
// packages/core/src/seams/transport.test.ts
// Exercises: SEAM-18's residual (composeSignal is the per-call-options-threading helper's cancellation half),
// XCUT-2 (timeout vs. caller-cancellation told apart by signal.reason.name, not a message string).
// No stub Transport is constructed — neither composeSignal nor isTimeoutSignal takes or returns one.
// Also HTTP-35 (composeSignal's documented RangeError is AbortSignal.timeout()'s own, and no value
// RequestOptionsBuilder accepts can produce it).
import {describe, expect, test} from 'bun:test';
import {
  composeSignal,
  isTimeoutSignal,
  CancellationError,
} from './transport.js';
import {RequestOptions} from '../http/request-options.js';
import {RequestOptionsValidationError} from '../http/errors.js';

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

describe('composeSignal timeout range (HTTP-35)', () => {
  // `composeSignal` hands `timeoutMs` straight to `AbortSignal.timeout()`, and what that does with
  // an out-of-range delay is a RUNTIME decision, measured 2026-09-05: Node raises
  // `RangeError: The value of "delay" is out of range` for `1.5`, for `2**32` and for `-1`; Bun
  // accepts `1.5` and `2**32` and raises a `TypeError` for `-1`. So the only claim assertable on
  // both is the one below — that no value `RequestOptionsBuilder` accepts can reach that fork at
  // all. `tests/node-conformance/seams.test.mjs` asserts the Node half, where the throw is real.
  // This is why audit #67 / #76 put the range check in the model rather than clamping here.
  test('every timeout RequestOptionsBuilder accepts composes without throwing', () => {
    for (const value of [1, 1000, 2 ** 32 - 1]) {
      const accepted = RequestOptions.newBuilder()
        .timeoutMs(value)
        .build().timeoutMs;
      expect(() => composeSignal(undefined, accepted)).not.toThrow();
    }
  });

  test('a timeout the builder rejects never reaches composeSignal', () => {
    for (const value of [1.5, 2 ** 32, -1, 0]) {
      expect(() => RequestOptions.newBuilder().timeoutMs(value)).toThrow(
        RequestOptionsValidationError,
      );
    }
  });
});
