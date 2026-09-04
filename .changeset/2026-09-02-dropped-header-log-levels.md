---
"@dexpace/transport-shared": patch
---

Give `createDropLogger`'s verbosity policy real levels (OBS-19, TRANSPORT-13). Every mode used to
emit at `verbose`, so the policy was configurable in name only.

- `'all'` now warns on every occurrence.
- `'first-per-name'` — the default for both `fetchTransport()` and `undiciTransport()` — now warns
  the **first** drop of each header name and emits later drops of that name at `verbose`. It
  previously suppressed later drops entirely; OBS-19's conformance text asks for "exactly one WARN
  then verbose lines", so they are emitted rather than dropped.
- `'quiet'` is unchanged and still writes nothing, which is TRANSPORT-13's own third mode.

The visible effect is that a caller-set header the transport cannot encode — dropped rather than
thrown, per TRANSPORT-12 — is now audible at a level a production logger enables. Before this, the
drop was indistinguishable from nothing having happened.
