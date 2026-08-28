// SPDX-License-Identifier: MIT
// packages/logging-debug/src/debug-logger.test.ts
// Exercises: OBS-1..9, OBS-25, OBS-40
import {describe, expect, test} from 'bun:test';
import {createDebugLogger, type DebugLike} from './debug-logger.js';

describe('createDebugLogger', () => {
  test('single debug instance formatted output', () => {
    const formatted: string[] = [];
    const dbg: DebugLike = Object.assign(
      (formatter: string, ...args: unknown[]) => {
        formatted.push(`${formatter} -> ${args.join(' ')}`);
      },
      {enabled: true},
    );

    const logger = createDebugLogger(dbg);
    logger.atLevel('info').event('my.event').field('k', 'v').emit();

    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toContain('event=my.event');
    expect(formatted[0]).toContain('k=v');
  });

  test('debug factory with enabled function routes per level namespace', () => {
    const map = new Map<string, string[]>();
    const factory = Object.assign(
      (namespace: string): DebugLike => {
        const logs: string[] = [];
        map.set(namespace, logs);
        return Object.assign(
          (_formatter: string, ...args: unknown[]) => {
            logs.push(args.join(' '));
          },
          {enabled: namespace !== 'dexpace:verbose'},
        );
      },
      {
        enabled: () => true,
      },
    );

    const logger = createDebugLogger(factory, 'dexpace');

    logger.atLevel('info').event('info.event').emit();
    expect(map.get('dexpace:info')).toHaveLength(1);
    expect(map.get('dexpace:info')?.[0]).toContain('event=info.event');

    // verbose is disabled
    logger.atLevel('verbose').event('verbose.event').emit();
    expect(map.get('dexpace:verbose')).toHaveLength(0);
  });

  test('rejects non-function/non-object input', () => {
    expect(() => createDebugLogger(null as unknown as DebugLike)).toThrow();
  });
});
