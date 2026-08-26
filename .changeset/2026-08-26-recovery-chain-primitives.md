---
'@dexpace/core': patch
---

Add the recovery-chain primitives for product-spec §8.2 (`RECOV-1`–`RECOV-16`). No public API change.

Everything this adds lives under `packages/core/src/recovery/` plus two package-root helpers, and none of it is
re-exported from `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch`
rather than an empty changeset because files under `packages/` did change: the published tarball carries the
new `dist/recovery/*.js` and `dist/suppress.js`, and a consumer stepping through the package in a debugger will
see them.

What landed: `Outcome<T>` with `success`/`failure`/`fold`; `RequestRecoveryChain` and `ResponseRecoveryChain`
(defensive copies on both, concurrency-safe by construction); `dispatchWithRecovery`, whose single `try`/`catch`
wraps both the request chain and the transport hop so no throwable from either can bypass the recovery hooks;
`wrapCancellation`; and `statusMappingStep`, a thin response step over Phase 3b's unchanged `toHttpError()`.
`assertNever` joins `invariant.ts` as the codebase's first discriminated-union `default` case.

One consumer-visible-in-principle detail worth recording: `RECOV-12` pairs a step's throwable with a close
failure, which is what `SuppressedError` is for — and `SuppressedError` reached Node only in 24.0.0, against
this package's `>=20.3` floor. Rather than raise the floor and drop Node 18, 20 and 22 for one error class,
`suppress()` uses the native class where the runtime has one and returns a shape-compatible stand-in (`name`,
`error`, `suppressed`) where it does not. Code that catches one of these should read its fields, not test
`instanceof SuppressedError`.
