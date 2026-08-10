// SPDX-License-Identifier: MIT
// packages/core/src/http/protocol.ts
import {ProtocolParseError} from './errors.js';

/**
 * A negotiated HTTP protocol version, held in its canonical lower-case wire form (HTTP-33).
 *
 * Frozen and value-comparable; obtain instances from the {@link Protocol.HTTP_1_1} /
 * {@link Protocol.HTTP_2} constants or from {@link Protocol.parse}.
 *
 * @public
 */
export class Protocol {
  readonly #token: string;

  private constructor(token: string) {
    this.#token = token;
    Object.freeze(this);
  }

  /** HTTP/1.1, canonical token `http/1.1`. */
  static readonly HTTP_1_1 = new Protocol('http/1.1');

  /** HTTP/2, canonical token `http/2`. */
  static readonly HTTP_2 = new Protocol('http/2');

  /**
   * Parses a protocol identifier case-insensitively and locale-invariantly, accepting the canonical
   * forms plus the `HTTP/2` and `HTTP/2.0` aliases (HTTP-33).
   *
   * @param raw - the identifier to parse; surrounding whitespace is ignored.
   * @returns the corresponding canonical constant.
   * @throws {@link ProtocolParseError} when the identifier is not a recognized HTTP version.
   */
  static parse(raw: string): Protocol {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'http/1.1') return Protocol.HTTP_1_1;
    if (normalized === 'http/2' || normalized === 'http/2.0')
      return Protocol.HTTP_2;
    throw new ProtocolParseError(`unrecognized protocol: ${raw}`);
  }

  /** The canonical lower-case wire token, e.g. `http/1.1`. */
  get token(): string {
    return this.#token;
  }

  /**
   * Compares by canonical token, so any accepted alias equals the constant it parses to.
   *
   * @param other - the protocol to compare against.
   * @returns `true` when both canonical tokens are equal.
   */
  equals(other: Protocol): boolean {
    return this.#token === other.#token;
  }
}
