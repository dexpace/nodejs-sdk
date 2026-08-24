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
