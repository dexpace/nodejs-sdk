# Node-runtime conformance suite

`tests/node-conformance/` — run by `bun run test:node` (`node --test tests/node-conformance/*.test.mjs`),
never by `bun test`.

Closes checkpoint §5.9 (`docs/work/mvp/2026-07-25-checkpoint-scaffold-through-phase3a.md:341`).

> **This tree must not run on Bun.** That is the only reason it exists. Until Phase 10 it lived at
> `test/node-conformance/`, outside anything `bun test` could reach; it now sits inside `tests/`, so
> `bunfig.toml`'s `[test] pathIgnorePatterns` holds the line instead — along with four other files that
> carry the same path, which `scripts/verify-test-partition.mjs` blocks CI on. **Read CLAUDE.md's "HARD RULE
> — the `tests/` partition" before moving, renaming, or nesting anything here.** It is the one place that
> rule and its reasoning are written down; this file only states what is local to the tree.

`bun test` runs the whole unit suite on **Bun's** runtime and proves nothing about the runtime this SDK
actually ships to. Bun's Web Streams, `AbortSignal`, and `Uint8Array`/async-iteration behavior are independent
implementations of Node's, and `packages/core/src/io/` — chunk boundaries, backpressure timing, reader-lock
discipline, `queueMicrotask` ordering — is exactly the kind of code where they diverge. The `no node: imports`
grep proves the code is runtime-*agnostic in its imports*, which is a much weaker claim than runtime-*correct
on Node*.

This layer is **thin and additive**, not a second unit suite. `bun test` stays the unit-test runner, unchanged
— `docs/knowledge/harvested/testing.md` mandates `bun:test` symbol imports, `setSystemTime`, and `--concurrent`, so
migrating the suite to `node:test` would be a styleguide deviation plus a whole-suite rewrite, and it buys
nothing for the pure-logic majority (`Headers`/`MediaType`/`QueryParams` parsing cannot behave differently on
Node).

## Rules

- **Name every case `*.test.mjs`, flat in this directory.** `test:node`'s glob does not descend, and
  `node --test` over a glob that matches nothing exits **0** — a case parked in a subdirectory is not a
  failure, it is a silence. `verify:test-partition` turns that silence into a red CI step.
- **Import the built artifact, never `src/`.** Public surface comes in through the `@dexpace/core` specifier;
  `io/` is `@internal` with no public subpath in `exports`, so it is reached by direct `dist/` file path. Run
  `bun run build` first — `test:node` does not build for you, because the CI job builds once and then runs the
  matrix.
- **Assert runtime-divergent behavior only.** Anything that is pure logic belongs in `bun test`, where it runs
  faster and closer to the code. A case here should be one you could imagine failing on one runtime and passing
  on the other.
- **Must pass on the declared floor.** `package.json` `engines.node` is the contract; CI runs this suite as a
  matrix over that floor and current LTS. Do not reach for an API newer than the floor without moving the floor
  in the same change. The floor is set by the *built-ins the code calls*, not by the syntax it emits — it reads
  `>=20.3` because `globalThis.crypto` is absent from ESM on every Node 18 release and `AbortSignal.any()`
  reached the 20.x line in 20.3.0, not because of anything ES2023.
- **Do not await a timer the runtime does not ref.** `AbortSignal.timeout()`'s timer is unref'd everywhere by
  design, so awaiting its `abort` event with nothing else scheduled lets the loop drain and the runner report
  `Promise resolution is still pending but the event loop has already resolved`. Hold the loop open with a ref'd
  deadline that also fails the case if the event never arrives.

## Membership rule

**A phase that touches a runtime-divergent surface adds a case here, not only to `bun test`** (§5.9:378).
Since Phase 4 that has meant most phases — pipelines, retry, redirect, auth, serde, SSE, pagination,
configuration, observability, the two concrete transports, and the RxJS bridge all have cases here. Two are
worth naming as the shape to aim for: 8a's `fetch`/`undici` transports, where this stops being precautionary
and becomes the point, and 8b's RxJS bridge, whose reason for being hand-written is a cancellation path the
runtime decides.

## Which cases exist

`ls` this directory. An earlier revision kept a table of file-to-surface descriptions here; it listed 6 of
14 by the time anyone checked, because nothing regenerated it. What each case covers, and which requirement
IDs it discharges, is recorded once — in that phase's checklist under `docs/work/mvp/phaseN/`.

One piece of provenance the tree cannot show: `seams.test.mjs` absorbed the retired
`scripts/verify-node-floor.mjs`, whose two `AbortSignal.any()` assertions were the only Node coverage that
existed before this suite. Its `globalThis.crypto` assertion is made from ESM on purpose — Node 18 exposed
`crypto` to CommonJS while leaving it undefined in ES modules, which is what sets the 20.3 floor.
