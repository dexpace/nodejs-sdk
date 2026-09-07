// SPDX-License-Identifier: MIT
// packages/transport-conformance/src/fixtures.ts
import {createReadStream} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type {FileBodyDescriptor} from '@dexpace/core';

/** A running fixture server, addressable by URL and shut down through {@link TestServer.close}. */
export interface TestServer {
  /** The origin every fixture path is resolved against, e.g. `http://127.0.0.1:38211`. */
  readonly url: string;
  /** Stops listening and resolves once the server has released its port. */
  close(): Promise<void>;
}

/** How long `/slow` stalls before answering -- long enough that no timeout under test wins the race by luck. */
const SLOW_RESPONSE_MS = 5_000;
/** `/drip`'s inter-chunk gap: long enough that a close-without-read happens mid-body, short enough not to pace the suite. */
const DRIP_INTERVAL_MS = 50;
const DRIP_CHUNKS = 20;

/**
 * `/repeated-challenge`'s two `WWW-Authenticate` lines, in wire order. Exported so the suite asserts
 * against what the server actually sent rather than against a second copy that can drift from it.
 *
 * The first algorithm is deliberately one no SDK handler supports, so a transport that keeps only the
 * first value produces a challenge nothing can answer — the shape audit #67 / #74 found.
 */
export const REPEATED_CHALLENGES: readonly string[] = [
  'Digest realm="conformance", nonce="n1", algorithm=SHA-512-256',
  'Digest realm="conformance", nonce="n1", algorithm=SHA-256, qop="auth"',
];

/**
 * `/fixed-length`'s payload. Its length is what a HEAD response advertises and does not deliver, so
 * it is exported: the row asserts the header survived the body-less decision rather than asserting
 * a number written twice.
 */
export const FIXED_LENGTH_BODY = 'seventeen-bytes!!';

/** `/not-modified`'s validator, the one header a 304 exists to carry. */
export const NOT_MODIFIED_ETAG = '"conformance-v1"';

/**
 * The three fixtures whose responses can carry no body at all, in their own function because the
 * main switch is at the 70-line lint cap -- and because they are one topic (TRANSPORT-24/25).
 * `req` is not needed: `node:http` suppresses the body of a HEAD response by itself.
 *
 * @param pathname - the requested path.
 * @param res - the response to write.
 * @returns `true` when this function answered, `false` to fall through to {@link route}.
 */
function routeBodyless(pathname: string, res: ServerResponse): boolean {
  switch (pathname) {
    case '/no-content':
      // TRANSPORT-24 with the WHATWG null-body rule: a 204 has no body and no framing to describe
      // one. Node's `node:http` sends no `Content-Length` here at all; Bun 1.3.14's sends `0`. The
      // row therefore asserts the header is absent-or-zero, never a positive length -- what a
      // transport is answerable for is the body SHAPE, which is the same on both.
      res.writeHead(204);
      res.end();
      return true;
    case '/not-modified':
      // Deliberately WITHOUT a `Content-Length`, though RFC 9110 15.4.5 permits a 304 to carry the
      // one a 200 would have had. undici 6.28.0 believes it: a 304 declaring 17 bytes leaves the
      // dispatcher waiting for a body that cannot come, and the exchange dies with
      // `UND_ERR_SOCKET: other side closed` (measured 2026-09-05, Node and Bun alike). That is
      // undici's bug to have, not this suite's to provoke -- the row is about the ETag surviving.
      res.writeHead(304, {etag: NOT_MODIFIED_ETAG});
      res.end();
      return true;
    case '/fixed-length':
      // The HEAD row's target. The declared length describes the body a GET would return, so the
      // header promises bytes the HEAD response will not deliver: a transport that framed a stream
      // from it hands the caller a read that never completes.
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': String(FIXED_LENGTH_BODY.length),
      });
      res.end(FIXED_LENGTH_BODY);
      return true;
    default:
      return false;
  }
}

function route(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (routeBodyless(pathname, res)) return;
  switch (pathname) {
    case '/echo-headers':
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify(req.headers));
      return;
    case '/echo-body': {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, {'content-type': 'application/octet-stream'});
        res.end(Buffer.concat(chunks));
      });
      return;
    }
    case '/early-response':
      // Answers without ever draining the request body, so a streaming producer is still running
      // when the response is delivered -- the window TRANSPORT-19's post-delivery clause lives in.
      //
      // `connection: close` because RFC 7230 6.3 requires it of a server that answers before
      // draining the request body: the unread remainder would otherwise sit in a reusable socket and
      // be parsed as the start line of whatever request came next. It is hygiene, not a fix -- the
      // client is free to ignore it, and Bun 1.3.14 did, serving the resulting 400 to a later row
      // from its own pool no matter what this server did (a socket destroy here changed nothing).
      // The row that provokes this therefore runs against its own origin -- see `isolatedUrl` in
      // run-suite.ts, which is what actually contains it.
      res.writeHead(413, {'content-type': 'text/plain', connection: 'close'});
      res.end('too large');
      return;
    case '/vendor-status':
      res.writeHead(520, {'content-type': 'text/plain'});
      res.end('vendor status body');
      return;
    case '/malformed-content-type':
      // TRANSPORT-27: a syntactically invalid media type and a chunked (length-less) body.
      //
      // The chunked framing is *derived*, never declared: writing the body before `end()` with no
      // declared length leaves the server no way to precompute one, so it must fall back to chunked.
      // Setting `transfer-encoding: chunked` by hand looks more direct and is a trap -- Bun 1.3.14
      // (`.bun-version`, so exactly what CI runs) honours the header in the status line but still
      // appends `Content-Length: 4` and writes the body UNCHUNKED. That response is malformed twice
      // over, and the two transports disagree about how: undici rejects it with "Response body length
      // does not match content-length header", while Bun's own `fetch` blocks for the chunk framing
      // that never arrives until the test times out. Bun 1.4.0 emits it correctly, which is why this
      // reproduced only on CI. Verified byte-for-byte on Bun 1.3.14, Bun 1.4.0, and Node 20.3.0.
      res.writeHead(200, {'content-type': 'not-a-media-type'});
      res.write('body');
      res.end();
      return;
    case '/drip': {
      // Headers land immediately, the body trickles: the shape a lazily-streamed response body and an
      // orphaned-response cleanup both need (TRANSPORT-9, TRANSPORT-25, SEAM-30).
      res.writeHead(200, {'content-type': 'application/octet-stream'});
      let sent = 0;
      const timer = setInterval(() => {
        sent += 1;
        if (sent >= DRIP_CHUNKS) {
          clearInterval(timer);
          res.end('end');
          return;
        }
        res.write(`chunk-${String(sent)};`);
      }, DRIP_INTERVAL_MS);
      res.on('close', () => {
        clearInterval(timer);
      });
      return;
    }
    case '/slow':
      // Nothing is written at all, so a request against it is still awaiting response headers when
      // the timeout or abort under test fires.
      setTimeout(() => {
        res.writeHead(200);
        res.end('done');
      }, SLOW_RESPONSE_MS).unref();
      return;
    case '/repeated-challenge':
      // AUTH-12/AUTH-25: the same challenge header sent TWICE, which RFC 9110 5.3 permits for any
      // list-valued field and RFC 7616 3.3 recommends for Digest algorithm discovery -- one challenge
      // per algorithm, strongest first. The two transports legitimately surface it differently:
      // WHATWG `Headers` comma-joins every name but `Set-Cookie`, so `@dexpace/transport-fetch`
      // delivers one entry, while undici arrays any repeated header and `@dexpace/transport-undici`
      // keeps two. Neither may LOSE one, which is what the row asserts.
      //
      // An array value in `writeHead`, not two `setHeader` calls: `setHeader` on the same name
      // replaces, which would make the fixture single-valued and the row vacuous. Spread into a
      // MUTABLE copy -- `OutgoingHttpHeader` is `string | string[]`, so a `readonly string[]` does
      // not satisfy it, and handing the exported constant itself to `node:http` would alias it.
      res.writeHead(401, {'www-authenticate': [...REPEATED_CHALLENGES]});
      res.end();
      return;
    case '/redirect':
      res.writeHead(302, {location: '/echo-headers'});
      res.end();
      return;
    default:
      res.writeHead(200, {'content-length': '0'});
      res.end();
  }
}

/**
 * Starts a local `node:http` server exposing the fixed set of endpoints every `TRANSPORT-N` assertion
 * needs, on an ephemeral port so parallel test files never collide.
 *
 * @returns the listening server; the caller closes it in its own `afterAll`.
 */
export function startFixtureServer(): Promise<TestServer> {
  return new Promise(resolve => {
    const server: Server = createServer((req, res) => {
      route(new URL(req.url ?? '/', 'http://localhost').pathname, req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise<void>(done => {
            // closeAllConnections, not close alone: a keep-alive socket a transport still holds open
            // would otherwise stall this for the server's whole idle timeout.
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

/** What {@link fileBodyFixture} needs beyond the path; mirrors `fileBody()`'s own option bag. */
export interface FileBodyFixtureOptions {
  /** The byte offset the descriptor declares; defaults to 0. */
  readonly start?: number;
  /** The byte count the descriptor declares, captured as `fileBody()` captures it from `stat`. */
  readonly count: number;
  /** Incremented on every `writeTo` call, so a row can assert the transport used it. */
  readonly writes?: {count: number};
}

/**
 * A `kind: 'file'` request body over a real path, carrying BODY-13's `transferred === count` check
 * itself — the shape `@dexpace/body-file`'s `fileBody()` produces, minus the construction-time
 * validation no row here needs.
 *
 * **Deliberately a stand-in, not the real factory.** `@dexpace/transport-conformance` is `private`,
 * resolves unbuilt, and depends on `@dexpace/core` alone; taking `@dexpace/body-file` would put a
 * ninth entry in the root `build:deps` chain for one row. A real `fileBody()` crossing a real
 * transport already has a home — `tests/node-conformance/transport.test.mjs`, which is the only
 * layer that can host it. What a *transport* is answerable for is narrower, and is exactly what this
 * exercises: TRANSPORT-28's structural recognition on `kind` alone, and that the declared length is
 * honoured by calling the descriptor's own `writeTo` rather than by reading `path` behind its back.
 *
 * @param path - the file to stream; read fresh on every `writeTo`, as BODY-11 requires.
 * @param options - the declared range, and an optional write counter.
 * @returns a frozen descriptor a transport must recognise structurally.
 */
export function fileBodyFixture(
  path: string,
  options: FileBodyFixtureOptions,
): FileBodyDescriptor {
  const start = options.start ?? 0;
  const {count} = options;
  return Object.freeze({
    kind: 'file' as const,
    mediaType: 'application/octet-stream',
    contentLength: count,
    replayable: true,
    path,
    start,
    count,
    async writeTo(sink: WritableStream<Uint8Array>): Promise<void> {
      if (options.writes !== undefined) options.writes.count += 1;
      const writer = sink.getWriter();
      if (count === 0) {
        writer.releaseLock();
        return;
      }
      const stream = createReadStream(path, {start, end: start + count - 1});
      let transferred = 0;
      try {
        for await (const chunk of stream) {
          const bytes = chunk as Buffer;
          await writer.write(new Uint8Array(bytes));
          transferred += bytes.byteLength;
        }
        if (transferred !== count) {
          // BODY-13's exact sentence, and its exact wording in `@dexpace/body-file`: the error names
          // transferred-of-total, so a row can assert the numbers rather than only the class.
          throw new Error(
            `short write: transferred ${String(transferred)} of ${String(count)} bytes`,
          );
        }
      } catch (error) {
        await writer.abort(error);
        throw error;
      } finally {
        stream.destroy();
        writer.releaseLock();
      }
    },
  });
}
