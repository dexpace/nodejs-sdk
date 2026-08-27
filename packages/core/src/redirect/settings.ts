// SPDX-License-Identifier: MIT
// packages/core/src/redirect/settings.ts
import {hasForbiddenNameByte} from '../http/ascii-validation.js';
import type {Method} from '../http/method.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import {DEFAULT_ALLOWED_METHODS} from './codes.js';

/**
 * REDIR-20's read-only condition snapshot. Allocated for EVERY recognized 3xx -- including one carrying
 * no usable `Location` -- and never on the non-redirect fast path (REDIR-21).
 *
 * `visited` is insertion-ordered and includes the current request's URI.
 *
 * @internal
 */
export interface RedirectCondition {
  readonly response: Response;
  readonly redirectsFollowed: number;
  readonly visited: ReadonlySet<string>;
}

/**
 * REDIR-20: fully overrides the built-in code/method eligibility decision. It does NOT override the
 * wire-safety mechanics that follow it -- credential stripping, the downgrade guard, body replayability,
 * loop and hop-cap detection -- see `decide.ts`'s note on the scope of that override.
 *
 * @internal
 */
export type RedirectPredicate = (
  condition: Readonly<RedirectCondition>,
) => boolean;

/**
 * Redirect policy. Every field is optional at the construction surface ({@link redirectSettings} takes a
 * `Partial`), so a zero-config call yields the spec defaults and a caller can override one field without
 * restating the rest.
 *
 * @internal
 */
export interface RedirectSettings {
  /** REDIR-17: a non-negative integer, default 3. `0` disables following, with no special branch anywhere downstream. */
  readonly maxHops: number;
  /** REDIR-3/REDIR-4: default `{GET, HEAD}`; stored as a defensive copy (REDIR-26). */
  readonly allowedMethods: ReadonlySet<Method>;
  /** REDIR-5: 303 is not followed unless this is opted in. */
  readonly allow303: boolean;
  /** REDIR-15: permits an HTTPS-to-HTTP hop, which is then surfaced observably by the step. */
  readonly allowSchemeDowngrade: boolean;
  /** REDIR-27: the response header the target is read from, default `Location`. Stored trimmed. */
  readonly locationHeader: string;
  /** REDIR-20: replaces the built-in code/method eligibility decision when present. */
  readonly predicate?: RedirectPredicate | undefined;
}

/**
 * The spec defaults, frozen.
 *
 * @internal
 */
export const DEFAULT_REDIRECT_SETTINGS: RedirectSettings = Object.freeze({
  maxHops: 3,
  allowedMethods: DEFAULT_ALLOWED_METHODS,
  allow303: false,
  allowSchemeDowngrade: false,
  locationHeader: 'Location',
});

/**
 * Builds validated, frozen redirect settings.
 *
 * An invalid value is a PROGRAMMER error, the same split 5a's `retrySettings()` applied -- `invariant()`,
 * not a new error leaf. `NonReplayableBodyError` and `SchemeDowngradeError` are the two OPERATIONAL
 * failures a caller can legitimately hit mid-redirect; a bad `maxHops` is neither.
 *
 * `maxHops: 0` needs no special branch here or downstream: `decide()`'s hop-cap gate applies uniformly to
 * every value, and a 0-hop budget simply fails it on the first follow attempt.
 *
 * `Object.freeze` is SHALLOW and does not disarm `Set.prototype.add` at all, so what REDIR-26 actually
 * asks for is the defensive COPY below -- mutating the caller's collection afterwards cannot change
 * policy. The `ReadonlySet` type is what keeps SDK-internal code from writing to it. A "frozen `Set`"
 * would be a promise the runtime cannot keep; do not "fix" this with one.
 *
 * @param overrides - the fields to change; everything else takes the spec default.
 * @returns frozen, validated settings.
 * @throws InvariantViolation for a `maxHops` that is not a non-negative integer, or a `locationHeader`
 *   that is blank or carries a byte the header-name grammar forbids.
 *
 * @internal
 */
export function redirectSettings(
  overrides?: Partial<RedirectSettings>,
): RedirectSettings {
  const merged = {...DEFAULT_REDIRECT_SETTINGS, ...overrides};
  invariant(
    Number.isInteger(merged.maxHops) && merged.maxHops >= 0,
    `redirect maxHops must be a non-negative integer, got ${String(merged.maxHops)}`,
  );
  // Trimmed and STORED trimmed, then validated as a header name. `HeadersBuilder` trims and validates
  // on the way in, but `Headers.get()` does neither -- it lower-cases the string and looks it up. So an
  // untrimmed or malformed `locationHeader` would not throw anywhere: it would simply never match, and
  // every redirect would come back unfollowed with no error at any layer. Same class of mistake 5a's
  // `attemptHeaderName` check exists for, with a quieter failure mode.
  const locationHeader = merged.locationHeader.trim();
  invariant(
    locationHeader.length > 0 && !hasForbiddenNameByte(locationHeader),
    `redirect locationHeader must be a valid header name, got '${merged.locationHeader}'`,
  );
  return Object.freeze({
    ...merged,
    locationHeader,
    allowedMethods: new Set(merged.allowedMethods),
  });
}
