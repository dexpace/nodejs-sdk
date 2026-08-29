// SPDX-License-Identifier: MIT
// packages/transport-shared/src/signal-fork.ts

/**
 * A caller signal, forwarded to the native client only for as long as the transport wants it.
 *
 * @internal
 */
export interface ForkedSignal {
  /** Hand this to the native client instead of the caller's own signal. */
  readonly signal: AbortSignal | undefined;
  /** Stops forwarding. Idempotent; later aborts of the source no longer reach the native client. */
  detach(): void;
}

/**
 * Forks `source` into a signal the transport controls.
 *
 * SEAM-16 forbids a signal abort that fires *after* the send resolved from closing the
 * already-delivered response body — the caller still owns it, even when discarding the value. Both
 * WHATWG `fetch` and undici tie the response body's lifetime to whatever signal they were handed, so
 * passing the caller's signal straight through violates that clause: a later `controller.abort()`
 * truncates a body the caller was reading. Forwarding through a fork the transport detaches at
 * delivery keeps cancellation live for the whole in-flight window (SEAM-13, TRANSPORT-7) and inert
 * afterwards.
 *
 * @param source - the composed caller/timeout signal, if any.
 * @returns the signal to dispatch with, plus the detach the transport calls on delivery.
 *
 * @internal
 */
export function forkSignal(source: AbortSignal | undefined): ForkedSignal {
  if (source === undefined) {
    return {signal: undefined, detach: () => undefined};
  }
  const controller = new AbortController();
  if (source.aborted) {
    controller.abort(source.reason);
    return {signal: controller.signal, detach: () => undefined};
  }
  const forward = (): void => {
    controller.abort(source.reason);
  };
  source.addEventListener('abort', forward, {once: true});
  return {
    signal: controller.signal,
    // removeEventListener is idempotent, so a detach on both the success and failure path is safe.
    detach: () => {
      source.removeEventListener('abort', forward);
    },
  };
}
