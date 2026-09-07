# Phase 6b — Server-Sent Events Implementation Plan — Checklist

Verification of [2026-07-28-phase6b-sse.md](./2026-07-28-phase6b-sse.md) against every requirement ID in
`docs/product-spec/13-server-sent-events-and-streaming.md` (`SSE-1`–`SSE-41`), as dispositioned by
`docs/work/mvp/phase6/phase6b/2026-07-28-phase6b-sse-design.md`.

**Status: EXECUTED (2026-08-27).** Every task below is implemented and tested across 1,497 repository tests, 40 script tests, and 79 Node conformance tests. Deviations, deferrals, and design rationales are recorded in `docs/work/mvp/2026-09-04-open-items-dissolution.md` §I and the roadmap design.

**Legend:** ✅ Implemented and tested — ✅(t) Satisfied by construction, with a test as the only possible evidence — ⏳ Deferred (named target phase) — N/A Not applicable in this port.

---

## §13.1 — Event Model (`SSE-20`–`SSE-22`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-20 | MUST | Immutable `SseEvent` with defensively copied `data` lines | ✅ | Task 1 — `packages/core/src/sse/event.ts` (`makeSseEvent()`). `event.test.ts` asserts `Object.isFrozen(event)` and `Object.isFrozen(event.data)`. |
| SSE-21 | MUST | Value equality and string representation | ✅ | Task 1 — `packages/core/src/sse/event.ts` (`sseEventsEqual()`, `sseEventToString()`). Tested in `event.test.ts`. (Hash equality is N/A in JS, recorded in §I). |
| SSE-22 | MUST | `isSseEventEmpty` predicate (comment counts as content) | ✅ | Task 1 — `packages/core/src/sse/event.ts` (`isSseEventEmpty()`). Tested in `event.test.ts`. |

---

## §13.2 — Line Framing, Parsing & Grammar (`SSE-1`–`SSE-19`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-1 | MUST | Dispatch on blank line & reset per-block accumulators | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-2 | MUST | `\n`, `\r`, and `\r\n` line framing | ✅ | Task 2 — `packages/core/src/sse/line-reader.ts`. Tested across split chunk boundaries in `line-reader.test.ts` and `line-reader.property.test.ts`. |
| SSE-3 | MUST | First-colon field splitting | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-4 | MUST | Present-but-empty recorded as `""`, distinct from absent (`undefined`) | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-5 | MUST | Single leading `U+0020` space stripped | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-6 | MUST | Leading `:` captures comment (latest wins) & dispatches | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-7 | MUST | Unknown fields silently ignored | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-8 | MUST | `data` lines accumulated in wire order as `string[]` | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-9 | MUST | `id` with `\u0000` dropped completely | ✅ | Task 3 — `packages/core/src/sse/parser.ts` & `event.ts`. Tested in `parser.test.ts` and `event.test.ts`. |
| SSE-10 | MUST | `event` not defaulted to `"message"` | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-11 | MUST | `retry` digits-only ASCII capped at `Number.MAX_SAFE_INTEGER` | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-12 | MUST | Leading UTF-8 BOM stripped via lookahead (`peek()`) once at stream start; later BOMs preserved | ✅ | Task 2 — `packages/core/src/sse/line-reader.ts`. Tested in `line-reader.test.ts`, `parser.test.ts`, and `test/node-conformance/sse.test.mjs`. |
| SSE-13 | MUST | Permissive dispatch (any of the 5 fields set emits event) | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-14 | MUST | EOF dispatch of pending fields | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-15 | MUST | Stable end sentinel (`SSE_END`) | ✅ | Task 2 + Task 3 — `packages/core/src/sse/line-reader.ts` & `parser.ts`. Tested in `line-reader.test.ts` and `parser.test.ts`. |
| SSE-16 | MUST | Single-pass; no `last-event-id` state retention across events | ✅ | Task 3 — `packages/core/src/sse/parser.ts`. Tested in `parser.test.ts`. |
| SSE-17 | MUST | Parser does not close or own `BufferedSource` | ✅ | Task 2 + Task 3 — `packages/core/src/sse/line-reader.ts` & `parser.ts`. Tested in `parser.test.ts`. |
| SSE-18 | MUST | Single-consumer model re-expressed as single-pass AsyncGenerator | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-19 | MUST | Configurable line cap (`maxLineBytes` / `SseLineTooLongError`) | ✅ | Task 2 — `packages/core/src/sse/line-reader.ts`. Tested in `line-reader.test.ts`. |

---

## §13.3 — Stream Facade & Resource Management (`SSE-23`–`SSE-32`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-23 | MUST | Exactly-once resource release across all termination paths | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `lifecycle.test.ts` (6-path matrix). |
| SSE-24 | MUST | Clean stream termination automatically releases resource | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts` and `lifecycle.test.ts`. |
| SSE-25 | MUST | Partial consume release via iterator `.return()` / early `break` | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts` and `lifecycle.test.ts`. |
| SSE-26 | MUST | Re-iteration throws `SseStreamError` | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-27 | MUST | Post-close iteration throws `SseStreamError`; mid-pull close ends cleanly | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-28 | MUST | Idempotent `close()` | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-29 | MUST | Mid-stream failure releases resource first; close error suppressed | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-30 | MUST | Clean terminal release failure swallowed/reported out-of-band; explicit `close()` propagates | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-31 | MUST | Close during in-flight read mapped to `IoError` | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts` and `test/node-conformance/sse.test.mjs`. |
| SSE-32 | MUST | `sseStreamFrom` binds response body lifecycle; rejects bodyless response | ✅ | Task 7 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |

---

## §13.4 — Typed Adapter (`SSE-33`–`SSE-36`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-33 | MUST | Typed adapter passes raw event name + newline-joined data | ✅ | Task 6 — `packages/core/src/sse/typed.ts`. Tested in `typed.test.ts`. |
| SSE-34 | MUST | `MapperOutcome<T>` union (`mapperValue`, `MAPPER_SKIP`, `MAPPER_DONE`) | ✅ | Task 6 — `packages/core/src/sse/typed.ts`. Tested in `typed.test.ts`. |
| SSE-35 | MUST | Lazy per-element mapping | ✅ | Task 6 — `packages/core/src/sse/typed.ts`. Tested in `typed.test.ts`. |
| SSE-36 | MUST | Throwing mapper releases resource before propagating error | ✅ | Task 6 — `packages/core/src/sse/typed.ts`. Tested in `typed.test.ts`. |

---

## §13.5 — Boundaries, Flow Control & Isolation (`SSE-37`–`SSE-41`)

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SSE-37 | MUST | Zero serde dependencies in core SSE | ✅ | Task 8 — `scripts/verify-sse-37.mjs`, asserted in CI and `test:scripts`. |
| SSE-38 | MUST | No reconnect or `Last-Event-ID` path in core SSE | ✅ | Task 8 — `scripts/verify-sse-37.mjs`, asserted in CI and `test:scripts`. |
| SSE-39 | MUST | Pull-based flow control (1:1 with consumer demand) | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-40 | MUST | Single-pass lazy view reusing reader | ✅ | Task 5 — `packages/core/src/sse/stream.ts`. Tested in `stream.test.ts`. |
| SSE-41 | MAY | Reactive adapter view (`Observable`) | ⏳ | Deferred to Phase 8b (`@dexpace/rx`). Recorded in §I and roadmap. |
