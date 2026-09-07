// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-source.test.ts
// Exercises: IO-1 (read protocol), IO-2 (zero-count read), IO-3 (negative count),
// IO-11 (exhausted, single-byte read, remaining-bytes read), IO-12 (exact-count read),
// IO-15 (skip), IO-41 (idempotent close), IO-42 (stream-backed rejects after close),
// IO-6 (wrapper owns the caller's stream)
import {describe, expect, test} from 'bun:test';
import {BufferedSource} from './buffered-source.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM} from './limits.js';
import {fakeReadableStream} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

describe('BufferedSource core reads', () => {
  test('IO-1: read appends to the destination tail and returns the transferred count', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const dest = new ByteQueue();
    dest.writeBytes(bytes(9));
    expect(await source.read(dest, 2)).toBe(2);
    expect([...dest.snapshot()]).toEqual([9, 1, 2]);
  });

  test('IO-1: read returns END_OF_STREAM once exhausted', async () => {
    const source = sourceOver(bytes(1));
    const dest = new ByteQueue();
    expect(await source.read(dest, 4)).toBe(1);
    expect(await source.read(dest, 4)).toBe(END_OF_STREAM);
  });

  test('IO-2: a zero-count read returns 0 on a fresh source', async () => {
    const source = sourceOver(bytes(1));
    expect(await source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-2: a zero-count read returns 0 — not END_OF_STREAM — on an exhausted source', async () => {
    const source = sourceOver();
    expect(await source.read(new ByteQueue(), 4)).toBe(END_OF_STREAM);
    expect(await source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-3: a negative count is rejected before any I/O', async () => {
    const source = sourceOver(bytes(1, 2));
    expect(
      (await rejection(source.read(new ByteQueue(), -1))).message,
    ).toContain('count must be a non-negative integer, got -1');
  });

  test('IO-11: exhausted() is false while bytes remain and true once they do not', async () => {
    const source = sourceOver(bytes(1));
    expect(await source.exhausted()).toBe(false);
    await source.readBytes();
    expect(await source.exhausted()).toBe(true);
  });

  test('IO-11: readByte returns the next byte, then fails at end', async () => {
    const source = sourceOver(bytes(7));
    expect(await source.readByte()).toBe(7);
    expect(await rejection(source.readByte())).toBeInstanceOf(EndOfStreamError);
  });

  test('IO-11: readBytes returns all remaining bytes, and empty when already exhausted', async () => {
    const source = sourceOver(bytes(1, 2), bytes(3));
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
    expect([...(await source.readBytes())]).toEqual([]);
  });

  test('IO-12: readExactly returns exactly the requested count across chunk boundaries', async () => {
    const source = sourceOver(bytes(1), bytes(2, 3), bytes(4));
    expect([...(await source.readExactly(3))]).toEqual([1, 2, 3]);
  });

  test('IO-12: readExactly fails rather than returning a short result', async () => {
    const source = sourceOver(bytes(1, 2));
    expect(await rejection(source.readExactly(3))).toBeInstanceOf(
      EndOfStreamError,
    );
  });
});

describe('BufferedSource skip and lifecycle (IO-15, IO-41, IO-42, IO-6)', () => {
  test('IO-15: skip advances past exactly the requested count', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4));
    await source.skip(2);
    expect([...(await source.readBytes())]).toEqual([3, 4]);
  });

  test('IO-15: skip fails when fewer bytes remain', async () => {
    const source = sourceOver(bytes(1, 2));
    expect(await rejection(source.skip(3))).toBeInstanceOf(EndOfStreamError);
  });

  test('IO-15: skip(0) is a no-op, even at and after end of stream', async () => {
    const source = sourceOver(bytes(1));
    await source.skip(0);
    await source.readBytes();
    await source.skip(0);
    expect(await source.exhausted()).toBe(true);
  });

  test('IO-41: close is idempotent', async () => {
    const source = sourceOver(bytes(1));
    await source.close();
    await source.close();
    expect(source.closed).toBe(true);
  });

  test('IO-42: a stream-backed source REJECTS reads after close', async () => {
    // The opposite direction from ByteQueue, which stays readable. IO-42 names both as the
    // inconsistency porters get wrong; both directions are asserted, here and in Task 4.
    const source = sourceOver(bytes(1, 2));
    await source.close();
    expect(await rejection(source.read(new ByteQueue(), 1))).toBeInstanceOf(
      ClosedResourceError,
    );
    expect(await rejection(source.readBytes())).toBeInstanceOf(
      ClosedResourceError,
    );
  });

  test('overBytes wraps a byte array as an independent copy', async () => {
    const input = bytes(1, 2, 3);
    const source = BufferedSource.overBytes(input);
    input[0] = 99;
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-6: closing the source cancels the caller stream it took ownership of', async () => {
    let cancelled = false;
    const source = BufferedSource.overStream(
      fakeReadableStream([bytes(1)], () => {
        cancelled = true;
      }),
    );
    await source.close();
    expect(cancelled).toBe(true);
  });
});

describe('BufferedSource host-native bridge (IO-16)', () => {
  test('toReadableStream yields the remaining bytes', async () => {
    const source = sourceOver(bytes(1, 2), bytes(3));
    const collected: number[] = [];
    for await (const chunk of source.toReadableStream())
      collected.push(...chunk);
    expect(collected).toEqual([1, 2, 3]);
  });

  test('closing the bridge closes the owning source', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const stream = source.toReadableStream();
    await stream.cancel();
    expect(source.closed).toBe(true);
  });
});
