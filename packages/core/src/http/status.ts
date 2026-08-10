// SPDX-License-Identifier: MIT
// packages/core/src/http/status.ts
/**
 * An HTTP response status code, with its canonical reason name when the code is recognized.
 *
 * A total function of the integer code: {@link Status.of} never throws, so a transport can surface a
 * vendor code (nginx 499, Cloudflare 520–526) faithfully instead of failing on it (HTTP-10).
 * Instances are frozen and compare by numeric code alone (HTTP-12).
 *
 * @example
 * ```ts
 * Status.of(200).name;        // 'OK'
 * Status.of(599).name;        // undefined
 * Status.of(599).isRecognized // false
 * ```
 *
 * @public
 */
export class Status {
  static readonly #known = new Map<number, Status>();

  readonly #code: number;
  readonly #name: string | undefined;

  private constructor(code: number, name: string | undefined) {
    this.#code = code;
    this.#name = name;
    Object.freeze(this);
  }

  static #register(code: number, name: string): void {
    Status.#known.set(code, new Status(code, name));
  }

  static {
    Status.#register(200, 'OK');
    Status.#register(201, 'Created');
    Status.#register(204, 'No Content');
    Status.#register(301, 'Moved Permanently');
    Status.#register(302, 'Found');
    Status.#register(304, 'Not Modified');
    Status.#register(400, 'Bad Request');
    Status.#register(401, 'Unauthorized');
    Status.#register(403, 'Forbidden');
    Status.#register(404, 'Not Found');
    Status.#register(409, 'Conflict');
    Status.#register(429, 'Too Many Requests');
    Status.#register(500, 'Internal Server Error');
    Status.#register(502, 'Bad Gateway');
    Status.#register(503, 'Service Unavailable');
  }

  /**
   * Maps any integer code to a `Status`, never throwing (HTTP-10).
   *
   * @param code - the numeric status code.
   * @returns the canonical named instance for a recognized code, otherwise a raw, unnamed instance
   * carrying that code.
   */
  static of(code: number): Status {
    return Status.#known.get(code) ?? new Status(code, undefined);
  }

  // HTTP-10's second clause verbatim: a lookup that returns absent for an unknown code, distinct from
  // the total-function `of`.
  /**
   * Looks up only the recognized codes, letting a caller distinguish them from vendor codes —
   * HTTP-10's second clause, deliberately distinct from the total {@link Status.of}.
   *
   * @param code - the numeric status code.
   * @returns the canonical instance, or `undefined` when the code is not recognized.
   */
  static recognized(code: number): Status | undefined {
    return Status.#known.get(code);
  }

  /** The numeric status code. */
  get code(): number {
    return this.#code;
  }

  /** The canonical reason name (`'OK'`, `'Not Found'`), or `undefined` for an unrecognized code. */
  get name(): string | undefined {
    return this.#name;
  }

  /** Whether this code is one the model recognizes and can name. */
  get isRecognized(): boolean {
    return this.#name !== undefined;
  }

  /** Whether the code is informational (100–199). */
  get isInformational(): boolean {
    return this.#code >= 100 && this.#code <= 199;
  }

  /** Whether the code is a success (200–299). */
  get isSuccess(): boolean {
    return this.#code >= 200 && this.#code <= 299;
  }

  /** Whether the code is a redirect (300–399). */
  get isRedirect(): boolean {
    return this.#code >= 300 && this.#code <= 399;
  }

  /** Whether the code is a client error (400–499). */
  get isClientError(): boolean {
    return this.#code >= 400 && this.#code <= 499;
  }

  /** Whether the code is a server error (500–599). */
  get isServerError(): boolean {
    return this.#code >= 500 && this.#code <= 599;
  }

  /** Whether the code is any error, client or server (400–599). */
  get isError(): boolean {
    return this.#code >= 400 && this.#code <= 599;
  }

  /**
   * Compares by numeric code only — the reason name never participates (HTTP-12).
   *
   * @param other - the status to compare against.
   * @returns `true` when both codes are equal.
   */
  equals(other: Status): boolean {
    return this.#code === other.#code;
  }
}
