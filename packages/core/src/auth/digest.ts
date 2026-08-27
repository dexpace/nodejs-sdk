// SPDX-License-Identifier: MIT
// packages/core/src/auth/digest.ts
import {hasForbiddenOutboundByte} from '../http/ascii-validation.js';
import {invariant} from '../invariant.js';
import type {
  Challenge,
  ChallengeHandler,
  DigestUriContext,
} from './challenge.js';
import {md5, toHex} from './md5.js';

/**
 * AUTH-15: exactly these four algorithms are supported. `auth-int` and every other algorithm is
 * declined rather than approximated.
 *
 * @public
 */
export type DigestAlgorithm = 'MD5' | 'MD5-sess' | 'SHA-256' | 'SHA-256-sess';

// `as const`, not a bare `readonly` annotation, so the CONSTANT_CASE is honest: `naming-conventions.md`
// reserves that casing for deeply immutable values, and a bare `readonly DigestAlgorithm[]` annotation
// is a compile-time claim only -- the array stays mutable at runtime through a cast.
const SUPPORTED_ALGORITHMS = [
  'MD5',
  'MD5-sess',
  'SHA-256',
  'SHA-256-sess',
] as const satisfies readonly DigestAlgorithm[];

// Strongest first. AUTH-16 makes this list the PREFERENCE order, applied regardless of the order the
// server offered its challenges in.
const DEFAULT_ALGORITHM_PREFERENCE = [
  'SHA-256-sess',
  'SHA-256',
  'MD5-sess',
  'MD5',
] as const satisfies readonly DigestAlgorithm[];

const NONCE_COUNT_LIMIT = 1024;

/**
 * Digest handler tuning.
 *
 * @internal
 */
export interface DigestOptions {
  /**
   * Preferred-first order, and also the ACCEPTABLE set: an algorithm absent from this list is
   * declined outright (AUTH-16). Defaults to `['SHA-256-sess', 'SHA-256', 'MD5-sess', 'MD5']`.
   */
  readonly algorithmPreference?: readonly DigestAlgorithm[] | undefined;
}

function baseAlgorithm(algorithm: DigestAlgorithm): 'MD5' | 'SHA-256' {
  return algorithm.startsWith('MD5') ? 'MD5' : 'SHA-256';
}

/**
 * AUTH-21's non-UTF-8 branch. ISO-8859-1 is a byte-for-byte code-unit copy for every character it can
 * represent; a character outside the codebook has no ISO-8859-1 encoding at all, and truncating is the
 * same lossy answer every other Latin-1 encoder gives. A server that expects such a character is
 * required to advertise `charset=UTF-8`, which routes to the other branch.
 */
function encodeLatin1(input: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) bytes[i] = input.charCodeAt(i);
  return bytes;
}

/**
 * AUTH-21's UTF-8 branch, copied into a freshly-allocated buffer.
 *
 * The copy is not incidental: `crypto.subtle.digest` takes a `BufferSource`, which excludes a view
 * that might sit on a `SharedArrayBuffer`, and `TextEncoder.encode` is typed as the wider
 * `Uint8Array<ArrayBufferLike>`. Re-narrowing with a cast would assert something the type system
 * cannot check; allocating an exact-typed buffer costs one copy of a string that is never more than a
 * few hundred bytes.
 */
function encodeUtf8(input: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(input);
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return bytes;
}

/** AUTH-17/AUTH-21: one hash, over one encoding of one string. */
interface HashInput {
  readonly base: 'MD5' | 'SHA-256';
  readonly input: string;
  /** AUTH-21: UTF-8 when the challenge advertised `charset=UTF-8`, ISO-8859-1 otherwise. */
  readonly isUtf8: boolean;
}

// An options object rather than three positional parameters: `function-design.md` requires one at
// three or more parameters, and unconditionally for any boolean parameter -- `hashHex(base, s, true)`
// says nothing at the call site about what the `true` selects.
async function hashHex({base, input, isUtf8}: HashInput): Promise<string> {
  const bytes = isUtf8 ? encodeUtf8(input) : encodeLatin1(input);
  // MD5 is hand-rolled because Web Crypto excludes it; SHA-256 goes through Web Crypto rather than
  // `node:crypto` to keep the package portable (SEAM-1, `sdk-design-nodejs/06`).
  if (base === 'MD5') return toHex(md5(bytes));
  return toHex(
    new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)),
  );
}

/**
 * The per-server-nonce request counter (AUTH-18, AUTH-19).
 *
 * `nc` starts at 1 for a first-seen nonce, increments only on reuse of that same nonce, and wraps to
 * the low 32 bits on overflow. Bounded at 1024 entries with insertion-order eviction — `Map`
 * iteration order IS insertion order, so the oldest key is `keys().next().value` and no separate LRU
 * structure is needed. Evicting a live nonce is harmless: its count restarts at 1, which is
 * spec-legal for a nonce the server has just re-issued.
 *
 * The eviction is an insert-THEN-drain, never a pre-insert check-then-evict: `next()` admits the
 * nonce first and only then brings the map back under the cap, which is how
 * `docs/knowledge/concurrency-and-async.md` (XCUT-14) and AUTH-19 both word it — "drained back under
 * the cap after admitting a nonce". The key space is the SERVER's, since it picks the nonces, so a
 * pre-insert evict would leave a burst sitting above the cap rather than converging to it.
 *
 * The drain is a `while` rather than an `if` purely as defence, and the distinction is NOT currently
 * observable: `next()` grows the map by at most one entry per call, so the body can run at most once
 * and the two spellings are equivalent today. The loop is what keeps the bound true if `NONCE_COUNT_LIMIT`
 * is ever lowered at runtime or a second writer is ever added.
 *
 * AUTH-24's concurrency clause: `next()` is one synchronous read-increment-write with no `await`
 * between the read and the write, so two concurrent callers cannot observe the same count. Node and
 * Bun have no preemptive interleaving mid-statement — the same collapse 5a documented for BODY-3's
 * materialize-once guard.
 *
 * @internal
 */
export class NonceCountStore {
  private readonly counts = new Map<string, number>();

  /**
   * The number of nonces currently tracked.
   *
   * Exposed so the bound itself is assertable — otherwise "drained back under the cap" is testable
   * only through the indirect "an evicted nonce restarts at 1" probe, which passes for a
   * single-victim-per-insert store that never converges.
   */
  get size(): number {
    return this.counts.size;
  }

  /**
   * Returns the nonce count to send with this request (AUTH-18).
   *
   * @param nonce - the server-chosen nonce being answered.
   * @returns `1` the first time this nonce is seen, one more than the previous value on each reuse,
   *   wrapping to the low 32 bits on overflow.
   */
  next(nonce: string): number {
    const current = this.counts.get(nonce);
    const count = current === undefined ? 1 : (current + 1) >>> 0;
    this.counts.set(nonce, count);

    // The just-admitted nonce sits at the TAIL of insertion order (a `set` on an existing key leaves
    // the map's size unchanged, so the loop is not entered at all on a reuse), which is why draining
    // from the head can never evict the live nonce this call is answering with.
    while (this.counts.size > NONCE_COUNT_LIMIT) {
      const oldest = this.counts.keys().next().value;
      invariant(
        oldest !== undefined,
        'nonce-count store is over its bound but reports no oldest entry',
      );
      this.counts.delete(oldest);
    }

    return count;
  }
}

/** AUTH-18: exactly 8 lower-case hex digits. */
function formatNonceCount(count: number): string {
  return count.toString(16).padStart(8, '0');
}

/** AUTH-20: at least 128 bits from a CSPRNG. Never `Math.random()`. */
function generateClientNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

interface ParsedDigestChallenge {
  readonly algorithm: DigestAlgorithm;
  readonly realm: string;
  readonly nonce: string;
  /**
   * Whether `qop=auth` was negotiated. Named for what it HOLDS, not for the wire parameter: `qop` on
   * the wire is a string (`auth`, `auth-int`), so a boolean called `qop` reads as that value.
   */
  readonly hasQopAuth: boolean;
  readonly isUtf8: boolean;
  /**
   * AUTH-22 names `opaque` in the must-quote list, which only makes sense if it is emitted: RFC 7616
   * requires the client return the server's opaque value unchanged, and a server that binds session
   * state to it rejects a request that omits it. Absent when the challenge carried none.
   */
  readonly opaque: string | undefined;
}

/**
 * AUTH-22 echoes `realm`, `nonce`, and `opaque` VERBATIM into the `Authorization` value, and HTTP-18's
 * outbound grammar admits only HTAB plus printable ASCII. A received challenge is held to the laxer
 * inbound rule (HTTP-19 permits obs-text, exactly so a Latin-1 field is not silently dropped), so a
 * server may legitimately hand us a realm this client cannot echo -- `Digest realm="café"` is a real
 * RFC 7616 shape, which is why the spec has a `charset` parameter at all.
 *
 * Declining such a challenge makes `canHandle` false, so the composer finds no candidate and AUTH-33
 * surfaces the 401 unchanged. That is strictly better than the alternative it replaces, which was to
 * build the header anyway and throw `HeaderValidationError` out of the whole auth step -- turning a
 * challenge the caller could have inspected into an exception. Relaxing the outbound rule instead was
 * never an option: HTTP-17/18/19's strictness is the request-splitting defence.
 *
 * The consequence is that AUTH-21's UTF-8 branch is reachable for the HASH INPUT (where a non-ASCII
 * password lives and works) but not for the realm ECHO. RFC 7616 §4's `username*` (RFC 5987) extended
 * notation is the standard answer and is deferred; both are recorded in the Deviation Ledger.
 */
function isHeaderSafeEcho(info: {
  readonly realm: string;
  readonly nonce: string;
  readonly opaque: string | undefined;
}): boolean {
  return (
    !hasForbiddenOutboundByte(info.realm) &&
    !hasForbiddenOutboundByte(info.nonce) &&
    (info.opaque === undefined || !hasForbiddenOutboundByte(info.opaque))
  );
}

/**
 * AUTH-16: satisfiable if and only if the scheme is `digest`, `realm` and `nonce` are both present,
 * `qop` is absent or contains `auth`, the algorithm (defaulting to `MD5`) is in the caller's
 * configured preference list, and every field AUTH-22 echoes back is header-safe
 * ({@link isHeaderSafeEcho}).
 */
function parseDigestChallenge(
  challenge: Challenge,
  preference: readonly DigestAlgorithm[],
): ParsedDigestChallenge | undefined {
  if (challenge.scheme !== 'digest') return undefined;
  const realm = challenge.params.get('realm');
  const nonce = challenge.params.get('nonce');
  if (realm === undefined || nonce === undefined) return undefined;

  const qopRaw = challenge.params.get('qop');
  const hasQop = qopRaw !== undefined;
  // AUTH-15: an `auth-int`-only challenge is DECLINED, not silently downgraded.
  if (
    hasQop &&
    !qopRaw.split(',').some(entry => entry.trim().toLowerCase() === 'auth')
  ) {
    return undefined;
  }

  const algorithmRaw = challenge.params.get('algorithm');
  const algorithm =
    algorithmRaw === undefined
      ? 'MD5'
      : SUPPORTED_ALGORITHMS.find(
          candidate => candidate.toLowerCase() === algorithmRaw.toLowerCase(),
        );
  if (algorithm === undefined || !preference.includes(algorithm)) {
    return undefined;
  }

  const isUtf8 =
    (challenge.params.get('charset') ?? '').toLowerCase() === 'utf-8';
  const info: ParsedDigestChallenge = {
    algorithm,
    realm,
    nonce,
    hasQopAuth: hasQop,
    isUtf8,
    opaque: challenge.params.get('opaque'),
  };
  return isHeaderSafeEcho(info) ? info : undefined;
}

/**
 * Everything {@link computeDigestResponse} needs. Bundled into one object because the computation
 * genuinely takes eleven inputs and `max-params` is 3.
 *
 * @internal
 */
export interface DigestComputationInput {
  /** The negotiated algorithm; `-sess` variants fold the nonce and cnonce into HA1. */
  readonly algorithm: DigestAlgorithm;
  /** The challenge's realm. */
  readonly realm: string;
  /** The server-chosen nonce. */
  readonly nonce: string;
  /** Whether `qop=auth` was negotiated. `false` selects RFC 2069's shorter response input. */
  readonly hasQopAuth: boolean;
  /** AUTH-21: UTF-8 hash input when the challenge advertised `charset=UTF-8`, ISO-8859-1 otherwise. */
  readonly isUtf8: boolean;
  /** The request method. */
  readonly method: string;
  /** The digest-uri: the request-target. */
  readonly uri: string;
  /** The user id. */
  readonly username: string;
  /** The password. */
  readonly password: string;
  /** The client nonce; ignored when `qop` is `false`. */
  readonly cnonce: string;
  /** The 8-hex-digit nonce count; ignored when `qop` is `false`. */
  readonly nc: string;
}

/**
 * Computes HA1, HA2, and the Digest response per RFC 7616/2069 (AUTH-17), in lower-case hex.
 *
 * Exported, and taking a single bundled parameter, so it can be unit-tested directly against fixed,
 * independently-verified vectors: `digestHandler()`'s own `stamp()` always generates a fresh random
 * cnonce (AUTH-20), so its output can never be asserted against a fixed expected hash end-to-end.
 *
 * @param input - the full computation input.
 * @returns the response value, lower-case hex.
 *
 * @internal
 */
export async function computeDigestResponse(
  input: DigestComputationInput,
): Promise<string> {
  const base = baseAlgorithm(input.algorithm);
  const isUtf8 = input.isUtf8;
  const ha1Plain = await hashHex({
    base,
    input: `${input.username}:${input.realm}:${input.password}`,
    isUtf8,
  });
  const ha1 = input.algorithm.endsWith('-sess')
    ? await hashHex({
        base,
        input: `${ha1Plain}:${input.nonce}:${input.cnonce}`,
        isUtf8,
      })
    : ha1Plain;
  const ha2 = await hashHex({
    base,
    input: `${input.method}:${input.uri}`,
    isUtf8,
  });
  const responseInput = input.hasQopAuth
    ? `${ha1}:${input.nonce}:${input.nc}:${input.cnonce}:auth:${ha2}`
    : `${ha1}:${input.nonce}:${ha2}`;
  return hashHex({base, input: responseInput, isUtf8});
}

/** AUTH-22's quoting: a quoted-string with `\` and `"` escaped. */
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

interface HeaderValueParams {
  readonly username: string;
  readonly info: ParsedDigestChallenge;
  readonly uri: string;
  readonly response: string;
  readonly cnonce: string;
  readonly nc: string;
}

/**
 * AUTH-22: quotes `username`/`realm`/`nonce`/`uri`/`response`/`cnonce`/`opaque`; leaves
 * `qop`/`nc`/`algorithm` unquoted, with the full algorithm spelling; emits `cnonce`/`nc`/`qop` only
 * when `qop` was actually negotiated.
 */
function buildHeaderValue(params: HeaderValueParams): string {
  const {username, info, uri, response, cnonce, nc} = params;
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(info.realm)}`,
    `nonce=${quote(info.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${info.algorithm}`,
    `response=${quote(response)}`,
  ];
  // AUTH-22: `opaque` is quoted and echoed back verbatim when the challenge carried one.
  if (info.opaque !== undefined) parts.push(`opaque=${quote(info.opaque)}`);
  if (info.hasQopAuth)
    parts.push('qop=auth', `nc=${nc}`, `cnonce=${quote(cnonce)}`);
  return `Digest ${parts.join(', ')}`;
}

/**
 * The Digest challenge handler (AUTH-15–AUTH-22).
 *
 * Cryptographic primitives are split across two sources for portability: `md5.ts` for MD5/MD5-sess,
 * which Web Crypto deliberately excludes, and `crypto.subtle.digest('SHA-256', …)` for the SHA-256
 * pair. The client nonce comes from `crypto.getRandomValues()` (AUTH-20).
 *
 * The per-nonce counter is the one piece of mutable state, and it needs no lock: nothing awaits
 * between its read and its write (AUTH-24).
 *
 * Challenge-reactive only — Digest structurally cannot stamp before seeing the server's
 * `realm`/`nonce`.
 *
 * @param username - the user id. Must not be blank, and must be header-safe (printable ASCII):
 *   AUTH-22 writes it into the `Authorization` value verbatim.
 * @param password - the password. Must not be blank. May hold any character — it only ever reaches
 *   the hash input, which is where AUTH-21's UTF-8/Latin-1 choice applies.
 * @param options - algorithm preference; omitted means strongest-first over all four.
 * @returns a handler that answers satisfiable `digest` challenges.
 * @throws InvariantViolation when either credential is blank, or the username carries a byte HTTP-18
 *   forbids in an outbound header value — both caller misconfigurations.
 *
 * @internal
 */
export function digestHandler(
  username: string,
  password: string,
  options?: DigestOptions,
): ChallengeHandler {
  invariant(username.trim().length > 0, 'Digest username must not be blank');
  invariant(password.trim().length > 0, 'Digest password must not be blank');
  // Configuration, not wire data: a non-ASCII username is the caller's own mistake, so it fails fast
  // and loudly at construction rather than being declined silently per-request the way an
  // unechoable server realm is. RFC 7616 §4's `username*` encoding would lift this and is deferred.
  invariant(
    !hasForbiddenOutboundByte(username),
    'Digest username must be header-safe (printable ASCII); RFC 7616 username* encoding is not yet supported',
  );
  const preference =
    options?.algorithmPreference ?? DEFAULT_ALGORITHM_PREFERENCE;
  const nonceCounts = new NonceCountStore();

  return {
    canHandle: (challenge: Challenge): boolean =>
      parseDigestChallenge(challenge, preference) !== undefined,

    // AUTH-16: among several Digest challenges differing only by algorithm, prefer the one earliest
    // in the CONFIGURED list, not the one earliest on the wire.
    rank: (challenge: Challenge): number => {
      const parsed = parseDigestChallenge(challenge, preference);
      return parsed === undefined
        ? Number.MAX_SAFE_INTEGER
        : preference.indexOf(parsed.algorithm);
    },

    stamp: async (
      challenge: Challenge,
      request?: DigestUriContext,
    ): Promise<string> => {
      const info = parseDigestChallenge(challenge, preference);
      invariant(
        info !== undefined,
        'digestHandler.stamp called with a challenge canHandle() would reject',
      );
      invariant(
        request !== undefined,
        'digestHandler.stamp requires a DigestUriContext (method + requestTarget)',
      );

      const cnonce = generateClientNonce();
      const nc = info.hasQopAuth
        ? formatNonceCount(nonceCounts.next(info.nonce))
        : '';
      const response = await computeDigestResponse({
        algorithm: info.algorithm,
        realm: info.realm,
        nonce: info.nonce,
        hasQopAuth: info.hasQopAuth,
        isUtf8: info.isUtf8,
        method: request.method,
        uri: request.requestTarget,
        username,
        password,
        cnonce,
        nc,
      });
      return buildHeaderValue({
        username,
        info,
        uri: request.requestTarget,
        response,
        cnonce,
        nc,
      });
    },
  };
}
