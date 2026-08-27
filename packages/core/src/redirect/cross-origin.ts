// SPDX-License-Identifier: MIT
// packages/core/src/redirect/cross-origin.ts
import type {Headers} from '../http/headers.js';

/**
 * The RFC 6454 origin tuple REDIR-8 compares on. Held as a value rather than reusing `URL.origin`'s
 * string form so the port is already normalized to the scheme default and the host already lower-cased
 * -- `URL.origin` renders an omitted default port and an explicit one identically, but does nothing for
 * a scheme this SDK does not follow.
 *
 * @internal
 */
export interface Origin {
  readonly scheme: string;
  readonly host: string;
  readonly port: number;
}

const DEFAULT_PORT_BY_SCHEME: ReadonlyMap<string, number> = new Map([
  ['http:', 80],
  ['https:', 443],
]);

/** REDIR-8: an omitted port normalizes to the scheme's default before comparison. */
function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return DEFAULT_PORT_BY_SCHEME.get(url.protocol.toLowerCase()) ?? 0;
}

/**
 * Extracts the comparable origin tuple. `URL.hostname` keeps a bracketed IPv6 literal bracketed and
 * already lower-cases a registered name, so nothing here re-encodes the host (REDIR-13).
 *
 * @param url - the URL whose origin is wanted.
 * @returns the normalized scheme/host/effective-port tuple.
 *
 * @internal
 */
export function originOf(url: URL): Origin {
  return {
    scheme: url.protocol.toLowerCase(),
    host: url.hostname.toLowerCase(),
    port: effectivePort(url),
  };
}

/**
 * REDIR-8: scheme/host(case-insensitive)/effective-port comparison against the SEED request's origin --
 * never the previous hop -- so a same-origin sub-redirect on a foreign host cannot re-expose the
 * credential a cross-origin hop already stripped. `new URL(...)` never performs DNS resolution, so there
 * is no `java.net.URL.equals()` hostname-resolution trap of the kind the JVM reference works around.
 *
 * @param seedOrigin - the origin of the ORIGINAL request, fixed for the whole chain.
 * @param target - the resolved redirect target.
 * @returns `true` when the target differs in scheme, host, or effective port.
 *
 * @internal
 */
export function isCrossOrigin(seedOrigin: Origin, target: URL): boolean {
  const targetOrigin = originOf(target);
  return (
    targetOrigin.scheme !== seedOrigin.scheme ||
    targetOrigin.host !== seedOrigin.host ||
    targetOrigin.port !== seedOrigin.port
  );
}

/**
 * REDIR-11's out-of-band signal, carried as a real header rather than an in-process marker.
 *
 * A `WeakSet<Request>` keyed by object identity was the alternative and is unforgeable, but stage order
 * is REDIRECT -> RETRY -> AUTH and 5a's attempt-stamping builds a FRESH per-attempt `Request` copy when
 * enabled -- an identity-keyed signal would silently stop matching the moment a retry sits between
 * redirect and auth, which is exactly when cross-origin credential suppression must still hold. Stamping
 * preserves headers, so a header survives that intermediate copy. `strip-marker-step.ts` is what keeps
 * it off the wire.
 *
 * @internal
 */
export const CROSS_ORIGIN_MARKER_HEADER =
  'x-dexpace-internal-redirect-cross-origin';

/**
 * REDIR-11(a): `HeadersBuilder.set` with a non-null value REPLACES the whole value list, so this is
 * clear-then-set in one call -- a forged or stale inbound copy cannot survive alongside our own.
 *
 * @param headers - the next hop's headers so far.
 * @returns headers carrying exactly one marker value.
 *
 * @internal
 */
export function withCrossOriginMarker(headers: Headers): Headers {
  return headers.newBuilder().set(CROSS_ORIGIN_MARKER_HEADER, '1').build();
}

/**
 * Idempotent -- clearing an already-absent header is a no-op.
 *
 * @param headers - the headers to strip the marker from.
 * @returns headers with no marker.
 *
 * @internal
 */
export function clearCrossOriginMarker(headers: Headers): Headers {
  return headers.newBuilder().set(CROSS_ORIGIN_MARKER_HEADER, null).build();
}

/**
 * REDIR-11(b): the marker only ever SUPPRESSES credential stamping; nothing reads it to cause one.
 * Phase 5c's auth step is its first real consumer.
 *
 * @param headers - the headers to inspect.
 * @returns `true` when the marker is present.
 *
 * @internal
 */
export function hasCrossOriginMarker(headers: Headers): boolean {
  return headers.has(CROSS_ORIGIN_MARKER_HEADER);
}
