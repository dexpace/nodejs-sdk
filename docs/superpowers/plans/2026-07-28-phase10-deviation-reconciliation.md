# Phase 10 — Deviation Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` in place with
the as-built, reconciled deviation ledger from Phases 0-8, per
`docs/superpowers/specs/2026-07-28-phase10-deviation-reconciliation-design.md`, and update the roadmap's Deferred
Items Log rows that name Phase 10 by name.

**Architecture:** No code, no package. Two document edits: (1) a full-content replacement of §10's twelve
pre-implementation predictions with a sixteen-item as-built reconciliation, staged verbatim in Task 1 below; (2)
eight targeted row edits plus one new row in the roadmap's Deferred Items Log table, staged verbatim in Task 3 —
five from the original pass (`NFR-8`, `NFR-12`, `NFR-16`, `SEAM-5`-`10`, `SEAM-18`) plus four more (Steps 8-11)
added after a separate 2026-07-28 roadmap update retargeted them here from a Phase 9 conformance sweep that
turned out never to run them. "Testing" here means grep-based structural checks confirming the staged content
landed intact, plus a manual completeness cross-check against every phase's own Deviation Ledger section (Task
4) — there is no runtime to exercise.

**Tech Stack:** Markdown only. No code, no build, no test runner.

**Prerequisite:** Phases 0 through 8b's specs and plans exist exactly as committed on `main` as of this plan's
writing (`2026-07-28`). This plan does not require any phase's *code* to exist — Phase 10 audits documents, not a
running SDK (see the design doc's "Why This Phase Doesn't Need Phase 9 to Run First" section). It reads, but does
not modify, every Phase 3a-8b spec and the 5c/6a/6b/6c plans' Deviation Ledger sections.

## Global Constraints

- **Do not touch `docs/product-spec/` or its subfiles.** That corpus is normative, ID-minting reference material
  (`docs/product-spec.md`'s own preamble) — Phase 10 audits deviations from it, it does not edit it.
- **Do not touch any Phase 0-8 spec or plan file.** Their Deviation Ledger sections are read-only inputs to this
  reconciliation; correcting them retroactively would erase the phase-by-phase reasoning trail the ledger sections
  exist to preserve (5c's own withdrawn-WeakSet entry is a deliberate example of keeping a wrong turn visible).
- **Do not run the `knowledge-harvest` skill.** It is explicitly user-invoked only. `docs/knowledge/deliberate-deviations.md`
  becomes stale once §10 is rewritten (its entries are sha-pinned to the pre-Phase-10 text); flag this in Task 5,
  don't act on it.
- **Do not commit.** Explicit instruction for this planning session — leave all edits staged/uncommitted.
- **No placeholder prose.** Every ledger item below is final, publishable text — not a summary to expand later.

---

## File Structure

```
docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md   # full rewrite      (Task 1, 2)
docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md               # Deferred Items Log # (Task 3)
                                                                                    rows + status note
```

No new files. Two existing files modified.

---

### Task 1: Draft the reconciled §10 replacement text

**Files:**
- (staging only — no file written this task; Task 2 applies this text)

**Interfaces:**
- Consumes: every Phase 3a-8b spec's `## Deviation Ledger (for Phase 10)` section; 5c/6a/6b/6c plans' `##
  Deviation Ledger Additions (for Phase 10)` sections; Phase 1's plan (`RequestConditions.applyTo` ETag note);
  Phase 2's design (`SEAM-5`-`10`/`SEAM-18` naming); the current 12-item text of
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`.
- Produces: the exact Markdown body Task 2 writes into that file.

- [ ] **Step 1: Confirm the current file's baseline** — read
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` in full immediately before
  editing (not from memory) so Task 2's replacement is diffed against the actual current text, not a stale recollection.

- [ ] **Step 2: Stage the replacement body**

```markdown
## 10. Deliberate Deviations from the Reference Contract

This section is the as-built reconciliation of every place the port's Node-idiomatic answer changes the
*mechanism* a requirement is satisfied by, rather than merely relocating it — superseding this section's
pre-implementation prediction now that Phases 0-8 have each shipped a design and plan. None of these narrow a
MUST-level correctness guarantee; each is a case where the JVM-specific mechanism a requirement was worded around
does not exist in Node, and an equivalent, differently-shaped mechanism is substituted instead. Reconciled by
Phase 10 (`docs/superpowers/specs/2026-07-28-phase10-deviation-reconciliation-design.md`), 2026-07-28.

1. **Single execution model eliminates every thread/CAS/interrupt-flag primitive, and collapses the sync/async
   transport seam into one.** **SEAM-11** describes a synchronous, blocking transport contract as distinct from
   **SEAM-16**'s asynchronous one; Node has no blocking-I/O execution model to give that distinction meaning, so
   the port ships one `Promise`-returning `Transport.send()` satisfying both requirements' letter at once (Phase
   2). The same absence of threads recurs at every later layer, restated independently rather than
   cross-referenced because each phase correctly re-derived it for its own corner: the execution-context store is
   a plain `Map`, not a concurrent one, and its per-call key is a trivially-unique `Symbol()` rather than a
   composite trace/span identifier a concurrent JVM store would need for collision-safety (Phase 4a); the
   stage-based pipeline has no sync↔async bridge and one `Promise`-only `Step` (`PIPE-28`-`34`, Phase 4c); the
   recovery chain's cancellation re-assertion is a no-op because `AbortSignal.aborted` is latched, not a
   clearable flag to restore (`RECOV-11`, Phase 4b); retry has no interrupt-flag restore, no fatal-error
   exclusion, no trampoline, and no scheduler-shutdown prohibition to code, because an `await` loop is already
   iterative and `AbortSignal` is already latched (`RETRY-23`/`25`/`30`/`45`, Phase 5a); configuration has no
   executor/async-wrapper vocabulary because `Promise` rejection already carries the original error
   (`CFG-19`-`21`, Phase 7a); observability's `AsyncLocalStorage` gets most of `OBS-24`'s manual
   context-propagation-bridge requirement for free, needing only a thin explicit-snapshot helper for the residual
   out-of-continuation case a JVM `ThreadLocal` would need to propagate by hand everywhere (Phase 7b); pagination
   ships one engine, not a blocking-plus-async pair (§12.9, Phase 6c); and the async-runtime bridge has no
   fatal/non-fatal error-class split, JavaScript having no catchable-fatal tier (`ASYNC-21`, Phase 8b). Phase 8b's
   own design additionally corrects an earlier framing: the absence of a non-blocking scheduled-delay primitive
   (`ASYNC-18`) is a full-port collapse, not an 8b-only scope boundary — no adapter anywhere in this port does
   reconnection/retry/backoff scheduling outside the retry engine itself.
2. **The byte-stream provider seam and its discovery machinery are removed.** **SEAM-3**-**SEAM-10** exist to keep
   a third-party stream library out of the zero-dependency core. Web Streams are a runtime standard, not a
   third-party library, so `@dexpace/core` implements the byte-stream contracts directly with no
   discovery/installation machinery (Phase 2); **IO-30**'s resolution half ships, **IO-39** does not — there is no
   registry to resolve conflicts within (Phase 3a). **SEAM-18**'s bridge-specific clauses ("wrapping a blocking
   transport as async REQUIRES a caller-supplied executor," "wrapping an async transport as blocking MUST unwrap
   the async-wrapper exception," "the blocking wait MUST honor interruption") presuppose a blocking transport this
   port cannot idiomatically have and so are not built; its one non-bridge clause — per-call options threaded
   through, not dropped — survives as an ordinary `Transport.send()` obligation, not a deviation (Phase 2).
3. **Two retry stacks collapse into one, with the total-timeout budget explicitly opt-in.** The spec itself
   sanctions this: **RETRY-28** requires that a port unifying retry entry points make that budget explicitly
   opt-in. As-built: one retry engine with two thin adapters, `totalTimeoutMs` optional and undefined by default
   (Phase 5a). Sixteen of the reference recovery-chain's eighteen **RECOV-17**-**RECOV-34** requirements collapse
   onto this single engine's own requirements; **RECOV-32**/**33** are net-new retry behavior with no reference
   twin. Full row-by-row disposition lives in Phase 5a's own design doc, not repeated here.
4. **True runtime encapsulation of domain models is not fully achievable.** ECMAScript `#private` fields close the
   "official construction path" hole **HTTP-2**/**SEAM-29** care about, but TypeScript's structural typing means a
   hand-built object literal can still impersonate a public interface type and bypass builder validation entirely.
   This is an acknowledged, language-level limitation, not an oversight; the mitigation — exporting only concrete
   classes, never bare structural interfaces, from each package's public entry point — narrows but does not
   eliminate the gap (Phase 1).
5. **Schema-as-witness replaces reflective generic-type capture, and the codec-configuration surface it would have
   carried does not exist.** **SERDE-5**-**SERDE-8**'s mechanism (a reflectively-reconstructed type token) has no
   TypeScript equivalent — TypeScript erases types more completely than JVM generics erasure, leaving no raw class
   token to reflect over. The port requires callers to supply a runtime schema value as the witness instead,
   argued to be at least as strong a guarantee, not a weaker substitute. As-built, this closes further than
   originally scoped: `Serde` is not generic in `T` at all, the bundle is per-format once the witness is a
   decode-time parameter rather than a type parameter, and the codec-configuration knobs a generic carrier would
   have gated — coercion, unknown-field handling, date format (**SERDE-21**-**SERDE-26**) — don't exist because
   `JSON.parse`/`stringify` expose no such knobs to gate in the first place (Phase 6a).
6. **Digest MD5 needs a vendored implementation; SHA-256 does not.** The Web Crypto API that keeps `@dexpace/core`
   portable across non-Node runtimes deliberately excludes MD5. The port vendors a small, dependency-free MD5
   implementation for RFC 7616 interoperability and uses `crypto.subtle` directly for SHA-256/SHA-256-sess
   (Phase 5c).
7. **Configuration layering has three tiers, not four.** **CFG-1**'s override → environment → system-property →
   default chain loses its system-property tier outright; Node has no ambient key/value store distinct from
   environment variables to fill that slot, and the port does not fabricate one (Phase 7a).
8. **Cancellation is `AbortController`/`AbortSignal` end-to-end, not "interrupt-and-restore-a-flag."** Every
   cancellable operation in the port — the transport call, the retry backoff wait, a derived per-call timeout —
   composes the same signal type. `Promise` has no public `cancel()` unlike `CompletableFuture`; cancellation is
   cooperative end-to-end, and a `send()` implementation must itself check `signal.aborted` after resuming from an
   `await` before treating a resolved value as deliverable (Phase 2). As-built, retry's timeout-vs-cancellation
   distinction is keyed off the abort reason's constructor name (`TimeoutError` from `AbortSignal.timeout()` vs.
   `AbortError` from a caller abort) rather than a class hierarchy, because both arrive through the same signal
   type (Phase 5a).
9. **Frozen collections are computed once, not wrapped on every read.** **HTTP-5**'s read-only-exposure
   requirement is satisfied by `Object.freeze`-ing each collection exactly once at construction and returning the
   same frozen reference from every subsequent getter call — cheaper than the reference's per-access
   unmodifiable-wrapper pattern, because the port's models never change after construction (Phase 1).
10. **The dead-code-survival gate targets a different risk, and `NFR-8` is confirmed not applicable.** **NFR-8**'s
    JVM shrink-test guards against reflection-driven code looking unreachable to a static analyzer. JS bundlers
    have no such reflection blind spot; `@dexpace/shrink-test` instead targets the dual-package hazard — two
    copies of `@dexpace/core` breaking cross-package `instanceof` checks after a bundle-and-tree-shake round trip
    — as the structurally equivalent risk (Phase 0/9). **Re-confirmed by Phase 10:** `NFR-8` itself (shrinker
    keep/retain configuration) is not applicable by design, full stop — this port has no reflection-driven
    discovery surface to keep-configure at all, the same discovery machinery Item 2 above already retired. This
    closes the item permanently rather than leaving it re-flagged for a future phase.
11. **`Symbol.asyncDispose` is adopted opportunistically, not uniformly, and this is deliberate, not drift.**
    Internal `io/` primitives ship `close()` only — the symbol postdates the package's declared `>=18.17` Node
    floor, and these types are `@internal` and never surface to a consumer who'd use the ergonomic disposal syntax
    (Phase 3a). Public, consumer-facing disposable resources added in later phases — `Body`/`Response` (Phase 3b),
    `SseStream` (Phase 6b), `Page` (Phase 6c) — each add `[Symbol.asyncDispose]` as optional and runtime-guarded
    rather than declaring `implements AsyncDisposable`, so the type works whether or not the running Node version
    supports the symbol, without raising the package's declared floor. Confirmed consistent across all four sites.
12. **The redirect/auth cross-origin marker is a real header, not a `WeakSet`, and its two interpretive questions
    are now settled by Phase 10 directly, not by a Phase 9 conformance sweep that was never going to run them.**
    An earlier `WeakSet<Request>` design was rejected mid-draft: it breaks once retry's attempt-stamping sits
    between redirect and auth and produces a fresh `Request` copy the set doesn't recognize. As-built, a
    `Cross-Origin-Marker` header is cleared and then conditionally re-set on every hop (Phase 5b), and auth's
    challenge-reaction hook is suppressed on a marked hop too, not only the outbound stamp — a leak the Phase 5c
    design caught before shipping (Phase 5c). Two items from this area were originally left open pending Phase
    9's conformance sweep against real fixtures; Phase 9's actual design scoped itself to `XCUT`/`NFR`
    conformance only (`docs/superpowers/specs/2026-07-28-phase9-cross-cutting-conformance-design.md`) and will
    never produce that evidence, so Phase 10 decides both directly instead of leaving them open indefinitely:
    - **Redirect predicate scope over safety mechanics — confirmed, 5b's reading is correct.** `REDIR-20`'s
      "fully override the built-in decision" scopes to the follow/no-follow determination the predicate is
      actually handed a snapshot to decide (current response, redirect count, visited URIs) — nothing about
      credentials or safety mechanics is in that snapshot. Credential stripping, downgrade denial, replayability,
      and the loop cap are separately governed by `XCUT-17`'s own universal, non-overridable framing ("applies
      even if each subsystem individually appears to work"); letting a caller-configured predicate opt out of
      those would be a real security regression, not a caller convenience. 5b's implementation is correct as
      designed; no change needed.
    - **Basic/Digest never stamp preemptively — confirmed, 5c's reading is correct.** `AUTH-14`/`AUTH-15`-`22`
      describe Basic/Digest stamping entirely as a reaction to a parsed challenge; the spec elsewhere describes
      Bearer's preemptive cached-token path explicitly and says nothing of the kind for Basic/Digest, an
      asymmetry that reads as deliberate rather than an oversight given the spec's own care in the Bearer case.
      Digest cannot stamp preemptively regardless — it structurally needs the server's `realm`/`nonce` first.
      Basic could technically stamp preemptively, but doing so sends credentials before a server has asked for
      them, at odds with this port's conservative-by-default posture everywhere else (credential-stripping by
      default, downgrade-deny by default). 5c's challenge-only implementation is correct as designed; no change
      needed.
13. **Transport adapters have platform-shaped gaps the reference doesn't.** Neither `fetch` nor `undici` expose a
    kernel-level zero-copy file-transfer path on this platform (**TRANSPORT-28**'s SHOULD). `transport-fetch`
    ships no proxy support at all — adding one would require depending on `undici` internals, undermining its
    zero-dependency purpose (**TRANSPORT-30**, scoped out). **TRANSPORT-8**'s native-cancel-vs-timeout distinction
    doesn't apply to `transport-fetch`, whose own governing text scopes it to transports with an internal-cancel
    path. Neither transport retries a partial send internally (**TRANSPORT-18**); the SDK's own retry layer
    handles it via the replayability gate instead. `Response.protocol` is a hardcoded `HTTP_1_1` best-effort
    default because neither `fetch`'s `Response` nor undici's `ResponseData` surface the negotiated protocol
    version (all: Phase 8a).
14. **Reproducible builds and publish provenance stay open, unblocking only at first real release.** **NFR-12**
    (byte-identical builds from identical source) and **NFR-16** (publish provenance enforced on the release path)
    are soft gaps: `bun install --frozen-lockfile` and plain `tsc` are deterministic by construction, and
    `prepublishOnly` + `npm publish --provenance` are scripted (Phase 0 Task 3), but neither has been exercised —
    no build artifact or real publish exists yet. Phase 10 does not manufacture a false close here: **NFR-12**
    unblocks when the workspace is built twice and the output digests diffed identical; **NFR-16** unblocks when
    the scripted publish path actually runs against a real registry. Both remain open, target "first real
    release."
15. **A server-issued ETag containing obs-text does not round-trip through a conditional request, by deliberate
    choice.** `RequestConditions.applyTo` writes entity tags through `Headers`' outbound `set`, which enforces
    **HTTP-18**'s MUST-level restriction (HTAB plus printable ASCII 0x20-0x7E only, rejecting any byte ≥ 0x80).
    **HTTP-48** permits obs-text inside an ETag's opaque value (RFC 7232 conformance, SHOULD-level), so replaying a
    server-issued ETag that happens to contain obs-text bytes throws instead of round-tripping (flagged unresolved
    by Phase 1, settled by Phase 10). **Decision: the strict outbound path stays; no relaxed emit path is added.**
    `HTTP-18` is MUST-level and exists for header-injection safety, directly reinforced by `XCUT-18` — the
    cross-cutting conformance checklist's own splitting-defense guard, which the product spec treats as a
    universal invariant that applies "even if each subsystem individually appears to work." A SHOULD-level
    RFC-conformance nicety for an edge case (obs-text-bearing ETags are rare in practice, mostly from legacy
    servers) does not outrank a MUST-level cross-cutting security invariant. `RequestConditions.applyTo` rejects
    such a value rather than silently mangling or passing it through.
16. **Async-runtime adapter fragmentation does not exist.** `Promise` is Node's only ecosystem-wide async
    primitive; the port ships no bridge modules equivalent to the JVM reference's coroutine/reactor/netty/
    virtual-threads adapters. The one optional adapter it does ship, `@dexpace/rx`, is sugar over a genuinely
    different data shape — push-based `Observable`s — not plumbing for the request/response pivot; its
    `sseEvents$`/`typedSse$` are single-subscription, not standard cold/repeatable Observables, because
    `SseStream` wraps an already-consumed-once HTTP response body (Phase 8b).
```

- [ ] **Step 3: Sanity-count the staged content** — confirm the block above contains exactly 16 top-level
  numbered items and that all 12 items in the current (pre-rewrite) file are traceable into it, per this exact
  mapping (old → new): old `#1` (SEAM-11/16 sync/async collapse) and old `#7` (single-threaded eliminates CAS)
  merge into new `Item 1`; old `#2` → new `Item 2`; old `#4` (two retry stacks) → new `Item 3`; old `#5`
  (encapsulation) → new `Item 4`; old `#6` (generic-erasure/schema-as-witness) → new `Item 5`; old `#8` (MD5) →
  new `Item 6`; old `#9` (config tiers) → new `Item 7`; old `#10` (cancellation) → new `Item 8`; old `#11`
  (frozen collections) → new `Item 9`; old `#12` (dead-code-survival gate) → new `Item 10`; old `#3`
  (async-runtime fragmentation) → new `Item 16` (placed last, not third, because it absorbed no new-phase
  content and reads better next to nothing — confirm it's still present, not accidentally dropped, precisely
  because its new position makes it easy to miss). Confirm `Item 11` through `Item 15` are the five clusters with
  **no** predecessor in the current file (`Symbol.asyncDispose`, the cross-origin marker, transport-adapter
  gaps, build/release readiness, and the ETag tension). This is a manual read-through, not a scripted check —
  there's no tooling that understands "does this paragraph cover that paragraph."

---

### Task 2: Apply the replacement to `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`

**Files:**
- Modify: `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (full-body replacement)

**Interfaces:**
- Consumes: Task 1's staged Markdown block verbatim.
- Produces: the file future phases (and any external reader of the Node port's design docs) treat as the
  authoritative deviation list, referenced by name from `docs/sdk-design-nodejs.md`'s own table of contents.

- [ ] **Step 1: Replace the file body** — open
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` and replace its entire content
  (the entire file: the `## 10. Deliberate Deviations...` heading through the last numbered item — currently 12
  items; don't rely on a specific line count, the file has no trailing newline so `wc -l` under-reports it by one)
  with Task
  1 Step 2's staged block, unchanged.

- [ ] **Step 2: Verify structural integrity**

Run: `grep -c '^[0-9]\+\. \*\*' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`
Expected: `16`

Run: `grep -c '^## 10\.' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`
Expected: `1` (exactly one heading, no leftover duplicate section from an incomplete replace)

- [ ] **Step 3: Verify every requirement ID class referenced in the roadmap's Phase-10-targeting rows appears
  somewhere in the new file** — these are the IDs the roadmap explicitly promised would land here.

Run: `grep -o 'SEAM-[0-9]\+\|NFR-8\|NFR-12\|NFR-16\|SEAM-18' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md | sort -u`
Expected output includes at minimum: `NFR-12`, `NFR-16`, `NFR-8`, `SEAM-11`, `SEAM-16`, `SEAM-18`, `SEAM-29`
(SEAM-3 through SEAM-10 are referenced as a range `**SEAM-3**-**SEAM-10**` in Item 2's prose, not as individual
tokens — visually confirm that range string is present with a second check: `grep -c 'SEAM-3.*SEAM-10' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` expected `1`).

---

### Task 3: Update the roadmap's Deferred Items Log

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md` (Deferred Items Log table, currently
  the table starting after the `## Deferred Items Log` heading)

**Interfaces:**
- Consumes: the current table rows for `NFR-8`, `NFR-12`, `NFR-16`, the `SEAM-5`-`SEAM-10` row, and the
  `SEAM-18` row.
- Produces: updated rows plus one new row, all pointing readers at Task 2's rewritten §10 instead of restating
  the deferral inline.

- [ ] **Step 1: Read the current table** from
  `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md` (the `## Deferred Items Log` section) to
  get exact current row text before editing — table rows shift line numbers as earlier edits land, so match by
  row content (`| NFR-8 |`, `| NFR-12 |`, etc.), not by line number.

- [ ] **Step 2: Edit the `NFR-8` row's Note column** to:

```
Re-confirmed as not applicable by design in Phase 10's reconciled ledger (Item 10) — this port has no
reflection-driven discovery surface to keep-configure. Closed 2026-07-28.
```

- [ ] **Step 3: Edit the `NFR-12` row's Note column** to:

```
Still open — Phase 10's reconciled ledger (Item 14) records the intended verification (double-build the
workspace, diff output digests) but cannot execute it without a real build artifact. Unblocks at first real
release.
```

- [ ] **Step 4: Edit the `NFR-16` row's Note column** to:

```
Still open — Phase 10's reconciled ledger (Item 14) records the intended verification (run the scripted
prepublishOnly + npm publish --provenance path for real) but cannot execute it without a real publish. Unblocks
at first real release.
```

- [ ] **Step 5: Edit the `SEAM-5`-`SEAM-10` row's Note column**, replacing "a permanent, documented
  simplification vs. the JVM reference, recorded in Phase 10's deviation ledger, not "TODO'd" anywhere" with:

```
A permanent, documented simplification vs. the JVM reference, recorded in Phase 10's reconciled deviation ledger
(Item 2), not "TODO'd" anywhere. Closed 2026-07-28.
```

- [ ] **Step 6: Edit the `SEAM-18` row's Note column**, replacing "Record in Phase 10's deviation ledger, don't
  re-litigate" with:

```
Recorded in Phase 10's reconciled deviation ledger (Item 2); its one non-bridge clause survives as an ordinary
Transport.send() obligation. Closed 2026-07-28.
```

- [ ] **Step 7: Add a new row** to the same table (append after the `SEAM-18` row):

```
| `HTTP-18`/`HTTP-48`/`HTTP-50` — outbound header strictness vs. ETag obs-text permission, discovered replaying a server-issued ETag with obs-text bytes through a conditional request | Phase 1 | **Resolved in Phase 10** | `RequestConditions.applyTo`'s strict outbound path is kept; `HTTP-18`'s MUST-level splitting defense (reinforced by `XCUT-18`) outranks `HTTP-48`'s SHOULD-level obs-text permission. See Phase 10's reconciled ledger, Item 15. Closed 2026-07-28 |
```

- [ ] **Step 8: Edit the `DigestChallengeUnsupportedError` row's Target-phase and Note columns.** A separate
  2026-07-28 roadmap update (made independently, after this plan's first draft) already retargeted this row from
  "Phase 5c plan time" to "Phase 9 (kept at plan time, on notice)" and then to "Retargeted to Phase 10 — 2026-07-28"
  once Phase 9's actual design shipped scoped to `XCUT`/`NFR` only. Change Target-phase to
  `**Resolved in Phase 10 — 2026-07-28**` and append to the Note:

```
**Resolved:** kept, permanently — no forced usage-sweep will ever run (Phase 9 is `XCUT`/`NFR`-scoped, no phase's
code exists yet for one regardless), and an `@internal`-tier leaf costs nothing sitting unused; it can be removed
later without a breaking change if it genuinely proves dead weight once real callers exist.
```

- [ ] **Step 9: Edit the "Basic/Digest never stamp preemptively" row's Target-phase and Note columns.** Same
  retargeting history as Step 8. Change Target-phase to `**Resolved in Phase 10 — 2026-07-28**` and append to the
  Note:

```
**Resolved:** confirmed correct as designed — the spec's asymmetry (describing Bearer's preemptive path, staying
silent on Basic/Digest) reads as deliberate, and staying reactive matches this port's conservative-by-default
posture elsewhere (credential-stripping by default, downgrade-deny by default). See Phase 10's reconciled ledger
(`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`, Item 12).
```

- [ ] **Step 10: Edit the "Redirect predicate's scope over safety mechanics" row's Target-phase and Note
  columns.** Same retargeting history. Change Target-phase to `**Resolved in Phase 10 — 2026-07-28**` and append
  to the Note:

```
**Resolved:** confirmed correct as designed — `REDIR-20`'s snapshot (response, redirect count, visited URIs)
carries nothing about credentials, and safety mechanics are separately governed by `XCUT-17`'s own universal,
non-overridable framing; a predicate opting out of them would be a security regression, not a convenience. See
Phase 10's reconciled ledger (`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`,
Item 12).
```

- [ ] **Step 11: Edit the `clientIdentityStep` default-install row's Target-phase and Note columns.** Same
  retargeting history. Change Target-phase to `**Resolved in Phase 10 — 2026-07-28**` and append to the Note:

```
**Resolved:** stays out, permanently — adding it would be unrequested preset scope creep; a caller who wants it
installs it explicitly, already possible via the public authoring surface.
```

- [ ] **Step 12: Verify the table still parses as Markdown** — every row (old and new) has the same number of `|`-delimited columns as the table's header row.

Run: `awk -F'|' '/^\|.*(NFR-8|NFR-12|NFR-16|SEAM-5|HTTP-18|DigestChallengeUnsupportedError|Basic\/Digest never stamp|Redirect predicate|Whether `clientIdentityStep`)/{print NF}' docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`
Expected: every printed number identical to the header row's own column count (check the header row's count first with the same `awk -F'|'` pattern against `| Item | Originated in |`). **Use `^\|.*(...)`, not `^\| \`(...)`** — three of these nine rows
(`Basic/Digest never stamp preemptively`, `Redirect predicate's scope...`, `Whether \`clientIdentityStep\`...`)
open with plain prose, not a backtick-quoted term, so an anchor requiring a backtick immediately after `| `
silently skips them and under-verifies.

---

### Task 4: Manual completeness cross-check (no file changes)

**Files:**
- (read-only verification pass, no modifications)

**Interfaces:**
- Consumes: every Phase 3a-8b spec's Deviation Ledger section, the 5c/6a/6b/6c plans' Deviation Ledger Additions,
  Task 2's rewritten §10.
- Produces: a pass/fail judgment — if this fails, return to Task 1 and add the missing material before considering
  the phase done.

- [ ] **Step 1: Re-open every one of these 15 files and confirm each phase named below has at least one
  corresponding sentence in the rewritten §10** (this list is exhaustive — every phase from 3a through 8b that has
  a Deviation Ledger section):

```
3a  docs/superpowers/specs/2026-07-24-phase3a-io-contracts-design.md
3b  docs/superpowers/specs/2026-07-25-phase3b-body-lifecycle-design.md
4a  docs/superpowers/specs/2026-07-25-phase4a-execution-context-design.md
4b  docs/superpowers/specs/2026-07-25-phase4b-recovery-chain-design.md
4c  docs/superpowers/specs/2026-07-25-phase4c-stage-pipeline-design.md
5a  docs/superpowers/specs/2026-07-26-phase5a-retry-design.md
5b  docs/superpowers/specs/2026-07-26-phase5b-redirect-design.md
5c  docs/superpowers/specs/2026-07-26-phase5c-auth-design.md + docs/superpowers/plans/2026-07-26-phase5c-auth.md
6a  docs/superpowers/specs/2026-07-28-phase6a-serde-design.md + docs/superpowers/plans/2026-07-28-phase6a-serde.md
6b  docs/superpowers/specs/2026-07-28-phase6b-sse-design.md + docs/superpowers/plans/2026-07-28-phase6b-sse.md
6c  docs/superpowers/specs/2026-07-28-phase6c-pagination-design.md + docs/superpowers/plans/2026-07-28-phase6c-pagination.md
7a  docs/superpowers/specs/2026-07-28-phase7a-configuration-design.md
7b  docs/superpowers/specs/2026-07-28-phase7b-observability-design.md
8a  docs/superpowers/specs/2026-07-28-phase8a-transport-design.md
8b  docs/superpowers/specs/2026-07-28-phase8b-async-runtime-design.md
```

  Expected: every phase's citation `(Phase Xy)` appears at least once in
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` — spot-check with
  `grep -o 'Phase [0-9][a-z]\?' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md | sort -u`
  and confirm the output set is `{Phase 0, Phase 1, Phase 2, Phase 3a, Phase 3b, Phase 4a, Phase 4b, Phase 4c,
  Phase 5a, Phase 5b, Phase 5c, Phase 6a, Phase 6b, Phase 6c, Phase 7a, Phase 7b, Phase 8a, Phase 8b, Phase 9}` —
  every phase from 3a through 8b now cited at least once, including 4a (execution-context store/key collapse,
  folded into Item 1) and 7b (`AsyncLocalStorage` propagation, also folded into Item 1), which an earlier draft
  of this plan wrongly left uncited. `Phase 9` appears only as the unblock trigger for Item 12's two open
  questions and Item 10's shrink-test origin note, not as a phase with its own deviation entry. Note: 4a's and
  7b's *other* ledger entries (Symbol() call-key ergonomics, `ContextInit` options-object shape, `contextsEqual()`
  omission, the retry/redirect logging vocabulary gap, the `Tracer`/`Span` structural-subset choice) are
  legitimately excluded from §10 — they're implementation-detail choices made where the spec was silent, not
  cases of a JVM-specific mechanism being replaced, which is what this section is scoped to.

- [ ] **Step 2: Confirm no contradiction** — for each requirement ID appearing in more than one source phase's
  ledger (per the extraction performed during design), confirm the rewritten §10 states one disposition, not two
  conflicting ones. The only ID touched by multiple phases with independently-derived (not cross-referenced)
  reasoning is the single-execution-model cluster in Item 1 — confirm it reads as one cumulative argument with
  per-phase sub-bullets, not as separate contradicting claims.

- [ ] **Step 3: Confirm the two `NFR-12`/`NFR-16` items are marked open in the rewritten file, and that Item 12's
  two formerly-open redirect/auth questions are now marked confirmed, not left open**:

Run: `grep -c 'explicitly open' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`
Expected: `0` — Item 12's redirect-predicate-scope and Basic/Digest-preemptive-stamp questions were originally
"explicitly open" pending Phase 9, but Phase 9's actual `XCUT`/`NFR`-only scope (shipped 2026-07-28, after this
plan's first draft) means that evidence will never arrive; Phase 10 decided both directly instead, so neither the
literal phrase nor an open item should remain here. If this returns `1` or more, Item 12 was not updated to match
the 2026-07-28 roadmap retargeting — go back and apply it.

Run: `grep -c '\- \*\*Redirect predicate scope over safety mechanics — confirmed\|\- \*\*Basic/Digest never stamp preemptively — confirmed' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`
Expected: `2` — both redirect/auth questions read as confirmed dispositions, not open items.

Run: `grep -c 'unblocking only at first real release\|remain open, target' docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md`
Expected: at least `1` (Item 14 — `NFR-12`/`NFR-16` are the only items that should still read as open)

---

### Task 5: Flag the stale knowledge-corpus entry (no action taken)

**Files:**
- (documentation of a follow-up, no modification to `docs/knowledge/`)

**Interfaces:**
- Consumes: `docs/knowledge/deliberate-deviations.md`, sha-pinned to the pre-Task-2 version of §10.
- Produces: nothing — this task is a recorded flag for a human or a future `knowledge-harvest` invocation, per
  the Global Constraints' prohibition on this plan invoking that skill itself.

- [ ] **Step 1: Note, in the PR description or session handoff when this plan is executed, that
  `docs/knowledge/deliberate-deviations.md`'s 13 entries are now stale** — each carries a `sha:f9ecb6e7d87b`
  pin to the pre-reconciliation §10 text Task 2 replaces. Re-running `knowledge-harvest` against
  `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` is the fix, and it's a
  user-invoked action, not something this plan's executor does automatically.

---

## Self-Review Notes (writing-plans skill, run against the design doc)

- **Spec coverage:** Design doc's Groups A-O each map to a numbered item in Task 1's staged text (A→1, B→2, C→3,
  D→8's second half, E→6, F→4, G→5, H→9, I→7, J→10, K→11, L→12, M→13, N→14, O→15, plus the original's item #3
  reproduced as Item 16). The Verification/Completeness Check section maps to Task 4. The Deferred Items Log
  updates map to Task 3. The "judgment call: rewrite in place" note is reflected in this plan's Architecture
  section and Global Constraints. No design section lacks a task.
- **Placeholder scan:** no "TBD"/"TODO"/"handle appropriately" — every step either contains the literal text to
  write or a literal shell command with an expected literal output.
- **Type consistency:** N/A — no code, no function signatures to cross-check between tasks.
