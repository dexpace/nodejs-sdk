// SPDX-License-Identifier: MIT
// packages/core/src/config/http-date.ts
import {invariant} from '../invariant.js';

/** Month abbreviations in canonical casing, indexed by `Date`'s zero-based UTC month. */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Weekday abbreviations in canonical casing, indexed by `Date`'s zero-based UTC day. */
const WEEKDAY_NAMES = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

/**
 * The RFC 1123 grammar this parser accepts. The leading weekday group is optional *as a whole*, so
 * dropping the comma after it does not degrade into "no weekday" -- the day-of-month group then has
 * to match the weekday text and fails, which is exactly CFG-31's missing-comma rejection.
 */
const HTTP_DATE =
  /^(?:[a-z]{3,9},\s+)?(\d{1,2})\s+([a-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(?:GMT|UTC|\+00:?00)$/iu;

/** RFC 1123's `date1` is a four-digit year, so these are the only instants CFG-29 can render. */
const MIN_HTTP_DATE_YEAR = 0;
const MAX_HTTP_DATE_YEAR = 9999;

function padTwoDigits(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * Formats an instant as the canonical RFC 1123 HTTP-date (CFG-29): always UTC, a zero-padded
 * two-digit day-of-month, and a literal `GMT` -- e.g. `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * @param epochMs - the instant, in epoch milliseconds.
 * @returns the canonical HTTP-date string.
 * @throws an assertion failure (a caller bug, not a catchable condition) when `epochMs` is not a finite number in `Date`'s representable range,
 *   or falls outside the four-digit-year span RFC 1123 can render -- a programmer error, not a value
 *   any wire input can produce.
 *
 * @public
 */
export function formatHttpDate(epochMs: number): string {
  const date = new Date(epochMs);
  invariant(
    !Number.isNaN(date.getTime()),
    `formatHttpDate: epochMs must be a representable instant, got ${String(epochMs)}`,
  );
  const year = date.getUTCFullYear();
  // A second, narrower bound than `Date`'s own. RFC 1123's `date1` carries a four-digit year, and
  // `padStart(4, '0')` cannot render one outside 0000..9999: year -1 came out as `00-1` and year
  // 275760 as `275760`, both malformed HTTP-dates emitted with no error at all, and neither
  // survived a round-trip back through `parseHttpDate` (CFG-29).
  invariant(
    year >= MIN_HTTP_DATE_YEAR && year <= MAX_HTTP_DATE_YEAR,
    `formatHttpDate: epochMs must fall in the four-digit-year range RFC 1123 renders, got year ${String(year)}`,
  );
  // `getUTCDay()` is 0..6 and `getUTCMonth()` 0..11 for the representable date the invariant above
  // guarantees, so both lookups always hit; `noUncheckedIndexedAccess` cannot see that. An
  // `invariant` rather than a `?? ''` fallback, because a silent empty string here would emit a
  // malformed HTTP-date with no error at all -- the same failure the year check above exists to stop.
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const month = MONTH_NAMES[date.getUTCMonth()];
  invariant(
    weekday !== undefined && month !== undefined,
    `formatHttpDate: unreachable -- no weekday or month name for epochMs ${String(epochMs)}`,
  );
  const day = padTwoDigits(date.getUTCDate());
  const yearText = String(year).padStart(4, '0');
  const hours = padTwoDigits(date.getUTCHours());
  const minutes = padTwoDigits(date.getUTCMinutes());
  const seconds = padTwoDigits(date.getUTCSeconds());
  return `${weekday}, ${day} ${month} ${yearText} ${hours}:${minutes}:${seconds} GMT`;
}

/** The already-range-checked UTC fields {@link toEpochMs} assembles into an instant. */
interface DateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Builds an instant from already-range-checked UTC fields, rejecting any combination `Date` would
 * silently roll over (`31 Feb`, `31 Apr`). `Date.UTC` cannot be used directly: it maps a two-digit
 * year onto 1900-1999, which would turn `0026` into 1926 without any error.
 */
function toEpochMs(fields: DateFields): number | null {
  const {year, month, day, hour, minute, second} = fields;
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  const rolledOver =
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day;
  if (rolledOver) return null;
  // Applied only after the calendar check, so a leap second (:60) rolls into the following minute
  // without that rollover being misread as an out-of-range day.
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/**
 * Parses an RFC 1123 HTTP-date, total: any string that is not a valid date yields `null` rather
 * than throwing.
 *
 * Never `Date.parse`/`new Date(string)` -- JS date-string parsing is permissive and non-standardized
 * across engines, the opposite of a total parser's contract.
 *
 * Tolerant (CFG-30) of an informational weekday, which is stripped and never validated against the
 * date; a single-digit day; case-insensitive month names; and the zone tokens `GMT`, `UTC`, `+0000`,
 * and `+00:00`, which all normalize to a zero offset. Strict on the rest (CFG-31): blank input and a
 * missing comma after the weekday both fail, and every field is range-checked so an out-of-range
 * value is rejected rather than silently rolled over into a valid but wrong instant.
 *
 * @param raw - the candidate HTTP-date; surrounding whitespace is tolerated.
 * @returns the instant in epoch milliseconds, or `null` when `raw` is not a valid HTTP-date.
 *
 * @public
 */
export function parseHttpDate(raw: string): number | null {
  const match = HTTP_DATE.exec(raw.trim());
  if (match === null) return null;

  const day = Number(match[1]);
  const monthText = (match[2] ?? '').toLowerCase();
  const month = MONTH_NAMES.findIndex(
    candidate => candidate.toLowerCase() === monthText,
  );
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  // A leap second (:60) is accepted and normalizes into the following minute; every other field is
  // a hard range check.
  if (month < 0 || day < 1 || hour > 23 || minute > 59 || second > 60)
    return null;
  return toEpochMs({year, month, day, hour, minute, second});
}
