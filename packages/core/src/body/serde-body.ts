// SPDX-License-Identifier: MIT
// packages/core/src/body/serde-body.ts
import type {Serde} from '../seams/serde.js';
import {SerializationError} from '../serde/errors.js';
import type {Body} from './body.js';
import {byteArrayBody} from './simple-bodies.js';

/**
 * Build a request body from a value plus a {@link Serde}, defaulting `Content-Type` to the serde's
 * own declared wire media type (SERDE-2).
 *
 * There is deliberately **no** format-agnostic fallback on this path. `Serde.mediaType` is a
 * required, non-optional field, so a serde cannot fail to declare one, and this function never
 * substitutes `application/octet-stream` — a non-JSON serde silently stamping a JSON content type is
 * exactly the failure SERDE-2 exists to prevent.
 *
 * Encoding is eager, which makes the body `replayable` (retry re-sends it) and gives it a known
 * `contentLength`. A streaming, non-replayable variant is deliberately not offered: a body that
 * cannot be replayed cannot survive a retry or a redirect, and every serde payload this SDK builds
 * is small enough to buffer.
 *
 * @param value - the value to encode into the body.
 * @param serde - the bundle whose serializer encodes it and whose media type labels it.
 * @param mediaType - an explicit `Content-Type` override; defaults to `serde.mediaType`.
 * @returns a replayable, frozen {@link Body} carrying the encoded bytes.
 * @throws SerializationError when the serializer cannot encode `value`, with the backing failure
 * chained as `cause` (SERDE-9).
 * @throws MediaTypeParseError when the resolved media type contains a byte that would break out of
 * the header it is rendered into (HTTP-26/HTTP-51).
 * @public
 */
export function serdeBody(
  value: unknown,
  serde: Serde,
  mediaType?: string,
): Body {
  let bytes: Uint8Array;
  try {
    bytes = serde.serializer.serialize(value);
  } catch (e: unknown) {
    // Already the SDK's stable write-path type: rethrow rather than nest it under a second one,
    // which would bury the codec's own message one `cause` deeper for no added information.
    if (e instanceof SerializationError) throw e;
    throw new SerializationError('failed to encode the request body', {
      cause: e,
    });
  }
  return byteArrayBody(bytes, mediaType ?? serde.mediaType);
}
