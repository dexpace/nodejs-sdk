// SPDX-License-Identifier: MIT
// packages/core/src/body/http-status-error.test.ts
// Exercises: HTTP-52/BODY-30 (1 MiB cap, replayable re-serve, buffered inside close-guaranteeing scope),
// BODY-31 (4xx/5xx only, no-body response returned unchanged), BODY-33 (non-consuming preview)
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {toHttpError} from './http-status-error.js';

function readableOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: c => {
      c.enqueue(bytes);
      c.close();
    },
  });
}

function responseWith(
  status: number,
  body: ReadableStream<Uint8Array> | null,
  headers: Headers = Headers.newBuilder().build(),
): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(headers)
    .body(body)
    .build();
}

describe('toHttpError (BODY-31)', () => {
  test('returns null for a non-error response', async () => {
    expect(await toHttpError(responseWith(200, null))).toBeNull();
    expect(await toHttpError(responseWith(304, null))).toBeNull();
  });

  test('returns an HttpStatusError for 4xx and 5xx', async () => {
    expect(await toHttpError(responseWith(404, null))).not.toBeNull();
    expect(await toHttpError(responseWith(500, null))).not.toBeNull();
  });
});

describe('HttpStatusError (HTTP-52/BODY-30)', () => {
  test('carries the status', async () => {
    expect((await toHttpError(responseWith(404, null)))?.status).toBe(404);
  });

  test('buffers the body and re-serves it as a replayable, independently readable Body', async () => {
    const bytes = new TextEncoder().encode('not found');
    const error = await toHttpError(responseWith(404, readableOf(bytes)));
    const body = error?.body();
    expect(body?.replayable).toBe(true);

    const chunks: Uint8Array[] = [];
    await body?.writeTo(new WritableStream({write: c => void chunks.push(c)}));
    expect(new TextDecoder().decode(chunks[0])).toBe('not found');

    const chunksAgain: Uint8Array[] = [];
    await error
      ?.body()
      ?.writeTo(new WritableStream({write: c => void chunksAgain.push(c)}));
    expect(new TextDecoder().decode(chunksAgain[0])).toBe('not found');
  });

  test('drops bytes beyond the 1 MiB cap but still drains and closes the connection', async () => {
    const big = new Uint8Array(2 * 1024 * 1024).fill(65);
    const error = await toHttpError(responseWith(500, readableOf(big)));
    expect(error?.body()?.contentLength).toBe(1024 * 1024);
  });

  test('when the response has no body, the error carries an undefined body and null preview (BODY-31)', async () => {
    const error = await toHttpError(responseWith(500, null));
    expect(error?.body()).toBeUndefined();
    expect(error?.preview()).toBeNull();
  });

  test('preview is non-consuming and repeatable (BODY-33)', async () => {
    const error = await toHttpError(
      responseWith(500, readableOf(new TextEncoder().encode('boom'))),
    );
    expect(error?.preview()).toBe('boom');
    expect(error?.preview()).toBe('boom');
  });
});
