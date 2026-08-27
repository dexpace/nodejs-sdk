// SPDX-License-Identifier: MIT
// packages/core/src/auth/basic.ts
import {invariant} from '../invariant.js';
import type {Challenge, ChallengeHandler} from './challenge.js';

/**
 * `btoa` is Latin-1: it throws on any code point above U+00FF and mis-encodes the rest. Encoding to
 * UTF-8 bytes first and handing `btoa` one character per byte is what makes a non-ASCII password
 * base64 to the bytes RFC 7617 specifies. `globalThis.btoa` is used rather than `node:buffer` to keep
 * the package portable (SEAM-1, `sdk-design-nodejs/06`).
 */
function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The Basic challenge handler (AUTH-14).
 *
 * The header value is `Basic ` plus base64 of the UTF-8 encoding of `username:password`, computed
 * ONCE at construction and closed over — "computed once" is AUTH-14's own wording, not a performance
 * nicety.
 *
 * Credentials are validated as non-empty but whitespace IS permitted, per RFC 7617's laxer rule.
 * This is deliberately NOT the stricter `.trim().length > 0` check `credential.ts`'s types apply: a
 * caller intentionally using a whitespace-only password is unusual but RFC 7617-legal, and rejecting
 * it here would be this port inventing a restriction the requirement declines to make.
 *
 * Challenge-reactive only, never preemptive: `authStep()` engages this handler on a 401/407, never on
 * the outbound pass. See `auth-step.ts` for that reading of AUTH-14/AUTH-23–AUTH-25.
 *
 * @param username - the user id. Must be non-empty; whitespace permitted.
 * @param password - the password. Must be non-empty; whitespace permitted.
 * @returns a stateless handler that answers `basic` challenges.
 * @throws InvariantViolation when either credential is empty — a caller misconfiguration.
 *
 * @internal
 */
export function basicHandler(
  username: string,
  password: string,
): ChallengeHandler {
  invariant(username.length > 0, 'Basic username must not be empty');
  invariant(password.length > 0, 'Basic password must not be empty');
  const value = `Basic ${toBase64Utf8(`${username}:${password}`)}`;

  return {
    // `challenge.scheme` arrives lower-cased from `parseChallenges`, which is where AUTH-14's
    // case-insensitivity is actually implemented.
    canHandle: (challenge: Challenge): boolean => challenge.scheme === 'basic',
    // Zero parameters, and that is the whole contract: the value was computed at construction, so
    // neither the challenge nor the request-target can change it. AUTH-25's
    // Authorization/Proxy-Authorization choice is the caller's, made from which challenge header the
    // status carried.
    stamp: (): Promise<string> => Promise.resolve(value),
  };
}
