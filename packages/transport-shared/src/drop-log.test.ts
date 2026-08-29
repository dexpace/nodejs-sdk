// SPDX-License-Identifier: MIT
// packages/transport-shared/src/drop-log.test.ts
// Exercises: TRANSPORT-13 (HeaderDropLogging: all, first-per-name, quiet; bounded case-insensitive dedup)
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {getGlobalLogger, setGlobalLogger, type Logger} from '@dexpace/core';
import {createDropLogger} from './drop-log.js';

let logged: {event?: string; fields: Record<string, unknown>}[] = [];
let originalLogger: Logger;

beforeEach(() => {
  logged = [];
  originalLogger = getGlobalLogger();
  setGlobalLogger({
    atLevel: () => {
      const entry: {event?: string; fields: Record<string, unknown>} = {
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

  test('mode all logs every occurrence', () => {
    const logger = createDropLogger('all');
    logger(['Content-Length']);
    logger(['content-length']);
    expect(logged.length).toBe(2);
  });

  test('mode first-per-name dedups case-insensitively', () => {
    const logger = createDropLogger('first-per-name');
    logger(['Content-Length']);
    logger(['content-length']);
    logger(['X-Custom']);
    expect(logged.length).toBe(2);
    expect(logged[0]?.fields).toEqual({header: 'content-length'});
    expect(logged[1]?.fields).toEqual({header: 'x-custom'});
  });

  test('bounded dedup drains to MAX_LOGGED_DROP_NAMES', () => {
    const logger = createDropLogger('first-per-name');
    const names = Array.from({length: 150}, (_, i) => `x-header-${String(i)}`);
    logger(names);
    expect(logged.length).toBe(150);
  });
});
