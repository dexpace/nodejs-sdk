// SPDX-License-Identifier: MIT
// packages/core/src/http/request-options.test.ts
// Exercises: HTTP-34 (EMPTY sentinel, defensive tag copy), HTTP-35 (timeout/maxRetries validation),
// AUTH-4 (the per-call auth descriptor tier, added in Phase 5c)
import {describe, expect, test} from 'bun:test';
import {createAuthDescriptor} from '../auth/descriptor.js';
import {createAuthRequirement} from '../auth/requirement.js';
import {RequestOptions} from './request-options.js';
import {RequestOptionsValidationError} from './errors.js';

describe('RequestOptions.EMPTY', () => {
  test('has null timeout, null max-retries, empty tags', () => {
    expect(RequestOptions.EMPTY.timeoutMs).toBeUndefined();
    expect(RequestOptions.EMPTY.maxRetries).toBeUndefined();
    expect(RequestOptions.EMPTY.tag('anything')).toBeUndefined();
  });
});

describe('per-call auth descriptor (AUTH-4)', () => {
  test('EMPTY carries no auth descriptor', () => {
    expect(RequestOptions.EMPTY.auth).toBeUndefined();
  });

  test('the builder stores and the accessor returns the same descriptor instance', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH')]);
    expect(RequestOptions.newBuilder().auth(descriptor).build().auth).toBe(
      descriptor,
    );
  });

  test('an explicit undefined clears the override', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('NO_AUTH')]);
    const builder = RequestOptions.newBuilder().auth(descriptor);
    expect(builder.auth(undefined).build().auth).toBeUndefined();
  });

  test('a derived builder carries the descriptor forward (HTTP-3)', () => {
    const descriptor = createAuthDescriptor([createAuthRequirement('BASIC')]);
    const original = RequestOptions.newBuilder().auth(descriptor).build();
    expect(original.newBuilder().build().auth).toBe(descriptor);
  });
});

describe('timeout validation (HTTP-35)', () => {
  test('rejects zero or negative timeout', () => {
    expect(() => RequestOptions.newBuilder().timeoutMs(0)).toThrow(
      RequestOptionsValidationError,
    );
    expect(() => RequestOptions.newBuilder().timeoutMs(-1)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('accepts a null (undefined) timeout — no override', () => {
    expect(() =>
      RequestOptions.newBuilder().timeoutMs(undefined).build(),
    ).not.toThrow();
  });

  test('accepts a positive timeout', () => {
    expect(RequestOptions.newBuilder().timeoutMs(5000).build().timeoutMs).toBe(
      5000,
    );
  });
});

describe('maxRetries validation (HTTP-35)', () => {
  test('rejects a negative maxRetries', () => {
    expect(() => RequestOptions.newBuilder().maxRetries(-1)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('rejects a non-finite maxRetries, which would make a retry loop unbounded', () => {
    // Worse in effect than a negative value: a negative one still fails a downstream `>= 1` guard,
    // while Infinity/NaN make an "attempt >= ceiling" test permanently false and the loop endless.
    for (const value of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => RequestOptions.newBuilder().maxRetries(value)).toThrow(
        RequestOptionsValidationError,
      );
    }
  });

  test('rejects a fractional maxRetries, which is not a count of wire sends', () => {
    expect(() => RequestOptions.newBuilder().maxRetries(1.5)).toThrow(
      RequestOptionsValidationError,
    );
  });

  test('accepts 0, meaning "disable retries for this call"', () => {
    expect(RequestOptions.newBuilder().maxRetries(0).build().maxRetries).toBe(
      0,
    );
  });

  test('accepts a positive integer', () => {
    expect(RequestOptions.newBuilder().maxRetries(3).build().maxRetries).toBe(
      3,
    );
  });
});

describe('tags are defensively copied at build (HTTP-34)', () => {
  test('a built options is unaffected by later mutation of the source map', () => {
    const source = new Map([['env', 'prod']]);
    const options = RequestOptions.newBuilder().tags(source).build();
    source.set('env', 'mutated');
    expect(options.tag('env')).toBe('prod');
  });
});

describe('newBuilder derivation (HTTP-3)', () => {
  test('a derived builder is pre-filled with timeout, retries, and tags', () => {
    const original = RequestOptions.newBuilder()
      .timeoutMs(5000)
      .maxRetries(0)
      .tags(new Map([['env', 'prod']]))
      .build();

    const derived = original.newBuilder().maxRetries(3).build();

    expect(derived.timeoutMs).toBe(5000);
    expect(derived.maxRetries).toBe(3);
    expect(derived.tag('env')).toBe('prod');
    expect(original.maxRetries).toBe(0);
  });
});
