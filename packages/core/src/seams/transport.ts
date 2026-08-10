// SPDX-License-Identifier: MIT
// packages/core/src/seams/transport.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {RequestOptions} from '../http/request-options.js';
import {DexpaceError} from '../http/errors.js';

/**
 * The single async HTTP transport seam — SEAM-11 (sync) and SEAM-16 (async) collapse into one
 * `Promise<Response>` contract; SEAM-17's canonical async pivot is native `Promise`, so there is no
 * second async ecosystem to bridge.
 *
 * @public
 */
export interface Transport {
  /**
   * Sends a request and resolves with its response.
   *
   * MUST be safe for concurrent calls; all per-request state confined to locals or the returned
   * promise graph — never instance fields on the transport (SEAM-12; conformance test is Phase 8's,
   * once a real transport exists to fire concurrent requests through).
   *
   * MUST NOT pre-buffer the response body — the caller owns reading and closing it (SEAM-11; the
   * streaming body type arrives in Phase 3, but the obligation binds every implementation from day
   * one).
   *
   * Aborting `signal` while the call is in flight SHOULD be treated as a best-effort request to
   * abort the underlying exchange and release its transport resources — sockets, descriptors
   * (SEAM-13).
   *
   * A `signal` abort that fires *after* the returned promise has resolved MUST NOT close the
   * already-delivered response body — the caller still owns closing it, even when discarding the
   * value (SEAM-16). Do not wire an unconditional `abort` listener that cancels the body.
   *
   * After the underlying fetch resolves, check whether `signal` already fired before delivering the
   * response; if so, cancel the response body instead of resolving. That cleanup path MUST be
   * awaited or given `.catch(() => {})` — an unhandled rejection there crashes the process under
   * Node's default `unhandledRejection` policy (SEAM-30; implemented by Phase 8's real adapters).
   *
   * Per-call `options` MUST be threaded through to the underlying client, never silently dropped. A
   * transport that ignores `options` MUST behave identically to the no-options call (SEAM-18's one
   * surviving, non-bridge-specific obligation).
   *
   * @param request - the request to send.
   * @param options - per-call operational overrides; MUST be threaded through, never dropped.
   * @param signal - an optional abort signal; see the cancellation obligations above.
   * @returns a promise that resolves to a non-null response, or rejects.
   */
  send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response>;

  /**
   * Releases resources this transport itself created.
   *
   * MUST be idempotent, release only resources the transport itself created, and never touch a
   * caller-supplied client/executor (SEAM-14). A lightweight transport with nothing to release MAY
   * implement this as a no-op: `async close(): Promise<void> {}`. The signature is locked from this
   * phase on — adding a required method to a published seam later is a breaking change; only the
   * *behavior* waits for Phase 8.
   *
   * Behavior of `send()` after `close()` has resolved is unspecified at the seam level (SEAM-15);
   * each Phase 8 adapter picks a mode (throw vs. rejected promise) and documents it.
   *
   * @returns a promise that resolves once the transport's own resources are released.
   */
  close(): Promise<void>;
}

/**
 * Wraps `AbortSignal.timeout(ms)` and `AbortSignal.any([...])` into the one signal a
 * `Transport.send()` call should honor. Returns `undefined` when neither input is supplied, so a
 * transport can pass the result straight to `fetch` without a branch. Reusable by Phase 5's retry
 * logic.
 *
 * @param userSignal - an optional caller-supplied abort signal.
 * @param timeoutMs - an optional timeout, in milliseconds.
 * @returns the composed signal, the sole supplied signal, or `undefined` when neither is supplied.
 *
 * @public
 */
export function composeSignal(
  userSignal?: AbortSignal,
  timeoutMs?: number,
): AbortSignal | undefined {
  const timeoutSignal =
    timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined;

  if (userSignal !== undefined && timeoutSignal !== undefined) {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  return userSignal ?? timeoutSignal;
}

/**
 * True when `signal` was aborted by `AbortSignal.timeout()`. Checks the structured `reason.name`
 * field rather than `reason instanceof DOMException` — `instanceof` is realm-bound, so a signal
 * created inside a `node:vm` context or a worker would fail the check even though it is a genuine
 * timeout (XCUT-2: told apart by a structured field on ambient state, not by matching a message
 * string).
 *
 * @param signal - the signal to inspect.
 * @returns `true` when `signal.reason` is a timeout reason.
 *
 * @public
 */
export function isTimeoutSignal(signal: AbortSignal): boolean {
  const reason = signal.reason as {name?: unknown} | null | undefined;
  return (
    typeof reason === 'object' &&
    reason !== null &&
    reason.name === 'TimeoutError'
  );
}

/**
 * Thrown for an explicit caller-initiated abort of an in-flight `Transport.send()` call.
 *
 * @public
 */
export class CancellationError extends DexpaceError {}
