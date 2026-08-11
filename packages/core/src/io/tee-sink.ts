// SPDX-License-Identifier: MIT
// packages/core/src/io/tee-sink.ts
import {invariant} from '../invariant.js';
import {encodeText, type BufferedSink} from './buffered-sink.js';
import {ByteQueue} from './byte-queue.js';
import {ClosedResourceError, IoError} from './errors.js';

/**
 * A sink that mirrors written bytes into a bounded in-memory tap while forwarding the full, untruncated
 * payload to its primary (IO-25–IO-29).
 *
 * Built as a plain `BufferedSink` decorator rather than on `TransformStream`, which `sdk-design/03` §3.1
 * sketches: a `TransformStream`'s own queueing and backpressure semantics muddy IO-27's
 * mirror-before-forward ordering, the clause most easily gotten wrong. §3.1's substantive point — that
 * the platform's `ReadableStream.tee()` solves a different problem (duplicating a *readable* for two
 * consumers, not mirroring a *sink's* writes) — is why no platform primitive is used at all.
 *
 * The tap has no cap by default. §5 bounds nothing; BODY-19 and BODY-34 set the real cap in Phase 3b.
 *
 * @internal
 */
export class TeeSink {
  readonly #primary: BufferedSink;
  readonly #tap = new ByteQueue();
  readonly #tapLimit: number;

  constructor(
    primary: BufferedSink,
    tapLimit: number = Number.POSITIVE_INFINITY,
  ) {
    invariant(
      tapLimit >= 0,
      `tapLimit must be non-negative, got ${String(tapLimit)}`,
    );
    this.#primary = primary;
    this.#tapLimit = tapLimit;
  }

  /**
   * IO-28: a raw buffer write would reach only the tap or only the primary and silently corrupt the wire
   * body, so no such handle exists.
   */
  get buffer(): never {
    throw new IoError(
      'TeeSink exposes no backing buffer; use the typed write methods',
    );
  }

  /** Mirror into the tap, then forward the full payload to the primary (IO-25, IO-27). */
  async write(src: ByteQueue, count: number): Promise<void> {
    // IO-42: reject before consuming from `src` or touching the tap, so a caller that catches the
    // rejection still holds its bytes — matching BufferedSink, which rejects before takeBytes.
    if (this.#primary.closed) throw new ClosedResourceError('TeeSink');
    const staging = new ByteQueue();
    staging.write(src, count);
    // IO-27: mirror BEFORE forwarding, so a failed primary write still captures the attempted bytes.
    this.#mirror(staging);
    // IO-27: staging is drained by the forward, so a later write cannot prepend stale bytes; the
    // `finally` guarantees that holds even when the primary throws.
    try {
      await this.#primary.write(staging, count);
    } finally {
      staging.clear();
    }
  }

  /** Mirror and forward UTF-8 text (IO-25). */
  async writeUtf8(text: string): Promise<void> {
    return this.writeString(text, 'utf-8');
  }

  /**
   * Mirror and forward text with an explicit charset (IO-25).
   *
   * Encodes once, through the sink's own `encodeText`, then routes the bytes down the normal `write`
   * path. That guarantees the tap mirrors exactly the bytes the primary emits — not a UTF-8 re-encoding
   * of them — and that an unsupported charset is refused identically on both sides.
   */
  async writeString(text: string, charset: string): Promise<void> {
    const encoded = new ByteQueue();
    encoded.writeBytes(encodeText(text, charset));
    return this.write(encoded, encoded.size);
  }

  /** A non-consuming copy of the tap's contents. */
  snapshot(): Uint8Array {
    return this.#tap.snapshot();
  }

  /** IO-29: forwards to the PRIMARY only, leaving the tap intact. */
  async flush(): Promise<TeeSink> {
    await this.#primary.flush();
    return this;
  }

  /** IO-29: forwards to the PRIMARY only, leaving the tap intact. */
  async emit(): Promise<TeeSink> {
    await this.#primary.emit();
    return this;
  }

  /** IO-29: forwards to the PRIMARY only; the tap survives for later snapshotting. */
  async close(): Promise<void> {
    await this.#primary.close();
  }

  /** IO-26: copy until the cap is reached, then stop copying while the payload still forwards. */
  #mirror(staging: ByteQueue): void {
    const room = this.#tapLimit - this.#tap.size;
    if (room <= 0) return;
    staging.copyTo(this.#tap, 0, Math.min(room, staging.size));
  }
}
