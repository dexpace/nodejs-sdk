// SPDX-License-Identifier: MIT
// packages/transport-undici/src/undici-transport.ts
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import type {ReadableStream as NodeReadableStream} from 'node:stream/web';
import {
  CancellationError,
  composeSignal,
  Protocol,
  Response,
  shouldBypassProxy,
  Status,
  TransportFailureError,
  type Body,
  type FileBodyDescriptor,
  type ProxyOptions,
  type Request,
  type RequestOptions,
  type Transport,
} from '@dexpace/core';
import {
  abortToSdkError,
  createDropLogger,
  degradeInboundHeaders,
  forkSignal,
  isMaterializable,
  mapOutboundHeaders,
  materializeBody,
  producerFailure,
  pumpBody,
  type BodyPump,
  type ForkedSignal,
  type HeaderDropLogging,
} from '@dexpace/transport-shared';
import type {Agent, Dispatcher, ProxyAgent} from 'undici';
import {
  createProxyChallengeReporter,
  warnIfCustomChallengeHandler,
} from './challenge-handler.js';

/**
 * `undici` is loaded through `createRequire`, not a static `import`, because Bun resolves the bare
 * specifier `undici` to its own built-in shim: the shim's `Agent` constructs but has no `request`
 * method, so every dispatch under `bun test` would fail with a `TypeError` instead of reaching the
 * wire. Requiring the real package's entry file by path bypasses that alias and resolves identically
 * under plain Node. The types still come from the static `import type` above, so this stays fully
 * checked. Revisit when Bun's shim implements `Dispatcher.request`, or if undici ever adds an
 * `exports` map that hides `index.js` (this package pins `^6`, which has neither).
 */
const require = createRequire(import.meta.url);
const undici = require('undici/index.js') as typeof import('undici');

/**
 * TRANSPORT-11's outbound drop set for this transport. `connection` is deliberately absent — §17's
 * own note is that an undici-class transport forwards it rather than dropping it.
 */
const UNDICI_FORBIDDEN_HEADERS: readonly string[] = [
  'content-length',
  'host',
  'transfer-encoding',
];

/**
 * The drop set when this transport owns a `ProxyAgent`. `ProxyAgent.dispatch` throws
 * `InvalidArgumentError` on *any* per-request `Proxy-Authorization` — a deliberate undici security
 * fix, not an oversight — so forwarding one turns every proxied send into a hard failure. Dropping
 * it degrades one header instead (TRANSPORT-12) and, because every drop is logged by name, keeps the
 * limitation discoverable rather than silent (TRANSPORT-11/13, TRANSPORT-30).
 */
const UNDICI_PROXIED_FORBIDDEN_HEADERS: readonly string[] = [
  ...UNDICI_FORBIDDEN_HEADERS,
  'proxy-authorization',
];

/** Bodies at or below this declared length are buffered rather than streamed; see the fetch twin. */
const MAX_MATERIALIZED_BODY_BYTES = 1_000_000;

/**
 * Options for {@link undiciTransport}.
 *
 * @public
 */
export interface UndiciTransportOptions {
  /**
   * A bring-your-own `Dispatcher`. It is used as-is and **never** closed by this transport
   * (SEAM-14); supplying it together with `proxy` is a construction-time error.
   */
  readonly dispatcher?: Dispatcher;
  /** Proxy configuration; the transport constructs and owns the resulting `ProxyAgent`. */
  readonly proxy?: ProxyOptions;
  /** How dropped header names are logged (TRANSPORT-13); defaults to `'first-per-name'`. */
  readonly headerDropLogging?: HeaderDropLogging;
  /** A timeout applied to every call that supplies no `RequestOptions.timeoutMs` of its own. */
  readonly defaultTimeoutMs?: number;
  /** `Agent` options, used only when no `dispatcher` is supplied. */
  readonly agentOptions?: Agent.Options;
}

/** The dispatcher pair one transport routes over, plus the subset it owns and must close. */
interface DispatcherSet {
  /** Where a non-bypassed request goes; identical to `direct` when no proxy is configured. */
  readonly proxied: Dispatcher;
  /** Where a `shouldBypassProxy` host goes, so `NO_PROXY` is honored rather than tunnelled. */
  readonly direct: Dispatcher;
  /** Dispatchers this transport constructed; empty for a caller-supplied one (SEAM-14). */
  readonly owned: readonly Dispatcher[];
}

/**
 * The proxy URI plus its Basic credential, kept apart. `formatProxyOptions` is deliberately *not*
 * used here: it masks credentials as `***:***` for logging, and feeding that to `ProxyAgent` would
 * authenticate with the literal mask (TRANSPORT-30 — credentials must not leak, and must still work).
 */
function toProxyAgentOptions(proxy: ProxyOptions): ProxyAgent.Options {
  // `host` is stored bare, so an IPv6 literal needs its brackets back before it can be a URL authority.
  const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
  const uri = `${proxy.type}://${host}:${String(proxy.port)}`;
  if (proxy.credentials === undefined) return {uri};
  const raw = `${proxy.credentials.username}:${proxy.credentials.password}`;
  return {uri, token: `Basic ${Buffer.from(raw).toString('base64')}`};
}

/**
 * One exclusive decision, made once, fixing both the dispatcher pair and its ownership. Supplying
 * both `dispatcher` and `proxy` fails loudly rather than silently picking one: a BYO dispatcher may
 * already be a `ProxyAgent`, and ignoring either option hides which is in force.
 */
function selectDispatchers(options: UndiciTransportOptions): DispatcherSet {
  if (options.dispatcher !== undefined && options.proxy !== undefined) {
    throw new TypeError(
      'supply either `dispatcher` or `proxy`, not both: a bring-your-own dispatcher may already be ' +
        'a ProxyAgent, and silently ignoring one of the two hides which is in force',
    );
  }
  if (options.dispatcher !== undefined) {
    const byo = options.dispatcher;
    return {proxied: byo, direct: byo, owned: []};
  }
  // Agent, not Pool: a Pool is bound to one origin at construction, but a general-purpose Transport
  // must reach whatever origin each Request names.
  const direct = new undici.Agent(options.agentOptions);
  if (options.proxy === undefined)
    return {proxied: direct, direct, owned: [direct]};
  const proxied = new undici.ProxyAgent(toProxyAgentOptions(options.proxy));
  return {proxied, direct, owned: [proxied, direct]};
}

/** undici's flat `[name, value, name, value, ...]` form -- the only shape that keeps a repeated name repeated (HTTP-14). */
function toUndiciHeaders(
  request: Request,
  forbidden: readonly string[],
  logDrops: (dropped: readonly string[]) => void,
): string[] {
  const {sent, dropped} = mapOutboundHeaders(request.headers, forbidden, {
    bodyDerivedMediaType: request.body?.mediaType,
  });
  logDrops(dropped);
  return [...sent.entries()].flat();
}

/**
 * undici's own codes for "this exchange was torn down from inside the client", as opposed to a
 * network failure. TRANSPORT-8 requires the two be told apart: a destroyed dispatcher is terminal
 * (nothing about retrying it can succeed — the client is gone), while a timeout on the same code
 * path stays retryable. Reached only after the caller-signal branch, so a caller abort and a
 * per-call timeout are already classified by then.
 */
const NATIVE_CANCEL_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_DESTROYED',
  'UND_ERR_ABORTED',
  'UND_ERR_CLOSED',
]);

/**
 * undici's codes for "these arguments can never work", as opposed to "this exchange failed". Both are
 * raised by argument validation and are perfectly reproducible, so classifying them as
 * `TransportFailureError` would hand `classify.ts` an always-retryable verdict (it returns `true` for
 * every `IoError`) and spend a caller's whole retry budget re-proving a permanent misconfiguration.
 * The commonest way to reach one is a bring-your-own `ProxyAgent` plus a per-request
 * `Proxy-Authorization`: `UNDICI_PROXIED_FORBIDDEN_HEADERS` only drops that header when this
 * transport constructed the proxy itself, so with a BYO dispatcher it reaches `dispatch` and is
 * rejected outright.
 */
const TERMINAL_ARGUMENT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_INVALID_ARG',
  'UND_ERR_NOT_SUPPORTED',
]);

function errorCode(error: unknown): string | undefined {
  const code = (error as {code?: unknown} | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isNativeCancel(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && NATIVE_CANCEL_CODES.has(code);
}

/**
 * Maps one dispatch failure onto the SDK's error vocabulary. Extracted from `#dispatch` so the four
 * branches read as one classification table rather than as control flow wrapped around a call.
 *
 * @param error - whatever the dispatch rejected with.
 * @param signal - the forked signal the dispatch was given, if any.
 * @returns the error to throw; never returns normally without one.
 */
function toDispatchError(
  error: unknown,
  signal: AbortSignal | undefined,
): Error {
  if (signal?.aborted) return abortToSdkError(signal, error);
  if (isNativeCancel(error)) {
    // TRANSPORT-8: terminal, never retryable -- the dispatcher this send was routed over no longer
    // exists, so a retry over it cannot succeed.
    return new CancellationError('undici dispatcher was destroyed', {
      cause: error,
    });
  }
  const code = errorCode(error);
  if (code !== undefined && TERMINAL_ARGUMENT_CODES.has(code)) {
    // Deliberately outside the IoError tree: `classify.ts` is an allow-list, so anything that is not
    // an IoError, a timeout, or a retryable status is non-retryable for free (RETRY-2). `TypeError`
    // matches `selectDispatchers`, which already reports a caller misconfiguration that way.
    return new TypeError(
      error instanceof Error
        ? error.message
        : 'undici rejected the request arguments',
      {cause: error},
    );
  }
  return new TransportFailureError(
    error instanceof Error ? error.message : 'undici dispatch failed',
    {cause: error},
  );
}

/** What undici accepts as a request body; `undefined` is not one of them, `null` is. */
type UndiciBody = Exclude<Dispatcher.RequestOptions['body'], undefined>;

/** A request body prepared for one dispatch, plus the teardown an abandoned producer is owed. */
interface PreparedBody {
  readonly init: UndiciBody;
  readonly pump: BodyPump | undefined;
}

/**
 * TRANSPORT-28's recognition contract, in one named place: a plain string-literal check, never a
 * cross-package `instanceof` against `@dexpace/body-file` (which this package does not depend on).
 * `Body.kind` is a union on one interface rather than a discriminated union of interfaces, so the
 * narrowing has to be spelled out as a predicate.
 */
function isFileBody(body: Body): body is FileBodyDescriptor {
  return body.kind === 'file';
}

async function prepareBody(body: Body | undefined): Promise<PreparedBody> {
  if (body === undefined) return {init: null, pump: undefined};
  if (isFileBody(body)) {
    // An empty range is not a degenerate read stream: `createReadStream` throws ERR_OUT_OF_RANGE the
    // moment `end` (start + count - 1) falls below `start`, so a zero-count file body has to become
    // an explicit empty body rather than a stream nobody can open.
    if (body.count === 0) return {init: new Uint8Array(0), pump: undefined};
    // TRANSPORT-28: dispatch straight off the file, honoring start/count, rather than routing the
    // bytes through a userspace TransformStream first. The closest available approximation of the
    // reference's zero-copy path -- see the Deviation Ledger for why a literal one does not exist.
    return {
      init: createReadStream(body.path, {
        start: body.start,
        end: body.start + body.count - 1,
      }),
      pump: undefined,
    };
  }
  if (isMaterializable(body, MAX_MATERIALIZED_BODY_BYTES)) {
    try {
      return {init: await materializeBody(body), pump: undefined};
    } catch (error) {
      // Same classification the streaming branch gives the same failure -- see the fetch twin.
      throw new TransportFailureError('request body could not be written', {
        cause: error,
      });
    }
  }
  const pump = pumpBody(body);
  return {
    init: Readable.fromWeb(pump.readable as unknown as NodeReadableStream),
    pump,
  };
}

/**
 * Wraps undici's body in a web stream that reads only when pulled.
 *
 * Deliberately not `Readable.toWeb`: Bun's adapter keeps enqueuing after the controller closes and
 * throws `ERR_INVALID_STATE` the moment a response is closed without being fully read — which is
 * exactly TRANSPORT-25's close-without-reading path. Deliberately not a `start()` that attaches a
 * `'data'` listener either: that switches the Node stream into flowing mode and buffers the whole
 * body eagerly, defeating the same requirement from the other side. Async iteration is pull-based,
 * so a chunk is read only when the consumer asks, and `cancel` destroys the underlying body, which
 * is what returns the connection to the pool.
 */
function toDemandDrivenStream(body: Readable): ReadableStream<Uint8Array> {
  // `undefined` as the return type, not the default `any`: the done-result's `value` would
  // otherwise destructure as `any` and defeat the type-aware lint rules.
  const chunks = body[Symbol.asyncIterator]() as AsyncIterator<
    Uint8Array,
    undefined
  >;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const {done, value} = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      body.destroy(reason instanceof Error ? reason : undefined);
    },
  });
}

function adaptResponse(
  request: Request,
  result: Dispatcher.ResponseData,
  logDrops: (dropped: readonly string[]) => void,
): Response {
  const raw: [string, string][] = [];
  for (const [name, value] of Object.entries(result.headers)) {
    if (value === undefined) continue;
    // An array means a genuinely repeated header -- undici arrays ANY name it saw more than once,
    // not just `Set-Cookie`. Keep each value its own entry: `WWW-Authenticate` and
    // `Proxy-Authenticate` arrive this way from a server following RFC 7616 3.3, and collapsing them
    // to the first would hide every challenge after it (audit #67 / #74). `@dexpace/transport-fetch`
    // comma-joins the same response, which RFC 9110 5.3 makes equivalent; the conformance row
    // `a repeated inbound header keeps every value` asserts the two agree on the list.
    if (Array.isArray(value)) for (const each of value) raw.push([name, each]);
    else raw.push([name, value]);
  }
  const {headers, dropped} = degradeInboundHeaders(raw);
  logDrops(dropped);

  return (
    Response.newBuilder()
      .request(request)
      // A documented best-effort default: undici's ResponseData does not surface the negotiated HTTP
      // version any more than the WHATWG Response does (Deviation Ledger).
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(result.statusCode))
      .headers(headers)
      .body(toDemandDrivenStream(result.body))
      .build()
  );
}

/** Everything one dispatch needs that is not the request itself; keeps `max-params` at three. */
interface DispatchContext {
  readonly headers: string[];
  readonly body: UndiciBody;
  /** The forked signal handed to undici; detached by `send` the moment the response is delivered. */
  readonly fork: ForkedSignal;
}

/**
 * Destroys every dispatcher in reverse acquisition order and returns whatever failed, rather than
 * stopping at the first rejection. Teardown is best-effort by definition: a dispatcher that cannot be
 * released is not a reason to leak the ones behind it (TRANSPORT-15/16).
 */
async function releaseAll(
  dispatchers: readonly Dispatcher[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const dispatcher of [...dispatchers].reverse()) {
    try {
      await dispatcher.destroy();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

class UndiciTransport implements Transport {
  readonly #dispatchers: DispatcherSet;
  readonly #proxy: ProxyOptions | undefined;
  readonly #logDrops: (dropped: readonly string[]) => void;
  readonly #defaultTimeoutMs: number | undefined;
  readonly #forbiddenHeaders: readonly string[];
  readonly #reportProxyChallenge: (response: Response) => void;
  #closing: Promise<void> | undefined;

  constructor(options: UndiciTransportOptions) {
    this.#dispatchers = selectDispatchers(options);
    this.#proxy = options.proxy;
    this.#logDrops = createDropLogger(
      options.headerDropLogging ?? 'first-per-name',
    );
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
    this.#forbiddenHeaders =
      options.proxy === undefined
        ? UNDICI_FORBIDDEN_HEADERS
        : UNDICI_PROXIED_FORBIDDEN_HEADERS;
    this.#reportProxyChallenge = createProxyChallengeReporter(options.proxy);
    // TRANSPORT-30: undici cannot dispatch a custom challenge handler at all, so the limitation is
    // surfaced up front rather than discovered on a 407.
    warnIfCustomChallengeHandler(options.proxy);
  }

  async send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    const composed = composeSignal(
      signal,
      options?.timeoutMs ?? this.#defaultTimeoutMs,
    );
    if (composed?.aborted) throw abortToSdkError(composed, composed.reason);

    // Headers BEFORE the body, deliberately -- the fetch twin evaluates them in this order too.
    // `prepareBody` starts a streaming producer eagerly, while `toUndiciHeaders` reads
    // `request.body.mediaType`, a getter on a caller-supplied Body that may throw. Preparing the
    // body first leaves such a throw with a live producer nobody can abandon, whose own later
    // rejection then reaches Node's default unhandledRejection policy (TRANSPORT-19, SEAM-30).
    const headers = toUndiciHeaders(
      request,
      this.#forbiddenHeaders,
      this.#logDrops,
    );
    const prepared = await prepareBody(request.body);
    // Dispatched with a fork the caller cannot reach: cancellation stays live for the whole in-flight
    // window and goes inert the moment the response is handed over (SEAM-16).
    const context: DispatchContext = {
      headers,
      body: prepared.init,
      fork: forkSignal(composed),
    };
    try {
      return await this.#exchange(request, context, prepared.pump);
    } finally {
      context.fork.detach();
    }
  }

  async #exchange(
    request: Request,
    context: DispatchContext,
    pump: BodyPump | undefined,
  ): Promise<Response> {
    const result = await this.#dispatch(request, context, pump);
    // The fork, not the caller's signal: it mirrors the source for as long as it stays attached,
    // which is exactly the in-flight window this check is about.
    const dispatched = context.fork.signal;

    if (dispatched?.aborted) {
      // TRANSPORT-9 / SEAM-30: this response will never reach a caller, so this producer closes it.
      await result.body.dump().catch(() => undefined);
      await pump?.abandon(dispatched.reason);
      throw abortToSdkError(dispatched, dispatched.reason);
    }

    try {
      // TRANSPORT-22: a live socket is in hand, so any throw here must release it before propagating.
      const response = adaptResponse(request, result, this.#logDrops);
      this.#reportProxyChallenge(response);
      return response;
    } catch (error) {
      result.body.destroy();
      // TRANSPORT-19: nothing is delivered on this path either, so the producer is owed its teardown
      // exactly as on the abort branch above.
      await pump?.abandon(error);
      throw error;
    }
  }

  async #dispatch(
    request: Request,
    context: DispatchContext,
    pump: BodyPump | undefined,
  ): Promise<Dispatcher.ResponseData> {
    const dispatcher =
      this.#proxy !== undefined &&
      shouldBypassProxy(this.#proxy, request.url.hostname)
        ? this.#dispatchers.direct
        : this.#dispatchers.proxied;
    try {
      // Raced, not sequenced, for the same two reasons as the fetch twin: a producer failure must
      // surface even while undici is still pending, and -- because the race keeps a handler on
      // `done` after it settles -- a producer that fails *after* delivery is an observed rejection
      // rather than one that reaches Node's default `unhandledRejection` policy (TRANSPORT-19).
      return await Promise.race([
        dispatcher.request({
          origin: request.url.origin,
          path: `${request.url.pathname}${request.url.search}`,
          method: request.method,
          headers: context.headers,
          body: context.body,
          // `?? null` rather than an omitted key: `exactOptionalPropertyTypes` makes an explicit
          // `undefined` a distinct, rejected value here, and undici reads `null` as "no signal".
          signal: context.fork.signal ?? null,
          // TRANSPORT-1: pinned explicitly rather than inherited -- a BYO dispatcher may carry a
          // redirect interceptor, and the pipeline is the single redirect authority.
          maxRedirections: 0,
        }),
        producerFailure(pump?.done),
      ]);
    } catch (error) {
      await pump?.abandon(error);
      throw toDispatchError(error, context.fork.signal);
    }
  }

  /**
   * Releases every dispatcher this transport constructed, in reverse acquisition order, and never a
   * caller-supplied one (SEAM-14, TRANSPORT-15). Idempotent, and concurrent calls share one
   * teardown (TRANSPORT-16).
   *
   * `destroy()`, not undici's graceful `close()`: TRANSPORT-16 requires a non-blocking shutdown with
   * no unbounded await, and `close()` waits for every enqueued request to finish — one in-flight send
   * against a slow peer would stall teardown for that peer's whole timeout. Sends still in flight
   * therefore reject with the terminal `CancellationError`, which is also this transport's documented
   * SEAM-15 post-close mode: a send issued after `close()` cannot succeed over a dispatcher that no
   * longer exists, so it is not reported as a retryable failure.
   *
   * A dispatcher that fails to release does not strand the rest: every owned dispatcher is destroyed
   * before the failure is reported, so one bad pool cannot leak the others.
   *
   * @returns a promise that resolves once the owned dispatchers are released.
   * @throws `TransportFailureError` when one or more owned dispatchers failed to release. The
   * rejection is memoized like the success path, so a later `close()` reports the same failure rather
   * than falsely claiming a clean teardown.
   */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      // Every owned dispatcher is destroyed even when an earlier one rejects. A bare `for … await`
      // loop propagates on the first failure and leaks the pooled connections of every dispatcher
      // after it -- and `owned` is walked in reverse, so with a proxy configured the ProxyAgent
      // actually holding those connections is the one destroyed last.
      const failures = await releaseAll(this.#dispatchers.owned);
      if (failures.length > 0) {
        // A raw undici error would otherwise escape a public method untyped (NFR-7); the causes are
        // preserved rather than flattened to a message.
        throw new TransportFailureError(
          'one or more owned dispatchers failed to release',
          {
            cause:
              failures.length === 1
                ? failures[0]
                : new AggregateError(failures),
          },
        );
      }
    })();
    return this.#closing;
  }
}

// Single teardown path for `await using`, delegating to `UndiciTransport.close()` and installed at run
// time only when the symbol exists — the same guarded shape `SseStream` and `Page` use.
//
// DO NOT restore this as a plain `[Symbol.asyncDispose]()` class member. Node 20.3 is this package's
// declared floor (`engines.node`, checked by verify:runtime-floor) and predates the symbol, which
// arrived in 20.4. On the floor the computed key evaluates to `undefined` and binds the method to the
// string key `"undefined"` — a junk prototype entry, and no working disposal. Declaring it on the
// class would also emit it into the `.d.ts` unconditionally, promising consumers on the floor a method
// that is not there.
if (typeof Symbol.asyncDispose === 'symbol') {
  Object.defineProperty(UndiciTransport.prototype, Symbol.asyncDispose, {
    value: function asyncDispose(this: UndiciTransport): Promise<void> {
      return this.close();
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Creates a `Transport` backed by `undici` — the full-featured option, with connection-pool control,
 * proxy support, and real `close()` semantics over the dispatchers it owns.
 *
 * `close()` is the single teardown path `docs/knowledge/harvested/resource-management.md` asks for, and the one
 * that actually destroys the dispatchers this transport owns. A `[Symbol.asyncDispose]` delegating to
 * it is installed at run time **when the runtime has the symbol**, which this package's declared floor
 * (`engines.node >=20.3`) does not — it arrived in Node 20.4. The return type therefore does not
 * promise `AsyncDisposable`: claiming it would type-check `await using` for a consumer sitting on the
 * floor, where the method is genuinely absent, and leak every pooled connection. Call `close()`, or
 * raise your own floor to 20.4+ and reach the symbol through a cast.
 *
 * @param options - optional transport settings.
 * @returns a transport ready to send; release it with `close()`.
 * @throws `TypeError` when both `dispatcher` and `proxy` are supplied.
 *
 * @public
 */
export function undiciTransport(
  options: UndiciTransportOptions = {},
): Transport {
  return new UndiciTransport(options);
}
