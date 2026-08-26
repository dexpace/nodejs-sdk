// SPDX-License-Identifier: MIT
// packages/core/src/body/simple-bodies.ts
import {QueryParams, type QueryParamsBuilder} from '../http/query-params.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {FormBodyValidationError} from './errors.js';
import {freezeBody} from './freeze-body.js';
import {assertHeaderSafeMediaType} from './media-type-safety.js';
import {withBodyWriter} from './write-body.js';

/**
 * A body backed by an in-memory byte array (BODY-1). Always replayable.
 *
 * @public
 */
export class ByteArrayBody implements Body {
  /** Discriminates this variant within the {@link Body} union. */
  readonly kind = 'byte-array' as const;
  /** The declared media type, or `undefined` when the caller supplied none. */
  readonly mediaType: string | undefined;
  /** The exact byte count `writeTo` will emit -- always known for an in-memory body. */
  readonly contentLength: number;
  /** Always `true`: the bytes are held in memory, so every write is byte-for-byte identical. */
  readonly replayable = true;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array, mediaType?: string) {
    assertHeaderSafeMediaType(mediaType); // HTTP-26/HTTP-51
    // Defensive copy: `bytes` caller passed might be mutated later (HTTP-1). Kept `#private` --
    // exposing this publicly would let a caller mutate a "replayable" body's contents after
    // construction, silently breaking the byte-for-byte-identical guarantee BODY-1 requires.
    this.#bytes = Uint8Array.from(bytes);
    this.mediaType = mediaType;
    this.contentLength = this.#bytes.length;
    freezeBody(this);
  }

  /**
   * Writes the held bytes into `sink`, then closes it (BODY-1). Repeatable.
   *
   * @param sink - the destination; this body's to close, the caller's only to supply.
   */
  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    await withBodyWriter(sink, async writer => {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    });
  }
}

/**
 * Creates a replayable ByteArrayBody (BODY-1).
 *
 * @throws MediaTypeParseError when `mediaType` contains a control character or non-ASCII byte, which
 * would let it break out of the header it is rendered into (HTTP-26/HTTP-51).
 * @public
 */
export function byteArrayBody(
  bytes: Uint8Array,
  mediaType?: string,
): ByteArrayBody {
  return new ByteArrayBody(bytes, mediaType);
}

/**
 * A body backed by an in-memory string (BODY-1). Always replayable.
 *
 * @public
 */
export class StringBody implements Body {
  /** Discriminates this variant within the {@link Body} union. */
  readonly kind = 'string' as const;
  /** Defaults to `text/plain; charset=utf-8`, matching the UTF-8 encoding `writeTo` emits. */
  readonly mediaType: string;
  /** The UTF-8 byte count, which is not the character count for non-ASCII text. */
  readonly contentLength: number;
  /** Always `true`: the text is held in memory, so every write is byte-for-byte identical. */
  readonly replayable = true;
  /** The source text, exactly as supplied. */
  readonly text: string;
  readonly #bytes: Uint8Array;

  constructor(text: string, mediaType = 'text/plain; charset=utf-8') {
    assertHeaderSafeMediaType(mediaType); // HTTP-26/HTTP-51
    this.text = text;
    this.mediaType = mediaType;
    this.#bytes = new TextEncoder().encode(text);
    this.contentLength = this.#bytes.length;
    freezeBody(this);
  }

  /**
   * Writes the UTF-8 encoding of {@link StringBody.text} into `sink`, then closes it (BODY-1).
   * Repeatable.
   *
   * @param sink - the destination; this body's to close, the caller's only to supply.
   */
  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    await withBodyWriter(sink, async writer => {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    });
  }
}

/**
 * Creates a replayable StringBody (BODY-1).
 *
 * @throws MediaTypeParseError when `mediaType` contains a control character or non-ASCII byte, which
 * would let it break out of the header it is rendered into (HTTP-26/HTTP-51).
 * @public
 */
export function stringBody(
  text: string,
  mediaType = 'text/plain; charset=utf-8',
): StringBody {
  return new StringBody(text, mediaType);
}

/**
 * A form field value. Primitives are rendered with their standard string form; `null` produces a
 * valueless parameter. Anything else is rejected rather than silently dropped.
 *
 * @public
 */
export type FormUrlEncodedValue = string | number | boolean | bigint | null;

/**
 * Accepted input shapes for {@link formUrlEncodedBody}.
 *
 * @public
 */
export type FormUrlEncodedInput =
  | QueryParams
  | ReadonlyMap<string, FormUrlEncodedValue | readonly FormUrlEncodedValue[]>
  | Record<string, FormUrlEncodedValue | readonly FormUrlEncodedValue[]>
  | readonly (readonly [string, FormUrlEncodedValue])[];

// BODY-35: a form field that is neither a primitive nor null cannot be rendered, and dropping it would
// put a silently incomplete body on the wire. Fail naming the key instead.
function toFieldValue(key: string, value: unknown): string | null {
  if (typeof value === 'string' || value === null) return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  throw new FormBodyValidationError(key, value);
}

function addParamValue(
  builder: QueryParamsBuilder,
  key: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const element of value as readonly unknown[]) {
      builder.add(key, toFieldValue(key, element));
    }
    return;
  }
  builder.add(key, toFieldValue(key, value));
}

function toQueryParams(input: FormUrlEncodedInput): QueryParams {
  if (input instanceof QueryParams) return input;
  const builder = QueryParams.newBuilder();
  const entries: readonly (readonly [unknown, unknown])[] =
    input instanceof Map
      ? [...input.entries()]
      : Array.isArray(input)
        ? (input as readonly (readonly [unknown, unknown])[])
        : Object.entries(input);
  for (const [key, value] of entries) {
    if (typeof key !== 'string')
      throw new FormBodyValidationError(String(key), key);
    addParamValue(builder, key, value);
  }
  return builder.build();
}

/**
 * A body backed by URL-encoded form data (BODY-1, HTTP-38/BODY-35). Always replayable.
 *
 * @public
 */
export class FormUrlEncodedBody implements Body {
  /** Discriminates this variant within the {@link Body} union. */
  readonly kind = 'form-urlencoded' as const;
  /** Fixed at `application/x-www-form-urlencoded` -- the encoding defines the media type. */
  readonly mediaType = 'application/x-www-form-urlencoded';
  /** The byte count of the encoded form, always known. */
  readonly contentLength: number;
  /** Always `true`: the encoded form is held in memory (BODY-35). */
  readonly replayable = true;
  /** The normalized parameters, whatever input shape they were built from. */
  readonly params: QueryParams;
  readonly #bytes: Uint8Array;

  constructor(input: FormUrlEncodedInput) {
    this.params = toQueryParams(input);
    // HTTP-38/BODY-35: x-www-form-urlencoded uses '+' for space, distinct from RFC 3986 query encoding.
    const encoded = this.params.encode().replace(/%20/g, '+');
    invariant(
      !encoded.includes(' '),
      'form-urlencoded encoding produced illegal space',
    );
    this.#bytes = new TextEncoder().encode(encoded);
    this.contentLength = this.#bytes.length;
    freezeBody(this);
  }

  /**
   * Writes the encoded form into `sink`, then closes it (BODY-1). Repeatable.
   *
   * @param sink - the destination; this body's to close, the caller's only to supply.
   */
  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    await withBodyWriter(sink, async writer => {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    });
  }
}

/**
 * Creates a replayable FormUrlEncodedBody (BODY-1, HTTP-38/BODY-35).
 *
 * @throws FormBodyValidationError when a field name is not a string, or a field value is neither a
 * primitive nor `null` -- such a field cannot be rendered and is never dropped silently.
 * @public
 */
export function formUrlEncodedBody(
  input: FormUrlEncodedInput,
): FormUrlEncodedBody {
  return new FormUrlEncodedBody(input);
}
