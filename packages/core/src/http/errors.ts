// SPDX-License-Identifier: MIT
// packages/core/src/http/errors.ts
/**
 * The root of the SDK's entire error taxonomy — the "anything this SDK threw" catch-all. Every
 * error the SDK raises, domain-model or otherwise, extends this class. Every subclass sets `name`
 * to its own class name, and wrap-and-rethrow always passes `{cause}`.
 *
 * @public
 */
export class DexpaceError extends Error {
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
export class RequiredFieldError extends DexpaceError {
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
export class HeaderValidationError extends DexpaceError {
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
export class MediaTypeParseError extends DexpaceError {}

/**
 * Thrown when a protocol identifier is not one of the recognized HTTP versions or their aliases
 * (HTTP-33).
 *
 * @public
 */
export class ProtocolParseError extends DexpaceError {}

/**
 * Thrown when a URL cannot be constructed from what a caller supplied.
 *
 * Three cases, all of them "this input has no URL form":
 *
 * - A request URL that is malformed or not absolute (HTTP-47). The message carries the offending
 *   input and the underlying parse failure is chained as `cause`.
 * - A base URL handed to `buildRequest()` that is malformed, not absolute, or carries a fragment
 *   (SEAM-27).
 * - A query-parameter name or value carrying an unpaired surrogate. Such a string has no UTF-8
 *   form, so RFC 3986 percent-encoding is undefined for it and `QueryParams.encode()` could only
 *   fail; `QueryParamsBuilder.add` rejects it at the call that supplied it instead. `cause` is not
 *   set on this path — nothing was caught, the input was inspected (HTTP-29, audit #67 / #76).
 *   `QueryParams.parse` does NOT throw it: HTTP-31 makes parsing lenient, so it substitutes U+FFFD.
 *
 * @public
 */
export class UrlConstructionError extends DexpaceError {}

/**
 * Thrown when a per-call operational override is out of range (HTTP-35).
 *
 * The ranges checked are the FULL ranges, not the lower bounds the requirement's own wording names.
 * HTTP-35's point is that an out-of-range override is a loud error at the call site that supplied
 * it, never a value reinterpreted downstream, and a value that only *some* consumer refuses is the
 * same failure moved one seam away:
 *
 * - `timeoutMs` must be an integer in `1 .. 2**32 - 1` — the range `AbortSignal.timeout()` accepts,
 *   which is the only one a transport can honour. Zero, negatives, `Infinity`, `NaN`, a fractional
 *   millisecond and anything above the ceiling are all rejected. Zero is rejected rather than
 *   reinterpreted: it means "no timeout" in one transport and is an error in another.
 * - `maxRetries` must be a non-negative integer. `0` is accepted and means "disable retries for
 *   this call", distinct from `undefined`; `Infinity` and `NaN` are rejected because they make a
 *   retry driver's ceiling test permanently false and its loop unbounded.
 *
 * @public
 */
export class RequestOptionsValidationError extends DexpaceError {}

/**
 * Thrown when an ETag is unterminated, has an empty strong opaque tag, or contains a character
 * outside the permitted etagc set (HTTP-48).
 *
 * @public
 */
export class EtagParseError extends DexpaceError {}

/**
 * Thrown when a byte range is invalid — a negative offset, a non-positive length, an overflowing
 * bound, a non-`bytes` unit, or a multi-range list (HTTP-49).
 *
 * @public
 */
export class HttpRangeValidationError extends DexpaceError {}

/**
 * Thrown when conditional-request state is contradictory — mixing the any-tag (`*`) with a concrete
 * entity-tag in the same header (HTTP-50).
 *
 * @public
 */
export class RequestConditionsValidationError extends DexpaceError {}

/**
 * Thrown when a request carries a body on a method whose classification forbids one — GET, HEAD,
 * TRACE, CONNECT. Raised at construction rather than deferred to a transport (HTTP-7).
 *
 * @public
 */
export class RequestBodyNotAllowedError extends DexpaceError {
  /**
   * @param method - the method that forbids a body, named in the message.
   */
  constructor(method: string) {
    super(`method ${method} does not allow a request body`);
  }
}

/**
 * Groups every error the HTTP domain model throws, with no class tier between those leaves and
 * {@link DexpaceError} — the corpus caps custom error hierarchies at two levels. This is the
 * replacement for the `DomainModelError` class, which was removed: a `catch` that read
 * `error instanceof DomainModelError` reads `isDomainModelError(error)` instead, and narrows to the
 * same union.
 *
 * Matches any construction, validation, or parse failure the model raises; test against a leaf class
 * to distinguish a specific one. Deliberately excludes the seam layer's own {@link DexpaceError}
 * leaves (`CancellationError`, `OperationAssemblyError`) — a cancelled transport call or an
 * unassembled operation is not itself a domain-model construction failure.
 *
 * @param error - the caught value.
 * @returns whether `error` is one of the ten domain-model error classes.
 *
 * @public
 */
export function isDomainModelError(
  error: unknown,
): error is
  | RequiredFieldError
  | HeaderValidationError
  | MediaTypeParseError
  | ProtocolParseError
  | UrlConstructionError
  | RequestOptionsValidationError
  | EtagParseError
  | HttpRangeValidationError
  | RequestConditionsValidationError
  | RequestBodyNotAllowedError {
  return (
    error instanceof RequiredFieldError ||
    error instanceof HeaderValidationError ||
    error instanceof MediaTypeParseError ||
    error instanceof ProtocolParseError ||
    error instanceof UrlConstructionError ||
    error instanceof RequestOptionsValidationError ||
    error instanceof EtagParseError ||
    error instanceof HttpRangeValidationError ||
    error instanceof RequestConditionsValidationError ||
    error instanceof RequestBodyNotAllowedError
  );
}
