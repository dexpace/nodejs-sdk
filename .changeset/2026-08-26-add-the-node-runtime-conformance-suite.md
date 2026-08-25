---
---

Add the Node-runtime conformance suite.

No published package changes.

Deliberately empty — `changeset --empty` — rather than absent. Every file in this change is repository
infrastructure that ships to nobody: `test/node-conformance/`, `.github/workflows/ci.yml`, `bunfig.toml`,
`eslint.config.js`, the root `package.json` scripts, `CLAUDE.md`, and the phase docs. Zero files under
`packages/` were touched, so there is nothing for `@dexpace/core` to bump and a `patch` here would put a line
in the published changelog that means nothing to a consumer reading it.

The empty changeset records that the judgement was made, which is the difference between "this change needs no
release" and "somebody forgot a changeset". Verified before writing it:
`git show --stat --name-only e3d0b18 | grep '^packages/'` returns nothing.

What the change does, for anyone reading this file from the repository rather than the changelog: `bun test`
runs the unit suite on Bun and proves nothing about the runtime the SDK ships to. 319 of 516 unit tests
exercise a runtime-divergent surface — Web Streams, `AbortSignal`, async iteration, `ByteQueue`'s `Uint8Array`
handling — against two assertions of Node coverage that touched none of it. `test/node-conformance/` adds 30
`node --test` cases over the built artifact, wired as `test:node` and run by CI as a matrix over the declared
`engines.node` floor and current LTS. Closes checkpoint §5.9 / roadmap finding E5.
