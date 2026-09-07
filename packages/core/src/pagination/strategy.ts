// SPDX-License-Identifier: MIT
// packages/core/src/pagination/strategy.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {PageInfo} from './page.js';

/**
 * A stateless parser turning one response into that page's items plus the next page's request (PAGE-5).
 *
 * **On `template`.** The glossary calls this "the original request template," but the engine passes the request
 * that produced *this* response — i.e. it advances with the walk. That is deliberate and is what the built-in
 * strategies need: `cursorStrategy` splices the new cursor onto the request actually just executed, so a walk
 * accumulates one cursor parameter rather than re-deriving page N's URL from page 1's every time. Read the
 * parameter as "the request to derive the next one from," and use `response.request` when you specifically want
 * the executed request's own URL (`pageNumberStrategy` does).
 *
 * **Contract obligations on implementors** — none of these can be enforced by the type system, so they are
 * stated here and covered by the engine's own tests:
 *
 * - **Read the body at most once.** The body is single-use. The engine hands you the response exactly once and
 *   never reads the body itself, so it is entirely yours — but only once.
 * - **Do not retain the response or its body past the call.** The engine closes the response as soon as `parse`
 *   resolves, so a retained body is already dead; holding one produces an intermittent failure rather than a
 *   clean one.
 * - **Do not close or mutate the response.** Lifecycle ownership belongs to the engine.
 * - **Be immutable and safe to share.** One strategy instance may drive several concurrent walks. Keep no
 *   per-call state on `this`.
 * - **Never signal termination by throwing.** Return `pageInfo(items)` with no next request. A throw means a
 *   genuine parse failure, and the engine treats it as one (PAGE-13).
 *
 * **Why `parse` is asynchronous.** `PAGE-5` says a strategy must read what it needs "synchronously inside
 * parse." This runtime has no synchronous body read — the bytes may not have arrived — so the literal reading
 * is unimplementable. Every enforceable part of the requirement's intent survives the promise, as listed above.
 * Do not "fix" this back to a synchronous signature; it cannot work.
 *
 * @public
 */
export interface PaginationStrategy<T> {
  /**
   * Parses one HTTP response into this page's items and the request for the next page (PAGE-5).
   *
   * @param response - the executed response to extract items from.
   * @param template - the request to derive the next page's request from.
   * @returns a {@link PageInfo} containing items and the optional next request.
   */
  parse(response: Response, template: Request): Promise<PageInfo<T>>;
}
