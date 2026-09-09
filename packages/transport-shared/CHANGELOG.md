# @dexpace/transport-shared

## 1.0.0

### Minor Changes

- c1eb3aa: Add the transport adapters (Phase 8a) — the first code in this SDK that puts bytes on the wire:
  - `@dexpace/transport-fetch`: a `Transport` over the runtime's global `fetch`, with zero dependencies beyond its `@dexpace/core` peer. No `proxy` option exists at all (an absent option, not a silently ignored one), and `close()` is a sanctioned no-op over a runtime global it does not own.
  - `@dexpace/transport-undici`: the full-featured `Transport`, taking exactly one external dependency. Ownership-aware `close()` over the dispatchers it constructed (never a bring-your-own one), `NO_PROXY` bypass routed over a separate direct `Agent`, direct file-body dispatch honoring `start`/`count`, and a native-internal cancel told apart from a timeout.
  - `@dexpace/body-file`: the concrete `fileBody()` factory, with fail-fast `node:fs` construction validation, a fresh handle per write, and short-write detection. Transports recognize it structurally through `body.kind === 'file'`, never a cross-package `instanceof`.
  - `@dexpace/transport-shared`: the header drop/degrade pass, drop-log dedup policy, abort-to-SDK-error mapping, request-body pump, and delivery-detached signal fork — `@internal` exports both transports share so the one algorithm exists once rather than twice.
  - `@dexpace/core` gains `TransportFailureError` (the canonical retryable no-response failure, an `IoError` subtype) and the type-only `FileBodyDescriptor` plus a `'file'` member on `Body['kind']`. `IoError` is promoted from `@internal` to `@public` as its base class. Note for TypeScript consumers: widening `Body['kind']` is additive for anyone _implementing_ `Body`, but an exhaustive `switch (body.kind)` with a `never` default will stop compiling until it handles `'file'`.
  - Both transports are proven against one shared `TRANSPORT-N` conformance suite and are `AsyncDisposable`, so `await using` is a single teardown path. Both also keep a handler on a streaming request body's producer for the whole send: a producer that fails _after_ the response was delivered (an early `413`, say) is an observed rejection rather than one that reaches the runtime's default `unhandledRejection` policy. `@dexpace/transport-undici` additionally reports undici's argument-validation failures outside the `IoError` tree, so a permanent misconfiguration is terminal rather than retried to exhaustion.

### Patch Changes

- c1eb3aa: Give `createDropLogger`'s verbosity policy real levels (OBS-19, TRANSPORT-13). Every mode used to
  emit at `verbose`, so the policy was configurable in name only.

  - `'all'` now warns on every occurrence.
  - `'first-per-name'` — the default for both `fetchTransport()` and `undiciTransport()` — now warns
    the **first** drop of each header name and emits later drops of that name at `verbose`. It
    previously suppressed later drops entirely; OBS-19's conformance text asks for "exactly one WARN
    then verbose lines", so they are emitted rather than dropped.
  - `'quiet'` is unchanged and still writes nothing, which is TRANSPORT-13's own third mode.

  The visible effect is that a caller-set header the transport cannot encode — dropped rather than
  thrown, per TRANSPORT-12 — is now audible at a level a production logger enables. Before this, the
  drop was indistinguishable from nothing having happened.

- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
- Updated dependencies [c1eb3aa]
  - @dexpace/core@0.1.0
