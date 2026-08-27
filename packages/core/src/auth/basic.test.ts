// SPDX-License-Identifier: MIT
// packages/core/src/auth/basic.test.ts
// Exercises: AUTH-14 ('Basic ' + base64(UTF-8(username:password)), computed once; accepts a basic
// challenge case-insensitively; whitespace-only credentials are PERMITTED -- RFC 7617's laxer rule,
// deliberately different from the credential types' stricter non-blank check in credential.ts),
// AUTH-25 (the handler returns the header VALUE only, never picks the header name).
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {basicHandler} from './basic.js';

const basicChallenge = {scheme: 'basic', params: new Map<string, string>()};

describe('basicHandler', () => {
  test('produces "Basic " + base64(UTF-8(username:password))', async () => {
    const handler = basicHandler('Aladdin', 'open sesame');
    const value = await handler.stamp(basicChallenge);
    expect(value).toBe('Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  test('handles non-ASCII credentials via UTF-8 encoding', async () => {
    const handler = basicHandler('üser', 'päss');
    const value = await handler.stamp(basicChallenge);
    expect(value.startsWith('Basic ')).toBe(true);
    // A naive Latin-1 btoa would produce a different, wrong encoding.
    expect(value).toBe(
      `Basic ${btoa(
        String.fromCharCode(...new TextEncoder().encode('üser:päss')),
      )}`,
    );
  });

  test('canHandle accepts "basic" (parseChallenges already lower-cases the scheme)', () => {
    const handler = basicHandler('u', 'p');
    expect(handler.canHandle(basicChallenge)).toBe(true);
    expect(handler.canHandle({scheme: 'digest', params: new Map()})).toBe(
      false,
    );
  });

  test('whitespace-only credentials are permitted (RFC 7617, laxer than credential.ts)', () => {
    expect(() => basicHandler(' ', ' ')).not.toThrow();
  });

  test('a truly empty username or password is rejected', () => {
    expect(() => basicHandler('', 'p')).toThrow(InvariantViolation);
    expect(() => basicHandler('u', '')).toThrow(InvariantViolation);
  });

  test('the encoded value is computed once, at construction', async () => {
    const handler = basicHandler('u', 'p');
    const first = await handler.stamp(basicChallenge);
    const second = await handler.stamp(basicChallenge);
    expect(first).toBe(second);
  });

  test('declares no rank -- it has no algorithm variants to prefer among (AUTH-16)', () => {
    // `'rank' in handler`, not `handler.rank` -- reading an unbound method off an object literal
    // trips `@typescript-eslint/unbound-method`, and presence is what the assertion is about anyway.
    expect('rank' in basicHandler('u', 'p')).toBe(false);
  });
});
