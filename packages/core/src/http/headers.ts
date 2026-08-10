// SPDX-License-Identifier: MIT
// packages/core/src/http/headers.ts
import type {Builder} from './builder.js';
import {HeaderValidationError} from './errors.js';
import {
  hasForbiddenNameByte,
  hasForbiddenOutboundByte,
  hasForbiddenInboundValueByte,
} from './ascii-validation.js';

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || hasForbiddenNameByte(trimmed)) {
    throw new HeaderValidationError('name', name, undefined);
  }
  return trimmed;
}

function validateOutboundValue(name: string, value: string): void {
  if (hasForbiddenOutboundByte(value)) {
    throw new HeaderValidationError('value', name, value);
  }
}

function validateInboundValue(name: string, value: string): void {
  if (hasForbiddenInboundValueByte(value)) {
    throw new HeaderValidationError('value', name, value);
  }
}

function toRawName(name: string | HeaderName): string {
  return typeof name === 'string' ? name : name.raw;
}

let createHeaders: (
  valuesByLowerName: ReadonlyMap<string, readonly string[]>,
  originalCasingByLowerName: ReadonlyMap<string, string>,
  insertionOrder: readonly string[],
) => Headers;

/**
 * An immutable, case-insensitive, multi-value header collection.
 *
 * Names are folded with an ASCII-invariant rule for storage, lookup, containment, and equality,
 * while the original casing is preserved for wire emission (HTTP-13). A name may carry several
 * values, and both per-name value order and distinct-name insertion order are preserved
 * (HTTP-14/16). Every returned collection is read-only and isolated from the builder that produced
 * it, so no accessor can be used to reach back into the model (HTTP-5).
 *
 * Construct through the static `Headers.newBuilder()`; derive an existing instance through its own
 * `newBuilder()` method.
 *
 * @example
 * ```ts
 * const headers = Headers.newBuilder()
 *   .add('Content-Type', 'text/plain')
 *   .add('X-Tag', 'a')
 *   .add('X-Tag', 'b')
 *   .build();
 *
 * headers.get('content-type'); // 'text/plain'
 * headers.getAll('X-Tag');     // ['a', 'b']
 * ```
 *
 * @public
 */
export class Headers {
  readonly #valuesByLowerName: ReadonlyMap<string, readonly string[]>;
  readonly #originalCasingByLowerName: ReadonlyMap<string, string>;
  readonly #insertionOrder: readonly string[];

  private constructor(
    valuesByLowerName: ReadonlyMap<string, readonly string[]>,
    originalCasingByLowerName: ReadonlyMap<string, string>,
    insertionOrder: readonly string[],
  ) {
    this.#valuesByLowerName = valuesByLowerName;
    this.#originalCasingByLowerName = originalCasingByLowerName;
    this.#insertionOrder = insertionOrder;
    Object.freeze(this);
  }

  static {
    createHeaders = (values, casing, order) =>
      new Headers(values, casing, order);
  }

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link HeadersBuilder} with no headers set.
   */
  static newBuilder(): HeadersBuilder {
    return new HeadersBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance (HTTP-3).
   *
   * Every value list is copied, never aliased, so mutating the returned builder leaves this
   * instance unchanged. Values are re-appended through the lenient inbound path: they already
   * passed validation when this instance was built, and a `Headers` carrying obs-text must stay
   * derivable (HTTP-19).
   *
   * @returns a {@link HeadersBuilder} holding a copy of this instance's headers.
   */
  newBuilder(): HeadersBuilder {
    const builder = new HeadersBuilder();
    for (const lowerName of this.#insertionOrder) {
      const originalName =
        this.#originalCasingByLowerName.get(lowerName) ?? lowerName;
      for (const value of this.#valuesByLowerName.get(lowerName) ?? []) {
        builder.addInbound(originalName, value);
      }
    }
    return builder;
  }

  /**
   * Returns the first value stored under `name`, matched case-insensitively.
   *
   * @param name - the header name, as a string or a {@link HeaderName} (HTTP-21).
   * @returns the first value, or `undefined` when the name is absent.
   */
  get(name: string | HeaderName): string | undefined {
    return this.#valuesByLowerName.get(toRawName(name).toLowerCase())?.[0];
  }

  /**
   * Returns every value stored under `name`, in insertion order.
   *
   * @param name - the header name, as a string or a {@link HeaderName}.
   * @returns a read-only, frozen list of values — empty when the name is absent.
   */
  getAll(name: string | HeaderName): readonly string[] {
    return this.#valuesByLowerName.get(toRawName(name).toLowerCase()) ?? [];
  }

  /**
   * Reports whether `name` is present, matched case-insensitively.
   *
   * @param name - the header name, as a string or a {@link HeaderName}.
   * @returns `true` when at least one value is stored under the name.
   */
  has(name: string | HeaderName): boolean {
    return this.#valuesByLowerName.has(toRawName(name).toLowerCase());
  }

  /**
   * Lists the distinct header names in insertion order, each in its original casing (HTTP-16).
   *
   * @returns a fresh read-only list; mutating it cannot reach the model.
   */
  names(): readonly string[] {
    return this.#insertionOrder.map(
      lowerName => this.#originalCasingByLowerName.get(lowerName) ?? lowerName,
    );
  }

  /**
   * Flattens every name/value pair for wire emission — one entry per value, so a multi-value name
   * appears once per value, in insertion order and original casing.
   *
   * @returns a fresh read-only list of `[name, value]` pairs; mutating it cannot reach the model.
   */
  entries(): readonly (readonly [string, string])[] {
    const result: (readonly [string, string])[] = [];
    for (const lowerName of this.#insertionOrder) {
      const originalName =
        this.#originalCasingByLowerName.get(lowerName) ?? lowerName;
      for (const value of this.#valuesByLowerName.get(lowerName) ?? []) {
        result.push([originalName, value]);
      }
    }
    return result;
  }

  /**
   * Compares by value, case-insensitively on names and case-sensitively on values (HTTP-13).
   *
   * @param other - the headers to compare against.
   * @returns `true` when both hold the same names with the same value lists.
   */
  equals(other: Headers): boolean {
    if (this.#insertionOrder.length !== other.#insertionOrder.length)
      return false;
    for (const lowerName of this.#insertionOrder) {
      const mine = this.#valuesByLowerName.get(lowerName) ?? [];
      const theirs = other.#valuesByLowerName.get(lowerName) ?? [];
      if (mine.length !== theirs.length || mine.some((v, i) => v !== theirs[i]))
        return false;
    }
    return true;
  }
}

/**
 * Accumulates headers and produces an immutable {@link Headers}.
 *
 * Two validation paths exist deliberately. The outbound methods ({@link HeadersBuilder.add},
 * {@link HeadersBuilder.set}) apply the strict caller-set grammar — HTAB plus printable ASCII in
 * values, no control or non-ASCII bytes in names (HTTP-17/18). The inbound methods
 * ({@link HeadersBuilder.addInbound}, {@link HeadersBuilder.setInbound}) relax values to permit
 * obs-text while still rejecting control characters, for headers received from a server (HTTP-19).
 * Names are validated strictly on both paths, and are trimmed before validation.
 *
 * @public
 */
export class HeadersBuilder implements Builder<Headers> {
  readonly #valuesByLowerName = new Map<string, string[]>();
  readonly #originalCasingByLowerName = new Map<string, string>();
  readonly #insertionOrder: string[] = [];

  /**
   * Appends a value under `name`, keeping any values already stored there (HTTP-14).
   *
   * @param name - the header name; surrounding whitespace is trimmed before validation.
   * @param value - the value, held to the strict outbound grammar.
   * @returns this builder, for chaining.
   * @throws {@link HeaderValidationError} when the name is blank or carries a control, DEL, or
   * non-ASCII byte, or when the value carries anything outside HTAB and printable ASCII.
   */
  add(name: string | HeaderName, value: string): this {
    const trimmedName = validateName(toRawName(name));
    validateOutboundValue(trimmedName, value);
    return this.#append(trimmedName, value);
  }

  /**
   * Replaces the whole value list under `name`, or removes the header when `value` is `null`
   * (HTTP-14/15).
   *
   * @param name - the header name; surrounding whitespace is trimmed before validation.
   * @param value - the single replacement value, or `null` to remove the header entirely.
   * @returns this builder, for chaining.
   * @throws {@link HeaderValidationError} when the name is invalid, or when a non-null value
   * carries anything outside HTAB and printable ASCII.
   */
  set(name: string | HeaderName, value: string | null): this {
    const trimmedName = validateName(toRawName(name));
    if (value !== null) validateOutboundValue(trimmedName, value);
    return this.#replace(trimmedName, value);
  }

  /**
   * Appends a value received from a server, permitting obs-text in the value (HTTP-19).
   *
   * @param name - the header name; validated as strictly as on the outbound path.
   * @param value - the received value; control characters and DEL are still rejected.
   * @returns this builder, for chaining.
   * @throws {@link HeaderValidationError} when the name is invalid or the value carries a control
   * character or DEL.
   */
  addInbound(name: string | HeaderName, value: string): this {
    const trimmedName = validateName(toRawName(name));
    validateInboundValue(trimmedName, value);
    return this.#append(trimmedName, value);
  }

  /**
   * Replaces the value list for a header received from a server, or removes it when `value` is
   * `null`, permitting obs-text in the value (HTTP-19).
   *
   * @param name - the header name; validated as strictly as on the outbound path.
   * @param value - the single replacement value, or `null` to remove the header entirely.
   * @returns this builder, for chaining.
   * @throws {@link HeaderValidationError} when the name is invalid or a non-null value carries a
   * control character or DEL.
   */
  setInbound(name: string | HeaderName, value: string | null): this {
    const trimmedName = validateName(toRawName(name));
    if (value !== null) validateInboundValue(trimmedName, value);
    return this.#replace(trimmedName, value);
  }

  #append(name: string, value: string): this {
    const lowerName = name.toLowerCase();
    if (!this.#valuesByLowerName.has(lowerName)) {
      this.#insertionOrder.push(lowerName);
      this.#originalCasingByLowerName.set(lowerName, name);
      this.#valuesByLowerName.set(lowerName, []);
    }
    this.#valuesByLowerName.get(lowerName)?.push(value);
    return this;
  }

  #replace(name: string, value: string | null): this {
    const lowerName = name.toLowerCase();
    if (value === null) {
      this.#valuesByLowerName.delete(lowerName);
      this.#originalCasingByLowerName.delete(lowerName);
      const index = this.#insertionOrder.indexOf(lowerName);
      if (index !== -1) this.#insertionOrder.splice(index, 1);
      return this;
    }
    if (!this.#valuesByLowerName.has(lowerName))
      this.#insertionOrder.push(lowerName);
    this.#originalCasingByLowerName.set(lowerName, name);
    this.#valuesByLowerName.set(lowerName, [value]);
    return this;
  }

  /**
   * Deep-copies and freezes the accumulated state into an immutable {@link Headers}.
   *
   * Every value list is copied at this point, so a snapshot returned earlier never observes later
   * mutations of this builder (HTTP-5).
   *
   * @returns the frozen headers.
   */
  build(): Headers {
    const frozenValues = new Map<string, readonly string[]>();
    for (const [lowerName, values] of this.#valuesByLowerName) {
      frozenValues.set(lowerName, Object.freeze([...values]));
    }
    return createHeaders(
      Object.freeze(frozenValues),
      Object.freeze(new Map(this.#originalCasingByLowerName)),
      Object.freeze([...this.#insertionOrder]),
    );
  }
}

/**
 * A validated header name that compares by its case-folded form while preserving the original
 * casing for wire emission (HTTP-21).
 *
 * Interchangeable with plain strings: every name-accepting method on {@link Headers} and
 * {@link HeadersBuilder} takes either form, and a header added under one form is visible under the
 * other. Enforces the same name grammar as the outbound string path (HTTP-17).
 *
 * Instances are deliberately not interned. HTTP-22 makes interning a MAY, and a process-lived map
 * keyed by caller-supplied names would be unbounded caller-influenced state; the observable
 * contract is value equality by case-folded name, which needs no shared instances.
 *
 * @public
 */
export class HeaderName {
  readonly #raw: string;
  readonly #lower: string;

  private constructor(raw: string, lower: string) {
    this.#raw = raw;
    this.#lower = lower;
    Object.freeze(this);
  }

  /**
   * Validates and constructs a header name.
   *
   * @param raw - the name; surrounding whitespace is trimmed before validation and the trimmed
   * form is what gets stored.
   * @returns the frozen header name.
   * @throws {@link HeaderValidationError} when the name is blank or carries a control, DEL, or
   * non-ASCII byte (HTTP-17).
   */
  static of(raw: string): HeaderName {
    const trimmed = validateName(raw);
    return new HeaderName(trimmed, trimmed.toLowerCase());
  }

  /** The name in its original (trimmed) casing, as it should appear on the wire. */
  get raw(): string {
    return this.#raw;
  }

  /** The case-folded form the header model keys on. */
  get lowerCased(): string {
    return this.#lower;
  }

  /**
   * Compares by case-folded form; original casing never participates.
   *
   * @param other - the name to compare against.
   * @returns `true` when both fold to the same name.
   */
  equals(other: HeaderName): boolean {
    return this.#lower === other.#lower;
  }
}
