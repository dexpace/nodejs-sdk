// SPDX-License-Identifier: MIT
// packages/core/src/config/duration.ts

/** An ISO-8601 duration, months deliberately unsupported -- `P5M` is ambiguous, `PT5M` is not. */
const ISO_DURATION =
  /^p(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?$/iu;
const SHORTHAND_DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/iu;
const BARE_NUMBER = /^\d+(?:\.\d+)?$/u;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * The shorthand unit table. Built from the constants above rather than from its own literals: the
 * ISO-8601 and shorthand grammars are two spellings of one scale, and CFG-7 requires them to agree.
 */
const MS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['ms', 1],
  ['s', MS_PER_SECOND],
  ['m', MS_PER_MINUTE],
  ['h', MS_PER_HOUR],
  ['d', MS_PER_DAY],
]);

function parseIsoDuration(raw: string): number | null {
  const match = ISO_DURATION.exec(raw);
  if (match === null) return null;
  const [days, hours, minutes, seconds] = match.slice(1);
  // `P` and `PT` match with every group absent; a duration with no component at all is not a
  // duration, so it falls through to the caller's default rather than resolving to zero.
  if (
    days === undefined &&
    hours === undefined &&
    minutes === undefined &&
    seconds === undefined
  ) {
    return null;
  }
  return (
    Number(days ?? 0) * MS_PER_DAY +
    Number(hours ?? 0) * MS_PER_HOUR +
    Number(minutes ?? 0) * MS_PER_MINUTE +
    Number(seconds ?? 0) * MS_PER_SECOND
  );
}

function parseShorthandDuration(raw: string): number | null {
  const match = SHORTHAND_DURATION.exec(raw);
  if (match === null) return null;
  // Both groups are mandatory in `SHORTHAND_DURATION`, so a match guarantees both participated, and
  // the unit is one of `MS_PER_UNIT`'s five keys by construction of the alternation. The compiler
  // sees neither fact under `noUncheckedIndexedAccess`, so the destructuring defaults and the
  // `undefined` check below are unreachable and exist only to satisfy the index type.
  const [, amount = '', unit = ''] = match;
  const perUnit = MS_PER_UNIT.get(unit.toLowerCase());
  if (perUnit === undefined) return null;
  return Number(amount) * perUnit;
}

/**
 * CFG-7's grammar, total: ISO-8601 (`P`/`p`-prefixed), shorthand `<number><unit>` over ms/s/m/h/d
 * case-insensitively, or a bare number read as milliseconds. Every unrecognized form -- an unknown
 * unit, a negative, anything else -- yields `null` so the caller falls back to its default.
 *
 * Its own module rather than a helper inside `configuration.ts`: the grammar is a concept separate
 * from the layered lookup that happens to consume it (`docs/knowledge/module-organization.md:42`).
 * `Configuration.getDuration` is its only caller today.
 *
 * @param raw - the candidate duration; surrounding whitespace is tolerated.
 * @returns the duration in milliseconds, or `null` when `raw` is not one.
 *
 * @internal
 */
export function parseDurationMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (BARE_NUMBER.test(trimmed)) return Number(trimmed);
  return parseShorthandDuration(trimmed) ?? parseIsoDuration(trimmed);
}
