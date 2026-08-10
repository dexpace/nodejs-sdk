# Open Items

Running register of everything known to be unmet, unverified, misreported, or deliberately deferred across the
implemented portion of this project. Reviewed state: **scaffold milestone** (committed, `0ebdc79`) and
**Phase 1 — Core HTTP Domain Model** (branch `2-phase-1-core-http-domain-model`, uncommitted at time of
review). Last reviewed **2026-07-30**.

A requirement absent from this file is either satisfied or belongs to a phase that has not started. The point
of the file is that nothing is unmet *silently* — every gap below is either scheduled against a named phase or
awaiting a decision.

**Status vocabulary**

| Status | Meaning |
|---|---|
| **DECIDE** | Blocked on a human decision. Two or more defensible answers; picking one is the work. |
| **ACT** | Decision already made or obvious; the work is simply not done. |
| **SCHEDULED** | Deliberately deferred to a named phase. No action now; listed so it cannot be lost. |
| **WATCH** | Not a defect today. Becomes one when a stated trigger fires. |

---

## A. Requirements unmet or misreported

### A1 — HTTP-24: `charset` does not return null for an unknown encoding — **DECIDE**

`product-spec/04` §4.4 conformance text: "`charset=utf-8` → UTF-8; `charset=bogus` → **null**; no charset →
null." Actual behavior:

```ts
MediaType.parse('text/plain;charset=bogus').charset  // → 'bogus', not undefined
```

`packages/core/src/http/media-type.ts` returns the parameter verbatim. There is no registry of recognized
encodings to resolve against, so "unknown" is not a state the current design can detect — the reference
contract presumably assumed a `Charset` type whose lookup can fail.

The Phase 1 checklist marks HTTP-24 ✅ with no note, so the project currently *claims* conformance it does not
have. That is the actual defect; the behavior itself may well be the right call.

Two ways out, both acceptable, but one must be chosen:
1. Resolve against a known-encoding set (e.g. `TextDecoder` probing or an explicit allow-list) and return
   `undefined` for anything unrecognized.
2. Record a deliberate deviation in
   `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, on the grounds that the
   TypeScript port models charset as an opaque string and has no failing lookup to model "unknown" with.

Either way: correct the checklist row, and add a test pinning the chosen behavior. The getter's TSDoc already
documents the current behavior honestly.

### A2 — HTTP-22: the checklist describes an implementation that does not exist — **ACT**

Phase 1 checklist, HTTP-22 row: `✅ | Task 7, HeaderName.of()'s static cache`.

No such cache exists. The plan deliberately dropped interning (Task 7's `HeaderName` comment: "No interning:
HTTP-22 makes it a MAY, and an intern map keyed by caller-supplied names is exactly the unbounded,
process-lived, caller-influenced map XCUT-14's drain-to-cap rule forbids"), and
`packages/core/src/http/headers.ts` has no static map on `HeaderName`.

The decision is right and the requirement is a MAY, so nothing about the code needs to change. The checklist
row is simply false and should read ⏳/N/A with the XCUT-14 reasoning, not ✅.

### A3 — HTTP-11: `Response` exposes no range classification of its own — **DECIDE**

`product-spec/04` §4.3: "Status MUST classify by range … **and a response MUST expose these derived from its
status**." `Response` carries only `status`; callers reach classification one hop away via
`response.status.isSuccess`.

Defensible as satisfied — the classification *is* reachable and single-sourced on `Status`, and mirroring six
getters onto `Response` is pure surface duplication. But no one recorded that reading, so it is currently an
accident rather than a decision. Either add the delegating getters or write the interpretation into the
checklist row.

### A4 — SEAM-1 is enforced narrowly relative to its conformance text — **ACT**

`scripts/verify-seam-1.mjs` asserts `packages/core/package.json`'s `dependencies` is `{}`. The spec's
conformance clause is broader: "a dependency audit of the core module finds only the standard library plus the
compile-scope logging facade; **no transport/codec/stream symbol is referenced from core**."

Blind spots today: `peerDependencies`, `optionalDependencies`, and `bundleDependencies` are unchecked, and
nothing inspects what the source actually imports. Low risk while core imports nothing but `URL`, but the gate
reads as stronger than it is. Cheap hardening: assert the other three dependency keys are absent-or-empty, and
add an import scan over `packages/core/src` allowing only relative specifiers and `node:`-prefixed builtins.

---

## B. Gates and tooling

### B1 — NFR-10 / NFR-17: CI never runs on the declared minimum runtime — **ACT** (trigger has now fired)

The scaffold checklist deferred this explicitly: *"recommend adding an `actions/setup-node@v4` step pinned to
`18.17` running `scripts/verify-dual-consumption.mjs` once real Node-API usage lands (Phase 1 onward), rather
than adding it now for a function that touches no runtime API."*

**That trigger has fired.** Phase 1 uses the native `URL` class, `Object.freeze`, class `static {}` blocks, and
`#private` fields — all real runtime surface. `verify:runtime-floor` checks that `engines.node` and the
compiled language level *agree*, but nothing ever executes the artifact on Node 18.17; CI runs whatever the
GitHub Actions runner defaults to. The half of NFR-10 that catches "we shipped syntax the declared floor cannot
run" is still missing.

### B2 — NFR-13: SPDX headers missing on scaffold-era files — **ACT**

Phase 1 established the convention ("every new source file opens with `// SPDX-License-Identifier: MIT` on line
1") and every file under `packages/core/src/http/` complies. Three files predating it do not:

- `scripts/verify-runtime-floor.mjs`
- `scripts/verify-seam-1.mjs`
- `eslint.config.js`

`scripts/verify-dual-consumption.mjs` gained one during Phase 1, which is what makes the omission of its two
siblings look accidental rather than scoped. NFR-13 is a review convention, not a mechanical gate, so this is a
one-line-per-file cleanup.

### B3 — NFR-12: reproducible builds asserted, never proven — **WATCH**

`bun install --frozen-lockfile` plus plain `tsc` are deterministic by construction, but nothing demonstrates
it. Becomes real at first publish (~Phase 10): build twice, diff artifact digests.

### B4 — NFR-14: `expect-type` breaks the single-source-of-versions convention — **WATCH**

Every other devDependency is centralized at the workspace root; Phase 1 added `expect-type` to
`packages/core/package.json`'s own `devDependencies`. Harmless with one package — it is exactly the restatement
NFR-14 warns about once a second package exists (Phase 8). Either hoist it to the root now or fold it into the
NFR-14 decision at Phase 8.

---

## C. Documentation defects

### C1 — Phase 1's scope statement contradicts its own plan — **ACT**

`docs/superpowers/specs/2026-07-23-phase1-core-http-domain-model-design.md` says the scope is "Full
`product-spec/04-core-http-domain-model.md` (HTTP-3 through HTTP-53, both MUST and SHOULD level) in one phase."

The plan's own Self-Review then amends that: *"The Phase 1 spec's scope statement should be read — and amended
— as HTTP-3..35, 46..50, 53"*, with the body-lifecycle cluster deferred to Phase 3b. The amendment was never
applied to the design doc, so read literally the two documents disagree about what Phase 1 owed. Correct the
design doc's scope line to match the plan.

### C2 — The structural-typing bypass deviation is not yet recorded — **SCHEDULED** (Phase 10)

The Phase 1 design doc acknowledges that `#private` fields close the *accidental* structural-typing bypass but
not deliberate reflection abuse (`Object.create(Request.prototype)`), and states this is "to be listed in
`sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` when that phase is reached." Listed
here so the promise survives until then.

---

## D. Scheduled deferrals

No action now. Each is already owned by a named phase; this table exists so none can quietly lapse.

| Item | Requirement | Owner phase | Note |
|---|---|---|---|
| Body lifecycle: write/replayability, single-use, close, charset | HTTP-36 – HTTP-43 | 3b | `Request`/`Response` `body` is typed `unknown` as an explicit placeholder |
| Lazy `TypedResponse<T>` with parse-once memoization | HTTP-44, HTTP-45 | 3b | |
| `MultipartBody` — the one builder-based model HTTP-3 lists that Phase 1 did not build | HTTP-51 | 3b | Depends on body-lifecycle contracts |
| 1 MiB error-body buffering cap | HTTP-52 | 3b | |
| `Request.equals` compares body by reference, not by value | HTTP-46 (body clause) | 3b | Blocked on a real `Body` model supplying value equality |
| `RequestConditions.applyTo` cannot emit an obs-text ETag | HTTP-18 vs HTTP-48/50 | 10 | Spec text in scope does not resolve the tension; strict outbound path kept rather than guessed. Documented in `applyTo`'s TSDoc |
| Seam contracts (byte-stream, transport, codec, projection) | SEAM-2 – SEAM-30 | 2–8 | |
| Adapter packages, peer-dependency dedup | NFR-2 | 8 | |
| Shrink-survival regression guard | NFR-9 | 9 | |
| Concurrency-model agnosticism check | NFR-11 | 4 | No async code exists yet |
| Self-identifying version metadata (real `User-Agent`) | NFR-15 | 7/8 | |
| Publish + provenance CI job | NFR-16 | release | `prepublishOnly` wired; nothing published yet |
| NFR-8 re-confirmed as a documented non-applicability | NFR-8 | 10 | No reflection-driven discovery surface exists by design |

---

## E. Process

### E1 — Phase 1 has no commits — **DECIDE**

`git log main..HEAD` shows only the scaffold commit. The Phase 1 plan specifies a commit after each of its 15
tasks (`feat(core): add Status value type (HTTP-10/11/12)`, and so on); all ~40 files currently sit in the
index and working tree as one undifferentiated change.

Not a correctness problem — every gate passes. But the per-task history the plan describes cannot be
reconstructed after the fact, and a single 3,300-line commit is materially harder to review or bisect. Decide
whether to reconstruct the task-by-task sequence before merging or to accept one squashed commit and note the
departure.

---

## Maintaining this file

Add an entry the moment a gap is found, not when it is fixed — the failure mode this file prevents is a
checklist row marked ✅ against code that does not implement it (A1, A2 are both instances). Remove an entry
only when the underlying requirement is genuinely satisfied *and* its checklist row agrees. When a phase
closes, re-scan its checklist against the code rather than trusting the marks.
