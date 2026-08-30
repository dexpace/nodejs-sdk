## 10. Deliberate Deviations from the Reference Contract

This section is the as-built reconciliation of every place the port's Node-idiomatic answer changes the
*mechanism* a requirement is satisfied by, rather than merely relocating it — superseding this section's
pre-implementation prediction now that Phases 0-8 have each shipped a design and plan. None of these narrow a
MUST-level correctness guarantee; each is a case where the JVM-specific mechanism a requirement was worded around
does not exist in Node, and an equivalent, differently-shaped mechanism is substituted instead. Reconciled by
Phase 10 (`docs/superpowers/specs/2026-07-28-phase10-deviation-reconciliation-design.md`), 2026-07-28.

**Three files carry "deviations" in their name. They are not interchangeable** (cross-reference added
2026-08-30, after the first of them was corrected against source without the other two being touched):

| File | What it is | Numbering |
|---|---|---|
| **This section (§10)** | The **normative ledger** of deliberate deviations — the canonical, as-built list. Every item's number is the one the other files cite. | Owns items 1-17 |
| `docs/deviations.md` | The **as-built audit** of this ledger, performed against source rather than against the phase specs that produced it. Carries the `file:line` evidence for each item, and the record of which items this ledger got wrong. Restates §10's item numbers; it does not assign its own. | Follows §10's |
| `docs/knowledge/deliberate-deviations.md` | Neither. A **harvested corpus topic file** queried by `bun run knowledge`, derived from an *older* revision of this section. Confusingly named; it is not a ledger and must not be edited as one — it is `knowledge-harvest`'s output. **Currently stale** — see its own head banner. | None |

**Renumbering this section renumbers `docs/deviations.md`.** Its section headings and its two summary tables are
keyed to the numbers above, with no independent identity to fall back on; change one and the other must change in
the same commit.

**Where a *new* deviation is recorded:** in the owning phase spec's own `## Deviation Ledger (for Phase 10)`
section, never here directly. This section is Phase 10's **output** — the consolidation of those per-phase
ledgers — not their intake.

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
   This is an acknowledged, language-level limitation, not an oversight; the mitigation — exporting the
   **`http/` wire-model types** as concrete classes rather than bare structural interfaces — narrows but does not
   eliminate the gap (Phase 1). *Corrected 2026-08-29: the mitigation previously read "exporting only concrete
   classes, never bare structural interfaces, from each package's public entry point", which the API report
   contradicts — `packages/core/etc/core.api.md` exports 61 interfaces against 58 classes. Most are seams
   (`Transport`, `Serde`, `Logger`) or options records, where structural typing is the point and no builder
   validation is being bypassed. At least one is not: `Configuration` is a builder-built, frozen type exported as
   a bare interface and accepted structurally by `setGlobalConfiguration()` and `resolveProxyOptions()`. The
   mitigation is real for the domain models it was written about; it is not a package-wide property.*
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
7. **Configuration keeps all four layering tiers, but the platform supplies nothing to bind the third to.**
   **CFG-1**'s override → environment → system-property → default chain is implemented in full: `getString`
   resolves an exact-key override, then the environment source under the exact key, then the *property* source
   under **CFG-3**'s normalized key (lower-cased, `_` → `.`), then the caller's default. The property layer is a
   first-class, caller-supplyable `SourceFn` seam — `ConfigurationBuilder.withPropertySource()` and
   `getRawProperty()` are both public API — so a host that *does* have an ambient key/value store can bind it.
   What deviates is only the **default production wiring**: `defaultConfiguration()` binds a property source that
   always returns `undefined`, because Node has no ambient store distinct from `process.env`, and routing a
   synthetic "system property" back through `process.env` under a different key would invent a layer the platform
   does not have (Phase 7a). *Corrected 2026-08-29: this entry previously read "three tiers, not four — the
   system-property tier is lost outright", which understated the as-built code. The tier exists and is
   substitutable; only its default binding is empty.*
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
11. **`Symbol.asyncDispose` is adopted opportunistically, not uniformly, and every install is runtime-guarded.**
    The symbol postdates the packages' declared Node floor (`>=20.3` since 2026-08-26; on the 20.x line the
    symbol arrives in 20.4.0), so nothing may declare it as a plain class member: on the floor the computed key
    evaluates to `undefined` and binds the method to the string key `"undefined"`, leaving a junk prototype entry
    and no working disposal, while the emitted `.d.ts` promises `AsyncDisposable` unconditionally. The port
    therefore runs a **two-tier policy**, verified against the code 2026-08-29:
    - **`close()` only, no disposal member at all.** Internal `io/` primitives — `@internal`, never surfaced to a
      consumer who would use the ergonomic syntax (Phase 3a). Also `Body`/`Response` (Phase 3b), which are
      *public* but deliberately teardown-by-`close()`; `http/response.test.ts` and
      `body/response-body-logging.test.ts` each pin the **absence** of the `"undefined"` key, and are the origin
      of the rule the other tier follows.
    - **Guarded runtime install.** `SseStream` (Phase 6b), `Page` (Phase 6c), and both transports —
      `FetchTransport` and `UndiciTransport` (Phase 8a) — install `[Symbol.asyncDispose]` via
      `Object.defineProperty` behind `typeof Symbol.asyncDispose === 'symbol'`. None declares
      `implements AsyncDisposable` and none emits the member into its `.d.ts`, so nothing promises a consumer on
      the floor a method that is not there.

    **This entry previously misdescribed the code on three counts and is corrected here rather than restated.**
    It claimed `Body`/`Response` add the member (they never have, and two tests assert they do not); it claimed
    all sites were "optional and runtime-guarded" (only `SseStream` was — `Page`, `FetchTransport`, and
    `UndiciTransport` each declared a plain class member *and* `implements AsyncDisposable`, and both transport
    factories publicly returned `Transport & AsyncDisposable`); and it omitted the two transport sites entirely
    while asserting consistency "across all four sites". The three unguarded sites were repaired on 2026-08-29 —
    see the changeset `2026-08-29-guard-symbol-asyncdispose-installs.md`. The type-system cost of keeping the
    floor at `>=20.3` is that `await using` does not type-check against these types; `close()` is the supported
    teardown path, and raising the floor to `>=20.4` in a later release would restore the declaration honestly.
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
    version (all: Phase 8a). Phase 8a's implementation added one more, found only by building it: **a custom
    proxy `challengeHandler` cannot be dispatched by `transport-undici` either** — undici's `ProxyAgent` takes
    its credential solely from its own constructor and rejects any per-request `Proxy-Authorization` with
    `InvalidArgumentError` (a deliberate security fix on their side), and the constructor runs before any
    challenge has been seen, so no handler-minted credential can reach the exchange that provoked it. This is
    the case **TRANSPORT-30**'s own text anticipates: the handler is surfaced with a WARN at construction and
    again on the first real `407`, proxy auth falls back to Basic (`ProxyOptions.credentials`, which *is*
    passed to the `ProxyAgent` constructor), the `407` reaches the caller untouched, and a per-request
    `Proxy-Authorization` is dropped from the outbound pass — logged by name like any other drop — rather than
    turning every proxied send into a hard failure. The Phase 8a *plan* had specified a retry-with-stamped-
    credential flow instead; that flow is not implementable on this platform (Phase 8a).
14. **`NFR-12` is closed on evidence; `NFR-16` alone stays open until first real release.** These two were
    recorded together as soft gaps that "cannot be verified without a real artifact" — true while the repository
    was docs-only, and no longer true for the first of them once Phases 1-9 shipped code. They are now separated:
    - **NFR-12 (byte-identical builds) — closed 2026-08-29, verified.** Two clean builds of an identical source
      tree (every `dist/` and `*.tsbuildinfo` swept between them) produce **644 emitted files, byte-identical**;
      `npm pack` of `@dexpace/core` twice produces an identical tarball digest. The check is now a blocking CI
      step rather than an assertion — `bun run verify:reproducible-build`
      (`scripts/verify-reproducible-build.mjs`), which sweeps, builds twice, and diffs a SHA-256 per emitted
      file. It was negative-tested by injecting a `Date.now()` into the one build-time codegen step
      (`packages/core/scripts/gen-version.mjs`) and confirming it fails naming the offending file.
    - **NFR-16 (publish provenance) — still open, target "first real release."** Its conformance test is
      behavioral ("a CI/release build fails an unsigned publication; a local build without keys still publishes
      unsigned") and needs a real registry and a real OIDC token. *Corrected 2026-08-29: this entry previously
      claimed `npm publish --provenance` was "scripted (Phase 0 Task 3)". It is not — the string appears in no
      `package.json`, no workflow, and no `.npmrc`; there is no `.npmrc` and no release workflow at all
      (`.github/workflows/` holds `ci.yml` only). Only `prepublishOnly` is wired, exactly as
      `docs/open-items.md`'s own row has always said. Authoring the release workflow with `--provenance` and
      `id-token: write` is actionable **now** and is the unblocking work; only exercising it needs the registry.*
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
17. **`TransportFailureError` adds a third level to an error tree the styleguide caps at two.** The
    styleguide holds custom error hierarchies to two levels deep, and Phase 3a flattened this very tree to
    obey it — the four I/O leaves extend `DexpaceError` directly, and `isIoError` exists to group them
    without reintroducing a middle tier (`packages/core/src/io/errors.ts`). Phase 8a's **TRANSPORT-20**
    reintroduces one: `TransportFailureError extends IoError extends DexpaceError`. The subtyping *is* the
    requirement rather than an accident of modelling — `classify.ts`'s cause-walk returns `true` for every
    `IoError`, so extending it is what makes a no-response failure retryable with no edit to the retry
    layer, and a flat sibling would have to be named there by hand and again for every transport added
    later. One level of depth buys the canonical-subtype clause. Held at exactly three: a fourth level is
    not sanctioned by this row (Phase 8a).
