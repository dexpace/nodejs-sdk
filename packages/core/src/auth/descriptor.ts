// SPDX-License-Identifier: MIT
// packages/core/src/auth/descriptor.ts
import {invariant} from '../invariant.js';
import type {AuthRequirement} from './requirement.js';

/**
 * AUTH-3: a non-empty, immutable, ordered list of requirements in preference order.
 *
 * @public
 */
export interface AuthDescriptor {
  /** The requirements, in preference order. Never empty. */
  readonly requirements: readonly AuthRequirement[];
  /** `true` if and only if some requirement's scheme is `NO_AUTH` (AUTH-3). */
  readonly allowsAnonymous: boolean;
}

/**
 * Builds a frozen {@link AuthDescriptor}, copying the requirement list so later caller-side mutation
 * cannot reach the stored value (AUTH-3).
 *
 * An empty list is a PROGRAMMER error — a caller assembling zero requirements has a bug, not an
 * operational failure — so it goes through `invariant()`, the same call 5a's `retrySettings()` and
 * 5b's `redirectSettings()` made, rather than a typed error leaf.
 *
 * @param requirements - the requirements, in preference order. Must be non-empty.
 * @returns the frozen descriptor.
 * @throws an assertion failure (a caller bug, not a catchable condition) when `requirements` is empty (AUTH-3).
 *
 * @public
 */
export function createAuthDescriptor(
  requirements: readonly AuthRequirement[],
): AuthDescriptor {
  invariant(
    requirements.length > 0,
    'AuthDescriptor requires at least one AuthRequirement',
  );
  return Object.freeze({
    requirements: Object.freeze([...requirements]),
    allowsAnonymous: requirements.some(
      requirement => requirement.scheme === 'NO_AUTH',
    ),
  });
}
