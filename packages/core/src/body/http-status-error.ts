// SPDX-License-Identifier: MIT
// packages/core/src/body/http-status-error.ts
import {DexpaceError} from '../http/errors.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
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
  readonly status: number;
  readonly #bodyBytes: Uint8Array | undefined;
  readonly #mediaType: string | undefined;

  // eslint-disable-next-line max-params -- constructor parameters fixed by error model
  constructor(
    status: number,
    bodyBytes: Uint8Array | undefined,
    mediaType: string | undefined,
    options?: ErrorOptions,
  ) {
    super(`HTTP ${String(status)}`, options);
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
      : byteArrayBody(this.#bodyBytes, this.#mediaType);
  }

  /** Non-consuming preview from the buffered copy (BODY-33). Null for no body. */
  preview(charset = 'utf-8'): string | null {
    if (this.#bodyBytes === undefined) return null;
    return new TextDecoder(charset).decode(this.#bodyBytes);
  }
}

/**
 * Turns a 4xx/5xx response into an HttpStatusError, buffering at most 1 MiB of the body inside the
 * response's own close-guaranteeing scope (HTTP-52/BODY-30). Returns null for a non-error response
 * (BODY-31) -- the caller keeps the response, body intact.
 *
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
    await response.close();
    return new HttpStatusError(response.status.code, undefined, mediaType);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
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
  } finally {
    // Release before close(): cancel() rejects with TypeError on a locked stream (see Response.bytes).
    reader.releaseLock();
    await response.close();
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
  return new HttpStatusError(response.status.code, bytes, mediaType);
}
