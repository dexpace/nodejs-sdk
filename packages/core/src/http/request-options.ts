// SPDX-License-Identifier: MIT
// packages/core/src/http/request-options.ts
import type {Builder} from './builder.js';
import {RequestOptionsValidationError} from './errors.js';

let createRequestOptions: (
  timeoutMs: number | undefined,
  maxRetries: number | undefined,
  tags: ReadonlyMap<string, string>,
) => RequestOptions;

/**
 * Immutable per-call operational overrides that are deliberately *not* part of the wire form: a
 * timeout, a max-retries count, and opaque string-keyed tags (HTTP-34).
 *
 * Every field defaults to a "use the configured default" sentinel of `undefined`, and
 * {@link RequestOptions.EMPTY} is the canonical override-nothing instance.
 *
 * `undefined` and `0` are different states for max-retries: `undefined` means "use the default",
 * while `0` means "disable retries for this call" (HTTP-35).
 *
 * @public
 */
export class RequestOptions {
  readonly #timeoutMs: number | undefined;
  readonly #maxRetries: number | undefined;
  readonly #tags: ReadonlyMap<string, string>;

  private constructor(
    timeoutMs: number | undefined,
    maxRetries: number | undefined,
    tags: ReadonlyMap<string, string>,
  ) {
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = maxRetries;
    this.#tags = tags;
    Object.freeze(this);
  }

  static {
    createRequestOptions = (timeoutMs, maxRetries, tags) =>
      new RequestOptions(timeoutMs, maxRetries, tags);
  }

  /** The canonical "override nothing" instance: no timeout, no retry override, no tags. */
  static readonly EMPTY = new RequestOptions(
    undefined,
    undefined,
    Object.freeze(new Map()),
  );

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link RequestOptionsBuilder} overriding nothing.
   */
  static newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance, copying the tag map rather than aliasing it
   * (HTTP-3).
   *
   * @returns a {@link RequestOptionsBuilder} holding a copy of these options.
   */
  newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder()
      .timeoutMs(this.#timeoutMs)
      .maxRetries(this.#maxRetries)
      .tags(this.#tags);
  }

  /** The per-call timeout in milliseconds, or `undefined` to use the configured default. */
  get timeoutMs(): number | undefined {
    return this.#timeoutMs;
  }

  /**
   * The per-call retry ceiling, or `undefined` to use the configured default. A value of `0` means
   * retries are disabled for this call — distinct from `undefined`.
   */
  get maxRetries(): number | undefined {
    return this.#maxRetries;
  }

  /**
   * Looks up an opaque tag by key.
   *
   * @param key - the tag key, matched case-sensitively.
   * @returns the tag value, or `undefined` when unset.
   */
  tag(key: string): string | undefined {
    return this.#tags.get(key);
  }
}

/**
 * Accumulates per-call overrides and produces an immutable {@link RequestOptions}.
 *
 * Range validation happens at each setter, not at `build()`, so a bad value fails at the call site
 * that supplied it.
 *
 * @public
 */
export class RequestOptionsBuilder implements Builder<RequestOptions> {
  #timeoutMs: number | undefined;
  #maxRetries: number | undefined;
  readonly #tags = new Map<string, string>();

  /**
   * Sets the per-call timeout.
   *
   * @param value - the timeout in milliseconds, or `undefined` for no override. Zero is rejected
   * rather than reinterpreted: it means "no timeout" in one transport and is an error in another
   * (HTTP-35).
   * @returns this builder, for chaining.
   * @throws {@link RequestOptionsValidationError} when a defined value is zero or negative.
   */
  timeoutMs(value: number | undefined): this {
    if (value !== undefined && value <= 0) {
      throw new RequestOptionsValidationError(
        `timeout must be positive, got ${String(value)}`,
      );
    }
    this.#timeoutMs = value;
    return this;
  }

  /**
   * Sets the per-call retry ceiling.
   *
   * @param value - the maximum retries, or `undefined` for no override. `0` is accepted and means
   * "disable retries for this call"; anything that is not a non-negative integer is rejected rather
   * than silently reinterpreted (HTTP-35).
   *
   * The range check is deliberately wider than "not negative". A retry ceiling is a count of wire
   * sends, so `Infinity` and `NaN` are as out-of-range as `-1` -- and they are worse in effect: a
   * negative value at least fails a downstream lower-bound guard, while a non-finite one makes a
   * retry driver's "have I reached the ceiling" test permanently false and its loop unbounded.
   * HTTP-35's point is that an out-of-range retry count is a loud error at the call site that
   * supplied it, never a value reinterpreted somewhere downstream.
   *
   * @returns this builder, for chaining.
   * @throws {@link RequestOptionsValidationError} when a defined value is negative, fractional, or
   * not finite.
   */
  maxRetries(value: number | undefined): this {
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      throw new RequestOptionsValidationError(
        `maxRetries must be a non-negative integer, got ${String(value)}`,
      );
    }
    this.#maxRetries = value;
    return this;
  }

  /**
   * Merges opaque tags into the builder's own map, overwriting on key collision.
   *
   * @param entries - the tags to merge; read, never retained.
   * @returns this builder, for chaining.
   */
  tags(entries: ReadonlyMap<string, string>): this {
    for (const [key, value] of entries) this.#tags.set(key, value);
    return this;
  }

  /**
   * Copies and freezes the accumulated state into an immutable {@link RequestOptions}.
   *
   * Tags are defensively copied here, so later mutation of any source map a caller passed to
   * {@link RequestOptionsBuilder.tags} cannot change the built instance (HTTP-34).
   *
   * @returns the frozen options.
   */
  build(): RequestOptions {
    return createRequestOptions(
      this.#timeoutMs,
      this.#maxRetries,
      Object.freeze(new Map(this.#tags)),
    );
  }
}
