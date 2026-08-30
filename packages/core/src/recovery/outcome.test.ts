// SPDX-License-Identifier: MIT
// packages/core/src/recovery/outcome.test.ts
// Exercises: RECOV-1 (closed two-variant sum type, mutually exclusive and jointly exhaustive, with a
// fold that applies exactly one of two branches at most once per call)
import {describe, expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import fc from 'fast-check';
import {failure, fold, success, type Outcome} from './outcome.js';

describe('success / failure (RECOV-1)', () => {
  test('success carries its value under kind "success"', () => {
    const outcome = success(42);

    expect(outcome.kind).toBe('success');
    expect(outcome.kind === 'success' && outcome.value).toBe(42);
  });

  test('failure carries its error under kind "failure", typed unknown', () => {
    // A JS throw can legally raise any value, not only an Error (sdk-design-nodejs/05).
    const outcome = failure('a string throw');

    expect(outcome.kind).toBe('failure');
    expect(outcome.kind === 'failure' && outcome.error).toBe('a string throw');
  });
});

describe('fold (RECOV-1)', () => {
  test('applies onSuccess for a success outcome', () => {
    const result = fold(
      success(10),
      v => v * 2,
      () => -1,
    );

    expect(result).toBe(20);
  });

  test('applies onFailure for a failure outcome', () => {
    const error = new Error('boom');

    const result = fold(
      failure<number>(error),
      () => 'unreachable',
      e => e,
    );

    expect(result).toBe(error);
  });

  test('invokes exactly one branch, never both, for either variant', () => {
    let successCalls = 0;
    let failureCalls = 0;
    const onSuccess = (): string => {
      successCalls += 1;
      return 'ok';
    };
    const onFailure = (): string => {
      failureCalls += 1;
      return 'err';
    };

    fold(success(1), onSuccess, onFailure);
    fold(failure<number>(new Error('x')), onSuccess, onFailure);

    expect(successCalls).toBe(1);
    expect(failureCalls).toBe(1);
  });
});

describe('fold identity law (RECOV-1)', () => {
  // Canonical law for an invariant-bearing function (docs/knowledge/harvested/testing.md): folding a success
  // through the identity success-handler, and a failure through the identity failure-handler, must
  // each recover the original payload, for arbitrary values.
  test('fold(success(x), id, _) === x for arbitrary x', () => {
    fc.assert(
      fc.property(fc.anything(), value => {
        expect(
          fold(
            success(value),
            v => v,
            () => 'unreachable',
          ),
        ).toBe(value);
      }),
    );
  });

  test('fold(failure(e), _, id) === e for arbitrary e', () => {
    fc.assert(
      fc.property(fc.anything(), error => {
        expect(
          fold(
            failure<unknown>(error),
            () => 'unreachable',
            e => e,
          ),
        ).toBe(error);
      }),
    );
  });
});

describe('Outcome<T> as a type (RECOV-1)', () => {
  // An exported generic type ships with a type-level test (styleguide 11.6). These only fire under
  // `bun run typecheck` — `bun test` executes this file but strips its types without checking them.
  test('the two variants are closed and jointly exhaustive', () => {
    expectTypeOf<Outcome<number>['kind']>().toEqualTypeOf<
      'success' | 'failure'
    >();
  });

  test('narrowing on kind reaches the variant payload, and only that payload', () => {
    expectTypeOf<
      Extract<Outcome<number>, {kind: 'success'}>['value']
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<Outcome<number>, {kind: 'failure'}>['error']
    >().toEqualTypeOf<unknown>();
  });

  test('a narrowed success has no error field (negative case)', () => {
    const outcome: Outcome<number> = success(1);
    if (outcome.kind !== 'success') throw new Error('unreachable seed');

    // @ts-expect-error -- RECOV-1: the variants are mutually exclusive, so a narrowed success has
    // no `error` to read. If this line ever compiles, the union has stopped being closed.
    const read: unknown = outcome.error;

    expect(read).toBeUndefined();
  });

  test('a narrowed failure has no value field (negative case)', () => {
    const outcome: Outcome<number> = failure(new Error('x'));
    if (outcome.kind !== 'failure') throw new Error('unreachable seed');

    // @ts-expect-error -- the mirror of the case above.
    const read: unknown = outcome.value;

    expect(read).toBeUndefined();
  });

  test('fold collapses both branches to one result type', () => {
    expectTypeOf(
      fold(
        success(1),
        v => v,
        () => 0,
      ),
    ).toEqualTypeOf<number>();
  });

  test('failure() infers the caller-declared payload type, not the error type', () => {
    expectTypeOf(failure<string>(new Error('x'))).toEqualTypeOf<
      Outcome<string>
    >();
  });
});
