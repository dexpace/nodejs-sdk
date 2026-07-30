// SPDX-License-Identifier: MIT
// packages/core/src/http/builder.test.ts
// Exercises: SEAM-29 (shared Builder contract), HTTP-4 (requireField single-sourcing)
import {describe, expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import {RequiredFieldError} from './errors.js';

describe('requireField', () => {
  test('returns the value when present', () => {
    expect(requireField('https://example.com', 'url')).toBe(
      'https://example.com',
    );
  });

  test('throws RequiredFieldError naming the field when null', () => {
    expect(() => requireField(null, 'url')).toThrow(RequiredFieldError);
    expect(() => requireField(null, 'url')).toThrow('url is required');
  });

  test('throws RequiredFieldError naming the field when undefined', () => {
    expect(() => {
      requireField(undefined, 'status');
    }).toThrow('status is required');
  });
});

// Type-level contract for the exported generic (styleguide 11.7). The assertions are erased at runtime;
// the real check is `tsc --noEmit` in the lint/typecheck gate.
describe('Builder<T> type contract', () => {
  test('any class with build(): T satisfies Builder<T>; the wrong target type is rejected', () => {
    class NumberBuilder {
      build(): number {
        return 1;
      }
    }
    expectTypeOf<NumberBuilder>().toExtend<Builder<number>>();
    expectTypeOf<NumberBuilder>().not.toExtend<Builder<string>>();
  });
});
