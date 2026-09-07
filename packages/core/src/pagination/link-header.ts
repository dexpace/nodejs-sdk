// SPDX-License-Identifier: MIT
// packages/core/src/pagination/link-header.ts

export interface LinkValue {
  /** The raw target inside the angle brackets, unresolved. */
  readonly target: string;
  /** The `rel` tokens, lowercased and split on whitespace. Empty when the link-value carried no `rel`. */
  readonly rel: readonly string[];
}

/**
 * Parse an RFC 5988/8288 `Link` header into its link-values (PAGE-18).
 *
 * A regular expression is the wrong tool here and a hand-rolled scanner is the right one, because the
 * separator rules are context-sensitive in two directions at once: a comma splits link-values **only** outside
 * both angle brackets and quoted strings, and a semicolon splits parameters under the same condition. A quoted
 * string additionally supports quoted-pair escapes (`\"`), so quote tracking cannot be a simple toggle.
 *
 * @internal
 */
export function parseLinkHeader(value: string): readonly LinkValue[] {
  const out: LinkValue[] = [];
  for (const raw of splitTopLevel(value, ',')) {
    const parsed = parseOne(raw);
    if (parsed !== undefined) out.push(parsed);
  }
  return out;
}

/**
 * The first target whose `rel` contains the token `next`, case-insensitively (PAGE-18).
 *
 * Multiple `Link` header instances are normalized by concatenation before parsing (PAGE-20), which is exactly
 * what the RFC's own list semantics allow. An empty header set maps to no next link.
 *
 * @internal
 */
export function findNextLink(
  headerValues: readonly string[],
): string | undefined {
  const combined = headerValues.filter(v => v.trim().length > 0).join(', ');
  if (combined.length === 0) return undefined;
  for (const link of parseLinkHeader(combined)) {
    if (link.rel.includes('next')) return link.target;
  }
  return undefined;
}

function parseOne(raw: string): LinkValue | undefined {
  const trimmed = raw.trim();
  const open = trimmed.indexOf('<');
  const close = trimmed.indexOf('>', open + 1);
  if (open === -1 || close === -1) return undefined;

  const target = trimmed.slice(open + 1, close).trim();
  const rel: string[] = [];

  for (const parameter of splitTopLevel(trimmed.slice(close + 1), ';')) {
    const eq = parameter.indexOf('=');
    if (eq === -1) continue;
    if (parameter.slice(0, eq).trim().toLowerCase() !== 'rel') continue;
    // `rel` may be quoted or unquoted, and a quoted value may list several whitespace-separated types.
    rel.push(
      ...unquote(parameter.slice(eq + 1).trim())
        .toLowerCase()
        .split(/[\s]+/)
        .filter(t => t.length > 0),
    );
  }

  return {target, rel: Object.freeze(rel)};
}

/** Split on `separator` only at depth zero — outside `<...>` and outside a quoted string. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inAngle = false;
  let inQuotes = false;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (inQuotes && char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && char === '<') inAngle = true;
    else if (!inQuotes && char === '>') inAngle = false;

    if (char === separator && !inAngle && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.filter(part => part.trim().length > 0);
}

/** Strip surrounding double quotes and unescape quoted pairs. */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2)
    return value;
  return value.slice(1, -1).replace(/\\(.)/g, '$1');
}
