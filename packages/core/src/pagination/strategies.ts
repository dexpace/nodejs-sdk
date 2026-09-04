// SPDX-License-Identifier: MIT
// packages/core/src/pagination/strategies.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {findNextLink} from './link-header.js';
import {pageInfo, type PageInfo} from './page.js';
import {readQueryParam, spliceQueryParam} from './query-splice.js';
import type {PaginationStrategy} from './strategy.js';

/** Build the next request by swapping only the URL, preserving method, headers, and body (PAGE-23). */
function withUrl(template: Request, url: URL): Request {
  return template.newBuilder().url(url).build();
}

/**
 * Cursor/continuation-token pagination (PAGE-16).
 *
 * `extract` reads items and the next cursor from **one** read of the response body. It is caller-supplied
 * rather than codec-driven because §12 requires the engine to be serde-agnostic: naming a `Serde` here would
 * couple pagination to a wire format it has no business knowing about. A caller using `@dexpace/codec-json`
 * simply closes over it inside `extract`.
 *
 * A `null` **or empty** cursor ends the stream — both, because a server returning `""` for "no more pages" is
 * common enough that treating it as a real cursor produces an infinite walk.
 *
 * @public
 */
export function cursorStrategy<T>(init: {
  extract: (
    response: Response,
  ) => Promise<{items: readonly T[]; cursor?: string | null | undefined}>;
  parameterName?: string | undefined;
}): PaginationStrategy<T> {
  const parameterName = init.parameterName ?? 'cursor';
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const {items, cursor} = await init.extract(response);
      if (cursor === null || cursor === undefined || cursor.length === 0)
        return pageInfo(items);
      return pageInfo(
        items,
        withUrl(
          template,
          spliceQueryParam(template.url, parameterName, cursor),
        ),
      );
    },
  });
}

/**
 * Page-number pagination (PAGE-17).
 *
 * An empty items list ends the stream **before** any arithmetic runs — defensive against servers that keep
 * returning an empty page past the end instead of signalling termination, which would otherwise walk forever.
 *
 * The current page comes from the *executed* request's query (`response.request.url`), not the template's.
 * The template is not a fixed page-1 request -- it advances with the walk, since this function returns the
 * next one as `nextRequest` and the engine makes that the following hop's template
 * (`paginator.ts:165,213`; the contract is on `PaginationStrategy.parse` in `strategy.ts:10-15`). It is the
 * *pre-flight* request for this hop, so it is the response's own request that reflects a redirect or any
 * rewrite a step applied on the way out, and that is the page number worth incrementing. An absent, empty,
 * or non-numeric value falls back to `startPage`; `startPage: 0` supports 0-based servers.
 *
 * @public
 */
export function pageNumberStrategy<T>(init: {
  extract: (response: Response) => Promise<readonly T[]>;
  parameterName?: string | undefined;
  startPage?: number | undefined;
}): PaginationStrategy<T> {
  const parameterName = init.parameterName ?? 'page';
  const startPage = init.startPage ?? 1;
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const items = await init.extract(response);
      if (items.length === 0) return pageInfo(items);

      const raw = readQueryParam(response.request.url, parameterName);
      const parsed =
        raw === undefined || raw.length === 0 ? Number.NaN : Number(raw);
      const current =
        Number.isInteger(parsed) && parsed >= 0 ? parsed : startPage;

      const nextUrl = spliceQueryParam(
        template.url,
        parameterName,
        String(current + 1),
      );
      return pageInfo(items, withUrl(template, nextUrl));
    },
  });
}

/**
 * `Link`-header pagination (PAGE-18, PAGE-19, PAGE-20).
 *
 * The target resolves as an RFC 3986 reference against the originating response's URL. WHATWG `URL` gets the
 * query-only (`?page=2`) case right natively — it preserves the base path and replaces only the query, where
 * RFC 2396's older rule would drop the last path segment.
 *
 * A target that cannot resolve into a valid URL is **end-of-stream, not an error** (PAGE-19). That is why the
 * `URL` constructor's throw is caught and converted here — one of the few places in this codebase where
 * swallowing an exception is the specified behavior rather than a smell.
 *
 * @public
 */
export function linkHeaderStrategy<T>(init: {
  extract: (response: Response) => Promise<readonly T[]>;
  headerName?: string | undefined;
}): PaginationStrategy<T> {
  const headerName = init.headerName ?? 'Link';
  return Object.freeze({
    async parse(response: Response, template: Request): Promise<PageInfo<T>> {
      const items = await init.extract(response);
      const target = findNextLink(response.headers.getAll(headerName));
      if (target === undefined) return pageInfo(items);

      let resolved: URL;
      try {
        resolved = new URL(target, response.request.url);
      } catch {
        return pageInfo(items); // PAGE-19: unresolvable means end of stream, never an error.
      }
      return pageInfo(items, withUrl(template, resolved));
    },
  });
}
