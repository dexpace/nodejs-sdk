// SPDX-License-Identifier: MIT
// packages/core/src/recovery/release.ts
import type {Response} from '../http/response.js';
import {suppress} from '../suppress.js';

/** Marks "the response was released without incident", distinct from any value `close()` could throw. */
const RELEASED_CLEANLY = Symbol('dexpace.recovery.released');

/**
 * Releases a discarded response, reporting rather than raising whatever release itself threw.
 *
 * `Response.close()` is documented to rethrow whatever cancelling the body raises (everything except
 * the `TypeError` a locked stream reports), so it is not a call that can sit in a bare `finally`:
 * there it would replace the value being returned, or replace an in-flight throwable with the
 * teardown failure -- the exact inversion RECOV-12 forbids and `suppress()` exists to prevent.
 *
 * @param response - the response to release, or `undefined` when there is none.
 * @returns an opaque release token for {@link withReleaseFailure}: whatever `close()` threw, or a
 *   sentinel meaning it released cleanly.
 *
 * @internal
 */
export async function releaseQuietly(
  response: Response | undefined,
): Promise<unknown> {
  if (response === undefined) return RELEASED_CLEANLY;
  try {
    await response.close();
    return RELEASED_CLEANLY;
  } catch (error) {
    return error;
  }
}

/**
 * Keeps `primary` primary, with a release failure riding along as suppressed (RECOV-12, RETRY-22's
 * "a teardown failure can never mask the upstream failure"; REDIR-22's equivalent, where the error
 * that must propagate is the decision failure, not the teardown that ran on its way out).
 *
 * The identity guard is not decorative. `Response.close()` memoizes its release promise, so a close
 * that already failed inside `toHttpError`'s own `finally` hands the SAME rejection back to the
 * second caller -- without this check that instance would be suppressed under itself.
 *
 * @param primary - the throwable the caller actually needs to see.
 * @param releaseFailure - the token {@link releaseQuietly} returned.
 * @returns `primary` unchanged when the release was clean, otherwise a `SuppressedError`-shaped
 *   pairing with `primary` primary.
 *
 * @internal
 */
export function withReleaseFailure(
  primary: unknown,
  releaseFailure: unknown,
): unknown {
  if (releaseFailure === RELEASED_CLEANLY || releaseFailure === primary) {
    return primary;
  }
  return suppress(
    primary,
    releaseFailure,
    'releasing the discarded response failed',
  );
}
