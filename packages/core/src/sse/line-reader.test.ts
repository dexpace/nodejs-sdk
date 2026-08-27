// SPDX-License-Identifier: MIT
// packages/core/src/sse/line-reader.test.ts
// Exercises: SSE-2 (LF, CR, CRLF; CRLF is one terminator; a lone CR terminates by itself), SSE-12 (one leading
// BOM consumed via lookahead, a later BOM preserved as data), SSE-14 (a final unterminated line is content),
// SSE-19 (optional line cap, off by default).
import {expect, test} from 'bun:test';
import {BufferedSource} from '../io/buffered-source.js';
import {SSE_END, SseLineReader, SseLineTooLongError} from './line-reader.js';

/** Build a BufferedSource over a byte stream delivered in the given chunks. */
function sourceOf(chunks: readonly (string | Uint8Array)[]): BufferedSource {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
  // 3a exposes no public constructor — `overStream` takes the ReadableStream itself and acquires the reader.
  return BufferedSource.overStream(stream);
}

async function drain(reader: SseLineReader): Promise<string[]> {
  const lines: string[] = [];
  for (;;) {
    const line = await reader.nextLine();
    if (line === SSE_END) return lines;
    lines.push(line);
  }
}

test('LF terminates a line (SSE-2)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\nb\n'])))).toEqual([
    'a',
    'b',
  ]);
});

test('CRLF is a single terminator, not two (SSE-2)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\r\nb\r\n'])))).toEqual([
    'a',
    'b',
  ]);
});

test('a lone CR terminates a line by itself (SSE-2)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\rb\r'])))).toEqual([
    'a',
    'b',
  ]);
});

test('mixed terminators in one stream all work', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\nb\r\nc\rd\n'])))).toEqual([
    'a',
    'b',
    'c',
    'd',
  ]);
});

test('a CR ending one chunk and an LF starting the next is ONE terminator', async () => {
  // The framing bug this reader exists to avoid: a naive splitter emits a spurious empty line here, which in
  // SSE means a spurious event dispatch.
  expect(await drain(new SseLineReader(sourceOf(['a\r', '\nb\n'])))).toEqual([
    'a',
    'b',
  ]);
});

test('a CR at the very end of the stream still terminates its line', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\r'])))).toEqual(['a']);
});

test('a final line with no terminator is returned as content (SSE-14)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\nb'])))).toEqual([
    'a',
    'b',
  ]);
});

test('an empty stream yields no lines', async () => {
  expect(await drain(new SseLineReader(sourceOf([])))).toEqual([]);
});

test('blank lines are preserved — they are the dispatch boundary', async () => {
  expect(await drain(new SseLineReader(sourceOf(['a\n\nb\n'])))).toEqual([
    'a',
    '',
    'b',
  ]);
});

test('one leading BOM is consumed exactly once (SSE-12)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['﻿data: x\n'])))).toEqual([
    'data: x',
  ]);
});

test('a non-BOM prefix survives the lookahead intact (SSE-12)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['data: x\n'])))).toEqual([
    'data: x',
  ]);
});

test('a BOM later in the stream is preserved as ordinary data (SSE-12)', async () => {
  expect(await drain(new SseLineReader(sourceOf(['data: a﻿b\n'])))).toEqual([
    'data: a﻿b',
  ]);
});

test('a multi-byte character split across chunks decodes correctly', async () => {
  const bytes = new TextEncoder().encode('data: ü\n');
  const split = bytes.indexOf(0xc3);
  expect(
    await drain(
      new SseLineReader(
        sourceOf([bytes.slice(0, split + 1), bytes.slice(split + 1)]),
      ),
    ),
  ).toEqual(['data: ü']);
});

test('no line cap applies by default (SSE-19)', async () => {
  const long = 'x'.repeat(100_000);
  expect(await drain(new SseLineReader(sourceOf([`${long}\n`])))).toEqual([
    long,
  ]);
});

test('an explicit cap rejects an oversized line (SSE-19)', () => {
  const reader = new SseLineReader(sourceOf(['x'.repeat(50)]), 10);
  expect(reader.nextLine()).rejects.toBeInstanceOf(SseLineTooLongError);
});

test('the end sentinel is stable — repeated pulls past EOF keep reporting the end', async () => {
  // Not a duplicate of the parser's SSE-15 test. The parser has its own `#ended` guard that would mask a reader
  // which kept answering; this asserts the reader itself terminates, because a reader that returns `''` forever
  // is an infinite supply of SSE dispatch boundaries, and `drain()` above would never return.
  const reader = new SseLineReader(sourceOf(['a\n']));
  expect(await reader.nextLine()).toBe('a');
  expect(await reader.nextLine()).toBe(SSE_END);
  expect(await reader.nextLine()).toBe(SSE_END);
  expect(await reader.nextLine()).toBe(SSE_END);
});

test('a CRLF-terminated stream emits no trailing empty line', async () => {
  // The LF of a final `\r\n` is swallowed as the second half of one terminator, leaving nothing buffered. If
  // EOF-with-an-empty-buffer were treated as content rather than as the end, this would yield a phantom `''` —
  // and a phantom `''` is a phantom event dispatch.
  expect(await drain(new SseLineReader(sourceOf(['a\r\n'])))).toEqual(['a']);
  expect(await drain(new SseLineReader(sourceOf(['a\r\nb\r\n'])))).toEqual([
    'a',
    'b',
  ]);
});

test('a BOM on subsequent lines is preserved as line content (SSE-12)', async () => {
  expect(
    await drain(new SseLineReader(sourceOf(['data: x\n\uFEFFdata: y\n']))),
  ).toEqual(['data: x', '\uFEFFdata: y']);
  expect(
    await drain(new SseLineReader(sourceOf(['\uFEFF\uFEFFdata: x\n']))),
  ).toEqual(['\uFEFFdata: x']);
});

test('oversized line error permanently marks the reader ended (SSE-19)', async () => {
  const reader = new SseLineReader(sourceOf(['toolongline\n']), 5);
  let caught: unknown;
  try {
    await reader.nextLine();
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SseLineTooLongError);
  expect(await reader.nextLine()).toBe(SSE_END);
});
