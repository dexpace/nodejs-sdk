---
"@dexpace/core": minor
---

Give `AuthTiers.operation` a source: `RequestOptions` gains `operationAuth`, a second per-call slot
that `effectiveTiers()` folds into AUTH-4's middle tier (AUTH-4, AUTH-5, AUTH-6, AUTH-7). Additive —
no signature changed and no behavior changed for a caller who does not set it.

`AuthTiers` has always resolved `perCall ?? operation ?? client`, and nothing in the workspace could
write the middle slot. The cost was measured rather than assumed: `examples/petstore/FINDINGS.md` §4
found that a consumer with per-operation descriptors had to fold them itself —
`const auth = call.auth ?? operation?.auth` — which reimplements the top two-thirds of AUTH-4's
precedence chain in consumer code, and leaves core unable to tell a caller's genuine per-call
override from an operation's declared requirement once they arrive in the same slot. Every generated
SDK would have carried that fold.

```ts
const options = RequestOptions.newBuilder()
  .auth(callerOverride) // may be undefined
  .operationAuth(operation.auth) // the operation table's static declaration
  .build();
```

`effectiveTiers()` applies each slot only when present, so a configured tier is never overwritten
with `undefined` — spreading an absent `perCall` would have erased one the AUTH step was constructed
with.

The other option the spike named — carrying the operation descriptor as a separate `StepContext`
field — was not taken. `StepContext.options` already travels from `Runtime.send` through every retry
attempt and redirect hop, and is where `authStep` reads the per-call descriptor today; a parallel
carrier for the same lifetime would have widened the pipeline's plumbing for one consumer.

Verified by deleting the fold it exists to remove: `examples/petstore/src/service-core.ts` now fills
both slots and lets core resolve the chain, and the spike's canary passes unchanged.

See `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1.
