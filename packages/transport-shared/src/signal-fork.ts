// SPDX-License-Identifier: MIT
// packages/transport-shared/src/signal-fork.ts

/**
 * A caller signal, forwarded to the native client only for as long as the transport wants it — and
 * a handle the transport can pull itself.
 *
 * @internal
 */
export interface ForkedSignal {
  /**
   * Hand this to the native client instead of the caller's own signal.
   *
   * Always present, even when the caller supplied no signal and no timeout was composed. That is
   * not symmetry for its own sake: {@link ForkedSignal.abort} is the only way a transport can
   * cancel a native call it has decided to abandon, and a send with no caller signal is exactly
   * the case where a failed request-body producer would otherwise leave one running forever
   * (TRANSPORT-9, SEAM-30). A controller nobody ever aborts costs one allocation and is
   * indistinguishable, to the native client, from no signal at all.
   */
  readonly signal: AbortSignal;
  /**
   * Stops forwarding, and latches the fork: a later {@link ForkedSignal.abort} is a no-op too.
   * Idempotent. Called at delivery, which is the moment the response stops being the transport's.
   */
  detach(): void;
  /**
   * Cancels the in-flight native call, so a response that arrives afterwards is refused rather
   * than stranded with its body neither read nor released (TRANSPORT-9).
   *
   * A no-op after {@link ForkedSignal.detach}, which is what keeps this from becoming the SEAM-16
   * violation the fork exists to prevent: once a body has been handed to the caller, nothing in
   * this transport may close it.
   *
   * @param reason - the abort reason; the failure that made the transport give up.
   */
  abort(reason: unknown): void;
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
 * The fork is two-way. It carries the caller's abort *in*, and it lets the transport cancel the
 * native call *out* — the second direction added by audit #67 / #82, because a request-body
 * producer that fails while the native call is still pending has to take that call down with it.
 *
 * @param source - the composed caller/timeout signal, if any.
 * @returns the signal to dispatch with, the detach the transport calls on delivery, and the abort
 *   it calls when it abandons the exchange.
 *
 * @internal
 */
export function forkSignal(source: AbortSignal | undefined): ForkedSignal {
  const controller = new AbortController();
  let detached = false;
  const forward = (): void => {
    controller.abort(source?.reason);
  };
  if (source !== undefined) {
    if (source.aborted) forward();
    else source.addEventListener('abort', forward, {once: true});
  }
  return {
    signal: controller.signal,
    detach: () => {
      detached = true;
      // removeEventListener is idempotent and a no-op for a listener never added, so a detach on
      // both the success and failure path, with or without a source, is safe.
      source?.removeEventListener('abort', forward);
    },
    abort: (reason: unknown) => {
      if (detached) return;
      controller.abort(reason);
    },
  };
}
