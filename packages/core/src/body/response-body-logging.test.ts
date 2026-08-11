// SPDX-License-Identifier: MIT
// packages/core/src/body/response-body-logging.test.ts
// Exercises: BODY-22 (lazy, drain-once), BODY-23 (fits-cap: full capture, repeatable non-consuming
// reads), BODY-24 (exceeds-cap: prefix+tail once, second read fails), BODY-26 (drain failure cached,
// partial bytes retained, error() does not drain), BODY-27 (close-once shared guard), BODY-28 (captured
// buffer survives close), BODY-29 (reported length), BODY-32 (negative cap rejected)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {withResponseLogging} from './response-body-logging.js';

function readableOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('withResponseLogging regimes (BODY-22..24)', () => {
  test('nothing is captured until read() is called (BODY-22 laziness)', () => {
    expect(
      withResponseLogging(readableOf([1, 2, 3]), 100).snapshot().length,
    ).toBe(0);
  });

  test('fits-cap: fully captures, and every later read() is a fresh non-consuming view (BODY-23)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3]);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3]);
    expect([...logged.snapshot()]).toEqual([1, 2, 3]);
  });

  test('exceeds-cap: replays the prefix then the live tail, consumer receives the complete body (BODY-24)', async () => {
    const logged = withResponseLogging(readableOf([1, 2], [3, 4, 5]), 3);
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3, 4, 5]);
    expect([...logged.snapshot()]).toEqual([1, 2, 3]); // only the prefix up to the cap is retained
  });

  test('exceeds-cap: a second read() throws (BODY-24)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3, 4]), 1);
    await logged.read();
    expect(logged.read()).rejects.toThrow();
  });
});

describe('withResponseLogging lifecycle (BODY-27, 28)', () => {
  test('close is idempotent and shared across the wrapper close and tail completion (BODY-27)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    await readAll(await logged.read());
    await logged.close();
    await logged.close();
  });

  test('the captured buffer survives close -- snapshot still works after (BODY-28)', async () => {
    const logged = withResponseLogging(readableOf([1, 2]), 100);
    await readAll(await logged.read());
    await logged.close();
    expect([...logged.snapshot()]).toEqual([1, 2]);
  });

  test('[Symbol.asyncDispose] delegates to close()', async () => {
    await withResponseLogging(readableOf([1]), 100)[Symbol.asyncDispose]();
  });
});

describe('withResponseLogging error caching (BODY-26)', () => {
  test('a drain failure is cached: read() re-throws it, snapshot keeps the partial bytes (BODY-26)', () => {
    const boom = new Error('upstream reset');
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
      },
      pull(controller) {
        controller.error(boom);
      },
    });
    const logged = withResponseLogging(failing, 100);

    expect(logged.read()).rejects.toBe(boom);
    expect(logged.read()).rejects.toBe(boom); // same cached error, upstream never re-read
    expect([...logged.snapshot()]).toEqual([1, 2]); // partial capture retained, snapshot does not throw
    expect(logged.error()).toBe(boom);
  });

  test('error() reports null without triggering a drain (BODY-26)', () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    expect(logged.error()).toBeNull();
    expect(logged.snapshot().length).toBe(0); // still undrained -- error() did not read anything
  });
});

describe('withResponseLogging properties and lengths (BODY-29..34)', () => {
  test('contentLength is the captured size when it fits, the declared length when it does not (BODY-29)', async () => {
    const fits = withResponseLogging(readableOf([1, 2, 3]), 100, 3);
    await fits.read();
    expect(fits.contentLength).toBe(3);

    const exceeds = withResponseLogging(readableOf([1, 2, 3, 4]), 2, 4);
    await exceeds.read();
    expect(exceeds.contentLength).toBe(4); // the delegate's true length, not the 2-byte prefix
  });

  test('a negative cap is rejected at construction (BODY-32)', () => {
    expect(() => withResponseLogging(readableOf([1]), -1)).toThrow(
      InvariantViolation,
    );
  });

  test('for any (cap, body) pair the consumer receives every byte and the tap stays bounded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({minLength: 0, maxLength: 512}),
        fc.integer({min: 0, max: 600}),
        async (payload, cap) => {
          const source = new ReadableStream<Uint8Array>({
            start(controller) {
              if (payload.length > 0) controller.enqueue(payload);
              controller.close();
            },
          });
          const logged = withResponseLogging(source, cap);

          // BODY-34: the consumer gets the complete body whichever regime triggered.
          expect([...(await readAll(await logged.read()))]).toEqual([
            ...payload,
          ]);
          // BODY-23/BODY-24: the capture is bounded by the cap either way.
          expect(logged.snapshot().length).toBe(Math.min(payload.length, cap));
        },
      ),
      {seed: 0x3b},
    );
  });
});
