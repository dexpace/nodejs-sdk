// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/cursor.ts
import type {ExecutionContext} from '../context/context.js';
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {CursorAlreadyAdvancedError} from './errors.js';
import {PILLAR_STAGES, type Stage} from './stage.js';
import type {Next, StepContext, StepDescriptor} from './step.js';

/**
 * Everything a `Cursor` needs, bundled into one object. Six positional parameters would fail ESLint's
 * `max-params: 3`, and Phase 1 reserves the `eslint-disable` escape hatch for private builder-internal
 * constructors only -- the same trap 4a's `ContextInit` and 4b's `DispatchConfig` were built to dodge.
 *
 * @internal
 */
export interface CursorInit {
  readonly steps: readonly StepDescriptor[];
  readonly transport: Transport;
  readonly request: Request;
  readonly context: ExecutionContext;
  readonly options?: RequestOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Drives one call through the flattened step array (PIPE-9..PIPE-17). One instance per `Runtime.send()`
 * call (PIPE-10); `advance()` is its single public entry point. Internally a private recursive dispatcher
 * indexed by array position -- `next` and every `fork()` call are one-shot closures built over the same
 * dispatcher (PIPE-15/16), sharing a single mutable in-flight request so a substitution sticks globally for
 * the rest of the call (PIPE-14).
 *
 * There is deliberately no settable start position: a fork produces a fresh one-shot closure over the
 * existing dispatcher, never a second `Cursor`, so every instance starts at position 0.
 *
 * @internal
 */
export class Cursor {
  readonly #steps: readonly StepDescriptor[];
  readonly #transport: Transport;
  #request: Request;
  readonly #options: RequestOptions | undefined;
  readonly #signal: AbortSignal | undefined;
  readonly #context: ExecutionContext;

  constructor(init: CursorInit) {
    this.#steps = init.steps;
    this.#transport = init.transport;
    this.#request = init.request;
    this.#options = init.options;
    this.#signal = init.signal;
    this.#context = init.context;
  }

  /**
   * The in-flight request as of now: the one passed in, or whatever a step last substituted (PIPE-14).
   * `Runtime` reads this after the drive so the exchange context describes the request actually sent.
   */
  get request(): Request {
    return this.#request;
  }

  /**
   * Drives the call from position 0 through every step and on to the terminal transport dispatch.
   * Called exactly once per cursor -- `Runtime.send()` allocates a fresh cursor per call (PIPE-10).
   *
   * @returns the response the outermost step returned, which may be a synthetic one it short-circuited
   *   with, a substituted one, or the terminal transport's own (PIPE-12).
   * @throws CursorAlreadyAdvancedError when a step reuses an already-invoked continuation (PIPE-15).
   */
  async advance(): Promise<Response> {
    return this.#dispatch(0);
  }

  async #dispatch(position: number): Promise<Response> {
    if (position >= this.#steps.length) {
      // PIPE-13: exhausted -- dispatch the current in-flight request to the terminal transport.
      return this.#transport.send(this.#request, this.#options, this.#signal);
    }
    const descriptor = this.#steps[position];
    invariant(
      descriptor !== undefined,
      `pipeline cursor position ${String(position)} is within bounds but undefined`,
    );
    const next = this.#continuationAt(position + 1, descriptor.stage);
    const ctx: StepContext = PILLAR_STAGES.has(descriptor.stage)
      ? {
          next,
          context: this.#context,
          fork: (): Next =>
            this.#continuationAt(position + 1, descriptor.stage),
        }
      : {next, context: this.#context};
    return descriptor.fn(this.#request, ctx);
  }

  /**
   * Builds a ONE-SHOT continuation targeting `targetPosition` (PIPE-11/15: a second call throws
   * CursorAlreadyAdvancedError). `ctx.next` and every `ctx.fork()` call share this helper -- both always
   * target `position + 1` of the requesting step; `fork()` may simply be called again to obtain a fresh
   * one-shot continuation bound to that same target (PIPE-16).
   */
  #continuationAt(targetPosition: number, ownerStage: Stage): Next {
    let used = false;
    return async (replacementRequest?: Request): Promise<Response> => {
      if (used) throw new CursorAlreadyAdvancedError(ownerStage);
      used = true;
      if (replacementRequest !== undefined) {
        this.#request = replacementRequest; // PIPE-14: sticks for every later step and the terminal dispatch.
      }
      return this.#dispatch(targetPosition);
    };
  }
}
