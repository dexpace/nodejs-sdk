// SPDX-License-Identifier: MIT
// packages/core/src/suppress.test.ts
// Exercises: the runtime-guarded stand-in for `SuppressedError` that RECOV-12 (and, later, Phases
// 5a/6a/6b/6c) need to attach a teardown failure to a primary throwable without inverting their
// priority.
//
// Neither branch of the guard is forced here by mutating `globalThis` — a test that deletes a
// global does not survive parallel execution, which docs/knowledge/testing.md:50 requires. The
// branch selection is covered where it is real instead: `suppress()` is asserted on its shape,
// which holds on either runtime, `FallbackSuppressedError` is constructed directly, and the
// `test:node` matrix runs both legs — `lts/*` has the native class, the pinned `20.3.0` floor does
// not.
import {describe, expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import {
  FallbackSuppressedError,
  suppress,
  type SuppressedErrorLike,
} from './suppress.js';

describe('suppress', () => {
  test('keeps the primary error primary and the secondary suppressed', () => {
    const primary = new Error('primary');
    const secondary = new Error('secondary');

    const result = suppress(primary, secondary, 'teardown failed');

    expect(result.error).toBe(primary);
    expect(result.suppressed).toBe(secondary);
    expect(result.message).toBe('teardown failed');
  });

  test('reports the same identity on either branch of the guard', () => {
    const result = suppress(
      new Error('primary'),
      new Error('secondary'),
      'msg',
    );

    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe('SuppressedError');
  });

  test('carries non-Error throwables unchanged — a JS throw can raise any value', () => {
    const result = suppress('a string throw', undefined, 'teardown failed');

    expect(result.error).toBe('a string throw');
    expect(result.suppressed).toBeUndefined();
  });

  test('uses the native SuppressedError when the runtime provides one', () => {
    const native = (globalThis as {SuppressedError?: unknown}).SuppressedError;
    if (typeof native !== 'function') return; // the floor runtime has no native class to use

    const result = suppress(new Error('a'), new Error('b'), 'msg');

    expect(result).toBeInstanceOf(native);
  });
});

describe('FallbackSuppressedError — the branch the declared floor takes', () => {
  test('mirrors the native shape rather than reporting its own class name', () => {
    const primary = new Error('primary');
    const secondary = new Error('secondary');

    const result = new FallbackSuppressedError(
      primary,
      secondary,
      'teardown failed',
    );

    expect(result).toBeInstanceOf(Error);
    expect(result.name).toBe('SuppressedError');
    expect(result.error).toBe(primary);
    expect(result.suppressed).toBe(secondary);
    expect(result.message).toBe('teardown failed');
  });

  test('satisfies the SuppressedErrorLike shape suppress() promises', () => {
    expectTypeOf<FallbackSuppressedError>().toExtend<SuppressedErrorLike>();
    expectTypeOf<
      ReturnType<typeof suppress>
    >().toEqualTypeOf<SuppressedErrorLike>();
  });
});
