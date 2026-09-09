# @dexpace/transport-fetch

## 1.0.0

### Minor Changes

- c1eb3aa: Add the transport adapters (Phase 8a) — the first code in this SDK that puts bytes on the wire:
  - `@dexpace/transport-fetch`: a `Transport` over the runtime's global `fetch`, with zero dependencies beyond its `@dexpace/core` peer. No `proxy` option exists at all (an absent option, not a silently ignored one), and `close()` is a sanctioned no-op over a runtime global it does not own.
  - `@dexpace/transport-undici`: the full-featured `Transport`, taking exactly one external dependency. Ownership-aware `close()` over the dispatchers it constructed (never a bring-your-own one), `NO_PROXY` bypass routed over a separate direct `Agent`, direct file-body dispatch honoring `start`/`count`, and a native-internal cancel told apart from a timeout.
  - `@dexpace/body-file`: the concrete `fileBody()` factory, with fail-fast `node:fs` construction validation, a fresh handle per write, and short-write detection. Transports recognize it structurally through `body.kind === 'file'`, never a cross-package `instanceof`.
  - `@dexpace/transport-shared`: the header drop/degrade pass, drop-log dedup policy, abort-to-SDK-error mapping, request-body pump, and delivery-detached signal fork — `@internal` exports both transports share so the one algorithm exists once rather than twice.
  - `@dexpace/core` gains `TransportFailureError` (the canonical retryable no-response failure, an `IoError` subtype) and the type-only `FileBodyDescriptor` plus a `'file'` member on `Body['kind']`. `IoError` is promoted from `@internal` to `@public` as its base class. Note for TypeScript consumers: widening `Body['kind']` is additive for anyone _implementing_ `Body`, but an exhaustive `switch (body.kind)` with a `never` default will stop compiling until it handles `'file'`.
  - Both transports are proven against one shared `TRANSPORT-N` conformance suite and are `AsyncDisposable`, so `await using` is a single teardown path. Both also keep a handler on a streaming request body's producer for the whole send: a producer that fails _after_ the response was delivered (an early `413`, say) is an observed rejection rather than one that reaches the runtime's default `unhandledRejection` policy. `@dexpace/transport-undici` additionally reports undici's argument-validation failures outside the `IoError` tree, so a permanent misconfiguration is terminal rather than retried to exhaustion.
- c1eb3aa: Guard every `[Symbol.asyncDispose]` install behind a runtime check, so disposal is never promised on a Node version that does not have the symbol.

  `Page`, `FetchTransport`, and `UndiciTransport` each declared `[Symbol.asyncDispose]` as a plain computed class member. `Symbol.asyncDispose` arrived in Node **20.4**, but every package here declares `engines.node: ">=20.3"`. On the declared floor the computed key evaluates to `undefined`, so the method was bound to the string key `"undefined"` — leaving a junk prototype entry and **no working disposal**, while the emitted `.d.ts` promised `AsyncDisposable` unconditionally. `SseStream` was already guarded, and `Response` carries a regression test asserting the absence of exactly this junk key (`http/response.test.ts`); these three sites had reintroduced it.

  The installs now match `SseStream`: `Object.defineProperty` behind `typeof Symbol.asyncDispose === 'symbol'`. Disposal works unchanged on Node 20.4+.

  Breaking, in the type system only:

  - `Page` no longer declares `implements AsyncDisposable`, and its `.d.ts` no longer declares `[Symbol.asyncDispose]`.
  - `fetchTransport()` returns `Transport` rather than `Transport & AsyncDisposable`.
  - `undiciTransport()` returns `Transport` rather than `Transport & AsyncDisposable`.

  `await using page = ...` / `await using transport = ...` therefore no longer type-checks. This is deliberate: the declaration was only ever true on Node 20.4+, and on the floor it type-checked a call that silently did nothing — for `undiciTransport` that meant leaking every pooled connection. Call `close()` instead, which has always been the real teardown path and is unchanged. Consumers pinned to Node 20.4+ who want `await using` back can reach the installed symbol through a cast.

  The floor will not be raised to `>=20.4` to restore the declaration. `NFR-10` requires a capability that needs a newer runtime to be isolated into its own unit declaring that higher floor, never to raise the floor of the general-purpose core; it also requires the emitted-artifact target and the visible-API level to agree, which is the clause the unguarded member violated. `>=20.3` is in any case derived rather than chosen — it is the lowest Node that runs what these packages emit, set by `globalThis.crypto` (absent from ESM on every Node 18 release) and `AbortSignal.any()` (20.3.0). The guarded install is the permanent shape.

  `Paginator.pages()`'s published TSDoc is corrected to match: it had discharged `PAGE-12`'s "consumers MUST be told to wrap the view in a scoped/auto-close construct" clause by naming `await using` alongside `for await`, which no longer type-checks. It now names the two constructs that do give the guarantee — a `for await` loop, or `.return()` from a `finally` when you drive the iterator by hand — and says why `await using` is not a third.

  Kept as **minor** rather than major because these packages are pre-1.0 (`0.0.0`), per the same semver initial-development carve-out the earlier `Body` narrowing used.

### Patch Changes

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
- Updated dependencies [c1eb3aa]
  - @dexpace/core@0.1.0
  - @dexpace/transport-shared@1.0.0
