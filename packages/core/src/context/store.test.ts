// SPDX-License-Identifier: MIT
// packages/core/src/context/store.test.ts
// Exercises: CTX-3 (all three flavors collapse to one slot, successive promotions overwriting it),
// CTX-4 (two contexts sharing identical trace AND span id get distinct keys and both
// register), CTX-8 (install-or-replace never throws; reject-on-duplicate fails naming the key),
// CTX-9/CTX-10 (identity-conditional close, intermediate-link close is a no-op), CTX-11/CTX-12 (bounded,
// post-insert drain loop), CTX-17 (a never-promoted dispatch context leaves no entry; its close is a
// harmless no-op), CTX-13 (arbitrary victim; no entry is promised to survive), CTX-18 (unknown-key
// lookup/close are well-defined no-ops), CTX-19 (strong refs),
// XCUT-14 (a caller-keyed process-lived map -- "context registries" is the requirement's own first
// example -- carries a hard cap and a post-insert drain loop, and a burst never leaves it stuck above)
//
// Every test builds its own `new ContextStore()`. The exported `contextStore` singleton is module-level
// mutable state shared by every test file in a `bun test` run -- 4c's runtime.test.ts installs into that
// same object -- so an absolute `size` assertion against it reads a counter a sibling file can move, and a
// blanket clear() wipes a sibling's entries. docs/knowledge/testing.md:50,52. The singleton gets exactly
// one assertion here: that it is a ContextStore.
import {describe, expect, test} from 'bun:test';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {InvariantViolation} from '../invariant.js';
import {
  createDispatchContext,
  promoteToExchange,
  promoteToRequest,
} from './context.js';
import {DuplicateContextKeyError} from './errors.js';
import {ContextStore, contextStore} from './store.js';

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

describe('install / installIfAbsent (CTX-8)', () => {
  test('install never throws and is retrievable by key', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    store.install(context);
    expect(store.get(context.key)).toBe(context);
  });

  test('install unconditionally overwrites an existing occupant', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    store.install(context);
    const promoted = promoteToRequest(context, aRequest());
    store.install(promoted);
    expect(store.get(context.key)).toBe(promoted);
  });

  test('installIfAbsent succeeds when the key is free', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    store.installIfAbsent(context);
    expect(store.get(context.key)).toBe(context);
  });

  test('installIfAbsent on an occupied key throws DuplicateContextKeyError naming the key', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    store.installIfAbsent(context);
    const other = createDispatchContext({
      instrumentation: context.instrumentation,
      key: context.key,
    });

    let caught: unknown;
    try {
      store.installIfAbsent(other);
    } catch (error) {
      caught = error;
    }

    // CTX-8 says the error names the key, so assert the field, not only the class -- the store passing
    // the wrong symbol through would otherwise be invisible here, and a symbol does not survive the
    // message-substring check the rest of the suite uses for named-field errors.
    expect(caught).toBeInstanceOf(DuplicateContextKeyError);
    expect((caught as DuplicateContextKeyError).key).toBe(context.key);
  });

  test('a rejected installIfAbsent leaves the incumbent in the slot', () => {
    // CTX-8's "admits exactly one winner": the loser must not have displaced or corrupted the winner.
    const store = new ContextStore();
    const winner = createDispatchContext();
    store.installIfAbsent(winner);
    const loser = createDispatchContext({key: winner.key});

    expect(() => {
      store.installIfAbsent(loser);
    }).toThrow(DuplicateContextKeyError);

    expect(store.get(winner.key)).toBe(winner);
    expect(store.size).toBe(1);
  });
});

describe('call-key uniqueness under an identical bundle (CTX-4)', () => {
  test('two contexts sharing identical trace AND span id get distinct keys and both register', () => {
    // §7's own Conformance clause for CTX-4, transcribed. Both contexts carry the very same
    // noopInstrumentationBundle -- identical traceId, spanId, flags, state -- which is exactly the
    // disabled-tracing case CTX-15 warns about. Symbol() keys make them distinct anyway, so neither
    // evicts the other.
    const store = new ContextStore();
    const a = createDispatchContext();
    const b = createDispatchContext();
    expect(a.instrumentation).toBe(b.instrumentation);
    expect(a.key).not.toBe(b.key);

    store.install(a);
    store.install(b);
    expect(store.get(a.key)).toBe(a);
    expect(store.get(b.key)).toBe(b);
    expect(store.size).toBe(2);
  });
});

describe('one slot for the whole chain (CTX-3)', () => {
  test('all three flavors register under the identical slot, each promotion overwriting the last', () => {
    // CTX-3's store-level clause: "all three flavors register under the identical store slot and
    // successive promotions overwrite one entry." Asserted here rather than in context.test.ts, which
    // can only show the keys match -- that they collapse to ONE entry needs a store.
    const store = new ContextStore();
    const dispatch = createDispatchContext();
    const request = aRequest();
    const requestCtx = promoteToRequest(dispatch, request, 'GetWidget');
    const exchangeCtx = promoteToExchange(requestCtx, aResponse(request));

    store.install(dispatch);
    store.install(requestCtx);
    store.install(exchangeCtx);

    expect(store.size).toBe(1);
    expect(store.get(dispatch.key)).toBe(exchangeCtx);
  });
});

describe('no auto-registration at construction (CTX-17)', () => {
  test('a freshly constructed dispatch context is not in the store', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    expect(store.get(context.key)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  test('promoting registers nothing either, and closing the unregistered source is a harmless no-op', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    promoteToRequest(context, aRequest()); // promotion alone registers nothing in 4a -- see below
    expect(store.size).toBe(0);
    expect(() => {
      store.close(context);
    }).not.toThrow();
  });

  // CTX-17's other half -- "the first store entry is installed by the first promotion" -- is NOT
  // satisfied here: promoteToRequest/promoteToExchange are pure and never touch the store, so an
  // explicit store.install(...) is what registers anything. That call belongs to 4c's pipeline,
  // which owns the store handle. Tracked as a deferral in this plan's Self-Review, not an omission.
});

describe('close (CTX-9, CTX-10)', () => {
  test('evicts when the closing context is the current occupant', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    store.install(context);
    store.close(context);
    expect(store.get(context.key)).toBeUndefined();
  });

  test('closing an intermediate link already superseded by promotion is a no-op', () => {
    const store = new ContextStore();
    const dispatch = createDispatchContext();
    store.install(dispatch);
    const promoted = promoteToRequest(dispatch, aRequest());
    store.install(promoted); // furthest-reached link now occupies the slot

    store.close(dispatch); // intermediate link -- must not evict the live promoted occupant
    expect(store.get(dispatch.key)).toBe(promoted);
  });

  test('closing an unknown or already-removed key is a well-defined no-op (CTX-18)', () => {
    const store = new ContextStore();
    const context = createDispatchContext();
    expect(() => {
      store.close(context);
    }).not.toThrow();
    store.install(context);
    store.close(context);
    expect(() => {
      store.close(context);
    }).not.toThrow();
  });
});

describe('lookup (CTX-18)', () => {
  test('an unknown key returns undefined, never throws', () => {
    expect(new ContextStore().get(Symbol('unknown'))).toBeUndefined();
  });
});

describe('bounded drain (CTX-11, CTX-12, CTX-13)', () => {
  // These pin the BOUND, not the drain's shape. `install`/`installIfAbsent` each set one key before
  // draining, so the map is never more than one over the cap and a single check-then-evict would pass
  // every assertion here -- verified by mutation. CTX-12/XCUT-14's loop is retained for runtimes where
  // concurrent inserts stack overshoots; see the note on `#drain`.

  test('a burst of inserts past the cap converges the store to at or under the cap', () => {
    const store = new ContextStore(5);
    for (let i = 0; i < 50; i += 1) {
      store.install(createDispatchContext());
      expect(store.size).toBeLessThanOrEqual(5); // drains after every single insert, never overshoots
    }
    // Negative space: bounding only from above would also pass for a store that retained nothing at all.
    // 50 distinct keys against a cap of 5 must leave the store saturated, not empty.
    expect(store.size).toBe(5);
  });

  test('installIfAbsent also drains after a successful insert', () => {
    const store = new ContextStore(2);
    for (let i = 0; i < 10; i += 1) {
      store.installIfAbsent(createDispatchContext());
    }
    expect(store.size).toBe(2);
  });

  test('a cap below 1 is rejected at construction', () => {
    // The constructor is the only place this is checked, which is what lets #drain skip an unreachable
    // in-loop undefined guard. A bad cap is a violated precondition -- a programmer error -- so it fails
    // through invariant (assertions.md:4, error-handling.md:36), not an ad-hoc throw.
    expect(() => new ContextStore(0)).toThrow(InvariantViolation);
    expect(() => new ContextStore(-1)).toThrow(InvariantViolation);
    expect(() => new ContextStore(1.5)).toThrow(InvariantViolation);
    expect(() => new ContextStore(1)).not.toThrow();
  });
});

describe('clear', () => {
  test('drops every entry, leaving the store reusable', () => {
    const store = new ContextStore();
    const kept = createDispatchContext();
    store.install(kept);
    store.install(createDispatchContext());

    store.clear();

    expect(store.size).toBe(0);
    expect(store.get(kept.key)).toBeUndefined();
    store.install(kept); // still usable afterwards -- clear() resets entries, not the cap
    expect(store.get(kept.key)).toBe(kept);
  });
});

describe('the process-wide singleton', () => {
  test('is a real ContextStore instance', () => {
    // The only assertion this file makes against the singleton: it is shared with every other test file
    // in the run, so nothing behavioural may be asserted through it.
    expect(contextStore).toBeInstanceOf(ContextStore);
  });
});
