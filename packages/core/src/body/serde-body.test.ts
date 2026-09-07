// SPDX-License-Identifier: MIT
// packages/core/src/body/serde-body.test.ts
// Exercises: SERDE-2 (serde's declared media type is the default Content-Type; never a format-agnostic
// constant), SERDE-9 (an encode failure surfaces as the SDK type with the original chained).
import {expect, test} from 'bun:test';
import type {Serde} from '../seams/serde.js';
import {SerializationError} from '../serde/errors.js';
import {serdeBody} from './serde-body.js';

const unused = (): never => {
  throw new Error('unused');
};

const fakeSerde = (
  mediaType: string,
  encode: (value: unknown) => Uint8Array,
): Serde => ({
  mediaType,
  serializer: {
    serialize: encode,
    serializeToString: unused,
    serializeInto: unused,
    serializeTo: unused,
  },
  deserializer: {
    deserialize: unused,
    deserializeFrom: unused,
  },
});

const encodeJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

test("media type defaults to the serde's declared type", () => {
  const body = serdeBody({a: 1}, fakeSerde('application/json', encodeJson));
  expect(body.mediaType).toBe('application/json');
});

test('a non-JSON serde stamps its own type, never a format-agnostic constant', () => {
  const body = serdeBody({a: 1}, fakeSerde('application/cbor', encodeJson));
  expect(body.mediaType).toBe('application/cbor');
  expect(body.mediaType).not.toBe('application/octet-stream');
});

test('an explicit media type overrides the default', () => {
  const body = serdeBody(
    {a: 1},
    fakeSerde('application/json', encodeJson),
    'application/merge-patch+json',
  );
  expect(body.mediaType).toBe('application/merge-patch+json');
});

test('the body is eagerly encoded, so it is replayable and has a known length', () => {
  const body = serdeBody({a: 1}, fakeSerde('application/json', encodeJson));
  expect(body.replayable).toBe(true);
  expect(body.contentLength).toBe(new TextEncoder().encode('{"a":1}').length);
});

test('the encoded bytes reach the sink', async () => {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(chunk);
    },
  });
  await serdeBody({a: 1}, fakeSerde('application/json', encodeJson)).writeTo(
    sink,
  );
  const joined = chunks.reduce(
    (acc, c) => acc + new TextDecoder().decode(c),
    '',
  );
  expect(joined).toBe('{"a":1}');
});

test('an encode failure surfaces as SerializationError with the original chained', () => {
  const boom = new Error('circular');
  const broken = fakeSerde('application/json', () => {
    throw boom;
  });
  let caught: unknown;
  try {
    serdeBody({a: 1}, broken);
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(SerializationError);
  // `as SerializationError`: narrowed by the assertion above, which the compiler cannot follow.
  expect((caught as SerializationError).cause).toBe(boom);
});

test('an already-typed SerializationError from the codec is not double-wrapped', () => {
  const original = new SerializationError('codec said no');
  const broken = fakeSerde('application/json', () => {
    throw original;
  });
  let caught: unknown;
  try {
    serdeBody({a: 1}, broken);
  } catch (e: unknown) {
    caught = e;
  }
  expect(caught).toBe(original);
});
