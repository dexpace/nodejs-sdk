// SPDX-License-Identifier: MIT
// packages/core/src/body/multipart-body.ts
import type {Builder} from '../http/builder.js';
import {MediaType} from '../http/media-type.js';
import {EndOfStreamError} from '../io/errors.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {MultipartBoundaryError} from './errors.js';
import {freezeBody} from './freeze-body.js';
import {assertHeaderSafeMediaType} from './media-type-safety.js';
import {withBodyWriter} from './write-body.js';

/**
 * A part inside a {@link MultipartBody}.
 *
 * @public
 */
export interface MultipartPart {
  /** The form field name, rendered into `Content-Disposition` and quoted/escaped (HTTP-51). */
  readonly name: string;
  /** An optional upload filename, quoted/escaped the same way as {@link MultipartPart.name}. */
  readonly filename?: string | undefined;
  /** The part's payload. Its `mediaType` becomes the part's `Content-Type` when present. */
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

/**
 * HTTP-51: the `Content-Type` a peer actually parses.
 *
 * RFC 2046 `bchars` and RFC 9110 `tchar` are different sets. `BOUNDARY_PATTERN` above admits ' ', ',',
 * ':', '=', '?', '/', '(' and ')', none of which is a `tchar`, so interpolating the boundary bare
 * produces a parameter value that stops at the first offending byte -- `boundary=a,b` reads as
 * `boundary=a` plus a junk parameter, and the peer then never finds a delimiter. Node's own FormData
 * parser rejects such a body outright with `TypeError: Failed to parse body as FormData`.
 *
 * Rendered through {@link MediaType} rather than a second quoting routine here: it is the module that
 * owns HTTP-25's token-or-quoted-string decision, and `parse(render(x)) === x` is its guarantee. A
 * boundary that IS a bare token still renders bare, so the generated default is byte-identical to what
 * this class emitted before.
 *
 * Narrowing `validateBoundary` to `tchar` instead was rejected: HTTP-51 asks that a boundary VIOLATING
 * the RFC 2046 grammar be refused, not that a conforming one be. The defect is in the rendering.
 */
function renderMediaType(boundary: string): string {
  return MediaType.of(
    'multipart',
    'form-data',
    new Map([['boundary', boundary]]),
  ).render();
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

/**
 * Counts what reaches the sink and refuses a chunk that would carry the message past `declared`
 * (HTTP-51).
 *
 * The shared framing routine guarantees the declared length and the emitted bytes agree about the
 * FRAMING, but it takes each part's own `contentLength` on trust -- and `MultipartPart.body` is the
 * public `Body` interface, so a caller-supplied implementation can report one length and write
 * another. That desynchronizes the value a transport stamps into `Content-Length` from what is
 * actually on the socket, which is the precise drift HTTP-51 exists to prevent.
 *
 * Refused BEFORE the write, not tallied after the loop, for the same reason `StreamBody.#writeExactly`
 * checks early: once the length is stamped, an overrun byte sits where the peer reads it as the start
 * of the next message, and a thrown error cannot recall bytes already written.
 */
function boundedWriter(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  declared: number,
): {write: (chunk: Uint8Array) => Promise<void>; written: () => number} {
  let written = 0;
  return {
    write: async (chunk: Uint8Array): Promise<void> => {
      if (declared !== -1 && written + chunk.length > declared) {
        throw new EndOfStreamError(written + chunk.length, declared);
      }
      written += chunk.length;
      await writer.write(chunk);
    },
    written: () => written,
  };
}

// Wraps the bounded write as a WritableStream whose close() does not close the real sink -- multiple
// parts share one underlying writer, and only the outer writeTo's own scope closes it.
function nonClosingSink(
  write: (chunk: Uint8Array) => Promise<void>,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({write});
}

/**
 * A composite body (BODY-2, HTTP-51). Replayable iff every part is; declared length collapses to unknown
 * if any part's length is unknown.
 *
 * @public
 */
export class MultipartBody implements Body {
  /** Discriminates this variant within the {@link Body} union. */
  readonly kind = 'multipart' as const;
  /**
   * `multipart/form-data` carrying the boundary this instance frames its parts with, with the
   * `boundary` parameter quoted whenever it is not a bare RFC 9110 token (HTTP-51).
   */
  readonly mediaType: string;
  /** The total framed byte count, or -1 when any part's own length is unknown (BODY-2). */
  readonly contentLength: number;
  /** `true` only when every part is replayable -- composite replayability (BODY-2). */
  readonly replayable: boolean;
  readonly #parts: readonly MultipartPart[];
  readonly #boundary: string;

  constructor(parts: readonly MultipartPart[], boundary?: string) {
    if (boundary !== undefined) validateBoundary(boundary);
    this.#boundary = boundary ?? generateBoundary();
    this.#parts = [...parts];
    this.mediaType = renderMediaType(this.#boundary);
    this.replayable = this.#parts.every(part => part.body.replayable);
    this.contentLength = computeContentLength(this.#parts, this.#boundary);
    invariant(
      this.contentLength === -1 ||
        this.contentLength >= trailerBytes(this.#boundary).length,
      `framing computed an impossible length ${String(this.contentLength)}`,
    );
    freezeBody(this); // HTTP-1: see freeze-body.ts
  }

  /**
   * Starts an empty builder (HTTP-3).
   *
   * @returns a fresh {@link MultipartBodyBuilder}.
   */
  static newBuilder(): MultipartBodyBuilder {
    return new MultipartBodyBuilder();
  }

  /**
   * Derives a builder pre-populated with this instance's parts and boundary, aliasing neither (HTTP-3).
   *
   * @returns a {@link MultipartBodyBuilder} holding a copy of this body's state.
   */
  newBuilder(): MultipartBodyBuilder {
    return new MultipartBodyBuilder()
      .parts(this.#parts)
      .boundary(this.#boundary);
  }

  /**
   * Writes every part framed by this body's boundary, then the closing trailer, then closes `sink`
   * (BODY-2).
   *
   * Two mechanisms keep {@link MultipartBody.contentLength} and these bytes from drifting (HTTP-51),
   * and both are needed. The shared framing routine that computed the length also produces the
   * framing here, which covers the delimiters and part headers; and the write is bounded and totalled
   * against the declared length, which covers what the routine cannot -- each part's own reported
   * `contentLength`, taken on trust from an interface any caller can implement.
   *
   * @param sink - the destination; this body's to close, the caller's only to supply. Each part
   * receives a non-closing adapter over the same writer, so no part can end the message early.
   * @throws EndOfStreamError when the bytes actually written disagree with
   * {@link MultipartBody.contentLength} — which happens when a caller-supplied part `Body` reports one
   * length and writes another (HTTP-51).
   * @throws {@link ConsumedBodyError} when a single-use part is written a second time (BODY-3) -- a
   * non-replayable composite needs no guard of its own; the offending part's own guard fires.
   */
  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    await withBodyWriter(sink, async writer => {
      const bounded = boundedWriter(writer, this.contentLength);
      for (const part of this.#parts) {
        await bounded.write(renderPartHeader(part, this.#boundary));
        await part.body.writeTo(nonClosingSink(bounded.write));
        await bounded.write(CRLF);
      }
      await bounded.write(trailerBytes(this.#boundary));
      // HTTP-51: a part that writes FEWER bytes than it declared is the mirror of the overrun the
      // bounded writer refuses, and just as wrong on the wire. Raised inside the writer scope so
      // withBodyWriter aborts rather than signalling a clean close over a short body.
      if (
        this.contentLength !== -1 &&
        bounded.written() !== this.contentLength
      ) {
        throw new EndOfStreamError(bounded.written(), this.contentLength);
      }
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

  /**
   * Replaces the whole parts list, copying it so the builder never aliases the caller's array.
   *
   * @param parts - the parts, in the order they will be framed.
   * @returns this builder, for chaining.
   */
  parts(parts: readonly MultipartPart[]): this {
    this.#parts = [...parts];
    return this;
  }

  /**
   * Appends one part, keeping whatever was added before.
   *
   * @param part - the part to append.
   * @returns this builder, for chaining.
   */
  addPart(part: MultipartPart): this {
    this.#parts.push(part);
    return this;
  }

  /**
   * Sets the boundary, or clears it so `build()` generates a fresh random one.
   *
   * Prefer the generated default; see {@link multipartBody} for the RFC 2046 non-appearance
   * obligation a caller-supplied delimiter carries and that this class cannot check.
   *
   * @param boundary - an RFC 2046 `bchars` delimiter that appears in no part, or `undefined`.
   * @returns this builder, for chaining.
   */
  boundary(boundary: string | undefined): this {
    this.#boundary = boundary;
    return this;
  }

  /**
   * Frames the accumulated parts into an immutable {@link MultipartBody}.
   *
   * @returns the frozen body.
   * @throws {@link MultipartBoundaryError} when the configured boundary violates RFC 2046's bchars
   * grammar (HTTP-51).
   * @throws MediaTypeParseError when a part's media type contains a control character or non-ASCII byte
   * (HTTP-26/HTTP-51).
   */
  build(): MultipartBody {
    return new MultipartBody(this.#parts, this.#boundary);
  }
}
