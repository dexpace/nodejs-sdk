// SPDX-License-Identifier: MIT
// packages/core/src/recovery/cancellation.test.ts
// Exercises: RECOV-11 (wrapping a cancellation throwable into a Failure), reframed for Node — an
// AbortSignal is durable once aborted and the SDK never holds the caller's AbortController, so
// there is nothing to re-assert. What the requirement still buys is the guarantee that a
// cancellation surfaces through the SAME Failure channel as every other throwable, never through a
// side exit (RECOV-2).
import {describe, expect, test} from 'bun:test';
import {CancellationError} from '../seams/transport.js';
import {wrapCancellation} from './cancellation.js';

describe('wrapCancellation (RECOV-11)', () => {
  test('wraps a CancellationError into a Failure carrying it unchanged', () => {
    const error = new CancellationError('cancelled by caller');

    const outcome = wrapCancellation(error);

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe(error);
  });

  test('wraps an ordinary error into a Failure carrying it unchanged', () => {
    const error = new Error('an ordinary failure');

    const outcome = wrapCancellation(error);

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe(error);
  });

  test('wraps a non-Error throw unchanged — a JS throw can raise any value', () => {
    const outcome = wrapCancellation('a string throw');

    expect(outcome.kind === 'failure' && outcome.error).toBe('a string throw');
  });

  test('never throws, for any input', () => {
    // RECOV-2 depends on this: dispatchWithRecovery calls it from inside its own catch, so a throw
    // here would let a transport failure bypass the response and recovery chains entirely.
    expect(() => wrapCancellation(new CancellationError('x'))).not.toThrow();
    expect(() => wrapCancellation(undefined)).not.toThrow();
  });
});
