// SPDX-License-Identifier: MIT
// packages/transport-shared/src/header-mapping.ts
import {Headers} from '@dexpace/core';

/* eslint-disable no-control-regex -- RFC 9110 requires testing for ASCII control characters */
const CONTROL_BYTE = /[\x00-\x08\x0B-\x1F\x7F]/u;
const NON_ASCII_OR_CONTROL = /[\x00-\x1F\x7F-\uFFFF]/u;
/* eslint-enable no-control-regex -- re-enable */

/**
 * Options for outbound header mapping.
 *
 * @internal
 */
export interface MapOutboundHeadersOptions {
  /** A media type derived from the request body to use if Content-Type is absent. */
  readonly bodyDerivedMediaType?: string | undefined;
}

/**
 * Filters forbidden framing headers and applies per-header degradation for outbound requests (TRANSPORT-10-12).
 *
 * @internal
 */
export function mapOutboundHeaders(
  headers: Headers,
  forbidden: readonly string[],
  opts: MapOutboundHeadersOptions = {},
): {sent: Headers; dropped: readonly string[]} {
  const forbiddenSet = new Set(forbidden.map(h => h.toLowerCase()));
  const dropped: string[] = [];
  const builder = Headers.newBuilder();
  for (const [name, value] of headers.entries()) {
    if (forbiddenSet.has(name.toLowerCase())) {
      dropped.push(name.toLowerCase());
      continue;
    }
    try {
      builder.add(name, value);
    } catch {
      dropped.push(name.toLowerCase());
    }
  }
  if (
    opts.bodyDerivedMediaType !== undefined &&
    headers.get('content-type') === undefined
  ) {
    try {
      builder.set('Content-Type', opts.bodyDerivedMediaType);
    } catch {
      dropped.push('content-type');
    }
  }
  return {sent: builder.build(), dropped};
}

/**
 * Leniently copies inbound response headers, dropping malformed entries while preserving obs-text (TRANSPORT-14).
 *
 * @internal
 */
export function degradeInboundHeaders(
  raw: Iterable<readonly [string, string]>,
): {headers: Headers; dropped: readonly string[]} {
  const dropped: string[] = [];
  const builder = Headers.newBuilder();
  for (const [name, value] of raw) {
    if (NON_ASCII_OR_CONTROL.test(name) || CONTROL_BYTE.test(value)) {
      dropped.push(name);
      continue;
    }
    try {
      builder.addInbound(name, value);
    } catch {
      dropped.push(name);
    }
  }
  return {headers: builder.build(), dropped};
}
