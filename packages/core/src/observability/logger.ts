// SPDX-License-Identifier: MIT
// packages/core/src/observability/logger.ts
import {invariant} from '../invariant.js';
import {getDiagnosticContext} from './diagnostic-context.js';

/**
 * The four log severity levels supported by the facade (OBS-2).
 *
 * @public
 */
export type LogLevel = 'error' | 'warning' | 'info' | 'verbose';

const RESERVED_EVENT_KEY = 'event';
const COLLISION_WARNING_EVENT = 'dexpace.logger.reservedKeyCollision';
const MAX_FIELD_LENGTH = 8192;
const TRUNCATION_MARKER = '…[truncated]';
const UNRENDERABLE_PLACEHOLDER = '[unrenderable value]';
const DEFAULT_DIAGNOSTIC_ALLOW_LIST: readonly string[] = Object.freeze([
  'trace.id',
  'span.id',
]);

/**
 * Fluent builder for constructing and emitting structured log events (OBS-3, OBS-4, OBS-8).
 *
 * @public
 */
export interface LogEvent {
  /** OBS-3: an empty key MUST be rejected. A null value is emitted as the literal string "null". */
  field(key: string, value: unknown): this;
  /** OBS-4: sets the reserved "event" tag exclusively; an empty name clears it. */
  event(name: string): this;
  /** Sets the cause field of the event. */
  cause(error: unknown): this;
  /** OBS-8: at most once; a second call is a no-op, safe under concurrent invocation. */
  emit(): void;
}

/**
 * Logging facade interface (OBS-1, OBS-9).
 *
 * @public
 */
export interface Logger {
  /** OBS-1: enabled/disabled is decided once, here. The disabled path allocates and emits nothing. */
  atLevel(level: LogLevel): LogEvent;
  /** OBS-9: attaches a global key/value context to every event this returns. */
  withContext(fields: Readonly<Record<string, unknown>>): Logger;
}

/**
 * OBS-6/OBS-7: total field-value rendering -- never throws, for any input.
 */
function renderField(value: unknown): unknown {
  try {
    if (value === null || value === undefined) return 'null';
    // OBS-6: numeric/boolean/bigint primitives pass through type-preserving and are exempt from truncation.
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value;
    }
    return truncate(renderNonPrimitive(value));
  } catch {
    return UNRENDERABLE_PLACEHOLDER;
  }
}

function renderNonPrimitive(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (Array.isArray(value)) {
      return `[${value.map(renderScalar).join(', ')}]`;
    }
    if (value instanceof Set) {
      return `[${[...value].map(renderScalar).join(', ')}]`;
    }
    if (value instanceof Map) return renderPairs([...value]);
    if (typeof value === 'object' && value !== null) {
      if (
        typeof (value as {toString?: unknown}).toString === 'function' &&
        (value as {toString: unknown}).toString !== Object.prototype.toString
      ) {
        const custom = (value as {toString(): unknown}).toString();
        return typeof custom === 'string' ? custom : UNRENDERABLE_PLACEHOLDER;
      }
      if (Symbol.toPrimitive in value) {
        const prim = (value as {[Symbol.toPrimitive](hint: string): unknown})[
          Symbol.toPrimitive
        ]('string');
        return typeof prim === 'string' ? prim : UNRENDERABLE_PLACEHOLDER;
      }
      return renderPairs(Object.entries(value));
    }
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return value.name || '[Function]';
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value.toString();
    }
    return UNRENDERABLE_PLACEHOLDER;
  } catch {
    return UNRENDERABLE_PLACEHOLDER;
  }
}

/** Formats shallow scalar representations for elements inside collections to prevent unbounded recursion. */
function renderScalar(value: unknown): string {
  try {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'object') return Array.isArray(value) ? '[…]' : '{…}';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return value.name || '[Function]';
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return value.toString();
    }
    return UNRENDERABLE_PLACEHOLDER;
  } catch {
    return UNRENDERABLE_PLACEHOLDER;
  }
}

function renderPairs(pairs: readonly (readonly [unknown, unknown])[]): string {
  const rendered = pairs.map(
    ([key, entry]) => `${renderScalar(key)}=${renderScalar(entry)}`,
  );
  return `[${rendered.join(', ')}]`;
}

/** OBS-7: bounded to 8 KiB with a marker. Primitives never reach here (see renderField). */
function truncate(rendered: string): string {
  if (rendered.length <= MAX_FIELD_LENGTH) return rendered;
  let sliceEnd = MAX_FIELD_LENGTH;
  const lastCode = rendered.charCodeAt(sliceEnd - 1);
  // Avoid splitting a UTF-16 surrogate pair across the truncation boundary
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    sliceEnd -= 1;
  }
  return rendered.slice(0, sliceEnd) + TRUNCATION_MARKER;
}

/** OBS-40: throttles the reserved-key-collision warning to at most one emission per Logger instance. */
class CollisionWarningGate {
  private warned = false;
  public shouldWarn(): boolean {
    if (this.warned) return false;
    this.warned = true;
    return true;
  }
}

/** One object rather than six positional arguments -- `max-params: 3` applies to constructors too. */
interface LogEventInit {
  readonly level: LogLevel;
  readonly wiring: LoggerWiring;
  readonly diagnosticFields: Readonly<Record<string, string>>;
  readonly verboseEnabled: boolean;
}

class RealLogEvent implements LogEvent {
  private readonly level: LogLevel;
  private readonly sink: (
    level: LogLevel,
    fields: ReadonlyMap<string, unknown>,
  ) => void;
  private readonly collisionGate: CollisionWarningGate;
  private readonly verboseEnabled: boolean;
  private readonly fields: Map<string, unknown>;
  private eventTag: string | undefined;
  private emitted = false;

  public constructor(init: LogEventInit) {
    const {level, wiring, diagnosticFields, verboseEnabled} = init;
    this.level = level;
    this.sink = wiring.sink;
    this.collisionGate = wiring.collisionGate;
    this.verboseEnabled = verboseEnabled;
    const globalFields = wiring.globalFields;

    // Field precedence: diagnostic context < global context < per-event field < explicit event tag.
    this.fields = new Map();
    for (const [key, value] of Object.entries(diagnosticFields)) {
      this.fields.set(key, renderField(value));
    }
    for (const [key, value] of Object.entries(globalFields)) {
      this.fields.set(key, renderField(value));
    }
  }

  public field(key: string, value: unknown): this {
    invariant(
      typeof key === 'string' && key !== '',
      'LogEvent.field: key must not be empty',
    );
    if (key === RESERVED_EVENT_KEY) {
      if (this.verboseEnabled && this.collisionGate.shouldWarn()) {
        this.sink(
          'verbose',
          new Map<string, unknown>([
            [RESERVED_EVENT_KEY, COLLISION_WARNING_EVENT],
            [
              'message',
              'LogEvent.field: "event" is reserved; use event() to set it instead.',
            ],
          ]),
        );
      }
      return this;
    }
    this.fields.set(key, renderField(value));
    return this;
  }

  public event(name: string): this {
    invariant(
      typeof name === 'string',
      'LogEvent.event: name must be a string',
    );
    this.eventTag = name === '' ? undefined : name;
    return this;
  }

  public cause(error: unknown): this {
    this.fields.set('cause', renderField(error));
    return this;
  }

  public emit(): void {
    if (this.emitted) return;
    this.emitted = true;

    const withTag = new Map(this.fields);
    if (this.eventTag !== undefined) {
      withTag.set(RESERVED_EVENT_KEY, this.eventTag);
    }

    this.sink(this.level, withTag);
  }
}

/** OBS-1: one shared, allocation-minimal inert event -- every builder method returns `this`, emit() is a no-op. */
const NOOP_EVENT: LogEvent = Object.freeze({
  field(): LogEvent {
    return NOOP_EVENT;
  },
  event(): LogEvent {
    return NOOP_EVENT;
  },
  cause(): LogEvent {
    return NOOP_EVENT;
  },
  emit(): void {
    return;
  },
});

/**
 * The no-op default (OBS-1), installed process-wide until a consumer supplies a real one.
 *
 * @public
 */
export const NOOP_LOGGER: Logger = Object.freeze({
  atLevel(): LogEvent {
    return NOOP_EVENT;
  },
  withContext(): Logger {
    return NOOP_LOGGER;
  },
});

/**
 * Configuration options for {@link createLogger}.
 *
 * @public
 */
export interface CreateLoggerOptions {
  readonly globalFields?: Readonly<Record<string, unknown>> | undefined;
  /** OBS-10: default is trace.id and span.id; null folds every present diagnostic-context key. */
  readonly diagnosticAllowList?: readonly string[] | null | undefined;
  /** OBS-1: gates atLevel's allocation -- a disabled level returns NOOP_EVENT without building a real one. */
  readonly isLevelEnabled?: ((level: LogLevel) => boolean) | undefined;
}

/** Every field the built Logger closes over. One object, so no function here exceeds `max-params: 3`. */
interface LoggerWiring {
  readonly sink: (
    level: LogLevel,
    fields: ReadonlyMap<string, unknown>,
  ) => void;
  readonly globalFields: Readonly<Record<string, unknown>>;
  readonly diagnosticAllowList: readonly string[] | null;
  readonly isLevelEnabled: (level: LogLevel) => boolean;
  readonly collisionGate: CollisionWarningGate;
}

function buildLogger(wiring: LoggerWiring): Logger {
  return {
    atLevel(level: LogLevel): LogEvent {
      if (!wiring.isLevelEnabled(level)) return NOOP_EVENT;
      return new RealLogEvent({
        level,
        wiring,
        diagnosticFields: getDiagnosticContext(wiring.diagnosticAllowList),
        verboseEnabled: wiring.isLevelEnabled('verbose'),
      });
    },
    withContext(fields: Readonly<Record<string, unknown>>): Logger {
      invariant(
        typeof fields === 'object' && (fields as unknown) !== null,
        'Logger.withContext: fields must be an object',
      );
      for (const key of Object.keys(fields)) {
        invariant(key !== '', 'Logger.withContext: key must not be empty');
      }
      return buildLogger({
        ...wiring,
        globalFields: {...wiring.globalFields, ...fields},
      });
    },
  };
}

/**
 * The single concrete `Logger` builder every real backend constructs through.
 *
 * @param sink - callback receiving log events.
 * @param options - logger creation options.
 * @returns a configured {@link Logger}.
 *
 * @public
 */
export function createLogger(
  sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void,
  options: CreateLoggerOptions = {},
): Logger {
  invariant(
    typeof sink === 'function',
    'createLogger: sink must be a function',
  );

  return buildLogger({
    sink,
    globalFields: options.globalFields ?? {},
    diagnosticAllowList:
      options.diagnosticAllowList === undefined
        ? DEFAULT_DIAGNOSTIC_ALLOW_LIST
        : options.diagnosticAllowList,
    isLevelEnabled: options.isLevelEnabled ?? ((): boolean => true),
    collisionGate: new CollisionWarningGate(),
  });
}

let globalLogger: Logger = NOOP_LOGGER;

/**
 * Returns the process-wide global logger instance.
 *
 * @public
 */
export function getGlobalLogger(): Logger {
  return globalLogger;
}

/**
 * Sets the process-wide global logger instance.
 *
 * @param logger - the logger to install.
 *
 * @public
 */
export function setGlobalLogger(logger: Logger): void {
  invariant(
    (logger as unknown) !== null && (logger as unknown) !== undefined,
    'setGlobalLogger: logger is required',
  );
  invariant(
    typeof logger.atLevel === 'function',
    'setGlobalLogger: logger.atLevel must be a function',
  );
  globalLogger = logger;
}
