// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/step.ts
import type {ExecutionContext} from '../context/context.js';
import type {Request} from '../http/request.js';
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
 * @internal
 */
export type Next = (request?: Request) => Promise<Response>;

/**
 * What a step receives on each invocation (PIPE-12). `fork` is present only when the invoking step occupies
 * a pillar stage (PIPE-15/16); an ordinary step's `ctx.fork` is `undefined`.
 *
 * The call's per-call `options` and `AbortSignal` are deliberately absent here: `Cursor` carries both and
 * threads them into the terminal dispatch, but PIPE-17's "readable by any step" clause has no reader until
 * Phase 5a's retry engine, which adds both fields as one additive amendment (5a Task 1).
 *
 * @internal
 */
export interface StepContext {
  readonly next: Next;
  readonly fork?: (() => Next) | undefined;
  readonly context: ExecutionContext;
}

/**
 * A pipeline step (PIPE-12): receives the inbound request, MAY invoke the rest of the chain via `ctx.next`
 * (or `ctx.fork` to re-drive more than once), and MAY inspect or substitute the outbound response --
 * including short-circuiting by never calling `next` at all.
 *
 * A step that forks more than once owns closing whatever response its own prior fork produced before
 * invoking `fork()` again (PIPE-40) -- that responsibility sits on the wrapping step, not on `Cursor`.
 *
 * @internal
 */
export type Step = (request: Request, ctx: StepContext) => Promise<Response>;

/**
 * A registered step: its function plus the identity (`type`) PIPE-6's reference-identity pillar check and
 * PIPE-18/19's anchor-type matching both key off, and the `stage` it occupies.
 *
 * @internal
 */
export interface StepDescriptor {
  readonly type: symbol;
  readonly stage: Stage;
  readonly fn: Step;
}
