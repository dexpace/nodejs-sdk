// SPDX-License-Identifier: MIT
// packages/core/src/config/equality.ts

/**
 * Whether `value` is one of the indexed collections {@link deepEqual} compares by content: a plain
 * array or a typed array. `DataView` is excluded -- it is an `ArrayBuffer` view with no indexed
 * elements, so it falls through to identity comparison like any other object.
 */
function isIndexedCollection(value: unknown): value is ArrayLike<unknown> {
  return (
    Array.isArray(value) ||
    (ArrayBuffer.isView(value) && !(value instanceof DataView))
  );
}

/**
 * Whether two indexed collections are the same kind. CFG-34's "an object array and a primitive array
 * of the same numeric values MUST NOT be equal" is, in this runtime, the plain-array/typed-array
 * split -- and one `Float64Array` is not the same kind as one `Int32Array` either, so typed arrays
 * compare prototypes.
 */
function isSameCollectionKind(
  a: ArrayLike<unknown>,
  b: ArrayLike<unknown>,
): boolean {
  const isATyped = !Array.isArray(a);
  const isBTyped = !Array.isArray(b);
  if (isATyped !== isBTyped) return false;
  if (!isATyped) return true;
  return Object.getPrototypeOf(a) === Object.getPrototypeOf(b);
}

/**
 * Compares two values by content (CFG-33, CFG-34).
 *
 * Arrays -- plain or typed -- compare element by element, recursing into nested arrays; everything
 * else compares with `Object.is`, never `===`. That is exactly CFG-34's floating-point semantics --
 * `NaN` equals `NaN`, and `+0` does not equal `-0` -- and it holds at the top level as well as
 * per element, so `deepEqual(NaN, NaN)` is `true` and `deepEqual(0, -0)` is `false`.
 * A typed array is never equal to a plain array of the same numeric values. Null-safe: two `null`s
 * are equal, as are two `undefined`s.
 *
 * Consistent with {@link deepHash}: every pair this reports equal hashes to the same value.
 *
 * @param a - the left value.
 * @param b - the right value.
 * @returns whether the two values are deeply equal.
 *
 * @internal
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined)
    return a === b;
  if (!isIndexedCollection(a) || !isIndexedCollection(b))
    return Object.is(a, b);
  if (!isSameCollectionKind(a, b) || a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (!deepEqual(a[i], b[i])) return false;
  }
  return true;
}

/** One bucket for every `NaN`, so `deepEqual([NaN], [NaN])` and their hashes agree. */
const NAN_HASH = 0x7ff8;

/** `-0` hashes distinctly from `+0`, which hashes to 0, because CFG-34 makes them unequal. */
const NEGATIVE_ZERO_HASH = 1;

function hashNumber(value: number): number {
  if (Number.isNaN(value)) return NAN_HASH;
  if (Object.is(value, -0)) return NEGATIVE_ZERO_HASH;
  return Math.trunc(value) | 0;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Hashes a value consistently with {@link deepEqual} (CFG-33): every pair `deepEqual` reports equal
 * hashes to the same number. Unequal values MAY collide -- that is what a hash is.
 *
 * Null-safe: `deepHash(null)` and `deepHash(undefined)` are both `0`.
 *
 * @param value - the value to hash.
 * @returns a 32-bit signed hash.
 *
 * @internal
 */
export function deepHash(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (isIndexedCollection(value)) {
    let hash = 17;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- `ArrayLike` covers typed and plain arrays alike but is not itself iterable, so `for-of` does not type-check here
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + deepHash(value[i])) | 0;
    }
    return hash;
  }
  if (typeof value === 'number') return hashNumber(value);
  if (typeof value === 'string') return hashString(value);
  if (typeof value === 'boolean') return value ? 1231 : 1237;
  if (typeof value === 'bigint') return hashString(value.toString());
  // Objects, functions, and symbols compare by identity in `deepEqual`, so a single shared bucket
  // keeps the two helpers consistent without inventing a structural hash `deepEqual` would not honor.
  return 1;
}
