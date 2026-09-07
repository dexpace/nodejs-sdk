// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/step.ts
import type {ExecutionContext} from '../context/context.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Stage} from './stage.js';

/**
 * Advances the pipeline once, optionally substituting a replacement request first (PIPE-14). `Request`
 * values are immutable, so "substitute" means constructing a new one and passing it downstream -- the
 * substitution sticks for every remaining step and the terminal dispatch for the rest of the current call.
 * Calling with no argument carries the current request through unchanged.
 *
 * One-shot: each handle advances the chain exactly once (PIPE-15). A step that needs to re-drive the
 * chain calls `ctx.fork()` again for a fresh handle rather than reusing this one.
 *
 * @throws CursorAlreadyAdvancedError -- as a rejected promise -- when an already-invoked handle is
 *   invoked a second time (PIPE-11/PIPE-15).
 *
 * @public
 */
export type Next = (request?: Request) => Promise<Response>;

/**
 * What a step receives on each invocation (PIPE-12). `fork` is present only when the invoking step occupies
 * a pillar stage (PIPE-15/16); an ordinary step's `ctx.fork` is `undefined`.
 *
 * @public
 */
export interface StepContext {
  /**
   * Advances the chain exactly once (PIPE-14/PIPE-15). The ordinary way a step delegates downstream;
   * a step that never calls it short-circuits the rest of the pipeline.
   */
  readonly next: Next;
  /**
   * Mints a FRESH one-shot continuation, so a pillar step can drive the downstream chain more than
   * once — retry's attempts, redirect's hops, auth's challenge replay (PIPE-15/PIPE-16).
   *
   * Present only when the invoking step occupies a pillar stage; `undefined` for an ordinary step. A
   * step that forks more than once owns closing whatever response its own prior fork produced before
   * forking again (PIPE-40).
   */
  readonly fork?: (() => Next) | undefined;
  /**
   * This call's execution context, at whichever promotion stage the drive has reached (CTX-1).
   * Branch on `context.kind` to tell which: `'dispatch'` before a request exists, `'request'` once
   * one is assembled, `'exchange'` once a response has arrived. Shared by reference across every
   * fork, so it is the same object on every attempt and every hop.
   */
  readonly context: ExecutionContext;
  /**
   * The call's cancellation signal, threaded from the cursor (PIPE-13). Undefined when the caller
   * supplied none. A pillar step that waits between drives (retry's backoff, auth's token fetch)
   * MUST honor it (RETRY-26/RETRY-32).
   */
  readonly signal?: AbortSignal | undefined;
  /**
   * The caller's per-call options, immutable and shared across every fork (PIPE-17: "readable by
   * any step"). Undefined when the caller supplied none. The retry step reads `maxRetries`
   * (RETRY-41/HTTP-35); the auth step reads the per-call auth descriptor (5c).
   */
  readonly options?: RequestOptions | undefined;
}

/**
 * A pipeline step (PIPE-12): receives the inbound request, MAY invoke the rest of the chain via `ctx.next`
 * (or `ctx.fork` to re-drive more than once), and MAY inspect or substitute the outbound response --
 * including short-circuiting by never calling `next` at all.
 *
 * A step that forks more than once owns closing whatever response its own prior fork produced before
 * invoking `fork()` again (PIPE-40) -- that responsibility sits on the wrapping step, not on `Cursor`.
 *
 * @public
 */
export type Step = (request: Request, ctx: StepContext) => Promise<Response>;

/**
 * A registered step: its function plus the identity (`type`) PIPE-6's reference-identity pillar check and
 * PIPE-18/19's anchor-type matching both key off, and the `stage` it occupies.
 *
 * @public
 */
export interface StepDescriptor {
  /**
   * This step's identity. PIPE-6's pillar-occupancy check and PIPE-18/PIPE-19's anchor matching both
   * compare it by REFERENCE, so a factory must mint one module-level symbol and reuse it across every
   * descriptor it produces — never a fresh `Symbol()` per call.
   */
  readonly type: symbol;
  /** The stage this step occupies. A pillar stage admits at most one step (PIPE-4/PIPE-5). */
  readonly stage: Stage;
  /** The step itself (PIPE-12). */
  readonly fn: Step;
}
