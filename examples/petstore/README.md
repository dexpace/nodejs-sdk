# Petstore codegen canary

A **throwaway spike**, not a shipped example. It answers one question for
[issue #64](https://github.com/dexpace/nodejs-sdk/issues/64): does the Python SDK's codegen contract
port onto `@dexpace/core` as it stands, and what exactly is missing?

The answer is [FINDINGS.md](./FINDINGS.md). Read that first — this file is only how to run it.

Nothing here is a workspace package, nothing is published, and no CI step runs any of it. It lives
outside `packages/` and `tests/` on purpose. One gate does see it — `bun run lint` — which is
[finding 7](./FINDINGS.md#7-gts-lint--does-reach-examples--the-isolation-claim-was-four-fifths-right).

## What it is

A frozen OpenAPI document, a deterministic generator, a projection-only facade, a hand-written
executor, and an end-to-end canary over an in-memory transport. The document in `spec/` is
byte-identical to the Python witness's, so the same fixture drives both ports.

The generator emits **data and delegation, never logic**: an operation table plus a facade whose
every method binds arguments into an `OperationInput` and calls the shared `ServiceCore`. Everything
behavioural — request assembly, pipeline, retry, auth resolution, error mapping, pagination, SSE —
stays in `@dexpace/core` or in the executor the spike was written to measure.

## Layout

| Path | What |
|---|---|
| `spec/petstore.openapi.json` | The frozen document. Never edited by anything here. |
| `generate.mjs` | Renders `src/_generated/`. Deterministic, Prettier-formatted. |
| `src/models.ts` | Hand-written models plus a `Schema<T>` per model. |
| `src/operation.ts` | The `Operation` / `OperationInput` split core does not have. |
| `src/errors.ts` | Typed errors plus the local `StatusErrorMap`. |
| `src/support.ts` | The binders the generated facade names. |
| `src/service-core.ts` | The executor — the payload of the spike. |
| `src/fake-transport.ts` | A local in-memory `Transport`. |
| `src/_generated/` | **Generated. Never hand-edit** — `regen.test.ts` fails if you do. |

## Running it

From the repository root, after `bun install --frozen-lockfile`:

```bash
bun run build                                       # required: the example resolves core via dist/
node examples/petstore/generate.mjs                 # rewrite src/_generated/
bun test ./examples/petstore                        # canary + regen guard
bunx tsc -p examples/petstore/tsconfig.json --noEmit
bunx eslint examples/
```

`bun test ./examples/petstore` needs the `./` prefix — a bare `examples/petstore` is treated as a
test-name filter and matches nothing.

## Regenerating

`src/_generated/` is checked in and byte-compared against a fresh render on every test run. To
change what is generated, edit `generate.mjs` (or the frozen document), then:

```bash
node examples/petstore/generate.mjs && bun test ./examples/petstore
```

A Prettier upgrade can also move the bytes, since the generator formats its output through
`gts/.prettierrc.json`. The regen test is what tells you to re-run the script.
