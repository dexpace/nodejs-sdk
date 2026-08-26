// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/cursor.test.ts
// Exercises: PIPE-9 (Cursor-level: an exhausted position dispatches to the terminal transport), PIPE-11/15
// (a reused next()/fork() continuation throws CursorAlreadyAdvancedError), PIPE-12 (ctx.context, ctx.fork
// gated by pillar stage, short-circuiting without invoking the chain, substituting the outbound response),
// PIPE-13 (terminal dispatch threads request/options/signal), PIPE-14 (a substituted request sticks
// downstream, across every later fork, and into the terminal dispatch), PIPE-15/16 (fork() returns
// independent, position-pinned one-shot continuations; a step that forks twice re-visits every downstream
// step both times), PIPE-17 (the caller's options are carried unchanged across every fork and into each
// dispatch)
import {describe, expect, test} from 'bun:test';
import {
  createRequestContext,
  type ExecutionContext,
} from '../context/context.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {Cursor} from './cursor.js';
import {CursorAlreadyAdvancedError} from './errors.js';
import type {Next, Step, StepDescriptor} from './step.js';

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
    return Promise.resolve();
  }
}

function passthroughStep(log: string[], label: string): Step {
  return async (_request, ctx) => {
    log.push(label);
    return ctx.next();
  };
}

describe('Cursor terminal dispatch (PIPE-9, PIPE-13)', () => {
  test('an exhausted cursor dispatches to the terminal transport, threading options and signal', async () => {
    const canned = aResponse(200);
    const transport = new RecordingTransport(canned);
    const request = aRequest('https://example.com/a');
    const signal = new AbortController().signal;
    const context = createRequestContext(request);

    const cursor = new Cursor({steps: [], transport, request, context, signal});
    const response = await cursor.advance();

    expect(response).toBe(canned);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.request).toBe(request);
    expect(transport.calls[0]?.signal).toBe(signal);
  });
});

describe('Cursor step invocation (PIPE-12)', () => {
  test('ctx.context is the exact reference passed to the constructor, visible to every step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const seen: ExecutionContext[] = [];
    const step: Step = async (_request, ctx) => {
      seen.push(ctx.context);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: step,
    };

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(seen[0]).toBe(context);
  });
});

describe('Cursor fork availability (PIPE-12, PIPE-15)', () => {
  test('ctx.fork is undefined for a non-pillar-stage step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const seenFork: ((() => Next) | undefined)[] = [];
    const step: Step = async (_request, ctx) => {
      seenFork.push(ctx.fork);
      return ctx.next();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: step,
    };

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(seenFork[0]).toBeUndefined();
  });

  test('ctx.fork is present for a pillar-stage step', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let sawFork: (() => Next) | undefined;
    const step: Step = async (_request, ctx) => {
      sawFork = ctx.fork;
      invariant(sawFork !== undefined, 'pillar step must receive a fork');
      return sawFork()();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('retry'),
      stage: 'RETRY',
      fn: step,
    };

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    expect(sawFork).toBeDefined();
  });
});

describe('Cursor bidirectionality (PIPE-12)', () => {
  test('a step that short-circuits never reaches the terminal transport', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const synthetic = aResponse(204);
    const transport = new RecordingTransport(aResponse(200));
    const shortCircuit: Step = () => Promise.resolve(synthetic);
    const descriptor: StepDescriptor = {
      type: Symbol('short-circuit'),
      stage: 'PRE_LOGGING',
      fn: shortCircuit,
    };

    const response = await new Cursor({
      steps: [descriptor],
      transport,
      request,
      context,
    }).advance();

    expect(response).toBe(synthetic);
    expect(transport.calls).toHaveLength(0);
  });

  test('a step may substitute the outbound response on the way back out', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const fromTransport = aResponse(200);
    const substituted = aResponse(203);
    const transport = new RecordingTransport(fromTransport);
    let sawFromTransport: Response | undefined;
    const substituteResponse: Step = async (_request, ctx) => {
      sawFromTransport = await ctx.next();
      return substituted;
    };
    const descriptor: StepDescriptor = {
      type: Symbol('substitute-response'),
      stage: 'PRE_LOGGING',
      fn: substituteResponse,
    };

    const response = await new Cursor({
      steps: [descriptor],
      transport,
      request,
      context,
    }).advance();

    expect(sawFromTransport).toBe(fromTransport);
    expect(response).toBe(substituted);
  });
});

describe('Cursor continuation reuse (PIPE-11, PIPE-15)', () => {
  test('a second call to the same next() throws CursorAlreadyAdvancedError', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let capturedNext: Next | undefined;
    const step: Step = async (_request, ctx) => {
      capturedNext = ctx.next;
      return ctx.next();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('probe'),
      stage: 'PRE_LOGGING',
      fn: step,
    };

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    invariant(
      capturedNext !== undefined,
      'the step must have run and captured its next()',
    );
    const rejection: unknown = await capturedNext().catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(CursorAlreadyAdvancedError);
  });

  test('a second call to the same fork()-returned continuation throws CursorAlreadyAdvancedError', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    let capturedContinuation: Next | undefined;
    const step: Step = async (_request, ctx) => {
      invariant(ctx.fork !== undefined, 'pillar step must receive a fork');
      capturedContinuation = ctx.fork();
      return capturedContinuation();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('retry'),
      stage: 'RETRY',
      fn: step,
    };

    await new Cursor({
      steps: [descriptor],
      transport: new RecordingTransport(aResponse(200)),
      request,
      context,
    }).advance();

    invariant(
      capturedContinuation !== undefined,
      'the step must have run and captured its fork() continuation',
    );
    const rejection: unknown = await capturedContinuation().catch(
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(CursorAlreadyAdvancedError);
  });
});

describe('Cursor request substitution (PIPE-14)', () => {
  test('a substituted request propagates downstream and to the terminal dispatch', async () => {
    const original = aRequest('https://example.com/a');
    const substituted = aRequest('https://example.com/b');
    const context = createRequestContext(original);
    const seenByDownstream: Request[] = [];
    const substituteStep: Step = async (_request, ctx) => ctx.next(substituted);
    const downstreamStep: Step = async (request, ctx) => {
      seenByDownstream.push(request);
      return ctx.next();
    };
    const transport = new RecordingTransport(aResponse(200));
    const steps: StepDescriptor[] = [
      {type: Symbol('substitute'), stage: 'PRE_LOGGING', fn: substituteStep},
      {type: Symbol('downstream'), stage: 'POST_LOGGING', fn: downstreamStep},
    ];

    await new Cursor({steps, transport, request: original, context}).advance();

    expect(seenByDownstream[0]).toBe(substituted);
    expect(transport.calls[0]?.request).toBe(substituted);
  });
});

describe('Cursor request substitution across forks (PIPE-14, PIPE-16)', () => {
  test('a substitution made inside one fork is what the next fork dispatches', async () => {
    const original = aRequest('https://example.com/original');
    const substituted = aRequest('https://example.com/substituted');
    const context = createRequestContext(original);
    const transport = new RecordingTransport(aResponse(200));
    const reDriving: Step = async (_request, ctx) => {
      invariant(ctx.fork !== undefined, 'a pillar step must receive a fork');
      await ctx.fork()(substituted);
      return ctx.fork()();
    };
    const descriptor: StepDescriptor = {
      type: Symbol('retry'),
      stage: 'RETRY',
      fn: reDriving,
    };

    await new Cursor({
      steps: [descriptor],
      transport,
      request: original,
      context,
    }).advance();

    // PIPE-14's stickiness is global to the call, not scoped to the fork that substituted: PIPE-16's
    // "forks advance independently" is about cursor position, not about request isolation.
    expect(transport.calls.map(call => call.request)).toEqual([
      substituted,
      substituted,
    ]);
  });
});

describe('Cursor fork (PIPE-15, PIPE-16, PIPE-17)', () => {
  test('a step forking twice re-visits every downstream step on both attempts', async () => {
    const request = aRequest('https://example.com');
    const context = createRequestContext(request);
    const options = RequestOptions.EMPTY;
    const log: string[] = [];
    const retryStep: Step = async (_request, ctx) => {
      invariant(ctx.fork !== undefined, 'retryStep must occupy a pillar stage');
      log.push('retry:attempt-1');
      await ctx.fork()();
      log.push('retry:attempt-2');
      return ctx.fork()();
    };
    const steps: StepDescriptor[] = [
      {type: Symbol('retry'), stage: 'RETRY', fn: retryStep},
      {
        type: Symbol('downstream'),
        stage: 'POST_RETRY',
        fn: passthroughStep(log, 'downstream'),
      },
    ];
    const transport = new RecordingTransport(aResponse(200));

    await new Cursor({steps, transport, request, context, options}).advance();

    expect(log).toEqual([
      'retry:attempt-1',
      'downstream',
      'retry:attempt-2',
      'downstream',
    ]);
    expect(transport.calls).toHaveLength(2);
    // PIPE-17: the caller's per-call options are carried unchanged across every re-drive fork and threaded
    // into each terminal dispatch -- shared by reference, never copied-and-diverged per fork.
    expect(transport.calls.map(call => call.options)).toEqual([
      options,
      options,
    ]);
  });
});
