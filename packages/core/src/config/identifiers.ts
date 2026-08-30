// SPDX-License-Identifier: MIT
// packages/core/src/config/identifiers.ts
import {invariant} from '../invariant.js';

const HEX_BY_BYTE: readonly string[] = Array.from({length: 256}, (_, byte) =>
  byte.toString(16).padStart(2, '0'),
);

/**
 * {@link randomUuid}'s body, with the random source taken explicitly.
 *
 * Parameterized for the same reason `build-info.ts`'s `detectRuntimeIdentity(host)` is: the
 * missing-WebCrypto branch is then reachable from a test without deleting or reassigning a global,
 * which no test may do (`docs/knowledge/harvested/testing.md:50` -- every test must survive parallel
 * execution).
 *
 * @param webCrypto - the WebCrypto implementation, or `undefined` on a runtime that exposes none.
 * @returns a lower-case, hyphenated 36-character UUID.
 * @throws InvariantViolation when `webCrypto` is absent or carries no `getRandomValues`.
 *
 * @internal
 */
export function randomUuidFrom(webCrypto: Crypto | undefined): string {
  invariant(
    typeof webCrypto?.getRandomValues === 'function',
    'randomUuid: globalThis.crypto.getRandomValues is unavailable. @dexpace/core needs WebCrypto exposed as a global -- Node >= 20.3 (see engines.node), or any browser/Workers runtime.',
  );

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, byte => HEX_BY_BYTE[byte] ?? '00').join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generates a type-4 UUID with the RFC 4122 layout -- version 4 in the high nibble of byte 6, the
 * IETF variant in the high bits of byte 8 (CFG-32).
 *
 * Callers MUST treat the output as **non-cryptographic** despite the CSPRNG source: it is an
 * identifier for correlation, not a secret or a capability token.
 *
 * Concurrency-safe by construction -- no shared mutable state here, and none in
 * `crypto.getRandomValues` either. `globalThis.crypto` is core's already-fixed cross-runtime
 * primitive; a `node:crypto` import would break the browser/Workers half of the runtime floor.
 *
 * @returns a lower-case, hyphenated 36-character UUID.
 * @throws InvariantViolation when the runtime exposes no global WebCrypto to draw from -- a
 *   deployment error, reported by name rather than as the bare `TypeError` that reading
 *   `getRandomValues` off `undefined` would otherwise produce.
 *
 * @public
 */
export function randomUuid(): string {
  // The lib types declare `globalThis.crypto` non-nullable, but `randomUuidFrom`'s guard exists
  // precisely for the runtime where it is not: a Node release below `engines.node`'s 20.3 floor,
  // where WebCrypto is absent from ESM, or an embedder that withholds it. Declaring the parameter
  // `Crypto | undefined` is what keeps that guard reachable -- the compiler cannot see that runtime,
  // so the check has to survive a type saying it cannot happen.
  return randomUuidFrom(globalThis.crypto);
}
