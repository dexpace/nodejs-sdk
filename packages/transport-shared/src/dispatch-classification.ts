// SPDX-License-Identifier: MIT
// packages/transport-shared/src/dispatch-classification.ts
import {DexpaceError, TransportFailureError} from '@dexpace/core';

/**
 * Error codes a native client uses for "these arguments can never work", as opposed to "this
 * exchange failed".
 *
 * `UND_ERR_INVALID_ARG` and `UND_ERR_NOT_SUPPORTED` are undici's two argument-validation codes,
 * raised by `Dispatcher.request` before a socket is touched (`lib/core/errors.js` in 6.28.0): a
 * non-`http(s)` origin, `CONNECT` as a method, a non-token method, a per-request
 * `Proxy-Authorization` on a `ProxyAgent`. `ERR_INVALID_ARG_VALUE`, `ERR_INVALID_ARG_TYPE` and
 * `ERR_INVALID_URL` are the Node-style codes Bun's `fetch` sets on the same class of refusal — Bun
 * 1.3.14 rejects an `ftp://` URL with a `TypeError` carrying `ERR_INVALID_ARG_VALUE`, where Node's
 * undici-backed `fetch` rejects with a causing network error instead. Measured on both, 2026-09-05.
 */
const TERMINAL_ARGUMENT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_INVALID_ARG',
  'UND_ERR_NOT_SUPPORTED',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_URL',
]);

/**
 * WHATWG network-error reasons that describe the *request* rather than the exchange.
 *
 * undici's `fetch` funnels every failure into one `TypeError('fetch failed', {cause})`
 * (`lib/web/fetch/index.js:230`), so the top-level error cannot tell a refused scheme from a
 * refused connection — the cause's message is the only discriminator the runtime offers. These
 * three are `makeNetworkError` reasons raised before any dispatch (`:620`, `:793`, `:962` in
 * 6.28.0); a scheme this SDK cannot speak is the same permanent misconfiguration undici's
 * *dispatcher* reports as `UND_ERR_INVALID_ARG`.
 *
 * `'bad port'` is deliberately **not** here. WHATWG blocks a fixed list of ports, `1` among them,
 * so on Node's `fetch` the canonical dead-port probe (`http://127.0.0.1:1`) arrives with that
 * reason — and TRANSPORT-20's own conformance sentence is "connect to a dead port; assert the
 * retryable type". Adding it would turn that row, and the SDK's headline retryable case, terminal.
 */
const TERMINAL_NETWORK_REASONS: ReadonlySet<string> = new Set([
  'unknown scheme',
  'URL scheme must be a HTTP(S) scheme',
  'about scheme is not supported',
]);

function errorCode(error: unknown): string | undefined {
  const code = (error as {code?: unknown} | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function hasTerminalCode(error: unknown): boolean {
  const code = errorCode(error);
  return code !== undefined && TERMINAL_ARGUMENT_CODES.has(code);
}

/**
 * Whether a native rejection is a permanent misconfiguration rather than a failed exchange.
 *
 * Three positive recognitions, in one place so the two shipped adapters cannot answer differently
 * for the same condition (the `ftp://` row asserts they do not). Everything else falls through to
 * retryable, which is both the safe default and the behaviour every adapter had before audit #67 /
 * #82 — TRANSPORT-20 makes "no response was produced" a MUST-retryable, so a rejection this table
 * does not recognise must stay one.
 *
 * 1. A **terminal argument code** on the error or its immediate cause, per the
 *    `TERMINAL_ARGUMENT_CODES` table above. This is the whole undici-dispatcher leg, and Bun's
 *    `fetch`.
 * 2. A **`TypeError` with no `cause`**. undici's `fetch` — which is also Node's global `fetch` —
 *    builds every *network* rejection with a cause, and every argument rejection as a bare
 *    `TypeError` thrown out of the `Request`/`Headers` constructors before a dispatch is attempted:
 *    an unsupported method, a non-token method, a body on a GET. The presence of a cause is
 *    therefore the runtime's own line between the two, and it needs no message matching.
 * 3. A cause whose message is one of the `TERMINAL_NETWORK_REASONS` above — the scheme refusals
 *    that undici's `fetch` can only report through its fixed `fetch failed` message.
 *
 * @param error - whatever the native call rejected with.
 * @returns `true` when no retry of the same request could succeed.
 *
 * @internal
 */
export function isPermanentDispatchFailure(error: unknown): boolean {
  if (hasTerminalCode(error)) return true;
  if (!(error instanceof Error)) return false;
  const {cause} = error;
  if (error instanceof TypeError && cause === undefined) return true;
  if (hasTerminalCode(cause)) return true;
  return cause instanceof Error && TERMINAL_NETWORK_REASONS.has(cause.message);
}

/**
 * The message to put on the mapped error: the native message, plus the cause's when the native
 * layer's own message is a fixed placeholder. `fetch failed` names nothing on its own, and the
 * reason that made the verdict permanent is the only useful thing to say.
 */
function describe(error: unknown, fallbackMessage: string): string {
  if (!(error instanceof Error)) return fallbackMessage;
  const {cause} = error;
  if (!(cause instanceof Error) || error.message.includes(cause.message)) {
    return error.message;
  }
  return `${error.message}: ${cause.message}`;
}

/**
 * Maps one native dispatch rejection onto the SDK's error vocabulary.
 *
 * A permanent misconfiguration becomes a bare `TypeError` carrying the native error as `cause`,
 * deliberately **outside** the `IoError` tree: `retry/classify.ts` is an allow-list that returns
 * `true` for every `IoError`, so a condition no retry can fix is non-retryable for free (RETRY-2),
 * and `TypeError` is already what both transports raise for a caller misconfiguration caught at
 * construction. Anything else becomes the retryable `TransportFailureError` TRANSPORT-20 requires.
 *
 * An error that already descends from `DexpaceError` is returned unchanged: it was classified at
 * its own source — a request-body producer failure racing the dispatch is the live case — and
 * re-classifying it here would answer for a layer this table knows nothing about.
 *
 * @param error - whatever the native call rejected with.
 * @param fallbackMessage - the message to use when the rejection is not an `Error` at all.
 * @returns the error to throw; the caller always throws it.
 *
 * @internal
 */
export function toDispatchFailure(
  error: unknown,
  fallbackMessage: string,
): Error {
  if (error instanceof DexpaceError) return error;
  if (isPermanentDispatchFailure(error)) {
    return new TypeError(describe(error, fallbackMessage), {cause: error});
  }
  return new TransportFailureError(
    error instanceof Error ? error.message : fallbackMessage,
    {cause: error},
  );
}
