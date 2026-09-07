// SPDX-License-Identifier: MIT
// packages/core/src/sse/line-reader.property.test.ts
// The guarantee the carry buffer exists to provide: how bytes arrive must not change how lines come out.
import {test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from '../io/buffered-source.js';
import {SSE_END, SseLineReader} from './line-reader.js';

const FIXTURE = 'data: a\r\ndata: b\rdata: c\n\nid: 7\ndata: tail';

async function linesFromChunks(
  chunks: readonly Uint8Array[],
): Promise<string[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  const reader = new SseLineReader(BufferedSource.overStream(stream));
  const lines: string[] = [];
  for (;;) {
    const line = await reader.nextLine();
    if (line === SSE_END) return lines;
    lines.push(line);
  }
}

test('the line sequence is identical for every chunk split of the same bytes', async () => {
  const all = new TextEncoder().encode(FIXTURE);
  const expected = await linesFromChunks([all]);

  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(fc.integer({min: 1, max: all.length - 1}), {maxLength: 4}),
      async rawCuts => {
        const cuts = [...rawCuts].sort((a, b) => a - b);
        const chunks: Uint8Array[] = [];
        let prev = 0;
        for (const cut of cuts) {
          chunks.push(all.slice(prev, cut));
          prev = cut;
        }
        chunks.push(all.slice(prev));
        const actual = await linesFromChunks(chunks);
        return JSON.stringify(actual) === JSON.stringify(expected);
      },
    ),
  );
});
