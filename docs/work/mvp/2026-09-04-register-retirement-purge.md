# Register retirement purge — the audit trail the two registers no longer carry

**2026-09-04.** `docs/open-items.md` and `docs/deferred-items.md` each carried a retirement table: one
compact row per item that had been resolved, or per deferral that had been discharged. Both tables were
deleted on this date, by decision of the repository owner, together with the prose in each register that
described them. This note is where their contents went.

**Why the note exists at all.** The registers' own rule was that a retired ID is never released: a source
comment citing `K10` or `T.F9` still had to resolve, and the `housekeeping` probe's citation check read the
retirement table as a second namespace of resolvable IDs alongside the live `### <ID>` headings. Deleting the
tables took that namespace with it and left 25 citations pointing at nothing. Rather than rewrite the dated
records that carry them — `docs/work/` is never retro-edited, and `.changeset/` is published release history —
the namespace moved here. `.claude/skills/housekeeping/probe.mjs` reads the **Purged item IDs** table below as
the second source, so every one of those citations resolves again, to a row that says what the item was and
how it closed.

**What this note is not.** It is not a register. Nothing is appended here as work proceeds; it is a dated
record of one deletion. A new finding goes to `docs/open-items.md`, a new deferral to
`docs/deferred-items.md`, exactly as before.

**Counts, at the moment of deletion.** 102 retired item IDs, 25 retired rows that never carried an ID, and 67
discharged deferrals. `docs/open-items.md` went from 1933 lines to 1767, `docs/deferred-items.md` from 199 to
104. Every table below is reproduced verbatim from `git show HEAD:` of the pre-deletion files, commit
`853c349`; the rows' own `file:line` evidence is unmodified and may itself have drifted since the date each
row carries.

**Citations still in flight.** The bare-ID references inside test titles and inline comment shorthand —
`(T.F9/V15)`, `(H14/P1, RECOV-12)`, "the very collision V13 closed", 44 of them across 20 files — were
deliberately left in place. They read as part of the code, not as register pointers, and the citation check
never matched them (it requires the `open-items.md` path beside the ID).

---

## Purged item IDs

The 102 IDs the deleted `## Retired items` table reserved. **The IDs are still not released** — never
renumbered, never reused. This table is what the probe's citation check resolves them against.

| ID | Title | Resolution | Date | Evidence |
|---|---|---|---|---|
| `A1` | HTTP-24: `charset` did not return null for an unknown encoding | resolved against the runtime's WHATWG encoding registry, returns `undefined` | 2026-09-02 | `packages/core/src/http/media-type.ts` — the `charset` getter and `isKnownEncoding` |
| `A3` | HTTP-11: `Response` exposes no range classification of its own | closed on the delegation reading — `response.status.isSuccess` is one hop | 2026-09-02 | deviations.md row: "`HTTP-11`'s range classifications are on `Status` only" |
| `A5` | CTX-8: the duplicate-key error's message did not identify the key | default keys gained a serial description | 2026-09-02 | `packages/core/src/context/context.ts` — `defaultKey()` |
| `B1` | NFR-10/NFR-17: CI never runs on the declared minimum runtime | closed by the `node-conformance` job, a matrix over the declared floor and current LTS | 2026-08-26 | `.github/workflows/ci.yml`; `tests/node-conformance/` |
| `B2` | NFR-13: SPDX headers missing on scaffold-era files | all three files carry the line-1 header | 2026-09-02 | `eslint.config.js:1`, added in `d8217af` |
| `B3` | NFR-12: reproducible builds asserted, never proven | gated — two clean builds agree on every emitted file and every tarball | 2026-08-29, widened 2026-08-30 | `scripts/verify-reproducible-build.mjs`, a blocking CI step |
| `B4` | NFR-14: `expect-type` breaks the single-source-of-versions convention | premise inverted — nine manifests all read `"catalog:"` | 2026-09-02 | root `package.json:12` |
| `C2` | The structural-typing bypass deviation is not yet recorded | Phase 10 recorded it as §10 ledger item 4 | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:64-75` |
| `E1` | Phase 1 has no commits | decided by what happened — one squashed commit, accepted | 2026-09-02 | commit `8051364` |
| `F3` | Zero `invariant()` assertions across `recovery/` | won't fix — density is not a target, decided project-wide | 2026-09-02 | deviations.md row: "`invariant()` density is not a target, project-wide"; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `F5` | `#private` fields carry no per-use justification | closed — `CLAUDE.md` states the convention once, with the styleguide 6.7 carve-out | 2026-09-02 | `CLAUDE.md`, "Domain model construction pattern"; `docs/deferred-items.md`'s *`#private`-vs-`private`* row, still deferred |
| `F6` | `RECOV-11` is a no-op in this port | ledgered as promised | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:36-37` |
| `F8` | 4b did not depend on 4a | premise corrected — 4b's only outside imports are `http/`, `body/`, `seams/`, `invariant`, `suppress`; the sequencing half closed when both merged into the 4c branch | 2026-08-26 | `packages/core/src/recovery/` |
| `G2` | `REDIR-28`/`REDIR-15` observability clause ships unimplemented | all four event families now emit | 2026-09-02 | `packages/core/src/redirect/redirect-step.ts` |
| `G3` | `Decision` carries no reason on `'return-current'` | `RedirectStopReason` shipped; the two blocked events emit | 2026-09-02 | `packages/core/src/redirect/decide.ts` |
| `G4` | `REDIR-20`'s "fully override" read as scoped to eligibility | the scoped reading is confirmed and recorded | 2026-09-02 | deviations.md row: "`REDIR-20`'s 'fully override' is read as scoped" |
| `G7` | `XCUT-17`(b)'s foreign-host half needs an auth layer | delivered by Phase 5c — the auth step is the marker's consumer | 2026-09-02 | `packages/core/src/auth/auth-step.ts`, `planOutbound` |
| `G10` | Phase 5c publishes `Step`, the context family, and a PROVISIONAL `InstrumentationBundle` | accepted — `activeSpan`/`tracerFactory` are documented as provisional in the emitted `.d.ts`, on the interface and on each member, which is the honest form of the trade | Phase 5c | `packages/core/src/context/instrumentation.ts`; `packages/core/etc/core.api.md` |
| `G11` | `DigestChallengeUnsupportedError` was speculative | cut during Phase 5c's own shape review, before it shipped | Phase 5c | `packages/core/src/auth/` — no such class |
| `G12` | `AUTH-37`'s failed background refresh is swallowed silently | emits `http.auth.bearerRefreshFailed` at `warning`, then continues | 2026-09-02 | `packages/core/src/auth/bearer-cache.ts`, `warnRefreshFailed` |
| `H1` | `@dexpace/codec-json` buffers the whole decoded body before parsing | accepted deviation — `JSON.parse` has no incremental form, so this is a property of the format, not of the seam; `decodeResponse` itself never buffers | Phase 6a | `packages/codec-json/src/json-serde.ts`; `packages/core/src/serde/response-handlers.ts` |
| `H2` | `SERDE-23` (ignore unknown fields) is satisfied by delegation, not enforcement | accepted deviation — stripping or rejecting an extra wire key is the caller's schema's property, and core cannot override it without defeating caller-supplied schemas | Phase 6a | `jsonSerde`'s TSDoc, `packages/codec-json/src/json-serde.ts` |
| `H3` | No serde-specific error base class | accepted deviation — two flat leaves under `DexpaceError` plus `isSerdeError`, because checkpoint §5.2 caps the tier at two levels | Phase 6a | `packages/core/src/serde/errors.ts`; `packages/core/etc/core.api.md` |
| `H5` | `NFR-8`/`NFR-9` shrinker keep-configuration | Phase 9 answered it the other way — `NFR-8` not applicable, `NFR-9` shipped | 2026-09-02 | `packages/shrink-test/`; deviations.md §10 |
| `H6` | Assertion density in 6a | won't fix — the same decision F3 records | 2026-09-02 | F3, retired; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `H12` | `seams/index.ts` is an unimported internal barrel | deleted, after a three-way proof that it was dead | 2026-09-02 | `packages/core/src/seams/` carries no `index.ts` |
| `H13` | `test:scripts` runs in no CI job | closed by the `Gate self-tests (scripts/*.test.mjs)` step, mirrored in the preflight | 2026-08-31 | `.github/workflows/ci.yml`; `.claude/skills/ci-preflight/run-ci.mjs` |
| `H14` | `decodeSuccessResponse`'s 4xx/5xx branch is unprotected against a teardown failure | fixed at `toHttpError` with `releaseQuietly`/`withReleaseFailure` | 2026-09-02 | `packages/core/src/body/http-status-error.ts`; three cases in its test |
| `I1` | `SSE-41` reactive adapter deferred to Phase 8b | delivered by Phase 8b | 2026-09-02 | `packages/rx/src/sse.ts:34,50` |
| `J1` | `PAGE-11` close-before-yield vs §7.1's illustrative snippet | resolved with an erratum — `PAGE-11` governs; materialized items survive close, so closing first releases the response immediately | Phase 6c | `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.1; `docs/knowledge/notes/pagination.md` |
| `J2` | `PAGE-5`/`PAGE-29` asynchronous `PaginationStrategy.parse` signature | resolved with a spec clarification — bodies arrive as async streams, so `parse` returns `Promise<PageInfo<T>>` with the isolated non-mutating semantics intact | Phase 6c | `packages/core/src/pagination/strategy.ts` |
| `J3` | `Page<T>` disposal is a runtime-guarded install, not `implements AsyncDisposable` | resolved — guarded `[Symbol.asyncDispose]` install with `close()` as the supported teardown; the `>=20.4` floor bump is decided against | 2026-08-30 | `packages/core/src/pagination/page.ts`; Section D's `await using` row; `I3` |
| `J4` | WHATWG encode-set boundary and verbatim query splice | resolved by design — hand-rolled tokenization over the raw query substring, so untargeted parameters survive byte-for-byte (`PAGE-21`/`PAGE-22`) | Phase 6c | `packages/core/src/pagination/query-splice.ts` |
| `J5` | Transport-direct pagination without an internal resilience loop | resolved by design — resilience composes externally at the pipeline layer (`PIPE-9`), keeping the engine transport-agnostic | Phase 6c | `packages/core/src/pagination/paginator.ts` |
| `J6` | `items()` vs `pages()` single-use asymmetry | resolved by design — `items()` re-walks and closes each page before yielding; `pages()` hands out live connection ownership and so is single-use (`PAGE-8`/`PAGE-14`) | Phase 6c | `packages/core/src/pagination/paginator.ts` |
| `J7` | Iterative generator drive without a trampoline | resolved by design — `PAGE-31` sanctions native loops; `#walk` and `driveFetchers` are `async function*` loops in constant stack space | Phase 6c | `packages/core/src/pagination/paginator.ts`, `fetchers.ts` |
| `J8` | Error unwrapping and root-cause propagation | resolved by design — `PaginationError` is reserved for engine misuse; transport, parse and network failures propagate unwrapped with their causes (`PAGE-28`) | Phase 6c | `packages/core/src/pagination/errors.ts` |
| `K2` | Proxy resolution implements the property tier the design ledgered as collapsed | resolved — the ledger wording was narrowed to say the *production sources* collapse, not the resolution logic; without the tier `CFG-24`/`CFG-26` would have been silent gaps | 2026-08-27 | `packages/core/src/config/proxy.ts`; the 7a design doc's ledger row |
| `K4` | `CFG-28`'s global-configuration convenience resolver is not built | closed — the clause is a MAY, and practice threads a `Configuration` | 2026-09-02 | `packages/transport-undici/` |
| `K5` | `CFG-35`'s throwable axis is not in this phase | already delivered by Phase 5a when the row was written | 2026-09-02 | `packages/core/src/retry/classify.ts` |
| `K9` | `Configuration.default()` ships as a free `defaultConfiguration()` | resolved — `Configuration` is an `interface` in this port and cannot carry a static; the plan's own alternative placement | 2026-08-27 | `packages/core/src/config/configuration.ts:354` |
| `K10` | `CFG-24`'s warning half is not emitted | emits `http.proxy.configRejected` on every rejection path | 2026-09-02 | `packages/core/src/config/proxy.ts` |
| `K14` | A configuration seam that fails is silently invisible | `readLayer` emits `config.sourceFailed`, carrying layer and key | 2026-09-02 | `packages/core/src/config/configuration.ts` |
| `K15` | `HTTP-17`: `hasForbiddenNameByte` permits a space in a header name | decided — the predicate matches the frozen requirement exactly, no deviation filed | 2026-09-02 | `packages/core/src/http/ascii-validation.ts`; `docs/product-spec/04-core-http-domain-model.md:32` |
| `K17` | `formatProxyOptions` re-brackets an IPv6 host stored bare | resolved — bracketing lives in the formatter, keyed off a colon in the host; `host` stays bare as the stored representation | 2026-08-27 | `packages/core/src/config/proxy.ts:222` |
| `L2` | G2's deferred emissions | resolved — `REDIR-28` hop and rejection logging and `REDIR-15` downgrade logging are active through `getGlobalLogger()`; see `G2` | 2026-08-28 | `packages/core/src/redirect/redirect-step.ts` |
| `L3` | G12, K10, K14 config and auth logger retrofit | all three sites emit, taken as one change | 2026-09-02 | `auth/bearer-cache.ts`, `config/proxy.ts`, `config/configuration.ts` |
| `M2` | `ASYNC-*` IDs marked 🚫 are not satisfied anywhere | Phase 8a landed both transports and the shared conformance suite | 2026-09-02 | `a0d734d`; `packages/transport-conformance/` |
| `M3` | `ASYNC-18` confirmed a full-port collapse at implementation time | resolved — `@dexpace/rx` contains no timer, scheduler or backoff; already reflected in §10 ledger item 1 | 2026-08-28 | `packages/rx/`; `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` |
| `N1` | Cancellation surfaces two different types depending on the layer | a core-side `abortToSdkError` maps both core sites, timeout still distinct | 2026-09-02 | `packages/core/src/cancellation.ts` |
| `N2` | `HttpStatusError`'s constructor fabricates a "successful exception" | constructor enforces 400-599; `retire()` got its own trail-entry leaf | 2026-09-02 | `packages/core/src/body/errors.ts`, `packages/core/src/retry/errors.ts` |
| `O3` | The phase records still carry pre-split corpus paths | won't fix — `docs/work/` files are dated records of what a phase planned, are never retro-edited, and `CLAUDE.md` states the split so it does not read as an oversight | 2026-09-02 | `CLAUDE.md`; `grep -rhoE "docs/knowledge/[a-z0-9-]+\.md" docs/work \| wc -l` |
| `P1` | `toHttpError`'s `finally` can mask the drain failure | merged into H14, which is canonical and carries the fix | 2026-09-02 | H14, retired |
| `P2` | `RequestOptionsBuilder.maxRetries` — the pattern deserves a sweep | sweep run over every public numeric setter; four holes fixed to the full range | 2026-09-02 | `http/request-options.ts`, `retry/settings.ts` |
| `P9` | Phase 7b still owes `engine.ts` two log events | both ship, plus a third the finding did not anticipate | 2026-08-31 | `packages/core/src/retry/engine.ts` |
| `U1` | Five citations point at paths the restructure moved | closed as a finding — four corrections handed to the frozen trees, the `.changeset/` one left permanently | 2026-09-02 | `docs/knowledge/notes/`, `docs/sdk-design-nodejs/10-…` (see HANDOFF) |
| `U2` | Three phase deferrals never reached the aggregate log | recovered into the aggregate | 2026-08-31 | `docs/deferred-items.md` |
| `U3` | Three `F` namespaces coexist; a bare citation is ambiguous | options 1 and 3 together — a section qualifier, taught to the citation check | 2026-09-02 | `.claude/skills/housekeeping/probe.mjs`; this file's Section index |
| `U6` | Six citations named the wrong section, four resolved to nothing | five corrected in source; the `.changeset/` one left as frozen history | 2026-08-31 | `packages/core/src/config/` |
| `U7` | `redirectStep()` is public; the guard that makes it safe is not | option 1 — `withRedirect` and `stripCrossOriginMarkerStep` promoted | 2026-09-02 | `packages/core/etc/core.api.md` |
| `U8` | Two published READMEs shipped a sample that does not compile | both show `close()` in a `finally`, and say why | 2026-08-31 | `packages/transport-fetch/README.md`, `packages/transport-undici/README.md` |
| `U9` | A `@throws` named a class that does not exist, ten more unreachable | option 3 — eight promoted, the two bug-signalling tags rewritten | 2026-09-02 | `packages/core/etc/core.api.md`; `docs/sdk-documentation/errors.md` |
| `U10` | Three documents stated three different, all-wrong citation counts | replaced by one derivation, a command rather than a sentence | 2026-09-01 | `node .claude/skills/housekeeping/probe.mjs --only=citations` |
| `U11` | The count checker could not read the counts it was written for | `parseNumeral` plus a subject-anchored, required claim table | 2026-09-01 | `.claude/skills/housekeeping/probe.mjs`, `probe.test.mjs` |
| `V1` | `OBS-19`/`TRANSPORT-13`: three modes, one level | `'all'` and `'first-per-name'` now warn; `'quiet'` stays silent | 2026-09-02 | `packages/transport-shared/src/drop-log.ts` |
| `V4` | `retrySettings` accepted a delay no timer can honor | closed from the other side — V13's chunked clock waits any finite duration | 2026-09-02 | `packages/core/src/retry/settings.ts`; `packages/core/src/config/clock.ts` |
| `V5` | One defect, two register letters, two contradicting statuses | resolved by merge — H14 canonical, P1 points at it | 2026-09-02 | H14 and P1, both retired |
| `V6` | The register hard-coded its own citation count | number replaced by the derivation command U10 prescribes | 2026-09-02 | this file's Section index |
| `V7` | Section Q's `Response.close()` latch claim is stale | Q's superseded paragraph is removed by this retirement pass | 2026-09-02 | `packages/core/src/http/response.ts:200-207` |
| `V8` | Section Q's assertion-count correction is wrong about Phase 4a | Q's superseded paragraph is removed by this retirement pass | 2026-09-02 | `packages/core/src/context/store.ts:35,49,67` |
| `V9` | Section R's "Suggested order" sequences work before Phase 4 | closed as advice; the block is removed by this retirement pass | 2026-09-02 | Section R |
| `V10` | Section R's Phase-3 residuals show four shipped rows as pending | marks corrected, then the four rows retired with this pass | 2026-09-02 | the four `R — residual` rows below |
| `V12` | Section H asserts and denies the same fact, four items apart | `H4`'s stale sentence struck and pointed at `H18` | 2026-09-02 | `packages/codec-json/tsconfig.json` carries no `references` key |
| `V13` | A `RETRY-18`-clamped pacing hint exceeds any timer | `Clock.sleep` chains timers, so a 365-day hint is waitable and no deviation is owed | 2026-09-02 | `packages/core/src/config/clock.ts`, `sleepInChunks` |
| `V14` | `N2`'s premise is false: core constructs the forbidden exception | `RetryDiscardedResponseError` gave `retire()` an honest trail entry | 2026-09-02 | `packages/core/src/retry/errors.ts` |
| `V15` | Section T's `F9` deadline passed; `Cursor` never checks the signal | `Cursor.#dispatch` checks at every step boundary, mapping through N1's mapper | 2026-09-02 | `packages/core/src/pipeline/cursor.ts` |
| `Q.D1` | Changeset level for `Request.body`'s narrowing to `Body \| undefined` | resolved to minor under semver's initial-development carve-out, pointer in the changeset | 3b execution | `.changeset/2026-08-25-body-lifecycle.md` |
| `Q.D2` | Three Phase-1/3a symbols the 3b plan called could not be verified | verified against the real code; the real names were used, no duplicates added | 3b execution | `packages/core/src/io/limits.ts` (`MAX_BYTE_ARRAY_LENGTH`), `http/status.ts`, `http/protocol.ts` |
| `R.E1` | `[Symbol.asyncDispose]` declared ahead of the declared floor | 3b reverted to `close()`-only; the §5.4 reopening closed when the `>=20.4` bump was rejected | 2026-09-02 | Section D's `await using` row; `I3` |
| `R.E5` | `bun test` proves nothing about the Node runtime | §5.9's own prescription implemented — a `node --test` tree plus a two-version CI matrix | 2026-08-26 | `tests/node-conformance/`; `.github/workflows/ci.yml` |
| `R.E6` | No per-class `#private` justification comment | closed on `F5`'s reading — the convention is stated once, project-wide | 2026-09-02 | `CLAUDE.md`, "Domain model construction pattern" |
| `R.E7` | `NFR-14`'s stale "no direct Bun equivalent" reason | moot — Phase 6a adopted workspace catalogs | 2026-08-27 | root `package.json`, `workspaces.catalog` |
| `R.E8` | `crypto` is absent from ESM on every Node 18 | floor raised to `>=20.3`, with `lib`/`target` moved to ES2023 | 2026-08-26 | `scripts/verify-runtime-floor.mjs`; `packages/*/package.json` |
| `S.F1` | `SuppressedError` does not exist on the declared runtime floor | branch (b) — a runtime-guarded `suppress()` helper, not a `>=24` floor | 2026-08-26 | `packages/core/src/suppress.ts` |
| `S.F2` | Zero assertions across the whole `recovery/` module | ledgered in 4b, then settled project-wide as won't-fix at `F3` | 2026-09-02 | `F3`, retired; `docs/deferred-items.md`'s *Assertion-density rule applied project-wide* row (retired) |
| `S.F3` | Stale `wrapCancellation()` `invariant()` sentence in the 4b spec | replaced with `assertNever`'s `InvariantViolation`, matching the plan | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F4` | The spec never designs the `assertNever` addition the plan builds | `invariant.ts` added to the spec's File Layout | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F5` | `RECOV-14`'s concurrent-invocation clause claimed but untested | one design sentence plus an interleaved-`apply()` test | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `S.F6` | `RECOV-32`/`RECOV-33` read as silent drops | the Scope sentence now names 5a and 7a by requirement | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` design doc |
| `S.F7` | `#private` fields with no justifying comment | closed on `F5`'s reading; the cosmetic remainder is logged, not owned | 2026-08-30 | `CLAUDE.md`; `docs/deferred-items.md`'s *`#private`-vs-`private`* row, still deferred |
| `S.F8` | The chain property test drops half of what the spec promises | generator extended to seed `Failure` and assert `RECOV-4` | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `S.F9` | `fold()`'s three positional parameters trip the corpus prose | dissolves under the lint threshold the repository actually follows — see `V11` | 2026-09-02 | `eslint.config.js` `max-params`; `V11`, live |
| `S.F10` | `statusMappingStep` is a module-level `const` arrow | changed to a named `function` declaration with a `satisfies` check | 2026-07-28 | `docs/work/mvp/phase4/phase4b/` plan |
| `T.F1` | `PIPE-17`'s "options readable by any step" claimed while unmet | both documents record the partial deferral by name — 5a Task 1 | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` documents |
| `T.F2` | Spec lists `replace` among the pillar-collision raisers | `replace` removed, `prependAll` added, `PIPE-5`'s exemption spelled out | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` design doc |
| `T.F3` | `contextStore.clear()` in `afterEach` wipes sibling test state | both hooks deleted, with a comment recording why | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F4` | `NFR-13`'s SPDX header absent from every 4c listing | Global Constraints bullet, every listing, and Task 6's grep | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F5` | Claimed property tests the plan never shipped | three real `fc.assert` properties added for `PIPE-22`/`PIPE-38` | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` plan |
| `T.F6` | Pipeline errors carry symbols as fields but never render them | both messages interpolate `String(type)` | 2026-07-29 | `packages/core/src/pipeline/errors.ts` |
| `T.F7` | `StepContext.fork?: () => Next` spelled bare | spelled `?: (() => Next) \| undefined` in both documents | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` documents |
| `T.F8` | `PIPE-18`/`PIPE-19` tags swapped on the builder listing | IDs corrected; the prose names the module-level helper | 2026-07-29 | `docs/work/mvp/phase4/phase4c/` design doc |
| `T.F9` | `Cursor` never checks the signal between steps | option (a) — check in `#dispatch`, map through `abortToSdkError`; see `V15` | 2026-09-02 | `packages/core/src/pipeline/cursor.ts` |

---

## Purged rows without an item ID

The 25 rows of the deleted `## Retired rows without an item ID` table. These reserve no ID — they are
Section D's deferral rows, Section R's Phase-3-owned residuals, and `L1`'s two resolved halves, cited by
section and row title rather than by ID. The probe does not read this table.

| Row | Subject | Resolution | Date | Evidence |
|---|---|---|---|---|
| L1 — `OBS-19` | Dropped-header verbosity policy deferred to Phase 8a | fixed — the policy now has three levels, not one; recorded as V1 | 2026-09-02 | `packages/transport-shared/src/drop-log.ts` |
| L1 — `OBS-28` | Richer HTTP-tracer vocabulary deferred to Phase 8a | closed as satisfied-by-level — a SHOULD whose no-op extension mechanism ships | 2026-09-02 | `packages/core/src/observability/tracing.ts:40-74` |
| R — residual: `BODY-34`'s shared preview-cap value | one cap value for both logging tees | shipped in 7b — one configured value threaded through both | 2026-09-02 | `packages/core/src/observability/logging-step.ts` |
| R — residual: `BODY-4`/`BODY-5` replayability consultation | resilience must read `body.replayable` | shipped in 5a and 5b | 2026-09-02 | `retry/classify.ts` `isResendable`; `redirect/decide.ts` |
| R — residual: `FileBody` | `HTTP-40`/`BODY-11`/`12`/`13`/`36` | shipped in 8a as a package, on the structural `Body.kind === 'file'` contract | 2026-09-02 | `packages/body-file/` |
| R — residual: logging tees unwired to any `Logger` | both tees need a driver | shipped in 7b — both are driven from the logging step | 2026-09-02 | `packages/core/src/observability/logging-step.ts` |
| D — Body lifecycle | `HTTP-36`–`HTTP-43` | shipped in 3b | 2026-08-26 | `packages/core/src/body/` |
| D — Lazy `TypedResponse<T>` | `HTTP-44`, `HTTP-45` | shipped in 3b | 2026-08-26 | `packages/core/src/body/typed-response.ts` |
| D — `MultipartBody` | `HTTP-51` | shipped in 3b; the non-appearance clause stays open in Section R's residuals | 2026-08-26 | `packages/core/src/body/multipart-body.ts` |
| D — 1 MiB error-body buffering cap | `HTTP-52` | shipped in 3b; `RECOV-16` reuses it unchanged | 2026-08-26 | `packages/core/src/body/http-status-error.ts` |
| D — Seam contracts | `SEAM-2`–`SEAM-30` | verified shipped across Phases 2 and 6a; §10 item 2 records the byte-stream removal | 2026-09-02 | `packages/core/src/seams/` |
| D — Adapter packages, peer-dependency dedup | `NFR-2` | nine publishable packages, core a peer of every one | 2026-09-02 | `bun run verify:seam-1` |
| D — Shrink-survival regression guard | `NFR-9` | `@dexpace/shrink-test`, private, in the CI step list | 2026-09-02 | `packages/shrink-test/` |
| D — Concurrency-model agnosticism check | `NFR-11` | 4c executed; §10 item 1 carries the full-port collapse | 2026-09-02 | `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` |
| D — `CTX-17`'s positive half | `CTX-17` | `Runtime.send()` installs and evicts its own store entry | 2026-09-02 | `packages/core/src/pipeline/runtime.ts` |
| D — Real W3C Trace Context generation | `CTX-14`, `CTX-15` | `generateTraceId`/`generateSpanId` ship with the all-zero sentinel guard | 2026-09-02 | `packages/core/src/observability/tracing.ts` |
| D — `FakeTransport` test double | — | ships and is used across the retry, redirect, auth and observability suites | 2026-09-02 | `packages/core/src/testing/fake-transport.ts` |
| D — Self-identifying version metadata | `NFR-15` | shipped; the missing barrel export is `K1`, not this row | 2026-09-02 | `packages/core/src/config/build-info.ts`, `client-identity-step.ts` |
| D — `NFR-8` re-confirmed as a documented non-applicability | `NFR-8` | recorded as a deviation — no reflection-driven discovery surface exists | 2026-09-02 | deviations.md §10 |
| D — Redirect structured logging | `REDIR-28`, `REDIR-15`, `XCUT-17`(d) | all three families emit; see `G2` | 2026-09-02 | `packages/core/src/redirect/redirect-step.ts` |
| D — Redirect's loop-detected and malformed-Location events | `REDIR-28` | both emit behind the stop-reason discriminant; see `G3` | 2026-09-02 | `packages/core/src/redirect/decide.ts` |
| D — The cross-origin marker's consumption side | `REDIR-11`(b/c), `XCUT-17`(b), `AUTH-29` | `planOutbound` reads the marker and clears it; see `G7` | 2026-09-02 | `packages/core/src/auth/auth-step.ts` |
| D — Auth re-runs per redirect hop | `PIPE-2` | `standardResilience()` seats `authStep()` inside the redirect pillar | 2026-09-02 | `packages/core/src/auth/preset.ts` |
| D — Public-barrel promotion of `redirectStep`/`withRedirect` | — | the half 5c left is closed; see `U7` | 2026-09-02 | `packages/core/etc/core.api.md` |
| D — Re-confirm the redirect predicate's scope | `REDIR-20` | confirmed and recorded as a deviations row; see `G4` | 2026-09-02 | deviations.md, "Deviations recorded outside a phase" |

---

## Purged deferral rows

The 67 rows of `docs/deferred-items.md`'s deleted `## Delivered and retired` table: every deferral since
delivered, closed, or settled as won't-fix, with the phase and commit that discharged it. Two of them
(`SEAM-5`–`SEAM-10` and `SEAM-18`) were never deferrals at all — permanent simplifications kept there because
they are easy to mistake for one. Rows are keyed by requirement ID or topic, never by line number.

| Row key (requirement ID or topic) | Origin phase | Delivered / closed by (phase, commit) | Evidence (`file:line`) | Date retired |
|---|---|---|---|---|
| `NFR-2` — each optional capability a separately installable unit | Phase 0 | Phase 6a (`743f316`) + Phase 8a (`a0d734d`) | `packages/codec-json/package.json` (`dependencies: {}`); `packages/transport-fetch/package.json:22-24` + `scripts/verify-seam-1.mjs:32-35` — allow-list-qualified: the gate asserts zero *unlisted* runtime deps, not zero deps | 2026-09-02 |
| `NFR-9` — shrink-survival regression guard | Phase 0 | Phase 9 (`d8217af`) | `packages/shrink-test/src/{bundle,fixture-app,run-shrink-guard}.ts` — runs via `bun run test` (`package.json:54`), **not** the `build` script and not a named CI step | 2026-09-02 |
| `NFR-11` — concurrency-model agnosticism | Phase 0 | Phase 4c (`63ed1b7`) | `packages/core/src/pipeline/step.ts` — `Step`/`Next`/`Runtime` are `Promise`-only; no framework async type leaks | 2026-09-02 |
| `NFR-12` — reproducible byte-identical builds | Phase 0 | closed 2026-08-29 | `scripts/verify-reproducible-build.mjs`, a blocking CI step over `dist/` and every `npm pack` tarball | 2026-09-02 |
| `NFR-13` — SPDX header per source file | Phase 0 | Phase 1 plan (2026-07-28) | Phase 1's Global Constraints; enforcement stays review-level by the spec's own wording, with no mechanical gate | 2026-09-02 |
| `NFR-14` — one source of truth for tool versions | Phase 0 | Phase 6a, closed 2026-08-27 | root `package.json` `workspaces.catalog`; members reference `"catalog:"` | 2026-09-02 |
| `NFR-15` — real `User-Agent`, never a placeholder | Phase 0 | Phase 7a (`bd37a08`) + Phase 8a (`a0d734d`) | `packages/core/src/config/client-identity-step.ts:109`; conformance at `packages/transport-conformance/src/run-suite.ts:517-525` | 2026-09-02 |
| `NFR-8` — shrinker keep/retain configuration | Phase 0 | Phase 10, closed 2026-07-28 | not applicable by design — this port has no reflection-driven discovery surface to keep-configure (§10 Item 10) | 2026-09-02 |
| Peer-dependency dedup for `@dexpace/core` (dual-package hazard) | Phase 0 | Phase 6a, closed 2026-08-27 | `scripts/verify-seam-1.mjs` asserts the peer + `peerDependenciesMeta` for every non-core package; `packages/codec-json/src/cross-package.test.ts` proves the consequence | 2026-09-02 |
| `NFR-10`/`NFR-17` — CI against the declared minimum Node | Phase 0 | Phase 2 (`8e55792`), replaced wholesale in Phase 3 (`e3ba885`) | `.github/workflows/ci.yml:99-130` — job `node-conformance`, matrix `['20.3.0','lts/*']` at `:110`, `bun run test:node` at `:129`. `scripts/verify-node-floor.mjs` shipped in Phase 2 and was **deleted** in `e3ba885` | 2026-09-02 |
| `MultipartBody` model (HTTP-3, HTTP-51, BODY-2) | Phase 1 | Phase 3b (`e3ba885`) | `packages/core/src/body/multipart-body.ts` | 2026-09-02 |
| `Request`/`Response` real body type | Phase 1 | Phase 3b (`e3ba885`) | `packages/core/src/http/request.ts:118`; `packages/core/src/http/response.ts:126` (`BODY-14`) | 2026-09-02 |
| `Logger`/`LogEvent` seam | Phase 2 | Phase 7b (`bd37a08`) | `packages/core/src/observability/logger.ts:274` + the global slot; bridges `@dexpace/logging-pino`, `@dexpace/logging-debug` | 2026-09-02 |
| `FakeTransport` test double | Phase 2 | Phase 5a (`cba4721`) | `packages/core/src/testing/fake-transport.ts` (`@internal`), with `countingResponse()` | 2026-09-02 |
| Phase 4 split into 4a / 4b / 4c | Phase 4 brainstorm | executed, Phase 4 (`63ed1b7`) | ~76 combined normative IDs; 4a first, then 4b and 4c | 2026-09-02 |
| Phase 5 split into 5a / 5b / 5c | Phase 5 brainstorm | executed, Phase 5 (`cba4721`) | 111 combined IDs; retry → redirect → auth, an order forced by coupling not size | 2026-09-02 |
| Phase 6 split into 6a / 6b / 6c | Phase 6 brainstorm (2026-07-28) | executed, Phase 6 (`743f316`) | 107 combined IDs; no segment depends on another — `SSE-37` and §12's preamble make the cross-segment surface empty by mandate | 2026-09-02 |
| Collapsed-requirement disposition tables for Phase 6 | Phase 6 brainstorm | Phase 6a/6b/6c (`743f316`) | 6a design `:339`; 6c design `:352` (`PAGE-25`–`PAGE-28` at `:360-363`); 6b design | 2026-09-02 |
| 3a's `readUtf8Line()` unusable for SSE (`IO-14` vs `SSE-2`) | Phase 6b | Phase 6b, closed 2026-08-27 | `packages/core/src/sse/line-reader.ts` — 6b owns its own reader rather than reshaping a frozen 3a surface | 2026-09-02 |
| `sdk-design-nodejs/07` §7.1 closes the page after yielding; `PAGE-11` requires before | Phase 6 brainstorm | Phase 6c, closed 2026-08-27 | `PAGE-11` governs — copy items, close, then yield; both the design and the knowledge corpus amended | 2026-09-02 |
| `PAGE-5`'s "synchronously inside parse" literal reading | Phase 6 brainstorm | Phase 6c, closed 2026-08-27 | Node has no synchronous body read, so `parse` returns a promise; every part of the requirement's intent survives | 2026-09-02 |
| `SSE-41` — reactive SSE adapter | Phase 6 brainstorm | Phase 8b (`a0d734d`) | `packages/rx/src/sse.ts:13` and `:39` | 2026-09-02 |
| Appendix C `RECOV-17`–`RECOV-34` reconciliation (18 rows) | Phase 4 sizing review | Phase 5a (`cba4721`) | row-by-row mapping table in the Phase 5a design; 16 collapse onto their §9 twin, `RECOV-32`/`RECOV-33` are genuinely new | 2026-09-02 |
| Real W3C Trace Context generation | Phase 4a | Phase 7b (`bd37a08`) | `packages/core/src/config/identifiers.ts:25-30`; `packages/core/src/observability/tracing.ts:206-223` | 2026-09-02 |
| `contextsEqual()` value-equality utility for `ExecutionContext` | Phase 4a | won't-fix, 2026-09-02 | 4b and 4c both shipped in `63ed1b7` without needing it, so the row's own trigger can never fire | 2026-09-02 |
| `PIPE-35` — FLATTEN-vs-NEST pipeline seeding | Phase 4c | Phase 5c (`cba4721`) | `packages/core/src/pipeline/builder.ts:238` — `seedFrom(runtime, 'flatten' \| 'nest')`, non-defaulted | 2026-09-02 |
| `PIPE-2` / `PIPE-40` conformance clauses | Phase 4c | Phase 5b + Phase 5c (`cba4721`) | 5b's two-hop `FakeTransport` test; 5c's per-hop auth re-run closing `PIPE-2`'s remaining half with `AUTH-29` | 2026-09-02 |
| `PIPE-24`/`PIPE-39` — the standard-resilience preset | Phase 4c | Phase 5c (`cba4721`) | `packages/core/src/auth/preset.ts:103` — `standardResilience()` | 2026-09-02 |
| `PIPE-36` — a shipped pillar family locks its stage | Phase 4c | Phase 5a (`cba4721`) | satisfied structurally: `retryStep()` returns a `StepDescriptor` with `stage: 'RETRY'` baked in, so there is nothing to relocate | 2026-09-02 |
| Public-barrel promotion of the pillar-step authoring surface | Phase 4c, re-confirmed in Phase 5a | Phase 5c (`cba4721`) | `packages/core/etc/core.api.md` — `Stage`/`STAGE_ORDER`/`PILLAR_STAGES`/`StepDescriptor`/`PipelineBuilder`/`Runtime`/the three pillar factories/`standardResilience` | 2026-09-02 |
| `RECOV-33` — client-identity header step | Phase 5a brainstorm | Phase 7a (`bd37a08`) | `packages/core/src/config/client-identity-step.ts:109` | 2026-09-02 |
| `StepContext.signal` and `StepContext.options` (`PIPE-17`) | Phase 5a brainstorm (`signal`); 2026-07-28 plans review (`options`) | Phase 5a Task 1 (`cba4721`) | `packages/core/src/pipeline/step.ts:58` and `:64` | 2026-09-02 |
| `RequestOptionsBuilder.maxRetries` accepts `Infinity`/`NaN`/fractions | Phase 5a code review (2026-08-26) | Phase 5's merge `cba4721` (2026-08-27) | `packages/core/src/http/request-options.ts:178`; `.changeset/2026-08-26-max-retries-range-check.md`. **Phase 10 was never its owner** and this row named it as such until 2026-08-30 | 2026-09-02 |
| The two structured retry log events + `RETRY-40`'s diagnostic half | Phase 5a execution (2026-08-26) | Phase 7b Task 9 (`bd37a08`) | `packages/core/src/retry/engine.ts:323` and `:396`, plus a third the plan never named, `http.retry.delayOverrideFailed` | 2026-09-02 |
| Phase 7a Tasks 1-3 executed early as 5a's prerequisite | Phase 5a execution (2026-08-26) | executed inside Phase 5a's window (`cba4721`) | the row's prescription ("7a's plan should mark Tasks 1-3 done") was **struck 2026-09-02**: `docs/work/` is a dated record and is never retro-edited, so 7a's plan still correctly reads `- Create:` at `:122`, `:265`, `:429` | 2026-09-02 |
| `SEAM-30` — orphan-response cleanup on the completion race | Phase 2 | Phase 8a (`a0d734d`) | `packages/transport-fetch/src/fetch-transport.ts:241`; `packages/transport-undici/src/undici-transport.ts:454` | 2026-09-02 |
| Byte-stream provider (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) | Discussed in Phase 2 (`sdk-design/03` §3.1), built in | Phase 3a (`e3ba885`) | `packages/core/src/io/{byte-queue,buffered-source,buffered-sink,tee-sink}.ts`, behind an internal barrel | 2026-09-02 |
| Every buffering cap — `BODY-19`, `BODY-30`/`HTTP-52`, `BODY-34` | Phase 3a | Phase 3b (`e3ba885`) for two; `BODY-34` in Phase 7b (`bd37a08`) | `packages/core/src/body/request-body-logging.ts:80-88`; `http-status-error.ts:18`; `observability/logging-step.ts:64-65`. **`BODY-34` is NOT threaded through `toHttpError`** — the code says so at `http-status-error.ts:16-17`, and this row claimed otherwise until 2026-09-02 | 2026-09-02 |
| Promotion of any §5 type into the published barrel | Phase 3a | Phase 3b (`e3ba885`) — never promoted; error leaves promoted in Phase 8a (`a0d734d`) | `packages/core/src/index.ts:35` exports `IoError`/`TransportFailureError` (`core.api.md:503`, `:1301`); no provider type is promoted. `packages/core/src/io/index.ts:5-7`'s "NOTHING here is re-exported" comment is stale and is a source edit nobody has made | 2026-09-02 |
| `MAX_BYTE_ARRAY_LENGTH` constant value (`IO-9`) | Phase 3a | Phase 3a plan time (`e3ba885`) | `packages/core/src/io/limits.ts:28` — `2 ** 31 - 1`, with the `AllocationLimitError` backstop at `:39-40` | 2026-09-02 |
| `Symbol.asyncDispose` on §5 resources | Phase 3a | closed 2026-08-30 | runtime-guarded, optionally-typed install in 6b/6c delegating to `close()`. Promotion to `implements AsyncDisposable` is **rejected, not pending** — `open-items.md` Section D. This row claimed a live residue until 2026-09-01; there is none | 2026-09-02 |
| `SEAM-5`–`SEAM-10` — discovery/registration/conflict-resolution machinery | Phase 2 | **Never** — permanent simplification, closed 2026-07-28 | §10 Item 2. Node has no pluggable byte-stream factory or fragmented async ecosystem to discover across. Never a deferral; kept here because it is easy to mistake for one | 2026-09-02 |
| Concrete `Serde` implementation (`@dexpace/codec-json`) | Phase 2 | Phase 6a, closed 2026-08-27 | `packages/codec-json/etc/codec-json.api.md` — `jsonSerde()`, the Tristate replacer, the decode combinators | 2026-09-02 |
| Concrete `Transport` implementations | Phase 2 | Phase 8a (`a0d734d`) | `packages/transport-fetch/src/fetch-transport.ts`; `packages/transport-undici/src/undici-transport.ts` | 2026-09-02 |
| `SEAM-21` — explicit runtime type token for deserialization | Phase 2 | Phase 6a, closed 2026-08-27 | every decode entry point takes a caller-supplied `Schema<T>`; `Serde` dropped its type parameter and the reshaped seam is public, forced by the package split | 2026-09-02 |
| `SEAM-14` — close *behavior* | Phase 2 | Phase 8a (`a0d734d`) | `fetch-transport.ts:292-300` (sanctioned no-op); `undici-transport.ts:511-532` (`destroy()`, reverse order, idempotent, memoized); test `undici-transport.test.ts:234` | 2026-09-02 |
| `SEAM-12` — concurrent-call conformance test | Phase 2 | Phase 8a (`a0d734d`) | `packages/transport-conformance/src/run-suite.ts:432` (group) and `:440` (many concurrent sends) | 2026-09-02 |
| `SEAM-18` — sync↔async bridges | Phase 2 | **Never** — permanent simplification, closed 2026-07-28 | §10 Item 2. Its one non-bridge clause survives as a `Transport.send()` obligation. Never a deferral | 2026-09-02 |
| `HTTP-18`/`HTTP-48`/`HTTP-50` — outbound header strictness vs ETag obs-text | Phase 1 | Phase 10, closed 2026-07-28 | strict outbound path kept; `HTTP-18`'s MUST outranks `HTTP-48`'s SHOULD (§10 Item 15) | 2026-09-02 |
| `FileBody` (`BODY-11`/`12`/`13`/`36`) | Phase 3b brainstorm | Phase 8a (`a0d734d`) | `@dexpace/body-file`'s `fileBody()`; core carries a type-only `FileBodyDescriptor` and `body.kind === 'file'` structural narrowing, never a cross-package `instanceof` | 2026-09-02 |
| `redirect/cross-origin.ts` — the `REDIR-11`/`AUTH-29` shared signal | Phase 5b brainstorm | Phase 5b (`cba4721`) | `packages/core/src/redirect/cross-origin.ts`. Kept as a standing caution: two solo brainstorms sharing a cross-phase contract drifted twice, on the marker's *shape* and again on its *scope* | 2026-09-02 |
| `standardResilience()` gains a `LOGGING` pillar step | Phase 5c brainstorm | Phase 7b (`bd37a08`) | `packages/core/src/auth/preset.ts:111` — `.append(loggingStep(options.logging))`, inert at `granularity: 'none'` | 2026-09-02 |
| `DigestChallengeUnsupportedError` | Phase 5c brainstorm | **cut before shipping, in Phase 5c** | absent from `packages/` entirely. 5c checklist `:229`; `open-items.md` G11. **This row asserted the opposite — "kept, permanently" — until 2026-09-02**, sending a reader after a symbol that does not exist | 2026-09-02 |
| Basic/Digest never stamp preemptively (an interpretation) | Phase 5c brainstorm | Phase 10, closed 2026-07-28 | confirmed correct as designed; the spec's asymmetry reads as deliberate (§10 Item 12) | 2026-09-02 |
| Redirect predicate's scope over safety mechanics (`REDIR-20`) | Phase 5b brainstorm | Phase 10, closed 2026-07-28 | confirmed correct as designed — safety mechanics are governed by `XCUT-17`'s universal framing (§10 Item 12) | 2026-09-02 |
| Redirect structured logging — `REDIR-28`'s four event families | Phase 5b brainstorm | Phase 7b (`bd37a08`); the reason discriminant and the last two events 2026-09-02 (uncommitted at time of writing) | `packages/core/src/redirect/decide.ts:44-58` (`RedirectStopReason`) and `:72`; `redirect-step.ts:126` hop, `:70` loop, `:118` downgrade, `:81` malformed-`Location` (raw by `REDIR-28`'s own carve-out). Closed jointly with `open-items.md` G3 | 2026-09-02 |
| 5a's `RetryConfig.clock`/`random` retyped against 7a's `Clock` | Phase 7a brainstorm | Phase 7a (`bd37a08`) | `packages/core/src/retry/retry-step.ts:3`, `:35`, `:42`, `:124`; `engine.ts:46`, `:48` | 2026-09-02 |
| 5a's private RFC 1123 parser re-sourced from `config/http-date.ts` | Phase 7a brainstorm | Phase 7a (`bd37a08`) | `packages/core/src/retry/pacing.ts:10` — one parser in the codebase, not two | 2026-09-02 |
| 5a's private `RETRYABLE_STATUSES` re-sourced from `config/retryable.ts` | Phase 7a brainstorm | Phase 7a (`bd37a08`) | `packages/core/src/retry/classify.ts:13` re-exports it, so `RETRY-1` and `CFG-35` cannot drift | 2026-09-02 |
| Whether `clientIdentityStep` joins `standardResilience()` | Phase 7a brainstorm | Phase 10, closed 2026-07-28 | stays out, permanently — no requirement mandates it; a caller installs it explicitly | 2026-09-02 |
| Retry/redirect structured-logging event names and fields | Phase 7b brainstorm | Phase 7b plan time (`bd37a08`) | `retry/engine.ts:18`, `:323`, `:396`; `redirect/redirect-step.ts:50`, `:73`, `:81` — all six under one `http.` prefix | 2026-09-02 |
| Whether the preset accepts a `tracerFactory`/`meter` pass-through | Phase 7b brainstorm | Phase 9 (`d8217af`) | `tests/conformance/xcut/fixtures/composed-pipeline.ts` configures all three through the existing `logging` option — no friction found, closed rather than re-deferred | 2026-09-02 |
| Phase 8 split into 8a / 8b | Phase 8 brainstorm (2026-07-28) | executed, Phase 8 (`a0d734d`) | 52 nominal combined IDs, but §17 is paid twice (two full `Transport` implementations) and nine log rows landed there | 2026-09-02 |
| Assertion-density rule applied project-wide | Phase 4b validation review F2 (2026-07-28) | won't-fix, 2026-09-02 | 43 non-test modules call `invariant()`; `http/`, `seams/`, `generated/` and `recovery/` are at zero, which is the correct shape. `open-items.md` F3/H6; `deviations.md`, "Deviations recorded outside a phase". **This row said thirteen modules and named `recovery/` as the lone holdout** until 2026-09-02 | 2026-09-02 |
| `CONSTANT_CASE` vs `lowerCamelCase` for module-level immutable collections | Phase 4c validation review (2026-07-29) | resolved by practice, 2026-09-02 | 24 module-level collections swept across all eleven packages, every one `CONSTANT_CASE`, zero `lowerCamelCase`. Declarations at `packages/core/src/pipeline/stage.ts:38`, `:58`. **This row's trigger had already fired six times** and it cited the import line, not the declaration | 2026-09-02 |
| `BODY-34`'s single shared preview-cap **value** | Phase 3b checklist | Phase 7b (`bd37a08`) | `packages/core/src/observability/logging-step.ts:64-65`, resolved once at `:465-466`, threaded to both tees at `:327` and `:379`. Recovered by the 2026-09-02 audit; had never reached this register | 2026-09-02 |
| Wiring either logging tee to a real `Logger` | Phase 3b checklist | Phase 7b (`bd37a08`) | `packages/core/src/observability/logging-step.ts:492` — `settings.logger ?? getGlobalLogger()`. Recovered by the 2026-09-02 audit; had never reached this register | 2026-09-02 |

---

## Retired review sections

Three of the four reviews the roadmap once carried in its own `## Open Findings` headings were relocated
into `docs/open-items.md` on 2026-08-31 as Sections Q, S and T: a validation pass over Phase 3b's design and
plan **before** either was executed, and two more over Phase 4b's and Phase 4c's. Every row of all three
reached a resolved disposition on 2026-09-02, and on 2026-09-04 the prose that framed them followed the rows
out of the register — a validation pass over an unexecuted phase is a dated record of what was true that
week, not an item anyone can still act on.

It is kept here because the prose is worth more than the rows were. Each section names the blockers it found
and the constraint each one generalizes into, the corpus conflicts it surfaced without ruling on, and a long
*applied without needing a decision* inventory — corrections made to the phase documents themselves, which
therefore left no trace anywhere else. That inventory is the part a later phase would otherwise re-derive.
Section R, the fourth relocated review, stays in the register: its `E2`–`E4` are open.

Reproduced verbatim, headings demoted one level. The cross-references inside them stand as written: `V11` is
a live register item, and `V15` and the row IDs resolve against the **Purged item IDs** table above.


### Section Q — Phase 3b validation review (2026-07-28)

> **Relocated.** A validation pass over Phase 3b's design and plan **before** either was executed. Relocated verbatim on
2026-08-31 from the roadmap's `## Open Findings — Phase 3b Validation Review (2026-07-28)` section. Its rows
are labelled `D1`, `D2` — the review's own numbering, not this register's item IDs.

A validation pass over `specs/2026-07-25-phase3b-body-lifecycle-design.md` and
`plans/2026-07-25-phase3b-body-lifecycle.md` (`docs/validation-prompts/phase3b-body-lifecycle-validation-prompt.md`)
returned **BLOCKED** on two runtime defects and a cluster of overclaimed disposition rows. **All findings except
D1 and D2 below are applied** to both documents. Recorded here rather than in `docs/deferred-items.md` because
these are review findings against an unexecuted phase, not deferrals of work.

The two blockers, both now fixed, are worth naming since they generalize: (1) `ReadableStream.cancel()` rejects
with `TypeError` on a locked stream and reading to `{done: true}` does **not** release the reader's lock, so
`Response.bytes()`, `toHttpError()` and the response-logging wrapper each had a `finally`-scoped close that
replaced a successful read with a `TypeError` — a `reader.releaseLock()`-before-cancel constraint now sits in the
plan's Global Constraints, and **every later phase that takes a reader and later closes the stream inherits it**;
(2) `HTTP-39`/`BODY-10`'s exact-length copy was dispositioned as "reuses Phase 3a's `writeAll`" while the plan's
own global constraint forbids importing `BufferedSink`, leaving a declared `contentLength` unverified and a short
stream sending a truncated body silently.

All rows retired 2026-09-02. Row IDs `Q.D1` and `Q.D2` remain reserved.

**Applied without needing a decision** (recorded so the reasoning survives): `BODY-34`'s "one shared cap"
contradiction resolved in the plan's favour — the shared preview cap covers the two logging tees, and
`toHttpError`'s 1 MiB cap is separate because `HTTP-52` *fixes* its value and a spec-fixed value cannot be the
configurable one; `BODY-26`/`BODY-29` built (`LoggedResponseBody` gained a non-draining `error()` and a
regime-dependent `contentLength`); `BODY-25` ledgered as structurally inapplicable — `ReadableStreamDefaultReader`
takes no requested count, so "zero bytes for a positive count" has no analog; `BODY-32`'s negative-cap rejection
added to both tees, which previously accepted a negative cap and silently mirrored nothing; `HTTP-3`'s
`MultipartBodyBuilder` added (`HTTP-3` names "the multipart body" explicitly and Phase 1 could not satisfy it);
`HTTP-2` honored by exporting the concrete body classes from the public barrel as **types only**; the `@internal`
tags removed from the three errors Task 13 promotes, which would have made `api-extractor` either fail or
silently omit them; `withResponseLogging` decomposed under the 70-line cap and made pull-driven, since its
`start()`-loop tail stream eagerly materialized the whole remainder of exactly the oversized bodies the cap
exists to keep off the heap.


### Section S — Phase 4b validation review (2026-07-28)

> **Relocated.** A validation pass over Phase 4b's design and plan before execution. Relocated verbatim on 2026-08-31 from
the roadmap's `## Open Findings — Phase 4b Validation Review (2026-07-28)` section.

**Its rows are `F1`–`F10`, the review's own numbering.** Section F above numbers *its* items `F1`–`F9`, and
Section T below numbers a different review's rows `F1`–`F9` again. Three `F` namespaces, no overlap in
meaning. A citation must name the section — "Section S's F2", never a bare "F2". Renumbering was rejected:
the roadmap's own status notes cite "4b's F2/F7" by these numbers, and a dated record that changes its row
IDs stops matching the documents that quote it.

A validation pass over `specs/2026-07-25-phase4b-recovery-chain-design.md` and
`plans/2026-07-25-phase4b-recovery-chain.md` (`docs/validation-prompts/phase4b-recovery-chain-validation-prompt.md`)
returned **BLOCKED**. The `RECOV-1`–`RECOV-16` mapping itself is sound and every cross-phase reference 4b consumes
checks out against the earlier phase plans — `toHttpError(): Promise<HttpStatusError | null>` (3b), `RequestOptions.EMPTY`
(Phase 1), `Transport.send(request, options?, signal?)` + `CancellationError` (Phase 2), and `Response.close()` latching
`#closed` *before* awaiting `body.cancel()` so it propagates a close rejection exactly once (3b). Nothing below is a
defect in that mapping. Recorded here rather than in `docs/deferred-items.md` because these are review findings against
an unexecuted phase, not deferrals of work.

**All ten rows are retired 2026-09-02** — `F1` and `F2` closed, `F3`–`F10` applied to the 4b documents.
Row IDs `S.F1`–`S.F10` remain reserved. `F1`'s resolution is the runtime-guarded `suppress()` helper
(`packages/core/src/suppress.ts`); read it before designing against `SuppressedError` anywhere, because
`esnext.disposable` in `lib` supplies `Symbol.asyncDispose`'s *type* and not `SuppressedError`'s *runtime*.

**Corpus conflict surfaced, not a finding.** `function-design.md:22-23` requires an options object at 3+ parameters
while `function-design.md:40-41` sets `max-params: ['error', 3]`, which errors only at four — the prose is one
parameter stricter than its own stated enforcement. F9 is filed against the prose; if the lint threshold is the
authority, F9 dissolves. Worth settling in the corpus rather than per-phase.
→ **numbered 2026-09-02 as V11**, and given a disposition. "Worth settling" with no owner and no
trigger is how a finding sits unsettled for five weeks; V11 states which of the two the repository
actually follows and what would change it.

A second conflict the 4b documents met and resolved correctly, recorded so a later reader does not re-litigate it:
`resource-management.md:4-5,72` mandates `using`/`await using` and documents that native disposal builds a
`SuppressedError` with the *disposal* failure primary, while `RECOV-12` requires the opposite priority. 4b picks
`RECOV-12` and argues it at SPEC:107-113 / PLAN:55-59. Correct call, already justified in-document.


### Section T — Phase 4c validation review (2026-07-29)

> **Relocated.** A validation pass over Phase 4c's design and plan before execution. Relocated verbatim on 2026-08-31 from
the roadmap's `## Open Findings — Phase 4c Validation Review (2026-07-29)` section. **Its rows are `F1`–`F9`,
the review's own numbering** — see the namespace note on Section S.

A validation pass over `specs/2026-07-25-phase4c-stage-pipeline-design.md` and
`plans/2026-07-25-phase4c-stage-pipeline.md`
(`docs/validation-prompts/phase4c-stage-pipeline-validation-prompt.md`) returned **NEEDS WORK — no blockers.**
The `PIPE-1`–`PIPE-40` mapping is sound and every cross-phase reference 4c consumes checks out against the earlier
phase plans: `Transport.send(request, options?, signal?)` + `close()` (Phase 2), `DexpaceError` as the taxonomy
root under `http/errors.ts` (Phase 2's retrofit), `RequestOptions.EMPTY` (Phase 1), `Status.of`/`Protocol.HTTP_1_1`
(Phase 1), and 4a's `createRequestContext(request, init?)`, `promoteToRequest`/`promoteToExchange`,
`ContextStore.install/get/close/clear/size` with the `kind`/`key`/`request`/`instrumentation`/`operationName`
context shape. Nothing below is a defect in that mapping.

**All nine rows are retired 2026-09-02** — `F1`–`F8` applied to the 4c documents, `F9` fixed to its own
option (a); see `V15`. Row IDs `T.F1`–`T.F9` remain reserved.

**Not findings, recorded so they are not re-raised.** Assertion density (`assertions.md:6-7`) is already open
project-wide as 4b's F2 — 4c is the phase that *satisfies* it, not one that violates it. `STAGE_ORDER` and
`PILLAR_STAGES` in `CONSTANT_CASE` sit against `naming-conventions.md:14`, whose worked example is literally a
module-level `new Set(...)` staying `lowerCamelCase` because its contents can mutate; a `ReadonlySet` type does
not make the underlying `Set` deeply immutable and `Object.freeze` cannot fix a `Set`. Left alone because the
casing question is project-wide (Phase 1's `Protocol`/`Status` statics, 4b's constants) and renaming one phase's
two constants would fork the convention rather than settle it — Phase 10's reconciliation owns it.

**Re-deferred 2026-08-30 (Phase 10): NOT SCHEDULED.** Phase 10 does not own it and did not settle it. The
`CONSTANT_CASE`-vs-`lowerCamelCase` question for module-level immutable collections is a naming-convention
call, not a deviation from the reference contract, so it is outside a reconciliation phase's scope; Phase 10 is
also the last row of the phase table, so there is no later phase to hand it to and none is invented here. The
state is unchanged and still consistent within itself — `STAGE_ORDER` and `PILLAR_STAGES` remain `CONSTANT_CASE`
and remain the pipeline's only such pair (`packages/core/src/pipeline/builder.ts:12`, `:179`, `:248`, `:269`).
**Trigger:** the next module-level immutable collection added outside `pipeline/`, which would make the fork
visible in a third place and force the choice — or a naming-convention sweep commissioned as its own phase.
Logged in `docs/deferred-items.md` so it is tracked rather than silent.


---

## The retirement rule, as the register stated it

The register's status vocabulary carried one row more than the eight it keeps, and that row went out with the
tables. It is the definition the 102 IDs above were retired under, so it is reproduced here rather than lost:
**RETIRED** was never a status an item carried — it was what happened to one that reached a resolved
disposition, whether `FIXED`, `RESOLVED`, `CLOSED`, "merged into", or a closed decision such as won't-fix, an
accepted deviation or an accepted risk. The body was removed and nothing kept in its place; the ID was never
released, never renumbered, never reused. It entered the vocabulary on 2026-09-02, when 76 items and 49 table
rows had accumulated in one file with nothing left to act on — the same pressure that produced this note two
days later.
