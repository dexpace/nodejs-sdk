// SPDX-License-Identifier: MIT
// packages/core/src/config/http-date.ts

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const HTTP_DATE =
  /^(?:[A-Za-z]{3,9},\s+)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(?:GMT|UTC|\+00:?00)$/u;

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * CFG-29: the canonical RFC 1123 HTTP-date form, always UTC, e.g. `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * @param epochMs - the instant, in epoch milliseconds.
 * @returns the canonical RFC 1123 rendering.
 *
 * @internal
 */
export function formatHttpDate(epochMs: number): string {
  const date = new Date(epochMs);
  const weekday = WEEKDAYS[date.getUTCDay()];
  const day = pad2(date.getUTCDate());
  const month = MONTHS[date.getUTCMonth()]?.replace(/^./u, c =>
    c.toUpperCase(),
  );
  const year = date.getUTCFullYear();
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
  return `${String(weekday)}, ${day} ${String(month)} ${String(year)} ${time} GMT`;
}

/**
 * CFG-30/CFG-31: a hand-written RFC 1123 parser, never `Date.parse` -- JS date-string parsing is
 * permissive and non-standardized across engines, the opposite of a total parser's contract.
 * Tolerant of an informational weekday (stripped, not validated -- CFG-30), a single-digit day, and
 * case-insensitive month/zone tokens (GMT/UTC/+0000/+00:00 all normalize to zero offset). Strict on
 * the rest: blank input and a missing post-weekday comma both fail (CFG-31); every field is
 * range-checked so an out-of-range value is REJECTED rather than silently rolled over by `Date.UTC`
 * into a valid but wrong instant.
 *
 * Total: never throws for any input.
 *
 * @param raw - the raw header value.
 * @returns the instant in epoch milliseconds, or `null` when the value is not a valid HTTP-date.
 *
 * @internal
 */
export function parseHttpDate(raw: string): number | null {
  const match = HTTP_DATE.exec(raw);
  if (match === null) return null;
  const day = Number(match[1] ?? '');
  const month = MONTHS.indexOf((match[2] ?? '').toLowerCase());
  const year = Number(match[3] ?? '');
  const hour = Number(match[4] ?? '');
  const minute = Number(match[5] ?? '');
  const second = Number(match[6] ?? '');
  // A four-digit year below 100 is REJECTED rather than parsed: `Date.UTC` applies legacy
  // two-digit-year mapping to any year in [0, 99], so `0026` would silently become 1926 -- the
  // "valid but wildly wrong instant" CFG-31's range checks exist to prevent, and the one input that
  // would turn a malformed `Retry-After` into a past instant (RETRY-17's `0`, i.e. retry
  // immediately) instead of no-hint (RETRY-16's fall back to backoff).
  if (year < 100) return null;
  if (
    month < 0 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return null;
  }
  // `second === 60` is RFC 9110's leap-second allowance and is deliberately admitted. `Date.UTC`
  // maps it to the first second of the following minute, which is the correct next real instant on
  // a calendar with no leap-second slot -- a documented normalization, not the silent field
  // rollover the range checks above reject.
  return Date.UTC(year, month, day, hour, minute, second);
}
