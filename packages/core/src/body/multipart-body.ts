// SPDX-License-Identifier: MIT
// packages/core/src/body/multipart-body.ts
import type {Builder} from '../http/builder.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {MultipartBoundaryError} from './errors.js';
import {assertHeaderSafeMediaType} from './media-type-safety.js';
import {withBodyWriter} from './write-body.js';

/**
 * A part inside a {@link MultipartBody}.
 *
 * @public
 */
export interface MultipartPart {
  readonly name: string;
  readonly filename?: string | undefined;
  readonly body: Body;
}

const BOUNDARY_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// RFC 2046 bchars grammar: 1-70 chars, last char not a space.
const BOUNDARY_PATTERN =
  /^[A-Za-z0-9'()+_,\-./:=? ]{1,69}[A-Za-z0-9'()+_,\-./:=?]$/;
const SINGLE_CHAR_BOUNDARY_PATTERN = /^[A-Za-z0-9'()+_,\-./:=?]$/;
const CRLF = new TextEncoder().encode('\r\n');

function generateBoundary(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let boundary = 'dexpace-';
  for (const byte of bytes) {
    const char = BOUNDARY_CHARS[byte % BOUNDARY_CHARS.length];
    invariant(char !== undefined, 'boundary character must be defined');
    boundary += char;
  }
  return boundary;
}

function validateBoundary(boundary: string): void {
  const valid =
    boundary.length === 1
      ? SINGLE_CHAR_BOUNDARY_PATTERN.test(boundary)
      : BOUNDARY_PATTERN.test(boundary);
  if (!valid) throw new MultipartBoundaryError(boundary);
}

// Escapes a quote/backslash so it cannot break the quoted-string grammar, and strips CR/LF outright so
// they can never break the header framing (HTTP-51).
function quoteParam(value: string): string {
  return value.replace(/[\\"]/g, ch => `\\${ch}`).replace(/[\r\n]/g, '');
}

// The shared framing routine HTTP-51 requires: both computeContentLength and writeTo call this for every
// part, so the declared length and the written bytes cannot drift.
function renderPartHeader(part: MultipartPart, boundary: string): Uint8Array {
  let header = `--${boundary}\r\n`;
  header += `Content-Disposition: form-data; name="${quoteParam(part.name)}"`;
  if (part.filename !== undefined)
    header += `; filename="${quoteParam(part.filename)}"`;
  header += '\r\n';
  if (part.body.mediaType !== undefined) {
    // Defence in depth: the bundled Body implementations validate at construction, but `MultipartPart`
    // accepts any `Body`, and this value is interpolated raw. A CR/LF here would append arbitrary
    // headers, close the header block, or forge a closing boundary -- and because this routine is shared
    // with computeContentLength, the declared length would agree with the corrupted bytes (HTTP-51).
    assertHeaderSafeMediaType(part.body.mediaType);
    header += `Content-Type: ${part.body.mediaType}\r\n`;
  }
  header += '\r\n';
  return new TextEncoder().encode(header);
}

function trailerBytes(boundary: string): Uint8Array {
  return new TextEncoder().encode(`--${boundary}--\r\n`);
}

function computeContentLength(
  parts: readonly MultipartPart[],
  boundary: string,
): number {
  let total = 0;
  for (const part of parts) {
    if (part.body.contentLength === -1) return -1; // BODY-2: any unknown part collapses the whole
    total +=
      renderPartHeader(part, boundary).length +
      part.body.contentLength +
      CRLF.length;
  }
  return total + trailerBytes(boundary).length;
}

// Wraps a locked writer as a WritableStream whose close() does not close the real sink -- multiple parts
// share one underlying writer, and only the outer writeTo's own finally block closes it.
function nonClosingSink(
  writer: WritableStreamDefaultWriter<Uint8Array>,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: async chunk => {
      await writer.write(chunk);
    },
  });
}

/**
 * A composite body (BODY-2, HTTP-51). Replayable iff every part is; declared length collapses to unknown
 * if any part's length is unknown.
 *
 * @public
 */
export class MultipartBody implements Body {
  readonly kind = 'multipart' as const;
  readonly mediaType: string;
  readonly contentLength: number;
  readonly replayable: boolean;
  readonly #parts: readonly MultipartPart[];
  readonly #boundary: string;

  constructor(parts: readonly MultipartPart[], boundary?: string) {
    if (boundary !== undefined) validateBoundary(boundary);
    this.#boundary = boundary ?? generateBoundary();
    this.#parts = [...parts];
    this.mediaType = `multipart/form-data; boundary=${this.#boundary}`;
    this.replayable = this.#parts.every(part => part.body.replayable);
    this.contentLength = computeContentLength(this.#parts, this.#boundary);
    invariant(
      this.contentLength === -1 ||
        this.contentLength >= trailerBytes(this.#boundary).length,
      `framing computed an impossible length ${String(this.contentLength)}`,
    );
  }

  static newBuilder(): MultipartBodyBuilder {
    return new MultipartBodyBuilder();
  }

  /** HTTP-3: pre-populated with this instance's parts and boundary, aliasing neither. */
  newBuilder(): MultipartBodyBuilder {
    return new MultipartBodyBuilder()
      .parts(this.#parts)
      .boundary(this.#boundary);
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    await withBodyWriter(sink, async writer => {
      for (const part of this.#parts) {
        await writer.write(renderPartHeader(part, this.#boundary));
        await part.body.writeTo(nonClosingSink(writer));
        await writer.write(CRLF);
      }
      await writer.write(trailerBytes(this.#boundary));
    });
  }
}

/**
 * Creates a MultipartBody (BODY-2, HTTP-51).
 *
 * @throws MultipartBoundaryError when `boundary` violates RFC 2046's bchars grammar (HTTP-51).
 * @throws MediaTypeParseError when a part's media type contains a control character or non-ASCII byte,
 * which would let it break out of the part header it is rendered into (HTTP-26/HTTP-51).
 * @public
 */
export function multipartBody(
  parts: readonly MultipartPart[],
  boundary?: string,
): MultipartBody {
  return new MultipartBody(parts, boundary);
}

/**
 * Builder for {@link MultipartBody}.
 *
 * @public
 */
export class MultipartBodyBuilder implements Builder<MultipartBody> {
  #parts: MultipartPart[] = [];
  #boundary: string | undefined;

  parts(parts: readonly MultipartPart[]): this {
    this.#parts = [...parts];
    return this;
  }

  addPart(part: MultipartPart): this {
    this.#parts.push(part);
    return this;
  }

  boundary(boundary: string | undefined): this {
    this.#boundary = boundary;
    return this;
  }

  /**
   * @throws MultipartBoundaryError when the configured boundary violates RFC 2046's bchars grammar
   * (HTTP-51).
   * @throws MediaTypeParseError when a part's media type contains a control character or non-ASCII byte
   * (HTTP-26/HTTP-51).
   */
  build(): MultipartBody {
    return new MultipartBody(this.#parts, this.#boundary);
  }
}
