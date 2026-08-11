// SPDX-License-Identifier: MIT
// packages/core/src/body/simple-bodies.ts
import {QueryParams, type QueryParamsBuilder} from '../http/query-params.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';

/**
 * A body backed by an in-memory byte array (BODY-1). Always replayable.
 *
 * @public
 */
export class ByteArrayBody implements Body {
  readonly kind = 'byte-array' as const;
  readonly mediaType: string | undefined;
  readonly contentLength: number;
  readonly replayable = true;
  readonly #bytes: Uint8Array;

  constructor(bytes: Uint8Array, mediaType?: string) {
    // Defensive copy: `bytes` caller passed might be mutated later (HTTP-1). Kept `#private` --
    // exposing this publicly would let a caller mutate a "replayable" body's contents after
    // construction, silently breaking the byte-for-byte-identical guarantee BODY-1 requires.
    this.#bytes = Uint8Array.from(bytes);
    this.mediaType = mediaType;
    this.contentLength = this.#bytes.length;
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    const writer = sink.getWriter();
    try {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    } finally {
      await writer.close();
    }
  }
}

/**
 * Creates a replayable ByteArrayBody (BODY-1).
 *
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
  readonly kind = 'string' as const;
  readonly mediaType: string;
  readonly contentLength: number;
  readonly replayable = true;
  readonly text: string;
  readonly #bytes: Uint8Array;

  constructor(text: string, mediaType = 'text/plain; charset=utf-8') {
    this.text = text;
    this.mediaType = mediaType;
    this.#bytes = new TextEncoder().encode(text);
    this.contentLength = this.#bytes.length;
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    const writer = sink.getWriter();
    try {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    } finally {
      await writer.close();
    }
  }
}

/**
 * Creates a replayable StringBody (BODY-1).
 *
 * @public
 */
export function stringBody(
  text: string,
  mediaType = 'text/plain; charset=utf-8',
): StringBody {
  return new StringBody(text, mediaType);
}

/**
 * Accepted input shapes for {@link formUrlEncodedBody}.
 *
 * @public
 */
export type FormUrlEncodedInput =
  | QueryParams
  | ReadonlyMap<string, string | readonly string[]>
  | Record<string, string | readonly string[]>
  | readonly (readonly [string, string])[];

function addParamValue(
  builder: QueryParamsBuilder,
  key: string,
  value: unknown,
): void {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === 'string') builder.add(key, v);
    }
  } else if (typeof value === 'string' || value === null) {
    builder.add(key, value);
  }
}

function toQueryParams(input: FormUrlEncodedInput): QueryParams {
  if (input instanceof QueryParams) return input;
  const builder = QueryParams.newBuilder();
  if (input instanceof Map) {
    for (const [key, value] of input.entries()) {
      if (typeof key === 'string') addParamValue(builder, key, value);
    }
  } else if (Array.isArray(input)) {
    for (const [key, value] of input as readonly (readonly [
      unknown,
      unknown,
    ])[]) {
      if (typeof key === 'string' && typeof value === 'string') {
        builder.add(key, value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(input)) {
      addParamValue(builder, key, value);
    }
  }
  return builder.build();
}

/**
 * A body backed by URL-encoded form data (BODY-1, HTTP-50). Always replayable.
 *
 * @public
 */
export class FormUrlEncodedBody implements Body {
  readonly kind = 'form-urlencoded' as const;
  readonly mediaType = 'application/x-www-form-urlencoded';
  readonly contentLength: number;
  readonly replayable = true;
  readonly params: QueryParams;
  readonly #bytes: Uint8Array;

  constructor(input: FormUrlEncodedInput) {
    this.params = toQueryParams(input);
    const encoded = this.params.encode().replace(/%20/g, '+'); // HTTP-50: space encoded as '+'
    invariant(
      !encoded.includes(' '),
      'form-urlencoded encoding produced illegal space',
    );
    this.#bytes = new TextEncoder().encode(encoded);
    this.contentLength = this.#bytes.length;
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    const writer = sink.getWriter();
    try {
      if (this.#bytes.length > 0) await writer.write(this.#bytes);
    } finally {
      await writer.close();
    }
  }
}

/**
 * Creates a replayable FormUrlEncodedBody (BODY-1, HTTP-50).
 *
 * @public
 */
export function formUrlEncodedBody(
  input: FormUrlEncodedInput,
): FormUrlEncodedBody {
  return new FormUrlEncodedBody(input);
}
