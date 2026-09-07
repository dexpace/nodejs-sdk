// SPDX-License-Identifier: MIT
// packages/core/src/redirect/codes.ts
import type {Method} from '../http/method.js';

/**
 * REDIR-1/REDIR-2: the only statuses redirect logic is ever consulted for. 300, 304, and 305 are
 * deliberately excluded even when they carry a `Location` -- 305 in particular must never redirect a
 * request to a server-chosen proxy.
 *
 * @internal
 */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

/**
 * REDIR-3/REDIR-4's default allowed-method set.
 *
 * @internal
 */
export const DEFAULT_ALLOWED_METHODS: ReadonlySet<Method> = new Set([
  'GET',
  'HEAD',
]);

/**
 * REDIR-1: any status outside {@link REDIRECT_STATUSES} -- 2xx, 4xx, 5xx, and non-redirect 3xx alike --
 * is returned verbatim without consulting redirect logic at all.
 *
 * @param status - the response status code.
 * @returns `true` when the status is one redirect logic may act on.
 *
 * @internal
 */
export function isRecognizedRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

/**
 * The policy slice {@link isEligibleByCode} reads. A `RedirectSettings` value satisfies this
 * structurally, so callers pass their settings directly rather than building an adapter object.
 *
 * @internal
 */
export interface CodeEligibility {
  readonly allowedMethods: ReadonlySet<Method>;
  readonly allow303: boolean;
}

/**
 * REDIR-3/REDIR-4/REDIR-5: 301/302/307/308 are eligible only when the ORIGINAL method is in
 * `allowedMethods` -- when followed, method and body are preserved, deliberately with no automatic
 * POST-to-GET rewrite. 303 is eligible only when opted in via `allow303`, independent of method; the
 * GET rebuild and body drop that follow are `decide.ts`'s job, not this predicate's.
 *
 * @param status - the response status code; assumed recognized.
 * @param method - the current hop's request method.
 * @param eligibility - the allowed-method set and the 303 opt-in.
 * @returns `true` when code and method alone permit following.
 *
 * @internal
 */
export function isEligibleByCode(
  status: number,
  method: Method,
  eligibility: CodeEligibility,
): boolean {
  if (status === 303) return eligibility.allow303;
  return eligibility.allowedMethods.has(method);
}
