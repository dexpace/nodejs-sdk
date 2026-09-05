# Audit #67 remediation — decision ledger

Supervisor-owned record for the remediation run of the 2026-09-04 audit
([umbrella #67](https://github.com/dexpace/nodejs-sdk/issues/67), subtasks #68–#82). One entry per
cross-task decision: which issue raised it, what was decided, the alternatives rejected, and which later
issues it constrains. Deferred work is listed at the end so the release pass can recover it. Umbrella
branch: `audit/remediation-67`, base `mvp`. Task branches: `audit/67/<issue>-<slug>`.

A decision that departs from the spec text is also a dated row in
[`deviations.md`](./deviations.md) under "Deviations recorded outside a phase"; this file records the
*choice*, that file records the *deviation*.

## Ground rules fixed before wave 1

### D0 — Where a remediation deviation is written (raised by #68, #69, #71, #72, #74, #75)
Several subtask issues say "record the reading in the Phase Nx ledger section". Those sections live in
`docs/work/mvp/`, which CLAUDE.md declares a dated record that is never retro-edited. **Decision:** every
deviation or reading this run records goes to `docs/deviations.md` under "Deviations recorded outside a
phase", dated, with `file:line` evidence and "Found by: audit #67 / #<issue>". Phase ledger sections are
not touched. *Rejected:* appending to phase ledgers (retro-edits a dated record; §10 is frozen so it is
not an option either). *Constrains:* every later subtask.

### D1 — Release machinery is out of scope (raised by the run's own brief)
No changesets, no version bumps, no `docs/first-release.md` edits. Each PR lists what it skipped under
"Deferred — release machinery"; the consolidated list is at the end of this file.

### D2 — Wave overlap adjustments
- Wave 1 (#68, #69) both edit the "Deviations recorded outside a phase" table in `docs/deviations.md` and
  `packages/core/src/context/instrumentation.ts`. Kept concurrent: #68 edits existing rows/lines and the
  `tracerFactory` TSDoc; #69 only *appends* rows at the end of the table and changes the single
  `activeSpan` line. The supervisor resolves the adjacent-hunk conflict at merge.
- Wave 3 becomes #72, #74, #75 (all M3); #73 moves to wave 4 with #76, #77. Reason: #72 and #73 both
  reshape `packages/core/src/retry/engine.ts` (`withTrail` vs. the per-attempt re-send of the template),
  and #73's layering choice is easier to make on top of #72's landed trail shape.
- Wave 6 splits: #81 first, then #82. Both edit `undici-transport.ts` and add rows to
  `packages/transport-conformance/src/run-suite.ts` + `fixtures.ts`; #82's "make undici match" clause
  depends on #81's drop-set rewrite.

## Decisions taken for #69 (M1) — the maintainer-decision items

### D3 — CTX-15: fix, not ledger
`noopInstrumentationBundle.activeSpan` becomes `NOOP_SPAN`. One line plus a test. #80 lists the same item;
it is done here, #80 skips it. *Rejected:* ledger row (the fix is smaller than the row).

**D3 outcome (2026-09-04, #69, PR #84).** The size estimate was wrong: importing `NOOP_SPAN` into
`context/instrumentation.ts` closed an import cycle with `observability/tracing.ts` (which imports
`InstrumentationBundle`), and `verify:import-cycles` counts type-only edges. Fixed as that gate prescribes:
`SpanContext`, `Span`, `Tracer`, `NOOP_SPAN`, `NOOP_TRACER` moved to a new leaf module
`packages/core/src/observability/span.ts`; `tracing.ts` re-exports them, so no import path and no API
report changed. The decision itself stands. *Constrains #80:* a `file:line` citation into `tracing.ts` for
those five names is now stale; CTX-15 is done, skip it.

**Trap for every later subtask.** gts turns on `stripInternal`, and TypeScript tests it by substring-scanning
every leading comment of a declaration, line comments included. A module header that merely *mentions* the
`@internal` tag deletes the first exported declaration from the emitted `.d.ts` with no `tsc` diagnostic;
the failure surfaces one package later as an unresolved name in core's own `dist/`. Do not write that tag in
a file-level comment.

**#68 outcome (2026-09-04, PR #83).** Round 1 corrected the TSDoc and guides; round 2 requested because
five `docs/deviations.md` anchors it found stale (items 2, 3, 4, 8, 11) were left unfixed as "outside the
partition" — they are the issue's own acceptance criterion. The false "nothing consumes either yet" claim at
`context/instrumentation.ts:8-13` was assigned to #68 in round 2. *Constrains #78:* item 17 now states the
cause-walk matches `IoError` and `TransportFailureError` only, and names #78 as the decider. *Constrains
#80:* the OBS-29 row is marked in progress with the 1:1 binding recorded as met at `pipeline/runtime.ts`;
the open part is caller-reachability of the operation span. *Constrains #71:* `auth.md`'s credential-shape
example is untouched and is #71's.

### D4 — PIPE-37: ledger the gap, do not implement in M1
No `PRE_REDIRECT` status-mapping pipeline step exists; `statusMappingStep` is a `ResponseStep`. Recorded
as a row in `deviations.md` naming the gap, the Phase 4→5 hand-off that dropped it, and the petstore
spike finding 2 as the same work. Implementing it is real pipeline work with public surface, outside a
docs-only milestone, and opening a tracking issue is a remote action this run is not authorised to take —
the maintainer opens it if wanted. *Constrains:* none of #70–#82 depends on it.

### D5 — REDIR-3: keep the current-hop-method reading, pin it, ledger it
Spec text says "original request method". The port evaluates eligibility against the method of the
request being redirected at *this* hop. The two differ only after an opted-in 303 rewrote POST→GET and a
later 301/302 arrives: the port follows it (GET is in the default set), the literal reading would refuse
it. **Decision:** keep the port's reading — the rewritten GET is idempotent and body-less, the 303 rewrite
is opt-in, and refusing would make `allow303` half-useful — pin it with a test (`allow303: true`, POST,
303 then 301) and record the reading as a `deviations.md` row. *Rejected:* switching to the literal reading
(behaviour change inside a docs milestone; stricter without a safety gain).

### D6 — PAGE-19: WHATWG relative resolution is the intended reading
`<not a url>; rel=next` resolves against the page URL under WHATWG rules, so it is a followable relative
reference, not an unparseable one. A target that fails `new URL(target, base)` still ends the stream.
Pin with a test and ledger the reading. *Rejected:* adding an ad-hoc "looks unparseable" heuristic.

### D7 — HTTP-46, IO-13, BODY-9, BODY-34, IO-38, transport `reasonPhrase`: ledger rows
All six are recorded as rows (evidence + reading). `reasonPhrase` sits beside §10 item 13; #82 reads it as
already done and does not re-ledger it.

## Wave 1 — landed 2026-09-04
PR #83 (#68) and PR #84 (#69) merged into the umbrella at `840f355`. One conflict (the OBS-29 row of
`deviations.md`): kept #68's "in progress, see #80" text and carried #69's moved `span.ts` citation. Merged
tree preflighted before the merge in a throwaway worktree (byte-identical result): all 20 steps passed.

## Wave 2 — landed 2026-09-05
PR #85 (#70) and PR #86 (#71) merged into the umbrella. One conflict (the import list of
`tests/conformance/xcut/security-by-default.conformance.test.ts`), unioned. Merged tree preflighted in a
throwaway worktree before the merge (byte-identical result): all 20 steps passed. Run paused here by the
maintainer; wave 3 (#72, #74, #75) not yet cut.

## Decisions taken for wave 2 (M2)

### D8 — #70: redact inside the error messages, and keep the raw URLs on the error properties
`SchemeDowngradeError` and `NonReplayableBodyError` build their messages from `redactUrl(url)`; `fromUrl` /
`toUrl` stay raw for program use. Reason: the message is what every logger, `cause` chain and consumer
`console.error` renders, so redacting at the source protects paths this SDK does not own, not only
`http.redirect.rejected`. If `emitRejected` can also carry the redacted URL fields the other redirect events
carry, add them — but the message fix is the required one. *Rejected as sole fix:* logging `error.name` plus
fields and dropping the message (leaves the raw message reachable through `cause` on the thrown error).
*Constrains:* none.

### D9 — #71: credential classes, and "once guarded, always guarded" for the replay
- `BasicCredential` and `DigestCredential` become classes with `#password`, `toString` and the
  `nodejs.util.inspect.custom` override, following whatever shape `auth/credential.ts` already uses for
  `ApiKeyCredential` / `BearerToken` (class plus `createX()` factory if that is the pattern there). Public
  shape change, free before the first version bump; `api:local` on core.
- Replay guard: if the original request required HTTPS (the step guarded it), `requireHttps` runs on the
  replacement request unconditionally, regardless of which header names it carries. *Rejected:* building the
  set of credential-carrying header names from configuration (misses a `challengeHook` that invents a
  header). AUTH-8 names bearer, API-key and name-key only; the wider reading is a `deviations.md` row (D0).
- `docs/sdk-documentation/auth.md`'s credential-shape example is rewritten here (#68 left it).
*Constrains #74:* it edits `auth-step.ts` next wave on top of this; the guard site moves.

**D8 outcome (2026-09-04, #70, PR #85).** Both messages built from `redactUrl()`; raw URLs stay on
`targetUrl` / `fromUrl` / `toUrl`; `http.redirect.rejected` gained `url.full` (redacted) like the sibling
events. A non-URL string handed to either public constructor now renders `[malformed url]` in the message
(OBS-15 totality read as the safe default; pinned). New fixture route `/redirect-secret-target` in
`tests/conformance/xcut/fixtures/server.ts` (307 to `/echo?access_token=<?secret=>`), reusable.
*Constrains #74:* build any URL-naming message from `redactUrl()` at the constructor. *Constrains #72, #78:*
`docs/sdk-documentation/errors.md` redirect section was edited here.

**D9 outcome (2026-09-05, #71, PR #86).** `BasicCredential` / `DigestCredential` are classes in
`auth/credential.ts` with `#password`, read inside the package through an `@internal` `credentialPassword()`
friend hook; `DigestCredential` takes `algorithmPreference` as a third positional. No construction-time
validation on the classes — AUTH-14/AUTH-16 stay single-sourced in `basicHandler()` / `digestHandler()`,
which `authStep()` builds at construction, so a blank password still fails there. Replay guard keys on
`OutboundPlan.guarded` ("once guarded, always guarded"); `guardReplayScheme` now takes a `ReplayGuardInput`
bundle. Two `deviations.md` rows: AUTH-8 widened to every credential type; XCUT-16 guard deliberately wider
than its letter. `scripts/verify-consumer-types.mjs`'s fixture changed because no structural
`BasicCredential` shape exists any more. *Constrains #74:* `auth-step.ts` conflict surface is the
`./credential.js` import block, `buildHandlers`, `OutboundPlan`/`planOutbound`, `guardReplayScheme`,
`ChallengeDrive`; `credential.ts` now has a type-only import of `./digest.js`, so a new edge from
`digest.ts` back into `credential.ts` closes a cycle. A stubbed `ChallengingTransport` exists in
`security-by-default.conformance.test.ts` for clauses needing an `https://` hop.

**Trap for later subtasks (api-extractor).** `{@link SomeError.message}` does not resolve (`message` is
inherited from `Error`; `ae-unresolved-link`). Write it as backticked prose.

## Decisions taken for wave 3 (M3) — pre-taken 2026-09-05, before dispatch

### D10 — #72: the final typed error is surfaced as-is; the trail rides in a side table, read through `retryAttempts()`
The surfaced error of `retryStep` / `dispatchWithRetry` is the final attempt's own error, class untouched:
`instanceof TransportFailureError` holds for `maxAttempts` 1 and 3 alike, and an abort during backoff surfaces
the `CancellationError` that `abortToSdkError` built (`retry/engine.ts:385`), which `withTrail` at `:386` was
undoing. Earlier attempts' errors are reachable through a new `@public` accessor exported from core,
`retryAttempts(error: unknown): readonly unknown[]` — oldest first, the surfaced instance itself excluded
(RETRY-34's skip-self clause), `[]` for an error that carries no trail — backed by a module-private `WeakMap`
that the engine writes once per terminal failure. **Not a deviation, a correction:** RETRY-34 says the prior
failures are "attached to the surfaced exception as suppressed", which is Java's `addSuppressed` — the
surfaced exception stays what it is and grows a list. Wrapping it in `SuppressedError` made the surfaced
*type* a function of how many attempts ran, which is what XCUT-1's "assert the surfaced error is the
cancellation type" clause catches. No `deviations.md` row. `suppress()` stays for its RECOV-12 job.
*Rejected:* an own property (`attempts` / `errors` / `suppressed`) defined on the surfaced error — a foreign
error may be frozen or non-extensible, so `defineProperty` in the engine's failure path can itself throw; a
primitive thrown value cannot carry one at all; and `.suppressed` already means "the one secondary" on
`SuppressedErrorLike`. *Rejected:* a `RetryExhaustedError` wrapper (hides `CancellationError`, the row XCUT-1
is about). *Rejected:* threading the trail through `cause` (`cause` is already the raw abort reason at
`:383`, and it means "why", not "before"). A primitive surfaced value is passed through unchanged with no
trail entry rather than wrapped. Update the `retryStep` TSDoc, `retry-dispatch.ts:45`'s `@throws` prose,
`docs/sdk-documentation/pipelines.md`'s retry section, the "suppressed trail" wording at
`docs/sdk-documentation/errors.md:188`, and `write-a-response-handler.md` so the RECOV-12 wrapper is documented
as the *only* place a `SuppressedError` is built. `api:local` on core. *Constrains #78:* the classify
cause-walk sees the typed error directly now, never through a `SuppressedError.error` hop. *Constrains #73:*
the trail accessor is the shape it layers on.

### D11 — #74: parse every challenge header; emit `cnonce` for `-sess` regardless of `qop`; empty `realm`/`nonce` are unsatisfiable
- **Repeated `WWW-Authenticate` / `Proxy-Authenticate`.** `pickChallengeHeader` reads `headers.getAll(name)`
  and parses each value with `parseChallenges`, concatenating the lists in wire order — parse-each rather
  than comma-join, so a malformed later value cannot poison the parse of an earlier one. `rank` selects across
  the concatenation. Conformance row in `packages/transport-conformance` (`run-suite.ts` + `fixtures.ts`): a
  fixture route sending two `WWW-Authenticate` headers, asserting the *parsed challenge list* is identical
  through both transports — `getAll` legitimately returns one comma-joined entry through fetch and two entries
  through undici, and the list after parsing is the only thing the transport is answerable for. Fix the
  `Set-Cookie`-only comment at `undici-transport.ts:334`; touch nothing else in that file (#81 owns it).
- **`-sess` without `qop`: emit `cnonce`.** RFC 7616 §3.4 says of `cnonce` "This parameter MUST be used by all
  implementations", and §3.4.2 folds it into A1 for every `-sess` algorithm; a `-sess` response without it is
  unverifiable by construction, which is what the port sends today (`digest.ts:337-343` hashes a cnonce the
  header at `:386-387` omits). `nc` and `qop` stay conditional on a negotiated `qop`. AUTH-22's "emit
  cnonce/nc/qop only when qop is negotiated" is RFC 2617's RFC 2069-compatibility form, which predates
  `-sess`. Departure from AUTH-22's letter: one `deviations.md` row (D0). *Rejected:* declining the challenge —
  it turns every `-sess`-without-`qop` server into a guaranteed 401 for no security gain, and the value is
  already computed. `computeDigestResponse` vector for `MD5-sess` with no `qop`.
- **Empty `realm` or `nonce`** is unsatisfiable: `parseDigestChallenge` requires non-empty strings, the
  challenge is declined and the next one tried (AUTH-25's "return no header when it cannot satisfy any"). No
  row; AUTH-12's verbatim storage is unchanged, the check sits at selection.
- No new core exports. `api:local` on core only if a `@public` TSDoc changes. No changeset (D1).
*Constraints inherited:* D9 (the `auth-step.ts` surface #71 reshaped: `buildHandlers`, `OutboundPlan`,
`planOutbound`, `guardReplayScheme`, `ChallengeDrive`; `credential.ts` imports `./digest.js` type-only, so no
edge from `digest.ts` back into `credential.ts`); D8 (any URL-naming message is built from `redactUrl()`).

### D12 — #75: keep the ownership transfer, and ledger it
`sseEvents$` / `typedSse$` keep passing `() => stream.close()` as `fromAsyncIterable`'s `release`. The
issue's "spec-faithful one-line change" is neither: (1) `SseStream` self-releases on **any** iterator
termination by SSE-30's own design — `#iterate`'s `finally` runs `#releaseQuietly()` when the runtime calls
`return()` (`packages/core/src/sse/stream.ts:136-138`), and `fromAsyncIterable` must call `iterator.return()`
exactly once (ASYNC-6), so the socket closes with or without the callback; a `for await` with `break` closes it
the same way. ASYNC-21's "MUST NOT close the caller-owned source" presumes a source whose iterator return does
not release, which this port's `SseStream` deliberately is not. (2) The release-*before*-`return()` ordering
is what settles an in-flight pull on unsubscribe (`packages/rx/src/from-async-iterable.ts:44-48`): an async
generator's `return()` queues behind a suspended `next()`, so dropping the callback would leave an unsubscribe
during a stalled read pending until the server sends a byte. Pagination passes no release because its pulls
are bounded HTTP exchanges; SSE's are not. Removing the callback would change only the failure channel and the
ordering, not whether the source closes — and it would reintroduce the hang. **Recorded as a deviation** from
ASYNC-21's non-closing clause: one `deviations.md` row (D0) naming `sse.ts:35,57-59`, `from-async-iterable.ts:103-108`,
the two reasons above, and the Phase 8b checklist gist at
`docs/work/mvp/phase8/phase8b/2026-07-28-phase8b-async-runtime-checklist.md:67` that dropped the clause (a
dated record; not retro-edited). Tests in `packages/rx/src/sse.test.ts`: early unsubscribe, source error, and
end-of-source each close the underlying resource **exactly once** (count the resource's `close`, not the
facade's — `SseStream.close()` is idempotent by SSE-28, so the facade count proves nothing); plus the
unsubscribe-during-suspended-pull case settles. TSDoc on both functions states the transfer outright
("subscribing hands the stream to the adapter; do not call `close()` yourself, and do not iterate it
afterwards"), and `packages/rx/README.md` says the same beside its `for await` guidance. `api:local` on rx.
*Rejected:* dropping `release` (above). *Rejected:* a caller-facing `{ownership}` option (two behaviours to
document for a case with one correct answer). No changeset (D1).

### Wave 3 partition
| Task | Owns | Shared, append-only |
|---|---|---|
| #72 | `packages/core/src/retry/**`, the retry exports in `packages/core/src/index.ts`, `packages/core/etc/core.api.md` (retry names), `docs/sdk-documentation/pipelines.md` retry section, `errors.md:188`, `write-a-response-handler.md`, `tests/conformance/xcut/retry-safety.*` and `cancellation-and-timeout.*` | — |
| #74 | `packages/core/src/auth/{digest,auth-step,challenge}.ts` and tests, `undici-transport.ts:334` comment only, `packages/transport-conformance/src/{run-suite,fixtures}.ts`, `docs/sdk-documentation/auth.md` | `docs/deviations.md` (one row at table end) |
| #75 | `packages/rx/**` | `docs/deviations.md` (one row at table end) |
Known merge seams: the `deviations.md` table tail (#74 + #75), and `core.api.md` if #74 changes a `@public`
TSDoc beside #72's new export. Supervisor resolves both, as in waves 1 and 2.

## Deferred — release machinery (recoverable list)
| Issue / PR | Deferred item |
|---|---|
| #68 / PR #83 | patch notes for `@dexpace/core` and `@dexpace/codec-json`: shipped `.d.ts` prose changed for `Deserializer`, `jsonSerde()`, `InstrumentationBundle.tracerFactory`, `buildRequest`, `RequestConditions.applyTo` |
| #68 / PR #83 | `docs/first-release.md:117` claims `serde.ts:99,170` cite `H15` — `H15` appears nowhere in `serde.ts`; `:159` puts `deserializeFrom` at `:162` and `serializeTo` at `:96` (actual `:221`, `:104`). File suspended under D1 |
| #70 / PR #85 | patch changeset for `@dexpace/core`: redirect error messages now carry redacted URLs (and `[malformed url]` for unparseable input); `http.redirect.rejected` gained `url.full` |
| #71 / PR #86 | minor changeset for `@dexpace/core`: `BasicCredential`/`DigestCredential` become classes (breaking for object-literal callers); patch note for `authStep`'s `@throws PlaintextCredentialError` prose; `docs/first-release.md` untouched though this is its "free before the first bump" class |
| #69 / PR #84 | patch changeset for `@dexpace/core`: `noopInstrumentationBundle.activeSpan` changed from `undefined` to `NOOP_SPAN` (documented default of a `@public` interface) |
