// SPDX-License-Identifier: MIT
// packages/core/src/pagination/query-splice.ts
import {
  decodeQueryComponent,
  encodeQueryComponent,
} from '../http/query-params.js';

/**
 * Rewrite one query parameter, splicing the raw query string rather than re-rendering it (PAGE-21–PAGE-24).
 *
 * **Why not `URLSearchParams`.** It re-serializes the *entire* query through its own canonical encoding on
 * every mutation: untouched parameters get reordered and re-encoded (against PAGE-21's byte-for-byte rule), and
 * a space becomes `+` rather than the `%20` this port standardizes on (HTTP-29).
 *
 * **Why not `QueryParams`.** Same problem in a different costume — `encode()` re-renders the whole query from
 * the parsed model. `QueryParams` is the right tool for *building* a query and the wrong one for *splicing* one.
 * Only the component *encoder* is shared, which is the part PAGE-22 and HTTP-29 genuinely agree on.
 *
 * Passing `undefined` removes the parameter. Setting replaces the first occurrence in place and drops later
 * duplicates — the single-value convention paging parameters follow. Everything else is copied byte-for-byte.
 *
 * @internal
 */
export function spliceQueryParam(
  url: URL,
  name: string,
  value: string | undefined,
): URL {
  const encodedName = encodeQueryComponent(name);
  const segments = splitQuery(url.search);

  const out: string[] = [];
  let replaced = false;

  for (const segment of segments) {
    if (nameOf(segment) !== encodedName) {
      out.push(segment); // byte-for-byte, untouched
      continue;
    }
    if (replaced) continue; // PAGE-23: later duplicates are dropped
    replaced = true;
    if (value !== undefined)
      out.push(`${encodedName}=${encodeQueryComponent(value)}`);
  }

  if (!replaced && value !== undefined) {
    out.push(`${encodedName}=${encodeQueryComponent(value)}`);
  }

  // Rebuilding through `URL` preserves scheme, userinfo, host, port, path, and fragment exactly (PAGE-24);
  // only `search` is assigned.
  const next = new URL(url.href);
  next.search = out.length === 0 ? '' : `?${out.join('&')}`;
  return next;
}

/**
 * Read one query parameter with the same RFC 3986 semantics the splice writes (PAGE-22).
 *
 * A literal `+` reads back as `+`, `%20` as a space, a value-less flag as the empty string, and an absent name
 * as `undefined`. First match wins.
 *
 * @internal
 */
export function readQueryParam(url: URL, name: string): string | undefined {
  const encodedName = encodeQueryComponent(name);
  for (const segment of splitQuery(url.search)) {
    if (nameOf(segment) !== encodedName) continue;
    const eq = segment.indexOf('=');
    return eq === -1 ? '' : decodeQueryComponent(segment.slice(eq + 1));
  }
  return undefined;
}

/**
 * Split a raw query into `&`-separated segments, dropping the leading `?` and any stray empty segments.
 *
 * Dropping empty segments (`?a=1&&b=2` → two segments) is not a byte-for-byte violation to apologize for — it
 * is the same leniency `HTTP-31` already mandates for query *parsing*, "stray `&` is skipped." Doing something
 * different here would put two disagreeing readings of the same query string in one codebase.
 */
function splitQuery(search: string): string[] {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  return raw.length === 0
    ? []
    : raw.split('&').filter(segment => segment.length > 0);
}

/** The raw (still-encoded) name of a segment. A value-less flag is all name. */
function nameOf(segment: string): string {
  const eq = segment.indexOf('=');
  return eq === -1 ? segment : segment.slice(0, eq);
}
