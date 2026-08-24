// SPDX-License-Identifier: MIT
// packages/core/src/io/byte-queue.property.test.ts
// Exercises: IO-7 (FIFO order across arbitrary chunk splits), IO-8 (snapshot independence),
// IO-10 (copyTo is non-consuming)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {ByteQueue} from './byte-queue.js';

const chunks = fc.array(fc.uint8Array({maxLength: 32}), {maxLength: 16});

describe('ByteQueue properties', () => {
  test('IO-7: writing arbitrary chunks then reading back preserves byte order exactly', () => {
    fc.assert(
      fc.property(chunks, input => {
        const queue = new ByteQueue();
        for (const chunk of input) queue.writeBytes(chunk);
        const expected = input.flatMap(chunk => [...chunk]);
        expect(queue.size).toBe(expected.length);
        expect([...queue.snapshot()]).toEqual(expected);
      }),
    );
  });

  test('IO-7: reading in arbitrary increments yields the same bytes as reading all at once', () => {
    fc.assert(
      fc.property(
        chunks,
        fc.array(fc.integer({min: 0, max: 8}), {maxLength: 32}),
        (input, steps) => {
          const source = new ByteQueue();
          for (const chunk of input) source.writeBytes(chunk);
          const expected = input.flatMap(chunk => [...chunk]);

          const dest = new ByteQueue();
          for (const step of steps) source.read(dest, step);
          source.read(dest, source.size);

          expect([...dest.snapshot()]).toEqual(expected);
        },
      ),
    );
  });

  test('IO-8: a snapshot is every written byte, leaves size alone, and survives later writes', () => {
    fc.assert(
      fc.property(chunks, fc.uint8Array({maxLength: 16}), (input, later) => {
        const queue = new ByteQueue();
        for (const chunk of input) queue.writeBytes(chunk);
        const before = queue.snapshot();
        const sizeBefore = queue.size;

        // Comparing `before` against a copy of ITSELF is the trap here: both sides derive from the same
        // array, so the assertion holds for any implementation — a `snapshot()` returning an empty array
        // passes it. Pin the CONTENT against the input instead, so the property can actually fail.
        expect([...before]).toEqual(input.flatMap(chunk => [...chunk]));
        expect(queue.size).toBe(sizeBefore);

        queue.writeBytes(later);
        expect([...before]).toEqual(input.flatMap(chunk => [...chunk]));
        expect(queue.size).toBe(sizeBefore + later.length);
      }),
    );
  });

  test('IO-10: copyTo never changes the source size', () => {
    fc.assert(
      fc.property(chunks, fc.integer({min: 0, max: 16}), (input, offset) => {
        const source = new ByteQueue();
        for (const chunk of input) source.writeBytes(chunk);
        fc.pre(offset <= source.size);
        const sizeBefore = source.size;
        source.copyTo(new ByteQueue(), offset);
        expect(source.size).toBe(sizeBefore);
      }),
    );
  });
});
