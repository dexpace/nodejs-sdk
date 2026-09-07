// SPDX-License-Identifier: MIT
// packages/core/src/pagination/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * A misuse or precondition failure of the pagination engine: a non-positive page cap at construction
 * (PAGE-9), or a second iterator on the single-use page-level view (PAGE-14).
 *
 * Not used for transport, parse, or close failures — those propagate as whatever the underlying layer raised,
 * because PAGE-28 requires the *original* cause to surface rather than a pagination-flavored wrapper.
 *
 * @public
 */
export class PaginationError extends DexpaceError {
  // bun's coverage tool never marks a bodiless subclass's implicit constructor as covered
  // (undercounts function coverage); an explicit forwarding constructor is instrumented
  // correctly and keeps the file above the 80% function-coverage floor without changing behavior.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor -- see comment above
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
