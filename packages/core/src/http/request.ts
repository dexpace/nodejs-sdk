// SPDX-License-Identifier: MIT
// packages/core/src/http/request.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import {UrlConstructionError, RequestBodyNotAllowedError} from './errors.js';
import {type Method, isBodyForbidden} from './method.js';
import {Headers} from './headers.js';

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch (e: unknown) {
    throw new UrlConstructionError(`malformed or non-absolute URL: ${raw}`, {
      cause: e,
    });
  }
}

// eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-6
let createRequest: (
  method: Method,
  url: URL,
  headers: Headers,
  body: unknown,
) => Request;

/**
 * An immutable HTTP request: method, target URL, headers, and an optional body (HTTP-6).
 *
 * Operational knobs such as timeout and retries are deliberately *not* here — they are per-call
 * overrides that never reach the wire, and live in {@link RequestOptions} instead.
 *
 * Method/body legality is enforced at construction rather than deferred to a transport: a body on
 * GET, HEAD, TRACE, or CONNECT fails in `build()` (HTTP-7). Equality compares the URL by textual
 * external form only, so it never resolves DNS or performs any other blocking work (HTTP-46).
 *
 * @example
 * ```ts
 * const request = Request.newBuilder()
 *   .method('POST')
 *   .url('https://example.com/items')
 *   .body('payload')
 *   .build();
 * ```
 *
 * @public
 */
export class Request {
  readonly #method: Method;
  readonly #url: URL;
  readonly #headers: Headers;
  readonly #body: unknown;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  private constructor(
    method: Method,
    url: URL,
    headers: Headers,
    body: unknown,
  ) {
    this.#method = method;
    this.#url = url;
    this.#headers = headers;
    this.#body = body;
    Object.freeze(this);
  }

  static {
    // eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-6
    createRequest = (method, url, headers, body) =>
      new Request(method, url, headers, body);
  }

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link RequestBuilder}.
   */
  static newBuilder(): RequestBuilder {
    return new RequestBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance; the URL is copied, not aliased (HTTP-3).
   *
   * @returns a {@link RequestBuilder} holding a copy of this request's state.
   */
  newBuilder(): RequestBuilder {
    return new RequestBuilder()
      .method(this.#method)
      .url(this.#url)
      .headers(this.#headers)
      .body(this.#body);
  }

  /** The request method. */
  get method(): Method {
    return this.#method;
  }

  /**
   * The target URL.
   *
   * Returns a fresh `URL` on every access: the native `URL` is mutable, so handing out the stored
   * instance would let a caller mutate this otherwise-immutable request through it (HTTP-5).
   */
  get url(): URL {
    return new URL(this.#url.href);
  }

  /** The request headers — never null, possibly empty. Already frozen, so returned by reference. */
  get headers(): Headers {
    return this.#headers;
  }

  /**
   * The request body, or `undefined` when absent.
   *
   * Typed `unknown` on purpose: this phase only needs presence or absence to enforce HTTP-7/8. The
   * body lifecycle — streaming, replayability, charset — is owned by a later phase.
   */
  get body(): unknown {
    return this.#body;
  }

  /**
   * Compares method, URL, headers, and body.
   *
   * The URL is compared by textual external form only, never by resolving the host — native URL
   * equality on some platforms resolves DNS, which blocks and is wrong for virtual hosts sharing an
   * IP (HTTP-46). The body is compared by reference for now; value equality arrives with the real
   * body model in a later phase.
   *
   * @param other - the request to compare against.
   * @returns `true` when every compared facet is equal.
   */
  equals(other: Request): boolean {
    return (
      this.#method === other.#method &&
      this.#url.href === other.#url.href &&
      this.#headers.equals(other.#headers) &&
      this.#body === other.#body
    );
  }
}

/**
 * Accumulates request state and produces an immutable {@link Request}.
 *
 * @public
 */
export class RequestBuilder implements Builder<Request> {
  #method: Method | undefined;
  #url: URL | undefined;
  #headers: Headers = Headers.newBuilder().build();
  #body: unknown;

  /**
   * Sets the request method.
   *
   * @param method - the method to use.
   * @returns this builder, for chaining.
   */
  method(method: Method): this {
    this.#method = method;
    return this;
  }

  /**
   * Sets the target URL, parsing and copying it immediately so later mutation of a caller's `URL`
   * cannot reach the built request.
   *
   * @param url - an absolute URL, as a string or a `URL`.
   * @returns this builder, for chaining.
   * @throws {@link UrlConstructionError} when a string input is malformed or not absolute; the
   * message carries the offending input and chains the underlying failure as `cause` (HTTP-47).
   */
  url(url: string | URL): this {
    this.#url = url instanceof URL ? new URL(url.href) : parseUrl(url);
    return this;
  }

  /**
   * Sets the request headers, replacing whatever was set before.
   *
   * @param headers - the headers to send; already immutable, so held by reference.
   * @returns this builder, for chaining.
   */
  headers(headers: Headers): this {
    this.#headers = headers;
    return this;
  }

  /**
   * Sets or clears the request body.
   *
   * @param body - the body, or `null`/`undefined` to clear it. `null` normalizes to `undefined`:
   * HTTP-7 rejects only a *non-null* body, so passing `null` clears exactly like `undefined`.
   * @returns this builder, for chaining.
   */
  body(body: unknown): this {
    this.#body = body ?? undefined;
    return this;
  }

  /**
   * Validates required fields and method/body legality, then constructs the request.
   *
   * With no method set, defaults to GET only when no body is present; a body with no method fails
   * naming the missing method rather than defaulting to GET and then tripping the no-body rule
   * (HTTP-8).
   *
   * @returns the frozen request.
   * @throws {@link RequiredFieldError} when no URL was set, or when a body was set with no method.
   * @throws {@link RequestBodyNotAllowedError} when a body is present on GET, HEAD, TRACE, or
   * CONNECT (HTTP-7).
   */
  build(): Request {
    const url = requireField(this.#url, 'url');

    if (this.#method === undefined) {
      if (this.#body !== undefined) requireField(undefined, 'method');
      return createRequest('GET', url, this.#headers, this.#body);
    }

    if (this.#body !== undefined && isBodyForbidden(this.#method)) {
      throw new RequestBodyNotAllowedError(this.#method);
    }

    return createRequest(this.#method, url, this.#headers, this.#body);
  }
}
