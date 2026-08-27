// SPDX-License-Identifier: MIT
// packages/core/src/auth/md5.ts

/**
 * RFC 1321 MD5, hand-rolled and dependency-free.
 *
 * Web Crypto's `subtle.digest()` deliberately excludes MD5 — the algorithm is out of the standard on
 * security grounds — yet RFC 7616 Digest still requires MD5/MD5-sess for interop with servers that
 * have not adopted SHA-256 (AUTH-15). Adding an npm dependency for it would violate SEAM-1's
 * zero-runtime-dependency rule, and reaching for `node:crypto` would cost the portability to
 * browsers/Deno/Workers that `sdk-design-nodejs/06` picks Web Crypto to keep.
 *
 * @packageDocumentation
 */

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
] as const;

// `/*#__PURE__*/`, because this is a top-level CALL, and `docs/knowledge/performance.md` is explicit
// that modules must do no work at import time — a top-level call is a side effect the bundler must
// preserve, and that pins the module in the bundle. `@dexpace/core` declares `"sideEffects": false`;
// without the annotation a bundler cannot prove these 64 `Math.sin` calls are pure, so `md5.ts` and
// its table are retained by every consumer that transitively imports anything reaching them,
// including one that never touches Digest.
// Deeply immutable via the freeze, which is what earns the CONSTANT_CASE (naming-conventions.md).
const CONSTANTS: readonly number[] = /*#__PURE__*/ Object.freeze(
  Array.from(
    {length: 64},
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
  ),
);

function leftRotate(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** RFC 1321 §3.1: pad to a multiple of 64 bytes with a single 0x80, zeros, then the original bit length. */
function pad(message: Uint8Array): Uint8Array {
  const bitLength = BigInt(message.length) * 8n;
  const paddingLength = (((56 - ((message.length + 1) % 64)) % 64) + 64) % 64;
  const result = new Uint8Array(message.length + 1 + paddingLength + 8);
  result.set(message);
  result[message.length] = 0x80;
  // `result` is freshly allocated, so its byteOffset is 0 and the buffer view needs no offset.
  new DataView(result.buffer).setBigUint64(result.length - 8, bitLength, true);
  return result;
}

/** The three state words RFC 1321's per-round auxiliary function reads. Bundled so `roundFunction`
 *  stays within `max-params`. */
interface RoundWords {
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

function roundFunction(i: number, words: RoundWords): number {
  const {b, c, d} = words;
  if (i < 16) return (b & c) | (~b & d);
  if (i < 32) return (d & b) | (~d & c);
  if (i < 48) return b ^ c ^ d;
  return c ^ (b | ~d);
}

function messageIndex(i: number): number {
  if (i < 16) return i;
  if (i < 32) return (5 * i + 1) % 16;
  if (i < 48) return (3 * i + 5) % 16;
  return (7 * i) % 16;
}

interface State {
  a: number;
  b: number;
  c: number;
  d: number;
}

function processBlock(words: readonly number[], state: State): State {
  let {a, b, c, d} = state;
  for (let i = 0; i < 64; i += 1) {
    const f =
      (roundFunction(i, {b, c, d}) +
        a +
        (CONSTANTS[i] ?? 0) +
        (words[messageIndex(i)] ?? 0)) >>>
      0;
    a = d;
    d = c;
    c = b;
    b = (b + leftRotate(f, SHIFTS[i] ?? 0)) >>> 0;
  }
  return {
    a: (state.a + a) >>> 0,
    b: (state.b + b) >>> 0,
    c: (state.c + c) >>> 0,
    d: (state.d + d) >>> 0,
  };
}

/**
 * Computes the RFC 1321 MD5 digest of `message` (AUTH-15–AUTH-17).
 *
 * Pure: no shared state, no allocation the caller can observe, safe for concurrent invocation
 * (AUTH-24).
 *
 * @param message - the bytes to hash.
 * @returns the 16-byte digest.
 *
 * @internal
 */
export function md5(message: Uint8Array): Uint8Array {
  const data = pad(message);
  // `data` comes straight from `pad`, so it is a fresh, offset-0 view over its own buffer.
  const view = new DataView(data.buffer);
  let state: State = {
    a: 0x67452301,
    b: 0xefcdab89,
    c: 0x98badcfe,
    d: 0x10325476,
  };

  for (let chunkStart = 0; chunkStart < data.length; chunkStart += 64) {
    const words = Array.from({length: 16}, (_, i) =>
      view.getUint32(chunkStart + i * 4, true),
    );
    state = processBlock(words, state);
  }

  const digest = new Uint8Array(16);
  const outView = new DataView(digest.buffer);
  outView.setUint32(0, state.a, true);
  outView.setUint32(4, state.b, true);
  outView.setUint32(8, state.c, true);
  outView.setUint32(12, state.d, true);
  return digest;
}

/**
 * Renders bytes as lower-case hex, two digits per byte — the form AUTH-17 requires for HA1/HA2 and
 * the Digest response.
 *
 * @param bytes - the bytes to render.
 * @returns the lower-case hex string, twice as long as `bytes`.
 *
 * @internal
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
