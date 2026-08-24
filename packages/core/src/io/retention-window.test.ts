// SPDX-License-Identifier: MIT
// packages/core/src/io/retention-window.test.ts
// Exercises: IO-19/IO-20 (non-consuming views), IO-22 (parent close invalidates views),
// IO-23 (mutually independent cursors), IO-24 (closed view fails loudly, distinct from EOF),
// IO-17 (a chunk that is not a Uint8Array is a source-contract violation),
// IO-41 (teardown is awaited, releases the reader lock, and surfaces its failure)
import {describe, expect, test} from 'bun:test';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, SourceContractViolationError} from './errors.js';
import {RetentionWindow} from './retention-window.js';
import {fakeReadableStream} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

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
    expect([...window.peekBytes(cursor, 0, 2)]).toEqual([1, 2]);
    expect(cursor.at).toBe(0);
  });

  test('peekBytes reads a window starting `offset` ahead of the cursor', async () => {
    const window = windowOver(bytes(1, 2, 3, 4, 5));
    const cursor = window.register(0);
    await window.pullThrough(5);
    expect([...window.peekBytes(cursor, 2, 2)]).toEqual([3, 4]);
    // Clamped to what has been pulled, never over-reading past the end.
    expect([...window.peekBytes(cursor, 3, 99)]).toEqual([4, 5]);
    expect([...window.peekBytes(cursor, 5, 1)]).toEqual([]);
    expect(cursor.at).toBe(0);
  });

  test('IO-22/IO-24: after close, any cursor use throws ClosedResourceError, not an EOF', async () => {
    const window = windowOver(bytes(1, 2, 3));
    const cursor = window.register(0);
    await window.pullThrough(3);
    await window.close();

    expect(() => {
      window.assertUsable();
    }).toThrow(ClosedResourceError);
    expect(() => window.readInto(cursor, new ByteQueue(), 1)).toThrow(
      ClosedResourceError,
    );
  });

  test('IO-41: close is idempotent', async () => {
    const window = windowOver(bytes(1));
    await window.close();
    await window.close();
    expect(window.closed).toBe(true);
  });
});

describe('RetentionWindow source-contract guards (IO-17)', () => {
  /**
   * A stream that yields a chunk the TYPE system says cannot occur. The cast is the point: these values
   * arrive from a caller-supplied stream, so the compile-time narrowing guarantees nothing at runtime.
   */
  const windowOverRaw = (chunk: unknown): RetentionWindow =>
    new RetentionWindow(
      new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(chunk as Uint8Array);
          controller.close();
        },
      }).getReader(),
    );

  test('an undefined chunk is an IoError, not a raw TypeError', async () => {
    // The `done: false` narrowing is a COMPILE-time guarantee about a value that arrives from a
    // caller-supplied stream, so without a runtime check this escapes the IoError tree entirely.
    const window = windowOverRaw(undefined);
    expect(await rejection(window.pullThrough(1))).toBeInstanceOf(
      SourceContractViolationError,
    );
  });

  test('a string chunk is rejected at the boundary, not left to corrupt the queue', async () => {
    // What `Readable.toWeb()` yields when the Node stream has an encoding set. `'abc'.length` is 3, so
    // a length-only check waves it through and it detonates much later, far from its cause.
    const window = windowOverRaw('abc');
    expect(await rejection(window.pullThrough(1))).toBeInstanceOf(
      SourceContractViolationError,
    );
  });
});

describe('RetentionWindow teardown (IO-41)', () => {
  test('close resolves only after the underlying cancel has finished', async () => {
    // Detaching the cancel lets `close()` resolve ahead of the real release, racing anything a caller
    // sequences on it — connection reuse, shutdown.
    const order: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes(1));
      },
      async cancel(): Promise<void> {
        await Bun.sleep(10);
        order.push('underlying-cancel-finished');
      },
    });
    const window = new RetentionWindow(stream.getReader());
    await window.close();
    order.push('close-returned');
    expect(order).toEqual(['underlying-cancel-finished', 'close-returned']);
  });

  test('a cancel failure propagates instead of being swallowed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes(1));
      },
      cancel(): never {
        throw new Error('socket teardown failed');
      },
    });
    const window = new RetentionWindow(stream.getReader());
    expect((await rejection(window.close())).message).toContain(
      'socket teardown failed',
    );
  });

  test('close releases the reader lock, which cancel alone never does', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes(1));
      },
    });
    const window = new RetentionWindow(stream.getReader());
    expect(stream.locked).toBe(true);
    await window.close();
    expect(stream.locked).toBe(false);
  });

  test('overlapping closes share one teardown and one outcome', async () => {
    let cancels = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes(1));
      },
      cancel(): void {
        cancels += 1;
      },
    });
    const window = new RetentionWindow(stream.getReader());
    await Promise.all([window.close(), window.close()]);
    await window.close();
    expect(cancels).toBe(1);
  });
});
