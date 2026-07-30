// SPDX-License-Identifier: MIT
// packages/core/src/http/method.ts
/**
 * An HTTP request method. Each member's canonical wire token equals its uppercase name (HTTP-9).
 *
 * @public
 */
export type Method =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'CONNECT'
  | 'OPTIONS'
  | 'TRACE'
  | 'PATCH';

const IDEMPOTENT_METHODS: ReadonlySet<Method> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
  'PUT',
  'DELETE',
]);
const BODY_FORBIDDEN_METHODS: ReadonlySet<Method> = new Set([
  'GET',
  'HEAD',
  'TRACE',
  'CONNECT',
]);

/**
 * Reports whether `method` is idempotent — the set `{GET, HEAD, OPTIONS, PUT, DELETE}`.
 *
 * This is the single source both the configurable retry allow-list and the inherent replay-safety
 * gate derive from (HTTP-9); it is deliberately not re-exported from the package barrel.
 *
 * @param method - the method to classify.
 * @returns `true` when the method is idempotent.
 */
export function isIdempotent(method: Method): boolean {
  return IDEMPOTENT_METHODS.has(method);
}

/**
 * Reports whether `method`'s classification forbids a request body — GET, HEAD, TRACE, CONNECT.
 *
 * @param method - the method to classify.
 * @returns `true` when a body must be rejected at construction (HTTP-7).
 */
export function isBodyForbidden(method: Method): boolean {
  return BODY_FORBIDDEN_METHODS.has(method);
}

/**
 * Returns the canonical wire token for `method`, which equals its uppercase name (HTTP-9).
 *
 * @param method - the method to render.
 * @returns the uppercase wire token.
 */
export function methodWireToken(method: Method): string {
  return method;
}
