// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/runtime.ts
import {
  createDispatchContext,
  createRequestContext,
  promoteToExchange,
  promoteToRequest,
  type ContextInit,
  type ExecutionContext,
  type RequestContext,
} from '../context/context.js';
import {contextStore} from '../context/store.js';
import {
  captureDiagnosticSnapshot,
  runWithSnapshot,
} from '../observability/diagnostic-context.js';
import {
  getActiveSpan,
  NOOP_TRACER,
  runWithActiveSpan,
  type Span,
  type Tracer,
} from '../observability/tracing.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {Cursor} from './cursor.js';
import type {StepDescriptor} from './step.js';

/**
 * What a built pipeline carries into every drive. `createDispatchContext` takes the `instrumentation`
 * and `key` halves -- `operationName` is not a dispatch-stage concept (CTX-16 introduces it at the
 * request stage) -- and `send()` hands the name to `promoteToRequest` itself, one promotion later.
 */
type RuntimeContextInit = ContextInit;

/** The advisory span name, matching what the LOGGING pillar step uses for its per-attempt spans. */
const OPERATION_SPAN_NAME = 'http.client.operation';

/**
 * Opens the one span that corresponds 1:1 to a logical operation (OBS-29), or returns `undefined`
 * when there is nothing to open.
 *
 * **Why here and not in the LOGGING pillar step.** `PIPE-2` fixes that step *inside* the `RETRY` and
 * `REDIRECT` pipelines, so its span is opened per transmission attempt and per redirect hop — the
 * right scope for an attempt, the wrong one for an operation. `OBS-29` asks for "one tracer instance
 * per logical operation", and `send()` is the only place in this package that runs exactly once per
 * one. The two spans are complementary rather than duplicative: this is the parent, the LOGGING
 * step's are the children.
 *
 * **Nesting is a real case, not a hypothetical.** `Runtime implements Transport` (PIPE-26), so a
 * runtime can be another runtime's terminal transport, and a caller can also have activated a span
 * of their own. Either way the outermost one is the logical operation, so an already-active
 * recording span means this call is *inside* an operation rather than starting one.
 */
function startOperationSpan(context: RequestContext): Span | undefined {
  if (getActiveSpan().isRecording) return undefined;

  const factory = context.instrumentation.tracerFactory as
    ((operationName: string) => Tracer | undefined) | undefined;
  if (typeof factory !== 'function') return undefined;

  const tracer = factory(OPERATION_SPAN_NAME) ?? NOOP_TRACER;
  const span = tracer.startSpan(OPERATION_SPAN_NAME);
  return span.isRecording ? span : undefined;
}

/**
 * Runs `drive` as the body of `span` and ends that span EXACTLY once, whichever way it finishes
 * (OBS-29: `operationSucceeded` and `operationFailed` are mutually exclusive and happen once each).
 *
 * The `ended` latch is not belt-and-braces. `end()` is caller-supplied through `tracerFactory`, and
 * OBS-20 deliberately does not wrap tracer calls -- so a throwing `end()` on the success path lands
 * in the `catch` below, which is obliged to `recordException` the failure it now has to surface.
 * Without the latch that path called `end()` a second time on a span the tracer already closed.
 */
async function driveWithSpan(
  span: Span,
  drive: () => Promise<Response>,
): Promise<Response> {
  let ended = false;
  const endOnce = (): void => {
    if (ended) return;
    ended = true;
    span.end();
  };
  try {
    const response = await drive();
    endOnce();
    return response;
  } catch (error: unknown) {
    span.recordException(error);
    endOnce();
    throw error;
  }
}

/**
 * The request context to promote from once the drive finishes: the original, unless a step substituted the
 * outbound request (PIPE-14), in which case an off-chain rebuild around the request that was actually sent,
 * pinned to the SAME call key (CTX-6's explicit-key path) and carrying the same instrumentation bundle by
 * reference (CTX-2/CTX-3). Promoting straight off the original would pair the response with a request that
 * never left the process, against CTX-1's "the exchange stage exposes the request and the response". Doing it
 * here rather than widening `promoteToExchange` with a request-override keeps promotion strictly additive.
 *
 * Exported (still internal-only, still absent from the package barrel) so its two branches can be asserted as
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
 * TypeScript has no friend classes, so `PipelineBuilder` -- a different module -- reaches `Runtime`'s
 * private constructor through this module-scoped `let`, assigned exactly once inside the class's
 * `static {}` block. Init-once wiring, not mutable state, the same shape every builder-based model in
 * `src/http/` uses (`createHeaders`, `createRequest`, ...). It is surfaced as {@link createRuntime}
 * rather than kept module-local because the sanctioned construction site lives in another file.
 */
let create: (
  steps: readonly StepDescriptor[],
  transport: Transport,
  contextInit: RuntimeContextInit,
) => Runtime;

/**
 * The built, immutable pipeline (PIPE-10, PIPE-25). Implements `Transport` itself (PIPE-26) -- Phase 2's
 * `Transport` SPI has one method (`send`), so there is no second `sendAsync` entry point to delegate through.
 * `close()` deliberately never touches the wrapped transport (PIPE-27): the pipeline never owns it.
 *
 * The constructor is TS-`private`, so no field-wise constructor appears in the emitted `.d.ts` and a
 * consumer cannot assemble a `Runtime` around `PipelineBuilder.build()`'s validation. That matters
 * now that this class is public surface: a hand-built `new Runtime([authStep(a), authStep(b)], t)`
 * would put two steps in the single AUTH pillar slot (PIPE-4/PIPE-5, AUTH-27) and a hand-ordered step
 * array would invert PIPE-2's pillar precedence chain, both without any collision error, because
 * `Cursor` runs whatever array it is handed. `PipelineBuilder` is the only path that enforces either.
 *
 * @public
 */
export class Runtime implements Transport {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;
  readonly #contextInit: RuntimeContextInit;

  private constructor(
    steps: readonly StepDescriptor[],
    transport: Transport,
    contextInit: RuntimeContextInit,
  ) {
    // PIPE-10/PIPE-25: the built runtime is immutable, and `get steps()` hands out a read-only view. Copying
    // and freezing here rather than trusting the caller makes both structural -- `createRuntime` is reachable
    // from any in-package caller, so an unfrozen array passed in would leave the "immutable after
    // construction" guarantee resting on caller discipline.
    this.#steps = Object.freeze([...steps]);
    this.#transport = transport;
    this.#contextInit = contextInit;
  }

  static {
    create = (steps, transport, contextInit) =>
      new Runtime(steps, transport, contextInit);
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
   *
   * @remarks Opens **one** span for the whole call when the context's instrumentation supplies a
   * tracer and no span is already active — `OBS-29`'s "one tracer instance per logical operation".
   * It is the parent of whatever per-attempt spans the LOGGING pillar step opens inside the RETRY
   * and REDIRECT pipelines, which `PIPE-2` fixes there and which are therefore per *transmission*.
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
    // Every async-scoped store this call touches is RE-RUN around the drive rather than entered in
    // place. `runWithSnapshot(captureDiagnosticSnapshot())` re-enters the caller's OWN diagnostic
    // store under `AsyncLocalStorage.run`, which changes nothing a step can observe and everything
    // about what survives the call: a `pushDiagnosticFields` below -- the LOGGING pillar's OBS-23
    // correlation scope is the shipped one -- now unwinds when `send()` returns. `#drive` does the
    // same for the span slot with `runWithActiveSpan`.
    //
    // Until 2026-09-05 both slots were `enterWith` plus a restore closure called from a `finally`.
    // `enterWith` installs on the async resource running it, and that resource is the CALLER's --
    // `send`'s synchronous prefix runs there -- while the `finally` runs on a resource created by
    // the first `await` inside. So the restore reached nothing the caller could see: after
    // `await send()` the ended operation span was still "active", suppressing the next call's span
    // (OBS-29's 1:1 binding), and this call's `trace.id`/`span.id` rode into every subsequent
    // application log through any core `Logger` (audit #67 / #80).
    return runWithSnapshot(captureDiagnosticSnapshot(), () =>
      this.#drive(request, options, signal),
    );
  }

  /**
   * One drive, inside the re-entered stores `send()` established. Split out so `send()` is the
   * scoping statement and nothing else: the whole body has to sit inside the `run` callback for the
   * unwind to cover it, and a body that long inline reads as if the callback were optional.
   */
  async #drive(
    request: Request,
    options: RequestOptions | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const dispatchContext = createDispatchContext(this.#contextInit);
    // CTX-16: the operation name this pipeline was built with enters at the request stage and is
    // carried unchanged by every promotion after it.
    const requestContext = promoteToRequest(
      dispatchContext,
      request,
      this.#contextInit.operationName,
    );
    let currentContext: ExecutionContext = requestContext; // tracks the latest install for the finally below.
    const drive = async (): Promise<Response> => {
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
    };
    // CTX-11/CTX-17: the install and everything that can throw after it are inside ONE try, so the
    // `finally` evicts on every path. `startOperationSpan` calls a caller-supplied `tracerFactory`,
    // which OBS-30 says must not throw and nothing enforces; installed outside the try, one throwing
    // factory left an entry in the process-wide store per failed send.
    try {
      contextStore.install(requestContext); // CTX-17's positive half: the first store entry, at the first promotion.
      // OBS-29's 1:1 binding. Started before the drive and outside every pillar, so a retry's second
      // attempt and a redirect's second hop are the same operation as the first.
      const span = startOperationSpan(requestContext);
      if (span === undefined) return await drive();
      return await runWithActiveSpan(span, () => driveWithSpan(span, drive));
    } finally {
      contextStore.close(currentContext); // always the most recently installed context for this call.
    }
  }

  /**
   * A no-op, deliberately (PIPE-27). The pipeline never OWNS its terminal transport, so closing the
   * runtime must not close the transport a caller handed it and may still be using elsewhere. The
   * method exists only to satisfy the `Transport` SPI, so a `Runtime` can be nested as another
   * pipeline's transport (PIPE-26) without the outer one leaking a close through.
   *
   * @returns a promise that is already resolved.
   */
  async close(): Promise<void> {
    // PIPE-27: the pipeline never owns its transport and MUST NOT close it.
  }

  /**
   * The flattened step array, in the order the cursor drives it (PIPE-25).
   *
   * Frozen at construction, so the returned array is a read-only view and not a defensive copy —
   * there is nothing a caller can mutate through it.
   *
   * @returns the ordered, immutable step array.
   */
  get steps(): readonly StepDescriptor[] {
    return this.#steps; // PIPE-25: "exposes a read-only, ordered view of its steps."
  }

  /**
   * The wrapped terminal transport.
   *
   * Exposed for `PipelineBuilder.seedFrom(runtime, 'flatten')` (PIPE-35), which must reuse this
   * runtime's own transport as the seeded builder's terminal — flatten mode is not implementable
   * without it. Read-only: the pipeline never owns its transport (PIPE-27), so there is nothing to
   * copy defensively and nothing a caller can change by holding the reference.
   *
   * @returns the transport this pipeline dispatches to innermost.
   */
  get transport(): Transport {
    return this.#transport;
  }
}

/**
 * The in-package construction hook for {@link Runtime}, whose own constructor is `private` so no
 * consumer can build one around `PipelineBuilder.build()`'s pillar and ordering validation.
 *
 * Exported (still internal-only, still absent from the package barrel) for the same reason
 * {@link exchangeSource} is: the sanctioned caller -- `PipelineBuilder.build()` -- lives in a
 * different module, and TypeScript has no friend-class visibility to express that with.
 *
 * @param steps - the flattened, stage-ordered step array. Copied and frozen.
 * @param transport - the terminal transport. Never closed by the pipeline (PIPE-27).
 * @param contextInit - what each drive's context chain is built from: the `instrumentation` bundle
 *   whose `tracerFactory` supplies `OBS-29`'s per-operation span, the advisory `operationName`
 *   every promotion carries (CTX-16), and an optional `key` pinning two contexts to one store slot
 *   (CTX-5). Defaults to the no-op bundle, no operation name, and a fresh key. `PipelineBuilder`'s
 *   second constructor argument is the public way to supply the first two.
 * @returns the built, immutable runtime.
 *
 * @internal
 */
export function createRuntime(
  steps: readonly StepDescriptor[],
  transport: Transport,
  contextInit: RuntimeContextInit = {},
): Runtime {
  return create(steps, transport, contextInit);
}
