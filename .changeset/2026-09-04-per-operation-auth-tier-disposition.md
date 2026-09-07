---
"@dexpace/core": patch
---

Document `AuthTiers.operation`'s settled disposition on the field itself (AUTH-4, AUTH-5, AUTH-6,
AUTH-7). Documentation only: no behavior, no types, and no exported symbol changed, so
`packages/core/etc/core.api.md` is byte-identical — the field is still
`readonly operation?: AuthDescriptor | undefined;`.

The tier was previously described as having "no shipped source yet", with a pointer to the
roadmap's Deferred Items Log. Both halves were wrong. "Yet" read as pending work, and the pointer
dangled: that log moved out of the roadmap into `docs/deferred-items.md` on 2026-08-31 and the
roadmap's own section is a stub.

Nothing is pending. `resolveAuthRequirement` selects `perCall ?? operation ?? client`, so the
`operation` tier resolves correctly the moment a caller populates the `AuthTiers` it passes — the
tier is live, not dead code. What does not exist is an automatic source: filling it would take a
per-operation configuration layer, a code generator or a client surface, and no phase on this
roadmap ships one, so `client` and `operation` alike stay construction-time configuration.
`AUTH-4` through `AUTH-7` are mechanically satisfied either way, which is why this is a missing
source rather than an unmet requirement.

The per-call half of the same question shipped in Phase 5c and is unaffected: `RequestOptions.auth`
reaches the AUTH step through `StepContext.options` and is merged into the tier set at resolution
time.

The reasoning now lives in the code a consumer reads in the published `.d.ts` and needs no pointer,
so the row for it was closed. The register that held it, `docs/deferred-items.md`, was dissolved the
same day; the live gap this leaves — a published tier core gives consumers no way to fill — is
tracked as `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1.
