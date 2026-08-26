// SPDX-License-Identifier: MIT
// test/node-conformance/body-lifecycle.test.mjs
//
// Phase 3b's public body surface, driven through the `@dexpace/core` specifier — the path a real consumer
// takes — on Node's Web Streams rather than Bun's.
//
// The reader-lock cases are the reason this file exists. `ReadableStream.cancel()` rejects with a
// TypeError on a locked stream, that check runs BEFORE the state check, and reading to `{done: true}`
// does NOT release the lock. Every one of those is spec text that two independent implementations can
// get subtly different, and getting it wrong turns every successful read into a rejection or silently
// holds a connection open.
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {
  byteArrayBody,
  Headers,
  materialize,
  multipartBody,
  Protocol,
  Request,
  Response,
  Status,
  streamBody,
  stringBody,
  toHttpError,
} from '@dexpace/core';

function streamOf(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from(bytes));
      controller.close();
    },
  });
}

function responseWith(code, body, headers = Headers.newBuilder().build()) {
  return Response.newBuilder()
    .request(Request.newBuilder().url('https://example.com').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(code))
    .headers(headers)
    .body(body)
    .build();
}

async function collect(body) {
  const chunks = [];
  await body.writeTo(
    new WritableStream({
      write: chunk => void chunks.push(Uint8Array.from(chunk)),
    }),
  );
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('Response reader-lock discipline on Node', () => {
  it('bytes() succeeds and closes, rather than being replaced by a cancel-on-locked TypeError', async () => {
    const response = responseWith(
      200,
      streamOf([...new TextEncoder().encode('hello')]),
    );
    assert.equal(new TextDecoder().decode(await response.bytes()), 'hello');
    // Idempotent, and already closed by bytes()' own finally.
    await response.close();
  });

  it('text() decodes with the declared charset and closes', async () => {
    const headers = Headers.newBuilder()
      .add('content-type', 'text/plain;charset=iso-8859-1')
      .build();
    const response = responseWith(200, streamOf([0x68, 0xe9]), headers);
    assert.equal(await response.text(), 'hé');
  });

  it('close() releases the connection even when the body was never read', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    await responseWith(204, stream).close();
    assert.equal(cancelled, true);
  });

  it('close() tolerates a body an external consumer already locked', async () => {
    const stream = streamOf([1, 2, 3]);
    const response = responseWith(200, stream);
    stream.getReader(); // an external consumer takes the lock; BODY-15 forbids assuming otherwise
    // cancel() on a locked stream rejects with TypeError; close() must swallow exactly that one.
    await response.close();
  });

  it('cancels the body at most once however often close is called', async () => {
    let cancels = 0;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1]));
      },
    });
    const delegate = stream.cancel.bind(stream);
    stream.cancel = async reason => {
      cancels += 1;
      return delegate(reason);
    };
    const response = responseWith(200, stream);
    await response.close();
    await response.close();
    await response.close();
    assert.equal(cancels, 1);
  });
});

describe('Body.writeTo over Node Web Streams', () => {
  it('writes a byte-array body repeatably, byte-for-byte', async () => {
    const body = byteArrayBody(Uint8Array.from([9, 8, 7]));
    assert.deepEqual([...(await collect(body))], [9, 8, 7]);
    assert.deepEqual([...(await collect(body))], [9, 8, 7]);
  });

  it('does not cancel the caller stream when the sink fails', async () => {
    // pipeTo's default preventCancel:false would cancel the SOURCE here. Whether a runtime honours
    // preventCancel is exactly the kind of Streams-spec detail worth pinning on Node.
    let cancelReason = 'NOT-CANCELLED';
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const failing = new WritableStream({
      write() {
        throw new Error('SOCKET GONE');
      },
    });

    await assert.rejects(streamBody(source).writeTo(failing), /SOCKET GONE/);
    assert.equal(cancelReason, 'NOT-CANCELLED');
  });

  it('raises when a declared contentLength disagrees with the stream', async () => {
    const body = streamBody(streamOf([1, 2]), undefined, 5);
    await assert.rejects(
      body.writeTo(new WritableStream({write: () => undefined})),
      error => error.name === 'EndOfStreamError',
    );
  });

  it('refuses a second write of a single-use body', async () => {
    const body = streamBody(streamOf([1]));
    await body.writeTo(new WritableStream({write: () => undefined}));
    await assert.rejects(
      body.writeTo(new WritableStream({write: () => undefined})),
      error => error.name === 'ConsumedBodyError',
    );
  });

  it('materializes a single-use stream body into a replayable one', async () => {
    const replayed = await materialize(streamBody(streamOf([4, 5, 6])));
    assert.equal(replayed.replayable, true);
    assert.deepEqual([...(await collect(replayed))], [4, 5, 6]);
    assert.deepEqual([...(await collect(replayed))], [4, 5, 6]);
  });
});

describe('MultipartBody framing on Node', () => {
  it('generates a boundary from Web Crypto and frames a part', async () => {
    // crypto.getRandomValues is a global on the declared floor; if it were not, every multipart body
    // this SDK produces would throw, and only running here would reveal it.
    const generated = multipartBody([{name: 'a', body: stringBody('x')}]);
    assert.match(
      generated.mediaType,
      /^multipart\/form-data; boundary=dexpace-[A-Za-z0-9]{32}$/,
    );
  });

  it('declares a length equal to the bytes it actually writes', async () => {
    const body = multipartBody(
      [{name: 'field', body: stringBody('value')}],
      'B',
    );
    const written = await collect(body);
    assert.equal(written.length, body.contentLength);
    assert.equal(
      new TextDecoder().decode(written),
      '--B\r\n' +
        'Content-Disposition: form-data; name="field"\r\n' +
        // stringBody declares text/plain; charset=utf-8 by default, so the part carries a Content-Type.
        'Content-Type: text/plain; charset=utf-8\r\n' +
        '\r\n' +
        'value\r\n' +
        '--B--\r\n',
    );
  });
});

describe('toHttpError buffering on Node', () => {
  it('buffers a 4xx body and re-serves it replayably after the connection is released', async () => {
    const payload = [...new TextEncoder().encode('not found')];
    const error = await toHttpError(responseWith(404, streamOf(payload)));
    assert.ok(error);
    assert.equal(error.status, 404);
    assert.equal(error.preview(), 'not found');

    const body = error.body();
    assert.equal(body.replayable, true);
    assert.deepEqual([...(await collect(body))], payload);
    assert.deepEqual([...(await collect(error.body()))], payload);
  });

  it('returns null for a non-error status and leaves the body intact', async () => {
    const response = responseWith(200, streamOf([1, 2, 3]));
    assert.equal(await toHttpError(response), null);
    assert.deepEqual([...(await response.bytes())], [1, 2, 3]);
  });
});
