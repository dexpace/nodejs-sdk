// SPDX-License-Identifier: MIT
// packages/core/src/config/configuration.ts
import {invariant} from '../invariant.js';
import {getGlobalLogger} from '../observability/logger.js';
import {parseDurationMs} from './duration.js';

/**
 * A substitutable lookup seam: a key name in, a value or `undefined` out (CFG-11). Both the
 * environment and the property layer are one of these, so a test supplies hermetic lookups without
 * touching the real environment.
 *
 * @public
 */
export type SourceFn = (key: string) => string | undefined;

const STRICT_INTEGER = /^[+-]?\d+$/u;

/**
 * Reads one layer, total.
 *
 * CFG-11 makes both seams caller-supplied, which means a layer can do two things the never-throw
 * accessors of CFG-5/6/7 must absorb rather than propagate:
 *
 *   * **It can throw.** A seam backed by a file, a secrets store, or a remote key/value store fails
 *     like any I/O. That used to escape unwrapped out of `getString`/`getInt`/`getBoolean`/
 *     `getDuration`, contradicting this interface's own "never a throw" contract.
 *   * **It can answer with a non-string.** A `Record`-backed seam -- `process.env` included --
 *     resolves a key named `constructor`, `toString`, or `__proto__` through `Object.prototype` and
 *     returns a *function* or an object. `getString` then handed back a non-string typed as
 *     `string | undefined`, and each typed accessor died on `raw.trim()` with a raw `TypeError`.
 *
 * Both resolve to "this layer supplies nothing", so the lookup falls through exactly as it does for
 * an absent key. The production seam additionally guards the prototype case at its own source; this
 * guard is the one that holds for a seam this package did not write.
 *
 * The residue used to be that a seam failure was then silently INVISIBLE: an operator whose
 * secrets-store seam was misconfigured saw the caller's default resolve, with nothing anywhere to
 * say why. That half is closed as of 2026-09-02 -- the swallowed throw is warned about, naming the
 * layer and the key -- which is what `docs/open-items.md` K14 owned. The value still resolves to the
 * caller's default either way, because CFG-5's never-throw clause is the stronger obligation.
 *
 * @param source - the caller-supplied lookup seam for one layer.
 * @param key - the key being looked up, already normalized for that layer.
 * @param layer - which layer this is, for the diagnostic.
 */
function readLayer(
  source: SourceFn,
  key: string,
  layer: 'environment' | 'property',
): string | undefined {
  let value: unknown;
  try {
    value = source(key);
  } catch (error) {
    // Deliberately unnarrowed: the throw comes from caller-supplied code, so no error type can be
    // predicted, and CFG-5 makes "the lookup never fails the caller" the stronger obligation.
    warnSourceFailed(layer, key, error);
    return undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/** The diagnostic for a seam that threw. Never the value -- a configuration value can be a secret. */
function warnSourceFailed(layer: string, key: string, error: unknown): void {
  try {
    getGlobalLogger()
      .atLevel('warning')
      .event('config.sourceFailed')
      .field('source', layer)
      .field('key', key)
      .cause(error)
      .emit();
  } catch {
    // OBS-20: logger failure must never fail a lookup CFG-5 makes total.
  }
}

/** CFG-3: the property layer is queried lower-cased with underscores replaced by dots. */
function normalizePropertyKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '.');
}

/**
 * A layered, immutable string-keyed configuration (CFG-1, CFG-8).
 *
 * Lookups resolve in strict order: an explicit override for the exact key, then the environment
 * source under the exact key, then the property source under the *normalized* key, then the
 * caller's default. Built instances are frozen and safe to share without synchronization; a
 * reconfigured instance comes from {@link Configuration.derive}, copy-on-write.
 *
 * Every typed accessor is total -- a missing or unparseable value yields the caller's default, never
 * a throw (CFG-5, CFG-6, CFG-7).
 *
 * Every CFG-37 guard on this type and on {@link ConfigurationBuilder} is a *shape* check, not a null
 * check: it tests that the argument is the kind of value the parameter names (`string`, `function`,
 * object), so a wrongly-typed argument from an untyped caller fails here rather than far downstream.
 *
 * @public
 */
export interface Configuration {
  /**
   * Resolves `key` through the full layered lookup (CFG-1).
   *
   * @param key - the key name; the override and environment layers use it verbatim, the property
   *   layer uses its normalized (lower-cased, dotted) form.
   * @param fallback - the value to return when no layer supplies one; may be omitted.
   */
  getString(key: string, fallback?: string): string | undefined;

  /**
   * Resolves `key` against the property layer alone, by exact name with no normalization (CFG-4),
   * so a camelCase property-only key such as `https.proxyHost` resolves with its casing preserved.
   */
  getRawProperty(key: string, fallback?: string): string | undefined;

  /**
   * Resolves `key` through the full layered lookup and parses it as a base-10 integer (CFG-5,
   * CFG-38). Negative integers are valid and returned as-is; anything unparseable yields `fallback`.
   */
  getInt(key: string, fallback: number): number;

  /**
   * Resolves `key` through the full layered lookup and parses it strictly as a boolean (CFG-6,
   * CFG-38): only case-insensitive `true`/`false` are recognized, and `1`/`0`/`yes`/`no`/`on`/`off`
   * all yield `fallback`.
   */
  getBoolean(key: string, fallback: boolean): boolean;

  /**
   * Resolves `key` through the full layered lookup and parses it as a duration in milliseconds
   * (CFG-7, CFG-38): ISO-8601, `<number><unit>` shorthand, or a bare number of milliseconds. A
   * negative duration or an unknown unit yields `fallbackMs`.
   */
  getDuration(key: string, fallbackMs: number): number;

  /**
   * Produces a reconfigured copy, copy-on-write (CFG-9): the override map is copied before `mutate`
   * runs and the source seams are inherited by reference, so this instance is left unchanged.
   *
   * @throws an assertion failure (a caller bug, not a catchable condition) when `mutate` is not a function (CFG-37).
   */
  derive(mutate: (builder: ConfigurationBuilder) => void): Configuration;
}

class LayeredConfiguration implements Configuration {
  readonly #overrides: ReadonlyMap<string, string>;
  readonly #envSource: SourceFn;
  readonly #propertySource: SourceFn;

  constructor(
    overrides: ReadonlyMap<string, string>,
    envSource: SourceFn,
    propertySource: SourceFn,
  ) {
    this.#overrides = overrides;
    this.#envSource = envSource;
    this.#propertySource = propertySource;
    Object.freeze(this);
  }

  getString(key: string, fallback?: string): string | undefined {
    const override = this.#overrides.get(key);
    if (override !== undefined) return override;
    const fromEnv = readLayer(this.#envSource, key, 'environment');
    // CFG-2: an environment value that is present but empty is absent, so the lookup falls through.
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
    const fromProperty = readLayer(
      this.#propertySource,
      normalizePropertyKey(key),
      'property',
    );
    if (fromProperty !== undefined) return fromProperty;
    return fallback;
  }

  getRawProperty(key: string, fallback?: string): string | undefined {
    return readLayer(this.#propertySource, key, 'property') ?? fallback;
  }

  getInt(key: string, fallback: number): number {
    const raw = this.getString(key)?.trim();
    if (raw === undefined || !STRICT_INTEGER.test(raw)) return fallback;
    const value = Number(raw);
    // `+ 0` folds `-0` -- which `"-0"` parses to and `Number.isSafeInteger` accepts -- onto `0`, so a
    // caller never receives a value that is `===` zero yet differs under `Object.is` or `1 / n`.
    return Number.isSafeInteger(value) ? value + 0 : fallback;
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.getString(key)?.trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return fallback;
  }

  getDuration(key: string, fallbackMs: number): number {
    const raw = this.getString(key);
    if (raw === undefined) return fallbackMs;
    const parsed = parseDurationMs(raw);
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0)
      return fallbackMs;
    return parsed;
  }

  derive(mutate: (builder: ConfigurationBuilder) => void): Configuration {
    invariant(
      typeof mutate === 'function',
      'Configuration.derive: mutate is required',
    );
    const builder = new ConfigurationBuilder()
      .withEnvSource(this.#envSource)
      .withPropertySource(this.#propertySource);
    // CFG-9: the override map is copied *before* the mutator runs, so a mutator that throws cannot
    // leave this instance half-rewritten either.
    for (const [key, value] of this.#overrides) builder.put(key, value);
    mutate(builder);
    return builder.build();
  }
}

/**
 * Accumulates overrides and source seams into a {@link Configuration} (CFG-11).
 *
 * Single-threaded use only (CFG-12): the immutability guarantee is about the built `Configuration`,
 * not about an in-progress builder.
 *
 * @public
 */
export class ConfigurationBuilder {
  readonly #overrides = new Map<string, string>();
  #envSource: SourceFn = () => undefined;
  #propertySource: SourceFn = () => undefined;

  /**
   * Sets an override for the exact key, the highest-precedence layer.
   *
   * @throws an assertion failure (a caller bug, not a catchable condition) when `key` or `value` is not a string (CFG-37).
   */
  put(key: string, value: string): this {
    invariant(
      typeof key === 'string',
      'ConfigurationBuilder.put: key is required',
    );
    invariant(
      typeof value === 'string',
      'ConfigurationBuilder.put: value is required',
    );
    this.#overrides.set(key, value);
    return this;
  }

  /**
   * Drops the override for `key`, leaving the lower layers to answer as if it had never been set
   * (CFG-10). Removing a key with no override is a no-op.
   *
   * @throws an assertion failure (a caller bug, not a catchable condition) when `key` is not a string (CFG-37).
   */
  remove(key: string): this {
    invariant(
      typeof key === 'string',
      'ConfigurationBuilder.remove: key is required',
    );
    this.#overrides.delete(key);
    return this;
  }

  /**
   * Replaces the environment seam (CFG-11).
   *
   * @throws an assertion failure (a caller bug, not a catchable condition) when `source` is not a function (CFG-37).
   */
  withEnvSource(source: SourceFn): this {
    invariant(
      typeof source === 'function',
      'ConfigurationBuilder.withEnvSource: source is required',
    );
    this.#envSource = source;
    return this;
  }

  /**
   * Replaces the property seam (CFG-11).
   *
   * @throws an assertion failure (a caller bug, not a catchable condition) when `source` is not a function (CFG-37).
   */
  withPropertySource(source: SourceFn): this {
    invariant(
      typeof source === 'function',
      'ConfigurationBuilder.withPropertySource: source is required',
    );
    this.#propertySource = source;
    return this;
  }

  /**
   * Freezes the accumulated state into a {@link Configuration}. The override map is copied here
   * (CFG-8), so later mutation of this builder cannot reach the returned instance.
   */
  build(): Configuration {
    return new LayeredConfiguration(
      new Map(this.#overrides),
      this.#envSource,
      this.#propertySource,
    );
  }
}

/** The well-known key for the retry-attempt cap (CFG-14). @public */
export const CFG_KEY_MAX_RETRY_ATTEMPTS = 'DEXPACE_MAX_RETRY_ATTEMPTS';
/** The well-known key for the log level (CFG-14). @public */
export const CFG_KEY_LOG_LEVEL = 'DEXPACE_LOG_LEVEL';
/** The well-known key for the plain-HTTP proxy URL (CFG-14). @public */
export const CFG_KEY_HTTP_PROXY = 'HTTP_PROXY';
/** The well-known key for the HTTPS proxy URL (CFG-14). @public */
export const CFG_KEY_HTTPS_PROXY = 'HTTPS_PROXY';
/** The well-known key for the proxy-bypass host list (CFG-14). @public */
export const CFG_KEY_NO_PROXY = 'NO_PROXY';

/**
 * Reads the ambient environment without a `node:` import, so the same source compiles and runs on
 * the browser/Workers half of core's runtime floor, where it simply finds nothing.
 */
function readEnvironmentRecord(): Record<string, string | undefined> {
  const host = globalThis as {
    process?: {env?: Record<string, string | undefined>};
  };
  return host.process?.env ?? {};
}

/**
 * The production environment seam. `Object.hasOwn` rather than a bare index: `process.env` is an
 * ordinary object, so `env['constructor']`, `env['toString']`, and `env['__proto__']` would
 * otherwise resolve through `Object.prototype` and hand the layered lookup a function or an object
 * where a string was promised (CFG-5).
 */
function readAmbientEnvironment(key: string): string | undefined {
  const env = readEnvironmentRecord();
  return Object.hasOwn(env, key) ? env[key] : undefined;
}

/**
 * The production wiring CFG-11 requires: the environment seam delegates to the platform
 * environment.
 *
 * The property seam is deliberately a function that always returns `undefined`. Node has no ambient
 * key/value store distinct from `process.env`, and routing a synthetic "system property" back
 * through `process.env` under a different key would invent a layer the platform does not have. The
 * seam stays substitutable so a host that *does* have one can supply it.
 *
 * @returns a fresh `Configuration` reading the live environment on every lookup.
 *
 * @public
 */
export function defaultConfiguration(): Configuration {
  return new ConfigurationBuilder()
    .withEnvSource(readAmbientEnvironment)
    .build();
}

/**
 * Module-level mutable state, which `docs/knowledge/harvested/variables-and-declarations.md:22` bans outright.
 * Deliberate: CFG-13 *specifies* a process-wide, last-write-wins slot, so the shared-by-every-importer
 * property the rule warns about is the requirement rather than a side effect. The rule's real cost --
 * state carried between test cases in one process -- is live and unmitigated: there is no reset hook,
 * so a test that writes this slot must restore it itself (`configuration.test.ts` captures the
 * load-time value and restores it in a `finally`).
 */
let globalConfiguration: Configuration = new ConfigurationBuilder().build();

/**
 * The process-wide configuration slot (CFG-13), defaulting to an empty `Configuration`.
 *
 * @returns the configuration most recently passed to {@link setGlobalConfiguration}.
 *
 * @public
 */
export function getGlobalConfiguration(): Configuration {
  return globalConfiguration;
}

/**
 * Replaces the process-wide configuration slot, last-write-wins (CFG-13).
 *
 * @throws an assertion failure (a caller bug, not a catchable condition) when `config` is not an object (CFG-37).
 *
 * @public
 */
export function setGlobalConfiguration(config: Configuration): void {
  // Typed as `unknown` first: CFG-37 exists for the untyped caller the compiler never sees, so the
  // check has to survive a type that says it cannot happen.
  const supplied: unknown = config;
  // A `typeof` check, not just a null check: every other CFG-37 guard in this module tests the shape
  // it needs (`string` for an override, `function` for a seam or a mutator). Accepting `42` here put
  // a number in the process-wide slot, where it surfaced as a failure in an unrelated consumer far
  // from the fault (`docs/knowledge/harvested/error-handling.md:36`).
  invariant(
    typeof supplied === 'object' && supplied !== null,
    'setGlobalConfiguration: config is required',
  );
  globalConfiguration = config;
}
