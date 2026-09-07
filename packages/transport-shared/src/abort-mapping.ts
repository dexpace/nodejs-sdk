// SPDX-License-Identifier: MIT
// packages/transport-shared/src/abort-mapping.ts
import {
  CancellationError,
  TransportFailureError,
  isTimeoutSignal,
  type DexpaceError,
} from '@dexpace/core';

/**
 * Maps an aborted signal to the canonical SDK error type.
 *
 * @param signal - the aborted AbortSignal
 * @param cause - the original reason or error
 * @returns a TransportFailureError if the signal was aborted by timeout, or CancellationError otherwise.
 *
 * @internal
 */
export function abortToSdkError(
  signal: AbortSignal,
  cause: unknown,
): DexpaceError {
  return isTimeoutSignal(signal)
    ? new TransportFailureError('request timed out', {cause})
    : new CancellationError('request cancelled', {cause});
}
