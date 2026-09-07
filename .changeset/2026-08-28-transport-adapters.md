---
"@dexpace/core": minor
"@dexpace/transport-fetch": minor
"@dexpace/transport-undici": minor
"@dexpace/transport-shared": minor
"@dexpace/body-file": minor
---

Add the transport adapters (Phase 8a) — the first code in this SDK that puts bytes on the wire:
- `@dexpace/transport-fetch`: a `Transport` over the runtime's global `fetch`, with zero dependencies beyond its `@dexpace/core` peer. No `proxy` option exists at all (an absent option, not a silently ignored one), and `close()` is a sanctioned no-op over a runtime global it does not own.
- `@dexpace/transport-undici`: the full-featured `Transport`, taking exactly one external dependency. Ownership-aware `close()` over the dispatchers it constructed (never a bring-your-own one), `NO_PROXY` bypass routed over a separate direct `Agent`, direct file-body dispatch honoring `start`/`count`, and a native-internal cancel told apart from a timeout.
- `@dexpace/body-file`: the concrete `fileBody()` factory, with fail-fast `node:fs` construction validation, a fresh handle per write, and short-write detection. Transports recognize it structurally through `body.kind === 'file'`, never a cross-package `instanceof`.
- `@dexpace/transport-shared`: the header drop/degrade pass, drop-log dedup policy, abort-to-SDK-error mapping, request-body pump, and delivery-detached signal fork — `@internal` exports both transports share so the one algorithm exists once rather than twice.
- `@dexpace/core` gains `TransportFailureError` (the canonical retryable no-response failure, an `IoError` subtype) and the type-only `FileBodyDescriptor` plus a `'file'` member on `Body['kind']`. `IoError` is promoted from `@internal` to `@public` as its base class. Note for TypeScript consumers: widening `Body['kind']` is additive for anyone *implementing* `Body`, but an exhaustive `switch (body.kind)` with a `never` default will stop compiling until it handles `'file'`.
- Both transports are proven against one shared `TRANSPORT-N` conformance suite and are `AsyncDisposable`, so `await using` is a single teardown path. Both also keep a handler on a streaming request body's producer for the whole send: a producer that fails *after* the response was delivered (an early `413`, say) is an observed rejection rather than one that reaches the runtime's default `unhandledRejection` policy. `@dexpace/transport-undici` additionally reports undici's argument-validation failures outside the `IoError` tree, so a permanent misconfiguration is terminal rather than retried to exhaustion.
