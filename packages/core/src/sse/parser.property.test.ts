// SPDX-License-Identifier: MIT
// packages/core/src/sse/parser.property.test.ts
import {test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from '../io/buffered-source.js';
import {SSE_END} from './line-reader.js';
import {SseParser} from './parser.js';

/** Text with no CR, LF, or NUL — the characters that would change framing or trigger SSE-9. */
const safeText = fc
  .stringMatching(/^[ -~]{0,20}$/)
  .filter(s => !s.includes('\u0000'));

test('serialize → parse round-trips any event with an id, event name, and data lines', async () => {
  await fc.assert(
    fc.asyncProperty(
      safeText,
      safeText,
      fc.array(safeText, {maxLength: 4}),
      async (id, name, data) => {
        const wire =
          `id: ${id}\n` +
          `event: ${name}\n` +
          data.map(d => `data: ${d}\n`).join('') +
          '\n';
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(wire));
            controller.close();
          },
        });
        const parser = new SseParser(BufferedSource.overStream(stream));
        const event = await parser.next();
        if (event === SSE_END) return false;
        return (
          event.id === id &&
          event.event === name &&
          JSON.stringify(event.data) === JSON.stringify(data)
        );
      },
    ),
  );
});
