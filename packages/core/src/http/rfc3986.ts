// SPDX-License-Identifier: MIT
// packages/core/src/http/rfc3986.ts

/**
 * Matches an UNPAIRED surrogate code unit, and only an unpaired one.
 *
 * In a `u`-mode pattern the engine works in code points, so a well-formed surrogate pair is one
 * non-surrogate code point and does not match, while a lone high or low unit stays a surrogate code
 * point and does. Equivalent to `!String.prototype.isWellFormed()`, which is ES2024 and so outside
 * this repo's declared `lib` (`tsconfig.base.json` pins `ES2023`) even though the
 * `engines.node >= 20.3` runtime has it — raising `lib` for one predicate is a wider change than
 * the predicate is worth.
 *
 * Two patterns, one rule: `.test()` must not carry `lastIndex` between calls, and `.replace()` must
 * be global. Neither is exported; the two functions below are, so no caller can pick the wrong one.
 */
const LONE_SURROGATE = /\p{Surrogate}/u;
const LONE_SURROGATE_GLOBAL = /\p{Surrogate}/gu;

/** Unicode's replacement character, what a lenient repair substitutes for an unpaired surrogate. */
const REPLACEMENT_CHARACTER = '\uFFFD';

/**
 * Whether `value` carries an unpaired surrogate, and so has no UTF-8 form and cannot be
 * percent-encoded. The strict half of the rule: a call site that was HANDED such a string rejects
 * it (audit #67 / #76).
 *
 * @param value - the string to inspect.
 * @returns `true` when at least one surrogate code unit is unpaired.
 */
export function hasLoneSurrogate(value: string): boolean {
  return LONE_SURROGATE.test(value);
}

/**
 * `value` with every unpaired surrogate replaced by U+FFFD. The lenient half, for a call site that
 * MUST NOT throw — `QueryParams.parse` under HTTP-31. Matches what the platform's own query
 * serializer does with the same input: `new URL('https://x/?a=\uD800').search` is `?a=%EF%BF%BD`
 * (measured 2026-09-05).
 *
 * @param value - the string to repair.
 * @returns `value` with unpaired surrogates replaced; the same string when there are none.
 */
export function toWellFormed(value: string): string {
  return value.replace(LONE_SURROGATE_GLOBAL, REPLACEMENT_CHARACTER);
}

/**
 * Percent-encodes a single URL component per RFC 3986, patching `encodeURIComponent`'s divergence:
 * `encodeURIComponent` leaves `! * ' ( )` unescaped, but none of them are in RFC 3986's unreserved
 * set (HTTP-29).
 *
 * Deliberately NOT total, and deliberately not guarded here. `encodeURIComponent` throws
 * `URIError: URI malformed` on a string carrying an unpaired surrogate, because such a string has
 * no UTF-8 form. Every caller in this package rejects or repairs that input BEFORE reaching here —
 * `QueryParamsBuilder.add`, `QueryParams.parse` and `substitutePathParams` each do, and each throws
 * the error class its own call site already throws — so a second, silent guard inside the encoder
 * would only move the failure back off the call site (audit #67 / #76).
 *
 * @param value - the raw component value; must not carry an unpaired surrogate.
 * @returns the percent-encoded component.
 * @throws A platform `URIError` when `value` carries an unpaired surrogate. Callers validate first;
 * see the note above.
 */
export function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
