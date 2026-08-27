// SPDX-License-Identifier: MIT
// packages/core/src/sse/line-reader.ts
import {DexpaceError} from '../http/errors.js';
import type {BufferedSource} from '../io/buffered-source.js';
import {invariant} from '../invariant.js';

/** End-of-stream sentinel. A symbol, not `undefined`, so an empty line (`''`) is never mistaken for the end. @internal */
export const SSE_END: unique symbol = Symbol('sse-end-of-stream');

/**
 * Raised only when a caller opted into `maxLineBytes` and a line exceeded it (SSE-19).
 *
 * `DexpaceError`'s constructor already sets `name` from `new.target`, so no subclass restates it.
 *
 * @public
 */
export class SseLineTooLongError extends DexpaceError {
  /** The configured cap, as a field so a log aggregator indexes it without parsing the message. */
  readonly limitBytes: number;

  constructor(limitBytes: number, options?: ErrorOptions) {
    super(
      `SSE line exceeded the configured maximum of ${String(limitBytes)} bytes`,
      options,
    );
    this.limitBytes = limitBytes;
  }
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * Splits a byte stream into SSE lines (SSE-2).
 *
 * **Why this is not `BufferedSource.readUtf8Line()`.** Phase 3a's primitive treats `\n` and `\r\n` as
 * terminators but keeps a lone `\r` as line *content* (`IO-14`). SSE-2 requires the opposite: a lone CR
 * terminates a line by itself. Both contracts are normative for their own subsystem, so SSE frames its own
 * lines rather than reshaping a frozen Phase 3a surface for one consumer.
 *
 * The awkward case is CR at a chunk boundary: a `\r` ending one read whose `\n` begins the next must resolve to
 * a single terminator. That is why a pending CR is held in `#pendingCr` until the following byte — or EOF — is
 * known, rather than being decided as soon as it is seen.
 *
 * Does **not** own or close `source` (SSE-17). Lifecycle belongs to the facade.
 *
 * @internal
 */
export class SseLineReader {
  readonly #source: BufferedSource;
  readonly #maxLineBytes: number | undefined;
  readonly #decoder = new TextDecoder('utf-8', {ignoreBOM: true});
  #bomChecked = false;
  #pendingCr = false;
  #ended = false;

  constructor(source: BufferedSource, maxLineBytes?: number) {
    invariant(
      maxLineBytes === undefined ||
        (Number.isSafeInteger(maxLineBytes) && maxLineBytes > 0),
      `maxLineBytes must be a positive safe integer when set, got ${String(maxLineBytes)}`,
    );
    this.#source = source;
    this.#maxLineBytes = maxLineBytes;
  }

  async nextLine(): Promise<string | typeof SSE_END> {
    // The end sentinel is stable at this layer too, and the guard has to be here rather than only in the
    // parser: without it the EOF branch below falls through to `decode([])` on every later call and returns
    // `''` forever, which is an infinite supply of blank lines — and a blank line is SSE's dispatch boundary.
    if (this.#ended) return SSE_END;

    if (!this.#bomChecked) {
      await this.#consumeLeadingBom();
      this.#bomChecked = true;
    }

    const bytes: number[] = [];

    for (;;) {
      // End of stream is detected BEFORE the read, never from its result: 3a's `readByte()` returns
      // `Promise<number>` and *rejects* with `EndOfStreamError` when nothing remains (`IO-11`) — it has no
      // `undefined` result to test. `exhausted()` is the sanctioned probe, and it is allowed to block waiting
      // on the upstream source, which is exactly SSE-39's backpressure point.
      if (await this.#source.exhausted()) {
        // A held CR already terminated its own line on the previous call, so it contributes nothing here —
        // in particular a stream ending `\r\n` must not emit a trailing empty line for the swallowed LF.
        this.#pendingCr = false;
        this.#ended = true;
        // SSE-14: a final line with no terminator is returned as content; an empty tail is simply the end.
        return bytes.length === 0 ? SSE_END : this.#decode(bytes);
      }

      const byte = await this.#source.readByte();

      if (this.#pendingCr) {
        this.#pendingCr = false;
        // The CR already terminated the previous line. An LF immediately after it is the second half of a
        // CRLF and is swallowed; anything else begins this line.
        if (byte === LF) continue;
      }

      if (byte === LF) return this.#decode(bytes);

      if (byte === CR) {
        this.#pendingCr = true;
        return this.#decode(bytes);
      }

      bytes.push(byte);
      if (
        this.#maxLineBytes !== undefined &&
        bytes.length > this.#maxLineBytes
      ) {
        this.#ended = true;
        throw new SseLineTooLongError(this.#maxLineBytes);
      }
    }
  }

  /**
   * Consume one leading UTF-8 BOM if present, leaving a non-BOM prefix untouched (SSE-12).
   *
   * Uses `peek()` — a non-consuming view over the same source (`IO-19`) — so the three bytes are only actually
   * consumed once they are confirmed to be `EF BB BF`.
   *
   * Two 3a contracts shape this: `readByte()` *rejects* at end of stream rather than returning a sentinel, so a
   * short stream must be probed with `exhausted()` first; and `readBytes()` takes no count (it drains
   * everything), so the fixed three-byte consume is `readExactly(3)`. The view is closed on the way out —
   * closing a derived view neither closes the parent nor advances its cursor (`IO-22`).
   */
  async #consumeLeadingBom(): Promise<void> {
    const view = this.#source.peek();
    try {
      if (await view.exhausted()) return;
      if ((await view.readByte()) !== 0xef) return;
      if (await view.exhausted()) return;
      if ((await view.readByte()) !== 0xbb) return;
      if (await view.exhausted()) return;
      if ((await view.readByte()) !== 0xbf) return;
    } finally {
      await view.close();
    }
    await this.#source.readExactly(3);
  }

  #decode(bytes: readonly number[]): string {
    return this.#decoder.decode(new Uint8Array(bytes));
  }
}
