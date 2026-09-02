# Contributing

Thanks for your interest in the Dexpace Node.js SDK. External pull requests
are welcome — this page covers everything you need to get a change merged.

## Setup

The repository is a [Bun](https://bun.sh)-managed workspace of eleven
packages, nine of them published. One install provisions everything along
with the dev toolchain. The Bun version is pinned in `.bun-version`, which
CI resolves — use it:

```bash
git clone https://github.com/dexpace/nodejs-sdk.git
cd nodejs-sdk
bun install --frozen-lockfile
```

## Quality gates

Every pull request must pass the same 20 steps CI runs, across two jobs and
on both Node 20.3 and current LTS. One command runs all of them locally, in
CI's own order:

```bash
node .claude/skills/ci-preflight/run-ci.mjs --clean
```

Run it before opening a PR; `--clean` starts it from the tree CI checks out
rather than a warm one. A consumer-facing change also needs a changeset —
`bun run changeset`, not `bunx changeset`, because the wrapper renames the
generated file — and a change to a package's exports needs its API report
regenerated with `api:local` in that package and committed.

## Conventions

The full convention set lives in [`CLAUDE.md`](CLAUDE.md). The essentials:

- **Branch off `mvp`, not `main`.** `mvp` is the integration branch and
  merges into `main` when the MVP is complete; GitHub still offers `main`
  as the base, so change it.
- **`bun run build` before `bun run test`.** Every package reaches
  `@dexpace/core` through `packages/core/dist/`; without a build the tests
  cannot resolve it, and against a stale one they pass over yesterday's core.
- **`bun run test` is the only invocation that reaches both test trees**
  (`bun test ./packages ./tests`) — a bare `bun test` silently runs
  `packages/` alone. `bun run test:node` is the separate Node-runtime suite.
- **ESM-only, NodeNext**: relative imports carry `.js` even in `.ts` source,
  type-only imports need `import type`, and `erasableSyntaxOnly` rules out
  enums and namespaces.
- **No new runtime dependencies.** Every published package ships a
  hard-committed empty `dependencies`; new third-party needs belong behind
  the `Transport` or `Serde` seams, or in a new adapter package (SEAM-1,
  gate-enforced).
- **MIT licence header** (`// SPDX-License-Identifier: MIT`) on line 1 of
  every source file, src and tests alike; functions capped at 70 lines.

## Commit messages

Use the prefixes the history already follows:

| Prefix   | Use for                          |
|----------|----------------------------------|
| `feat:`  | new features                     |
| `fix:`   | bug fixes                        |
| `chore:` | refactors and cleanup            |
| `docs:`  | documentation-only changes       |
| `test:`  | tests only                       |
| `ci:`    | CI configuration                 |

## Reporting issues

Open one at [github.com/dexpace/nodejs-sdk/issues](https://github.com/dexpace/nodejs-sdk/issues).
For security vulnerabilities, follow [`SECURITY.md`](SECURITY.md) instead of
opening a public issue.
