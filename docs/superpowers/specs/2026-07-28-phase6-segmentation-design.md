# Phase 6 — Pagination, SSE, Serde — Segmentation Design

**Status:** Draft, approved for planning.

**Purpose:** Split the roadmap's Phase 6 into executable sub-phases and fix their scope, order, and shared
contracts before any of them gets its own brainstorm → spec → plan cycle. This document decides *how Phase 6 is
cut*; it does not design any sub-phase's implementation. It is the analogue of the Phase 4 and Phase 5 sizing
decisions, which were recorded only as Deferred-Items-Log rows — Phase 6 gets a document instead because the cut
carries three findings that outlive the sizing question itself (§5, §6, §7).

**Governing documents:** `docs/product-spec/12-pagination.md` (`PAGE-1`–`PAGE-36`),
`docs/product-spec/13-server-sent-events-and-streaming.md` (`SSE-1`–`SSE-41`),
`docs/product-spec/14-serialization-serde.md` (`SERDE-1`–`SERDE-30`),
`docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` (Node-port mapping),
`docs/sdk-design-nodejs/02-package-and-workspace-layout.md` (`@dexpace/codec-json`'s package contract),
`docs/knowledge/{pagination,sse-streaming,serde,package-and-dependency-layout}.md`. Styleguide:
`styleguide/typescript/`, `styleguide/typescript-bun/`.

**How this doc was produced.** Drafted solo, user away from keyboard, with `docs/knowledge/` as the standing
tie-breaker on every decision below. The Deferred-Items-Log's own caution about solo cross-phase drift (the
`cross-origin.ts` row, which "earned itself twice" across 5b/5c) applies directly here and is answered in §7:
all three sub-phases are cut so they share no types with each other, and the one place they touch the same
earlier-phase surface is named explicitly rather than left for mid-draft file discovery.

---

## 1. The sizing case for a split

| Section | IDs | Count |
|---|---|---|
| §12 Pagination | `PAGE-1`–`PAGE-36` | 36 |
| §13 SSE | `SSE-1`–`SSE-41` | 41 |
| §14 Serde | `SERDE-1`–`SERDE-30` | 30 |
| **Total** | | **107** |

107 combined normative IDs. Phase 3 split at ~79 and Phase 4 at ~76; Phase 5's 111 forced a three-way cut. Phase 6
sits between them, so a split is not a judgment call — the only open questions are how many ways and in what order.

## 2. Decision: three segments, cut along the spec's own section boundaries

**6a — Serde** (`§14`, `SERDE-1`–`SERDE-30`) · `@dexpace/core` + **`@dexpace/codec-json`**
**6b — SSE** (`§13`, `SSE-1`–`SSE-41`) · `@dexpace/core`
**6c — Pagination** (`§12`, `PAGE-1`–`PAGE-36`) · `@dexpace/core`

A two-way cut was considered and rejected: any pairing leaves one segment at ~66–77 IDs, back at the threshold
that forced the Phase 3 and Phase 4 splits, and it would bundle two subsystems that share nothing. A four-way cut
(splitting pagination into engine and strategies) was also rejected — §5 shows §12.9's nine async-engine IDs
largely collapse in this port, so `PAGE`'s effective weight is well under its nominal 36.

The section boundaries are the right seams because **the spec itself forbids the couplings that would otherwise
cross them**:

- `SSE-37` (MUST) — core SSE parsing and streaming carry *no serialization dependency*. The knowledge corpus
  records this as a hard architectural invariant, not a preference. So 6b cannot depend on 6a.
- `§12`'s preamble (MUST) — the pagination engine is "transport-agnostic and serde-agnostic." So 6c cannot depend
  on 6a either. The built-in cursor strategy (`PAGE-16`) reads items and a cursor from the body, but through a
  caller-supplied extraction function, never through a `Serde`.
- Nothing in `§13` or `§12` references the other.

The cross-segment contract surface is therefore empty by mandate. That is the property whose absence caused the
5b/5c drift, and it is the strongest argument for cutting here rather than anywhere else.

## 3. Decision: order 6a → 6b → 6c (a convenience order, not a dependency order)

Because §2 establishes that no segment depends on another, the order is chosen on cost and risk, and **any
sub-phase may be executed out of order without breaking the others.** State this in each sub-phase's own design so
a future reader does not invent a dependency that was never there.

**6a first**, for two reasons that are both about paying a cost once, early:

1. 6a scaffolds the workspace's **second package**. `@dexpace/codec-json` is the first non-`core` package in the
   repo, and standing it up is cross-cutting work (peer-dependency declaration, TypeScript project reference,
   version single-sourcing, a second `api-extractor` report, a second build target) that every later package
   inherits. §6 shows this also pulls three Phase-0 deferrals forward out of Phase 8.
2. 6a is the only segment that **reshapes an existing published seam**. The Deferred-Items-Log's `SEAM-21` row
   records that Phase 2's `Serde<T>.deserialize(data: unknown): T` is exactly the erased/inferred generic
   `SEAM-21` forbids, and that the interface *will* change shape in Phase 6 — which is why Phase 2 deliberately
   kept `Serde<T>` out of the package barrel and marked it `@internal`. Reshaping a seam belongs before, not
   after, other work built on the same barrel.

**6c last**, because it is the segment most coupled to *earlier* phases — 4c's `Runtime`, 5a Task 1's
`StepContext.options` (the wire `PAGE-36`'s per-page override discipline rides on), and 3b's `Response` body. It
benefits from 5a–5c being fully settled.

**6b in the middle** by elimination; it is the most self-contained of the three (a byte-level parser over 3a's
`BufferedSource` plus a lifecycle facade) and could equally run first.

## 4. What each segment owns

### 6a — Serde

Ships: the reshaped `Deserializer` seam (schema-as-witness, `{ parse(input: unknown): T }`, closing `SEAM-21`);
`Tristate<T>` as the three-branch discriminated union with `present()` bounded against `null`; the serde error
hierarchy (`SERDE-9`/`SERDE-10`'s root plus directional subtypes); `SERDE-2`'s media-type-as-default-`Content-Type`
wiring into 3b's body-creation path; `SERDE-27`/`SERDE-28`'s streaming and status-aware response handlers; and the
whole `@dexpace/codec-json` package (`JSON.parse`/`JSON.stringify`, the `Tristate` replacer, the
`tristate(innerSchema)` combinator).

Reuses, does not rebuild: 3a's `IoError` — `SERDE-12`'s "a genuine stream I/O error propagates unwrapped, only
malformed input is wrapped" is a routing rule over the existing error tree, not a new one. 3b's `toHttpError()` and
its fixed 1 MiB error-body cap — `SERDE-28`'s bounded buffered error body is the *same* cap (`BODY-30`/`HTTP-52`),
and §14 says so in its own parenthetical. Building a second cap here would be a defect.

### 6b — SSE

Ships: the `SseEvent` immutable value (`SSE-20`–`SSE-22`); the line/field state machine (`SSE-1`–`SSE-15`) over
3a's `BufferedSource` line-reading primitive; the reader's statefulness and non-ownership contract
(`SSE-16`–`SSE-19`); the resource-owning stream facade with exactly-once close across every termination path
(`SSE-23`–`SSE-32`); and the typed adapter (`SSE-33`–`SSE-36`).

Reuses, does not rebuild: 4b's `Outcome`-shaped discriminated union for the mapper's Skip/Done/Value outcomes —
`sdk-design-nodejs/07` §7.2 says so explicitly ("reused rather than re-invented"). Note the shapes are not
identical (`Outcome<T>` is success/failure; the mapper's is a three-way Value/Skip/Done), so "reuse" means the
same union idiom and the same `fold`-style consumption, not the same type. 6b's own design owes an explicit
decision here — a third variant on `Outcome<T>` versus a sibling type — rather than inheriting the ambiguity.

`SSE-37`'s zero-serde invariant should be enforced **mechanically**, not by review: an import assertion over
`src/sse/`, the same shape as the existing CI check that parses `@dexpace/core`'s `dependencies` field and fails
the build if anything appears in it.

### 6c — Pagination

Ships: `Page` and `PageInfo`; the strategy contract; the item-level and page-level views over one drive routine;
the page cap (`PAGE-9`/`PAGE-10`); the three built-in strategies (cursor, page-number, Link header, including
`PAGE-18`'s quoted-comma-safe link-value tokenizer and `PAGE-19`'s RFC 3986 reference resolution); the verbatim
query splice (`PAGE-21`–`PAGE-24`); and the fetcher-based front-end (`PAGE-34`/`PAGE-35`).

Reuses, does not rebuild: Phase 1's RFC 3986 component encoder (`HTTP-29`). `PAGE-22` restates the identical
encoding rule — space as `%20`, literal `+` preserved as data — and `sdk-design-nodejs/07` §7.1 rejects
`URLSearchParams` for exactly the reason a second encoder would be wrong. A second percent-encoder in this
codebase would be a defect.

## 5. Requirements that collapse in this port

Each sub-phase's design owes a row-by-row disposition table for its own collapsed IDs, the same service 5a's
`RECOV-17`–`RECOV-34` table performs. Without it Phase 9's conformance sweep reads collapsed requirements as
uncovered. The three clusters, identified now so no sub-phase re-derives them:

**§12.9 async paging (`PAGE-25`–`PAGE-33`) — 6c.** The reference has two engines, blocking and asynchronous;
this port has one, because it has one async primitive. The async generator *is* the engine. `PAGE-25`'s "no
thread blocks per page" is true by construction. `PAGE-29`'s caller-supplied-executor mode has no Node analogue —
the consumer's own `for await` loop is the scheduling authority, and there is no transport callback thread to tie
up. `PAGE-31`'s trampoline is unnecessary: a `for await` loop is already iterative and structurally cannot recurse
per page, which is precisely the "MAY satisfy the intent with its native loop model" escape the requirement itself
grants. What does **not** collapse: `PAGE-26`/`PAGE-27`/`PAGE-32`'s close-exactly-once obligations re-express as
`finally`-block obligations on the single generator and must be implemented and tested; cancellation re-expresses
as `AbortSignal`; `PAGE-33`'s documented cancellation race survives verbatim as documentation.

**Threading requirements — 6b.** `SSE-18` (one reader driven from one thread at a time) and `SSE-31`
(cross-thread `close()`) re-express against the single-threaded event loop: "concurrent `next()` calls" means
overlapping un-awaited promises, not threads. `SSE-31` does **not** fully collapse — "close tears the resource
down while a read is in flight" is a genuinely reachable state in Node (`close()` during an awaited
`reader.read()`), and the requirement's two branches — clean end when observed *between* pulls, an I/O-shaped
failure when observed *during* one — both need real tests.

**Codec-configuration requirements — 6a.** `SERDE-21`/`SERDE-22` (reject cross-shape scalar coercion, permit
representation-preserving conversion), `SERDE-25` (fresh codec instance per factory call), and `SERDE-26` (never
mutate a caller-supplied codec instance, operate on a private copy) are all written against a configurable codec
engine. This port has none: `JSON.parse` has no coercion knobs and no instance to copy, and shape strictness lives
in the caller's schema, one layer up. `SERDE-8`'s "reject construction with an unresolved type variable" is
likewise vacuous — `sdk-design-nodejs/07` §7.3 establishes that the compile-time rejection is both earlier and
stronger than the reference's runtime guard. These are satisfied-by-construction or not-applicable, and belong in
Phase 10's deviation ledger, not in a TODO.

**Deferred rather than collapsed:** `SSE-41`'s reactive adapter travels to Phase 8 with `@dexpace/rx`, matching
the roadmap's existing placement of `§18`.

## 6. Finding: three Phase-0 deferrals become live in 6a, not Phase 8

Three Deferred-Items-Log rows were targeted at Phase 8 on the shared premise that no second package exists until
the transport adapters are scaffolded. `@dexpace/codec-json` falsifies that premise one phase early:

| Row | Why it is live in 6a |
|---|---|
| `NFR-2` — each optional capability a separately installable unit (core + ≤1 external lib) | `codec-json` is the first such unit, and it takes **zero** external libraries — the cleanest possible instance of the requirement. Resolvable for the codec half in 6a; the transport half still waits for Phase 8 |
| `NFR-14` — single source of truth for dependency/tool versions | The row's own text says it "becomes a real decision the moment a second package with its own dependencies exists." That moment is 6a. The Bun equivalent of the pnpm `catalog:` protocol `sdk-design-nodejs/02` specifies must be chosen here, confirmed against `styleguide/typescript-bun/` |
| Peer-dependency dedup for `@dexpace/core` (dual-package-hazard guard) | `codec-json` is the first package to declare the `@dexpace/core` peer. The hazard is not theoretical for this package specifically: the knowledge corpus names the `Tristate` discriminant and the `Outcome` sum type as exactly the branded-symbol checks two non-identical copies of core would break — and `Tristate` is 6a's own deliverable |

6a's design must dispose of all three explicitly. Leaving them pointed at Phase 8 would mean the workspace's first
multi-package moment passes with none of its guards installed.

## 7. Finding: `sdk-design-nodejs/07`'s item-view snippet contradicts `PAGE-11`

`PAGE-11` (MUST): the item-level view "MUST eager-close each page *before* yielding any of that page's items
(after copying the materialized items)." The Node design doc's illustrative snippet closes *after*:

```
for await (const page of pages()) {
  try { yield* page.items }
  finally { await page.close() }
}
```

Under the snippet the page's response stays open for the whole time its items are being yielded. The snippet still
passes `PAGE-11`'s stated conformance test — an early `break` drives `.return()`, hence the `finally`, hence the
close — which is exactly why this needs recording: **the conformance test is weaker than the requirement**, so
following the snippet ships a violation that the checklist would not catch.

Resolution, per the standing tie-breaker that the normative spec and knowledge corpus win: `PAGE-11` governs.
Items are already materialized and survive close (`PAGE-2`), so closing first costs nothing. The snippet is
illustrative of JavaScript's `.return()`-on-abandon mechanism — which is the point §7.1 is actually making, and
which remains correct — not of close ordering. 6c implements copy-items → close → yield, and its design should
carry this as an erratum note against `sdk-design-nodejs/07`.

## 8. Open items for the sub-phase designs

Named here so each sub-phase inherits a question rather than rediscovering it:

- **6c — is `parse` async?** `PAGE-5` requires the strategy to "read everything it needs from the response
  synchronously inside parse." Node has no synchronous body read, so the literal reading is unimplementable. The
  intent — single-use-body discipline, no retention of the response or its body past the call, no closing, no
  mutation — is fully preservable with `parse` returning a promise. 6c's design must state this re-expression
  explicitly rather than letting an async signature look like an oversight.
- **6b — `Outcome<T>` variant or sibling type** for the mapper's Value/Skip/Done, per §4.
- **6a — the `Serde` bundle's shape after the reshape.** `SERDE-1` requires one bundle exposing one encoder and
  one decoder; the reshape replaces the decoder's parameter list, not the bundle. 6a's design confirms whether
  `Serde<T>` stays generic in `T` at all once the schema carries `T` (a schema-per-call decoder is arguably
  `Serde` non-generic with `deserialize<T>(schema)`), and whether the reshaped seam is finally promoted to the
  public barrel — Phase 2 kept it `@internal` precisely so this could be decided here.

## 9. Roadmap changes this decision implies

- Phase table row 6 splits into 6a / 6b / 6c with the package columns of §2.
- A Deferred-Items-Log row recording the split, its rationale, and the "no cross-segment dependency, order is
  convenience only" property.
- The three `NFR-2` / `NFR-14` / peer-dependency rows retargeted from Phase 8 to 6a per §6.
- A row carrying §7's `PAGE-11` erratum to 6c.
