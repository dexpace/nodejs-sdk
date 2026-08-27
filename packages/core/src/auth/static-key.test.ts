// SPDX-License-Identifier: MIT
// packages/core/src/auth/static-key.test.ts
// Exercises: AUTH-26 (uniform over ApiKeyCredential/NameKeyCredential; default header Authorization;
// prefix + exactly one space when set; stateless -- no challenge involved).
import {describe, expect, test} from 'bun:test';
import {ApiKeyCredential, NameKeyCredential} from './credential.js';
import {stampStaticKey} from './static-key.js';

describe('stampStaticKey', () => {
  test('defaults to the Authorization header, no prefix', () => {
    const stamp = stampStaticKey(new ApiKeyCredential('secret'));
    expect(stamp.headerName).toBe('Authorization');
    expect(stamp.headerValue).toBe('secret');
  });

  test('applies a configured prefix with exactly one separating space', () => {
    const stamp = stampStaticKey(new ApiKeyCredential('secret'), {
      prefix: 'Bearer',
    });
    expect(stamp.headerValue).toBe('Bearer secret');
  });

  test('an empty prefix still contributes its separating space, rather than being ignored', () => {
    // `undefined` means "no prefix"; `''` is a caller who explicitly configured one. Collapsing the
    // two would make the option's absent state unreachable.
    expect(
      stampStaticKey(new ApiKeyCredential('secret'), {prefix: ''}).headerValue,
    ).toBe(' secret');
  });

  test('honors a configured header name', () => {
    const stamp = stampStaticKey(new NameKeyCredential('x-api-key', 'secret'), {
      headerName: 'X-Api-Key',
    });
    expect(stamp.headerName).toBe('X-Api-Key');
    expect(stamp.headerValue).toBe('secret');
  });

  test('treats NameKeyCredential uniformly with ApiKeyCredential -- only the secret is read, not .name', () => {
    const stamp = stampStaticKey(
      new NameKeyCredential('ignored-here', 'secret'),
    );
    expect(stamp.headerName).toBe('Authorization');
    expect(stamp.headerValue).toBe('secret');
  });

  test('is stateless -- the same credential stamps identically every call', () => {
    const credential = new ApiKeyCredential('secret');
    expect(stampStaticKey(credential)).toEqual(stampStaticKey(credential));
  });
});
