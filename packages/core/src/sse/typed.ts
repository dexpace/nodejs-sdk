// SPDX-License-Identifier: MIT
// packages/core/src/sse/typed.ts
import {assertNever} from '../invariant.js';
import {suppress} from '../suppress.js';
import type {SseEvent} from './event.js';
import type {SseStream} from './stream.js';

/**
 * A mapper's three outcomes (SSE-34): yield a decoded value, silently drop the event, or end the stream.
 *
 * **A sibling of Phase 4b's `Outcome<T>`, not a third variant on it.** `Outcome<T>` is a two-branch
 * success/failure union threaded through the recovery chain; widening it with `skip`/`done` would force every
 * existing `fold` call site in `src/recovery/` to handle variants that can never occur there. What
 * `sdk-design-nodejs/07` §7.2 argues for reusing is the *idiom* — a `kind`-discriminated union over frozen
 * literals — and that is exactly what this is.
 *
 * @public
 */
export type MapperOutcome<T> =
  | {readonly kind: 'value'; readonly value: T}
  | {readonly kind: 'skip'}
  | {readonly kind: 'done'};

/**
 * Yield this event's decoded value to the consumer.
 *
 * @public
 */
export function mapperValue<T>(value: T): MapperOutcome<T> {
  return Object.freeze({kind: 'value', value} as const);
}

/**
 * Drop this event and advance. It never surfaces to the consumer — keep-alives and comments live here.
 *
 * @public
 */
export const MAPPER_SKIP: MapperOutcome<never> = Object.freeze({
  kind: 'skip',
} as const);

/**
 * End iteration cleanly and close the stream, yielding no model for the sentinel event itself.
 *
 * @public
 */
export const MAPPER_DONE: MapperOutcome<never> = Object.freeze({
  kind: 'done',
} as const);

/**
 * Decodes a raw event into a caller model (SSE-33).
 *
 * `eventName` is the raw `event` field, `undefined` when the server omitted it — never defaulted to
 * `'message'`. `joinedData` is the event's data lines joined with a single `\n`, or `''` when the event carried
 * no data. The parser deliberately does not join (SSE-8); joining is this layer's job.
 *
 * @public
 */
export type SseMapper<T> = (
  eventName: string | undefined,
  joinedData: string,
) => MapperOutcome<T>;

/**
 * Lazily decode an {@link (SseStream:class)} into caller models (SSE-33–SSE-36).
 *
 * Decoding is per-element: the mapper runs inside the loop body, so a consumer taking one element decodes
 * exactly one event. Skips drain inside the same pull, which is the one exception SSE-39 sanctions to its 1:1
 * polling rule — "only as many as needed to produce one element."
 *
 * A throwing mapper propagates to the consumer's pull, but only after the underlying resource is released, with
 * a release failure attached as suppressed — see `runMapper`, which owns that path.
 *
 * @throws SseStreamError when `stream` has already been iterated or closed — the underlying facade is
 *   single-pass (SSE-26/SSE-27), and this adapter takes its one iterator.
 *
 * @public
 */
export function typedSseStream<T>(
  stream: SseStream,
  mapper: SseMapper<T>,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<T> {
      for await (const event of stream) {
        const outcome = await runMapper(stream, mapper, event);
        switch (outcome.kind) {
          case 'value':
            yield outcome.value;
            break;
          case 'skip':
            break;
          case 'done':
            return;
          default:
            return assertNever(outcome);
        }
      }
    },
  };
}

/**
 * Run the mapper for one event, honoring SSE-36 when it throws: release first, then propagate, with a release
 * failure attached to the mapper's error as suppressed.
 *
 * **This cannot be left to the facade,** which is what an earlier draft assumed. The facade's `catch` only sees
 * failures raised by *its own* pull of the parser. A throw from this loop's body is not that: it unwinds by
 * calling the facade iterator's `return()`, which runs the facade's *quiet* release path — the one SSE-30
 * requires to swallow a close failure. So on that route the close error would be swallowed instead of attached,
 * which is precisely what SSE-36 forbids. Releasing here, through the facade's public `close()`, gets the
 * explicit-close semantics this case needs; the facade's later `return()` then finds the resource already
 * released and does nothing (SSE-28).
 */
async function runMapper<T>(
  stream: SseStream,
  mapper: SseMapper<T>,
  event: SseEvent,
): Promise<MapperOutcome<T>> {
  try {
    return mapper(event.event, event.data.join('\n'));
  } catch (mapperError: unknown) {
    try {
      await stream.close();
    } catch (closeError: unknown) {
      throw suppress(
        mapperError,
        closeError,
        'an SSE mapper failed and releasing the stream also failed',
      );
    }
    throw mapperError;
  }
}
