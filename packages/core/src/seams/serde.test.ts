// SPDX-License-Identifier: MIT
// packages/core/src/seams/serde.test.ts
// Exercises: SERDE-1 (one bundle, one encoder, one decoder), SERDE-2 (mediaType required, never optional),
// SERDE-5 (decode takes an explicit schema witness — SEAM-21), SERDE-6 (parametric targets via combinators),
// SEAM-19/SEAM-20 (the bundle's shape and its four allocation profiles).
// `bun test` executes this file but does not typecheck it; the assertions only fire under `bun run typecheck`.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {Deserializer, Schema, Serde, Serializer} from './serde.js';

test('Serde bundles exactly one serializer and one deserializer for one media type', () => {
  expectTypeOf<Serde>().toHaveProperty('mediaType').toEqualTypeOf<string>();
  expectTypeOf<Serde>()
    .toHaveProperty('serializer')
    .toEqualTypeOf<Serializer>();
  expectTypeOf<Serde>()
    .toHaveProperty('deserializer')
    .toEqualTypeOf<Deserializer>();
});

test('an implementation without mediaType is rejected (negative case, styleguide 11.6)', () => {
  // @ts-expect-error -- SEAM-19: mediaType is required and never defaulted; omitting it must not compile
  const missingMediaType: Serde = {
    serializer: {} as Serializer,
    deserializer: {} as Deserializer,
  };
  void missingMediaType;
});

test("decode's return type is driven by the schema argument, not by the bundle", () => {
  type Decoded = ReturnType<Deserializer['deserialize']>;
  // Unconstrained call site infers `unknown`; the constrained one below is the real assertion.
  expectTypeOf<Decoded>().toBeUnknown();

  const decode = (d: Deserializer, s: Schema<{id: number}>): {id: number} =>
    d.deserialize(new Uint8Array(), {schema: s});
  expectTypeOf(decode).returns.toEqualTypeOf<{id: number}>();
});

test('a parametric target needs no special carrier — the schema is a combinator over element schemas', () => {
  const decodeMany = (
    d: Deserializer,
    s: Schema<readonly {id: number}[]>,
  ): readonly {id: number}[] => d.deserialize(new Uint8Array(), {schema: s});
  expectTypeOf(decodeMany).returns.toEqualTypeOf<readonly {id: number}[]>();
});

test('serializeInto returns a byte count and accepts an optional offset', () => {
  expectTypeOf<Serializer['serializeInto']>().returns.toEqualTypeOf<number>();
  expectTypeOf<Serializer['serializeInto']>()
    .parameter(2)
    .toEqualTypeOf<number | undefined>();
});

test('all four SEAM-20 allocation profiles are present, including the fresh-string one', () => {
  expectTypeOf<
    Serializer['serializeToString']
  >().returns.toEqualTypeOf<string>();
  expectTypeOf<Serializer['serialize']>().returns.toEqualTypeOf<Uint8Array>();
  expectTypeOf<Serializer>().toHaveProperty('serializeTo');
  expectTypeOf<Serializer>().toHaveProperty('serializeInto');
});

test('the stream profiles take platform stream types, never a core-internal io type', () => {
  expectTypeOf<Serializer['serializeTo']>()
    .parameter(1)
    .toEqualTypeOf<WritableStream<Uint8Array>>();
  expectTypeOf<Deserializer['deserializeFrom']>()
    .parameter(0)
    .toEqualTypeOf<ReadableStream<Uint8Array>>();
});
