// SPDX-License-Identifier: MIT
// packages/core/src/io/text-codec.ts
import {IoError} from './errors.js';

/**
 * The single source of truth for both directions of IO-13's text encoding.
 *
 * Lives in its own module because encode and decode must agree byte for byte: IO-13 requires the two to
 * round-trip, and the only way to guarantee that is to derive them from one table. `BufferedSink`,
 * `TeeSink` and `BufferedSource` all route through here rather than each reaching for the platform.
 *
 * @internal
 */

/** Charset labels this package encodes and decodes itself rather than delegating to the platform. */
const LATIN1_LABELS = new Set([
  'iso-8859-1',
  'latin1',
  'iso8859-1',
  'iso_8859-1',
]);
const UTF8_LABELS = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8']);

/**
 * Encode `text` for the wire (IO-13).
 *
 * ISO-8859-1 is a direct code-point-to-byte map for 0–255; anything above is not representable.
 * `TextEncoder` is UTF-8-only — there is no `TextEncoder('iso-8859-1')` — and SEAM-1 forbids an encoding
 * dependency, so any other label throws rather than silently re-encoding as UTF-8, which would corrupt
 * the bytes on the wire.
 */
export function encodeText(text: string, charset: string): Uint8Array {
  const normalized = charset.toLowerCase();
  if (UTF8_LABELS.has(normalized)) return new TextEncoder().encode(text);
  if (!LATIN1_LABELS.has(normalized)) {
    throw new IoError(
      `unsupported write charset: ${charset} (only utf-8 and iso-8859-1 can be encoded)`,
    );
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new IoError(
        `code point ${String(code)} is not representable in ${charset}`,
      );
    }
    out[i] = code;
  }
  return out;
}

/**
 * Decode `bytes` that arrived from the wire (IO-13).
 *
 * ISO-8859-1 is decoded HERE rather than through `TextDecoder`, deliberately. The WHATWG Encoding
 * Standard maps the labels `iso-8859-1` and `latin1` onto windows-1252, so
 * `new TextDecoder('iso-8859-1').encoding === 'windows-1252'` — which reinterprets 0x80–0x9F as typographic
 * characters (0x80 becomes U+20AC EUR). That breaks IO-13's mandated symmetry in both directions: bytes
 * written by `encodeText` do not come back, and text decoded that way cannot be re-encoded at all,
 * because the substituted code points are above 0xFF. The direct byte-to-code-point map is the actual
 * ISO-8859-1 the write side implements.
 *
 * Every other label goes to `TextDecoder`, which is correct for them.
 *
 * NOT interchangeable with `http/charset.ts`'s `decodeBodyText`, which decodes a whole message body at
 * the HTTP layer, delegates `iso-8859-1` to `TextDecoder`'s windows-1252 mapping, and consumes a leading
 * BOM. This one is per-fragment decoding at the byte layer. See that function's note for the full split.
 *
 * `ignoreBOM: true` is REQUIRED, not incidental. The decoder is applied per fragment — per line, per
 * counted read — so the default (strip a leading U+FEFF) deletes a BOM anywhere a fragment happens to
 * begin, not just at the start of a stream. That silently drops the first three bytes of a body, breaking
 * content hashing and signature verification, and it makes SSE-12 ("any BOM later in the stream MUST be
 * preserved as ordinary data") unimplementable in Phase 6b, because the byte is gone before the SSE
 * parser ever sees the line. Consuming a single start-of-stream BOM belongs to whoever knows where the
 * stream starts; it is not this function's business. Do not turn this flag off.
 */
export function decodeText(bytes: Uint8Array, charset: string): string {
  const normalized = charset.toLowerCase();
  if (LATIN1_LABELS.has(normalized)) {
    // Chunked because `String.fromCharCode(...bytes)` overflows the call stack on a large body.
    let out = '';
    for (let at = 0; at < bytes.length; at += LATIN1_CHUNK) {
      out += String.fromCharCode(...bytes.subarray(at, at + LATIN1_CHUNK));
    }
    return out;
  }
  return decoderFor(charset).decode(bytes);
}

const LATIN1_CHUNK = 8192;

function decoderFor(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset, {ignoreBOM: true});
  } catch (e: unknown) {
    // A charset label reaching this layer is internal, so this is an argument error, not boundary
    // data. Phase 3b's HTTP-42 owns the "unknown declared charset falls back to UTF-8" rule.
    throw new IoError(`unsupported charset: ${charset}`, {cause: e});
  }
}

/** Whether `charset` can be decoded at all — used to reject a bad label before any bytes are consumed. */
export function assertDecodable(charset: string): void {
  if (LATIN1_LABELS.has(charset.toLowerCase())) return;
  decoderFor(charset);
}
