// SPDX-License-Identifier: MIT
// packages/core/src/body/typed-response.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';

/**
 * A typed view over an HTTP response (HTTP-44). Wraps an underlying raw Response and a parser function,
 * materializing and parsing the response value lazily on the first call to `value()`.
 *
 * Deliberately does NOT expose the underlying `Response` itself (only its status/headers/protocol/
 * reason/request, per HTTP-44) -- doing so would let a caller read the single-use body directly,
 * bypassing `value()`'s memoization and the HTTP-45 in-flight-promise serialization entirely.
 *
 * @public
 */
export class TypedResponse<T> {
  readonly #response: Response;
  readonly #parse: (response: Response) => Promise<T>;
  #memoized: Promise<T> | undefined;

  constructor(response: Response, parse: (response: Response) => Promise<T>) {
    this.#response = response;
    this.#parse = parse;
  }

  get status(): Response['status'] {
    return this.#response.status;
  }

  get headers(): Response['headers'] {
    return this.#response.headers;
  }

  get protocol(): string {
    return this.#response.protocol.token; // lower-case token string (Protocol.token)
  }

  get reason(): string | undefined {
    return this.#response.reasonPhrase;
  }

  /** The originating request (HTTP-44). Accessing raw fields never consumes the body. */
  get request(): Request {
    return this.#response.request;
  }

  /**
   * Lazily parses and returns the typed value. Memoized: the parser function runs at most once, and
   * subsequent calls return the same parsed value (or re-throw the same error) without re-parsing or
   * re-reading the body (HTTP-44). Concurrent first callers share the single in-flight parse (HTTP-45).
   */
  value(): Promise<T> {
    this.#memoized ??= this.#parse(this.#response);
    return this.#memoized;
  }
}
