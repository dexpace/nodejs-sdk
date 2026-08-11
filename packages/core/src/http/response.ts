// SPDX-License-Identifier: MIT
// packages/core/src/http/response.ts
import type {Builder} from './builder.js';
import {requireField} from './builder.js';
import {Headers} from './headers.js';
import {MediaType} from './media-type.js';
import type {Protocol} from './protocol.js';
import type {Request} from './request.js';
import type {Status} from './status.js';

/**
 * An HTTP response model (HTTP-6).
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
  #closed = false;

  // eslint-disable-next-line max-params -- private, builder-internal; field count fixed by the wire model (HTTP-6)
  constructor(
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

  static newBuilder(): ResponseBuilder {
    return new ResponseBuilder();
  }

  newBuilder(): ResponseBuilder {
    return new ResponseBuilder()
      .request(this.#request)
      .protocol(this.#protocol)
      .status(this.#status)
      .reasonPhrase(this.#reasonPhrase)
      .headers(this.#headers)
      .body(this.#body);
  }

  get request(): Request {
    return this.#request;
  }

  get protocol(): Protocol {
    return this.#protocol;
  }

  get status(): Status {
    return this.#status;
  }

  get reasonPhrase(): string | undefined {
    return this.#reasonPhrase;
  }

  get headers(): Headers {
    return this.#headers;
  }

  /** Single-use (BODY-14) -- the same reference every call, never a replay. */
  get body(): ReadableStream<Uint8Array> | null {
    return this.#body;
  }

  /** Reads the whole body as bytes, closing the response whether or not the read succeeds (BODY-16). */
  async bytes(): Promise<Uint8Array> {
    if (this.#body === null) {
      await this.close();
      return new Uint8Array(0);
    }
    const reader = this.#body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
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
      reader.releaseLock();
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

  /** Reads the whole body as text, defaulting to the media type's charset then UTF-8 (HTTP-42). */
  async text(): Promise<string> {
    const bytes = await this.bytes();
    try {
      return new TextDecoder(this.#charset()).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes); // HTTP-42: unrecognized charset also falls back
    }
  }

  #charset(): string {
    const contentType = this.#headers.get('content-type');
    if (contentType === undefined) return 'utf-8';
    try {
      return MediaType.parse(contentType).charset ?? 'utf-8';
    } catch {
      return 'utf-8';
    }
  }

  /** Idempotent; releases the underlying connection whether or not the body was read (BODY-15, HTTP-43). */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#body === null) return;
    // BODY-15 forbids assuming the body was read, so an external consumer may still hold the reader
    // lock -- cancel() rejects with TypeError in that case. Swallow only that: the caller asked to
    // release the connection, and the lock holder's own close will finish the job.
    await this.#body.cancel().catch((error: unknown) => {
      if (!(error instanceof TypeError)) throw error;
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}

/**
 * Builder for {@link Response}.
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

  request(request: Request): this {
    this.#request = request;
    return this;
  }

  protocol(protocol: Protocol): this {
    this.#protocol = protocol;
    return this;
  }

  status(status: Status): this {
    this.#status = status;
    return this;
  }

  reasonPhrase(reasonPhrase: string | undefined): this {
    this.#reasonPhrase = reasonPhrase;
    return this;
  }

  headers(headers: Headers): this {
    this.#headers = headers;
    return this;
  }

  body(body: ReadableStream<Uint8Array> | null): this {
    this.#body = body;
    return this;
  }

  build(): Response {
    const request = requireField(this.#request, 'request');
    const protocol = requireField(this.#protocol, 'protocol');
    const status = requireField(this.#status, 'status');
    return new Response(
      request,
      protocol,
      status,
      this.#reasonPhrase,
      this.#headers,
      this.#body,
    );
  }
}
