// SPDX-License-Identifier: MIT
// packages/core/src/body/response-body-logging.ts
import {invariant} from '../invariant.js';
import {ByteQueue} from '../io/byte-queue.js';
import {MAX_BYTE_ARRAY_LENGTH} from '../io/limits.js';
import {ConsumedBodyError} from './errors.js';

export interface LoggedResponseBody extends AsyncDisposable {
  /**
   * Returns a stream serving the body. Lazy -- nothing is read from the delegate until the first call
   * (BODY-22). Fits-cap regime: every call, including calls after the first, returns a fresh
   * non-consuming view over the captured bytes (BODY-23). Exceeds-cap regime: exactly one call is
   * allowed; a second throws (BODY-24). If the drain failed, every call re-throws the cached error.
   */
  read(): Promise<ReadableStream<Uint8Array>>;
  /** Non-consuming; reflects whatever has been captured so far, even after a failed drain (BODY-26). */
  snapshot(): Uint8Array;
  /** The cached drain failure, or null. MUST NOT trigger a drain (BODY-26). */
  error(): Error | null;
  /** Captured size iff fully captured within the cap, else the delegate's declared length (BODY-29). */
  readonly contentLength: number;
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
 * Reads until EOF (fits regime) or until the cap is reached (exceeds regime, leaving the delegate open
 * and the overflow chunk staged). BODY-26: a failure is cached, never allowed to truncate silently.
 *
 * BODY-25 note: the requirement's "zero bytes returned for a positive requested count" has no analog
 * here -- `ReadableStreamDefaultReader.read()` takes no count, and a zero-length chunk is a legal
 * no-op, not an EOF signal. EOF is signalled only by `{done: true}`, which is what the loop keys on.
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
      controller.enqueue(value);
    },
    async cancel() {
      await closeDelegate(state);
    },
  });
}

/**
 * Wraps a raw response body stream (BODY-22..29). `@internal` -- unwired until Phase 7 supplies a Logger.
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
      state.started ??= drainOnce(state);
      await state.started; // a cached failure re-throws here on every call (BODY-26)
      if (state.regime === 'fits') return capturedStream(state);
      if (state.tailConsumed) {
        throw new ConsumedBodyError('logged-response');
      }
      state.tailConsumed = true;
      return tailStream(state);
    },
    snapshot: () => state.captured.snapshot(),
    error: () => state.failure, // deliberately does not drain (BODY-26)
    get contentLength(): number {
      // BODY-29: the capture is the true length only when the whole body fit within the cap.
      return state.regime === 'fits' ? state.captured.size : declaredLength;
    },
    close: () => closeDelegate(state),
    [Symbol.asyncDispose]: () => closeDelegate(state),
  };
}
