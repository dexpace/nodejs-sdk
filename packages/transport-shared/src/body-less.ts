// SPDX-License-Identifier: MIT
// packages/transport-shared/src/body-less.ts
import type {Method} from '@dexpace/core';

/**
 * The statuses that can never carry a body, whatever the request was: WHATWG fetch's null-body
 * status set, which is RFC 9110's own list of body-less statuses (`101`, `103`, `204`, `205`, `304`).
 * A `Content-Length` on one of them describes the body a `200` would have had and frames nothing.
 */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

/** The lower and upper bounds of the 2xx range, inside which a `CONNECT` response is body-less. */
const OK_MIN = 200;
const OK_MAX = 299;

/**
 * Whether the response to `method` with `status` can carry a body at all.
 *
 * The WHATWG rule, and what `@dexpace/core`'s model already types: `Response.body` is
 * `ReadableStream<Uint8Array> | null` (`http/response.ts:18`), and `null` is what a consumer can
 * branch on without reading. Both shipped adapters apply this rather than forwarding whatever their
 * native client happened to produce, because three of the four combinations disagreed until audit
 * #67 / #82:
 *
 * - undici's dispatcher always hands back a `BodyReadable`, so `@dexpace/transport-undici` wrapped
 *   an empty stream for 204, 304 and HEAD alike;
 * - Node's global `fetch` returns `null` for all three, per the spec;
 * - Bun 1.3.14's `fetch` returns a live `ReadableStream` for all three (measured 2026-09-05), so
 *   `@dexpace/transport-fetch` inherited the runtime's answer rather than the contract's.
 *
 * A transport that decides here instead reports the same shape on every runtime, which is what a
 * conformance row can assert. Whatever native handle it then declines to expose is its own to
 * release — an undrained `BodyReadable` holds the pooled connection open (TRANSPORT-25, SEAM-30).
 *
 * @param method - the request method; always a canonical uppercase token (HTTP-9).
 * @param status - the response status code as the server sent it.
 * @returns `true` when the adapted response must carry `body === null`.
 *
 * @internal
 */
export function hasNoResponseBody(method: Method, status: number): boolean {
  if (method === 'HEAD') return true;
  // A 2xx CONNECT switches the connection to a tunnel; anything after the blank line is tunnelled
  // bytes, not a body. A non-2xx CONNECT is an ordinary error response and may carry one.
  if (method === 'CONNECT') return status >= OK_MIN && status <= OK_MAX;
  return NULL_BODY_STATUSES.has(status);
}
