// SPDX-License-Identifier: MIT
// packages/core/src/config/retryable.ts

function buildRetryableStatuses(): ReadonlySet<number> {
  const codes = new Set<number>([408, 429]);
  for (let code = 500; code <= 599; code += 1) {
    // 501 Not Implemented and 505 HTTP Version Not Supported mean the server cannot fulfill the
    // request regardless of how many times it is asked.
    if (code !== 501 && code !== 505) codes.add(code);
  }
  return codes;
}

/**
 * CFG-35: the single retryable-status definition. `Object.freeze` does not seal a `Set`'s internal
 * slots, so a frozen `Set` would be a misleading no-op -- typed `ReadonlySet` instead, same
 * treatment as Phase 1's idempotent-method set. Phase 5a's retry engine re-exports this exact set
 * rather than defining its own (RETRY-1/RETRY-13).
 *
 * @internal
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = buildRetryableStatuses();

/**
 * Whether a status code is retryable per CFG-35's fixed set.
 *
 * @param code - the numeric status code.
 * @returns true when the code is in {@link RETRYABLE_STATUSES}.
 *
 * @internal
 */
export function isRetryableStatus(code: number): boolean {
  return RETRYABLE_STATUSES.has(code);
}
