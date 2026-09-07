// SPDX-License-Identifier: MIT
// examples/petstore/src/service-core.ts
/**
 * The executor tier a generated client delegates to.
 *
 * **This file is finding 1 — it is the payload of the spike.** Nothing in `@dexpace/core` exports
 * an object with `execute` / `executeRequest` / `paginate` / `events` plus ownership-aware close,
 * so every service SDK would write this. It turns out to be thin, and the reason it is thin is
 * worth stating: `Runtime` implements `Transport`, so the pipeline drops straight into `Paginator`,
 * into `sseStreamFrom`, and into a plain `send()` with no adapter between them.
 *
 * What is NOT thin, and is the actual finding, is everything the executor has to decide that core
 * does not:
 *
 * - **Auth tier precedence** ({@link requestOptions}). Core's `AuthTiers` is
 *   `perCall ?? operation ?? client`, resolved inside `authStep`. Only `perCall` and `client` have
 *   a source; `RequestOptions.auth` fills `perCall` and the step's own settings fill `client`. So
 *   an operation's declared descriptor has to be folded into the `perCall` slot HERE, and the
 *   `call.auth ?? operation.auth` precedence — the top two-thirds of AUTH-4's chain — is
 *   reimplemented in this file. See FINDINGS.md, finding 4.
 * - **Status-to-error mapping** ({@link ServiceCore.execute}). Core produces one class; the map is
 *   applied on the way out. See finding 2.
 * - **Which failures reach a stream** ({@link ServiceCore.events}). `sseStreamFrom` does not look
 *   at the status, so a 404 would be parsed as an event stream unless the executor checks first.
 *
 * And one thing that is genuinely free: **ownership**. `Runtime.close()` is a documented no-op that
 * never touches its terminal transport (PIPE-27), so "borrowed" needs no bookkeeping — the executor
 * closes only what it built itself.
 */
import {
  DexpaceError,
  Paginator,
  RequestOptions,
  buildRequest,
  decodeSuccessResponse,
  sseStreamFrom,
  standardResilience,
  toHttpError,
  typedSseStream,
} from '@dexpace/core';
import type {
  AuthDescriptor,
  DecodeTarget,
  PaginationStrategy,
  Request,
  Response,
  Runtime,
  Serde,
  SseMapper,
  SseStream,
  StandardResilienceOptions,
  Transport,
} from '@dexpace/core';
import {assemble, type Operation, type OperationInput} from './operation.js';
import {remapStatusError, type StatusErrorMap} from './errors.js';

/** Per-call overrides every entry point accepts. */
export interface CallOptions {
  /** AUTH-4's `perCall` tier. Beats the operation's own descriptor, which beats the client default. */
  readonly auth?: AuthDescriptor | undefined;
  /** Per-call timeout, threaded through `RequestOptions`. */
  readonly timeoutMs?: number | undefined;
  /** Per-call retry cap, threaded through `RequestOptions`. */
  readonly maxRetries?: number | undefined;
  /** Cancellation for this call. */
  readonly signal?: AbortSignal | undefined;
}

/** {@link ServiceCore.execute} and {@link ServiceCore.executeRequest}: what to decode into. */
export interface ExecuteOptions<T> extends CallOptions {
  /** The runtime type witness plus its diagnostic label. */
  readonly responseType: DecodeTarget<T>;
}

/** {@link ServiceCore.paginate}: which strategy walks the collection, and how far. */
export interface PaginateOptions<T> extends CallOptions {
  readonly strategy: PaginationStrategy<T>;
  /** Maximum page exchanges; unbounded when omitted. */
  readonly maxPages?: number | undefined;
}

/** {@link ServiceCore.events}: how each SSE frame becomes a model. */
export interface EventsOptions<T> extends CallOptions {
  readonly mapper: SseMapper<T>;
}

/** Everything a {@link ServiceCore} is built from. */
export interface ServiceCoreInit {
  /** The absolute base URL every operation is projected onto. */
  readonly baseUrl: string | URL;
  /**
   * A terminal transport the core OWNS: it is wrapped in `standardResilience()` and closed by
   * {@link ServiceCore.close}. Mutually exclusive with `runtime`.
   */
  readonly transport?: Transport | undefined;
  /**
   * An already-assembled pipeline the core BORROWS: used as-is and never closed. Mutually exclusive
   * with `transport`.
   */
  readonly runtime?: Runtime | undefined;
  /** Pillar overrides, applied only on the owned-transport path where the preset is built here. */
  readonly resilience?: StandardResilienceOptions | undefined;
  /** The wire codec. Required: core owns none (SEAM-1), so the executor has to be told. */
  readonly serde: Serde;
  /** The declarative status-to-error table; omitted leaves `HttpStatusError` unmapped. */
  readonly errors?: StatusErrorMap | undefined;
}

/**
 * Carry the two auth tiers into `RequestOptions`, each in its own slot.
 *
 * This used to read `const auth = call.auth ?? operation?.auth`, which reimplemented the top
 * two-thirds of AUTH-4's precedence chain in consumer code and left core unable to tell a genuine
 * per-call override from an operation's declared requirement. `RequestOptions.operationAuth` landed
 * 2026-09-04 (`docs/work/mvp/2026-09-04-open-items-dissolution.md` W1) and the fold is gone: core resolves
 * `perCall ?? operation ?? client` itself, all three tiers distinguishable.
 *
 * Returning `undefined` when there is nothing to say still matters: an empty `RequestOptions` would
 * still occupy the `perCall` slot as "no descriptor", and the point of the chain is that an ABSENT
 * tier falls through while a PRESENT one does not.
 */
function requestOptions(
  operation: Operation | undefined,
  call: CallOptions,
): RequestOptions | undefined {
  if (
    call.auth === undefined &&
    operation?.auth === undefined &&
    call.timeoutMs === undefined &&
    call.maxRetries === undefined
  ) {
    return undefined;
  }
  return RequestOptions.newBuilder()
    .auth(call.auth)
    .operationAuth(operation?.auth)
    .timeoutMs(call.timeoutMs)
    .maxRetries(call.maxRetries)
    .build();
}

/** The shared executor every generated facade method delegates to. */
export class ServiceCore {
  readonly #baseUrl: string | URL;
  readonly #runtime: Runtime;
  readonly #ownedTransport: Transport | undefined;
  readonly #serde: Serde;
  readonly #errors: StatusErrorMap | undefined;

  constructor(init: ServiceCoreInit) {
    const {transport, runtime} = init;
    this.#baseUrl = init.baseUrl;
    this.#serde = init.serde;
    this.#errors = init.errors;
    if (transport !== undefined && runtime === undefined) {
      this.#runtime = standardResilience(transport, init.resilience);
      this.#ownedTransport = transport;
    } else if (runtime !== undefined && transport === undefined) {
      this.#runtime = runtime;
      this.#ownedTransport = undefined;
    } else {
      throw new TypeError(
        'ServiceCore takes exactly one of `transport` (owned) or `runtime` (borrowed)',
      );
    }
  }

  /** The pipeline every call goes through — owned or borrowed alike. */
  get runtime(): Runtime {
    return this.#runtime;
  }

  /** Assemble, send, and decode a 2xx into `T`; map a failure status through the error table. */
  async execute<T>(
    operation: Operation,
    input: OperationInput,
    call: ExecuteOptions<T>,
  ): Promise<T> {
    const response = await this.dispatch(operation, input, call);
    return this.#decode(response, call.responseType);
  }

  /** The same, for a request a caller already built — an escape hatch out of the operation table. */
  async executeRequest<T>(
    request: Request,
    call: ExecuteOptions<T>,
  ): Promise<T> {
    const response = await this.#runtime.send(
      request,
      requestOptions(undefined, call),
      call.signal,
    );
    return this.#decode(response, call.responseType);
  }

  /** Assemble and send, with no decode: the raw response, still open, still the caller's to close. */
  dispatch(
    operation: Operation,
    input: OperationInput,
    call: CallOptions = {},
  ): Promise<Response> {
    const request = buildRequest(this.#baseUrl, assemble(operation, input));
    return this.#runtime.send(
      request,
      requestOptions(operation, call),
      call.signal,
    );
  }

  /**
   * A lazy walk over a paginated collection.
   *
   * Nothing is sent until the returned paginator is iterated (PAGE-6), so this method is
   * synchronous and the generated facade needs no `await`.
   */
  paginate<T>(
    operation: Operation,
    input: OperationInput,
    paging: PaginateOptions<T>,
  ): Paginator<T> {
    return new Paginator<T>({
      transport: this.#runtime,
      initialRequest: buildRequest(this.#baseUrl, assemble(operation, input)),
      strategy: paging.strategy,
      maxPages: paging.maxPages,
      options: requestOptions(operation, paging),
      signal: paging.signal,
    });
  }

  /**
   * A lazy stream of mapped SSE events.
   *
   * Lazy for the same reason `paginate` is: the request is sent on the first pull, so the facade
   * method stays synchronous. The status check runs before the parser ever sees a byte.
   */
  events<T>(
    operation: Operation,
    input: OperationInput,
    streaming: EventsOptions<T>,
  ): AsyncIterable<T> {
    const open = async (): Promise<SseStream> => {
      const response = await this.dispatch(operation, input, streaming);
      await this.#failOnErrorStatus(response);
      return sseStreamFrom(response, {signal: streaming.signal});
    };
    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<T> {
        yield* typedSseStream(await open(), streaming.mapper);
      },
    };
  }

  /**
   * Release what this core created, and nothing else.
   *
   * An OWNED transport is closed. A BORROWED runtime is left alone — and so is the transport
   * underneath it, which `Runtime.close()` would not have touched anyway (PIPE-27).
   */
  async close(): Promise<void> {
    if (this.#ownedTransport !== undefined) {
      await this.#ownedTransport.close();
    }
  }

  async #decode<T>(response: Response, target: DecodeTarget<T>): Promise<T> {
    try {
      return await decodeSuccessResponse(
        response,
        this.#serde.deserializer,
        target,
      );
    } catch (error: unknown) {
      throw remapStatusError(error, this.#errors);
    }
  }

  /**
   * Turn a non-2xx into the mapped typed error before any streaming reader is built.
   *
   * `toHttpError` covers 4xx/5xx and returns `null` for anything else, so an unfollowed 3xx or a
   * 1xx lands in the second branch — closed, then reported as itself rather than being handed to
   * an SSE parser that would read it as a malformed event stream.
   */
  async #failOnErrorStatus(response: Response): Promise<void> {
    if (response.status.isSuccess) return;
    const failure = await toHttpError(response);
    if (failure !== null) throw remapStatusError(failure, this.#errors);
    await response.close();
    throw new DexpaceError(
      `response status ${String(response.status.code)} is neither a success nor an error status`,
    );
  }
}
