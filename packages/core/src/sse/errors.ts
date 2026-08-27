// SPDX-License-Identifier: MIT
// packages/core/src/sse/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * A misuse or precondition failure of the SSE stream facade: a second iterator on a single-pass stream
 * (SSE-26), an iterator requested after close (SSE-27), or a stream opened over a response with no body
 * (SSE-32).
 *
 * Distinct from `IoError`, which is a genuine read failure. This type always means the *caller* did something
 * the contract forbids, or the *server* sent a response the contract cannot work with.
 *
 * @public
 */
export class SseStreamError extends DexpaceError {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- explicit constructor required for Bun test function coverage instrumentation
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
