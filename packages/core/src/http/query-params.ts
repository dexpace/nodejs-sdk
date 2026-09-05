// SPDX-License-Identifier: MIT
// packages/core/src/http/query-params.ts
import type {Builder} from './builder.js';
import {UrlConstructionError} from './errors.js';
import {
  encodeRfc3986Component,
  hasLoneSurrogate,
  toWellFormed,
} from './rfc3986.js';

/**
 * @internal
 * RFC 3986 component encoding (HTTP-29): space → `%20` (never `+`), literal `+` → `%2B`, everything outside
 * the unreserved set `A–Z a–z 0–9 - . _ ~` percent-encoded.
 *
 * Exported so `src/pagination/query-splice.ts` can reuse it. `PAGE-22` restates this exact rule, and two
 * encoders in one codebase is a drift bug waiting to happen — there is exactly one.
 */
export function encodeQueryComponent(value: string): string {
  return encodeRfc3986Component(value);
}

/**
 * @internal
 * RFC 3986 component decoding (HTTP-29/HTTP-31): a literal `+` reads back as `+`, `%20` as a space, and
 * malformed percent-encoding falls back to raw text rather than throwing.
 */
export function decodeQueryComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The strict half of the surrogate rule, applied by `add()`.
 *
 * `encodeRfc3986Component` is `encodeURIComponent`, which throws a bare `URIError: URI malformed`
 * on an unpaired surrogate — outside the `DexpaceError` tree, and out of `encode()` or `equals()`
 * rather than out of the call that supplied the value. Rejecting here puts the failure at the call
 * site, which is the same place HTTP-35 and HTTP-17/18 put theirs (audit #67 / #76).
 */
function requireWellFormed(kind: 'name' | 'value', text: string): void {
  if (hasLoneSurrogate(text)) {
    throw new UrlConstructionError(
      `query parameter ${kind} contains an unpaired surrogate and cannot be percent-encoded`,
    );
  }
}

let createQueryParams: (
  valuesByName: ReadonlyMap<string, readonly string[]>,
  insertionOrder: readonly string[],
) => QueryParams;

/**
 * An immutable, order-preserving, multi-value collection of URL query parameters.
 *
 * Unlike {@link Headers}, names are case-**sensitive** — `page` and `Page` are distinct. A
 * value-less parameter (`?flag`) is modelled as a single empty-string value, distinct from an
 * absent name (HTTP-28).
 *
 * Encoding and parsing are deliberately asymmetric and kept as separate operations.
 * {@link QueryParams.encode} is strict RFC 3986 percent-encoding — not
 * `application/x-www-form-urlencoded`, so a space is `%20` and never `+` (HTTP-29/32).
 * {@link QueryParams.parse} is lenient and never throws (HTTP-31). The asymmetry extends to
 * unpaired surrogates: {@link QueryParamsBuilder.add} rejects one, while
 * {@link QueryParams.parse} substitutes U+FFFD for it.
 *
 * @example
 * ```ts
 * QueryParams.newBuilder().add('q', 'a b').add('plus', 'c+d').build().encode();
 * // 'q=a%20b&plus=c%2Bd'
 * ```
 *
 * @public
 */
export class QueryParams {
  readonly #valuesByName: ReadonlyMap<string, readonly string[]>;
  readonly #insertionOrder: readonly string[];

  private constructor(
    valuesByName: ReadonlyMap<string, readonly string[]>,
    insertionOrder: readonly string[],
  ) {
    this.#valuesByName = valuesByName;
    this.#insertionOrder = insertionOrder;
    Object.freeze(this);
  }

  static {
    createQueryParams = (values, order) => new QueryParams(values, order);
  }

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link QueryParamsBuilder} with no parameters set.
   */
  static newBuilder(): QueryParamsBuilder {
    return new QueryParamsBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance, copying every value list rather than
   * aliasing it (HTTP-3).
   *
   * @returns a {@link QueryParamsBuilder} holding a copy of this instance's parameters.
   */
  newBuilder(): QueryParamsBuilder {
    const builder = new QueryParamsBuilder();
    for (const name of this.#insertionOrder) {
      for (const value of this.#valuesByName.get(name) ?? [])
        builder.add(name, value);
    }
    return builder;
  }

  /**
   * Parses a query string leniently, inverting {@link QueryParams.encode} and never throwing
   * (HTTP-31).
   *
   * A `null`, `undefined`, or blank input yields empty parameters; a leading `?` is tolerated; a
   * segment with no `=` or a trailing `=` yields an empty-string value; a stray `&` is skipped;
   * malformed percent-encoding falls back to the raw text rather than failing; and an unpaired
   * surrogate is replaced with U+FFFD rather than rejected the way
   * {@link QueryParamsBuilder.add} rejects one, so the result is always encodable.
   *
   * @param raw - the query string, with or without its leading `?`.
   * @returns the parsed, frozen parameters.
   */
  static parse(raw: string | null | undefined): QueryParams {
    const builder = new QueryParamsBuilder();
    if (raw === null || raw === undefined || raw.trim() === '')
      return builder.build();

    const withoutLeadingMark = raw.startsWith('?') ? raw.slice(1) : raw;
    for (const segment of withoutLeadingMark.split('&')) {
      if (segment === '') continue;
      const eqIndex = segment.indexOf('=');
      const rawName = eqIndex === -1 ? segment : segment.slice(0, eqIndex);
      const rawValue = eqIndex === -1 ? '' : segment.slice(eqIndex + 1);
      // HTTP-31 is MUST-level that parsing never throws, so the strict `add()` path above cannot be
      // the one `parse` uses on text it did not choose — exactly the split `Headers` draws between
      // its outbound (`add`) and inbound (`addInbound`) methods for HTTP-18 against HTTP-19.
      builder.add(
        toWellFormed(decodeQueryComponent(rawName)),
        toWellFormed(decodeQueryComponent(rawValue)),
      );
    }
    return builder.build();
  }

  /**
   * Returns the first value stored under `name`, matched case-sensitively.
   *
   * @param name - the parameter name.
   * @returns the first value — `''` for a value-less parameter — or `undefined` when absent.
   */
  get(name: string): string | undefined {
    return this.#valuesByName.get(name)?.[0];
  }

  /**
   * Returns every value stored under `name`, in insertion order.
   *
   * @param name - the parameter name.
   * @returns a read-only, frozen list of values — empty when the name is absent.
   */
  getAll(name: string): readonly string[] {
    return this.#valuesByName.get(name) ?? [];
  }

  /**
   * Reports whether `name` is present, matched case-sensitively.
   *
   * @param name - the parameter name.
   * @returns `true` when at least one value is stored under the name.
   */
  has(name: string): boolean {
    return this.#valuesByName.has(name);
  }

  /**
   * Renders the query string with RFC 3986 percent-encoding (HTTP-29/32).
   *
   * Everything outside the unreserved set `A–Z a–z 0–9 - . _ ~` is encoded — space as `%20` never
   * `+`, a literal `+` as `%2B`, `/` as `%2F`, `*` as `%2A`. Insertion order is preserved, a
   * repeated name is emitted once per value, and the leading `?` is omitted.
   *
   * @returns the encoded query string, empty when there are no parameters.
   */
  encode(): string {
    const parts: string[] = [];
    for (const name of this.#insertionOrder) {
      const encodedName = encodeRfc3986Component(name);
      for (const value of this.#valuesByName.get(name) ?? []) {
        parts.push(`${encodedName}=${encodeRfc3986Component(value)}`);
      }
    }
    return parts.join('&');
  }

  /**
   * Compares order-sensitively: two instances are equal iff they encode identically (HTTP-30).
   *
   * @param other - the parameters to compare against.
   * @returns `true` when both encode to the same string.
   */
  equals(other: QueryParams): boolean {
    return this.encode() === other.encode();
  }
}

/**
 * Accumulates query parameters and produces an immutable {@link QueryParams}.
 *
 * @public
 */
export class QueryParamsBuilder implements Builder<QueryParams> {
  readonly #valuesByName = new Map<string, string[]>();
  readonly #insertionOrder: string[] = [];

  /**
   * Appends a value under `name`, keeping any values already stored there.
   *
   * @param name - the parameter name, kept case-sensitively.
   * @param value - the value; `null` records a value-less parameter as a single empty string
   * (HTTP-28).
   * @returns this builder, for chaining.
   * @throws {@link UrlConstructionError} when the name or the value carries an unpaired surrogate.
   * Such a string has no UTF-8 form, so RFC 3986 percent-encoding is undefined for it and
   * {@link QueryParams.encode} could only fail — it is rejected here, at the call that supplied it.
   * A well-formed surrogate pair is ordinary text and is accepted (HTTP-29).
   */
  add(name: string, value: string | null): this {
    const actualValue = value ?? '';
    requireWellFormed('name', name);
    requireWellFormed('value', actualValue);
    if (!this.#valuesByName.has(name)) {
      this.#insertionOrder.push(name);
      this.#valuesByName.set(name, []);
    }
    this.#valuesByName.get(name)?.push(actualValue);
    return this;
  }

  /**
   * Deep-copies and freezes the accumulated state into an immutable {@link QueryParams}.
   *
   * A name whose value list ended up empty is dropped here, so it cannot leave a phantom
   * containment entry that {@link QueryParams.encode} would never emit (HTTP-30).
   *
   * @returns the frozen parameters.
   */
  build(): QueryParams {
    const valuesByName = new Map<string, readonly string[]>();
    const insertionOrder: string[] = [];
    for (const name of this.#insertionOrder) {
      const values = this.#valuesByName.get(name) ?? [];
      if (values.length === 0) continue; // HTTP-30: an empty value list is dropped at build time
      valuesByName.set(name, Object.freeze([...values]));
      insertionOrder.push(name);
    }
    return createQueryParams(
      Object.freeze(valuesByName),
      Object.freeze(insertionOrder),
    );
  }
}
