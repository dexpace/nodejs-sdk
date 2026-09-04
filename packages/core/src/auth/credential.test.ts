// SPDX-License-Identifier: MIT
// packages/core/src/auth/credential.test.ts
// Exercises: AUTH-8 (BearerToken is value-equal; ApiKeyCredential/NameKeyCredential are
// reference-equal via bare `===`, no equals() override; ALL FIVE credential types -- bearer, API key,
// name key, Basic and Digest -- redact their secret in every string/diagnostic form and none is
// reachable through JSON.stringify/Object.keys, including when a whole AuthCredentialSet is handed to
// `util.inspect`), AUTH-9 (blank
// rejected as a programmer error, and every type is nominal so the validation cannot be routed
// around), AUTH-10 (expiry math: undefined never locally expires; expired iff nowMs + marginMs >
// expiresAt), AUTH-26 (`credentialKey()` is the sole read path for a static key's secret),
// AUTH-14/AUTH-16 (the Basic and Digest credentials carry the username and the algorithm preference
// as non-secret fields, which AUTH-8 permits to stay visible).
import {describe, expect, test} from 'bun:test';
// The ONE `node:` import in this package's tests, and it is the point of the AuthCredentialSet rows
// below: the reported leak was `util.inspect(credentials)` printing `password: 'hunter2'`, so the row
// that proves it closed has to drive the real `util.inspect`, not the hook it happens to call.
import {inspect} from 'node:util';
import {InvariantViolation} from '../invariant.js';
import type {AuthCredentialSet} from './auth-step.js';
import type {DigestAlgorithm} from './digest.js';
import {
  ApiKeyCredential,
  BasicCredential,
  BearerToken,
  DigestCredential,
  NameKeyCredential,
  bearerTokensEqual,
  createBearerToken,
  credentialKey,
  credentialPassword,
  isBearerTokenExpired,
} from './credential.js';

// `util.inspect` is not imported: nothing else in `packages/core` reaches for a `node:` module, and
// the hook under test is reachable directly. `console.log`/`util.inspect` call exactly this method.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

function inspectOf(
  value:
    | ApiKeyCredential
    | BasicCredential
    | BearerToken
    | DigestCredential
    | NameKeyCredential,
): string {
  const hooks = value as unknown as Record<symbol, (() => string) | undefined>;
  const hook = hooks[INSPECT];
  expect(typeof hook).toBe('function');
  return hook === undefined ? '<no inspect hook>' : hook.call(value);
}

describe('BearerToken', () => {
  test('value equality over token + expiry', () => {
    const a = createBearerToken('t', 1000);
    const b = createBearerToken('t', 1000);
    expect(bearerTokensEqual(a, b)).toBe(true);
  });

  test('differing token or expiry is not equal', () => {
    expect(
      bearerTokensEqual(createBearerToken('a'), createBearerToken('b')),
    ).toBe(false);
    expect(
      bearerTokensEqual(createBearerToken('t', 1), createBearerToken('t', 2)),
    ).toBe(false);
  });

  test('an absent expiry and a set expiry are not equal', () => {
    expect(
      bearerTokensEqual(createBearerToken('t'), createBearerToken('t', 1)),
    ).toBe(false);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(createBearerToken('t'))).toBe(true);
  });

  test('rejects a blank or whitespace-only token (AUTH-9)', () => {
    expect(() => createBearerToken('')).toThrow(InvariantViolation);
    expect(() => createBearerToken('   ')).toThrow(InvariantViolation);
  });

  test('rejects a non-finite expiresAt', () => {
    // `isBearerTokenExpired` is `nowMs + marginMs > expiresAt`, so a NaN expiry makes every
    // comparison false: the token reads as permanently fresh, the cache serves it from the hot path
    // forever, and no provider call ever happens to notice. Rejected at construction rather than
    // discovered as a dead credential in production.
    expect(() => createBearerToken('t', Number.NaN)).toThrow(
      'expiresAt must be a finite epoch',
    );
    expect(() => createBearerToken('t', Number.POSITIVE_INFINITY)).toThrow(
      'expiresAt must be a finite epoch',
    );
  });

  test('undefined expiresAt never locally expires (AUTH-10)', () => {
    const token = createBearerToken('t');
    expect(isBearerTokenExpired(token, Number.MAX_SAFE_INTEGER, 0)).toBe(false);
    expect(isBearerTokenExpired(token, Number.MAX_SAFE_INTEGER, 60_000)).toBe(
      false,
    );
  });

  test('expired iff nowMs + marginMs > expiresAt (AUTH-10)', () => {
    const token = createBearerToken('t', 1000);
    expect(isBearerTokenExpired(token, 999, 0)).toBe(false);
    expect(isBearerTokenExpired(token, 1000, 0)).toBe(false); // exactly at expiry, not yet past it
    expect(isBearerTokenExpired(token, 1001, 0)).toBe(true);
    expect(isBearerTokenExpired(token, 900, 200)).toBe(true); // margin pushes it over
  });
});

describe('BearerToken redaction and nominality (AUTH-8/AUTH-9)', () => {
  test('toString and inspect redact the token but keep the expiry', () => {
    const token = createBearerToken('super-secret', 1000);
    expect(token.toString()).not.toContain('super-secret');
    expect(String(token)).not.toContain('super-secret');
    expect(token.toString()).toContain('1000');
    expect(inspectOf(token)).not.toContain('super-secret');
  });

  test('JSON.stringify and Object.keys cannot reach the token -- #private, not TS private', () => {
    const token = createBearerToken('super-secret', 1000);
    expect(JSON.stringify(token)).not.toContain('super-secret');
    expect(Object.keys(token)).toEqual(['expiresAt']);
  });

  test('the accessor still hands the real token to the stamping path', () => {
    expect(createBearerToken('super-secret').token).toBe('super-secret');
  });

  test('nominal: an object literal is not a BearerToken, so AUTH-9 cannot be bypassed', () => {
    // The compile-time half is the point -- a `TokenProvider` returning `{token: '', expiresAt:
    // undefined}` no longer type-checks -- and this asserts the runtime half: the constructor is
    // private, so `createBearerToken` (which validates) is the only construction path.
    const literal = {token: '', expiresAt: undefined};
    expect(literal instanceof BearerToken).toBe(false);
    expect(createBearerToken('t') instanceof BearerToken).toBe(true);
  });
});

describe('ApiKeyCredential (AUTH-8)', () => {
  test('two instances with identical fields are NOT equal -- reference identity only', () => {
    expect(
      new ApiKeyCredential('secret') === new ApiKeyCredential('secret'),
    ).toBe(false);
  });

  test('toString and inspect redact the key', () => {
    const credential = new ApiKeyCredential('super-secret');
    expect(credential.toString()).not.toContain('super-secret');
    expect(String(credential)).not.toContain('super-secret');
    expect(inspectOf(credential)).not.toContain('super-secret');
  });

  test('JSON.stringify cannot reach the key either -- #private, not TS private', () => {
    expect(JSON.stringify(new ApiKeyCredential('super-secret'))).not.toContain(
      'super-secret',
    );
    expect(Object.keys(new ApiKeyCredential('super-secret'))).toEqual([]);
  });

  test('rejects a blank or whitespace-only key (AUTH-9)', () => {
    expect(() => new ApiKeyCredential('')).toThrow(InvariantViolation);
    expect(() => new ApiKeyCredential('   ')).toThrow(InvariantViolation);
  });

  test('the secret is reachable ONLY through the internal credentialKey() hook', () => {
    const credential = new ApiKeyCredential('secret');
    expect(credentialKey(credential)).toBe('secret');
    // No public `key` accessor: the friend hook is the whole read path, so the secret never appears
    // on the published surface (AUTH-8).
    expect('key' in credential).toBe(false);
  });
});

describe('NameKeyCredential (AUTH-8)', () => {
  test('two instances with identical fields are NOT equal', () => {
    expect(
      new NameKeyCredential('n', 'k') === new NameKeyCredential('n', 'k'),
    ).toBe(false);
  });

  test('toString redacts the key but names the name', () => {
    const credential = new NameKeyCredential('x-api-key', 'super-secret');
    expect(credential.toString()).toContain('x-api-key');
    expect(credential.toString()).not.toContain('super-secret');
    expect(inspectOf(credential)).not.toContain('super-secret');
  });

  test('rejects a blank or whitespace-only name or key (AUTH-9)', () => {
    expect(() => new NameKeyCredential('', 'k')).toThrow(InvariantViolation);
    expect(() => new NameKeyCredential('n', '')).toThrow(InvariantViolation);
    expect(() => new NameKeyCredential('  ', 'k')).toThrow(InvariantViolation);
  });

  test('the secret is reachable only through credentialKey(); .name stays public', () => {
    const credential = new NameKeyCredential('x-api-key', 'secret');
    expect(credentialKey(credential)).toBe('secret');
    expect(credential.name).toBe('x-api-key');
    expect('key' in credential).toBe(false);
  });

  test('JSON.stringify reaches the name but never the key', () => {
    const serialized = JSON.stringify(
      new NameKeyCredential('x-api-key', 'super-secret'),
    );
    expect(serialized).toContain('x-api-key');
    expect(serialized).not.toContain('super-secret');
  });
});

describe('BasicCredential (AUTH-8/AUTH-14)', () => {
  test('two instances with identical fields are NOT equal -- reference identity only', () => {
    expect(
      new BasicCredential('u', 'p') === new BasicCredential('u', 'p'),
    ).toBe(false);
  });

  test('toString and inspect redact the password but keep the username', () => {
    const credential = new BasicCredential('alice', 'super-secret');
    expect(credential.toString()).toContain('alice');
    expect(credential.toString()).not.toContain('super-secret');
    expect(String(credential)).not.toContain('super-secret');
    expect(inspectOf(credential)).not.toContain('super-secret');
  });

  test('JSON.stringify reaches the username but never the password', () => {
    const credential = new BasicCredential('alice', 'super-secret');
    expect(JSON.stringify(credential)).toContain('alice');
    expect(JSON.stringify(credential)).not.toContain('super-secret');
    expect(Object.keys(credential)).toEqual(['username']);
  });

  test('the password is reachable ONLY through the internal credentialPassword() hook', () => {
    const credential = new BasicCredential('alice', 'super-secret');
    expect(credentialPassword(credential)).toBe('super-secret');
    // No public `password` property: that is exactly what the structural interface this class
    // replaced put on the published surface (AUTH-8).
    expect('password' in credential).toBe(false);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(new BasicCredential('u', 'p'))).toBe(true);
  });
});

describe('DigestCredential (AUTH-8/AUTH-16)', () => {
  test('two instances with identical fields are NOT equal', () => {
    expect(
      new DigestCredential('u', 'p') === new DigestCredential('u', 'p'),
    ).toBe(false);
  });

  test('toString and inspect redact the password but keep username and preference', () => {
    const credential = new DigestCredential('bob', 'super-secret', ['SHA-256']);
    expect(credential.toString()).toContain('bob');
    expect(credential.toString()).toContain('SHA-256');
    expect(credential.toString()).not.toContain('super-secret');
    expect(String(credential)).not.toContain('super-secret');
    expect(inspectOf(credential)).not.toContain('super-secret');
  });

  test('JSON.stringify reaches the username but never the password', () => {
    const credential = new DigestCredential('bob', 'super-secret');
    expect(JSON.stringify(credential)).toContain('bob');
    expect(JSON.stringify(credential)).not.toContain('super-secret');
    expect(Object.keys(credential)).toEqual([
      'username',
      'algorithmPreference',
    ]);
  });

  test('the password is reachable ONLY through the internal credentialPassword() hook', () => {
    const credential = new DigestCredential('bob', 'super-secret');
    expect(credentialPassword(credential)).toBe('super-secret');
    expect('password' in credential).toBe(false);
  });

  test('an omitted algorithmPreference stays undefined -- the handler owns the default', () => {
    // `digestHandler` applies AUTH-16's strongest-first default. Materializing it here would put a
    // second copy of that list on the public surface, free to drift from the one that is used.
    expect(
      new DigestCredential('bob', 'p').algorithmPreference,
    ).toBeUndefined();
  });

  test('the algorithm preference is copied and frozen, not aliased (HTTP-3)', () => {
    const supplied: DigestAlgorithm[] = ['SHA-256', 'MD5'];
    const credential = new DigestCredential('bob', 'p', supplied);
    supplied.push('MD5-sess');

    expect(credential.algorithmPreference).toEqual(['SHA-256', 'MD5']);
    expect(Object.isFrozen(credential.algorithmPreference)).toBe(true);
  });

  test('is frozen', () => {
    expect(Object.isFrozen(new DigestCredential('u', 'p'))).toBe(true);
  });
});

describe('a whole AuthCredentialSet is diagnostic-safe (AUTH-8)', () => {
  /** Every scheme's material at once -- the shape a caller hands `authStep()`. */
  function everyCredential(): AuthCredentialSet {
    return {
      basic: new BasicCredential('alice', 'basic-hunter2'),
      digest: new DigestCredential('bob', 'digest-hunter2', ['SHA-256']),
      apiKey: {
        credential: new NameKeyCredential('x-api-key', 'api-key-hunter2'),
        headerName: 'X-Api-Key',
      },
      bearer: {
        provider: () =>
          Promise.resolve(createBearerToken('bearer-hunter2', 1000)),
      },
    };
  }

  test('util.inspect prints no secret from any of the four schemes', () => {
    const rendered = inspect(everyCredential(), {depth: null});

    expect(rendered).not.toContain('basic-hunter2');
    expect(rendered).not.toContain('digest-hunter2');
    expect(rendered).not.toContain('api-key-hunter2');
    // The non-secret fields AUTH-8 permits to stay visible are still there, which is what makes the
    // rendering worth printing at all.
    expect(rendered).toContain('alice');
    expect(rendered).toContain('bob');
    expect(rendered).toContain('x-api-key');
  });

  test('util.inspect honours the inspect hook on a BearerToken too', () => {
    // `inspectOf` proves the hook exists; this proves `util.inspect` actually calls it.
    expect(inspect(createBearerToken('bearer-hunter2', 1000))).not.toContain(
      'bearer-hunter2',
    );
  });

  test('JSON.stringify serializes no secret from any of the four schemes', () => {
    const serialized = JSON.stringify(everyCredential());

    expect(serialized).not.toContain('basic-hunter2');
    expect(serialized).not.toContain('digest-hunter2');
    expect(serialized).not.toContain('api-key-hunter2');
  });
});
