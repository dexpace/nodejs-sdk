// SPDX-License-Identifier: MIT
// packages/core/src/io/factories.test.ts
// Exercises: IO-30 (factory half — fresh, independent, empty buffers; stream, byte-array, and
// foreign-primitive wrapping; the byte-array source is an independent copy), IO-17 (a primitive
// source returning 0 for a positive request fails loudly)
import {describe, expect, test} from 'bun:test';
import {SourceContractViolationError} from './errors.js';
import {
  bufferedSinkOverPrimitive,
  bufferedSinkOverStream,
  bufferedSourceOverBytes,
  bufferedSourceOverPrimitive,
  bufferedSourceOverStream,
  newByteQueue,
} from './factories.js';
import {
  collectingWritableStream,
  fakeReadableStream,
} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

describe('IO-30 factories', () => {
  test('two buffers are distinct and both empty', () => {
    const first = newByteQueue();
    const second = newByteQueue();
    expect(first).not.toBe(second);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
  });

  test('buffers are independent — writing to one does not affect the other', () => {
    const first = newByteQueue();
    const second = newByteQueue();
    first.writeBytes(Uint8Array.from([1, 2]));
    expect(second.size).toBe(0);
  });

  test('wrapping a byte array then mutating the input leaves the source unchanged', async () => {
    const input = Uint8Array.from([1, 2, 3]);
    const source = bufferedSourceOverBytes(input);
    input[0] = 99;
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('wrapping a caller stream produces a readable source', async () => {
    const source = bufferedSourceOverStream(
      fakeReadableStream([Uint8Array.from([7, 8])]),
    );
    expect([...(await source.readBytes())]).toEqual([7, 8]);
  });

  test('wrapping a caller stream produces a writable sink', async () => {
    const {stream, written} = collectingWritableStream();
    const sink = bufferedSinkOverStream(stream);
    await sink.writeUtf8('hi');
    await sink.close();
    expect(new TextDecoder().decode(written())).toBe('hi');
  });

  test('wrapping a foreign primitive source supplies the typed reads', async () => {
    const backing = newByteQueue();
    backing.writeBytes(Uint8Array.from([1, 2, 3]));
    const source = bufferedSourceOverPrimitive({
      read: (dest, count) => backing.read(dest, count),
    });
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-17: a primitive source returning 0 for a positive request fails loudly', async () => {
    const source = bufferedSourceOverPrimitive({read: () => 0});
    expect(await rejection(source.readBytes())).toBeInstanceOf(
      SourceContractViolationError,
    );
  });

  test('wrapping a foreign primitive sink supplies the typed writes', async () => {
    const collected = newByteQueue();
    const sink = bufferedSinkOverPrimitive({
      write: (src, count) => {
        collected.write(src, count);
      },
    });
    await sink.writeUtf8('hi');
    await sink.close();
    expect(new TextDecoder().decode(collected.snapshot())).toBe('hi');
  });
});
