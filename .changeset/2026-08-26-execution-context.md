---
'@dexpace/core': patch
---

Add the execution-context model for product-spec §7 (`CTX-1`–`CTX-20`, `XCUT-14`). No public API change.

Everything this adds lives under `packages/core/src/context/` and none of it is re-exported from
`src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
empty changeset because files under `packages/` did change: the published tarball carries the new
`dist/context/*.js`, and a consumer stepping through the package in a debugger will see them.

What landed: `ExecutionContext` as a three-member discriminated union — `DispatchContext` (before any
request), `RequestContext` (an outbound request assembled), `ExchangeContext` (a response arrived, terminal) —
with `promoteToRequest`/`promoteToExchange` as the pure promotion chain and `createDispatchContext`/
`createRequestContext`/`createExchangeContext` as the off-chain factories `CTX-5`/`CTX-6` require.
`InstrumentationBundle` plus the `noopInstrumentationBundle` disabled-tracing default. `ContextStore`, a
bounded keyed registry with `install`/`installIfAbsent`/`find`/`close`, and `DuplicateContextKeyError`.

Three design calls worth recording:

- **Call keys are `Symbol()`, not a counter or a UUID.** `CTX-4`'s uniqueness requirement cannot lean on any
  field of the instrumentation bundle, because `noopInstrumentationBundle`'s fields are all constants shared
  by every context that takes the default. A fresh `Symbol()` per call is distinct across the process and
  across all three context flavors by construction, and `ContextInit.key` is the pin that makes two contexts
  deliberately share one store slot (`CTX-5`).
- **The store's cap drains in a loop, and holds strong references.** `XCUT-14` names context registries first
  among the caller-keyed process-lived maps that MUST carry a hard cap and drain back under it after each
  insert — an unbounded one is a memory-exhaustion vector, not merely a leak. The loop (rather than a single
  check-then-evict) is what makes an insert burst converge. `Map`, never `WeakMap`/`WeakRef`: a registered
  context keeps its whole `Request`+`Response` graph reachable on purpose, so the cap is the backstop rather
  than the collector (`CTX-19`).
- **Promotions never touch a store.** `context.ts` does not import `store.ts`, which is what satisfies
  `CTX-17`'s negative half structurally — constructing a head context must not auto-register it. Wiring the
  store into the promotions would invert the layering and make every promotion a global side effect. The
  positive half — the first store entry, installed by the first promotion — is Phase 4c's `Runtime.send()`.

Two known deviations, both already in the deferral register (`docs/open-items.md`):

- `contextStore` is a module-level mutable singleton, which
  `docs/knowledge/harvested/variables-and-declarations.md:22` bans. Accepted because threading a store handle through
  builder → runtime → every step would be a wide API change for no observable gain; logged in the design's
  Deviation Ledger for Phase 10. Tests build their own `new ContextStore()` rather than asserting through the
  singleton, which is shared by every file in a `bun test` run.
- `activeSpan` and `tracerFactory` stay typed `unknown`, and `activeSpan` is `undefined` rather than a no-op
  span object. `CTX-14`/`CTX-15` ship as the bundle's frozen shape and the disabled default only; real W3C
  Trace Context generation waits for the Phase 7 tracing adapter that gets to define `Span`.
