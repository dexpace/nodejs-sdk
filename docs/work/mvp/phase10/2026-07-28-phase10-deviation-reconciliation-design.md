# Phase 10 — Deviation Reconciliation — Design

**Status:** Draft, brainstormed solo (user away from keyboard) — same precedent as Phase 5c's solo draft against 5b.
Judgment calls made without a live back-and-forth are called out explicitly in their own section below rather than
folded silently into the ledger; flag any of them for revision on review.

**Purpose:** Phase 10 is the last-but-one phase in the [v1 roadmap](../2026-07-23-nodejs-sdk-v1-roadmap-design.md).
It audits every deliberate deviation from the JVM reference contract that Phases 0–8 introduced while building
`@dexpace/core` and its satellite packages, reconciles them against the pre-implementation prediction in
`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (§10), and produces the
as-built, canonical version of that document. It also closes or re-confirms the small set of `NFR-*` rows the
roadmap's Deferred Items Log already targets at Phase 10 by name, and settles one open spec-interpretation
tension a Phase 1 plan explicitly deferred here.

**Scope is documents, not code.** Phase 10 ships no package — the roadmap table lists it as `— (review only)`.
Every phase spec from 3a through 8b already carries its own `## Deviation Ledger (for Phase 10)` section, and
Phase 2's design carries a retrofitted one (Phase 1 still predates the convention but has an equivalent flagged
item, see below); those sections are complete, already-reasoned raw material. Phase 10's job is consolidation and cross-referencing, not new investigation —
with two exceptions. First, two items (`NFR-12`, `NFR-16`) are soft gaps that need a real build/publish artifact
to verify, which doesn't exist in this docs-only repository state yet; Phase 10 cannot close those, and records
them as open with an explicit unblock trigger rather than papering over them. Second, four items (two redirect/
auth interpretive questions, plus two related preset/API-surface questions) were originally flagged by their own
phases as provisional pending Phase 9's conformance-test execution against reference fixtures — a premise this
draft's revision voids: Phase 9 has since shipped its own design and plan (2026-07-28), scoped to `XCUT`/`NFR`
conformance only, and will never produce that evidence. Phase 10 decides those four directly instead (§Group L);
nothing in this phase's own scope is left waiting on Phase 9.

> **Corrected 2026-08-30 — the scope above is what was planned, not what shipped.** Phase 10 shipped code, in
> three published packages. Two premises this paragraph rests on were false by the time it executed. The first
> is "docs-only repository state": Phases 1-9 had all shipped by then, so `NFR-12` needed a *build*, not a
> *release*, and it closed on evidence rather than staying open (see the correction on Group N below). The
> second is "consolidation and cross-referencing, not new investigation": the audit was performed against
> as-built source rather than against the phase specs that produced the ledger, and that method found a live
> defect — `Page`, `FetchTransport` and `UndiciTransport` declared `[Symbol.asyncDispose]` as a plain computed
> class member, which on the declared `engines.node ">=20.3"` floor bound the method to the string key
> `"undefined"` (`NFR-10`; the symbol landed in Node 20.4). Fixing it is a breaking type change with two
> changesets, and three later review passes found three more defects behind it. The full inventory, with the
> reasoning for breaking this scope and for holding the line on the project-wide convention sweeps that also
> named this phase, is the roadmap's **Status note (2026-08-30, Phase 10 EXECUTED — scope corrected)**; the
> per-item as-built evidence is `docs/deviations.md`. This paragraph is left standing rather than rewritten so
> the planned-versus-actual gap stays legible.

**Governing documents:** `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (the
document this phase rewrites), the roadmap's own Deferred Items Log, and every Phase 2, 3a–8b, and 9 spec's
Deviation Ledger section plus the handful of plan-level "Deviation Ledger Additions" sections (5c, 6a, 6b, 6c)
that amend their design doc's ledger with plan-time corrections.

## Why This Phase Doesn't Need Phase 9 to Run First

The roadmap's ordering rationale (line 108-110) groups Phase 9 (Conformance) and Phase 10 (Deviation
Reconciliation) together as phases that "audit what phases 0-8 built rather than building anything new," which
could read as Phase 10 depending on Phase 9's output. It doesn't, at all, as it turns out: the ~90 deviation
entries collected across Phases 3a-8b are design-time reasoning already committed to specs and plans — none of it
requires a running SDK to evaluate. This design's first draft left two entries (§Group L) waiting on Phase 9's
real conformance-test execution against reference fixtures. Phase 9 has since been brainstormed and planned
(2026-07-28, after this draft), and its actual scope turned out to be `XCUT`/`NFR` conformance only — it will
never produce that evidence. The roadmap's own Deferred Items Log was updated to retarget those two items (plus
two related preset/API-surface judgment calls) here; §Group L below now decides all four directly instead of
waiting on a sweep that was never coming.

## Deliverable

One artifact: a rewritten `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`,
replacing its current 12 pre-implementation predictions with the full as-built reconciled ledger, organized by
theme (not by phase — several entries recur near-identically across 4-5 phases and should collapse into one
cross-referenced entry rather than be repeated). Supporting edits: the roadmap's Deferred Items Log rows that
name `NFR-8`, `NFR-12`, `NFR-16`, `SEAM-5`–`SEAM-10`, and `SEAM-18` get their Note column updated to point at the
reconciled ledger instead of restating the deferral. `docs/knowledge/deliberate-deviations.md` (the harvested
corpus entry, sha-pinned to the pre-Phase-10 version of §10) becomes stale the moment §10 is rewritten; Phase 10
flags this for re-harvest but does not run `knowledge-harvest` itself — that skill is explicitly user-invoked
only.

**Judgment call:** rewriting §10 in place (rather than writing a new file elsewhere and leaving the original as a
historical artifact) is a deliberate choice, not an oversight. `docs/sdk-design-nodejs.md`'s own preamble says
judgment calls "are collected in §10" without qualifying that as a one-time snapshot, and git history already
preserves the pre-Phase-10 version losslessly, so a separate archive file would be pure duplication. Flag if you'd
rather keep the original alongside the reconciled version.

## Reconciliation Process

1. **Collect.** Pull every phase's `## Deviation Ledger (for Phase 10)` section (specs 2, 3a-8b, and 9) plus every
   plan's `## Deviation Ledger Additions (for Phase 10)` section (5c, 6a, 6b, 6c) verbatim. Phase 2 originally
   predated the convention and was pulled in by name for `SEAM-5`-`SEAM-10` and `SEAM-18` only; its design now
   carries a retrofitted ledger section covering those two plus the dot-segment path-parameter rejection
   (`SEAM-27`) that the by-name pull would have missed, so Phase 2 is collected like any other phase and needs no
   special case. **Phase 1 still does:** its plan flags the HTTP-18/HTTP-50 ETag tension inline, not in a named
   section, and is pulled in by name.
2. **Cross-reference against the original 12.** Each of the 12 items in the current §10 either: (a) is confirmed
   as-built with no change, (b) is confirmed but needs expansion because later phases added detail the
   prediction didn't anticipate, or (c) needs correction because a later phase's actual mechanism diverged from
   the prediction. None of the 12 fall into (c) — see Group-by-group disposition below.
3. **Collapse recurring dispositions.** The single-execution-model / no-threads reasoning (§Group A) is
   independently restated by at least nine phases (2, 4a, 4b, 4c, 5a, 6c, 7a, 7b, 8b) rather than cross-referenced.
   That's each phase correctly recognizing the same JVM constraint doesn't apply to its own corner, not drift —
   but the reconciled ledger states it once, with every phase's specific instance listed as a sub-bullet, instead
   of repeating the paragraph eight times.
4. **Resolve genuinely open questions.** Six items need an actual decision, not just consolidation: the ETag
   obs-text tension (§Group O), re-confirming `NFR-8` (§Group J), and the two redirect/auth interpretive
   questions plus two related preset/API-surface questions in §Group L (all four retargeted here from a Phase 9
   conformance sweep that turned out never to be running them). All six are decided below, in this design, not
   deferred further — deferring an already-deferred item a second time would defeat the phase's purpose.
5. **Mark what genuinely can't close yet.** Two items only — `NFR-12` and `NFR-16` in §Group N — get an explicit
   "open, unblocks at X" entry rather than a false close; both need a real build/publish artifact this docs-only
   repository state doesn't have.

## Reconciled Ledger — Group-by-Group Disposition

*(The literal replacement text for §10 is staged in full in the implementation plan, Task 2 — this section is
the disposition reasoning, not the final prose.)*

**Group A — Single execution model collapses every thread/CAS/interrupt-flag primitive into ordinary
`async`/`await`.** Confirms and **expands** original item #7 (single-threaded eliminates concurrency primitives)
and item #1 (SEAM-11/16 sync/async collapse). As-built instances: the execution-context store is a plain `Map`
with a trivially-unique `Symbol()` call-key rather than a concurrent store keyed by a composite trace/span
identifier (4a, no concurrent-store collision concern to design around), `PIPE-28`-`34` (4c, no sync↔async
bridge, one `Promise`-only `Step`), `CFG-19`-`21` (7a, no executor/async-wrapper vocabulary), `RETRY-23`/`25`/`30`/`45`
(5a, no interrupt-flag restore, no fatal-error split, no trampoline, no scheduler-shutdown), `RECOV-11` (4b,
cancellation re-assertion is a no-op because `AbortSignal.aborted` is latched, not a clearable flag), `OBS-24`
(7b, `AsyncLocalStorage` auto-propagation covers most of the manual context-propagation bridge a JVM `ThreadLocal`
would need, needing only a thin explicit-snapshot helper for the residual out-of-continuation case), §12.9 (6c,
one pagination engine, not blocking+async), `ASYNC-21`/`ASYNC-18` (8b — `ASYNC-18` specifically corrects the
Phase 8 segmentation design's earlier framing: no non-blocking scheduled-delay primitive exists **anywhere in
this port**, a full-port collapse, not an 8b-only scope boundary). One running argument, cited once.

**Group B — Seam pluggability removed where nothing needs discovering.** Confirms original item #2. As-built:
`SEAM-3`-`10` (2, byte-stream provider — Web Streams are a platform standard, not a third-party library to keep
pluggable), `SEAM-18`'s bridge-specific clauses (2/4c, no bridge exists because there's only one bank), `IO-30`
resolved / `IO-39` not built (3a, no registry). `SEAM-18`'s one non-bridge clause ("per-call options threaded
through, not dropped") survives as an ordinary `Transport.send()` obligation, not a deviation.

**Group C — Retry stacks unify into one engine.** Confirms original item #4 (`RETRY-28` sanctions this
explicitly). As-built: one engine, two thin adapters (5a), `totalTimeoutMs` opt-in. Cross-reference, don't
duplicate, 5a's own `RECOV-17`-`34` disposition table (16 of 18 rows collapse onto retry's own requirements;
`RECOV-32`/`33` are net-new retry behavior).

**Group D — Cancellation is `AbortSignal` end-to-end.** Confirms original item #10, unchanged as predicted. One
addition: 5a's timeout-vs-cancellation distinction is keyed off the abort reason's constructor name
(`TimeoutError` from `AbortSignal.timeout()` vs. `AbortError` from caller abort) rather than a class hierarchy,
because both arrive through the same signal type.

**Group E — MD5 vendored, SHA-256 uses Web Crypto.** Confirms original item #8, unchanged, shipped as predicted
in 5c.

**Group F — Structural typing limits full runtime encapsulation.** Confirms original item #5, unchanged.

**Group G — Schema-as-witness replaces reflective generic capture.** Confirms and **expands** original item #6.
As-built: 6a ships no `TypeRef`/generic type carrier (`SERDE-6`/`8`), no codec-configuration surface — coercion,
unknown-field handling, date format (`SERDE-21`-`26`) — because `JSON.parse`/`stringify` expose no such knobs,
and `Serde` isn't generic in `T` (bundle is per-format once the witness is a decode-time parameter, not a type
parameter).

**Group H — Frozen collections computed once.** Confirms original item #11, unchanged.

**Group I — Configuration has three tiers, not four.** Confirms original item #9, unchanged. (`CFG-19`-`21`'s
executor-vocabulary absence lives in Group A, not repeated here.)

**Group J — Dead-code-survival gate retargeted; `NFR-8` re-confirmed (decision made now).** Confirms original
item #12 (`@dexpace/shrink-test` targets the dual-package `instanceof` hazard, not a reflection blind spot JS
bundlers don't have). **New disposition:** `NFR-8` (shrinker keep/retain configuration) is **not applicable by
design** — this port has no reflection-driven discovery surface to keep-configure at all, the `IoProvider`-style
mechanism Group B already retired. This was flagged across two docs (scaffold checklist, roadmap Deferred Items
Log) as "worth re-confirming explicitly... not actionable now" pending Phase 10. Confirmed: closed, not
actionable, recorded as a permanent N/A rather than a future task.

**Group K — `Symbol.asyncDispose` adopted opportunistically, not uniformly (new cluster).** Not in the original
12. Internal `io/` primitives (3a) ship `close()` only — the symbol postdates the declared `>=18.17` floor, and
these types are `@internal`. Public consumer-facing disposable resources added later — `Body`/`Response` (3b),
`SseStream` (6b), `Page` (6c) — each add `[Symbol.asyncDispose]` as optional and runtime-guarded rather than
declaring `implements AsyncDisposable`. Reconciled: this is a deliberate two-tier policy, not drift — internal
plumbing never needs the ergonomic disposal syntax its own module never uses; public resources get it whenever
the running Node version supports it, without raising the package's declared floor. Confirmed consistent across
all four sites.

**Group L — Redirect/auth cross-origin marker mechanism, with two interpretive questions now decided by Phase 10
directly.** Not in the original 12. As-built: a real `Cross-Origin-Marker` header, cleared-then-conditionally-set
every hop (5b), replacing an earlier `WeakSet<Request>` design that 5b itself rejected mid-draft as incompatible
with 5a's attempt-stamping producing fresh `Request` copies; 5c's marker also suppresses the challenge-reaction
hook on a marked hop, not just the outbound stamp (a bug the 5c design caught before shipping). Two items were
originally left open pending Phase 9's conformance-test execution against reference fixtures. **That premise is
now void**: Phase 9 was brainstormed and planned (2026-07-28) after this design's first draft, and its actual
scope is `XCUT`/`NFR` conformance only (`docs/work/mvp/phase9/2026-07-28-phase9-cross-cutting-conformance-design.md`)
— it does not re-audit `AUTH-*`/`REDIR-*` interpretive calls, and no phase's code exists yet for a fixture-based
sweep to run against regardless. The roadmap's own Deferred Items Log was updated to retarget both rows here;
Phase 10 decides them rather than deferring a second time:
- **5b's redirect-predicate override scope — confirmed, 5b's reading is correct.** `REDIR-20`'s snapshot (current
  response, redirect count, visited URIs) carries nothing about credentials or safety mechanics, so "fully
  override the built-in decision" scopes to the follow/no-follow determination the predicate is actually handed
  data to decide. Credential stripping, downgrade denial, replayability, and the loop cap are separately governed
  by `XCUT-17`'s own universal, non-overridable framing — a predicate opting out of those would be a security
  regression, not a caller convenience. No change to 5b's implementation.
- **5c's reading that Basic/Digest never stamp preemptively — confirmed, 5c's reading is correct.** `AUTH-14`/
  `AUTH-15`-`22` describe stamping entirely as a challenge reaction; the spec explicitly describes Bearer's
  preemptive cached-token path elsewhere and says nothing of the kind for Basic/Digest — an asymmetry that reads
  as deliberate, not an oversight. Digest cannot stamp preemptively regardless (needs the server's `realm`/`nonce`
  first); Basic staying reactive matches this port's conservative-by-default posture elsewhere. No change to 5c's
  implementation.

Two related Deferred Items Log rows, also retargeted to Phase 10 by the same 2026-07-28 roadmap update, are
disposed of the same way but don't warrant their own §10 ledger entry — neither is a JVM-mechanism deviation, both
are ordinary preset-shape/API-surface judgment calls: `DigestChallengeUnsupportedError` stays, kept `@internal`,
zero cost either way; `clientIdentityStep` stays out of `standardResilience()`'s default install list, since
nothing mandates it and adding it would be unrequested scope creep on a "standard" preset. Closed directly in the
roadmap's Deferred Items Log, not restated here.

**Group M — Transport-adapter platform gaps (new cluster).** Not in the original 12. As-built (8a): no zero-copy
`sendfile(2)` path on either `fetch` or `undici`, `transport-fetch` ships no proxy support at all (adding one
would require depending on `undici` internals, undermining its zero-dependency purpose), `TRANSPORT-8`'s
native-cancel-vs-timeout distinction doesn't apply to `transport-fetch` (§17's own text scopes it to transports
with an internal-cancel path), no re-subscribable-producer replay machinery (5a's replayability gate at the SDK
layer handles retried sends instead), `Response.protocol` is a hardcoded `HTTP_1_1` best-effort default because
neither `fetch` nor undici's `ResponseData` surface the negotiated protocol version.

**Group N — Build/release readiness stays open, unblocks at first real release (not this phase).** `NFR-12`
(reproducible, byte-identical builds) and `NFR-16` (publish provenance enforced) are soft gaps that need a real
build artifact and a real `npm publish --provenance` run to verify — neither exists in this docs-only repo state.
Phase 10 records the intended verification method (double-build the workspace, diff digests, for `NFR-12`; run
the already-scripted `prepublishOnly` + `npm publish --provenance` path for real, for `NFR-16`) and leaves both
open with "first real release" as the unblock trigger, exactly as the roadmap's Deferred Items Log already states
— Phase 10 doesn't manufacture a false close here.

> **Corrected 2026-08-30 — `NFR-12`'s half of this group was wrong, and it closed.** The premise "needs a real
> build artifact… neither exists in this docs-only repo state" expired the moment Phases 1-9 shipped code.
> `NFR-12` needed a *build*, not a *publish*, and was verifiable from Phase 1 onward; it sat open two phases
> longer than it had to. It is now closed on evidence and kept closed by a gate:
> `scripts/verify-reproducible-build.mjs` sweeps every `dist/` and `*.tsbuildinfo`, builds twice, and compares a
> SHA-256 per emitted file **and** per `npm pack` tarball across all nine publishable packages — 644 emitted
> files and 9 tarballs byte-identical. It is a blocking CI step and a `ci-preflight` step, and was
> negative-tested by injecting a `Date.now()` into `packages/core/scripts/gen-version.mjs`, the one build-time
> codegen step. **`NFR-16` is unaffected and this group's disposition still holds for it:** its conformance test
> is behavioral and needs a real registry and a real OIDC token. One sub-claim about `NFR-16` was also wrong and
> is corrected in §10 itself — `npm publish --provenance` was never scripted; only `prepublishOnly` is. See
> `docs/deviations.md` §14 and the roadmap's `NFR-12` / `NFR-16` rows.

**Group O — HTTP-18 vs. HTTP-48/50 ETag obs-text replay tension (decision made now).** Not in the original 12;
flagged by Phase 1's plan as unresolved and explicitly targeted at Phase 10. `RequestConditions.applyTo` writes
entity tags through `Headers`' outbound `set`, which enforces `HTTP-18`'s **MUST**-level restriction (HTAB +
printable ASCII 0x20-0x7E only, rejecting any byte ≥ 0x80). `HTTP-48` **permits** obs-text inside an ETag's
opaque value (RFC 7232 conformance, **SHOULD**-level), so a conditional request replaying a server-issued ETag
that happens to contain obs-text bytes throws instead of round-tripping. **Decision:** keep the strict outbound
path; do not add a relaxed emit path for replayed ETags. Reasoning: `HTTP-18` is `MUST`-level and its rationale is
security (blocking CR/LF-splitting-adjacent injection via non-ASCII/control bytes), directly reinforced by
`XCUT-18` — the cross-cutting conformance checklist's own header-splitting guard, which the product spec treats
as a universal, subsystem-independent invariant that "applies even if each subsystem individually appears to
work." A `SHOULD`-level RFC-conformance nicety for an edge case (obs-text in ETags is rare in practice, mostly
legacy servers) does not outrank a `MUST`-level cross-cutting security invariant. This closes as a permanent,
documented deviation: the port does not resurrect obs-text bytes from a server-issued ETag into an outbound
conditional-request header; `RequestConditions.applyTo` rejects such a value rather than silently mangling or
passing it through.

## Verification / Completeness Check

Before the rewritten §10 is considered done, confirm every source is accounted for:
- Every phase spec 2, 3a-8b, and 9's `## Deviation Ledger (for Phase 10)` section has **every row** represented in
  the reconciled ledger, or explicitly listed as legitimately excluded (cross-check against the extraction
  performed for this design — 17 of 17 sections present and non-empty). Row-level, not section-level: a phase
  cited by several items can still have one row silently dropped, which is how Phase 2's dot-segment `SEAM-27`
  rejection was missed until Phase 2's own validation caught it by hand.
- Every plan-level `## Deviation Ledger Additions (for Phase 10)` section (5c, 6a, 6b, 6c) is folded in.
- Phase 1's ETag flag (still pre-dating the ledger-section convention, still pulled in by name) is represented.
  Phase 2 no longer needs a by-name pull — its design carries a retrofitted ledger section.
- Every roadmap Deferred Items Log row naming "Phase 10" (`NFR-8`, `NFR-12`, `NFR-16`, the `SEAM-5`-`10` and
  `SEAM-18` rows, plus the four rows the 2026-07-28 update retargeted here from a Phase 9 sweep that turned out
  never to run them — redirect-predicate scope, Basic/Digest preemptive-stamp reading,
  `DigestChallengeUnsupportedError`, `clientIdentityStep`) has a corresponding disposition above.
- No group above states a disposition that contradicts another group or another phase's own ledger entry for the
  same requirement ID (checked during extraction — none found; the closest case, `RETRY-25`'s reasoning being
  reused verbatim for `ASYNC-21`, is confirmed as deliberate, self-aware reuse, not independent drift).

There is no automated test for this phase — no `NFR-9` shrink-survival tooling applies (that's targeted at Phase
9, not 10), and there's no code to run. Completeness is a manual cross-check against the list above, re-run once
before considering the phase done.

## Deviation Ledger (for Phase 10)

Phase 10 has one deviation from its own description worth recording for completeness, even though it's about
process rather than the SDK: the roadmap table lists Phase 10's product-spec/sdk-design refs as `— / §10`,
implying a document to consult; this design treats §10 as a document to **rewrite in place**, which is a slightly
stronger reading than "consult." See the judgment call under Deliverable above.

## Deferred Items (add to the roadmap's Deferred Items Log)

- `NFR-12`, `NFR-16`: Note columns updated (not re-targeted) to point at Group N's verification method, still
  blocked on first real release.
- `NFR-8`: closed. Target-phase column becomes "Phase 10 (Deviation Reconciliation) — closed 2026-07-28", Note
  updated to Group J's disposition.
- `SEAM-5`-`10`, `SEAM-18`: Note columns updated to point at Group B, "recorded" language becomes "recorded,
  Phase 10 closed."
- New row: HTTP-18/HTTP-48/HTTP-50 ETag obs-text tension — originated Phase 1, resolved Phase 10 (Group O),
  closed.
- Four rows the 2026-07-28 roadmap update already retargeted from "Phase 9 conformance sweep" to Phase 10 —
  resolved here, Target-phase columns become "Resolved in Phase 10 — 2026-07-28": redirect-predicate override
  scope (originated Phase 5b, disposition in Group L), Basic/Digest never-preemptive reading (originated Phase
  5c, disposition in Group L), `DigestChallengeUnsupportedError` (originated Phase 5c, kept `@internal`, no §10
  entry — Group L's closing paragraph), `clientIdentityStep` not in `standardResilience()`'s default install
  (originated Phase 7a, stays out, no §10 entry — Group L's closing paragraph).
