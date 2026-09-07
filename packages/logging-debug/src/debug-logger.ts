// SPDX-License-Identifier: MIT
// packages/logging-debug/src/debug-logger.ts
// Exercises: OBS-1..9, OBS-25, OBS-40
import {
  createLogger,
  type CreateLoggerOptions,
  type Logger,
  type LogLevel,
} from '@dexpace/core';

/**
 * Structural subset of debug's Debugger so this package adds zero runtime dependencies beyond the core package.
 * A real debug instance duck-types directly into this shape.
 *
 * @public
 */
export interface DebugLike {
  enabled: boolean;
  (formatter: string, ...args: unknown[]): void;
}

/**
 * Factory creating DebugLike instances per namespace.
 *
 * @public
 */
export type DebugFactory = (namespace: string) => DebugLike;

/**
 * Creates a Logger adapter wrapping a debug instance or factory.
 *
 * @param debugOrFactory - debug function or factory.
 * @param namespace - base namespace (default: 'dexpace').
 * @param options - optional creation options such as diagnostic allow list.
 * @returns a Logger routing to debug.
 *
 * @public
 */
export function createDebugLogger(
  debugOrFactory: DebugLike | DebugFactory,
  namespace = 'dexpace',
  options?: Omit<CreateLoggerOptions, 'isLevelEnabled'>,
): Logger {
  if (
    (debugOrFactory as unknown) === null ||
    (typeof debugOrFactory !== 'function' && typeof debugOrFactory !== 'object')
  ) {
    throw new TypeError(
      'createDebugLogger: debug instance or factory is required',
    );
  }

  const isSingleDebugger =
    typeof (debugOrFactory as {enabled?: unknown}).enabled === 'boolean';

  const debuggers = new Map<LogLevel, DebugLike>();
  const getDebugger = (level: LogLevel): DebugLike => {
    if (isSingleDebugger) {
      return debugOrFactory as DebugLike;
    }
    let dbg = debuggers.get(level);
    if (dbg === undefined) {
      dbg = (debugOrFactory as DebugFactory)(`${namespace}:${level}`);
      debuggers.set(level, dbg);
    }
    return dbg;
  };

  return createLogger(
    (level, fields) => {
      const dbg = getDebugger(level);
      const parts: string[] = [];
      for (const [k, v] of fields) parts.push(`${k}=${String(v)}`);
      dbg('%s', parts.join(' '));
    },
    {
      ...options,
      isLevelEnabled: (level: LogLevel): boolean => getDebugger(level).enabled,
    },
  );
}
