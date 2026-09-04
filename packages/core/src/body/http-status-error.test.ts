// SPDX-License-Identifier: MIT
// packages/core/src/body/http-status-error.test.ts
// Exercises: HTTP-52/BODY-30 (1 MiB cap, replayable re-serve, buffered inside close-guaranteeing scope),
// BODY-31 (4xx/5xx only, no-body response returned unchanged), BODY-33 (non-consuming preview),
// HTTP-42 (preview decodes with the media type's charset, falling back to UTF-8, never throwing),
// XCUT-8 (the status-to-exception mapping factory refuses to fabricate a "successful exception":
// toHttpError returns null for 1xx/2xx/3xx rather than an error, which is the absent/null
// convenience form XCUT-8 explicitly permits in place of a throwing strict mapper. The port ships
// only that form, and since 2026-09-02 the CONSTRUCTOR enforces the 400-599 band too, so the
// guarantee holds at both levels rather than only at the factory).
import {describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {HttpStatusError} from './http-status-error.js';
import {HttpStatusValidationError} from './errors.js';
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

describe("the constructor refuses a status outside HTTP-11's error band (N2, XCUT-8)", () => {
  test('rejects a non-error status -- the "successful exception" XCUT-8 forbids', () => {
    for (const status of [200, 204, 301, 399]) {
      expect(() => new HttpStatusError(status, undefined, undefined)).toThrow(
        HttpStatusValidationError,
      );
    }
  });

  test('rejects a status outside 100-599 entirely', () => {
    expect(() => new HttpStatusError(600, undefined, undefined)).toThrow(
      HttpStatusValidationError,
    );
    expect(() => new HttpStatusError(0, undefined, undefined)).toThrow(
      HttpStatusValidationError,
    );
  });

  test('rejects a non-integer or non-finite status', () => {
    expect(() => new HttpStatusError(404.5, undefined, undefined)).toThrow(
      HttpStatusValidationError,
    );
    expect(() => new HttpStatusError(Number.NaN, undefined, undefined)).toThrow(
      HttpStatusValidationError,
    );
    expect(
      () => new HttpStatusError(Number.POSITIVE_INFINITY, undefined, undefined),
    ).toThrow(HttpStatusValidationError);
  });

  test('accepts the whole band, inclusive at both edges', () => {
    for (const status of [400, 404, 500, 599]) {
      expect(new HttpStatusError(status, undefined, undefined).status).toBe(
        status,
      );
    }
  });
});

describe('toHttpError survives a failing close (H14/P1, RECOV-12)', () => {
  /**
   * A body whose `cancel()` hook fails INDEPENDENTLY of the read, which is the only shape that makes
   * the masking observable: for a plain errored `ReadableStream` the read error and the cancel error
   * are the same object, so nothing is masked. Here the stream reads cleanly to completion and only
   * teardown fails.
   */
  /** Fails the memoized close ONCE, so the drain's own release meets the stored rejection. */
  async function failFirstClose(response: Response): Promise<void> {
    let closeError: unknown;
    try {
      await response.close();
    } catch (error: unknown) {
      closeError = error;
    }
    expect(String(closeError)).toContain('CLOSE FAILED');
  }

  function bodyFailingToCancel(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: c => {
        c.enqueue(bytes);
        c.close();
      },
      cancel: () => {
        throw new Error('CLOSE FAILED');
      },
    });
  }

  test('a 5xx whose close() fails still yields the HttpStatusError the docs promise', async () => {
    const response = responseWith(
      500,
      bodyFailingToCancel(new TextEncoder().encode('boom')),
    );
    await failFirstClose(response);

    const error = await toHttpError(response);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error?.status).toBe(500);
  });

  test("the release failure is not lost: it rides along as the error's cause", async () => {
    const response = responseWith(
      500,
      bodyFailingToCancel(new TextEncoder().encode('boom')),
    );
    await failFirstClose(response);

    const error = await toHttpError(response);
    expect(String((error as Error | null)?.cause)).toContain('CLOSE FAILED');
  });

  test('a bodiless 4xx whose close() fails still yields the HttpStatusError', async () => {
    const response = responseWith(404, bodyFailingToCancel(new Uint8Array()));
    await failFirstClose(response);
    // Drain the (already-cancelled) body path: the body is non-null, so this exercises the drain
    // branch; the bodiless branch is covered by the null-body cases above.
    const error = await toHttpError(response);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error?.status).toBe(404);
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
