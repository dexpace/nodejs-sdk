// SPDX-License-Identifier: MIT
// packages/core/src/auth/credential.ts
import {invariant} from '../invariant.js';

// No `as unique symbol` cast: TypeScript rejects `unique symbol` in a type assertion (TS1335). A
// `const` initialized directly by a `Symbol.for()` call already gets the `unique symbol` type, which
// is what makes it usable as a computed member name below.
const INSPECT: unique symbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * TypeScript has no friend classes, so {@link createBearerToken} -- a plain function, not a member --
 * reaches the private constructor through this module-scoped `let`, assigned exactly once inside the
 * class's `static {}` block. Init-once wiring, not mutable state; the same shape every builder-based
 * model in `src/http/` uses.
 */
let createToken: (token: string, expiresAt: number | undefined) => BearerToken;

/**
 * An OAuth2 bearer token (AUTH-8, AUTH-9, AUTH-10).
 *
 * A class with `#token`, not a frozen data object, for two reasons AUTH-8 and AUTH-9 make between
 * them:
 *
 * - **Redaction.** AUTH-8 requires EVERY credential type to redact its secret in any
 *   string/diagnostic representation. A plain `{token, expiresAt}` object redacts nothing:
 *   `console.log` prints the token, `JSON.stringify` serializes it, and any structured logger walking
 *   the object graph carries it into a log sink. `#token` is unreachable to all three, and the
 *   `toString`/inspect pair below gives the redacted form those paths fall back to. `expiresAt` stays
 *   an ordinary public field -- AUTH-8 explicitly permits non-secret fields to remain visible.
 * - **Nominality.** `TokenProvider` returns a `BearerToken`, so with a structural interface a provider
 *   could hand back an object literal and bypass AUTH-9's non-blank validation entirely. `#token`
 *   makes the type nominal and the `private` constructor makes {@link createBearerToken} the only way
 *   to build one, so the validation cannot be routed around.
 *
 * AUTH-8's VALUE equality is unaffected: it lives in {@link bearerTokensEqual}, a pure function over
 * the two fields, exactly as it did when this was a data object. There is deliberately no `equals`
 * member -- the key credentials below need reference identity, and keeping equality out of both
 * classes keeps that distinction in one place.
 *
 * @public
 */
export class BearerToken {
  readonly #token: string;
  /** Epoch ms; `undefined` means "never locally expires" (AUTH-10). Non-secret, so visible. */
  readonly expiresAt: number | undefined;

  private constructor(token: string, expiresAt: number | undefined) {
    this.#token = token;
    this.expiresAt = expiresAt;
    Object.freeze(this);
  }

  static {
    createToken = (token, expiresAt) => new BearerToken(token, expiresAt);
  }

  /** The opaque token, never blank (AUTH-9). Read by the stamping path that writes the header. */
  get token(): string {
    return this.#token;
  }

  /**
   * AUTH-8's redacted string form. The expiry survives; the token does not.
   *
   * @returns the representation with the token masked.
   */
  toString(): string {
    return `BearerToken{token=***, expiresAt=${String(this.expiresAt)}}`;
  }

  /**
   * The same redaction for `console.log`/`util.inspect`, which do not route object arguments through
   * `toString`. Node-specific but harmless elsewhere -- an unrecognized well-known symbol is simply
   * never read.
   *
   * @returns the redacted representation.
   */
  [INSPECT](): string {
    return this.toString();
  }
}

/**
 * Builds a frozen {@link BearerToken}. The only way to construct one: the constructor is `private`, so
 * AUTH-9's validation below cannot be bypassed by a provider returning a hand-built value.
 *
 * @param token - the opaque token. Must not be blank.
 * @param expiresAt - epoch ms at which the token expires, or `undefined` for "never locally expires".
 *   When present it must be a finite number.
 * @returns the frozen token.
 * @throws InvariantViolation when `token` is blank (AUTH-9), or when `expiresAt` is present but not
 *   finite -- both caller misconfigurations.
 *
 * @public
 */
export function createBearerToken(
  token: string,
  expiresAt?: number,
): BearerToken {
  invariant(token.trim().length > 0, 'bearer token must not be blank'); // AUTH-9
  // A `NaN` expiry makes every comparison in `isBearerTokenExpired` false, so the token reads as
  // permanently fresh and the cache stamps a dead credential forever -- silently, and with no
  // provider call to notice. Rejected at construction for the same reason `authStep` rejects a
  // non-finite margin: it is the identical bug arriving through the other door.
  invariant(
    expiresAt === undefined || Number.isFinite(expiresAt),
    `bearer token expiresAt must be a finite epoch, got ${String(expiresAt)}`,
  );
  return createToken(token, expiresAt);
}

/**
 * AUTH-8's VALUE equality for {@link BearerToken}, over the real token and expiry.
 *
 * A pure function rather than an `equals` member, deliberately: the two key credentials next door
 * need REFERENCE identity, and keeping equality out of every credential class is what stops one of
 * them acquiring value semantics by accident. The redacted string form has no bearing on it.
 *
 * @param a - the left token.
 * @param b - the right token.
 * @returns `true` when token and expiry both match.
 *
 * @public
 */
export function bearerTokensEqual(a: BearerToken, b: BearerToken): boolean {
  return a.token === b.token && a.expiresAt === b.expiresAt;
}

/**
 * AUTH-10: expired at `nowMs` with grace margin `marginMs` if and only if an expiry is set and
 * `nowMs + marginMs` strictly exceeds it. An exact hit on the expiry instant is NOT yet expired.
 *
 * @param token - the token to test.
 * @param nowMs - the reference time, epoch ms.
 * @param marginMs - the refresh grace margin in ms; `0` evaluates true expiry.
 * @returns `true` when the token is expired under that margin.
 *
 * @internal
 */
export function isBearerTokenExpired(
  token: BearerToken,
  nowMs: number,
  marginMs: number,
): boolean {
  return token.expiresAt !== undefined && nowMs + marginMs > token.expiresAt;
}

/**
 * The friend-class hooks for the two key credentials' secrets. `static-key.ts` -- a different module,
 * and the ONLY sanctioned reader -- reaches them through {@link credentialKey}.
 *
 * A public `get key()` would have been simpler and was the first shape here, but it re-opens exactly
 * the leak the `#key` note below argues against: it puts the secret back on the published `.d.ts`,
 * reachable as `credential.key` by any consumer, any diagnostic helper walking accessors, and any
 * future logging step. Init-once wiring assigned in each class's `static {}` block, not mutable state.
 */
let readApiKey: (credential: ApiKeyCredential) => string;
let readNameKey: (credential: NameKeyCredential) => string;

/**
 * The in-package read hook for a static key credential's secret (AUTH-26's stamping path).
 *
 * Exported (still internal-only, absent from the package barrel) because the one caller --
 * `stampStaticKey` -- lives in another module and TypeScript has no friend-class visibility to
 * express that with.
 *
 * @param credential - the credential whose secret is being stamped.
 * @returns the raw key.
 *
 * @internal
 */
export function credentialKey(
  credential: ApiKeyCredential | NameKeyCredential,
): string {
  return credential instanceof ApiKeyCredential
    ? readApiKey(credential)
    : readNameKey(credential);
}

/**
 * A static API key (AUTH-8, AUTH-9, AUTH-26).
 *
 * AUTH-8 requires REFERENCE equality here — "two instances with identical fields are NOT equal" — so
 * this is a class with a private field and deliberately NO `equals` override: `===`, the language
 * default, already gives exactly those semantics.
 *
 * `#key`, not `private key`, is the deliberate exception to `docs/knowledge/harvested/data-modeling.md`'s
 * `private`-by-default rule, and the same note requires the justification be written down: AUTH-8's
 * redaction is a RUNTIME-privacy requirement, not a compile-time one. `private` is erased, leaving the
 * secret reachable through `credential['key']`, `Object.keys`, `JSON.stringify`, and a default
 * `util.inspect` — exactly the accidental-leak paths the redacted `toString`/inspect exist to close.
 * `#key` is genuinely unreachable, and the nominality it induces is load-bearing besides: it is what
 * stops a caller substituting an object literal for a validated credential.
 *
 * @public
 */
export class ApiKeyCredential {
  readonly #key: string;

  /**
   * @param key - the secret key. Must not be blank.
   * @throws InvariantViolation when `key` is blank (AUTH-9).
   */
  constructor(key: string) {
    invariant(key.trim().length > 0, 'ApiKeyCredential key must not be blank'); // AUTH-9
    this.#key = key;
  }

  static {
    readApiKey = credential => credential.#key;
  }

  /**
   * AUTH-8's redacted string form.
   *
   * @returns a fixed representation with the key masked.
   */
  toString(): string {
    return 'ApiKeyCredential{key=***}';
  }

  /**
   * The same redaction for `console.log`/`util.inspect`, which do not route object arguments through
   * `toString`. Node-specific but harmless elsewhere — an unrecognized well-known symbol is simply
   * never read.
   *
   * @returns the redacted representation.
   */
  [INSPECT](): string {
    return this.toString();
  }
}

/**
 * A named static key — the header-name/secret pair AUTH-26 stamps (AUTH-8, AUTH-9).
 *
 * `#key` for the same runtime-privacy reason as {@link ApiKeyCredential}; `name` is non-secret, which
 * AUTH-8 explicitly permits to stay visible, so it is an ordinary public field.
 *
 * @public
 */
export class NameKeyCredential {
  /** The non-secret identifier — a header name, a key id. AUTH-8 permits this to stay visible. */
  readonly name: string;
  readonly #key: string;

  /**
   * @param name - the non-secret identifier. Must not be blank.
   * @param key - the secret key. Must not be blank.
   * @throws InvariantViolation when either is blank (AUTH-9).
   */
  constructor(name: string, key: string) {
    invariant(
      name.trim().length > 0,
      'NameKeyCredential name must not be blank',
    ); // AUTH-9
    invariant(key.trim().length > 0, 'NameKeyCredential key must not be blank'); // AUTH-9
    this.name = name;
    this.#key = key;
  }

  static {
    readNameKey = credential => credential.#key;
  }

  /**
   * AUTH-8's redacted string form: the name survives, the key does not.
   *
   * @returns the representation with the key masked.
   */
  toString(): string {
    return `NameKeyCredential{name=${this.name}, key=***}`;
  }

  /**
   * The same redaction for `console.log`/`util.inspect`. See {@link ApiKeyCredential} for why both
   * hooks are needed.
   *
   * @returns the redacted representation.
   */
  [INSPECT](): string {
    return this.toString();
  }
}

/**
 * AUTH-11: an async token source. A plain function type, no class.
 *
 * A throwing or rejecting provider propagates and is never cached — `bearer-cache.ts` simply does not
 * catch around the call, so that falls out of the structure rather than needing an explicit branch.
 *
 * **A provider MUST carry its own deadline.** It takes NO parameters, deliberately -- not even an
 * optional `{signal}` bag. AUTH-34 coalesces every concurrent caller racing on a missing or expiring
 * token onto ONE fetch, so that fetch belongs to no single request: handing it one caller's signal
 * would let a stranger's cancellation reject callers who never aborted, including a caller who
 * supplied no signal at all, and would let a request that merely finished tear down a refresh other
 * requests are joined to. `bearer-cache.ts` races each caller's own WAIT against that caller's own
 * signal instead, which cancels the wait without cancelling the work.
 *
 * Since nothing can ever populate a signal parameter, there is no signal parameter -- a slot
 * documented as never filled is worse than no slot, because a caller writes code against it and then
 * wonders why cancelling does nothing. The consequence is that nothing outside the provider can bound
 * the fetch, so the provider must bound itself:
 *
 * ```ts
 * const provider: TokenProvider = () => fetchToken({signal: AbortSignal.timeout(5_000)});
 * ```
 *
 * `docs/knowledge/harvested/concurrency-and-async.md`'s "every external I/O call must carry a deadline" is the
 * rule this discharges; its "pass the caller's signal down to the I/O primitive" rule is the one
 * deliberately not applied here, because the premise it rests on -- that the call owns the I/O -- is
 * false for a coalesced fetch. Recorded in the phase checklist's Deviation Ledger.
 *
 * @public
 */
export type TokenProvider = () => Promise<BearerToken>;
