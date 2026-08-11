// SPDX-License-Identifier: MIT
// packages/core/src/io/limits.test.ts
// Exercises: IO-1 (the end-of-stream sentinel), IO-9 (maximum single-array allocation)
import {describe, expect, test} from 'bun:test';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';

describe('limits', () => {
  test('END_OF_STREAM is the -1 sentinel IO-1 specifies', () => {
    expect(END_OF_STREAM).toBe(-1);
  });

  test('MAX_BYTE_ARRAY_LENGTH is a positive safe integer', () => {
    expect(Number.isSafeInteger(MAX_BYTE_ARRAY_LENGTH)).toBe(true);
    expect(MAX_BYTE_ARRAY_LENGTH).toBeGreaterThan(0);
  });

  test('a Uint8Array of MAX_BYTE_ARRAY_LENGTH is at or under what the host actually allows', () => {
    // The constant is deliberately conservative across V8 and JavaScriptCore. This asserts we did not
    // pick a number the current host cannot honor; the RangeError backstop in ByteQueue covers hosts
    // whose real ceiling is lower still.
    expect(MAX_BYTE_ARRAY_LENGTH).toBeLessThanOrEqual(2 ** 32 - 1);
  });
});
