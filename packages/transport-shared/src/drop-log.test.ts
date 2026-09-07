// SPDX-License-Identifier: MIT
// packages/transport-shared/src/drop-log.test.ts
// Exercises: TRANSPORT-13 (HeaderDropLogging: all, first-per-name, quiet; bounded case-insensitive dedup),
// OBS-19 (the verbosity policy's LEVELS: warn every occurrence; warn the first drop per name then verbose)
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {
  getGlobalLogger,
  setGlobalLogger,
  type Logger,
  type LogLevel,
} from '@dexpace/core';
import {createDropLogger} from './drop-log.js';

let logged: {
  level: LogLevel;
  event?: string;
  fields: Record<string, unknown>;
}[] = [];
let originalLogger: Logger;

beforeEach(() => {
  logged = [];
  originalLogger = getGlobalLogger();
  setGlobalLogger({
    atLevel: (level: LogLevel) => {
      const entry: {
        level: LogLevel;
        event?: string;
        fields: Record<string, unknown>;
      } = {
        level,
        fields: {},
      };
      const mockEvent = {
        event: (name: string) => {
          entry.event = name;
          return mockEvent;
        },
        field: (key: string, value: unknown) => {
          entry.fields[key] = value;
          return mockEvent;
        },
        cause: () => mockEvent,
        emit: () => {
          logged.push(entry);
        },
      };
      return mockEvent;
    },
    withContext: () => originalLogger,
  });
});

afterEach(() => {
  setGlobalLogger(originalLogger);
});

describe('createDropLogger (TRANSPORT-13)', () => {
  test('mode quiet logs nothing', () => {
    const logger = createDropLogger('quiet');
    logger(['Content-Length', 'Host']);
    expect(logged.length).toBe(0);
  });

  test('mode all logs every occurrence, every one loudly (OBS-19)', () => {
    const logger = createDropLogger('all');
    logger(['Content-Length']);
    logger(['content-length']);
    expect(logged.length).toBe(2);
    expect(logged.map(l => l.level)).toEqual(['warning', 'warning']);
  });

  test('mode first-per-name warns once per name, then goes verbose (OBS-19)', () => {
    const logger = createDropLogger('first-per-name');
    logger(['Content-Length']);
    logger(['content-length']);
    logger(['X-Custom']);
    expect(logged.length).toBe(3);
    expect(logged.map(l => l.level)).toEqual(['warning', 'verbose', 'warning']);
    expect(logged.map(l => l.fields)).toEqual([
      {header: 'content-length'},
      {header: 'content-length'},
      {header: 'x-custom'},
    ]);
  });

  test('bounded dedup drains to MAX_LOGGED_DROP_NAMES', () => {
    const logger = createDropLogger('first-per-name');
    const names = Array.from({length: 150}, (_, i) => `x-header-${String(i)}`);
    logger(names);
    expect(logged.length).toBe(150);
    expect(logged.every(l => l.level === 'warning')).toBe(true);
  });
});
