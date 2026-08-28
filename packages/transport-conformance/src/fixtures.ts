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
      res.writeHead(413, {'content-type': 'text/plain'});
      res.end('too large');
      return;
    case '/vendor-status':
      res.writeHead(520, {'content-type': 'text/plain'});
      res.end('vendor status body');
      return;
    case '/malformed-content-type':
      // TRANSPORT-27: a syntactically invalid media type and a chunked (length-less) body.
      res.writeHead(200, {
        'content-type': 'not-a-media-type',
        'transfer-encoding': 'chunked',
      });
      res.end('body');
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
