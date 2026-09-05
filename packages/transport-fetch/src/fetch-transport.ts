// SPDX-License-Identifier: MIT
// packages/transport-fetch/src/fetch-transport.ts
import {
  composeSignal,
  Protocol,
  Response,
  Status,
  TransportFailureError,
  type Body,
  type Request,
  type RequestOptions,
  type Transport,
} from '@dexpace/core';
import {
  abortToSdkError,
  createDropLogger,
  degradeInboundHeaders,
  forkSignal,
  hasNoResponseBody,
  isMaterializable,
  mapOutboundHeaders,
  materializeBody,
  producerFailure,
  pumpBody,
  toDispatchFailure,
  type ForkedSignal,
  type HeaderDropLogging,
} from '@dexpace/transport-shared';

/**
 * TRANSPORT-1's redirect mode. `'manual'` yields the raw 3xx — status, `Location`, body — on every
 * runtime this package is tested against (Node and Bun, both `undici`-backed).
 *
 * On a **browser** the same value yields an *opaque-redirect* filtered response instead: status `0`,
 * no headers, a null body. The redirect is still not followed, so TRANSPORT-1 holds, but the
 * pipeline above has nothing to redirect *with*. `@dexpace/transport-fetch` is therefore Node/Bun in
 * practice even though its dependency list would run anywhere; a browser build needs a redirect
 * strategy that does not depend on reading `Location` off the 3xx.
 */
const REDIRECT_MODE = 'manual' as const;

/**
 * TRANSPORT-11's outbound drop set for this transport.
 *
 * `connection` is in it because WHATWG `fetch` treats it as a forbidden request header and would
 * strip it silently — dropping it here makes the removal observable through the drop log instead.
 *
 * `expect`, `keep-alive` and `upgrade` are in it because the *implementations* do not honour the
 * WHATWG forbidden-header list at all. Node's global `fetch` is undici-backed and undici's `Headers`
 * deliberately does not implement forbidden names in a non-browser environment, so the three reach
 * `lib/core/request.js:398,409` and reject the dispatch; `fetch()` then rejects with a bare
 * `TypeError: fetch failed`, which this transport can only classify as the **retryable**
 * `TransportFailureError` — a permanent misconfiguration that spends the caller's whole retry budget
 * re-proving itself. Bun 1.3.14 diverges again: it forwards `expect` and `keep-alive` to the wire
 * and hangs indefinitely on `upgrade`. Measured on both, 2026-09-05, audit #67 / #81. Neither
 * outcome is TRANSPORT-12's, and a name in the drop set is the one behaviour that is.
 */
const FETCH_FORBIDDEN_HEADERS = [
  'content-length',
  'host',
  'transfer-encoding',
  'connection',
  'expect',
  'keep-alive',
  'upgrade',
] as const;

/**
 * Bodies at or below this declared length are materialized into one `Uint8Array` instead of streamed,
 * which sidesteps the `duplex: 'half'` corner cases some `fetch` implementations still have. An
 * explicit named bound, per the styleguide's "every buffer declares its bound" rule.
 */
const MAX_MATERIALIZED_BODY_BYTES = 1_000_000;

/**
 * Options for {@link fetchTransport}.
 *
 * There is deliberately **no** `proxy` option: Node's bare global `fetch` exposes no proxy hook that
 * does not route through `undici` internals, and depending on `undici` would undo this package's
 * entire reason to exist. The absence is the contract — reach for `@dexpace/transport-undici` when
 * you need proxying (TRANSPORT-30, scoped out; design doc §6).
 *
 * @public
 */
export interface FetchTransportOptions {
  /** How dropped header names are logged (TRANSPORT-13); defaults to `'first-per-name'`. */
  readonly headerDropLogging?: HeaderDropLogging;
  /** A timeout applied to every call that supplies no `RequestOptions.timeoutMs` of its own. */
  readonly defaultTimeoutMs?: number;
  /** A custom `fetch` implementation; defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
}

/**
 * The narrow slice of `fetch` this transport calls. Deliberately not `typeof globalThis.fetch`: some
 * runtimes hang extra statics off that value (Bun's `fetch.preconnect`), and requiring them would
 * reject every reasonable test double while adding nothing this transport uses.
 *
 * @public
 */
export type FetchLike = (
  input: string,
  init: RequestInit & {duplex?: 'half'},
) => Promise<globalThis.Response>;

/** A request body prepared for one `fetch` call, plus the teardown its producer may still need. */
interface PreparedBody {
  /** What to hand `RequestInit.body`, or `undefined` for a body-less request. */
  readonly init: BodyInit | undefined;
  /** `'half'` when `init` is a stream, which `fetch` requires be declared explicitly. */
  readonly duplex: 'half' | undefined;
  /** Settles when the streaming producer finishes; `undefined` for the buffered/no-body cases. */
  readonly done: Promise<void> | undefined;
  /** Idempotent teardown for an abandoned producer (TRANSPORT-19); resolves once it has unwound. */
  abandon(cause: unknown): Promise<void>;
}

const NO_BODY: PreparedBody = {
  init: undefined,
  duplex: undefined,
  done: undefined,
  abandon: () => Promise.resolve(),
};

async function prepareBody(body: Body | undefined): Promise<PreparedBody> {
  if (body === undefined) return NO_BODY;
  if (isMaterializable(body, MAX_MATERIALIZED_BODY_BYTES)) {
    try {
      return {...NO_BODY, init: await materializeBody(body)};
    } catch (error) {
      // Same classification the streaming branch gives the same failure: a body that could not be
      // produced is a transport failure with its cause intact, not a raw body error on one path and
      // a wrapped one on the other (TRANSPORT-18's buffering clause, restated).
      throw new TransportFailureError('request body could not be written', {
        cause: error,
      });
    }
  }
  const pump = pumpBody(body);
  return {
    init: pump.readable,
    duplex: 'half',
    done: pump.done,
    abandon: cause => pump.abandon(cause),
  };
}

/** One entry per VALUE, so a repeated name survives as repeated appends (HTTP-14). */
function toNativeHeaders(
  request: Request,
  logDrops: (dropped: readonly string[]) => void,
): globalThis.Headers {
  const {sent, dropped} = mapOutboundHeaders(
    request.headers,
    FETCH_FORBIDDEN_HEADERS,
    {bodyDerivedMediaType: request.body?.mediaType},
  );
  logDrops(dropped);

  const native = new globalThis.Headers();
  for (const [name, value] of sent.entries()) {
    try {
      native.append(name, value);
    } catch {
      // TRANSPORT-12: a name the WHATWG layer rejects degrades to a drop, never a failed send.
      logDrops([name]);
    }
  }
  return native;
}

function adaptResponse(
  request: Request,
  fetchResponse: globalThis.Response,
  logDrops: (dropped: readonly string[]) => void,
): Response {
  const raw: [string, string][] = [];
  fetchResponse.headers.forEach((value, name) => {
    // Set-Cookie is the one name WHATWG keeps un-joined; every other name arrives comma-joined.
    if (name.toLowerCase() !== 'set-cookie') raw.push([name, value]);
  });
  for (const cookie of fetchResponse.headers.getSetCookie()) {
    raw.push(['set-cookie', cookie]);
  }

  const {headers, dropped} = degradeInboundHeaders(raw);
  logDrops(dropped);

  return (
    Response.newBuilder()
      .request(request)
      // A documented best-effort default, not an observed value: the WHATWG `Response` exposes no
      // negotiated-HTTP-version field for this transport to read (Deviation Ledger).
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(fetchResponse.status))
      .reasonPhrase(fetchResponse.statusText || undefined)
      .headers(headers)
      // Decided here, not inherited from the runtime. Node's `fetch` returns `null` for 204, 304
      // and HEAD as the spec requires, and Bun 1.3.14's returns a live `ReadableStream` for all
      // three (measured 2026-09-05) -- so forwarding `fetchResponse.body` made the SHAPE of a
      // body-less response a property of the runtime rather than of this SDK. `#exchange` releases
      // whatever handle this declines (audit #67 / #82).
      .body(
        hasNoResponseBody(request.method, fetchResponse.status)
          ? null
          : fetchResponse.body,
      )
      .build()
  );
}

/** Everything one dispatch needs beyond the request itself; keeps `max-params` at three. */
interface DispatchPlan {
  readonly headers: globalThis.Headers;
  readonly prepared: PreparedBody;
  /** The forked signal handed to `fetch`; detached by `send` the moment the response is delivered. */
  readonly fork: ForkedSignal;
}

class FetchTransport implements Transport {
  readonly #logDrops: (dropped: readonly string[]) => void;
  readonly #fetch: FetchLike;
  readonly #defaultTimeoutMs: number | undefined;

  constructor(options: FetchTransportOptions) {
    this.#logDrops = createDropLogger(
      options.headerDropLogging ?? 'first-per-name',
    );
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#defaultTimeoutMs = options.defaultTimeoutMs;
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

    // Dispatched with a fork the caller cannot reach: cancellation stays live for the whole in-flight
    // window and goes inert the moment the response is handed over (SEAM-16).
    const plan: DispatchPlan = {
      headers: toNativeHeaders(request, this.#logDrops),
      prepared: await prepareBody(request.body),
      fork: forkSignal(composed),
    };
    try {
      return await this.#exchange(request, plan, composed);
    } finally {
      plan.fork.detach();
    }
  }

  async #exchange(
    request: Request,
    plan: DispatchPlan,
    composed: AbortSignal | undefined,
  ): Promise<Response> {
    const fetchResponse = await this.#dispatch(request, plan);

    if (composed?.aborted) {
      // TRANSPORT-9 / SEAM-30: this response will never reach a caller, so this producer closes it.
      await fetchResponse.body?.cancel().catch(() => undefined);
      await plan.prepared.abandon(composed.reason);
      throw abortToSdkError(composed, composed.reason);
    }

    try {
      // TRANSPORT-22: a live socket is in hand, so any throw here must release it before propagating.
      const response = adaptResponse(request, fetchResponse, this.#logDrops);
      if (response.body === null && fetchResponse.body !== null) {
        // A runtime handed a body for a response that cannot have one. Nothing references it any
        // more, so releasing it is this transport's, not the caller's (TRANSPORT-25, SEAM-30).
        await fetchResponse.body.cancel().catch(() => undefined);
      }
      return response;
    } catch (error) {
      await fetchResponse.body?.cancel().catch(() => undefined);
      // TRANSPORT-19: nothing is delivered on this path either, so the producer is owed its teardown
      // exactly as on the abort branch above.
      await plan.prepared.abandon(error);
      throw error;
    }
  }

  async #dispatch(
    request: Request,
    plan: DispatchPlan,
  ): Promise<globalThis.Response> {
    const {prepared} = plan;
    const {signal} = plan.fork;
    const init: RequestInit & {duplex?: 'half'} = {
      method: request.method,
      headers: plan.headers,
      // TRANSPORT-1: the pipeline, not the native client, is the redirect authority.
      redirect: REDIRECT_MODE,
    };
    if (prepared.init !== undefined) init.body = prepared.init;
    if (prepared.duplex !== undefined) init.duplex = prepared.duplex;
    init.signal = signal;

    try {
      // Raced, not sequenced: a producer failure must surface even while `fetch` is still pending,
      // and a producer that never resolves must not outlive the send (TRANSPORT-19).
      return await Promise.race([
        this.#fetch(request.url.href, init),
        producerFailure(prepared.done),
      ]);
    } catch (error) {
      // Read BEFORE the fork is pulled below, or every producer failure would look like a caller
      // abort and surface as a CancellationError.
      const abortedByCaller = signal.aborted;
      await prepared.abandon(error);
      if (abortedByCaller) throw abortToSdkError(signal, error);
      // TRANSPORT-9: when the producer lost the race, `fetch` is still pending. Nothing awaits it
      // any more, so a response that arrives later would be dropped with its body neither read nor
      // cancelled -- a leaked connection for as long as the pool keeps it. Pulling the fork takes
      // the native call down instead. On the path where `fetch` itself rejected there is nothing
      // left to cancel and this is inert (audit #67 / #82).
      plan.fork.abort(error);
      // TRANSPORT-20 versus RETRY-2, decided by the table in `@dexpace/transport-shared` rather
      // than here: until audit #67 / #82 every native rejection became `TransportFailureError`,
      // which `classify.ts` reports retryable for being an `IoError`, so an `ftp://` URL or a
      // `CONNECT` method spent the caller's whole retry budget re-proving a permanent
      // misconfiguration. The undici twin already refused those; the two must not disagree.
      throw toDispatchFailure(error, 'fetch failed');
    }
  }

  /**
   * Resolves immediately: the global `fetch` owns no resource this package created, so there is
   * nothing to release (SEAM-14). `send()` therefore keeps working after `close()` — the documented
   * post-close mode this transport picks under SEAM-15.
   *
   * @returns a promise that resolves once teardown is complete, which is immediately.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}

// Single teardown path for `await using`, delegating to `FetchTransport.close()` and installed at run
// time only when the symbol exists — the same guarded shape `SseStream` and `Page` use.
//
// DO NOT restore this as a plain `[Symbol.asyncDispose]()` class member. Node 20.3 is this package's
// declared floor (`engines.node`, checked by verify:runtime-floor) and predates the symbol, which
// arrived in 20.4. On the floor the computed key evaluates to `undefined` and binds the method to the
// string key `"undefined"` — a junk prototype entry, and no working disposal. Declaring it on the
// class would also emit it into the `.d.ts` unconditionally, promising consumers on the floor a method
// that is not there.
if (typeof Symbol.asyncDispose === 'symbol') {
  Object.defineProperty(FetchTransport.prototype, Symbol.asyncDispose, {
    value: function asyncDispose(this: FetchTransport): Promise<void> {
      return this.close();
    },
    writable: true,
    configurable: true,
  });
}

/**
 * Creates a `Transport` backed by the standard global `fetch` — the zero-dependency option.
 *
 * `close()` is a sanctioned no-op and `send()` keeps working after it (SEAM-15). There is no proxy
 * support at all; see {@link FetchTransportOptions}.
 *
 * `close()` is the single teardown path `docs/knowledge/harvested/resource-management.md` asks for. A
 * `[Symbol.asyncDispose]` delegating to it is installed at run time **when the runtime has the
 * symbol**, which this package's declared floor (`engines.node >=20.3`) does not — it arrived in Node
 * 20.4. The return type therefore does not promise `AsyncDisposable`: claiming it would type-check
 * `await using` for a consumer sitting on the floor, where the method is genuinely absent. Call
 * `close()`, or raise your own floor to 20.4+ and reach the symbol through a cast.
 *
 * @param options - optional transport settings.
 * @returns a transport ready to send; release it with `close()`.
 *
 * @public
 */
export function fetchTransport(options: FetchTransportOptions = {}): Transport {
  return new FetchTransport(options);
}
