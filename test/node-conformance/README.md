# Node-runtime conformance suite

Closes checkpoint §5.9 (`docs/superpowers/plans/2026-07-25-checkpoint-scaffold-through-phase3a.md:341`).

`bun test` runs the whole unit suite on **Bun's** runtime and proves nothing about the runtime this SDK
actually ships to. Bun's Web Streams, `AbortSignal`, and `Uint8Array`/async-iteration behavior are independent
implementations of Node's, and `packages/core/src/io/` — chunk boundaries, backpressure timing, reader-lock
discipline, `queueMicrotask` ordering — is exactly the kind of code where they diverge. The `no node: imports`
grep proves the code is runtime-*agnostic in its imports*, which is a much weaker claim than runtime-*correct
on Node*.

This layer is **thin and additive**, not a second unit suite. `bun test` stays the unit-test runner, unchanged
— `docs/knowledge/testing.md` mandates `bun:test` symbol imports, `setSystemTime`, and `--concurrent`, so
migrating the suite to `node:test` would be a styleguide deviation plus a whole-suite rewrite, and it buys
nothing for the pure-logic majority (`Headers`/`MediaType`/`QueryParams` parsing cannot behave differently on
Node).

## Rules

- **Import the built artifact, never `src/`.** Public surface comes in through the `@dexpace/core` specifier;
  `io/` is `@internal` with no public subpath in `exports`, so it is reached by direct `dist/` file path. Run
  `bun run build` first — `test:node` does not build for you, because the CI job builds once and then runs the
  matrix.
- **Assert runtime-divergent behavior only.** Anything that is pure logic belongs in `bun test`, where it runs
  faster and closer to the code. A case here should be one you could imagine failing on one runtime and passing
  on the other.
- **Must pass on the declared floor.** `package.json` `engines.node` is the contract; CI runs this suite as a
  matrix over that floor and current LTS. Do not reach for an API newer than the floor without moving the floor
  in the same change.

## Membership rule

**A phase that touches a runtime-divergent surface adds a case here, not only to `bun test`** (§5.9:378). That
means Phase 4 (pipelines, where `NFR-11`'s async-framework-leak check lands) and Phase 8 (concrete
`fetch`/`undici` transports, where this stops being precautionary and becomes the point).

## Files

| File | Surface |
|---|---|
| `seams.test.mjs` | `AbortSignal.any()` composition — folded in from the retired `scripts/verify-node-floor.mjs`, whose two assertions were the only Node coverage that existed before this suite |
| `io-byte-stream.test.mjs` | Phase 3a's `ByteQueue`, `BufferedSource` + views, `BufferedSink`, `TeeSink`, `writeAll` |
| `body-lifecycle.test.mjs` | Phase 3b's public body surface over real Node Web Streams — reader-lock discipline, `pipeTo` ownership, multipart framing, error-body buffering |
