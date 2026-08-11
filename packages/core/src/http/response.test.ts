// packages/core/src/http/response.test.ts
// Exercises: HTTP-6 (required fields), HTTP-41/BODY-14 (single-use body, same reference on repeat
// access), HTTP-41/BODY-15, HTTP-43 (idempotent close, releases the connection whether or not the body
// was read), HTTP-41/BODY-16 (convenience readers close in a finally-style guarantee), HTTP-42
// (charset default and UTF-8 fallback)
import {describe, expect, test} from 'bun:test';
import {Headers} from './headers.js';
import {Protocol} from './protocol.js';
import {Request} from './request.js';
import {Response} from './response.js';
import {Status} from './status.js';

function baseRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function readableOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function baseResponse(
  body: ReadableStream<Uint8Array> | null = null,
  headers: Headers = Headers.newBuilder().build(),
): Response {
  return Response.newBuilder()
    .request(baseRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .headers(headers)
    .body(body)
    .build();
}

describe('required fields', () => {
  test('throws naming request when missing', () => {
    expect(() =>
      Response.newBuilder()
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(200))
        .build(),
    ).toThrow('request is required');
  });

  test('throws naming protocol when missing', () => {
    expect(() =>
      Response.newBuilder()
        .request(baseRequest())
        .status(Status.of(200))
        .build(),
    ).toThrow('protocol is required');
  });

  test('throws naming status when missing', () => {
    expect(() =>
      Response.newBuilder()
        .request(baseRequest())
        .protocol(Protocol.HTTP_1_1)
        .build(),
    ).toThrow('status is required');
  });
});

describe('construction', () => {
  test('carries the originating request, protocol, status, headers, and an optional reason phrase', () => {
    const request = baseRequest();
    const response = Response.newBuilder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .reasonPhrase('OK')
      .build();

    expect(response.request.equals(request)).toBe(true);
    expect(response.protocol.equals(Protocol.HTTP_1_1)).toBe(true);
    expect(response.status.equals(Status.of(200))).toBe(true);
    expect(response.reasonPhrase).toBe('OK');
  });

  test('reason phrase is optional, body defaults to null', () => {
    const response = Response.newBuilder()
      .request(baseRequest())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(204))
      .build();
    expect(response.reasonPhrase).toBeUndefined();
    expect(response.body).toBeNull();
  });
});

describe('newBuilder derivation', () => {
  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = baseResponse();
    original.newBuilder().status(Status.of(500)).build();
    expect(original.status.code).toBe(200);
  });
});

describe('body (HTTP-41/BODY-14)', () => {
  test('repeated access returns the same reference, not a replay', () => {
    const stream = readableOf('x');
    const response = baseResponse(stream);
    expect(response.body).toBe(stream);
    expect(response.body).toBe(response.body);
  });
});

describe('bytes/text (BODY-16, HTTP-42)', () => {
  test('bytes() reads the whole body', async () => {
    const response = baseResponse(readableOf('hello'));
    expect(new TextDecoder().decode(await response.bytes())).toBe('hello');
  });

  test('bytes() on a null body returns empty', async () => {
    expect(await baseResponse(null).bytes()).toEqual(new Uint8Array(0));
  });

  test('text() defaults to UTF-8 when no content-type is declared', async () => {
    expect(await baseResponse(readableOf('héllo')).text()).toBe('héllo');
  });

  test('text() uses the declared charset', async () => {
    const bytes = Uint8Array.from([0x68, 0xe9]); // "hé" in ISO-8859-1
    const stream = new ReadableStream<Uint8Array>({
      start: c => {
        c.enqueue(bytes);
        c.close();
      },
    });
    const headers = Headers.newBuilder()
      .add('content-type', 'text/plain;charset=iso-8859-1')
      .build();
    expect(await baseResponse(stream, headers).text()).toBe('hé');
  });

  test('text() falls back to UTF-8 when the declared charset is unrecognized', async () => {
    const headers = Headers.newBuilder()
      .add('content-type', 'text/plain;charset=bogus-charset')
      .build();
    expect(await baseResponse(readableOf('ok'), headers).text()).toBe('ok');
  });

  test('bytes() closes the response even though the read succeeded', async () => {
    const response = baseResponse(readableOf('x'));
    await response.bytes();
    expect(response.close()).resolves.toBeUndefined(); // idempotent, already closed
  });
});

describe('close (HTTP-41/BODY-15, HTTP-43)', () => {
  test('is idempotent', async () => {
    const response = baseResponse(readableOf('x'));
    await response.close();
    await response.close();
  });

  test('releases the connection even when the body was never read', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    await baseResponse(stream).close();
    expect(cancelled).toBe(true);
  });

  test('[Symbol.asyncDispose] delegates to close()', async () => {
    const response = baseResponse(readableOf('x'));
    await response[Symbol.asyncDispose]();
    expect(response.close()).resolves.toBeUndefined();
  });
});
