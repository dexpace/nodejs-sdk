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

## Deferred — release machinery (recoverable list)
| Issue / PR | Deferred item |
|---|---|
| #69 / PR #84 | patch changeset for `@dexpace/core`: `noopInstrumentationBundle.activeSpan` changed from `undefined` to `NOOP_SPAN` (documented default of a `@public` interface) |
