// SPDX-License-Identifier: MIT
// packages/core/src/body/request-body-logging.test.ts
// Exercises: BODY-17 (mirror + forward the full untruncated payload), BODY-18 (tap clears at the start
// of every write), BODY-19 (tap cap, full payload unaffected), BODY-20 (partial-failure snapshot), BODY-21
// (replayable/materialize pass through, preserving the tap), BODY-37 (no backing-buffer escape hatch)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {withRequestLogging} from './request-body-logging.js';
import {byteArrayBody} from './simple-bodies.js';
import {streamBody} from './stream-body.js';

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
