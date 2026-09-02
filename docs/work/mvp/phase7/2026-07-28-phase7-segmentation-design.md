# Phase 7 Segmentation — Design

**Status:** Draft, approved for planning.

**Purpose:** Record why and how Phase 7 ("Instrumentation & Configuration") splits before either sub-phase gets
its own detailed design, mirroring the sizing review that split Phases 3, 4, 5, and 6. This document is the
segmentation rationale only; the two sub-phases' full designs are
[7a (Configuration & Platform Primitives)](./phase7a/2026-07-28-phase7a-configuration-design.md) and
[7b (Instrumentation & Observability)](./phase7b/2026-07-28-phase7b-observability-design.md).

## 1. Sizing

Phase 7 as tabled covers `docs/product-spec/15-instrumentation-and-observability.md` (`OBS-1`–`OBS-40`, 40 IDs)
and `docs/product-spec/16-configuration.md` (`CFG-1`–`CFG-38`, 38 IDs) — 78 combined normative requirements.
That sits at the same threshold that forced Phase 3 (~79) and Phase 4 (~76) to split, comfortably below Phase 5's
111 and Phase 6's 107 but well past the point those two splits established as "too large for one spec." Six rows
in the roadmap's Deferred Items Log target "Phase 7" by name, and they partition cleanly across the same §15/§16
line — see §3 below.

Unlike Phase 6 (`PAGE`/`SSE`/`SERDE`), where the spec's own coupling bans (`SSE-37`, §12's serde-agnosticism
preamble) left **zero** cross-segment contract surface, §15 and §16 have one real, if soft, dependency: `OBS-35`
(`SHOULD`) resolves the HTTP logging granularity through the layered configuration lookup `CFG-1` defines, and
leans on a well-known log-level key constant `CFG-14` (`SHOULD`) says should exist. Nothing in §16 depends on
§15. This is a real, if soft, coupling, not a contract-surface split like Phase 6's — see §4 for what it means
for ordering.

## 2. The cut

- **7a — Configuration & Platform Primitives** (§16, `CFG-1`–`CFG-38`): the layered `Configuration` model, `Clock`
  and async primitives, the proxy model, RFC 1123 dates, UUID generation, deep equality, the retryability
  classifier, and the build/runtime version descriptor.
- **7b — Instrumentation & Observability** (§15, `OBS-1`–`OBS-40`): the `Logger`/`LogEvent` facade, the
  diagnostic-context (MDC) allow-list, the redaction policy, tracing (`Tracer`/`Span`, W3C trace context),
  the metrics SPI, and the HTTP logging granularity/body-preview/event-vocabulary machinery — the `LOGGING`
  pillar step itself.

Both new packages named in the roadmap's phase table, `@dexpace/logging-pino` and `@dexpace/logging-debug`, are
7b's — they are `Logger` adapters, not configuration.

## 3. Deferred Items Log disposition

| Item | Originated in | Goes to |
|---|---|---|
| `Logger`/`LogEvent` seam | Phase 2 | **7b** |
| Real W3C Trace Context generation (trace-id/span-id byte generation, hex encoding) | Phase 4a | **7b** |
| `RECOV-33` — client-identity header step | Phase 5a brainstorm | **7a** (configuration-driven, no retry coupling — as 5a's own design already reasoned) |
| `standardResilience()` gains a `LOGGING` pillar step | Phase 5c brainstorm | **7b** |
| Redirect structured logging (`SHOULD`-level hop/loop/downgrade events) | Phase 5b brainstorm | **7b** |
| `NFR-15` — self-identifying version metadata (real `User-Agent`, never a placeholder) | Phase 0 | **7a** (`CFG-36`'s build/runtime descriptor is the mechanism; `RECOV-33`'s step, also 7a, is what stamps it) |

`NFR-15` and `RECOV-33` land in the same sub-phase deliberately: `CFG-36`'s token list is explicitly scoped
"for User-Agent-style composition," and `RECOV-33`'s client-identity step is the only thing in either spec
section that stamps a header from it. Splitting them across 7a/7b would recreate the exact kind of cross-phase
contract 5b/5c's `cross-origin.ts` drift already warned against — see the roadmap's caution note. Both close in
7a as one unit.

## 4. Ordering

**7a leads, 7b trails.** Unlike Phase 6's three segments (explicitly "no segment depends on another... any
sub-phase may execute out of order"), 7b's `OBS-35` genuinely wants 7a's `Configuration.getString` and a
`CFG-14` key constant to exist. Building 7b first would mean either stubbing a throwaway config lookup (extra
work, thrown away) or shipping `OBS-35` unwired (a real gap, not a documented scope boundary — unlike, say,
5c's `LOGGING`-pillar omission, which had no `SHOULD` clause depending on the missing piece). 7a has no such
dependency in the other direction and is the smaller, lower-risk half — a good default lead in its own right,
independent of the coupling.

This also matches dependency order for the three retrofits identified during 7a's own brainstorm (§16.4's `Clock`
seam absorbing 5a's ad hoc `now`/`random` injection point; §16.6's RFC 1123 formatter/parser absorbing 5a's
private `pacing.ts` parser; `CFG-35`'s shared retryability classifier absorbing 5a's private `classify.ts` status
set) — all three are 7a amendments to already-written phases, unrelated to 7b.

**They do, however, invert 7a's order against Phase 5.** All three retrofits point 5a's plan at 7a modules, so
7a's `config/` must be *executed* before 5a's plan runs — and 7b's parallel amendments do the same for 5b's Task
6 and 5c's Task 16. The 7a-leads-7b ordering above is about the two sub-phases relative to each other; relative
to the roadmap as a whole, both sub-phases move ahead of Phase 5's execution. See the roadmap's "Execution order
is no longer the numeric order for Phase 5" note and each affected plan's Prerequisite section.

## 5. Roadmap changes this decision implies

- Phase table row 7 splits into 7a / 7b, package column unchanged (`@dexpace/core` for both, plus
  `@dexpace/logging-pino`/`@dexpace/logging-debug` for 7b).
- The Deferred Items Log rows in §3 above are updated in place to point at 7a/7b instead of bare "Phase 7."
- Three new deferred-item rows this segmentation itself produces, added to the roadmap's log:

  | Item | Originated in | Target | Note |
  |---|---|---|---|
  | 5a's `RetryConfig.clock`/`random` retyped against 7a's real `Clock` seam, replacing its ad hoc injection point | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | Single-sources the injectable-determinism seam 5a's own design already noted it was pre-empting |
  | 5a's private RFC 1123 parser in `pacing.ts` re-sourced from 7a's shared `http-date.ts` | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | 7a's module is a superset (adds the formatter 5a never needed); 5a's parser becomes an import, not a second implementation |
  | 5a's private `RETRYABLE_STATUSES`/`isRetryableStatus` in `classify.ts` re-sourced from 7a's `config/retryable.ts` | Phase 7a brainstorm | 7a (doc amendment to 5a's design/plan) | `CFG-35` mandates one shared retryability definition; 7a ships the identical `RETRY-1` set and 5a re-exports it unchanged |
