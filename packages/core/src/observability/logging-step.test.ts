// SPDX-License-Identifier: MIT
// packages/core/src/observability/logging-step.test.ts
// Exercises: OBS-34 (granularity gates log events, not span/metrics), OBS-35 (level resolves from
// Configuration, tolerant/case-insensitive), OBS-39 (stable http.request/http.response event names/keys,
// url.full always redacted), OBS-20 (a throwing Logger is caught and re-surfaced as http.instrumentation.*;
// a throwing tracer/meter propagates, NOT caught), OBS-36, OBS-37, OBS-38 (body previews).
import {afterEach, describe, expect, test} from 'bun:test';
import {Headers} from '../http/headers.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {Cursor} from '../pipeline/cursor.js';
import {createRequestContext} from '../context/context.js';
import {FakeTransport, countingResponse} from '../testing/fake-transport.js';
import {
  CFG_KEY_LOG_LEVEL,
  ConfigurationBuilder,
  setGlobalConfiguration,
} from '../config/configuration.js';
import {stringBody} from '../body/simple-bodies.js';
import type {Logger, LogEvent} from './logger.js';
import type {Meter} from './metrics.js';
import type {Tracer} from './tracing.js';
import {loggingStep} from './logging-step.js';

function spyLogger(): {logger: Logger; events: Record<string, unknown>[]} {
  const events: Record<string, unknown>[] = [];
  function event(): LogEvent {
    const fields: Record<string, unknown> = {};
    const self: LogEvent = {
      field(key, value) {
        fields[key] = value;
        return self;
      },
      event(name) {
        fields.event = name;
        return self;
      },
      cause(error) {
        fields.cause = error;
        return self;
      },
      emit() {
        events.push({...fields});
      },
    };
    return self;
  }
  return {
    logger: {
      atLevel: () => event(),
      withContext: () => ({
        atLevel: () => event(),
        withContext: () => ({}) as Logger,
      }),
    },
    events,
  };
}

function textResponse(
  status: number,
  text: string,
  contentType = 'text/plain',
): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(
      Headers.newBuilder()
        .set('content-type', contentType)
        .set('content-length', String(bytes.length))
        .build(),
    )
    .body(stream)
    .build();
}

function chunkedResponse(status: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(Headers.newBuilder().set('transfer-encoding', 'chunked').build())
    .body(stream)
    .build();
}

function binaryResponse(status: number, bytes: Uint8Array): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(
      Headers.newBuilder()
        .set('content-type', 'application/octet-stream')
        .set('content-length', String(bytes.length))
        .build(),
    )
    .body(stream)
    .build();
}

async function send(
  step: ReturnType<typeof loggingStep>,
  transport: FakeTransport,
  request = Request.newBuilder().url('https://example.com/test').build(),
): Promise<Response> {
  return new Cursor({
    steps: [step],
    transport,
    request,
    context: createRequestContext(request),
  }).advance();
}

afterEach(() => {
  setGlobalConfiguration(
    new ConfigurationBuilder().remove(CFG_KEY_LOG_LEVEL).build(),
  );
});

describe('granularity controls (OBS-34)', () => {
  test('at granularity: none, no log events are emitted but span & metrics run', async () => {
    const {logger, events} = spyLogger();
    let spanStarted = false;
    let spanEnded = false;
    const fakeTracer: Tracer = {
      startSpan: () => {
        spanStarted = true;
        return {
          isRecording: true,
          setAttribute: () => fakeTracer.startSpan('child'),
          recordException: () => fakeTracer.startSpan('child'),
          end: () => {
            spanEnded = true;
          },
        };
      },
    };
    let counterCalls = 0;
    const fakeMeter: Meter = {
      createCounter: () => ({
        add: () => {
          counterCalls += 1;
        },
      }),
      createHistogram: () => ({
        record: () => undefined,
      }),
    };

    const transport = new FakeTransport([countingResponse(200).response]);
    await send(
      loggingStep({
        logger,
        granularity: 'none',
        tracerFactory: () => fakeTracer,
        meter: fakeMeter,
      }),
      transport,
    );

    expect(events).toHaveLength(0);
    expect(spanStarted).toBe(true);
    expect(spanEnded).toBe(true);
    expect(counterCalls).toBe(1);
  });
});

describe('ambient configuration resolution (OBS-35)', () => {
  test('resolves headers granularity from CFG_KEY_LOG_LEVEL', async () => {
    setGlobalConfiguration(
      new ConfigurationBuilder().put(CFG_KEY_LOG_LEVEL, 'HEADERS').build(),
    );
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(loggingStep({logger}), transport);

    const eventNames = events.map(e => e.event);
    expect(eventNames).toContain('http.request');
    expect(eventNames).toContain('http.response');
  });

  test('falls back to none when config is unset or invalid', async () => {
    setGlobalConfiguration(
      new ConfigurationBuilder().put(CFG_KEY_LOG_LEVEL, 'INVALID').build(),
    );
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);

    await send(loggingStep({logger}), transport);
    expect(events).toHaveLength(0);
  });
});

describe('structured events: request and response (OBS-39)', () => {
  test('emits standard field hierarchy for successful request', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);
    const req = Request.newBuilder()
      .url('https://user:secret@example.com/api?token=secret#token=hash')
      .method('GET')
      .build();

    await send(loggingStep({logger, granularity: 'headers'}), transport, req);

    expect(events).toHaveLength(2);
    const [requestEvent, responseEvent] = events;

    expect(requestEvent?.event).toBe('http.request');
    expect(requestEvent?.['http.request.method']).toBe('GET');
    expect(requestEvent?.['url.full']).not.toContain('secret');
    expect(requestEvent?.['url.full']).toContain('***');

    expect(responseEvent?.event).toBe('http.response');
    expect(responseEvent?.['http.response.status_code']).toBe(200);
    expect(typeof responseEvent?.['http.response.duration_ms']).toBe('number');
  });

  test('emits error response event on failure', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([new Error('network failure')]);

    let caught: unknown;
    try {
      await send(loggingStep({logger, granularity: 'headers'}), transport);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();

    expect(events).toHaveLength(2);
    const failureEvent = events[1];
    expect(failureEvent?.event).toBe('http.response');
    expect(failureEvent?.['error.type']).toBe('Error');
    expect(failureEvent?.cause).toBeDefined();
  });
});

describe('header redaction policies (OBS-17, OBS-18)', () => {
  test('redacts non-allow-listed headers per DroppedHeaderPolicy', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse({
        status: 200,
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret',
        },
      }),
    ]);

    await send(
      loggingStep({
        logger,
        granularity: 'headers',
        droppedHeaderPolicy: 'mark',
      }),
      transport,
    );

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(responseEvent?.['http.response.header.content-type']).toBe(
      'application/json',
    );
    expect(responseEvent?.['http.response.header.authorization']).toBe(
      'REDACTED',
    );
  });

  test('omits non-allow-listed headers when policy is omit', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'session=abc',
        },
      }),
    ]);

    await send(
      loggingStep({
        logger,
        granularity: 'headers',
        droppedHeaderPolicy: 'omit',
      }),
      transport,
    );

    const responseEvent = events.find(e => e.event === 'http.response');
    expect('http.response.header.set-cookie' in (responseEvent ?? {})).toBe(
      false,
    );
  });
});

describe('location header redaction (OBS-17)', () => {
  test('a Location header is redacted through the URL-value redactor', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      countingResponse({
        status: 302,
        headers: {location: 'https://other.example/cb?code=SECRET'},
      }),
    ]);

    await send(loggingStep({logger, granularity: 'headers'}), transport);

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(
      String(responseEvent?.['http.response.header.location']),
    ).not.toContain('SECRET');
  });
});

describe('failure containment: logger safety (OBS-20)', () => {
  test('a throwing Logger is caught; the request still completes and emits logFailure', async () => {
    const emittedEvents: Record<string, unknown>[] = [];
    let shouldThrow = true;
    const throwingLogger: Logger = {
      atLevel(level) {
        return {
          field() {
            return this;
          },
          event(name) {
            emittedEvents.push({level, event: name});
            return this;
          },
          cause() {
            return this;
          },
          emit(): void {
            if (shouldThrow) {
              shouldThrow = false;
              throw new Error('logger exploded');
            }
          },
        };
      },
      withContext(): Logger {
        return throwingLogger;
      },
    };
    const transport = new FakeTransport([countingResponse(200).response]);
    const res = await send(
      loggingStep({logger: throwingLogger, granularity: 'headers'}),
      transport,
    );
    expect(res).toBeDefined();
    expect(
      emittedEvents.some(e => e.event === 'http.instrumentation.logFailure'),
    ).toBe(true);
  });

  test('a failing response body drain does not fail the request (OBS-20)', async () => {
    const {logger} = spyLogger();
    const failingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('stream broke'));
      },
    });
    const brokenResponse = Response.newBuilder()
      .request(Request.newBuilder().url('https://example.com').build())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .headers(
        Headers.newBuilder()
          .set('content-type', 'text/plain')
          .set('content-length', '100')
          .build(),
      )
      .body(failingStream)
      .build();
    const transport = new FakeTransport([brokenResponse]);
    const res = await send(
      loggingStep({logger, granularity: 'body'}),
      transport,
    );
    expect(res).toBeDefined();
    expect(res.status.code).toBe(200);
  });
});

describe('failure containment: tracer and meter propagation (OBS-20, OBS-30)', () => {
  test('a throwing tracer is NOT caught -- it propagates and fails the request', async () => {
    const {logger} = spyLogger();
    const explodingTracer: Tracer = {
      startSpan(): never {
        throw new Error('tracer exploded');
      },
    };
    const transport = new FakeTransport([countingResponse(200).response]);

    let caughtErr: unknown;
    try {
      await send(
        loggingStep({
          logger,
          granularity: 'headers',
          tracerFactory: () => explodingTracer,
        }),
        transport,
      );
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeDefined();
    expect((caughtErr as Error).message).toBe('tracer exploded');
  });

  test('a throwing meter is NOT caught -- it propagates and fails the request', async () => {
    const explodingMeter: Meter = {
      createCounter() {
        return {
          add() {
            throw new Error('meter counter exploded');
          },
        };
      },
      createHistogram() {
        return {
          record() {
            throw new Error('meter histogram exploded');
          },
        };
      },
    };
    const transport = new FakeTransport([countingResponse(200).response]);
    let caughtErr: unknown;
    try {
      await send(
        loggingStep({meter: explodingMeter, granularity: 'none'}),
        transport,
      );
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeDefined();
    expect((caughtErr as Error).message).toBe('meter counter exploded');
  });
});

describe('failure containment: non-error thrown values (XCUT-20)', () => {
  test('a non-Error thrown value does not make the logging step throw its own TypeError', async () => {
    const {logger, events} = spyLogger();
    const rejectingTransport = {
      send: () =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- testing non-Error rejection (XCUT-20)
        Promise.reject('string rejection'),
      close: () => Promise.resolve(),
    };
    const req = Request.newBuilder().url('https://example.com/test').build();
    const cursor = new Cursor({
      steps: [loggingStep({logger, granularity: 'headers'})],
      transport: rejectingTransport,
      request: req,
      context: createRequestContext(req),
    });

    let caughtErr: unknown;
    try {
      await cursor.advance();
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBe('string rejection');

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(responseEvent?.['error.type']).toBe('Error');
  });
});

describe('response body preview (OBS-36, OBS-37, OBS-38)', () => {
  test('a body larger than previewSizeBytes still reaches caller in full, preview is capped', async () => {
    const {logger, events} = spyLogger();
    const payload = 'x'.repeat(50_000);
    const transport = new FakeTransport([textResponse(200, payload)]);

    const response = await send(
      loggingStep({logger, granularity: 'body', previewSizeBytes: 128}),
      transport,
    );

    expect(await response.text()).toHaveLength(50_000);
    const responseEvent = events.find(e => e.event === 'http.response');
    expect(String(responseEvent?.['http.response.body.preview'])).toHaveLength(
      128,
    );
    expect(responseEvent?.['http.response.body.size']).toBe(128);
  });

  test('an unknown-length response body skips capture entirely (OBS-37)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([chunkedResponse(200)]);

    await send(loggingStep({logger, granularity: 'body'}), transport);

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(responseEvent?.['http.response.body.preview']).toBeUndefined();
  });

  test('a binary body renders as a size-only marker, never decoded (OBS-38)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      binaryResponse(200, new Uint8Array([0xff, 0xfe, 0x00])),
    ]);

    await send(loggingStep({logger, granularity: 'body'}), transport);

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(responseEvent?.['http.response.body.preview']).toBe(
      '[binary 3 bytes captured]',
    );
    expect(responseEvent?.['http.response.body.size']).toBe(3);
  });

  test('a truncated multi-byte sequence decodes to a replacement character, never throwing (OBS-38)', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([
      textResponse(200, '€€€', 'text/plain; charset=utf-8'),
    ]);

    const res = await send(
      loggingStep({logger, granularity: 'body', previewSizeBytes: 2}),
      transport,
    );
    expect(res).toBeDefined();

    const responseEvent = events.find(e => e.event === 'http.response');
    expect(String(responseEvent?.['http.response.body.preview'])).toContain(
      '\uFFFD',
    );
  });
});

describe('request body preview and validation (OBS-36, OBS-38)', () => {
  test('request body preview is captured under granularity: body', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([textResponse(200, 'ok')]);
    const req = Request.newBuilder()
      .url('https://example.com/submit')
      .method('POST')
      .body(stringBody('hello payload', 'text/plain'))
      .build();

    await send(loggingStep({logger, granularity: 'body'}), transport, req);

    const requestEvent = events.find(e => e.event === 'http.request');
    expect(requestEvent?.['http.request.body.preview']).toBe('hello payload');
    expect(requestEvent?.['http.request.body.size']).toBe(13);
  });

  test('validates previewSizeBytes is positive and finite', () => {
    expect(() => loggingStep({previewSizeBytes: -1})).toThrow();
    expect(() => loggingStep({previewSizeBytes: Number.NaN})).toThrow();
  });

  test('tolerant granularity setting parsing', async () => {
    const {logger, events} = spyLogger();
    const transport = new FakeTransport([countingResponse(200).response]);
    await send(
      loggingStep({logger, granularity: '  HEADERS  ' as never}),
      transport,
    );
    expect(events.map(e => e.event)).toEqual(['http.request', 'http.response']);
  });

  test('negative or invalid content-length header skips body capture', async () => {
    const {logger, events} = spyLogger();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const resp = Response.newBuilder()
      .request(Request.newBuilder().url('https://example.com').build())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .headers(Headers.newBuilder().set('content-length', '-1').build())
      .body(stream)
      .build();
    const transport = new FakeTransport([resp]);

    await send(loggingStep({logger, granularity: 'body'}), transport);
    const responseEvent = events.find(e => e.event === 'http.response');
    expect(responseEvent?.['http.response.body.preview']).toBeUndefined();
  });
});
