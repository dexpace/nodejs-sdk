// SPDX-License-Identifier: MIT
// packages/transport-shared/src/body-pump.ts
import type {Body} from '@dexpace/core';

/**
 * A streaming request body in flight: the stream to hand the native client, the producer's own
 * settlement, and the teardown an abandoned send owes it (TRANSPORT-19).
 *
 * @internal
 */
export interface BodyPump {
  /** The bytes `writeTo` produces, ready to hand to the native client. */
  readonly readable: ReadableStream<Uint8Array>;
  /** Settles when the producer finishes; rejects with whatever `writeTo` raised. */
  readonly done: Promise<void>;
  /** Idempotent teardown: aborts the producer and resolves once it has actually unwound. */
  abandon(cause: unknown): Promise<void>;
}

/**
 * The sink handed to `writeTo`, interposed rather than passing the `TransformStream`'s own writable
 * straight through. Closing belongs to whoever created the stream (BODY-8), and the two conventions
 * in this tree disagree: every `@dexpace/core` body closes the sink it was given, while
 * `@dexpace/body-file`'s deliberately does not. Owning `close` here terminates the request body
 * exactly once for both shapes — handing over the raw writable would either double-close (a
 * `TypeError` that surfaces as a failed send) or never close at all (the native client waiting
 * forever on a stream that never ends).
 */
function interposedSink(
  writer: WritableStreamDefaultWriter<Uint8Array>,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: chunk => writer.write(chunk),
    close: () => undefined,
    abort: () => undefined,
  });
}

/**
 * Starts `body`'s producer against a fresh `TransformStream` and returns the read end.
 *
 * The returned `done` is retained, never floating: a `writeTo` rejection must fail the send rather
 * than leave the native client waiting on a stream that never closes.
 *
 * @param body - the body to stream; written exactly once (TRANSPORT-17).
 * @returns the read end, the producer's settlement, and its teardown.
 *
 * @internal
 */
export function pumpBody(body: Body): BodyPump {
  const {readable, writable} = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const done = (async () => {
    try {
      await body.writeTo(interposedSink(writer));
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      throw error;
    }
    await writer.close();
  })();
  return {
    readable,
    done,
    abandon: async (cause: unknown) => {
      // `abort` is idempotent, satisfying TRANSPORT-19's idempotent-teardown clause; awaiting the
      // producer with its rejection swallowed guarantees it has unwound before `send()` returns.
      await writer.abort(cause).catch(() => undefined);
      await done.catch(() => undefined);
    },
  };
}

/**
 * A promise that rejects when `done` rejects and otherwise never settles, for racing a pending
 * dispatch against its own request-body producer.
 *
 * Racing is not the only reason to call this, and on the delivery path it is not even the main one:
 * `Promise.race` attaches a handler to `done` that outlives the race, so a producer that fails
 * *after* the native client already delivered a response is an observed rejection rather than an
 * unhandled one. Without it that late rejection reaches Node's default `unhandledRejection` policy
 * and takes the process down — the exact hazard SEAM-30 names, arriving from the request side.
 *
 * @param done - the producer settlement from {@link pumpBody}, or `undefined` when the body was not
 *   streamed.
 * @returns a promise that rejects with the producer's failure and never resolves.
 *
 * @internal
 */
export function producerFailure(
  done: Promise<void> | undefined,
): Promise<never> {
  if (done === undefined) return new Promise<never>(() => undefined);
  // `then` with no rejection handler: a producer *success* says nothing about the response, so the
  // derived promise only ever carries the failure onward.
  return done.then(() => new Promise<never>(() => undefined));
}

/**
 * Collects `body` into one contiguous buffer, for the small-and-replayable case both transports
 * prefer over a streamed request body.
 *
 * The `Uint8Array<ArrayBuffer>` return type is load-bearing, not decoration: `BodyInit` accepts
 * `ArrayBufferView<ArrayBuffer>` but not the `ArrayBufferLike`-backed default, which may be a
 * `SharedArrayBuffer`. This always allocates a fresh, non-shared buffer, so it says so.
 *
 * @param body - the body to write.
 * @returns every byte the body produced, in order.
 *
 * @internal
 */
export async function materializeBody(
  body: Body,
): Promise<Uint8Array<ArrayBuffer>> {
  // Chunks are retained by reference until the merge below, which relies on the Web Streams
  // convention that a chunk passed to `write()` belongs to the sink. Every `Body` in this tree
  // allocates per chunk (`node:fs` read streams included); a producer that wrote views over one
  // reused scratch buffer would need a copy here instead.
  const chunks: Uint8Array[] = [];
  let total = 0;
  await body.writeTo(
    new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
        total += chunk.byteLength;
      },
    }),
  );
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Whether a body is small enough and replayable enough to materialize rather than stream. Streaming
 * request bodies still carry `duplex: 'half'` corner cases in some `fetch` implementations, so the
 * buffered path is the default wherever it is available.
 *
 * @param body - the body to classify.
 * @param maxBytes - the inclusive upper bound on a materializable body's declared length.
 * @returns `true` when {@link materializeBody} should be used instead of {@link pumpBody}.
 *
 * @internal
 */
export function isMaterializable(body: Body, maxBytes: number): boolean {
  return (
    body.replayable && body.contentLength >= 0 && body.contentLength <= maxBytes
  );
}
