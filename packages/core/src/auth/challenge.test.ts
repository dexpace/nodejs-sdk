// SPDX-License-Identifier: MIT
// packages/core/src/auth/challenge.test.ts
// Exercises: AUTH-12 (scheme/param names lower-cased, values verbatim, token68 under its synthetic
// key), AUTH-13 (total: blank -> [], malformed recovers at the next top-level comma, unterminated
// quote ends at EOF, params before a malformed tail kept), and the multi-challenge/comma-ambiguity
// case that is the whole reason this parser cannot be a `.split(',')`.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {parseChallenges} from './challenge.js';

describe('a single challenge', () => {
  test('scheme and param names are lower-cased; values are verbatim', () => {
    const [challenge] = parseChallenges('BASIC Realm="MixedCase"');
    expect(challenge?.scheme).toBe('basic');
    expect(challenge?.params.get('realm')).toBe('MixedCase');
  });

  test('a bare scheme with no params gets an empty parameter map', () => {
    const [challenge] = parseChallenges('NTLM');
    expect(challenge?.scheme).toBe('ntlm');
    expect(challenge?.params.size).toBe(0);
  });

  test('a token68 value is recorded under the synthetic key', () => {
    const [challenge] = parseChallenges(
      'Negotiate a87421000492aa874209af8bc028',
    );
    expect(challenge?.scheme).toBe('negotiate');
    // AUTH-12 names this key literally as 'token68'.
    expect(challenge?.params.get('token68')).toBe(
      'a87421000492aa874209af8bc028',
    );
  });

  test("token68's own '=' padding is part of the value, not an assignment", () => {
    const [challenge] = parseChallenges('Negotiate YWJj==');
    expect(challenge?.params.get('token68')).toBe('YWJj==');
  });

  test('an unquoted token value is accepted', () => {
    const [challenge] = parseChallenges('Digest realm=simple, qop=auth');
    expect(challenge?.params.get('realm')).toBe('simple');
    expect(challenge?.params.get('qop')).toBe('auth');
  });

  // Only the WRAPPER is frozen, and the name says so. `Object.freeze` on the `params` `Map` would
  // not stop `.set()`, so freezing it would be a comment that lies; the `ReadonlyMap` TYPE is the
  // only guard on the parameters, for the same reason `createAuthRequirement` records for its own
  // params map -- `Challenge` is `@internal`, never reaches a consumer, and nothing in this package
  // re-casts `Challenge['params']` back to `Map`.
  test('the returned challenge wrapper is frozen', () => {
    const [challenge] = parseChallenges('Basic realm="a"');
    expect(Object.isFrozen(challenge)).toBe(true);
  });
});

describe('multiple comma-separated challenges', () => {
  test('a top-level comma between two DIFFERENT auth-params of the SAME challenge does not start a new one', () => {
    const challenges = parseChallenges(
      'Digest realm="a", nonce="n", qop="auth"',
    );
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.params.get('realm')).toBe('a');
    expect(challenges[0]?.params.get('nonce')).toBe('n');
    expect(challenges[0]?.params.get('qop')).toBe('auth');
  });

  test('two distinct challenges are both recovered, each with its own params', () => {
    const challenges = parseChallenges(
      'Basic realm="a", Digest realm="b", nonce="n"',
    );
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).toEqual({
      scheme: 'basic',
      params: new Map([['realm', 'a']]),
    });
    expect(challenges[1]?.scheme).toBe('digest');
    expect(challenges[1]?.params.get('realm')).toBe('b');
    expect(challenges[1]?.params.get('nonce')).toBe('n');
  });

  test('a comma INSIDE a quoted value never splits the challenge', () => {
    const [challenge] = parseChallenges('Digest realm="a, b", nonce="n"');
    expect(challenge?.params.get('realm')).toBe('a, b');
    expect(challenge?.params.get('nonce')).toBe('n');
  });

  test('wire order is preserved', () => {
    const challenges = parseChallenges('Digest realm="d", Basic realm="b"');
    expect(challenges.map(c => c.scheme)).toEqual(['digest', 'basic']);
  });
});

describe('quoted-string handling', () => {
  test('a backslash escape is unquoted', () => {
    const [challenge] = parseChallenges(String.raw`Digest realm="a\"b"`);
    expect(challenge?.params.get('realm')).toBe('a"b');
  });

  test('an unterminated quoted string terminates at end-of-input (AUTH-13)', () => {
    const [challenge] = parseChallenges('Digest realm="abc');
    expect(challenge?.params.get('realm')).toBe('abc');
  });

  test('an equals sign inside a quoted value is not an assignment', () => {
    const [challenge] = parseChallenges('Digest realm="a=b", nonce="n"');
    expect(challenge?.params.get('realm')).toBe('a=b');
    expect(challenge?.params.get('nonce')).toBe('n');
  });
});

describe('totality and recovery (AUTH-13)', () => {
  test('blank input yields an empty list', () => {
    expect(parseChallenges('')).toEqual([]);
    expect(parseChallenges('   ')).toEqual([]);
  });

  test('a malformed segment recovers at the next top-level comma, keeping prior params', () => {
    const challenges = parseChallenges(
      'Digest realm="a", =bad, Basic realm="b"',
    );
    expect(challenges).toHaveLength(2);
    expect(challenges[0]).toEqual({
      scheme: 'digest',
      params: new Map([['realm', 'a']]),
    });
    expect(challenges[1]).toEqual({
      scheme: 'basic',
      params: new Map([['realm', 'b']]),
    });
  });

  test('a leading auth-param with no scheme ahead of it is discarded, not crashed on', () => {
    const challenges = parseChallenges('realm="orphan", Basic realm="b"');
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.scheme).toBe('basic');
  });

  test('a comma inside the malformed segment’s quoted value is not a recovery point', () => {
    const challenges = parseChallenges(
      'Basic realm="a", ="x,y", Digest realm="b"',
    );
    expect(challenges.map(c => c.scheme)).toEqual(['basic', 'digest']);
  });

  test('an escaped quote inside a malformed segment does not end its quoted run', () => {
    // The `\"` keeps the run open, so the comma that follows is still inside quotes and is not a
    // recovery point; recovery lands on the one after the closing quote.
    const challenges = parseChallenges(
      String.raw`Basic realm="a", ="x\",y", Digest realm="b"`,
    );
    expect(challenges.map(c => c.scheme)).toEqual(['basic', 'digest']);
  });

  test('stray commas collapse rather than emitting empty challenges', () => {
    expect(parseChallenges(',,,')).toEqual([]);
    expect(
      parseChallenges('Basic,,Digest realm="b"').map(c => c.scheme),
    ).toEqual(['basic', 'digest']);
  });
});

describe('parser totality, as properties (AUTH-13)', () => {
  test('property: never throws for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), raw => {
        expect(() => parseChallenges(raw)).not.toThrow();
      }),
    );
  });

  test('property: never throws and always terminates over a metacharacter corpus', () => {
    // `fc.string()` above rarely produces dense clusters of the characters that actually drive this
    // parser's recovery branches, and one of those branches (`readSchemeTail` resetting to its saved
    // position when a token68 read comes back empty) advances nothing on its own -- termination rests
    // on the outer loop consuming instead. This enumerates that alphabet exhaustively at length 5.
    const alphabet = [' ', ',', '=', '"', '\\', '/', '!', '@', 'a', '\t'];
    for (let seed = 0; seed < 100_000; seed += 1) {
      let text = '';
      let n = seed;
      for (let i = 0; i < 5; i += 1) {
        text += alphabet[n % alphabet.length] ?? '';
        n = Math.floor(n / alphabet.length);
      }
      expect(() => parseChallenges(text)).not.toThrow();
    }
  });

  test('a 100 KB quoted value stays linear and yields one challenge', () => {
    expect(
      parseChallenges(`Basic realm="${'x'.repeat(100_000)}"`),
    ).toHaveLength(1);
  });

  test('property: a well-formed single challenge round-trips scheme + one param exactly', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{1,10}$/u),
        fc.stringMatching(/^[a-zA-Z0-9 ]{0,20}$/u),
        (scheme, value) => {
          const [challenge] = parseChallenges(`${scheme} realm="${value}"`);
          expect(challenge?.scheme).toBe(scheme.toLowerCase());
          expect(challenge?.params.get('realm')).toBe(value);
        },
      ),
    );
  });

  test('property: a comma inside a quoted value never splits the challenge', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9]{0,8}$/u), fragment => {
        const challenges = parseChallenges(
          `Digest realm="${fragment},${fragment}", nonce="n"`,
        );
        expect(challenges).toHaveLength(1);
        expect(challenges[0]?.params.get('realm')).toBe(
          `${fragment},${fragment}`,
        );
      }),
    );
  });
});
