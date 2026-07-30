// SPDX-License-Identifier: MIT
// packages/core/src/http/media-type.ts
import {MediaTypeParseError} from './errors.js';
import {hasForbiddenOutboundByte} from './ascii-validation.js';

const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function splitRespectingQuotes(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
    } else if (ch === '\\' && inQuotes) {
      current += ch;
      escaped = true;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === separator && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function validateNoForbiddenBytes(value: string): void {
  if (hasForbiddenOutboundByte(value)) {
    throw new MediaTypeParseError(
      `media type contains a forbidden character (${String(value.length)} chars)`,
    );
  }
}

function validateToken(value: string, label: string): void {
  if (!TOKEN_RE.test(value)) {
    throw new MediaTypeParseError(
      `media type ${label} must be a non-empty RFC token (${String(value.length)} chars)`,
    );
  }
}

function renderParameterValue(value: string): string {
  if (TOKEN_RE.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * An RFC 7231 media type — a type, a subtype, and zero or more parameters.
 *
 * Type, subtype, and parameter keys are lower-cased at construction; parameter values keep their
 * case, so equality is case-insensitive on the former and case-sensitive on the latter (HTTP-23).
 * Every constructible instance renders to text that re-parses to an equal value (HTTP-25), and no
 * instance can carry a byte that would be unsafe in a header (HTTP-26).
 *
 * @example
 * ```ts
 * const json = MediaType.parse('Application/JSON;Charset=UTF-8');
 * json.type;                                  // 'application'
 * json.charset;                               // 'UTF-8'
 * json.matches(MediaType.parse('application/*')); // true
 * ```
 *
 * @public
 */
export class MediaType {
  readonly #type: string;
  readonly #subtype: string;
  readonly #parameters: ReadonlyMap<string, string>;

  private constructor(
    type: string,
    subtype: string,
    parameters: ReadonlyMap<string, string>,
  ) {
    this.#type = type;
    this.#subtype = subtype;
    this.#parameters = parameters;
    Object.freeze(this);
  }

  /**
   * Constructs a media type from already-separated parts.
   *
   * @param type - the type; must be a non-empty RFC token.
   * @param subtype - the subtype; must be a non-empty RFC token.
   * @param parameters - optional parameters; keys must be RFC tokens, values must be free of
   * control and non-ASCII bytes. Copied, never aliased.
   * @returns the frozen media type, with type, subtype, and parameter keys lower-cased.
   * @throws {@link MediaTypeParseError} when a part is not a valid token, when a parameter value
   * contains a forbidden byte, or when a wildcard type is paired with a concrete subtype.
   */
  static of(
    type: string,
    subtype: string,
    parameters: ReadonlyMap<string, string> = new Map(),
  ): MediaType {
    // Type, subtype, and parameter keys must be RFC tokens (which also implies non-empty and free of
    // forbidden bytes) — anything else renders to text that parse() rejects or reparses differently,
    // breaking HTTP-25's parse(render(x)) === x guarantee for constructible values (HTTP-53's grammar).
    validateToken(type, 'type');
    validateToken(subtype, 'subtype');
    if (type === '*' && subtype !== '*') {
      throw new MediaTypeParseError(
        'a wildcard type is only permitted with a wildcard subtype (*/*) per HTTP-27',
      );
    }
    const normalized = new Map<string, string>();
    for (const [key, value] of parameters) {
      validateToken(key, 'parameter key');
      validateNoForbiddenBytes(value);
      normalized.set(key.toLowerCase(), value);
    }
    return new MediaType(
      type.toLowerCase(),
      subtype.toLowerCase(),
      Object.freeze(normalized),
    );
  }

  /**
   * Parses a media type, respecting quoted-strings — a `;` or `=` inside quotes is not a separator
   * — splitting each parameter on its first `=` only, stripping quotes, and unescaping
   * quoted-pairs (HTTP-25).
   *
   * @param raw - the media-type text, e.g. `text/plain;charset=utf-8`.
   * @returns the parsed, frozen media type.
   * @throws {@link MediaTypeParseError} when the input is blank, lacks a non-empty type and subtype
   * around a single `/`, carries a parameter without a non-empty key and value, or contains a byte
   * the grammar forbids.
   */
  static parse(raw: string): MediaType {
    if (raw.trim() === '')
      throw new MediaTypeParseError('media type cannot be blank');

    const segments = splitRespectingQuotes(raw, ';');
    const typeSubtype = segments[0]?.trim() ?? '';
    const slashIndex = typeSubtype.indexOf('/');
    if (slashIndex <= 0 || slashIndex === typeSubtype.length - 1) {
      throw new MediaTypeParseError(
        `media type requires non-empty type and subtype: ${raw}`,
      );
    }

    const type = typeSubtype.slice(0, slashIndex);
    const subtype = typeSubtype.slice(slashIndex + 1);
    const parameters = MediaType.#parseParameters(segments.slice(1), raw);
    return MediaType.of(type, subtype, parameters);
  }

  static #parseParameters(
    segments: readonly string[],
    raw: string,
  ): Map<string, string> {
    const parameters = new Map<string, string>();
    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed === '') continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0 || eqIndex === trimmed.length - 1) {
        throw new MediaTypeParseError(
          `malformed parameter in media type: ${raw}`,
        );
      }

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      parameters.set(key, value);
    }
    return parameters;
  }

  /** The lower-cased type, e.g. `application`. */
  get type(): string {
    return this.#type;
  }

  /** The lower-cased subtype, e.g. `json`. */
  get subtype(): string {
    return this.#subtype;
  }

  /**
   * Looks up a parameter by key, case-insensitively.
   *
   * @param key - the parameter key.
   * @returns the parameter's value with its original case, or `undefined` when absent.
   */
  parameter(key: string): string | undefined {
    return this.#parameters.get(key.toLowerCase());
  }

  /**
   * The `charset` parameter, resolved case-insensitively — `undefined` when absent, never throwing,
   * so callers fall back to their own default (HTTP-24).
   *
   * The value is returned verbatim and is not checked against a registry of known encodings; an
   * unrecognized name surfaces as-is rather than as `undefined`.
   */
  get charset(): string | undefined {
    return this.parameter('charset');
  }

  /**
   * Renders the canonical wire form, emitting each parameter value bare when it is a valid token
   * and quoted-and-escaped otherwise, so `parse(render(x))` equals `x` (HTTP-25).
   *
   * @returns the rendered media type.
   */
  render(): string {
    let result = `${this.#type}/${this.#subtype}`;
    for (const [key, value] of this.#parameters) {
      result += `; ${key}=${renderParameterValue(value)}`;
    }
    return result;
  }

  /**
   * Tests this media type against a possibly-wildcarded pattern, ignoring parameters (HTTP-27).
   *
   * A wildcard in either position matches any value; a wildcard type is only constructible with a
   * wildcard subtype, so the pattern is either `＊/＊`, `type/＊`, or fully concrete.
   *
   * @param pattern - the pattern to match against.
   * @returns `true` when this media type satisfies the pattern.
   */
  matches(pattern: MediaType): boolean {
    const typeMatches = pattern.#type === '*' || pattern.#type === this.#type;
    const subtypeMatches =
      pattern.#subtype === '*' || pattern.#subtype === this.#subtype;
    return typeMatches && subtypeMatches;
  }

  /**
   * Compares by value: case-insensitively on type, subtype, and parameter keys (all already
   * folded), case-sensitively on parameter values (HTTP-23).
   *
   * @param other - the media type to compare against.
   * @returns `true` when both describe the same media type with the same parameters.
   */
  equals(other: MediaType): boolean {
    if (this.#type !== other.#type || this.#subtype !== other.#subtype)
      return false;
    if (this.#parameters.size !== other.#parameters.size) return false;
    for (const [key, value] of this.#parameters) {
      if (other.#parameters.get(key) !== value) return false;
    }
    return true;
  }
}
