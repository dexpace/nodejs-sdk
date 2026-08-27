// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/runtime.test.ts
// Exercises: PIPE-9 (an empty pipeline dispatches directly, no cursor/context allocated), PIPE-10 (each
// send() allocates its own per-call state, interleaved calls share none of it, and the built step view is
// frozen and copied), PIPE-11 (per-call mutable state lives on the cursor, never on the runtime), PIPE-14
// (a substituted request reaches the wire, and is what the exchange context is built from), PIPE-25
// (get steps() exposes the flattened, immutable array), PIPE-26 (Runtime itself satisfies the Transport SPI
// with one send() method, and nests inside another pipeline with the caller's options intact), PIPE-27
// (close() never touches the wrapped transport), CTX-17's positive half (the first store entry is installed
// by the first promotion), CTX-1/2/3/6 (exchangeSource pins the call key and instrumentation when it
// rebuilds)
import {describe, expect, test} from 'bun:test';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {contextStore} from '../context/store.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {createRuntime, exchangeSource} from './runtime.js';
import type {Step, StepDescriptor} from './step.js';

function aRequest(url: string): Request {
  return Request.newBuilder().url(url).build();
}

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(aRequest('https://example.com'))
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

class RecordingTransport implements Transport {
  readonly calls: {
    request: Request;
    options: RequestOptions | undefined;
    signal: AbortSignal | undefined;
  }[] = [];
  closeCalls = 0;
  #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    this.calls.push({request, options, signal});
    return Promise.resolve(this.#response);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

// No `afterEach(() => contextStore.clear())`: the singleton is shared by every test file in the run, so a
// blanket clear wipes entries a sibling installed (4a's plan forbids it by name; testing.md:50,52). Nothing
// here needs one -- `Runtime.send()` evicts its own entry in a `finally`, on the success and the throw path.

describe('Runtime.send empty pipeline (PIPE-9)', () => {
  test('dispatches directly to the terminal transport, threading options and signal, no context installed', async () => {
    const canned = aResponse(200);
    const transport = new RecordingTransport(canned);
    const runtime = createRuntime([], transport);
    const request = aRequest('https://example.com/a');
    const signal = new AbortController().signal;
    const sizeBefore = contextStore.size;

    const response = await runtime.send(request, undefined, signal);

    expect(response).toBe(canned);
    expect(transport.calls).toEqual([{request, options: undefined, signal}]);
    // A delta, not an absolute size: `contextStore` is process-wide, so a sibling test file sharing the
    // process must not be able to turn this assertion red (styleguide 11.7 -- tests survive any order).
    expect(contextStore.size).toBe(sizeBefore);
  });
});

describe('Runtime.send context-store wiring (CTX-17, CTX-8)', () => {
  test('installs a RequestContext before dispatch, then evicts it after the call resolves', async () => {
    let observed: ExecutionContext | undefined;
    const step: Step = async (_request, ctx) => {
      observed = contextStore.get(ctx.context.key);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: step,
    };
    const runtime = createRuntime(
      [descriptor],
      new RecordingTransport(aResponse(200)),
    );

    const response = await runtime.send(aRequest('https://example.com'));

    invariant(
      observed !== undefined,
      'the step must have observed an installed context',
    );
    expect(observed.kind).toBe('request');
    expect(contextStore.get(observed.key)).toBeUndefined(); // evicted in send()'s finally
    expect(response.status.code).toBe(200);
  });

  test('evicts the installed context even when a step throws', async () => {
    let observedKey: symbol | undefined;

    // eslint-disable-next-line @typescript-eslint/require-await -- throwing before any await IS the case under test: PIPE-29/30 hold structurally because an `async` step body that throws synchronously still surfaces as a rejected promise. `Promise.reject` would exercise something else. Revisit if a step ever throws through a real await.
    const step: Step = async (_request, ctx) => {
      observedKey = ctx.context.key;
      throw new Error('boom');
    };
    const descriptor: StepDescriptor = {
      type: Symbol('throws'),
      stage: 'PRE_LOGGING',
      fn: step,
    };
    const runtime = createRuntime(
      [descriptor],
      new RecordingTransport(aResponse(200)),
    );

    const rejection: unknown = await runtime
      .send(aRequest('https://example.com'))
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe('boom');
    invariant(
      observedKey !== undefined,
      'the step must have run and captured its call key',
    );
    expect(contextStore.get(observedKey)).toBeUndefined();
  });
});

describe('exchangeSource (PIPE-14, CTX-1, CTX-2, CTX-3, CTX-6)', () => {
  // Tested directly rather than by spying on `contextStore.install`: the exchange context is evicted in
  // `send()`'s own `finally`, so observing it end-to-end would mean patching a method on the process-wide
  // singleton -- a mock of an owned interface (styleguide 11.3) that also leaks across test files sharing
  // the process if a run is ever parallelised. `exchangeSource` is a pure function; the end-to-end half that
  // remains observable (the substituted request is what actually reached the wire) is asserted below.
  test('returns the SAME context object when no step substituted the request', () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request, {operationName: 'GetWidget'});

    expect(exchangeSource(context, request)).toBe(context);
  });

  test('rebuilds around the substituted request, pinning the same key and instrumentation', () => {
    const original = aRequest('https://example.com/original');
    const substituted = aRequest('https://example.com/substituted');
    const context = createRequestContext(original, {
      operationName: 'GetWidget',
    });

    const rebuilt = exchangeSource(context, substituted);

    expect(rebuilt.request).toBe(substituted);
    expect(rebuilt.key).toBe(context.key); // CTX-3: one call key for the whole chain
    expect(rebuilt.instrumentation).toBe(context.instrumentation); // CTX-2: carried forward by reference
    expect(rebuilt.operationName).toBe('GetWidget');
  });
});

describe('Runtime.send request substitution reaches the wire (PIPE-14)', () => {
  test('the transport receives the substituted request, not the original', async () => {
    const original = aRequest('https://example.com/original');
    const substituted = aRequest('https://example.com/substituted');
    const substituteStep: Step = async (_request, ctx) => ctx.next(substituted);
    const descriptor: StepDescriptor = {
      type: Symbol('substitute'),
      stage: 'PRE_LOGGING',
      fn: substituteStep,
    };
    const transport = new RecordingTransport(aResponse(200));

    await createRuntime([descriptor], transport).send(original);

    expect(transport.calls[0]?.request).toBe(substituted);
  });
});

describe('Runtime concurrency (PIPE-10, PIPE-11)', () => {
  test("two interleaved sends never observe each other's in-flight request", async () => {
    const transport = new RecordingTransport(aResponse(200));
    const rewrite: Step = async (request, ctx) => {
      await Promise.resolve(); // hand the event loop over, so both drives are mid-flight at once
      return ctx.next(aRequest(`${request.url.href}rewritten`));
    };
    const descriptor: StepDescriptor = {
      type: Symbol('rewrite'),
      stage: 'PRE_LOGGING',
      fn: rewrite,
    };
    const runtime = createRuntime([descriptor], transport);

    await Promise.all([
      runtime.send(aRequest('https://example.com/a/')),
      runtime.send(aRequest('https://example.com/b/')),
    ]);

    // PIPE-11: per-call mutable state lives on the per-call cursor, so one call's substituted request
    // (PIPE-14 makes it stick for the rest of *that* call) cannot leak into the other's dispatch.
    expect(transport.calls.map(call => call.request.url.href).sort()).toEqual([
      'https://example.com/a/rewritten',
      'https://example.com/b/rewritten',
    ]);
  });
});

describe('Runtime.steps (PIPE-25)', () => {
  test('exposes the exact flattened array it was constructed with', () => {
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: async (_r, ctx) => ctx.next(),
    };
    const runtime = createRuntime(
      [descriptor],
      new RecordingTransport(aResponse(200)),
    );

    expect(runtime.steps).toEqual([descriptor]);
  });

  test('the exposed view is frozen', () => {
    const runtime = createRuntime([], new RecordingTransport(aResponse(200)));

    expect(Object.isFrozen(runtime.steps)).toBe(true);
  });

  test("copies the caller's array, so a later mutation of it cannot reach the built runtime", () => {
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: async (_r, ctx) => ctx.next(),
    };
    const source: StepDescriptor[] = [descriptor];
    const runtime = createRuntime(
      source,
      new RecordingTransport(aResponse(200)),
    );

    source.push({...descriptor, type: Symbol('smuggled')});

    // PIPE-10: immutable after construction, and not by caller discipline.
    expect(runtime.steps).toEqual([descriptor]);
  });
});

describe('Runtime as a nested transport (PIPE-26)', () => {
  test("a built pipeline stands in as another pipeline's transport, options and signal surviving both hops", async () => {
    const transport = new RecordingTransport(aResponse(200));
    const log: string[] = [];
    const probe =
      (label: string): Step =>
      async (_request, ctx) => {
        log.push(`enter:${label}`);
        const response = await ctx.next();
        log.push(`exit:${label}`);
        return response;
      };
    const inner = createRuntime(
      [{type: Symbol('inner'), stage: 'PRE_SERDE', fn: probe('inner')}],
      transport,
    );
    const outer = createRuntime(
      [{type: Symbol('outer'), stage: 'PRE_REDIRECT', fn: probe('outer')}],
      inner,
    );
    const options = RequestOptions.EMPTY;
    const signal = new AbortController().signal;

    await outer.send(aRequest('https://example.com'), options, signal);

    expect(log).toEqual([
      'enter:outer',
      'enter:inner',
      'exit:inner',
      'exit:outer',
    ]);
    // PIPE-26: "options survive the indirection" -- through the outer cursor, the nested runtime's own
    // send(), and its cursor, reaching the terminal transport as the same references the caller passed.
    expect(transport.calls[0]?.options).toBe(options);
    expect(transport.calls[0]?.signal).toBe(signal);
  });
});

describe('Runtime.close (PIPE-27)', () => {
  test('never calls the underlying transport close', async () => {
    const transport = new RecordingTransport(aResponse(200));
    const runtime = createRuntime([], transport);

    await runtime.close();

    expect(transport.closeCalls).toBe(0);
  });
});
