// SPDX-License-Identifier: MIT
// packages/core/src/retry/pacing.ts
// Phase 7a retrofit: this module previously hand-rolled its own private RFC 1123 parser here (a
// HTTP_DATE regex, a MONTHS table, and a local `parseHttpDate` function, tolerant of an
// informational weekday and a single-digit day -- never `Date.parse`, since JS date-string parsing
// is permissive and non-standardized across engines, the opposite of RETRY-16's totality mandate).
// Phase 7a's `config/http-date.ts` is a superset (it adds the formatter this module never needed)
// built to the identical grammar, so that private copy is deleted and this line imports the shared
// one instead -- one RFC 1123 parser in the codebase, not two.
import {parseHttpDate} from '../config/http-date.js';
import type {Headers} from '../http/headers.js';

/** RETRY-18/RECOV-26: every computed delta is clamped to this ceiling before use. */
const MAX_PACING_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * RETRY-19: the strict decimal grammar that screens a value BEFORE any float parse. Deliberately
 * rejects a leading sign, exponent notation, whitespace, and every type-suffixed or hex-float form --
 * `Number()` would happily accept several of them and produce a wildly wrong instant.
 */
const DECIMAL_SECONDS = /^\d+(?:\.\d+)?$/u;
const DECIMAL_INTEGER = /^\d+$/u;

function clampPacing(deltaMs: number): number {
  return Math.min(Math.max(0, deltaMs), MAX_PACING_MS);
}

function parseDeltaSeconds(raw: string): number | null {
  if (!DECIMAL_SECONDS.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function parseIntegerValue(raw: string | undefined): number | null {
  if (raw === undefined || !DECIMAL_INTEGER.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseRetryAfter(raw: string, nowMs: number): number | null {
  const seconds = parseDeltaSeconds(raw);
  if (seconds !== null) return clampPacing(seconds);
  const instant = parseHttpDate(raw);
  return instant === null ? null : clampPacing(instant - nowMs);
}

function parseRateLimitReset(
  headers: Headers,
  nowMs: number,
  random: () => number,
): number | null {
  const epochSeconds = parseIntegerValue(headers.get('X-RateLimit-Reset'));
  if (epochSeconds === null) return null;
  const delta = clampPacing(epochSeconds * 1000 - nowMs);
  // RECOV-25: positive jitter to [100%,120%] so many clients released at one reset instant do not
  // stampede. A literal Retry-After receives no such perturbation (RETRY-20).
  return delta === 0 ? 0 : clampPacing(delta * (1 + random() * 0.2));
}

/**
 * Resolves a server pacing hint from a response's headers, honoring the fixed precedence of
 * RETRY-21/RECOV-24: `Retry-After` numeric, then `Retry-After` as an HTTP-date, then
 * `retry-after-ms`, then `x-ms-retry-after-ms`, then `X-RateLimit-Reset`. First parseable value
 * wins.
 *
 * TOTAL by contract (RETRY-16/RECOV-23): it never throws for any input. Malformed, negative, or
 * out-of-range values map to `null` -- "no hint" -- so the caller falls back to exponential backoff.
 * They MUST NOT map to `0`, which would hammer a server that just asked for room. `0` is reserved
 * for a validly-parsed instant already in the past (RETRY-17).
 *
 * @param headers - the discarded response's headers, read while it is still live.
 * @param nowMs - the wall-clock instant the date forms are measured against.
 * @param random - the uniform [0,1) source RECOV-25's reset jitter draws from.
 * @returns milliseconds to wait, or `null` when no usable hint is present.
 *
 * @internal
 */
export function parsePacingHint(
  headers: Headers,
  nowMs: number,
  random: () => number,
): number | null {
  const retryAfter = headers.get('Retry-After');
  if (retryAfter !== undefined) {
    const parsed = parseRetryAfter(retryAfter, nowMs);
    if (parsed !== null) return parsed;
  }
  const deltaMs =
    parseIntegerValue(headers.get('retry-after-ms')) ??
    parseIntegerValue(headers.get('x-ms-retry-after-ms'));
  if (deltaMs !== null) return clampPacing(deltaMs);
  return parseRateLimitReset(headers, nowMs, random);
}
