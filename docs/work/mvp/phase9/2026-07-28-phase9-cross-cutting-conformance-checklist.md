# Phase 9 — Cross-Cutting Invariants & Conformance — Requirement Checklist

Every `XCUT-1`–`XCUT-24` and `NFR-1`–`NFR-17` ID, mapped to the task that satisfies it and the evidence that
proves it. This is the first systematic tabulation of the `XCUT` family in this project — before Phase 9 the
grep across every spec and plan turned up incidental citations only, and **zero** `XCUT-N` citations in any
source file.

**Legend.** ✅ satisfied, evidence cited · 🔁 satisfied by an earlier phase, retrofit citation added here ·
📋 documented disposition, no test · ⚠️ satisfied with a finding filed against another phase.

**Gate status at close:** `typecheck`, `lint`, `build`, `test` (2171 pass / 0 fail, 99.72% lines vs. the 80%
floor), `api`, `lint:publish`, `verify:dual-consumption`, `verify:consumer-types`, `verify:seam-1`,
`verify:sse-37`, `verify:runtime-floor`, `audit`, `shrink-test`, `test:node`, `test:scripts` — all green.

---

## `XCUT` — cross-cutting invariants

| ID | Status | Task | Evidence |
|---|---|---|---|
| `XCUT-1` | ✅ | 5 | `cancellation-and-timeout.conformance.test.ts` — 3 rows: an aborted in-flight request surfaces `CancellationError`; the retry pillar does not spend its remaining attempts (`dispatches() === 1`); the ambient signal stays aborted |
| `XCUT-2` | 🔁 | 5 | `seams/transport.test.ts` — citation already present from Phase 2; `isTimeoutSignal` discriminates on `signal.reason.name`, never a message string. No change needed |
| `XCUT-3` | ⚠️ | 5 | Same file — 3 rows: a 60 s backoff aborts in well under 5 s; a cancellation (not a timeout) is carried in the surfaced chain; no further attempt dispatched. **Finding N1** — the retry path surfaces a bare `AbortError`, not `CancellationError` |
| `XCUT-4` | ✅ | 6 | `error-taxonomy.conformance.test.ts` — 3 rows: a 5xx returns its fully-received response and converts via `toHttpError` to a status+body-carrying error; a refused connection rejects as `IoError` |
| `XCUT-5` | 🔁 | 6 | `retry/classify.test.ts` — already asserts 408, 429, 500/503/599 retryable and 501/505 not. This port has no separately-cached flag: the classifier is a pure function of the immutable `.status` |
| `XCUT-6` | ✅ | 6 | Same file — 2 rows: a `CustomTransientError extends IoError` declared *in the test file* is retried with no edit to `classify.ts`; a plain `Error` is not. Subtyping is this port's retryability capability (deviation ledger item 17) |
| `XCUT-7` | ✅ | 6 | Same file — 2 rows against a live `/status?code=N`: widening to `{501}` retries a 501; narrowing to `{503}` stops a 500 whose built-in classification is retryable |
| `XCUT-8` | ⚠️🔁 | 6 | `body/http-status-error.test.ts` — `toHttpError` returns `null` for 200/304, the absent/null convenience form `XCUT-8` permits. **Finding N2** — the public constructor still builds `HttpStatusError(200, …)` |
| `XCUT-9` | ✅ | 6 | `error-taxonomy.conformance.test.ts` — a self-referential `cause` is classified and surfaced unchanged; the test completing at all is the assertion |
| `XCUT-10` | ✅ | 7 | `retry-safety.conformance.test.ts` — all five rows of the requirement's own conformance clause, including the load-bearing one: a body-less POST failing with a *transport* error is still not retried |
| `XCUT-11` | ✅ | 8 | `concurrency-and-lifecycle.conformance.test.ts` — 24 interleaved requests through one shared pipeline pair every response to its own request; exactly one dispatch each, no double-sends |
| `XCUT-12` | 🔁 | 8 | `auth/bearer-cache.test.ts` — N concurrent callers coalesce to exactly one provider invocation, in both the expired and post-eviction zones |
| `XCUT-13` | ✅🔁 | 8 | `concurrency-and-lifecycle.conformance.test.ts` — 4 rows incl. a real transport closed twice, and an aborted signal not cleared by close. Retrofits on `fetch-transport.test.ts` / `undici-transport.test.ts` |
| `XCUT-14` | 🔁 | 8 | `context/store.test.ts` ("a burst past the cap converges to at or under the cap") and `auth/digest.test.ts` (1024-entry nonce counter, drain-to-cap). Retrofit rather than a new test — **neither map is reachable from a consumer-shaped test**, so a burst driven from `tests/` could assert liveness but never a bound |
| `XCUT-15` | 🔁 | 9 | `http/request.test.ts` (URL cloned per access, setters yield new instances) and `http/headers.test.ts` (builder defensively copies an ingested collection) |
| `XCUT-16` | ✅🔁 | 9 | `security-by-default.conformance.test.ts` — a bearer credential over `http://` throws `PlaintextCredentialError` with **`providerInvocations === 0`** and `dispatches() === 0`: the refusal lands before any token fetch. Retrofit on `auth/auth-step.test.ts` |
| `XCUT-17` | ✅🔁 | 9 | Same file — 4 rows over two genuinely distinct origins: Authorization dropped even same-origin; Cookie kept same-origin but dropped cross-origin. Clauses (c) userinfo and (d) downgrade retrofitted onto `redirect/decide.test.ts`, being unreachable over a plaintext fixture |
| `XCUT-18` | 🔁 | 9 | `http/headers.test.ts` — names reject C0 incl. HTAB, DEL and non-ASCII; outbound values reject the same except HTAB; inbound lenient on obs-text but not control bytes |
| `XCUT-19` | 🔁 | 9 | `observability/redaction.test.ts` (userinfo never allow-listable, query/fragment default-deny) and `auth/credential.test.ts` (all three credentials redact their secret in every string form) |
| `XCUT-20` | 🔁 | 9 | `observability/logging-step.test.ts` — a throwing `Logger` is caught and re-surfaced as `http.instrumentation.*`; the request still completes |
| `XCUT-21` | 🔁 | 8 | `auth/digest.test.ts` — the cnonce is drawn from `crypto.getRandomValues` at ≥128 bits, fresh per call (AUTH-20) |
| `XCUT-22` | 🔁 | 8 | `undici-transport.test.ts` ("a bring-your-own dispatcher is never closed by the transport") and `fetch-transport.test.ts`. Also asserted end-to-end at pipeline level: `Runtime.close()` leaves the caller's transport usable |
| `XCUT-23` | 📋 | — | **N/A by construction.** Every seam this port ships (`Transport`, `Serde`, the logger facade) is explicit-call-only; the classpath auto-discovery `SEAM-5`–`SEAM-10` describes is a permanent simplification never built. The ordering holds vacuously — there is nothing for an explicit install to beat. Deviation ledger, Phase 9 row 1 |
| `XCUT-24` | ✅🔁 | 10 | `diagnostic-previews.conformance.test.ts` — the requirement's own clause verbatim: a **10 MB** body with a 1 KiB cap. Text previews cap at 1024 chars, binary at `[binary 1024 bytes captured]`, `body.size` is 1024 not 10485760, no event field exceeds the cap, and the caller still reads all 10485760 bytes |

**All 24 dispositioned. No silent gaps.**

---

## `NFR` — non-functional requirements

| ID | Status | Evidence |
|---|---|---|
| `NFR-1` | ✅ | Audited across all 11 packages: `@dexpace/core` declares zero `dependencies`. Gate-enforced by `verify:seam-1` |
| `NFR-2` | ✅ | Every adapter is core-as-peer plus at most one external library — `logging-debug`→`debug`, `logging-pino`→`pino`, `rx`→`rxjs`, `transport-undici`→`undici`, `transport-fetch`/`body-file`/`codec-json`→none. `@dexpace/transport-shared` is an internal sibling, not a third-party lib |
| `NFR-3` | ✅ | One committed `etc/*.api.md` per published package (9 of them); internals stay unexported |
| `NFR-4` | ✅ | `bun run api` verifies all 9 reports; blocking in CI |
| `NFR-5` | ✅ | `bunfig.toml` `coverageThreshold = 0.8`, blocking. Actual: 99.72% lines / 98.76% funcs. **Verified live twice** — raising the threshold to 0.999 makes the run exit 1, and a single new file at 66.67% function coverage failed the run on its own while the aggregate stayed at 98.5%. So Bun enforces the floor **per file**, not only in aggregate: stricter than `NFR-5`'s "minimum aggregate" wording requires, and the gate is demonstrably not dormant |
| `NFR-6` | ✅ | `tsc --noEmit` per package under `strict`; `typecheck` now covers `shrink-test` and `tests/` too |
| `NFR-7` | ✅ | `gts` + `strictTypeChecked`/`stylisticTypeChecked`, fatal. Every `eslint-disable` carries a `-- reason`, including the one added this phase in `error-taxonomy.conformance.test.ts` |
| `NFR-8` | 📋 | **Not applicable by design** — no reflection-driven discovery surface to keep-configure. Deviation ledger, Phase 9 row 2; `docs/knowledge/deliberate-deviations.md:55` (stale as of 2026-08-30 — read `docs/deviations.md` §10 instead) |
| `NFR-9` | ✅ | `@dexpace/shrink-test` (Tasks 1–3): esbuild bundle+minify+tree-shake, 24 KiB budget against a measured 16,671 bytes, then a **child-process** round trip. Guard proven non-vacuous: a separately-bundled `IoError` has a different class identity and `instanceof` is false across the boundary |
| `NFR-10` | ✅ | All 10 published packages declare `engines.node >= 20.3`; `verify:runtime-floor` gates target-vs-floor; `test:node` runs the floor and current LTS in CI |
| `NFR-11` | ✅ | No `Observable`/`rxjs`/`Subscriber`/`EventEmitter` anywhere in `core.api.md`; `rxjs` appears in no core source file |
| `NFR-12` | 📋 | Deferred to Phase 10 / first release, unchanged |
| `NFR-13` | ✅ | Swept every tracked `.ts`/`.mjs`/`.js`: **3 offenders fixed** (`eslint.config.js`, `scripts/knowledge.mjs`, `scripts/knowledge.test.mjs`). Now 0. `packages/core/scripts/gen-version.mjs` correctly carries it on line 2 under a shebang |
| `NFR-14` | ⚠️ | Root catalog holds `api-extractor`, `expect-type`, `fast-check`, `typescript`. **Finding N4** — `rxjs@^7.8.0` is restated in three places. Peer ranges (`debug`, `pino`) are correctly per-package, being part of each package's published contract |
| `NFR-15` | ✅ | `SDK_VERSION` generated at build time from `package.json`; resolves to the real version, never an "unknown" placeholder |
| `NFR-16` | 📋 | Deferred to first actual publish, unchanged |
| `NFR-17` | ✅ | Every gate above is a blocking CI step. `shrink-test` needed no fourteenth step: the suite lives under `packages/`, so `bun run test` already runs it |

**All 17 dispositioned.**

---

## Deviations recorded for Phase 10

| Deviation | Reference behavior | Justification |
|---|---|---|
| `XCUT-23`'s explicit-install / auto-discovery / loud-fail ordering is satisfied vacuously, not tested as a race | The JVM reference arbitrates a real classpath auto-discovery race for its SPI seams | Every seam this port ships is explicit-call-only; the auto-discovery mechanism was never built, so no competing resolution path exists for an explicit install to beat |
| `NFR-8`'s shrinker keep-configuration ships nothing | The reference ships ProGuard/R8 keep rules for its reflective/SPI surface | No reflection-driven discovery surface exists here. The risk that *does* carry over is the dual-package hazard, and `@dexpace/shrink-test` targets it — now with measured proof the hazard is real |
| `XCUT-6`'s "retryability capability" is subtyping, not a duck-typed flag | The reference queries a capability interface | `classify.ts`'s allow-list returns true for any `IoError`, so extending it opts a new failure in with no classifier edit. Already ledgered as item 17 |

## Findings filed — `docs/work/mvp/2026-09-04-open-items-dissolution.md` Section N

| # | Summary | Owner |
|---|---|---|
| N1 | Cancellation surfaces `CancellationError` from the transport but a bare `AbortError` from a retry backoff wait | 5a |
| N2 | `HttpStatusError`'s public constructor accepts a 200, fabricating the "successful exception" `XCUT-8` names | 3b |
| N3 | The plan's `grep -rn "unresolved 2026-07-25" docs/knowledge/` step cannot pass as written | Phase 10 |
| N4 | `rxjs` version restated in three places against `NFR-14`'s single-source-of-truth | Phase 10 |

## Plan amendments

The plan was written before any package existed, and several of its code blocks assume APIs that shipped
differently. Recorded so the next reader does not treat the plan as as-built:

1. **Suite location.** `bunfig.toml` pins `[test] root = "packages"`, so a top-level `tests/` tree is invisible
   to `bun test`. The root `test` script now passes both trees (`bun test ./packages ./tests`); CI runs
   `bun run test --coverage`. The design's "exactly one new root script" no longer holds — `test` and
   `typecheck` each grew, and CI's Test step changed.
2. **`StandardResilienceOptions.retry` is `RetryStepOptions`**, so settings nest under `.settings` — not the
   plan's `Partial<RetrySettings>`.
3. **`isRetryableFailure` is `@internal`** and absent from core's barrel. Every `XCUT-6`/`7`/`9` row drives the
   composed pipeline instead, which is what this suite is for anyway.
4. **`XCUT-6`'s test error extends `IoError`**, not a duck-typed `{isRetryable: true}` — no such capability
   exists, by design.
5. **The dispatch counter wraps the transport, not `Runtime.send`.** The plan's placement counts caller
   invocations and would read 1 whether retry re-issued four times or none, inverting every `XCUT-10` row.
6. **Two real listeners for the cross-origin hop.** The plan reused one port under `localhost` vs `127.0.0.1`;
   the server binds `127.0.0.1` explicitly, so that name is not reliably resolvable.
7. **`XCUT-17`'s auth-re-stamp row is unreachable over a plaintext fixture** — `XCUT-16` forbids stamping a
   credential over `http://`, which the suite asserts directly instead.
8. **`XCUT-13` on `Runtime` proves nothing about close.** `Runtime.close()` is a documented no-op (PIPE-27);
   the real idempotence lives in the transports, so the test asserts both, plus the trap that a consumer who
   only calls `runtime.close()` never closes the transport.
9. **Task 11's three documentation fixes were already applied at planning time** (commit `c6603aa`), so this
   phase confirmed them rather than making them.
10. **`scripts/verify-nfr-audit.mjs` was never created.** The plan had it written, run once, then deleted; the
    same checks were run directly, and their results are the `NFR-1`/`NFR-2` rows above.
