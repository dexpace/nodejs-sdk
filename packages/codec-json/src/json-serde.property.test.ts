// SPDX-License-Identifier: MIT
// packages/codec-json/src/json-serde.property.test.ts
// Exercises: SERDE-1 (the bundle's own serializer and deserializer round-trip each other).
import {test} from 'bun:test';
import type {Schema} from '@dexpace/core';
import fc from 'fast-check';
import {jsonSerde} from './json-serde.js';

// `as T`: the round-trip is about bytes, not shape, so the witness deliberately validates nothing.
const identity = <T>(): Schema<T> => ({parse: input => input as T});

test('serialize → deserialize is the identity for any JSON value except null', () => {
  fc.assert(
    fc.property(
      fc.jsonValue().filter(v => v !== null),
      value => {
        const serde = jsonSerde();
        const decoded = serde.deserializer.deserialize(
          serde.serializer.serialize(value),
          identity(),
        );
        return JSON.stringify(decoded) === JSON.stringify(value);
      },
    ),
  );
});

test('serializeToString → deserialize agrees with the byte profile on the same values', () => {
  fc.assert(
    fc.property(
      fc.jsonValue().filter(v => v !== null),
      value => {
        const {serializer} = jsonSerde();
        return (
          serializer.serializeToString(value) ===
          new TextDecoder().decode(serializer.serialize(value))
        );
      },
    ),
  );
});

test('serializeInto at any valid offset writes exactly what serialize produces', () => {
  fc.assert(
    fc.property(
      fc.jsonValue().filter(v => v !== null),
      fc.nat({max: 32}),
      (value, offset) => {
        const {serializer} = jsonSerde();
        const expected = serializer.serialize(value);
        const target = new Uint8Array(offset + expected.length + 8).fill(0xaa);

        const written = serializer.serializeInto(value, target, offset);

        return (
          written === expected.length &&
          target
            .slice(offset, offset + written)
            .every((b, i) => b === expected[i]) &&
          target.slice(0, offset).every(b => b === 0xaa)
        );
      },
    ),
  );
});
