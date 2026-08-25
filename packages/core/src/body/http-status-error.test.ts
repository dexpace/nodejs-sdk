// SPDX-License-Identifier: MIT
// packages/core/src/body/http-status-error.test.ts
// Exercises: HTTP-52/BODY-30 (1 MiB cap, replayable re-serve, buffered inside close-guaranteeing scope),
// BODY-31 (4xx/5xx only, no-body response returned unchanged), BODY-33 (non-consuming preview),
// HTTP-42 (preview decodes with the media type's charset, falling back to UTF-8, never throwing)
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

function contentType(value: string): Headers {
  return Headers.newBuilder().add('content-type', value).build();
}

describe('preview charset resolution (HTTP-42, BODY-33)', () => {
  const cafeLatin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1

  test('decodes with the charset declared by the response media type', async () => {
    const error = await toHttpError(
      responseWith(
        500,
        readableOf(cafeLatin1),
        contentType('text/plain; charset=iso-8859-1'),
      ),
    );
    expect(error?.preview()).toBe('café');
  });

  test('an explicit charset argument still wins', async () => {
    const error = await toHttpError(
      responseWith(500, readableOf(cafeLatin1), contentType('text/plain')),
    );
    expect(error?.preview('iso-8859-1')).toBe('café');
  });

  test('an unknown charset falls back to UTF-8 instead of raising a RangeError', async () => {
    const error = await toHttpError(
      responseWith(
        500,
        readableOf(new TextEncoder().encode('ok')),
        contentType('text/plain; charset=bogus-charset'),
      ),
    );
    expect(error?.preview()).toBe('ok');
    expect(error?.preview('also-bogus')).toBe('ok');
  });

  test('defaults to UTF-8 when no media type was sent', async () => {
    const error = await toHttpError(
      responseWith(500, readableOf(new TextEncoder().encode('héllo'))),
    );
    expect(error?.preview()).toBe('héllo');
  });

  test('body() drops an inbound media type that is not outbound-safe (HTTP-18/HTTP-19)', async () => {
    // HTTP-19 admits obs-text (>= 0x80) inbound; HTTP-18 forbids it outbound. Re-serving a received
    // content-type on an outbound Body must drop it, never raise from an accessor on an error object.
    const headers = Headers.newBuilder()
      .addInbound('content-type', 'text/plain; note="\u00e9"')
      .build();
    const error = await toHttpError(
      responseWith(500, readableOf(Uint8Array.from([1])), headers),
    );
    expect(error?.body()?.mediaType).toBeUndefined();
    expect(error?.preview()).toBe('\u0001'); // still previews, charset resolution falls back
  });
});
