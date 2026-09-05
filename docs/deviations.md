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
   is deliberately amended. **That section is no longer empty, and the paragraph that once said it was is
   this one.** The 2026-08-31 restructure swept the non-frozen tree and found no unrecorded deviation there,
   only three unrecorded *deferrals* (the dissolved register's U2) and six mis-numbered register citations
   (the dissolved register's U6) — a clean result, and one that held only because that sweep read the
   *registers*. The 2026-09-02 register audit and the 2026-09-04 code audit
   ([#67](https://github.com/dexpace/nodejs-sdk/issues/67)) both read something else and both filled the
   section: the second went through the shipped **code** and found MUST-level narrowings and undecided
   readings that lived only in a phase spec, only in a test comment, or nowhere at all. Read the table below
   for what is in it — this paragraph deliberately does not count the rows, because a stated count is the
   one thing in a collection point that goes wrong on the next append.

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
  the drift — registered as the dissolved register's U4.
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
(`packages/core/src/context/context.ts:112`, defaulted per flavor at `:128` and `:149`). `Next` is
`(request?) => Promise<Response>` with no sync twin (`packages/core/src/pipeline/step.ts:23`).
`wrapCancellation` degenerates to `failure(error)` and says so
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

**Verified.** One engine — `runWithRetry` (`packages/core/src/retry/engine.ts:367`) — with exactly two thin
callers: the pillar step (`packages/core/src/retry/retry-step.ts:151`) and the dispatch adapter
(`packages/core/src/retry/retry-dispatch.ts:85`). `totalTimeoutMs` is `readonly totalTimeoutMs?: number |
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
> written. `packages/core/etc/core.api.md` exports interfaces and classes in comparable numbers, and at least
> one interface is a builder-built, validated, frozen type: `Configuration` is `export interface Configuration`
> (`packages/core/src/config/configuration.ts:100`) returned from `ConfigurationBuilder.build()`, and
> `setGlobalConfiguration()` / `resolveProxyOptions()` accept any hand-rolled object of that shape. Most
> other exported interfaces are seams (`Transport`, `Serde`, `Logger`) or options records, where structural
> typing is the point. The *deviation* is real and uncorrectable; the *mitigation sentence* overstated what
> the package actually does and has been narrowed to the `http/` wire-model types.

---

## 5. Schema-as-witness replaces reflective generic-type capture

**Verified.** `Serde` is not generic in `T` (`packages/core/src/seams/serde.ts:241`); the witness is a
decode-time parameter, `deserialize<T>(data: Uint8Array, target: DecodeTarget<T>): T`
(`packages/core/src/seams/serde.ts:194`, and `deserializeFrom<T>` at `:221` takes the same target),
where `DecodeTarget<T>` bundles the `Schema<T>` witness with its optional diagnostic label
(`:122-124`). The witness moved into that object on 2026-09-04 — the SPI took it positionally as
`(data, schema, typeName?)` until then, which is the signature this row quoted; the deviation is
unchanged by the reshaping, since a schema *value* is still what stands in for a reflected type token.
The codec-configuration knobs are absent and documented as absent —
`packages/codec-json/src/json-serde.ts:244,250` explain that `SERDE-23`'s unknown-field policy belongs
to the schema and that `SERDE-21`/`22` have no coercion setting because there is no coercing codec.
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
`packages/transport-undici/src/undici-transport.ts:566`; the manifest field at `packages/core/package.json:25`,
`packages/transport-fetch/package.json:26`, `packages/transport-undici/package.json:26`). That field entitles a
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
(`packages/core/src/redirect/cross-origin.ts:80,93,104,118`). The auth step reads it once on the outbound
pass (`packages/core/src/auth/auth-step.ts:395`) and gates both branches on the answer — preemptive stamping
at `:401`, and whether to react to a challenge at all at `:786`, not merely whether to stamp. The answer
rides across the dispatch on `OutboundPlan.crossOrigin` (`:375`, and `:370-372` for why), because the marker
itself is cleared from the request before it reaches the wire. An independent `POST_AUTH` backstop strips it
even in a pipeline with no auth step (`packages/core/src/redirect/strip-marker-step.ts`), satisfying
`REDIR-11(c)`'s porter caveat.

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
`packages/core/package.json`). ~~There is **no** release workflow — `.github/workflows/` contains `ci.yml`
only — and the string `provenance` appears in no `package.json`, no workflow, and no `.npmrc` (there is no
`.npmrc`).~~

**Superseded 2026-09-02.** `.github/workflows/release.yml` now exists: it triggers on a push to
`main`, runs `changesets/action@v1`, declares `id-token: write`, and sets
`NPM_CONFIG_PROVENANCE: 'true'`. So `provenance` is now scripted, and the "no release workflow"
statement above is false. There is still no `.npmrc`, which is correct — `changesets/action` writes
one from `NPM_TOKEN` at run time.

**Why it cannot be corrected here.** `NFR-16`'s conformance test is behavioral: "a CI/release build fails an
unsigned publication; a local build without keys still publishes unsigned." Satisfying it requires a real
`npm publish --provenance` against a real registry with a real OIDC token. Nothing in this repository can
produce that evidence; it unblocks at first release and not before.

> **Corrected in the ledger 2026-08-29.** Item 14 claimed `prepublishOnly` *and* `npm publish --provenance`
> "are scripted (Phase 0 Task 3)". Only the first is. `docs/work/mvp/2026-09-04-open-items-dissolution.md`'s Section D row
> "Publish + provenance CI job" ([`#d-nfr-16-provenance`](./work/mvp/2026-09-04-open-items-dissolution.md#d-nfr-16-provenance)) already recorded this
> accurately ("`prepublishOnly` wired; nothing published yet"); §10 did not, and now does.
>
> ~~**Still actionable, and not done here:** authoring the release workflow with `--provenance` and
> `id-token: write` is doable today — it is only *exercising* it that needs a registry. That is the one
> remaining piece of work this audit identified and deliberately did not perform, because a release workflow
> is an outward-facing artifact whose shape (trigger, environment, tag convention, who may publish) is a
> project decision rather than a defect repair.~~
>
> **Done 2026-09-02.** `.github/workflows/release.yml` is authored. It is **inert until an `NPM_TOKEN`
> repository secret exists** — without one `changesets/action` cannot authenticate, so it maintains
> the "Version Packages" pull request and publishes nothing. Two prerequisites that blocked the first
> real publish are now one:
>
> - **Fixed 2026-09-02** — no manifest carried a `repository` field, which npm requires before it
>   will accept `--provenance`. All nine publishable manifests now carry one; the two private
>   packages deliberately do not.
> - **Still open, and a maintainer call** — `.changeset/config.json` sets `"access": "restricted"`,
>   which conflicts with provenance: attestations go to a public transparency log and require a
>   public package. Publishing privately and publishing with provenance cannot both be true.
>
> The *behavioural* half of `NFR-16` is unchanged and still uncorrectable here, for the reason stated
> above: it needs a real registry and a real OIDC token.
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
`set` (`packages/core/src/http/request-conditions.ts:133-146`), which enforces `HTTP-18`'s HTAB + printable
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
extend `DexpaceError` **directly** (lines 29, 51, 67, 83) and are grouped by the `isIoError` predicate
(line 108) rather than by a middle tier. `TransportFailureError extends IoError` (line 132) is the single
three-level branch.

**Why it cannot be corrected.** `TRANSPORT-20` requires `TransportFailureError` to *be* an `IoError` — the
subtyping is the requirement, not an artifact of modelling. It is also load-bearing: `classify.ts`'s
cause-walk tests `current instanceof IoError` (`packages/core/src/retry/classify.ts:73`), so the `extends`
is what makes a no-response transport failure retryable with zero edits to the retry layer. A flat sibling
would have to be enumerated by hand in the retry classifier, and again for every transport added later —
trading one level of depth for an open-ended maintenance obligation that the styleguide's own rule exists
to prevent. Held at exactly three; a fourth level is not sanctioned by this entry.

> **Anchor correction 2026-09-04 (audit #67 / #68); the rule itself is not decided here.** The line
> numbers above were stale and are re-derived. The substantive point this paragraph used to make — "the
> cause-walk returns retryable for any `IoError`" — reads as covering all five I/O classes, and it does
> not: because the tree is flat, `instanceof IoError` at `classify.ts:73` matches `IoError` itself and
> `TransportFailureError` only. `EndOfStreamError`, `SourceContractViolationError`,
> `ClosedResourceError` and `AllocationLimitError` are **not** retryable through that branch. Whether
> they should be — and therefore whether the classifier tests `instanceof IoError` or the `isIoError`
> predicate — is decided by audit subtask #78, and this row's rationale is rewritten there. Nothing in
> the deviation itself (the three-level branch, and why it stays) turns on that answer.

## Deviations recorded outside a phase

Every row here was found by a pass over shipped code rather than produced by a phase. The
`docs/work/mvp/2026-09-04-open-items-dissolution.md` register audit (that file's Section V) opened the
section on 2026-09-02; later reviews and audits append to it. Deliberately uncounted — a stated total is a
number that goes wrong on the next append, which is that file's U10.

A row here has no owning phase — it was found by a review, an audit, or a maintenance pass over shipped code.
It is recorded on the day it is found rather than waiting for `docs/sdk-design-nodejs/10-…`, which is in a
frozen tree and is amended only deliberately, by hand. When §10 is next amended, a row here becomes a numbered
§10 item and moves into the audit above under that number.

| Deviation | Found by | Date | Evidence | §10 status |
|---|---|---|---|---|
| **`HTTP-11`'s range classifications are on `Status` only, not mirrored onto `Response`.** The spec places them on both: `docs/product-spec/04-core-http-domain-model.md:23` reads "Status MUST classify by range … **and a response MUST expose these derived from its status**", and appendix C (`appendix-c-consolidated-normative-requirement-index.md:47`) restates it as "Response MUST expose these same classifications derived from its status." The port ships them once, on `Status`, reachable as `response.status.isSuccess`. Six delegating getters on `Response` would duplicate surface that cannot drift, since there would be one implementation behind both — but the letter of the requirement does name the response, so the reading is recorded rather than assumed | the dissolved register's A3, register audit | 2026-09-02 | `packages/core/src/http/status.ts` carries all six; `packages/core/src/http/response.ts` carries `status` and no classification of its own | not yet in §10 |
| **`REDIR-20`'s "fully override" is read as scoped to code/method eligibility, not to the safety mechanics that follow it.** A configured redirect predicate replaces the built-in follow decision; it does **not** bypass userinfo stripping, credential hygiene, the downgrade guard, body replayability, or loop/cap detection. Those are stated as unconditional MUSTs elsewhere in the same chapter and are not "should this kind of redirect be followed" policy — a caller predicate opting to follow a 307 with a single-use body still cannot make that body re-sendable. Genuinely ambiguous wording, decided one way and now recorded as decided | the dissolved register's G4, register audit | 2026-09-02 | `packages/core/src/redirect/decide.ts` consults `settings.predicate` at the eligibility gate and runs every later guard unconditionally; pinned by "the predicate does NOT bypass the safety mechanics" in `decide.test.ts`. Phase 9's conformance sweep was to re-confirm this and closed without doing so | not yet in §10 |
| **`OBS-29` is carried by spans rather than by the named tracer callbacks; both halves are now met, and the operation span is reachable from the public API.** `OBS-29` (MUST) requires `operationStarted` once at the start, `operationSucceeded`/`operationFailed` mutually exclusive and once each at the end, and **one tracer instance per logical operation**. The port has no method of those names; it has `Tracer.startSpan(name): Span`, and the requirement is discharged under that vocabulary. **Ordering:** `Runtime.send` opens one span before the drive and ends it exactly once, behind an `ended` latch that a throwing `end()` cannot get past (`pipeline/runtime.ts:78-96`), and the per-attempt spans the LOGGING pillar step opens follow the same shape from a single `finally` (`observability/logging-step.ts:469`, then `:457,494`). **1:1 binding:** the span is opened outside every pillar, so a retry's second attempt and a redirect's second hop stay inside the first call's span (`pipeline/runtime.ts:57-67,280-282`); before 2026-09-05 a leaked `enterWith` made the *previous* call's ended span read as active and suppressed the next one, so only the first operation per async context got a span at all — the binding was stated and not delivered. **Caller reachability**, which this row carried as the open half from 2026-09-02 to 2026-09-05, is closed: `PipelineOptions` (`pipeline/builder.ts:32-50`) is `@public`, is the second constructor argument of `PipelineBuilder` (`:71`) and is extended by `StandardResilienceOptions` (`auth/preset.ts:23,115-118`), so `createInstrumentationBundle`'s result has somewhere public to go. What remains a deviation is only the **vocabulary**: a consumer sees `startSpan`/`end`/`recordException`, not `operationStarted`/`operationSucceeded`/`operationFailed`, and appendix C's own note that "pipeline/transport wiring to emit it is a follow-up, so it is not yet runtime-enforced" (`appendix-c-consolidated-normative-requirement-index.md:509`) is now out of date for this port | the dissolved register's L1/V2, register audit; anchors re-derived by audit #67 / #68; finished by audit #67 / #80 | 2026-09-02, re-anchored 2026-09-04, closed 2026-09-05 | `packages/core/src/observability/span.ts:54-56` (`Tracer`, one method — declared in `tracing.ts` until 2026-09-04, when audit #67 / #69 moved the inert tracing declarations into their own module to break an import cycle; `tracing.ts` re-exports them, so the public path is unchanged); `packages/core/src/pipeline/runtime.ts:57-67,78-96,206-233,280-282` (the operation span, its single `end()`, and the `run`-scoped stores that keep the binding true across calls); `packages/core/src/pipeline/builder.ts:32-50,71,293` and `packages/core/src/auth/preset.ts:23,115-118` (the public route to a bundle); `observability/logging-step.ts:457,469,494` (the per-attempt span); `docs/product-spec/15-instrumentation-and-observability.md:54` (the requirement) | not yet in §10 |
| **`invariant()` density is not a target, project-wide.** `docs/knowledge/harvested/assertions.md:6-7` sets a 2-per-function module average. The port's position: a module gains an `invariant()` when it has an internal precondition worth asserting, and `recovery/`, `http/`, `seams/` and `generated/` have none — measured 2026-09-02, all four at zero. Adding assertions to reach an average would assert nothing. `recovery/` is the sharp case: an `invariant()` inside `ResponseRecoveryChain.apply()` throws, and `RECOV-8` forbids `apply()` from throwing, so a density rule would push that module toward a shape the specification forbids | the dissolved register's F3/H6 and the deferral register's *Assertion-density rule applied project-wide* row (retired to [the purge note](./work/mvp/2026-09-04-register-retirement-purge.md)), register audit | 2026-09-02 | `packages/core/src/recovery/`, `http/`, `seams/`: zero `invariant(` calls. `pipeline/` and `context/` both carry them, so the rule is applied where it earns its place. Counted qualitatively on purpose — the two figures this cell used to state were wrong by the time anyone read them; re-derive with `grep -rn 'invariant(' packages/core/src/<dir> --include='*.ts' \| grep -v '\.test\.'` | not yet in §10 |
| **`PIPE-40` and `REDIR-22` contradict each other on the non-replayable-body path, and the port implements `REDIR-22`.** Two MUSTs name the same trigger and prescribe opposite dispositions. `docs/product-spec/08-execution-pipelines.md:20` (`PIPE-40`): "on paths that abandon a re-drive (redirect cycle, **non-replayable body**, budget exhausted) the in-flight response MUST be returned unclosed." `docs/product-spec/10-redirect-handling.md:22` (`REDIR-22`): "if building the follow-up throws (**non-replayable body**, downgrade rejection) the current response MUST be closed before the error propagates." The port closes, then throws, on three grounds: `REDIR-6` independently fixes the control flow ("the operation MUST fail with a clear error naming replayability"), so the path throws and a response never *returned* cannot be "returned unclosed"; specific governs general, since §10 of the spec owns the redirect step's lifecycle; and closing is the safer reading, because the alternative leaks a body on an error path with no caller holding a reference to close it. `PIPE-40`'s other two named paths do genuinely return, and both return unclosed as it requires. **The erratum this needs is proposed below and is not applied here**, because `docs/product-spec/` is frozen and correcting a normative sentence is the specification owner's act, not a maintenance one | the dissolved register's G1, Phase 5b design's Deviation Ledger | 2026-09-04 | `packages/core/src/redirect/redirect-step.ts` closes before throwing, with the reasoning asserted inline in `redirect-step.test.ts`; nothing in the code waits on the erratum | not yet in §10 |
| **`PIPE-37`'s outermost pre-redirect status-mapping step was never built, and until this row nothing recorded that.** `PIPE-37` (MUST) requires a step whose correctness depends on the single terminal response — status-to-typed-error mapping is its own worked example — to occupy the outermost pre-redirect slot, so it runs outside both the redirect and the retry loop. The port ships the *mapping*, but as `statusMappingStep`, a `ResponseStep` on the response-recovery chain (RECOV-15/RECOV-16), not as a pipeline `Step` carrying `stage: 'PRE_REDIRECT'`. The slot itself exists and is installable — `config/clientIdentityStep` occupies it today — so this is a wiring gap, not a missing mechanism. It has an owner in writing and the owner never took it: Phase 4's checklist marked the row ⏳ and said "the obligation lands on whichever phase wires 4b's `statusMappingStep` into a real pipeline — **Phase 5**", and Phase 5 shipped without it, with no deferral carrying the hand-off forward. That is why a code audit found it and no checklist did. **Ledgered rather than implemented.** Installing a `PRE_REDIRECT` mapping step is public pipeline surface with a real behaviour change behind it, and the petstore spike arrives at the same work from the other side: its finding 2 wants a declarative `StatusErrorMap` applied *at* the `toHttpError` call site rather than wrapped around it, so a mapped error class can see a decoded payload instead of raw bytes. Whoever does one does both | audit #67 / #69 | 2026-09-04 | `packages/core/src/recovery/status-mapping.ts:26` (`statusMappingStep(response: Response): Promise<Response>` — a `ResponseStep`, with no `StepDescriptor` and no stage); `packages/core/src/pipeline/stage.ts:39` (`PRE_REDIRECT` heads `STAGE_ORDER`) and `packages/core/src/config/client-identity-step.ts:124` (the one shipped step that occupies it); `docs/work/mvp/phase4/2026-07-26-phase4-execution-context-and-pipelines-checklist.md:141` (the dropped hand-off); `docs/product-spec/08-execution-pipelines.md:26` (PIPE-37 shares that line with PIPE-25/36/38); `examples/petstore/FINDINGS.md:96-97` | not yet in §10 |
| **`REDIR-3`'s eligibility test reads the CURRENT hop's method, where the spec says the ORIGINAL request's.** `isEligibleByCode` is handed `currentRequest.method`, the method of the request being redirected at this hop. The two readings agree on every chain but one: an opted-in 303 rewrites POST to GET (REDIR-5), and a 301 or 302 arriving on that rewritten hop is then followed under the default {GET, HEAD} set, where the literal reading would refuse it because the request that started the chain was a POST. **Kept, deliberately.** The rewritten GET is idempotent and carries no body — REDIR-5 dropped it — so the literal reading buys no wire safety here, only a refusal; and refusing would make `allow303` half-useful, opting into the rewrite but not into anything the rewritten request can reach. Every other guard on the hop is unaffected, since eligibility is step 3 of eight and the userinfo strip, downgrade guard, replayability gate, loop detection and hop cap all run after it regardless. Switching to the literal reading stays a narrow, mechanical change — thread the seed request's method through `RedirectContext` — if a later reading of §10 wants it | audit #67 / #69 | 2026-09-04 | `packages/core/src/redirect/decide.ts:241` passes `currentRequest.method` into `packages/core/src/redirect/codes.ts:69`'s `eligibility.allowedMethods.has(method)`; `docs/product-spec/10-redirect-handling.md:8` is the "ORIGINAL request method" wording. Pinned by "a 303-rewritten GET makes a following 301 eligible under the default method set" in `packages/core/src/redirect/decide.test.ts`, which goes red the moment the reference point moves | not yet in §10 |
| **`PAGE-19`'s own conformance fixture `<not a url>; rel=next` does not end the stream on this platform — it is followed.** The requirement's normative sentence is "a target that cannot resolve into a valid URL MUST be treated as end-of-stream", and its illustrative conformance note offers `<not a url>` as an instance. Under WHATWG `URL` — the resolver `strategies.ts` uses, and the only RFC 3986 resolver available without a runtime dependency (SEAM-1) — a supplied base makes that string a perfectly ordinary relative *path* reference: it resolves to `/repo/not%20a%20url`. It resolves, so the port follows it. **The normative half is satisfied exactly as written**: a target that genuinely fails `new URL(target, base)` returns the page with no next request and throws nothing. Only the fixture disagrees, and it disagrees because it was written against a resolver that rejects a space. **Rejected:** an ad-hoc "looks unparseable" heuristic in front of the resolver, which would have to guess at strings RFC 3986 defines, and would make the followable-relative-reference clause of the same requirement wrong instead | audit #67 / #69 | 2026-09-04 | `packages/core/src/pagination/strategies.ts:115-120` (the `new URL(target, response.request.url)` resolve, with the `catch` returning `pageInfo(items)`); `docs/product-spec/12-pagination.md:52` is the conformance note. Both halves pinned in `packages/core/src/pagination/strategies.test.ts` — "the spec's `<not a url>` fixture is a RELATIVE reference, so it is followed" and "an unresolvable target ends the stream rather than throwing" | not yet in §10 |
| **`Request.equals` compares the body by reference identity, where `HTTP-46` says by value.** `HTTP-46` requires equality to compare "method, headers, and body by value", with only the URL singled out for textual comparison. The port compares method, `url.href` and headers by value as required, and the body with `===`. **Why it stays.** `Body` is a lifecycle object, not a value: a `StreamBody` is single-use (BODY-9) and reading its bytes to compare them consumes it, which would make `equals` destructive — an equality operator that empties its operands is worse than one that under-reports. The variants that *could* compare cheaply (`ByteArrayBody`, `StringBody`) would give a comparison whose cost and semantics depend on which variant a caller happened to build, which is the drift `HTTP-1`'s value-model rules exist to prevent. Reference identity is sound in the safe direction — it never reports two different bodies equal — and it is what `Request.equals`'s own TSDoc has always said it does. Archived as blocked in the dissolution record and in neither §10 nor the register; recorded here so it is somewhere a reader will look | audit #67 / #69 | 2026-09-04 | `packages/core/src/http/request.ts:137` (`this.#body === other.#body`, beside the by-value method, `url.href` and `headers.equals` comparisons on 134-136); `docs/product-spec/appendix-c-consolidated-normative-requirement-index.md:82` | not yet in §10 |
| **`IO-13`'s "symmetric write-side encodings" ship for UTF-8 and ISO-8859-1 only; every other charset throws on write.** The read side stays fully general through `TextDecoder`. The write side does not, because `TextEncoder` is UTF-8-only — there is no `TextEncoder('iso-8859-1')` — and SEAM-1 forbids adding an encoding library to `@dexpace/core`. ISO-8859-1 is therefore hand-rolled as the direct code-point-to-byte map, which is also what lets the decode side round-trip it: WHATWG maps the label `iso-8859-1` onto windows-1252, so delegating would break the symmetry `IO-13` is about. Any other label raises `IoError` naming the charset rather than silently re-encoding as UTF-8 and corrupting the bytes on the wire. `IO-13`'s own conformance note names ISO-8859-1 as the non-UTF-8 case, so the two shipped encodings are the two the requirement exercises. **Recorded in the Phase 3a design's ledger since 2026-07-24 and nowhere else** — it never reached §10 or this file, which is the gap this row closes | audit #67 / #69 | 2026-09-04 | `packages/core/src/io/text-codec.ts:32-51` (`encodeText`, and the `unsupported write charset` throw at :36-39); `docs/work/mvp/phase3/phase3a/2026-07-24-phase3a-io-contracts-design.md:406` | not yet in §10 |
| **`BODY-9`'s mark/reset replay path for a stream-backed body is not built: `StreamBody` is always single-use.** `BODY-9` is a SHOULD, and it is conditional — replayable "when and only when the stream supports mark/reset". Node's `ReadableStream` has no generic mark/reset to support, so the condition is never met and the SHOULD's own fallback ("otherwise it MUST be single-use") is the branch that applies. `StreamBody.replayable` is a hardcoded `false`, which every consumer already reads: `decide.ts` fails a non-303 redirect carrying one (REDIR-6), and the retry pillar refuses to re-send it. A caller who wants replay materializes first or uses `byteArrayBody`. **Recorded in the Phase 3b design's ledger since 2026-07-25 and nowhere else** | audit #67 / #69 | 2026-09-04 | `packages/core/src/body/stream-body.ts:24` (`readonly replayable = false`); `docs/work/mvp/phase3/phase3b/2026-07-25-phase3b-body-lifecycle-design.md:441` | not yet in §10 |
| **`BODY-34`'s one shared preview cap covers the two logging tees only, not `toHttpError`'s error-body capture.** Read literally as "every in-memory capture in the package", `BODY-34` would put the request-side tee, the response-side drain and `toHttpError`'s error buffer behind one configurable value. They cannot share one: `HTTP-52` **fixes** the error-body cap at 1 MiB, and a spec-fixed constant cannot also be the configurable shared setting. The two capture sites `BODY-34` actually names — the request-side tee-capture and the response-side drain-on-first-access — do share one cap, so the requirement's own enumeration is satisfied; only the wider reading is not. `http-status-error.ts` states the split at the constant rather than leaving it to be inferred. **Recorded in the Phase 3b design's ledger since 2026-07-25 and nowhere else** | audit #67 / #69 | 2026-09-04 | `packages/core/src/body/http-status-error.ts:17-19` (`ERROR_BODY_CAP_BYTES`, with the "Deliberately NOT BODY-34's shared preview cap" note); `packages/core/src/body/response-body-logging.ts:47` and `packages/core/src/body/response-body-logging.ts:105-115` (the shared `cap` and the bounded drain that honours it); `docs/work/mvp/phase3/phase3b/2026-07-25-phase3b-body-lifecycle-design.md:447` | not yet in §10 |
| **`IO-38`'s cross-thread close visibility has no subject on this platform and is recorded as not applicable, not as satisfied.** The requirement presupposes that a source or buffer instance can reach a second thread, so that closing it there invalidates a slice being read here. None can. Class instances are not structured-cloneable at all — `postMessage`/`structuredClone` preserve neither prototypes nor `#private` fields, so a `ByteQueue` or `BufferedSource` sent to a worker arrives as a plain object with no methods and no close state to observe. `BufferedSource` is doubly excluded: it holds a `ReadableStreamDefaultReader`, which is neither cloneable nor transferable. A raw `ArrayBuffer` *can* be transferred, but it carries no close state and derives no slices, so the hazard has no subject there either. This row exists because "not applicable" and "done" look identical in a checklist and are not the same claim. **Recorded in the Phase 3a design's ledger since 2026-07-24 and nowhere else** | audit #67 / #69 | 2026-09-04 | `docs/work/mvp/phase3/phase3a/2026-07-24-phase3a-io-contracts-design.md:401`; `packages/core/src/io/buffered-source.ts:47` (the reader it holds); no `worker_threads`, `postMessage` or `structuredClone` call exists anywhere in `packages/core/src/` | not yet in §10 |
| **The two shipped transports disagree on `HTTP-6`'s optional reason phrase: `transport-fetch` sets it, `transport-undici` leaves it `undefined`.** `HTTP-6` (MUST) has a response carry "an optional reason phrase", and the domain model provides the slot. `fetch-transport` fills it from the WHATWG `Response.statusText`, normalizing the empty string to `undefined`. `undici-transport` does not call `.reasonPhrase()` at all, because undici's `ResponseData` carries `statusCode` and no phrase — HTTP/2 has no reason phrase and undici's parser does not surface HTTP/1.1's. **Platform-shaped, and it sits beside §10 item 13's `Protocol.HTTP_1_1` gap rather than under it.** Item 13 already ledgers the negotiated-version gap in both adapters for the same reason — the value is not readable — but it does not name the reason phrase, so this row does. The field is optional in the requirement, and no shipped step or conformance row reads it, so the disagreement is observable to a caller and to nothing else. Recorded rather than papered over: synthesizing a phrase from the status code in the undici adapter would report a value the server never sent | audit #67 / #69 | 2026-09-04 | `packages/transport-fetch/src/fetch-transport.ts:180` (`.reasonPhrase(...)` fed from the WHATWG `statusText`, with the empty string normalized to `undefined`) against `packages/transport-undici/src/undici-transport.ts:342-350` (the builder chain, with no `.reasonPhrase` call); `docs/product-spec/04-core-http-domain-model.md:13`; the neighbouring gap is item 13 of the audit above | not yet in §10 |
| **`AUTH-8`'s redaction clause is read as covering EVERY credential type, not the three it enumerates.** The requirement's own list is "API key, name-key secret, bearer token", and it was implemented to the letter: `ApiKeyCredential`, `NameKeyCredential` and `BearerToken` shipped as classes with a `#private` secret, a redacted `toString()` and the `nodejs.util.inspect.custom` hook, while the Basic and Digest credentials shipped as structural interfaces with a public `readonly password: string`. That is a leak the same requirement's first four words forbid: `util.inspect` of an `AuthCredentialSet` printed `password: 'hunter2'` beside `ApiKeyCredential{key=***}`, and `JSON.stringify` serialized both passwords. **Widened, deliberately.** Both are now classes on the same pattern, with the password reachable only through the in-package `credentialPassword()` friend hook. The cost is a public-shape change — `{username, password}` object literals no longer type-check — taken now because it is free before the first version bump. Validation is deliberately NOT duplicated onto the classes: AUTH-14's non-empty-whitespace-permitted rule and AUTH-16's acceptable-set rule stay single-sourced in `basicHandler()`/`digestHandler()`, which `authStep()` builds at construction, so a blank password still fails synchronously from that factory | audit #67 / #71 | 2026-09-04 | `docs/product-spec/11-authentication.md:12` is AUTH-8's three-type enumeration. `packages/core/src/auth/credential.ts:342` (`BasicCredential`) and `:393` (`DigestCredential`), with the friend hooks at `:299-300` and `credentialPassword()` at `:314`; the sole reader is `buildHandlers` in `packages/core/src/auth/auth-step.ts:131-152`. Pinned by "a whole AuthCredentialSet is diagnostic-safe (AUTH-8)" in `packages/core/src/auth/credential.test.ts`, which drives the real `util.inspect` rather than the hook it calls | not yet in §10 |
| **`XCUT-16`'s replay guard is keyed on whether the hop was guarded, not on whether the replacement looks credentialed.** `XCUT-16` and `AUTH-28` say the guard applies "on any path where a credential will be attached", and carve out "a deliberately credential-free re-issue MAY proceed over any scheme". Deciding which of the two a challenge replacement is cannot be done by reading header names: the step's own `ApiKeyCredentialConfig.headerName` stamps whatever header the caller names, and a `challengeHook` may invent a carrier this step has never been told about. The port therefore reads "a credential will be attached" as a property of the HOP — if the outbound pass ran the HTTPS guard, so does the replay, whatever URL and headers the hook chose. **Strictly wider than the requirement's letter**, and knowingly so: it refuses a downgraded replacement that carries no credential at all, on a hop that is credentialed. The carve-out is preserved where it is observable — a `NO_AUTH` hop is never guarded outbound, and its replay is guarded only when the replacement carries `Authorization` or `Proxy-Authorization`, which is the previous rule kept as a second arm. *Rejected:* deriving the credential-carrying header names from configuration, which misses the hook-invented carrier and is the shape that let the reported leak through | audit #67 / #71 | 2026-09-04 | `docs/product-spec/19-cross-cutting-invariants-and-policies.md:44` is the requirement and its carve-out. `packages/core/src/auth/auth-step.ts:389` sets `OutboundPlan.guarded`; `:564-575` is `guardReplayScheme` and its two arms. Pinned by "a replacement carrying a NON-standard credential header over plaintext is refused" and "a header-free replacement over plaintext is refused too" in `packages/core/src/auth/auth-step.test.ts`, and by the "XCUT-16: a guarded hop stays guarded across a challenge replay" block in `tests/conformance/xcut/security-by-default.conformance.test.ts` | not yet in §10 |
| **`ASYNC-21`'s "MUST NOT close the caller-owned source on any termination" is not honoured: the RxJS SSE adapter takes ownership and closes.** `sseEvents$` and `typedSse$` pass `() => stream.close()` as `fromAsyncIterable`'s `release`, and RxJS runs a subscriber's finalizer on *every* termination — unsubscription, end-of-source and a source error alike, which is the complete list the clause names. **Kept, deliberately, on two grounds.** (1) **The clause has no subject on this platform.** It presumes a source whose iterator return leaves the source open; this port's `SseStream` is deliberately not that one. `#iterate`'s `finally` calls `#releaseQuietly()`, so the resource is released whenever the runtime drives `return()` — which `fromAsyncIterable` must do exactly once (`ASYNC-6`), and which a plain `for await` with `break` does too. Removing the callback would change which channel reports a release failure and when the release runs, not whether the caller-owned source ends up closed. (2) **The ordering is load-bearing.** The release runs *ahead of* `iterator.return()` because an async generator's `return()` queues behind a suspended `next()`, and an SSE stream idling between events is parked in exactly that pull — so without the callback an `unsubscribe()` stays pending until the server next sends a byte, holding the socket open indefinitely. Measured: deleting the two `release` arguments turns four cases red — the two suspended-pull ones, as "the teardown did not settle within 500ms", and the two pre-existing idle-unsubscribe assertions — while every exactly-once release count stays green, which is the shape of the claim. Pagination attaches no release for the complementary reason: a `Paginator`'s pulls are bounded HTTP exchanges, never a wait on a server that may never answer. *Rejected:* dropping the callback to match the letter (reintroduces the hang for no change in what closes). *Rejected:* a caller-facing `{ownership}` option (two behaviours to document for a case with one correct answer). The public TSDoc and `packages/rx/README.md` now state the transfer outright — subscribing hands the stream over, do not close it yourself and do not iterate it afterwards — rather than leaving the `ASYNC-21` citation on the doc comment's first line to read as satisfied | audit #67 / #75 | 2026-09-05 | `packages/rx/src/sse.ts:46` and `:73-75` are the two `release` arguments; `packages/rx/src/from-async-iterable.ts:103-108` is the teardown that runs one on every termination; `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:42` is the requirement. Ground 1: `packages/core/src/sse/stream.ts:136-139` (`#iterate`'s `finally` → `#releaseQuietly()`) with `:117-121` (`close()` memoized, `SSE-28`). Ground 2: `packages/rx/src/from-async-iterable.ts:44-48` states the ordering and why. Pinned by the two `resource ownership` blocks in `packages/rx/src/sse.test.ts`, which count the release the OWNED resource sees rather than `SseStream.close()` calls — the facade memoizes, so a facade-level count reads "once" however many paths call it — and by "SSE ownership transfer releases once on Node" in `tests/node-conformance/rx-bridge.test.mjs`. Phase 8b marked `ASYNC-21` ✅ with this clause dropped from its gist (`docs/work/mvp/phase8/phase8b/2026-07-28-phase8b-async-runtime-checklist.md:67`); that is a dated record and is left as written. The other half is `SSE-41`'s own "documented source ownership" clause, which the same checklist marked ✅ (`:74`) on the strength of documentation that named unsubscription only — completed by the TSDoc and README rewrite this row accompanies | not yet in §10 |
| **`AUTH-22`'s "emit cnonce/nc/qop only when qop is negotiated" is not applied to `cnonce` for a `-sess` algorithm.** A `-sess` HA1 is `H(H(user:realm:pass):nonce:cnonce)` (RFC 7616 §3.4.2), so the client nonce is an *input to the hash* for `MD5-sess` and `SHA-256-sess` whatever `qop` the challenge offered. The port implemented AUTH-22 to the letter: it drew a fresh cnonce, folded it into HA1, and then omitted it from the header whenever `qop` was absent — a response no server can verify, because it has no way to reconstruct HA1. AUTH-30 bounds the re-challenge replay to one 401, so every such exchange simply failed. **`cnonce` is now emitted for any `-sess` algorithm; `nc` and `qop` stay conditional exactly as AUTH-22 says**, because RFC 2069's response input is `H(HA1:nonce:HA2)` and carries no nonce count, so emitting one would advertise a count the response was not computed over. RFC 7616 §3.4 states the wider rule outright — "cnonce: This parameter MUST be used by all implementations". AUTH-22's clause is RFC 2617's RFC 2069-compatibility form, written before `-sess` existed, and the requirement's own AUTH-15 mandates both `-sess` algorithms, so the two sentences cannot both be followed. *Rejected:* declining a `-sess`-without-`qop` challenge instead, which turns every such server into a guaranteed 401 for no security gain, when the value the server needs has already been computed | audit #67 / #74 | 2026-09-05 | `packages/core/src/auth/digest.ts:345-350` (the `-sess` HA1 that consumes the cnonce) against `:405-408` (`buildHeaderValue`, where the `else if` now emits it); `docs/product-spec/11-authentication.md:18` and `docs/product-spec/appendix-c-consolidated-normative-requirement-index.md:357` are AUTH-22's wording. Pinned by the `digestHandler -sess without qop (AUTH-17/AUTH-22)` block in `packages/core/src/auth/digest.test.ts` — one row asserting the header carries `cnonce` and neither `nc` nor `qop`, one recomputing the response from the header's OWN cnonce so a value drawn twice would fail — and by the `MD5-sess, no qop` vector in the same file | not yet in §10 |
| **`RETRY-44`'s "downstream chain" is read as everything BELOW the retry point, which in the recovery stack excludes the request chain.** The requirement has two clauses: each attempt re-executes the downstream chain with fresh per-attempt state, and "upstream steps MUST NOT mutate the shared in-flight request between attempts". The port originally read the first clause as covering the *whole* recovery chain and re-ran `RequestRecoveryChain.apply()` per attempt, with a test that said so by name. That makes `packages/core/src/recovery/idempotency-key.ts` generate a fresh key on every attempt, so three attempts of one logical request reach the server as three unrelated writes — the precise failure `RECOV-32` exists to prevent, and the opposite of what that step's own `@public` TSDoc promises. **The chain is now applied once, above the loop; each attempt re-executes transport plus response chain over `stampAttempt`'s fresh copy of the prepared request.** Under this reading both clauses hold and the second holds *by construction*: upstream steps cannot mutate the in-flight request between attempts because they no longer run between attempts. The pillar stack is untouched — there "downstream" is the forked continuation (`ctx.fork()`), and `retryStep` still re-drives it per attempt. *Rejected:* memoizing the key on the template (a `WeakMap` keyed by the `Request` instance) — a caller who deliberately sends one immutable `Request` value twice would replay the key and have the server drop a genuine second call. *Rejected:* re-running the chain over the *prepared* request each attempt — the chain would read its own output, which is clause two's mutation in different clothes, and every shipped and caller-written step would have to be proven idempotent. One consequence recorded rather than assumed: the re-send gate (`RETRY-5`/`RECOV-18`) now judges the prepared request rather than the caller's, which is what a retry would actually re-send | audit #67 / #73 | 2026-09-05 | `packages/core/src/retry/retry-dispatch.ts:83-88` (the chain applied once, then `runWithRetry`) against `:27-33` (the per-attempt half); `packages/core/src/recovery/orchestrator.ts:62` (`prepareRequest`) and `:117` (`dispatchPrepared`); `packages/core/src/retry/engine.ts:243` is the gate that now reads the prepared request. `RETRY-44`'s wording is `docs/product-spec/09-retry-and-resilience.md:35` and `docs/product-spec/appendix-c-consolidated-normative-requirement-index.md:306`. Pinned by `packages/core/src/retry/retry-dispatch.test.ts:126` (chain applied once), `:169` (one `generate()`, one key on three sends), `:201` (the `RETRY-38` ordinal varies while the key does not) and `:227` (a request-chain throw is not retried and meets the recovery phase exactly once) | not yet in §10 |
| **`HTTP-35`'s timeout check is read as the FULL range `AbortSignal.timeout()` accepts, not the lower bound the requirement enumerates.** `HTTP-35` says the options builder "MUST reject a non-null timeout that is zero or negative". `RequestOptionsBuilder.timeoutMs` rejects three more classes: non-finite (shipped unledgered before this audit), non-integer, and anything above `2**32 - 1`. **Strictly stricter than the letter, and deliberately so.** The field has exactly one consumer — `composeSignal` hands it to `AbortSignal.timeout()` — so a value this setter admits and that function refuses is `HTTP-35`'s own failure mode with the seam moved: the error surfaces inside a transport, as an unwrapped platform `RangeError`, one frame away from the call that supplied it. The earlier reading accepted `1.5` and argued in TSDoc that "a timeout is a duration and a fractional millisecond is meaningful"; no consumer of the field can express one. **The range checked is Node's, and that is the point:** `AbortSignal.timeout(1.5)` and `AbortSignal.timeout(2 ** 32)` raise `RangeError` on Node and are ACCEPTED on Bun, and a negative delay is `RangeError` on Node against `TypeError` on Bun (measured 2026-09-05), so leaving the check to the runtime would make an SDK-level contract depend on which runtime the caller happens to be on. *Rejected:* rounding with `Math.ceil` and clamping inside `composeSignal`, which hides the caller's mistake in the one place `HTTP-35` exists to surface it. `composeSignal` is documented as still able to raise, because a transport's own `defaultTimeoutMs` construction option bypasses this setter and is not validated by core — recorded for #81/#82, not fixed here | audit #67 / #76 | 2026-09-05 | `docs/product-spec/04-core-http-domain-model.md:48` is `HTTP-35`'s wording. `packages/core/src/http/request-options.ts:12` (`MAX_TIMEOUT_MS`) and `:204-214` (the check and the rewritten TSDoc paragraph); `packages/core/src/seams/transport.ts:86-92` is `composeSignal`'s new `@throws`, which states the two-runtime divergence rather than naming one error class. Pinned by "rejects a fractional timeout, which no transport deadline can honor" (`packages/core/src/http/request-options.test.ts:128`, the FLIPPED case — it pinned acceptance until this audit), "rejects a timeout above AbortSignal.timeout()'s ceiling of 2**32 - 1" (`:134`), "accepts the ceiling itself" (`:143`) and the `every accepted timeout is an integer in 1..2**32 - 1` property (`:157`); the Node half is `composeSignal timeout range on Node (HTTP-35)` in `tests/node-conformance/seams.test.mjs:105`, which cannot live in `bun test` because Bun accepts both rejected values | not yet in §10 |
| **`HTTP-31`'s "falls back to raw text rather than throwing" is satisfied for an unpaired surrogate by SUBSTITUTING U+FFFD, not by keeping the raw text.** `HTTP-31` (MUST) makes `QueryParams.parse` lenient and enumerates the lenient cases, ending with "malformed percent-encoding falling back to raw text rather than throwing". An unpaired surrogate is a fourth kind of malformed input the enumeration does not name, and the fallback it prescribes is not available for it: the raw text has no UTF-8 form, so keeping it produces a `QueryParams` whose `encode()` throws `URIError` — the throw merely deferred out of `parse` and into an accessor that documents no throw at all. **The port repairs instead.** `parse` runs `toWellFormed()` over each decoded name and value, so every instance it returns is encodable, which is what "parsing MUST invert encode" needs to mean. The strict half of the rule is unaffected and is where `#76` puts the rejection: `QueryParamsBuilder.add` throws `UrlConstructionError` for the same input, and `substitutePathParams` throws `OperationAssemblyError`. That asymmetry is not new to the query model — it is exactly the outbound/inbound split `Headers` already draws for `HTTP-18` against `HTTP-19`, applied to the one requirement pair that needs it here. Substitution matches the platform rather than inventing a policy: `new URL('https://x/?a=\uD800').search` is `?a=%EF%BF%BD` (measured 2026-09-05). *Rejected:* letting `parse` throw the builder's error, which breaks a MUST. *Rejected:* dropping the offending parameter, which loses a name the caller may be matching on | audit #67 / #76 | 2026-09-05 | `docs/product-spec/04-core-http-domain-model.md:42` carries `HTTP-31`'s wording (shared with `HTTP-30`). `packages/core/src/http/rfc3986.ts:17-18` are the two patterns, `:31` `hasLoneSurrogate` (strict) and `:44` `toWellFormed` (lenient) — one rule, two entry points, so no caller can pick the wrong one; `packages/core/src/http/query-params.ts:144-150` is `parse`'s repair with the `HTTP-18`/`HTTP-19` comparison stated inline, against `:44-50` and `:240-241` for the strict `add` path; `packages/core/src/seams/operation.ts:139-144` is the path-param half. `/\p{Surrogate}/u` rather than `String.prototype.isWellFormed()` because the latter is ES2024 and `tsconfig.base.json:5-11` pins `lib: ES2023`, though the `engines.node >= 20.3` runtime has it. Pinned by the `lone surrogates are rejected where they are supplied (HTTP-29, HTTP-31)` block in `packages/core/src/http/query-params.test.ts:170` — "parse() stays lenient and substitutes U+FFFD, because HTTP-31 forbids throwing" (`:197`) and the `no anything escapes parse()` property (`:233`) | not yet in §10 |
| **`OBS-35`'s "MUST NOT bake in a default config key name" is satisfied by making the key configurable, not by removing the default.** `OBS-35` (SHOULD) asks for a tolerant, layered log-level resolution and adds one MUST: no baked-in default key name. The port ships `CFG_KEY_LOG_LEVEL` (`DEXPACE_LOG_LEVEL`) as `CFG-14`'s well-known key and, until 2026-09-05, read it unconditionally. It is now `LoggingStepSettings.configKey`'s default: a caller names their own key and the resolution is otherwise identical. **Why the default stays.** A required key would mean no caller gets ambient granularity without naming one first, which trades a MUST about *naming* for a worse default experience, and `CFG-14` — which this port also implements — exists precisely to standardise the name. The layered resolution itself is `CFG-1`'s (override → environment → normalised property → default) and is tolerant as the requirement asks. **A second, quieter half:** the process-wide configuration slot starts empty (`CFG-13`), so no key of any name resolves until a host calls `setGlobalConfiguration(defaultConfiguration())`. That is deliberate — defaulting the slot to a configuration that reads `process.env` would make an import-time environment read the SDK's default behaviour — and it is now documented as the required wiring rather than left to be discovered | audit #67 / #80 | 2026-09-05 | `packages/core/src/observability/logging-step.ts:64-79,94-104` (the setting and the resolution); `packages/core/src/config/configuration.ts:311,354-358,368` (`CFG_KEY_LOG_LEVEL`, `defaultConfiguration`, the empty default slot); `docs/sdk-documentation/pipelines.md` "Turning logging on from the environment"; `docs/product-spec/15-instrumentation-and-observability.md:66` (the requirement) | not yet in §10 |

### Proposed erratum for `PIPE-40` (drafted 2026-09-04, not applied)

The narrower of the two edits, and the one that leaves both requirements true. `PIPE-40` is the
general rule and needs only to stop naming a trigger that `REDIR-22` has already claimed; `REDIR-22`
is correct as written and should not be touched.

`docs/product-spec/08-execution-pipelines.md:20`, currently:

> on paths that abandon a re-drive (redirect cycle, **non-replayable body**, budget exhausted) the
> in-flight response MUST be returned unclosed.

Proposed:

> on paths that abandon a re-drive and **return** the in-flight response (redirect cycle, budget
> exhausted) that response MUST be returned unclosed. Where a path instead **fails** — a
> non-replayable body under `REDIR-6`, a rejected downgrade — `REDIR-22` governs and the response
> MUST be closed before the error propagates.

Applying it is a deliberate hand edit to a frozen tree by whoever owns the specification. Until then
the dissolved register's G1 carries the live pointer, and the behaviour is chosen, tested and unaffected
either way.
