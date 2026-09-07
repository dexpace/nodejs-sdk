// SPDX-License-Identifier: MIT
// packages/core/src/serde/response-handlers.ts
import {toHttpError} from '../body/http-status-error.js';
import {DexpaceError} from '../http/errors.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import {releaseQuietly, withReleaseFailure} from '../recovery/release.js';
import type {DecodeTarget, Deserializer} from '../seams/serde.js';

// Re-exported so the handler layer and the seam name one type, not two. It is DECLARED on the seam
// because the seam is what a third-party codec implements against.
export type {DecodeTarget};
import {DeserializationError} from './errors.js';

const UNNAMED_TARGET = 'the target type';

/**
 * Run `work`, then close `response` — on every path, but **without letting a close failure eat the
 * real one**.
 *
 * A bare `finally { await response.close() }` looks equivalent and is not: when `close()` rejects
 * while an error is already in flight, the `finally`'s rejection *replaces* it, and the caller is
 * told their connection dropped when in fact their payload was malformed. So:
 *
 * - work threw, close succeeded → the work error propagates
 * - work threw, close also threw → the work error stays **primary**, the close error attaches as
 *   `suppressed`
 * - work succeeded, close threw → the close error propagates; it is the only failure there is
 *
 * Built on 4b's `releaseQuietly`/`withReleaseFailure` rather than a second suppression mechanism, so
 * the ordering — and the identity guard those helpers carry for `Response.close()`'s memoized
 * rejection — cannot drift between the retry, redirect, auth, and serde subsystems.
 */
async function closingAfter<T>(
  response: Response,
  work: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (primary: unknown) {
    throw withReleaseFailure(primary, await releaseQuietly(response));
  }
  await response.close();
  return result;
}

/**
 * Decode a response body directly through a {@link Deserializer} into the schema's type (SERDE-27).
 *
 * The live body stream is handed to the deserializer — **this function never buffers it**. Whether
 * the codec on the other side buffers is the codec's business: `@dexpace/codec-json` must, because
 * `JSON.parse` has no incremental form, and that limitation is recorded in the phase's Deviation
 * Ledger.
 *
 * The response is closed on every path — success, missing body, codec failure, and stream failure
 * alike — so no path can strand the connection, and a close failure never displaces the failure that
 * actually matters.
 *
 * Failure routing follows SERDE-12: only malformed-input and shape-mismatch failures are wrapped as
 * {@link DeserializationError} with the original chained. A genuine stream failure propagates
 * untouched, because re-wrapping it would tell a caller their payload was malformed when their
 * socket dropped.
 *
 * **Telling the two apart.** `isSerdeError(e)` is the discriminator: `true` means the payload was
 * the problem — malformed bytes, a shape mismatch, a missing body — and the value is a
 * {@link DeserializationError}. `false` means the failure came off the stream (or out of `close()`)
 * and was deliberately not re-typed. The stream-failure class itself is not part of this package's
 * public surface, so the structural check is the supported test rather than an `instanceof`.
 *
 * **The limit of that discriminator, stated plainly.** Every error already in the SDK's own typed
 * tree passes through untouched, so a stream failure raised by this SDK's I/O layer is always
 * recognizable. A **foreign** stream error is not: core hands the live stream to the codec and
 * never reads it, so at the point of the catch a transport's raw error is indistinguishable from a
 * non-conforming codec leaking one. Since SERDE-27 requires a codec/parse failure be surfaced as a
 * serde exception, the untyped case is wrapped — and a foreign transport's stream error is
 * therefore reported as a {@link DeserializationError}. Affected in practice: any transport whose
 * response body is not built by this SDK — a `fetch`/undici body (`TypeError('terminated')`), a
 * hand-built `ReadableStream` errored with a bare `Error`, or an aborted body
 * (`DOMException` named `'AbortError'`). Distinguishing them needs the transport to tag its stream
 * errors; until it does, treat `isSerdeError(e) === true` as "payload **or** foreign stream", not
 * as proof of a payload failure.
 *
 * @param response - the response to decode and close.
 * @param deserializer - the decode half of a `Serde`; explicit because core owns no codec (SEAM-1).
 * @param target - the runtime witness plus its optional diagnostic label.
 * @returns a promise of the decoded value.
 * @throws DeserializationError when the response carried no body, when the payload is malformed or
 * does not match the schema, or — see the limit above — when a foreign stream error could not be
 * told apart from a codec failure.
 * @throws TypeError when the response body is already locked by another consumer. A programmer
 * error (two consumers racing one response), reported as the same plain `TypeError`
 * `Response.bytes()` raises for it rather than being demoted to a payload failure.
 * @throws Whatever reading the body raised — every error in this SDK's typed tree propagates
 * unwrapped (SERDE-12) — plus whatever `close()` raised when the decode itself succeeded.
 * @throws An error carrying a suppressed secondary, when the decode failed **and** releasing the
 * response then failed too. Its `name` is `'SuppressedError'`, `.error` is the primary failure (the
 * one worth acting on) and `.suppressed` is the release failure. `instanceof SuppressedError` is
 * **not** a valid test: the class is absent on this package's declared Node floor and a
 * structurally identical stand-in is built there instead. Test the shape, or read `.error`
 * unconditionally.
 * @public
 */
export async function decodeResponse<T>(
  response: Response,
  deserializer: Deserializer,
  target: DecodeTarget<T>,
): Promise<T> {
  const label = target.typeName ?? UNNAMED_TARGET;
  return closingAfter(response, async () => {
    const body = response.body;
    if (body === null) {
      throw new DeserializationError(
        `response carried no body to decode into ${label}`,
      );
    }
    if (body.locked) {
      // A locked body means two consumers are racing one response — a programmer error, not a
      // malformed payload. Raised as the plain `TypeError` `Response.bytes()` already surfaces for
      // the same mistake, and raised HERE so the catch below cannot demote it to a
      // `DeserializationError` that blames the server's payload for the caller's bug.
      throw new TypeError(
        `the body of the response being decoded into ${label} is already locked by another consumer`,
      );
    }
    try {
      return await deserializer.deserializeFrom(body, target);
    } catch (e: unknown) {
      // SERDE-12: anything already in the SDK's typed error tree passes through untouched. That
      // covers every I/O leaf (`IoError`, `EndOfStreamError`, `ClosedResourceError`,
      // `AllocationLimitError`, `SourceContractViolationError` — a FLAT tree, so an
      // `instanceof IoError` check caught only one of the five), `DeserializationError` from a
      // conforming codec, and `HttpStatusError`. Re-typing any of them would tell a caller their
      // payload was malformed when their socket dropped.
      //
      // The wrap that remains exists for SERDE-27's "surface a codec failure as a serde exception"
      // clause, against a NON-CONFORMING codec that leaks a raw `SyntaxError` instead of the
      // `DeserializationError` the `Deserializer` contract obliges it to throw. Its cost is stated
      // in this function's `@throws` block and cannot be removed here: core hands the live stream
      // to the codec and never reads it, so at this point a foreign transport's stream error and a
      // foreign codec's leaked error are the same shape.
      if (e instanceof DexpaceError) throw e;
      throw new DeserializationError(
        `failed to decode the response body into ${label}`,
        {cause: e},
      );
    }
  });
}

/**
 * Decode only on success; map failure statuses instead of decoding them (SERDE-28).
 *
 * - **2xx** — delegates to {@link decodeResponse}.
 * - **4xx/5xx** — delegates to Phase 3b's `toHttpError()`, which buffers a bounded in-memory copy of
 *   the error body inside the response's own close-guaranteeing scope, at the shared 1 MiB cap
 *   (`BODY-30`/`HTTP-52`). There is deliberately no second cap here: §14 points at that one
 *   explicitly, and a second would drift.
 * - **anything else** (1xx, an unfollowed 3xx such as 304) — closes the response and raises a
 *   {@link DeserializationError} whose message leads with the status code, carrying `ETag` and
 *   `Location` as readable fields so conditional and redirect context survives the closed response.
 *
 * Decoding an error payload as the success type is the failure mode this function exists to prevent:
 * it produces a shape mismatch that blames the caller's schema for the server's 500.
 *
 * @param response - the response to inspect, decode or map, and close.
 * @param deserializer - the decode half of a `Serde`; explicit because core owns no codec (SEAM-1).
 * @param target - the runtime witness plus its optional diagnostic label.
 * @returns a promise of the decoded value, for a 2xx only.
 * @throws HttpStatusError on 4xx/5xx, carrying a bounded copy of the error body.
 * @throws DeserializationError on any other non-2xx status, and on a 2xx whose body is missing,
 * malformed, or does not match the schema.
 * @throws TypeError when a 2xx response's body is already locked by another consumer, exactly as
 * {@link decodeResponse} documents.
 * @throws Whatever reading a 2xx body raised — every error in this SDK's typed tree propagates
 * unwrapped (SERDE-12). The same discriminator {@link decodeResponse} documents applies here, with
 * the same stated limit for a foreign transport's stream errors.
 * @throws An error carrying a suppressed secondary, when the failure that should propagate and the
 * release that ran on its way out **both** failed. `name` is `'SuppressedError'`, `.error` is
 * primary and `.suppressed` rides along; `instanceof` is not a valid test on the declared floor.
 * See {@link decodeResponse}.
 * @public
 */
export async function decodeSuccessResponse<T>(
  response: Response,
  deserializer: Deserializer,
  target: DecodeTarget<T>,
): Promise<T> {
  const status = response.status;

  if (status.isSuccess) {
    return decodeResponse(response, deserializer, target);
  }

  if (status.isClientError || status.isServerError) {
    const httpError = await toHttpError(response);
    // `toHttpError` returns null only for a non-4xx/5xx response, which this branch has already excluded.
    invariant(
      httpError !== null,
      'toHttpError returned null for a 4xx/5xx response',
    );
    throw httpError;
  }

  const etag = response.headers.get('ETag') ?? null;
  const location = response.headers.get('Location') ?? null;
  // Routed through the same helper as `decodeResponse` rather than a `try { throw } finally { close }`: if the
  // close fails here too, the status error must stay primary, not be replaced by it.
  return closingAfter(response, () =>
    Promise.reject(
      new DeserializationError(
        `${String(status.code)}: response status is not decodable into ${target.typeName ?? UNNAMED_TARGET}`,
        {status: status.code, etag, location},
      ),
    ),
  );
}
