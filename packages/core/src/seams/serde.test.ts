// SPDX-License-Identifier: MIT
// packages/core/src/seams/serde.test.ts
// Exercises: SEAM-19 (mediaType required, never defaulted) — a compile-time check only (styleguide 11.6);
// `bun test` executes this file but does not typecheck it (its transpiler strips types without checking them).
// The assertions only actually fire under `bun run typecheck` — see the plan's Task 5 Step 3.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Serde} from './serde.js';

test('mediaType is a required, non-optional string', () => {
  expectTypeOf<Serde<string>>()
    .toHaveProperty('mediaType')
    .toEqualTypeOf<string>();
});

test("deserialize's return type is bound to the instance's T", () => {
  expectTypeOf<Serde<number>['deserialize']>().returns.toEqualTypeOf<number>();
});

test("serialize's parameter type is bound to the instance's T", () => {
  expectTypeOf<Serde<boolean>['serialize']>()
    .parameter(0)
    .toEqualTypeOf<boolean>();
});

test('an implementation without mediaType is rejected (negative case, styleguide 11.6)', () => {
  // @ts-expect-error -- SEAM-19: mediaType is required and never defaulted; omitting it must not compile
  const missingMediaType: Serde<string> = {
    serialize: (value: string): unknown => value,
    deserialize: (data: unknown): string => String(data),
  };
  void missingMediaType;
});
