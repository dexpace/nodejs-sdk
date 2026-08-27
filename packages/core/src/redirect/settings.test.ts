// SPDX-License-Identifier: MIT
// packages/core/src/redirect/settings.test.ts
// Exercises: REDIR-17 (maxHops default 3; 0 is an ordinary value, not a special-cased branch -- decide()'s
// hop-cap gate is what makes it "disable following"), REDIR-26 (the allowed-method set is stored as an
// immutable defensive COPY, so mutating the caller's collection afterwards cannot change policy),
// REDIR-27 (the location header is configurable, defaulting to 'Location'), REDIR-20 (the predicate slot),
// REDIR-3/4/5 (the default allowed-method set and the 303 opt-in default).
import {describe, expect, test} from 'bun:test';
import type {Method} from '../http/method.js';
import {DEFAULT_ALLOWED_METHODS} from './codes.js';
import {DEFAULT_REDIRECT_SETTINGS, redirectSettings} from './settings.js';

describe('defaults', () => {
  test('ship the spec defaults', () => {
    expect(DEFAULT_REDIRECT_SETTINGS.maxHops).toBe(3);
    expect(DEFAULT_REDIRECT_SETTINGS.allow303).toBe(false);
    expect(DEFAULT_REDIRECT_SETTINGS.allowSchemeDowngrade).toBe(false);
    expect(DEFAULT_REDIRECT_SETTINGS.locationHeader).toBe('Location');
    expect([...DEFAULT_REDIRECT_SETTINGS.allowedMethods].sort()).toEqual(
      [...DEFAULT_ALLOWED_METHODS].sort(),
    );
  });

  test('no predicate by default', () => {
    expect(DEFAULT_REDIRECT_SETTINGS.predicate).toBeUndefined();
  });

  test('a zero-config call yields the defaults', () => {
    expect(redirectSettings().maxHops).toBe(3);
    expect(redirectSettings().locationHeader).toBe('Location');
  });

  test('one field can be overridden without restating the rest', () => {
    const settings = redirectSettings({allow303: true});
    expect(settings.allow303).toBe(true);
    expect(settings.maxHops).toBe(3);
  });
});

describe('validation', () => {
  test('rejects a negative maxHops', () => {
    expect(() => redirectSettings({maxHops: -1})).toThrow();
  });

  test('accepts maxHops of 0 as an ordinary value, not a special case', () => {
    expect(redirectSettings({maxHops: 0}).maxHops).toBe(0);
  });

  test('rejects a non-finite maxHops', () => {
    expect(() => redirectSettings({maxHops: Number.NaN})).toThrow();
    expect(() =>
      redirectSettings({maxHops: Number.POSITIVE_INFINITY}),
    ).toThrow();
  });

  test('rejects a fractional maxHops rather than silently truncating it', () => {
    // `2.5` would otherwise pass the cap gate for two hops and fail on the third -- a budget the
    // caller never wrote. Same `Number.isInteger` guard `retryStep`'s per-call override applies.
    expect(() => redirectSettings({maxHops: 2.5})).toThrow();
  });

  test('rejects a blank locationHeader', () => {
    expect(() => redirectSettings({locationHeader: ''})).toThrow();
    expect(() => redirectSettings({locationHeader: '   '})).toThrow();
  });

  test('rejects a locationHeader carrying a byte HTTP-17 forbids in a header name', () => {
    // `Headers.get()` neither trims nor validates -- it lower-cases and looks up. An unvalidated name
    // would therefore never throw and never match: redirects silently unfollowed, no error anywhere.
    // The predicate is the codebase's own header-name rule (control bytes, DEL, non-ASCII), the same
    // one `HeadersBuilder` applies -- printable ASCII such as a space is legal here and stays legal.
    expect(() =>
      redirectSettings({locationHeader: 'Loc\u0000ation'}),
    ).toThrow();
    expect(() => redirectSettings({locationHeader: 'Loc\u00e1tion'})).toThrow();
  });

  test('stores locationHeader trimmed, so a padded name still matches', () => {
    expect(
      redirectSettings({locationHeader: '  Location  '}).locationHeader,
    ).toBe('Location');
  });

  test('accepts a caller-supplied predicate', () => {
    const predicate = (): boolean => true;
    expect(redirectSettings({predicate}).predicate).toBe(predicate);
  });
});

describe('immutability', () => {
  test('the allowed-methods set is defensively copied (REDIR-26)', () => {
    const caller = new Set<Method>(['GET']);
    const settings = redirectSettings({allowedMethods: caller});
    caller.add('POST');
    expect(settings.allowedMethods.has('POST')).toBe(false);
  });

  test('the returned settings object is frozen', () => {
    expect(Object.isFrozen(redirectSettings())).toBe(true);
  });

  test('DEFAULT_REDIRECT_SETTINGS is frozen', () => {
    expect(Object.isFrozen(DEFAULT_REDIRECT_SETTINGS)).toBe(true);
  });
});
