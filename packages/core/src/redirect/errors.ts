// SPDX-License-Identifier: MIT
// packages/core/src/redirect/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * REDIR-6: a method-preserving redirect (301/302/307/308) re-sends the original body, so the body must
 * be replayable. Distinct from 3b's `ConsumedBodyError`, which fires on a SECOND write against an
 * already-consumed single-use body -- this one is a fail-fast gate evaluated BEFORE any write is
 * attempted, and names replayability specifically as the requirement demands.
 *
 * @internal
 */
export class NonReplayableBodyError extends DexpaceError {
  /**
   * The redirect target that would have received the re-send.
   *
   * Carried as a field, not only interpolated into the message, per
   * `docs/knowledge/error-handling.md` -- so it survives serialization and reaches a structured log
   * without anyone parsing the message back apart. Phase 7b's rejection event reads it directly.
   */
  readonly targetUrl: string;

  /**
   * @param targetUrl - the redirect target that would have received the re-send.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(targetUrl: string, options?: ErrorOptions) {
    super(
      `cannot follow redirect to '${targetUrl}': request body is not replayable`,
      options,
    );
    this.targetUrl = targetUrl;
  }
}

/**
 * REDIR-15: an HTTPS-to-HTTP hop, rejected unless `RedirectSettings.allowSchemeDowngrade` is set.
 * Evaluated per hop transition, so an HTTPS-to-HTTP-to-HTTPS chain flags only the hop that downgraded.
 *
 * @internal
 */
export class SchemeDowngradeError extends DexpaceError {
  /** The current hop's request URL -- the HTTPS side of the rejected transition. */
  readonly fromUrl: string;
  /** The resolved redirect target -- the HTTP side of the rejected transition. */
  readonly toUrl: string;

  /**
   * @param fromUrl - the current hop's request URL.
   * @param toUrl - the resolved redirect target.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(fromUrl: string, toUrl: string, options?: ErrorOptions) {
    super(
      `redirect from '${fromUrl}' to '${toUrl}' would downgrade HTTPS to HTTP`,
      options,
    );
    this.fromUrl = fromUrl;
    this.toUrl = toUrl;
  }
}
