## 10. Deliberate Deviations from the Reference Contract

This section consolidates every place above where the port's Node-idiomatic answer changes the *mechanism* a
requirement is satisfied by, rather than merely relocating it. None of these narrow a MUST-level correctness
guarantee; each is a case where the JVM-specific mechanism the reference requirement was worded around does not
exist in Node, and an equivalent, differently-shaped mechanism is substituted instead.

1. **Sync transport seam collapses into the async one (§3.2).** **SEAM-11** describes a synchronous, blocking
   transport contract as distinct from **SEAM-16**'s asynchronous one. Node has no blocking-I/O execution model to
   give that distinction meaning; the port ships one `Promise`-returning `Transport.send()` satisfying both
   requirements' letter simultaneously, rather than fabricating a synchronous API on top of an inherently
   asynchronous runtime.
2. **The byte-stream provider seam is no longer pluggable (§3.1).** **SEAM-3**–**SEAM-10** exist to keep a
   third-party stream library out of the zero-dependency core. Web Streams are a runtime standard, not a
   third-party library, so there is nothing left to make pluggable; `@dexpace/core` implements the byte-stream
   contracts directly, with no discovery/installation machinery.
3. **Async-runtime adapter fragmentation does not exist (§2, §3.2).** `sdk-async-coroutines`/`-reactor`/`-netty`/
   `-virtualthreads` each bridge one JVM async ecosystem to the canonical pivot. `Promise` is Node's only
   ecosystem-wide async primitive; the port ships no equivalent bridge modules, and the one optional adapter it does
   ship (`@dexpace/rx`) is sugar over a genuinely different data shape (push-based streams), not plumbing for the
   request/response pivot.
4. **Two retry stacks collapse into one, with the total-timeout budget explicitly opt-in (§6).** The spec itself
   anticipates and sanctions this: "**RETRY-28**... a port that unifies retry entry points MUST make that budget
   explicitly opt-in."
5. **True runtime encapsulation of domain models is not fully achievable (§4).** ECMAScript `#private` fields close
   the "official construction path" hole `HTTP-2`/`SEAM-29` care about, but TypeScript's structural typing means a
   hand-built object literal can still impersonate a public interface type, bypassing builder validation entirely.
   This is an acknowledged, language-level limitation, not an oversight; the mitigation (exporting only concrete
   classes, not bare structural interfaces, from each package's public entry point) narrows but does not eliminate
   the gap.
6. **Generic-erasure defense uses schema-as-witness, not reflective type capture (§7.3).** `SERDE-5`–`SERDE-8`'s
   mechanism (a reflectively-reconstructed type token) has no TypeScript equivalent, because TypeScript erases types
   more completely than JVM generics erasure does — there is no raw class token left to reflect over at all. The
   port requires callers to supply a runtime schema value as the witness instead of trying to recover erased
   information; this is argued in §7.3 to be at least as strong a guarantee, not a weaker substitute.
7. **Single-threaded execution eliminates whole categories of concurrency primitive (§6).** Guards the JVM reference
   needs an atomic compare-and-set for (**BODY-3**'s materialize-once race) collapse to a synchronous
   check-and-set — but only correctly, and only if the guard executes before the guarded `async` function's first
   `await`; this precondition is stated explicitly in §6 because it is the one place the simplification could be
   silently misapplied.
8. **Digest MD5 needs a vendored implementation; SHA-256 does not (§6).** The Web Crypto API that keeps `@dexpace/
   core` portable across non-Node runtimes deliberately excludes MD5. The port vendors a small, dependency-free MD5
   implementation for RFC 7616 interoperability and uses `crypto.subtle` directly for SHA-256/SHA-256-sess.
9. **Configuration layering has three tiers, not four (§8).** **CFG-1**'s override → environment → system-property →
   default chain loses its system-property tier outright; Node has no ambient key/value store distinct from
   environment variables to fill that slot, and the port does not fabricate one.
10. **Cancellation is `AbortController`/`AbortSignal` end-to-end, not "interrupt-and-restore-a-flag" (§3.2, §6).**
    Every cancellable operation in the port — the transport call itself, the retry backoff wait, a derived per-call
    timeout — composes the same signal type, a single idiom replacing the reference's per-context interrupt-flag
    discipline. `Promise` has no public `cancel()`, unlike `CompletableFuture`; cancellation is cooperative
    end-to-end, and a `send()` implementation must itself check `signal.aborted` after resuming from an `await`
    before treating a resolved value as deliverable, rather than relying on an external `cancel()` call to
    synchronously pre-empt it.
11. **Frozen collections are computed once, not wrapped on every read (§4).** `HTTP-5`'s read-only-exposure
    requirement is satisfied by `Object.freeze`-ing each collection exactly once at construction and returning the
    same frozen reference from every subsequent getter call, cheaper than the reference's per-access
    unmodifiable-wrapper pattern because the port's models never change after construction in the first place.
12. **The dead-code-survival gate targets a different risk (§9).** `NFR-8`'s JVM shrink-test guards against
    reflection-driven code looking unreachable to a static analyzer. JS bundlers have no reflection blind spot to
    guard against; `@dexpace/shrink-test` instead targets the dual-package hazard (two copies of `@dexpace/core`
    breaking cross-package `instanceof` checks after a bundle-and-tree-shake round trip) as the port's structurally
    equivalent risk.
