// SPDX-License-Identifier: MIT
// packages/core/src/io/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * Root of the I/O error tree (product-spec §5).
 *
 * Error messages in this tree carry counts and limits, never buffer contents — these buffers hold request
 * and response bodies, which routinely contain credentials and PII (styleguide 8.8).
 *
 * @public
 */
export class IoError extends DexpaceError {
  // bun's coverage tool never marks a bodiless subclass's implicit constructor as covered
  // (undercounts function coverage); an explicit forwarding constructor is instrumented
  // correctly and keeps the file above the 80% function-coverage floor without changing behavior.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- see comment above
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * A source ended before delivering the requested number of bytes (IO-11, IO-12, IO-15), or a sink write
 * found fewer bytes in its source buffer than requested (IO-4).
 *
 * @public
 */
export class EndOfStreamError extends DexpaceError {
  /** How many bytes the source actually delivered before ending. */
  readonly delivered: number;
  /** How many bytes the caller required. */
  readonly requested: number;

  constructor(delivered: number, requested: number, options?: ErrorOptions) {
    super(
      `end of stream: delivered ${String(delivered)} of ${String(requested)} bytes`,
      options,
    );
    this.delivered = delivered;
    this.requested = requested;
  }
}

/**
 * A foreign source violated the read protocol — most commonly by returning zero bytes for a positive
 * requested count, which IO-17 requires be raised rather than tolerated as end-of-stream or spun on.
 *
 * @public
 */
export class SourceContractViolationError extends DexpaceError {
  // See IoError's constructor above: keeps this bodiless subclass registered for bun's
  // function coverage.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- see comment above
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * A closed source, sink, buffer, or view was used (IO-42), or a view outlived the parent that invalidated
 * it (IO-22). Distinct from `EndOfStreamError` by requirement — IO-24 demands a closed view fail loudly
 * with a state error rather than looking like a normal exhaustion.
 *
 * @public
 */
export class ClosedResourceError extends DexpaceError {
  /** The resource that was already closed, as it appears in the message. */
  readonly resource: string;

  constructor(resource: string, options?: ErrorOptions) {
    super(`${resource} is closed`, options);
    this.resource = resource;
  }
}

/**
 * A materialization would exceed the maximum single-array allocation (IO-9). The message points at the
 * streaming alternative, as IO-9 requires.
 *
 * @public
 */
export class AllocationLimitError extends DexpaceError {
  /** The byte count the materialization asked for. */
  readonly requested: number;
  /** The maximum single-array allocation this runtime permits (IO-9). */
  readonly limit: number;

  constructor(requested: number, limit: number, options?: ErrorOptions) {
    super(
      `cannot materialize ${String(requested)} bytes as one array (limit ${String(limit)}); stream the body instead`,
      options,
    );
    this.requested = requested;
    this.limit = limit;
  }
}

/**
 * Groups every leaf in this file, including bare `IoError`, without reintroducing a class tier between
 * them and `DexpaceError` — the corpus caps custom error hierarchies at two levels. Retrofits Phase 3a's
 * shape, where the four leaves extended `IoError` (a 3-tier chain). `http/errors.ts` carried an
 * identically-shaped tier for longer; `isDomainModelError` is this guard's counterpart there, added
 * when that one was flattened.
 *
 * @public
 */
export function isIoError(
  error: unknown,
): error is
  | IoError
  | EndOfStreamError
  | SourceContractViolationError
  | ClosedResourceError
  | AllocationLimitError {
  return (
    error instanceof IoError ||
    error instanceof EndOfStreamError ||
    error instanceof SourceContractViolationError ||
    error instanceof ClosedResourceError ||
    error instanceof AllocationLimitError
  );
}

/**
 * The canonical retryable transport-failure exception (TRANSPORT-20): any send that produced no HTTP
 * response — connection refused, DNS/TLS failure, peer reset, connect/read timeout. A subtype of IoError
 * so 5a's `classify.ts` cause-walk already treats it as always-retryable with no change to that file.
 *
 * @public
 */
export class TransportFailureError extends IoError {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- load-bearing for Bun function coverage (see IoError)
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
