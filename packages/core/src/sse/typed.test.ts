// SPDX-License-Identifier: MIT
// packages/core/src/sse/typed.test.ts
// Exercises: SSE-33 (mapper receives event name + newline-joined data), SSE-34 (Value/Skip/Done honored),
// SSE-35 (lazy per-element decoding), SSE-36 (a throwing mapper releases the resource before propagating).
import {expect, test} from 'bun:test';
import {BufferedSource} from '../io/buffered-source.js';
import {IoError} from '../io/errors.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {SseParser} from './parser.js';
import {SseStream} from './stream.js';
import {
  MAPPER_DONE,
  MAPPER_SKIP,
  mapperValue,
  typedSseStream,
} from './typed.js';

function streamOver(text: string): {stream: SseStream; closes: () => number} {
  let closeCount = 0;
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const stream = new SseStream(new SseParser(BufferedSource.overStream(web)), {
    close(): Promise<void> {
      closeCount += 1;
      return Promise.resolve();
    },
  });
  return {stream, closes: () => closeCount};
}

test('the mapper receives the raw event name and newline-joined data (SSE-33)', async () => {
  const seen: [string | undefined, string][] = [];
  const {stream} = streamOver('event: ping\ndata: l1\ndata: l2\n\n');
  for await (const value of typedSseStream(stream, (name, data) => {
    seen.push([name, data]);
    return mapperValue(1);
  })) {
    void value;
  }
  expect(seen).toEqual([['ping', 'l1\nl2']]);
});

test('a no-data event joins to the empty string, and an absent name stays undefined (SSE-33)', async () => {
  const seen: [string | undefined, string][] = [];
  const {stream} = streamOver('id: 1\n\n');
  for await (const value of typedSseStream(stream, (name, data) => {
    seen.push([name, data]);
    return MAPPER_SKIP;
  })) {
    void value;
  }
  expect(seen).toEqual([[undefined, '']]);
});

test('Value is yielded, Skip is dropped silently (SSE-34)', async () => {
  const {stream} = streamOver('data: keep\n\ndata: drop\n\ndata: keep2\n\n');
  const out: string[] = [];
  for await (const value of typedSseStream(stream, (_name, data) =>
    data === 'drop' ? MAPPER_SKIP : mapperValue(data),
  )) {
    out.push(value);
  }
  expect(out).toEqual(['keep', 'keep2']);
});

test('Done ends iteration cleanly, closes, and yields nothing for the sentinel (SSE-34)', async () => {
  const {stream, closes} = streamOver(
    'data: a\n\ndata: STOP\n\ndata: never\n\n',
  );
  const out: string[] = [];
  for await (const value of typedSseStream(stream, (_name, data) =>
    data === 'STOP' ? MAPPER_DONE : mapperValue(data),
  )) {
    out.push(value);
  }
  expect(out).toEqual(['a']);
  expect(closes()).toBe(1);
});

test('post-sentinel events are never decoded (SSE-34)', async () => {
  let calls = 0;
  const {stream} = streamOver(
    'data: a\n\ndata: STOP\n\ndata: never\n\ndata: also-never\n\n',
  );
  for await (const value of typedSseStream(stream, (_name, data) => {
    calls += 1;
    return data === 'STOP' ? MAPPER_DONE : mapperValue(data);
  })) {
    void value;
  }
  expect(calls).toBe(2);
});

test('decoding is lazy and per-element (SSE-35)', async () => {
  let decodes = 0;
  const {stream} = streamOver('data: a\n\ndata: b\n\ndata: c\n\n');
  const iterator = typedSseStream(stream, (_name, data) => {
    decodes += 1;
    return mapperValue(data);
  })[Symbol.asyncIterator]();

  await iterator.next();
  expect(decodes).toBe(1);
  await iterator.next();
  expect(decodes).toBe(2);
});

test('a throwing mapper releases the resource before the error reaches the consumer (SSE-36)', async () => {
  const boom = new Error('bad payload');
  const {stream, closes} = streamOver('data: a\n\ndata: b\n\n');
  let caught: unknown;
  try {
    for await (const value of typedSseStream(stream, (_name, data) => {
      if (data === 'b') throw boom;
      return mapperValue(data);
    })) {
      void value;
    }
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBe(boom);
  expect(closes()).toBe(1);
});

test('a release failure while a mapper error is in flight is attached as suppressed (SSE-36)', async () => {
  const boom = new Error('bad payload');
  const closeFailure = new IoError('close failed');
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: a\n\n'));
      controller.close();
    },
  });
  const stream = new SseStream(new SseParser(BufferedSource.overStream(web)), {
    close: () => Promise.reject(closeFailure),
  });

  let caught: unknown;
  try {
    for await (const value of typedSseStream(stream, () => {
      throw boom;
    })) {
      void value;
    }
  } catch (e: unknown) {
    caught = e;
  }
  const suppressed = caught as SuppressedErrorLike;
  expect(suppressed.name).toBe('SuppressedError');
  expect(suppressed.error).toBe(boom);
  expect(suppressed.suppressed).toBe(closeFailure);
});
