// SPDX-License-Identifier: MIT
// packages/core/src/sse/lifecycle.test.ts
// SSE-23: exactly one release across the stream's whole life, regardless of how it terminated.
import {expect, test} from 'bun:test';
import {BufferedSource} from '../io/buffered-source.js';
import {SseParser} from './parser.js';
import {SseStream} from './stream.js';
import {MAPPER_DONE, mapperValue, typedSseStream} from './typed.js';

function counted(text: string): {stream: SseStream; closes: () => number} {
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

const THREE_EVENTS = 'data: a\n\ndata: b\n\ndata: STOP\n\n';

test.each([
  [
    'clean end of stream',
    async (stream: SseStream) => {
      for await (const event of stream) {
        void event;
      }
    },
  ],
  [
    'explicit close with no iteration',
    async (stream: SseStream) => {
      await stream.close();
    },
  ],
  [
    'partial consume then explicit close',
    async (stream: SseStream) => {
      for await (const event of stream) {
        void event;
        break;
      }
      await stream.close();
    },
  ],
  [
    'early break alone',
    async (stream: SseStream) => {
      for await (const event of stream) {
        void event;
        break;
      }
    },
  ],
  [
    'consumer throws mid-iteration',
    async (stream: SseStream) => {
      try {
        for await (const event of stream) {
          void event;
          throw new Error('consumer blew up');
        }
      } catch {
        /* expected */
      }
    },
  ],
  [
    'typed mapper returns Done',
    async (stream: SseStream) => {
      for await (const value of typedSseStream(stream, (_n, d) =>
        d === 'STOP' ? MAPPER_DONE : mapperValue(d),
      )) {
        void value;
      }
    },
  ],
])('exactly one release: %s (SSE-23)', async (_name, terminate) => {
  const {stream, closes} = counted(THREE_EVENTS);
  await terminate(stream);
  expect(closes()).toBe(1);
});
