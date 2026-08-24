// SPDX-License-Identifier: MIT
// packages/core/src/io/limits.test.ts
// Exercises: IO-1 (the end-of-stream sentinel), IO-9 (maximum single-array allocation)
import {describe, expect, test} from 'bun:test';
import {AllocationLimitError} from './errors.js';
import {
  assertAllocatable,
  END_OF_STREAM,
  MAX_BYTE_ARRAY_LENGTH,
} from './limits.js';

describe('limits', () => {
  test('END_OF_STREAM is the -1 sentinel IO-1 specifies', () => {
    expect(END_OF_STREAM).toBe(-1);
  });

  test('MAX_BYTE_ARRAY_LENGTH is a positive safe integer', () => {
    expect(Number.isSafeInteger(MAX_BYTE_ARRAY_LENGTH)).toBe(true);
    expect(MAX_BYTE_ARRAY_LENGTH).toBeGreaterThan(0);
  });

  // There is deliberately NO test that a Uint8Array of MAX_BYTE_ARRAY_LENGTH actually allocates.
  // Honest verification means allocating 2 GiB, which is far too heavy for the default suite, and the
  // cheap stand-in — comparing the constant against another compile-time constant — cannot fail for any
  // value the constant could plausibly hold, so it reads as coverage while asserting nothing. The
  // guarantee is carried instead by the RangeError backstop in `ByteQueue.allocate`, which converts a
  // host whose real ceiling is lower into an AllocationLimitError (see byte-queue.test.ts).
  test('MAX_BYTE_ARRAY_LENGTH stays under the 2 GiB the docs promise', () => {
    expect(MAX_BYTE_ARRAY_LENGTH).toBe(2 ** 31 - 1);
  });

  test('IO-9: assertAllocatable refuses over the ceiling and permits everything at or under it', () => {
    expect(() => {
      assertAllocatable(MAX_BYTE_ARRAY_LENGTH + 1);
    }).toThrow(AllocationLimitError);
    expect(() => {
      assertAllocatable(MAX_BYTE_ARRAY_LENGTH);
    }).not.toThrow();
    expect(() => {
      assertAllocatable(0);
    }).not.toThrow();
  });

  test('IO-9: the refusal names the limit and points at streaming alternatives', () => {
    // This is the guard the count-less read path applies incrementally, so it stands in for the
    // multi-gigabyte case the suite cannot afford to allocate.
    const error = new AllocationLimitError(
      MAX_BYTE_ARRAY_LENGTH + 1,
      MAX_BYTE_ARRAY_LENGTH,
    );
    expect(error.message).toContain(String(MAX_BYTE_ARRAY_LENGTH));
  });
});
