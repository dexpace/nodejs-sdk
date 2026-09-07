// SPDX-License-Identifier: MIT
// packages/core/src/body/request-body-logging.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from '../io/byte-queue.js';
import {MAX_BYTE_ARRAY_LENGTH} from '../io/limits.js';
import type {Body} from './body.js';
import {materialize} from './materialize.js';

/**
 * A {@link Body} that also mirrors what it writes into a bounded, readable tap (BODY-17..21).
 *
 * @internal
 */
export interface LoggedBody extends Body {
  /** A copy of the tap's current contents -- at most tapCapBytes of the most recent write (BODY-19). */
  snapshot(): Uint8Array;
  /** Materializes the delegate while preserving the logging wrapper and the tap (BODY-21). */
  materialize(): Promise<LoggedBody>;
}

/**
 * One `writeTo` call's plumbing: the primary sink's writer, this wrapper's tap, and the cap.
 *
 * Extracted from the closure so the adapter-stream construction can live in its own function without
 * tripping `max-params`, mirroring `response-body-logging.ts`'s `DrainState`.
 */
interface TapState {
  readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly tap: ByteQueue;
  readonly cap: number;
  /** Whether the delegate has already ended the adapter, by closing or aborting it. */
  settled: boolean;
}

/**
 * The adapter stream handed to the delegate: mirrors up to `cap` bytes of each chunk, then forwards the
 * chunk whole (BODY-17, BODY-19).
 *
 * The `abort` handler is load-bearing, not symmetry for its own sake. A `Body.writeTo` aborts its sink
 * on failure so the transport learns the message is broken (see `write-body.ts`); without an `abort`
 * algorithm here the adapter's default is a no-op, so the abort STOPS AT THE DECORATOR -- the real sink
 * is left open, still locked, and a truncated body can be committed downstream as a complete one.
 */
function tappedSink(state: TapState): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: async chunk => {
      if (state.tap.size < state.cap) {
        const room = state.cap - state.tap.size;
        // BODY-20/IO-27: mirror BEFORE forwarding, so a failing primary write still captures
        // the chunk that failed.
        state.tap.writeBytes(
          room >= chunk.length ? chunk : chunk.subarray(0, room),
        );
      }
      await state.writer.write(chunk); // BODY-19: the full payload always reaches the primary
      invariant(
        state.tap.size <= state.cap,
        `tap grew past its ${String(state.cap)}-byte cap`,
      );
    },
    close: async () => {
      state.settled = true;
      await state.writer.close();
    },
    abort: async (reason: unknown) => {
      state.settled = true;
      await state.writer.abort(reason);
    },
  });
}

/**
 * Mirrors up to tapCapBytes of each writeTo call into an internal tap while forwarding the full,
 * untruncated payload to the primary sink (BODY-17). The tap clears at the start of every write so a
 * retry against a replayable delegate does not accumulate stale bytes (BODY-18). No handle onto the tap's
 * buffer escapes: `snapshot()` returns a fresh, independent copy of the current contents (BODY-19,
 * `../io/byte-queue.ts:96`), so a caller holding one cannot observe or disturb a later write. Each
 * `materialize()` wraps its own `ByteQueue` for the same reason (BODY-21).
 *
 * @internal Consumed by the LOGGING pillar step (OBS-36).
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
    return Object.freeze({
      kind: inner.kind,
      mediaType: inner.mediaType,
      contentLength: inner.contentLength,
      get replayable() {
        return inner.replayable;
      },
      async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
        tap.clear(); // BODY-18
        const state: TapState = {
          writer: sink.getWriter(),
          tap,
          cap,
          settled: false,
        };
        try {
          await inner.writeTo(tappedSink(state));
        } catch (error: unknown) {
          // A delegate that refuses before it ever touches the adapter -- ConsumedBodyError on a
          // second write of a single-use body -- reaches neither handler in `tappedSink`, so the
          // primary writer would stay locked and open forever. Best-effort, and never allowed to
          // displace the primary failure (RECOV-12).
          if (!state.settled) {
            await state.writer.abort(error).catch(() => undefined);
          }
          throw error;
        }
        // `Body.writeTo`'s contract is that the body closes the sink it was given. This wrapper is
        // the one place that takes a writer on behalf of someone else's `Body`, so a delegate that
        // resolves without closing would strand the caller's sink open and locked with nothing
        // thrown to notice it by. Honouring the contract on the delegate's behalf is the repair.
        if (!state.settled) await state.writer.close();
      },
      snapshot(): Uint8Array {
        return tap.snapshot();
      },
      materialize: async () => wrap(await materialize(inner)),
    });
  }

  return wrap(delegate);
}
