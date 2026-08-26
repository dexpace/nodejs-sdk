// SPDX-License-Identifier: MIT
// packages/core/src/context/context.ts
import type {Request} from '../http/request.js';
import type {Response} from '../http/response.js';
import {
  noopInstrumentationBundle,
  type InstrumentationBundle,
} from './instrumentation.js';

/**
 * Before any request (CTX-1). No `operationName` — CTX-16 introduces it at the request stage.
 *
 * @internal
 */
export interface DispatchContext {
  readonly kind: 'dispatch';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
}

/**
 * An outgoing request assembled (CTX-1).
 *
 * @internal
 */
export interface RequestContext {
  readonly kind: 'request';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
}

/**
 * A response arrived; terminal — no further promotion exists (CTX-1).
 *
 * @internal
 */
export interface ExchangeContext {
  readonly kind: 'exchange';
  readonly key: symbol;
  readonly instrumentation: InstrumentationBundle;
  readonly operationName: string | undefined;
  readonly request: Request;
  readonly response: Response;
}

/**
 * The three promotion-chain stages as one discriminated union, branched on `kind`.
 *
 * @internal
 */
export type ExecutionContext =
  DispatchContext | RequestContext | ExchangeContext;

/**
 * Optional inputs shared by the three off-chain `create*` factories. One options object rather than
 * positional parameters: `createExchangeContext` would otherwise take five, and ESLint's `max-params` is 3
 * and counts optional parameters. Every field is spelled `?: T | undefined` for
 * `exactOptionalPropertyTypes`.
 *
 * @internal
 */
export interface ContextInit {
  /** Advisory operation label (CTX-16); never influences the request, dispatch, or store key. */
  readonly operationName?: string | undefined;
  /** @defaultValue `noopInstrumentationBundle` */
  readonly instrumentation?: InstrumentationBundle | undefined;
  /**
   * Pin to make two contexts share one store slot (CTX-5).
   *
   * @defaultValue a fresh `Symbol()` per call
   */
  readonly key?: symbol | undefined;
}

/**
 * Off-chain construction (CTX-5): `key` defaults to a fresh Symbol() per call unless pinned, which is also
 * what makes default keys globally distinct across the process and all three flavors (CTX-6). Takes
 * `Omit<ContextInit, 'operationName'>` — CTX-16 introduces the operation name at the request stage, so the
 * dispatch factory does not offer it.
 *
 * @internal
 */
export function createDispatchContext(
  init: Omit<ContextInit, 'operationName'> = {},
): DispatchContext {
  const {
    instrumentation = noopInstrumentationBundle,
    key = Symbol('dispatch-context'),
  } = init;
  return Object.freeze({
    kind: 'dispatch',
    key,
    instrumentation: freezeBundle(instrumentation),
  });
}

/**
 * Off-chain construction (CTX-5/6) — see `promoteToRequest` for the normal promotion path.
 *
 * @internal
 */
export function createRequestContext(
  request: Request,
  init: ContextInit = {},
): RequestContext {
  const {
    operationName,
    instrumentation = noopInstrumentationBundle,
    key = Symbol('request-context'),
  } = init;
  return Object.freeze({
    kind: 'request',
    key,
    instrumentation: freezeBundle(instrumentation),
    operationName,
    request,
  });
}

/**
 * Off-chain construction (CTX-5/6) — see `promoteToExchange` for the normal promotion path.
 *
 * @internal
 */
export function createExchangeContext(
  request: Request,
  response: Response,
  init: ContextInit = {},
): ExchangeContext {
  const {
    operationName,
    instrumentation = noopInstrumentationBundle,
    key = Symbol('exchange-context'),
  } = init;
  return Object.freeze({
    kind: 'exchange',
    key,
    instrumentation: freezeBundle(instrumentation),
    operationName,
    request,
    response,
  });
}

/**
 * dispatch -\> request (CTX-1/2/3): adds the request, carries key + instrumentation forward verbatim —
 * `freezeBundle` is idempotent and freezes in place, so the bundle reference CTX-2 carries forward is
 * unchanged; it is re-run because `DispatchContext` is an interface, so a caller can hand a
 * literal-constructed context whose bundle never passed through a `create*` factory.
 *
 * @internal
 */
export function promoteToRequest(
  context: DispatchContext,
  request: Request,
  operationName?: string,
): RequestContext {
  return Object.freeze({
    kind: 'request',
    key: context.key,
    instrumentation: freezeBundle(context.instrumentation),
    operationName,
    request,
  });
}

/**
 * request -\> exchange (CTX-1/2/3): adds the response, carries everything else forward verbatim; the
 * bundle is re-frozen for the same reason as `promoteToRequest`.
 *
 * @internal
 */
export function promoteToExchange(
  context: RequestContext,
  response: Response,
): ExchangeContext {
  return Object.freeze({
    kind: 'exchange',
    key: context.key,
    instrumentation: freezeBundle(context.instrumentation),
    operationName: context.operationName,
    request: context.request,
    response,
  });
}

/**
 * CTX-7: a context must be immutable, but `Object.freeze` on the context object is shallow, so a
 * caller-supplied bundle would stay writable behind the `instrumentation` slot. Frozen in place rather than
 * copied, so the reference the promotions carry forward (CTX-2) is the one the caller handed in.
 * `noopInstrumentationBundle` is already frozen, so the default path costs nothing. Idempotent, which is
 * what lets both the factories and the two promotions call it unconditionally.
 */
function freezeBundle(bundle: InstrumentationBundle): InstrumentationBundle {
  return Object.isFrozen(bundle) ? bundle : Object.freeze(bundle);
}
