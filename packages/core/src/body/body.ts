// SPDX-License-Identifier: MIT
// packages/core/src/body/body.ts

/**
 * The core domain interface for HTTP message bodies.
 *
 * @public
 */
export interface Body {
  readonly kind:
    'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart';
  readonly mediaType: string | undefined;
  readonly contentLength: number;
  readonly replayable: boolean;
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
