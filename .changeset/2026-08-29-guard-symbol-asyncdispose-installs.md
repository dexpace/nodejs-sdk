---
"@dexpace/core": minor
"@dexpace/transport-fetch": minor
"@dexpace/transport-undici": minor
---

Guard every `[Symbol.asyncDispose]` install behind a runtime check, so disposal is never promised on a Node version that does not have the symbol.

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
