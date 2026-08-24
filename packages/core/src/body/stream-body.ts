// SPDX-License-Identifier: MIT
// packages/core/src/body/stream-body.ts
import {EndOfStreamError} from '../io/errors.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {ConsumedBodyError} from './errors.js';
import {assertHeaderSafeMediaType} from './media-type-safety.js';
import {withBodyWriter} from './write-body.js';

/**
 * A single-use body backed by a caller-supplied stream.
 *
 * @public
 */
export class StreamBody implements Body {
  readonly kind = 'stream' as const;
  readonly mediaType: string | undefined;
  readonly contentLength: number;
  readonly replayable = false;
  readonly #stream: ReadableStream<Uint8Array>;
  #consumed = false;

  constructor(
    stream: ReadableStream<Uint8Array>,
    mediaType?: string,
    contentLength = -1,
  ) {
    assertHeaderSafeMediaType(mediaType); // HTTP-26/HTTP-51
    invariant(
      contentLength >= -1,
      `contentLength must be >= -1 (-1 = unknown), got ${String(contentLength)}`,
    ); // IO-3
    this.#stream = stream;
    this.mediaType = mediaType;
    this.contentLength = contentLength;
  }

  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    if (this.#consumed) throw new ConsumedBodyError('stream');
    this.#consumed = true; // set before the first await -- BODY-3's race-safety guard

    if (this.contentLength < 0) {
      await this.#stream.pipeTo(sink);
      return;
    }
    await this.#writeExactly(sink, this.contentLength);
  }

  /** HTTP-39/BODY-10: writes precisely `declared` bytes or raises naming delivered-of-declared. */
  async #writeExactly(
    sink: WritableStream<Uint8Array>,
    declared: number,
  ): Promise<void> {
    const reader = this.#stream.getReader();
    try {
      await withBodyWriter(sink, async writer => {
        let delivered = 0;
        for (;;) {
          // Serial by necessity: each read depends on the previous one advancing the cursor.
          const {done, value} = await reader.read();
          if (done) break;
          // Checked BEFORE the write, not after the loop: once a transport has stamped the declared
          // Content-Length, an overrun byte sits on the socket where the peer reads it as the start of
          // the next message, and a thrown error cannot recall bytes already written (HTTP-39/BODY-10).
          if (delivered + value.length > declared) {
            throw new EndOfStreamError(delivered + value.length, declared);
          }
          delivered += value.length;
          await writer.write(value);
        }
        // Raised inside the writer scope so withBodyWriter aborts: a truncated body must never be
        // signalled to the sink as a clean close.
        if (delivered !== declared) {
          throw new EndOfStreamError(delivered, declared);
        }
      });
    } finally {
      reader.releaseLock(); // BODY-8: release our handle, never cancel the caller's stream
    }
  }
}

/**
 * Creates a single-use StreamBody (BODY-9).
 *
 * @throws MediaTypeParseError when `mediaType` contains a control character or non-ASCII byte, which
 * would let it break out of the header it is rendered into (HTTP-26/HTTP-51).
 * @throws ConsumedBodyError from `writeTo` when the body has already been written once (BODY-3).
 * @throws EndOfStreamError from `writeTo` when the stream yields a byte count other than the declared
 * `contentLength` (HTTP-39/BODY-10).
 * @public
 */
export function streamBody(
  stream: ReadableStream<Uint8Array>,
  mediaType?: string,
  contentLength = -1,
): StreamBody {
  return new StreamBody(stream, mediaType, contentLength);
}
