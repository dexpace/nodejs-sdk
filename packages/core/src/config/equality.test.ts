// SPDX-License-Identifier: MIT
// packages/core/src/config/equality.test.ts
// Exercises: CFG-33 (content-based array comparison recursing into nested arrays, null-safety,
// hash/equality consistency), CFG-34 (NaN equals NaN, +0 does not equal -0, a typed array is never
// equal to a plain array of the same numeric values).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {deepEqual, deepHash} from './equality.js';

describe('deepEqual (CFG-33)', () => {
  test('compares primitives with Object.is', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  test('compares arrays element by element', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  test('recurses into nested arrays', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, [2, 3]], [1, [2, 4]])).toBe(false);
  });

  test('treats arrays of different lengths as unequal', () => {
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  test('treats two empty arrays as equal', () => {
    expect(deepEqual([], [])).toBe(true);
  });

  test('treats two nulls as equal and null as unequal to undefined', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  test('overflows the stack on a self-referential array rather than terminating', () => {
    // Pinned, not fixed. Both helpers recurse without a cycle guard or a depth cap, and neither is
    // exported from the package barrel or called by anything yet. `docs/open-items.md` K16 records
    // the acyclic, bounded-depth precondition the first consumer inherits.
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    const other: unknown[] = [];
    other.push(other);

    expect(() => deepEqual(cyclic, other)).toThrow(RangeError);
  });

  test('falls back to identity for non-array objects', () => {
    const shared = {x: 2};

    expect(deepEqual(shared, shared)).toBe(true);
    expect(deepEqual({x: 2}, {x: 2})).toBe(false);
  });

  test('compares typed arrays by element value', () => {
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(
      true,
    );
    expect(deepEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(
      false,
    );
  });
});

describe('deepEqual floating-point array semantics (CFG-34)', () => {
  test('treats NaN as equal to NaN inside an array', () => {
    expect(deepEqual([Number.NaN], [Number.NaN])).toBe(true);
  });

  test('treats +0 as unequal to -0 inside an array', () => {
    expect(deepEqual([0], [-0])).toBe(false);
  });

  test('never treats a typed numeric array as equal to a plain array of the same values', () => {
    expect(deepEqual(new Float64Array([1, 2]), [1, 2])).toBe(false);
  });

  test('never treats two differently-typed numeric arrays as equal', () => {
    expect(deepEqual(new Float64Array([1, 2]), new Int32Array([1, 2]))).toBe(
      false,
    );
  });

  test('treats a DataView as an opaque object rather than an indexed collection', () => {
    const bytes = new Uint8Array([1, 2]).buffer;

    expect(deepEqual(new DataView(bytes), new DataView(bytes))).toBe(false);
  });
});

describe('deepHash recursion limits (CFG-33)', () => {
  test('overflows the stack on a self-referential array rather than terminating', () => {
    // The `deepHash` half of the G16 precondition; the `deepEqual` half is pinned above.
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    expect(() => deepHash(cyclic)).toThrow(RangeError);
  });

  test('overflows the stack past its recursion depth rather than terminating', () => {
    let deep: unknown[] = [];
    for (let i = 0; i < 100_000; i += 1) deep = [deep];

    expect(() => deepHash(deep)).toThrow(RangeError);
  });
});

describe('deepHash (CFG-33)', () => {
  test('hashes null and undefined to zero', () => {
    expect(deepHash(null)).toBe(0);
    expect(deepHash(undefined)).toBe(0);
  });

  test('agrees with deepEqual for equal nested arrays', () => {
    const left = [1, 'a', [3, 4]];
    const right = [1, 'a', [3, 4]];

    expect(deepEqual(left, right)).toBe(true);
    expect(deepHash(left)).toBe(deepHash(right));
  });

  test('hashes NaN consistently, matching its self-equality inside an array', () => {
    expect(deepHash([Number.NaN])).toBe(deepHash([Number.NaN]));
  });

  test('hashes +0 and -0 distinctly, matching their inequality', () => {
    expect(deepHash([0])).not.toBe(deepHash([-0]));
  });

  test('distinguishes element order', () => {
    expect(deepHash([1, 2])).not.toBe(deepHash([2, 1]));
  });

  test('hashes equal bigints to the same value', () => {
    expect(deepHash(9_007_199_254_740_993n)).toBe(
      deepHash(9_007_199_254_740_993n),
    );
    expect(deepHash(1n)).not.toBe(deepHash(2n));
  });

  test('hashes booleans distinctly', () => {
    expect(deepHash(true)).not.toBe(deepHash(false));
  });
});

describe('deepEqual and deepHash properties (CFG-33)', () => {
  const tree = fc.letrec<{node: unknown}>(rec => ({
    node: fc.oneof(
      {depthSize: 'small'},
      fc.integer(),
      fc.string(),
      fc.boolean(),
      fc.constant(null),
      fc.array(rec('node'), {maxLength: 4}),
    ),
  })).node;

  test('is reflexive', () => {
    fc.assert(
      fc.property(tree, value => {
        expect(deepEqual(value, value)).toBe(true);
      }),
    );
  });

  test('is symmetric', () => {
    fc.assert(
      fc.property(tree, tree, (left, right) => {
        expect(deepEqual(left, right)).toBe(deepEqual(right, left));
      }),
    );
  });

  test('hashes every equal pair to the same value', () => {
    fc.assert(
      fc.property(tree, tree, (left, right) => {
        if (deepEqual(left, right)) {
          expect(deepHash(left)).toBe(deepHash(right));
        }
      }),
    );
  });
});
