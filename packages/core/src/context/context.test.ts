// SPDX-License-Identifier: MIT
// packages/core/src/context/context.test.ts
// Exercises: CTX-1 (one-way promotion, incl. the compile-time no-promote-back check), CTX-2 (additive,
// non-mutating, carries forward instrumentation + key), CTX-3 (one shared call key across the whole
// chain), CTX-5/CTX-6 (off-chain construction, fresh key per default call at population scale, explicit
// key pinning), CTX-7 (immutable), CTX-15 (keys stay call-unique though every bundle field is identical),
// CTX-16 (operationName absent at dispatch, introduced at request, carried forward, never keyed on)
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {
  type DispatchContext,
  createDispatchContext,
  createExchangeContext,
  createRequestContext,
  promoteToExchange,
  promoteToRequest,
} from './context.js';
import {noopInstrumentationBundle} from './instrumentation.js';

function aRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

function aResponse(request: Request): Response {
  return Response.newBuilder()
    .request(request)
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(200))
    .build();
}

describe('promotion chain (CTX-1, CTX-2, CTX-3)', () => {
  test('dispatch exposes exactly its expected artifacts', () => {
    const dispatch = createDispatchContext();
    expect(dispatch.kind).toBe('dispatch');
    expect(dispatch.key).toBeDefined();
    expect(dispatch.instrumentation).toBe(noopInstrumentationBundle);
  });

  test('promoting dispatch to request adds exactly the request, carrying key and instrumentation forward by reference', () => {
    const dispatch = createDispatchContext();
    const request = aRequest();
    const requestCtx = promoteToRequest(dispatch, request, 'GetWidget');

    expect(requestCtx.kind).toBe('request');
    expect(requestCtx.key).toBe(dispatch.key);
    expect(requestCtx.instrumentation).toBe(dispatch.instrumentation);
    expect(requestCtx.request).toBe(request);
    expect(requestCtx.operationName).toBe('GetWidget');
  });

  test('the source context is unchanged by promotion', () => {
    const dispatch = createDispatchContext();
    const before = {...dispatch};
    promoteToRequest(dispatch, aRequest());
    expect(dispatch).toEqual(before);
  });

  test('promoting request to exchange adds exactly the response, carrying everything else forward', () => {
    const request = aRequest();
    const requestCtx = promoteToRequest(
      createDispatchContext(),
      request,
      'GetWidget',
    );
    const response = aResponse(request);
    const exchangeCtx = promoteToExchange(requestCtx, response);

    expect(exchangeCtx.kind).toBe('exchange');
    expect(exchangeCtx.key).toBe(requestCtx.key);
    expect(exchangeCtx.instrumentation).toBe(requestCtx.instrumentation);
    expect(exchangeCtx.operationName).toBe('GetWidget');
    expect(exchangeCtx.request).toBe(request);
    expect(exchangeCtx.response).toBe(response);
  });

  test('the whole chain shares one call key across all three flavors', () => {
    const dispatch = createDispatchContext();
    const requestCtx = promoteToRequest(dispatch, aRequest());
    const exchangeCtx = promoteToExchange(
      requestCtx,
      aResponse(requestCtx.request),
    );
    expect(requestCtx.key).toBe(dispatch.key);
    expect(exchangeCtx.key).toBe(dispatch.key);
  });
});

describe('promotion is one-way (CTX-1)', () => {
  test('no promotion function accepts an ExchangeContext, so there is no way back', () => {
    const requestCtx = promoteToRequest(createDispatchContext(), aRequest());
    const exchangeCtx = promoteToExchange(
      requestCtx,
      aResponse(requestCtx.request),
    );

    // CTX-1's "the exchange type exposes no method promoting back" is a compile-time guarantee in this
    // design, not a runtime one: promoteToRequest/promoteToExchange are free functions typed to accept
    // only DispatchContext/RequestContext respectively, and there is no third promotion function. These
    // two @ts-expect-error lines are the assertion -- `bun run typecheck` FAILS if either promotion ever
    // widens to accept a terminal context, which a prose-only comment would not catch.
    // @ts-expect-error -- ExchangeContext is terminal; it is not a DispatchContext
    promoteToRequest(exchangeCtx, aRequest());
    // @ts-expect-error -- ExchangeContext is terminal; it is not a RequestContext
    promoteToExchange(exchangeCtx, aResponse(requestCtx.request));

    expect(exchangeCtx.kind).toBe('exchange');
  });
});

describe('off-chain construction (CTX-5, CTX-6)', () => {
  test('default construction mints a fresh, distinct key every call', () => {
    const a = createDispatchContext();
    const b = createDispatchContext();
    expect(a.key).not.toBe(b.key);
  });

  test('N default-constructed contexts across all three flavors are pairwise key-distinct', () => {
    // CTX-5's "globally distinct across the whole process and all three flavors" is a property over the
    // whole population, not just a pair -- a keying scheme that collided every Nth call would pass the
    // pairwise test above. Every bundle field is identical here (all use noopInstrumentationBundle), so
    // this is also CTX-15's "call-key derivation MUST remain call-unique even when every bundle field is
    // identical" at scale.
    const request = aRequest();
    const keys = new Set<symbol>();
    for (let i = 0; i < 1000; i += 1) {
      keys.add(createDispatchContext().key);
      keys.add(createRequestContext(request).key);
      keys.add(createExchangeContext(request, aResponse(request)).key);
    }
    expect(keys.size).toBe(3000);
  });

  test('an explicit key can be pinned so two contexts share one slot', () => {
    const key = Symbol('shared');
    const a = createDispatchContext({key});
    const b = createDispatchContext({key});
    expect(a.key).toBe(b.key);
  });

  test('an explicit instrumentation bundle is carried onto the context verbatim', () => {
    const instrumentation = {
      ...noopInstrumentationBundle,
      traceId: 'a'.repeat(32),
      isValid: true,
    };
    expect(createDispatchContext({instrumentation}).instrumentation).toBe(
      instrumentation,
    );
  });

  test('a caller-supplied instrumentation bundle is frozen by the factory (CTX-7)', () => {
    // Object.freeze on the context is shallow, so without this the bundle behind `instrumentation` stays
    // writable and the caller can mutate a "immutable" context out from under the whole chain.
    const instrumentation = {
      ...noopInstrumentationBundle,
      traceId: 'a'.repeat(32),
    };
    const dispatch = createDispatchContext({instrumentation});

    expect(Object.isFrozen(dispatch.instrumentation)).toBe(true);
    expect(Object.isFrozen(instrumentation)).toBe(true); // frozen in place, so the reference stays shared
  });

  test('createRequestContext and createExchangeContext also default to a fresh key per call', () => {
    const request = aRequest();
    const a = createRequestContext(request);
    const b = createRequestContext(request);
    expect(a.key).not.toBe(b.key);

    const c = createExchangeContext(request, aResponse(request));
    const d = createExchangeContext(request, aResponse(request));
    expect(c.key).not.toBe(d.key);
  });
});

describe('operationName (CTX-16)', () => {
  test('is absent at the dispatch stage', () => {
    expect('operationName' in createDispatchContext()).toBe(false);
  });

  test('defaults to undefined when not supplied at promotion', () => {
    const requestCtx = promoteToRequest(createDispatchContext(), aRequest());
    expect(requestCtx.operationName).toBeUndefined();
  });

  test('is carried forward unchanged across the request-to-exchange promotion', () => {
    const requestCtx = promoteToRequest(
      createDispatchContext(),
      aRequest(),
      'GetWidget',
    );
    const exchangeCtx = promoteToExchange(
      requestCtx,
      aResponse(requestCtx.request),
    );
    expect(exchangeCtx.operationName).toBe('GetWidget');
  });

  test('is advisory only -- it never influences the call key', () => {
    // CTX-16: "never influencing the request, dispatch decision, or store key." Two otherwise-identical
    // promotions differing only in operationName keep their source keys; and pinning one key across two
    // different operation names still yields one slot, proving the name is not folded into it.
    const key = Symbol('shared');
    const a = promoteToRequest(
      createDispatchContext({key}),
      aRequest(),
      'GetWidget',
    );
    const b = promoteToRequest(
      createDispatchContext({key}),
      aRequest(),
      'DeleteWidget',
    );
    expect(a.key).toBe(b.key);
    expect(a.operationName).not.toBe(b.operationName);
  });
});

describe('immutability (CTX-7)', () => {
  test('a promotion freezes a bundle that never passed through a factory', () => {
    // The context flavors are interfaces, not classes, so 4b/4c can hand a promotion a
    // literal-constructed context whose bundle was never frozen. Without this the promoted context is
    // "immutable" in name only: the caller keeps a writable reference to its trace state.
    const instrumentation = {
      ...noopInstrumentationBundle,
      traceId: 'a'.repeat(32),
    };
    const forged: DispatchContext = {
      kind: 'dispatch',
      key: Symbol('forged'),
      instrumentation,
    };

    const requestCtx = promoteToRequest(forged, aRequest());

    expect(Object.isFrozen(requestCtx.instrumentation)).toBe(true);
    expect(requestCtx.instrumentation).toBe(instrumentation); // frozen in place -- CTX-2 still holds
    expect(
      Object.isFrozen(
        promoteToExchange(requestCtx, aResponse(requestCtx.request))
          .instrumentation,
      ),
    ).toBe(true);
  });

  test('every context flavor is frozen', () => {
    const dispatch = createDispatchContext();
    expect(Object.isFrozen(dispatch)).toBe(true);
    const requestCtx = promoteToRequest(dispatch, aRequest());
    expect(Object.isFrozen(requestCtx)).toBe(true);
    expect(
      Object.isFrozen(
        promoteToExchange(requestCtx, aResponse(requestCtx.request)),
      ),
    ).toBe(true);
  });
});
