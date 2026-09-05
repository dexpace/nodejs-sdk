// SPDX-License-Identifier: MIT
// packages/core/src/observability/redaction.ts
// Exercises: OBS-11..18
import {invariant} from '../invariant.js';

const DEFAULT_QUERY_ALLOW_LIST = new Set(['api-version']);
const DEFAULT_HEADER_ALLOW_LIST = new Set([
  'content-type',
  'content-length',
  'accept',
  'user-agent',
]);
const MALFORMED_URL_SENTINEL = '[malformed url]';

function redactQueryString(
  search: URLSearchParams,
  allowList: ReadonlySet<string>,
): string {
  const pairs: string[] = [];
  for (const [key, value] of search) {
    const val = allowList.has(key.toLowerCase())
      ? encodeURIComponent(value)
      : '***';
    pairs.push(`${encodeURIComponent(key)}=${val}`);
  }
  return pairs.join('&');
}

function redactFragment(hash: string, allowList: ReadonlySet<string>): string {
  if (hash === '' || hash === '#') return hash;
  const raw = hash.slice(1);
  if (!raw.includes('=')) return hash;
  const tokens = raw.split('&').map(token => {
    const [key, ...rest] = token.split('=');
    if (key === undefined || rest.length === 0) return token;
    return allowList.has(key.toLowerCase()) ? token : `${key}=***`;
  });
  return `#${tokens.join('&')}`;
}

function hasQueryDelimiter(input: URL | string): boolean {
  const raw = typeof input === 'string' ? input : input.href;
  const beforeFragment = raw.split('#')[0] ?? raw;
  return beforeFragment.includes('?');
}

function hasHashDelimiter(input: URL | string): boolean {
  const raw = typeof input === 'string' ? input : input.href;
  return raw.includes('#');
}

/**
 * Redacts sensitive components from a URL according to spec rules (OBS-11..15).
 *
 * **The result is a re-rendered URL, not the caller's string with holes in it.** Every input goes
 * through WHATWG `URL`, and the output is assembled from its parsed components, so the normalisations
 * parsing performs come with it: the host is lower-cased, a default port for the scheme
 * (`https://h:443/`) is dropped, a missing path becomes `/`, and percent-encoding is canonicalised.
 * A log line therefore need not match the request line byte for byte. That is inherent to parsing and
 * is left as is deliberately (audit #67 / #80): re-rendering the original authority by hand would mean
 * a second URL renderer in this package, maintained against WHATWG, for no gain in what OBS-11..15
 * actually asks for — that userinfo, non-allow-listed query values and fragment values do not reach a
 * log. Compare identity elsewhere; this is for humans and log pipelines.
 *
 * @param input - the URL or string to redact.
 * @param queryAllowList - set of allowed query parameter names (default: \{api-version\}).
 * @returns the redacted URL string, or '[malformed url]' if parsing fails.
 *
 * @internal
 */
export function redactUrl(
  input: URL | string,
  queryAllowList: ReadonlySet<string> = DEFAULT_QUERY_ALLOW_LIST,
): string {
  try {
    const rawInput = typeof input === 'string' ? input : input.href;
    const url = typeof input === 'string' ? new URL(input) : input;
    const userinfo =
      url.username !== '' || url.password !== '' ? '***:***@' : '';
    const normalizedAllowList =
      queryAllowList === DEFAULT_QUERY_ALLOW_LIST
        ? DEFAULT_QUERY_ALLOW_LIST
        : new Set(Array.from(queryAllowList, k => k.toLowerCase()));
    const query = redactQueryString(url.searchParams, normalizedAllowList);
    let fragment = redactFragment(url.hash, normalizedAllowList);
    // WHATWG URL normalizes empty query '?' and hash '#' to empty strings; preserve original delimiter presence.
    if (fragment === '' && hasHashDelimiter(input)) {
      fragment = '#';
    }
    const separator = query !== '' || hasQueryDelimiter(input) ? '?' : '';
    const slashes =
      url.host !== '' || rawInput.startsWith(`${url.protocol}//`) ? '//' : '';
    return `${url.protocol}${slashes}${userinfo}${url.host}${url.pathname}${separator}${query}${fragment}`;
  } catch {
    return MALFORMED_URL_SENTINEL;
  }
}

/** Handles header values (like Location or Content-Location) that may be absolute URLs or relative paths. */
function redactAbsoluteOrRelativeUrl(value: string): string {
  try {
    return redactUrl(new URL(value));
  } catch {
    const hasQueryOrFragment = value.includes('?') || value.includes('#');
    if (!hasQueryOrFragment) return value;
    const path = value.split(/[?#]/u)[0] ?? value;
    return `${path}?***`;
  }
}

/**
 * Policy for handling non-allow-listed headers (OBS-18).
 *
 * @public
 */
export type DroppedHeaderPolicy = 'mark' | 'omit';

const REDACTED_MARKER = 'REDACTED';

/**
 * Redacts a header value based on header name allow-list and policy (OBS-16..18).
 *
 * @param name - the header name.
 * @param value - the header value.
 * @param policy - whether to mark with REDACTED or omit (default: 'mark').
 * @returns the redacted value, or undefined if omitted.
 *
 * @internal
 */
export function redactHeaderValue(
  name: string,
  value: string,
  policy: DroppedHeaderPolicy = 'mark',
): string | undefined {
  invariant(
    typeof name === 'string',
    'redactHeaderValue: name must be a string',
  );
  invariant(
    typeof value === 'string',
    'redactHeaderValue: value must be a string',
  );

  const lowerName = name.toLowerCase();
  if (lowerName === 'location' || lowerName === 'content-location') {
    return redactAbsoluteOrRelativeUrl(value);
  }
  if (DEFAULT_HEADER_ALLOW_LIST.has(lowerName)) return value;
  return policy === 'mark' ? REDACTED_MARKER : undefined;
}
