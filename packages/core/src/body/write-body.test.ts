// SPDX-License-Identifier: MIT
// packages/core/src/body/write-body.test.ts
// Exercises: RECOV-12 (a failure inside the writer scope is never masked by the teardown -- the sink is
// aborted, and an abort() that itself rejects does not displace the primary failure), RETRY-2 (the
// primary failure reaches the caller unwrapped so classification can walk its own cause chain)
import {describe, expect, test} from 'bun:test';
import {rejection} from '../io/test-support/rejection.js';
import {withBodyWriter} from './write-body.js';

interface SinkLog {
  readonly chunks: Uint8Array[];
  closed: boolean;
  abortReason: unknown;
}

function recordingSink(overrides: UnderlyingSink<Uint8Array> = {}): {
  stream: WritableStream<Uint8Array>;
  log: SinkLog;
} {
  const log: SinkLog = {chunks: [], closed: false, abortReason: undefined};
  const stream = new WritableStream<Uint8Array>({
    write: chunk => void log.chunks.push(chunk),
    close: () => void (log.closed = true),
    abort: reason => void (log.abortReason = reason),
    ...overrides,
  });
  return {stream, log};
}

describe('withBodyWriter success path', () => {
  test('writes through and closes the sink', async () => {
    const {stream, log} = recordingSink();

    await withBodyWriter(stream, async writer => {
      await writer.write(Uint8Array.from([1, 2]));
    });

    expect(log.chunks).toEqual([Uint8Array.from([1, 2])]);
    expect(log.closed).toBe(true);
    expect(log.abortReason).toBeUndefined();
  });

  test('a close failure propagates unwrapped (RETRY-2)', async () => {
    const {stream} = recordingSink({
      close: () => {
        throw new Error('CLOSE FAILED');
      },
    });

    const error = await rejection(
      withBodyWriter(stream, () => Promise.resolve()),
    );

    expect(error.message).toBe('CLOSE FAILED');
  });
});

describe('withBodyWriter failure path (RECOV-12, RETRY-2)', () => {
  test('aborts the sink with the primary failure and rethrows it', async () => {
    const {stream, log} = recordingSink();
    const primary = new Error('SOCKET GONE');

    const error = await rejection(
      withBodyWriter(stream, () => Promise.reject(primary)),
    );

    expect(error).toBe(primary);
    expect(log.abortReason).toBe(primary);
    expect(log.closed).toBe(false);
  });

  test('an abort() that itself rejects does not displace the primary failure', async () => {
    const {stream} = recordingSink({
      abort: () => {
        throw new Error('ABORT FAILED');
      },
    });
    const primary = new Error('SOCKET GONE');

    const error = await rejection(
      withBodyWriter(stream, () => Promise.reject(primary)),
    );

    expect(error).toBe(primary);
  });

  test('aborting an already-errored stream still surfaces the primary failure', async () => {
    // The sink's own write() poisons the stream, so abort() runs against a stream that is already
    // errored -- the case the naive `finally { close() }` shape turns into a bogus TypeError.
    const {stream} = recordingSink({
      write: () => {
        throw new Error('SINK EXPLODED');
      },
    });

    const error = await rejection(
      withBodyWriter(stream, async writer => {
        await writer.write(Uint8Array.from([1]));
      }),
    );

    expect(error.message).toBe('SINK EXPLODED');
  });
});
