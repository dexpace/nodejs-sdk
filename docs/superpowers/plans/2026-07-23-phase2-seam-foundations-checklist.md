# Phase 2 — Seam Foundations Implementation Plan — Checklist

Verification of [2026-07-23-phase2-seam-foundations.md](./2026-07-23-phase2-seam-foundations.md) against every
requirement ID cited in `docs/superpowers/specs/2026-07-23-phase2-seam-foundations-design.md`'s disposition table
(`docs/product-spec/03-pluggable-seams-and-extension-model.md`), plus the HTTP-29 retrofit
(`docs/product-spec/04-core-http-domain-model.md`) and the NFR-10/NFR-17 residual pulled forward from Phase 3.

**Legend:** ✅ Implemented and tested — 📄 Contract obligation only (TSDoc), conformance test owned by a later
phase — ⏳ Deferred (named reason) — N/A.

## Transport seam

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SEAM-11 | MUST | Single operation, no pre-buffering | ✅ | Task 4 — satisfied structurally by `Promise<Response>` |
| SEAM-12 | MUST | Concurrent-call safety | 📄 | Task 4, TSDoc on `send()`; conformance test is Phase 8's (needs a real transport) |
| SEAM-14 | MUST | `close()` idempotent, ownership-aware, interrupt-safe | 📄 | Task 4 — signature locked (`close(): Promise<void>`); behavior deferred to Phase 8 |
| SEAM-16 | MUST | Non-null response, or exceptional rejection | ✅ | Task 4 — `Promise<Response>` cannot type-check resolving `undefined` |
| SEAM-17 | SHOULD | Canonical async pivot is native `Promise` | ✅ | Task 4 — no code needed beyond the interface shape |
| SEAM-18 | MUST | Bridge obligations; one surviving clause: options threaded, never dropped | ✅ (residual only) | Task 4, TSDoc on `send()`. The bridge itself is **never built** — moot under the one-transport collapse |
| SEAM-30 | MUST | Cancel an orphaned response after the completion race | 📄 | Task 4, TSDoc on `send()`; implementation is Phase 8's (needs a real response to cancel) |
| XCUT-2 | MUST | Timeout vs. cancellation decidable from ambient state, not a message string | ✅ | Task 4, `isTimeoutSignal()` keyed on `signal.reason.name`, tested against both a real timeout and a `CancellationError` abort |

## Serde seam

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SEAM-19 | MUST | `mediaType` required, never defaulted | ✅ | Task 5, type-level `expectTypeOf` check |
| SEAM-21 | MUST | Explicit runtime type token for deserialization (no erased/inferred generic) | ⏳ | Deferred to Phase 6 per `sdk-design/03` §7.3. Task 5 keeps `Serde<T>` out of the public barrel (Task 7) specifically so this deferral is a non-breaking change when Phase 6 lands |

## Operation-input projection

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SEAM-26 | MUST | `OperationDescriptor`: method + path required, four projections default to empty | ✅ | Task 6, direct conformance test (parameterless GET) |
| SEAM-27 | MUST | `buildRequest()` encoding + base-URL composition rules | ✅ | Task 6 — worked example, trailing-slash normalization, empty-path no-op, base-query preservation, fragment/malformed rejection, missing-placeholder error, and the path-param `/`-encoding property test, one test per conformance note |

## Cross-cutting

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-29 (retrofit) | MUST | Shared RFC 3986 encoder, single implementation | ✅ | Task 2 — extracted to `http/rfc3986.ts`, imported by both `query-params.ts` and `operation.ts` |
| NFR-10 / NFR-17 (residual, pulled forward from Phase 3) | — | CI runs the built artifact against the *declared minimum* Node version, not just the runner default | ✅ | Task 7 — `node-floor-conformance` CI job pins `actions/setup-node@18.17.0` and runs `scripts/verify-node-floor.mjs`, which forces `composeSignal()`'s `AbortSignal.any()` branch |

## Never built (not a deferral — confirm absence, don't re-litigate)

| ID | Note |
|---|---|
| SEAM-5–SEAM-10 | Discovery/registration/conflict-resolution machinery — nothing pluggable enough to need discovering in this port |
| SEAM-18 (bridge machinery itself) | A bridge connects two transport seams; this port collapsed to one. Only the one non-bridge clause (options threading) survives, as a `send()` obligation |

## Explicitly out of scope this phase (targets recorded in the roadmap's Deferred Items Log)

| Item | Target phase |
|---|---|
| `Logger`/`LogEvent` seam | Phase 7 |
| `FakeTransport` test double | First phase that tests against `Transport` (likely Phase 4) |
| `SEAM-30` cleanup implementation | Phase 8 |
| `SEAM-14` close *behavior* | Phase 8 |
| `SEAM-12` concurrency conformance test | Phase 8 |
| Byte-stream provider implementation (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) | Phase 3 |
| `SEAM-21` type-witness mechanism | Phase 6 |
| Concrete `Serde` (`@dexpace/codec-json`) | Phase 6 |
| Concrete `Transport` (`@dexpace/transport-fetch`/`-undici`) | Phase 8 |
