// SPDX-License-Identifier: MIT
// packages/core/src/auth/composing-handler.test.ts
// Exercises: AUTH-23 (ordered handler list, defensively copied; first configured handler wins),
// AUTH-24 (handler order beats wire-order challenge position), AUTH-25 (returns the value half only
// -- no header-name decision here, and no header at all when nothing is satisfiable), and the
// rank-based tie-break that carries AUTH-16's algorithm preference.
import {describe, expect, test} from 'bun:test';
import type {Challenge, ChallengeHandler} from './challenge.js';
import {composingHandler} from './composing-handler.js';

function fakeHandler(
  scheme: string,
  value: string,
  rank = 0,
): ChallengeHandler {
  return {
    canHandle: (challenge: Challenge): boolean => challenge.scheme === scheme,
    stamp: (): Promise<string> => Promise.resolve(value),
    rank: (): number => rank,
  };
}

/**
 * Captures a rejection reason. `expect(...).rejects` is typed as returning `void` under this runner's
 * type definitions, so awaiting it trips `@typescript-eslint/await-thenable`; this helper keeps the
 * assertion honest without a lint suppression. Same shape 5a's and 5b's step suites settled on.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('composingHandler', () => {
  test('delegates to the first CONFIGURED handler that can satisfy any offered challenge', async () => {
    const handler = composingHandler([
      fakeHandler('digest', 'digest-value'),
      fakeHandler('basic', 'basic-value'),
    ]);
    const challenges: readonly Challenge[] = [
      {scheme: 'basic', params: new Map()},
      {scheme: 'digest', params: new Map()},
    ];
    // basic appears FIRST on the wire, but digest's HANDLER is configured first -- handler order wins.
    expect(await handler.stamp(challenges)).toBe('digest-value');
  });

  test('falls through to a later handler when the first cannot satisfy anything offered', async () => {
    const handler = composingHandler([
      fakeHandler('digest', 'digest-value'),
      fakeHandler('basic', 'basic-value'),
    ]);
    expect(await handler.stamp([{scheme: 'basic', params: new Map()}])).toBe(
      'basic-value',
    );
  });

  test('returns undefined when no handler can satisfy any offered challenge', async () => {
    const handler = composingHandler([fakeHandler('digest', 'x')]);
    expect(
      await handler.stamp([{scheme: 'basic', params: new Map()}]),
    ).toBeUndefined();
  });

  test('returns undefined for an empty challenge list', async () => {
    const handler = composingHandler([fakeHandler('digest', 'x')]);
    expect(await handler.stamp([])).toBeUndefined();
  });

  test('returns undefined when no handlers are configured at all', async () => {
    const handler = composingHandler([]);
    expect(
      await handler.stamp([{scheme: 'digest', params: new Map()}]),
    ).toBeUndefined();
  });
});

describe('composingHandler ranking and delegation (AUTH-16/AUTH-23)', () => {
  test('within one handler satisfying multiple challenges, rank breaks the tie', async () => {
    const digestLike: ChallengeHandler = {
      canHandle: challenge => challenge.scheme === 'digest',
      stamp: challenge =>
        Promise.resolve(
          `value-for-${challenge.params.get('algorithm') ?? 'default'}`,
        ),
      rank: challenge =>
        challenge.params.get('algorithm') === 'SHA-256' ? 0 : 1,
    };
    const handler = composingHandler([digestLike]);
    const challenges: readonly Challenge[] = [
      {scheme: 'digest', params: new Map([['algorithm', 'MD5']])},
      {scheme: 'digest', params: new Map([['algorithm', 'SHA-256']])},
    ];
    expect(await handler.stamp(challenges)).toBe('value-for-SHA-256');
  });

  test('rank never outranks handler order -- a worse-ranked earlier handler still wins', async () => {
    const handler = composingHandler([
      fakeHandler('digest', 'digest-value', 99),
      fakeHandler('basic', 'basic-value', 0),
    ]);
    const challenges: readonly Challenge[] = [
      {scheme: 'basic', params: new Map()},
      {scheme: 'digest', params: new Map()},
    ];
    expect(await handler.stamp(challenges)).toBe('digest-value');
  });

  test('a handler with no rank() defaults to 0 and does not crash the sort', async () => {
    const noRank: ChallengeHandler = {
      canHandle: (): boolean => true,
      stamp: (): Promise<string> => Promise.resolve('no-rank-value'),
    };
    const handler = composingHandler([noRank]);
    expect(await handler.stamp([{scheme: 'anything', params: new Map()}])).toBe(
      'no-rank-value',
    );
  });
});

describe('composingHandler isolation and error propagation (AUTH-23)', () => {
  test('defensively copies the handler list at construction (AUTH-23)', async () => {
    const handlers = [fakeHandler('basic', 'v1')];
    const handler = composingHandler(handlers);
    handlers.push(fakeHandler('digest', 'v2'));
    // 'digest' was pushed after construction, so the composed handler must not see it.
    expect(
      await handler.stamp([{scheme: 'digest', params: new Map()}]),
    ).toBeUndefined();
  });

  // There is deliberately no companion test for an `isProxy` flag. One was threaded through this
  // composer into both handlers and NEITHER read it, so the only assertion either could carry was
  // that it changed nothing; AUTH-25's origin-vs-proxy choice lives in `auth-step.ts`'s
  // `answerHeaderName`, which is where it is actually asserted.
  test('passes the request context through to the winning handler', async () => {
    let observedRequest: {method: string; requestTarget: string} | undefined;
    const recorder: ChallengeHandler = {
      canHandle: (): boolean => true,
      stamp: (_challenge, request): Promise<string> => {
        observedRequest = request;
        return Promise.resolve('v');
      },
    };
    const handler = composingHandler([recorder]);
    await handler.stamp([{scheme: 'x', params: new Map()}], {
      method: 'GET',
      requestTarget: '/y',
    });
    expect(observedRequest).toEqual({method: 'GET', requestTarget: '/y'});
  });

  test("a rejecting handler's failure propagates rather than being swallowed as 'no replacement'", async () => {
    const boom: ChallengeHandler = {
      canHandle: (): boolean => true,
      stamp: (): Promise<string> =>
        Promise.reject(new Error('handler blew up')),
    };
    const error = await rejectionOf(
      composingHandler([boom]).stamp([{scheme: 'x', params: new Map()}]),
    );
    expect((error as Error).message).toBe('handler blew up');
  });
});
