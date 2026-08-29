// SPDX-License-Identifier: MIT
// tests/conformance/xcut/fixtures/composed-pipeline.ts
import {
  standardResilience,
  type AuthStepSettings,
  type LoggingStepSettings,
  type RedirectSettings,
  type Request,
  type RequestOptions,
  type Response,
  type RetryStepOptions,
  type Runtime,
  type Transport,
} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

/**
 * Per-pillar overrides, mirroring `StandardResilienceOptions` exactly rather than restating a
 * narrowed copy of it -- `retry` is a `RetryStepOptions` (settings nest under `.settings`), not a
 * `Partial<RetrySettings>`.
 */
export interface ComposedPipelineOverrides {
  readonly retry?: RetryStepOptions | undefined;
  readonly redirect?: Partial<RedirectSettings> | undefined;
  readonly auth?: AuthStepSettings | undefined;
  readonly logging?: LoggingStepSettings | undefined;
  /** Swap the terminal transport, e.g. for `undiciTransport()`. Defaults to `fetchTransport()`. */
  readonly transport?: Transport | undefined;
}

/**
 * Counts dispatches to the terminal transport.
 *
 * Wrapping the TRANSPORT is the only placement that answers "was this retried?". Wrapping
 * `Runtime.send` -- one call in, one call out -- counts the caller's own invocations and would read
 * 1 whether the retry pillar re-issued four times or none, which is the opposite of what every
 * `XCUT-10` row asserts.
 */
class CountingTransport implements Transport {
  #dispatches = 0;
  readonly #inner: Transport;

  // Not a constructor parameter property: `erasableSyntaxOnly` bans those repo-wide.
  constructor(inner: Transport) {
    this.#inner = inner;
  }

  get dispatches(): number {
    return this.#dispatches;
  }

  async send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    this.#dispatches += 1;
    return this.#inner.send(request, options, signal);
  }

  async close(): Promise<void> {
    return this.#inner.close();
  }
}

/** A built pipeline plus the two things a conformance row needs around it. */
export interface ComposedPipeline {
  /** The composed runtime: redirect wraps retry wraps auth wraps logging (AUTH-27). */
  readonly runtime: Runtime;
  /** Dispatches that actually reached the terminal transport, i.e. attempts including retries. */
  readonly dispatches: () => number;
  /** Closes the terminal transport. `Runtime.close()` is a documented no-op (PIPE-27). */
  close(): Promise<void>;
}

/**
 * The one real, fully composed pipeline every `XCUT-N` test in this directory drives --
 * retry + redirect + auth + logging via 5c/7b's `standardResilience()` over a real
 * `fetchTransport()`. Never a per-test hand-rolled subset: the value this suite adds over each
 * pillar's own unit tests is proving the invariants still hold when all of them run together.
 *
 * @param overrides - per-pillar settings; omitted pillars take their shipped defaults.
 * @returns the runtime, its dispatch counter, and a close that reaches the transport.
 */
export function buildComposedPipeline(
  overrides: ComposedPipelineOverrides = {},
): ComposedPipeline {
  const counting = new CountingTransport(
    overrides.transport ?? fetchTransport(),
  );
  const runtime = standardResilience(counting, {
    retry: overrides.retry,
    redirect: overrides.redirect,
    auth: overrides.auth,
    logging: overrides.logging,
  });

  return {
    runtime,
    dispatches: () => counting.dispatches,
    close: () => counting.close(),
  };
}
