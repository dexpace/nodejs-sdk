// SPDX-License-Identifier: MIT
// packages/core/src/redirect/errors.ts
import {DexpaceError} from '../http/errors.js';
import {redactUrl} from '../observability/redaction.js';

// Both messages below interpolate `redactUrl(...)`, never the raw URL -- XCUT-19(a)/(b) and
// OBS-11/OBS-12 applied to the MESSAGE rather than to a log field. An error message is a public API:
// it travels into every logger, every `cause` chain, and every consumer's own `console.error`, and
// this SDK owns none of those. `http.redirect.rejected` in particular hands the decision error to
// `LogEvent.cause()`, which renders it as `name: message` (`observability/logger.ts`), so a raw
// `from`/`to` URL here put userinfo and query-string tokens into the log record in clear text however
// carefully the surrounding fields were redacted. Redacting at construction is the only placement that
// also covers the paths this SDK does not own. OBS-15 makes the call safe from a constructor: an input
// that will not parse yields `[malformed url]` rather than throwing. The raw value stays on the
// error's own property, which is what program code reads.

/**
 * REDIR-6: a method-preserving redirect (301/302/307/308) re-sends the original body, so the body must
 * be replayable. Distinct from 3b's `ConsumedBodyError`, which fires on a SECOND write against an
 * already-consumed single-use body -- this one is a fail-fast gate evaluated BEFORE any write is
 * attempted, and names replayability specifically as the requirement demands.
 *
 * @remarks
 * The `message` names the target in REDACTED form (OBS-11/OBS-12): userinfo as `***:***@` and every
 * non-allow-listed query value as `***`. Read {@link NonReplayableBodyError.targetUrl} for the raw URL.
 *
 * @public
 */
export class NonReplayableBodyError extends DexpaceError {
  /**
   * The redirect target that would have received the re-send, **raw and unredacted**.
   *
   * Carried as a field, not only interpolated into the message, per
   * `docs/knowledge/harvested/error-handling.md` -- so it survives serialization and reaches a structured log
   * without anyone parsing the message back apart. Phase 7b's rejection event reads it directly.
   *
   * This is the raw URL; the `message` carries the redacted form. Program code that needs the real
   * target reads this property; anything that renders to a human or to a log backend reads the
   * message.
   */
  readonly targetUrl: string;

  /**
   * @param targetUrl - the redirect target that would have received the re-send.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(targetUrl: string, options?: ErrorOptions) {
    super(
      `cannot follow redirect to '${redactUrl(targetUrl)}': request body is not replayable`,
      options,
    );
    this.targetUrl = targetUrl;
  }
}

/**
 * REDIR-15: an HTTPS-to-HTTP hop, rejected unless `RedirectSettings.allowSchemeDowngrade` is set.
 * Evaluated per hop transition, so an HTTPS-to-HTTP-to-HTTPS chain flags only the hop that downgraded.
 *
 * @remarks
 * The `message` names both URLs in REDACTED form (OBS-11/OBS-12): userinfo as `***:***@` and every
 * non-allow-listed query value as `***`. Read {@link SchemeDowngradeError.fromUrl} and
 * {@link SchemeDowngradeError.toUrl} for the raw URLs.
 *
 * @public
 */
export class SchemeDowngradeError extends DexpaceError {
  /**
   * The current hop's request URL -- the HTTPS side of the rejected transition, **raw and
   * unredacted**. The `message` carries the redacted form.
   */
  readonly fromUrl: string;
  /**
   * The resolved redirect target -- the HTTP side of the rejected transition, **raw and unredacted**.
   * The `message` carries the redacted form.
   */
  readonly toUrl: string;

  /**
   * @param fromUrl - the current hop's request URL.
   * @param toUrl - the resolved redirect target.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(fromUrl: string, toUrl: string, options?: ErrorOptions) {
    super(
      `redirect from '${redactUrl(fromUrl)}' to '${redactUrl(toUrl)}' would downgrade HTTPS to HTTP`,
      options,
    );
    this.fromUrl = fromUrl;
    this.toUrl = toUrl;
  }
}
