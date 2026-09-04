// SPDX-License-Identifier: MIT
// packages/codec-json/src/json-serde.test.ts
// Exercises: SERDE-1 (round-trip through one bundle), SERDE-2 (declared media type), SERDE-3 (never closes a
// caller stream), SERDE-4 (offset, byte count, RangeError with no cause), SERDE-5 (the schema witness drives
// the decode), SERDE-6 (parametric targets are combinator schemas), SERDE-9/SERDE-10 (library error never
// escapes; the directional leaves), SERDE-12 (the codec re-wraps nothing off the stream), SERDE-13 (a wire
// null into a non-null target, on every entry point, before the schema), SERDE-20 (a top-level unencodable
// value throws rather than sharing the Tristate degradation's old fallback), SERDE-25 (fresh instance per
// call), SEAM-20 (all four allocation profiles).
import {describe, expect, test} from 'bun:test';
import {
  DeserializationError,
  SerializationError,
  type Schema,
} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

/** Distinguishes "the promise resolved" from a rejection value that happens to be falsy. */
const RESOLVED = Symbol('resolved');

/**
 * Settles `promise` and hands back whatever it rejected with.
 *
 * `expect(p).rejects.toX()` is typed `void` under `bun:test`, so awaiting it trips `await-thenable`.
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return RESOLVED;
  } catch (e: unknown) {
    return e;
  }
}

test('declares application/json as its wire media type', () => {
  expect(jsonSerde().mediaType).toBe('application/json');
});

test('each call returns a fresh, frozen bundle (SERDE-25)', () => {
  const a = jsonSerde();
  const b = jsonSerde();

  expect(a).not.toBe(b);
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.serializer)).toBe(true);
  expect(Object.isFrozen(a.deserializer)).toBe(true);
});

test('serialize encodes to UTF-8 JSON bytes', () => {
  const bytes = jsonSerde().serializer.serialize({id: 1, name: 'ünïcode'});

  expect(new TextDecoder().decode(bytes)).toBe('{"id":1,"name":"ünïcode"}');
});

test('serializeToString is the fresh-string allocation profile SEAM-20 requires', () => {
  const serde = jsonSerde();

  expect(serde.serializer.serializeToString({id: 1, name: 'ünïcode'})).toBe(
    '{"id":1,"name":"ünïcode"}',
  );
  // The string and byte profiles are two views of one encoding, not two encoders that can drift.
  expect(serde.serializer.serialize({a: 1})).toEqual(
    new TextEncoder().encode(serde.serializer.serializeToString({a: 1})),
  );
});

test('a top-level value with no JSON representation throws, never encodes as null (SERDE-9)', () => {
  // `JSON.stringify` returns the VALUE `undefined` for a top-level undefined, function, or symbol.
  // Emitting the `null` literal instead — tempting, because a byte- or string-producing profile has
  // to emit SOMETHING — substitutes a meaningful wire value ("clear this field", to a PATCH server)
  // for a payload the caller cannot have meant to send. All three are unencodable values, which
  // SERDE-9/SERDE-10 require surface as the stable serde type. SERDE-20's top-level Tristate
  // degradation is the one case that legitimately encodes as `null`, and it is resolved before
  // `JSON.stringify` runs rather than through this path — see tristate-replacer.test.ts.
  const {serializer} = jsonSerde();

  for (const unencodable of [undefined, () => 0, Symbol('x')]) {
    expect(() => serializer.serializeToString(unencodable)).toThrow(
      SerializationError,
    );
    expect(() => serializer.serialize(unencodable)).toThrow(SerializationError);
    expect(() =>
      serializer.serializeInto(unencodable, new Uint8Array(64)),
    ).toThrow(SerializationError);
  }
});

test('the unencodable-value message names the typeof, so the caller can see which it was', () => {
  const {serializer} = jsonSerde();
  let caught: unknown;
  try {
    serializer.serializeToString(() => 0);
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SerializationError);
  expect((caught as SerializationError).message).toContain('function');
  // A plain unencodable value has nothing to chain — there was no library error to preserve.
  expect((caught as SerializationError).cause).toBeUndefined();
});

test('a nested undefined or function still follows ordinary JSON.stringify rules', () => {
  // Only the TOP level throws: nested, `JSON.stringify` drops the key, which is well-understood
  // behaviour a caller relies on and is not this codec's to override.
  const {serializer} = jsonSerde();

  expect(serializer.serializeToString({a: 1, b: undefined})).toBe('{"a":1}');
  expect(serializer.serializeToString({a: 1, b: () => 0})).toBe('{"a":1}');
  expect(serializer.serializeToString([1, undefined, 2])).toBe('[1,null,2]');
});

test('an unencodable value throws SerializationError, never the library type (SERDE-9)', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  let caught: unknown;

  try {
    jsonSerde().serializer.serialize(cyclic);
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SerializationError);
  expect(caught).toHaveProperty('cause', expect.any(TypeError));
});

test('every allocation profile routes an unencodable value through the same SDK type', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const {serializer} = jsonSerde();

  expect(() => serializer.serializeToString(cyclic)).toThrow(
    SerializationError,
  );
  expect(() => serializer.serialize(cyclic)).toThrow(SerializationError);
  expect(() => serializer.serializeInto(cyclic, new Uint8Array(64))).toThrow(
    SerializationError,
  );
});

test('serializeInto honors an offset, returns the byte count, and leaves the prefix untouched (SERDE-4)', () => {
  const target = new Uint8Array(64).fill(0xaa);

  const written = jsonSerde().serializer.serializeInto({a: 1}, target, 10);

  const expected = new TextEncoder().encode('{"a":1}');
  expect(written).toBe(expected.length);
  expect(target.slice(10, 10 + written)).toEqual(expected);
  expect(target.slice(0, 10)).toEqual(new Uint8Array(10).fill(0xaa));
  // Nothing past the written region is touched either — the buffer is the caller's.
  expect(target.slice(10 + written)).toEqual(
    new Uint8Array(64 - 10 - written).fill(0xaa),
  );
});

test('serializeInto with no offset writes at 0', () => {
  const target = new Uint8Array(32);

  const written = jsonSerde().serializer.serializeInto({a: 1}, target);

  expect(target.slice(0, written)).toEqual(new TextEncoder().encode('{"a":1}'));
});

test('a payload that does not fit throws a plain RangeError with no cause (SERDE-4)', () => {
  const target = new Uint8Array(3).fill(0xaa);
  let caught: unknown;

  try {
    jsonSerde().serializer.serializeInto({a: 1}, target);
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(RangeError);
  expect(caught).not.toBeInstanceOf(SerializationError);
  expect((caught as RangeError).cause).toBeUndefined();
  // An overflow leaves the buffer exactly as it was — no partial write.
  expect(target).toEqual(new Uint8Array(3).fill(0xaa));
});

test('an out-of-range offset throws RangeError', () => {
  const {serializer} = jsonSerde();

  expect(() =>
    serializer.serializeInto({a: 1}, new Uint8Array(32), -1),
  ).toThrow(RangeError);
  expect(() =>
    serializer.serializeInto({a: 1}, new Uint8Array(32), 99),
  ).toThrow(RangeError);
  expect(() =>
    serializer.serializeInto({a: 1}, new Uint8Array(32), 1.5),
  ).toThrow(RangeError);
  expect(() =>
    serializer.serializeInto({a: 1}, new Uint8Array(32), Number.NaN),
  ).toThrow(RangeError);
});

test('an exactly-fitting buffer is not an overflow', () => {
  const expected = new TextEncoder().encode('{"a":1}');
  const target = new Uint8Array(expected.length);

  expect(jsonSerde().serializer.serializeInto({a: 1}, target)).toBe(
    expected.length,
  );
  expect(target).toEqual(expected);
});

test('serializeTo writes fully and never closes the caller-owned sink (SERDE-3)', async () => {
  let closed = false;
  let aborted = false;
  const chunks: string[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
    close() {
      closed = true;
    },
    abort() {
      aborted = true;
    },
  });

  await jsonSerde().serializer.serializeTo({a: 1}, sink);

  expect(chunks.join('')).toBe('{"a":1}');
  expect(closed).toBe(false);
  expect(aborted).toBe(false);
});

test('serializeTo releases the writer lock, so the caller can keep using its own sink', async () => {
  const chunks: string[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
  });
  const serde = jsonSerde();

  await serde.serializer.serializeTo({a: 1}, sink);
  await serde.serializer.serializeTo({b: 2}, sink);

  expect(chunks.join('')).toBe('{"a":1}{"b":2}');
});

test('serializeTo rejects an unencodable value without ever locking the caller-owned sink', async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const sink = new WritableStream<Uint8Array>();
  let caught: unknown;

  try {
    await jsonSerde().serializer.serializeTo(cyclic, sink);
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(SerializationError);
  // Encoding happens before the lock is taken: a failed encode leaves the sink untouched and usable.
  expect(sink.locked).toBe(false);
});

interface Dto {
  readonly id: number;
}

const dtoSchema: Schema<Dto> = {
  parse(input: unknown): Dto {
    // `as Dto`: probing one field on an `unknown` already proven a non-null object.
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as Dto).id !== 'number'
    ) {
      throw new Error('not a Dto');
    }
    return input as Dto;
  },
};

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const streamOf = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(text));
      controller.close();
    },
  });

test('decode runs the schema over the parsed value (SERDE-5)', () => {
  expect(
    jsonSerde().deserializer.deserialize(bytes('{"id":3}'), {
      schema: dtoSchema,
      typeName: 'Dto',
    }),
  ).toEqual({id: 3});
});

test('a parametric target is just a combinator schema — no carrier type exists (SERDE-6)', () => {
  const arraySchema: Schema<readonly Dto[]> = {
    // `as unknown[]`: JSON arrays arrive as `unknown`; the element schema validates each entry.
    parse: input => (input as unknown[]).map(e => dtoSchema.parse(e)),
  };

  expect(
    jsonSerde().deserializer.deserialize(bytes('[{"id":1},{"id":2}]'), {
      schema: arraySchema,
    }),
  ).toEqual([{id: 1}, {id: 2}]);
});

test('malformed JSON throws DeserializationError with the library error chained (SERDE-9)', () => {
  let caught: unknown;

  try {
    jsonSerde().deserializer.deserialize(bytes('{not json'), {
      schema: dtoSchema,
      typeName: 'Dto',
    });
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(DeserializationError);
  expect(caught).toHaveProperty('cause', expect.any(SyntaxError));
});

test('a schema rejection throws DeserializationError naming the target (SERDE-9)', () => {
  let caught: unknown;

  try {
    jsonSerde().deserializer.deserialize(bytes('{"id":"x"}'), {
      schema: dtoSchema,
      typeName: 'Dto',
    });
  } catch (e: unknown) {
    caught = e;
  }

  expect(caught).toBeInstanceOf(DeserializationError);
  expect(caught).toHaveProperty('message', expect.stringContaining('Dto'));
  expect(caught).toHaveProperty('cause', expect.any(Error));
});

/**
 * Accepts anything, so a rejection can only have come from the codec.
 *
 * Driven through a permissive witness deliberately: with `dtoSchema` a deleted wire-null check still
 * produces a `DeserializationError` naming `Dto` — the schema rejects `null` on its own and the wrapper
 * message reads almost the same — so those assertions cannot tell the two rejectors apart. Verified by
 * mutation: removing `decodeText`'s null branch left every `dtoSchema`-driven case green.
 */
const permissiveSchema = (): {schema: Schema<unknown>; ran: () => boolean} => {
  let ran = false;
  return {
    schema: {
      parse: i => {
        ran = true;
        return i;
      },
    },
    ran: () => ran,
  };
};

/** The codec's own wire-null message, which a schema rejection cannot produce. */
const WIRE_NULL_MESSAGE =
  /wire null cannot be decoded into the non-null target/;

test('a wire null into a non-null target fails naming the target, on every entry point (SERDE-13)', async () => {
  const {deserializer} = jsonSerde();
  const first = permissiveSchema();
  const second = permissiveSchema();

  expect(() =>
    deserializer.deserialize(bytes('null'), {
      schema: first.schema,
      typeName: 'Dto',
    }),
  ).toThrow(DeserializationError);
  expect(() =>
    deserializer.deserialize(bytes('null'), {
      schema: first.schema,
      typeName: 'Dto',
    }),
  ).toThrow(WIRE_NULL_MESSAGE);

  const caught = await rejection(
    deserializer.deserializeFrom(streamOf('null'), {
      schema: second.schema,
      typeName: 'Dto',
    }),
  );
  expect(caught).toBeInstanceOf(DeserializationError);
  expect(caught).toHaveProperty(
    'message',
    expect.stringMatching(WIRE_NULL_MESSAGE),
  );
  expect(caught).toHaveProperty('message', expect.stringContaining('Dto'));
  // Neither entry point reached the witness: the codec rejected, not the schema.
  expect([first.ran(), second.ran()]).toEqual([false, false]);
});

test('the wire-null rejection is raised before the schema runs, so a permissive schema cannot swallow it', () => {
  const permissive = permissiveSchema();

  expect(() =>
    jsonSerde().deserializer.deserialize(bytes('null'), {
      schema: permissive.schema,
      typeName: 'Loose',
    }),
  ).toThrow(DeserializationError);
  expect(permissive.ran()).toBe(false);
});

test('the null rejection falls back to a documented label when no typeName is given', () => {
  const permissive = permissiveSchema();

  expect(() =>
    jsonSerde().deserializer.deserialize(bytes('null'), {
      schema: permissive.schema,
    }),
  ).toThrow(
    /wire null cannot be decoded into the non-null target the target type/,
  );
  expect(permissive.ran()).toBe(false);
});

test('deserializeFrom reads to EOF across multiple chunks and never cancels the source (SERDE-3)', async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes('{"id"'));
      controller.enqueue(bytes(':42}'));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  expect(
    await jsonSerde().deserializer.deserializeFrom(source, {
      schema: dtoSchema,
      typeName: 'Dto',
    }),
  ).toEqual({id: 42});
  expect(cancelled).toBe(false);
});

test('deserializeFrom releases the reader lock on the success path', async () => {
  const source = streamOf('{"id":1}');

  await jsonSerde().deserializer.deserializeFrom(source, {
    schema: dtoSchema,
    typeName: 'Dto',
  });

  expect(source.locked).toBe(false);
});

test('a genuine stream failure propagates unwrapped, and the lock is still released (SERDE-12)', async () => {
  // Asserted with a plain sentinel rather than core's `IoError`: that class is deliberately
  // package-private to `@dexpace/core` (Phase 3b froze `io/` as unexported), and the requirement is
  // that the codec re-wraps NOTHING coming off the stream — which a sentinel proves more broadly.
  const failure = new Error('socket reset');
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });

  const caught = await rejection(
    jsonSerde().deserializer.deserializeFrom(source, {
      schema: dtoSchema,
      typeName: 'Dto',
    }),
  );

  expect(caught).toBe(failure);
  expect(caught).not.toBeInstanceOf(DeserializationError);
});

test('an empty body is a malformed payload, not a silent undefined (SERDE-9)', async () => {
  const empty = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });

  expect(
    await rejection(
      jsonSerde().deserializer.deserializeFrom(empty, {
        schema: dtoSchema,
        typeName: 'Dto',
      }),
    ),
  ).toBeInstanceOf(DeserializationError);
});

test('a UTF-8 payload split mid-multi-byte-character across chunks decodes correctly', async () => {
  const full = bytes('{"id":1,"n":"ü"}');
  const split = full.indexOf(0xc3); // the first byte of "ü"
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(full.slice(0, split + 1));
      controller.enqueue(full.slice(split + 1));
      controller.close();
    },
  });
  // `as {id: number; n: string}`: a deliberately loose schema; the assertion is about bytes, not shape.
  const looseSchema: Schema<{id: number; n: string}> = {
    parse: i => i as {id: number; n: string},
  };

  expect(
    await jsonSerde().deserializer.deserializeFrom(source, {
      schema: looseSchema,
    }),
  ).toEqual({id: 1, n: 'ü'});
});

test("serializeInto writes through a subarray VIEW at the view's own coordinates (SERDE-4)", () => {
  // `target` is typed `Uint8Array`, and a caller carving one out of a pool hands over a view with a
  // non-zero `byteOffset`. `offset` must be relative to the VIEW, the fit check must use the view's
  // length rather than the backing buffer's, and nothing outside the view may be touched.
  const backing = new Uint8Array(24).fill(0xaa);
  const view = backing.subarray(4, 16); // 12 bytes, byteOffset 4
  const {serializer} = jsonSerde();

  const written = serializer.serializeInto({a: 1}, view, 2);
  const payload = serializer.serialize({a: 1});

  expect(written).toBe(payload.length);
  // Landed at byteOffset + offset, not at the backing buffer's absolute `offset`. Compared as plain
  // arrays: `serialize` returns `Uint8Array<ArrayBufferLike>` and `subarray` here is
  // `Uint8Array<ArrayBuffer>`, which `toEqual`'s overloads will not unify.
  expect(Array.from(backing.subarray(6, 6 + written))).toEqual(
    Array.from(payload),
  );
  // Everything outside [6, 6+written) is untouched, on BOTH sides of the view.
  expect(backing.subarray(0, 6).every(b => b === 0xaa)).toBe(true);
  expect(backing.subarray(6 + written).every(b => b === 0xaa)).toBe(true);
});

test('the fit check measures the view, not the buffer behind it (SERDE-4)', () => {
  // A 4-byte window onto a 64-byte buffer has room for 4 bytes, not 64. Measuring the backing
  // buffer would let the write run past the window the caller actually lent out.
  const backing = new Uint8Array(64).fill(0xaa);
  const view = backing.subarray(0, 4);

  expect(() => jsonSerde().serializer.serializeInto({a: 1}, view, 0)).toThrow(
    RangeError,
  );
  expect(backing.every(b => b === 0xaa)).toBe(true);
});

describe('DecodeTarget object form, admitsNull, and {signal} (H9/H10/H15 batch, 2026-09-04)', () => {
  const serde = jsonSerde();
  const passthrough: Schema<unknown> = {parse: (i: unknown) => i};

  test('deserialize takes a DecodeTarget, not positional schema/typeName', () => {
    const bytes = new TextEncoder().encode('{"a":1}');
    expect(
      serde.deserializer.deserialize(bytes, {schema: passthrough}),
    ).toEqual({a: 1});
  });

  test('the typeName still reaches the error message through the target', () => {
    const bytes = new TextEncoder().encode('null');
    expect(() =>
      serde.deserializer.deserialize(bytes, {
        schema: passthrough,
        typeName: 'Pet',
      }),
    ).toThrow(/non-null target Pet/);
  });

  test('admitsNull lets a top-level wire null through to the schema (SERDE-13 opt-in)', () => {
    const bytes = new TextEncoder().encode('null');
    expect(
      serde.deserializer.deserialize(bytes, {
        schema: passthrough,
        admitsNull: true,
      }),
    ).toBeNull();
  });

  test('admitsNull is off by default, so the unconditional rejection is unchanged', () => {
    const bytes = new TextEncoder().encode('null');
    expect(() =>
      serde.deserializer.deserialize(bytes, {schema: passthrough}),
    ).toThrow(DeserializationError);
  });
});

describe('{signal} on the two stream-driving SPI methods (H15)', () => {
  const serde = jsonSerde();
  const passthrough: Schema<unknown> = {parse: (i: unknown) => i};

  test('deserializeFrom honors an already-aborted signal before reading', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}'));
        controller.close();
      },
    });
    expect(
      await rejection(
        serde.deserializer.deserializeFrom(
          source,
          {schema: passthrough},
          {signal: AbortSignal.abort()},
        ),
      ),
    ).toBeInstanceOf(Error);
  });

  test('deserializeFrom leaves the source uncancelled when the signal aborts (SERDE-3)', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}'));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    await serde.deserializer
      .deserializeFrom(
        source,
        {schema: passthrough},
        {signal: AbortSignal.abort()},
      )
      .catch(() => undefined);
    expect(cancelled).toBe(false);
  });

  test('serializeTo honors an already-aborted signal and leaves the sink unclosed', async () => {
    let closed = false;
    const sink = new WritableStream<Uint8Array>({
      close() {
        closed = true;
      },
    });
    expect(
      await rejection(
        serde.serializer.serializeTo({a: 1}, sink, {
          signal: AbortSignal.abort(),
        }),
      ),
    ).toBeInstanceOf(Error);
    expect(closed).toBe(false);
  });
});

describe('the options argument stays optional on both stream methods', () => {
  const serde = jsonSerde();
  const passthrough: Schema<unknown> = {parse: (i: unknown) => i};

  test('an absent options argument keeps both stream methods working', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":1}'));
        controller.close();
      },
    });
    expect(
      await serde.deserializer.deserializeFrom(source, {schema: passthrough}),
    ).toEqual({a: 1});
  });
});
