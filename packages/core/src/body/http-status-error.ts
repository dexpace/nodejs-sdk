// SPDX-License-Identifier: MIT
// packages/core/src/body/http-status-error.ts
import {decodeBodyText, resolveCharset} from '../http/charset.js';
import {DexpaceError} from '../http/errors.js';
import {HttpStatusValidationError} from './errors.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import {
  releaseQuietly,
  releasedCleanly,
  withReleaseFailure,
} from '../recovery/release.js';
import type {Body} from './body.js';
import {headerSafeMediaType} from './media-type-safety.js';
import {byteArrayBody} from './simple-bodies.js';

// Fixed by HTTP-52. Deliberately NOT BODY-34's shared preview cap, which is configurable and covers the
// two logging tees only -- a spec-fixed value cannot be the configurable one.
const ERROR_BODY_CAP_BYTES = 1024 * 1024; // 1 MiB, HTTP-52/BODY-30

/**
 * A 4xx/5xx response turned into an exception (HTTP-52/BODY-30, BODY-31).
 *
 * @public
 */
export class HttpStatusError extends DexpaceError {
  /**
   * The response status code, always in HTTP-11's 400-599 error band (BODY-31).
   *
   * "Always" is enforced by the constructor as of 2026-09-02, not merely asserted here. It was a
   * documented-but-unchecked invariant before that, which is what let a consumer build the
   * "successful exception" `XCUT-8` forbids.
   */
  readonly status: number;
  readonly #bodyBytes: Uint8Array | undefined;
  readonly #mediaType: string | undefined;

  /**
   * @param status - the response status; MUST be an integer in HTTP-11's 400-599 error band.
   * @param bodyBytes - the buffered error body, capped at 1 MiB (HTTP-52/BODY-30), or `undefined`.
   * @param mediaType - the response's `Content-Type`, used to decode {@link HttpStatusError.preview}.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   * @throws {@link HttpStatusValidationError} when `status` is not an integer in 400-599. `XCUT-8`
   *   requires the mapping to reject a non-error status rather than fabricate a "successful
   *   exception"; `toHttpError` is the total form that returns `null` instead of throwing.
   */
  // eslint-disable-next-line max-params -- constructor parameters fixed by error model
  constructor(
    status: number,
    bodyBytes: Uint8Array | undefined,
    mediaType: string | undefined,
    options?: ErrorOptions,
  ) {
    super(`HTTP ${String(status)}`, options);
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new HttpStatusValidationError(status);
    }
    this.status = status;
    this.#bodyBytes = bodyBytes;
    this.#mediaType = mediaType;
  }

  /**
   * The buffered error body, re-served as a replayable Body -- readable independently and repeatably
   * after the transport connection was released (BODY-30). Undefined when there was no body.
   */
  body(): Body | undefined {
    return this.#bodyBytes === undefined
      ? undefined
      : // Dropped rather than raised when the received content-type is not outbound-safe: an inbound
        // value may legally carry obs-text (HTTP-19) that an outbound body may not (HTTP-18).
        byteArrayBody(this.#bodyBytes, headerSafeMediaType(this.#mediaType));
  }

  /**
   * Non-consuming preview from the buffered copy (BODY-33). Null for no body.
   *
   * Decodes with `charset` when given, otherwise with the charset declared by the response's media type,
   * falling back to UTF-8 when that is absent or unknown -- the same resolution `Response.text()` uses
   * (HTTP-42). Never throws: an unrecognized label falls back rather than raising a RangeError out of a
   * method on an error object, where a caller is least able to handle another exception.
   */
  preview(charset?: string): string | null {
    if (this.#bodyBytes === undefined) return null;
    return decodeBodyText(
      this.#bodyBytes,
      charset ?? resolveCharset(this.#mediaType),
    );
  }
}

/**
 * Turns a 4xx/5xx response into an HttpStatusError, buffering at most 1 MiB of the body inside the
 * response's own close-guaranteeing scope (HTTP-52/BODY-30). Returns null for a non-error response
 * (BODY-31) -- the caller keeps the response, body intact.
 *
 * **A failing release can no longer replace the result** (RECOV-12). The drain used to end its work
 * in a bare `finally` block that awaited `response.close()`; `Response.close()` memoizes its
 * release promise, so a close that had already failed handed the same rejection back and it
 * replaced the `HttpStatusError` this function was about to build -- the error never existed, and
 * every caller documenting `@throws HttpStatusError on 4xx/5xx` lied. Release now goes through
 * `releaseQuietly`, so:
 *
 * - a **read** failure stays primary, with the release failure suppressed under it
 *   (`withReleaseFailure`), exactly as every other subsystem does it;
 * - a **successful** read returns the `HttpStatusError` even when the release failed, carrying that
 *   failure as its `cause` so it is recorded rather than dropped.
 *
 * @param response - the response to convert; it is released either way (BODY-16).
 * @returns the error for a 4xx/5xx, or `null` for any other status.
 * @throws Whatever reading the response body raises; the response is released either way (BODY-16).
 *   If releasing ALSO fails, the read failure stays primary and the release failure rides along
 *   suppressed.
 * @public
 */
export async function toHttpError(
  response: Response,
): Promise<HttpStatusError | null> {
  // BODY-31: error statuses only, i.e. HTTP-11's 400-599 band. A bare `code < 400` would sweep a
  // non-standard 6xx -- which HTTP-10 requires Status.of to accept and return -- into the error path
  // and consume a body BODY-31 says must be handed back intact.
  if (!response.status.isError) return null;
  const mediaType = response.headers.get('content-type');
  if (response.body === null) {
    const releaseFailure = await releaseQuietly(response);
    return new HttpStatusError(
      response.status.code,
      undefined,
      mediaType,
      releaseOptions(releaseFailure),
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Acquired INSIDE the try, for the same reason Response.bytes does it: `getReader()` throws when an
  // external consumer already holds the lock, and acquiring it above the try skipped the close on
  // exactly that path -- holding the connection open (HTTP-52/BODY-30).
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let readFailure: {readonly error: unknown} | undefined;
  try {
    reader = response.body.getReader();
    for (;;) {
      // Serial by necessity: each read depends on the previous one advancing the cursor.
      const {done, value} = await reader.read();
      if (done) break;
      if (total >= ERROR_BODY_CAP_BYTES) continue; // keep draining to release the connection; drop the bytes
      const room = ERROR_BODY_CAP_BYTES - total;
      const piece = value.length > room ? value.subarray(0, room) : value;
      chunks.push(piece);
      total += piece.length;
    }
  } catch (error: unknown) {
    readFailure = {error};
  }
  // Release before close(): cancel() rejects with TypeError on a locked stream (see Response.bytes).
  reader?.releaseLock();
  const releaseFailure = await releaseQuietly(response);
  if (readFailure !== undefined) {
    throw withReleaseFailure(readFailure.error, releaseFailure);
  }
  invariant(
    total <= ERROR_BODY_CAP_BYTES,
    `buffered ${String(total)} bytes past the ${String(ERROR_BODY_CAP_BYTES)} cap`,
  );

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new HttpStatusError(
    response.status.code,
    bytes,
    mediaType,
    releaseOptions(releaseFailure),
  );
}

/**
 * Turns {@link releaseQuietly}'s opaque token into `ErrorOptions`. A clean release yields
 * `undefined`, so the common path constructs exactly what it always did; a failed one rides along as
 * `cause`, which is the only slot a RETURNED error has for a secondary failure.
 */
function releaseOptions(releaseToken: unknown): ErrorOptions | undefined {
  return releasedCleanly(releaseToken) ? undefined : {cause: releaseToken};
}
