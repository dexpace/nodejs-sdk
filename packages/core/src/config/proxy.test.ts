// SPDX-License-Identifier: MIT
// packages/core/src/config/proxy.test.ts
// Exercises: CFG-22 (immutable model, credential-masking string form via formatProxyOptions and the
// own toString the factory attaches), CFG-23 (glob bypass -- full string, case-insensitive,
// metacharacters literal, compiled once at construction), CFG-24 (property layer ahead of
// environment, HTTPS ahead of HTTP, port from the host's own layer, https-only credentials, never
// throws), CFG-25 (explicit in-range port, no guessing), CFG-26 (separator escape and token order),
// CFG-27 (a bare "*" is bypass-all), CFG-28 (nothing reads the environment implicitly).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import type {Configuration} from './configuration.js';
import {ConfigurationBuilder} from './configuration.js';
import type {ProxyOptions} from './proxy.js';
import {
  compiledGlobs,
  createProxyOptions,
  formatProxyOptions,
  globsFor,
  resolveProxyOptions,
  shouldBypassProxy,
} from './proxy.js';

/**
 * `ProxyOptions` deliberately declares no `toString(): string` member -- every object satisfies one
 * through `Object.prototype`, so the declaration could not have enforced CFG-22's masking anyway, and
 * it would have forced `Omit`/`Pick` gymnastics through the public API. What the factory ships is an
 * *own* `toString` delegating to `formatProxyOptions`. Reaching it therefore needs one explicit
 * widening, kept here so the asymmetry is stated once rather than cast at six call sites.
 *
 * A pure type widening: it asserts nothing about the argument, and is applied below to a hand-built
 * literal that provably has no own `toString`. {@link hasOwnToString} is the one that checks.
 */
function asStringable(options: ProxyOptions): ProxyOptions & {
  toString(): string;
} {
  return options;
}

/** Whether `options` carries its own `toString` at all, as distinct from inheriting Object's. */
function hasOwnToString(options: ProxyOptions): boolean {
  return Object.hasOwn(options, 'toString');
}

/**
 * A fresh bypass-options value per test. Never a shared `const` at describe scope: the array is
 * mutable, and `proxy.ts` keys its compiled-glob cache by that exact array *identity*, so a shared
 * fixture would be shared into module-level state that outlives the describe
 * (`docs/knowledge/harvested/testing.md:52`, `:50`).
 */
function bypassOptions(
  ...nonProxyHosts: string[]
): Pick<ProxyOptions, 'bypassAll' | 'nonProxyHosts'> {
  return {bypassAll: false, nonProxyHosts};
}

function configWith(
  env: Record<string, string> = {},
  properties: Record<string, string> = {},
): Configuration {
  return new ConfigurationBuilder()
    .withEnvSource(key => env[key])
    .withPropertySource(key => properties[key])
    .build();
}

/**
 * Resolves a configuration that must yield a proxy. A regression to `null` then names itself, rather
 * than reaching the assertion as an empty string and reporting a confusing value mismatch.
 */
function resolvedProxy(config: Configuration): ProxyOptions {
  const options = resolveProxyOptions(config);
  if (options === null) {
    throw new Error(
      'expected the proxy to resolve, but resolution returned null',
    );
  }
  return options;
}

describe('createProxyOptions (CFG-22)', () => {
  test('masks credentials in its string form', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      credentials: {username: 'user', password: 'secret'},
    });

    expect(asStringable(options).toString()).toBe(
      'http://***:***@proxy.example.com:8080',
    );
  });

  test('leaks neither the username nor the password through string interpolation', () => {
    const options = createProxyOptions({
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      credentials: {username: 'user', password: 'secret'},
    });

    const rendered = String(asStringable(options));

    expect(rendered).not.toContain('secret');
    expect(rendered).not.toContain('user');
  });

  test('renders no credential segment when there are none', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
    });

    expect(asStringable(options).toString()).toBe(
      'http://proxy.example.com:8080',
    );
  });

  test('is frozen, with a frozen non-proxy host list', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      nonProxyHosts: ['*.internal'],
    });

    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.nonProxyHosts)).toBe(true);
  });

  test('copies the non-proxy host list rather than aliasing the caller array', () => {
    const patterns = ['*.internal'];
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      nonProxyHosts: patterns,
    });

    patterns.push('*.other');

    expect(options.nonProxyHosts).toEqual(['*.internal']);
  });
});

describe('createProxyOptions bypass-all (CFG-22, CFG-27)', () => {
  test('carries a caller-set bypass-all flag through to the built value', () => {
    // `resolveProxyOptions` always passes `false` (CFG-27 turns bypass-all into a `null` resolution),
    // so without this the factory could ignore `init.bypassAll` entirely and stay green.
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      bypassAll: true,
    });

    expect(options.bypassAll).toBe(true);
    expect(shouldBypassProxy(options, 'anything.example.com')).toBe(true);
  });

  test('defaults bypass-all to false when the caller omits it', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
    });

    expect(options.bypassAll).toBe(false);
  });
});

describe('formatProxyOptions (CFG-22)', () => {
  test('agrees with the own toString a factory-built instance carries', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      credentials: {username: 'user', password: 'secret'},
    });

    // One masking implementation: the instance's `toString` delegates here rather than restating it.
    expect(hasOwnToString(options)).toBe(true);
    expect(asStringable(options).toString()).toBe(formatProxyOptions(options));
    expect(formatProxyOptions(options)).toBe(
      'http://***:***@proxy.example.com:8080',
    );
  });

  test('renders the same masked form whatever the credentials contain', () => {
    // CFG-22's masking law. The two fixed-credential tests above prove the shape; this proves the
    // guarantee is about every username and password rather than about `user`/`secret`. Asserted as
    // an exact match rather than `not.toContain`, which a one-character username would defeat --
    // `'p'` appears in `proxy.example.com` no matter how well the masking works.
    fc.assert(
      fc.property(fc.string(), fc.string(), (username, password) => {
        const options = createProxyOptions({
          type: 'http',
          host: 'proxy.example.com',
          port: 8080,
          credentials: {username, password},
        });

        expect(formatProxyOptions(options)).toBe(
          'http://***:***@proxy.example.com:8080',
        );
      }),
    );
  });

  test('is the masking contract for a hand-built options object, which carries no toString obligation', () => {
    // `ProxyOptions` deliberately declares no `toString(): string` member -- every object satisfies
    // one through `Object.prototype`, so the declaration could not have enforced masking anyway.
    // A literal therefore type-checks, renders as an ordinary object, and leaks nothing; the masked
    // form comes from the free function.
    const options: ProxyOptions = {
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      nonProxyHosts: [],
      credentials: {username: 'user', password: 'secret'},
      bypassAll: false,
    };

    expect(hasOwnToString(options)).toBe(false);
    expect(String(asStringable(options))).toBe('[object Object]');
    expect(String(asStringable(options))).not.toContain('secret');
    expect(formatProxyOptions(options)).toBe(
      'socks5://***:***@proxy.example.com:1080',
    );
  });
});

describe('shouldBypassProxy (CFG-23)', () => {
  test('matches a subdomain case-insensitively', () => {
    const options = bypassOptions('*.internal.example.com');

    expect(shouldBypassProxy(options, 'API.internal.example.com')).toBe(true);
  });

  test('does not match the apex domain', () => {
    const options = bypassOptions('*.internal.example.com');

    expect(shouldBypassProxy(options, 'internal.example.com')).toBe(false);
  });

  test('requires a full-string match', () => {
    const options = bypassOptions('*.internal.example.com');

    expect(shouldBypassProxy(options, 'a.internal.example.com.evil.test')).toBe(
      false,
    );
  });

  test('treats a dot in the pattern literally', () => {
    expect(shouldBypassProxy(bypassOptions('a.b'), 'axb')).toBe(false);
  });

  test('treats ? as exactly one character', () => {
    const single = bypassOptions('ho?t.example.com');

    expect(shouldBypassProxy(single, 'host.example.com')).toBe(true);
    expect(shouldBypassProxy(single, 'hoost.example.com')).toBe(false);
  });

  test('escapes regex metacharacters rather than honoring them', () => {
    const metacharacters = bypassOptions('a+b');

    expect(shouldBypassProxy(metacharacters, 'aab')).toBe(false);
    expect(shouldBypassProxy(metacharacters, 'a+b')).toBe(true);
  });

  test('short-circuits on bypass-all regardless of the glob list', () => {
    expect(
      shouldBypassProxy(
        {bypassAll: true, nonProxyHosts: []},
        'anything.example.com',
      ),
    ).toBe(true);
  });

  test('returns false for an empty glob list', () => {
    expect(shouldBypassProxy(bypassOptions(), 'example.com')).toBe(false);
  });
});

describe('bypass glob compilation (CFG-23)', () => {
  test('compiles the glob list at construction, before any bypass decision', () => {
    const options = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      nonProxyHosts: ['*.internal.example.com'],
    });

    // Read before any `shouldBypassProxy` call. That is the whole assertion: a lazy `globsFor` on
    // first use produces identical bypass answers, so without reading the cache here the
    // construction-time compile could be deleted outright and every other test would stay green.
    expect(compiledGlobs.has(options.nonProxyHosts)).toBe(true);
  });

  test('returns the very same compiled list on a second lookup rather than recompiling', () => {
    const patterns = Object.freeze(['*.internal.example.com']);

    const first = globsFor(patterns);
    const second = globsFor(patterns);

    // Identity, not equality: `patterns.map(...)` twice is deeply equal but not the same array, so
    // only `toBe` can tell a cache hit from a recompile.
    expect(second).toBe(first);
  });

  test('answers bypass decisions consistently across repeated calls for one list', () => {
    const shared = createProxyOptions({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      nonProxyHosts: ['*.internal.example.com'],
    });

    expect(shouldBypassProxy(shared, 'a.internal.example.com')).toBe(true);
    expect(shouldBypassProxy(shared, 'b.internal.example.com')).toBe(true);
  });
});

describe('shouldBypassProxy glob dialect edges (CFG-23)', () => {
  test('treats a backslash as an ordinary literal, since the dialect defines no escape', () => {
    const escaped = {bypassAll: false, nonProxyHosts: ['a\\*b']};

    expect(shouldBypassProxy(escaped, 'a\\*b')).toBe(true);
    expect(shouldBypassProxy(escaped, 'a*b')).toBe(false);
    expect(shouldBypassProxy(escaped, 'aXXXb')).toBe(false);
  });

  test('matches a star-dense pattern in linear time rather than backtracking', () => {
    // A legal `NO_PROXY` entry. Under the previous `*` -> `.*` regex this pattern against this host
    // drove catastrophic backtracking for 38 seconds of blocked event loop; the two-pointer walk
    // that replaced it settles in microseconds.
    const dense = {bypassAll: false, nonProxyHosts: ['*a*a*a*a*a*a*a*a*a*b']};
    const started = performance.now();

    expect(shouldBypassProxy(dense, 'a'.repeat(60))).toBe(false);

    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('resolveProxyOptions from the environment (CFG-24, CFG-25)', () => {
  test('prefers HTTPS_PROXY over HTTP_PROXY', () => {
    const options = resolveProxyOptions(
      configWith({
        HTTPS_PROXY: 'https://secure.example.com:9090',
        HTTP_PROXY: 'http://plain.example.com:8080',
      }),
    );

    expect(options?.host).toBe('secure.example.com');
    expect(options?.port).toBe(9090);
  });

  test('falls back to HTTP_PROXY when HTTPS_PROXY is absent', () => {
    const options = resolveProxyOptions(
      configWith({HTTP_PROXY: 'http://plain.example.com:8080'}),
    );

    expect(options?.host).toBe('plain.example.com');
  });

  test('reads percent-decoded credentials out of the URL', () => {
    const options = resolveProxyOptions(
      configWith({HTTPS_PROXY: 'http://us%40er:p%3Ass@proxy.example.com:8080'}),
    );

    expect(options?.credentials).toEqual({username: 'us@er', password: 'p:ss'});
  });

  test('maps a socks5 scheme to the socks5 proxy type', () => {
    const options = resolveProxyOptions(
      configWith({HTTPS_PROXY: 'socks5://proxy.example.com:1080'}),
    );

    expect(options?.type).toBe('socks5');
  });

  test('rejects an unknown scheme', () => {
    expect(
      resolveProxyOptions(
        configWith({HTTPS_PROXY: 'ftp://proxy.example.com:21'}),
      ),
    ).toBeNull();
  });

  test('rejects a proxy URL with no port, never guessing a default', () => {
    expect(
      resolveProxyOptions(configWith({HTTPS_PROXY: 'https://example.com'})),
    ).toBeNull();
  });

  test('rejects an out-of-range port', () => {
    expect(
      resolveProxyOptions(
        configWith({HTTPS_PROXY: 'https://example.com:70000'}),
      ),
    ).toBeNull();
  });
});

describe('resolveProxyOptions rejection paths (CFG-24, CFG-25)', () => {
  test('resolves to null when no proxy is configured', () => {
    expect(resolveProxyOptions(configWith())).toBeNull();
  });

  test('resolves to null on malformed input, without throwing', () => {
    const config = configWith({HTTPS_PROXY: 'not a url at all'});

    expect(() => resolveProxyOptions(config)).not.toThrow();
    expect(resolveProxyOptions(config)).toBeNull();
  });

  test('never throws for an arbitrary environment value', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(() =>
          resolveProxyOptions(configWith({HTTPS_PROXY: value})),
        ).not.toThrow();
      }),
    );
  });

  test('never throws for an arbitrary URL-shaped environment value', () => {
    // A bare `fc.string()` essentially never produces something the URL parser accepts, so it could
    // not reach the credential decode at all -- it missed a `URIError` escaping on a lone `%`. This
    // generator assembles values that parse, then perturbs the pieces most likely to break.
    const piece = fc.stringMatching(/^[\w%.:+~@-]{0,12}$/u);
    const parts = fc.record({
      scheme: fc.constantFrom('http', 'https', 'socks5', 'ftp', 'zz'),
      user: piece,
      password: piece,
      host: piece,
      port: fc.constantFrom(
        '',
        ':0',
        ':80',
        ':443',
        ':8080',
        ':65535',
        ':70000',
        ':x',
      ),
    });

    fc.assert(
      fc.property(parts, ({scheme, user, password, host, port}) => {
        const credentials = user === '' ? '' : `${user}:${password}@`;
        const value = `${scheme}://${credentials}${host}${port}`;

        expect(() =>
          resolveProxyOptions(configWith({HTTPS_PROXY: value})),
        ).not.toThrow();
      }),
    );
  });
});

describe("CFG-24's WARNING half: a rejected proxy URL is audible", () => {
  async function collectWarnings(
    run: () => void,
  ): Promise<Map<string, unknown>[]> {
    const {createLogger, setGlobalLogger, NOOP_LOGGER} =
      await import('../observability/logger.js');
    const events: Map<string, unknown>[] = [];
    setGlobalLogger(
      createLogger((_level, fields) => {
        events.push(new Map(fields));
      }),
    );
    try {
      run();
    } finally {
      setGlobalLogger(NOOP_LOGGER);
    }
    return events.filter(e => e.get('event') === 'http.proxy.configRejected');
  }

  test('an unparseable URL warns, naming the variable and the reason', async () => {
    const rejected = await collectWarnings(() => {
      expect(
        resolveProxyOptions(configWith({HTTPS_PROXY: 'not a url at all'})),
      ).toBeNull();
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.get('source')).toBe('HTTPS_PROXY');
    expect(rejected[0]?.get('reason')).toBe('unparseable');
  });

  test('an absent port warns, naming the variable and the reason (CFG-25)', async () => {
    const rejected = await collectWarnings(() => {
      expect(
        resolveProxyOptions(configWith({HTTP_PROXY: 'http://p.example.com'})),
      ).toBeNull();
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.get('source')).toBe('HTTP_PROXY');
    expect(rejected[0]?.get('reason')).toBe('port');
  });

  test('an unsupported scheme warns, naming the variable and the reason', async () => {
    const rejected = await collectWarnings(() => {
      expect(
        resolveProxyOptions(
          configWith({HTTPS_PROXY: 'ftp://p.example.com:21'}),
        ),
      ).toBeNull();
    });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.get('reason')).toBe('scheme');
  });

  test('a well-formed proxy URL warns about nothing', async () => {
    const rejected = await collectWarnings(() => {
      expect(
        resolveProxyOptions(
          configWith({HTTPS_PROXY: 'http://p.example.com:8080'}),
        ),
      ).not.toBeNull();
    });
    expect(rejected).toHaveLength(0);
  });
});

describe('resolveProxyOptions URL-layer edges (CFG-24, CFG-25)', () => {
  test('honors an explicitly written default port that the URL parser normalizes away', () => {
    // `new URL('http://p:80').port` is `''` -- the WHATWG parser folds a special scheme's default
    // port away, making `http://p:80` indistinguishable from `http://p` by that field alone. CFG-25
    // bans *guessing* an absent port, not discarding one the operator wrote, and `:80` / `:443` are
    // the two most common proxy configurations there are.
    expect(
      resolveProxyOptions(configWith({HTTP_PROXY: 'http://p.example.com:80'}))
        ?.port,
    ).toBe(80);
    expect(
      resolveProxyOptions(
        configWith({HTTPS_PROXY: 'https://p.example.com:443'}),
      )?.port,
    ).toBe(443);
  });

  test('rejects a port above the 0..65535 range even when the URL parser rejects it first', () => {
    expect(
      resolveProxyOptions(
        configWith({HTTP_PROXY: 'http://p.example.com:70000'}),
      ),
    ).toBeNull();
  });

  test('resolves an IPv6 literal to a bare address, without the URL parser brackets', () => {
    expect(
      resolveProxyOptions(configWith({HTTP_PROXY: 'http://[2001:db8::1]:8080'}))
        ?.host,
    ).toBe('2001:db8::1');
  });

  test('re-brackets an IPv6 host when rendering, so address and port stay separable', () => {
    const options = resolvedProxy(
      configWith({HTTP_PROXY: 'http://[2001:db8::1]:8080'}),
    );

    expect(formatProxyOptions(options)).toBe('http://[2001:db8::1]:8080');
  });

  test('leaves a registered name unbracketed when rendering', () => {
    const options = resolvedProxy(
      configWith({HTTP_PROXY: 'http://p.example.com:8080'}),
    );

    expect(formatProxyOptions(options)).toBe('http://p.example.com:8080');
  });

  test('treats an empty user name in the URL as no credentials at all', () => {
    expect(
      resolveProxyOptions(
        configWith({HTTP_PROXY: 'http://:secret@p.example.com:8080'}),
      )?.credentials,
    ).toBeUndefined();
  });

  test('resolves to null rather than throwing on an unescaped percent in the credentials', () => {
    // `decodeURIComponent('pa%ss')` raises `URIError`, and a literal `%` in a proxy password is
    // ordinary operator input, so CFG-24's never-throw clause has to cover the decode too.
    const config = configWith({
      HTTP_PROXY: 'http://u:pa%ss@h.example.com:8080',
    });

    expect(() => resolveProxyOptions(config)).not.toThrow();
    expect(resolveProxyOptions(config)).toBeNull();
  });
});

describe('resolveProxyOptions from the property layer (CFG-24)', () => {
  test('prefers the property layer over the environment', () => {
    const options = resolveProxyOptions(
      configWith(
        {HTTPS_PROXY: 'https://from-env.example.com:9090'},
        {
          'https.proxyHost': 'from-property.example.com',
          'https.proxyPort': '3128',
        },
      ),
    );

    expect(options?.host).toBe('from-property.example.com');
    expect(options?.port).toBe(3128);
  });

  test('prefers https.proxyHost over http.proxyHost', () => {
    const options = resolveProxyOptions(
      configWith(
        {},
        {
          'https.proxyHost': 'secure.example.com',
          'https.proxyPort': '3128',
          'http.proxyHost': 'plain.example.com',
          'http.proxyPort': '8080',
        },
      ),
    );

    expect(options?.host).toBe('secure.example.com');
    expect(options?.port).toBe(3128);
  });

  test('takes the port from the same layer as the chosen host, never the other one', () => {
    const options = resolveProxyOptions(
      configWith(
        {},
        {'https.proxyHost': 'secure.example.com', 'http.proxyPort': '8080'},
      ),
    );

    expect(options).toBeNull();
  });
});

describe('resolveProxyOptions property credentials (CFG-24)', () => {
  test('reads credentials only from the https properties, even when the host came from http', () => {
    const options = resolveProxyOptions(
      configWith(
        {},
        {
          'http.proxyHost': 'plain.example.com',
          'http.proxyPort': '8080',
          'https.proxyUser': 'user',
          'https.proxyPassword': 'secret',
        },
      ),
    );

    expect(options?.host).toBe('plain.example.com');
    expect(options?.credentials).toEqual({
      username: 'user',
      password: 'secret',
    });
  });

  test('resolves to null when the property host has no port', () => {
    expect(
      resolveProxyOptions(
        configWith({}, {'https.proxyHost': 'secure.example.com'}),
      ),
    ).toBeNull();
  });
});

describe('resolveProxyOptions property-layer edges (CFG-24, CFG-25)', () => {
  test('rejects every numeric-literal form that is not a bare run of digits', () => {
    // `Number()` alone accepts all of these, each of which would silently connect to a port the
    // operator never wrote (CFG-25's "non-numeric" clause, read the way `getInt` reads it).
    for (const port of [
      '0x10',
      '0b11',
      '0o17',
      '1e2',
      '1e3',
      '80.0',
      '+80',
      '-80',
      '8_0',
      '1.5',
      '.5',
      'Infinity',
      'NaN',
      '',
      '   ',
      '65536',
    ]) {
      expect(
        resolveProxyOptions(
          configWith(
            {},
            {'http.proxyHost': 'p.example.com', 'http.proxyPort': port},
          ),
        ),
      ).toBeNull();
    }
  });

  test('accepts a bare run of digits, surrounding whitespace tolerated', () => {
    for (const [port, expected] of [
      ['80', 80],
      [' 8080 ', 8080],
      ['0', 0],
      ['65535', 65_535],
    ] as const) {
      expect(
        resolveProxyOptions(
          configWith(
            {},
            {'http.proxyHost': 'p.example.com', 'http.proxyPort': port},
          ),
        )?.port,
      ).toBe(expected);
    }
  });
});

describe('non-proxy host resolution (CFG-26, CFG-27)', () => {
  test('splits NO_PROXY on commas', () => {
    const options = resolveProxyOptions(
      configWith({
        HTTPS_PROXY: 'https://example.com:8080',
        NO_PROXY: 'a.test,b.test',
      }),
    );

    expect(options?.nonProxyHosts).toEqual(['a.test', 'b.test']);
  });

  test('honors a backslash-escaped comma in NO_PROXY', () => {
    const options = resolveProxyOptions(
      configWith({
        HTTPS_PROXY: 'https://example.com:8080',
        NO_PROXY: String.raw`a\,b,c`,
      }),
    );

    expect(options?.nonProxyHosts).toEqual(['a,b', 'c']);
  });

  test('lets the pipe-separated property list win over NO_PROXY', () => {
    const options = resolveProxyOptions(
      configWith(
        {HTTPS_PROXY: 'https://example.com:8080', NO_PROXY: 'from-env.test'},
        {'http.nonProxyHosts': String.raw`a\|b|c`},
      ),
    );

    expect(options?.nonProxyHosts).toEqual(['a|b', 'c']);
  });
});

describe('non-proxy host token order (CFG-26, CFG-27)', () => {
  test('retains a whitespace-only fragment as an empty token, dropping only empty ones', () => {
    const options = resolveProxyOptions(
      configWith({HTTPS_PROXY: 'https://example.com:8080', NO_PROXY: 'a,, ,c'}),
    );

    expect(options?.nonProxyHosts).toEqual(['a', '', 'c']);
  });

  test('trims surrounding whitespace from each token', () => {
    const options = resolveProxyOptions(
      configWith({
        HTTPS_PROXY: 'https://example.com:8080',
        NO_PROXY: ' a.test , b.test ',
      }),
    );

    expect(options?.nonProxyHosts).toEqual(['a.test', 'b.test']);
  });

  test('treats a bare "*" as bypass-all, resolving to null so the caller routes directly', () => {
    expect(
      resolveProxyOptions(
        configWith({HTTPS_PROXY: 'https://example.com:8080', NO_PROXY: '*'}),
      ),
    ).toBeNull();
  });

  test('treats a "*" among several entries as an ordinary any-host glob', () => {
    const options = resolveProxyOptions(
      configWith({
        HTTPS_PROXY: 'https://example.com:8080',
        NO_PROXY: '*,x.test',
      }),
    );

    expect(options?.nonProxyHosts).toEqual(['*', 'x.test']);
  });
});

describe('non-proxy host escape round-trip (CFG-26)', () => {
  test('returns every token whole, whatever separators it contains', () => {
    // CFG-26's escape law: a token written with its separators escaped comes back exactly as written.
    // The fixed cases above pin one escaped comma; this pins the round-trip over arbitrary tokens,
    // including ones that are all separators. At least two tokens, so a lone `*` cannot turn the
    // resolution into CFG-27's bypass-all and return `null`.
    const token = fc.stringMatching(/^[a-z,.*-]{1,10}$/u);

    fc.assert(
      fc.property(fc.array(token, {minLength: 2, maxLength: 4}), tokens => {
        const encoded = tokens
          .map(one => one.replaceAll(',', String.raw`\,`))
          .join(',');

        const options = resolvedProxy(
          configWith({
            HTTPS_PROXY: 'https://example.com:8080',
            NO_PROXY: encoded,
          }),
        );

        expect(options.nonProxyHosts).toEqual(tokens);
      }),
    );
  });
});

describe('implicit reads (CFG-28)', () => {
  test('consults the environment seam only when the resolver is invoked', () => {
    let reads = 0;
    const config = new ConfigurationBuilder()
      .withEnvSource(key => {
        reads += 1;
        return key === 'HTTPS_PROXY' ? 'https://example.com:8080' : undefined;
      })
      .build();

    expect(reads).toBe(0);

    resolveProxyOptions(config);

    expect(reads).toBeGreaterThan(0);
  });
});

describe('proxy endpoint normalization across both CFG-24 tiers', () => {
  test('resolves an IPv6 literal to the same bare address the environment layer produces', () => {
    const fromProperty = resolvedProxy(
      configWith(
        {},
        {'http.proxyHost': '[2001:db8::1]', 'http.proxyPort': '8080'},
      ),
    );
    const fromEnvironment = resolvedProxy(
      configWith({HTTP_PROXY: 'http://[2001:db8::1]:8080'}),
    );

    expect(fromProperty.host).toBe('2001:db8::1');
    expect(fromProperty.host).toBe(fromEnvironment.host);
  });

  test('treats an empty https.proxyUser as no credentials, matching the URL layer', () => {
    expect(
      resolveProxyOptions(
        configWith(
          {},
          {
            'http.proxyHost': 'p.example.com',
            'http.proxyPort': '8080',
            'https.proxyUser': '',
            'https.proxyPassword': 'secret',
          },
        ),
      )?.credentials,
    ).toBeUndefined();
  });
});
