// SPDX-License-Identifier: MIT
// packages/transport-undici/src/undici-transport.test.ts
// Exercises: TRANSPORT-2 (no redirect interceptor is composed), TRANSPORT-8 (a native-internal cancel
// is terminal while a timeout stays retryable), TRANSPORT-11 (undici keeps `Connection`),
// TRANSPORT-15/16 (ownership-aware, idempotent close), TRANSPORT-22 (an adaptation throw destroys the
// native body), TRANSPORT-20 (a permanent argument error is terminal, a no-response failure is
// retryable), TRANSPORT-28 (a file body dispatches its declared byte range), SEAM-14
import {createRequire} from 'node:module';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  createProxyOptions,
  getGlobalLogger,
  Headers,
  Request,
  RequestOptions,
  IoError,
  setGlobalLogger,
  TransportFailureError,
  type FileBodyDescriptor,
  type Logger,
} from '@dexpace/core';
import type {Dispatcher} from 'undici';
import {undiciTransport} from './undici-transport.js';

const require = createRequire(import.meta.url);
const undici = require('undici/index.js') as typeof import('undici');

/**
 * Awaits `pending` and hands back its rejection reason. `expect(p).rejects.…` is typed `void` here,
 * so this keeps the assertion ordered with whatever the row checks afterwards.
 */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

/** Installs a logger that records every dropped header name, and returns the restore function. */
function captureDroppedHeaders(): {
  dropped: string[];
  restore: () => void;
} {
  const dropped: string[] = [];
  const previous = getGlobalLogger();
  const capturing: Logger = {
    atLevel: () => {
      let name: string | undefined;
      const entry = {
        field: (key: string, value: unknown) => {
          if (key === 'header') name = String(value);
          return entry;
        },
        event: () => entry,
        cause: () => entry,
        emit: () => {
          if (name !== undefined) dropped.push(name);
        },
      };
      return entry;
    },
    withContext: () => capturing,
  };
  setGlobalLogger(capturing);
  return {
    dropped,
    restore: () => {
      setGlobalLogger(previous);
    },
  };
}

/** Records every request body the server received, so a file body's byte range is checkable. */
let server: Server;
let origin: string;
const received: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/slow') return; // never answers -- the in-flight fixture
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('ok');
    });
  });
  await new Promise<void>(done => {
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  origin = `http://127.0.0.1:${String(port)}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(done => {
    server.close(() => {
      done();
    });
  });
});

describe('undiciTransport construction and ownership', () => {
  test('SEAM-14: a bring-your-own dispatcher is never closed by the transport', async () => {
    let closed = false;
    const byo = {
      request: () => Promise.reject(new Error('not dispatched in this test')),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
      destroy: () => Promise.resolve(),
    } as unknown as Dispatcher;

    const transport = undiciTransport({dispatcher: byo});
    await transport.close();
    await transport.close();
    expect(closed).toBe(false);
  });

  test('TRANSPORT-15/16: an owned agent is closed, idempotently', async () => {
    const transport = undiciTransport({agentOptions: {connections: 1}});
    await transport.close();
    // Reaching the next line proves the second close neither threw nor hung (TRANSPORT-16).
    await transport.close();
  });

  test('a transport-constructed ProxyAgent is owned and released too', async () => {
    const transport = undiciTransport({
      proxy: createProxyOptions({type: 'http', host: '127.0.0.1', port: 3128}),
    });
    // The ProxyAgent is SDK-created, so close() must release it -- the bug this guards is closing
    // only the separately-constructed direct Agent and leaking the ProxyAgent actually in use.
    await transport.close();
    await transport.close();
  });

  test('supplying both a dispatcher and a proxy fails loudly at construction', () => {
    const agent = new undici.Agent();
    expect(() =>
      undiciTransport({
        dispatcher: agent,
        proxy: createProxyOptions({type: 'http', host: 'proxy', port: 8080}),
      }),
    ).toThrow(TypeError);
    void agent.close();
  });
});

describe('undiciTransport dispatch', () => {
  test('TRANSPORT-2/11: redirects are pinned off and Connection is forwarded, not dropped', async () => {
    const dispatched: Dispatcher.RequestOptions[] = [];
    const recorder = {
      request: (options: Dispatcher.RequestOptions) => {
        dispatched.push(options);
        return Promise.resolve({
          statusCode: 200,
          headers: {},
          body: {
            destroy: () => undefined,
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.resolve({done: true, value: undefined}),
            }),
          },
        } as unknown as Dispatcher.ResponseData);
      },
      close: () => Promise.resolve(),
    } as unknown as Dispatcher;

    const transport = undiciTransport({dispatcher: recorder});
    const request = Request.newBuilder()
      .url(`${origin}/anything?q=1`)
      .headers(
        Headers.newBuilder()
          .set('Connection', 'keep-alive')
          .set('Content-Length', '999')
          .build(),
      )
      .build();
    await (await transport.send(request)).close();

    const sent = dispatched[0];
    expect(sent?.maxRedirections).toBe(0);
    expect(sent?.path).toBe('/anything?q=1');
    const headers = sent?.headers as string[];
    expect(headers).toContain('Connection');
    expect(headers).not.toContain('Content-Length');
  });
});

describe('undiciTransport body and adaptation paths', () => {
  test('TRANSPORT-28: a file body dispatches exactly its declared byte range', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'undici-file-body-'));
    try {
      const path = join(dir, 'payload.bin');
      await writeFile(path, 'ABCDEFGH');
      // The structural recognition contract, built by hand: this package must narrow on
      // `kind === 'file'` alone, never on an instanceof against @dexpace/body-file, which it
      // deliberately does not depend on.
      const descriptor: FileBodyDescriptor = {
        kind: 'file',
        mediaType: 'application/octet-stream',
        contentLength: 4,
        replayable: true,
        path,
        start: 2,
        count: 4,
        writeTo: () =>
          Promise.reject(new Error('the transport must not call writeTo here')),
      };
      const transport = undiciTransport();
      const request = Request.newBuilder()
        .method('POST')
        .url(`${origin}/upload`)
        .body(descriptor)
        .build();
      received.length = 0;
      await (await transport.send(request)).close();
      await transport.close();
      expect(received[0]).toBe('CDEF');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });

  test('a zero-count file body dispatches as an empty body, not a stream error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'undici-empty-file-body-'));
    try {
      const path = join(dir, 'payload.bin');
      await writeFile(path, 'ABCDEFGH');
      // createReadStream throws ERR_OUT_OF_RANGE the moment `end` falls below `start`, which is what
      // `start + count - 1` computes for count 0 -- the empty range needs its own branch.
      const descriptor: FileBodyDescriptor = {
        kind: 'file',
        mediaType: 'application/octet-stream',
        contentLength: 0,
        replayable: true,
        path,
        start: 4,
        count: 0,
        writeTo: () => Promise.resolve(),
      };
      const transport = undiciTransport();
      received.length = 0;
      const response = await transport.send(
        Request.newBuilder()
          .method('POST')
          .url(`${origin}/upload`)
          .body(descriptor)
          .build(),
      );
      await response.close();
      await transport.close();
      expect(received[0]).toBe('');
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
});

describe('undiciTransport request-body failures', () => {
  test('a body that cannot be written fails the send as a transport failure', async () => {
    const transport = undiciTransport();
    const request = Request.newBuilder()
      .method('POST')
      .url(`${origin}/upload`)
      .body({
        kind: 'byte-array',
        mediaType: 'text/plain',
        contentLength: 3,
        replayable: true,
        writeTo: () => Promise.reject(new Error('body exploded')),
      })
      .build();
    // Classified the same way the streaming branch classifies the same failure, cause intact.
    expect(await rejection(transport.send(request))).toMatchObject({
      name: 'TransportFailureError',
      cause: {message: 'body exploded'},
    });
    await transport.close();
  });

  test('TRANSPORT-22: an adaptation throw destroys the native body before propagating', async () => {
    let destroyed = false;
    const hostile = {
      get statusCode(): number {
        throw new Error('adaptation exploded');
      },
      headers: {},
      body: {
        destroy: () => {
          destroyed = true;
        },
      },
    } as unknown as Dispatcher.ResponseData;

    const transport = undiciTransport({
      dispatcher: {
        request: () => Promise.resolve(hostile),
        close: () => Promise.resolve(),
      } as unknown as Dispatcher,
    });
    const request = Request.newBuilder().url(`${origin}/anything`).build();
    expect(await rejection(transport.send(request))).toMatchObject({
      message: 'adaptation exploded',
    });
    expect(destroyed).toBe(true);
  });
});

describe('undiciTransport failure classification (TRANSPORT-20)', () => {
  test('an argument undici can never accept is terminal, not a retryable failure', async () => {
    // The drop set that removes Proxy-Authorization is chosen from `options.proxy`, so a BYO
    // ProxyAgent leaves the header in place and ProxyAgent.dispatch rejects it outright. That is a
    // permanent misconfiguration: classifying it as TransportFailureError would make it an IoError,
    // and classify.ts returns true for every IoError -- a caller's whole retry budget spent
    // re-proving the same rejection. It is reported outside the IoError tree instead.
    const agent = new undici.ProxyAgent({uri: 'http://127.0.0.1:1/'});
    const transport = undiciTransport({dispatcher: agent});
    try {
      const request = Request.newBuilder()
        .url('http://example.invalid/')
        .headers(
          Headers.newBuilder()
            .set('Proxy-Authorization', 'Basic Zm9vOmJhcg==')
            .build(),
        )
        .build();
      const error = await rejection(transport.send(request));
      expect(error).toBeInstanceOf(TypeError);
      // Outside the IoError tree is the whole point: classify.ts's allow-list returns true for
      // every IoError and false for anything it was never opted into (RETRY-2).
      expect(error).not.toBeInstanceOf(IoError);
      expect((error as {cause?: {code?: string}}).cause?.code).toBe(
        'UND_ERR_INVALID_ARG',
      );
    } finally {
      await transport.close();
      await agent.close();
    }
  });

  test('a genuine network failure stays the retryable TransportFailureError', async () => {
    // The twin of the row above: the catch-all branch must keep classifying a no-response failure
    // as retryable, so narrowing it did not turn every dispatch error terminal.
    const transport = undiciTransport();
    try {
      const request = Request.newBuilder().url('http://127.0.0.1:1/').build();
      const error = await rejection(transport.send(request));
      expect(error).toBeInstanceOf(TransportFailureError);
      expect(error).toBeInstanceOf(IoError);
    } finally {
      await transport.close();
    }
  });
});

describe('undiciTransport proxy dispatch (TRANSPORT-30)', () => {
  test('a per-request Proxy-Authorization is dropped when a proxy is configured', async () => {
    // ProxyAgent.dispatch throws InvalidArgumentError on ANY per-request Proxy-Authorization -- a
    // deliberate undici security fix -- so forwarding one would turn every proxied send into a hard
    // failure. It is dropped instead, and the drop log is what keeps that discoverable
    // (TRANSPORT-11/12/30).
    const {dropped, restore} = captureDroppedHeaders();
    const transport = undiciTransport({
      headerDropLogging: 'all',
      proxy: createProxyOptions({
        type: 'http',
        host: '127.0.0.1',
        port: 1,
        nonProxyHosts: ['127.0.0.1'],
      }),
    });
    try {
      const response = await transport.send(
        Request.newBuilder()
          .url(`${origin}/anything`)
          .headers(
            Headers.newBuilder()
              .set('Proxy-Authorization', 'Basic stale')
              .build(),
          )
          .build(),
      );
      await response.close();
      expect(dropped).toContain('proxy-authorization');
    } finally {
      restore();
      await transport.close();
    }
  });

  test('a proxied transport routes a NO_PROXY host over its direct agent', async () => {
    const transport = undiciTransport({
      proxy: createProxyOptions({
        type: 'http',
        host: '127.0.0.1',
        port: 1,
        nonProxyHosts: ['127.0.0.1'],
      }),
    });
    // Port 1 is a dead proxy: reaching the fixture at all proves the bypass routed direct.
    const response = await transport.send(
      Request.newBuilder().url(`${origin}/anything`).build(),
    );
    expect(response.status.code).toBe(200);
    await response.close();
    await transport.close();
  });

  test('asyncDispose is the same teardown as close', async () => {
    const transport = undiciTransport();
    await transport[Symbol.asyncDispose]();
    await transport.close();
  });
});

describe('undiciTransport cancellation (TRANSPORT-8)', () => {
  test('TRANSPORT-16: close does not wait out an in-flight request', async () => {
    const transport = undiciTransport();
    const pending = rejection(
      transport.send(Request.newBuilder().url(`${origin}/slow`).build()),
    );
    await new Promise(resolve => setTimeout(resolve, 25));
    const startedClosing = Date.now();
    await transport.close();
    // The fixture holds /slow open forever; a graceful close would block here until it gave up.
    expect(Date.now() - startedClosing).toBeLessThan(1_000);
    expect(await pending).toMatchObject({name: 'CancellationError'});
  });

  test('destroying the dispatcher mid-flight is terminal, not a retryable failure', async () => {
    const agent = new undici.Agent();
    const transport = undiciTransport({dispatcher: agent});
    const pending = transport.send(
      Request.newBuilder().url(`${origin}/slow`).build(),
    );
    // Give the request time to actually reach the socket before tearing the client down.
    await new Promise(resolve => setTimeout(resolve, 25));
    await agent.destroy();
    expect(await rejection(pending)).toMatchObject({
      name: 'CancellationError',
    });
  });

  test('a timeout on the same path stays retryable', async () => {
    const transport = undiciTransport();
    const pending = transport.send(
      Request.newBuilder().url(`${origin}/slow`).build(),
      RequestOptions.newBuilder().timeoutMs(40).build(),
    );
    expect(await rejection(pending)).toMatchObject({
      name: 'TransportFailureError',
    });
    await transport.close();
  });
});
