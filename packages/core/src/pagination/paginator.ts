// SPDX-License-Identifier: MIT
// packages/core/src/pagination/paginator.ts
import type {Request} from '../http/request.js';
import type {RequestOptions} from '../http/request-options.js';
import type {Response} from '../http/response.js';
import type {Transport} from '../seams/transport.js';
import {invariant} from '../invariant.js';
import {PaginationError} from './errors.js';
import {Page, type PageInfo} from './page.js';
import type {PaginationStrategy} from './strategy.js';
import {suppress} from '../suppress.js';

/**
 * Initialization options for {@link Paginator}.
 *
 * @public
 */
export interface PaginatorInit<T> {
  /**
   * Any `Transport` — a raw one, a `FakeTransport`, or 4c's `Runtime` (which implements `Transport`, so a
   * full resilience pipeline drops in unchanged). The engine is transport-agnostic by §12's own mandate.
   */
  readonly transport: Transport;
  /** The request template that fetches the initial page (page 1) (PAGE-1). */
  readonly initialRequest: Request;
  /** The pagination strategy that parses each response into items and the next request (PAGE-5). */
  readonly strategy: PaginationStrategy<T>;
  /** Maximum exchanges. Counts pages, not items. Unbounded when omitted (PAGE-10). */
  readonly maxPages?: number | undefined;
  /** Applied to **every** page exchange, not just the first (PAGE-36). */
  readonly options?: RequestOptions | undefined;
  /** Optional abort signal applied to every page exchange (PAGE-25). */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Turns a paginated endpoint into a lazy stream of items or of whole pages (PAGE-1).
 *
 * Holds only frozen configuration and is safe to share; each call to {@link Paginator.items} or {@link Paginator.pages} builds a
 * fresh walk with its own counter and cursor, so two iterations drive two full fetch sequences (PAGE-8). That
 * is a property of generators, not bookkeeping performed here.
 *
 * **Laziness is free** (PAGE-6): a generator body does not run until its first `.next()`, so constructing this
 * object, calling `items()`, and taking its iterator all trigger zero exchanges.
 *
 * **Cancellation race** (PAGE-33), inherent and worth knowing: if `signal` aborts *before* the transport
 * delivers a response, that response never reaches this engine and releasing it is the transport's
 * responsibility — cancelling a walk cannot reach into a response it was never handed. Conversely, a page
 * request already dispatched may still complete after the abort; when it does, this engine closes and discards
 * that response rather than yielding it.
 *
 * @public
 */
export class Paginator<T> {
  // `#private` rather than `private` (styleguide 6.6 defaults to `private`): this is a published class, so the
  // config bag must be unreachable via bracket access from consumer code, not merely compile-time-hidden.
  // It is the class's ONLY field — PAGE-8 requires the engine to hold immutable configuration and nothing else.
  readonly #init: PaginatorInit<T>;

  constructor(init: PaginatorInit<T>) {
    // PAGE-9: fail fast at construction, not lazily on the first fetch, so a misconfiguration surfaces at the
    // call site that caused it.
    if (
      init.maxPages !== undefined &&
      (!Number.isInteger(init.maxPages) || init.maxPages <= 0)
    ) {
      throw new PaginationError(
        `maxPages must be a positive integer; received ${String(init.maxPages)}`,
      );
    }
    this.#init = Object.freeze({...init});

    invariant(
      (this.#init.transport as unknown) !== undefined,
      'Paginator requires a transport',
    );
    invariant(
      (this.#init.initialRequest as unknown) !== undefined,
      'Paginator requires an initialRequest',
    );
    invariant(
      (this.#init.strategy as unknown) !== undefined,
      'Paginator requires a strategy',
    );
  }

  /**
   * Every item across every page, flattened in server order (PAGE-1).
   *
   * **Each page is closed before any of its items are yielded** (PAGE-11), after the items are copied. The
   * items survive close (PAGE-2), so this costs nothing — and it means abandoning iteration mid-page can never
   * strand a response, regardless of how long the consumer takes.
   *
   * Note this is deliberately *not* the ordering `sdk-design-nodejs/07` §7.1's illustrative snippet shows. That
   * snippet closes in a `finally` after yielding, which holds the response open for the whole item walk; it
   * passes PAGE-11's stated conformance test anyway, which is exactly why the ordering is called out here.
   *
   * Re-iterable, unlike {@link Paginator.pages}: PAGE-14 scopes single-use to the page-level view, and PAGE-8 requires
   * independent iterations to work.
   */
  items(): AsyncIterable<T> {
    const walk = this.#walk.bind(this);
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        for await (const page of walk()) {
          const items = page.items;
          await page.close();
          yield* items;
        }
      },
    };
  }

  /**
   * Whole pages, each exposing per-page status, headers, and originating request (PAGE-1).
   *
   * Auto-closing (PAGE-12): the previous page is closed as the consumer advances, and the currently held page
   * is closed at exhaustion or on abandonment via the generator's `finally` — which the runtime drives
   * automatically when a `for await` loop exits early through `break`, `return`, or a throw.
   *
   * **Consume this inside a scoped construct** (PAGE-12, MUST). A `for await` loop is one — it drives
   * `.return()` on every exit path, including `break` and `throw`, so the held page is always released. Driving
   * the iterator by hand is the case to be careful with: if you call `[Symbol.asyncIterator]()` yourself and
   * then abandon it without calling `.return()`, the generator never resumes, its `finally` never runs, and the
   * page it is holding stays open until the process exits. Two constructs give you the guarantee: stay inside a
   * `for await`, or, when you drive the iterator yourself, call `.return()` on it from a `finally`.
   *
   * `await using` is deliberately **not** a third. {@link (Page:class)} installs `[Symbol.asyncDispose]` at run
   * time only where the runtime has it, so it does not declare `AsyncDisposable` and `await using page` does not
   * type-check against this package's `engines.node >=20.3` floor — the symbol arrived in Node 20.4. Every page
   * this view yields is closed for you as the walk advances; `Page.close()` is the manual counterpart, and is
   * idempotent.
   *
   * Single-use (PAGE-14) — **per view, not per paginator**. A second `[Symbol.asyncIterator]()` on *this*
   * returned view fails loudly rather than silently restarting the walk. Calling `pages()` again is the
   * sanctioned recovery path PAGE-14 itself names ("a caller restarts pagination by requesting a fresh view
   * from the engine"), so it returns a new, independent view. Guarding `pages()` too would make the engine
   * stateful, which PAGE-8 forbids ("the engine itself MUST hold only immutable configuration and be safe to
   * share") and would break two concurrent callers sharing one `Paginator`.
   */
  pages(): AsyncIterable<Page<T>> {
    const walk = this.#walk.bind(this);
    let iteratorTaken = false;
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<Page<T>> => {
        // PAGE-14 governs obtaining the *iterator*, not calling pages(), and guarding only the method would
        // leave the exact hole the requirement names: `for await` calls Symbol.asyncIterator afresh each time,
        // so iterating one returned view twice would silently restart the entire walk. 6b's SseStream guards at
        // this same level, for the same reason.
        if (iteratorTaken) {
          throw new PaginationError(
            'the page-level view is single-use; its iterator may be obtained at most once',
          );
        }
        iteratorTaken = true;
        return walk()[Symbol.asyncIterator]();
      },
    };
  }

  /** The one drive routine both views share. */
  async *#walk(): AsyncGenerator<Page<T>> {
    const {transport, strategy, initialRequest, maxPages, options, signal} =
      this.#init;
    let request: Request | undefined = initialRequest;
    let fetched = 0;
    let held: Page<T> | undefined;

    try {
      while (request !== undefined) {
        // PAGE-25/PAGE-26: check abort before dispatch so no extra request is sent past the abort boundary.
        if (isAborted(signal)) return;
        // PAGE-9: cap stops the walk even when the strategy still reports a next request.
        if (maxPages !== undefined && fetched >= maxPages) return;

        // PAGE-12: release the previous page before dispatching the next request, so the two-page window
        // does not hold connections open across subsequent network exchanges.
        if (held !== undefined) {
          const previous = held;
          held = undefined;
          await previous.close();
        }

        const response = await transport.send(request, options, signal);
        fetched += 1;

        // PAGE-26/PAGE-33: an abort that landed while this exchange was in flight means the page must be
        // dropped AND closed rather than delivered.
        if (isAborted(signal)) {
          await closeQuietly(response);
          return;
        }

        const info: PageInfo<T> = await parseOrClose(
          strategy,
          response,
          request,
        );
        held = await pageOrClose(response, info);
        request = info.nextRequest;
        yield held;
      }
    } finally {
      // Covers exhaustion, an early `break`, and a consumer throw — a `for await` loop drives `.return()` on the
      // generator (AsyncIteratorClose), which executes this `finally` block (PAGE-12, PAGE-27, PAGE-32). If
      // `held.close()` throws during an active `.return()` unwind, the ECMAScript specification discards the close
      // error and propagates the consumer's original error, satisfying PAGE-32's requirement.
      if (held !== undefined) await held.close();
    }
  }
}

/**
 * PAGE-13: if `parse` rejects, the page was never constructed, so nothing else will close this response — do it
 * inline on the exceptional path. A close failure must not mask the parse failure: parse error primary, close
 * error suppressed.
 */
async function parseOrClose<T>(
  strategy: PaginationStrategy<T>,
  response: Response,
  template: Request,
): Promise<PageInfo<T>> {
  try {
    return await strategy.parse(response, template);
  } catch (parseError: unknown) {
    return closeThenRethrow(response, parseError, 'pagination parse failed');
  }
}

/**
 * PAGE-4: `parse` must always return a well-formed result, and must never signal termination through a side
 * channel. A strategy that returns nothing is a programmer error, so the walk crashes at the fault rather than
 * silently ending as if the server had run out of pages.
 *
 * PAGE-27: and it crashes *after* releasing the response. `parse` returning a malformed value is the one exit
 * from this loop the `finally` in `#walk` cannot cover — `held` is still `undefined` there, because assigning it
 * is precisely what failed — so, like PAGE-13's parse rejection, the release happens inline (audit #67 / #79).
 *
 * Both checks reject `null` as well as `undefined`, which is what their messages have always claimed. Testing
 * only for `undefined` let `{items: null}` through to `Page`'s constructor, where the item copy surfaced as a
 * bare `TypeError` from spread — naming nothing a caller could act on, and leaking the response on the way.
 *
 * Not async: the only asynchrony here is the close, and only on the failure path.
 */
function pageOrClose<T>(
  response: Response,
  info: PageInfo<T>,
): Promise<Page<T>> {
  try {
    invariant(
      (info as unknown) !== undefined && (info as unknown) !== null,
      'PaginationStrategy.parse must return a PageInfo, never null or undefined',
    );
    invariant(
      (info.items as unknown) !== undefined && (info.items as unknown) !== null,
      'PageInfo.items must never be null or absent (PAGE-2)',
    );
    return Promise.resolve(new Page(response, info.items));
  } catch (buildError: unknown) {
    return closeThenRethrow(
      response,
      buildError,
      'the pagination strategy returned a malformed PageInfo',
    );
  }
}

/**
 * Release `response`, then rethrow `primary`. Shared by the two inline-close paths so they cannot drift: a close
 * failure is attached as suppressed and never masks the failure that got here first (PAGE-13, PAGE-15).
 */
async function closeThenRethrow(
  response: Response,
  primary: unknown,
  context: string,
): Promise<never> {
  try {
    await response.close();
  } catch (closeError: unknown) {
    throw suppress(
      primary,
      closeError,
      `${context} and releasing the response also failed`,
    );
  }
  throw primary;
}

/** PAGE-26: on an already-settled cancellation path, a close error is swallowed — nothing is left to report to. */
async function closeQuietly(response: Response): Promise<void> {
  try {
    await response.close();
  } catch {
    // Deliberately swallowed: the walk has already ended and there is no in-flight result to attach this to.
  }
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}
