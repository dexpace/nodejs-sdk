// SPDX-License-Identifier: MIT
// packages/core/src/http/rfc3986.ts

/**
 * Percent-encodes a single URL component per RFC 3986, patching `encodeURIComponent`'s divergence:
 * `encodeURIComponent` leaves `! * ' ( )` unescaped, but none of them are in RFC 3986's unreserved
 * set (HTTP-29).
 *
 * @param value - the raw component value.
 * @returns the percent-encoded component.
 */
export function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
