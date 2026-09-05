// SPDX-License-Identifier: MIT
// tests/node-conformance/observability.test.mjs
//
// Phase 7b's runtime-divergent surfaces, driven through the `@dexpace/core` specifier on Node.js:
//   * AsyncLocalStorage store propagation across native Node promises, microtasks, and macrotask timers (OBS-10, OBS-24).
//   * activateSpan / activateSpanForCorrelation scope restoration and MDC push on Node (OBS-22, OBS-23).
//   * W3C trace/span identifier randomness via globalThis.crypto.getRandomValues on Node (OBS-26, OBS-27).
//   * What a caller's async context holds AFTER `await runtime.send()` resolves (OBS-22, OBS-23, OBS-29,
//     audit #67 / #80). Node's AsyncLocalStorage is the mechanism under test, not merely the host: the
//     leak this pins was `enterWith` installing on the caller's async resource with the restore closure
//     running on a later one, and Bun's suite passed over it for nine phases.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  NOOP_SPAN,
  PipelineBuilder,
  Protocol,
  Request,
  Response,
  Status,
  activateSpan,
  activateSpanForCorrelation,
  createInstrumentationBundle,
  createLogger,
  getActiveSpan,
  loggingStep,
} from '@dexpace/core';

describe('observability on Node.js native runtime floor', () => {
  it('generates valid W3C trace and span IDs via WebCrypto (OBS-26, OBS-27)', () => {
    const bundle = createInstrumentationBundle();
    assert.equal(bundle.isValid, true);
    assert.match(bundle.traceId, /^[0-9a-f]{32}$/u);
    assert.notEqual(bundle.traceId, '0'.repeat(32));
    assert.match(bundle.spanId, /^[0-9a-f]{16}$/u);
    assert.notEqual(bundle.spanId, '0'.repeat(16));
  });

  it('preserves and restores active span across async execution turns on Node (OBS-22)', async () => {
    const mockSpan = {
      isRecording: true,
      setAttribute() {
        return this;
      },
      recordException() {
        return this;
      },
      end() {
        return;
      },
    };

    assert.equal(getActiveSpan(), NOOP_SPAN);
    const scope = activateSpan(mockSpan);
    try {
      assert.equal(getActiveSpan(), mockSpan);
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(getActiveSpan(), mockSpan);
    } finally {
      scope.close();
    }
    assert.equal(getActiveSpan(), NOOP_SPAN);
  });

  it('folds context and single-emits correctly on Node (OBS-3, OBS-8)', () => {
    const emitted = [];
    const logger = createLogger((level, fields) => {
      emitted.push({level, fields: Object.fromEntries(fields)});
    });

    const event = logger.atLevel('info');
    event
      .event('node.conformance')
      .field('runtime', 'node')
      .field('null_val', null);
    event.emit();
    event.emit(); // second emit must be no-op (OBS-8)

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].level, 'info');
    assert.equal(emitted[0].fields.event, 'node.conformance');
    assert.equal(emitted[0].fields.runtime, 'node');
    assert.equal(emitted[0].fields.null_val, 'null');
  });

  it('correlates spanContext into logger diagnostic fields (OBS-23)', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';
    const recordingSpan = {
      isRecording: true,
      setAttribute() {
        return this;
      },
      recordException() {
        return this;
      },
      end() {
        return;
      },
      spanContext() {
        return {traceId, spanId};
      },
    };

    const emitted = [];
    const logger = createLogger((level, fields) => {
      emitted.push(Object.fromEntries(fields));
    });

    const scope = activateSpanForCorrelation(recordingSpan);
    try {
      logger.atLevel('info').event('correlated.event').emit();
    } finally {
      scope.close();
    }

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]['trace.id'], traceId);
    assert.equal(emitted[0]['span.id'], spanId);
  });
});

/** A transport literal: two methods, no socket. */
const okTransport = {
  send: async request =>
    Response.newBuilder()
      .request(request)
      .status(Status.of(200))
      .protocol(Protocol.HTTP_1_1)
      .body(null)
      .build(),
  close: async () => undefined,
};

/** A recording tracer whose spans carry a spanContext, so OBS-23's correlation push actually fires. */
function recordingTracer() {
  const started = [];
  return {
    started,
    tracer: {
      startSpan(name) {
        const record = {name, ended: 0};
        started.push(record);
        const span = {
          isRecording: true,
          setAttribute: () => span,
          recordException: () => span,
          end: () => {
            record.ended += 1;
          },
          spanContext: () => ({
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
          }),
        };
        return span;
      },
    },
  };
}

describe('async context after Runtime.send on Node.js (OBS-22, OBS-23, OBS-29)', () => {
  it('leaves the caller the active span and diagnostic fields it had before the call', async () => {
    const {tracer, started} = recordingTracer();
    const emitted = [];
    // A pipeline built the public way, with the LOGGING pillar inside it: that step is what pushes
    // OBS-23's trace.id/span.id, and before 2026-09-05 the push outlived the call.
    const runtime = new PipelineBuilder(okTransport, {
      instrumentation: createInstrumentationBundle(() => tracer),
    })
      .append(
        loggingStep({
          granularity: 'headers',
          logger: createLogger(() => undefined),
        }),
      )
      .build();
    const request = Request.newBuilder().url('https://example.com/one').build();

    assert.equal(getActiveSpan(), NOOP_SPAN);
    const response = await runtime.send(request);
    assert.equal(response.status.code, 200);

    assert.equal(getActiveSpan(), NOOP_SPAN);
    createLogger((level, fields) => {
      emitted.push(Object.fromEntries(fields));
    })
      .atLevel('info')
      .event('application.event.after.send')
      .emit();
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]['trace.id'], undefined);
    assert.equal(emitted[0]['span.id'], undefined);

    // OBS-29's 1:1 binding, which the leak also broke: the second call opens its own operation span.
    await runtime.send(request);
    const operationSpans = started.filter(
      span => span.name === 'http.client.operation',
    );
    assert.equal(operationSpans.length, 2);
    assert.deepEqual(
      operationSpans.map(span => span.ended),
      [1, 1],
    );
  });
});
