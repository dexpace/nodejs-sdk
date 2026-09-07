// SPDX-License-Identifier: MIT
// packages/core/src/io/sink.ts
import type {ByteQueue} from './byte-queue.js';

/**
 * The write surface of §5 — what `BufferedSink` and `TeeSink` both are.
 *
 * This interface exists because `TeeSink` is a `BufferedSink` DECORATOR, and TypeScript has no structural
 * escape hatch for that: `BufferedSink` carries `#private` fields, which make it a nominal type, so a
 * decorator can never be assignable to it no matter how faithfully it mirrors the API. Without a shared
 * interface `writeAll` — the only pump in the package — cannot accept a tee, and tees cannot nest, which
 * defeats the body-capture use case IO-25 exists for and silently invites callers to bypass the tap by
 * reaching for the primary's bridge instead.
 *
 * `flush`/`emit` return `Promise<Sink>` rather than `this` because IO-18 only asks that they be chainable;
 * each implementation narrows the return to its own type.
 *
 * @internal
 */
export interface Sink {
  /** Whether the sink has been closed or aborted (IO-42). */
  readonly closed: boolean;

  /** Remove exactly `count` bytes from `src`'s head and push them downstream (IO-4). */
  write(src: ByteQueue, count: number): Promise<void>;

  /** Encode and write UTF-8 text (IO-13). */
  writeUtf8(text: string): Promise<void>;

  /** Encode and write text with an explicit charset (IO-13). */
  writeString(text: string, charset: string): Promise<void>;

  /** IO-18: force buffered bytes all the way out toward the destination. */
  flush(): Promise<Sink>;

  /** IO-18: a cheap one-level handoff. */
  emit(): Promise<Sink>;

  /** IO-5, IO-41: closeable and idempotent. */
  close(): Promise<void>;

  /** Discard the destination with a reason rather than committing what was written (IO-42). */
  abort(reason?: unknown): Promise<void>;

  /** A writable host-native byte-stream bridge (IO-16). */
  toWritableStream(): WritableStream<Uint8Array>;
}
