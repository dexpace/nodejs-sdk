// SPDX-License-Identifier: MIT
// tests/node-conformance/transport.test.mjs
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
// TRANSPORT-20 with RETRY-2 (an unsupported URL scheme is a permanent misconfiguration outside the IoError
// tree -- Node and Bun report it with entirely different error shapes),
// TRANSPORT-17 (a single-use body written once, its bytes on the wire), TRANSPORT-24 (vendor status codes),
// TRANSPORT-11/12 (a header the native layer refuses is dropped, not a failed send -- Node's undici-backed
// `fetch` rejects three names Bun's forwards),
// TRANSPORT-28/BODY-11 (a real fileBody() over the wire, whole and ranged), BODY-13 (a truncate-after-stat
// short write fails the send on the streamed path, which only this runtime can assert),
// TRANSPORT-24/25 (a 204 and a HEAD carry a null body on this runtime as well -- Node's `fetch`
// returns null where Bun's returns a stream, and undici's dispatcher always returns a readable),
// HTTP-35 (a defaultTimeoutMs AbortSignal.timeout() cannot take is refused at the factory -- Node
// throws RangeError for two of the values Bun accepts),
// TRANSPORT-25 (the response body is a lazily-read stream and close releases it), TRANSPORT-29/SEAM-12
// (concurrent sends), SEAM-16 (an abort after delivery must not close the delivered body).
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {after, before, describe, it} from 'node:test';
import {mkdtemp, rm, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Headers, isIoError, Request, RequestOptions} from '@dexpace/core';
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

/** `/fixed-length`'s payload; its length is what the HEAD response advertises and never delivers. */
const FIXED_LENGTH_BODY = 'seventeen-bytes!!';

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
      if (pathname === '/no-content') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname === '/fixed-length') {
        // `node:http` suppresses the body for a HEAD request by itself and keeps the declared
        // length, which is the trap: the header promises bytes no response will deliver.
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(FIXED_LENGTH_BODY.length),
        });
        res.end(FIXED_LENGTH_BODY);
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

  // `makeTransport` takes the transport-wide default timeout so the HTTP-35 case can build a
  // misconfigured transport; every other case passes nothing and gets today's shape.
  for (const [name, makeTransport] of [
    ['transport-fetch', defaultTimeoutMs => fetchTransport({defaultTimeoutMs})],
    [
      'transport-undici',
      defaultTimeoutMs => undiciTransport({defaultTimeoutMs}),
    ],
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

      it('drops the headers the native layer refuses rather than failing the send (TRANSPORT-11/12)', async () => {
        // The one case in this file where Bun and Node disagree about the *outcome*, not merely the
        // implementation. `Expect`, `Keep-Alive` and `Upgrade` are undici's three unconditional
        // rejections, and Node's global `fetch` is undici-backed, so on this runtime an undropped
        // one rejects the send: `TypeError: fetch failed` through transport-fetch, which can only
        // be classified as the RETRYABLE TransportFailureError, and a terminal TypeError through
        // transport-undici. Bun's `fetch` instead forwards `Expect`/`Keep-Alive` to the wire and
        // hangs on `Upgrade`, so the Bun conformance rows for these names prove a weaker claim than
        // this one does (audit #67 / #81, measured 2026-09-05).
        const transport = makeTransport();
        try {
          const response = await transport.send(
            Request.newBuilder()
              .url(`${origin}/echo`)
              .headers(
                Headers.newBuilder()
                  .set('Expect', '100-continue')
                  .set('Keep-Alive', 'timeout=5')
                  .set('Upgrade', 'websocket')
                  .set('X Custom', 'model-valid, non-token')
                  .set('X-Pass-Through', 'survives')
                  .build(),
              )
              .build(),
            RequestOptions.newBuilder().timeoutMs(2_000).build(),
          );
          const echoed = JSON.parse(await response.text());
          for (const name of ['expect', 'keep-alive', 'upgrade', 'x custom']) {
            assert.equal(echoed.headers[name], undefined, name);
          }
          assert.equal(echoed.headers['x-pass-through'], 'survives');
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

      it('reports a null body for a 204 and a HEAD, on this runtime too (TRANSPORT-24/25)', async () => {
        // The one place the WHATWG null-body rule can be checked against the runtime the SDK ships
        // to. Node's `fetch` returns `null` for 204/304/HEAD by itself, Bun 1.3.14's returns a live
        // `ReadableStream` for all three, and undici's dispatcher always hands back a
        // `BodyReadable` -- so the Bun conformance rows prove the adapters normalise Bun's answers
        // and this proves they did not normalise into Bun's shape (audit #67 / #82).
        const transport = makeTransport();
        try {
          const empty = await transport.send(
            Request.newBuilder().url(`${origin}/no-content`).build(),
          );
          assert.equal(empty.status.code, 204);
          assert.equal(empty.body, null);
          await empty.close();

          const head = await transport.send(
            Request.newBuilder()
              .method('HEAD')
              .url(`${origin}/fixed-length`)
              .build(),
          );
          assert.equal(head.status.code, 200);
          assert.equal(head.body, null);
          // The advertised length survives; only the body a GET would have returned is absent.
          assert.equal(
            head.headers.get('content-length'),
            String(FIXED_LENGTH_BODY.length),
          );
          await head.close();

          // A body-less decision that also nulled an ordinary response would pass every assertion
          // above, so the same route is read once more over GET.
          const full = await transport.send(
            Request.newBuilder().url(`${origin}/fixed-length`).build(),
          );
          assert.equal(await full.text(), FIXED_LENGTH_BODY);
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

      it('refuses an unhonourable defaultTimeoutMs at the factory (HTTP-35)', async () => {
        // Runtime-divergent, and the reason the check exists at all: `AbortSignal.timeout(1.5)` and
        // `AbortSignal.timeout(2**32)` throw `RangeError` on Node and are accepted by Bun 1.3.14,
        // so before audit #67 / #82 the same misconfigured transport failed every send here and
        // silently used a different deadline there. The factory now answers identically on both,
        // which is what this pins on the runtime that used to be the strict one.
        for (const value of [0, -1, 1.5, 2 ** 32, Number.NaN]) {
          assert.throws(
            () => makeTransport(value),
            error => {
              assert.ok(
                error instanceof TypeError,
                `expected a TypeError for ${value}, got ${error?.constructor?.name}`,
              );
              assert.equal(isIoError(error), false);
              assert.ok(error.message.includes(String(value)), error.message);
              return true;
            },
          );
        }
        // And a legitimate default still builds something that sends.
        const transport = makeTransport(30_000);
        try {
          const response = await transport.send(
            Request.newBuilder().url(`${origin}/echo`).build(),
          );
          assert.equal(response.status.code, 200);
          await response.close();
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

      it('classifies an unsupported URL scheme as permanent, not retryable (TRANSPORT-20, RETRY-2)', async () => {
        // Runtime-divergent in the strongest sense: the two runtimes do not merely word this
        // differently, they use different error shapes. Node's undici-backed `fetch` rejects
        // `ftp://` with `TypeError: fetch failed` carrying `Error: unknown scheme` as its cause --
        // byte-identical, at the top level, to a DNS or connect failure -- while Bun 1.3.14 rejects
        // with `TypeError [ERR_INVALID_ARG_VALUE]: protocol must be http:, https: or s3:` and no
        // cause at all. The Bun conformance row therefore proves nothing about this runtime, which
        // is the runtime the SDK ships to. undici's dispatcher agrees with itself on both
        // (`UND_ERR_INVALID_ARG`) and is here for the pairing (audit #67 / #82).
        const transport = makeTransport();
        try {
          await assert.rejects(
            transport.send(
              Request.newBuilder().url('ftp://example.com/anything').build(),
            ),
            error => {
              // `classify.ts` is an allow-list over `IoError`, so the class IS the retry verdict:
              // a `TransportFailureError` here would spend the caller's whole budget re-proving a
              // URL no retry can fix.
              assert.ok(
                error instanceof TypeError,
                `expected a TypeError, got ${error?.constructor?.name}`,
              );
              assert.equal(isIoError(error), false);
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

        // BODY-13's short-write clause on the STREAMED request-body path, which is this tree's to
        // hold for two independent reasons. The shared conformance row
        // (`run-suite.ts`'s "a file body truncated after its length was captured") drives the
        // buffered path only: above the adapters' 1,000,000-byte materialize bound the producer
        // failure aborts a `TransformStream` mid-pull, and Bun 1.3.14's `Readable.fromWeb` leaks
        // that abort reason as unhandled rejections, which `bun:test` scores against an unrelated
        // row. Node's bridge does not. And this is the only layer where a real `fileBody()` — whose
        // `transferred === count` invariant is the thing under test — meets a real transport.
        //
        // Until audit #67 / #81 the undici transport handed `createReadStream(path, …)` to undici
        // and never called `writeTo` at all, so this case reported 200 with ten bytes on the wire
        // while transport-fetch raised. `content-length` is dropped outbound, so the framing cannot
        // catch it either.
        it('fails a send whose file was truncated after its length was captured (BODY-13)', async () => {
          const declared = 1_100_000;
          const shortDir = await mkdtemp(
            join(tmpdir(), 'dexpace-filebody-short-'),
          );
          const shortPath = join(shortDir, 'payload.bin');
          const transport = makeTransport();
          try {
            await writeFile(shortPath, fixtureBytes(declared));
            const body = fileBody(shortPath);
            assert.equal(body.contentLength, declared);
            await truncate(shortPath, 10);
            await assert.rejects(
              transport.send(
                Request.newBuilder()
                  .method('POST')
                  .url(`${origin}/echo`)
                  .body(body)
                  .build(),
              ),
              error => {
                assert.equal(error.name, 'TransportFailureError');
                // BODY-13 names transferred-of-total. The streamed path rethrows the producer's own
                // message; the buffered one carries it as a cause, so both are searched.
                const chain = [];
                for (let at = error; at instanceof Error; at = at.cause) {
                  chain.push(at.message);
                }
                assert.ok(
                  chain.some(message =>
                    message.includes(`transferred 10 of ${declared} bytes`),
                  ),
                  `no transferred-of-total in ${JSON.stringify(chain)}`,
                );
                return true;
              },
            );
          } finally {
            await transport.close();
            await rm(shortDir, {recursive: true, force: true});
          }
        });
      });
    });
  }
});
