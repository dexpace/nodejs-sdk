// SPDX-License-Identifier: MIT
// packages/transport-shared/src/abort-mapping.test.ts
// Exercises: TRANSPORT-3 (cancellation -> CancellationError), TRANSPORT-4 (timeout -> TransportFailureError)
import {describe, expect, test} from 'bun:test';
import {CancellationError, TransportFailureError} from '@dexpace/core';
import {abortToSdkError} from './abort-mapping.js';

describe('abortToSdkError', () => {
  test('maps AbortController abort to CancellationError', () => {
    const controller = new AbortController();
    controller.abort(new Error('user abort'));
    const err = abortToSdkError(controller.signal, controller.signal.reason);
    expect(err).toBeInstanceOf(CancellationError);
    expect(err.message).toBe('request cancelled');
  });

  test('maps AbortSignal.timeout to TransportFailureError', async () => {
    const signal = AbortSignal.timeout(5);
    await new Promise(r => setTimeout(r, 20));
    const err = abortToSdkError(signal, signal.reason);
    expect(err).toBeInstanceOf(TransportFailureError);
    expect(err.message).toBe('request timed out');
  });
});
