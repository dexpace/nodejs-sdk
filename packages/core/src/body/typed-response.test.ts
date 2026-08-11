// SPDX-License-Identifier: MIT
// packages/core/src/body/typed-response.test.ts
// Exercises: HTTP-44 (raw fields without touching the body, parse-once memoized including failure),
// HTTP-45 (concurrent first callers serialized to one parse run)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {TypedResponse} from './typed-response.js';

function readableOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
}

function baseResponse(
  body: ReadableStream<Uint8Array> | null = null,
): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .reasonPhrase('OK')
    .body(body)
    .build();
}

describe('TypedResponse', () => {
  test('exposes raw fields without touching the body (HTTP-44)', () => {
    const response = baseResponse(readableOf('untouched'));
    const typed = new TypedResponse(response, r => r.text());
    expect(typed.status.code).toBe(200);
    expect(typed.headers).toBe(response.headers);
    expect(typed.protocol).toBe('http/1.1');
    expect(typed.reason).toBe('OK');
    expect(typed.request).toBe(response.request);
    expect(response.body?.locked).toBe(false);
  });

  test('parses on first value() call and memoizes the result', async () => {
    let calls = 0;
    const typed = new TypedResponse(baseResponse(readableOf('x')), () => {
      calls += 1;
      return Promise.resolve('parsed');
    });
    expect(await typed.value()).toBe('parsed');
    expect(await typed.value()).toBe('parsed');
    expect(calls).toBe(1);
  });

  test('memoizes a thrown failure -- every later call re-throws the same error, parse never re-runs', () => {
    let calls = 0;
    const failure = new Error('parse failed');
    const typed = new TypedResponse(baseResponse(readableOf('x')), () => {
      calls += 1;
      return Promise.reject(failure);
    });
    expect(typed.value()).rejects.toBe(failure);
    expect(typed.value()).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  test('concurrent first callers share one in-flight parse (HTTP-45)', async () => {
    let calls = 0;
    const typed = new TypedResponse(baseResponse(readableOf('x')), async () => {
      calls += 1;
      await Promise.resolve();
      return 'value';
    });
    const [a, b] = await Promise.all([typed.value(), typed.value()]);
    expect(a).toBe('value');
    expect(b).toBe('value');
    expect(calls).toBe(1);
  });
});
