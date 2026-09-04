// SPDX-License-Identifier: MIT
// packages/core/src/http/request-options.ts
import type {AuthDescriptor} from '../auth/descriptor.js';
import type {Builder} from './builder.js';
import {RequestOptionsValidationError} from './errors.js';

// eslint-disable-next-line max-params -- private, builder-internal plumbing; one parameter per HTTP-34 field
let createRequestOptions: (
  timeoutMs: number | undefined,
  maxRetries: number | undefined,
  tags: ReadonlyMap<string, string>,
  auth: AuthDescriptor | undefined,
  operationAuth: AuthDescriptor | undefined,
) => RequestOptions;

/**
 * Immutable per-call operational overrides that are deliberately *not* part of the wire form: a
 * timeout, a max-retries count, opaque string-keyed tags (HTTP-34), and a per-call auth descriptor
 * (AUTH-4).
 *
 * Every scalar field defaults to a "use the configured default" sentinel of `undefined`; tags default
 * to an empty map, which means the same thing. {@link RequestOptions.EMPTY} is the canonical
 * override-nothing instance.
 *
 * `undefined` and `0` are different states for max-retries: `undefined` means "use the default",
 * while `0` means "disable retries for this call" (HTTP-35).
 *
 * @public
 */
export class RequestOptions {
  readonly #timeoutMs: number | undefined;
  readonly #maxRetries: number | undefined;
  readonly #tags: ReadonlyMap<string, string>;
  readonly #auth: AuthDescriptor | undefined;
  readonly #operationAuth: AuthDescriptor | undefined;

  // eslint-disable-next-line max-params -- private, builder-internal; one parameter per HTTP-34 field
  private constructor(
    timeoutMs: number | undefined,
    maxRetries: number | undefined,
    tags: ReadonlyMap<string, string>,
    auth: AuthDescriptor | undefined,
    operationAuth: AuthDescriptor | undefined,
  ) {
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = maxRetries;
    this.#tags = tags;
    this.#auth = auth;
    this.#operationAuth = operationAuth;
    Object.freeze(this);
  }

  static {
    // eslint-disable-next-line max-params -- private, builder-internal plumbing; one parameter per HTTP-34 field
    createRequestOptions = (timeoutMs, maxRetries, tags, auth, operationAuth) =>
      new RequestOptions(timeoutMs, maxRetries, tags, auth, operationAuth);
  }

  /**
   * The canonical "override nothing" instance: no timeout, no retry override, no tags, and neither
   * auth descriptor.
   */
  static readonly EMPTY = new RequestOptions(
    undefined,
    undefined,
    Object.freeze(new Map()),
    undefined,
    undefined,
  );

  /**
   * Starts an empty builder.
   *
   * @returns a fresh {@link RequestOptionsBuilder} overriding nothing.
   */
  static newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder();
  }

  /**
   * Derives a builder pre-populated from this instance, copying the tag map rather than aliasing it
   * (HTTP-3).
   *
   * @returns a {@link RequestOptionsBuilder} holding a copy of these options.
   */
  newBuilder(): RequestOptionsBuilder {
    return new RequestOptionsBuilder()
      .timeoutMs(this.#timeoutMs)
      .maxRetries(this.#maxRetries)
      .tags(this.#tags)
      .auth(this.#auth)
      .operationAuth(this.#operationAuth);
  }

  /** The per-call timeout in milliseconds, or `undefined` to use the configured default. */
  get timeoutMs(): number | undefined {
    return this.#timeoutMs;
  }

  /**
   * The per-call retry ceiling, or `undefined` to use the configured default. A value of `0` means
   * retries are disabled for this call — distinct from `undefined`.
   */
  get maxRetries(): number | undefined {
    return this.#maxRetries;
  }

  /**
   * Looks up an opaque tag by key.
   *
   * @param key - the tag key, matched case-sensitively.
   * @returns the tag value, or `undefined` when unset.
   */
  tag(key: string): string | undefined {
    return this.#tags.get(key);
  }

  /**
   * The per-call auth descriptor, or `undefined` to use the configured tiers.
   *
   * Fills AUTH-4's most-specific `perCall` tier: when present it wins over any `perCall`, `operation`,
   * or `client` descriptor the AUTH pillar step was constructed with, and a tier below it is never
   * consulted even if this one turns out to be unsatisfiable.
   *
   * Returned by reference: an {@link AuthDescriptor} is frozen at construction, so there is nothing to
   * copy defensively.
   */
  get auth(): AuthDescriptor | undefined {
    return this.#auth;
  }

  /**
   * The operation's declared auth descriptor, or `undefined` when the operation declares none.
   *
   * Fills AUTH-4's middle `operation` tier. Selection is `perCall ?? operation ?? client`, so
   * {@link RequestOptions.auth} still wins over this, and this still wins over whatever descriptor
   * the AUTH pillar step was constructed with. A tier below the selected one is never consulted even
   * if the selected one turns out to be unsatisfiable.
   *
   * This slot exists for a generated client, not for a hand-written call: it is where an operation
   * table's static `auth` declaration goes, so the caller's genuine per-call override stays
   * distinguishable from it. Without it a generator has to fold the two together itself — which
   * reimplements this very precedence rule outside core and leaves core unable to tell which tier
   * won. `examples/petstore/FINDINGS.md` §4 measures that cost; `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1 records it.
   *
   * Returned by reference: an {@link AuthDescriptor} is frozen at construction, so there is nothing
   * to copy defensively.
   */
  get operationAuth(): AuthDescriptor | undefined {
    return this.#operationAuth;
  }
}

/**
 * Accumulates per-call overrides and produces an immutable {@link RequestOptions}.
 *
 * Range validation happens at each setter, not at `build()`, so a bad value fails at the call site
 * that supplied it.
 *
 * @public
 */
export class RequestOptionsBuilder implements Builder<RequestOptions> {
  #timeoutMs: number | undefined;
  #maxRetries: number | undefined;
  readonly #tags = new Map<string, string>();
  #auth: AuthDescriptor | undefined;
  #operationAuth: AuthDescriptor | undefined;

  /**
   * Sets the per-call timeout.
   *
   * The range check is the FULL range, not merely its lower bound. `Infinity` and `NaN` are as out
   * of range as `-1`: a non-finite deadline is one no clock can compare against, so it degrades to
   * "no deadline" silently rather than failing at the call site that supplied it, which is exactly
   * what HTTP-35 exists to prevent. Not required to be integral, unlike `maxRetries` -- a timeout is
   * a duration and a fractional millisecond is meaningful.
   *
   * @param value - the timeout in milliseconds, or `undefined` for no override. Zero is rejected
   * rather than reinterpreted: it means "no timeout" in one transport and is an error in another
   * (HTTP-35).
   * @returns this builder, for chaining.
   * @throws {@link RequestOptionsValidationError} when a defined value is zero, negative, or not
   * finite.
   */
  timeoutMs(value: number | undefined): this {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new RequestOptionsValidationError(
        `timeout must be a finite positive duration, got ${String(value)}`,
      );
    }
    this.#timeoutMs = value;
    return this;
  }

  /**
   * Sets the per-call retry ceiling.
   *
   * The range check is deliberately wider than "not negative". A retry ceiling is a count of wire
   * sends, so `Infinity` and `NaN` are as out-of-range as `-1` -- and they are worse in effect: a
   * negative value at least fails a downstream lower-bound guard, while a non-finite one makes a
   * retry driver's "have I reached the ceiling" test permanently false and its loop unbounded.
   * HTTP-35's point is that an out-of-range retry count is a loud error at the call site that
   * supplied it, never a value reinterpreted somewhere downstream.
   *
   * @param value - the maximum retries, or `undefined` for no override. `0` is accepted and means
   * "disable retries for this call"; anything that is not a non-negative integer is rejected rather
   * than silently reinterpreted (HTTP-35).
   * @returns this builder, for chaining.
   * @throws {@link RequestOptionsValidationError} when a defined value is negative, fractional, or
   * not finite.
   */
  maxRetries(value: number | undefined): this {
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
      throw new RequestOptionsValidationError(
        `maxRetries must be a non-negative integer, got ${String(value)}`,
      );
    }
    this.#maxRetries = value;
    return this;
  }

  /**
   * Merges opaque tags into the builder's own map, overwriting on key collision.
   *
   * @param entries - the tags to merge; read, never retained.
   * @returns this builder, for chaining.
   */
  tags(entries: ReadonlyMap<string, string>): this {
    for (const [key, value] of entries) this.#tags.set(key, value);
    return this;
  }

  /**
   * Sets the per-call auth descriptor, filling AUTH-4's `perCall` tier for this call only.
   *
   * No validation beyond the type: {@link createAuthDescriptor} already rejects an empty requirement
   * list and freezes the result (AUTH-3), so any constructed descriptor is valid by construction.
   *
   * @param descriptor - the descriptor, or `undefined` for no override.
   * @returns this builder, for chaining.
   */
  auth(descriptor: AuthDescriptor | undefined): this {
    this.#auth = descriptor;
    return this;
  }

  /**
   * Sets the operation's declared auth descriptor, filling AUTH-4's `operation` tier for this call.
   *
   * Independent of {@link RequestOptionsBuilder.auth}: filling both is the normal case for a
   * generated client whose caller also passed an override, and `perCall ?? operation ?? client`
   * resolves them. No validation beyond the type, for the same reason
   * {@link RequestOptionsBuilder.auth} needs none.
   *
   * @param descriptor - the operation's descriptor, or `undefined` when it declares none.
   * @returns this builder, for chaining.
   */
  operationAuth(descriptor: AuthDescriptor | undefined): this {
    this.#operationAuth = descriptor;
    return this;
  }

  /**
   * Copies and freezes the accumulated state into an immutable {@link RequestOptions}.
   *
   * Tags are defensively copied here, so later mutation of any source map a caller passed to
   * {@link RequestOptionsBuilder.tags} cannot change the built instance (HTTP-34).
   *
   * @returns the frozen options.
   */
  build(): RequestOptions {
    return createRequestOptions(
      this.#timeoutMs,
      this.#maxRetries,
      Object.freeze(new Map(this.#tags)),
      this.#auth,
      this.#operationAuth,
    );
  }
}
