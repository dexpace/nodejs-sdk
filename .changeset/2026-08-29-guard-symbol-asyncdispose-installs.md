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

`await using page = ...` / `await using transport = ...` therefore no longer type-checks. This is deliberate: the declaration was only ever true on Node 20.4+, and on the floor it type-checked a call that silently did nothing — for `undiciTransport` that meant leaking every pooled connection. Call `close()` instead, which has always been the real teardown path and is unchanged. Consumers pinned to Node 20.4+ who want `await using` back can reach the installed symbol through a cast, or the floor can be raised to `>=20.4` in a later release, which would restore the declaration honestly.

Kept as **minor** rather than major because these packages are pre-1.0 (`0.0.0`), per the same semver initial-development carve-out the earlier `Body` narrowing used.
