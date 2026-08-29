// SPDX-License-Identifier: MIT
// packages/core/src/body/response-body-logging.test.ts
// Exercises: BODY-22 (lazy, drain-once), BODY-23 (fits-cap: full capture, repeatable non-consuming
// reads), BODY-24 (exceeds-cap: prefix+tail once, second read fails), BODY-26 (drain failure cached,
// partial bytes retained, error() does not drain), BODY-27 (close-once shared guard), BODY-28 (captured
// buffer survives close), BODY-29 (reported length), BODY-32 (negative cap rejected), BODY-25 (a
// zero-length delegate chunk is a stream-contract violation, never end-of-stream)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {SourceContractViolationError} from '../io/errors.js';
import {withResponseLogging} from './response-body-logging.js';

function readableOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

/** Awaits a rejection and returns its reason, failing loudly when the promise resolves instead. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error('expected a rejection, but the promise resolved');
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
  test('the delegate is cancelled at most once however often close is called (BODY-27)', async () => {
    // The exceeds-cap regime deliberately: on the fits path the delegate is already closed by the time
    // the guard runs, so cancel() is a spec no-op and a counter there proves nothing -- and BODY-27
    // exists for the transports that are less forgiving than a spec-compliant ReadableStream.
    const {stream, cancels} = countingStream([1, 2], [3, 4]);
    const logged = withResponseLogging(stream, 1);
    await logged.read();
    await logged.close();
    await logged.close();
    await logged.close();
    expect(cancels()).toBe(1);
  });

  test('the wrapper close and the tail stream share one guard (BODY-27)', async () => {
    const {stream, cancels} = countingStream([1, 2], [3, 4]);
    const logged = withResponseLogging(stream, 1);
    const tail = await logged.read();
    await tail.cancel(); // tail path
    await logged.close(); // wrapper path
    expect(cancels()).toBe(1);
  });

  test('the captured buffer survives close -- snapshot still works after (BODY-28)', async () => {
    const logged = withResponseLogging(readableOf([1, 2]), 100);
    await readAll(await logged.read());
    await logged.close();
    expect([...logged.snapshot()]).toEqual([1, 2]);
  });

  test('teardown is close() only -- no [Symbol.asyncDispose] on the >=20.3 floor', () => {
    // See Response's matching assertion: the symbol is undefined on the declared floor, so declaring
    // it binds the method to the string "undefined". Absence is the assertion.
    const logged = withResponseLogging(readableOf([1]), 100);
    expect(Object.keys(logged)).not.toContain('undefined');
    expect(typeof logged.close).toBe('function');
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

/**
 * A delegate that counts calls to `cancel()` and throws on the second, standing in for the transports
 * BODY-27 names -- the ones that do not tolerate a double close. Counting the underlying source's
 * `cancel` callback instead would prove nothing: the Streams spec makes a second `cancel()` on an
 * already-cancelled stream a resolved no-op that never reaches the source.
 */
function countingStream(...chunks: number[][]): {
  stream: ReadableStream<Uint8Array>;
  cancels: () => number;
} {
  let cancels = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
  const delegate = stream.cancel.bind(stream);
  stream.cancel = async (reason?: unknown): Promise<void> => {
    cancels += 1;
    if (cancels > 1)
      throw new Error('transport does not tolerate a double close');
    return delegate(reason);
  };
  return {stream, cancels: () => cancels};
}

describe('close failures (BODY-28)', () => {
  test('a non-TypeError from cancel() propagates rather than being swallowed', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
      },
    });
    stream.cancel = (): Promise<void> =>
      Promise.reject(new Error('CONNECTION STUCK'));
    const logged = withResponseLogging(stream, 1);
    await logged.read(); // exceeds-cap regime leaves the delegate live, so close() really cancels
    expect(logged.close()).rejects.toThrow('CONNECTION STUCK');
  });
});

describe('delegate stream contract (BODY-25)', () => {
  function emptyThenData(): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(0));
        controller.enqueue(Uint8Array.from([7]));
        controller.close();
      },
    });
  }

  test('a zero-length chunk is raised, never tolerated as a no-op', () => {
    // Matches RetentionWindow under IO-17's identical rule: a response body reaches both this tee and
    // BufferedSource, so the two layers must not disagree about the same upstream.
    const logged = withResponseLogging(emptyThenData(), 100);
    expect(logged.read()).rejects.toThrow(SourceContractViolationError);
  });

  test('the violation is cached like any other drain failure (BODY-26)', () => {
    const logged = withResponseLogging(emptyThenData(), 100);
    expect(logged.read()).rejects.toThrow(SourceContractViolationError);
    expect(logged.error()).toBeInstanceOf(SourceContractViolationError);
    expect(logged.read()).rejects.toThrow(SourceContractViolationError);
  });
});

describe('the tail path enforces the same chunk contract (BODY-25)', () => {
  test('a zero-length chunk after the cap is raised, not enqueued', async () => {
    // The drain stops at the cap, so a violating chunk arriving afterwards is read by tailStream, not
    // drainOnce. A rule that holds in one regime and not the other makes the same upstream pass or
    // fail depending only on how big the body happened to be.
    let pulls = 0;
    const delegate = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
          return;
        }
        controller.enqueue(new Uint8Array(0));
      },
    });
    const logged = withResponseLogging(delegate, 2);
    const tail = await logged.read();

    expect((await rejection(readAll(tail))).name).toBe(
      'SourceContractViolationError',
    );
    // BODY-26: cached like any other delegate failure, so error() still reports it.
    expect(logged.error()).toBeInstanceOf(SourceContractViolationError);
  });
});

describe('snapshot is a drain trigger (BODY-22)', () => {
  test('calling snapshot starts the drain, without a read()', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    expect([...logged.snapshot()]).toEqual([]); // synchronous: the drain has only just been started
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...logged.snapshot()]).toEqual([1, 2, 3]);
  });

  test('the drain still happens exactly once (BODY-22)', async () => {
    const logged = withResponseLogging(readableOf([1, 2, 3]), 100);
    logged.snapshot();
    logged.snapshot();
    expect([...(await readAll(await logged.read()))]).toEqual([1, 2, 3]);
  });

  test('a snapshot-triggered drain failure still reaches read(), and does not go unhandled', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('UPSTREAM GONE'));
      },
    });
    const logged = withResponseLogging(stream, 100);
    expect([...logged.snapshot()]).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(logged.read()).rejects.toThrow('UPSTREAM GONE');
  });
});
