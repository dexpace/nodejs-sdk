// SPDX-License-Identifier: MIT
// packages/core/src/body/request-body-logging.test.ts
// Exercises: BODY-17 (mirror + forward the full untruncated payload), BODY-18 (tap clears at the start
// of every write), BODY-19 (tap cap, full payload unaffected), BODY-20 (partial-failure snapshot), BODY-21
// (replayable/materialize pass through, preserving the tap CAP without sharing its buffer), BODY-37 (no
// backing-buffer escape hatch), plus the decorator's own sink ownership: an abort must reach the
// primary sink rather than stopping at the adapter (RECOV-12)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {withRequestLogging} from './request-body-logging.js';
import {rejection} from '../io/test-support/rejection.js';
import type {Body} from './body.js';
import {ConsumedBodyError} from './errors.js';
import {byteArrayBody} from './simple-bodies.js';
import {streamBody} from './stream-body.js';

/** Sentinel distinguishing "abort() never ran" from "abort(undefined)". */
const NOT_ABORTED = Symbol('not-aborted');

/** A healthy sink that records which teardown path the body took. */
function observableSink(): {
  sink: WritableStream<Uint8Array>;
  aborted: () => unknown;
  closed: () => boolean;
} {
  let aborted: unknown = NOT_ABORTED;
  let closed = false;
  const sink = new WritableStream<Uint8Array>({
    write: () => undefined,
    close: () => void (closed = true),
    abort: reason => void (aborted = reason),
  });
  return {sink, aborted: () => aborted, closed: () => closed};
}

function collectingSink(): {
  sink: WritableStream<Uint8Array>;
  written: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write: c => void chunks.push(c),
  });
  return {
    sink,
    written: () => {
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
  };
}

describe('withRequestLogging mirroring and caps (BODY-17..20)', () => {
  test('forwards the full payload untruncated regardless of the tap cap (BODY-17, BODY-19)', async () => {
    const logged = withRequestLogging(
      byteArrayBody(Uint8Array.from([1, 2, 3, 4, 5])),
      2,
    );
    const {sink, written} = collectingSink();
    await logged.writeTo(sink);
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
    expect([...logged.snapshot()]).toEqual([1, 2]);
  });

  test('the tap clears at the start of every write (BODY-18)', async () => {
    const logged = withRequestLogging(
      byteArrayBody(Uint8Array.from([9, 9])),
      10,
    );
    await logged.writeTo(collectingSink().sink);
    await logged.writeTo(collectingSink().sink);
    expect([...logged.snapshot()]).toEqual([9, 9]); // not [9, 9, 9, 9]
  });

  test('a tap cap of 0 mirrors nothing while still forwarding everything', async () => {
    const logged = withRequestLogging(
      byteArrayBody(Uint8Array.from([1, 2])),
      0,
    );
    const {sink, written} = collectingSink();
    await logged.writeTo(sink);
    expect([...written()]).toEqual([1, 2]);
    expect(logged.snapshot().length).toBe(0);
  });

  test('a partial write failure still leaves the bytes mirrored up to that point (BODY-20)', () => {
    const failing = new WritableStream<Uint8Array>({
      write: (_chunk, controller) => {
        controller.error(new Error('boom'));
      },
    });
    const logged = withRequestLogging(
      byteArrayBody(Uint8Array.from([1, 2, 3])),
      10,
    );
    expect(logged.writeTo(failing)).rejects.toThrow();
    expect(logged.snapshot().length).toBeGreaterThan(0);
  });
});

describe('withRequestLogging replayability, materialize, and protection (BODY-21, 32, 37)', () => {
  test('replayable passes through the delegate verbatim (BODY-21)', () => {
    expect(
      withRequestLogging(byteArrayBody(Uint8Array.from([1])), 10).replayable,
    ).toBe(true);
    const singleUse = withRequestLogging(
      streamBody(
        new ReadableStream({
          start: c => {
            c.close();
          },
        }),
      ),
      10,
    );
    expect(singleUse.replayable).toBe(false);
  });

  test('materialize() returns a still-logged, now-replayable wrapper preserving the tap (BODY-21)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([7, 7]));
        controller.close();
      },
    });
    const logged = withRequestLogging(streamBody(stream), 10);
    expect(logged.replayable).toBe(false);

    const materialized = await logged.materialize();
    expect(materialized.replayable).toBe(true);
    expect(typeof materialized.snapshot).toBe('function');

    const {sink, written} = collectingSink();
    await materialized.writeTo(sink);
    expect([...written()]).toEqual([7, 7]);
    expect([...materialized.snapshot()]).toEqual([7, 7]);
  });

  test('exposes no direct handle onto the tap buffer -- snapshot is the only read path (BODY-37)', () => {
    const logged = withRequestLogging(byteArrayBody(Uint8Array.from([1])), 10);
    expect(Object.keys(logged)).not.toContain('tap');
    expect(Object.keys(logged)).not.toContain('buffer');
  });

  test('the primary always receives the exact payload, independent of the tap cap (BODY-17)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({minLength: 0, maxLength: 512}),
        fc.integer({min: 0, max: 600}),
        async (payload, tapCap) => {
          const logged = withRequestLogging(byteArrayBody(payload), tapCap);
          const {sink, written} = collectingSink();
          await logged.writeTo(sink);

          expect([...written()]).toEqual([...payload]); // wire body never reduced or altered
          expect(logged.snapshot().length).toBe(
            Math.min(payload.length, tapCap),
          ); // tap bounded
        },
      ),
      {seed: 0x3b},
    );
  });

  test('a negative tap cap is rejected at construction (BODY-32)', () => {
    expect(() =>
      withRequestLogging(byteArrayBody(Uint8Array.from([1])), -1),
    ).toThrow(InvariantViolation);
  });
});

function bytesStream(...values: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(values));
      controller.close();
    },
  });
}

describe('materialize does not alias the tap (BODY-21)', () => {
  test('each wrapper keeps its own buffer, so one write cannot rewrite the other preview', async () => {
    const logged = withRequestLogging(
      streamBody(bytesStream(1, 2, 3), undefined, 3),
      100,
    );
    const materialized = await logged.materialize();

    const {sink} = collectingSink();
    await materialized.writeTo(sink);

    expect([...materialized.snapshot()]).toEqual([1, 2, 3]);
    // BODY-18 clears the tap at the start of every write. With one shared ByteQueue, a Phase 7 retry
    // loop's second attempt silently rewrites the preview the first-attempt wrapper is still holding.
    expect([...logged.snapshot()]).toEqual([]);
  });

  test('the materialized wrapper still honours the configured cap', async () => {
    const logged = withRequestLogging(
      streamBody(bytesStream(1, 2, 3), undefined, 3),
      2,
    );
    const materialized = await logged.materialize();
    const {sink} = collectingSink();
    await materialized.writeTo(sink);
    expect([...materialized.snapshot()]).toEqual([1, 2]);
  });
});

describe('the decorator owns the sink it was handed (BODY-17, RECOV-12)', () => {
  // The adapter stream the tee hands the delegate must forward BOTH teardown paths. Without an
  // `abort` algorithm on it the delegate's abort stops at the decorator -- the adapter's default
  // abort is a no-op -- so the real sink is never told the message is broken and a truncated body
  // can be committed downstream as a complete one.

  test('a delegate failure aborts the primary sink rather than closing it', async () => {
    // A declared length the stream cannot satisfy: withBodyWriter aborts, and that abort has to
    // reach the caller's sink through the tee.
    const {sink, aborted, closed} = observableSink();
    const short = streamBody(bytesStream(1, 2), undefined, 5);
    const logged = withRequestLogging(short, 10);

    expect((await rejection(logged.writeTo(sink))).name).toBe(
      'EndOfStreamError',
    );
    expect(aborted()).not.toBe(NOT_ABORTED);
    expect(closed()).toBe(false);
  });

  test('a delegate that refuses before writing still tears the primary sink down', async () => {
    // ConsumedBodyError is raised before the adapter is ever touched, so neither of its handlers
    // runs and only writeTo's own catch can release the writer it took.
    const {sink, aborted, closed} = observableSink();
    const body = streamBody(bytesStream());
    await body.writeTo(new WritableStream());
    const logged = withRequestLogging(body, 10);

    expect(await rejection(logged.writeTo(sink))).toBeInstanceOf(
      ConsumedBodyError,
    );
    expect(aborted()).toBeInstanceOf(ConsumedBodyError);
    expect(closed()).toBe(false);
  });

  test('a delegate that resolves without closing the adapter still closes the primary', async () => {
    // Body.writeTo's contract is that the body closes the sink it was given. A delegate that just
    // resolves would otherwise strand the caller's sink open and locked, with nothing thrown.
    const {sink, aborted, closed} = observableSink();
    const rogue: Body = {
      kind: 'byte-array',
      mediaType: undefined,
      contentLength: 1,
      replayable: true,
      writeTo: async (target: WritableStream<Uint8Array>): Promise<void> => {
        const writer = target.getWriter();
        await writer.write(Uint8Array.from([1]));
        writer.releaseLock(); // resolves without close() or abort()
      },
    };

    await withRequestLogging(rogue, 10).writeTo(sink);
    expect(closed()).toBe(true);
    expect(aborted()).toBe(NOT_ABORTED);
  });

  test('a successful write closes the primary sink and never aborts it', async () => {
    const {sink, aborted, closed} = observableSink();
    await withRequestLogging(byteArrayBody(Uint8Array.from([1])), 10).writeTo(
      sink,
    );
    expect(closed()).toBe(true);
    expect(aborted()).toBe(NOT_ABORTED);
  });
});
