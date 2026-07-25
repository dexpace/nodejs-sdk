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
bun run test:node
bun run audit
```

- [ ] All twelve commands exit 0 locally.
- [ ] Both GitHub Actions jobs (`ci`, `node-floor-conformance`) are green on the pushed commit — `node-floor-conformance` still declares `needs: ci` and still pins `actions/setup-node@v4` to `18.17.0` (scaffold Task 8 + Phase 2 Task 7 Steps 9–10).
- [ ] `node-floor-conformance` runs as a **matrix over both `18.17.0` and current Node LTS**, not the floor alone (§5.9) — a green floor job does not prove the built artifact works on the version most consumers actually run.
- [ ] `bun run test:node` (the Node-runtime conformance suite, §5.9) covers every runtime-divergent surface landed through Phase 3a: `composeSignal`/`AbortSignal.any`, and Phase 3a's `ByteQueue`/`BufferedSource`/`BufferedSink`/`TeeSink` against Node's `Uint8Array`/async-iteration semantics. It is **not** a duplicate of the `bun test` suite — pure-logic tests (`Headers`, `MediaType`, `QueryParams` parsing) stay Bun-only on purpose.
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
- [ ] `engines.node` and `tsconfig.base.json`'s `lib` agree, and **both moved exactly as §5.4 requires and no further**: the floor raised to the first Node release exposing `Symbol.dispose`/`Symbol.asyncDispose` (verify the number; believed `18.18.0`), `lib` extended with the disposable entry (`["es2023", "esnext.disposable"]` per `resource-management.md`'s Constraints, reconciled with the existing `DOM` entry). No *other* phase introduced an API requiring a higher floor or a further `lib` entry — §5.4's bump is the only sanctioned one, so anything beyond it is unreviewed drift.
- [ ] `grep -rn 'Symbol.asyncDispose' packages/core/src/` returns a hit for every resource-owning class (§5.4): `Transport` (the port interface itself, not only implementations), `ByteQueue`, `BufferedSource`, `BufferedSink`, `RetentionWindow` — each with `close()` retained as a delegate, not as a second independent teardown path.
- [ ] No file in `packages/core/src/` assigns to the `Symbol` global (`grep -rn 'Symbol.asyncDispose\s*??=\|Symbol.asyncDispose\s*=' packages/core/src/` empty) — §5.4 mandates the floor bump specifically instead of a library-side polyfill.
- [ ] Root `package.json` `scripts` has exactly one entry each for: `lint`, `fix`, `typecheck`, `build`, `test`, `test:node`, `api`, `lint:publish`, `audit`, `verify:dual-consumption`, `verify:seam-1`, `verify:node-floor` — no duplicate or orphaned script left over from a phase's draft.
- [ ] `bun.lock` and `.bun-version` are both committed and `bunfig.toml` declares an **isolated** install linker (§5.7) — and `bun install --frozen-lockfile` from a clean `node_modules` still resolves `@types/bun` for `tsc` and still lets `scripts/verify-dual-consumption.mjs` resolve `@dexpace/core`. Both depend on the hoisted layout the isolated linker changes; verify them together, not just that install exits 0.
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
| `NFR-14` single-source-of-truth versions | Scaffold | Becomes a real decision at Phase 8 (second package) — **mechanism now identified: Bun workspace catalogs, see §5.8.** Scaffold's checklist recorded "no direct Bun equivalent"; that is out of date, so re-decide with catalogs on the table rather than re-deriving the gap |
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
| `Symbol.asyncDispose` on I/O resources **and on `Transport`** | Phase 3a / Phase 2 | ~~Whenever `engines.node` moves~~ → **This checkpoint** (§5.4). No longer deferred: the corpus rule is unopposed, and the floor bump that unblocks it is a one-line project decision rather than an external constraint. Ledgered here so the row is not read as still-open |
| I/O provider registry (`IO-30` resolution half, `IO-31..36`, `IO-39`) | Phase 3a | Never — permanent simplification, same reasoning as `SEAM-5..10` |
| Isolated install linker enforcing declared-dependency discipline (§5.7) | This checkpoint | Set now (cheap, one `bunfig.toml` line); its *value* only lands at Phase 8, when adapter packages declare peer deps (`undici`, `pino`) that flat hoisting would let a package resolve undeclared |
| Bun workspace catalogs as the `NFR-14` mechanism (§5.8) | This checkpoint | Phase 8 — do not add a catalog block while `@dexpace/core` is the only package; there is nothing to deduplicate and it adds indirection with no payoff |
| Node-runtime conformance suite `test:node`, matrixed floor + LTS (§5.9) | This checkpoint | Seed now with `composeSignal` + Phase 3a `io/`; **every later phase touching a runtime-divergent surface (Phase 3b bodies, Phase 4 pipelines, Phase 8 transports) must add to it, not just to `bun test`** |

- [ ] Each row's target phase still exists in the current roadmap (spot-check against `docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md` if it's been revised since these plans were written).

## 5. Knowledge-base validation findings

These surfaced from reading `docs/knowledge` broadly (not just the requirement IDs each plan already cites) and
cross-referencing against what the four plans actually ship. None of these are caught by the per-phase
checklists, because those check plan-vs-spec-ID, not plan-vs-styleguide.

**Precedence rule governing this section:** `docs/knowledge` is authoritative over the plans. Where a plan
contradicts a knowledge rule, the *plan* is wrong and gets changed — a plan does not override the corpus by
having shipped first. The findings below are therefore stated as required corrections, not as open judgment
calls, except where the conflict is *inside* the corpus itself (a design entry contradicting a styleguide entry,
recorded in that file's own `## Conflicts` section). For those intra-corpus cases the tiebreak is:

1. A rule carrying an explicit spec requirement ID (`NFR-N`, `HTTP-N`, `SEAM-N`, `IO-N`) beats a general
   styleguide default, because the ID is a conformance obligation and the default is a preference.
2. Otherwise the styleguide wins, because it is the narrower, repo-specific source.
3. If both readings can be satisfied at once, satisfy both — a reconciliation is not a deviation and needs no
   escalation.

Every resolution recorded here still has to be back-ported into the relevant `docs/knowledge` file's
`## Conflicts` entry (replacing its `unresolved 2026-07-25` marker) before sign-off; a resolution that lives only
in this checkpoint will be re-litigated by whoever reads the corpus next.

§5.7–5.9 are the package-manager/runtime cluster: three enforcement properties the pnpm-based
`sdk-design-nodejs/02` design provided for free and the Bun decision dropped without recording. **None of them
reopens Bun vs pnpm** — that is settled (`2026-07-23-scaffold-milestone-checklist.md:54`) and each of the three has
a Bun-native fix. They are recorded here so the fixes get made deliberately instead of the gaps being rediscovered
at Phase 8 as an argument to revisit the package manager.

### 5.1 Coverage floor as a *blocking* gate — plans vs. styleguide, unresolved in `docs/knowledge` itself

`docs/knowledge/tooling-and-quality-gates.md`'s own `## Conflicts` section records this as **unresolved**:
the styleguide (`typescript/11-testing.md:210-213`) says coverage is reported as a trend via `bun test
--coverage` and "never target it as a pass/fail gate for a build"; the spec's `NFR-5` requires an enforced 80%
floor "wired into the default build lifecycle." The scaffold plan resolved this in the spec's favor —
`bunfig.toml`'s `coverageThreshold = 0.8` blocks the build — and its own checklist marks `NFR-5` ✅ without
mentioning the styleguide tension at all.

**Verdict:** intra-corpus conflict, resolved by tiebreak rule 1 above — the plan's choice stands. `NFR-5` and
`NFR-17` are carried in the corpus as spec conformance obligations
(`docs/knowledge/tooling-and-quality-gates.md:86`: "the aggregate coverage floor is enforced by the default build
(NFR-5) … all gates are automatic and blocking (NFR-17)"), which outranks the styleguide's general
"never target it as a pass/fail gate" default (`docs/knowledge/testing.md:54`). Note the conflict entry's *other*
half — which runner — resolves the opposite way and the plans already comply: `bun test` with `bun:test` symbol
imports is the styleguide's, and the design's `c8`/`vitest` half is dead.

**Action:** replace the `unresolved 2026-07-25` marker on
`docs/knowledge/tooling-and-quality-gates.md`'s "test runner and whether coverage gates the build" conflict entry
with this resolution, split across its two halves (runner → styleguide/`bun test`; gating → spec `NFR-5`, floor
blocking at `bunfig.toml`'s `coverageThreshold = 0.8`). Until that edit lands, the styleguide reads as if the
gate is a mistake and the next contributor will delete it.

### 5.2 Error hierarchy depth — Phase 2's `DexpaceError` retrofit

`docs/knowledge/error-handling.md`: "Error hierarchies must be kept to two levels deep; a five-level error
hierarchy navigates no better than a two-level one" (`styleguide/08-error-handling.md:59`).

Phase 2 Task 3 explicitly makes `DexpaceError` "the new taxonomy root, replacing `DomainModelError`'s previous
role as root," with `DomainModelError extends DexpaceError` and every Phase 1 leaf still `extends
DomainModelError`. That's `Error → DexpaceError → DomainModelError → {RequiredFieldError, HeaderValidationError,
...}` — three custom levels under `Error`, not two. `CancellationError` and `OperationAssemblyError` are fine
(they extend `DexpaceError` directly, two levels). The `DomainModelError` branch is the one that's now three
deep.

**Verdict:** the plan is wrong; the corpus rule is unopposed. `error-handling.md`'s two-level rule carries no
competing design entry and `error-handling.md`'s own `## Conflicts` section is empty — so this is a
plan-vs-knowledge contradiction, not an intra-corpus one, and precedence resolves it without a judgment call.
The three-tier shape is not ratifiable here. (Neither Phase 1's nor Phase 2's Self-Review caught it because both
cross-reference only `HTTP-N`/`SEAM-N` IDs, and this rule has no requirement ID — the structural blind spot §5
exists to cover.)

**Action:** flatten to `Error → DexpaceError → {RequiredFieldError, HeaderValidationError, …}` before Phase 4.
Drop `DomainModelError` as a class tier and re-point every Phase 1 leaf at `DexpaceError` directly. This is a
mechanical `extends` change plus the Phase 2 Task 3 retrofit text; the leaves' own constructors and messages are
untouched.

**Cost, stated so it isn't rediscovered as a surprise:** the `instanceof DomainModelError` group check Phase 2
calls "unaffected" disappears. Restore it as a *type-level* discriminant rather than a class tier if any caller
actually needs the grouping — a `readonly kind: 'domain-model' | …` discriminant on `DexpaceError`, or an
exported `isDomainModelError(e): e is …` type-guard union — neither of which adds an inheritance level. Do not
reintroduce the grouping by subclassing. Phase 4's error families then land as leaves on `DexpaceError` too,
which is what keeps the flattening from being undone one phase later.

### 5.3 Error subclasses hold no identifying `readonly` fields

`docs/knowledge/error-handling.md`: "Error subclasses must carry the identifying inputs (ids, offending input,
correlation id) as `readonly` fields so they survive serialization and appear in structured logs"
(`styleguide/08-error-handling.md:58`).

…reinforced by a second corpus rule in the same file: "Structured identifying fields belong on the error object
itself, not only embedded in the message string, so a log aggregator can index them without parsing prose"
(`styleguide/08-error-handling.md:215`).

Phase 1's `HeaderValidationError`/`MediaTypeParseError`/etc. take the offending name/value as constructor
arguments but store *none* of them as fields — only an escaped-and-filtered string ends up in `.message`.

**Verdict:** the plan over-corrected and now violates a corpus rule it did not need to violate. `HTTP-20`
(`docs/knowledge/http-domain-model.md:40`) constrains what a *message* may echo — "validation error messages MUST
NOT echo the offending header **value** verbatim and MUST escape any control characters in an echoed header
**name**" — and `error-handling.md:214` independently requires masking to "the minimum identifying fragment"
rather than dropping identification entirely. Neither says an error object may carry no identifying field at
all. Both rules and `HTTP-20` are simultaneously satisfiable, so tiebreak rule 3 applies: satisfy both rather
than sacrificing one.

**Action:** carry the identifying inputs as `readonly` fields in their *already-sanitized* form — the same
transformation the message string gets, applied once and stored, with `.message` interpolating the stored field
instead of re-sanitizing:

- the offending **name** as a `readonly` field, control-characters-escaped (identical to what `HTTP-20` already
  permits in the message);
- the offending **value** never stored raw — store only a non-reversible descriptor where one aids diagnosis
  (`valueLength: number`, or the masked minimum fragment `error-handling.md:214` describes), or no value field
  at all where even a fragment is a leak;
- for `MediaTypeParseError`, the failing token/offset rather than the full input.

Then add the rationale as a file comment on `errors.ts`: fields are sanitized-at-construction *because*
`JSON.stringify(error)` and structured-log field enumeration bypass `.message` entirely — that is what makes the
sanitize-once-at-the-boundary shape mandatory rather than stylistic. That comment is what stops a later
contributor from "restoring" the raw value into the field.

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

**Verdict:** the rule (`docs/knowledge/resource-management.md:8`) is unopposed — that file's `## Conflicts`
section is empty — so both phases contradict the corpus and precedence resolves against them. Phase 3a's version
is *documented*, which is better than Phase 2's silence, but a recorded deviation is still a deviation: the
corpus does not grant "the floor makes it awkward" as an exemption, and `resource-management.md:10` already
supplies the shape that would have complied ("if a legacy `close()` must remain, make `[Symbol.dispose]`
delegate to it so there is a single teardown path").

Phase 3a's technical objection is real but is an argument about the *floor*, not about the rule — and the floor
is a one-line project decision, not a constraint handed down by the corpus. That makes this the cheap side of
the tradeoff, so it does not get escalated: adopt the rule.

**Action** — land all three parts together, they do not work separately:

1. **Raise `engines.node`** past the first release exposing the `Symbol.dispose`/`Symbol.asyncDispose`
   well-known symbols, so the computed key cannot bind to the string `"undefined"`. Believed to be `18.18.0`
   (also backported to the 20.x line) — **verify against the actual Node release notes before writing the
   number**, exactly as §5.7/§5.8 require for Bun feature claims. Do **not** ship a library-side polyfill that
   assigns to the `Symbol` global: mutating a global from inside `@dexpace/core` is a far worse contract for a
   zero-dependency SDK (`SEAM-1`) than a patch-level floor bump.
2. **Add the `lib` entry.** `docs/knowledge/resource-management.md`'s Constraints section: disposable types
   require an explicit `"lib": ["es2023", "esnext.disposable"]`. `tsconfig.base.json` currently declares
   `["ES2022", "DOM"]`, so `Symbol.asyncDispose` does not even type-check today. This changes the §2 invariant
   that asserts `lib` is unchanged — update that checklist line in the same commit rather than letting the gate
   fail against its own stale expectation.
3. **Implement `[Symbol.asyncDispose]()` on every resource-owning class** — Phase 2's `Transport`, Phase 3a's
   `ByteQueue`/`BufferedSource`/`BufferedSink`/`RetentionWindow` — as the primary teardown interface, with the
   existing `close()` retained as a delegate to it (`:10`), so there is exactly one teardown path and no
   caller breaks. `Transport` is a *port interface*, so the symbol method belongs in the interface contract, not
   only in implementations; Phase 8's concrete transports then inherit the obligation instead of each
   re-deciding.

Both `Transport.close()` and the I/O classes are still pre-consumer surface (§2 confirms none of Phase 3a's
types reached the public barrel), so this is the cheapest moment this change will ever be available.

### 5.5 `resource-management.md`'s bounded-collection rule vs Phase 3a's `RetentionWindow`/tap design

`docs/knowledge/resource-management.md`: "Bound every cache, pool, and queue that grows with input, with the
bound named as an explicit design parameter" — satisfied: `ByteQueue`/`RetentionWindow` sizes are the buffer's
own explicit content (not an unbounded cache), and `IO-26`'s tap capacity is an explicit, named parameter with a
documented default. No gap found here — listed to confirm the check was made, not because anything is wrong.

### 5.6 `AbortSignal.any` composition matches the styleguide's own recommended pattern

`docs/knowledge/resource-management.md`: "Compose multiple abort conditions with `AbortSignal.any([...])`...
rather than juggling several controllers" — Phase 2's `composeSignal()` does exactly this. No gap.

### 5.7 Flat hoisting lets a package resolve a dependency it never declared

`docs/knowledge/tooling-and-quality-gates.md` records this as a **constraint**, not a resolved decision: "By
default `bun install` hoists dependencies into a flat `node_modules` layout (the npm/yarn style), so a package can
resolve a transitive dependency it never declared" (`styleguide/typescript/01-formatting-and-tooling.md:117`).
`docs/knowledge/package-and-dependency-layout.md:48` is explicit that the *reason* `sdk-design-nodejs/02` chose a
pnpm workspace was its isolated (symlinked) layout, and `:47` that "the peer-dependency declaration is what makes
npm/pnpm" fail loudly on a missing peer. Switching the package manager to Bun kept the workspace *shape* but
silently dropped that enforcement — nothing in the scaffold plan restores it.

Bun exposes an isolated linker (`nodeLinker`/`linker = "isolated"` in `bunfig.toml`, pnpm-style symlinked layout).
**Verify the exact key and value against the Bun version pinned in `.bun-version` before wiring it** — it is a
relatively recent addition and this checkpoint is not asserting the spelling.

**Verdict:** no live bug today. `@dexpace/core` has a hard-empty `dependencies` field (`SEAM-1`, mechanically
gated by `verify-seam-1.mjs`), so there is currently no runtime dependency for any package to phantom-resolve, and
the only shared tree is the workspace-root `devDependencies`. It becomes a real exposure at **Phase 8**, the first
time an adapter package declares a runtime peer (`undici`, `pino`) — a flat tree lets `@dexpace/core`'s own tests
`import 'undici'` and pass, then fail for a consumer who installed core alone.

**Action:** set the isolated linker **now**, at this checkpoint, while the tree is one package and the blast radius
is a single `bun install`. Two things break under isolated linking and must be re-verified in the same change (both
are already checklist items in §2): `tsc`'s automatic `@types/bun` discovery from `node_modules/@types` — which
scaffold Task 1 Step 2 depends on and which sets no `compilerOptions.types` entry to fall back on — and
`scripts/verify-dual-consumption.mjs`, which resolves the built `@dexpace/core` through workspace linking. If
either breaks and cannot be fixed cheaply, record the isolated-linker rejection as an explicit deviation with
Phase 8 as the forced re-decision point; do not leave it as an unexamined default.

### 5.8 `NFR-14`'s "no direct Bun equivalent" is out of date

Scaffold's checklist (`2026-07-23-scaffold-milestone-checklist.md:45`) marks `NFR-14` (single source of truth for
dependency/tool versions) as "✅ for now / ⏳ formalize at Phase 8", reasoning that
"`sdk-design-nodejs/02`'s original mechanism was pnpm's `catalog:` protocol, which has no direct Bun equivalent
wired in this plan." `docs/knowledge/tooling-and-quality-gates.md:110` and
`package-and-dependency-layout.md:70` both still frame `catalog:` as pnpm-only, the Node analog of
`gradle/libs.versions.toml`.

Bun has since added workspace **catalogs** (a `catalog`/`catalogs` block in the workspace-root `package.json`,
referenced from member packages as `"catalog:"`). As with §5.7, **confirm the exact schema against the pinned Bun
version before writing any of it** — the claim here is that the mechanism exists, not that this document has the
spelling right.

**Verdict:** the requirement's conclusion (⏳ until Phase 8) is still correct — with one package there is nothing
to deduplicate, and a catalog block would be pure indirection. But the stated *reason* is now wrong, and a wrong
reason is worse than an open item: at Phase 8 someone reads "no Bun equivalent" and either hand-syncs versions
across packages or reopens the pnpm decision, when neither is necessary.

**Action:** correct the reason in `2026-07-23-scaffold-milestone-checklist.md:45` (and the two `docs/knowledge`
lines that assert `catalog:` is pnpm-specific) to say the mechanism exists in Bun and is deferred for lack of a
second package — not for lack of a tool. Keep the ⏳ status and the Phase 8 target unchanged.

### 5.9 `bun test` proves nothing about the Node runtime this SDK ships to

This is the largest gap in the four phases and no per-phase checklist could have caught it, because every phase
verified itself against `bun test` exiting 0.

`docs/knowledge/tooling-and-quality-gates.md` already states the principle, from
`sdk-design-nodejs/09:52-54`: "CI must run the built output, not just `tsc --noEmit`, against each package's
declared minimum Node version in addition to current LTS." What the plans actually built:

- `bun test` — the entire test suite, ~32 test files across Phases 1/2/3a, running on **Bun's** runtime.
- `scripts/verify-node-floor.mjs` (Phase 2 Task 7) — **two assertions**, on Node 18.17.0, that `composeSignal()`
  returns a distinct `AbortSignal`.
- `scripts/verify-dual-consumption.mjs` (scaffold Task 6) — a smoke *import* on Node, no behavioral assertions.
- `node-floor-conformance` — pins `18.17.0` only. **Current LTS is never exercised at all**, in direct
  contradiction of the "in addition to current LTS" half of the rule above.

For an HTTP SDK this is a substantive risk, not a formality: Bun's `fetch`, Web Streams, `AbortSignal`, and
`Uint8Array`/async-iteration behavior are independent implementations of Node's, and Phase 3a's `io/` layer
(`ByteQueue`, `BufferedSource`, `BufferedSink`, `TeeSink`) is exactly the kind of code where they diverge — chunk
boundaries, backpressure timing, `queueMicrotask` ordering. Phase 3a's own checklist grep (`from 'node:'` returns
empty) proves the code is runtime-*agnostic in its imports*, which is a different and much weaker claim than
runtime-*correct on Node*.

**Verdict:** a real gap against a rule the knowledge base already states, and the one finding here that needs new
code rather than a note. But the obvious fix — move the suite to `vitest`/`node:test` — is the **wrong** fix and
should be explicitly rejected: `docs/knowledge/testing.md` mandates `bun:test` symbol imports (`:4`),
`setSystemTime` for clock virtualization (`:38`), and `--concurrent` parallel-safety (`:50`), so swapping runners
is a styleguide-chapter deviation *plus* a ~32-file rewrite, and it buys nothing for the pure-logic majority of
those tests (`Headers`/`MediaType`/`QueryParams` parsing cannot behave differently on Node).

**Action:** keep `bun test` as the unit-test runner, unchanged, and add a **thin, additive Node-runtime
conformance layer** — a small number of `node --test` files under `test/node-conformance/`, importing the **built**
artifact (never `src/`), wired as `test:node` in root `package.json` and run by the existing
`node-floor-conformance` job. Two changes to that job: make it a matrix over `[18.17.0, <current LTS>]` (closing
the "in addition to current LTS" half), and have it run `bun run test:node` in place of the two-assertion
`verify-node-floor.mjs` — folding that script's `AbortSignal.any` check in as the suite's first case rather than
keeping two parallel Node entry points. Seed it with `composeSignal` plus Phase 3a's byte-stream surface. The
membership rule matters more than the initial content: **a phase that touches a runtime-divergent surface adds a
case here, not only to `bun test`** — that means Phase 3b (body lifecycle, `MultipartBody`), Phase 4 (pipelines,
where `NFR-11`'s async-framework-leak check already lands), and Phase 8 (concrete `fetch`/`undici` transports,
where this stops being precautionary).

### 5.10 Blanket `#private` without the per-use justification the corpus requires

`docs/knowledge/data-modeling.md:20`: class fields "should use the `private` modifier by default rather than
`#private` fields, since `private` is compile-time-only, erasable, and emits no runtime code." `:22`: "a
`#private` field **requires a comment justifying a genuine runtime-privacy requirement** … it is not the default
for ordinary application code." `docs/knowledge/http-domain-model.md`'s own `## Conflicts` entry
(`unresolved 2026-07-25`) records the design pulling the other way — `#field` for every piece of model state,
because runtime encapsulation is what the immutable-value requirement needs — and notes the tension precisely:
"the design's rationale is the justification the styleguide asks for, so this may be a sanctioned carve-out
rather than a true conflict — **but it is blanket across every model class, not per-use**."

Phase 1 adopts `#private` universally across the HTTP model classes and writes the rationale once, at plan level.

**Verdict:** intra-corpus conflict, and tiebreak rule 3 settles it — both entries are satisfiable at once. The
*choice* of `#private` is ratified (runtime privacy genuinely is the requirement here: structural typing and
bracket access would otherwise let a caller forge or mutate a supposedly-immutable wire model, which is what
`HTTP-1`/`SEAM-29` depend on). The *missing comment* is a real, uncorrected gap — the corpus asks for the
justification at the declaration site, where a reader meets the field, not in a plan document they will never
open.

**Action:** one short justification comment per declaring class (not per field — per-field would be noise for a
class whose every field is `#private` for the same reason), naming the runtime-privacy requirement and citing
`HTTP-1`/`SEAM-29`. Then resolve the `http-domain-model.md` conflict entry as a sanctioned carve-out **scoped to
wire-model classes only** — the carve-out must not read as blanket permission for `#private` elsewhere in the
SDK, or `data-modeling.md:20`'s default is dead everywhere by precedent.

### 5.11 Phase 4 pre-commitment: `Stage` must not be a TypeScript `enum`

Not a defect in the four phases under review — Phase 4 is unwritten. Recorded here because the corpus conflict
is already open and the checkpoint is the last gate before Phase 4 starts.

`docs/knowledge/pipeline.md`'s `## Conflicts` (`unresolved 2026-07-25`): the design describes the fixed stage
ordering as a "frozen `Stage` enum" with sparse numeric keys; the styleguide "bans TypeScript `enum` outright (a
deviation it records deliberately against Google's guide) and enforces the ban with `erasableSyntaxOnly`,
prescribing a literal union or an `as const` object plus a derived type instead."

**Verdict:** tiebreak rule 3 again — the design's requirement is *frozen, ordered stage identity with sparse
numeric keys*, and an `as const` object plus a derived literal union delivers exactly that. The word "enum" in
the design doc is describing a concept, not mandating the TypeScript construct. There is no genuine conflict to
resolve, and no deviation to record. Note also that a literal `enum` would not merely be a style violation: it
is non-erasable syntax and `erasableSyntaxOnly` makes it a **compile error**, so the scaffold's own `typecheck`
gate rejects it. Whoever writes Phase 4 would discover this the hard way.

**Action:** when the Phase 4 plan is written, define `Stage` as an `as const` object plus
`type Stage = typeof Stage[keyof typeof Stage]`, preserving the sparse numeric ordering values so later stages
can be inserted between existing ones without renumbering. Resolve the `pipeline.md` conflict entry to that
reading now, before the plan exists — it costs one edit today and prevents a plan being written against a
construct the compiler rejects.

### 5.12 Tooling conflicts already resolved by the plans — recorded, not re-opened

The remaining two `unresolved 2026-07-25` entries in `docs/knowledge/tooling-and-quality-gates.md` are already
settled by what the plans built; they need a corpus edit, not a decision.

- **Package manager and lockfile** (design: pnpm workspace + `catalog:`; styleguide: `bun install` against a
  committed `bun.lock`, Bun pinned via `.bun-version`, `bun install --frozen-lockfile` as the CI gate) —
  resolved in favor of the styleguide. The scaffold implements Bun throughout, and the decision is already
  recorded at `2026-07-23-scaffold-milestone-checklist.md:54`. §5.7/§5.8 above close the two enforcement
  properties this cost; **neither reopens the choice.**
- **`gts` as the lint/format baseline** (styleguide: gts as sole toolchain, exactly one ESLint overlay
  extending it, Prettier defaults non-overridable; design's table: typescript-eslint `strict-type-checked` /
  `stylistic-type-checked` directly, gts never mentioned) — resolved in favor of the styleguide. The plans
  extend gts in `eslint.config.js` and layer the type-checked strict tiers on top as the single permitted
  overlay, which satisfies the design's rule set as well.

**Action:** replace both `unresolved 2026-07-25` markers with these resolutions and a pointer to where each was
decided. Both design-side entries (`sdk-design-nodejs/02:50-51`, `09:8-10`, `09:15`) are now obsolete
descriptions of a toolchain this repo does not use — leaving them unmarked invites a future contributor to
"re-align" the repo against them.

## 6. Sign-off

- [ ] Sections 1–4 are all green/accounted-for.
- [ ] Section 5's twelve findings are each fixed — not ratified-in-place. Under §5's precedence rule a plan does
      not get to keep a shape the corpus rules against, so "we thought about it and left it" is not a valid
      disposition for §5.2/§5.3/§5.4/§5.10. The dispositions are:
      - **Code changes, landed and green before sign-off:** §5.2 (flatten the error hierarchy), §5.3 (sanitized
        `readonly` identifying fields + `errors.ts` rationale comment), §5.4 (floor bump + `lib` entry +
        `Symbol.asyncDispose` on every resource owner), §5.7 (isolated linker), §5.9 (`test:node` suite +
        floor/LTS matrix), §5.10 (per-class `#private` justification comments).
      - **Documentation-only:** §5.8 (correct the stale `NFR-14` reason), §5.11 (Phase 4 `Stage` pre-commitment).
      - **Verified-no-gap, no action:** §5.5, §5.6.
      - **Corpus edits only:** §5.1, §5.12.
- [ ] **Every `unresolved 2026-07-25` marker touched by §5 is resolved in `docs/knowledge` itself**, not only
      here: `tooling-and-quality-gates.md` ×3 (§5.1 coverage-gating + runner, §5.12 package manager, §5.12 gts),
      `http-domain-model.md` ×1 (§5.10 `#private`, scoped to wire-model classes), `pipeline.md` ×1 (§5.11 `Stage`
      as `as const`). Verify with `grep -rn 'unresolved 2026-07-25' docs/knowledge/` returning empty. A
      resolution recorded only in this checkpoint is not recorded — the next contributor reads the corpus, not
      this file.
- [ ] `docs/knowledge/error-handling.md` and `resource-management.md` still have **empty** `## Conflicts`
      sections after §5.2/§5.3/§5.4 land — i.e. the plans were brought to the rules, and no new deviation entry
      was invented to preserve the old plan shapes.
- [ ] Every runtime/tooling version claim in §5.4/§5.7/§5.8 was verified against its actual source before being
      wired — Node release notes for the `Symbol.asyncDispose` floor, `.bun-version` for the Bun features. This
      document names mechanisms, not exact config keys or version numbers.
- [ ] Only then start Phase 3b (body-lifecycle contracts, `MultipartBody`, the deferred caps) or Phase 4
      (execution context & pipelines), per whichever the current roadmap names next.
