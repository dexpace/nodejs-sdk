// SPDX-License-Identifier: MIT
// packages/core/src/http/builder.ts
import {RequiredFieldError} from './errors.js';

/**
 * The shared construction contract every builder-based domain model implements (SEAM-29).
 *
 * Structural, not nominal — a class satisfies it by declaring `build(): T`, with no explicit
 * `implements` required — so generic composition helpers can accept any model's builder uniformly.
 *
 * @typeParam T - the immutable model the builder produces.
 * @public
 */
export interface Builder<T> {
  /**
   * Validates the accumulated state and constructs the immutable model.
   *
   * @returns a fully constructed, frozen instance of `T`.
   */
  build(): T;
}

/**
 * The one frozen empty list every multi-value accessor returns for an absent name.
 *
 * Shared, not allocated per miss, and frozen for the same reason the present-name lists are:
 * HTTP-5's accessors "MUST NOT let a caller mutate the model through the returned value", and the
 * TSDoc on `Headers.getAll` and `QueryParams.getAll` promises a frozen list on every path. Both
 * returned a fresh `[]` on a miss, which was neither (audit #67 / #76). Sharing one instance is
 * safe precisely because it is frozen — there is no state in it to alias, and no caller can add
 * any.
 *
 * Lives here rather than in either model because both need it and the two models deliberately
 * import nothing from each other; this module is already the shared construction helper they both
 * import from.
 */
export const EMPTY_VALUE_LIST: readonly string[] = Object.freeze([]);

/**
 * Returns `value` when present, throwing a field-named error when it is `null` or `undefined`.
 *
 * The single source of HTTP-4's required-field errors — every `build()` in this package routes its
 * required-field checks through here so the message can never drift between models.
 *
 * @param value - the possibly-absent field value.
 * @param fieldName - the field's name, as it should appear in the error message.
 * @returns `value`, narrowed to `T`.
 * @throws {@link RequiredFieldError} when `value` is `null` or `undefined`.
 */
export function requireField<T>(
  value: T | null | undefined,
  fieldName: string,
): T {
  if (value === null || value === undefined) {
    throw new RequiredFieldError(fieldName);
  }
  return value;
}
