// SPDX-License-Identifier: MIT
// packages/core/src/io/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * Root of the I/O error tree (product-spec §5).
 *
 * Error messages in this tree carry counts and limits, never buffer contents — these buffers hold request
 * and response bodies, which routinely contain credentials and PII (styleguide 8.8).
 *
 * @internal
 */
export class IoError extends DexpaceError {}

/**
 * A source ended before delivering the requested number of bytes (IO-11, IO-12, IO-15), or a sink write
 * found fewer bytes in its source buffer than requested (IO-4).
 *
 * @internal
 */
export class EndOfStreamError extends IoError {
  readonly delivered: number;
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
 * @internal
 */
export class SourceContractViolationError extends IoError {}

/**
 * A closed source, sink, buffer, or view was used (IO-42), or a view outlived the parent that invalidated
 * it (IO-22). Distinct from `EndOfStreamError` by requirement — IO-24 demands a closed view fail loudly
 * with a state error rather than looking like a normal exhaustion.
 *
 * @internal
 */
export class ClosedResourceError extends IoError {
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
 * @internal
 */
export class AllocationLimitError extends IoError {
  readonly requested: number;
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
