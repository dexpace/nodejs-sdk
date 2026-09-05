// SPDX-License-Identifier: MIT
// packages/codec-json/src/abort-race.ts

/**
 * One abort listener held for the length of a whole stream drive, plus the race that lets it settle
 * an operation that is already *pending*.
 *
 * @internal
 */
export interface AbortRace {
  /**
   * Settle with `operation`, or reject with the signal's `reason` the moment it aborts — whichever
   * happens first.
   *
   * Also rejects before `operation` is even consulted when the signal is already aborted, which is
   * the between-chunks check the loop used to make for itself.
   */
  race<T>(operation: Promise<T>): Promise<T>;

  /** Drop the abort listener. Call from the `finally` that releases the stream lock. */
  release(): void;
}

/** The no-signal case: no listener to install, no race to run, no allocation per chunk. */
const UNRACED: AbortRace = Object.freeze({
  race: <T>(operation: Promise<T>): Promise<T> => operation,
  release: (): void => undefined,
});

/**
 * Bind `signal` to a single listener that can interrupt any number of pending operations
 * (SERDE-3, audit #67 / #79).
 *
 * `throwIfAborted()` between chunks is not enough on its own: a `reader.read()` that never resolves
 * is never raced against anything, so the drain parks inside it, the call never settles, and
 * `source.locked` stays `true` for the rest of the process — the opposite of the seam's promise that
 * "an aborted call never leaves the caller's source locked". Racing the pending operation is what
 * makes that promise true rather than aspirational.
 *
 * The signal's `reason` is surfaced verbatim, never re-typed: a caller aborting with its own error
 * gets that error back, and a bare `abort()` gets the platform's `AbortError` `DOMException`, which
 * is exactly what `throwIfAborted()` would have thrown.
 *
 * One listener per call, not one per chunk — a 10 000-chunk body would otherwise register and remove
 * 10 000 listeners on a signal the caller may hold for the life of a request.
 *
 * @param signal - the caller's signal, or `undefined` when the call took none.
 * @returns a race bound to `signal`, whose `release()` removes the listener.
 * @internal
 */
export function abortRace(signal: AbortSignal | undefined): AbortRace {
  if (signal === undefined) return UNRACED;

  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => {
      // The seam documents that a caller sees its own abort `reason` verbatim, and a caller may
      // abort with any value at all — `controller.abort('gone')` is legal. Re-typing it here would
      // break that contract, and it is also exactly what `throwIfAborted()` throws.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- see above; re-enable if the seam ever narrows `reason` to an Error
      reject(signal.reason as unknown);
    };
    signal.addEventListener('abort', onAbort, {once: true});
  });
  // An abort can land while nothing is racing this promise — between two reads, or after the last
  // one and before `release()`. That rejection would be an unhandled one, which takes the process
  // down under Node's default policy (`docs/knowledge/harvested/cancellation-and-timeouts.md:26`).
  // A no-op handler marks it handled without stopping `Promise.race` below from seeing it.
  void aborted.catch(() => undefined);

  return Object.freeze({
    async race<T>(operation: Promise<T>): Promise<T> {
      signal.throwIfAborted();
      // A pending `operation` that rejects after losing the race is still settled through
      // `Promise.race`'s own handler, so it never becomes an unhandled rejection either — measured
      // on Bun 1.3.14 and Node 20.3/26, where releasing a reader with a read outstanding rejects
      // that read (`AbortError` on Bun, `TypeError` on Node).
      return Promise.race([operation, aborted]);
    },
    release(): void {
      signal.removeEventListener('abort', onAbort);
    },
  });
}
