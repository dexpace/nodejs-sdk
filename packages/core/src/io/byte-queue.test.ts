// SPDX-License-Identifier: MIT
// packages/core/src/io/byte-queue.test.ts
// Exercises: IO-1 (tail-append, transferred count, EOF sentinel), IO-2 (zero-count read),
// IO-3 (negative count rejected before any I/O), IO-4 (exact head removal, no partial write),
// IO-7 (FIFO buffer that is simultaneously source and sink)
import {describe, expect, test} from 'bun:test';
import {ByteQueue} from './byte-queue.js';
import {AllocationLimitError, EndOfStreamError} from './errors.js';
import {END_OF_STREAM, MAX_BYTE_ARRAY_LENGTH} from './limits.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const drain = (queue: ByteQueue): number[] => [...queue.snapshot()];

describe('ByteQueue read (IO-1, IO-2, IO-7)', () => {
  test('starts empty', () => {
    expect(new ByteQueue().size).toBe(0);
  });

  test('IO-7: bytes written through the sink surface read back through the source surface in order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    source.writeBytes(bytes(4, 5));
    const dest = new ByteQueue();
    expect(source.read(dest, 5)).toBe(5);
    expect(drain(dest)).toEqual([1, 2, 3, 4, 5]);
    expect(source.size).toBe(0);
  });

  test('IO-1: read appends to the TAIL of a non-empty destination, never overwriting', () => {
    const dest = new ByteQueue();
    dest.writeBytes(bytes(9, 9));
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    expect(source.read(dest, 2)).toBe(2);
    expect(drain(dest)).toEqual([9, 9, 1, 2]);
  });

  test('IO-1: read never returns more than requested, and returns at least 1 when not exhausted', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4));
    const dest = new ByteQueue();
    expect(source.read(dest, 2)).toBe(2);
    expect(source.size).toBe(2);
  });

  test('IO-1: read of a partial source returns what it has, then END_OF_STREAM', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    const dest = new ByteQueue();
    expect(source.read(dest, 8)).toBe(2);
    expect(source.read(dest, 8)).toBe(END_OF_STREAM);
  });

  test('IO-2: a zero-count read returns 0 on a non-empty source', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1));
    expect(source.read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-2: a zero-count read returns 0 — NOT end-of-stream — on an exhausted source', () => {
    expect(new ByteQueue().read(new ByteQueue(), 0)).toBe(0);
  });

  test('IO-3: a negative count is rejected before any transfer', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    expect(() => source.read(dest, -1)).toThrow(
      'count must be a non-negative integer, got -1',
    );
    expect(source.size).toBe(3);
    expect(dest.size).toBe(0);
  });
});

describe('ByteQueue write (IO-3, IO-4)', () => {
  test('IO-4: write removes exactly the requested count from the source HEAD, in order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    dest.write(source, 3);
    expect(source.size).toBe(0);
    expect(drain(dest)).toEqual([1, 2, 3]);
  });

  test('IO-4: writing more than the source holds throws instead of writing partially', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    const dest = new ByteQueue();
    expect(() => {
      dest.write(source, 4);
    }).toThrow(EndOfStreamError);
    expect(source.size).toBe(3);
    expect(dest.size).toBe(0);
  });

  test('IO-3: write rejects a negative count', () => {
    expect(() => {
      new ByteQueue().write(new ByteQueue(), -2);
    }).toThrow('count must be a non-negative integer, got -2');
  });

  test('writeBytes copies, so mutating the caller input afterwards does not change the queue', () => {
    const input = bytes(1, 2, 3);
    const queue = new ByteQueue();
    queue.writeBytes(input);
    input[0] = 99;
    expect(drain(queue)).toEqual([1, 2, 3]);
  });

  test('a transfer that straddles chunk boundaries preserves order', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2));
    source.writeBytes(bytes(3, 4));
    source.writeBytes(bytes(5, 6));
    const dest = new ByteQueue();
    expect(source.read(dest, 3)).toBe(3);
    expect(drain(dest)).toEqual([1, 2, 3]);
    expect(source.size).toBe(3);
    const rest = new ByteQueue();
    expect(source.read(rest, 3)).toBe(3);
    expect(drain(rest)).toEqual([4, 5, 6]);
  });
});

describe('ByteQueue snapshot and copyTo (IO-8, IO-9, IO-10)', () => {
  test('IO-8: snapshot does not consume or mutate', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    expect([...queue.snapshot()]).toEqual([1, 2, 3]);
    expect(queue.size).toBe(3);
  });

  test('IO-8: a snapshot is independent of later mutations, in both directions', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    const first = queue.snapshot();
    queue.writeBytes(bytes(4));
    expect([...first]).toEqual([1, 2, 3]);
    first[0] = 99;
    expect([...queue.snapshot()]).toEqual([1, 2, 3, 4]);
  });

  test('IO-9: materializing past the limit fails with an actionable error, not an allocation crash', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    expect(() => queue.takeBytes(MAX_BYTE_ARRAY_LENGTH + 1)).toThrow(
      AllocationLimitError,
    );
  });

  test('IO-10: copyTo copies a window without consuming or mutating the source', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4, 5));
    const dest = new ByteQueue();
    source.copyTo(dest, 1, 3);
    expect([...dest.snapshot()]).toEqual([2, 3, 4]);
    expect(source.size).toBe(5);
  });

  test('IO-10: copyTo defaults to offset-through-end', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3, 4));
    const dest = new ByteQueue();
    source.copyTo(dest, 2);
    expect([...dest.snapshot()]).toEqual([3, 4]);
  });

  test('IO-10: copyTo rejects an out-of-range window', () => {
    const source = new ByteQueue();
    source.writeBytes(bytes(1, 2, 3));
    expect(() => {
      source.copyTo(new ByteQueue(), 2, 5);
    }).toThrow('copy window 2..7 exceeds size 3');
    expect(() => {
      source.copyTo(new ByteQueue(), -1);
    }).toThrow('offset must be a non-negative integer, got -1');
  });

  test('IO-10: clear discards every byte', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    queue.clear();
    expect(queue.size).toBe(0);
    expect([...queue.snapshot()]).toEqual([]);
  });
});

describe('ByteQueue takeBytes and skip', () => {
  test('takeBytes consumes exactly the requested count', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3, 4));
    expect([...queue.takeBytes(2)]).toEqual([1, 2]);
    expect(queue.size).toBe(2);
  });

  test('takeBytes past the end throws rather than returning short', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2));
    expect(() => queue.takeBytes(3)).toThrow(EndOfStreamError);
  });

  test('skip discards from the head and returns how many it discarded', () => {
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3, 4));
    expect(queue.skip(2)).toBe(2);
    expect([...queue.snapshot()]).toEqual([3, 4]);
    expect(queue.skip(9)).toBe(2);
    expect(queue.size).toBe(0);
  });
});

describe('ByteQueue close (IO-41, IO-42)', () => {
  test('IO-41: close is idempotent — a second close does not throw', () => {
    const queue = new ByteQueue();
    queue.close();
    expect(() => {
      queue.close();
    }).not.toThrow();
    expect(queue.closed).toBe(true);
  });

  test('IO-42: a purely in-memory buffer stays readable and writable after close', () => {
    // IO-42 carves this out explicitly, and Phase 3b depends on it: snapshot-after-close is how
    // post-mortem body logging works. Making an in-memory buffer throw here is one of the two
    // directions IO-42 names as the porter's trap; the other is Task 6's stream-backed source, which
    // MUST reject after close.
    const queue = new ByteQueue();
    queue.writeBytes(bytes(1, 2, 3));
    queue.close();
    expect([...queue.snapshot()]).toEqual([1, 2, 3]);
    expect(() => {
      queue.writeBytes(bytes(4));
    }).not.toThrow();
    expect(queue.read(new ByteQueue(), 1)).toBe(1);
  });
});
