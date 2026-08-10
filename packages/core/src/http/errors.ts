// SPDX-License-Identifier: MIT
// packages/core/src/http/errors.ts
/**
 * The root of every error the HTTP domain model throws.
 *
 * Catch this to handle any construction, validation, or parse failure from the model uniformly;
 * catch a leaf subclass to distinguish a specific failure. Every subclass sets `name` to its own
 * class name, and wrap-and-rethrow always passes `{cause}`.
 *
 * @public
 */
export class DomainModelError extends Error {
  /**
   * @param message - the human-readable failure description.
   * @param options - standard error options; pass `{cause}` when wrapping a caught error.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

// Narrows a caught `unknown` into an Error (styleguide 8.4). Defined once, imported everywhere a caught
// value becomes a `cause`. Must never itself throw from inside a catch — String() can throw on a
// null-prototype object or a hostile toString, hence the inner try.
/**
 * Narrows a caught `unknown` into an `Error`, for use as a `cause` when rethrowing.
 *
 * Never throws itself — `String()` can throw on a null-prototype object or a hostile `toString`,
 * so the conversion is guarded and falls back to a fixed message.
 *
 * @param value - the caught value.
 * @returns `value` unchanged when it is already an `Error`, otherwise a new `Error` describing it.
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  try {
    return new Error(String(value));
  } catch {
    return new Error('unstringifiable thrown value');
  }
}

/**
 * Thrown by `build()` when a required field was never set (HTTP-4).
 *
 * The missing field is available both in the message (`"<name> is required"`) and, structurally,
 * on {@link RequiredFieldError.fieldName} — prefer the field over parsing the prose.
 *
 * @public
 */
export class RequiredFieldError extends DomainModelError {
  /** The name of the field that was missing. */
  readonly fieldName: string;

  /**
   * @param fieldName - the name of the missing field, as it should appear in the message.
   */
  constructor(fieldName: string) {
    super(`${fieldName} is required`);
    this.fieldName = fieldName;
  }
}

/* eslint-disable no-control-regex -- control character escaping required for HTTP-20 */
function escapeControlChars(input: string): string {
  return input
    .replace(
      /[\x00-\x1f\x7f]/g,
      ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`,
    )
    .replace(/\\x0d/g, '\\r')
    .replace(/\\x0a/g, '\\n');
}
/* eslint-enable no-control-regex -- re-enable no-control-regex */

/* eslint-disable @typescript-eslint/no-unused-vars -- parameter deliberately accepted but un-echoed for HTTP-20 */
/**
 * Thrown when a header name or value fails validation (HTTP-17/18/19).
 *
 * The offending value is never echoed and never stored, and an echoed name has its control
 * characters escaped — the redaction happens in this constructor rather than at each call site, so
 * no throw site can leak a secret or inject control characters into a log (HTTP-20).
 *
 * @public
 */
export class HeaderValidationError extends DomainModelError {
  /** Whether the header's name or its value failed validation. */
  readonly kind: 'name' | 'value';
  /**
   * The offending header name with its control characters escaped. Escaped before storage; the raw
   * offending *value* is deliberately never kept on the error at all (HTTP-20).
   */
  readonly escapedName: string;

  /**
   * @param kind - whether the name or the value was rejected.
   * @param offendingName - the header name; stored only in escaped form.
   * @param _offendingValue - the rejected value. Accepted so call sites read naturally, but
   * deliberately never interpolated into the message nor retained on the error (HTTP-20).
   */
  constructor(
    kind: 'name' | 'value',
    offendingName: string,
    _offendingValue: string | undefined,
  ) {
    const escapedName = escapeControlChars(offendingName);
    super(`invalid header ${kind}: ${escapedName}`);
    this.kind = kind;
    this.escapedName = escapedName;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars -- re-enable no-unused-vars */

/**
 * Thrown when a media type is blank, structurally malformed, or contains a byte the grammar forbids
 * (HTTP-25/26/53).
 *
 * @public
 */
export class MediaTypeParseError extends DomainModelError {}

/**
 * Thrown when a protocol identifier is not one of the recognized HTTP versions or their aliases
 * (HTTP-33).
 *
 * @public
 */
export class ProtocolParseError extends DomainModelError {}

/**
 * Thrown when a request URL is malformed or not absolute; the message carries the offending input
 * and the underlying parse failure is chained as `cause` (HTTP-47).
 *
 * @public
 */
export class UrlConstructionError extends DomainModelError {}

/**
 * Thrown when a per-call operational override is out of range — a non-null timeout that is zero or
 * negative, or a negative max-retries (HTTP-35).
 *
 * @public
 */
export class RequestOptionsValidationError extends DomainModelError {}

/**
 * Thrown when an ETag is unterminated, has an empty strong opaque tag, or contains a character
 * outside the permitted etagc set (HTTP-48).
 *
 * @public
 */
export class EtagParseError extends DomainModelError {}

/**
 * Thrown when a byte range is invalid — a negative offset, a non-positive length, an overflowing
 * bound, a non-`bytes` unit, or a multi-range list (HTTP-49).
 *
 * @public
 */
export class HttpRangeValidationError extends DomainModelError {}

/**
 * Thrown when conditional-request state is contradictory — mixing the any-tag (`*`) with a concrete
 * entity-tag in the same header (HTTP-50).
 *
 * @public
 */
export class RequestConditionsValidationError extends DomainModelError {}

/**
 * Thrown when a request carries a body on a method whose classification forbids one — GET, HEAD,
 * TRACE, CONNECT. Raised at construction rather than deferred to a transport (HTTP-7).
 *
 * @public
 */
export class RequestBodyNotAllowedError extends DomainModelError {
  /**
   * @param method - the method that forbids a body, named in the message.
   */
  constructor(method: string) {
    super(`method ${method} does not allow a request body`);
  }
}
