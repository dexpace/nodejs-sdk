# Phase 3b — Body Lifecycle Implementation Plan — Checklist

Verification of [2026-07-25-phase3b-body-lifecycle.md](./2026-07-25-phase3b-body-lifecycle.md) against every
requirement ID in `docs/product-spec/06-request-and-response-body-lifecycle.md`, as dispositioned by
`docs/work/mvp/phase3/phase3b/2026-07-25-phase3b-body-lifecycle-design.md`.

**Legend:** ✅ Implemented and tested — 📄 Contract-obligation-only (this phase guarantees the property; a later
phase consults it) — ⏳ Deferred (named target phase) — 🚫 Not built (permanent simplification, named reason).

## 6.1 The body model

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-36 / BODY-1 | MUST | Body produces bytes via a single write-to-sink operation; reports media type, content length (-1 unknown), replayability | ✅ | Task 2 (`Body` interface), Tasks 3/4/6 (five concrete variants). `writeTo` takes the platform `WritableStream<Uint8Array>`, which is what keeps all of `src/io/` `@internal` |
| BODY-2 | MUST | Composite replayability; declared length collapses to unknown if any part's is | ✅ | Task 6; both directions asserted, plus the `-1` collapse |
| HTTP-51 | SHOULD | One shared framing routine drives both the declared length and the emitted bytes | ✅ | Task 6 (`renderPartHeader` called by `computeContentLength` **and** `writeTo`), plus a `fast-check` property that declared length equals bytes written for arbitrary part sets. Header parameter values are quoted/escaped and CR/LF stripped; a second property asserts an arbitrary part name never injects extra framing CRLFs. The shared routine alone is **not** sufficient: it takes each part's own `contentLength` on trust, and `MultipartPart.body` is the `@public` `Body` interface, so a caller implementation can report one length and write another. `writeTo` therefore also verifies its total against the declared value — refusing an overrunning chunk before it reaches the sink, and raising inside the writer scope on a short total so the sink is aborted rather than cleanly closed. Both directions asserted |
| HTTP-51 (boundary) | SHOULD | Caller-supplied boundary validated | ✅ (grammar) / ⚠️ (non-appearance) | Task 6. RFC 2046 puts two duties on the sender: a `bchars`-valid delimiter, and one appearing in no part. The first is enforced (`MultipartBoundaryError`); the second **cannot** be checked here, because a `StreamBody` part's bytes do not exist until the write, and a partial scan would read as a complete guarantee. Mitigated by generating the boundary by default — 32 random characters from Web Crypto — and by documenting the obligation on both entry points. Ledgered |
| BODY-3 / HTTP-37 | MUST | Materialize-once; the consumed-once guard is checked before the first suspension point | ✅ | Task 4 (`StreamBody.#consumed`, set before the first `await`), Task 5 (`materialize` holds no state of its own — `writeTo` can be called directly, and the guard must cover that path too). Property test over N concurrent callers: exactly one drains, every other observes `ConsumedBodyError` |
| BODY-8 | MUST | Stream ownership stated per variant | ✅ | Task 4. `StreamBody.writeTo` never cancels the caller's stream — **on either path**. The declared-length path only `releaseLock()`s, and the unknown-length path passes `preventCancel: true`, because `pipeTo`'s default cancels the source when the destination fails. Both asserted with a `cancel` spy |
| BODY-9 | SHOULD | Mark/reset replay on a stream body | ✅ (bounded) | Task 4 — `StreamBody` is always single-use. Node's `ReadableStream` has no generic mark/reset; a caller wanting replay calls `materialize` or uses `byteArrayBody`. Ledgered |
| HTTP-39 / BODY-10 | MUST | Declared length verified; a stream that disagrees fails rather than sending a truncated or overrunning body | ✅ | Task 4's `#writeExactly`. The overrun check runs **before** the write, not after the loop: once a transport has stamped `Content-Length`, an extra byte is already on the socket and no thrown error can recall it. A short stream raises `EndOfStreamError(delivered, declared)` from inside the writer scope, so the sink is aborted rather than cleanly closed |
| HTTP-38 / BODY-35 | MUST | Replayability classified by source; form-urlencoded always replayable, `+` for space | ✅ | Task 3. Encoding routes through Phase 1's `QueryParams`, so the RFC 3986 rules are single-sourced and only the `%20`→`+` swap is local; a postcondition asserts no literal space survives |
| BODY-4, BODY-5 | MUST | Replayability and idempotency gate a re-send | 📄 | Contract-obligation-only. This phase guarantees `replayable` is correct; Phase 5's retry/redirect/auth steps consult it. No task builds consultation |
| HTTP-40 / BODY-11, BODY-12, BODY-13, BODY-36 | MUST | File-backed body | ⏳ Phase 8a | Needs `node:fs`, against core's zero-`node:`-import invariant. Resolved in Phase 8a's design as a structural recognition contract plus a `@dexpace/body-file` package. In the roadmap's Deferred Items Log |
| HTTP-2 / HTTP-3 | MUST | Builder-based models expose a pre-populated `newBuilder()`; never a public field-wise constructor | ✅ | Task 6 adds `MultipartBodyBuilder` with static and instance `newBuilder()`, copying the parts list so the builder never aliases the source. `HTTP-2` holds two ways: concrete body classes are exported **as types only** (never as values, so `new ByteArrayBody(...)` is unreachable), and `Response` — which *is* a value export — keeps its `private constructor` plus the `createResponse` friend hook. The committed API report is the mechanical gate for both |
| HTTP-1 / XCUT-15 | MUST | A constructed model cannot drift from what it emits | ✅ | Tasks 3/4/6 — every variant calls `freezeBody(this)` last, so `contentLength` cannot be reassigned after construction; `MultipartBody` additionally deep-copies its parts array. Asserted across all five variants |

## 6.2 Response body

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-41 / BODY-14 | MUST | Single-use body; repeat access returns the same reference, not a replay | ✅ | Task 8 — `Response.body` is a plain getter over a `#private` field, so this needs no separate guard |
| HTTP-41 / BODY-15, HTTP-43 | MUST | Idempotent close; releases the connection whether or not the body was read | ✅ | Task 8. Memoized on the close *promise*, not a boolean: a flag set before the `await` reports a failed release as success to every later caller. Tolerates a body locked by an external consumer, since `BODY-15` forbids assuming the body was read |
| HTTP-41 / BODY-16 | MUST | Convenience readers close in a finally-style guarantee | ✅ | Task 8. Two ordering constraints, both load-bearing and both asserted. `reader.releaseLock()` is the first statement of the `finally`, before the close: `cancel()` rejects with `TypeError` on a locked stream and reading to `{done: true}` does not release the lock, so the reverse order turns every successful read into a rejection. And the reader is acquired **inside** the try: `getReader()` itself throws when an external consumer already holds the lock — which `BODY-15` forbids assuming away — so acquiring it above the try skipped the close on exactly the path the guarantee most needs to cover |
| HTTP-42 | MUST | `text()` uses the declared charset, falling back to UTF-8 | ✅ | Task 8 via `http/charset.ts`. Falls back for an absent, unparseable, **and** unrecognized label; all three asserted |
| HTTP-44, HTTP-45 | MUST | Raw fields without touching the body; parse-once memoized including failure; concurrent first callers serialized | ✅ | Task 9. The promise is cached before the first `await`, and the parse is wrapped in an `async` IIFE so a parser that throws *synchronously* is memoized too — a bare `??=` would re-run the handler against a body whose bytes are already gone |

## 6.3 Request-body logging

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| BODY-17 | MUST | Mirror into the tap AND forward the full untruncated payload | ✅ | Task 10, plus the property test that carries this phase's most important invariant: for arbitrary payloads and arbitrary caps, the primary receives the exact concatenation of every written byte. The adapter stream forwards **both** teardown paths — `close` and `abort` — so a delegate failure reaches the caller's sink rather than stopping at the decorator, and `writeTo`'s own `catch` releases the writer when a delegate refuses before touching the adapter at all |
| BODY-18 | MUST | The tap clears at the start of every write | ✅ | Task 10 — asserted across two writes of a replayable delegate, which is what a Phase 7 retry loop does |
| BODY-19 | MUST | Tap capacity cap; the full payload is unaffected by it | ✅ | Task 10; cap of 0, cap below payload, and cap above payload all asserted |
| BODY-20 | SHOULD | A partial failure still yields the bytes mirrored up to that point | ✅ | Task 10 — mirror-before-forward, so the chunk that failed is captured |
| BODY-21 | MUST | The materialized form stays wrapped and keeps its tap cap | ✅ | Task 10. `materialize()` is a member, not the free function, because the return type must stay `LoggedBody`. Each wrapper gets its **own** tap buffer rather than sharing one: two live wrappers over a single `ByteQueue` means the materialized wrapper's `BODY-18` clear-on-write silently rewrites the preview the pre-materialization wrapper still holds |
| BODY-37 | MUST | No writable-buffer escape hatch; `snapshot()` is the only read path | ✅ | Task 10 — the tap is closure-scoped, asserted absent from the wrapper's own keys. Restates `IO-28` at this layer |

## 6.4 Response-body logging

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| BODY-22 | MUST | Lazy; the delegate is drained exactly once | ✅ | Task 11 — the drain is memoized on one in-flight promise. `snapshot()` is a trigger alongside `read()`, and being synchronous it starts the drain and returns what has been captured so far rather than awaiting it, which is what lets `BODY-26`'s "snapshot returns the partial bytes without throwing" hold |
| BODY-23 | MUST | Fits-cap: full capture, every later read a fresh non-consuming view | ✅ | Task 11 |
| BODY-24 | MUST | Exceeds-cap: prefix then live tail, exactly once; a second read fails | ✅ | Task 11. The tail is pull-driven, one chunk per `pull()` — an eager `start()` loop would materialize the whole remainder of exactly the oversized bodies the cap exists to keep off the heap |
| BODY-25 | MUST | A zero-byte delivery is never treated as end-of-stream | ✅ | Task 11. `ReadableStreamDefaultReader.read()` carries no requested count, so the clause has no *literal* analog — but the tolerant reading made the same upstream succeed or fail depending only on which wrapper it passed through, since `RetentionWindow` raises on the same input under the identically-worded `IO-17`. Enforced on **both** read paths, the drain and the exceeds-cap tail |
| BODY-26 | MUST | A drain failure is cached, not propagated-and-forgotten; partial capture is never presented as complete | ✅ | Task 11 — `read()` re-throws on every call, `snapshot()` returns the partial bytes without throwing, `error()` surfaces it **without triggering a drain**. All three asserted |
| BODY-27 | MUST | The delegate is closed at most once across every close path | ✅ | Task 11 — one close-once guard shared by the wrapper's own close and the one-shot tail's completion and cancel. The reader's lock is released before the cancel, same trap as `Response.bytes` |
| BODY-28 | MUST | The captured buffer survives close | ✅ | Task 11 — depends on `IO-42`'s explicit in-memory carve-out, which is why Phase 3a's `ByteQueue.close()` deliberately leaves its read surface usable |
| BODY-29 | SHOULD | Reported length is the captured size only when the whole body fit | ✅ | Task 11 — the delegate's declared length otherwise, since the capture is only a bounded prefix |

## 6.5 Error bodies and caps

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-52 / BODY-30 | MUST | 4xx/5xx buffered up to a fixed 1 MiB and re-served replayably; buffering inside the close-guaranteeing scope | ✅ | Task 12. The loop keeps draining past the cap so the connection is still released, and drops the excess |
| BODY-31 | MUST | Error statuses only; a non-error response is handed back with its body intact | ✅ | Task 12 — gated on `Status.isError` (`HTTP-11`'s 400–599 band), **not** a bare `code < 400`, which would sweep a non-standard 6xx that `HTTP-10` requires `Status.of` to accept into the error path and consume a body `BODY-31` says must be returned intact |
| BODY-32 | MUST | Every byte-capped capture operation validates its cap | ✅ | Tasks 10 and 11 — both `tapCapBytes` and `capBytes` reject a negative value and clamp to the platform max. An unvalidated negative cap makes `size < cap` permanently false and silently mirrors nothing. The capless-snapshot clause is inherited: every `snapshot()` here delegates to `ByteQueue.snapshot()`, which already raises `AllocationLimitError` over the platform max (`IO-9`) |
| BODY-33 | SHOULD | Non-consuming error-body preview | ✅ | Task 12 — served from the buffered copy, so it is repeatable; `null` for no body. Decodes with the response's declared charset falling back to UTF-8, and never raises a `RangeError` out of a method on an error object |
| BODY-34 | MUST | One shared preview-size cap | ✅ (parameter) / ⏳ Phase 7 (value) | Tasks 10 and 11 each take it as a parameter; Phase 7 supplies the single config value that feeds both when it wires a real `Logger`. `toHttpError`'s 1 MiB cap is explicitly **not** this cap — `HTTP-52` fixes its value, so it cannot be the configurable one |

## Cross-cutting plan obligations

| Obligation | Source | Status | Where |
|---|---|---|---|
| No runtime dependency added | `SEAM-1` | ✅ | `verify:seam-1`; `dependencies` stays `{}` |
| No `node:` import in core | `sdk-design/03` §3.1 | ✅ | `grep -rn "from 'node:" packages/core/src/` is empty. Web Crypto, `TextEncoder`/`TextDecoder` and Web Streams are platform globals |
| The published `.d.ts` compiles for a consumer | `NFR-10`; new `verify:consumer-types` gate | ✅ | Compiles a throwaway consumer against the built declarations using the `lib`/`target` read from `tsconfig.base.json`, with `types: []`. Added because a real defect cleared every other gate: `typecheck` passes on dev-only ambient globals, `build` emits regardless, `api` only compares a report, `lint:publish` checks resolution and export shape, and `verify:dual-consumption` runs `node`, not `tsc`. Verified to fail on the reintroduced defect |
| Nothing from `src/io/` enters the public surface | Phase 3a's open promotion question | ✅ | Answered by `writeTo` taking the platform `WritableStream`: `io/` stays `@internal` indefinitely. The API report carries no `ByteQueue`/`BufferedSource`/`BufferedSink`/`TeeSink`/`IoError`, and neither logging tee |
| `http/` does not import `io/` | Plan Global Constraints | ✅ | `body/` is `io/`'s only new consumer. Of the *stream-shaped* types the constraint names, it takes `ByteQueue` alone — never `BufferedSource`/`BufferedSink`/`TeeSink`, whose reader/writer-bound, `ByteQueue`-and-count-shaped signatures do not compose with `writeTo`'s chunk-shaped sink. It additionally imports two `io/` error leaves and `MAX_BYTE_ARRAY_LENGTH`, which the constraint does not restrict and which exist precisely to be reused rather than duplicated. `http/request.ts`'s `Body` import is type-only and erases |
| Every public symbol documented | CLAUDE.md; `api-extractor` | ✅ | `packages/core/etc/core.api.md` contains **zero** `(undocumented)` markers. This regressed to 62 during implementation — `Response`'s wholesale rewrite also dropped 11 of Phase 1's own TSDoc blocks — and is now mechanically clean |
| Property tests where invariants exist | styleguide 11.5 | ✅ | Task 5 (`materialize` concurrency), Task 6 (framing length ×1, header injection ×1), Task 10 (tap independence), Task 11 (two-regime completeness) |
| Assertion density | styleguide ch05 §5.7 | ✅ | `invariant` preconditions on both caps and on `contentLength`; postconditions in `materialize`, `computeContentLength`, `drainOnce`, `toHttpError`'s buffer loop, and the form encoder |
| Negative space and cleanup | styleguide 11.9, 13.9 | ✅ | Double-close on `Response` and the response wrapper; write-after-consumed; read-after-tail-consumed; a delegate failure aborting rather than closing the primary sink; a caller stream that must not be cancelled |
| Every test file cites its requirement IDs | Phase 1 convention, for Phase 9 | ✅ | Top-of-file comment in all ten `body/` test files, both modified `http/` ones, and the `io/` files this phase touched |
| SPDX header on line 1 | `NFR-13` | ✅ | Every file under `packages/core/src/`. `http/response.test.ts` lost it in Task 8's wholesale rewrite and has it back |
| 80% aggregate coverage floor | `NFR-5` | ✅ | Well above; `bun test` runs coverage by default, and the threshold is enforced rather than merely reported — raising it to `0.999` makes the identical suite exit 1 |
| The body surface runs on Node, not only Bun | checkpoint §5.9; roadmap E5 | ✅ | `test/node-conformance/body-lifecycle.test.mjs` exercises `Response.bytes`/`text`/`close`'s reader-lock discipline, `StreamBody`'s `preventCancel` ownership, multipart framing including the Web Crypto boundary, and `toHttpError` buffering against the **built** artifact under `node --test`. Added when E5 was closed; this phase's surface is a founding member of that suite because §6 is where Web Streams semantics first reach a consumer |
| Changeset committed | Consumer-facing change | ✅ | `RequestBuilder.body` and `ResponseBuilder.body` both narrow from `unknown`, which `api-design.md` classes as breaking. Released as **minor** under semver's 0.x initial-development carve-out, with the pointer recorded — this is D1's decision, taken |

## Deferred out of this phase

| Item | Target | Note |
|---|---|---|
| `FileBody` (`HTTP-40`/`BODY-11`/`BODY-12`/`BODY-13`/`BODY-36`) | Phase 8a | Needs `node:fs`. Already in the roadmap's Deferred Items Log |
| `BODY-34`'s single shared preview-cap **value** | Phase 7 | This phase ships both tees' parameters; Phase 7 owns the `Logger`/config surface that threads one value through them |
| `BODY-4`/`BODY-5` replayability **consultation** | Phase 5 | Retry, redirect, and auth read the property this phase guarantees |
| Wiring either logging tee to a real `Logger` | Phase 7 | Mechanism ships now because the IDs are §6; nothing constructs one yet. Matches Phase 2 shipping `Serde<T>`'s interface with no implementation |
| `[Symbol.asyncDispose]` on `Response`, `LoggedResponseBody`, `Transport`, and Phase 3a's four resource owners | Checkpoint §5.4 | Blocked on the `engines.node` floor bump. Must land on all seven at once — see the ledger row |
| Removing `DomainModelError` as a class tier | Checkpoint §5.2 | A breaking change to a barrel-exported class. `io/`'s leaves are already flat; the Phase 1 tier is the residual |
