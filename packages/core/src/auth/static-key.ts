// SPDX-License-Identifier: MIT
// packages/core/src/auth/static-key.ts
import {
  credentialKey,
  type ApiKeyCredential,
  type NameKeyCredential,
} from './credential.js';

/**
 * Where and how a static key is written (AUTH-26).
 *
 * @internal
 */
export interface StaticKeyOptions {
  /** The header to write. Defaults to `Authorization` (AUTH-26). */
  readonly headerName?: string | undefined;
  /** A scheme prefix; when set it is written followed by exactly one space (AUTH-26). */
  readonly prefix?: string | undefined;
}

/**
 * The header name/value pair a static-key stamp produces.
 *
 * @internal
 */
export interface StaticKeyStamp {
  /** The header to write. */
  readonly headerName: string;
  /** The value to write, prefix already applied. */
  readonly headerValue: string;
}

/**
 * AUTH-26: writes the secret into the configured header, prefixed by the configured prefix and one
 * space when set.
 *
 * Uniform over both credential shapes. `NameKeyCredential.name` is deliberately NOT consulted: it is
 * non-secret metadata for the redacted `toString` in `credential.ts`, not a header name — a caller
 * that wants the name to select the header passes it as `options.headerName`, explicitly.
 *
 * Stateless after construction, and no challenge is involved: a static key is stamped preemptively,
 * never in reaction to a 401.
 *
 * @param credential - the API key or name-key credential to stamp.
 * @param options - header name and prefix overrides.
 * @returns the header name and value to write.
 *
 * @internal
 */
export function stampStaticKey(
  credential: ApiKeyCredential | NameKeyCredential,
  options?: StaticKeyOptions,
): StaticKeyStamp {
  const headerName = options?.headerName ?? 'Authorization';
  // `credentialKey()`, not a public `credential.key` getter: AUTH-8's secret stays off the published
  // surface and this module is the one sanctioned reader.
  const key = credentialKey(credential);
  const headerValue =
    options?.prefix === undefined ? key : `${options.prefix} ${key}`;
  return {headerName, headerValue};
}
