// SPDX-License-Identifier: MIT
// packages/core/src/http/charset.ts
import {MediaType} from './media-type.js';

/**
 * HTTP-42's charset resolution: the media type's declared `charset`, falling back to UTF-8 when the
 * media type is absent or unparseable. Never throws.
 */
export function resolveCharset(mediaType: string | undefined): string {
  if (mediaType === undefined) return 'utf-8';
  try {
    return MediaType.parse(mediaType).charset ?? 'utf-8';
  } catch {
    return 'utf-8';
  }
}

/**
 * Decodes a whole message body with `charset`, falling back to UTF-8 when the label is unknown
 * (HTTP-42). `TextDecoder` throws a RangeError on an unrecognized label, which callers on an error path
 * are least able to handle.
 *
 * NOT interchangeable with `io/text-codec.ts`'s `decodeText`, despite the similar shape -- the two
 * disagree by design and the name says so:
 *
 * - This one is whole-body decoding at the HTTP layer. It delegates every label to `TextDecoder`, so
 *   `iso-8859-1` follows the WHATWG Encoding Standard's mapping onto windows-1252 (0x80 decodes to
 *   U+20AC), and it consumes a leading BOM, which is what a caller of `Response.text()` expects.
 * - `io/text-codec.decodeText` is per-FRAGMENT decoding at the byte layer. It implements true
 *   ISO-8859-1 so that IO-13's write/read round-trip holds against `encodeText`, and sets
 *   `ignoreBOM` so a U+FEFF appearing mid-stream survives as ordinary data (SSE-12).
 *
 * Reaching for the wrong one silently changes bytes. Pick by layer: message bodies here, stream
 * fragments there.
 */
export function decodeBodyText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
