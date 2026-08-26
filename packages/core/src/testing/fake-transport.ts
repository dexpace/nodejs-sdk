// SPDX-License-Identifier: MIT
// packages/core/src/testing/fake-transport.ts
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';

/**
 * One recorded wire send.
 *
 * @internal
 */
export interface FakeCall {
  readonly request: Request;
  readonly options: RequestOptions | undefined;
  readonly signal: AbortSignal | undefined;
}

/**
 * A scripted `Transport` for multi-attempt tests (`@internal`, never exported from the package
 * barrel).
 *
 * Entries are served in order; once exhausted the LAST entry repeats, so a script of
 * `[error, response]` models "fails once, then succeeds forever" without counting attempts by hand.
 * A `Response` entry is returned; an `Error` entry is thrown.
 *
 * **The repeat serves the same instance, not a fresh one.** An `Error` repeats harmlessly, but a
 * trailing `Response` is a single object whose body a consumer may already have drained or closed --
 * so a script ending in a retryable-status response models "the same, already-retired response
 * arrives again", which is not what a multi-attempt test usually means. Script one entry per
 * expected wire send whenever the repeated entry is a `Response` the code under test consumes.
 *
 * @internal
 */
export class FakeTransport implements Transport {
  readonly #script: readonly (Response | Error)[];
  readonly #calls: FakeCall[] = [];

  constructor(script: readonly (Response | Error)[]) {
    invariant(
      script.length > 0,
      'FakeTransport needs at least one scripted entry',
    );
    this.#script = [...script];
  }

  /** Every send this double has served, in order. */
  get calls(): readonly FakeCall[] {
    return this.#calls;
  }

  /** Wire-send count -- what RETRY-27's budget and RETRY-32's no-further-attempts rule assert on. */
  get sendCount(): number {
    return this.#calls.length;
  }

  /**
   * Records the send and serves the scripted entry at this position.
   *
   * @param request - the request being sent.
   * @param options - the per-call options, recorded verbatim.
   * @param signal - the call's abort signal, recorded verbatim.
   * @returns the scripted `Response`.
   * @throws the scripted `Error` when this position holds one.
   */
  send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    const index = Math.min(this.#calls.length, this.#script.length - 1);
    this.#calls.push({request, options, signal});
    const entry = this.#script[index];
    invariant(entry !== undefined, 'FakeTransport script index out of range');
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(entry);
  }

  /**
   * No-op: the double owns no resources (SEAM-14's ownership rule).
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Builds a `Response` whose close can be OBSERVED.
 *
 * `Response` instances are `Object.freeze`d, so assigning a spy over `response.close` throws
 * `TypeError: Cannot add property close, object is not extensible` under ESM strict mode. The only
 * sanctioned observation point is the body stream itself. Every retry, redirect, and auth test that
 * asserts a body was released uses this helper.
 *
 * `cancelCount()` counts RELEASE, by either of the two routes the engine can take, because the
 * retire path and the abandon path release the same body differently:
 *
 * - abandoned unread -- `Response.close()` cancels the stream, firing `cancel()`;
 * - retired -- `toHttpError()` DRAINS the body into its bounded buffer (HTTP-52), so the stream
 *   reaches EOF and the later `close()` finds nothing to cancel; `pull()` is the only hook that
 *   observes it.
 *
 * The stream MUST close (here, on the first `pull` after its single chunk is read). A
 * `ReadableStream` that enqueues and never closes leaves `toHttpError()`'s drain awaiting a chunk
 * that never arrives, and every engine test that discards a 503 hangs until the runner's timeout.
 *
 * @param status - the status code the response carries.
 * @param request - the originating request; defaults to a bare GET.
 * @returns the response and a counter reporting how many times its body was released.
 *
 * @internal
 */
export function countingResponse(
  status: number,
  request: Request = Request.newBuilder().url('https://example.com').build(),
): {response: Response; cancelCount: () => number} {
  let releases = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1]));
    },
    pull(controller) {
      // Reached only once the single chunk has been read (default highWaterMark 1), i.e. a full drain.
      releases += 1;
      controller.close();
    },
    cancel() {
      releases += 1;
    },
  });
  const response = Response.newBuilder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .body(body)
    .build();
  return {response, cancelCount: () => releases};
}
