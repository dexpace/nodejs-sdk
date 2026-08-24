// SPDX-License-Identifier: MIT
// packages/core/src/body/request-body-logging.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from '../io/byte-queue.js';
import {MAX_BYTE_ARRAY_LENGTH} from '../io/limits.js';
import type {Body} from './body.js';
import {materialize} from './materialize.js';

export interface LoggedBody extends Body {
  /** A copy of the tap's current contents -- at most tapCapBytes of the most recent write (BODY-19). */
  snapshot(): Uint8Array;
  /** Materializes the delegate while preserving the logging wrapper and the tap (BODY-21). */
  materialize(): Promise<LoggedBody>;
}

/**
 * Mirrors up to tapCapBytes of each writeTo call into an internal tap while forwarding the full,
 * untruncated payload to the primary sink (BODY-17). The tap clears at the start of every write so a
 * retry against a replayable delegate does not accumulate stale bytes (BODY-18). No handle onto the tap's
 * backing buffer is exposed -- snapshot() is the only way to read it (BODY-37). `@internal` -- unwired
 * until Phase 7 supplies a Logger to drive it.
 */
export function withRequestLogging(
  delegate: Body,
  tapCapBytes: number,
): LoggedBody {
  // BODY-32: reject a negative cap, clamp to the platform's max single-array size. Without the guard a
  // negative cap makes `tap.size < cap` permanently false and the tee silently mirrors nothing.
  invariant(
    tapCapBytes >= 0,
    `tapCapBytes must be non-negative, got ${String(tapCapBytes)}`,
  );
  const cap = Math.min(tapCapBytes, MAX_BYTE_ARRAY_LENGTH);

  function wrap(inner: Body): LoggedBody {
    // Per-wrapper, never hoisted to the factory scope. BODY-21 asks materialize() to preserve the tap
    // *cap*, not to share the buffer: two live wrappers over one ByteQueue means BODY-18's clear-on-write
    // in the materialized wrapper silently rewrites the preview the pre-materialization wrapper is still
    // holding -- which is precisely what a Phase 7 retry loop does between attempts.
    const tap = new ByteQueue();
    return {
      kind: inner.kind,
      mediaType: inner.mediaType,
      contentLength: inner.contentLength,
      get replayable() {
        return inner.replayable;
      },
      async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
        tap.clear(); // BODY-18
        const writer = sink.getWriter();
        const tapped = new WritableStream<Uint8Array>({
          write: async chunk => {
            if (tap.size < cap) {
              const room = cap - tap.size;
              // BODY-20/IO-27: mirror BEFORE forwarding, so a failing primary write still captures
              // the chunk that failed.
              tap.writeBytes(
                room >= chunk.length ? chunk : chunk.subarray(0, room),
              );
            }
            await writer.write(chunk); // BODY-19: the full payload always reaches the primary
            invariant(
              tap.size <= cap,
              `tap grew past its ${String(cap)}-byte cap`,
            );
          },
          close: async () => {
            await writer.close();
          },
        });
        await inner.writeTo(tapped);
      },
      snapshot(): Uint8Array {
        return tap.snapshot();
      },
      materialize: async () => wrap(await materialize(inner)),
    };
  }

  return wrap(delegate);
}
