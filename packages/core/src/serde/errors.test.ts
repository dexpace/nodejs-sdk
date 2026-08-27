// SPDX-License-Identifier: MIT
// packages/core/src/serde/errors.test.ts
// Exercises: SERDE-9 (stable SDK type, cause chained), SERDE-10 (directional subtypes off one root),
// SERDE-11 (unchecked — nothing to assert in JS, documented), SERDE-28 (status/etag/location as fields),
// SEAM-23 (a stable SDK-owned failure hierarchy — here two flat leaves plus the isSerdeError guard).
import {expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  DeserializationError,
  SerializationError,
  isSerdeError,
} from './errors.js';

test('both leaves extend DexpaceError directly (two-level tree)', () => {
  expect(new SerializationError('x')).toBeInstanceOf(DexpaceError);
  expect(new DeserializationError('x')).toBeInstanceOf(DexpaceError);
  // The tree is flat: neither is an instance of the other.
  expect(new SerializationError('x')).not.toBeInstanceOf(DeserializationError);
});

test('cause is chained, not swallowed', () => {
  const backing = new Error('JSON.parse blew up');
  const error = new DeserializationError('decode failed', {cause: backing});
  expect(error.cause).toBe(backing);
});

test('isSerdeError groups both directions and rejects everything else', () => {
  expect(isSerdeError(new SerializationError('x'))).toBe(true);
  expect(isSerdeError(new DeserializationError('x'))).toBe(true);
  expect(isSerdeError(new DexpaceError('x'))).toBe(false);
  expect(isSerdeError(new Error('x'))).toBe(false);
  expect(isSerdeError(null)).toBe(false);
});

test('DeserializationError carries status/etag/location as readable fields, not only in the message', () => {
  const error = new DeserializationError('304 Not Modified: body not decoded', {
    status: 304,
    etag: 'W/"abc"',
    location: null,
  });
  expect(error.status).toBe(304);
  expect(error.etag).toBe('W/"abc"');
  expect(error.location).toBeNull();
});

test('the optional fields default to null/undefined rather than throwing', () => {
  const error = new DeserializationError('plain');
  expect(error.status).toBeUndefined();
  expect(error.etag).toBeNull();
  expect(error.location).toBeNull();
});

test('the write leaf carries no response context — there is no response behind an encode', () => {
  // The read path owns status/etag/location. Declaring them on the write leaf too would put three
  // permanently-empty fields on a published class; a caller narrows direction first, and
  // `instanceof DeserializationError` is what reaches the response context.
  const error: SerializationError = new SerializationError('x');
  expect('status' in error).toBe(false);
  expect('etag' in error).toBe(false);
  expect('location' in error).toBe(false);
});

test('isSerdeError narrows to the union; direction is narrowed before response context', () => {
  const caught: unknown = new DeserializationError('x', {status: 502});
  expect(isSerdeError(caught)).toBe(true);
  // `isSerdeError` alone does not reach `.status` — that is the read leaf's, by design.
  expect(
    isSerdeError(caught) && caught instanceof DeserializationError
      ? caught.status
      : undefined,
  ).toBe(502);
});

test('name is set so a stack trace identifies the leaf', () => {
  expect(new SerializationError('x').name).toBe('SerializationError');
  expect(new DeserializationError('x').name).toBe('DeserializationError');
});
