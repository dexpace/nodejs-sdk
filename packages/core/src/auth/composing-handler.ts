// SPDX-License-Identifier: MIT
// packages/core/src/auth/composing-handler.ts
import type {
  Challenge,
  ChallengeHandler,
  DigestUriContext,
} from './challenge.js';

/**
 * Ordered delegation over a fixed handler list (AUTH-23–AUTH-25).
 *
 * @internal
 */
export interface ComposingHandler {
  /**
   * Answers the best challenge any configured handler can satisfy.
   *
   * @param challenges - every challenge the response offered, in wire order.
   * @param request - the request being stamped, for handlers that need method and target.
   * @returns the header VALUE, or `undefined` when no handler can satisfy any offered challenge —
   *   which the auth step reads as "no replacement request" (AUTH-25).
   */
  stamp(
    challenges: readonly Challenge[],
    request?: DigestUriContext,
  ): Promise<string | undefined>;
}

interface Candidate {
  readonly handlerIndex: number;
  readonly rank: number;
  readonly handler: ChallengeHandler;
  readonly challenge: Challenge;
}

function collectCandidates(
  handlers: readonly ChallengeHandler[],
  challenges: readonly Challenge[],
): Candidate[] {
  const candidates: Candidate[] = [];
  handlers.forEach((handler, handlerIndex) => {
    for (const challenge of challenges) {
      if (handler.canHandle(challenge)) {
        candidates.push({
          handlerIndex,
          rank: handler.rank?.(challenge) ?? 0,
          handler,
          challenge,
        });
      }
    }
  });
  return candidates;
}

/**
 * AUTH-23: handler CONFIGURATION order is the primary key — "the first handler in declaration order
 * whose can-handle check passes" wins regardless of where its satisfiable challenge sits on the wire.
 * `rank` is the secondary key, carrying AUTH-16's algorithm-preference-over-wire-order rule within a
 * single handler.
 */
function bestCandidate(
  candidates: readonly Candidate[],
): Candidate | undefined {
  return [...candidates].sort(
    (a, b) => a.handlerIndex - b.handlerIndex || a.rank - b.rank,
  )[0];
}

/**
 * Composes an ordered handler list into one challenge answerer (AUTH-23–AUTH-25).
 *
 * The list is defensively copied at construction (AUTH-23), so a caller mutating its array afterwards
 * cannot change which handlers this composer consults. Callers order stronger schemes first — the
 * auth step builds `[digest, basic]`.
 *
 * Returns `undefined` — meaning "no replacement request" — when no handler can satisfy any offered
 * challenge (AUTH-25). It never throws: an unsatisfiable challenge is an ordinary outcome the auth
 * step turns into "leave the 401 unchanged" (AUTH-33), not an error condition.
 *
 * AUTH-25's `Authorization`-vs-`Proxy-Authorization` choice is NOT threaded through here: this
 * composer and both handlers produce the VALUE half only, and `auth-step.ts` picks the header name
 * from which challenge header the status actually carried.
 *
 * Handlers are stateless apart from Digest's per-nonce counter, which is safe for concurrent
 * invocation (AUTH-24).
 *
 * @param handlers - the handlers, strongest first.
 * @returns the composed handler.
 *
 * @internal
 */
export function composingHandler(
  handlers: readonly ChallengeHandler[],
): ComposingHandler {
  const configured = [...handlers];
  return {
    stamp: async (challenges, request): Promise<string | undefined> => {
      const candidate = bestCandidate(
        collectCandidates(configured, challenges),
      );
      if (candidate === undefined) return undefined;
      return candidate.handler.stamp(candidate.challenge, request);
    },
  };
}
