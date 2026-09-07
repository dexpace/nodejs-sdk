// SPDX-License-Identifier: MIT
// packages/transport-shared/src/signal-fork.test.ts
// Exercises: SEAM-16 (an abort after delivery must not reach the native client), SEAM-13/TRANSPORT-7
// (an abort before delivery must), TRANSPORT-9 (the transport can cancel a native call it abandons,
// with or without a caller signal)
import {describe, expect, test} from 'bun:test';
import {forkSignal} from './signal-fork.js';

describe('forkSignal', () => {
  test('still yields a live signal when the caller supplied none', () => {
    // The transport's own cancellation handle. Until audit #67 / #82 this returned `undefined`, so
    // a send with no caller signal and no timeout dispatched with none -- and a request-body
    // producer that failed mid-flight had no way to take the native call down with it.
    const fork = forkSignal(undefined);
    expect(fork.signal).toBeInstanceOf(AbortSignal);
    expect(fork.signal.aborted).toBe(false);
    expect(() => {
      fork.detach();
    }).not.toThrow();
  });

  test('forwards an abort that fires while still attached, reason and all', () => {
    const controller = new AbortController();
    const fork = forkSignal(controller.signal);
    const reason = new Error('caller changed their mind');
    controller.abort(reason);
    expect(fork.signal.aborted).toBe(true);
    // Carried verbatim because `isTimeoutSignal` reads `reason.name`: a fork that invented its own
    // reason would turn every per-call timeout into a CancellationError (TRANSPORT-4).
    expect(fork.signal.reason).toBe(reason);
  });

  test('an already-aborted source forks as already aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('too late'));
    const fork = forkSignal(controller.signal);
    expect(fork.signal.aborted).toBe(true);
  });

  test('an abort after detach never reaches the fork (SEAM-16)', () => {
    const controller = new AbortController();
    const fork = forkSignal(controller.signal);
    fork.detach();
    fork.detach(); // idempotent
    controller.abort(new Error('after delivery'));
    expect(fork.signal.aborted).toBe(false);
  });
});

describe('forkSignal.abort (TRANSPORT-9)', () => {
  test('cancels the native call with the reason the transport gave up for', () => {
    const fork = forkSignal(undefined);
    const reason = new Error('producer exploded');
    fork.abort(reason);
    expect(fork.signal.aborted).toBe(true);
    expect(fork.signal.reason).toBe(reason);
  });

  test('cancels a fork that has a source too, without touching the source', () => {
    const controller = new AbortController();
    const fork = forkSignal(controller.signal);
    fork.abort(new Error('producer exploded'));
    expect(fork.signal.aborted).toBe(true);
    // The caller's own signal is not the transport's to abort; only the fork it dispatched with.
    expect(controller.signal.aborted).toBe(false);
  });

  test('is a no-op after detach, so a delivered body is never torn out (SEAM-16)', () => {
    // The latch is what keeps the second direction of the fork from becoming the very violation
    // the first direction exists to prevent.
    const fork = forkSignal(undefined);
    fork.detach();
    fork.abort(new Error('too late to matter'));
    expect(fork.signal.aborted).toBe(false);
  });
});
