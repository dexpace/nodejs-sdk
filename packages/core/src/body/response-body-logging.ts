// SPDX-License-Identifier: MIT
// packages/core/src/body/response-body-logging.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from '../io/byte-queue.js';
import {
  ClosedResourceError,
  SourceContractViolationError,
} from '../io/errors.js';
import {MAX_BYTE_ARRAY_LENGTH} from '../io/limits.js';
import {ConsumedBodyError} from './errors.js';

/**
 * A lazily-draining, bounded capture wrapper over a raw response body stream (BODY-22..29).
 *
 * Teardown is `close()` only. Revisit when a project-wide explicit resource management pass lands
 * across all Phase 2/3a resource classes.
 *
 * @internal
 */
export interface LoggedResponseBody {
  /**
   * Returns a stream serving the body. Lazy -- nothing is read from the delegate until the first call
   * (BODY-22). Fits-cap regime: every call, including calls after the first, returns a fresh
   * non-consuming view over the captured bytes (BODY-23). Exceeds-cap regime: exactly one call is
   * allowed; a second throws (BODY-24). If the drain failed, every call re-throws the cached error.
   * After `close()` in any regime but fits-cap, throws `ClosedResourceError`: the delegate is gone and
   * the captured prefix is not the whole body (BODY-27, BODY-28).
   */
  read(): Promise<ReadableStream<Uint8Array>>;
  /**
   * Non-consuming; reflects whatever has been captured so far, even after a failed drain (BODY-26) and
   * after `close()` (BODY-28), which it never restarts a drain past.
   */
  snapshot(): Uint8Array;
  /**
   * The cached drain failure, or null. MUST NOT trigger a drain (BODY-26), and reports only a genuine
   * upstream failure -- never one manufactured by reading past `close()`.
   */
  error(): Error | null;
  /** Captured size iff fully captured within the cap, else the delegate's declared length (BODY-29). */
  readonly contentLength: number;
  /**
   * Releases the delegate. Idempotent, and shared with the exceeds-cap tail stream's own completion so
   * the delegate is cancelled at most once however close is reached (BODY-27). The captured bytes
   * survive, so `snapshot()` still works afterwards (BODY-28).
   */
  close(): Promise<void>;
}

/**
 * Mutable state for one wrapper instance. Extracted from the factory closure so the factory stays under
 * the 70-line function cap and each step below is independently testable.
 */
interface DrainState {
  readonly captured: ByteQueue;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly delegate: ReadableStream<Uint8Array>;
  readonly cap: number;
  regime: 'undrained' | 'fits' | 'exceeds';
  tailConsumed: boolean;
  pendingTailChunk: Uint8Array | undefined;
  failure: Error | null;
  closed: boolean;
  started: Promise<void> | undefined;
}

/** BODY-27: one close-once guard shared by the wrapper's close and the tail stream's completion. */
async function closeDelegate(state: DrainState): Promise<void> {
  if (state.closed) return;
  state.closed = true;
  // MUST precede cancel(): cancel() rejects with TypeError on a locked stream, and reading to done does
  // not release the lock (see Response.bytes for the same trap).
  state.reader.releaseLock();
  // BODY-28: on the fits-cap path the capture already succeeded, so a close failure is best-effort and
  // must not surface as a drain error. Narrowed to the one thing cancel() reports here.
  await state.delegate.cancel().catch((error: unknown) => {
    if (!(error instanceof TypeError)) throw error;
  });
}

/**
 * BODY-25: a delegate chunk of zero bytes is a stream-contract violation, not a no-op and never EOF --
 * EOF is signalled only by `{done: true}`. `ReadableStreamDefaultReader.read()` carries no requested
 * count, so the requirement's "for a positive requested count" has no literal analog, but the tolerant
 * reading is the wrong one to pick: `RetentionWindow` raises on the same input under IO-17's identical
 * rule, and a response body reaches both this tee and `BufferedSource`, so a divergence would make one
 * upstream fail or succeed depending only on which wrapper it passed through.
 *
 * Applied on BOTH read paths -- `drainOnce` and the exceeds-cap tail -- because a rule that holds in one
 * regime and not the other makes the same upstream pass or fail depending only on how big the body
 * happened to be.
 */
function assertNonEmptyChunk(value: Uint8Array): void {
  if (value.length === 0) {
    throw new SourceContractViolationError(
      'source delivered 0 bytes without signalling end of stream',
    );
  }
}

/**
 * Reads until EOF (fits regime) or until the cap is reached (exceeds regime, leaving the delegate open
 * and the overflow chunk staged). BODY-26: a failure is cached, never allowed to truncate silently.
 */
async function drainOnce(state: DrainState): Promise<void> {
  try {
    for (;;) {
      // Serial by necessity: each read depends on the previous one advancing the cursor.
      const {done, value} = await state.reader.read();
      if (done) {
        state.regime = 'fits';
        await closeDelegate(state);
        return;
      }
      assertNonEmptyChunk(value);
      if (state.captured.size + value.length <= state.cap) {
        state.captured.writeBytes(value);
        continue;
      }
      const room = state.cap - state.captured.size;
      if (room > 0) state.captured.writeBytes(value.subarray(0, room));
      state.pendingTailChunk = value.subarray(room);
      state.regime = 'exceeds';
      invariant(
        state.captured.size <= state.cap,
        `captured past the ${String(state.cap)}-byte cap`,
      );
      return;
    }
  } catch (error: unknown) {
    // BODY-26: retain what was read and cache the error rather than discarding a partial capture.
    state.failure = error instanceof Error ? error : new Error(String(error));
    throw state.failure;
  }
}

/**
 * BODY-22's once-only, lazily-started drain. Concurrent first accesses share the one in-flight promise.
 *
 * The detached `.catch` matters: a snapshot-triggered drain has no awaiter, so without it a drain failure
 * becomes an unhandled rejection. Attaching a handler to a *copy* leaves the stored promise rejected, so
 * `read()` still re-throws the cached failure on every call (BODY-26).
 *
 * BODY-28: after `close()` there is nothing left to drain -- `closeDelegate` released the reader, so
 * starting one here reads from a detached reader, raises a raw `TypeError: Invalid state`, and
 * `drainOnce`'s catch caches it as this wrapper's `failure`. `error()` would then report a fabricated
 * upstream failure forever, over a capture that never failed, and the captured bytes BODY-28 promises
 * survive close would be reachable only past that lie. A drain already in flight is left alone: on the
 * fits-cap path the drain closes the delegate itself, and its own promise is what `read()` awaits.
 */
function startDrain(state: DrainState): Promise<void> {
  if (state.closed && state.started === undefined) return Promise.resolve();
  state.started ??= drainOnce(state);
  void state.started.catch(() => undefined);
  return state.started;
}

/** A fresh, non-consuming view over the fully-captured bytes. Repeatable (BODY-23). */
function capturedStream(state: DrainState): ReadableStream<Uint8Array> {
  const bytes = state.captured.snapshot();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Replays the captured prefix, then continues from the still-live tail (BODY-24). Pull-driven, one
 * chunk per pull: looping inside start() would eagerly materialize the whole remaining body in the
 * controller's queue -- precisely the oversized payloads the cap exists to keep off the heap.
 */
function tailStream(state: DrainState): ReadableStream<Uint8Array> {
  const prefix = state.captured.snapshot();
  let staged: Uint8Array | undefined = state.pendingTailChunk;
  let prefixSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        if (prefix.length > 0) {
          controller.enqueue(prefix);
          return;
        }
      }
      if (staged !== undefined) {
        const chunk = staged;
        staged = undefined;
        if (chunk.length > 0) {
          controller.enqueue(chunk);
          return;
        }
      }
      const {done, value} = await state.reader.read();
      if (done) {
        await closeDelegate(state);
        controller.close();
        return;
      }
      try {
        assertNonEmptyChunk(value); // BODY-25, same rule as the drain
      } catch (error: unknown) {
        // Cached like any other delegate failure so `error()` still reports it (BODY-26); the throw
        // errors this stream, which is what the consumer of the tail actually observes.
        state.failure =
          error instanceof Error ? error : new Error(String(error));
        throw state.failure;
      }
      controller.enqueue(value);
    },
    async cancel() {
      await closeDelegate(state);
    },
  });
}

/**
 * Wraps a raw response body stream (BODY-22..29).
 *
 * @internal Unwired until Phase 7 supplies a Logger to drive it.
 */
export function withResponseLogging(
  delegate: ReadableStream<Uint8Array>,
  capBytes: number,
  declaredLength = -1,
): LoggedResponseBody {
  invariant(
    capBytes >= 0,
    `capBytes must be non-negative, got ${String(capBytes)}`,
  ); // BODY-32
  const state: DrainState = {
    captured: new ByteQueue(),
    reader: delegate.getReader(),
    delegate,
    cap: Math.min(capBytes, MAX_BYTE_ARRAY_LENGTH), // BODY-32: clamp, do not attempt an impossible allocation
    regime: 'undrained',
    tailConsumed: false,
    pendingTailChunk: undefined,
    failure: null,
    closed: false,
    started: undefined,
  };

  return {
    async read(): Promise<ReadableStream<Uint8Array>> {
      await startDrain(state); // a cached failure re-throws here on every call (BODY-26)
      // Ordered deliberately. `fits` first: on that path the drain closed the delegate itself, and
      // BODY-23 still requires every later read to be a fresh non-consuming view -- "closed" there does
      // not mean "unreadable" (BODY-28).
      if (state.regime === 'fits') return capturedStream(state);
      if (state.tailConsumed) {
        throw new ConsumedBodyError('logged-response');
      }
      // Anything else with the delegate gone: there is no live tail to continue from, and the captured
      // prefix is not the whole body, so serving it would hand the consumer a silently truncated
      // response. IO-42's state error, not the raw `TypeError` a detached reader throws.
      if (state.closed) throw new ClosedResourceError('LoggedResponseBody');
      state.tailConsumed = true;
      return tailStream(state);
    },
    snapshot(): Uint8Array {
      // BODY-22 lists snapshot in the drain's trigger set alongside read. The accessor is synchronous,
      // so it starts the drain and returns what has been captured so far rather than awaiting it; a
      // later read() awaits the very same in-flight promise, so the delegate is still read exactly once.
      // (BODY-26's "snapshot returns the partial bytes without throwing" is why it cannot await here.)
      // After close() `startDrain` is a no-op, so this is the post-mortem accessor BODY-28 asks for.
      void startDrain(state);
      return state.captured.snapshot();
    },
    error: () => state.failure, // deliberately does not drain (BODY-26)
    get contentLength(): number {
      // BODY-29: the capture is the true length only when the whole body fit within the cap.
      return state.regime === 'fits' ? state.captured.size : declaredLength;
    },
    close: () => closeDelegate(state),
  };
}
