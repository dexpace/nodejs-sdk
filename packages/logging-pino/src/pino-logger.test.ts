// SPDX-License-Identifier: MIT
// packages/logging-pino/src/pino-logger.test.ts
import {describe, expect, test} from 'bun:test';
import {createPinoLogger, type PinoLike} from './pino-logger.js';

describe('createPinoLogger', () => {
  test('maps SDK log levels to pino methods and checks isLevelEnabled', () => {
    const calls: {level: string; obj: Record<string, unknown>}[] = [];
    const pino: PinoLike = {
      isLevelEnabled: (level: string) => level !== 'debug',
      error: (obj: object) =>
        calls.push({level: 'error', obj: obj as Record<string, unknown>}),
      warn: (obj: object) =>
        calls.push({level: 'warn', obj: obj as Record<string, unknown>}),
      info: (obj: object) =>
        calls.push({level: 'info', obj: obj as Record<string, unknown>}),
      debug: (obj: object) =>
        calls.push({level: 'debug', obj: obj as Record<string, unknown>}),
      trace: (obj: object) =>
        calls.push({level: 'trace', obj: obj as Record<string, unknown>}),
    };

    const logger = createPinoLogger(pino);

    logger.atLevel('info').event('test.event').field('k', 'v').emit();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe('info');
    expect(calls[0]?.obj.event).toBe('test.event');
    expect(calls[0]?.obj.k).toBe('v');

    // verbose is mapped to debug, which is disabled in isLevelEnabled
    logger.atLevel('verbose').event('debug.event').emit();
    expect(calls).toHaveLength(1);
  });

  test('rejects null or non-pino input', () => {
    expect(() => createPinoLogger(null as unknown as PinoLike)).toThrow();
    expect(() => createPinoLogger({} as unknown as PinoLike)).toThrow();
  });
});
