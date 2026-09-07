// SPDX-License-Identifier: MIT
// packages/codec-json/src/conformance.test.ts
// Exercises the requirements the Phase 6a design dispositions as satisfied-by-construction: SERDE-21 (no
// cross-shape coercion), SERDE-22 (representation-preserving conversions still bind), SERDE-23 (unknown
// fields are the schema's decision, not the codec's), SERDE-24 (ISO-8601 dates round-trip), SERDE-29 (a
// bundle is safe to share once configured).
//
// No code in this repository implements SERDE-21 or SERDE-22 — `JSON.parse` performs no coercion, so there
// is nothing to switch off. These tests ARE the coverage, and Phase 9's sweep reads them as the evidence.
import {expect, test} from 'bun:test';
import type {Schema} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

const numberSchema: Schema<number> = {
  parse: i => {
    if (typeof i !== 'number') throw new Error('not a number');
    return i;
  },
};
const intSchema: Schema<number> = {
  parse: i => {
    if (!Number.isInteger(i)) throw new Error('not an integer');
    // `as number`: `Number.isInteger` is not a type guard, but it cannot return true for a non-number.
    return i as number;
  },
};
const boolSchema: Schema<boolean> = {
  parse: i => {
    if (typeof i !== 'boolean') throw new Error('not a boolean');
    return i;
  },
};
const stringSchema: Schema<string> = {
  parse: i => {
    if (typeof i !== 'string') throw new Error('not a string');
    return i;
  },
};

const decode = <T>(json: string, schema: Schema<T>): T =>
  jsonSerde().deserializer.deserialize(new TextEncoder().encode(json), {
    schema,
    typeName: 'Target',
  });

// Typed as `Schema<unknown>` rather than inferred: `test.each` would otherwise widen the column to a
// union of the three schema types, which no single `decode` call site can accept. Schemas are
// covariant in their output, so each concrete schema is assignable here.
const COERCION_CASES: readonly (readonly [string, string, Schema<unknown>])[] =
  [
    ['string → integer', '"5"', intSchema],
    ['string → float', '"1.5"', numberSchema],
    ['string → boolean', '"true"', boolSchema],
    ['empty string → integer', '""', intSchema],
    ['empty string → float', '""', numberSchema],
    ['empty string → boolean', '""', boolSchema],
    ['float → integer (lossy narrowing)', '1.5', intSchema],
    ['boolean → integer', 'true', intSchema],
    ['integer → boolean', '1', boolSchema],
    ['boolean → float', 'true', numberSchema],
    ['integer → string', '5', stringSchema],
    ['boolean → string', 'true', stringSchema],
  ];

test.each(COERCION_CASES)(
  'SERDE-21: %s is rejected, never silently reshaped',
  (_name, json, schema) => {
    expect(() => decode(json, schema)).toThrow();
  },
);

test('SERDE-22: an integer binds to a float target (JavaScript has one numeric type)', () => {
  expect(decode('5', numberSchema)).toBe(5);
});

test('SERDE-22: an empty string binds to a textual target', () => {
  expect(decode('""', stringSchema)).toBe('');
});

test('SERDE-22: every well-typed value binds to its matching target', () => {
  expect(decode('1.5', numberSchema)).toBe(1.5);
  expect(decode('true', boolSchema)).toBe(true);
  expect(decode('"text"', stringSchema)).toBe('text');
});

test('SERDE-23: a permissive schema keeps an unknown wire field — the codec never rejects one', () => {
  // The delegation, proven rather than asserted: nothing in this codec inspects the key set. A
  // server adding a backward-compatible field does not break a client that has not regenerated.
  const permissive: Schema<{id: number}> = {
    parse: i => {
      // `as {id: unknown}`: the wire shape this schema is written against, narrowed field by field
      // on the next line rather than trusted.
      const o = i as {id: unknown};
      if (typeof o.id !== 'number') throw new Error('not an id');
      // Returned as-is, extra keys included — this is what "ignore unknown fields" looks like when
      // the schema, not the codec, owns the policy. `as {id: number}`: `id` was just checked; the
      // extra keys are deliberately carried through and are outside the declared type.
      return i as {id: number};
    },
  };

  // `as Record<string, unknown>`: the decoded value's declared type is `{id: number}` and the point
  // of the assertion is the key the type does NOT name, which is present at runtime.
  const decoded = decode('{"id":1,"addedLater":true}', permissive) as Record<
    string,
    unknown
  >;

  expect(decoded).toEqual({id: 1, addedLater: true});
});

test("SERDE-23: a strict schema rejects the same payload — the policy is the schema's, either way", () => {
  const strict: Schema<{id: number}> = {
    parse: i => {
      // `as Record<string, unknown>`: this schema's whole job is to inspect the key set, and
      // `unknown` is not indexable.
      const o = i as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length !== 1 || typeof o.id !== 'number') {
        throw new Error(`unexpected keys: ${keys.join(',')}`);
      }
      return {id: o.id};
    },
  };

  expect(decode('{"id":1}', strict)).toEqual({id: 1});
  // Same codec, same bytes, opposite outcome — because the schema changed, not the codec.
  expect(() => decode('{"id":1,"addedLater":true}', strict)).toThrow();
});

test('SERDE-24: a Date encodes as ISO-8601 and round-trips to the same instant', () => {
  const instant = new Date('2026-07-28T12:34:56.789Z');

  const encoded = new TextDecoder().decode(
    jsonSerde().serializer.serialize({at: instant}),
  );

  expect(encoded).toBe('{"at":"2026-07-28T12:34:56.789Z"}');
  // `as {at: string}`: the wire shape, which the schema's whole job is to reconstitute.
  const dateSchema: Schema<{at: Date}> = {
    parse: i => ({at: new Date((i as {at: string}).at)}),
  };
  expect(decode(encoded, dateSchema).at.getTime()).toBe(instant.getTime());
});

/**
 * A source that hands its payload back one byte at a time, so every read is a separate microtask.
 *
 * `deserializeFrom`'s read loop therefore yields between chunks, which is what makes 200 of these
 * genuinely interleave. Wrapping synchronous `deserialize` calls in `Promise.resolve` would not: they
 * run to completion during array construction, and the assertion would hold for a deeply stateful
 * bundle too.
 */
const drip = (text: string): ReadableStream<Uint8Array> => {
  const payload = new TextEncoder().encode(text);
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= payload.length) {
        controller.close();
        return;
      }
      controller.enqueue(payload.subarray(index, index + 1));
      index += 1;
    },
  });
};

test('SERDE-29: one bundle serves many concurrent operations without cross-talk', async () => {
  const serde = jsonSerde();
  const identity: Schema<unknown> = {parse: i => i};
  let inFlight = 0;
  let peakInFlight = 0;

  const results = await Promise.all(
    Array.from({length: 200}, async (_, i) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        return await serde.deserializer.deserializeFrom(
          drip(serde.serializer.serializeToString({i})),
          {schema: identity},
        );
      } finally {
        inFlight -= 1;
      }
    }),
  );

  expect(results).toEqual(Array.from({length: 200}, (_, i) => ({i})));
  // The test is worthless without this: it asserts the decodes really did overlap, so a bundle that
  // carried per-operation state would be caught rather than run to completion one at a time.
  expect(peakInFlight).toBe(200);
});
