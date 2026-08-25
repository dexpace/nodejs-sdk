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
 * Decodes with `charset`, falling back to UTF-8 when the label is unknown (HTTP-42). `TextDecoder`
 * throws a RangeError on an unrecognized label, which callers on an error path are least able to handle.
 */
export function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
