# Phase 3a — I/O Contracts Implementation Plan — Checklist

Verification of [2026-07-24-phase3a-io-contracts.md](./2026-07-24-phase3a-io-contracts.md) against every
requirement ID in `docs/product-spec/05-i-o-contracts.md`, as dispositioned by
`docs/work/mvp/phase3/phase3a/2026-07-24-phase3a-io-contracts-design.md`.

**Legend:** ✅ Implemented and tested — 🚫 Not built (permanent simplification, named reason) — ⏳ Deferred
(named target phase) — N/A Not applicable in this port.

## 5.1 Primitive read/write protocol

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-1 | MUST | Tail-append, transferred count, ≥1 when non-exhausted, 0 for count 0, −1 at end, never over-deliver | ✅ | Task 2 (`ByteQueue.read`), Task 6 (`BufferedSource.read`); partial-then-EOF asserted at both |
| IO-2 | MUST | A 0-count read returns 0 and never reports end-of-stream | ✅ | Tasks 2, 6 — checked **before** exhaustion, commented as load-bearing at both sites, asserted on a fresh and an exhausted source |
| IO-3 | MUST | Negative count rejected as an argument error before any I/O | ✅ | Tasks 2, 6, 9, 10 via `assertCount`, single-sourced in `limits.ts`; asserted to leave both source and destination untouched. **Corrected during Phase 3b:** the guard shipped as three byte-for-byte copies and `TeeSink` — the fourth size-taking surface — had none, so a negative count reached it and was rejected only indirectly by whichever `ByteQueue` call ran first, and not at all on its `count === 0` and short-source early returns |
| IO-4 | MUST | Sink write removes exactly N from the source HEAD; fails rather than writing partially | ✅ | Task 2 (`ByteQueue.write`), Task 9 (`BufferedSink.write`); nothing reaches the wire on the short-source path |
| IO-5 | MUST | Sink exposes flush; source and sink both closeable | ✅ | Task 9 |
| IO-18 | SHOULD | `emit` (cheap handoff) distinguished from `flush` (full force-out); in-memory may no-op returning self | ✅ | Task 9 |

## 5.2 Buffer semantics

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-7 | MUST | FIFO byte queue that is simultaneously source and sink, with a live size | ✅ | Task 2; Task 4 property test proves order across arbitrary chunk splits and arbitrary read increments |
| IO-8 | MUST | Snapshot is a fresh independent copy, non-consuming, non-mutating | ✅ | Task 3; Task 4 property test asserts independence in both directions |
| IO-9 | SHOULD | Refuse a materialization past the host's max single-array size, with an actionable message | ✅ | Task 1 (`MAX_BYTE_ARRAY_LENGTH = 2**31 − 1`, `AllocationLimitError`), Task 3 (eager check + `RangeError` backstop in `allocate`) |
| IO-10 | MUST | Clear discards all; copy-to copies a window without consuming, defaults offset→end, rejects out-of-range | ✅ | Task 3; Task 4 property test asserts source size is unchanged |
| IO-41 | MUST | Close is idempotent; underlying resource closed at most once | ✅ | Task 4 (`ByteQueue`), Task 5 (`RetentionWindow`), Task 6 (`BufferedSource`), Task 9 (`BufferedSink`) |
| IO-42 | MUST | Stream-backed rejects after close; in-memory buffer exempt on its own surface, but close invalidates derived slices | ✅ | **Both directions asserted**, as the requirement's own rationale demands: Task 4 (`ByteQueue` stays readable — Phase 3b's snapshot-after-close depends on it) and Task 6 (`BufferedSource` rejects). Slice invalidation is Task 5's `RetentionWindow.close` |

## 5.3 Typed reads and lines

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-11 | MUST | `exhausted()`, single-byte read, count-less read of all remaining (empty when exhausted) | ✅ | Task 6 |
| IO-12 | MUST | Exact-count read returns exactly N or fails; never short | ✅ | Task 6, asserted across chunk boundaries and on the short path |
| IO-13 | MUST | UTF-8 and explicit-charset reads, with symmetric write-side encodings | ✅ (read) / ⚠️ (write, bounded) | Task 7 (read: any `TextDecoder` label; `text-codec.ts`'s `decodeText` implements true ISO-8859-1 and sets `ignoreBOM`, and is deliberately **not** interchangeable with `http/charset.ts`'s whole-body `decodeBodyText` — the names were disambiguated in Phase 3b), Task 9 (write: **UTF-8 and ISO-8859-1 only**), plus two `fast-check` round-trip property tests in `buffered-sink.test.ts` — sink-out/source-back through UTF-8, and through ISO-8859-1 asserting one byte per code point, which is what distinguishes an honored charset from a silent UTF-8 re-encoding. `TeeSink`'s own `writeUtf8`/`writeString` are asserted to mirror the primary's exact encoded bytes and to refuse an unsupported label identically. `TextEncoder` is UTF-8-only and `SEAM-1` forbids an encoding dependency, so full symmetry is unreachable; any other label throws rather than silently re-encoding. Ledgered deviation |
| IO-14 | MUST | Line read consumes the terminator; `\n` and `\r\n` both terminate; lone `\r` is content; final unterminated line as-is; absent when exhausted first | ✅ | Task 7, including a `fast-check` property test with **adversarially generated chunk boundaries**, so a terminator straddling two stream chunks is covered — the case the requirement's rationale names and hand-picked examples miss |
| IO-15 | MUST | Skip advances exactly N, fails if fewer remain; `skip(0)` a no-op even at/after EOF | ✅ | Task 6 |
| IO-16 | SHOULD | Read-only host-native byte-stream bridge; symmetric writable bridge; closing the bridge closes the owner | ✅ | Task 12. Host-native means `ReadableStream`/`WritableStream` for this port, per `sdk-design/03` §3.1 — no `node:` import; Task 13 Step 9 greps to enforce that |

## 5.4 Non-consuming views

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-19 | MUST | Peek is a non-consuming view over the **whole remaining source** | ✅ | Task 8. Uncapped by design — a retention cap would bound the fastest-to-slowest cursor spread and stop a divergent view reaching the end, partially failing this MUST. Caps live in §6 (Phase 3b) |
| IO-20 | MUST | Slice is non-consuming and length-bounded; reading past the window is end-of-window | ✅ | Task 8, plus a property test over arbitrary offset/count |
| IO-21 | MUST | Offset overflow detected LAZILY; negative offset or count rejected eagerly | ✅ | Task 8, both halves asserted |
| IO-22 | MUST | Closing a slice neither closes nor advances the parent; closing the parent invalidates every outstanding slice | ✅ | Task 5 (`release`, `close`), Task 8 (both directions asserted) |
| IO-23 | MUST | Multiple slices/peeks mutually independent; slice-of-slice composes additively, capped at the outer remainder | ✅ | Task 5, Task 8, plus a property test that no view read advances any other view or the parent |
| IO-24 | MUST | Reading an explicitly closed slice fails loudly with a state error, distinct from EOF | ✅ | Task 5 (`ClosedResourceError`, a distinct class from `EndOfStreamError` — asserted in Task 1), Task 8 |
| IO-38 | MUST | Close state observable across threads to derived slices | N/A | A `ReadableStreamDefaultReader` is neither structured-cloneable nor transferable, so no instance crosses a worker boundary for the torn-read hazard to exist. No code; spec ledger row |

## 5.5 Pumping and the tee sink

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-17 | MUST | Write-all pumps to exhaustion, terminates only on −1; a foreign source's zero-read for a positive request is an I/O error, never EOF and never spun on | ✅ | Task 11 (`writeAll`); the violation is raised in Task 5's `#pullOnce` and driven by `protocolViolatingStream`. **Corrected during Phase 3b:** a primitive source that *over*-reported its transferred count was left to `ByteQueue.takeBytes` and surfaced as `EndOfStreamError: delivered 2 of 99 bytes` — a foreign source's broken accounting reported as an exhausted stream, the exact confusion this requirement forbids. Both misreport directions now raise `SourceContractViolationError` and are asserted |
| IO-25 | MUST | Tee mirrors into the tap AND forwards the full untruncated payload; the wire body is never reduced | ✅ | Task 10, plus **the most important property test in §5**: for arbitrary write sequences and arbitrary tap caps, the primary receives the exact concatenation of every written byte |
| IO-26 | MUST | Tap capacity limit; default effectively unbounded; a limit of 0 mirrors nothing while forwarding everything | ✅ | Task 10 (`Number.POSITIVE_INFINITY` default, spelled as a value rather than a magic number); all three cases asserted |
| IO-27 | MUST | Mirror BEFORE forwarding; clear staging even on a failed write so no stale bytes prepend | ✅ | Task 10, both clauses asserted; staging cleared in a `finally` so it holds on the throwing path |
| IO-28 | MUST | No direct backing-buffer handle; attempting it fails, directing callers at the typed writes | ✅ | Task 10 (`get buffer(): never`) |
| IO-29 | MUST | Tee's own flush/close/emit forward to the PRIMARY only, leaving the tap intact | ✅ | Task 10. All three asserted: `close` with snapshot-after-close, and `flush`/`emit` both by returning the tee with the tap intact and — the observable proof they are not swallowed by the decorator — by rejecting with `ClosedResourceError` once the primary is closed, which only the primary can raise |

## 5.6 Provider factories, timeouts, and thread-safety

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| IO-30 (factory half) | MUST | Factories for a fresh empty buffer, stream-wrapping source/sink, byte-array source, foreign-primitive wrapping; each buffer fresh/independent/empty; byte-array source an independent copy | ✅ | Task 13; the copy semantics and buffer independence are asserted directly, matching the requirement's own conformance notes |
| IO-30 (resolution half), IO-31–IO-36 | MUST | Install precedence, idempotent install, caching, warning, de-duplication | 🚫 | **Never built.** No registry exists — one implementation, always present, no installation call. Same permanent simplification as `SEAM-5`–`SEAM-10`; derived in `sdk-design/03` §3.1, stated in `factories.ts` TSDoc, recorded in the spec's ledger |
| IO-37 | MUST | All streaming instances are single-threaded contracts, not safe for concurrent use | ✅ | Satisfied by the event-loop model outright; stated in `ByteQueue`, `BufferedSource`, and `BufferedSink` TSDoc |
| IO-39 | SHOULD | Provider registry supports lock-free reads with serialized installs | 🚫 | **Never built** — there is no registry to read from. Same reason as IO-30's resolution half |
| IO-40 | MUST | No read/write timeout imposed by this layer; cancellation belongs to the transport; a wrapping sink neither swallows nor duplicates the wrapped stream's cancellation | ✅ | Enforced **by absence**: no `AbortSignal`, no timer anywhere in `src/io/`. Stated in Global Constraints with an explicit "do not add a signal parameter", and in both async classes' TSDoc. Deliberately overrides styleguide 9.5 — ledgered |

## Cross-cutting plan obligations

| Obligation | Source | Status | Where |
|---|---|---|---|
| Nothing enters the published API surface | Design decision (styleguide 10.3, Phase 2's `Serde<T>` precedent) | ✅ | Task 13 Step 8 — `git diff --exit-code packages/core/etc/core.api.md` must produce no output. Mechanical proof, not a review promise |
| No runtime dependency added | `SEAM-1` | ✅ | Task 13 Step 7 runs `verify:seam-1`; `mitata` is a root devDependency only |
| No `node:` import in core | `sdk-design/03` §3.1, runtime-agnosticism | ✅ | Task 13 Step 9 greps `packages/core/src/` and fails on any match |
| Property tests where invariants exist | styleguide 11.5 | ✅ | Task 4 (`ByteQueue` ×4), Task 7 (`readUtf8Line`), Task 8 (views ×2), Task 9 (charset round-trips ×2), Task 10 (`TeeSink` wire payload) |
| Rejection assertions are awaited and attributable | styleguide 11.9 | ✅ | `test-support/rejection.ts`. bun types `.rejects.toThrow()` as `void`, so the plan's `await expect(…).rejects` form fails `@typescript-eslint/await-thenable`; the helper awaits the promise and returns the reason instead, with no `eslint-disable`. Ledgered |
| Negative-space and cleanup assertions | styleguide 11.9, 13.9 | ✅ | Idempotent close (Tasks 4, 5, 6, 9), both IO-42 directions (Tasks 4, 6), parent-close invalidation (Task 8), failed-write tap capture (Task 10) |
| Determinism — no fake clocks needed | styleguide 11.8 | ✅ | IO-40 means this layer owns no timer; every stream under test is built from an in-memory array |
| Fakes over `mock.module` | styleguide 11.3 | ✅ | Task 5's `test-support/fake-stream.ts` and `test-support/rejection.ts`, both excluded from the build via `tsconfig.build.json`'s `src/io/test-support/**` |
| No type-level tests | styleguide 11.6 | ✅ (correctly absent) | 11.6 requires them for public generics and conditional types; this phase publishes neither. Stated rather than manufactured |
| Committed baseline bench | styleguide 15.6 | ✅ | Task 13, `byte-queue.bench.ts`. Baseline only — no optimization applied, no 15.10 ledger notes, per 15.1/15.6's "do not tune ahead of a profile" |
| 80% aggregate coverage floor | `NFR-5` | ✅ | Task 13 Step 7 |
| Every test file cites its requirement IDs | Phase 1 convention, for Phase 9's conformance pass | ✅ | Top-of-file comment in all eleven test files |

## Deferred out of this phase

| Item | Target | Note |
|---|---|---|
| `BODY-19` tap cap, `BODY-30`/`HTTP-52` 1 MiB error-body cap, `BODY-34` shared preview config | Phase 3b | Deliberate placement. §5 bounds nothing; **every** cap the product spec mandates sits in §6. Do not re-litigate by adding `maxRetainedBytes` to `BufferedSource` |
| `MultipartBody`; `Request`/`Response` real body type | Phase 3b | Already tracked in the roadmap's Deferred Items Log, retargeted from "Phase 3" when Phase 3 split |
| Promotion of any §5 type into the public barrel | Phase 3b or later | 3b chooses whether `BODY-1`'s write-to-sink names `BufferedSink` or the platform's `WritableStream<Uint8Array>` |
| `Symbol.asyncDispose` on §5 resources | Whenever `engines.node` moves | The symbol postdates the `>=18.17` floor and TypeScript does not polyfill it for a declaring library — the computed key would silently bind to the string `"undefined"` at run time. Matches Phase 2's `Transport` |
