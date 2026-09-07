// SPDX-License-Identifier: MIT
// packages/core/src/config/retryable.ts
import {InvariantViolation} from '../invariant.js';

function buildRetryableStatuses(): Set<number> {
  const codes = new Set<number>([408, 429]);
  for (let code = 500; code <= 599; code += 1) {
    // 501 Not Implemented and 505 HTTP Version Not Supported both say the server cannot fulfill the
    // request in the form it was asked, no matter how many times it is asked again.
    if (code !== 501 && code !== 505) codes.add(code);
  }
  return codes;
}

/** Refuses a mutation of the set the barrel publishes as a contract (CFG-35). */
function denyMutation(operation: string): () => never {
  return () => {
    throw new InvariantViolation(
      `RETRYABLE_STATUSES is immutable: ${operation} is not permitted (CFG-35)`,
    );
  };
}

/**
 * The single retryable-status definition (CFG-35): exactly 408, 429, and every 5xx except 501 and
 * 505. Where implemented, this exact set is a hard contract, so it lives in one place and every
 * consumer -- the retry engine's `RETRY-1` classifier included -- re-exports it rather than
 * restating it.
 *
 * The `ReadonlySet` *type* is not enough on its own, and neither is `Object.freeze`, which does not
 * seal a `Set`'s internal slots -- `add`/`delete`/`clear` go straight past it. Phase 1's
 * `IDEMPOTENT_METHODS` can live with that because it is module-private and unreachable; this binding
 * leaves through the package barrel, where `(RETRYABLE_STATUSES as Set<number>).add(418)` used to
 * succeed and permanently rewrite the process-wide classifier. So the three mutators become own
 * properties that throw, and the freeze is what stops them being defined back.
 *
 * @public
 */
export const RETRYABLE_STATUSES: ReadonlySet<number> = Object.freeze(
  Object.defineProperties(buildRetryableStatuses(), {
    add: {value: denyMutation('add')},
    delete: {value: denyMutation('delete')},
    clear: {value: denyMutation('clear')},
  }),
);

/**
 * Whether a response status is retryable (CFG-35).
 *
 * @param code - the HTTP status code.
 * @returns `true` for 408, 429, and 5xx other than 501 and 505; `false` otherwise.
 *
 * @public
 */
export function isRetryableStatus(code: number): boolean {
  return RETRYABLE_STATUSES.has(code);
}
