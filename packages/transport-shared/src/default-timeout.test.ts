// SPDX-License-Identifier: MIT
// packages/transport-shared/src/default-timeout.test.ts
// Exercises: HTTP-35 (a timeout outside the range a transport can honour is refused where it was
// supplied, not where it is used), TRANSPORT-5 (a per-call override replaces a transport default,
// so the default is a real configuration value and answerable for its own range)
import {describe, expect, test} from 'bun:test';
import {isIoError} from '@dexpace/core';
import {requireValidDefaultTimeoutMs} from './default-timeout.js';

describe('requireValidDefaultTimeoutMs', () => {
  test('accepts undefined and every integer in the honourable range', () => {
    for (const value of [undefined, 1, 50, 30_000, 2 ** 32 - 1]) {
      expect(() => {
        requireValidDefaultTimeoutMs(value);
      }).not.toThrow();
    }
  });

  test('refuses everything AbortSignal.timeout() cannot take', () => {
    // The full range, not merely its lower bound. `1.5` and `2**32` are the two Bun 1.3.14 accepts
    // and Node rejects with a `RangeError`, which is the divergence that made an unvalidated
    // default a per-runtime behaviour rather than a per-caller error.
    for (const value of [
      0,
      -1,
      1.5,
      2 ** 32,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      let thrown: unknown;
      try {
        requireValidDefaultTimeoutMs(value);
      } catch (error) {
        thrown = error;
      }
      expect([value, thrown instanceof TypeError]).toEqual([value, true]);
      // Outside the `IoError` tree, like every other construction-time refusal these transports
      // raise: nothing retries a factory, and one class for all of them is easier to catch.
      expect([value, isIoError(thrown)]).toEqual([value, false]);
      // "Discoverable": the message names the value that was refused, not merely that one was.
      expect((thrown as Error).message).toContain(String(value));
    }
  });

  test('the message names the range as well as the value', () => {
    expect(() => {
      requireValidDefaultTimeoutMs(0);
    }).toThrow('1..4294967295');
  });
});
