// SPDX-License-Identifier: MIT
// packages/core/src/auth/digest.test.ts
// Exercises: AUTH-15 (exactly {MD5, MD5-sess, SHA-256, SHA-256-sess}, qop=auth or absent, declines
// auth-int and unsupported algorithms), AUTH-16 (satisfiability: scheme/realm/nonce/qop/algorithm,
// and configured-preference order over wire order), AUTH-17 (HA1/HA2/response per RFC 7616/2069,
// verified against independently-computed vectors), AUTH-18/AUTH-19 (nonce count: starts at 1,
// increments only on nonce reuse, 8 lower-case hex digits, bounded and drained to the cap),
// AUTH-20 (client nonce from crypto.getRandomValues, >=128 bits), AUTH-21 (UTF-8 vs ISO-8859-1 by
// charset), AUTH-22 (quoting, and cnonce/nc/qop emitted only when qop negotiated), AUTH-25
// (Authorization vs Proxy-Authorization is the CALLER's job -- stamp() returns only the value).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {InvariantViolation} from '../invariant.js';
import type {Challenge, DigestUriContext} from './challenge.js';
import {
  NonceCountStore,
  computeDigestResponse,
  digestHandler,
} from './digest.js';

const REALM = 'testrealm@host.com';
const NONCE = 'dcd98b7102dd2f0e8b11d0f600bfb0c093';
const CNONCE = '0a4f113b';
const NC = '00000001';
const BASE = {
  realm: REALM,
  nonce: NONCE,
  isUtf8: true,
  method: 'GET',
  uri: '/dir/index.html',
  username: 'Mufasa',
  password: 'Circle Of Life',
  cnonce: CNONCE,
  nc: NC,
} as const;

const REQUEST_CONTEXT: DigestUriContext = {
  method: 'GET',
  requestTarget: '/dir/index.html',
};

function digestChallenge(params: Record<string, string>): Challenge {
  return {scheme: 'digest', params: new Map(Object.entries(params))};
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

describe('computeDigestResponse (verified against RFC 2617/7616 vectors)', () => {
  test('MD5, qop=auth', async () => {
    expect(
      await computeDigestResponse({
        ...BASE,
        algorithm: 'MD5',
        hasQopAuth: true,
      }),
    ).toBe('6629fae49393a05397450978507c4ef1');
  });

  test('MD5, no qop (RFC 2069 form)', async () => {
    expect(
      await computeDigestResponse({
        ...BASE,
        algorithm: 'MD5',
        hasQopAuth: false,
      }),
    ).toBe('670fd8c2df070c60b045671b8b24ff02');
  });

  test('MD5-sess, qop=auth', async () => {
    expect(
      await computeDigestResponse({
        ...BASE,
        algorithm: 'MD5-sess',
        hasQopAuth: true,
      }),
    ).toBe('8e3825c57e897f5a0dec6c2d4e5059d0');
  });

  test('SHA-256, qop=auth', async () => {
    expect(
      await computeDigestResponse({
        ...BASE,
        algorithm: 'SHA-256',
        hasQopAuth: true,
      }),
    ).toBe('5abdd07184ba512a22c53f41470e5eea7dcaa3a93a59b630c13dfe0a5dc6e38b');
  });

  test('SHA-256-sess, qop=auth', async () => {
    expect(
      await computeDigestResponse({
        ...BASE,
        algorithm: 'SHA-256-sess',
        hasQopAuth: true,
      }),
    ).toBe('b8822e12417cb7750f4e2b8515f0dcf25b7dd26993e80bee1426201446a7f59b');
  });
});

describe('computeDigestResponse charset and determinism (AUTH-17/AUTH-21)', () => {
  test('AUTH-21: the charset changes the hash for a non-ASCII password', async () => {
    const utf8 = await computeDigestResponse({
      ...BASE,
      password: 'pässwörd',
      algorithm: 'MD5',
      hasQopAuth: true,
      isUtf8: true,
    });
    const latin1 = await computeDigestResponse({
      ...BASE,
      password: 'pässwörd',
      algorithm: 'MD5',
      hasQopAuth: true,
      isUtf8: false,
    });
    expect(utf8).not.toBe(latin1);
  });

  test('AUTH-21: an all-ASCII input hashes identically under either charset', async () => {
    const utf8 = await computeDigestResponse({
      ...BASE,
      algorithm: 'MD5',
      hasQopAuth: true,
      isUtf8: true,
    });
    const latin1 = await computeDigestResponse({
      ...BASE,
      algorithm: 'MD5',
      hasQopAuth: true,
      isUtf8: false,
    });
    expect(utf8).toBe(latin1);
  });

  test('is deterministic -- the same inputs recompute to the same response (AUTH-17)', async () => {
    const input = {...BASE, algorithm: 'SHA-256', hasQopAuth: true} as const;
    expect(await computeDigestResponse(input)).toBe(
      await computeDigestResponse(input),
    );
  });
});

describe('NonceCountStore (AUTH-18/19)', () => {
  test('starts at 1 for a first-seen nonce', () => {
    expect(new NonceCountStore().next('n1')).toBe(1);
  });

  test('increments only on reuse of the SAME nonce', () => {
    const store = new NonceCountStore();
    expect(store.next('n1')).toBe(1);
    // A different nonce starts fresh; it does not inherit n1's count.
    expect(store.next('n2')).toBe(1);
    expect(store.next('n1')).toBe(2);
    expect(store.next('n1')).toBe(3);
  });

  test('property: a fixed nonce produces a strictly increasing sequence', () => {
    fc.assert(
      fc.property(fc.integer({min: 1, max: 200}), calls => {
        const fresh = new NonceCountStore();
        let previous = 0;
        for (let i = 0; i < calls; i += 1) {
          const count = fresh.next('fixed');
          expect(count).toBeGreaterThan(previous);
          previous = count;
        }
      }),
    );
  });

  test('bounded at 1024 entries, oldest evicted first (AUTH-19)', () => {
    const store = new NonceCountStore();
    for (let i = 0; i < 1024; i += 1) store.next(`nonce-${String(i)}`);
    store.next('nonce-1024'); // 1025th distinct nonce -- evicts 'nonce-0'
    expect(store.next('nonce-0')).toBe(1); // evicted -- starts over, not 2
  });

  test('drains back UNDER the cap after every admit, not one victim per insert (AUTH-19/XCUT-14)', () => {
    // The distinguishing case for drain-to-cap vs pre-insert check-then-evict: a long run of fresh
    // server-chosen nonces. A single-victim-per-insert store stays pinned at (or above) the bound
    // forever without converging; the loop must leave the map at exactly the cap after each admit.
    const store = new NonceCountStore();
    for (let i = 0; i < 4096; i += 1) {
      store.next(`burst-${String(i)}`);
      expect(store.size).toBeLessThanOrEqual(1024);
    }
    expect(store.size).toBe(1024);
  });
});

describe('digestHandler: credential validation (AUTH-9/AUTH-22)', () => {
  test('rejects blank credentials', () => {
    expect(() => digestHandler('', 'p')).toThrow(InvariantViolation);
    expect(() => digestHandler('u', '  ')).toThrow(InvariantViolation);
  });

  test('rejects a username that is not header-safe (AUTH-22)', () => {
    // AUTH-22 writes the username verbatim into the Authorization value, and HTTP-18 admits only
    // HTAB plus printable ASCII there. Caller configuration, so it fails fast and loudly at
    // construction rather than being declined silently per request the way a server realm is.
    // RFC 7616 §4's `username*` encoding would lift this and is deferred.
    expect(() => digestHandler('björn', 'p')).toThrow('header-safe');
  });

  test('canHandle declines a challenge whose realm cannot be echoed (AUTH-22/HTTP-18)', () => {
    // A received field-value may legally carry obs-text (HTTP-19), so `realm="café"` reaches us
    // intact -- but it cannot go back out. Declining makes AUTH-33 surface the 401 unchanged, which
    // beats building the header anyway and throwing HeaderValidationError out of the whole step.
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: 'café', nonce: NONCE, algorithm: 'MD5'}),
      ),
    ).toBe(false);
  });

  test('canHandle declines an opaque or nonce that cannot be echoed (AUTH-22/HTTP-18)', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, opaque: 'ö'}),
      ),
    ).toBe(false);
    expect(
      handler.canHandle(digestChallenge({realm: REALM, nonce: 'nö'})),
    ).toBe(false);
  });
});

describe('digestHandler: challenge selection (AUTH-15/AUTH-16)', () => {
  test('canHandle accepts a well-formed Digest challenge', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth'}),
      ),
    ).toBe(true);
  });

  test('canHandle accepts a qop list that merely CONTAINS auth', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth-int, auth'}),
      ),
    ).toBe(true);
  });

  test('canHandle rejects a non-Digest scheme', () => {
    expect(
      digestHandler('u', 'p').canHandle({scheme: 'basic', params: new Map()}),
    ).toBe(false);
  });

  test('canHandle rejects a missing realm or nonce', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.canHandle(digestChallenge({nonce: NONCE}))).toBe(false);
    expect(handler.canHandle(digestChallenge({realm: REALM}))).toBe(false);
  });

  test('canHandle declines an auth-int-only qop (AUTH-15)', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth-int'}),
      ),
    ).toBe(false);
  });

  test('canHandle declines an unsupported algorithm (AUTH-15)', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD4'}),
      ),
    ).toBe(false);
  });

  test('canHandle matches the algorithm name case-insensitively', () => {
    const handler = digestHandler('u', 'p');
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'sha-256'}),
      ),
    ).toBe(true);
  });
});

describe('digestHandler stamping (AUTH-17..AUTH-22, AUTH-25)', () => {
  test('canHandle defaults to MD5 when algorithm is absent', () => {
    const handler = digestHandler('u', 'p', {algorithmPreference: ['MD5']});
    expect(
      handler.canHandle(digestChallenge({realm: REALM, nonce: NONCE})),
    ).toBe(true);
  });

  test('canHandle honors a caller-restricted algorithm preference', () => {
    const handler = digestHandler('u', 'p', {algorithmPreference: ['SHA-256']});
    expect(
      handler.canHandle(
        digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD5'}),
      ),
    ).toBe(false);
  });

  test('rank reflects preference-list order, for composing-handler.ts to sort by', () => {
    const handler = digestHandler('u', 'p', {
      algorithmPreference: ['SHA-256', 'MD5'],
    });
    const sha = handler.rank?.(
      digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'SHA-256'}),
    );
    const md5Rank = handler.rank?.(
      digestChallenge({realm: REALM, nonce: NONCE, algorithm: 'MD5'}),
    );
    expect(sha).toBeLessThan(md5Rank ?? Number.POSITIVE_INFINITY);
  });

  test('rank is worst-possible for a challenge it cannot handle', () => {
    const handler = digestHandler('u', 'p');
    expect(handler.rank?.({scheme: 'basic', params: new Map()})).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test('stamp() produces a well-formed Digest header value, qop negotiated', async () => {
    const handler = digestHandler('Mufasa', 'Circle Of Life');
    const challenge = digestChallenge({
      realm: REALM,
      nonce: NONCE,
      qop: 'auth',
    });
    const value = await handler.stamp(challenge, REQUEST_CONTEXT);
    expect(value.startsWith('Digest ')).toBe(true);
    expect(value).toContain('username="Mufasa"');
    expect(value).toContain(`realm="${REALM}"`);
    expect(value).toContain('uri="/dir/index.html"');
    expect(value).toContain('qop=auth');
    expect(value).toMatch(/nc=[0-9a-f]{8}/u);
    expect(value).toMatch(/response="[0-9a-f]+"/u);
  });
});

describe('digestHandler nonce counting and preconditions (AUTH-18/AUTH-25)', () => {
  test('stamp() draws a fresh >=128-bit client nonce per call (AUTH-20)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({
      realm: REALM,
      nonce: NONCE,
      qop: 'auth',
    });
    const first = /cnonce="([0-9a-f]+)"/u.exec(
      await handler.stamp(challenge, REQUEST_CONTEXT),
    );
    const second = /cnonce="([0-9a-f]+)"/u.exec(
      await handler.stamp(challenge, REQUEST_CONTEXT),
    );
    expect(first?.[1]).toHaveLength(32); // 16 bytes rendered as hex
    expect(first?.[1]).not.toBe(second?.[1]);
  });

  test('stamp() emits the FULL algorithm spelling, unquoted (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const value = await handler.stamp(
      digestChallenge({
        realm: REALM,
        nonce: NONCE,
        qop: 'auth',
        algorithm: 'SHA-256-sess',
      }),
      REQUEST_CONTEXT,
    );
    expect(value).toContain('algorithm=SHA-256-sess');
  });

  test('stamp() escapes a quote inside a realm rather than emitting it raw (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const value = await handler.stamp(
      digestChallenge({realm: 'a"b', nonce: NONCE}),
      REQUEST_CONTEXT,
    );
    expect(value).toContain(String.raw`realm="a\"b"`);
  });
});

describe('digestHandler opaque and qop emission (AUTH-22)', () => {
  test('stamp() echoes the challenge opaque back, quoted (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({
      realm: REALM,
      nonce: NONCE,
      qop: 'auth',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41',
    });
    const value = await handler.stamp(challenge, REQUEST_CONTEXT);
    expect(value).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  test('stamp() omits opaque entirely when the challenge carried none (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const value = await handler.stamp(
      digestChallenge({realm: REALM, nonce: NONCE}),
      REQUEST_CONTEXT,
    );
    expect(value).not.toContain('opaque');
  });
});

describe('digestHandler nonce-count sequencing (AUTH-18)', () => {
  test('stamp() omits cnonce/nc/qop when the challenge negotiated no qop (AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({realm: REALM, nonce: NONCE});
    const value = await handler.stamp(challenge, REQUEST_CONTEXT);
    expect(value).not.toContain('qop=');
    expect(value).not.toContain('cnonce=');
    expect(value).not.toContain('nc=');
  });

  test('two successive stamp() calls against the SAME nonce increment nc (AUTH-18)', async () => {
    const handler = digestHandler('u', 'p');
    const challenge = digestChallenge({
      realm: REALM,
      nonce: NONCE,
      qop: 'auth',
    });
    const first = await handler.stamp(challenge, REQUEST_CONTEXT);
    const second = await handler.stamp(challenge, REQUEST_CONTEXT);
    expect(first).toContain('nc=00000001');
    expect(second).toContain('nc=00000002');
  });

  test('a no-qop stamp does not consume a nonce count (AUTH-18/AUTH-22)', async () => {
    const handler = digestHandler('u', 'p');
    await handler.stamp(
      digestChallenge({realm: REALM, nonce: NONCE}),
      REQUEST_CONTEXT,
    );
    const withQop = await handler.stamp(
      digestChallenge({realm: REALM, nonce: NONCE, qop: 'auth'}),
      REQUEST_CONTEXT,
    );
    expect(withQop).toContain('nc=00000001');
  });

  test('stamp() rejects a challenge canHandle() would decline', async () => {
    const handler = digestHandler('u', 'p');
    expect(
      await rejectionOf(
        handler.stamp({scheme: 'basic', params: new Map()}, REQUEST_CONTEXT),
      ),
    ).toBeInstanceOf(InvariantViolation);
  });

  test('stamp() rejects a missing DigestUriContext -- it cannot compute HA2 without one', async () => {
    const handler = digestHandler('u', 'p');
    expect(
      await rejectionOf(
        handler.stamp(digestChallenge({realm: REALM, nonce: NONCE})),
      ),
    ).toBeInstanceOf(InvariantViolation);
  });
});
