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
    Internal `io/` primitives ship `close()` only — the symbol postdates the package's declared Node floor
    (`>=20.3` since 2026-08-26; on the 20.x line the symbol arrives in 20.4.0), and these types are `@internal` and never surface to a consumer who'd use the ergonomic disposal syntax
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
