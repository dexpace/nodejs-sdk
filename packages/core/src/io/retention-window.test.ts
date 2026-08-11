// SPDX-License-Identifier: MIT
// packages/core/src/io/retention-window.test.ts
// Exercises: IO-19/IO-20 (non-consuming views), IO-22 (parent close invalidates views),
// IO-23 (mutually independent cursors), IO-24 (closed view fails loudly, distinct from EOF)
import {describe, expect, test} from 'bun:test';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError} from './errors.js';
import {RetentionWindow} from './retention-window.js';
import {fakeReadableStream} from './test-support/fake-stream.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const windowOver = (...chunks: Uint8Array[]): RetentionWindow =>
  new RetentionWindow(fakeReadableStream(chunks).getReader());

describe('RetentionWindow', () => {
  test('pullThrough pulls until the requested logical offset is available', async () => {
    const window = windowOver(bytes(1, 2), bytes(3, 4));
    expect(await window.pullThrough(3)).toBe(true);
    expect(window.pulledThrough).toBeGreaterThanOrEqual(3);
  });

  test('pullThrough returns false once the stream is exhausted', async () => {
    const window = windowOver(bytes(1, 2));
    expect(await window.pullThrough(5)).toBe(false);
    expect(window.pulledThrough).toBe(2);
  });

  test('readInto advances only the cursor it is given', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const first = window.register(0);
    const second = window.register(0);
    await window.pullThrough(4);

    const dest = new ByteQueue();
    expect(window.readInto(first, dest, 2)).toBe(2);
    expect(first.at).toBe(2);
    expect(second.at).toBe(0);
  });

  test('IO-23: two cursors read the same bytes independently', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const first = window.register(0);
    const second = window.register(0);
    await window.pullThrough(3);

    const a = new ByteQueue();
    const b = new ByteQueue();
    window.readInto(first, a, 3);
    window.readInto(second, b, 3);
    expect([...a.snapshot()]).toEqual([1, 2, 3]);
    expect([...b.snapshot()]).toEqual([1, 2, 3]);
  });

  test('bytes behind the slowest cursor are trimmed, bytes at or ahead of it are retained', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const fast = window.register(0);
    const slow = window.register(0);
    await window.pullThrough(4);

    window.readInto(fast, new ByteQueue(), 4);
    expect(window.retainedBytes).toBe(4); // slow still needs all four

    window.readInto(slow, new ByteQueue(), 4);
    expect(window.retainedBytes).toBe(0); // nobody needs them now
  });
});

describe('RetentionWindow trim, peek, and close', () => {
  test('releasing a cursor lets the head trim forward', async () => {
    const window = windowOver(bytes(1, 2, 3, 4));
    const fast = window.register(0);
    const slow = window.register(0);
    await window.pullThrough(4);
    window.readInto(fast, new ByteQueue(), 4);

    window.release(slow);
    expect(window.retainedBytes).toBe(0);
  });

  test('peekBytes materializes without advancing the cursor', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const cursor = window.register(0);
    await window.pullThrough(3);
    expect([...window.peekBytes(cursor, 2)]).toEqual([1, 2]);
    expect(cursor.at).toBe(0);
  });

  test('IO-22/IO-24: after close, any cursor use throws ClosedResourceError, not an EOF', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const cursor = window.register(0);
    await window.pullThrough(3);
    window.close();

    expect(() => {
      window.assertUsable();
    }).toThrow(ClosedResourceError);
    expect(() => window.readInto(cursor, new ByteQueue(), 1)).toThrow(
      ClosedResourceError,
    );
  });

  test('IO-41: close is idempotent', () => {
    const window = windowOver(bytes(1));
    window.close();
    expect(() => {
      window.close();
    }).not.toThrow();
  });
});
