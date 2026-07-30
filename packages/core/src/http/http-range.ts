// SPDX-License-Identifier: MIT
// packages/core/src/http/http-range.ts
import {HttpRangeValidationError} from './errors.js';

/**
 * Which of the three byte-range shapes an {@link HttpRange} holds: a bounded window
 * (`bytes=0-499`), a trailing suffix (`bytes=-500`), or an open-ended tail (`bytes=9500-`).
 *
 * @public
 */
export type RangeKind = 'bounded' | 'suffix' | 'open';

function validateNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpRangeValidationError(
      `${label} must be a non-negative safe integer, got ${String(value)}`,
    );
  }
}

function validatePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HttpRangeValidationError(
      `${label} must be a positive safe integer, got ${String(value)}`,
    );
  }
}

function parseByteCount(part: string, label: string): number {
  if (!/^\d+$/.test(part)) {
    throw new HttpRangeValidationError(
      `${label} must be a plain decimal integer`,
    );
  }
  const value = Number(part);
  if (!Number.isSafeInteger(value)) {
    throw new HttpRangeValidationError(
      `${label} overflows the safe-integer range`,
    );
  }
  return value;
}

/**
 * A single HTTP byte range, in one of the three {@link RangeKind} shapes (HTTP-49).
 *
 * Only the `bytes` unit is supported, and only one range per value — a multi-range comma list is
 * rejected. All bounds must be plain decimal safe integers, so a fractional, hex, or overflowing
 * value fails at construction rather than silently truncating.
 *
 * {@link HttpRange.raw} holds the parsed input verbatim when the instance came from
 * {@link HttpRange.parse}, and a synthesized canonical form when it came from one of the
 * factories — those have no original wire text to preserve.
 *
 * @public
 */
export class HttpRange {
  readonly #kind: RangeKind;
  readonly #start: number | undefined;
  readonly #length: number | undefined;
  readonly #suffixLength: number | undefined;
  readonly #raw: string;

  // eslint-disable-next-line max-params -- private, factory-internal; range facets are a fixed shape (HTTP-49)
  private constructor(
    kind: RangeKind,
    start: number | undefined,
    length: number | undefined,
    suffixLength: number | undefined,
    raw: string,
  ) {
    this.#kind = kind;
    this.#start = start;
    this.#length = length;
    this.#suffixLength = suffixLength;
    this.#raw = raw;
    Object.freeze(this);
  }

  /**
   * Builds a bounded range covering `length` bytes from `start`.
   *
   * @param start - the first byte offset; must be a non-negative safe integer.
   * @param length - how many bytes to request; must be a positive safe integer.
   * @returns the frozen range, rendering as `bytes=start-end`.
   * @throws {@link HttpRangeValidationError} when the offset is negative, the length is
   * non-positive, either is not a safe integer, or the computed end overflows.
   */
  static bounded(start: number, length: number): HttpRange {
    validateNonNegative(start, 'range start');
    validatePositive(length, 'range length');
    const end = start + length - 1;
    if (!Number.isSafeInteger(end))
      throw new HttpRangeValidationError(
        `range overflows: ${String(start)}-${String(end)}`,
      );
    return new HttpRange(
      'bounded',
      start,
      length,
      undefined,
      `bytes=${String(start)}-${String(end)}`,
    );
  }

  /**
   * Builds a suffix range requesting the final `suffixLength` bytes.
   *
   * @param suffixLength - how many trailing bytes to request; must be a positive safe integer.
   * @returns the frozen range, rendering as `bytes=-suffixLength`.
   * @throws {@link HttpRangeValidationError} when the length is non-positive or not a safe integer.
   */
  static suffix(suffixLength: number): HttpRange {
    validatePositive(suffixLength, 'suffix length');
    return new HttpRange(
      'suffix',
      undefined,
      undefined,
      suffixLength,
      `bytes=-${String(suffixLength)}`,
    );
  }

  /**
   * Builds an open-ended range from `start` to the end of the representation.
   *
   * @param start - the first byte offset; must be a non-negative safe integer.
   * @returns the frozen range, rendering as `bytes=start-`.
   * @throws {@link HttpRangeValidationError} when the offset is negative or not a safe integer.
   */
  static open(start: number): HttpRange {
    validateNonNegative(start, 'range start');
    return new HttpRange(
      'open',
      start,
      undefined,
      undefined,
      `bytes=${String(start)}-`,
    );
  }

  /**
   * Parses a `Range` header value, holding parse to the same strictness as the factories.
   *
   * @param raw - the range text, e.g. `bytes=0-499`; surrounding whitespace is trimmed and the
   * trimmed text is retained as {@link HttpRange.raw}.
   * @returns the frozen range.
   * @throws {@link HttpRangeValidationError} when the unit is not `bytes`, the value is a
   * multi-range list, the spec is malformed, a bound is not a plain decimal integer, a bound
   * overflows the safe-integer range, or the implied length is non-positive.
   */
  static parse(raw: string): HttpRange {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('bytes=')) {
      throw new HttpRangeValidationError(
        `only the bytes unit is supported: ${raw}`,
      );
    }

    const spec = trimmed.slice('bytes='.length);
    if (spec.includes(','))
      throw new HttpRangeValidationError(
        `multi-range is not supported: ${raw}`,
      );

    const dashIndex = spec.indexOf('-');
    if (dashIndex === -1)
      throw new HttpRangeValidationError(`malformed range: ${raw}`);

    const startPart = spec.slice(0, dashIndex);
    const endPart = spec.slice(dashIndex + 1);

    if (startPart === '') {
      const suffixLength = parseByteCount(endPart, 'suffix length');
      validatePositive(suffixLength, 'suffix length');
      return new HttpRange(
        'suffix',
        undefined,
        undefined,
        suffixLength,
        trimmed,
      );
    }

    const start = parseByteCount(startPart, 'range start');
    if (endPart === '')
      return new HttpRange('open', start, undefined, undefined, trimmed);

    const end = parseByteCount(endPart, 'range end');
    const length = end - start + 1;
    validatePositive(length, 'range length');
    return new HttpRange('bounded', start, length, undefined, trimmed);
  }

  /** Which range shape this instance holds. */
  get kind(): RangeKind {
    return this.#kind;
  }

  /** The first byte offset for a bounded or open range; `undefined` for a suffix range. */
  get start(): number | undefined {
    return this.#start;
  }

  /** The byte count for a bounded range; `undefined` for a suffix or open range. */
  get length(): number | undefined {
    return this.#length;
  }

  /** The trailing byte count for a suffix range; `undefined` for the other shapes. */
  get suffixLength(): number | undefined {
    return this.#suffixLength;
  }

  /** The wire form: the parsed input verbatim, or a canonical rendering for factory-built ranges. */
  get raw(): string {
    return this.#raw;
  }
}
