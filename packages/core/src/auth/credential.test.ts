// SPDX-License-Identifier: MIT
// packages/core/src/auth/credential.test.ts
// Exercises: AUTH-8 (BearerToken is value-equal; ApiKeyCredential/NameKeyCredential are
// reference-equal via bare `===`, no equals() override; ALL THREE redact their secret in every
// string/diagnostic form and none is reachable through JSON.stringify/Object.keys), AUTH-9 (blank
// rejected as a programmer error, and every type is nominal so the validation cannot be routed
// around), AUTH-10 (expiry math: undefined never locally expires; expired iff nowMs + marginMs >
// expiresAt), AUTH-26 (`credentialKey()` is the sole read path for a static key's secret).
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {
  ApiKeyCredential,
  BearerToken,
  NameKeyCredential,
  bearerTokensEqual,
  createBearerToken,
  credentialKey,
  isBearerTokenExpired,
} from './credential.js';

// `util.inspect` is not imported: nothing else in `packages/core` reaches for a `node:` module, and
// the hook under test is reachable directly. `console.log`/`util.inspect` call exactly this method.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

function inspectOf(
  value: ApiKeyCredential | BearerToken | NameKeyCredential,
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
