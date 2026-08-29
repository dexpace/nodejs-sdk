// SPDX-License-Identifier: MIT
// test/node-conformance/transport.test.mjs
//
// Phase 8a's Node layer. This is the file the suite's membership rule was written for: `bun test` runs both
// transports against *Bun's* `fetch`, `AbortSignal`, and Web Streams, and the shipping runtime is Node's —
// two independent implementations of exactly the surfaces a transport is made of. Bun's `undici` shim alone
// already diverges enough that `undici-transport.ts` has to bypass it by module path.
//
// It is also the only layer that can join BODY-11 to TRANSPORT-28: `@dexpace/body-file` is a Node-only
// package and neither transport depends on it (they narrow structurally on `body.kind === 'file'`), so a real
// `fileBody()` crossing a real transport has no home inside either package's own suite.
//
// Exercises: TRANSPORT-1 (redirects not followed), TRANSPORT-4/20 (timeout and no-response classification),
// TRANSPORT-17 (a single-use body written once, its bytes on the wire), TRANSPORT-24 (vendor status codes),
// TRANSPORT-28/BODY-11 (a real fileBody() over the wire, whole and ranged),
// TRANSPORT-25 (the response body is a lazily-read stream and close releases it), TRANSPORT-29/SEAM-12
// (concurrent sends), SEAM-16 (an abort after delivery must not close the delivered body).
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {after, before, describe, it} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Headers, Request, RequestOptions} from '@dexpace/core';
import {fileBody} from '@dexpace/body-file';
import {fetchTransport} from '@dexpace/transport-fetch';
import {undiciTransport} from '@dexpace/transport-undici';

/** Long enough that no timeout under test wins the race by luck. */
const SLOW_RESPONSE_MS = 5_000;

let server;
let origin;

/** A genuinely single-use body: `replayable: false` forces the streaming request-body path on both transports. */
function countingBody(counter) {
  const payload = new TextEncoder().encode('payload');
  return {
    kind: 'stream',
    mediaType: 'text/plain',
    contentLength: payload.byteLength,
    replayable: false,
    async writeTo(sink) {
      counter.writes += 1;
      const writer = sink.getWriter();
      await writer.write(payload);
      await writer.close();
    },
  };
}

/**
 * Distinguishable bytes, so a truncated or misaligned send fails the digest and not merely the
 * length. Printable ASCII rather than the full byte range: the shared `/echo` fixture echoes the
 * request body back as a UTF-8 string, which would mangle arbitrary bytes before any assertion here
 * could see them.
 */
function fixtureBytes(size) {
  const buf = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    buf[index] = 33 + ((index * 7) % 94);
  }
  return buf;
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Every hook and test lives inside this suite rather than at the file root, and that is
// load-bearing on the declared floor. Under Node 20.3.0 -- `engines.node`, and the floor leg of
// CI's node-conformance matrix -- an async ROOT-level `before` does not finish before subtests
// inside a `describe` start, in a file whose only root children are suites. This file is exactly
// that shape: the loop below contributes two `describe`s and no top-level `it`, so every test read
// `origin` as `undefined` and failed with `malformed or non-absolute URL: undefined/redirect`,
// while the matching root `after` never closed the server and the run hung. Node 22 fixed the
// ordering. Owning the hooks from a suite is correct on every version, and neither `bun test` nor
// a newer local Node can see the difference -- only the matrix floor leg can.
describe('the transport adapters on the Node runtime', () => {
  before(async () => {
    server = createServer((req, res) => {
      const {pathname} = new URL(req.url ?? '/', 'http://localhost');
      if (pathname === '/slow') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('done');
        }, SLOW_RESPONSE_MS).unref();
        return;
      }
      if (pathname === '/redirect') {
        res.writeHead(302, {location: '/echo'});
        res.end();
        return;
      }
      if (pathname === '/vendor') {
        res.writeHead(520, {'content-type': 'text/plain'});
        res.end('vendor status body');
        return;
      }
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, {'content-type': 'application/json'});
        res.end(
          JSON.stringify({
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    });
    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => {
      server.close(resolve);
    });
  });

  for (const [name, makeTransport] of [
    ['transport-fetch', () => fetchTransport()],
    ['transport-undici', () => undiciTransport()],
  ]) {
    describe(`${name} on the Node runtime`, () => {
      it('returns a 302 raw and never follows it (TRANSPORT-1)', async () => {
        const transport = makeTransport();
        try {
          const response = await transport.send(
            Request.newBuilder().url(`${origin}/redirect`).build(),
          );
          assert.equal(response.status.code, 302);
          assert.equal(response.headers.get('location'), '/echo');
          await response.close();
        } finally {
          await transport.close();
        }
      });

      it('surfaces a vendor status with a readable body (TRANSPORT-24)', async () => {
        const transport = makeTransport();
        try {
          const response = await transport.send(
            Request.newBuilder().url(`${origin}/vendor`).build(),
          );
          assert.equal(response.status.code, 520);
          assert.equal(await response.text(), 'vendor status body');
        } finally {
          await transport.close();
        }
      });

      it('writes a single-use streaming body exactly once, bytes intact (TRANSPORT-17)', async () => {
        // Node streams a request body through `duplex: 'half'` (fetch) or a `Readable` (undici); Bun's
        // handling of both is its own implementation, which is the whole reason this case is here.
        const transport = makeTransport();
        const counter = {writes: 0};
        try {
          const response = await transport.send(
            Request.newBuilder()
              .method('POST')
              .url(`${origin}/echo`)
              .body(countingBody(counter))
              .build(),
          );
          const echoed = JSON.parse(await response.text());
          assert.equal(echoed.body, 'payload');
          assert.equal(counter.writes, 1);
        } finally {
          await transport.close();
        }
      });

      it('exposes the response body as a stream that close() releases (TRANSPORT-25)', async () => {
        const transport = makeTransport();
        try {
          const response = await transport.send(
            Request.newBuilder().url(`${origin}/echo`).build(),
          );
          assert.ok(response.body instanceof ReadableStream);
          await response.close();
          await response.close(); // idempotent (BODY-15)
        } finally {
          await transport.close();
        }
      });

      it('classifies a per-call timeout as retryable, not cancellation (TRANSPORT-4)', async () => {
        const transport = makeTransport();
        try {
          await assert.rejects(
            transport.send(
              Request.newBuilder().url(`${origin}/slow`).build(),
              RequestOptions.newBuilder().timeoutMs(50).build(),
            ),
            error => {
              assert.equal(error.name, 'TransportFailureError');
              return true;
            },
          );
        } finally {
          await transport.close();
        }
      });

      it('classifies a dead port as a retryable transport failure (TRANSPORT-20)', async () => {
        const transport = makeTransport();
        try {
          await assert.rejects(
            transport.send(
              Request.newBuilder().url('http://127.0.0.1:1').build(),
            ),
            error => {
              assert.equal(error.name, 'TransportFailureError');
              return true;
            },
          );
        } finally {
          await transport.close();
        }
      });

      it('maps a caller abort to a terminal cancellation (TRANSPORT-3)', async () => {
        const transport = makeTransport();
        const controller = new AbortController();
        try {
          const pending = transport.send(
            Request.newBuilder().url(`${origin}/slow`).build(),
            undefined,
            controller.signal,
          );
          setTimeout(() => {
            controller.abort();
          }, 20).unref();
          await assert.rejects(pending, error => {
            assert.equal(error.name, 'CancellationError');
            return true;
          });
        } finally {
          await transport.close();
        }
      });

      it('does not close a delivered body when the signal fires afterwards (SEAM-16)', async () => {
        // Both native clients tie the response body's lifetime to the signal they were handed, so this
        // only holds because the transport dispatches over a fork it detaches at delivery.
        const transport = makeTransport();
        const controller = new AbortController();
        try {
          const response = await transport.send(
            Request.newBuilder().url(`${origin}/vendor`).build(),
            undefined,
            controller.signal,
          );
          controller.abort();
          assert.equal(await response.text(), 'vendor status body');
        } finally {
          await transport.close();
        }
      });

      it('keeps concurrent sends independent of one another (TRANSPORT-29, SEAM-12)', async () => {
        const transport = makeTransport();
        try {
          const responses = await Promise.all(
            Array.from({length: 10}, (_unused, index) =>
              transport.send(
                Request.newBuilder()
                  .url(`${origin}/echo`)
                  .headers(
                    Headers.newBuilder().set('X-Call', String(index)).build(),
                  )
                  .build(),
              ),
            ),
          );
          const seen = await Promise.all(
            responses.map(async response => {
              const echoed = JSON.parse(await response.text());
              return echoed.headers['x-call'];
            }),
          );
          assert.equal(new Set(seen).size, 10);
        } finally {
          await transport.close();
        }
      });

      // The two halves of TRANSPORT-28 are tested apart everywhere else: body-file drives `writeTo`
      // against a local sink, and transport-undici narrows on a hand-built `{kind: 'file'}` literal.
      // Only here do a real factory and a real transport meet -- which matters most for undici, whose
      // file path bypasses `writeTo` entirely for its own `createReadStream`.
      describe('a real fileBody() over the wire (TRANSPORT-28, BODY-11)', () => {
        let dir;
        let path;
        const source = fixtureBytes(300 * 1024);

        before(async () => {
          dir = await mkdtemp(join(tmpdir(), 'dexpace-filebody-'));
          path = join(dir, 'payload.bin');
          await writeFile(path, source);
        });

        after(async () => {
          await rm(dir, {recursive: true, force: true});
        });

        it('sends the whole file byte-exactly', async () => {
          const transport = makeTransport();
          try {
            const response = await transport.send(
              Request.newBuilder()
                .method('POST')
                .url(`${origin}/echo`)
                .body(fileBody(path))
                .build(),
            );
            const echoed = JSON.parse(await response.text());
            assert.equal(echoed.body.length, source.byteLength);
            assert.equal(sha(Buffer.from(echoed.body, 'utf8')), sha(source));
          } finally {
            await transport.close();
          }
        });

        it('honors start and count', async () => {
          const transport = makeTransport();
          try {
            const response = await transport.send(
              Request.newBuilder()
                .method('POST')
                .url(`${origin}/echo`)
                .body(fileBody(path, {start: 10, count: 20}))
                .build(),
            );
            const echoed = JSON.parse(await response.text());
            assert.equal(
              sha(Buffer.from(echoed.body, 'utf8')),
              sha(source.subarray(10, 30)),
            );
          } finally {
            await transport.close();
          }
        });
      });
    });
  }
});
