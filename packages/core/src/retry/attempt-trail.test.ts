// SPDX-License-Identifier: MIT
// packages/core/src/retry/attempt-trail.test.ts
// Exercises: RETRY-34 (the prior-attempt trail rides alongside the surfaced error rather than
// replacing it; the surfaced instance is skipped; a run with no priors leaves no trail behind),
// XCUT-1 (recording a trail never changes the surfaced value's class).
import {describe, expect, test} from 'bun:test';
import {IoError} from '../io/errors.js';
import {CancellationError} from '../seams/transport.js';
import {recordAttempts, retryAttempts} from './attempt-trail.js';

describe('retryAttempts -- the read side', () => {
  test('returns an empty list for an error that never went through the engine', () => {
    expect(retryAttempts(new IoError('never retried'))).toEqual([]);
  });

  test('returns an empty list for a primitive, which cannot carry a trail at all', () => {
    // RETRY-34's trail is keyed by identity, so a string, a number or a symbol throw passes
    // through the engine unchanged and unannotated rather than being wrapped to make room.
    expect(retryAttempts('a bare string throw')).toEqual([]);
    expect(retryAttempts(42)).toEqual([]);
    expect(retryAttempts(Symbol('thrown'))).toEqual([]);
    expect(retryAttempts(null)).toEqual([]);
    expect(retryAttempts(undefined)).toEqual([]);
  });

  test('returns the recorded attempts oldest first', () => {
    const first = new IoError('first');
    const second = new IoError('second');
    const surfaced = new IoError('third');

    recordAttempts(surfaced, [first, second]);

    expect(retryAttempts(surfaced)).toEqual([first, second]);
  });

  test('hands back a frozen list, so one caller cannot edit a trail another caller holds', () => {
    const surfaced = new IoError('surfaced');
    recordAttempts(surfaced, [new IoError('prior')]);

    const attempts = retryAttempts(surfaced);

    expect(Object.isFrozen(attempts)).toBe(true);
  });

  test('does not read a trail off the cause chain -- only off the instance itself', () => {
    const inner = new IoError('inner');
    recordAttempts(inner, [new IoError('prior')]);
    const outer = new IoError('outer', {cause: inner});

    expect(retryAttempts(outer)).toEqual([]);
  });
});

describe('recordAttempts -- the write side', () => {
  test('leaves the class and identity of the error untouched (XCUT-1)', () => {
    const surfaced = new CancellationError('operation cancelled');

    recordAttempts(surfaced, [new IoError('prior')]);

    expect(surfaced).toBeInstanceOf(CancellationError);
    expect(surfaced.name).toBe('CancellationError');
  });

  test('adds no own property, so a JSON or structured-clone round trip is unchanged', () => {
    const surfaced = new IoError('surfaced');
    const before = Object.getOwnPropertyNames(surfaced).sort();

    recordAttempts(surfaced, [new IoError('prior')]);

    expect(Object.getOwnPropertyNames(surfaced).sort()).toEqual(before);
  });

  test('copies the trail, so a later push by the engine cannot mutate a published list', () => {
    const surfaced = new IoError('surfaced');
    const trail: unknown[] = [new IoError('prior')];

    recordAttempts(surfaced, trail);
    trail.push(new IoError('added afterwards'));

    expect(retryAttempts(surfaced)).toHaveLength(1);
  });
});

describe('recordAttempts -- the values it can and cannot key on', () => {
  test('is a no-op on a frozen error rather than throwing', () => {
    // The reason the trail is a side table and not an own property: a foreign error may be frozen
    // or non-extensible, and `defineProperty` inside the failure path of the engine would then replace
    // the failure the caller cares about with a TypeError.
    const surfaced = Object.freeze(new IoError('frozen by its author'));
    const prior = new IoError('prior');

    expect(() => {
      recordAttempts(surfaced, [prior]);
    }).not.toThrow();
    expect(retryAttempts(surfaced)).toEqual([prior]);
  });

  test('is a no-op for a primitive surfaced value', () => {
    expect(() => {
      recordAttempts('a bare string throw', [new IoError('prior')]);
    }).not.toThrow();
    expect(retryAttempts('a bare string throw')).toEqual([]);
  });

  test('records against a thrown function, which is an object for these purposes', () => {
    const surfaced = (): void => undefined;
    const prior = new IoError('prior');

    recordAttempts(surfaced, [prior]);

    expect(retryAttempts(surfaced)).toEqual([prior]);
  });
});

describe('recordAttempts -- a reused error instance', () => {
  test('an empty trail clears any entry a previous run left on a reused instance', () => {
    // Error singletons are ordinary in fakes and in transports that reuse one instance. The RETRY-34
    // clause "on eventual success the prior trail MUST be discarded" is worth nothing if the NEXT run
    // to surface that same instance still reports the old one.
    const reused = new IoError('reused across runs');
    recordAttempts(reused, [new IoError('from the first run')]);

    recordAttempts(reused, []);

    expect(retryAttempts(reused)).toEqual([]);
  });

  test('the latest recording wins for a reused instance', () => {
    const reused = new IoError('reused across runs');
    const older = new IoError('from the first run');
    const newer = new IoError('from the second run');

    recordAttempts(reused, [older]);
    recordAttempts(reused, [newer]);

    expect(retryAttempts(reused)).toEqual([newer]);
  });
});
