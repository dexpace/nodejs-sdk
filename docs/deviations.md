# Deviations — the as-built audit, and the landing point for the rest

Audit of `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (the Phase 10
reconciled ledger, 17 items) performed against the **as-built code**, not against the phase specs that
produced it. Every item was re-derived from source; each entry below records the file and line that proves
the claim.

**Scope of this file, as of 2026-08-31:** two things, in this order.

1. **The audit.** The deviations that are *permanently uncorrectable* — where restoring the reference
   contract's own mechanism is impossible on this platform, forbidden by a project constraint, or would be a
   regression. Items found to be **correctable** are deliberately **not** listed here; they were fixed
   instead. That is everything below, and it is unchanged.
2. **The collection point.** A deviation found outside a phase, by a review or a maintenance pass, with no
   phase ledger to write to and no permission to write to §10. It is appended under
   "Deviations recorded outside a phase" at the end of this file, dated, and folded into §10 the next time §10
   is deliberately amended. That section is empty today: the 2026-08-31 restructure swept the non-frozen tree
   and found no unrecorded deviation, only three unrecorded *deferrals* (`open-items.md` U2) and six
   mis-numbered register citations (`open-items.md` U6).

**This file is the audit and the mutable collection point; §10 is the ledger and it is frozen.** (The
cross-reference was added 2026-08-30, when nothing in the repo linked the two and the numbering they share had
no stated owner. The role below widened on 2026-08-31, when `docs/` gained a stated structure and §10 landed
inside a read-only tree.)

- **`docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md` (§10) is the normative
  ledger** — the canonical list of deliberate deviations, and the **owner of the item numbers**. Every `## N`
  heading and every table row below is keyed to §10's numbering and has no independent identity. **If §10
  renumbers, this file must be renumbered in the same commit.** §10 carries the matching pointer back here.
- **§10 sits in a frozen tree.** `docs/sdk-design-nodejs/` is read-only to routine maintenance and to the
  `housekeeping` skill, which refuses to write there — see [`README.md`](./README.md). Editing §10 is a
  deliberate, hand-made act. **This file is not frozen**, and that asymmetry is the point: a deviation
  discovered by a maintenance pass, a review, or an audit is recorded here on the day it is found, and §10 is
  amended when someone deliberately amends it. What must never happen is the finding waiting for the ledger.
  The coupling now spans a freeze boundary, and only one side of it can be repaired by the tool that notices
  the drift — registered as `open-items.md` U4.
- **This file is the as-built audit of that ledger** — it re-derives each item from source, carries the
  `file:line` evidence, and records which of §10's claims did not survive contact with the code.
- **A deviation *produced by a phase* is recorded in neither, at first.** It goes in the owning phase's own
  `## Deviation Ledger (for Phase 10)` section — 24 such sections exist under `docs/work/mvp/` — and §10 is
  the consolidated **output** of those, not their intake. Those sections are dated provenance and stay where
  they are.
- **A deviation found *outside* a phase is recorded here.** A maintenance pass, a review of shipped code, or
  an audit has no phase ledger to write to and cannot write to §10. It writes here, and the next deliberate
  §10 amendment folds it in. This is the half of the intake rule that did not exist before 2026-08-31, and its
  absence is why a finding with no owning phase had nowhere to go.
- **The corpus no longer carries a copy.** `docs/knowledge/deliberate-deviations.md` was a harvested topic
  file derived from an older revision of §10 — a third of the register, mis-anchored, two entries false. It
  was dropped on 2026-08-31: a register accumulates rows and a harvest of it is one stale revision, so §10 is
  read directly. What remains under the corpus is a pointer, `docs/knowledge/notes/deliberate-deviations.md`,
  which says exactly that.

Audited 2026-08-29 against `25-phase-10-deviation-reconciliation` @ `d8217af`; the audit's own changes landed
on that branch as `27fb81f`, which is the tree this file describes.

**What the audit changed** (committed as `27fb81f`):

| Was | Outcome |
|---|---|
| Item 11 — `Symbol.asyncDispose` declared as a plain class member on `Page`, `FetchTransport`, `UndiciTransport` | **Code fixed.** All three now install it guarded, matching `SseStream`. On the `>=20.3` floor the computed key evaluated to `undefined`, leaving a junk `"undefined"` prototype entry and no working disposal — verified on real Node 20.3.0, before and after. `implements AsyncDisposable` and the factories' `& AsyncDisposable` return types dropped as untrue on the floor. Changeset added; API reports regenerated |
| Item 11 — the `Page` node-conformance test asserted `typeof page[Symbol.asyncDispose] === 'function'` | **Test fixed.** On the floor that read `page['undefined']`, which *was* the junk method, so the assertion passed over a `Page` that could not be disposed. Now branches on the symbol and asserts the junk key's absence on both matrix legs |
| Item 14 — `NFR-12` recorded as unverifiable | **Closed on evidence.** 644 emitted files **and 9 `npm pack` tarballs** byte-identical across two clean builds. Added `bun run verify:reproducible-build` as a blocking CI step, negative-tested by injecting a `Date.now()` into `gen-version.mjs`. (Widened 2026-08-30: the tarball comparison was a by-hand check of `@dexpace/core` alone at audit time; it is now a second leg inside the gate, over every publishable package, on both builds) |
| Item 7 — "three tiers, not four" | **Ledger corrected.** The code implements all four; only the default production binding of the property layer is empty |
| Item 4 — "never bare structural interfaces" | **Ledger corrected.** 61 exported interfaces vs 58 classes; `Configuration` is builder-built and exported structurally |
| Item 14 — "`npm publish --provenance` is scripted" | **Ledger corrected.** It is not scripted anywhere; only `prepublishOnly` is |

Everything below is what remains genuinely uncorrectable: **fifteen** of the ledger's seventeen items. Items
**7** and **11** are gone from the count because they were correctable and were corrected; item **14** stays,
because only its `NFR-12` half closed. (`27fb81f`'s commit message says "fourteen"; it counted the split item
14 as gone. The list below is the authoritative count — fifteen `##` sections, fifteen table rows.)

| Ledger item | Verdict |
|---|---|
| 1 Single execution model | Uncorrectable — platform |
| 2 Byte-stream provider seam | Uncorrectable — platform + `SEAM-1` |
| 3 Retry stacks unified | Uncorrectable — spec-sanctioned by `RETRY-28` |
| 4 Structural-typing encapsulation gap | Uncorrectable — language (its mitigation clause was wrong; corrected) |
| 5 Schema-as-witness | Uncorrectable — language |
| 6 Vendored MD5 | Uncorrectable — platform + `SEAM-1` |
| 8 `AbortSignal` cancellation | Uncorrectable — platform |
| 9 Freeze-once collections | Uncorrectable — and strictly better |
| 10 `NFR-8` not applicable | Uncorrectable — no surface to configure |
| 12 Cross-origin marker header | Uncorrectable — the alternative is broken |
| 13 Transport-adapter platform gaps | Uncorrectable — platform (4 of 5 clauses) |
| 14 `NFR-16` publish provenance | Uncorrectable *here* — needs a real registry (`NFR-12` split out and closed) |
| 15 ETag obs-text does not round-trip | Uncorrectable — MUST outranks SHOULD |
| 16 No async-runtime adapter fragmentation | Uncorrectable — no second ecosystem exists |
| 17 Three-level error tree | Uncorrectable — the subtyping *is* the requirement |

Items **7**, **11**, and the `NFR-12` half of **14** are absent from this list on purpose. They were correctable, and have been corrected — see the table above.

---

## 1. Single execution model eliminates every thread/CAS/interrupt-flag primitive

**Verified.** `Transport.send()` is `Promise`-only, one method satisfying `SEAM-11` and `SEAM-16` at once
(`packages/core/src/seams/transport.ts:49`). `ContextStore` holds a plain `Map<symbol, ExecutionContext>`
(`packages/core/src/context/store.ts:24`) with a fresh `Symbol()` per call
(`packages/core/src/context/context.ts:104,125,149`). `Next` is `(request?) => Promise<Response>` with no sync
twin (`packages/core/src/pipeline/step.ts:23`). `wrapCancellation` degenerates to `failure(error)` and says so
(`packages/core/src/recovery/cancellation.ts:31`). `ASYNC-18` holds: SSE parses `retryMs`
(`packages/core/src/sse/parser.ts:131`) but never acts on it — reconnection is caller-owned, so no adapter
schedules a delay outside the retry engine.

**Why it cannot be corrected.** There is no thread to interrupt, no CAS to perform, and no clearable
interrupt flag to restore. `AbortSignal.aborted` is latched by specification — re-asserting it is not merely
unnecessary, it is not expressible. Reintroducing the distinction would mean shipping a synchronous blocking
transport, which Node's I/O model cannot provide without a worker thread and a `SharedArrayBuffer` +
`Atomics.wait` handshake — a mechanism strictly worse than the one it replaced, and one that would break
`SEAM-1`'s zero-dependency floor for the browser/Workers half of the runtime target.

---

## 2. The byte-stream provider seam and its discovery machinery are removed

**Verified.** `packages/core/src/io/index.ts` exports concrete types only; the sole surviving mention of
"provider" in `io/` is a comment recording that `IO-30`'s *resolution* half was not built
(`packages/core/src/io/factories.ts:13`). There is no registry, no install precedence, no conflict
resolution — `IO-39` ships nothing.

**Why it cannot be corrected.** `SEAM-3`–`SEAM-10` exist to keep a *third-party* stream library out of a
zero-dependency core. Web Streams are a runtime built-in. A discovery mechanism needs at least two
candidate implementations to discover between; there is exactly one, and adding a second would require a
runtime dependency that `verify:seam-1` fails the build over. The machinery would be ceremony with an empty
registry behind it.

`SEAM-18`'s three bridge clauses (caller-supplied executor, async-wrapper unwrapping, interruptible blocking
wait) inherit item 1's impossibility — they presuppose the blocking transport that cannot exist. Its one
non-bridge clause survives and is enforced as an ordinary obligation on `send()`
(`packages/core/src/seams/transport.ts:49`).

---

## 3. Two retry stacks collapse into one, with the total-timeout budget explicitly opt-in

**Verified.** One engine — `runWithRetry` (`packages/core/src/retry/engine.ts:354`) — with exactly two thin
callers: the pillar step (`packages/core/src/retry/retry-step.ts:137`) and the dispatch adapter
(`packages/core/src/retry/retry-dispatch.ts:53`). `totalTimeoutMs` is `readonly totalTimeoutMs?: number |
undefined` and undefined by default (`packages/core/src/retry/settings.ts:27`), pinned by a test named for
`RETRY-28` (`packages/core/src/retry/settings.test.ts:20`).

**Why it cannot be corrected.** This is not a deviation the port chose against the spec — `RETRY-28` is the
spec instructing a unifying port to make the budget opt-in. "Correcting" it means splitting one engine into
two that differ in no observable behavior, then re-deriving `RECOV-17`–`RECOV-34` against the duplicate.
The ledger entry documents conformance, not a gap.

---

## 4. True runtime encapsulation of domain models is not fully achievable

**Verified.** Domain models use `#private` fields and a TS `private` constructor reached through the
`createX` friend hook, so `build()` cannot be bypassed for a *class* — e.g.
`packages/core/src/http/request-conditions.ts:59-76`.

**Why it cannot be corrected.** TypeScript's type system is structural and erased. Nothing at runtime
distinguishes a `Headers` instance from an object literal that satisfies the same shape, and no compiler flag
changes that. A nominal-typing emulation (a branded `#private` witness field) would only move the check to
call sites that must then be written to perform it, and would still be defeated by a cast. This is a
language-level ceiling.

> **Corrected in the ledger 2026-08-29 — the text was wrong, the deviation is not.** Item 4's stated mitigation — "exporting only
> concrete classes, never bare structural interfaces, from each package's public entry point" — is false as
> written. `packages/core/etc/core.api.md` exports **61 interfaces** against 58 classes, and at least one is
> a builder-built, validated, frozen type: `Configuration` is `export interface Configuration`
> (`packages/core/src/config/configuration.ts:72`) returned from `ConfigurationBuilder.build()`, and
> `setGlobalConfiguration()` / `resolveProxyOptions()` accept any hand-rolled object of that shape. Most
> other exported interfaces are seams (`Transport`, `Serde`, `Logger`) or options records, where structural
> typing is the point. The *deviation* is real and uncorrectable; the *mitigation sentence* overstated what
> the package actually does and has been narrowed to the `http/` wire-model types.

---

## 5. Schema-as-witness replaces reflective generic-type capture

**Verified.** `Serde` is not generic in `T` (`packages/core/src/seams/serde.ts:182`); the witness is a
decode-time parameter, `deserialize<T>(data, schema: Schema<T>, typeName?)`
(`packages/core/src/seams/serde.ts:145`). The codec-configuration knobs are absent and documented as
absent — `packages/codec-json/src/json-serde.ts:236,242` explain that `SERDE-21`/`22` have no coercion
setting because there is no coercing codec, and `SERDE-23`'s unknown-field policy belongs to the schema.
`packages/codec-json/src/conformance.test.ts:8` states outright that no code implements `SERDE-21` or
`SERDE-22`.

**Why it cannot be corrected.** `SERDE-5`–`SERDE-8` are worded around a reflectively reconstructed type
token. JVM generics erasure leaves a raw `Class` behind; TypeScript erases to nothing — there is no runtime
artifact of `T` at all to reflect over. Nor can the missing knobs be added: `JSON.parse`/`JSON.stringify`
expose no coercion, unknown-field, or date-format hooks to gate. A hand-rolled JSON parser could expose
them, at the cost of correctness, performance, and a large maintenance surface, to gate settings the schema
witness already decides more precisely.

---

## 6. Digest MD5 needs a vendored implementation; SHA-256 does not

**Verified.** `packages/core/src/auth/md5.ts` is a hand-rolled RFC 1321 implementation whose header states
the reason. SHA-256 goes through `globalThis.crypto.subtle.digest('SHA-256', bytes)`
(`packages/core/src/auth/digest.ts:103`).

**Why it cannot be corrected.** Web Crypto excludes MD5 by design, on security grounds — it is not an
oversight to work around, and no flag re-enables it. The two alternatives are both closed: an npm MD5
dependency fails `verify:seam-1`'s zero-runtime-dependency gate, and `node:crypto` would forfeit the
browser/Deno/Workers portability that motivated choosing Web Crypto in the first place. RFC 7616 still
requires MD5/MD5-sess for interop with servers that have not moved to SHA-256, so dropping it is not an
option either.

---

## 8. Cancellation is `AbortController`/`AbortSignal` end-to-end

**Verified.** `composeSignal` folds a caller signal and a timeout into one via `AbortSignal.any`
(`packages/core/src/seams/transport.ts:74`). The timeout-vs-cancellation split reads the structured
`reason.name` field, explicitly *not* `instanceof`, because `instanceof` is realm-bound
(`packages/core/src/seams/transport.ts:109`).

**Why it cannot be corrected.** `Promise` has no `cancel()`, unlike `CompletableFuture`; cancellation in
JavaScript is cooperative by construction. The `reason.name` check is not a shortcut around a class
hierarchy that could be built — `AbortSignal.timeout()` and a caller `abort()` both deliver a `DOMException`
through the same signal type, and the runtime chooses the class. There is no seam at which the port could
substitute its own.

> Minor wording nit: the ledger says "the abort reason's *constructor name*". The code reads the `name`
> **property** (`reason.name === 'TimeoutError'`), which is deliberate and stronger — a constructor-name
> check would break across realms exactly as `instanceof` does.

---

## 9. Frozen collections are computed once, not wrapped on every read

**Verified.** `Headers` freezes each value array, the lookup map, the casing map, and the insertion order
once at build time, then freezes the instance (`packages/core/src/http/headers.ts:314-319,345`).

**Why it cannot be corrected.** The reference's per-access unmodifiable wrapper exists to guard a mutable
backing collection. These models are immutable after construction, so there is no window in which a
re-wrap could observe a different value. Restoring per-access wrapping would allocate on every getter to
defend against a mutation that cannot occur. The one genuine residue is already recorded elsewhere in the
project: `Request.url` clones per access because the native `URL` really is mutable.

---

## 10. `NFR-8` (shrinker keep/retain configuration) is not applicable

**Verified.** `packages/shrink-test/` exists and targets the dual-package `instanceof` hazard
(`packages/shrink-test/src/fixture-app.ts:111`, `run-shrink-guard.test.ts:8` — both line numbers refreshed
2026-08-30 after the fixture grew a third probe). Nothing in the workspace carries a keep-rule, and there is
no reflective lookup for one to protect.

**Why it cannot be corrected.** A keep-rule names a symbol a static analyzer cannot see is reachable.
`NFR-8`'s premise is JVM reflection; JS bundlers have no equivalent blind spot, and item 2 already retired
the one discovery mechanism the port might have had. There is no symbol to keep-configure, so the
configuration file would be empty by construction. The structurally equivalent JS risk is covered instead.

**What the guard now also pins, and why it is the standing evidence for a manifest decision (added
2026-08-30).** The `[Symbol.asyncDispose]` repair replaced three class members with a **module-scope
`Object.defineProperty` statement** — a top-level side effect — in four files across three packages that all
declare `"sideEffects": false` (`packages/core/src/sse/stream.ts:209`,
`packages/core/src/pagination/page.ts:114`, `packages/transport-fetch/src/fetch-transport.ts:314`,
`packages/transport-undici/src/undici-transport.ts:566`; the manifest field at `packages/core/package.json:20`,
`packages/transport-fetch/package.json:21`, `packages/transport-undici/package.json:21`). That field entitles a
bundler to drop a module whose exports go unused, and nothing forbids a future one from also dropping a
top-level statement it judges inert — which would silently un-install disposal in the shipped artifact while
every type still checks, the same failure shape this guard already exists for. `fixture-app.ts`'s
`probeDisposalSymbol` therefore constructs a `Page` and a `FetchTransport` **inside the bundled, minified,
tree-shaken artifact** and asserts the member is present and callable; `run-shrink-guard.ts` exits non-zero on
any `false` field of `FixtureResult`, so the check is blocking.

**`sideEffects` was deliberately not narrowed** to the four file paths that carry an install. Narrowing is
more fragile, not less: the list would silently go stale on any file move or rename, and a stale narrow list
fails *open* — the bundler drops the module and nothing complains. The shrink guard tests the property that
actually matters (the install survives a real `bundle + minify + treeShaking` pass) rather than a manifest
proxy for it, and it needs no maintenance when a file moves. Budget note: the added probe took the measured
bundle from 16,671 to 17,689 bytes against a 24 KiB budget (`packages/shrink-test/shrink-test.config.ts`).

---

## 12. The redirect/auth cross-origin marker is a real header, not a `WeakSet`

**Verified.** `CROSS_ORIGIN_MARKER_HEADER` is set, cleared, and tested per hop
(`packages/core/src/redirect/cross-origin.ts:80,93,104,118`). The auth step reads it before deciding whether
to react to a challenge, not just whether to stamp (`packages/core/src/auth/auth-step.ts:387-390`). An
independent `POST_AUTH` backstop strips it even in a pipeline with no auth step
(`packages/core/src/redirect/strip-marker-step.ts`), satisfying `REDIR-11(c)`'s porter caveat.

**Why it cannot be corrected.** The reference's in-process marker was tried and withdrawn during Phase 5b's
own drafting: retry's attempt-stamping sits between redirect and auth and produces a **fresh `Request`
copy**, which a `WeakSet<Request>` keyed on object identity no longer recognizes — the marker would silently
vanish exactly on the hop that most needs it. Restoring the identity-based marker means either removing
attempt-stamping (breaking `RETRY-38`) or making `Request` mutable (breaking `HTTP-2`/`HTTP-5`).

The two interpretive questions Phase 10 settled here — `REDIR-20`'s predicate scope and Basic/Digest never
stamping preemptively — are confirmed against the code and stand as decided. Both are security-conservative
readings; reversing either would widen an attack surface for a caller convenience the spec never asked for.

---

## 13. Transport adapters have platform-shaped gaps the reference does not

**Verified.** `Protocol.HTTP_1_1` is hardcoded in both adapters
(`packages/transport-fetch/src/fetch-transport.ts:178`, `packages/transport-undici/src/undici-transport.ts:346`).
`transport-fetch` documents having no `proxy` option at all
(`packages/transport-fetch/src/fetch-transport.ts:62-65`). The proxy `challengeHandler` is surfaced with a
warning rather than dispatched (`packages/transport-undici/src/challenge-handler.ts:27,50`).

**Why it cannot be corrected.** Four of the five clauses are closed by the platform, not by choice:

- **Negotiated protocol version.** Neither `fetch`'s `Response` nor undici's `ResponseData` carries it.
  There is no API to read, so the best-effort default is the only honest answer available.
- **Zero-copy `sendfile(2)` (`TRANSPORT-28`, SHOULD).** No user-space path in either client reaches the
  syscall; a raw `node:net` transport would be a different product.
- **`TRANSPORT-8`'s native-cancel-vs-timeout distinction.** §17's own text scopes the clause to transports
  that *have* an internal cancel path. `transport-fetch` does not, so the clause does not bind it.
- **Proxy `challengeHandler` on undici.** undici's `ProxyAgent` takes its credential solely from its own
  constructor and rejects a per-request `Proxy-Authorization` with `InvalidArgumentError` — a deliberate
  security fix upstream. The constructor runs before any challenge exists, so a handler-minted credential
  can never reach the exchange that provoked it. This is unfixable without vendoring undici internals. Note
  that the Phase 8a *plan* specified a retry-with-stamped-credential flow that is simply not implementable
  on this platform; the shipped fallback (WARN at construction, WARN on first `407`, Basic via
  `ProxyOptions.credentials`, `407` returned untouched) is the correct disposition.

The fifth clause, `transport-fetch` shipping no proxy support (`TRANSPORT-30`), is a **deliberate scope
boundary rather than an impossibility** — it is achievable, at the cost of depending on `undici` internals,
which would defeat the package's zero-dependency purpose. `@dexpace/transport-undici` is the supported
answer for callers who need proxying. Recorded here for completeness, not as a platform limit.

---

## 14. `NFR-16` — publish provenance

**Verified.** `prepublishOnly` is wired in all nine publishable packages (e.g.
`packages/core/package.json:29`). There is **no** release workflow — `.github/workflows/` contains `ci.yml`
only — and the string `provenance` appears in no `package.json`, no workflow, and no `.npmrc` (there is no
`.npmrc`).

**Why it cannot be corrected here.** `NFR-16`'s conformance test is behavioral: "a CI/release build fails an
unsigned publication; a local build without keys still publishes unsigned." Satisfying it requires a real
`npm publish --provenance` against a real registry with a real OIDC token. Nothing in this repository can
produce that evidence; it unblocks at first release and not before.

> **Corrected in the ledger 2026-08-29.** Item 14 claimed `prepublishOnly` *and* `npm publish --provenance`
> "are scripted (Phase 0 Task 3)". Only the first is. `docs/open-items.md`'s Section D row
> "Publish + provenance CI job" ([`#d-nfr-16-provenance`](./open-items.md#d-nfr-16-provenance)) already recorded this
> accurately ("`prepublishOnly` wired; nothing published yet"); §10 did not, and now does.
>
> **Still actionable, and not done here:** authoring the release workflow with `--provenance` and
> `id-token: write` is doable today — it is only *exercising* it that needs a registry. That is the one
> remaining piece of work this audit identified and deliberately did not perform, because a release workflow
> is an outward-facing artifact whose shape (trigger, environment, tag convention, who may publish) is a
> project decision rather than a defect repair.
>
> **`NFR-12` was split out of this row and closed on evidence** — 644 emitted files and 9 `npm pack` tarballs
> byte-identical across two clean builds, and a new blocking CI gate
> (`scripts/verify-reproducible-build.mjs`). It is no longer part of this file's scope. *Widened 2026-08-30:
> at audit time the tarball evidence was a by-hand `npm pack` of `@dexpace/core` alone, asserted rather than
> gated. Both legs now run inside the gate — `digestTarballs()` packs every non-`private` package on each of
> the two builds and diffs the SHA-256 maps — so the claim above is verified on every CI run rather than on
> the day it was written.*

---

## 15. A server-issued ETag containing obs-text does not round-trip

**Verified.** `RequestConditions.applyTo` writes every entity tag through the outbound `Headers` builder's
`set` (`packages/core/src/http/request-conditions.ts:129-142`), which enforces `HTTP-18`'s HTAB + printable
ASCII 0x20–0x7E rule (`packages/core/src/http/ascii-validation.ts:16`). The inbound path is separately laxer
and permits obs-text, exactly as `HTTP-19` requires
(`packages/core/src/http/ascii-validation.ts:41`, `packages/core/src/http/headers.ts:246,262`).

**Why it should not be corrected.** This one is *technically* correctable — a relaxed emit path for replayed
ETags could be added — and the decision is that it must not be. `HTTP-18` is **MUST**-level and its rationale
is header-injection safety, reinforced by `XCUT-18`, which the product spec treats as a universal invariant
that binds "even if each subsystem individually appears to work." `HTTP-48`'s obs-text permission is
**SHOULD**-level RFC conformance for a rare case, mostly legacy servers. A SHOULD-level nicety does not
outrank a MUST-level cross-cutting security invariant, and adding the relaxed path would create precisely
the two-emit-paths condition that makes splitting defenses fail in practice. Permanent by decision.

---

## 16. Async-runtime adapter fragmentation does not exist

**Verified.** `packages/rx/` is the only adapter, and its `sseEvents$`/`typedSse$` are documented as
single-subscription because `SseStream` wraps an already-consumed-once response body
(`packages/rx/src/sse.ts:17,41`). No coroutine, reactor, netty, or virtual-thread equivalents exist.

**Why it cannot be corrected.** The reference's adapter set exists because the JVM has several competing
async ecosystems the SDK must pivot between. Node has one: `Promise`. There is no second ecosystem to bridge
to, so the adapters have no counterpart to be written against. `@dexpace/rx` is sugar over a genuinely
different *data shape* (push-based `Observable`), not the same plumbing under another name — and its
single-subscription behavior is forced by HTTP itself, since a consumed response body cannot be re-read.

---

## 17. `TransportFailureError` adds a third level to a two-level error tree

**Verified.** `IoError extends DexpaceError` (`packages/core/src/io/errors.ts:13`); the four I/O leaves —
`EndOfStreamError`, `SourceContractViolationError`, `ClosedResourceError`, `AllocationLimitError` — each
extend `DexpaceError` **directly** (lines 29, 49, 65, 80) and are grouped by the `isIoError` predicate
(line 102) rather than by a middle tier. `TransportFailureError extends IoError` (line 126) is the single
three-level branch.

**Why it cannot be corrected.** `TRANSPORT-20` requires `TransportFailureError` to *be* an `IoError` — the
subtyping is the requirement, not an artifact of modelling. It is also load-bearing: `classify.ts`'s
cause-walk returns retryable for any `IoError`, so the `extends` is what makes a no-response transport
failure retryable with zero edits to the retry layer. A flat sibling would have to be enumerated by hand in
the retry classifier, and again for every transport added later — trading one level of depth for an
open-ended maintenance obligation that the styleguide's own rule exists to prevent. Held at exactly three;
a fourth level is not sanctioned by this entry.

## Deviations recorded outside a phase

Empty as of 2026-08-31.

A row here has no owning phase — it was found by a review, an audit, or a maintenance pass over shipped code.
It is recorded on the day it is found rather than waiting for `docs/sdk-design-nodejs/10-…`, which is in a
frozen tree and is amended only deliberately, by hand. When §10 is next amended, a row here becomes a numbered
§10 item and moves into the audit above under that number.

| Deviation | Found by | Date | Evidence | §10 status |
|---|---|---|---|---|
| — | — | — | — | — |
