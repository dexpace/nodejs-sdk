// SPDX-License-Identifier: MIT
// packages/core/src/cancellation.ts
import type {DexpaceError} from './http/errors.js';
import {TransportFailureError} from './io/errors.js';
import {CancellationError, isTimeoutSignal} from './seams/transport.js';

/**
 * Maps an aborted signal to this SDK's own terminal type, so `XCUT-1`'s "a distinct, terminal,
 * NON-retryable signal" is one type wherever the abort was observed.
 *
 * Before 2026-09-02 only the transports did this (`@dexpace/transport-shared`'s `abortToSdkError`).
 * Core's own cancellable waits -- the retry engine's backoff, the bearer cache's token fetch --
 * surfaced `signal.reason` verbatim, so a caller writing
 * `catch (e) { if (e instanceof CancellationError) ... }` handled a cancelled dispatch and silently
 * missed a cancelled backoff, which arrived as a bare `DOMException` named `AbortError`.
 *
 * `XCUT-3` is why this is not unconditionally a `CancellationError`: a cancellation must be
 * distinguishable from a timeout, and `AbortSignal.timeout()` aborts with a `TimeoutError` reason.
 *
 * **Deliberately a second copy** of `@dexpace/transport-shared`'s function of the same name, not a
 * shared one. That package peer-depends on core and could only reach this through core's PUBLIC
 * barrel; publishing an internal mapper to widen a package boundary is the wrong trade for six
 * lines. Both are pinned by tests asserting the same two branches, so a divergence surfaces as a
 * failure rather than as silent drift -- the same disposition `docs/work/mvp/2026-09-04-open-items-dissolution.md` K18 records for
 * `isHeaderSafe`.
 *
 * @param signal - the aborted signal.
 * @param cause - the original abort reason, kept as the returned error's `cause`.
 * @returns `TransportFailureError` when the abort was a timeout, `CancellationError` otherwise.
 *
 * @internal
 */
export function abortToSdkError(
  signal: AbortSignal,
  cause: unknown,
): DexpaceError {
  return isTimeoutSignal(signal)
    ? new TransportFailureError('operation timed out', {cause})
    : new CancellationError('operation cancelled', {cause});
}
