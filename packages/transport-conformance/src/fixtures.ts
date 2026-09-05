// SPDX-License-Identifier: MIT
// packages/transport-conformance/src/fixtures.ts
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

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

function route(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
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
