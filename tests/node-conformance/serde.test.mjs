// SPDX-License-Identifier: MIT
// tests/node-conformance/serde.test.mjs
//
// Phase 6a's runtime-divergent surface, run against the BUILT artifact on real Node.
//
// Three things in this phase are independent implementations on Bun and on Node, and `bun test` only
// ever exercises Bun's:
//
//   1. Web Streams. `serializeTo` takes a caller-owned `WritableStream` and must release its writer
//      lock without closing it; `deserializeFrom` takes a caller-owned `ReadableStream` and must read
//      to EOF without cancelling it. Lock and close semantics are exactly where the two runtimes'
//      stream implementations have diverged before.
//   2. `TextDecoder`'s streaming mode, which is what keeps a multi-byte character intact when it is
//      split across two chunks.
//   3. `suppress()`'s runtime guard on `decodeResponse`'s close-failure path. The `20.3.0` leg of the
//      CI matrix has no native `SuppressedError` and takes the fallback branch; the `lts/*` leg takes
//      the native one. Asserted on SHAPE, never `instanceof`, for exactly that reason.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  absent,
  decodeResponse,
  DeserializationError,
  nullValue,
  present,
  Protocol,
  Request,
  Response,
  serdeBody,
  Status,
} from '@dexpace/core';
import {jsonSerde, tristateObject} from '@dexpace/codec-json';

const identity = {parse: input => input};

function streamOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("serializeTo against Node's WritableStream (SERDE-3)", () => {
  it('writes fully, leaves the sink open, and releases the writer lock', async () => {
    const written = [];
    let closed = false;
    let aborted = false;
    const sink = new WritableStream({
      write(chunk) {
        written.push(Buffer.from(chunk).toString('utf8'));
      },
      close() {
        closed = true;
      },
      abort() {
        aborted = true;
      },
    });

    const {serializer} = jsonSerde();
    await serializer.serializeTo({a: 1}, sink);
    // A second write proves the lock really came back — a still-locked sink throws from getWriter().
    await serializer.serializeTo({b: 2}, sink);

    assert.equal(written.join(''), '{"a":1}{"b":2}');
    assert.equal(
      closed,
      false,
      'the caller owns the sink; the codec must not close it',
    );
    assert.equal(aborted, false);
    assert.equal(sink.locked, false);
  });
});

describe("deserializeFrom against Node's ReadableStream (SERDE-3, SERDE-12)", () => {
  it("reads to EOF without cancelling the caller's source, and releases the reader lock", async () => {
    let cancelled = false;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('{"id"'));
        controller.enqueue(Buffer.from(':42}'));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    const value = await jsonSerde().deserializer.deserializeFrom(source, {
      schema: identity,
      typeName: 'Dto',
    });

    assert.deepEqual(value, {id: 42});
    assert.equal(cancelled, false);
    assert.equal(source.locked, false);
  });

  it('propagates a stream failure unwrapped and still releases the lock', async () => {
    const failure = new Error('socket reset');
    const source = new ReadableStream({
      start(controller) {
        controller.error(failure);
      },
    });

    await assert.rejects(
      jsonSerde().deserializer.deserializeFrom(source, {
        schema: identity,
        typeName: 'Dto',
      }),
      caught => {
        assert.equal(
          caught,
          failure,
          'a stream failure must reach the caller untouched',
        );
        return true;
      },
    );
    assert.equal(source.locked, false);
  });

  it('keeps a multi-byte character intact when it is split across two chunks', async () => {
    const full = Buffer.from('{"id":1,"n":"ü"}', 'utf8');
    const split = full.indexOf(0xc3); // the first byte of "ü"

    const value = await jsonSerde().deserializer.deserializeFrom(
      streamOf(full.subarray(0, split + 1), full.subarray(split + 1)),
      {schema: identity},
    );

    assert.deepEqual(value, {id: 1, n: 'ü'});
  });
});

describe('the Tristate wire contract on Node (SERDE-15, SERDE-17, SERDE-20)', () => {
  it('omits Absent, emits Null, and unwraps Present', () => {
    const encoded = Buffer.from(
      jsonSerde().serializer.serialize({
        keep: absent(),
        clear: nullValue(),
        set: present('v'),
      }),
    ).toString('utf8');

    assert.equal(encoded, '{"clear":null,"set":"v"}');
  });

  it('degrades to a wire null where a key cannot be dropped', () => {
    const {serializer} = jsonSerde();
    const encode = value =>
      Buffer.from(serializer.serialize(value)).toString('utf8');

    assert.equal(encode(absent()), 'null');
    assert.equal(encode([present(1), absent()]), '[1,null]');
  });

  it('resolves a missing key to Absent on the decode side', () => {
    const schema = tristateObject({age: identity});

    assert.equal(schema.parse({}).age.kind, 'absent');
    assert.equal(schema.parse({age: null}).age.kind, 'null');
    assert.equal(schema.parse({age: 30}).age.kind, 'present');
  });
});

describe('serdeBody across the package boundary (SERDE-2)', () => {
  it("stamps the codec's declared media type and produces a replayable body", async () => {
    const body = serdeBody({name: 'ada', nickname: absent()}, jsonSerde());

    assert.equal(body.mediaType, 'application/json');
    assert.equal(body.replayable, true);

    const chunks = [];
    await body.writeTo(
      new WritableStream({
        write(chunk) {
          chunks.push(Buffer.from(chunk).toString('utf8'));
        },
      }),
    );
    assert.equal(chunks.join(''), '{"name":"ada"}');
    assert.equal(body.contentLength, '{"name":"ada"}'.length);
  });
});

function aResponse(body = null) {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .body(body)
    .build();
}

describe("decodeResponse's close-failure path on the declared Node floor (SERDE-27)", () => {
  it('decodes a real Response and releases it exactly once', async () => {
    const response = aResponse(streamOf(Buffer.from('{"id":7}')));

    const value = await decodeResponse(response, jsonSerde().deserializer, {
      schema: identity,
      typeName: 'Dto',
    });

    assert.deepEqual(value, {id: 7});
    // `close()` memoizes, so a second call is a no-op rather than a second cancel; what matters is
    // that the body was consumed and the response is no longer holding the stream open.
    await response.close();
    assert.equal(response.body?.locked ?? false, false);
  });

  it('keeps the decode failure primary when releasing the response ALSO fails', async () => {
    // The whole reason this file exists at this line: the pairing is built by `suppress()`, whose
    // branch depends on whether the runtime has a native `SuppressedError`. The `20.3.0` leg of the
    // matrix does not and takes the fallback; `lts/*` does. Asserted on SHAPE for that reason — an
    // `instanceof SuppressedError` check would silently assert nothing on the floor.
    //
    // The deserializer rejects WITHOUT draining, which is what leaves the body live enough for
    // `close()` to reach the underlying `cancel()` at all: a stream already read to EOF cancels
    // trivially and never raises, so the real codec cannot reach this path.
    const closeFailure = new Error('cancel exploded');
    const response = aResponse(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('{"id":1}'));
        },
        cancel() {
          throw closeFailure;
        },
      }),
    );
    const decodeFailure = new DeserializationError('malformed payload');
    const failingDeserializer = {
      deserialize() {
        throw decodeFailure;
      },
      deserializeFrom() {
        return Promise.reject(decodeFailure);
      },
    };

    await assert.rejects(
      decodeResponse(response, failingDeserializer, {
        schema: identity,
        typeName: 'Dto',
      }),
      caught => {
        assert.equal(caught.name, 'SuppressedError');
        assert.equal(
          caught.error,
          decodeFailure,
          'the decode failure must stay primary, not be replaced by the release failure',
        );
        assert.equal(caught.suppressed, closeFailure);
        return true;
      },
    );
  });
});

/**
 * Fails the case instead of hanging it. `node --test` has no default per-test timeout, so a
 * regression in the abort race would park the runner for as long as CI allows rather than reporting
 * anything. The timer is ref'd, which also holds the loop open while the abort is in flight.
 */
async function settleWithin(promise, ms) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whatever `promise` rejected with, or the string marker when it resolved. */
async function rejection(promise) {
  try {
    await promise;
    return 'RESOLVED';
  } catch (e) {
    return e;
  }
}

describe('an abort landing on a PENDING read or write (SERDE-3, audit #67 / #79)', () => {
  // Runtime-divergent twice over. `AbortSignal` and Web Streams are independent implementations
  // here, and the two disagree on what a reader release does to an outstanding read: measured
  // 2026-09-05, Bun 1.3.14 rejects it with an `AbortError` and Node 20.3/26 with
  // `TypeError: Invalid state: Releasing reader`. Neither may reach the caller in place of its own
  // abort reason, and neither may escape as an unhandled rejection — which `node --test` would
  // report as a failure of this file even if every assertion below passed.
  it('settles deserializeFrom with the caller reason and unlocks the source', async () => {
    let cancelled = false;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('{"id"'));
      },
      // Parks the drain inside its second `read()`: the state a between-chunks check cannot see.
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const reason = new Error('the caller gave up mid-drain');
    const settled = rejection(
      jsonSerde().deserializer.deserializeFrom(
        source,
        {schema: identity, typeName: 'Dto'},
        {signal: controller.signal},
      ),
    );
    const abortAt = setTimeout(() => controller.abort(reason), 5);

    try {
      assert.equal(await settleWithin(settled, 2000), reason);
    } finally {
      clearTimeout(abortAt);
    }
    assert.equal(source.locked, false, 'the caller must get its source back');
    assert.equal(cancelled, false, 'the source is caller-owned (SERDE-3)');
  });

  it('settles serializeTo with the caller reason and unlocks the sink', async () => {
    let closed = false;
    let aborted = false;
    const sink = new WritableStream({
      write() {
        return new Promise(() => {});
      },
      close() {
        closed = true;
      },
      abort() {
        aborted = true;
      },
    });
    const controller = new AbortController();
    const reason = new Error('the caller gave up mid-write');
    const settled = rejection(
      jsonSerde().serializer.serializeTo({a: 1}, sink, {
        signal: controller.signal,
      }),
    );
    const abortAt = setTimeout(() => controller.abort(reason), 5);

    try {
      assert.equal(await settleWithin(settled, 2000), reason);
    } finally {
      clearTimeout(abortAt);
    }
    assert.equal(sink.locked, false, 'the caller must get its sink back');
    assert.equal(closed, false, 'the sink is caller-owned (SERDE-3)');
    assert.equal(aborted, false);
  });

  it('leaves a completed drain untouched when the signal never fires', async () => {
    const controller = new AbortController();
    const value = await jsonSerde().deserializer.deserializeFrom(
      streamOf(Buffer.from('{"id"'), Buffer.from(':42}')),
      {schema: identity},
      {signal: controller.signal},
    );

    assert.deepEqual(value, {id: 42});
    // The listener is removed on the way out, so a later abort reaches nothing at all — an
    // unremoved one would reject a promise nobody is waiting on any more.
    controller.abort(new Error('too late'));
  });
});
