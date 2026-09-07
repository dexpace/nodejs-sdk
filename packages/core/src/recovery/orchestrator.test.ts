// SPDX-License-Identifier: MIT
// packages/core/src/recovery/orchestrator.test.ts
// Exercises: RECOV-2 (one try/catch wraps the request chain AND the transport invocation; no
// throwable from either bypasses the recovery hooks), RECOV-10 (unwrap: a Success returns the
// response, a Failure rethrows the throwable unchanged, no wrapping or substitution), RECOV-11 (the
// catch routes every throwable through wrapCancellation, so the helper sits on the real dispatch
// path rather than being an unwired primitive)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {CancellationError, type Transport} from '../seams/transport.js';
import {dispatchWithRecovery} from './orchestrator.js';
import {success} from './outcome.js';
import {RequestRecoveryChain, type RequestStep} from './request-chain.js';
import {
  ResponseRecoveryChain,
  type RecoveryStep,
  type ResponseStep,
} from './response-chain.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function aResponse(
  request: Request,
  body: ReadableStream<Uint8Array> | null = null,
): Response {
  return Response.newBuilder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

/** Close is observed through the body stream's `cancel()` — `Response` is frozen. */
function countingCloseBody(): {
  body: ReadableStream<Uint8Array>;
  closeCount: () => number;
} {
  let cancels = 0;
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        cancels += 1;
      },
    }),
    closeCount: () => cancels,
  };
}

/** Awaits `promise`, returning whatever it rejected with — `undefined` when it resolved. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

type SendImpl = (
  request: Request,
  options?: RequestOptions,
  signal?: AbortSignal,
) => Promise<Response>;

/** A minimal, file-local Transport stub — no shared FakeTransport exists yet. */
class StubTransport implements Transport {
  readonly #impl: SendImpl;

  constructor(impl: SendImpl) {
    this.#impl = impl;
  }

  send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    return this.#impl(request, options, signal);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function emptyChains(): {
  requestChain: RequestRecoveryChain;
  responseChain: ResponseRecoveryChain;
} {
  return {
    requestChain: new RequestRecoveryChain([]),
    responseChain: new ResponseRecoveryChain([], []),
  };
}

describe('dispatchWithRecovery happy path', () => {
  test('returns the transport response when everything succeeds', async () => {
    const request = aRequest();
    const response = aResponse(request);
    const transport = new StubTransport(() => Promise.resolve(response));

    const result = await dispatchWithRecovery(request, {
      transport,
      ...emptyChains(),
    });

    expect(result).toBe(response);
  });

  test('sends the request the request chain produced, not the one the caller handed in', async () => {
    const tagStep: RequestStep = request =>
      Promise.resolve(
        request
          .newBuilder()
          .headers(
            request.headers.newBuilder().set('X-Trace', 'tagged').build(),
          )
          .build(),
      );
    let sent: Request | undefined;
    const transport = new StubTransport(request => {
      sent = request;
      return Promise.resolve(aResponse(request));
    });

    await dispatchWithRecovery(aRequest(), {
      transport,
      requestChain: new RequestRecoveryChain([tagStep]),
      responseChain: new ResponseRecoveryChain([], []),
    });

    expect(sent?.headers.get('X-Trace')).toBe('tagged');
  });

  test('threads per-call options and signal through to the transport unchanged', async () => {
    const request = aRequest();
    const options = RequestOptions.EMPTY;
    const controller = new AbortController();
    let receivedOptions: RequestOptions | undefined;
    let receivedSignal: AbortSignal | undefined;
    const transport = new StubTransport((req, opts, signal) => {
      receivedOptions = opts;
      receivedSignal = signal;
      return Promise.resolve(aResponse(req));
    });

    await dispatchWithRecovery(request, {
      transport,
      ...emptyChains(),
      options,
      signal: controller.signal,
    });

    expect(receivedOptions).toBe(options);
    expect(receivedSignal).toBe(controller.signal);
  });
});

describe('RECOV-2: every throwable from the request chain or the transport is caught', () => {
  test('a throwing request step surfaces as a Failure to a recovery hook, not an unhandled throw', async () => {
    const thrownError = new Error('request step failed');
    const failingStep: RequestStep = () => {
      throw thrownError;
    };
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = outcome => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return Promise.resolve(outcome);
    };
    const transport = new StubTransport(() => {
      throw new Error('must not run — the request chain already failed');
    });

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([failingStep]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    );

    expect(error).toBe(thrownError);
    expect(seenByRecovery).toEqual([thrownError]);
  });

  test('a throwing transport surfaces as a Failure to a recovery hook, not an unhandled throw', async () => {
    const thrownError = new Error('transport failed');
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = outcome => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return Promise.resolve(outcome);
    };
    const transport = new StubTransport(() => {
      throw thrownError;
    });

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    );

    expect(error).toBe(thrownError);
    expect(seenByRecovery).toEqual([thrownError]);
  });

  test('a recovery step can turn a transport failure back into a Success', async () => {
    const request = aRequest();
    const fallback = aResponse(request);
    const recoverStep: RecoveryStep = outcome =>
      Promise.resolve(outcome.kind === 'failure' ? success(fallback) : outcome);
    const transport = new StubTransport(() => {
      throw new Error('transport failed');
    });

    const result = await dispatchWithRecovery(request, {
      transport,
      requestChain: new RequestRecoveryChain([]),
      responseChain: new ResponseRecoveryChain([], [recoverStep]),
    });

    expect(result).toBe(fallback);
  });
});

describe('RECOV-10: the final unwrap is unchanged, no wrapping or substitution', () => {
  test('a response step throwing a typed error surfaces exactly that error, by identity', async () => {
    class MyTypedError extends Error {}
    const typedError = new MyTypedError('mapped');
    const mapToTypedError: ResponseStep = () => {
      throw typedError;
    };
    const transport = new StubTransport(request =>
      Promise.resolve(aResponse(request)),
    );

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([mapToTypedError], []),
      }),
    );

    expect(error).toBe(typedError);
  });

  test('a non-Error throwable is rethrown as-is, not coerced into an Error', async () => {
    const transport = new StubTransport(() => {
      // The point of the case: a JS throw can legally raise any value, and RECOV-10 requires the
      // orchestrator to rethrow it by identity rather than coercing it into an Error. Re-enable if
      // the transport seam ever narrows what an implementation may reject with.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- see the comment above
      throw 'a string throw';
    });

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {transport, ...emptyChains()}),
    );

    expect(error).toBe('a string throw');
  });
});

describe('RECOV-11: the catch routes every throwable through wrapCancellation', () => {
  test('a transport CancellationError paired with an aborted signal surfaces unchanged', async () => {
    const controller = new AbortController();
    const cancellation = new CancellationError('aborted by caller');
    const transport = new StubTransport(() => {
      controller.abort();
      throw cancellation;
    });

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], []),
        signal: controller.signal,
      }),
    );

    expect(error).toBe(cancellation);
  });

  test('a CancellationError raised with no caller signal still reaches the recovery chain (RECOV-2)', async () => {
    // A transport may abort its own in-flight requests for reasons the caller never signalled —
    // SEAM-14 permits close() to cancel them. That must surface as an ordinary Failure through the
    // recovery hooks, not as a side exit: RECOV-2 admits no throwable from the transport bypassing
    // them.
    const cancellation = new CancellationError(
      'aborted by the transport itself',
    );
    const seenByRecovery: unknown[] = [];
    const recoveryStep: RecoveryStep = outcome => {
      if (outcome.kind === 'failure') seenByRecovery.push(outcome.error);
      return Promise.resolve(outcome);
    };
    const transport = new StubTransport(() => {
      throw cancellation;
    });

    const error = await rejection(
      dispatchWithRecovery(aRequest(), {
        transport,
        requestChain: new RequestRecoveryChain([]),
        responseChain: new ResponseRecoveryChain([], [recoveryStep]),
      }),
    );

    expect(error).toBe(cancellation);
    expect(seenByRecovery).toEqual([cancellation]);
  });
});

describe('negative space: the orchestrator releases nothing of its own', () => {
  test('the response it hands back is left open for the caller to close', async () => {
    // RECOV-10 returns the contained response; ownership passes to the caller. A future
    // "helpful" close here would hand back a response whose body is already cancelled.
    const request = aRequest();
    const {body, closeCount} = countingCloseBody();
    const transport = new StubTransport(() =>
      Promise.resolve(aResponse(request, body)),
    );

    const result = await dispatchWithRecovery(request, {
      transport,
      ...emptyChains(),
    });

    expect(closeCount()).toBe(0);
    expect(result.body).not.toBeNull();
  });

  test('it never closes the transport it was handed', async () => {
    // SEAM-14/PIPE-27's discipline, asserted early: the orchestrator borrows the transport, it
    // does not own it.
    let closeCalls = 0;
    const request = aRequest();
    const transport = new StubTransport(() =>
      Promise.resolve(aResponse(request)),
    );
    const countingTransport: Transport = {
      send: (...args) => transport.send(...args),
      close: () => {
        closeCalls += 1;
        return Promise.resolve();
      },
    };

    await dispatchWithRecovery(request, {
      transport: countingTransport,
      ...emptyChains(),
    });

    expect(closeCalls).toBe(0);
  });
});
