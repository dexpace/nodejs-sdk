// SPDX-License-Identifier: MIT
// packages/core/src/http/request-conditions.ts
import type {Builder} from './builder.js';
import {RequestConditionsValidationError} from './errors.js';
import {ETag} from './etag.js';
import {Headers} from './headers.js';

function addEtag(
  list: readonly ETag[],
  etag: ETag,
  headerName: string,
): readonly ETag[] {
  if (etag.isAny) {
    if (list.some(e => !e.isAny)) {
      throw new RequestConditionsValidationError(
        `${headerName}: '*' cannot combine with a concrete ETag`,
      );
    }
    return [ETag.ANY];
  }
  if (list.some(e => e.isAny)) {
    throw new RequestConditionsValidationError(
      `${headerName}: cannot add a concrete ETag alongside '*'`,
    );
  }
  return [...list, etag];
}

function toRfc1123(date: Date): string {
  return date.toUTCString();
}

// eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-50
let createRequestConditions: (
  ifMatch: readonly ETag[],
  ifNoneMatch: readonly ETag[],
  ifModifiedSince: Date | undefined,
  ifUnmodifiedSince: Date | undefined,
) => RequestConditions;

/**
 * An immutable set of conditional-request preconditions, applied to headers as `If-Match`,
 * `If-None-Match`, `If-Modified-Since`, and `If-Unmodified-Since` (HTTP-50).
 *
 * Multiple entity-tags emit as one comma-separated header; dates emit in RFC 1123 form.
 * {@link RequestConditions.applyTo} uses `set`, never `add`, so applying the same conditions twice
 * cannot duplicate a header. The any-tag (`*`) is mutually exclusive with concrete entity-tags, and
 * repeated `*` collapses to one — enforced when the tag is added, not at emission.
 *
 * @example
 * ```ts
 * const conditions = RequestConditions.newBuilder().ifMatch(etag).build();
 * const headers = conditions.applyTo(existingHeaders);
 * ```
 *
 * @public
 */
export class RequestConditions {
  readonly #ifMatch: readonly ETag[];
  readonly #ifNoneMatch: readonly ETag[];
  readonly #ifModifiedSince: Date | undefined;
  readonly #ifUnmodifiedSince: Date | undefined;

  // eslint-disable-next-line max-params -- private, builder-internal; the four conditional facets are fixed (HTTP-50)
  private constructor(
    ifMatch: readonly ETag[],
    ifNoneMatch: readonly ETag[],
    ifModifiedSince: Date | undefined,
    ifUnmodifiedSince: Date | undefined,
  ) {
    this.#ifMatch = ifMatch;
    this.#ifNoneMatch = ifNoneMatch;
    this.#ifModifiedSince = ifModifiedSince;
    this.#ifUnmodifiedSince = ifUnmodifiedSince;
    Object.freeze(this);
  }

  static {
    // eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-50
    createRequestConditions = (ifMatch, ifNoneMatch, modified, unmodified) =>
      new RequestConditions(ifMatch, ifNoneMatch, modified, unmodified);
  }

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link RequestConditionsBuilder} with no preconditions set.
   */
  static newBuilder(): RequestConditionsBuilder {
    return new RequestConditionsBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance (HTTP-3).
   *
   * `ETag` instances are frozen values safe to share; the builder's own setters re-copy the dates,
   * so neither instance aliases the other.
   *
   * @returns a {@link RequestConditionsBuilder} holding this instance's preconditions.
   */
  newBuilder(): RequestConditionsBuilder {
    const builder = new RequestConditionsBuilder();
    for (const matchTag of this.#ifMatch) builder.ifMatch(matchTag);
    for (const noneMatchTag of this.#ifNoneMatch)
      builder.ifNoneMatch(noneMatchTag);
    if (this.#ifModifiedSince !== undefined)
      builder.ifModifiedSince(this.#ifModifiedSince);
    if (this.#ifUnmodifiedSince !== undefined)
      builder.ifUnmodifiedSince(this.#ifUnmodifiedSince);
    return builder;
  }

  /**
   * Returns a copy of `headers` with these preconditions written onto it.
   *
   * Idempotent: each header is `set`, never appended, so applying the same conditions repeatedly
   * yields the same result (HTTP-50). A precondition that was never set leaves its header
   * untouched.
   *
   * Emission goes through the strict outbound header path, which rejects obs-text. An ETag whose
   * opaque tag carries obs-text is legal per HTTP-48 but cannot be emitted here; reconciling that
   * against HTTP-18 is left to a later phase rather than guessed at now.
   *
   * @param headers - the headers to derive from; not modified.
   * @returns a new {@link Headers} carrying the preconditions.
   * @throws {@link HeaderValidationError} when an entity-tag contains a byte the outbound header
   * value grammar forbids.
   */
  applyTo(headers: Headers): Headers {
    let builder = headers.newBuilder();
    if (this.#ifMatch.length > 0) {
      builder = builder.set(
        'If-Match',
        this.#ifMatch.map(e => e.raw).join(', '),
      );
    }
    if (this.#ifNoneMatch.length > 0) {
      builder = builder.set(
        'If-None-Match',
        this.#ifNoneMatch.map(e => e.raw).join(', '),
      );
    }
    if (this.#ifModifiedSince !== undefined) {
      builder = builder.set(
        'If-Modified-Since',
        toRfc1123(this.#ifModifiedSince),
      );
    }
    if (this.#ifUnmodifiedSince !== undefined) {
      builder = builder.set(
        'If-Unmodified-Since',
        toRfc1123(this.#ifUnmodifiedSince),
      );
    }
    return builder.build();
  }
}

/**
 * Accumulates conditional-request preconditions and produces an immutable
 * {@link RequestConditions}.
 *
 * @public
 */
export class RequestConditionsBuilder implements Builder<RequestConditions> {
  #ifMatch: readonly ETag[] = [];
  #ifNoneMatch: readonly ETag[] = [];
  #ifModifiedSince: Date | undefined;
  #ifUnmodifiedSince: Date | undefined;

  /**
   * Adds an entity-tag to `If-Match`.
   *
   * @param etag - the tag; {@link ETag.ANY} collapses any repeat to a single `*`.
   * @returns this builder, for chaining.
   * @throws {@link RequestConditionsValidationError} when this would mix `*` with a concrete
   * entity-tag in either direction (HTTP-50).
   */
  ifMatch(etag: ETag): this {
    this.#ifMatch = addEtag(this.#ifMatch, etag, 'If-Match');
    return this;
  }

  /**
   * Adds an entity-tag to `If-None-Match`.
   *
   * @param etag - the tag; {@link ETag.ANY} collapses any repeat to a single `*`.
   * @returns this builder, for chaining.
   * @throws {@link RequestConditionsValidationError} when this would mix `*` with a concrete
   * entity-tag in either direction (HTTP-50).
   */
  ifNoneMatch(etag: ETag): this {
    this.#ifNoneMatch = addEtag(this.#ifNoneMatch, etag, 'If-None-Match');
    return this;
  }

  /**
   * Sets `If-Modified-Since`.
   *
   * @param date - the instant; copied, not aliased, so a caller mutating its own `Date` after
   * `build()` cannot change what {@link RequestConditions.applyTo} emits.
   * @returns this builder, for chaining.
   */
  ifModifiedSince(date: Date): this {
    this.#ifModifiedSince = new Date(date.getTime());
    return this;
  }

  /**
   * Sets `If-Unmodified-Since`.
   *
   * @param date - the instant; copied, not aliased, exactly as in
   * {@link RequestConditionsBuilder.ifModifiedSince}.
   * @returns this builder, for chaining.
   */
  ifUnmodifiedSince(date: Date): this {
    this.#ifUnmodifiedSince = new Date(date.getTime());
    return this;
  }

  /**
   * Freezes the accumulated preconditions into an immutable {@link RequestConditions}.
   *
   * All exclusivity validation already happened at the setters, so this cannot fail.
   *
   * @returns the frozen conditions.
   */
  build(): RequestConditions {
    return createRequestConditions(
      this.#ifMatch,
      this.#ifNoneMatch,
      this.#ifModifiedSince,
      this.#ifUnmodifiedSince,
    );
  }
}
