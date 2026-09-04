// SPDX-License-Identifier: MIT
// packages/core/src/config/proxy.ts
import type {Configuration} from './configuration.js';
import {
  CFG_KEY_HTTPS_PROXY,
  CFG_KEY_HTTP_PROXY,
  CFG_KEY_NO_PROXY,
} from './configuration.js';
import {getGlobalLogger} from '../observability/logger.js';

/** Property-layer keys, read raw so their camelCase survives (CFG-4, CFG-24, CFG-26). */
const PROPERTY_KEYS = {
  httpsHost: 'https.proxyHost',
  httpsPort: 'https.proxyPort',
  httpHost: 'http.proxyHost',
  httpPort: 'http.proxyPort',
  httpsUser: 'https.proxyUser',
  httpsPassword: 'https.proxyPassword',
  nonProxyHosts: 'http.nonProxyHosts',
} as const;

const MAX_PORT = 65_535;

/**
 * A bare run of decimal digits. Bare `Number()` also accepts `0x10`, `0b11`, `0o17`, `1e2`, `80.0`,
 * and `+80`, each of which would silently connect to a port the operator never wrote (CFG-25).
 *
 * Deliberately *stricter* than the integer grammar `configuration.ts` applies to `getInt`, which
 * permits the leading `+`/`-` sign that a port cannot carry.
 */
const DECIMAL_DIGITS = /^\d+$/u;

/** The proxy transports CFG-22 enumerates. @public */
export type ProxyType = 'http' | 'socks4' | 'socks5';

/** Optional proxy credentials -- a documented-nullable slot, exempt from CFG-37. @public */
export interface ProxyCredentials {
  /** The proxy user name, already percent-decoded. */
  readonly username: string;
  /** The proxy password, already percent-decoded. Never rendered by `toString`. */
  readonly password: string;
}

/**
 * An immutable proxy configuration (CFG-22): transport type, socket address, the ordered non-proxy
 * host glob list, optional credentials, an optional challenge-handler slot, and an explicit
 * bypass-all flag.
 *
 * `@dexpace/transport-undici` is the only consumer: it hands `credentials` to undici's `ProxyAgent`
 * constructor and probes `challengeHandler` for the two TRANSPORT-30 warnings. `transport-fetch`
 * ships no `proxy` option at all, because Node's bare global `fetch` exposes no proxy hook -- a
 * deliberate scope boundary, audited as `docs/deviations.md` item 13.
 *
 * CFG-22's credential-masking string rendering is {@link formatProxyOptions}, a free function rather
 * than a `toString(): string` member: every object satisfies such a member through
 * `Object.prototype`, so declaring it here would state a contract the type cannot enforce while
 * forcing every other signature in this module to `Omit` it back out. A `createProxyOptions` instance
 * additionally carries an own `toString` that delegates to the same function, so interpolating one
 * into a log masks; a hand-built object literal has no such obligation and renders as an ordinary
 * object -- which leaks nothing either.
 *
 * @public
 */
export interface ProxyOptions {
  /** The proxy transport. */
  readonly type: ProxyType;
  /**
   * The proxy host name or literal address, always **bare**: an IPv6 literal carries no `[...]`
   * brackets whichever CFG-24 layer supplied it, so a transport joining `host` and `port` never has
   * to know which one answered. `URL.hostname` brackets one and the `https.proxyHost` property does
   * not; resolution normalizes both to this form. A consumer composing a URL authority re-adds them.
   */
  readonly host: string;
  /** The proxy port, always explicit and within 0..65535 -- never guessed from the scheme (CFG-25). */
  readonly port: number;
  /** Ordered glob patterns for hosts that bypass this proxy (CFG-23). */
  readonly nonProxyHosts: readonly string[];
  /** Proxy credentials, when the configuration supplied them. */
  readonly credentials?: ProxyCredentials | undefined;
  /**
   * The optional challenge-handler slot CFG-22's field list requires (a MUST,
   * `docs/product-spec/16-configuration.md`). **Nothing dispatches through it, and nothing is going
   * to.** That disposition is settled.
   *
   * undici's `ProxyAgent` takes its credential solely from its own constructor and rejects a
   * per-request `Proxy-Authorization` with `InvalidArgumentError`, a deliberate upstream security
   * fix. The constructor runs before any challenge exists, so a handler-minted credential can never
   * reach the exchange that provoked it. The full audit is `docs/deviations.md` item 13.
   *
   * `@dexpace/transport-undici` answers TRANSPORT-30's discoverability clause instead: a WARN at
   * construction when a handler is configured, a second WARN on the first real 407, Basic proxy auth
   * through `credentials` -- which that transport does pass to the `ProxyAgent` constructor -- and
   * the 407 returned untouched for the caller's own auth layer.
   *
   * Typed `unknown` rather than a declared signature deliberately. The one concrete argument a
   * handler could take is the native client's own response type -- undici's
   * `Dispatcher.ResponseData`, which is what the Phase 8a plan sketched -- and SEAM-1's zero runtime
   * dependencies forbid core from naming it. Inventing a transport-neutral challenge shape here
   * would publish a contract with no implementation behind it and no way to validate one. `unknown`
   * states honestly that the protocol is unspecified. The slot's only readers are the two
   * `typeof x === 'function'` probes in `transport-undici`'s `challenge-handler.ts`, and those
   * probes are what make both WARNs fire -- so the field is load-bearing for discoverability without
   * anything dispatching through it.
   *
   * It stays for that reason and one more: removing it would break CFG-22's MUST and strand
   * TRANSPORT-30's SHOULD-warn clause with no subject.
   */
  readonly challengeHandler?: unknown;
  /** When set, every host bypasses this proxy and is dialled directly (CFG-23, CFG-27). */
  readonly bypassAll: boolean;
}

/**
 * A glob or a candidate host reduced to its comparison form: lower-cased once, then split into code
 * *points* rather than UTF-16 code units so `?` still means one character in the astral planes.
 */
type FoldedText = readonly string[];

/**
 * Compiled bypass globs, keyed by the very array they were compiled from, so CFG-23's "compiled once
 * at construction" holds for a factory-built `ProxyOptions` without putting a cache field on the
 * public shape -- and still holds for a hand-built one, which compiles on its first use and reuses
 * the result thereafter.
 *
 * The consequence for a hand-built one: `createProxyOptions` freezes the list it stores, but an
 * object literal typed as `ProxyOptions` may carry a mutable array, and that array's first compile is
 * cached against it permanently. A pattern pushed onto it afterwards is silently ignored by
 * {@link shouldBypassProxy}. Build through the factory, or treat the array as frozen by convention.
 *
 * Exported so `proxy.test.ts` can read the cache *before* any bypass decision. Without that,
 * CFG-23's "compiled once at construction" is indistinguishable from "compiled on first use", and
 * {@link createProxyOptions}'s {@link compileGlobs} call could be deleted with every test still
 * green. Not re-exported from the package barrel.
 *
 * @internal
 */
export const compiledGlobs = new WeakMap<
  readonly string[],
  readonly FoldedText[]
>();

function foldToCodePoints(value: string): FoldedText {
  return Array.from(value.toLowerCase());
}

/**
 * CFG-23's glob dialect: `*` is any run, `?` is exactly one character, everything else is a literal,
 * and the match is full-string and case-insensitive.
 *
 * **There is no escape character.** CFG-23 defines none, so a backslash is an ordinary literal: the
 * pattern `a\*b` matches the three-character host `a\*b` and nothing else -- neither `a*b` nor
 * `aXXXb`.
 *
 * Deliberately a hand-written walk rather than a `RegExp`. Translating `*` to `.*` produced adjacent
 * unanchored runs, and a non-matching host then drove catastrophic backtracking: the pattern
 * `*a*a*a*a*a*a*a*a*a*b` against a 60-character host took 38 seconds of blocked event loop. Patterns
 * are operator-supplied through `NO_PROXY` / `http.nonProxyHosts` and the host is often a redirect
 * target, so that exponent was reachable from ordinary configuration. This walk keeps exactly one
 * backtrack anchor per `*` instead of a stack of them, so it is O(pattern x text) at worst.
 */
function globMatches(pattern: FoldedText, text: FoldedText): boolean {
  let patternAt = 0;
  let textAt = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (textAt < text.length) {
    const expected = pattern[patternAt];
    if (
      expected === '?' ||
      (expected !== undefined && expected === text[textAt])
    ) {
      patternAt += 1;
      textAt += 1;
    } else if (expected === '*') {
      starAt = patternAt;
      resumeAt = textAt;
      patternAt += 1;
    } else if (starAt === -1) {
      return false;
    } else {
      // The most recent `*` swallows one more character and the walk resumes just after it.
      resumeAt += 1;
      patternAt = starAt + 1;
      textAt = resumeAt;
    }
  }
  while (pattern[patternAt] === '*') patternAt += 1;
  return patternAt === pattern.length;
}

/**
 * The compiled form of `patterns`, compiling and caching on first use. Exported for the identity
 * assertion in `proxy.test.ts` that pins the reuse; not re-exported from the package barrel.
 *
 * @internal
 */
export function globsFor(patterns: readonly string[]): readonly FoldedText[] {
  const cached = compiledGlobs.get(patterns);
  if (cached !== undefined) return cached;
  const compiled = patterns.map(foldToCodePoints);
  compiledGlobs.set(patterns, compiled);
  return compiled;
}

/**
 * Fills {@link compiledGlobs} for `patterns`, so a later {@link globsFor} on the very same array is a
 * lookup rather than a compile. This is CFG-23's "compiled once at construction".
 *
 * A separate name and a `void` return because {@link createProxyOptions} is the one caller that wants
 * the effect without the value: `compileGlobs(hosts);` reads as the effect it is, where
 * `globsFor(hosts);` read as a discarded result and looked deletable.
 */
function compileGlobs(patterns: readonly string[]): void {
  globsFor(patterns);
}

/**
 * Whether `host` should bypass the proxy and be dialled directly (CFG-23).
 *
 * @param options - the proxy configuration; only the bypass flag and glob list are read.
 * @param host - the destination host name.
 * @returns `true` when bypass-all is set, or when `host` matches any configured glob.
 *
 * @public
 */
export function shouldBypassProxy(
  options: Pick<ProxyOptions, 'bypassAll' | 'nonProxyHosts'>,
  host: string,
): boolean {
  if (options.bypassAll) return true;
  const candidate = foldToCodePoints(host);
  return globsFor(options.nonProxyHosts).some(glob =>
    globMatches(glob, candidate),
  );
}

/**
 * Renders a proxy for logs with any credentials masked (CFG-22). The single masking implementation:
 * the own `toString` a {@link createProxyOptions} instance carries delegates here.
 *
 * @param options - the proxy to render.
 * @returns `type://host:port` -- the proxy type stands in as the scheme, an IPv6 host is
 *   re-bracketed, and `***:***@` stands in for any credentials.
 *
 * @public
 */
export function formatProxyOptions(options: ProxyOptions): string {
  const credentials = options.credentials === undefined ? '' : '***:***@';
  // `host` is stored bare, so an IPv6 literal has to be re-bracketed here or the rendering is
  // ambiguous: `2001:db8::1:8080` cannot be read back as an address plus a port. A colon in the host
  // is the only case that needs it -- no registered name or IPv4 literal can contain one.
  const host = options.host.includes(':') ? `[${options.host}]` : options.host;
  return `${options.type}://${credentials}${host}:${String(options.port)}`;
}

/**
 * What {@link createProxyOptions} accepts: the three fields a proxy cannot be described without, plus
 * the four the factory defaults or leaves empty.
 *
 * @public
 */
export interface ProxyOptionsInit {
  /** The proxy transport. */
  readonly type: ProxyType;
  /** The proxy host name or literal address. */
  readonly host: string;
  /** The proxy port, explicit and within 0..65535 -- never guessed from the scheme (CFG-25). */
  readonly port: number;
  /** Ordered glob patterns for hosts that bypass this proxy; defaults to empty (CFG-23). */
  readonly nonProxyHosts?: readonly string[] | undefined;
  /** Proxy credentials, when there are any. */
  readonly credentials?: ProxyCredentials | undefined;
  /**
   * The optional challenge-handler slot CFG-22's field list requires, copied through to the built
   * {@link ProxyOptions} unchanged. Nothing dispatches through it, by settled disposition rather
   * than by omission; the reasoning is on {@link ProxyOptions.challengeHandler}.
   */
  readonly challengeHandler?: unknown;
  /** Whether every host bypasses this proxy; defaults to `false` (CFG-27). */
  readonly bypassAll?: boolean | undefined;
}

/**
 * Builds a frozen {@link ProxyOptions} carrying an own `toString` that delegates to
 * {@link formatProxyOptions}, so interpolating the result into a log masks credentials (CFG-22), and
 * whose bypass globs are compiled once, here, rather than on every bypass decision (CFG-23).
 *
 * @param init - the proxy's fields; `nonProxyHosts` defaults to empty and `bypassAll` to `false`.
 * @returns the frozen proxy configuration.
 *
 * @public
 */
export function createProxyOptions(init: ProxyOptionsInit): ProxyOptions {
  const nonProxyHosts = Object.freeze([...(init.nonProxyHosts ?? [])]);
  compileGlobs(nonProxyHosts);
  const fields = {
    type: init.type,
    host: init.host,
    port: init.port,
    nonProxyHosts,
    credentials: init.credentials,
    challengeHandler: init.challengeHandler,
    bypassAll: init.bypassAll ?? false,
  };
  return Object.freeze({...fields, toString: () => formatProxyOptions(fields)});
}

/**
 * Splits on unescaped occurrences of `separator`, preserving a backslash-escaped separator inside the
 * token it belongs to (CFG-26).
 */
function splitEscaped(raw: string, separator: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i += 1) {
    const character = raw[i] ?? '';
    if (character === '\\' && raw[i + 1] === separator) {
      current += `\\${separator}`;
      i += 1;
    } else if (character === separator) {
      tokens.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  tokens.push(current);
  return tokens;
}

/**
 * CFG-26's observable order, exactly: split, drop empty, unescape, trim. Trimming last is what makes
 * a whitespace-only fragment survive the drop and land as an empty token.
 */
function parseNonProxyHosts(raw: string, separator: string): readonly string[] {
  return splitEscaped(raw, separator)
    .filter(token => token !== '')
    .map(token => token.replaceAll(`\\${separator}`, separator))
    .map(token => token.trim());
}

interface NonProxyResolution {
  readonly bypassAll: boolean;
  readonly hosts: readonly string[];
}

/**
 * CFG-26: the property layer (pipe-separated) wins over the environment variable (comma-separated).
 * CFG-27: a resolved list of exactly one bare `*` is bypass-all, represented by the flag rather than
 * as a literal glob entry; a `*` among several entries stays an ordinary any-host glob.
 */
function resolveNonProxyHosts(config: Configuration): NonProxyResolution {
  const fromProperty = config.getRawProperty(PROPERTY_KEYS.nonProxyHosts);
  const hosts =
    fromProperty === undefined
      ? parseNonProxyHosts(config.getString(CFG_KEY_NO_PROXY) ?? '', ',')
      : parseNonProxyHosts(fromProperty, '|');
  if (hosts.length === 1 && hosts[0] === '*')
    return {bypassAll: true, hosts: []};
  return {bypassAll: false, hosts};
}

/** CFG-25: explicit, numeric, and in range -- no default-port guessing, ever. */
function parsePort(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!DECIMAL_DIGITS.test(trimmed)) return null;
  const port = Number(trimmed);
  return port <= MAX_PORT ? port : null;
}

const PROXY_TYPE_BY_SCHEME: ReadonlyMap<string, ProxyType> = new Map([
  ['http:', 'http'],
  ['https:', 'http'],
  ['socks:', 'socks5'],
  ['socks5:', 'socks5'],
  ['socks5h:', 'socks5'],
  ['socks4:', 'socks4'],
  ['socks4a:', 'socks4'],
]);

/**
 * What both CFG-24 tiers produce: the endpoint fields only. Deliberately not
 * `Omit<ProxyOptionsInit, 'challengeHandler'>` -- that also admits `nonProxyHosts` and `bypassAll`,
 * which neither producer sets and which {@link resolveProxyOptions} supplies from the separate
 * CFG-26/CFG-27 resolution, making the spread order there silently load-bearing.
 */
type ProxyEndpoint = Pick<
  ProxyOptionsInit,
  'type' | 'host' | 'port' | 'credentials'
>;

/**
 * CFG-22's `host` is the bare address, so an IPv6 literal loses the brackets `URL.hostname` puts back
 * on it and the two CFG-24 layers agree on one representation (see {@link ProxyOptions.host}).
 */
function unbracketHost(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * The port the operator actually wrote, which is not always `url.port`.
 *
 * The WHATWG parser normalizes a *special* scheme's default port to the empty string, so `url.port`
 * cannot tell `http://p:80` from `http://p` and `https://p:443` from `https://p`. CFG-25 bans
 * *guessing* an absent port; it does not license discarding one the operator wrote. Re-reading under
 * a scheme the parser does not treat as special leaves the port verbatim.
 *
 * Only the port is taken from the probe: a non-special scheme also skips host lower-casing, so every
 * other field still comes from the real `url`.
 */
function explicitPort(raw: string, url: URL): string | undefined {
  if (url.port !== '') return url.port;
  try {
    const probe = new URL(
      raw.replace(/^[a-z][a-z\d+.-]*:/iu, 'x-dexpace-probe:'),
    );
    return probe.port === '' ? undefined : probe.port;
  } catch {
    // Parsed under its real scheme but not under the probe: not a port question, so CFG-25's
    // "absent port is invalid" result stands.
    return undefined;
  }
}

/**
 * CFG-24's `user:pass@` segment, percent-decoded. An empty user name is no credentials at all -- the
 * same rule the property layer applies -- so `http://:secret@host:8080` carries none.
 */
function readUrlCredentials(url: URL): ProxyCredentials | undefined {
  if (url.username === '') return undefined;
  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/**
 * CFG-24's WARNING half: "invalid config -> null + warning". The null half was always here; until
 * 2026-09-02 the warning had nowhere to go, because no `Logger` seam existed when 7a shipped this
 * module. The consequence was that a typo'd `HTTPS_PROXY` routed every request DIRECT with
 * nothing to read anywhere.
 *
 * Never the URL itself: a proxy URL carries `user:pass@`, and CFG-22 masks credentials in every
 * rendering. The variable that supplied it and the reason it was rejected are enough to act on.
 */
function warnProxyRejected(source: string, reason: string): void {
  try {
    getGlobalLogger()
      .atLevel('warning')
      .event('http.proxy.configRejected')
      .field('source', source)
      .field('reason', reason)
      .emit();
  } catch {
    // OBS-20: logger failure must never fail resolution, which CFG-24 makes total.
  }
}

/**
 * CFG-24's environment form: `scheme://user:pass@host:port`. Total -- malformed input is `null`,
 * and every null path warns through {@link warnProxyRejected} naming `source`.
 */
function parseProxyUrl(raw: string, source: string): ProxyEndpoint | null {
  const trimmed = raw.trim();
  let url: URL;
  let port: number | null;
  let credentials: ProxyCredentials | undefined;
  try {
    url = new URL(trimmed);
    port = parsePort(explicitPort(trimmed, url));
    // Inside the `try` on purpose: `decodeURIComponent` raises `URIError` on a lone `%`, which an
    // un-encoded proxy password legitimately contains, and CFG-24 requires null rather than a throw.
    credentials = readUrlCredentials(url);
  } catch {
    // A malformed proxy URL is ordinary bad configuration, not a programmer error: CFG-24 requires
    // resolution to return null rather than throw.
    warnProxyRejected(source, 'unparseable');
    return null;
  }
  // Three gates, three distinct warnings. Kept as separate `if`s rather than the single conjunction
  // they were, because "the proxy was rejected" is not actionable and "the port is unusable" is.
  const type = PROXY_TYPE_BY_SCHEME.get(url.protocol);
  if (type === undefined) {
    warnProxyRejected(source, 'scheme');
    return null;
  }
  if (port === null) {
    warnProxyRejected(source, 'port');
    return null;
  }
  if (url.hostname === '') {
    warnProxyRejected(source, 'host');
    return null;
  }
  return {type, host: unbracketHost(url.hostname), port, credentials};
}

/**
 * CFG-24's property form. Host is `https.proxyHost` preferred over `http.proxyHost`, and the port
 * MUST come from the same layer as the chosen host -- an `https` host never borrows an `http` port.
 * Credentials read only from `https.proxyUser`/`https.proxyPassword`, with no `http.*` fallback,
 * even when the host came from the `http` layer.
 */
function resolveFromProperties(config: Configuration): ProxyEndpoint | null {
  const httpsHost = config.getRawProperty(PROPERTY_KEYS.httpsHost);
  const host = httpsHost ?? config.getRawProperty(PROPERTY_KEYS.httpHost);
  if (host === undefined || host === '') return null;

  const portKey =
    httpsHost === undefined ? PROPERTY_KEYS.httpPort : PROPERTY_KEYS.httpsPort;
  const port = parsePort(config.getRawProperty(portKey));
  if (port === null) return null;

  const username = config.getRawProperty(PROPERTY_KEYS.httpsUser);
  const password = config.getRawProperty(PROPERTY_KEYS.httpsPassword);
  // An empty user name is no credentials, the same rule the URL layer applies, so a blank
  // `https.proxyUser` does not fabricate a masked `***:***@` for a proxy that has none.
  const credentials =
    username === undefined || username === ''
      ? undefined
      : {username, password: password ?? ''};
  return {type: 'http', host: unbracketHost(host), port, credentials};
}

/** CFG-24's environment form, HTTPS_PROXY preferred over HTTP_PROXY. */
function resolveFromEnvironment(config: Configuration): ProxyEndpoint | null {
  const https = config.getString(CFG_KEY_HTTPS_PROXY);
  const source = https === undefined ? CFG_KEY_HTTP_PROXY : CFG_KEY_HTTPS_PROXY;
  const raw = https ?? config.getString(CFG_KEY_HTTP_PROXY);
  return raw === undefined ? null : parseProxyUrl(raw, source);
}

/**
 * Resolves proxy settings from configuration (CFG-24), or `null` when none is configured, the
 * configuration is invalid, or bypass-all is in force.
 *
 * Total: malformed input never throws (CFG-24, CFG-25). The property layer is consulted first and
 * the environment second; in the default Node wiring the property seam is empty, so this is
 * effectively environment-only there -- the precedence exists for a host that supplies a real
 * property store through the seam.
 *
 * Nothing here runs implicitly: the environment is read only because a caller invoked this (CFG-28).
 *
 * @param config - the configuration to resolve against.
 * @returns the resolved proxy, or `null`.
 *
 * @public
 */
export function resolveProxyOptions(
  config: Configuration,
): ProxyOptions | null {
  const {bypassAll, hosts} = resolveNonProxyHosts(config);
  if (bypassAll) return null;

  const endpoint =
    resolveFromProperties(config) ?? resolveFromEnvironment(config);
  if (endpoint === null) return null;

  // `bypassAll` is stated rather than left to the factory default: CFG-27 makes bypass-all resolve to
  // `null` above, so a `ProxyOptions` that came out of *resolution* can never carry `true`.
  return createProxyOptions({
    ...endpoint,
    nonProxyHosts: hosts,
    bypassAll: false,
  });
}
