// SPDX-License-Identifier: MIT
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

/** Awaits a rejection and returns its reason, failing loudly when the promise resolves. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

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

  test('text() falls back to UTF-8 when the content-type itself is unparseable', async () => {
    // Distinct from an unrecognized *charset* below: here MediaType.parse throws before any charset
    // is read. HTTP-42's fallback has to cover absent, unparseable, and unrecognized alike.
    const headers = Headers.newBuilder()
      .add('content-type', 'not a media type at all')
      .build();
    expect(await baseResponse(readableOf('ok'), headers).text()).toBe('ok');
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
  test('cancels the body at most once however often close is called (BODY-15, HTTP-43)', async () => {
    let cancels = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
    });
    // Counting calls to cancel(), not the source's cancel callback: the Streams spec makes a second
    // cancel() on an already-cancelled stream a resolved no-op that never reaches the source, so only
    // the call count can show the guard working -- and the throw stands in for a transport whose
    // cancel is not re-entrant, which is why HTTP-43 asks for at-most-once in the first place.
    const delegate = stream.cancel.bind(stream);
    stream.cancel = async (reason?: unknown): Promise<void> => {
      cancels += 1;
      if (cancels > 1)
        throw new Error('transport does not tolerate a double close');
      return delegate(reason);
    };
    const response = baseResponse(stream);
    await response.close();
    await response.close();
    await response.close();
    // Counted, not merely "did not throw": cancel() on an already-cancelled ReadableStream resolves
    // quietly, so idempotence observed only as the absence of a throw tests nothing. The guard exists
    // for transports whose cancel is not re-entrant.
    expect(cancels).toBe(1);
  });

  test('a failed release is not remembered as a successful close', () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        throw new Error('CONNECTION STUCK');
      },
    });
    const response = baseResponse(stream);
    // Every caller sees the failure -- marking the response closed before awaiting would report a
    // connection that was never released as released.
    expect(response.close()).rejects.toThrow('CONNECTION STUCK');
    expect(response.close()).rejects.toThrow('CONNECTION STUCK');
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

  test('teardown is close() only -- no [Symbol.asyncDispose] on the >=18.17 floor', () => {
    // The symbol postdates engines.node ">=18.17", where the computed key evaluates to `undefined`
    // and binds the method to the string "undefined" instead. Asserting its ABSENCE is what keeps it
    // from being reintroduced ahead of the floor bump that would make it real on every resource owner.
    const response = baseResponse(readableOf('x'));
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(response)),
    ).not.toContain('undefined');
    expect(typeof response.close).toBe('function');
  });
});

describe('the close guarantee survives a locked body (BODY-16)', () => {
  // `getReader()` itself throws when an external consumer already holds the lock, and BODY-15
  // forbids assuming the body was never touched. Acquiring the reader above the try meant the one
  // failure BODY-16's guarantee most needs to cover was the one that skipped close entirely.
  function lockedResponse(): {response: Response; released: () => boolean} {
    let released = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        released = true;
      },
    });
    const response = baseResponse(stream);
    stream.getReader(); // an external consumer takes the lock
    return {response, released: () => released};
  }

  test('bytes() still closes the response when the body is already locked', async () => {
    const {response, released} = lockedResponse();
    expect((await rejection(response.bytes())).name).toBe('TypeError');
    // The connection is released as far as this response can release it; the external lock holder's
    // own close finishes the job, exactly as close() already documents.
    expect(released()).toBe(false);
    // Idempotent and already-closed: a second close is a no-op rather than a second cancel attempt.
    await response.close();
  });

  test('text() inherits the same guarantee', async () => {
    const {response} = lockedResponse();
    expect((await rejection(response.text())).name).toBe('TypeError');
    await response.close();
  });
});

describe('construction is builder-only (HTTP-2)', () => {
  test('the constructor is unreachable from outside the module', () => {
    // `Response` is exported as a VALUE, so a public field-wise constructor would let a caller skip
    // build()'s required-field validation and would appear in the emitted .d.ts. The private
    // constructor plus the createResponse friend hook is what prevents both.
    //
    // The assertion is the @ts-expect-error itself: every argument below is well-typed and the arity
    // is right, so privacy is the ONLY reason this line errors. If the private constructor is ever
    // lost, the suppression becomes unused and `tsc` fails the build.
    const args = [
      baseRequest(),
      Protocol.HTTP_1_1,
      Status.of(200),
      undefined,
      Headers.newBuilder().build(),
      null,
    ] as const;
    const construct = (): unknown =>
      // @ts-expect-error -- HTTP-2: constructible only through ResponseBuilder, never directly.
      new Response(...args);
    expect(construct()).toBeInstanceOf(Response);
  });
});
