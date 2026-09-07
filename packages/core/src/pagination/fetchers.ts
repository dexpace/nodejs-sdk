// SPDX-License-Identifier: MIT
// packages/core/src/pagination/fetchers.ts
import {invariant} from '../invariant.js';
import {PaginationError} from './errors.js';
import type {Page} from './page.js';

/**
 * A mutable bag threaded through **every** fetcher call in one walk (PAGE-35).
 *
 * The same instance is passed each time, so a custom retriever can stash cursor or auth state between pages.
 * Cross-call mutation visibility is the *point*, not a hazard to defend against — it is documented here rather
 * than designed away. Single-consumer; needs no synchronization.
 *
 * @public
 */
export interface PagingOptions {
  /** The RFC 8288 link target for the next page (PAGE-34). */
  nextLink?: string | undefined;
  /** The continuation/cursor token fallback for the next page (PAGE-34). */
  continuationToken?: string | undefined;
  /** Custom per-walk state stashed by callers across page requests (PAGE-35). */
  [key: string]: unknown;
}

/**
 * What a fetcher returns: a page it built and does not close, plus how to reach the one after it.
 *
 * @public
 */
export interface FetcherPage<T> {
  /** The constructed page, which owns its underlying response and will be closed by the engine (PAGE-34). */
  readonly page: Page<T>;
  /** The RFC 8288 next link, taking priority over continuationToken (PAGE-34). */
  readonly nextLink?: string | undefined;
  /** The continuation token fallback used when nextLink is absent (PAGE-34). */
  readonly continuationToken?: string | undefined;
}

/**
 * Initialization options for {@link paginateWithFetchers}.
 *
 * @public
 */
export interface FetcherPaginationInit<T> {
  /** Called exactly once, at the start of the walk. Return `undefined` for an empty stream. */
  first: (options: PagingOptions) => Promise<FetcherPage<T> | undefined>;
  /**
   * Called with the previous page's next link, or — only when no link was present — its continuation token.
   * Return `undefined` to end the stream.
   */
  next: (
    key: string,
    options: PagingOptions,
  ) => Promise<FetcherPage<T> | undefined>;
  /** Maximum pages delivered. Unbounded when omitted. */
  maxPages?: number | undefined;
}

/**
 * Drive pagination from caller-supplied per-page fetchers instead of a strategy (PAGE-34).
 *
 * **Ownership**: each fetcher builds a {@link (Page:class)} that owns its response and must **not** close it —
 * ownership transfers to the page, and this engine closes it as the consumer advances and at exhaustion. A
 * fetcher that throws *before* building the page still owns whatever response it opened; this engine never saw
 * it and has no handle with which to close it.
 *
 * **Next link wins** over the continuation token. A blank or whitespace-only link with no fallback token ends
 * the stream, as does an `undefined` return from either fetcher — an `undefined` first page yields an empty
 * stream rather than an error.
 *
 * **Single-use** (PAGE-14). This is a page-level view, so its iterator may be obtained at most once; a second
 * `for await` over the same returned value throws rather than silently restarting. Without the guard a second
 * loop would re-run `first()`, breaking PAGE-34's "exactly once" and double-consuming the walk. Call
 * `paginateWithFetchers()` again for a fresh walk — the same restart path `Paginator.pages()` offers.
 *
 * @public
 */
export function paginateWithFetchers<T>(
  init: FetcherPaginationInit<T>,
): AsyncIterable<Page<T>> {
  if (
    init.maxPages !== undefined &&
    (!Number.isInteger(init.maxPages) || init.maxPages <= 0)
  ) {
    throw new PaginationError(
      `maxPages must be a positive integer; received ${String(init.maxPages)}`,
    );
  }
  invariant(
    typeof init.first === 'function',
    'paginateWithFetchers requires a first-page fetcher',
  );
  invariant(
    typeof init.next === 'function',
    'paginateWithFetchers requires a next-page fetcher',
  );

  let iteratorTaken = false;

  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<Page<T>> {
      if (iteratorTaken) {
        throw new PaginationError(
          'the fetcher pagination view is single-use; its iterator may be obtained at most once',
        );
      }
      iteratorTaken = true;
      yield* driveFetchers(init);
    },
  };
}

async function* driveFetchers<T>(
  init: FetcherPaginationInit<T>,
): AsyncGenerator<Page<T>> {
  const options: PagingOptions = {};
  let held: Page<T> | undefined;
  let delivered = 0;

  try {
    let current: FetcherPage<T> | undefined = await init.first(options);

    while (current !== undefined) {
      const page: Page<T> = current.page;
      held = page;
      delivered += 1;
      yield page;

      // PAGE-9: stop *before* fetching the page that would exceed the cap.
      if (init.maxPages !== undefined && delivered >= init.maxPages) return;

      const key: string | undefined = nextKey(current);
      if (key === undefined) return;

      // PAGE-12: release previous page before calling the next fetcher to eliminate connection overlap.
      held = undefined;
      await page.close();

      options.nextLink = current.nextLink;
      options.continuationToken = current.continuationToken;
      current = await init.next(key, options);
    }
  } finally {
    if (held !== undefined) await held.close();
  }
}

/** PAGE-34: the next link wins; the continuation token is a fallback only when no usable link is present. */
function nextKey<T>(page: FetcherPage<T>): string | undefined {
  const link = page.nextLink?.trim();
  if (link !== undefined && link.length > 0) return link;
  const token = page.continuationToken?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
