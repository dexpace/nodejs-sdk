// SPDX-License-Identifier: MIT
// packages/core/src/observability/diagnostic-context.test.ts
// Exercises: OBS-10 (default allow-list {trace.id, span.id}, null allow-list folds all, null values skipped),
// OBS-24 (immutable snapshot bridge: capture, reinstall, restore including on throw).
import {describe, expect, test} from 'bun:test';
import {
  captureDiagnosticSnapshot,
  createAsyncScopedStore,
  getDiagnosticContext,
  pushDiagnosticFields,
  runWithSnapshot,
  withDiagnosticFields,
} from './diagnostic-context.js';

describe('allow-list folding (OBS-10)', () => {
  test('only trace.id/span.id fold by default', () => {
    withDiagnosticFields(
      {'trace.id': 't1', 'span.id': 's1', 'app.custom': 'x'},
      () => {
        const folded = getDiagnosticContext(['trace.id', 'span.id']);
        expect(folded).toEqual({'trace.id': 't1', 'span.id': 's1'});
      },
    );
  });

  test('a null allow-list folds every present key', () => {
    withDiagnosticFields({'trace.id': 't1', 'app.custom': 'x'}, () => {
      const folded = getDiagnosticContext(null);
      expect(folded).toEqual({'trace.id': 't1', 'app.custom': 'x'});
    });
  });

  test('keys with null or undefined values are skipped (OBS-10)', () => {
    withDiagnosticFields(
      {
        'trace.id': 't1',
        'span.id': null as unknown as string,
        'app.null': null as unknown as string,
      },
      () => {
        const folded = getDiagnosticContext(null);
        expect(folded).toEqual({'trace.id': 't1'});
        expect('span.id' in folded).toBe(false);
        expect('app.null' in folded).toBe(false);
      },
    );
  });

  test('prototype keys do not cause prototype pollution', () => {
    withDiagnosticFields(
      {['__proto__']: 'polluted', constructor: 'hacked'},
      () => {
        const folded = getDiagnosticContext(null);
        expect(Object.getPrototypeOf(folded)).toBe(Object.prototype);
        expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
        expect(Object.hasOwn(folded, '__proto__')).toBe(true);
        expect(folded.__proto__).toBe('polluted');
      },
    );
  });

  test('withDiagnosticFields and pushDiagnosticFields reject non-object inputs', () => {
    expect(() => {
      withDiagnosticFields(
        null as unknown as Record<string, string>,
        () => undefined,
      );
    }).toThrow();
    expect(() =>
      pushDiagnosticFields(null as unknown as Record<string, string>),
    ).toThrow();
  });

  test('outside any withDiagnosticFields scope, the context is empty', () => {
    expect(getDiagnosticContext(null)).toEqual({});
  });
});

describe('async propagation', () => {
  test('the context is visible after an await inside the scope', async () => {
    await withDiagnosticFields({'trace.id': 't1'}, async () => {
      await Promise.resolve();
      expect(getDiagnosticContext(null)['trace.id']).toBe('t1');
    });
  });

  test('nested scopes restore the outer context on exit', () => {
    withDiagnosticFields({'trace.id': 'outer'}, () => {
      withDiagnosticFields({'trace.id': 'inner'}, () => {
        expect(getDiagnosticContext(null)['trace.id']).toBe('inner');
      });
      expect(getDiagnosticContext(null)['trace.id']).toBe('outer');
    });
  });
});

describe('snapshot bridge (OBS-24)', () => {
  test('captures on the originating call and reinstalls on a detached callback', () => {
    let capturedInsideBridge: string | undefined;
    withDiagnosticFields({'trace.id': 'bridged'}, () => {
      const snapshot = captureDiagnosticSnapshot();
      // Simulate a callback invoked outside the tracked continuation (e.g. a raw event-emitter callback).
      setImmediate(() => {
        runWithSnapshot(snapshot, () => {
          capturedInsideBridge = getDiagnosticContext(null)['trace.id'];
        });
      });
    });
    return new Promise<void>(resolve => {
      setImmediate(() => {
        expect(capturedInsideBridge).toBe('bridged');
        resolve();
      });
    });
  });

  test('restores the prior context after the bridge, including when the guarded block throws', () => {
    withDiagnosticFields({'trace.id': 'prior'}, () => {
      const snapshot = captureDiagnosticSnapshot();
      expect(() => {
        runWithSnapshot(snapshot, () => {
          throw new Error('boom');
        });
      }).toThrow('boom');
      expect(getDiagnosticContext(null)['trace.id']).toBe('prior');
    });
  });
});

describe('pushDiagnosticFields', () => {
  test('pushes fields into scope and restores prior store on call handle', () => {
    withDiagnosticFields({'trace.id': 'prior'}, () => {
      const restore = pushDiagnosticFields({
        'trace.id': 'pushed',
        'span.id': 's1',
      });
      expect(getDiagnosticContext(null)).toEqual({
        'trace.id': 'pushed',
        'span.id': 's1',
      });
      restore();
      expect(getDiagnosticContext(null)).toEqual({'trace.id': 'prior'});
      // restore is idempotent
      restore();
      expect(getDiagnosticContext(null)).toEqual({'trace.id': 'prior'});
    });
  });

  test('top-level pushDiagnosticFields restores empty context after handle is closed', () => {
    expect(getDiagnosticContext(null)).toEqual({});
    const restore = pushDiagnosticFields({'trace.id': 't-top'});
    expect(getDiagnosticContext(null)['trace.id']).toBe('t-top');
    restore();
    expect(getDiagnosticContext(null)).toEqual({});
  });
});

describe('createAsyncScopedStore', () => {
  test('enter installs value and returned restore function resets prior value', () => {
    const store = createAsyncScopedStore<string>();
    expect(store.get()).toBeUndefined();
    const restore = store.enter('val1');
    expect(store.get()).toBe('val1');
    restore();
    expect(store.get()).toBeUndefined();
    // restore is idempotent
    restore();
    expect(store.get()).toBeUndefined();
  });
});
