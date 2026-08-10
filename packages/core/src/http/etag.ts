// SPDX-License-Identifier: MIT
// packages/core/src/http/etag.ts
import {EtagParseError} from './errors.js';

function hasForbiddenEtagcByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const allowed =
      code === 0x21 || (code >= 0x23 && code <= 0x7e) || code >= 0x80;
    if (!allowed) return true;
  }
  return false;
}

/**
 * An HTTP entity-tag in one of three forms: strong (`"opaque"`), weak (`W/"opaque"`), or the any
 * singleton ({@link ETag.ANY}, `*`) (HTTP-48).
 *
 * The opaque tag permits obs-text but rejects a literal quote, control characters, and DEL. A
 * strong tag's opaque part must be non-empty; a weak tag's may be empty. Every instance round-trips
 * through {@link ETag.raw}.
 *
 * @public
 */
export class ETag {
  readonly #raw: string;
  readonly #opaque: string | undefined;
  readonly #weak: boolean;
  readonly #any: boolean;

  // eslint-disable-next-line max-params -- private, factory-internal; the four ETag facets are a fixed shape (HTTP-48)
  private constructor(
    raw: string,
    opaque: string | undefined,
    weak: boolean,
    any: boolean,
  ) {
    this.#raw = raw;
    this.#opaque = opaque;
    this.#weak = weak;
    this.#any = any;
    Object.freeze(this);
  }

  /** The any singleton, `*`, which matches any entity-tag. */
  static readonly ANY = new ETag('*', undefined, false, true);

  /**
   * Parses an entity-tag.
   *
   * @param raw - the tag text; surrounding whitespace is trimmed.
   * @returns the parsed tag, or `undefined` for blank input — an absent header is not an error
   * (HTTP-48).
   * @throws {@link EtagParseError} when the tag is unterminated or otherwise malformed, when a
   * strong tag's opaque part is empty, or when the opaque part contains a quote, a control
   * character, or DEL.
   */
  static parse(raw: string): ETag | undefined {
    const trimmed = raw.trim();
    if (trimmed === '') return undefined;
    if (trimmed === '*') return ETag.ANY;

    const weak = trimmed.startsWith('W/');
    const quotedPart = weak ? trimmed.slice(2) : trimmed;
    if (
      quotedPart.length < 2 ||
      !quotedPart.startsWith('"') ||
      !quotedPart.endsWith('"')
    ) {
      throw new EtagParseError(`unterminated or malformed ETag: ${raw}`);
    }

    const opaque = quotedPart.slice(1, -1);
    if (!weak && opaque === '')
      throw new EtagParseError('a strong ETag opaque tag must not be empty');
    if (hasForbiddenEtagcByte(opaque)) {
      throw new EtagParseError(
        'ETag opaque tag contains a forbidden character',
      );
    }
    return new ETag(trimmed, opaque, weak, false);
  }

  /** Whether this is a weak tag (`W/"..."`), permitting semantically-equivalent representations. */
  get isWeak(): boolean {
    return this.#weak;
  }

  /** Whether this is the any singleton, `*`. */
  get isAny(): boolean {
    return this.#any;
  }

  /** The opaque tag with its quotes and weakness prefix stripped; `undefined` for the any tag. */
  get opaque(): string | undefined {
    return this.#opaque;
  }

  /** The tag exactly as it appears on the wire, including quotes and any `W/` prefix. */
  get raw(): string {
    return this.#raw;
  }
}
