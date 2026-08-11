// SPDX-License-Identifier: MIT
// packages/core/src/body/stream-body.ts
import {EndOfStreamError} from '../io/errors.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {ConsumedBodyError} from './errors.js';

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
    const writer = sink.getWriter();
    let delivered = 0;
    try {
      for (;;) {
        // Serial by necessity: each read depends on the previous one advancing the cursor.
        const {done, value} = await reader.read();
        if (done) break;
        delivered += value.length;
        await writer.write(value);
      }
    } finally {
      reader.releaseLock(); // BODY-8: release our handle, never cancel the caller's stream
      await writer.close();
    }

    if (delivered !== declared) {
      throw new EndOfStreamError(delivered, declared);
    }
  }
}

/**
 * Creates a single-use StreamBody (BODY-9).
 *
 * @public
 */
export function streamBody(
  stream: ReadableStream<Uint8Array>,
  mediaType?: string,
  contentLength = -1,
): StreamBody {
  return new StreamBody(stream, mediaType, contentLength);
}
