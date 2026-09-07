// SPDX-License-Identifier: MIT
// packages/core/src/body/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * A single-use body's second write (BODY-3). `bodyKind` names which Body variant refused the write.
 *
 * @example
 * ```ts
 * try {
 *   await body.writeTo(sink);
 * } catch (error) {
 *   if (error instanceof ConsumedBodyError) {
 *     // materialize() first if you need to send this body more than once
 *   }
 * }
 * ```
 * @public
 */
export class ConsumedBodyError extends DexpaceError {
  /** The `Body.kind` of the variant that refused the write. */
  readonly bodyKind: string;

  constructor(bodyKind: string, options?: ErrorOptions) {
    super(
      `${bodyKind} body already consumed -- single-use bodies cannot be written twice`,
      options,
    );
    this.bodyKind = bodyKind;
  }
}

/**
 * A caller-supplied multipart boundary violates RFC 2046's grammar (HTTP-51).
 *
 * @public
 */
export class MultipartBoundaryError extends DexpaceError {
  /** The rejected boundary, exactly as supplied. */
  readonly boundary: string;

  constructor(boundary: string, options?: ErrorOptions) {
    super(`invalid multipart boundary: ${JSON.stringify(boundary)}`, options);
    this.boundary = boundary;
  }
}

/**
 * A form field that cannot be rendered into an `x-www-form-urlencoded` body (HTTP-38/BODY-35) -- a
 * non-string field name, or a value that is neither a primitive nor `null`. Raised rather than dropping
 * the field, which would put a silently incomplete body on the wire.
 *
 * @public
 */
export class FormBodyValidationError extends DexpaceError {
  /** The form field name whose value could not be rendered. */
  readonly field: string;

  constructor(field: string, value: unknown, options?: ErrorOptions) {
    super(
      `form field ${JSON.stringify(field)} has an unsupported value of type ${typeof value} -- use a string, number, boolean, bigint, or null`,
      options,
    );
    this.field = field;
  }
}

/**
 * A {@link HttpStatusError} construction whose status is not in HTTP-11's 400-599 error band, or is
 * not an integer at all.
 *
 * `XCUT-8` requires the status-to-exception mapping to reject a non-error status "rather than
 * fabricate a 'successful exception'". `toHttpError` always satisfied that — it returns `null` for
 * anything outside the band — but the published constructor validated nothing, so
 * `new HttpStatusError(200, …)` built exactly the object the requirement forbids and contradicted
 * the class's own documented invariant. Enforced from 2026-09-02.
 *
 * A two-level leaf under {@link DexpaceError}, matching its siblings in this file. It never joined
 * the `DomainModelError` tier `http/errors.ts` carried at the time; that tier has since been
 * flattened onto {@link DexpaceError} as well, and `isDomainModelError` groups what hung off it.
 *
 * Deliberately NOT part of {@link isBodyError}. That guard groups the three failures a caller meets
 * while *working with* a body; this one reports a programmer error at the moment an error object is
 * constructed, and widening the guard's return type would change a published signature for a case
 * no body-handling `catch` wants to see.
 *
 * @public
 */
export class HttpStatusValidationError extends DexpaceError {
  /** The rejected status value, exactly as supplied. */
  readonly status: number;

  /**
   * @param status - the rejected status value.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(status: number, options?: ErrorOptions) {
    super(
      `HttpStatusError status must be an integer in HTTP-11's 400-599 error band, got ${String(status)}`,
      options,
    );
    this.status = status;
  }
}

/**
 * Type guard for body errors.
 *
 * @public
 */
export function isBodyError(
  error: unknown,
): error is
  ConsumedBodyError | MultipartBoundaryError | FormBodyValidationError {
  return (
    error instanceof ConsumedBodyError ||
    error instanceof MultipartBoundaryError ||
    error instanceof FormBodyValidationError
  );
}
