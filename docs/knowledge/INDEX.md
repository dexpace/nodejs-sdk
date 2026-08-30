# Knowledge Index

| topic | file | entries | roles | conflicts | last harvest |
| --- | --- | --- | --- | --- | --- |
| api-design | `api-design.md` | 32 | styleguide | 0 | 2026-07-25 |
| assertions | `assertions.md` | 6 | styleguide | 0 | 2026-07-25 |
| authentication | `authentication.md` | 49 | design, spec | 0 | 2026-07-25 |
| cancellation-and-timeouts | `cancellation-and-timeouts.md` | 17 | design, spec | 0 | 2026-07-25 |
| concurrency-and-async | `concurrency-and-async.md` | 65 | spec, styleguide | 0 | 2026-07-25 |
| configuration | `configuration.md` | 51 | design, spec | 0 | 2026-07-25 |
| cross-cutting-invariants | `cross-cutting-invariants.md` | 7 | spec | 0 | 2026-07-25 |
| data-modeling | `data-modeling.md` | 27 | styleguide | 0 | 2026-07-25 |
| deliberate-deviations | `deliberate-deviations.md` | 13 | design | 0 | 2026-07-25 — **STALE, see below** |
| documentation | `documentation.md` | 21 | styleguide | 0 | 2026-07-25 |
| error-handling | `error-handling.md` | 43 | spec, styleguide | 0 | 2026-07-25 |
| execution-context | `execution-context.md` | 33 | spec | 0 | 2026-07-25 |
| function-design | `function-design.md` | 24 | styleguide | 0 | 2026-07-25 |
| http-domain-model | `http-domain-model.md` | 59 | design, spec | 1 | 2026-07-25 |
| io-and-byte-streams | `io-and-byte-streams.md` | 41 | spec | 0 | 2026-07-25 |
| message-bodies | `message-bodies.md` | 46 | design, spec | 0 | 2026-07-25 |
| module-organization | `module-organization.md` | 22 | styleguide | 0 | 2026-07-25 |
| naming-conventions | `naming-conventions.md` | 32 | styleguide | 0 | 2026-07-25 |
| observability | `observability.md` | 63 | design, spec | 0 | 2026-07-25 |
| package-and-dependency-layout | `package-and-dependency-layout.md` | 31 | design, spec | 0 | 2026-07-25 |
| pagination | `pagination.md` | 61 | design, spec | 0 | 2026-07-25 |
| performance | `performance.md` | 35 | styleguide | 0 | 2026-07-25 |
| pipeline | `pipeline.md` | 83 | design, spec | 1 | 2026-07-25 |
| redaction-and-security | `redaction-and-security.md` | 22 | spec | 0 | 2026-07-25 |
| redirect-handling | `redirect-handling.md` | 32 | design, spec | 0 | 2026-07-25 |
| resource-management | `resource-management.md` | 36 | styleguide | 0 | 2026-07-25 |
| retry-and-resilience | `retry-and-resilience.md` | 68 | design, spec | 0 | 2026-07-25 |
| sdk-positioning | `sdk-positioning.md` | 20 | design, spec | 0 | 2026-07-25 |
| seams-and-extensibility | `seams-and-extensibility.md` | 50 | design, spec | 0 | 2026-07-25 |
| serde | `serde.md` | 54 | design, spec | 0 | 2026-07-25 |
| sse-streaming | `sse-streaming.md` | 62 | design, spec | 0 | 2026-07-25 |
| styleguide-overview | `styleguide-overview.md` | 51 | styleguide | 0 | 2026-07-25 |
| testing | `testing.md` | 35 | styleguide | 0 | 2026-07-25 |
| tooling-and-quality-gates | `tooling-and-quality-gates.md` | 54 | design, spec, styleguide | 3 | 2026-07-25 |
| transport-adapter | `transport-adapter.md` | 37 | spec | 0 | 2026-07-25 |
| type-system | `type-system.md` | 29 | styleguide | 0 | 2026-07-25 |
| typescript-idioms | `typescript-idioms.md` | 19 | styleguide | 0 | 2026-07-25 |
| url-and-query-encoding | `url-and-query-encoding.md` | 20 | design, spec | 0 | 2026-07-25 |
| variables-and-declarations | `variables-and-declarations.md` | 14 | styleguide | 0 | 2026-07-25 |

## Stale topics

One row above is annotated rather than refreshed, because re-harvesting is `knowledge-harvest`'s job and that
skill is user-invoked only. Flagged 2026-08-30 by Phase 10.

- **`deliberate-deviations`** — harvested from the **12-item pre-implementation prediction** in
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (`05d649a`, 62 lines). That
  source is now a 238-line, 17-item as-built ledger, corrected twice since (`a0d734d`, `27fb81f`). All 13
  entries are mis-anchored, the `sha:f9ecb6e7d87b` pin in `SOURCES.md` no longer matches (current:
  `301f1d519cd8`), and two entries are substantively false — both carry an inline `**Stale…**` marker so the
  correction reaches `bun run knowledge` output. Full detail in the topic file's own head banner. **Unblock:**
  a `knowledge-harvest` run over that one source, which re-pins `SOURCES.md`, the `<sub>` lines, and this row.
