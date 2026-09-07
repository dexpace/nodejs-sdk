// SPDX-License-Identifier: MIT
// packages/rx/src/from-async-iterable.ts
import {Observable} from 'rxjs';

/**
 * Drive an iterator's `return()` on a termination path, swallowing a release failure.
 *
 * Release is *quiet* here (`SSE-30`): the terminal signal the subscriber sees has already been decided by the
 * time this runs, so a failure to release cannot preempt it. `SseStream` still reports the failure through its
 * own `onReleaseFailure` hook — swallowing here drops nothing that layer records.
 */
async function returnQuietly(iterator: AsyncIterator<unknown>): Promise<void> {
  if (typeof iterator.return !== 'function') {
    return;
  }
  try {
    await iterator.return();
  } catch {
    // Quiet release per ASYNC-21 / SSE-30 -- see this function's own doc comment.
  }
}

/** As {@link returnQuietly}, for the caller-supplied source release. */
async function releaseQuietly(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch {
    // Quiet release per ASYNC-21 / SSE-30 -- see returnQuietly's doc comment.
  }
}

/**
 * Converts an {@link AsyncIterable} into an RxJS {@link Observable}, attaching a finalizer that reaches the
 * source on every termination path (`ASYNC-6`, `ASYNC-21`).
 *
 * **Why this is not `rxjs`'s own `from(asyncIterable)`.** RxJS 7's async-iterable path is a bare
 * `for await` loop that tests `subscriber.closed` only *after* a pull resolves. Unsubscribing while a pull is
 * suspended — the normal state of an idle SSE stream waiting for the next event — therefore reaches the source
 * only if and when the server sends something, so the response body is never released and the connection is
 * held open indefinitely. Verified against `rxjs@7.8.2`; pinned by
 * `from-async-iterable.conformance.test.ts`'s "rxjs's own from()" case, which fails if a future RxJS closes the
 * gap and makes this module redundant.
 *
 * On a termination path this runs `release` first and *then* returns the iterator: closing the source is what
 * settles an in-flight pull, and an async generator's `return()` is queued behind that pull rather than
 * preempting it. Cancellation is the case that ordering exists for — it is the only one where the pull may
 * stay suspended indefinitely. `return()` runs exactly once across every path — early cancellation,
 * end-of-source, and a source error alike.
 *
 * @param iterable - The source to bridge. Its iterator is taken once per subscription.
 * @param release - Optional source-level release, run ahead of `iterator.return()`. RxJS runs a subscriber's
 *   finalizer on *every* termination, so this fires exactly once per subscription — on unsubscription, on
 *   end-of-source, and on a source error alike, not on cancellation alone. Pass only a release that tolerates
 *   being called after the source has already drained; `SseStream.close()` is idempotent (`SSE-28`), which is
 *   what makes the end-of-source call a no-op rather than a second release.
 *
 * @internal
 */
export function fromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  release?: () => Promise<void>,
): Observable<T> {
  return new Observable<T>(subscriber => {
    const iterator = iterable[Symbol.asyncIterator]();

    // A function, not a bare `subscriber.closed` read: cancellation lands during an `await`, and TypeScript's
    // narrowing would otherwise treat every re-check inside the loop as dead code. It is the opposite -- those
    // re-checks are the whole point.
    const cancelled = (): boolean => subscriber.closed;

    // The single owner of `ASYNC-6`'s exactly-once obligation. Cancellation and end-of-source both reach it,
    // and whichever arrives first is the one that releases.
    let returned = false;
    const returnOnce = async (): Promise<void> => {
      if (returned) {
        return;
      }
      returned = true;
      await returnQuietly(iterator);
    };

    void (async (): Promise<void> => {
      try {
        while (!cancelled()) {
          const result = await iterator.next();
          if (result.done === true || cancelled()) {
            break;
          }
          subscriber.next(result.value);
        }
        if (!cancelled()) {
          subscriber.complete();
        }
      } catch (err: unknown) {
        if (!cancelled()) {
          subscriber.error(err);
        }
      } finally {
        await returnOnce();
      }
    })();

    return () => {
      if (release !== undefined) {
        void releaseQuietly(release);
      }
      void returnOnce();
    };
  });
}
