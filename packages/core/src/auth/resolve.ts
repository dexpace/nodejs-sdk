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
  /** The per-operation tier. No shipped source yet — see the roadmap's Deferred Items Log. */
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
 * @throws InvariantViolation when every tier is absent — a caller misconfiguration, not an
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
