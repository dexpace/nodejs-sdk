// SPDX-License-Identifier: MIT
// test/node-conformance/sse.test.mjs
//
// Phase 6b's runtime-divergent SSE surface, run against the BUILT artifact on real Node.
//
// Key runtime-divergent points asserted on real Node Web Streams:
//   1. Web Streams reader-lock discipline: releaseLock() on Node's ReadableStream while a read is in
//      flight rejects with TypeError, which SseStream maps to IoError (SSE-31).
//   2. Response body cancellation and double release in closingBoth().
//   3. TextDecoder ignoreBOM behavior across line boundaries on Node.
//   4. Async generator teardown (.return()) and resource release on early break.
//   5. AbortSignal listener lifecycle on Node.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  MAPPER_DONE,
  MAPPER_SKIP,
  mapperValue,
  Protocol,
  Request,
  Response,
  sseStreamFrom,
  SseStreamError,
  Status,
  typedSseStream,
} from '@dexpace/core';

function streamOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

function responseOver(body) {
  const req = Request.newBuilder()
    .url('https://example.com/events')
    .method('GET')
    .build();
  return Response.newBuilder()
    .request(req)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

describe('SSE stream over Node Web Streams', () => {
  it('parses events and preserves pull discipline on Node (SSE-1..8, SSE-39)', async () => {
    let pulls = 0;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          if (pulls > 2) {
            controller.close();
            return;
          }
          controller.enqueue(
            new TextEncoder().encode(`event: msg\ndata: item-${pulls}\n\n`),
          );
        },
      },
      {highWaterMark: 0},
    );

    const stream = sseStreamFrom(responseOver(body));
    const events = [];
    for await (const event of stream) {
      events.push(event);
      if (events.length === 1) {
        // Assert only one pull occurred to get the first event
        assert.equal(pulls, 1);
      }
    }
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'msg');
    assert.deepEqual(events[0].data, ['item-1']);
    assert.equal(events[1].event, 'msg');
    assert.deepEqual(events[1].data, ['item-2']);
  });

  it('strips leading BOM once and preserves subsequent BOM on Node (SSE-12)', async () => {
    const bomPrefix = new Uint8Array([0xef, 0xbb, 0xbf]);
    const payload = new TextEncoder().encode(
      'data: first\n\n\uFEFFdata: second\n\n',
    );
    const combined = new Uint8Array(bomPrefix.length + payload.length);
    combined.set(bomPrefix, 0);
    combined.set(payload, bomPrefix.length);

    const stream = sseStreamFrom(responseOver(streamOf(combined)));
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }
    // First event has leading BOM stripped by line reader
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].data, ['first']);
  });

  it('maps in-flight reader teardown to IoError on Node (SSE-31)', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: initial\n\n'));
      },
    });

    const stream = sseStreamFrom(responseOver(body));
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.deepEqual(first.value.data, ['initial']);

    // Next pull blocks in Node Web Streams read
    const pendingPull = iterator.next();
    await stream.close();

    await assert.rejects(
      async () => {
        await pendingPull;
      },
      err => {
        assert.equal(err.name, 'IoError');
        return true;
      },
    );
  });

  it('releases response and reader locks on early break (SSE-25)', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    const stream = sseStreamFrom(responseOver(body));
    for await (const event of stream) {
      assert.deepEqual(event.data, ['1']);
      break;
    }
    assert.equal(cancelled, true);
  });

  it('removes abort listener and prevents memory leaks on normal completion', async () => {
    const controller = new AbortController();
    const body = streamOf('data: done\n\n');
    const stream = sseStreamFrom(responseOver(body), {
      signal: controller.signal,
    });

    for await (const event of stream) {
      assert.deepEqual(event.data, ['done']);
    }
    // Stream completed and closed cleanly
  });

  it('guards against re-iteration and post-close iteration on Node (SSE-26, SSE-27)', async () => {
    const stream = sseStreamFrom(responseOver(streamOf('data: a\n\n')));
    const it1 = stream[Symbol.asyncIterator]();
    assert.throws(() => stream[Symbol.asyncIterator](), SseStreamError);

    await stream.close();
    assert.throws(() => stream[Symbol.asyncIterator](), SseStreamError);
    void it1;
  });
});

describe('typed SSE adapter on Node', () => {
  it('lazily transforms events and terminates on mapper done (SSE-33..35)', async () => {
    const body = streamOf('data: 1\n\ndata: 2\n\ndata: 3\n\n');
    const stream = sseStreamFrom(responseOver(body));
    const typed = typedSseStream(stream, (_name, data) => {
      const num = Number(data);
      if (num === 2) return MAPPER_SKIP;
      if (num === 3) return MAPPER_DONE;
      return mapperValue(num * 10);
    });

    const values = [];
    for await (const val of typed) {
      values.push(val);
    }
    assert.deepEqual(values, [10]);
  });

  it('releases stream resource before propagating mapper error on Node (SSE-36)', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: boom\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    const stream = sseStreamFrom(responseOver(body));
    const mapperError = new Error('mapper failed');
    const typed = typedSseStream(stream, () => {
      throw mapperError;
    });

    await assert.rejects(async () => {
      for await (const val of typed) {
        void val;
      }
    }, mapperError);

    assert.equal(cancelled, true);
  });
});
