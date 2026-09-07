// SPDX-License-Identifier: MIT
// packages/core/src/io/pump.test.ts
// Exercises: IO-17 (pump to exhaustion, terminate only on the EOF sentinel, raise a zero-read for a
// positive request as a source-contract violation)
import {describe, expect, test} from 'bun:test';
import {BufferedSink} from './buffered-sink.js';
import {BufferedSource} from './buffered-source.js';
import {SourceContractViolationError} from './errors.js';
import {writeAll} from './pump.js';
import {
  collectingWritableStream,
  fakeReadableStream,
  protocolViolatingStream,
} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

describe('writeAll (IO-17)', () => {
  test('pumps the source to exhaustion and returns the total transferred', async () => {
    const source = BufferedSource.overStream(
      fakeReadableStream([Uint8Array.from([1, 2]), Uint8Array.from([3, 4, 5])]),
    );
    const {stream, written} = collectingWritableStream();
    const sink = BufferedSink.overStream(stream);

    expect(await writeAll(source, sink)).toBe(5);
    await sink.close();
    expect([...written()]).toEqual([1, 2, 3, 4, 5]);
  });

  test('an already-exhausted source transfers zero and does not hang', async () => {
    const source = BufferedSource.overStream(fakeReadableStream([]));
    const {stream} = collectingWritableStream();
    expect(await writeAll(source, BufferedSink.overStream(stream))).toBe(0);
  });

  test('a source returning zero bytes for a positive request is a contract violation', async () => {
    // Never tolerated as end-of-stream, and never spun on forever — a misbehaving foreign source must
    // fail loudly rather than hang or truncate a body.
    const source = BufferedSource.overStream(protocolViolatingStream());
    const {stream} = collectingWritableStream();
    expect(
      await rejection(writeAll(source, BufferedSink.overStream(stream))),
    ).toBeInstanceOf(SourceContractViolationError);
  });
});
