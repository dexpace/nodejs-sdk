// SPDX-License-Identifier: MIT
// packages/core/src/retry/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * A response the retry engine DISCARDED whose status is outside HTTP-11's 400-599 error band.
 *
 * Reachable only when a caller widens `RetrySettings.retryableStatuses` to include a non-error code:
 * the engine then retries a 2xx or 3xx, and every response it discards still owes `RETRY-34` an
 * entry in the suppressed trail. `toHttpError` correctly returns `null` for such a status
 * (`BODY-31` hands a non-error response back intact), so there is nothing for it to build.
 *
 * Until 2026-09-02 the engine fabricated `new HttpStatusError(200, …)` here — precisely the
 * "successful exception" `XCUT-8` forbids, constructed by core itself, and contradicting
 * `HttpStatusError`'s own documented invariant. This leaf exists so the trail can say what actually
 * happened: a response was discarded by a caller-widened retry policy, which is not an HTTP failure.
 * Recorded at `docs/open-items.md` N2 and V14.
 *
 * A two-level leaf under {@link DexpaceError}, deliberately — see checkpoint §5.2 and
 * `docs/open-items.md` R.E2 on why no new middle tier is introduced.
 *
 * @public
 */
export class RetryDiscardedResponseError extends DexpaceError {
  /**
   * The discarded response's status code, outside 400-599 by construction.
   *
   * Carried as a field rather than only interpolated into the message, per
   * `docs/knowledge/harvested/error-handling.md` — so it survives serialization and reaches a
   * structured log without anyone parsing the message back apart.
   */
  readonly status: number;

  /**
   * @param status - the discarded response's status code.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(status: number, options?: ErrorOptions) {
    super(
      `retry discarded a response with status ${String(status)}, which is outside the 400-599 error band; a caller-widened retryableStatuses is the only way to reach this`,
      options,
    );
    this.status = status;
  }
}
