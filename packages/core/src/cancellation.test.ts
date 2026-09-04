// SPDX-License-Identifier: MIT
// packages/core/src/cancellation.test.ts
// Exercises: XCUT-1 (cancellation surfaces as one distinct terminal type wherever it was observed),
// XCUT-3 (a cancellation is told apart from a timeout by ambient state, not by a message string).
import {describe, expect, test} from 'bun:test';
import {abortToSdkError} from './cancellation.js';
import {TransportFailureError} from './io/errors.js';
import {CancellationError} from './seams/transport.js';

describe('abortToSdkError (XCUT-1, XCUT-3)', () => {
  test('a caller abort becomes a CancellationError carrying the reason', () => {
    const controller = new AbortController();
    const reason = new Error('caller went away');
    controller.abort(reason);

    const mapped = abortToSdkError(controller.signal, controller.signal.reason);

    expect(mapped).toBeInstanceOf(CancellationError);
    expect(mapped.cause).toBe(reason);
  });

  test('a timeout abort becomes a TransportFailureError, never a CancellationError', async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve, {once: true});
    });

    const mapped = abortToSdkError(signal, signal.reason);

    expect(mapped).toBeInstanceOf(TransportFailureError);
    expect(mapped).not.toBeInstanceOf(CancellationError);
  });
});
