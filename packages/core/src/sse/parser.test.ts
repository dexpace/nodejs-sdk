// SPDX-License-Identifier: MIT
// packages/core/src/sse/parser.test.ts
// Exercises: SSE-1 (blank-line dispatch, fresh accumulators), SSE-3 (first-colon split), SSE-4 (present-but-empty
// distinct from absent), SSE-5 (one leading space stripped), SSE-6 (comments), SSE-7 (unknown fields discarded),
// SSE-8 (data accumulation), SSE-9 (NUL id ignored entirely), SSE-10 (event never defaulted), SSE-11 (retry),
// SSE-13 (permissive dispatch), SSE-14 (EOF dispatch), SSE-15 (stable end sentinel), SSE-16 (no last-event-id).
import {expect, test} from 'bun:test';
import {BufferedSource} from '../io/buffered-source.js';
import {type SseEvent, makeSseEvent} from './event.js';
import {SSE_END} from './line-reader.js';
import {SseParser} from './parser.js';

function parserOf(text: string): SseParser {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text.length > 0) {
        controller.enqueue(new TextEncoder().encode(text));
      }
      controller.close();
    },
  });
  return new SseParser(BufferedSource.overStream(stream));
}

async function eventsOf(text: string): Promise<SseEvent[]> {
  const parser = parserOf(text);
  const events: SseEvent[] = [];
  for (;;) {
    const event = await parser.next();
    if (event === SSE_END) return events;
    events.push(event);
  }
}

test('a blank line dispatches exactly one event, with fresh accumulators after (SSE-1)', async () => {
  const events = await eventsOf('data: 1\n\ndata: 2\n\n');
  expect(events.map(e => e.data)).toEqual([['1'], ['2']]);
});

test('per-event id does not carry forward (SSE-1, SSE-16)', async () => {
  const events = await eventsOf('id: 1\ndata: a\n\ndata: b\n\n');
  expect(events[0]?.id).toBe('1');
  expect(events[1]?.id).toBeUndefined();
});

test('a colon-less line is the whole field name with an empty value (SSE-3, SSE-4)', async () => {
  expect((await eventsOf('data\n\n'))[0]?.data).toEqual(['']);
});

test('a trailing colon yields an empty value (SSE-3, SSE-4)', async () => {
  expect((await eventsOf('data:\n\n'))[0]?.data).toEqual(['']);
});

test('an empty event field is present-but-empty, not absent (SSE-4)', async () => {
  expect((await eventsOf('event:\ndata:x\n\n'))[0]?.event).toBe('');
});

test('exactly one leading space is stripped; further spaces survive (SSE-5)', async () => {
  expect((await eventsOf('data: hello\n\n'))[0]?.data).toEqual(['hello']);
  expect((await eventsOf('data:   hello\n\n'))[0]?.data).toEqual(['  hello']);
});

test('a leading colon is a comment, and a comment-only block dispatches (SSE-6, SSE-13)', async () => {
  const events = await eventsOf(':keep-alive\n\n');
  expect(events).toHaveLength(1);
  expect(events[0]?.comment).toBe('keep-alive');
  expect(events[0]?.data).toEqual([]);
});

test('an unknown field sets no state and causes no dispatch (SSE-7)', async () => {
  const events = await eventsOf('garbage: zzz\nevent: kept\ndata: p\n\n');
  expect(events).toHaveLength(1);
  expect(events[0]?.event).toBe('kept');
  expect(events[0]?.data).toEqual(['p']);
  expect(events[0]?.id).toBeUndefined();
});

test('a colon-less unknown field alone dispatches nothing (SSE-7)', async () => {
  expect(await eventsOf('garbage\n\n')).toEqual([]);
});

test('consecutive data fields accumulate in wire order, unjoined (SSE-8)', async () => {
  expect((await eventsOf('data: line1\ndata: line2\n\n'))[0]?.data).toEqual([
    'line1',
    'line2',
  ]);
});

test('an id containing NUL is ignored entirely (SSE-9)', async () => {
  expect((await eventsOf('id: a\u0000b\ndata:x\n\n'))[0]?.id).toBeUndefined();
});

test('a NUL id does not overwrite a valid id from the same block (SSE-9)', async () => {
  expect((await eventsOf('id: good\nid: a\u0000b\ndata:x\n\n'))[0]?.id).toBe(
    'good',
  );
});

test('a NUL-only block does not count as a field seen, so it dispatches nothing (SSE-9, SSE-13)', async () => {
  expect(await eventsOf('id: a\u0000b\n\n')).toEqual([]);
});

test('an absent event field is undefined, never defaulted to "message" (SSE-10)', async () => {
  expect((await eventsOf('data:x\n\n'))[0]?.event).toBeUndefined();
});

test('event and id are latest-wins within a block (SSE-9, SSE-10)', async () => {
  const event = (
    await eventsOf('event: a\nevent: b\nid: 1\nid: 2\ndata:x\n\n')
  )[0];
  expect([event?.event, event?.id]).toEqual(['b', '2']);
});

test.each([
  ['retry: 5000', 5000],
  ['retry: 0', 0],
])('an all-digit retry is accepted (SSE-11): %s', async (line, expected) => {
  expect((await eventsOf(`${line}\ndata:x\n\n`))[0]?.retryMs).toBe(expected);
});

test.each([
  'retry: bad',
  'retry: -100',
  'retry:',
  'retry: 12x',
  'retry: 1 2',
  'retry: 99999999999999999999',
])('a malformed or oversized retry is ignored (SSE-11): %s', async line => {
  expect((await eventsOf(`${line}\ndata:x\n\n`))[0]?.retryMs).toBeUndefined();
});

test('an id-only block dispatches (SSE-13)', async () => {
  expect(await eventsOf('id: 42\n\n')).toHaveLength(1);
});

test('a block with no field set is skipped (SSE-13)', async () => {
  expect(await eventsOf('\n\n\n')).toEqual([]);
});

test('EOF dispatches a pending unterminated block (SSE-14)', async () => {
  const events = await eventsOf('data: hello');
  expect(events).toHaveLength(1);
  expect(events[0]?.data).toEqual(['hello']);
});

test('an empty stream ends immediately (SSE-14)', async () => {
  expect(await eventsOf('')).toEqual([]);
});

test('the parser never closes its source — ownership starts at the facade (SSE-17)', async () => {
  let cancelled = 0;
  const web = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: a\n\n'));
      controller.close();
    },
    cancel() {
      cancelled += 1;
    },
  });
  const source = BufferedSource.overStream(web);
  let sourceClosed = 0;
  const originalClose = source.close.bind(source);
  source.close = async () => {
    sourceClosed += 1;
    await originalClose();
  };

  const parser = new SseParser(source);
  await parser.next();
  await parser.next(); // drive to end of stream

  expect(sourceClosed).toBe(0);
  expect(cancelled).toBe(0);
});

test('the end sentinel is stable across repeated pulls (SSE-15)', async () => {
  const parser = parserOf('data: x\n\n');
  await parser.next();
  expect(await parser.next()).toBe(SSE_END);
  expect(await parser.next()).toBe(SSE_END);
  expect(await parser.next()).toBe(SSE_END);
});

test('a BOM on subsequent lines causes the line to be treated as an unknown field and discarded (SSE-7, SSE-12)', async () => {
  const parser = parserOf('data: a\n\uFEFFdata: b\n\n');
  const event = await parser.next();
  expect(event).toEqual(makeSseEvent({data: ['a']}));
});

test('multiple comments in a single block resolve to latest-wins (SSE-6)', async () => {
  const parser = parserOf(': first\n: second\n\n');
  const event = await parser.next();
  expect(event).toEqual(makeSseEvent({comment: 'second'}));
});

test('single leading space after colon on comment line is stripped (SSE-5, SSE-6)', async () => {
  const parser = parserOf(':  two spaces\n\n');
  const event = await parser.next();
  expect(event).toEqual(makeSseEvent({comment: ' two spaces'}));
});

test('invalid retry value does not overwrite a prior valid retry in the same block (SSE-11)', async () => {
  const parser = parserOf('retry: 1000\nretry: bad\n\n');
  const event = await parser.next();
  expect(event).toEqual(makeSseEvent({retryMs: 1000}));
});

test('a block containing only a retry field dispatches an event (SSE-13)', async () => {
  const parser = parserOf('retry: 2500\n\n');
  const event = await parser.next();
  expect(event).toEqual(makeSseEvent({retryMs: 2500}));
});
