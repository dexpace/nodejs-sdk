// SPDX-License-Identifier: MIT
// packages/transport-fetch/src/fetch-transport.test.ts
// Exercises: XCUT-13 (close is idempotent -- a repeat call is a latched no-op that neither throws nor
// blocks), XCUT-22 (the SDK closes only what it created; this transport creates no pooled resource, so
// its close owns nothing to release),
// TRANSPORT-2 (no retrying/redirecting dispatcher is ever composed), TRANSPORT-15/16
// (close is a documented no-op), TRANSPORT-17/19 (single-use body written once, abandoned producer
// unblocked), TRANSPORT-22 (an adaptation throw still closes the native response),
// TRANSPORT-20 with RETRY-2 (a permanent misconfiguration is classified outside the IoError tree,
// a failed exchange inside it), TRANSPORT-30
// (no proxy option exists at all), SEAM-30 (no producer is left running for its rejection to reach
// Node's default unhandledRejection policy)
import {describe, expect, test} from 'bun:test';
import {
  byteArrayBody,
  Headers,
  isIoError,
  Request,
  streamBody,
  TransportFailureError,
  type Body,
} from '@dexpace/core';
import {fetchTransport} from './fetch-transport.js';

/**
 * Awaits `pending` and hands back its rejection reason. `expect(p).rejects.…` is typed `void` here,
 * so this keeps the assertion ordered with whatever the row checks afterwards.
 */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

/** A `fetch` double recording the `RequestInit` it was handed, answering a fixed 200. */
type RecordedInit = RequestInit & {duplex?: 'half'};

function recordingFetch(): {
  fetch: (input: string, init: RecordedInit) => Promise<globalThis.Response>;
  calls: RecordedInit[];
} {
  const calls: RecordedInit[] = [];
  return {
    calls,
    fetch: (_input, init) => {
      calls.push(init);
      return Promise.resolve(new globalThis.Response('ok', {status: 200}));
    },
  };
}

describe('fetchTransport dispatch', () => {
  test('TRANSPORT-1/2: redirects are never followed by the native client', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const request = Request.newBuilder()
      .url('http://127.0.0.1:1/anything')
      .build();
    await (await transport.send(request)).close();
    expect(recorder.calls[0]?.redirect).toBe('manual');
  });

  test('TRANSPORT-11: the framing headers the client computes are dropped', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const request = Request.newBuilder()
      .url('http://127.0.0.1:1/anything')
      .headers(
        Headers.newBuilder()
          .set('Content-Length', '999')
          .set('Connection', 'keep-alive')
          .set('X-Kept', 'yes')
          .build(),
      )
      .build();
    await (await transport.send(request)).close();
    const sent = recorder.calls[0]?.headers as globalThis.Headers;
    expect(sent.get('content-length')).toBeNull();
    expect(sent.get('connection')).toBeNull();
    expect(sent.get('x-kept')).toBe('yes');
  });

  test('a small replayable body is materialized rather than streamed', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const request = Request.newBuilder()
      .method('POST')
      .url('http://127.0.0.1:1/anything')
      .body(
        byteArrayBody(new Uint8Array([1, 2, 3]), 'application/octet-stream'),
      )
      .build();
    await (await transport.send(request)).close();
    expect(recorder.calls[0]?.body).toBeInstanceOf(Uint8Array);
    expect(recorder.calls[0]?.duplex).toBeUndefined();
  });

  test('TRANSPORT-17: a single-use body is streamed with duplex declared', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([7]));
        controller.close();
      },
    });
    const request = Request.newBuilder()
      .method('POST')
      .url('http://127.0.0.1:1/anything')
      .body(streamBody(source))
      .build();
    await (await transport.send(request)).close();
    expect(recorder.calls[0]?.body).toBeInstanceOf(ReadableStream);
    expect(recorder.calls[0]?.duplex).toBe('half');
  });
});

describe('fetchTransport failure paths', () => {
  test('TRANSPORT-22: an adaptation throw cancels the native body before propagating', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    // A deliberately hostile Response: the only way to make adaptation fail, since every value a
    // conforming one carries is either total (Status.of) or degraded rather than rejected.
    const hostile = {
      status: 200,
      statusText: 'OK',
      body,
      headers: {
        forEach: () => {
          throw new Error('adaptation exploded');
        },
        getSetCookie: () => [],
      },
    } as unknown as globalThis.Response;

    const transport = fetchTransport({fetch: () => Promise.resolve(hostile)});
    const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
    expect(await rejection(transport.send(request))).toMatchObject({
      message: 'adaptation exploded',
    });
    expect(cancelled).toBe(true);
  });

  test('TRANSPORT-19/20: a producer failure fails the send and unwinds the producer', async () => {
    const failing: Body = {
      kind: 'stream',
      mediaType: undefined,
      contentLength: -1,
      replayable: false,
      writeTo() {
        return Promise.reject(new Error('producer exploded'));
      },
    };
    // A fetch that never settles, so the only way this send can finish is the producer's failure
    // winning the race -- the regression this guards is sequencing the two instead of racing them.
    const transport = fetchTransport({
      fetch: () => new Promise<globalThis.Response>(() => undefined),
    });
    const request = Request.newBuilder()
      .method('POST')
      .url('http://127.0.0.1:1/x')
      .body(failing)
      .build();
    expect(await rejection(transport.send(request))).toMatchObject({
      name: 'TransportFailureError',
    });
  });
});

describe('fetchTransport request-body failures', () => {
  test('a buffered body that cannot be written fails the send the same way', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const request = Request.newBuilder()
      .method('POST')
      .url('http://127.0.0.1:1/x')
      .body({
        kind: 'byte-array',
        mediaType: 'text/plain',
        contentLength: 3,
        replayable: true,
        writeTo: () => Promise.reject(new Error('body exploded')),
      })
      .build();
    // The materialized branch classifies a body failure exactly as the streaming branch does.
    expect(await rejection(transport.send(request))).toMatchObject({
      name: 'TransportFailureError',
      cause: {message: 'body exploded'},
    });
    expect(recorder.calls.length).toBe(0);
  });

  test('a header-mapping throw never strands a started body producer (TRANSPORT-19, SEAM-30)', async () => {
    // This transport builds its DispatchPlan as one object literal, so the safety here rests on
    // property EVALUATION ORDER: `headers` must be computed before `prepared`. `prepareBody` starts
    // a streaming producer eagerly and `toNativeHeaders` reads `request.body.mediaType`, a
    // caller-supplied getter that may throw -- reversing the two would leave a live producer nobody
    // can abandon, whose later rejection reaches Node's default unhandledRejection policy. The
    // undici twin had exactly that ordering bug; this row keeps it from appearing here.
    let producerStarted = false;
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const request = Request.newBuilder()
      .method('POST')
      .url('http://127.0.0.1:1/x')
      .body({
        kind: 'stream',
        get mediaType(): string | undefined {
          throw new Error('mediaType getter exploded');
        },
        // -1 / non-replayable forces the streaming branch rather than the buffered one.
        contentLength: -1,
        replayable: false,
        writeTo: () => {
          producerStarted = true;
          return Promise.resolve();
        },
      })
      .build();

    await rejection(transport.send(request));
    expect(producerStarted).toBe(false);
    expect(recorder.calls.length).toBe(0);
  });

  test('a network failure is wrapped as TransportFailureError with its cause kept', async () => {
    const cause = new Error('connect ECONNREFUSED');
    const transport = fetchTransport({fetch: () => Promise.reject(cause)});
    const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
    expect(await rejection(transport.send(request))).toMatchObject({
      name: 'TransportFailureError',
      cause,
    });
  });
});

describe('fetchTransport failure classification (TRANSPORT-20, RETRY-2)', () => {
  /** Every shape a runtime's `fetch` uses to say "these arguments can never work". */
  const permanent: readonly (readonly [string, Error])[] = [
    // Node's undici-backed `fetch`, thrown out of the `Request` constructor: no cause, because no
    // dispatch was ever attempted.
    [
      'a forbidden method',
      new TypeError("'CONNECT' HTTP method is unsupported."),
    ],
    [
      'a non-token method',
      new TypeError("'BAD METHOD' is not a valid HTTP method."),
    ],
    // The same runtime's scheme refusal, which it can only report as a network error.
    [
      'an unsupported scheme',
      new TypeError('fetch failed', {cause: new Error('unknown scheme')}),
    ],
    // Bun 1.3.14's shape for the same scheme refusal: a code, and no cause at all.
    [
      "Bun's coded scheme refusal",
      Object.assign(new TypeError('protocol must be http:, https: or s3:'), {
        code: 'ERR_INVALID_ARG_VALUE',
      }),
    ],
  ];

  for (const [what, cause] of permanent) {
    test(`${what} is terminal, outside the IoError tree`, async () => {
      // A permanent misconfiguration classified as TransportFailureError is an IoError, and
      // `classify.ts` returns true for every IoError -- so the caller's whole retry budget goes on
      // re-proving it. The undici twin has refused its own equivalents since Phase 8a; this
      // transport refused none of them until audit #67 / #82.
      const transport = fetchTransport({fetch: () => Promise.reject(cause)});
      const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
      const error = await rejection(transport.send(request));
      expect(error).toBeInstanceOf(TypeError);
      expect(isIoError(error)).toBe(false);
      expect((error as Error).cause).toBe(cause);
    });
  }

  test('a network failure reported the same way stays retryable', async () => {
    // The twin of the rows above: `fetch failed` is also how every genuine connect/DNS/TLS failure
    // arrives, so the cause is the only discriminator and narrowing must not swallow this.
    const cause = new TypeError('fetch failed', {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND h.invalid'), {
        code: 'ENOTFOUND',
      }),
    });
    const transport = fetchTransport({fetch: () => Promise.reject(cause)});
    const request = Request.newBuilder().url('http://h.invalid/x').build();
    const error = await rejection(transport.send(request));
    expect(error).toBeInstanceOf(TransportFailureError);
    expect(isIoError(error)).toBe(true);
  });
});

describe('fetchTransport lifecycle', () => {
  test('TRANSPORT-15/16: close is a no-op and send still works afterwards (SEAM-15)', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    await transport.close();
    // Reaching the next line proves the second close neither threw nor hung (TRANSPORT-16).
    await transport.close();
    const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
    await (await transport.send(request)).close();
    expect(recorder.calls.length).toBe(1);
  });

  test('asyncDispose is the same teardown as close, where the runtime has it', async () => {
    const transport = fetchTransport();
    // Cast rather than a bare `Symbol.asyncDispose` index: on the pinned floor (Node 20.3, which
    // predates the symbol's 20.4 arrival) it is `undefined` and the index would read the string key
    // `"undefined"`. The install in fetch-transport.ts is guarded to match.
    const asyncDispose = (Symbol as {asyncDispose?: symbol}).asyncDispose;
    if (typeof asyncDispose === 'symbol') {
      const dispose = (
        transport as unknown as Record<
          symbol,
          (() => Promise<void>) | undefined
        >
      )[asyncDispose];
      expect(dispose).toBeDefined();
      await dispose?.call(transport);
    }
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(transport)),
    ).not.toContain('undefined');
    await transport.close();
  });

  test('an aborted signal fails the send before any fetch call is made', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({fetch: recorder.fetch});
    const controller = new AbortController();
    controller.abort();
    const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
    expect(
      await rejection(transport.send(request, undefined, controller.signal)),
    ).toMatchObject({name: 'CancellationError'});
    expect(recorder.calls.length).toBe(0);
  });

  test('defaultTimeoutMs applies when the call supplies no timeout of its own', async () => {
    const recorder = recordingFetch();
    const transport = fetchTransport({
      fetch: recorder.fetch,
      defaultTimeoutMs: 5_000,
    });
    const request = Request.newBuilder().url('http://127.0.0.1:1/x').build();
    await (await transport.send(request)).close();
    expect(recorder.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});
