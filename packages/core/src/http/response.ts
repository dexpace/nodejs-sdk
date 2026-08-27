// SPDX-License-Identifier: MIT
// packages/core/src/http/response.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import {decodeBodyText, resolveCharset} from './charset.js';
import {Headers} from './headers.js';
import type {Protocol} from './protocol.js';
import type {Request} from './request.js';
import type {Status} from './status.js';

// eslint-disable-next-line max-params -- private, builder-internal plumbing; field count fixed by HTTP-6
let createResponse: (
  request: Request,
  protocol: Protocol,
  status: Status,
  reasonPhrase: string | undefined,
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
) => Response;

/**
 * An immutable HTTP response: the originating request, the negotiated protocol, the status, an
 * optional reason phrase, headers, and a single-use body stream (HTTP-6).
 *
 * Status-range classification is reached through {@link Response.status} — `response.status.isSuccess`,
 * `response.status.isError`, and the rest (HTTP-11).
 *
 * Owns the body's connection, released by {@link Response.close}. Teardown is `close()` only.
 * Revisit when a project-wide explicit resource management pass lands across all Phase 2/3a resource classes.
 *
 * @public
 */
export class Response {
  readonly #request: Request;
  readonly #protocol: Protocol;
  readonly #status: Status;
  readonly #reasonPhrase: string | undefined;
  readonly #headers: Headers;
  readonly #body: ReadableStream<Uint8Array> | null;
  // Not `readonly` -- Object.freeze(this) below only freezes normal properties, never #private fields,
  // so this can still track close state after construction (BODY-15, HTTP-43).
  #closing: Promise<void> | undefined;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  private constructor(
    request: Request,
    protocol: Protocol,
    status: Status,
    reasonPhrase: string | undefined,
    headers: Headers,
    body: ReadableStream<Uint8Array> | null,
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
    // TypeScript has no friend classes, so ResponseBuilder reaches the private constructor through this
    // module-scoped hook, assigned exactly once. HTTP-2: no public field-wise constructor may appear in
    // the emitted `.d.ts`, or a consumer can construct around build()'s required-field validation.
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
   * mutability back into either instance. The body stream is shared by reference, since it is
   * single-use by definition (BODY-14) and a copy would be a replay.
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

  /** Single-use (BODY-14) -- the same reference every call, never a replay. */
  get body(): ReadableStream<Uint8Array> | null {
    return this.#body;
  }

  /**
   * Reads the whole body as bytes, closing the response whether or not the read succeeds (BODY-16).
   *
   * @returns every byte of the body, or an empty array when there is no body.
   * @throws Whatever the body stream raises mid-read, and a `TypeError` when an external consumer
   * already holds the body's reader lock. The connection is released in every case.
   */
  async bytes(): Promise<Uint8Array> {
    if (this.#body === null) {
      await this.close();
      return new Uint8Array(0);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Acquired INSIDE the try. `getReader()` itself throws a TypeError when an external consumer
    // already holds the lock, and BODY-15 forbids assuming the body was never touched -- so acquiring
    // it above the try meant the one failure BODY-16's guarantee most needs to cover was the one that
    // skipped the close entirely, leaving the connection held.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      reader = this.#body.getReader();
      for (;;) {
        // Serial by necessity: each read depends on the previous one advancing the cursor.
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    } finally {
      // MUST precede close(): ReadableStream.cancel() rejects with TypeError on a locked stream, and
      // reading to done does NOT release the lock. Without this the finally replaces the read value
      // with a TypeError and bytes()/text() never succeed.
      reader?.releaseLock();
      await this.close();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  /**
   * Reads the whole body as text, closing the response the same way {@link Response.bytes} does.
   *
   * Decodes with the charset declared by `content-type`, falling back to UTF-8 when it is absent,
   * unparseable, or an unrecognized label (HTTP-42).
   *
   * @returns the decoded body, or the empty string when there is no body.
   * @throws Whatever {@link Response.bytes} throws, which this delegates to -- including the
   * `TypeError` an externally locked body produces. The connection is released in every case.
   */
  async text(): Promise<string> {
    const bytes = await this.bytes();
    return decodeBodyText(
      bytes,
      resolveCharset(this.#headers.get('content-type')),
    );
  }

  /**
   * Releases the underlying connection whether or not the body was ever read (BODY-15, HTTP-43).
   *
   * Idempotent, and safe to call while an external consumer still holds the body's reader lock.
   *
   * @throws Whatever cancelling the body stream raises, other than the `TypeError` a locked stream
   * reports — that one is expected here and swallowed.
   */
  async close(): Promise<void> {
    // Memoized rather than flag-guarded, the same shape BufferedSink.close settled on for IO-5/IO-41:
    // a `#closed = true` set before the await reports a FAILED release as success to every later caller,
    // over a connection that was never released. Handing every caller the same promise propagates the
    // failure on every path while still cancelling at most once.
    this.#closing ??= this.#release();
    return this.#closing;
  }

  async #release(): Promise<void> {
    if (this.#body === null) return;
    // BODY-15 forbids assuming the body was read, so an external consumer may still hold the reader
    // lock -- cancel() rejects with TypeError in that case. Swallow only that: the caller asked to
    // release the connection, and the lock holder's own close will finish the job.
    await this.#body.cancel().catch((error: unknown) => {
      if (!(error instanceof TypeError)) throw error;
    });
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
  #body: ReadableStream<Uint8Array> | null = null;

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
   * @param body - the single-use body stream, or `null` when the response carries none.
   * `null` rather than `undefined` here mirrors WHATWG `fetch`'s `Response.body` deliberately;
   * `Request.body` keeps the domain model's `undefined` convention.
   * @returns this builder, for chaining.
   */
  body(body: ReadableStream<Uint8Array> | null): this {
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
