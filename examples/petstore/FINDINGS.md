# Petstore codegen spike — findings

The deliverable of [issue #64](https://github.com/dexpace/nodejs-sdk/issues/64). This is the answer
the spike was built to produce: for each gap the issue hypothesised, what the example actually had
to hand-write, and whether it belongs in `packages/core/src/codegen/`.

**Status: spike complete, all five hypotheses confirmed, five more gaps found.** The example is
throwaway. Nothing here is shipped, nothing is a package, and no CI step runs any of it.

## What was built

```
examples/petstore/
├── spec/petstore.openapi.json   byte-identical to python-sdk/examples/petstore/spec/
├── generate.mjs                 deterministic renderer, Prettier-formatted output      426 lines
├── generate.d.mts               hand-written types for the script
├── tsconfig.json                standalone; exists for eslint's projectService (finding 7)
├── src/
│   ├── models.ts                Pet / PetEvent / PetPatch + Schema<T> witnesses         158
│   ├── operation.ts             the Operation / OperationInput split (finding 3)         84
│   ├── errors.ts                PetStoreError / PetNotFoundError + StatusErrorMap        129
│   ├── support.ts               jsonBody, petPatchToWire, PET_PAGE_STRATEGY, mapper      154
│   ├── service-core.ts          the executor — the payload of the spike                  290
│   ├── fake-transport.ts        local in-memory Transport (finding 5)                    129
│   └── _generated/
│       ├── operations.ts        the operation table                                       45
│       └── client.ts            the facade                                                82
├── canary.test.ts               15 assertions end to end over the fake transport         365
└── regen.test.ts                re-render, byte-compare                                   34
```

Everything under `src/` except `_generated/` is what a real service SDK would hand-write. That is
**944 lines, of which roughly 340 are the gap**: the executor's mechanical half, the status map, the
operation split, and the fake transport. The rest — models, schemas, binders — is per-service work
that no core change removes.

## Verification

All run by hand; none is a CI step.

```bash
bun run build                                       # @dexpace/core -> dist, and the rest
node examples/petstore/generate.mjs                 # rewrite src/_generated/
bunx tsc -p examples/petstore/tsconfig.json --noEmit
bunx eslint examples/                               # clean; and `bun run lint` covers it too
bun test ./examples/petstore                        # 15 pass, 0 fail
bun run test                                        # 164 files — UNCHANGED from the pre-scaffold run
```

The isolation premise held on the number that mattered: `bun run test` collected **164 files before
the scaffold and 164 after**. It did not hold completely — see finding 7.

---

## Confirmed hypotheses

### 1. No executor tier — confirmed, and it is thin

Nothing in `@dexpace/core` exports an object with `execute` / `executeRequest` / `paginate` /
`events` plus ownership-aware close. `src/service-core.ts` is that object. Stripped of its comments
it is about 90 lines, and it is thin for one specific reason worth recording:

**`Runtime implements Transport` (PIPE-26) is what collapses the layer.** The same pipeline drops
into `new Paginator({transport: runtime, ...})`, into a bare `runtime.send()`, and into the response
`sseStreamFrom()` opens, with no adapter anywhere. Python needs a `ServiceCore` and an
`AsyncServiceCore`; Node needs one, and it delegates rather than bridges.

**Ownership is free, not implemented.** `Runtime.close()` is a documented no-op that never touches
its terminal transport (PIPE-27), so "borrowed" costs no bookkeeping — the executor closes the
transport it built the preset around, and nothing else. Both close semantics are asserted in the
canary.

**Verdict — belongs in core**, as `packages/core/src/codegen/service-core.ts`. It is the smallest of
the four gaps to lift and the one every service SDK would otherwise copy verbatim.

### 2. No declarative status-to-error map — confirmed

`decodeSuccessResponse` routes every 4xx/5xx through `toHttpError`, which produces `HttpStatusError`
and nothing else. `src/errors.ts` is the local `StatusErrorMap`: a `ReadonlyMap<number, ctor>` plus a
fallback, validated at construction, applied by `remapStatusError` in the executor's `catch`.

Two things the spike learned that the issue did not anticipate:

- **The Node disjointness rule is nearly structural.** Python must enforce that a mapped class
  extends `HttpResponseError` and does not extend `OSError`, because both are reachable by
  multiple inheritance. Node's tree is `DexpaceError` -> {`HttpStatusError`, `IoError`,
  `TransportFailureError`, ...} and single inheritance makes overlap impossible. The check is still
  worth having — nothing stops a caller mapping a 404 to an `IoError` subclass — but it is one
  `instanceof` on the prototype, not a lattice walk.
- **The re-map is post-hoc, and that is lossy.** By the time `remapStatusError` runs, `toHttpError`
  has already drained the body into its bounded buffer and closed the response. A mapped error class
  can therefore only ever see what `HttpStatusError` kept: status, media type, and up to 1 MiB of
  bytes. If the map lived in core it could construct the typed error **at the drain site**, and a
  service error class could be handed a decoded error payload rather than raw bytes.

**Verdict — belongs in core**, and specifically at the `toHttpError` call site rather than wrapped
around it, so the second point above stops being a limitation.

### 3. `OperationDescriptor` merges the static and per-call halves — confirmed, and the fix is additive

Four of `OperationDescriptor`'s six fields (`pathParams`, `query`, `headers`, `body`) change per
call, so it cannot be the module-level constant an operation table needs, and it has no slot for an
operation's declared auth. `src/operation.ts` splits it:

```ts
Operation      = {name, method, pathTemplate, auth?}   // frozen once, at module load
OperationInput = {pathParams?, query?, headers?, body?}  // per call
assemble(op, input) -> OperationDescriptor               // two lines
```

**The compatibility question in the issue resolves in favour of "no break".** `Operation &
OperationInput` is exactly `OperationDescriptor` plus `name` and `auth`. Core can introduce both
halves and re-express `OperationDescriptor` as their union without touching a single published
signature; `buildRequest(baseUrl, operation)` keeps its exact shape and every existing caller keeps
compiling.

**Verdict — belongs in core**, as a purely additive reshape. No deprecation, no major version.

### 4. The `operation` auth tier has no source — confirmed, and now measured

`docs/deferred-items.md` records the `operation` tier as **BLOCKED — no source layer exists on this
roadmap**. This spike is that layer, and here is exactly what its absence costs.

`AuthTiers` is `perCall ?? operation ?? client`, resolved inside `authStep`. `RequestOptions.auth`
fills `perCall`; the step's own settings fill `client`; nothing fills `operation`. So the executor
folds the operation's descriptor into the `perCall` slot:

```ts
const auth = call.auth ?? operation?.auth;   // service-core.ts, requestOptions()
```

Three consequences, all real:

1. **AUTH-4's precedence chain is reimplemented outside core.** The top two-thirds of it live in a
   consumer's executor. Every generated SDK would carry the same two-line `??`.
2. **Core cannot tell the two tiers apart.** Once folded, a caller's genuine per-call override and
   an operation's declared requirement occupy the same slot. The executor resolves the collision
   before core sees it; core has no way to audit, log, or diagnose which tier actually won.
3. **`AuthTiers.operation` stays dead.** It is a documented public field with no writer anywhere in
   the workspace.

**What works correctly and needed no help:** presence-selects-the-tier. The canary asserts all three
outcomes — the operation tier beating a client `API_KEY` default, an operation with no descriptor
falling back to that default, and a present-but-unsatisfiable `OAUTH2` requirement raising
`AuthResolutionError` **with `transport.calls` still empty**. AUTH-4/AUTH-5/AUTH-6 are mechanically
right; only the plumbing is missing.

**Verdict — the smallest useful fix is a second per-call slot.** Either `RequestOptions` gains
`operationAuth?: AuthDescriptor` (filling `AuthTiers.operation` in `effectiveTiers`), or
`StepContext.options` carries the operation descriptor separately. Either makes the fold above
disappear and `AuthTiers.operation` live. This closes the `deferred-items.md` row.

### 5. `FakeTransport` and `countingResponse` are unreachable — confirmed

They live at `packages/core/src/testing/fake-transport.ts` and are absent from the package barrel.
Reaching them means deep-importing `packages/core/src/` while everything else resolves
`@dexpace/core` to `packages/core/dist/` — two copies of core, two `HttpStatusError` classes, every
cross-boundary `instanceof` silently false. The example wrote its own instead: `src/fake-transport.ts`,
129 lines including its own body-draining helper, because `Body` exposes `writeTo(sink)` and no byte
accessor.

**Verdict — worth deciding, and the answer is probably a separate package.** Exporting the testing
helpers from `@dexpace/core`'s barrel puts test doubles in every production bundle and makes them
API-report surface with a compatibility promise. A `@dexpace/testing` package with core as a peer
dependency gets the sharing without either cost. Doing nothing is also defensible: the fake is 30
mechanical lines, and every consumer writing their own is not a crisis.

**A companion positive finding.** Python needs a `_PetPageStrategy` wrapper class that re-decodes
each raw page item, because its `CursorStrategy` is configured by wire field names and yields raw
documents. Node's `cursorStrategy` takes an `extract` callback instead, so the decode happens inside
it and the wrapper has **no twin here**. `support.ts`'s `PET_PAGE_STRATEGY` is one call.

---

## New gaps, found while building

### 6. There is no encode witness — `Schema<T>` is decode-only

`Schema<T>` is `{parse(input: unknown): T}`. Nothing in the seam goes the other way. Python's
`Codec` is bidirectional: `_CODEC.encode(model)` produces the wire document, so its `json_body(model)`
is generic over every model.

Node's `serdeBody(value, serde, mediaType)` encodes **whatever object it is handed**, with no field
mapping. So a model whose field names differ from its wire names — `petId` vs `pet_id`, `weightKg`
vs `weight_kg`, which is every real API — needs a hand-written projection per model:

```ts
export function petPatchToWire(patch: PetPatch): Readonly<Record<string, unknown>> {
  return {name: patch.name, tag: patch.tag, weight_kg: patch.weightKg};
}
```

A generator can emit these — it knows both names from `components/schemas`. But there is no seam in
core to hang them on, so today the generated facade has to name a hand-written symbol from the
service's own shim, which is exactly what `client.ts` does.

**Verdict — not core's job to solve, but core should state the shape.** An `Encoder<T>` mirror of
`Schema<T>`, or a `Codec<T> = {parse; toWire}` pair, would give a generator one thing to emit
instead of a naming convention between two files.

### 7. `gts lint .` DOES reach `examples/` — the isolation claim was four-fifths right

The plan's isolation list named `bunfig.toml`, `verify-test-partition.mjs`, the tsconfig projects and
api-extractor. All four hold. It missed **Lint**, which is a blocking CI step and runs `gts lint .`
from the repository root over every file in the tree.

Two consequences, both handled here rather than by editing shared config:

- **The example needs its own `tsconfig.json`.** `eslint.config.js` runs the type-aware tier with
  `projectService: true`, which resolves each `.ts` file against the nearest enclosing tsconfig. With
  none, lint fails with *"was not found by the project service"*.
- **Generated output has to be Prettier-clean**, because formatting is an error, not a warning.
  Predicting Prettier's line breaking from a string-concatenating renderer is not viable, so
  `generate.mjs` formats its own output through the same `gts/.prettierrc.json` that
  `eslint.config.js` feeds the `prettier/prettier` rule, resolved the same way. The cost is that a
  Prettier upgrade can change the checked-in bytes — and `regen.test.ts` is what says so.

This is worth writing down for the next spike that assumes `examples/` is invisible. It is invisible
to four gates and fully visible to the fifth.

### 8. `Paginator` has no status-mapping hook

The engine hands every response to the strategy regardless of status. A mid-walk 500 therefore
reaches `extract`, fails schema validation, and surfaces as a `DeserializationError` — never as the
`StatusErrorMap`'s typed error, because the executor's mapping wraps `execute`, not the walk.

A generated SDK cannot fix this without putting status handling into every strategy, which is the
duplication `StatusErrorMap` exists to prevent. Whatever shape finding 2 takes in core, `Paginator`
needs the same treatment — most cheaply as an optional `onErrorStatus` hook on `PaginatorInit`, or
by having the engine reject on a non-2xx before the strategy is consulted.

Not exercised by the canary: the spike records the gap rather than asserting the current behaviour,
because asserting it would pin a shape that should change.

### 9. `max-params: 3` bites a generated facade

`updatePet(petId, patch, call)` is already at the repository's cap. Two path parameters plus a body
plus a call bag is four, and a real API has plenty of those. A generator targeting this repository's
lint rules must emit a single options object per method — or generated code needs an exemption.
Worth deciding before a generator exists, because it changes every rendered signature.

### 10. The document's scheme vocabulary needs a mapping table

`AuthScheme` is a closed union (`'OAUTH2' | 'API_KEY' | 'BASIC' | 'DIGEST' | 'NO_AUTH'`). The frozen
document says `bearer` and `apikey`. `generate.mjs` carries `SCHEME_BY_SPEC_NAME` and fails at
generation time on an unmapped name, which is the right time to fail. A real generator would derive
it from `components/securitySchemes` instead — but the closed union means the mapping is
**mandatory**, not a convenience, and it belongs in whatever codegen contract core publishes.

### 11. No sync/async parity gate analogue — confirmed, nothing to port

Node is async-only. One facade, no mode switch in the generator, no AST-normalising parity check.
Python's `tools/parity_check.py` and `test_petstore_parity.py` have no twin and need none.

---

## Recommendation

If `packages/core/src/codegen/` is built, it should contain, in descending order of value:

| What | Why | Size |
|---|---|---|
| `Operation` / `OperationInput` / `assemble` | Finding 3. Purely additive; unblocks a real operation table. | ~40 lines |
| The `operation` auth-tier slot | Finding 4. Closes a register row that has been blocked since Phase 5c, and stops AUTH-4 being reimplemented per SDK. | ~15 lines, plus a `RequestOptions` field |
| `StatusErrorMap` + its application at the `toHttpError` site | Finding 2. Removes a hand-written `if (status === ...)` chain from every service SDK, and fixes the post-hoc losses. | ~70 lines |
| `ServiceCore` | Finding 1. The most code, the least judgement — a delegation layer over surfaces that already compose. | ~90 lines |
| A `Paginator` status hook | Finding 8. Without it, finding 2's fix has a hole exactly the width of a paginated endpoint. | ~10 lines |

Findings 5, 6, 9 and 10 are decisions rather than code: whether testing helpers get a package,
whether the serde seam gains an encode half, whether generated code is exempt from `max-params`, and
where the scheme mapping is published.

**What this spike deliberately did not do:** design any of those APIs. The issue's sequencing was
right — the executor was built first, against the core as it stands, so the shape of each gap is now
measured rather than guessed.
