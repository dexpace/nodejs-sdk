// SPDX-License-Identifier: MIT
// packages/core/src/auth/resolve.ts
import {invariant} from '../invariant.js';
import type {AuthDescriptor} from './descriptor.js';
import {AuthResolutionError} from './errors.js';
import type {AuthRequirement} from './requirement.js';
import type {AuthScheme} from './scheme.js';

/**
 * AUTH-4's three configuration tiers, most specific first. Every slot is optional; at least one must
 * be present at resolution time.
 *
 * @public
 */
export interface AuthTiers {
  /** The per-call override, sourced from `RequestOptions.auth` by the AUTH pillar step. */
  readonly perCall?: AuthDescriptor | undefined;
  /**
   * The per-operation tier, sourced from `RequestOptions.operationAuth` by the AUTH pillar step.
   * Selection is `perCall ?? operation ?? client`.
   *
   * It had no source until 2026-09-04, and the cost of that was measured rather than assumed: a
   * consumer with per-operation descriptors had to fold them into `perCall` itself, which
   * reimplemented this very precedence rule outside core and left core unable to tell a genuine
   * per-call override from an operation's declared requirement. `examples/petstore/FINDINGS.md` §4
   * is that measurement; `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1 records the fix.
   */
  readonly operation?: AuthDescriptor | undefined;
  /** The client-wide tier, fixed at step construction. */
  readonly client?: AuthDescriptor | undefined;
}

/**
 * Resolves the single {@link AuthRequirement} a call should satisfy (AUTH-4, AUTH-5, AUTH-7).
 *
 * Tier selection is `perCall ?? operation ?? client` — the first tier PRESENT, not the first that
 * succeeds. If the selected tier lists no satisfiable scheme, {@link AuthResolutionError} is thrown
 * naming that tier's schemes; a lower tier is never consulted, because the caller asked for the
 * override explicitly (AUTH-4).
 *
 * Satisfiability is judged on scheme identity alone (AUTH-5): `NO_AUTH` always, otherwise membership
 * in `availableSchemes`. No concrete credential value is ever inspected, which is why the caller
 * derives `availableSchemes` from the credential types it configured rather than passing credentials
 * in.
 *
 * Pure and stateless (AUTH-7): the returned requirement is the very object the descriptor already
 * holds, not a copy.
 *
 * @param tiers - the three configuration tiers; at least one must be present.
 * @param availableSchemes - the schemes a credential is actually configured for.
 * @returns the first satisfiable requirement from the selected tier, in declared order.
 * @throws AuthResolutionError when the selected tier lists no satisfiable scheme (AUTH-6).
 * @throws an assertion failure (a caller bug, not a catchable condition) when every tier is absent — a caller misconfiguration, not an
 *   operational failure (AUTH-6, per the plan's Global Constraints).
 *
 * @public
 */
export function resolveAuthRequirement(
  tiers: AuthTiers,
  availableSchemes: ReadonlySet<AuthScheme>,
): AuthRequirement {
  const descriptor = tiers.perCall ?? tiers.operation ?? tiers.client;
  invariant(
    descriptor !== undefined,
    'resolveAuthRequirement: at least one auth tier must be configured',
  );

  const match = descriptor.requirements.find(
    requirement =>
      requirement.scheme === 'NO_AUTH' ||
      availableSchemes.has(requirement.scheme),
  );
  if (match === undefined) {
    const requiredSchemes = descriptor.requirements.map(
      requirement => requirement.scheme,
    );
    throw AuthResolutionError.unsatisfiable(requiredSchemes, [
      ...availableSchemes,
    ]);
  }
  return match;
}
