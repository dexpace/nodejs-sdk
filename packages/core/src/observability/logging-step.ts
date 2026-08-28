// SPDX-License-Identifier: MIT
// packages/core/src/observability/logging-step.ts
import type {StepDescriptor, StepContext} from '../pipeline/step.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {withRequestLogging} from '../body/request-body-logging.js';
import {
  withResponseLogging,
  type LoggedResponseBody,
} from '../body/response-body-logging.js';
import {
  CFG_KEY_LOG_LEVEL,
  getGlobalConfiguration,
} from '../config/configuration.js';
import {defaultClock, type Clock} from '../config/clock.js';
import {toError} from '../http/errors.js';
import {decodeBodyText, resolveCharset} from '../http/charset.js';
import {invariant} from '../invariant.js';
import {
  getGlobalLogger,
  type LogEvent,
  type LogLevel,
  type Logger,
} from './logger.js';
import {
  redactHeaderValue,
  redactUrl,
  type DroppedHeaderPolicy,
} from './redaction.js';
import {
  NOOP_METER,
  type Counter,
  type Histogram,
  type Meter,
} from './metrics.js';
import {
  NOOP_TRACER,
  activateSpanForCorrelation,
  type Tracer,
} from './tracing.js';

/**
 * Logging granularity levels for HTTP request/response logging (OBS-34).
 *
 * @public
 */
export type LoggingGranularity = 'none' | 'headers' | 'body';

/**
 * Settings for configuring the {@link loggingStep} (OBS-34..39).
 *
 * @public
 */
export interface LoggingStepSettings {
  /** The logger to emit events to (default: getGlobalLogger()). */
  readonly logger?: Logger | undefined;
  /**
   * Severity the http.request/http.response events emit at (OBS-2's axis).
   * Default: 'info' (failures always emit at 'error').
   */
  readonly severity?: LogLevel | undefined;
  /** Granularity of logging (default: resolved from Configuration via CFG_KEY_LOG_LEVEL, fallback 'none'). */
  readonly granularity?: LoggingGranularity | undefined;
  /** Byte limit for request/response body previews (default: 8192). */
  readonly previewSizeBytes?: number | undefined;
  /** Optional custom tracer factory. */
  readonly tracerFactory?: (() => Tracer) | undefined;
  /** Metrics meter instance (default: NOOP_METER). */
  readonly meter?: Meter | undefined;
  /** Policy for non-allow-listed headers (default: 'mark'). */
  readonly droppedHeaderPolicy?: DroppedHeaderPolicy | undefined;
  /** Injected clock seam for duration measurement (default: defaultClock). */
  readonly clock?: Clock | undefined;
}

const DEFAULT_PREVIEW_SIZE_BYTES = 8192;

function resolveGranularity(settings: LoggingStepSettings): LoggingGranularity {
  if (settings.granularity !== undefined) {
    const rawSetting = settings.granularity.trim().toLowerCase();
    if (rawSetting === 'headers' || rawSetting === 'body') return rawSetting;
    return 'none';
  }
  const raw = getGlobalConfiguration()
    .getString(CFG_KEY_LOG_LEVEL, 'none')
    ?.trim()
    .toLowerCase();
  if (raw === 'headers' || raw === 'body') return raw;
  return 'none';
}

function isTextMediaType(contentType: string | undefined): boolean {
  if (contentType === undefined) return true;
  const raw = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (raw === '') return true;
  if (
    raw.startsWith('text/') ||
    raw === 'application/json' ||
    raw === 'application/xml' ||
    raw === 'application/javascript' ||
    raw === 'application/x-www-form-urlencoded' ||
    raw.endsWith('+json') ||
    raw.endsWith('+xml') ||
    raw.endsWith('+text')
  ) {
    return true;
  }
  return false;
}

function renderBodyPreview(
  bytes: Uint8Array | undefined,
  contentType: string | undefined,
): string | undefined {
  if (bytes === undefined || !(bytes instanceof Uint8Array)) return undefined;
  if (bytes.length === 0) return '';
  try {
    if (isTextMediaType(contentType)) {
      return decodeBodyText(bytes, resolveCharset(contentType));
    }
    return `[binary ${String(bytes.length)} bytes captured]`;
  } catch {
    return `[binary ${String(bytes.length)} bytes captured]`;
  }
}

interface LogEventBuilder {
  readonly target: LogEvent;
  readonly prefix: 'http.request' | 'http.response';
  readonly policy: DroppedHeaderPolicy;
}

function addHeaderFields(
  event: LogEventBuilder,
  headers: Iterable<readonly [string, string]>,
): void {
  for (const [name, value] of headers) {
    const redacted = redactHeaderValue(name, value, event.policy);
    if (redacted !== undefined) {
      event.target.field(
        `${event.prefix}.header.${name.toLowerCase()}`,
        redacted,
      );
    }
  }
}

/** Containment: logging failures must never cause the HTTP request pipeline to throw or fail (OBS-20). */
function safeEmit(logger: Logger, build: () => void): void {
  try {
    build();
  } catch (error) {
    try {
      logger
        .atLevel('verbose')
        .event('http.instrumentation.logFailure')
        .cause(error)
        .emit();
    } catch {
      // swallowed per OBS-20
    }
  }
}

/**
 * Stable identity symbol for the LOGGING pillar step.
 *
 * @public
 */
export const LOGGING_STEP_TYPE: unique symbol = Symbol('dexpace.logging');

interface EmitContext {
  readonly logger: Logger;
  readonly severity: LogLevel;
  readonly granularity: LoggingGranularity;
  readonly policy: DroppedHeaderPolicy;
  readonly previewSizeBytes: number;
}

interface BodyPreviewResult {
  readonly preview: string | undefined;
  readonly size: number | undefined;
}

function emitRequestEvent(
  context: EmitContext,
  request: Request,
  bodyInfo?: BodyPreviewResult,
): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    const event = context.logger
      .atLevel(context.severity)
      .event('http.request')
      .field('http.request.method', request.method)
      .field('url.full', redactUrl(request.url));
    addHeaderFields(
      {target: event, prefix: 'http.request', policy: context.policy},
      request.headers.entries(),
    );
    if (bodyInfo?.preview !== undefined) {
      event.field('http.request.body.preview', bodyInfo.preview);
      if (bodyInfo.size !== undefined) {
        event.field('http.request.body.size', bodyInfo.size);
      }
    }
    event.emit();
  });
}

function emitResponseEvent(
  context: EmitContext,
  outcome: {
    response: Response;
    elapsedMs: number;
    preview: string | undefined;
    size: number | undefined;
  },
): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    const event = context.logger
      .atLevel(context.severity)
      .event('http.response')
      .field('http.response.status_code', outcome.response.status.code)
      .field('http.response.duration_ms', outcome.elapsedMs);
    addHeaderFields(
      {target: event, prefix: 'http.response', policy: context.policy},
      outcome.response.headers.entries(),
    );
    if (outcome.preview !== undefined) {
      event.field('http.response.body.preview', outcome.preview);
      if (outcome.size !== undefined) {
        event.field('http.response.body.size', outcome.size);
      }
    }
    event.emit();
  });
}

function emitFailureEvent(
  context: EmitContext,
  outcome: {error: Error; elapsedMs: number},
): void {
  if (context.granularity === 'none') return;
  safeEmit(context.logger, () => {
    context.logger
      .atLevel('error')
      .event('http.response')
      .field('error.type', outcome.error.name)
      .field('http.response.duration_ms', outcome.elapsedMs)
      .cause(outcome.error)
      .emit();
  });
}

function resolveTracer(
  settings: LoggingStepSettings,
  ctx: StepContext,
): Tracer {
  if (settings.tracerFactory !== undefined) return settings.tracerFactory();

  const factory = ctx.context.instrumentation.tracerFactory as
    ((operationName: string) => Tracer | undefined) | undefined;
  if (typeof factory !== 'function') return NOOP_TRACER;

  const opName =
    'operationName' in ctx.context ? ctx.context.operationName : undefined;
  const created = factory(opName ?? 'http.client.request');
  return created ?? NOOP_TRACER;
}

/** Captures response body preview safely when content-length is declared (OBS-36, OBS-37). */
async function captureResponseBody(
  response: Response,
  previewSizeBytes: number,
): Promise<{
  readonly response: Response;
  readonly preview: string | undefined;
  readonly size: number | undefined;
}> {
  try {
    const hasContentLength = response.headers.has('content-length');
    if (response.body === null || !hasContentLength) {
      return {response, preview: undefined, size: undefined};
    }
    const rawLen = Number.parseInt(
      response.headers.get('content-length') ?? '-1',
      10,
    );
    const declaredLen = Number.isFinite(rawLen) ? rawLen : -1;
    if (declaredLen < 0) {
      return {response, preview: undefined, size: undefined};
    }
    const loggedResponse: LoggedResponseBody = withResponseLogging(
      response.body,
      previewSizeBytes,
      declaredLen,
    );
    const loggedStream = await loggedResponse.read();
    const captured = response.newBuilder().body(loggedStream).build();
    const snap = loggedResponse.snapshot();
    const preview = renderBodyPreview(
      snap,
      response.headers.get('content-type'),
    );
    const size = snap.length > 0 ? snap.length : undefined;
    return {response: captured, preview, size};
  } catch {
    // OBS-20: body-drain failure must never fail the request
    return {response, preview: undefined, size: undefined};
  }
}

async function prepareRequestBody(
  request: Request,
  granularity: LoggingGranularity,
  previewSizeBytes: number,
): Promise<{
  readonly outbound: Request;
  readonly preview: string | undefined;
  readonly size: number | undefined;
}> {
  if (granularity !== 'body' || request.body === undefined) {
    return {outbound: request, preview: undefined, size: undefined};
  }
  const logged = withRequestLogging(request.body, previewSizeBytes);
  if (logged.replayable) {
    const probeSink = new WritableStream<Uint8Array>({
      write: () => undefined,
    });
    try {
      await logged.writeTo(probeSink);
    } catch {
      // probe error is ignored per OBS-20
    }
  }
  const snap = logged.snapshot();
  const preview = renderBodyPreview(
    snap,
    request.headers.get('content-type') ?? request.body.mediaType,
  );
  const size = snap.length > 0 ? snap.length : undefined;
  const outbound = request.newBuilder().body(logged).build();
  return {outbound, preview, size};
}

interface StepInstruments {
  readonly requestCounter: Counter;
  readonly requestDuration: Histogram;
  readonly clock: Clock;
}

interface ExecutionPlan {
  readonly settings: LoggingStepSettings;
  readonly emitContext: EmitContext;
  readonly instruments: StepInstruments;
  readonly previewSizeBytes: number;
}

interface PipelineExecutionArgs {
  readonly ctx: StepContext;
  readonly plan: ExecutionPlan;
  readonly outbound: Request;
  readonly startedAt: number;
  readonly span: ReturnType<Tracer['startSpan']>;
}

async function executePipeline(args: PipelineExecutionArgs): Promise<Response> {
  const {ctx, plan, outbound, startedAt, span} = args;
  const {emitContext, instruments, previewSizeBytes} = plan;
  try {
    const response = await ctx.next(outbound);
    const {
      response: captured,
      preview,
      size,
    } = emitContext.granularity === 'body'
      ? await captureResponseBody(response, previewSizeBytes)
      : {response, preview: undefined, size: undefined};

    const elapsedMs = instruments.clock.monotonic() - startedAt;
    instruments.requestCounter.add(1, {
      method: outbound.method,
      status: captured.status.code,
    });
    instruments.requestDuration.record(elapsedMs, {
      method: outbound.method,
      status: captured.status.code,
    });
    emitResponseEvent(emitContext, {
      response: captured,
      elapsedMs,
      preview,
      size,
    });

    span.end();
    return captured;
  } catch (caught) {
    const error = toError(caught);
    const elapsedMs = instruments.clock.monotonic() - startedAt;

    instruments.requestCounter.add(1, {
      method: outbound.method,
      errorType: error.name,
    });
    instruments.requestDuration.record(elapsedMs, {
      method: outbound.method,
      errorType: error.name,
    });
    emitFailureEvent(emitContext, {error, elapsedMs});

    span.recordException(error);
    span.end();
    throw caught;
  }
}

async function handleRequestExecution(
  request: Request,
  ctx: StepContext,
  plan: ExecutionPlan,
): Promise<Response> {
  const {settings, emitContext, instruments, previewSizeBytes} = plan;
  const tracer = resolveTracer(settings, ctx);
  const span = tracer.startSpan('http.client.request');
  const scope = activateSpanForCorrelation(span);
  const startedAt = instruments.clock.monotonic();

  try {
    const {outbound, preview, size} = await prepareRequestBody(
      request,
      emitContext.granularity,
      previewSizeBytes,
    );
    emitRequestEvent(emitContext, outbound, {preview, size});
    return await executePipeline({
      ctx,
      plan,
      outbound,
      startedAt,
      span,
    });
  } finally {
    scope.close();
  }
}

/**
 * Creates the LOGGING pillar step descriptor (OBS-34..39).
 *
 * @param settings - optional logging step settings.
 * @returns the step descriptor.
 *
 * @public
 */
export function loggingStep(
  settings: LoggingStepSettings = {},
): StepDescriptor {
  const meter = settings.meter ?? NOOP_METER;
  const clock = settings.clock ?? defaultClock;
  const policy = settings.droppedHeaderPolicy ?? 'mark';
  const severity: LogLevel = settings.severity ?? 'info';
  const previewSizeBytes =
    settings.previewSizeBytes ?? DEFAULT_PREVIEW_SIZE_BYTES;

  invariant(
    previewSizeBytes > 0,
    'loggingStep: previewSizeBytes must be positive',
  );
  invariant(
    Number.isFinite(previewSizeBytes),
    'loggingStep: previewSizeBytes must be finite',
  );

  const instruments: StepInstruments = {
    requestCounter: meter.createCounter('http.client.request.count', {
      unit: '{request}',
    }),
    requestDuration: meter.createHistogram('http.client.request.duration', {
      unit: 'ms',
    }),
    clock,
  };

  return {
    type: LOGGING_STEP_TYPE,
    stage: 'LOGGING',
    fn: (request, ctx) => {
      const emitContext: EmitContext = {
        logger: settings.logger ?? getGlobalLogger(),
        severity,
        granularity: resolveGranularity(settings),
        policy,
        previewSizeBytes,
      };
      return handleRequestExecution(request, ctx, {
        settings,
        emitContext,
        instruments,
        previewSizeBytes,
      });
    },
  };
}
