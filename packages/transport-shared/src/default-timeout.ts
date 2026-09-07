// SPDX-License-Identifier: MIT
// packages/transport-shared/src/default-timeout.ts

/**
 * `AbortSignal.timeout()`'s upper bound, and therefore every transport's. Duplicated from
 * `@dexpace/core`'s `http/request-options.ts:12`, which is not exported: the two must agree, and
 * `RequestOptionsBuilder.timeoutMs`'s own rejection message is the wording copied below so a caller
 * who trips either one reads the same sentence.
 */
const MAX_TIMEOUT_MS = 2 ** 32 - 1;

/**
 * Rejects a transport-wide default timeout that no transport could honour.
 *
 * The range is `AbortSignal.timeout()`'s — an integer in `1 .. 2**32 - 1` — because that is the
 * only range the thing this value ends up in accepts. `RequestOptionsBuilder.timeoutMs` has checked
 * exactly this since audit #67 / #76, on HTTP-35's reading that a timeout a setter accepted and a
 * transport then refused is a failure belonging at the call site. `defaultTimeoutMs` was left
 * unchecked on both transports and so became the last path by which `1.5`, `0` or `2**32` reached
 * `composeSignal` — where Node throws `RangeError` and Bun 1.3.14 accepts the first two, so the same
 * misconfiguration was a failed send on one runtime and a silently different deadline on the other
 * (audit #67 / #82).
 *
 * A `TypeError`, matching the construction-time refusals both transports already raise for a
 * caller misconfiguration (`undiciTransport`'s two) and deliberately outside the `IoError` tree —
 * though nothing retries a factory, the conformance row asserts the same shape for both, and a
 * transport is easier to reason about when every construction-time refusal is one class.
 *
 * @param value - the configured default, or `undefined` for none.
 * @throws `TypeError` when a defined value is zero, negative, not finite, not an integer, or
 * greater than `2**32 - 1`.
 *
 * @internal
 */
export function requireValidDefaultTimeoutMs(value: number | undefined): void {
  if (
    value === undefined ||
    (Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS)
  ) {
    return;
  }
  throw new TypeError(
    `defaultTimeoutMs must be an integer number of milliseconds in 1..${String(MAX_TIMEOUT_MS)}, ` +
      `got ${String(value)}: it is handed to AbortSignal.timeout(), which accepts nothing else`,
  );
}
