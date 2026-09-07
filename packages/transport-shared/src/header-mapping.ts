// SPDX-License-Identifier: MIT
// packages/transport-shared/src/header-mapping.ts
import {Headers} from '@dexpace/core';

/**
 * Every byte TRANSPORT-14 refuses in an *inbound* header value: the C0 controls except HTAB, plus
 * DEL. Deliberately the same character class as `@dexpace/core`'s `hasForbiddenInboundValueByte`,
 * which `Headers.addInbound` applies a few lines later \u2014 obs-text (\u2265 0x80) is carried, HTAB is
 * carried, everything else below 0x20 is not.
 *
 * `\x0A` was missing from Phase 8a until audit #67 / #82: the class read `\x0B-\x1F`, excepting LF
 * alongside the intended HTAB. Nothing observable changed, because `addInbound` rejected the value
 * anyway and the `try`/`catch` in {@link degradeInboundHeaders} recorded the same drop \u2014 which is
 * exactly why it survived, and why the test for this constant reads the class directly rather than
 * going through that function.
 *
 * Exported for that test only. The package barrel deliberately does not re-export it: it is one
 * half of a redundant pair, not plumbing another transport should reach for.
 *
 * @internal
 */
/* eslint-disable no-control-regex -- RFC 9110 requires testing for ASCII control characters */
export const CONTROL_BYTE = /[\x00-\x08\x0A-\x1F\x7F]/u;
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
