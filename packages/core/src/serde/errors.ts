// SPDX-License-Identifier: MIT
// packages/core/src/serde/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * Options common to both serde error leaves.
 *
 * Carries only the chained cause, which both directions have. Response context belongs to the read
 * path alone — see {@link DeserializationErrorOptions}.
 *
 * @public
 */
export interface SerdeErrorOptions {
  /** The backing failure, always chained rather than swallowed (SERDE-9). */
  readonly cause?: unknown;
}

/**
 * Options for the read-path leaf, adding the response context a status-aware handler preserves.
 *
 * Separate from {@link SerdeErrorOptions} because only a decode can have a response behind it. A
 * write-path failure has no status, no `ETag`, and no `Location` to describe, so the fields do not
 * exist there rather than existing and being permanently empty.
 *
 * @public
 */
export interface DeserializationErrorOptions extends SerdeErrorOptions {
  /** HTTP status, present only when the error was raised by a status-aware response handler (SERDE-28). */
  readonly status?: number | undefined;
  /** `ETag` of the originating response, preserved so conditional-request context survives (SERDE-28). */
  readonly etag?: string | null | undefined;
  /** `Location` of the originating response, preserved so redirect context survives (SERDE-28). */
  readonly location?: string | null | undefined;
}

/**
 * A write-path serde failure: an unencodable value, or a codec failure while encoding (SERDE-10).
 *
 * Sits directly under {@link DexpaceError} — the error tree is deliberately two levels deep, so
 * there is no `SerdeError` base class. Use {@link isSerdeError} to catch both directions at once,
 * then narrow with `instanceof` when the direction matters.
 *
 * @public
 */
export class SerializationError extends DexpaceError {
  /**
   * @param message - the human-readable failure description.
   * @param options - the chained cause.
   */
  constructor(message: string, options?: SerdeErrorOptions) {
    super(message, {cause: options?.cause});
    // No `this.name = ...` here: DexpaceError's constructor already does `this.name = new.target.name`.
  }
}

/**
 * A read-path serde failure: malformed input, a shape mismatch, a wire `null` into a non-null target
 * (SERDE-13), a missing response body, or a non-decodable status (SERDE-10, SERDE-27, SERDE-28).
 *
 * A genuine stream failure is **not** this type — it propagates unwrapped (SERDE-12), so a caught
 * value for which {@link isSerdeError} is `false` came off the stream rather than out of the codec.
 *
 * @public
 */
export class DeserializationError extends DexpaceError {
  // Declared `T | undefined` rather than `status?: number`: `exactOptionalPropertyTypes` is on, and
  // the constructor assigns a possibly-undefined value. The key must exist either way — a reader
  // checking `'status' in error` should get a straight answer.
  /** The originating HTTP status when a status-aware handler raised this, else `undefined` (SERDE-28). */
  readonly status: number | undefined;
  /** The originating response's `ETag`, so conditional context survives the closed response (SERDE-28). */
  readonly etag: string | null;
  /** The originating response's `Location`, so redirect context survives the closed response (SERDE-28). */
  readonly location: string | null;

  /**
   * @param message - the human-readable failure description; status-led when a handler raised it.
   * @param options - the chained cause, plus any response context worth surviving the close.
   */
  constructor(message: string, options?: DeserializationErrorOptions) {
    super(message, {cause: options?.cause});
    this.status = options?.status;
    this.etag = options?.etag ?? null;
    this.location = options?.location ?? null;
  }
}

/**
 * Type guard grouping both serde directions, so a caller can catch one category without a base class
 * (SERDE-9/SERDE-10). Same mechanism as Phase 3b's `isIoError`/`isBodyError`.
 *
 * Narrows to the union of the two leaves. Direction is the first thing to branch on: a further
 * `e instanceof DeserializationError` reaches the read path's response context.
 *
 * @param e - the caught value.
 * @returns whether `e` is either serde leaf.
 * @public
 */
export function isSerdeError(
  e: unknown,
): e is SerializationError | DeserializationError {
  return e instanceof SerializationError || e instanceof DeserializationError;
}
