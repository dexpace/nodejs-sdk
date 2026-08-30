// SPDX-License-Identifier: MIT
// packages/core/src/recovery/cancellation.ts
import {failure, type Outcome} from './outcome.js';

/**
 * Wraps a cancellation or interruption throwable into a Failure (RECOV-11).
 *
 * The reference requires re-asserting the cancellation signal on the current context when wrapping,
 * so code later blocked on the outcome still observes cancellation — a concern specific to a
 * clearable `Thread.interrupt()` flag. Node has nothing to re-assert: an `AbortSignal` stays
 * aborted once fired, and the SDK holds a signal, never the caller's `AbortController`, so it could
 * not set one anyway. The helper therefore degenerates to `failure(error)`, and exists as the one
 * named, findable site where RECOV-11's Node disposition lives.
 *
 * It deliberately does **not** crash on a `CancellationError` whose paired signal never aborted.
 * `Transport` is a pluggable seam, so that mismatch is a misbehaving third-party implementation —
 * an operational failure, not a violated precondition of this codebase, and crash-loud treatment is
 * reserved for the latter (`docs/knowledge/harvested/error-handling.md`). It would also break RECOV-2: this
 * runs inside `dispatchWithRecovery`'s own `catch`, so throwing here would let a transport failure
 * skip the response and recovery chains entirely, which is precisely what RECOV-2 forbids. A
 * transport that aborts its in-flight requests from `close()` — which SEAM-14 permits — produces
 * exactly that shape while the caller passed no signal at all.
 *
 * This function never throws, for any input.
 *
 * @param error - whatever the request chain or the transport raised.
 * @returns a failure outcome carrying `error` unchanged.
 *
 * @internal
 */
export function wrapCancellation(error: unknown): Outcome<never> {
  return failure(error);
}
