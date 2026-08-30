// SPDX-License-Identifier: MIT
// packages/core/src/sse/stream.ts
import type {Response} from '../http/response.js';
import {BufferedSource} from '../io/buffered-source.js';
import {IoError} from '../io/errors.js';
import {suppress} from '../suppress.js';
import type {SseEvent} from './event.js';
import {SseStreamError} from './errors.js';
import {SSE_END} from './line-reader.js';
import {SseParser} from './parser.js';

/**
 * Anything the facade can own and release exactly once.
 *
 * @internal
 */
export interface SseResource {
  close(): Promise<void>;
}

/**
 * Options for configuring an {@link (SseStream:class)}.
 *
 * @public
 */
export interface SseStreamOptions {
  /**
   * Called when a release fails on a clean automatic terminal path, where SSE-30 requires the failure to be
   * reported out-of-band and swallowed rather than thrown (throwing would discard events already delivered).
   *
   * Defaults to a no-op. Phase 7 wires a real `Logger` in here without reshaping this class — the same
   * "mechanism now, wiring later" split Phase 3b used for its logging tees.
   */
  readonly onReleaseFailure?: ((error: unknown) => void) | undefined;
}

/**
 * Options for opening an SSE stream from a Response.
 *
 * @public
 */
export interface SseStreamFromOptions extends SseStreamOptions {
  /** Opt-in line cap (SSE-19). Off by default, matching the reference's own absence of a cap. */
  readonly maxLineBytes?: number | undefined;

  /**
   * Cancellation for this long-running operation
   * (`docs/knowledge/harvested/concurrency-and-async.md:18`, `docs/knowledge/harvested/api-design.md:34`).
   *
   * Aborting closes the stream, which is the only cancellation a pull-based reader needs: an iterator sitting
   * *between* pulls then ends cleanly (SSE-27) and one blocked *in* a read surfaces an `IoError` (SSE-31).
   * Both paths release the owned resource exactly once, so this adds a trigger rather than a code path.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * A single-pass, resource-owning view over a parsed SSE byte stream (SSE-23–SSE-32).
 *
 * Owns exactly one closeable resource and releases it exactly once across every termination path: clean
 * end-of-stream, explicit `close()`, early `break`, a mid-stream read failure, or a typed mapper's Done.
 *
 * @public
 */
export class SseStream implements AsyncIterable<SseEvent> {
  readonly #parser: SseParser;
  readonly #resource: SseResource;
  readonly #onReleaseFailure: (error: unknown) => void;
  #iteratorTaken = false;
  #closed = false;
  #closing: Promise<void> | undefined;

  /** @internal */
  constructor(
    parser: SseParser,
    resource: SseResource,
    options?: SseStreamOptions,
  ) {
    this.#parser = parser;
    this.#resource = resource;
    this.#onReleaseFailure = options?.onReleaseFailure ?? (() => undefined);
  }

  /**
   * The stream's one iterator (SSE-26).
   *
   * @throws SseStreamError when an iterator was already taken, or when the stream is already closed — both are
   *   caller-contract violations, not stream conditions, so neither is recoverable by retrying.
   * @throws IoError from a pull, when the source fails mid-stream or is torn down under an in-flight read
   *   (SSE-29 / SSE-31). The resource is released before either reaches the consumer.
   */
  [Symbol.asyncIterator](): AsyncIterator<SseEvent> {
    if (this.#closed) {
      throw new SseStreamError(
        'cannot iterate an SSE stream that has already been closed',
      );
    }
    if (this.#iteratorTaken) {
      throw new SseStreamError(
        'an SSE stream is single-pass; its iterator may be obtained at most once',
      );
    }
    this.#iteratorTaken = true;
    return this.#iterate();
  }

  /**
   * Release the owned resource. Idempotent (SSE-28): only the first call reaches the resource, and that holds
   * even after an automatic release on a terminal or failure path.
   *
   * A release failure here **propagates** — the caller asked for the close, so the caller hears about it. That
   * is the opposite of the automatic path, and the split is SSE-30's actual portable contract.
   *
   * @throws IoError when releasing the owned resource fails. Nothing is left to retry: the release is marked
   *   done either way, so a second `close()` is a no-op rather than a second attempt.
   */
  async close(): Promise<void> {
    this.#closed = true;
    this.#closing ??= this.#resource.close();
    return this.#closing;
  }

  async *#iterate(): AsyncGenerator<SseEvent> {
    try {
      for (;;) {
        // A close observed between pulls ends iteration cleanly, without reading from a torn-down resource.
        if (this.#closed) return;
        const event = await this.#pullNext();
        if (event === SSE_END) return;
        yield event;
      }
    } catch (e: unknown) {
      // SSE-29: release BEFORE the error propagates, and attach a release failure as suppressed rather than
      // letting it mask the real cause.
      await this.#releaseWithInFlightError(e);
    } finally {
      // Covers clean end-of-stream and early `break` (the runtime calls `.return()`, which runs this block).
      await this.#releaseQuietly();
    }
  }

  async #pullNext(): Promise<SseEvent | typeof SSE_END> {
    try {
      return await this.#parser.next();
    } catch (e: unknown) {
      // SSE-31: a close that tears the source down while this read was in flight surfaces here. Web
      // Streams rejects a pending read with a bare TypeError when its reader's lock is released; map it so
      // callers see one failure shape rather than a platform-specific type.
      if (this.#closed && !(e instanceof IoError)) {
        throw new IoError(
          'the SSE source was closed while a read was in flight',
          {cause: e},
        );
      }
      throw e;
    }
  }

  /** SSE-30's automatic clean-terminal path: a failing release is reported out-of-band and swallowed. */
  async #releaseQuietly(): Promise<void> {
    this.#closed = true;
    if (this.#closing !== undefined) {
      try {
        await this.#closing;
      } catch (e: unknown) {
        this.#onReleaseFailure(e);
      }
      return;
    }
    const releasePromise = this.#resource.close();
    this.#closing = releasePromise;
    try {
      await releasePromise;
    } catch (e: unknown) {
      this.#onReleaseFailure(e);
    }
  }

  /** SSE-29 / SSE-36: an error is already in flight, so it stays primary and the close error is suppressed. */
  async #releaseWithInFlightError(primary: unknown): Promise<never> {
    this.#closed = true;
    const releasePromise = (this.#closing ??= this.#resource.close());
    try {
      await releasePromise;
    } catch (closeError: unknown) {
      throw suppress(
        primary,
        closeError,
        'the SSE stream failed and its release also failed',
      );
    }
    throw primary;
  }
}

// Scoped teardown for `await using` (styleguide 13.1/13.2), installed at run time only when the symbol
// exists. This is the original of the shape `Page` and both transport adapters now repeat.
//
// DO NOT restore this as a plain `[Symbol.asyncDispose]()` class member. Node 20.3 is this package's
// declared floor (`engines.node`, checked by verify:runtime-floor) and predates the symbol, which
// arrived in 20.4. On the floor the computed key evaluates to `undefined` and binds the method to the
// string key `"undefined"` — a junk prototype entry, and no working disposal. TypeScript does not
// polyfill the well-known symbol either, so declaring it on the class would emit it into the `.d.ts`
// unconditionally and break consumers compiling on ES2023 without esnext.disposable.
//
// `Response` (HTTP-38) goes one step further and ships no disposal member at all — `close()` is its
// whole teardown surface, and `http/response.test.ts` pins the junk key's absence there.
if (typeof Symbol.asyncDispose === 'symbol') {
  Object.defineProperty(SseStream.prototype, Symbol.asyncDispose, {
    value: function asyncDispose(this: SseStream): Promise<void> {
      return this.close();
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Open an SSE stream over an HTTP response, binding the stream's lifecycle to the response (SSE-32).
 *
 * Closing the stream closes the response. A response with no body fails loudly rather than yielding an empty
 * stream: a bodyless SSE response is a server or caller mistake, and silently producing zero events would hide
 * it behind a successful-looking loop that does nothing.
 *
 * @throws SseStreamError when the response has no body (SSE-32).
 *
 * @public
 */
export function sseStreamFrom(
  response: Response,
  options?: SseStreamFromOptions,
): SseStream {
  const body = response.body;
  if (body === null) {
    throw new SseStreamError(
      'cannot open an SSE stream over a response with no body',
    );
  }
  const source = BufferedSource.overStream(body);
  const parser = new SseParser(source, {maxLineBytes: options?.maxLineBytes});
  const unbind = {fn: (): void => undefined};
  const resource: SseResource = {
    async close(): Promise<void> {
      unbind.fn();
      await closingBoth(source, response).close();
    },
  };
  const stream = new SseStream(parser, resource, options);
  unbind.fn = bindAbort(stream, options?.signal, options?.onReleaseFailure);
  return stream;
}

/**
 * Make an abort close the stream.
 *
 * This lives here rather than in `SseStream`'s constructor because a constructor may only assign its arguments
 * to fields — no branching, no listener registration (`docs/knowledge/harvested/data-modeling.md:24`). The listener is
 * registered with `{once: true}` and removed upon close, and the close promise is explicitly
 * discarded with `void` plus a `.catch`, because an unhandled rejection on this path would take the process
 * down under Node's default `unhandledRejection` policy
 * (`docs/knowledge/harvested/cancellation-and-timeouts.md:26`).
 */
function bindAbort(
  stream: SseStream,
  signal: AbortSignal | undefined,
  onReleaseFailure?: (error: unknown) => void,
): () => void {
  if (signal === undefined) return () => undefined;

  const release = (): void => {
    void stream.close().catch((error: unknown) => {
      onReleaseFailure?.(error);
    });
  };

  if (signal.aborted) {
    release();
    return () => undefined;
  }
  signal.addEventListener('abort', release, {once: true});
  return () => {
    signal.removeEventListener('abort', release);
  };
}

/**
 * Bundle the two things this function acquired into the **one** resource SSE-23 says the facade owns.
 *
 * Passing the bare `response` here would leak the `BufferedSource` — and worse than leak it: the source holds a
 * reader lock on `response.body`, and cancelling a `ReadableStream` that still has a locked reader throws
 * `TypeError`, so `response.close()` would fail on a real `Response` while passing happily against a
 * close-counting test double. Release order is reverse acquisition (source first, then response), per
 * `styleguide/typescript/13` §13.5.
 *
 * Both closes always run — one failing must not skip the other — and if both fail the first stays primary with
 * the second attached as suppressed, matching every other release path in Phase 6.
 */
function closingBoth(source: BufferedSource, response: Response): SseResource {
  return {
    async close(): Promise<void> {
      let sourceFailure: unknown;
      let sourceFailed = false;
      try {
        await source.close();
      } catch (e: unknown) {
        sourceFailure = e;
        sourceFailed = true;
      }
      try {
        await response.close();
      } catch (responseFailure: unknown) {
        if (sourceFailed) {
          throw suppress(
            sourceFailure,
            responseFailure,
            'releasing the SSE source failed and releasing the response also failed',
          );
        }
        throw responseFailure;
      }
      if (sourceFailed) throw sourceFailure;
    },
  };
}
