// SPDX-License-Identifier: MIT
// packages/core/src/context/errors.ts
import {DexpaceError} from '../http/errors.js';

/**
 * `installIfAbsent` found the key already occupied (CTX-8).
 *
 * @internal
 */
export class DuplicateContextKeyError extends DexpaceError {
  readonly key: symbol;

  constructor(key: symbol, options?: ErrorOptions) {
    super(`context key already registered: ${String(key)}`, options);
    this.key = key;
  }
}
