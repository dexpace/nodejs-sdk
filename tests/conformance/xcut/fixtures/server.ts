// SPDX-License-Identifier: MIT
// tests/conformance/xcut/fixtures/server.ts
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/**
 * A pair of running fixture origins. Two real listeners, not one listener addressed by two hostnames:
 * the server binds `127.0.0.1` explicitly, so a second name for the same port is not reliably
 * resolvable (`localhost` may resolve to `::1` first), and `XCUT-17`'s cross-origin hop has to be a
 * genuinely different origin for the assertion to mean anything.
 */
export interface XcutFixtureServer {
  /** The primary origin every path is resolved against, e.g. `http://127.0.0.1:38211`. */
  readonly url: string;
  /** A second, independently-listening origin -- a different port, so a different origin. */
  readonly crossOriginUrl: string;
  /** Stops both listeners and resolves once each has released its port. */
  close(): Promise<void>;
}

/** `/large-body`'s default payload: comfortably past any preview cap `XCUT-24` would configure. */
const LARGE_BODY_BYTES = 10 * 1024 * 1024;
/** `/slow`'s default stall, long enough that no cancellation under test wins its race by luck. */
const SLOW_RESPONSE_MS = 5_000;

/** Reflects back what actually arrived, so a test can prove which credentials survived a hop. */
function echo(req: IncomingMessage, res: ServerResponse, url: URL): void {
  res.writeHead(200, {'content-type': 'application/json'});
  res.end(
    JSON.stringify({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      method: req.method ?? null,
      authorization: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null,
      proxyAuthorization: req.headers['proxy-authorization'] ?? null,
    }),
  );
}

/** The routes shared by both origins. `crossOrigin` is the OTHER origin, for the two-hop redirect. */
function route(
  req: IncomingMessage,
  res: ServerResponse,
  crossOrigin: string,
): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  switch (url.pathname) {
    case '/ok':
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('ok');
      return;
    case '/echo':
      echo(req, res, url);
      return;
    case '/slow': {
      const delayMs = Number(
        url.searchParams.get('ms') ?? String(SLOW_RESPONSE_MS),
      );
      // `unref` so a stalled timer can never hold the suite open past its own afterAll.
      setTimeout(() => {
        res.writeHead(200);
        res.end('done');
      }, delayMs).unref();
      return;
    }
    case '/large-body': {
      const size = Number(
        url.searchParams.get('bytes') ?? String(LARGE_BODY_BYTES),
      );
      // content-length is declared, not derived. Writing the body without it leaves Node no length
      // to precompute and it falls back to chunked -- and OBS-37 deliberately skips preview capture
      // on an unknown-length body, so the XCUT-24 rows would silently assert against no preview
      // at all rather than against a capped one.
      // The media type is selectable because OBS-38 forks on it: a text body is previewed as
      // decoded text, a binary one as a size-only `[binary N bytes captured]` marker. XCUT-24's cap
      // has to hold on both paths, so both are driven.
      res.writeHead(200, {
        'content-type':
          url.searchParams.get('type') ?? 'application/octet-stream',
        'content-length': String(size),
      });
      res.end(Buffer.alloc(size, 'x'));
      return;
    }
    case '/redirect-same-origin':
      res.writeHead(302, {location: '/echo'});
      res.end();
      return;
    case '/redirect-cross-origin':
      res.writeHead(302, {location: `${crossOrigin}/echo`});
      res.end();
      return;
    case '/fail-500':
      res.writeHead(500, {'content-type': 'text/plain'});
      res.end('server error');
      return;
    case '/status': {
      // Any status on demand, for XCUT-7's widen/narrow rows: 501 is excluded from the built-in
      // retryable set and 500 is in it, so both directions need a live endpoint to prove against.
      const code = Number(url.searchParams.get('code') ?? '500');
      res.writeHead(code, {'content-type': 'text/plain'});
      res.end(`status ${String(code)}`);
      return;
    }
    default:
      res.writeHead(404, {'content-length': '0'});
      res.end();
  }
}

/** Starts one listener on an ephemeral port and resolves its origin alongside the handle. */
function listen(
  crossOrigin: () => string,
): Promise<{origin: string; server: Server}> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      route(req, res, crossOrigin());
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      resolve({origin: `http://127.0.0.1:${String(port)}`, server});
    });
  });
}

/** Closes one listener, dropping keep-alive sockets a transport may still be holding. */
function shutdown(server: Server): Promise<void> {
  return new Promise<void>(done => {
    // closeAllConnections, not close alone: a pooled socket would otherwise stall this for the
    // server's whole idle timeout (the same reason 8a's own fixture does it).
    server.closeAllConnections();
    server.close(() => {
      done();
    });
  });
}

/**
 * Starts the two fixture origins every `XCUT-N` suite in this directory shares, each on an ephemeral
 * port so parallel test files never collide.
 *
 * The secondary comes up first so the primary's `/redirect-cross-origin` can name it; the secondary's
 * own cross-origin route points back at the primary, which is why both are handed a late-bound
 * getter rather than a string.
 *
 * @returns both origins; the caller closes them in its own `afterAll`.
 */
export async function startFixtureServer(): Promise<XcutFixtureServer> {
  let primaryOrigin = '';
  const secondary = await listen(() => primaryOrigin);
  const primary = await listen(() => secondary.origin);
  primaryOrigin = primary.origin;

  return {
    url: primary.origin,
    crossOriginUrl: secondary.origin,
    close: async (): Promise<void> => {
      await Promise.all([shutdown(primary.server), shutdown(secondary.server)]);
    },
  };
}
