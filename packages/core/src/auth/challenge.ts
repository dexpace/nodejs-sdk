// SPDX-License-Identifier: MIT
// packages/core/src/auth/challenge.ts

/**
 * One parsed RFC 7235 challenge (AUTH-12): the scheme plus its auth-params.
 *
 * Scheme and parameter names are lower-cased; parameter values are stored verbatim after unquoting.
 *
 * @internal
 */
export interface Challenge {
  /** The challenge scheme, lower-cased. */
  readonly scheme: string;
  /** Auth-params, keys lower-cased, values verbatim after unquoting. */
  readonly params: ReadonlyMap<string, string>;
}

/**
 * What a handler needs from the request being stamped, beyond the challenge itself.
 *
 * Digest's HA2 is computed over the method and the request-target (RFC 7616 §3.4.3), neither of which
 * the challenge carries. Passed as a small context object rather than the whole `Request` so a handler
 * cannot reach the body or headers it has no business reading.
 *
 * @internal
 */
export interface DigestUriContext {
  /** The request method, upper-case, as it goes on the wire. */
  readonly method: string;
  /** The digest-uri: the request-target (path plus query) of the request being stamped. */
  readonly requestTarget: string;
}

/**
 * One challenge-reactive stamping strategy (AUTH-23–AUTH-25). Implemented by `basic.ts` and
 * `digest.ts`, composed by `composing-handler.ts`.
 *
 * Throughout `auth/`, to STAMP means to PRODUCE the value the caller writes, never to write it: every
 * `stamp` in this module (`ChallengeHandler.stamp`, `ComposingHandler.stamp`, `stampStaticKey`,
 * `BearerTokenCache.stamp`) returns credential material and leaves the header write to `auth-step.ts`.
 *
 * Declared here rather than in `composing-handler.ts` so both implementations can be written before
 * the composer exists, and because `challenge.ts` already owns the {@link Challenge} type both
 * methods operate on.
 *
 * `stamp()` is asynchronous because Digest's SHA-256/SHA-256-sess algorithms compute HA1/HA2/response
 * through `crypto.subtle.digest()`, and Web Crypto offers no synchronous digest to fall back to.
 * Basic's implementation resolves immediately.
 *
 * @internal
 */
export interface ChallengeHandler {
  /**
   * AUTH-16/AUTH-25: whether this handler can answer `challenge`.
   *
   * @param challenge - the offered challenge.
   * @returns `true` when this handler can produce a header value for it.
   */
  canHandle(challenge: Challenge): boolean;

  /**
   * Produces the header VALUE only — the caller picks `Authorization` vs `Proxy-Authorization` from
   * which challenge header the status actually carried (AUTH-25).
   *
   * There is deliberately no `isProxy` parameter. It was one, threaded from `auth-step.ts` through
   * `composing-handler.ts` into both implementations, and NEITHER read it: Basic's value is computed
   * once at construction and Digest's depends only on the challenge and the request-target, so the
   * only test either could carry for the parameter was one asserting it changed nothing. AUTH-25's
   * origin-vs-proxy choice lives entirely in `auth-step.ts`'s `answerHeaderName`, which is the one
   * place that knows which challenge header the status carried. A future scheme whose VALUE differs
   * by proxy-ness would add it back — and would then have something to assert about it.
   *
   * @param challenge - the challenge being answered; `canHandle` has already passed.
   * @param request - the request being stamped. Optional so a handler needing neither method nor
   *   target (Basic) is callable with one argument; Digest asserts its presence.
   * @returns the header value.
   */
  stamp(challenge: Challenge, request?: DigestUriContext): Promise<string>;

  /**
   * AUTH-16's "earliest in the configured preference list, not wire order": when a server offers
   * several challenges a single handler could equally satisfy — RFC 7616 uses repeated Digest
   * challenges differing only by `algorithm` as an algorithm-discovery mechanism — `canHandle` alone
   * can only answer yes/no per challenge, never express a preference among them.
   *
   * Lower is more preferred. Optional: a handler with no algorithm variants (Basic) omits it and is
   * treated as rank 0.
   *
   * @param challenge - the offered challenge.
   * @returns the preference rank; lower wins.
   */
  rank?(challenge: Challenge): number;
}

/**
 * AUTH-12 names this key literally: a token68 value is "recorded under a synthetic key", spelled
 * `token68` in the requirement's own text. A genuine `token68=...` auth-param does not exist in RFC
 * 7235's grammar — token68 is positional, never `name=value` — so no collision with a real parameter
 * is possible.
 */
const TOKEN68_KEY = 'token68';
const TOKEN_CHAR = /[!#$%&'*+\-.^_`|~0-9A-Za-z]/u;
const TOKEN68_CHAR = /[A-Za-z0-9\-._~+/]/u;

interface Scanner {
  readonly text: string;
  pos: number;
}

/**
 * The one place BWS (RFC 7230's optional SP/HTAB run) is skipped, shared by the Scanner-driven walk
 * and the two lookahead predicates below -- which cannot take a `Scanner`, because they must not
 * advance one.
 */
function skipBwsFrom(text: string, from: number): number {
  let index = from;
  while (index < text.length && (text[index] === ' ' || text[index] === '\t')) {
    index += 1;
  }
  return index;
}

function skipSpaces(scanner: Scanner): void {
  scanner.pos = skipBwsFrom(scanner.text, scanner.pos);
}

function readToken(scanner: Scanner): string {
  const start = scanner.pos;
  while (
    scanner.pos < scanner.text.length &&
    TOKEN_CHAR.test(scanner.text[scanner.pos] ?? '')
  )
    scanner.pos += 1;
  return scanner.text.slice(start, scanner.pos);
}

function readToken68Tail(scanner: Scanner): string {
  const start = scanner.pos;
  while (scanner.pos < scanner.text.length) {
    const char = scanner.text[scanner.pos] ?? '';
    // '=' is token68's own padding, not an assignment: the caller only reaches here after ruling out
    // a `name=value` reading.
    if (!TOKEN68_CHAR.test(char) && char !== '=') break;
    scanner.pos += 1;
  }
  return scanner.text.slice(start, scanner.pos);
}

/**
 * Honors backslash escapes (AUTH-12). An unterminated string ends at end-of-input rather than
 * throwing (AUTH-13).
 */
function readQuotedString(scanner: Scanner): string {
  scanner.pos += 1; // opening quote, already confirmed present by the caller
  let value = '';
  while (scanner.pos < scanner.text.length) {
    // `?? ''` throughout, not a cast: `noUncheckedIndexedAccess` types every index read as
    // `string | undefined`, and the loop bound already rules the undefined out.
    const char = scanner.text[scanner.pos] ?? '';
    if (char === '\\' && scanner.pos + 1 < scanner.text.length) {
      value += scanner.text[scanner.pos + 1] ?? '';
      scanner.pos += 2;
      continue;
    }
    if (char === '"') {
      scanner.pos += 1;
      return value;
    }
    value += char;
    scanner.pos += 1;
  }
  return value;
}

/**
 * Consumes, without capturing, up to and including the next top-level comma — the recovery path for a
 * malformed segment (AUTH-13). Quote depth is tracked, so a comma inside a quoted value is not a
 * recovery point.
 */
function skipToNextTopLevelComma(scanner: Scanner): void {
  let inQuotes = false;
  while (scanner.pos < scanner.text.length) {
    const char = scanner.text[scanner.pos];
    if (char === '\\' && inQuotes && scanner.pos + 1 < scanner.text.length) {
      scanner.pos += 2;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      scanner.pos += 1;
      return;
    }
    scanner.pos += 1;
  }
}

/** Whether the next non-whitespace character is the `=` of a `name=value` auth-param. */
function peekIsParamAssignment(text: string, fromPos: number): boolean {
  return text[skipBwsFrom(text, fromPos)] === '=';
}

/**
 * Whether a `name=value` reading is viable: an `=` followed, after optional BWS, by a real token or
 * quoted-string value.
 *
 * Only the position immediately after a scheme name needs this stricter test, because that is the one
 * place RFC 7235 permits a positional `token68` — and a token68 may END in one or more `=` (base64
 * padding), so `Negotiate YWJj==` would otherwise be misread as an auth-param `ywjj` with an empty
 * value. Everywhere else inside a challenge the loose `=` test stands, so a genuinely empty auth-param
 * value stays an empty auth-param rather than being re-read as a token68 that cannot appear there.
 */
function peekIsValuedParam(text: string, fromPos: number): boolean {
  const equalsAt = skipBwsFrom(text, fromPos);
  if (text[equalsAt] !== '=') return false;
  const next = text[skipBwsFrom(text, equalsAt + 1)] ?? '';
  return next === '"' || TOKEN_CHAR.test(next);
}

function readValue(scanner: Scanner): string {
  return scanner.text[scanner.pos] === '"'
    ? readQuotedString(scanner)
    : readToken(scanner);
}

interface MutableChallenge {
  readonly scheme: string;
  readonly params: Map<string, string>;
}

/** Reads one `name=value` pair into `current`. The caller has already confirmed the `=` follows. */
function readParamInto(
  scanner: Scanner,
  name: string,
  current: MutableChallenge,
): void {
  skipSpaces(scanner);
  scanner.pos += 1; // '='
  skipSpaces(scanner);
  current.params.set(name.toLowerCase(), readValue(scanner));
  skipSpaces(scanner);
  if (scanner.text[scanner.pos] === ',') scanner.pos += 1;
}

/** Reads the optional token68-or-first-param tail immediately following a freshly-read scheme name. */
function readSchemeTail(scanner: Scanner, current: MutableChallenge): void {
  skipSpaces(scanner);
  if (scanner.pos >= scanner.text.length || scanner.text[scanner.pos] === ',')
    return;
  const savedPos = scanner.pos;
  const maybeName = readToken(scanner);
  if (maybeName !== '' && peekIsValuedParam(scanner.text, scanner.pos)) {
    readParamInto(scanner, maybeName, current);
    return;
  }
  scanner.pos = savedPos;
  const token68 = readToken68Tail(scanner);
  if (token68 !== '') current.params.set(TOKEN68_KEY, token68);
  skipSpaces(scanner);
  if (scanner.text[scanner.pos] === ',') scanner.pos += 1;
}

/**
 * Parses an RFC 7235 `WWW-Authenticate`/`Proxy-Authenticate` value into its ordered challenge list
 * (AUTH-12).
 *
 * Total by construction (AUTH-13): it never throws, for any input. Blank input yields `[]`; a
 * malformed segment recovers at the next top-level comma through a quote-depth-tracked scan — never a
 * naive `.split(',')`, which breaks on a quoted value containing a comma; params parsed before a
 * malformed tail are kept; an unterminated quoted string terminates at end-of-input.
 *
 * Hand-written for the same reason 5a's RFC 1123 `Retry-After` date parser was: there is no built-in
 * RFC 7235 parser to lean on, and a general-purpose header splitter would not honor quoted-string
 * commas.
 *
 * @param headerValue - the raw header value.
 * @returns the challenges, in wire order. Never throws.
 *
 * @internal
 */
export function parseChallenges(headerValue: string): readonly Challenge[] {
  const challenges: MutableChallenge[] = [];
  const scanner: Scanner = {text: headerValue, pos: 0};

  for (;;) {
    skipSpaces(scanner);
    if (scanner.pos >= scanner.text.length) break;
    if (scanner.text[scanner.pos] === ',') {
      scanner.pos += 1;
      continue;
    }

    const token = readToken(scanner);
    if (token === '') {
      skipToNextTopLevelComma(scanner);
      continue;
    }

    if (peekIsParamAssignment(scanner.text, scanner.pos)) {
      // A `name=value` with no scheme ahead of it: attach it to the challenge in progress, or discard
      // the segment when the header opens with one.
      const current = challenges.at(-1);
      if (current === undefined) {
        skipToNextTopLevelComma(scanner);
        continue;
      }
      readParamInto(scanner, token, current);
      continue;
    }

    const current: MutableChallenge = {
      scheme: token.toLowerCase(),
      params: new Map(),
    };
    challenges.push(current);
    readSchemeTail(scanner, current);
  }

  // `Object.freeze` is SHALLOW, and `params` is a `Map`, which `Object.freeze` cannot make read-only
  // at all -- `.set()` still succeeds on a frozen Map. The `ReadonlyMap` TYPE is therefore the only
  // guard on the parameters, exactly as `createAuthRequirement` documents for its own params map, and
  // it holds for the same reason: `Challenge` is `@internal`, never reaches a consumer, and nothing
  // in this package re-casts `Challenge['params']` back to `Map`.
  return challenges.map(entry =>
    Object.freeze({scheme: entry.scheme, params: entry.params}),
  );
}
