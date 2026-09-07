// SPDX-License-Identifier: MIT
// packages/core/src/serde/tristate.test.ts
// Exercises: SERDE-14 (three states, Present-of-null unrepresentable), SERDE-18 (helpers, ofNullable never
// yields Absent), SERDE-30 (stable identity-free string form).
import {expect, test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Tristate} from './tristate.js';
import {
  absent,
  foldTristate,
  isAbsent,
  isNull,
  isPresent,
  isTristate,
  nullValue,
  ofNullable,
  present,
  tristateToString,
  valueOrNull,
} from './tristate.js';

test('exactly three states, discriminated by kind', () => {
  expect(absent().kind).toBe('absent');
  expect(nullValue().kind).toBe('null');
  expect(present(42).kind).toBe('present');
});

test('Present carries its value', () => {
  const t = present({id: 7});
  expect(isPresent(t) ? t.value : undefined).toEqual({id: 7});
});

test('predicates are mutually exclusive', () => {
  expect([isAbsent(absent()), isNull(absent()), isPresent(absent())]).toEqual([
    true,
    false,
    false,
  ]);
  expect([
    isAbsent(nullValue()),
    isNull(nullValue()),
    isPresent(nullValue()),
  ]).toEqual([false, true, false]);
  expect([
    isAbsent(present(1)),
    isNull(present(1)),
    isPresent(present(1)),
  ]).toEqual([false, false, true]);
});

test('ofNullable maps null and undefined to Null, never to Absent', () => {
  expect(ofNullable(null).kind).toBe('null');
  expect(ofNullable(undefined).kind).toBe('null');
  expect(ofNullable('x').kind).toBe('present');
});

test('foldTristate dispatches all three branches', () => {
  const label = <T>(t: Tristate<T>): string =>
    foldTristate(t, {
      onAbsent: () => 'A',
      onNull: () => 'N',
      onPresent: v => `P:${String(v)}`,
    });
  expect(label(absent())).toBe('A');
  expect(label(nullValue())).toBe('N');
  expect(label(present('hi'))).toBe('P:hi');
});

test('valueOrNull collapses both empty branches to null', () => {
  expect(valueOrNull(absent())).toBeNull();
  expect(valueOrNull(nullValue())).toBeNull();
  expect(valueOrNull(present(5))).toBe(5);
});

test('sentinels have a stable, identity-free string form (SERDE-30)', () => {
  expect(tristateToString(absent())).toBe('Absent');
  expect(tristateToString(nullValue())).toBe('Null');
  expect(tristateToString(present(3))).toBe('Present(3)');
  // Two separately constructed sentinels render identically — no identity hash leaks.
  expect(tristateToString(absent())).toBe(tristateToString(absent()));
});

test('values are frozen — a Tristate cannot be mutated after construction', () => {
  // `as unknown as {kind: string}`: deliberately widening away `readonly` and the literal type to
  // prove the *runtime* freeze, which the type system alone cannot demonstrate.
  const t = present(1) as unknown as {kind: string};
  expect(() => {
    t.kind = 'absent';
  }).toThrow();
});

test('isTristate accepts only branded values — truth table', () => {
  // A custom type guard needs the full table, not just the happy case (docs/knowledge/harvested/testing.md:34).
  expect([
    isTristate(absent()),
    isTristate(nullValue()),
    isTristate(present(1)),
  ]).toEqual([true, true, true]);
  expect([
    isTristate(null),
    isTristate(undefined),
    isTristate({}),
    isTristate({kind: 'absent'}),
    isTristate('absent'),
    isTristate(0),
    isTristate([]),
  ]).toEqual([false, false, false, false, false, false, false]);
});

test('Present of null does not type-check — the illegal fourth state is unrepresentable (SERDE-14)', () => {
  expectTypeOf<Parameters<typeof present<string>>[0]>().toEqualTypeOf<string>();
  // `NonNullable<string | null>` is `string`, so `present<string | null>(null)` is rejected by the compiler.
  expectTypeOf<
    Parameters<typeof present<string | null>>[0]
  >().toEqualTypeOf<string>();
  // @ts-expect-error — SERDE-14: Present-of-null must not compile
  present<string | null>(null);
});

test('Absent and Null are assignable to any parameterization (SERDE-14 covariance)', () => {
  expectTypeOf(absent()).toExtend<Tristate<number>>();
  expectTypeOf(nullValue()).toExtend<Tristate<{deep: string}>>();
});
