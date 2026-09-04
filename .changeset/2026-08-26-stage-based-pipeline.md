---
'@dexpace/core': patch
---

Add the stage-based pipeline for product-spec §8.1 (`PIPE-1`–`PIPE-40`). No public API change.

Everything this adds lives under `packages/core/src/pipeline/` and none of it is re-exported from
`src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
empty changeset because files under `packages/` did change: the published tarball carries the new
`dist/pipeline/*.js`, and a consumer stepping through the package in a debugger will see them.

What landed: `Stage` and `STAGE_ORDER`, the fixed total order from `PRE_REDIRECT` out to the reserved terminal
`SEND`, with `PILLAR_STAGES` marking the slots that admit at most one step. `Step`, `StepContext`, `Next` and
`StepDescriptor` as the step contract. `PipelineBuilder`, the surgical-edit API — `append`/`prepend`/
`appendAll`/`prependAll`/`insertAfter`/`insertBefore`/`replace`/`remove`/`reload` — flattening into an
immutable `Runtime` at `build()`. `Cursor`, one instance per call, driving the flattened array. Five typed
errors: `PillarCollisionError`, `AnchorNotFoundError`, `CrossStageEditError`, `CursorAlreadyAdvancedError`,
`ReservedStageError`.

Design calls worth recording:

- **`Runtime` implements `Transport` itself (`PIPE-26`), and its `close()` is a deliberate no-op
  (`PIPE-27`).** Phase 2's `Transport` SPI has a single `send`, so there is no second async entry point to
  delegate through. The pipeline never owns the transport it wraps, so closing the pipeline must not close it.
- **Continuations are one-shot, and a fork is a closure, not a second cursor.** `next` and every `fork()`
  handle are one-shot closures over one private recursive dispatcher indexed by array position
  (`PIPE-15`/`PIPE-16`); reusing an already-invoked handle rejects with `CursorAlreadyAdvancedError`. There is
  deliberately no settable start position — a step that must re-drive the chain calls `ctx.fork()` again. The
  dispatcher shares one mutable in-flight request, so a `PIPE-14` substitution sticks for every later step
  *and* the terminal dispatch.
- **`Stage` is a string-literal union, not an enum.** `erasableSyntaxOnly` bars enums, and `Stage` carries no
  behavior beyond ordering, which `STAGE_ORDER` alone provides. Adding a stage later is one splice into that
  array — no existing `Stage` value changes, so there is no numeric-gap renumbering to design around.
- **`prependAll` reverses its batch and `appendAll` does not.** The asymmetry falls out of prepending each
  element individually, and is the documented one `PIPE-38` allows rather than an oversight. `reload` is the
  transactional bulk path (`PIPE-23`): fully validated before any existing content is touched, so a rejected
  batch leaves the builder untouched instead of half-applied.
- **`replace` is the sanctioned way past a pillar collision.** `PIPE-5` exempts it from the pillar check;
  re-seating the *same* `type` symbol anywhere is an idempotent no-op rather than a second step (`PIPE-6`),
  which is also what keeps the bulk paths from seating two steps where `append` would seat one.
- **`send()` closes `CTX-17`'s positive half.** The first promotion installs into Phase 4a's `contextStore`,
  the exchange promotion replaces it under the same key, and the `finally` evicts whichever context was
  installed last. `exchangeSource()` is exported (still `@internal`) so its two branches can be asserted as
  the pure function they are: when a step substituted the outbound request, the exchange is promoted from an
  off-chain rebuild around the request that was *actually sent*, pinned to the same call key and carrying the
  same instrumentation bundle by reference. Promoting straight off the original would pair the response with a
  request that never left the process.

One deferral, recorded in `docs/work/mvp/2026-09-04-open-items-dissolution.md`: `StepContext` carries neither the per-call `options` nor the
`AbortSignal`. `Cursor` holds both and threads them into the terminal dispatch (`PIPE-17`), but the
"readable by any step" clause has no reader until Phase 5a's retry engine, which adds both fields as one
additive amendment.
