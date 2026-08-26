// SPDX-License-Identifier: MIT
// packages/core/src/body/body.ts

/**
 * The core domain interface for HTTP message bodies.
 *
 * @public
 */
export interface Body {
  /**
   * The discriminant that narrows this interface to a concrete variant, per the styleguide's
   * discriminated-union-over-independent-classes pattern -- there is deliberately no base class.
   */
  readonly kind:
    'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart';
  /**
   * The media type to send as `Content-Type`, or `undefined` when the body declares none.
   *
   * Absence is `undefined`, never `null`, matching the domain model everywhere else.
   */
  readonly mediaType: string | undefined;
  /**
   * The exact byte count `writeTo` will emit, or -1 when it is not known ahead of the write
   * (BODY-35). A transport stamps this into `Content-Length`, so it must never disagree with the
   * bytes actually written.
   */
  readonly contentLength: number;
  /**
   * Whether writing more than once yields byte-for-byte identical output (BODY-4/BODY-5).
   *
   * Consulted by Phase 5's retry, redirect, and auth steps before re-sending a request; a
   * single-use body must be run through `materialize` first.
   */
  readonly replayable: boolean;
  /**
   * Writes the body once into `sink`, closing it on success and aborting it on failure so a partially
   * written body is never signalled to the transport as a complete one.
   *
   * @param sink - the destination. The body owns closing it -- the caller only supplies it -- and
   * aborts it rather than closing it when the write fails, so a truncated payload is never signalled
   * downstream as a complete one.
   * @throws ConsumedBodyError when a single-use body is written a second time (BODY-3).
   * @throws EndOfStreamError when a stream body's byte count disagrees with its declared
   * `contentLength` (HTTP-39/BODY-10).
   */
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
