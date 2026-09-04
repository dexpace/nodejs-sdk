// SPDX-License-Identifier: MIT
// packages/core/src/recovery/idempotency-key.ts
import type {Method} from '../http/method.js';
import type {Request} from '../http/request.js';
import type {RequestStep} from './request-chain.js';

const DEFAULT_HEADER = 'Idempotency-Key';
const DEFAULT_METHODS: readonly Method[] = ['POST', 'PUT', 'PATCH'];

/**
 * Everything {@link idempotencyKeyStep} accepts (RECOV-32).
 *
 * @public
 */
export interface IdempotencyKeyOptions {
  /** The key strategy. Invoked at most once per applicable request (RECOV-32). */
  readonly generate: () => string;
  /**
   * The header to stamp.
   *
   * @defaultValue `'Idempotency-Key'`
   */
  readonly headerName?: string | undefined;
  /** Defaults to the non-idempotent write methods; defensively copied at construction. */
  readonly methods?: ReadonlySet<Method> | undefined;
  /** When true (the default) a request already carrying the header is left entirely alone. */
  readonly respectExisting?: boolean | undefined;
}

/**
 * A `RequestStep` that stamps an idempotency key on write requests (RECOV-32).
 *
 * Runs ONCE per call, upstream of retry -- not per attempt. `retry/attempt-stamp.ts` is its sibling:
 * that one writes the attempt ordinal on each per-attempt copy and preserves whatever this wrote
 * (RETRY-38), so the server sees one stable key across every retry of the same logical request.
 *
 * @param options - the key strategy plus the header name, method set, and existing-key policy.
 * @returns the request step to install in a `RequestRecoveryChain`.
 *
 * @public
 */
export function idempotencyKeyStep(
  options: IdempotencyKeyOptions,
): RequestStep {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const methods = new Set<Method>(options.methods ?? DEFAULT_METHODS);
  const respectExisting = options.respectExisting ?? true;

  return (request: Request): Promise<Request> => {
    if (!methods.has(request.method)) return Promise.resolve(request);
    if (respectExisting && request.headers.get(headerName) !== undefined) {
      return Promise.resolve(request);
    }
    return Promise.resolve(
      request
        .newBuilder()
        .headers(
          request.headers
            .newBuilder()
            .set(headerName, options.generate())
            .build(),
        )
        .build(),
    );
  };
}
