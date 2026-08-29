// SPDX-License-Identifier: MIT
// packages/transport-shared/src/signal-fork.test.ts
// Exercises: SEAM-16 (an abort after delivery must not reach the native client), SEAM-13/TRANSPORT-7
// (an abort before delivery must)
import {describe, expect, test} from 'bun:test';
import {forkSignal} from './signal-fork.js';

describe('forkSignal', () => {
  test('returns no signal when the caller supplied none', () => {
    const fork = forkSignal(undefined);
    expect(fork.signal).toBeUndefined();
    expect(() => {
      fork.detach();
    }).not.toThrow();
  });

  test('forwards an abort that fires while still attached, reason and all', () => {
    const controller = new AbortController();
    const fork = forkSignal(controller.signal);
    const reason = new Error('caller changed their mind');
    controller.abort(reason);
    expect(fork.signal?.aborted).toBe(true);
    expect(fork.signal?.reason).toBe(reason);
  });

  test('an already-aborted source forks as already aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('too late'));
    const fork = forkSignal(controller.signal);
    expect(fork.signal?.aborted).toBe(true);
  });

  test('an abort after detach never reaches the fork (SEAM-16)', () => {
    const controller = new AbortController();
    const fork = forkSignal(controller.signal);
    fork.detach();
    fork.detach(); // idempotent
    controller.abort(new Error('after delivery'));
    expect(fork.signal?.aborted).toBe(false);
  });
});
