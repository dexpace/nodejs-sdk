// SPDX-License-Identifier: MIT
// packages/core/src/body/media-type-safety.ts
import {hasForbiddenOutboundValueByte} from '../http/ascii-validation.js';
import {MediaTypeParseError} from '../http/errors.js';

/**
 * Rejects a media type that is not header-safe, using the same predicate as outbound header-value
 * validation (HTTP-26).
 *
 * `Body.mediaType` is interpolated into a multipart part header verbatim (HTTP-51), so a CR/LF inside it
 * is a header-injection primitive: it can append arbitrary headers, close the header block outright, and
 * forge a closing boundary, all while the shared framing routine keeps the declared content length
 * consistent with the corrupted bytes. Validating at construction closes it at the source -- a media type
 * containing a control character is never legitimate.
 */
export function assertHeaderSafeMediaType(mediaType: string | undefined): void {
  if (mediaType === undefined) return;
  if (hasForbiddenOutboundValueByte(mediaType)) {
    throw new MediaTypeParseError(
      `media type must not contain a control character or non-ASCII byte: ${JSON.stringify(mediaType)}`,
    );
  }
}

/**
 * Returns `mediaType` when it is header-safe, otherwise undefined.
 *
 * For media types that arrive from the wire rather than from a caller. HTTP-19 deliberately lets an
 * inbound header value carry obs-text (>= 0x80) that HTTP-18 forbids outbound, so re-serving a received
 * `content-type` on an outbound body can legitimately fail {@link assertHeaderSafeMediaType}. Dropping
 * the media type is the right trade there -- raising from an accessor on an error object is not.
 */
export function headerSafeMediaType(
  mediaType: string | undefined,
): string | undefined {
  if (mediaType === undefined) return undefined;
  return hasForbiddenOutboundValueByte(mediaType) ? undefined : mediaType;
}
