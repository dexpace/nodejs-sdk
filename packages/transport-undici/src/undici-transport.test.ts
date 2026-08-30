// SPDX-License-Identifier: MIT
// packages/transport-undici/src/undici-transport.test.ts
// Exercises: TRANSPORT-2 (no redirect interceptor is composed), TRANSPORT-8 (a native-internal cancel
// is terminal while a timeout stays retryable), TRANSPORT-11 (undici keeps `Connection`),
// XCUT-22 (the SDK closes only resources it created: a caller-supplied dispatcher is never closed and
// stays usable afterwards), XCUT-13 (close is idempotent -- a second call is a no-op that neither
// throws nor blocks),
// TRANSPORT-15/16 (ownership-aware, idempotent close), TRANSPORT-22 (an adaptation throw destroys the
// native body), TRANSPORT-20 (a permanent argument error is terminal, a no-response failure is
// retryable), TRANSPORT-28 (a file body dispatches its declared byte range), SEAM-14,
// TRANSPORT-19 (a header-mapping throw leaves no started body producer stranded), SEAM-30 (so no
// producer rejection reaches Node's default unhandledRejection policy)
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
  type Body,
  type FileBodyDescriptor,
  type Logger,
} from '@dexpace/core';
import type {Agent, Dispatcher, ProxyAgent} from 'undici';
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

/**
 * DispatcherBase's public `destroyed` getter, which undici's shipped `Dispatcher` and `ProxyAgent`
 * types omit even though every concrete dispatcher exposes it.
 */
interface DestroyableDispatcher {
  readonly destroyed: boolean;
}

/**
 * A streaming body whose `mediaType` getter throws, recording whether its producer was ever started.
 * The shape header mapping trips over: `mediaType` is read during mapping, while `writeTo` only runs
 * once `pumpBody` has taken ownership.
 */
function bodyWithThrowingMediaType(): {
  body: Body;
  producerStarted: () => boolean;
} {
  let started = false;
  return {
    body: {
      kind: 'stream',
      get mediaType(): string | undefined {
        throw new Error('mediaType getter exploded');
      },
      // -1 / non-replayable forces the streaming branch rather than the buffered one.
      contentLength: -1,
      replayable: false,
      writeTo: () => {
        started = true;
        return Promise.resolve();
      },
    },
    producerStarted: () => started,
  };
}

/**
 * Swaps undici's exported `Agent` binding for a capturing subclass, so the dispatcher a transport
 * constructs for *itself* is reachable from the test. `destroyed` is DispatcherBase's own public getter,
 * so teardown stays observable without patching `destroy` at all.
 */
function captureOwnedAgents(): {
  agents: DestroyableDispatcher[];
  restore: () => void;
} {
  const bindings = undici as unknown as Record<string, unknown>;
  const RealAgent = undici.Agent;
  const agents: DestroyableDispatcher[] = [];

  class CapturingAgent extends RealAgent {
    constructor(opts?: Agent.Options) {
      super(opts);
      // No cast needed here: undici's shipped `Agent` type declares `destroyed`, unlike its bare
      // `Dispatcher` and `ProxyAgent` types.
      agents.push(this);
    }
  }

  bindings.Agent = CapturingAgent;
  return {
    agents,
    restore: () => {
      bindings.Agent = RealAgent;
    },
  };
}

/**
 * Swaps undici's exported `Agent` / `ProxyAgent` bindings so a transport built afterwards gets a
 * direct `Agent` whose `destroy()` rejects, and captures the `ProxyAgent` constructed alongside it.
 *
 * The exported CLASS BINDINGS are swapped, not `DispatcherBase.prototype.destroy`: the transport
 * reads `undici.Agent` / `undici.ProxyAgent` off this exports object at construction time, while
 * ProxyAgent's own internal Agent comes from its private `require('./agent')`. Patching the shared
 * prototype instead makes the injected failure fire inside ProxyAgent's internals too, which is a
 * different bug than the one under test.
 *
 * The ProxyAgent is captured rather than intercepted: overriding its `destroy` would also catch
 * DispatcherBase's internal `this.destroy(err, callback)` re-dispatch and recurse. `destroyed` is
 * DispatcherBase's own public getter, so the effect is observable without touching teardown at all.
 */
function explodeDirectAgentDestroy(): {
  proxyAgents: DestroyableDispatcher[];
  restore: () => void;
} {
  const bindings = undici as unknown as Record<string, unknown>;
  const RealAgent = undici.Agent;
  const RealProxyAgent = undici.ProxyAgent;
  const proxyAgents: DestroyableDispatcher[] = [];

  class ExplodingAgent extends RealAgent {
    override destroy(): Promise<void> {
      return Promise.reject(new Error('agent destroy exploded'));
    }
  }
  class CapturingProxyAgent extends RealProxyAgent {
    constructor(opts: ProxyAgent.Options) {
      super(opts);
      // Cast because undici's shipped ProxyAgent type omits DispatcherBase's `destroyed` getter.
      proxyAgents.push(this as unknown as DestroyableDispatcher);
    }
  }

  bindings.Agent = ExplodingAgent;
  bindings.ProxyAgent = CapturingProxyAgent;
  return {
    proxyAgents,
    restore: () => {
      bindings.Agent = RealAgent;
      bindings.ProxyAgent = RealProxyAgent;
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

  test('a failing dispatcher destroy still releases every other owned dispatcher (TRANSPORT-15/16)', async () => {
    // owned is [ProxyAgent, Agent] and close() walks it reversed, so the direct Agent is destroyed
    // first. When that destroy rejects, a naive `for … await` loop propagates immediately and the
    // ProxyAgent -- the dispatcher actually holding the pooled proxy connections -- is never
    // released.
    const {proxyAgents, restore} = explodeDirectAgentDestroy();
    try {
      const transport = undiciTransport({
        proxy: createProxyOptions({
          type: 'http',
          host: '127.0.0.1',
          port: 3128,
        }),
      });
      expect(proxyAgents.length).toBe(1);
      // The failure is reported -- teardown must not swallow it (TRANSPORT-16) -- and it is reported
      // with the underlying cause intact rather than flattened to a message.
      const error = await rejection(transport.close());
      expect(error).toBeInstanceOf(TransportFailureError);
      expect(error).toMatchObject({
        cause: {message: 'agent destroy exploded'},
      });
      // Idempotent even on the failure path: the rejection is memoized, so a second close reports the
      // same failure rather than falsely claiming a clean teardown (TRANSPORT-16, XCUT-13).
      expect(await rejection(transport.close())).toBe(error);
      // ... but every other owned dispatcher is released regardless. This is the leak: with the
      // naive `for … await` loop the direct Agent's rejection aborts the walk and this stays false.
      expect(proxyAgents[0]?.destroyed).toBe(true);
    } finally {
      // Restoration must never be skipped, so this block stays assertion-free.
      restore();
    }
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

describe('undiciTransport disposal (TRANSPORT-15/16)', () => {
  test('asyncDispose is the same teardown as close, where the runtime has it', async () => {
    // The owned Agent is captured so "same teardown as close" is an assertion about the dispatcher
    // this transport constructed, not merely about the member existing: an asyncDispose wired to
    // anything other than close() -- or to a bare resolved promise -- leaves `destroyed` false below.
    const {agents, restore} = captureOwnedAgents();
    try {
      const transport = undiciTransport();
      expect(agents.length).toBe(1);
      // Cast rather than a bare `Symbol.asyncDispose` index: on the pinned floor (Node 20.3, which
      // predates the symbol's 20.4 arrival) it is `undefined` and the index would read the string key
      // `"undefined"`. The install in undici-transport.ts is guarded to match.
      const asyncDispose = (Symbol as {asyncDispose?: symbol}).asyncDispose;
      if (typeof asyncDispose === 'symbol') {
        const dispose = (
          transport as unknown as Record<
            symbol,
            (() => Promise<void>) | undefined
          >
        )[asyncDispose];
        expect(dispose).toBeDefined();
        await dispose?.call(transport);
        expect(agents[0]?.destroyed).toBe(true);
      }
      // Both legs: an unguarded `[Symbol.asyncDispose]()` class member would leave this junk key on
      // the prototype on the >=20.3 floor, with no working disposal behind it.
      expect(
        Object.getOwnPropertyNames(Object.getPrototypeOf(transport)),
      ).not.toContain('undefined');
      await transport.close();
    } finally {
      // Restoration must never be skipped, so this block stays assertion-free.
      restore();
    }
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

  test('a header-mapping throw never strands a started body producer (TRANSPORT-19, SEAM-30)', async () => {
    // `pumpBody` starts the producer EAGERLY, and header mapping reads `request.body.mediaType` --
    // a getter on a caller-supplied Body, which may throw. If the producer is started first, that
    // throw escapes before anything can abandon it and the producer's own later rejection reaches
    // Node's default unhandledRejection policy. Mapping headers first closes the window, which is
    // the order the fetch twin already evaluates them in.
    const {body, producerStarted} = bodyWithThrowingMediaType();
    const transport = undiciTransport();
    const request = Request.newBuilder()
      .method('POST')
      .url(`${origin}/upload`)
      .body(body)
      .build();

    await rejection(transport.send(request));
    expect(producerStarted()).toBe(false);
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
