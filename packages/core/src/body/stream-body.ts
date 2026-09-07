// SPDX-License-Identifier: MIT
// packages/core/src/body/stream-body.ts
import {EndOfStreamError, SourceContractViolationError} from '../io/errors.js';
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {ConsumedBodyError} from './errors.js';
import {freezeBody} from './freeze-body.js';
import {assertHeaderSafeMediaType} from './media-type-safety.js';
import {withBodyWriter} from './write-body.js';

/**
 * HTTP-39/BODY-10: a zero-length delivery during an exact-length copy is a source-contract violation,
 * never end-of-stream and never something to spin on -- `{done: true}` is the only end signal.
 *
 * Two failure modes, and neither one is diagnosable anywhere else. A source that only ever yields empty
 * chunks never ends, so the delivered-of-declared check below is never reached; and every empty chunk
 * that gets past here reaches the transport sink, where to an HTTP/1.1 chunked-encoding transport a
 * zero-length chunk is the TERMINATING chunk (`io/buffered-sink.ts`'s `writeString`) -- so tolerating
 * one ends the request body early on the wire while the copy still believes it is mid-body.
 *
 * The wording and the error type are `io/retention-window.ts`'s deliberately: `read()` carries no
 * requested count, so the requirement's "for a positive requested count" has no literal analog, and a
 * request body reaches both this copy and `BufferedSource` -- a divergence would make the same upstream
 * fail or succeed depending only on which wrapper it passed through. `body/response-body-logging.ts`
 * makes the same call for BODY-25 on the response side.
 *
 * A declared length of 0 is still a legitimate empty write (BODY-10): that is a source that signals
 * `{done: true}` immediately, which never reaches this check.
 */
function assertNonEmptyChunk(value: Uint8Array): void {
  if (value.length === 0) {
    throw new SourceContractViolationError(
      'source delivered 0 bytes without signalling end of stream',
    );
  }
}

/**
 * A single-use body backed by a caller-supplied stream.
 *
 * @public
 */
export class StreamBody implements Body {
  /** Discriminates this variant within the {@link Body} union. */
  readonly kind = 'stream' as const;
  /** The declared media type, or `undefined` when the caller supplied none. */
  readonly mediaType: string | undefined;
  /** The caller-declared byte count, or -1 when unknown (BODY-10). */
  readonly contentLength: number;
  /** Always `false` -- Node's `ReadableStream` has no generic mark/reset (BODY-9). */
  readonly replayable = false;
  readonly #stream: ReadableStream<Uint8Array>;
  // Not `readonly`, and deliberately unaffected by `freezeBody(this)` below: freeze never touches
  // `#private` fields, so BODY-3's consumed-once guard still works on a frozen instance.
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
    freezeBody(this); // HTTP-1
  }

  /**
   * Writes every byte of the wrapped stream into `sink`, then closes it (BODY-1).
   *
   * @param sink - the destination; this body's to close, the caller's only to supply.
   * @throws {@link ConsumedBodyError} on a second call -- this body is single-use (BODY-3).
   * @throws EndOfStreamError when a declared `contentLength` disagrees with the bytes the stream
   * actually yields, in either direction (HTTP-39/BODY-10).
   * @throws SourceContractViolationError when the stream delivers a zero-length chunk without
   * signalling end of stream during a declared-length write (HTTP-39/BODY-10).
   */
  async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
    if (this.#consumed) throw new ConsumedBodyError('stream');
    this.#consumed = true; // set before the first await -- BODY-3's race-safety guard

    if (this.contentLength < 0) {
      // BODY-8: `preventCancel` is load-bearing, not a default worth inheriting. `pipeTo`'s default
      // (`preventCancel: false`) cancels the SOURCE when the destination fails -- taking cancellation
      // ownership away from the caller on exactly the failure path where they need it, and
      // contradicting `#writeExactly` below, which only releases its reader. Without it one class
      // has two opposite ownership rules depending on whether a length was declared.
      await this.#stream.pipeTo(sink, {preventCancel: true});
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
          assertNonEmptyChunk(value); // HTTP-39/BODY-10
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
 * @throws SourceContractViolationError from `writeTo` when the stream delivers a zero-length chunk
 * without signalling end of stream during a declared-length write (HTTP-39/BODY-10).
 * @public
 */
export function streamBody(
  stream: ReadableStream<Uint8Array>,
  mediaType?: string,
  contentLength = -1,
): StreamBody {
  return new StreamBody(stream, mediaType, contentLength);
}
