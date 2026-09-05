// SPDX-License-Identifier: MIT
// packages/core/src/retry/attempt-trail.ts

/**
 * RETRY-34's prior-attempt trail, held in a side table keyed by the surfaced throwable rather than
 * written onto it.
 *
 * A `WeakMap` because the key is the error a caller is about to catch: the entry has to disappear
 * when that error does, and a `Map` here would pin every failed request's error graph -- including
 * whatever the buffered `HttpStatusError` bodies hold -- for the life of the process.
 */
const attemptTrails = new WeakMap<object, readonly unknown[]>();

/** One shared frozen empty list, so the common "no trail" answer allocates nothing. */
const NO_ATTEMPTS: readonly unknown[] = Object.freeze([]);

/**
 * The subset of throwables a `WeakMap` can key on. Objects and functions qualify; primitives do
 * not, and a registered symbol throws when used as a weak key, so symbols are excluded outright
 * rather than probed.
 */
function trailKey(value: unknown): object | undefined {
  if (typeof value === 'function') return value;
  return typeof value === 'object' && value !== null ? value : undefined;
}

/**
 * Records the errors of the earlier attempts against the error the retry engine is about to
 * surface (`RETRY-34`).
 *
 * Written into a side table instead of onto the error for three reasons the engine cannot rule out
 * about a throwable it did not construct: it may be frozen or otherwise non-extensible, so a
 * `defineProperty` in the failure path would itself throw and replace the failure the caller cares
 * about; it may be a primitive, which can carry nothing at all; and `suppressed` already means
 * "the one secondary" on `SuppressedErrorLike`, so reusing the name would collide with
 * `RECOV-12`'s pairing.
 *
 * `attempts` MUST already have the surfaced instance filtered out -- `RETRY-34`'s skip-self clause,
 * applied by the engine's `attachTrail` (`engine.ts`), which is the one caller. An empty
 * `attempts` DELETES any entry a previous run left, so a transport that reuses a single error
 * instance across calls reports the trail of the run that just surfaced it rather than a stale one.
 *
 * The list is copied and frozen, so the engine's own mutable `trail` array cannot be observed
 * growing after the fact.
 *
 * @param error - the throwable the engine is surfacing; a primitive is silently ignored.
 * @param attempts - the earlier attempts' errors, oldest first, surfaced instance excluded.
 *
 * @internal
 */
export function recordAttempts(
  error: unknown,
  attempts: readonly unknown[],
): void {
  const key = trailKey(error);
  if (key === undefined) return;
  if (attempts.length === 0) {
    attemptTrails.delete(key);
    return;
  }
  attemptTrails.set(key, Object.freeze([...attempts]));
}

/**
 * The errors of the attempts that came before the one you caught.
 *
 * The retry pillar surfaces the **final** attempt's own error, unwrapped: `instanceof` against it
 * answers the same for one attempt as for ten, and a cancellation that ended a backoff wait arrives
 * as `CancellationError` rather than as something carrying one. The earlier attempts are not
 * discarded — they are recorded here, one entry per attempt that failed BEFORE the error you caught.
 * A worked example is in `docs/sdk-documentation/pipelines.md`.
 *
 * **That is not an attempt count, and `length + 1` is not one either.** The arithmetic holds only
 * when the surfaced error is itself an attempt's, and on three reachable paths it is not: a
 * cancellation or timeout the engine observes at its `RETRY-32` gate is synthesized there rather
 * than raised by a send; a failure from stamping the attempt header is raised before the request
 * goes out; and a `Clock.sleep` that rejects for something other than an abort fails after the
 * attempt it followed is already in the trail. On each of those the trail already accounts for every
 * send, so adding one overstates it. Narrowing the catch does not rescue the sum — `abortToSdkError`
 * yields `TransportFailureError` for a timeout signal, so even that class can reach you without a
 * send behind it.
 *
 * Oldest first, and the error you passed in is never a member of its own trail (`RETRY-34`'s
 * skip-self clause, which matters because a transport may reuse one error instance across
 * attempts). A run that succeeded, a failure that was never retried, and any error this SDK did not
 * surface from a retry loop all answer with an empty list — this never throws and never returns
 * `undefined`.
 *
 * The result is frozen, and it is read by identity: an error reached through another error's
 * `cause` has its own trail or none, never its wrapper's.
 *
 * @param error - the throwable a retrying pipeline surfaced; any value, not necessarily an `Error`.
 * @returns the earlier attempts' errors, oldest first, or an empty list when there are none.
 *
 * @public
 */
export function retryAttempts(error: unknown): readonly unknown[] {
  const key = trailKey(error);
  if (key === undefined) return NO_ATTEMPTS;
  return attemptTrails.get(key) ?? NO_ATTEMPTS;
}
