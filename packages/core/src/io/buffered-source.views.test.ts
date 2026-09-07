// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-source.views.test.ts
// Exercises: IO-19 (peek is non-consuming over the whole remaining source), IO-20 (bounded slice),
// IO-21 (lazy offset overflow, eager negative rejection), IO-22 (closing a slice does not close the
// parent; closing the parent invalidates slices), IO-23 (independence, additive composition),
// IO-24 (reading a closed slice is a state error, distinct from EOF),
// IO-16 (the readable bridge: cancel closes the source, EOF does not, a failed read does)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from './buffered-source.js';
import {ClosedResourceError} from './errors.js';
import {drainStream, fakeReadableStream} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

describe('BufferedSource views', () => {
  test('IO-19: reads from a peek do not advance the original cursor', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const peek = source.peek();
    expect([...(await peek.readBytes())]).toEqual([1, 2, 3]);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-20: a slice exposes at most count bytes starting offset ahead', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4, 5));
    const slice = source.slice(1, 3);
    expect([...(await slice.readBytes())]).toEqual([2, 3, 4]);
  });

  test('IO-20: reading past the window behaves as end-of-window, and never advances the parent', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    expect([...(await slice.readBytes())]).toEqual([1, 2]);
    expect([...(await slice.readBytes())]).toEqual([]);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-21: an offset past the source size succeeds at construction and reads as empty', async () => {
    const source = sourceOver(bytes(1, 2));
    const slice = source.slice(100, 4);
    expect([...(await slice.readBytes())]).toEqual([]);
  });

  test('IO-21: a negative offset or count is rejected eagerly at construction', () => {
    const source = sourceOver(bytes(1, 2));
    expect(() => source.slice(-1, 2)).toThrow(
      'offset must be a non-negative integer, got -1',
    );
    expect(() => source.slice(0, -2)).toThrow(
      'count must be a non-negative integer, got -2',
    );
  });
});

describe('BufferedSource view lifecycle and independence (IO-22, IO-23, IO-24)', () => {
  test('IO-22: closing a slice neither closes the parent nor advances its cursor', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await slice.readBytes();
    await slice.close();
    expect(source.closed).toBe(false);
    expect([...(await source.readBytes())]).toEqual([1, 2, 3]);
  });

  test('IO-22: closing the parent invalidates outstanding slices', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await source.close();
    expect(await rejection(slice.readBytes())).toBeInstanceOf(
      ClosedResourceError,
    );
  });

  test('IO-24: reading an explicitly closed slice fails loudly, distinct from a normal EOF', async () => {
    const source = sourceOver(bytes(1, 2, 3));
    const slice = source.slice(0, 2);
    await slice.close();
    expect(await rejection(slice.readBytes())).toBeInstanceOf(
      ClosedResourceError,
    );
  });

  test('IO-23: two slices of one source have independent cursors and budgets', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4));
    const first = source.slice(0, 2);
    const second = source.slice(2, 2);
    expect([...(await second.readBytes())]).toEqual([3, 4]);
    expect([...(await first.readBytes())]).toEqual([1, 2]);
  });

  test('IO-23: a slice of a slice composes offsets additively and caps at the outer remainder', async () => {
    const source = sourceOver(bytes(1, 2, 3, 4, 5, 6));
    const outer = source.slice(1, 4); // 2,3,4,5
    const inner = outer.slice(1, 10); // starts at 3, capped to 3 bytes: 3,4,5
    expect([...(await inner.readBytes())]).toEqual([3, 4, 5]);
  });
});

describe('BufferedSource view properties', () => {
  test('property: an arbitrary slice reads exactly the bytes at its window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({minLength: 1, maxLength: 64}),
        fc.integer({min: 0, max: 64}),
        fc.integer({min: 0, max: 64}),
        async (data, offset, count) => {
          const source = BufferedSource.overStream(fakeReadableStream([data]));
          const slice = source.slice(offset, count);
          const expected = [...data.subarray(offset, offset + count)];
          expect([...(await slice.readBytes())]).toEqual(expected);
        },
      ),
    );
  });

  test('property: no view read advances any other view or the parent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({minLength: 1, maxLength: 32}),
        async data => {
          const source = BufferedSource.overStream(fakeReadableStream([data]));
          const first = source.peek();
          const second = source.peek();
          await first.readBytes();
          expect([...(await second.readBytes())]).toEqual([...data]);
          expect([...(await source.readBytes())]).toEqual([...data]);
        },
      ),
    );
  });
});

describe('BufferedSource closed reporting and bridge lifecycle (IO-16, IO-19, IO-22)', () => {
  const sourceOf = (...values: number[]): BufferedSource =>
    BufferedSource.overBytes(bytes(...values));

  test('IO-22: a view invalidated by its parent reports itself closed', async () => {
    // Reading only the view's own flag makes the natural guard `if (!view.closed) await view.read()`
    // take the throwing branch every time, which defeats the point of exposing the flag.
    const source = sourceOf(1, 2, 3);
    const view = source.peek();
    await source.close();
    expect(source.closed).toBe(true);
    expect(view.closed).toBe(true);
  });

  test('IO-19: draining the bridge to EOF leaves outstanding previews readable', async () => {
    // IO-16 requires that closing the BRIDGE close the source; auto-closing at natural EOF is an extra
    // step that tears down the whole window and invalidates every peek — defeating IO-19's stated
    // rationale (previews, replay) for its most natural usage.
    const source = sourceOf(1, 2, 3);
    const preview = source.peek();
    await drainStream(source.toReadableStream());
    expect([...(await preview.readBytes())]).toEqual([1, 2, 3]);
    expect(source.closed).toBe(false);
    await source.close();
  });

  test('IO-16: cancelling the bridge closes the owning source', async () => {
    const source = sourceOf(1, 2, 3);
    const bridge = source.toReadableStream();
    await bridge.cancel();
    expect(source.closed).toBe(true);
  });

  test('IO-16: a mid-stream read failure closes the source instead of stranding it', async () => {
    // `cancel` is NOT invoked on an errored stream, so without an explicit close here the reader lock
    // and the retention window are both stranded on the failure path that matters most for a
    // connection-backed source.
    const stream = new ReadableStream<Uint8Array>({
      start(controller): void {
        controller.enqueue(bytes(1, 2, 3));
      },
      pull(): never {
        throw new Error('mid-stream read failure');
      },
    });
    const source = BufferedSource.overStream(stream);
    expect(stream.locked).toBe(true);
    expect(
      (await rejection(drainStream(source.toReadableStream()))).message,
    ).toContain('mid-stream read failure');
    expect(source.closed).toBe(true);
    // The lock is what actually leaks. The underlying `cancel` callback is deliberately NOT asserted:
    // per the Streams spec, cancelling an ALREADY-ERRORED stream rejects with the stored error without
    // ever invoking the underlying source's cancel, so there is nothing left to observe there.
    expect(stream.locked).toBe(false);
  });
});
