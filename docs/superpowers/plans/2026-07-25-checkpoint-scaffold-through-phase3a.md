# Checkpoint — Scaffold → Phase 1 → Phase 2 → Phase 3a

**Purpose:** a single gate to run before starting Phase 3b (or Phase 4, if 3b is folded elsewhere) that
verifies the four already-planned phases —
[scaffold](./2026-07-23-scaffold-milestone.md),
[Phase 1 (core HTTP domain model)](./2026-07-23-phase1-core-http-domain-model.md),
[Phase 2 (seam foundations)](./2026-07-23-phase2-seam-foundations.md),
[Phase 3a (I/O contracts)](./2026-07-24-phase3a-io-contracts.md)
— are not just individually self-reviewed but hold together as one artifact, and that nothing they trade off
against `docs/knowledge` (the styleguide + spec + design-doc corpus) went unrecorded.

**Why this exists separately from the four per-phase checklists:** each of those checklists verifies its own
plan against `product-spec`/`sdk-design-nodejs` requirement IDs (`HTTP-N`, `SEAM-N`, `IO-N`, `NFR-N`) — that
work is done and is not repeated here. None of the four checks the styleguide chapters directly except where a
plan happens to cite one. Section 5 below is the part that does: it cross-references `docs/knowledge` broadly
(including its own recorded `## Conflicts` sections) and surfaces tensions the per-phase, spec-ID-driven passes
structurally could not have caught.

---

## 1. Full gate sequence (cumulative, run from repo root)

Every command below must exit 0, in this order, on a clean checkout with all four phases' code present:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun test --coverage
bun run api
bun run lint:publish
bun run verify:dual-consumption
bun run verify:seam-1
bun run verify:node-floor
bun run audit
```

- [ ] All eleven commands exit 0 locally.
- [ ] Both GitHub Actions jobs (`ci`, `node-floor-conformance`) are green on the pushed commit — `node-floor-conformance` still declares `needs: ci` and still pins `actions/setup-node@v4` to `18.17.0` (scaffold Task 8 + Phase 2 Task 7 Steps 9–10).
- [ ] `bun test --coverage` aggregate is ≥ 80% (`NFR-5`, `bunfig.toml`'s `coverageThreshold`) — Phase 3a is the first phase with enough surface (`ByteQueue`, `BufferedSource/Sink`, `TeeSink`) that a coverage regression would plausibly hide; check the actual number, not just the exit code.
- [ ] Phase 3a's committed bench (`byte-queue.bench.ts`, Task 13) still runs — baseline only, no tuning expected, but confirm it hasn't silently started failing.

## 2. Cross-phase structural invariants

These are invariants each individual phase plan states it preserves from the *previous* phase — this section
re-verifies them holding simultaneously, against the real tree, not phase-by-phase in isolation.

- [ ] `bun run verify:seam-1` passes against the full `packages/core/src/` tree (http/, seams/, io/) — SEAM-1's zero-runtime-dependency contract, unbroken across three phases of real code landing on top of the Phase 0 stub.
- [ ] `git diff --exit-code packages/core/etc/core.api.md` is clean. Then hand-read the report once and confirm it contains exactly: Phase 1's HTTP domain model classes, Phase 2's `Transport`/`composeSignal`/`isTimeoutSignal`/`CancellationError`/`OperationDescriptor`/`buildRequest`/`OperationAssemblyError`/`DexpaceError`, and **nothing new from Phase 3a** — Phase 3a's own Self-Review states its `ByteQueue`/`BufferedSource`/`BufferedSink`/`TeeSink` surface is deliberately not promoted to the public barrel yet (deferred to 3b/later).
- [ ] `grep -c 'Serde' packages/core/etc/core.api.md` is `0` — Phase 2's internal-only exclusion (Task 7 Step 4) re-verified after Phase 3a touched the same `src/index.ts` region only additively, not by re-exporting `seams/index.ts` wholesale.
- [ ] `grep -rn "from 'node:" packages/core/src/ ; grep -rn 'require(.node:' packages/core/src/` — both empty. Phase 3a's Task 13 Step 9 checks this for `io/`; re-run it against the whole tree, since Phase 2's `Transport`/`buildRequest` code is also supposed to be runtime-agnostic and was never explicitly grepped for this.
- [ ] `packages/core/src/index.ts` content matches exactly what Phase 2 Task 7 Step 2 wrote (`export * from './http/index.js'` plus the seven named seam exports) with no unreviewed Phase 3a addition.
- [ ] `engines.node` (`packages/core/package.json`) is still `>=18.17` and `tsconfig.base.json`'s `lib` is still `["ES2022", "DOM"]` — no phase since Phase 2 introduced an API requiring a higher floor or an additional `lib` entry (Phase 3a's Global Constraints explicitly avoid `Symbol.asyncDispose` for exactly this reason — see §5.6).
- [ ] Root `package.json` `scripts` has exactly one entry each for: `lint`, `fix`, `typecheck`, `build`, `test`, `api`, `lint:publish`, `audit`, `verify:dual-consumption`, `verify:seam-1`, `verify:node-floor` — no duplicate or orphaned script left over from a phase's draft.
- [ ] A changeset exists for each phase that shipped new public API (Phase 2 added one in Task 7 Step 11; confirm Phase 1 and Phase 3a either added their own or deliberately didn't because nothing new reached the public barrel — Phase 3a shouldn't have one yet, matching §2's api.md check above).

## 3. Requirement-ID coverage rollup

Full detail lives in each phase's own checklist; this is the cross-phase summary so a reviewer doesn't have to
open four files to see the whole picture.

| Phase | In-scope ID families | ✅ | ⏳ deferred | 🚫 never built | N/A |
|---|---|---|---|---|---|
| Scaffold | `SEAM-1/2`, `NFR-1..17` | 6 | 5 (`NFR-2/9/11/15`, peer-dep dedup) | 0 | 3 (`SEAM-2/3..30`, `NFR-11/15`) |
| Phase 1 | `HTTP-3..53` (39 IDs), `SEAM-29`, `SEAM-1` (re-verified) | 39 + 2 | 0 (MultipartBody named as a deliberate gap, not tracked as ⏳ against an ID) | 0 | `SEAM-2` |
| Phase 2 | `SEAM-11/12/14/16/17/18/19/21/26/27/30`, `XCUT-2`, `HTTP-29` retrofit, `NFR-10/17` residual | 8 full + 3 contract-obligation-only (📄) | 1 (`SEAM-21` → Phase 6) | 0 (bridge machinery correctly never built) | — |
| Phase 3a | `IO-1..42` (per §5.1–5.6 of `product-spec/05`) | ~34 | `IO-13` write-side ledgered as a bounded ⚠️→✅ (UTF-8/ISO-8859-1 only, not full symmetry) | `IO-30` resolution half, `IO-31..36`, `IO-39` (registry never built — same reasoning as Scaffold's `SEAM-5..10`) | `IO-38` |

- [ ] Every ⏳/🚫/N/A row above has a one-line reason a reviewer can find without re-deriving it — confirmed present in each phase's own checklist (they all do).
- [ ] No two phases silently disagree about which phase owns a deferred item (e.g., `MultipartBody`/real body type is claimed by both Phase 1's Self-Review and Phase 3a's checklist as "Phase 3b" — confirm this is the same target, not two different Phase 3b's).

## 4. Consolidated deferred-items ledger

One table, pulled from all four Self-Reviews/checklists, so nothing pushed downstream is invisible once you
stop reading any single phase's file.

| Item | From phase | Target phase |
|---|---|---|
| `@dexpace/shrink-test` (bundle-survival gate) | Scaffold | Later phase that scaffolds the package |
| `NFR-9` shrink-and-run regression guard | Scaffold | Same as above |
| `NFR-2` adapter packages (transport/logging/codec) | Scaffold | Phase 8 |
| `NFR-11` async-framework-leak check | Scaffold | Phase 4 (Execution Context & Pipelines) |
| `NFR-12` reproducible-build proof | Scaffold | Around Phase 10 / first release |
| `NFR-13` SPDX header convention | Scaffold | Starts informally at Phase 1, never mechanically gated (spec says review convention only) |
| `NFR-14` single-source-of-truth versions | Scaffold | Becomes a real decision at Phase 8 (second package) |
| `NFR-15` real `User-Agent` metadata | Scaffold | Phase 7/8 (transport/instrumentation) |
| `NFR-16` publish provenance signing | Scaffold | First actual publish, not yet scheduled |
| Pinned-runtime CI check (residual of `NFR-10`/`NFR-17`) | Scaffold | Pulled forward and closed in Phase 2 Task 7 — confirm this row can be marked done |
| `MultipartBody` model, `Request`/`Response` real body type | Phase 1 → Phase 3a | Phase 3b |
| `SEAM-21` type-witness mechanism, concrete `Serde` (`@dexpace/codec-json`) | Phase 2 | Phase 6 |
| `Logger`/`LogEvent` seam | Phase 2 | Phase 7 |
| `FakeTransport` test double | Phase 2 | First phase testing against `Transport` (likely Phase 4) |
| `SEAM-30` cleanup implementation, `SEAM-14` close *behavior*, `SEAM-12` concurrency conformance test | Phase 2 | Phase 8 |
| Concrete `Transport` (`@dexpace/transport-fetch`/`-undici`) | Phase 2 | Phase 8 |
| `BODY-19`/`BODY-30`/`HTTP-52`/`BODY-34` caps (tap cap, 1 MiB error-body cap, shared preview config) | Phase 3a | Phase 3b — **do not** add `maxRetainedBytes` to `BufferedSource` before then |
| Promotion of any Phase 3a I/O type into the public barrel | Phase 3a | Phase 3b or later (3b picks the name: `BufferedSink` vs `WritableStream<Uint8Array>`) |
| `Symbol.asyncDispose` on I/O resources | Phase 3a | Whenever `engines.node` moves past `>=18.17` |
| I/O provider registry (`IO-30` resolution half, `IO-31..36`, `IO-39`) | Phase 3a | Never — permanent simplification, same reasoning as `SEAM-5..10` |

- [ ] Each row's target phase still exists in the current roadmap (spot-check against `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md` if it's been revised since these plans were written).

## 5. Knowledge-base validation findings

These surfaced from reading `docs/knowledge` broadly (not just the requirement IDs each plan already cites) and
cross-referencing against what the four plans actually ship. None of these are caught by the per-phase
checklists, because those check plan-vs-spec-ID, not plan-vs-styleguide. Each is a judgment call the plans made
implicitly — flagging so it's an explicit, recorded decision rather than a silent drift.

### 5.1 Coverage floor as a *blocking* gate — plans vs. styleguide, unresolved in `docs/knowledge` itself

`docs/knowledge/tooling-and-quality-gates.md`'s own `## Conflicts` section records this as **unresolved**:
the styleguide (`typescript/11-testing.md:210-213`) says coverage is reported as a trend via `bun test
--coverage` and "never target it as a pass/fail gate for a build"; the spec's `NFR-5` requires an enforced 80%
floor "wired into the default build lifecycle." The scaffold plan resolved this in the spec's favor —
`bunfig.toml`'s `coverageThreshold = 0.8` blocks the build — and its own checklist marks `NFR-5` ✅ without
mentioning the styleguide tension at all.

**Verdict:** likely the right call (an explicit spec `MUST`-adjacent requirement should win over a general
styleguide default), but it is currently a *silent* override — the knowledge base's own conflict entry is still
marked `unresolved 2026-07-25`. **Action:** record this specific resolution (spec NFR-5 overrides styleguide
11-testing:210-213 for this repo) either in `docs/knowledge/tooling-and-quality-gates.md`'s Conflicts section or
in a project-level deviation note, so the next person reading the styleguide doesn't "fix" it back.

### 5.2 Error hierarchy depth — Phase 2's `DexpaceError` retrofit

`docs/knowledge/error-handling.md`: "Error hierarchies must be kept to two levels deep; a five-level error
hierarchy navigates no better than a two-level one" (`styleguide/08-error-handling.md:59`).

Phase 2 Task 3 explicitly makes `DexpaceError` "the new taxonomy root, replacing `DomainModelError`'s previous
role as root," with `DomainModelError extends DexpaceError` and every Phase 1 leaf still `extends
DomainModelError`. That's `Error → DexpaceError → DomainModelError → {RequiredFieldError, HeaderValidationError,
...}` — three custom levels under `Error`, not two. `CancellationError` and `OperationAssemblyError` are fine
(they extend `DexpaceError` directly, two levels). The `DomainModelError` branch is the one that's now three
deep.

**Verdict:** a real tension the styleguide rule was written to prevent, and neither Phase 1's nor Phase 2's
Self-Review checks it — both only cross-reference `HTTP-N`/`SEAM-N` IDs, and this rule has no requirement ID.
**Action:** either flatten it (drop `DomainModelError` as a separate tier and have every HTTP leaf extend
`DexpaceError` directly, losing the `instanceof DomainModelError` narrowing Phase 2 says is "unaffected") or
explicitly ratify the three-tier shape as an intentional, bounded exception (one root + one named
domain-grouping tier + leaves — not the unbounded five-level case the rule warns about) before Phase 4 adds
more error families on top of `DexpaceError`.

### 5.3 Error subclasses hold no identifying `readonly` fields

`docs/knowledge/error-handling.md`: "Error subclasses must carry the identifying inputs (ids, offending input,
correlation id) as `readonly` fields so they survive serialization and appear in structured logs"
(`styleguide/08-error-handling.md:58`).

Phase 1's `HeaderValidationError`/`MediaTypeParseError`/etc. take the offending name/value as constructor
arguments but store none of them as fields — only an escaped-and-filtered string ends up in `.message`. This is
*correct* per `HTTP-20` ("never echo the offending value... escape control characters in an echoed name") and
per `redaction-and-security.md`'s broader default-redact posture — storing the raw offending value as a
`readonly` field would silently defeat HTTP-20 the moment something does `JSON.stringify(error)` or logs its
own fields instead of `.message`.

**Verdict:** the deviation from the general styleguide rule is correct, but it's implicit — nothing in Task 1
states "we deliberately do not carry these as fields, because HTTP-20 requires never surfacing them, including
through structured-log field enumeration." **Action:** add that one-line rationale to `errors.ts`'s file
comment (or the Global Constraints section) so a later contributor doesn't "fix" it by adding the field back.

### 5.4 `close()` vs `Symbol.dispose`/`Symbol.asyncDispose` as the primary teardown interface

`docs/knowledge/resource-management.md`: "A class that owns a resource requiring release must implement
`Symbol.dispose`/`Symbol.asyncDispose` rather than exposing a public `close()` method as the primary teardown
interface" (`styleguide/13-resource-management.md:54-58`); a legacy `close()` may remain only as a delegate.

- Phase 2's `Transport.close(): Promise<void>` is plain `close()`, with no `Symbol.asyncDispose` and no note
  explaining why.
- Phase 3a's `ByteQueue`/`BufferedSource`/`BufferedSink`/`RetentionWindow` are also plain `close()` — but Phase
  3a's own checklist *does* ledger this explicitly: `Symbol.asyncDispose` "postdates the `>=18.17` floor and
  TypeScript does not polyfill it for a declaring library — the computed key would silently bind to the string
  `"undefined"` at run time," deferred to whenever `engines.node` moves.

**Verdict:** Phase 3a's omission is deliberate and recorded; Phase 2's is the same omission, same underlying
reason (same Node floor), but unrecorded. **Action:** add a one-line note to Phase 2's checklist (or `errors.ts`
/ `transport.ts`) pointing at the same Node-floor reasoning Phase 3a already wrote down, so `Transport.close()`
doesn't read as an oversight relative to the I/O layer's documented one.

### 5.5 `resource-management.md`'s bounded-collection rule vs Phase 3a's `RetentionWindow`/tap design

`docs/knowledge/resource-management.md`: "Bound every cache, pool, and queue that grows with input, with the
bound named as an explicit design parameter" — satisfied: `ByteQueue`/`RetentionWindow` sizes are the buffer's
own explicit content (not an unbounded cache), and `IO-26`'s tap capacity is an explicit, named parameter with a
documented default. No gap found here — listed to confirm the check was made, not because anything is wrong.

### 5.6 `AbortSignal.any` composition matches the styleguide's own recommended pattern

`docs/knowledge/resource-management.md`: "Compose multiple abort conditions with `AbortSignal.any([...])`...
rather than juggling several controllers" — Phase 2's `composeSignal()` does exactly this. No gap.

## 6. Sign-off

- [ ] Sections 1–4 are all green/accounted-for.
- [ ] Section 5's six findings are each either fixed or explicitly ratified (with a one-line note in the
      relevant plan/source file) — not left as an implicit judgment call a future phase might contradict.
- [ ] Only then start Phase 3b (body-lifecycle contracts, `MultipartBody`, the deferred caps) or Phase 4
      (execution context & pipelines), per whichever the current roadmap names next.
