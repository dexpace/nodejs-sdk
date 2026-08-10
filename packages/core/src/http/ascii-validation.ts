// SPDX-License-Identifier: MIT
// packages/core/src/http/ascii-validation.ts
/**
 * Reports whether `value` contains a byte forbidden in an outbound header value: anything outside
 * HTAB plus printable ASCII 0x20–0x7E (HTTP-18).
 *
 * Media-type construction reuses this exact predicate rather than reimplementing the character
 * class, so a media type is always header-safe and the two rules cannot drift (HTTP-26).
 *
 * @param value - the text to inspect.
 * @returns `true` when at least one byte is forbidden.
 */
export function hasForbiddenOutboundByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const allowed = code === 0x09 || (code >= 0x20 && code <= 0x7e);
    if (!allowed) return true;
  }
  return false;
}

/**
 * Reports whether `value` contains a byte forbidden in a header name: any C0 control, DEL, or
 * non-ASCII byte. Stricter than the value rule — HTAB is not excepted here (HTTP-17).
 *
 * @param value - the name to inspect, already trimmed.
 * @returns `true` when at least one byte is forbidden.
 */
export function hasForbiddenNameByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || code > 0x7e) return true;
  }
  return false;
}

/**
 * Reports whether `value` contains a byte forbidden in an *inbound* header value: control
 * characters (C0 except HTAB, plus DEL) only.
 *
 * Deliberately laxer than {@link hasForbiddenOutboundByte} — RFC 7230 permits obs-text (≥ 0x80) in
 * a response field value, and applying the outbound grammar inbound would silently drop legitimate
 * headers such as a Latin-1 `Content-Disposition` filename (HTTP-19).
 *
 * @param value - the text to inspect.
 * @returns `true` when at least one byte is forbidden.
 */
export function hasForbiddenInboundValueByte(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code <= 0x1f && code !== 0x09;
    const isDel = code === 0x7f;
    if (isControl || isDel) return true;
  }
  return false;
}
