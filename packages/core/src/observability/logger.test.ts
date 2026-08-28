// SPDX-License-Identifier: MIT
// packages/core/src/observability/logger.test.ts
// Exercises: OBS-1 (disabled path allocates/emits nothing, shared singleton event), OBS-3 (empty key
// rejected, null value emitted as literal "null"), OBS-4 (event() reserved-key precedence and single
// occurrence), OBS-5 (per-event > global > diagnostic-context precedence, actually wired through
// createLogger), OBS-6 (total field rendering), OBS-7 (truncation), OBS-8 (single-emit guard), OBS-9 (global
// context on every event), OBS-40 (once-per-logger reserved-key-collision warning, gated on verbose enabled,
// never fired for an ambient collision arriving via diagnostic context).
import {afterEach, describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {withDiagnosticFields} from './diagnostic-context.js';
import {
  NOOP_LOGGER,
  createLogger,
  getGlobalLogger,
  setGlobalLogger,
  type Logger,
  type LogEvent,
} from './logger.js';

function collectingLogger(): {
  logger: Logger;
  emitted: Record<string, unknown>[];
} {
  const emitted: Record<string, unknown>[] = [];
  function makeEvent(
    globalFields: Readonly<Record<string, unknown>>,
  ): LogEvent {
    const fields: Record<string, unknown> = {...globalFields};
    let emittedOnce = false;
    return {
      field(key, value) {
        if (key === '') throw new RangeError('field key must not be empty');
        fields[key] = value === null ? 'null' : value;
        return this;
      },
      event(name) {
        if (name === '') delete fields.event;
        else fields.event = name;
        return this;
      },
      cause(error) {
        fields.cause = error;
        return this;
      },
      emit() {
        if (emittedOnce) return;
        emittedOnce = true;
        emitted.push({...fields});
      },
    };
  }
  const logger: Logger = {
    atLevel: () => makeEvent({}),
    withContext(context) {
      return {
        atLevel: () => makeEvent(context),
        withContext: (ctx: Readonly<Record<string, unknown>>) =>
          logger.withContext(ctx),
      };
    },
  };
  return {logger, emitted};
}

describe('the no-op default (OBS-1)', () => {
  test('the disabled event is a shared singleton across calls', () => {
    const noop = getGlobalLogger();
    setGlobalLogger(noop); // ensure default state for this test
    const first = getGlobalLogger().atLevel('verbose');
    const second = getGlobalLogger().atLevel('verbose');
    expect(first).toBe(second);
  });

  test('every builder method returns the same event and emit is a no-op', () => {
    const event = getGlobalLogger().atLevel('info');
    expect(event.field('k', 'v')).toBe(event);
    expect(event.event('x')).toBe(event);
    expect(event.cause(new Error('x'))).toBe(event);
    expect(() => {
      event.emit();
    }).not.toThrow();
    expect(NOOP_LOGGER.withContext({k: 'v'})).toBe(NOOP_LOGGER);
  });
});

describe('global logger slot (mirrors CFG-13)', () => {
  // This block is the only one that mutates the module-level global slot -- restore the no-op default after
  // every test so no later test file (or a later test in this one, if execution order ever changes) observes
  // a logger some earlier test installed. The Global Constraints section requires exactly this discipline.
  afterEach(() => {
    setGlobalLogger(NOOP_LOGGER);
  });

  test('last-write-wins: getGlobalLogger returns the same instance after set', () => {
    const {logger} = collectingLogger();
    setGlobalLogger(logger);
    expect(getGlobalLogger()).toBe(logger);
  });

  test('defaults to the no-op logger when nothing has been set', () => {
    expect(getGlobalLogger()).toBe(NOOP_LOGGER);
  });

  test('rejects null or non-logger input', () => {
    expect(() => {
      setGlobalLogger(null as unknown as Logger);
    }).toThrow();
    expect(() => {
      setGlobalLogger({} as unknown as Logger);
    }).toThrow();
  });
});

describe('field/event semantics (OBS-3, OBS-4)', () => {
  test('an empty field key throws', () => {
    const {logger} = collectingLogger();
    expect(() => logger.atLevel('info').field('', 'x')).toThrow();
  });

  test('a null field value is emitted as the literal string "null"', () => {
    const {logger, emitted} = collectingLogger();
    logger.atLevel('info').field('k', null).emit();
    expect(emitted[0]?.k).toBe('null');
  });

  test('event(name) sets the reserved key exactly once; an empty name clears it', () => {
    const {logger, emitted} = collectingLogger();
    logger.atLevel('info').event('x').emit();
    expect(emitted[0]?.event).toBe('x');

    const {logger: logger2, emitted: emitted2} = collectingLogger();
    logger2.atLevel('info').event('x').event('').emit();
    expect(emitted2[0]?.event).toBeUndefined();
  });
});

describe('single-emit guard (OBS-8)', () => {
  test('a second terminal emit is a no-op', () => {
    const {logger, emitted} = collectingLogger();
    const event = logger.atLevel('info').field('k', 1);
    event.emit();
    event.emit();
    expect(emitted).toHaveLength(1);
  });
});

describe('global context (OBS-9)', () => {
  test('a global field configured via withContext attaches to every event', () => {
    const {logger, emitted} = collectingLogger();
    const withGlobal = logger.withContext({service: 'dexpace'});
    withGlobal.atLevel('info').emit();
    withGlobal.atLevel('info').field('extra', 1).emit();
    expect(emitted[0]?.service).toBe('dexpace');
    expect(emitted[1]?.service).toBe('dexpace');
  });

  test('withContext rejects null or empty field key', () => {
    const logger = createLogger(() => undefined);
    expect(() =>
      logger.withContext(null as unknown as Record<string, unknown>),
    ).toThrow();
    expect(() => logger.withContext({'': 'bad'})).toThrow();
  });
});

describe('createLogger: diagnostic-context folding and full precedence (OBS-5)', () => {
  function recordingLogger(options?: Parameters<typeof createLogger>[1]): {
    logger: Logger;
    emitted: ReadonlyMap<string, unknown>[];
  } {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger(
      (_level, fields) => emitted.push(fields),
      options,
    );
    return {logger, emitted};
  }

  test('folds diagnostic-context fields when nothing else overrides them', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 't1', 'span.id': 's1'}, () => {
      logger.atLevel('info').emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('t1');
    expect(emitted[0]?.get('span.id')).toBe('s1');
  });

  test('global context (withContext) wins over folded diagnostic context for the same key', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 'from-diagnostic'}, () => {
      logger.withContext({'trace.id': 'from-global'}).atLevel('info').emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('from-global');
  });

  test('a per-event field wins over both global context and folded diagnostic context', () => {
    const {logger, emitted} = recordingLogger();
    withDiagnosticFields({'trace.id': 'from-diagnostic'}, () => {
      logger
        .withContext({'trace.id': 'from-global'})
        .atLevel('info')
        .field('trace.id', 'from-event')
        .emit();
    });
    expect(emitted[0]?.get('trace.id')).toBe('from-event');
  });

  test('outside any diagnostic-context scope, no diagnostic fields are folded', () => {
    const {logger, emitted} = recordingLogger();
    logger.atLevel('info').emit();
    expect(emitted[0]?.has('trace.id')).toBe(false);
  });
});

describe('createLogger: reserved-key collision warning (OBS-40)', () => {
  test('warns exactly once per logger, ambient keys never trigger it', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger.atLevel('info').field('event', 'x').emit(); // explicit collision, attempt 1
    logger.atLevel('info').field('event', 'y').emit(); // explicit collision, attempt 2 -- must not re-warn

    const warnings = emitted.filter(
      f => f.get('event') === 'dexpace.logger.reservedKeyCollision',
    );
    expect(warnings).toHaveLength(1);
  });

  test('never warns when verbose is disabled for this logger', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields), {
      isLevelEnabled: level => level !== 'verbose',
    });

    logger.atLevel('info').field('event', 'x').emit();

    expect(
      emitted.some(
        f => f.get('event') === 'dexpace.logger.reservedKeyCollision',
      ),
    ).toBe(false);
  });

  test('an ambient "event" key folded from diagnostic context is never warned about', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    withDiagnosticFields({event: 'ambient-value'}, () => {
      logger.atLevel('info').emit();
    });

    expect(
      emitted.some(
        f => f.get('event') === 'dexpace.logger.reservedKeyCollision',
      ),
    ).toBe(false);
  });
});

describe('createLogger: total field rendering (OBS-6)', () => {
  function render(value: unknown): unknown {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    createLogger((_level, fields) => emitted.push(fields))
      .atLevel('info')
      .field('k', value)
      .emit();
    return emitted[0]?.get('k');
  }

  test('an Error renders as "Name: message"', () => {
    expect(render(new TypeError('boom'))).toBe('TypeError: boom');
  });

  test('numeric and boolean primitives pass through type-preserving', () => {
    expect(render(42)).toBe(42);
    expect(render(false)).toBe(false);
    expect(render(100n)).toBe(100n);
  });

  test('an array, a Map, and a Set each render to a bracketed form carrying their entries', () => {
    expect(render([1, 2])).toBe('[1, 2]');
    expect(render(new Set(['a']))).toBe('[a]');
    expect(render(new Map([['a', 1]]))).toBe('[a=1]');
    expect(render({a: 1})).toBe('[a=1]');
  });

  test('a value whose toString throws renders as the placeholder rather than propagating', () => {
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };
    expect(render(hostile)).toBe('[unrenderable value]');
  });
});

describe('createLogger: truncation and robust rendering (OBS-7)', () => {
  function render(value: unknown): unknown {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    createLogger((_level, fields) => emitted.push(fields))
      .atLevel('info')
      .field('k', value)
      .emit();
    return emitted[0]?.get('k');
  }

  test('an oversized string is truncated with a marker (OBS-7)', () => {
    const rendered = String(render('x'.repeat(10_000)));
    expect(rendered.length).toBeLessThan(10_000);
    expect(rendered.endsWith('…[truncated]')).toBe(true);
  });

  test('property: rendering never throws for any value', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        expect(() => render(value)).not.toThrow();
      }),
    );
  });

  test('unicode surrogate pair at truncation boundary is not sliced in half', () => {
    const emoji = '😀'; // \uD83D\uDE00
    const str = 'a'.repeat(8191) + emoji + 'b'.repeat(100);
    const rendered = String(render(str));
    expect(rendered.endsWith('…[truncated]')).toBe(true);
    const beforeMarker = rendered.slice(0, -'…[truncated]'.length);
    const lastCode = beforeMarker.charCodeAt(beforeMarker.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
  });
});

describe('createLogger: hostile and edge-case rendering (OBS-6)', () => {
  function render(value: unknown): unknown {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    createLogger((_level, fields) => emitted.push(fields))
      .atLevel('info')
      .field('k', value)
      .emit();
    return emitted[0]?.get('k');
  }

  test('a global-context value is rendered too, not passed raw to the sink', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const hostile = {
      toString(): string {
        throw new Error('nope');
      },
    };
    createLogger((_level, fields) => emitted.push(fields))
      .withContext({k: hostile})
      .atLevel('info')
      .emit();
    expect(emitted[0]?.get('k')).toBe('[unrenderable value]');
  });

  test('hostile toString returning non-string is rendered safely as placeholder (OBS-6)', () => {
    expect(render({toString: () => undefined})).toBe('[unrenderable value]');
    expect(render({toString: () => null})).toBe('[unrenderable value]');
    expect(render({toString: () => ({nested: 1})})).toBe(
      '[unrenderable value]',
    );
    expect(render({[Symbol.toPrimitive]: () => null})).toBe(
      '[unrenderable value]',
    );
  });

  test('LogEvent.field and event reject non-string keys/names', () => {
    const logger = createLogger(() => undefined);
    const event = logger.atLevel('info');
    expect(() => event.field(null as unknown as string, 'val')).toThrow();
    expect(() => event.field(123 as unknown as string, 'val')).toThrow();
    expect(() => event.event(null as unknown as string)).toThrow();
  });

  test('cause sets the cause field', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));
    const err = new Error('test-err');
    logger.atLevel('error').cause(err).emit();
    expect(emitted[0]?.get('cause')).toBe('Error: test-err');
  });
});

describe('createLogger: the reserved key survives when no tag is set (OBS-4, OBS-9)', () => {
  test('an ambient global-context "event" key is emitted when event() was never called', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger.withContext({event: 'app.ambient'}).atLevel('info').emit();

    expect(emitted[0]?.get('event')).toBe('app.ambient');
  });

  test('a set tag suppresses the ambient key, carrying "event" exactly once', () => {
    const emitted: ReadonlyMap<string, unknown>[] = [];
    const logger = createLogger((_level, fields) => emitted.push(fields));

    logger
      .withContext({event: 'app.ambient'})
      .atLevel('info')
      .event('http.request')
      .emit();

    expect(emitted[0]?.get('event')).toBe('http.request');
  });
});

describe('createLogger: disabled levels allocate nothing (OBS-1)', () => {
  test('atLevel returns the shared NOOP_EVENT-equivalent when the level is disabled, sink is never called', () => {
    const logger = createLogger(
      () => {
        throw new Error('sink must not be called for a disabled level');
      },
      {isLevelEnabled: level => level !== 'verbose'},
    );

    const event = logger.atLevel('verbose');
    expect(event.field('k', 'v')).toBe(event);
    expect(() => {
      event.emit();
    }).not.toThrow();
  });
});
