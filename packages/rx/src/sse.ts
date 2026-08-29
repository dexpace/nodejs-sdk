// SPDX-License-Identifier: MIT
// packages/rx/src/sse.ts
import type {Observable} from 'rxjs';
import {
  typedSseStream,
  type SseEvent,
  type SseMapper,
  type SseStream,
} from '@dexpace/core';
import {fromAsyncIterable} from './from-async-iterable.js';

/**
 * Bridges an {@link @dexpace/core#SseStream} to an RxJS `Observable` (SSE-41, ASYNC-21).
 *
 * Single-subscription: `SseStream` wraps an already-open, single-use HTTP response body (BODY-14) and is itself
 * single-pass (SSE-26) -- obtaining an iterator succeeds at most once and a second attempt fails loudly.
 * Subscribing to the returned `Observable` a second time reaches `SseStream`'s own guard and surfaces an error
 * through the `Observable`'s error channel.
 *
 * Unsubscribing closes the stream, releasing the response body even when no event is in flight (ASYNC-6).
 *
 * Diagnostic context propagates on its own (ASYNC-8–ASYNC-11): every pull runs inside the continuation chain
 * that called `subscribe()`, which is exactly what Node's `AsyncLocalStorage` tracks. That holds only for the
 * `Observable` returned here -- a caller who pipes it through an RxJS scheduler operator (`observeOn`,
 * `subscribeOn`) hands each emission to a task outside that chain, and owns reinstating the context on the far
 * side. This package installs no scheduler of its own, precisely so that boundary is never introduced behind
 * the caller's back.
 *
 * @param stream - The `SseStream` instance to observe.
 * @returns An `Observable` emitting parsed {@link @dexpace/core#SseEvent}s.
 *
 * @public
 */
export function sseEvents$(stream: SseStream): Observable<SseEvent> {
  return fromAsyncIterable(stream, () => stream.close());
}

/**
 * Bridges an {@link @dexpace/core#SseStream} to a typed RxJS `Observable` via an {@link @dexpace/core#SseMapper} (SSE-41, ASYNC-21, SSE-33–SSE-36).
 *
 * Shares every note on {@link sseEvents$}: single-subscription, release-on-unsubscribe, and automatic
 * diagnostic-context propagation through the unscheduled path.
 *
 * A throwing mapper reaches the `Observable`'s error channel unwrapped (ASYNC-13), after `typedSseStream` has
 * released the stream (SSE-36).
 *
 * @param stream - The `SseStream` instance to observe.
 * @param mapper - The mapper decoding raw SSE events into domain items, skips, or done sentinels.
 * @returns An `Observable` emitting decoded items of type `T`.
 *
 * @public
 */
export function typedSse$<T>(
  stream: SseStream,
  mapper: SseMapper<T>,
): Observable<T> {
  return fromAsyncIterable(typedSseStream(stream, mapper), () =>
    stream.close(),
  );
}
