// SPDX-License-Identifier: MIT
// packages/core/src/config/configuration.test.ts
// Exercises: CFG-1 (strict layered precedence), CFG-2 (an empty environment value is absent), CFG-3
// (normalized property key), CFG-4 (raw property accessor, no normalization), CFG-5/CFG-6/CFG-7
// (never-throw typed accessors; CFG-7's grammar itself is duration.test.ts's), CFG-8 (immutable,
// override map copied at build), CFG-9 (copy-on-write derive), CFG-10 (remove drops only the
// override layer), CFG-11 (substitutable env/property seams, production default delegates to the
// platform environment), CFG-13 (global slot, last-write-wins), CFG-37 (fail-fast when a required
// argument is not the shape its parameter names), CFG-38 (typed accessors resolve through the full
// layered lookup).
// CFG-12 is deliberately untested: `docs/open-items.md` K3 records that a single-threaded-use
// statement has no observable behavior in this runtime to assert.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import {randomUuid} from './identifiers.js';
import {
  CFG_KEY_HTTPS_PROXY,
  CFG_KEY_HTTP_PROXY,
  CFG_KEY_LOG_LEVEL,
  CFG_KEY_MAX_RETRY_ATTEMPTS,
  CFG_KEY_NO_PROXY,
  ConfigurationBuilder,
  defaultConfiguration,
  getGlobalConfiguration,
  setGlobalConfiguration,
} from './configuration.js';

// Captured before any test writes the slot, so "defaults to an empty configuration" stays a real
// claim no matter what order the tests below run in.
const GLOBAL_AT_LOAD = getGlobalConfiguration();

function sourceOf(
  entries: Record<string, string>,
): (key: string) => string | undefined {
  return key => entries[key];
}

describe('layered precedence (CFG-1)', () => {
  test('resolves the override ahead of the environment', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(sourceOf({X: 'from-env'}))
      .put('X', 'from-override')
      .build();

    expect(config.getString('X', 'from-default')).toBe('from-override');
  });

  test('resolves the environment ahead of the property layer', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(sourceOf({X: 'from-env'}))
      .withPropertySource(sourceOf({x: 'from-property'}))
      .build();

    expect(config.getString('X', 'from-default')).toBe('from-env');
  });

  test('resolves the property layer ahead of the default', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource(sourceOf({x: 'from-property'}))
      .build();

    expect(config.getString('X', 'from-default')).toBe('from-property');
  });

  test('resolves the default when no layer supplies a value', () => {
    const config = new ConfigurationBuilder().build();

    expect(config.getString('X', 'from-default')).toBe('from-default');
  });

  test('resolves undefined when no layer supplies a value and no default is given', () => {
    const config = new ConfigurationBuilder().build();

    expect(config.getString('X')).toBeUndefined();
  });
});

describe('empty environment values (CFG-2)', () => {
  test('falls through to the property layer when the environment value is empty', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(() => '')
      .withPropertySource(sourceOf({x: 'from-property'}))
      .build();

    expect(config.getString('X')).toBe('from-property');
  });

  test('falls through to the default when the environment value is empty and no property exists', () => {
    const config = new ConfigurationBuilder().withEnvSource(() => '').build();

    expect(config.getString('X', 'from-default')).toBe('from-default');
  });
});

describe('property key normalization (CFG-3, CFG-4)', () => {
  test('queries the property layer under the lower-cased, dotted key', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource(sourceOf({'max.retry.attempts': '5'}))
      .build();

    expect(config.getString('MAX_RETRY_ATTEMPTS')).toBe('5');
  });

  test('resolves a camelCase property-only key through the raw accessor', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource(sourceOf({'https.proxyHost': 'proxy.example.com'}))
      .build();

    expect(config.getRawProperty('https.proxyHost')).toBe('proxy.example.com');
  });

  test('does not resolve a camelCase property-only key through the normalizing accessor', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource(sourceOf({'https.proxyHost': 'proxy.example.com'}))
      .build();

    expect(config.getString('https.proxyHost')).toBeUndefined();
  });

  test('falls back when the raw accessor finds nothing', () => {
    const config = new ConfigurationBuilder().build();

    expect(config.getRawProperty('https.proxyHost', 'fallback')).toBe(
      'fallback',
    );
  });
});

describe('getInt (CFG-5, CFG-38)', () => {
  test('resolves the default when the key is absent', () => {
    expect(new ConfigurationBuilder().build().getInt('X', 42)).toBe(42);
  });

  test('resolves the default when the value is not an integer', () => {
    const config = new ConfigurationBuilder().put('X', 'not-a-number').build();

    expect(config.getInt('X', 42)).toBe(42);
  });

  test('resolves the default for a value with a trailing non-digit tail', () => {
    const config = new ConfigurationBuilder().put('X', '12abc').build();

    expect(config.getInt('X', 42)).toBe(42);
  });

  test('resolves the default for a fractional value', () => {
    const config = new ConfigurationBuilder().put('X', '1.5').build();

    expect(config.getInt('X', 42)).toBe(42);
  });

  test('normalizes a negative zero onto positive zero', () => {
    const config = new ConfigurationBuilder().put('X', '-0').build();

    expect(Object.is(config.getInt('X', -1), 0)).toBe(true);
  });

  test('returns a negative integer as-is', () => {
    const config = new ConfigurationBuilder().put('X', '-5').build();

    expect(config.getInt('X', 0)).toBe(-5);
  });

  test('resolves through the layered lookup, not the override map alone', () => {
    const config = new ConfigurationBuilder().withEnvSource(() => '7').build();

    expect(config.getInt('X', 0)).toBe(7);
  });
});

describe('getBoolean (CFG-6, CFG-38)', () => {
  test('accepts true and false case-insensitively', () => {
    const yes = new ConfigurationBuilder().put('X', 'TRUE').build();
    const no = new ConfigurationBuilder().put('X', 'False').build();

    expect(yes.getBoolean('X', false)).toBe(true);
    expect(no.getBoolean('X', true)).toBe(false);
  });

  test('rejects a truthy-looking value that is not literally true', () => {
    for (const value of ['1', 'yes', 'on']) {
      const config = new ConfigurationBuilder().put('X', value).build();

      expect(config.getBoolean('X', false)).toBe(false);
    }
  });

  test('rejects a falsy-looking value that is not literally false', () => {
    // Asserted against a `true` fallback deliberately. Under a `false` fallback a lenient parser that
    // read `'0'`/`'no'`/`'off'` as `false` would return exactly what the fallback returns, so the test
    // could not tell CFG-6's strict grammar from a permissive one.
    for (const value of ['0', 'no', 'off']) {
      const config = new ConfigurationBuilder().put('X', value).build();

      expect(config.getBoolean('X', true)).toBe(true);
    }
  });

  test('resolves through the layered lookup, not the override map alone', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(() => 'true')
      .build();

    expect(config.getBoolean('X', false)).toBe(true);
  });
});

describe('getDuration (CFG-7, CFG-38)', () => {
  // The grammar itself is duration.test.ts's; what belongs here is the accessor's own contract --
  // the layered lookup runs first, and a rejected value becomes the caller's fallback, never a throw.
  function durationOf(raw: string, fallback = 0): number {
    return new ConfigurationBuilder()
      .put('X', raw)
      .build()
      .getDuration('X', fallback);
  }

  test('returns the parsed duration when the value is one', () => {
    expect(durationOf('PT5S')).toBe(5000);
    expect(durationOf('500ms')).toBe(500);
    expect(durationOf('1000')).toBe(1000);
  });

  test('falls back to the caller default when the grammar rejects the value', () => {
    expect(durationOf('PT-5S', 99)).toBe(99);
    expect(durationOf('5x', 99)).toBe(99);
  });

  test('falls back to the caller default when no layer supplies a value', () => {
    expect(new ConfigurationBuilder().build().getDuration('X', 99)).toBe(99);
  });

  test('resolves through the layered lookup, not the override map alone', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(() => 'PT2S')
      .build();

    expect(config.getDuration('X', 0)).toBe(2000);
  });

  test('never throws for an arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        const config = new ConfigurationBuilder().put('X', value).build();

        expect(() => config.getDuration('X', 7)).not.toThrow();
      }),
    );
  });
});

describe('immutability (CFG-8)', () => {
  test('is unaffected by builder mutation after build', () => {
    const builder = new ConfigurationBuilder().put('X', 'original');
    const config = builder.build();

    builder.put('X', 'mutated-after-build');

    expect(config.getString('X')).toBe('original');
  });

  test('is frozen', () => {
    const config = new ConfigurationBuilder().build();

    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('derive (CFG-9, CFG-10)', () => {
  test('leaves the receiver unchanged', () => {
    const base = new ConfigurationBuilder().put('X', 'base').build();

    const derived = base.derive(builder => {
      builder.put('X', 'derived');
    });

    expect(base.getString('X')).toBe('base');
    expect(derived.getString('X')).toBe('derived');
  });

  test('inherits the source seams by reference', () => {
    const base = new ConfigurationBuilder()
      .withEnvSource(sourceOf({Y: 'env-y'}))
      .build();

    const derived = base.derive(builder => {
      builder.put('X', 'derived');
    });

    expect(derived.getString('Y')).toBe('env-y');
  });

  test('detaches only the copy when the mutator replaces a source', () => {
    const base = new ConfigurationBuilder()
      .withEnvSource(sourceOf({Y: 'env-y'}))
      .build();

    const derived = base.derive(builder => {
      builder.withEnvSource(sourceOf({Y: 'replaced'}));
    });

    expect(base.getString('Y')).toBe('env-y');
    expect(derived.getString('Y')).toBe('replaced');
  });

  test('drops only the override layer on remove, falling through to the environment', () => {
    const base = new ConfigurationBuilder()
      .withEnvSource(sourceOf({X: 'from-env'}))
      .put('X', 'from-override')
      .build();

    const derived = base.derive(builder => {
      builder.remove('X');
    });

    expect(derived.getString('X', 'from-default')).toBe('from-env');
  });

  test('treats removing a key with no override as a no-op', () => {
    const base = new ConfigurationBuilder()
      .withEnvSource(sourceOf({X: 'from-env'}))
      .build();

    const derived = base.derive(builder => {
      builder.remove('X');
    });

    expect(derived.getString('X')).toBe('from-env');
  });
});

describe('substitutable seams (CFG-11)', () => {
  test('routes the environment lookup through the injected function, verbatim', () => {
    const seen: string[] = [];
    const config = new ConfigurationBuilder()
      .withEnvSource(key => {
        seen.push(key);
        return undefined;
      })
      .build();

    config.getString('SOME_KEY');

    expect(seen).toEqual(['SOME_KEY']);
  });

  test('routes the property lookup through the injected function, normalized', () => {
    const seen: string[] = [];
    const config = new ConfigurationBuilder()
      .withPropertySource(key => {
        seen.push(key);
        return undefined;
      })
      .build();

    config.getString('SOME_KEY');

    expect(seen).toEqual(['some.key']);
  });

  test('delegates the production default to the ambient environment', () => {
    // A fresh key per run, drawn from the package's own generator rather than the clock: two
    // same-millisecond runs of this file would otherwise pick the same name and race on real
    // `process.env` (`docs/knowledge/harvested/testing.md:36`, `:50`).
    const key = `DEXPACE_TEST_${randomUuid().replaceAll('-', '')}`;
    const host = globalThis as {
      process?: {env?: Record<string, string | undefined>};
    };
    const environment = host.process?.env;
    expect(environment).toBeDefined();
    if (environment === undefined) return;
    environment[key] = 'from-real-env';

    try {
      expect(defaultConfiguration().getString(key)).toBe('from-real-env');
    } finally {
      Reflect.deleteProperty(environment, key);
    }
  });

  test('leaves the production property seam empty, since Node has no such store', () => {
    expect(
      defaultConfiguration().getRawProperty('https.proxyHost'),
    ).toBeUndefined();
  });
});

describe('the global slot (CFG-13)', () => {
  test('defaults to an empty configuration', () => {
    expect(GLOBAL_AT_LOAD.getString('X', 'from-default')).toBe('from-default');
  });

  test('returns the instance most recently written, last-write-wins', () => {
    const first = new ConfigurationBuilder().put('X', 'first').build();
    const second = new ConfigurationBuilder().put('X', 'second').build();

    setGlobalConfiguration(first);
    setGlobalConfiguration(second);

    try {
      expect(getGlobalConfiguration()).toBe(second);
    } finally {
      setGlobalConfiguration(GLOBAL_AT_LOAD);
    }
  });
});

describe('well-known keys (CFG-14)', () => {
  test('exposes a stable constant per documented key', () => {
    expect([
      CFG_KEY_MAX_RETRY_ATTEMPTS,
      CFG_KEY_LOG_LEVEL,
      CFG_KEY_HTTP_PROXY,
      CFG_KEY_HTTPS_PROXY,
      CFG_KEY_NO_PROXY,
    ]).toEqual([
      'DEXPACE_MAX_RETRY_ATTEMPTS',
      'DEXPACE_LOG_LEVEL',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
    ]);
  });
});

// Key names every `Record`-backed seam answers through `Object.prototype` rather than with a string:
// `process.env['constructor']` is a *function*, `process.env['__proto__']` is an object.
const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'toString', 'valueOf'];

describe('a total lookup whatever the seam answers (CFG-5, CFG-6, CFG-7, CFG-11)', () => {
  test('resolves the default for a prototype-named key against a record-backed seam', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(sourceOf({A: 'a'}))
      .build();

    for (const key of PROTOTYPE_KEYS) {
      expect(config.getString(key, 'fallback')).toBe('fallback');
    }
  });

  test('never throws from a typed accessor for a prototype-named key', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(sourceOf({A: 'a'}))
      .build();

    for (const key of PROTOTYPE_KEYS) {
      expect(config.getInt(key, 7)).toBe(7);
      expect(config.getBoolean(key, true)).toBe(true);
      expect(config.getDuration(key, 9)).toBe(9);
    }
  });

  test('resolves the default for a prototype-named key against the production environment seam', () => {
    // The same hazard on the wiring `defaultConfiguration` actually ships: `getInt('constructor')`
    // used to die on `TypeError: (...).trim is not a function` here, on real `process.env`.
    const config = defaultConfiguration();

    for (const key of PROTOTYPE_KEYS) {
      expect(config.getString(key, 'fallback')).toBe('fallback');
      expect(config.getInt(key, 7)).toBe(7);
      expect(config.getBoolean(key, true)).toBe(true);
      expect(config.getDuration(key, 9)).toBe(9);
    }
  });
});

describe('fail-fast validation (CFG-37)', () => {
  test('rejects an absent override key', () => {
    const builder = new ConfigurationBuilder();

    expect(() => builder.put(undefined as unknown as string, 'v')).toThrow(
      InvariantViolation,
    );
  });

  test('rejects an absent override value', () => {
    const builder = new ConfigurationBuilder();

    expect(() => builder.put('k', undefined as unknown as string)).toThrow(
      InvariantViolation,
    );
  });

  test('rejects an absent removal key', () => {
    const builder = new ConfigurationBuilder();

    expect(() => builder.remove(undefined as unknown as string)).toThrow(
      InvariantViolation,
    );
  });

  test('rejects an absent source function', () => {
    const builder = new ConfigurationBuilder();

    expect(() =>
      builder.withEnvSource(undefined as unknown as () => undefined),
    ).toThrow(InvariantViolation);
    expect(() =>
      builder.withPropertySource(undefined as unknown as () => undefined),
    ).toThrow(InvariantViolation);
  });

  test('rejects an absent derive mutator', () => {
    const config = new ConfigurationBuilder().build();

    expect(() => config.derive(undefined as unknown as () => void)).toThrow(
      InvariantViolation,
    );
  });

  test('rejects an absent global-configuration value', () => {
    expect(() => {
      setGlobalConfiguration(
        undefined as unknown as ReturnType<typeof defaultConfiguration>,
      );
    }).toThrow(InvariantViolation);
  });

  test('rejects a global-configuration value that is present but not a configuration', () => {
    // Every other guard in this module checks the shape it needs; this one checked only for null,
    // so a `42` reached the process-wide slot and surfaced far from the fault.
    expect(() => {
      setGlobalConfiguration(
        42 as unknown as ReturnType<typeof defaultConfiguration>,
      );
    }).toThrow(InvariantViolation);
    expect(getGlobalConfiguration()).not.toBe(42);
  });

  test('accepts an explicitly absent lookup default, which is documented-nullable', () => {
    const config = new ConfigurationBuilder().build();

    expect(() => config.getString('X', undefined)).not.toThrow();
  });
});

describe('a total lookup when a seam fails (CFG-5, CFG-6, CFG-7, CFG-11)', () => {
  test('falls through to the lower layers when the environment seam throws', () => {
    // CFG-11 makes the seam caller-supplied, so it can be backed by a file or a remote store and
    // fail like any I/O. CFG-5's never-throw clause is the stronger obligation.
    const config = new ConfigurationBuilder()
      .withEnvSource(() => {
        throw new Error('env seam exploded');
      })
      .withPropertySource(sourceOf({x: 'from-property'}))
      .build();

    expect(config.getString('X', 'fallback')).toBe('from-property');
  });

  test('resolves the caller default from every accessor when the environment seam throws', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource(() => {
        throw new Error('env seam exploded');
      })
      .build();

    expect(config.getString('X', 'fallback')).toBe('fallback');
    expect(config.getInt('X', 7)).toBe(7);
    expect(config.getBoolean('X', true)).toBe(true);
    expect(config.getDuration('X', 9)).toBe(9);
  });

  test('resolves the caller default from every accessor when the property seam throws', () => {
    const config = new ConfigurationBuilder()
      .withPropertySource(() => {
        throw new Error('property seam exploded');
      })
      .build();

    expect(config.getString('X', 'fallback')).toBe('fallback');
    expect(config.getInt('X', 7)).toBe(7);
    expect(config.getBoolean('X', true)).toBe(true);
    expect(config.getDuration('X', 9)).toBe(9);
    expect(config.getRawProperty('X', 'fallback')).toBe('fallback');
  });

  test('treats a seam answering with a non-string as a layer that supplies nothing', () => {
    const config = new ConfigurationBuilder()
      .withEnvSource((() => 42) as unknown as (key: string) => undefined)
      .build();

    expect(config.getString('X', 'fallback')).toBe('fallback');
    expect(config.getInt('X', 7)).toBe(7);
  });
});
