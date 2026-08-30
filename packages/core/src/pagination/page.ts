// SPDX-License-Identifier: MIT
// packages/core/src/pagination/page.ts
import type {Headers} from '../http/headers.js';
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import type {Status} from '../http/status.js';
import {invariant} from '../invariant.js';

/**
 * A pagination strategy's parse output: the items on this page plus the request that fetches the next one
 * (PAGE-4).
 *
 * `nextRequest === undefined` is the **single, exclusive** end-of-stream signal the engine recognizes. A
 * strategy must never signal termination by throwing or through a side channel, and an empty `items` list
 * paired with a defined `nextRequest` is a perfectly valid non-terminal page.
 *
 * @public
 */
export interface PageInfo<T> {
  /** The materialized items on this page (PAGE-2). */
  readonly items: readonly T[];
  /** The request that fetches the next page, or `undefined` to signal end of stream (PAGE-4). */
  readonly nextRequest: Request | undefined;
}

/**
 * Construct a frozen {@link PageInfo}. Omit `nextRequest` to signal end of stream.
 *
 * @public
 */
export function pageInfo<T>(
  items: readonly T[],
  nextRequest?: Request,
): PageInfo<T> {
  return Object.freeze({items: Object.freeze([...items]), nextRequest});
}

/**
 * One page of results, owning exactly one underlying response (PAGE-2, PAGE-3).
 *
 * State is split by lifetime, which is the whole point of the type: the materialized item list and the derived
 * status, headers, and originating request are captured at construction and **remain readable after close** —
 * only the raw body and its connection become invalid. Reading `page.status` after `await page.close()` is
 * supported, not a bug.
 *
 * Whoever pulls a page owns closing it. A component that hands a caller a live page — a first-page fetcher, for
 * instance — must **not** close the response itself; ownership transfers to the page.
 *
 * A class rather than a frozen object because it owns a resource with a lifecycle and an idempotent close,
 * which is `styleguide/typescript/06` §6.3's test for a class.
 *
 * @public
 */
export class Page<T> {
  /** Materialized, frozen items that remain readable after close (PAGE-2). */
  readonly items: readonly T[];
  /** The HTTP response status code and reason phrase (PAGE-1). */
  readonly status: Status;
  /** The HTTP response headers (PAGE-1). */
  readonly headers: Headers;
  /** The executed request that produced this page (PAGE-1). */
  readonly request: Request;
  // `#private` rather than the styleguide's default `private` (styleguide 6.6): `Page` is a *published* type
  // holding a live connection, and `private` is compile-time-only — a consumer could reach the response through
  // bracket access and close or re-read it behind the engine's back, breaking PAGE-3's single-owner rule and
  // PAGE-27's close-exactly-once. Runtime unreachability is the requirement here, not just encapsulation.
  readonly #response: Response;

  constructor(response: Response, items: readonly T[]) {
    invariant(
      (response as unknown) !== undefined,
      'a Page must own a response (PAGE-3)',
    );
    invariant(
      (items as unknown) !== undefined,
      'a Page’s items must never be null (PAGE-2)',
    );

    this.#response = response;
    // Captured now, so they outlive the response (PAGE-2). Copied so a caller's later mutation cannot reach in.
    this.items = Object.freeze([...items]);
    this.status = response.status;
    this.headers = response.headers;
    this.request = response.request;
  }

  /**
   * Release the underlying response's body and connection (PAGE-3).
   *
   * Idempotent, by delegation: Phase 3b's `Response.close()` is already close-once, so this adds no second
   * guard that could disagree with it.
   */
  async close(): Promise<void> {
    await this.#response.close();
  }
}

// PAGE-12's scoped teardown, installed at run time only when the symbol exists — the same guarded
// shape `SseStream` uses. `Response` ships no disposal member at all (HTTP-38), and
// `http/response.test.ts` pins the absence of the junk key this guard exists to prevent.
//
// Because the install is conditional, this class deliberately does NOT declare `implements
// AsyncDisposable`: `await using page` therefore does not type-check on the declared floor, where the
// method is genuinely absent. `close()` is the supported teardown path — see `Paginator.pages()`,
// which tells consumers which scoped constructs actually give PAGE-12's guarantee.
//
// DO NOT restore this as a plain `async [Symbol.asyncDispose]()` class member. Node 20.3 is this
// package's declared floor (`engines.node`, checked by verify:runtime-floor) and predates the symbol,
// which arrived in 20.4. On the floor the computed key evaluates to `undefined` and binds the method
// to the string key `"undefined"` — a junk prototype entry, and no working disposal. Declaring it on
// the class would also emit it into the `.d.ts` unconditionally, promising consumers on the floor a
// method that is not there.
if (typeof Symbol.asyncDispose === 'symbol') {
  Object.defineProperty(Page.prototype, Symbol.asyncDispose, {
    value: function asyncDispose<T>(this: Page<T>): Promise<void> {
      return this.close();
    },
    writable: true,
    configurable: true,
  });
}
