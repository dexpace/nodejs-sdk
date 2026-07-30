// SPDX-License-Identifier: MIT
// packages/core/src/http/response.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import type {Request} from './request.js';
import type {Protocol} from './protocol.js';
import type {Status} from './status.js';
import {Headers} from './headers.js';

// eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-6
let createResponse: (
  request: Request,
  protocol: Protocol,
  status: Status,
  reasonPhrase: string | undefined,
  headers: Headers,
  body: unknown,
) => Response;

/**
 * An immutable HTTP response: the originating request, the negotiated protocol, the status, an
 * optional reason phrase, headers, and an optional body (HTTP-6).
 *
 * Status-range classification is reached through {@link Response.status} — `response.status.isSuccess`,
 * `response.status.isError`, and the rest (HTTP-11).
 *
 * @public
 */
export class Response {
  readonly #request: Request;
  readonly #protocol: Protocol;
  readonly #status: Status;
  readonly #reasonPhrase: string | undefined;
  readonly #headers: Headers;
  readonly #body: unknown;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  private constructor(
    request: Request,
    protocol: Protocol,
    status: Status,
    reasonPhrase: string | undefined,
    headers: Headers,
    body: unknown,
  ) {
    this.#request = request;
    this.#protocol = protocol;
    this.#status = status;
    this.#reasonPhrase = reasonPhrase;
    this.#headers = headers;
    this.#body = body;
    Object.freeze(this);
  }

  static {
    // eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-6
    createResponse = (request, protocol, status, reasonPhrase, headers, body) =>
      new Response(request, protocol, status, reasonPhrase, headers, body);
  }

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link ResponseBuilder}.
   */
  static newBuilder(): ResponseBuilder {
    return new ResponseBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance (HTTP-3).
   *
   * Every field it carries is itself immutable — `Request` freezes and defensively clones its URL,
   * and `Headers`, `Status`, and `Protocol` are frozen values — so sharing them cannot leak
   * mutability back into either instance.
   *
   * @returns a {@link ResponseBuilder} holding this response's state.
   */
  newBuilder(): ResponseBuilder {
    return new ResponseBuilder()
      .request(this.#request)
      .protocol(this.#protocol)
      .status(this.#status)
      .reasonPhrase(this.#reasonPhrase)
      .headers(this.#headers)
      .body(this.#body);
  }

  /** The request this response was produced for. */
  get request(): Request {
    return this.#request;
  }

  /** The negotiated protocol version. */
  get protocol(): Protocol {
    return this.#protocol;
  }

  /** The response status, which also carries the range classification (HTTP-11). */
  get status(): Status {
    return this.#status;
  }

  /** The reason phrase as sent, or `undefined` when the transport supplied none. */
  get reasonPhrase(): string | undefined {
    return this.#reasonPhrase;
  }

  /** The response headers — never null, possibly empty. */
  get headers(): Headers {
    return this.#headers;
  }

  /**
   * The response body, or `undefined` when absent. Typed `unknown` until the body lifecycle lands
   * in a later phase.
   */
  get body(): unknown {
    return this.#body;
  }
}

/**
 * Accumulates response state and produces an immutable {@link Response}.
 *
 * @public
 */
export class ResponseBuilder implements Builder<Response> {
  #request: Request | undefined;
  #protocol: Protocol | undefined;
  #status: Status | undefined;
  #reasonPhrase: string | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: unknown;

  /**
   * Sets the originating request. Required.
   *
   * @param request - the request this response answers.
   * @returns this builder, for chaining.
   */
  request(request: Request): this {
    this.#request = request;
    return this;
  }

  /**
   * Sets the negotiated protocol. Required.
   *
   * @param protocol - the protocol the exchange used.
   * @returns this builder, for chaining.
   */
  protocol(protocol: Protocol): this {
    this.#protocol = protocol;
    return this;
  }

  /**
   * Sets the response status. Required.
   *
   * @param status - the status received.
   * @returns this builder, for chaining.
   */
  status(status: Status): this {
    this.#status = status;
    return this;
  }

  /**
   * Sets the reason phrase.
   *
   * @param reasonPhrase - the phrase as sent, or `undefined` when there was none.
   * @returns this builder, for chaining.
   */
  reasonPhrase(reasonPhrase: string | undefined): this {
    this.#reasonPhrase = reasonPhrase;
    return this;
  }

  /**
   * Sets the response headers, replacing whatever was set before.
   *
   * @param headers - the headers received; already immutable, so held by reference.
   * @returns this builder, for chaining.
   */
  headers(headers: Headers): this {
    this.#headers = headers;
    return this;
  }

  /**
   * Sets the response body.
   *
   * @param body - the body, or `undefined` when absent.
   * @returns this builder, for chaining.
   */
  body(body: unknown): this {
    this.#body = body;
    return this;
  }

  /**
   * Validates the required fields and constructs the response.
   *
   * @returns the frozen response.
   * @throws {@link RequiredFieldError} when the request, protocol, or status was never set,
   * naming whichever is missing (HTTP-4).
   */
  build(): Response {
    const request = requireField(this.#request, 'request');
    const protocol = requireField(this.#protocol, 'protocol');
    const status = requireField(this.#status, 'status');
    return createResponse(
      request,
      protocol,
      status,
      this.#reasonPhrase,
      this.#headers,
      this.#body,
    );
  }
}
