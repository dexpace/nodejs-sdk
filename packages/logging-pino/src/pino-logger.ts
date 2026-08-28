// SPDX-License-Identifier: MIT
// packages/logging-pino/src/pino-logger.ts
// Exercises: OBS-1..9, OBS-25, OBS-40
import {
  createLogger,
  type CreateLoggerOptions,
  type Logger,
  type LogLevel,
} from '@dexpace/core';

/**
 * Structural subset of pino's Logger so this package adds zero runtime dependencies beyond the core package.
 * A real pino instance duck-types directly into this shape.
 *
 * @public
 */
export interface PinoLike {
  isLevelEnabled(level: string): boolean;
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
  trace(obj: object, msg?: string): void;
}

const LEVEL_MAP: Record<LogLevel, 'error' | 'warn' | 'info' | 'debug'> = {
  error: 'error',
  warning: 'warn',
  info: 'info',
  verbose: 'debug',
};

/**
 * Creates a Logger adapter wrapping a pino instance.
 *
 * @param pino - the pino logger instance or compatible object.
 * @param options - optional creation options such as diagnostic allow list.
 * @returns a Logger routing to pino.
 *
 * @public
 */
export function createPinoLogger(
  pino: PinoLike,
  options?: Omit<CreateLoggerOptions, 'isLevelEnabled'>,
): Logger {
  if ((pino as unknown) === null || typeof pino !== 'object') {
    throw new TypeError('createPinoLogger: pino instance is required');
  }
  if (typeof pino.isLevelEnabled !== 'function') {
    throw new TypeError(
      'createPinoLogger: pino.isLevelEnabled must be a function',
    );
  }
  return createLogger(
    (level, fields) => {
      const pinoLevel = LEVEL_MAP[level];
      const obj = Object.fromEntries(fields);
      pino[pinoLevel](obj);
    },
    {
      ...options,
      isLevelEnabled: (level: LogLevel): boolean =>
        pino.isLevelEnabled(LEVEL_MAP[level]),
    },
  );
}
