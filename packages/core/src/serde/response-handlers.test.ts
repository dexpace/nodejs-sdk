// SPDX-License-Identifier: MIT
// packages/core/src/serde/response-handlers.test.ts
// Exercises: SERDE-27 (stream through the deserializer without materializing, close on every path, missing
// body names the target, codec failure wrapped with cause, genuine I/O error propagates unwrapped),
// SERDE-12 (a stream failure is never re-wrapped — every leaf of this SDK's typed tree, not just
// `IoError`, whose tree is FLAT), SERDE-28 (status-aware routing, preserved ETag/Location).
import {expect, test} from 'bun:test';
import {HttpStatusError} from '../body/http-status-error.js';
import {Status} from '../http/status.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  SourceContractViolationError,
} from '../io/errors.js';
import type {DecodeTarget, Deserializer, Schema} from '../seams/serde.js';
import type {SuppressedErrorLike} from '../suppress.js';
import {DeserializationError} from './errors.js';
import {decodeResponse, decodeSuccessResponse} from './response-handlers.js';

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

/** A deserializer that reads the source to EOF and JSON-parses it. Never cancels the source. */
const jsonish: Deserializer = {
  deserialize<T>(data: Uint8Array, target: DecodeTarget<T>): T {
    // `as unknown`: `JSON.parse` is typed `any`; the cast narrows away from it at the boundary.
    return target.schema.parse(
      JSON.parse(new TextDecoder().decode(data)) as unknown,
    );
  },
  async deserializeFrom<T>(
    source: ReadableStream<Uint8Array>,
    target: DecodeTarget<T>,
    options?: {readonly signal?: AbortSignal | undefined},
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    const reader = source.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = chunks.map(c => new TextDecoder().decode(c)).join('');
    return target.schema.parse(JSON.parse(text) as unknown);
  },
};

function bodyOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function failingBody(error: Error): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
}

type FakeResponse = Parameters<typeof decodeResponse>[0];

/** Distinguishes "the promise resolved" from a rejection value that happens to be falsy. */
const RESOLVED = Symbol('resolved');

/**
 * Settles `promise` and hands back whatever it rejected with.
 *
 * `expect(p).rejects.toX()` is typed `void` under `bun:test`, so awaiting it trips `await-thenable`;
 * capturing the rejection as a value is the idiom the rest of this package's async tests use.
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return RESOLVED;
  } catch (e: unknown) {
    return e;
  }
}

/** Minimal close-counting stand-in for `Response`. Only the fields the handler touches. */
function fakeResponse(body: ReadableStream<Uint8Array> | null): {
  response: FakeResponse;
  closes: () => number;
} {
  let closeCount = 0;
  // `as unknown as FakeResponse`: `Response` carries `#private` fields, so no object literal is
  // assignable to it; `decodeResponse` reads only `body` and calls `close()`.
  const response = {
    body,
    close(): Promise<void> {
      closeCount += 1;
      return Promise.resolve();
    },
  } as unknown as FakeResponse;
  return {response, closes: () => closeCount};
}

/** A response whose `close()` always rejects, for the suppression cases. */
function failingCloseResponse(
  body: ReadableStream<Uint8Array> | null,
  closeFailure: Error,
): FakeResponse {
  // `as unknown as FakeResponse`: see `fakeResponse` above.
  return {
    body,
    close(): Promise<void> {
      return Promise.reject(closeFailure);
    },
  } as unknown as FakeResponse;
}

const dtoTarget = {schema: dtoSchema, typeName: 'Dto'} as const;

test('a valid body decodes to the typed value and the response closes exactly once', async () => {
  const {response, closes} = fakeResponse(bodyOf('{"id":7}'));

  expect(await decodeResponse(response, jsonish, dtoTarget)).toEqual({id: 7});
  expect(closes()).toBe(1);
});

test('a missing body throws DeserializationError naming the target, and still closes', async () => {
  const {response, closes} = fakeResponse(null);

  const caught = await rejection(decodeResponse(response, jsonish, dtoTarget));

  expect(caught).toBeInstanceOf(DeserializationError);
  expect(caught).toHaveProperty('message', expect.stringContaining('Dto'));
  expect(closes()).toBe(1);
});

test('a missing body with no typeName falls back to a documented label', async () => {
  const {response} = fakeResponse(null);

  const caught = await rejection(
    decodeResponse(response, jsonish, {schema: dtoSchema}),
  );

  expect(caught).toHaveProperty(
    'message',
    expect.stringContaining('the target type'),
  );
});

test('a codec/shape failure is wrapped as DeserializationError with the original chained', async () => {
  const {response, closes} = fakeResponse(bodyOf('{"id":"not-a-number"}'));

  const caught = await rejection(decodeResponse(response, jsonish, dtoTarget));

  expect(caught).toBeInstanceOf(DeserializationError);
  expect(caught).toHaveProperty('cause', expect.any(Error));
  expect(closes()).toBe(1);
});

test('a DeserializationError the codec already raised is not double-wrapped', async () => {
  const original = new DeserializationError('codec said no');
  const rejecting: Deserializer = {
    deserialize: () => {
      throw original;
    },
    deserializeFrom: () => Promise.reject(original),
  };
  const {response} = fakeResponse(bodyOf('{}'));

  expect(await rejection(decodeResponse(response, rejecting, dtoTarget))).toBe(
    original,
  );
});

test('a close failure does NOT mask the decode failure — decode primary, close suppressed', async () => {
  // A bare `finally { await response.close() }` would replace the DeserializationError with the close
  // error, telling the caller their socket died when in fact their payload was malformed.
  //
  // Asserted on SHAPE, never `instanceof SuppressedError`: that class is absent on the declared
  // `engines.node` floor, so the instanceof form would silently assert nothing there (see suppress.ts).
  const closeFailure = new IoError('close failed');

  const caught = await rejection(
    decodeResponse(
      failingCloseResponse(bodyOf('{"id":"not-a-number"}'), closeFailure),
      jsonish,
      dtoTarget,
    ),
  );

  // `as SuppressedErrorLike`: narrowed by the name assertion below, which the compiler cannot follow.
  const paired = caught as SuppressedErrorLike;
  expect(paired.name).toBe('SuppressedError');
  expect(paired.error).toBeInstanceOf(DeserializationError);
  expect(paired.suppressed).toBe(closeFailure);
});

test('a close failure on the SUCCESS path surfaces plainly — it is the only failure there is', async () => {
  const closeFailure = new IoError('close failed');

  const caught = await rejection(
    decodeResponse(
      failingCloseResponse(bodyOf('{"id":7}'), closeFailure),
      jsonish,
      dtoTarget,
    ),
  );

  expect(caught).toBe(closeFailure);
});

/**
 * Adds the status/header surface `decodeSuccessResponse` reads, on top of the stand-in above.
 *
 * `text()`/`bytes()` are present because the 4xx/5xx branch delegates to 3b's real `toHttpError()`,
 * which buffers a bounded copy of the error body — a stand-in carrying only
 * `status`/`headers`/`body`/`close` would fail inside `toHttpError`, not inside the code under test,
 * and the resulting error would be misleading. Both read the same `body` stream once, matching the
 * real `Response`'s single-use discipline.
 */
function fakeStatusResponse(
  code: number,
  body: ReadableStream<Uint8Array> | null,
  headers: Readonly<Record<string, string>> = {},
): {response: FakeResponse; closes: () => number} {
  let closeCount = 0;
  const drain = async (): Promise<Uint8Array> => {
    if (body === null) return new Uint8Array();
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    reader.releaseLock();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };
  // `as unknown as FakeResponse`: see `fakeResponse` above.
  const response = {
    status: Status.of(code),
    headers: {get: (name: string) => headers[name.toLowerCase()]},
    body,
    bytes: drain,
    text: async () => new TextDecoder().decode(await drain()),
    close(): Promise<void> {
      closeCount += 1;
      return Promise.resolve();
    },
  } as unknown as FakeResponse;
  return {response, closes: () => closeCount};
}

test('2xx decodes the body', async () => {
  const {response, closes} = fakeStatusResponse(200, bodyOf('{"id":1}'));

  expect(await decodeSuccessResponse(response, jsonish, dtoTarget)).toEqual({
    id: 1,
  });
  expect(closes()).toBe(1);
});

test('500 throws the mapped HTTP error, not a decode of the error payload as the success type', async () => {
  const {response, closes} = fakeStatusResponse(
    500,
    bodyOf('{"error":"boom"}'),
  );

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, dtoTarget),
  );

  expect(caught).toBeInstanceOf(HttpStatusError);
  // SERDE-27's close-on-every-path covers this branch too, even though the close happens inside
  // `toHttpError`. Asserting it here keeps that delegation honest if 3b's implementation changes.
  expect(closes()).toBe(1);
});

test('a non-canonical 599 is treated as a server error, not as an "other" status', async () => {
  const {response, closes} = fakeStatusResponse(599, bodyOf('nope'));

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, dtoTarget),
  );

  expect(caught).toBeInstanceOf(HttpStatusError);
  expect(closes()).toBe(1);
});

test('304 closes and raises a status-leading DeserializationError preserving ETag/Location', async () => {
  const {response, closes} = fakeStatusResponse(304, null, {
    etag: 'W/"v1"',
    location: '/next',
  });

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, dtoTarget),
  );

  expect(caught).toBeInstanceOf(DeserializationError);
  // `as DeserializationError`: narrowed by the assertion above, which the compiler cannot follow.
  const error = caught as DeserializationError;
  expect(error.message.startsWith('304')).toBe(true);
  expect(error.status).toBe(304);
  expect(error.etag).toBe('W/"v1"');
  expect(error.location).toBe('/next');
  expect(closes()).toBe(1);
});

test('a 1xx is also an "other" status, closed and reported, never decoded', async () => {
  const {response, closes} = fakeStatusResponse(102, bodyOf('{"id":1}'));

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, dtoTarget),
  );

  expect(caught).toBeInstanceOf(DeserializationError);
  expect(closes()).toBe(1);
});

test('an "other" status whose close also fails keeps the status error primary', async () => {
  const closeFailure = new IoError('close failed');
  // `as unknown as FakeResponse`: see `fakeResponse` above.
  const response = {
    status: Status.of(304),
    headers: {get: () => undefined},
    body: null,
    close: () => Promise.reject(closeFailure),
  } as unknown as FakeResponse;

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, dtoTarget),
  );

  // `as SuppressedErrorLike`: narrowed by the name assertion below.
  const paired = caught as SuppressedErrorLike;
  expect(paired.name).toBe('SuppressedError');
  expect(paired.error).toBeInstanceOf(DeserializationError);
  expect(paired.suppressed).toBe(closeFailure);
});

test('the "other" status message falls back to the documented label with no typeName', async () => {
  const {response} = fakeStatusResponse(304, null);

  const caught = await rejection(
    decodeSuccessResponse(response, jsonish, {schema: dtoSchema}),
  );

  expect(caught).toHaveProperty(
    'message',
    expect.stringContaining('the target type'),
  );
});

// --- SERDE-12: the typed-tree pass-through, leaf by leaf ---------------------------------------
//
// `io/errors.ts` is a FLAT tree: `EndOfStreamError`, `ClosedResourceError`, `AllocationLimitError`
// and `SourceContractViolationError` all extend `DexpaceError` DIRECTLY, not `IoError`. Any guard
// narrower than `DexpaceError` — `e instanceof IoError` being the obvious one — whitelists exactly
// one of the five and re-stamps the other four as `DeserializationError`, telling a caller their
// payload was malformed when their stream had ended early. One case per leaf, so a future reshuffle
// of that tree cannot regress them silently.

const streamLeaves: readonly (readonly [string, Error])[] = [
  ['IoError', new IoError('socket reset')],
  ['EndOfStreamError', new EndOfStreamError(3, 10)],
  ['ClosedResourceError', new ClosedResourceError('source closed')],
  ['AllocationLimitError', new AllocationLimitError(1_048_577, 1_048_576)],
  [
    'SourceContractViolationError',
    new SourceContractViolationError('zero bytes for a positive read'),
  ],
];

for (const [name, failure] of streamLeaves) {
  test(`a stream failure of type ${name} propagates unwrapped (SERDE-12)`, async () => {
    const {response, closes} = fakeResponse(failingBody(failure));

    const caught = await rejection(
      decodeResponse(response, jsonish, dtoTarget),
    );

    expect(caught).toBe(failure);
    expect(caught).not.toBeInstanceOf(DeserializationError);
    expect(closes()).toBe(1);
  });
}

test('an HttpStatusError raised mid-decode is passed through, never re-typed', async () => {
  // Not an I/O leaf and not a serde leaf, but still the SDK's own typed tree: nothing already
  // carrying an SDK type may be re-stamped by this handler.
  const statusFailure = new HttpStatusError(503, undefined, undefined);
  const {response, closes} = fakeResponse(failingBody(statusFailure));

  const caught = await rejection(decodeResponse(response, jsonish, dtoTarget));

  expect(caught).toBe(statusFailure);
  expect(closes()).toBe(1);
});

test('a FOREIGN stream error is wrapped — the documented, irreducible limit of the discriminator', async () => {
  // Pins the limitation rather than the ideal, so it stays visible instead of latent. Core hands
  // the live stream to the codec and never reads it, so at the catch a transport's raw `Error` and
  // a non-conforming codec leaking one are the same shape — and SERDE-27 requires the codec case be
  // surfaced as a serde exception. Fixing this needs the transport to tag its stream errors; when
  // that lands, THIS test is the one that should change.
  const foreign = new Error('ECONNRESET');
  const {response, closes} = fakeResponse(failingBody(foreign));

  const caught = await rejection(decodeResponse(response, jsonish, dtoTarget));

  expect(caught).toBeInstanceOf(DeserializationError);
  expect((caught as DeserializationError).cause).toBe(foreign);
  expect(closes()).toBe(1);
});

// --- a locked body is a programmer error, not a payload failure --------------------------------

test('a body already locked by another consumer raises a plain TypeError, not a decode failure', async () => {
  const body = bodyOf('{"id":1}');
  const stolen = body.getReader(); // an external consumer got there first
  const {response, closes} = fakeResponse(body);

  const caught = await rejection(decodeResponse(response, jsonish, dtoTarget));

  expect(caught).toBeInstanceOf(TypeError);
  expect(caught).not.toBeInstanceOf(DeserializationError);
  expect((caught as TypeError).message).toContain('Dto');
  // Still closed: a programmer error must not also strand the connection.
  expect(closes()).toBe(1);
  stolen.releaseLock();
});

test('two concurrent decodes of one response: the loser reports contention, not a bad payload', async () => {
  const {response, closes} = fakeResponse(bodyOf('{"id":1}'));

  const [first, second] = await Promise.allSettled([
    decodeResponse(response, jsonish, dtoTarget),
    decodeResponse(response, jsonish, dtoTarget),
  ]);

  // One wins outright; the other is told it raced, in the platform's own vocabulary.
  const outcomes = [first, second];
  const fulfilled = outcomes.filter(o => o.status === 'fulfilled');
  const rejected = outcomes.filter(o => o.status === 'rejected');
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toBeInstanceOf(TypeError);
  expect(rejected[0]?.reason).not.toBeInstanceOf(DeserializationError);
  expect(closes()).toBe(2);
});
