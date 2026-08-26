// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/runtime.ts
import {
  createDispatchContext,
  createRequestContext,
  promoteToExchange,
  promoteToRequest,
  type ExecutionContext,
  type RequestContext,
} from '../context/context.js';
import {contextStore} from '../context/store.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {Cursor} from './cursor.js';
import type {StepDescriptor} from './step.js';

/**
 * The request context to promote from once the drive finishes: the original, unless a step substituted the
 * outbound request (PIPE-14), in which case an off-chain rebuild around the request that was actually sent,
 * pinned to the SAME call key (CTX-6's explicit-key path) and carrying the same instrumentation bundle by
 * reference (CTX-2/CTX-3). Promoting straight off the original would pair the response with a request that
 * never left the process, against CTX-1's "the exchange stage exposes the request and the response". Doing it
 * here rather than widening `promoteToExchange` with a request-override keeps promotion strictly additive.
 *
 * Exported (still `@internal`, still absent from the package barrel) so its two branches can be asserted as
 * the pure function they are. The alternative -- observing the exchange context end-to-end -- would require
 * patching `install` on the process-wide `contextStore` singleton, since `send()` evicts the entry in its own
 * `finally`.
 *
 * @internal
 */
export function exchangeSource(
  context: RequestContext,
  finalRequest: Request,
): RequestContext {
  if (finalRequest === context.request) return context;
  return createRequestContext(finalRequest, {
    key: context.key,
    instrumentation: context.instrumentation,
    operationName: context.operationName,
  });
}

/**
 * The built, immutable pipeline (PIPE-10, PIPE-25). Implements `Transport` itself (PIPE-26) -- Phase 2's
 * `Transport` SPI has one method (`send`), so there is no second `sendAsync` entry point to delegate through.
 * `close()` deliberately never touches the wrapped transport (PIPE-27): the pipeline never owns it.
 *
 * @internal
 */
export class Runtime implements Transport {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;

  constructor(steps: readonly StepDescriptor[], transport: Transport) {
    // PIPE-10/PIPE-25: the built runtime is immutable, and `get steps()` hands out a read-only view. Copying
    // and freezing here rather than trusting the caller makes both structural -- `PipelineBuilder` is not the
    // only construction site (tests build one directly, and Phase 5+ may too), so an unfrozen array passed in
    // would leave the "immutable after construction" guarantee resting on caller discipline.
    this.#steps = Object.freeze([...steps]);
    this.#transport = transport;
  }

  /**
   * Drives `request` through the flattened step array and on to the wrapped transport, installing this
   * call's `ExecutionContext` in the store for the duration of the drive and evicting it again on both
   * the resolve and the throw path (CTX-17, CTX-9).
   *
   * A pipeline with no steps skips both the cursor and the context entirely and dispatches straight to
   * the wrapped transport (PIPE-9).
   *
   * @param request - the request to send.
   * @param options - per-call operational overrides, carried unchanged across every re-drive fork and
   *   threaded into each terminal dispatch (PIPE-17).
   * @param signal - the caller's abort signal, threaded to the terminal dispatch. Not observed between
   *   steps in this phase -- see the roadmap's Phase 4c open finding F9.
   * @returns whatever the outermost step returned (PIPE-12).
   */
  async send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    if (this.#steps.length === 0) {
      // PIPE-9: an empty pipeline dispatches directly to the terminal transport, no cursor allocated.
      return this.#transport.send(request, options, signal);
    }
    const dispatchContext = createDispatchContext();
    const requestContext = promoteToRequest(dispatchContext, request);
    contextStore.install(requestContext); // CTX-17's positive half: the first store entry, at the first promotion.
    let currentContext: ExecutionContext = requestContext; // tracks the latest install for the finally below.
    try {
      const cursor = new Cursor({
        steps: this.#steps,
        transport: this.#transport,
        request,
        context: requestContext,
        options,
        signal,
      });
      const response = await cursor.advance();
      // PIPE-14: a step may have substituted the outbound request -- promote from whatever was actually sent.
      const exchangeContext = promoteToExchange(
        exchangeSource(requestContext, cursor.request),
        response,
      );
      contextStore.install(exchangeContext); // install-or-replace under the same key (CTX-8).
      currentContext = exchangeContext;
      return response;
    } finally {
      contextStore.close(currentContext); // always the most recently installed context for this call.
    }
  }

  async close(): Promise<void> {
    // PIPE-27: the pipeline never owns its transport and MUST NOT close it.
  }

  get steps(): readonly StepDescriptor[] {
    return this.#steps; // PIPE-25: "exposes a read-only, ordered view of its steps."
  }
}
