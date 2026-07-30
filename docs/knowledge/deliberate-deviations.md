# deliberate-deviations

## Rules

## Constraints

## Conclusions
- None of the port's Node-idiomatic mechanism substitutions narrow a MUST-level correctness guarantee from the reference contract; each substitutes an equivalent, differently-shaped mechanism where the JVM-specific one the requirement was worded around does not exist in Node.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:3-6` · high · sha:f9ecb6e7d87b</sub>
- The synchronous transport seam and the asynchronous transport seam collapse into a single `Promise`-returning `Transport.send()` satisfying both requirements' letter simultaneously, because Node has no blocking-I/O execution model to give the sync/async distinction meaning.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:8-12` · high · sha:f9ecb6e7d87b</sub>
- The byte-stream provider seam is no longer pluggable because Web Streams are a runtime standard rather than a third-party library, so `@dexpace/core` implements the byte-stream contracts directly with no discovery/installation machinery.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:13-16` · high · sha:f9ecb6e7d87b</sub>
- Async-runtime adapter fragmentation does not exist in the port because `Promise` is Node's only ecosystem-wide async primitive, so no bridge modules equivalent to the JVM reference's coroutine/reactor/netty/virtual-threads adapters are shipped, and the one optional adapter shipped (`@dexpace/rx`) is sugar over a genuinely different push-based data shape rather than plumbing for the request/response pivot.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:17-21` · high · sha:f9ecb6e7d87b</sub>
- The two retry stacks collapse into one, with the total-timeout budget made explicitly opt-in, a substitution the spec itself sanctions by requiring that a port that unifies retry entry points MUST make that budget explicitly opt-in.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:22-24` · high · sha:f9ecb6e7d87b</sub>
- True runtime encapsulation of domain models is not fully achievable because TypeScript's structural typing means a hand-built object literal can still impersonate a public interface type and bypass builder validation, even though ECMAScript `#private` fields close the "official construction path" hole; this acknowledged language-level limitation is mitigated, not eliminated, by exporting only concrete classes rather than bare structural interfaces from each package's public entry point.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:25-30` · high · sha:f9ecb6e7d87b</sub>
- The generic-erasure defense uses schema-as-witness rather than reflective type capture, because TypeScript erases types more completely than JVM generic erasure and leaves no raw class token to reflect over, and this substitution is argued to be at least as strong a guarantee, not a weaker one.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:31-35` · high · sha:f9ecb6e7d87b</sub>
- Single-threaded execution collapses the JVM reference's atomic compare-and-set guard for the materialize-once body race into a synchronous check-and-set, correct only if the guard executes before the guarded async function's first `await`, a precondition stated explicitly because it is the one place the simplification could be silently misapplied.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:36-40` · high · sha:f9ecb6e7d87b</sub>
- Digest MD5 needs a vendored implementation while SHA-256 does not, because the Web Crypto API deliberately excludes MD5, so the port vendors a small, dependency-free MD5 implementation for RFC 7616 interoperability and uses `crypto.subtle` directly for SHA-256/SHA-256-sess.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:41-43` · high · sha:f9ecb6e7d87b</sub>
- Configuration layering has three tiers rather than four because the system-property tier is lost outright, Node having no ambient key/value store distinct from environment variables to fill that slot, and the port does not fabricate one.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:44-46` · high · sha:f9ecb6e7d87b</sub>
- Cancellation is `AbortController`/`AbortSignal` end-to-end rather than an interrupt-and-restore-a-flag discipline, composing the same signal type across the transport call, the retry backoff wait, and a derived per-call timeout; since `Promise` has no public `cancel()` unlike `CompletableFuture`, cancellation is cooperative end-to-end, and a `send()` implementation must check `signal.aborted` after resuming from an `await` before treating a resolved value as deliverable.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:47-53` · high · sha:f9ecb6e7d87b</sub>
- Frozen collections are computed once rather than wrapped on every read, satisfied by `Object.freeze`-ing each collection exactly once at construction and returning the same frozen reference from every subsequent getter call, cheaper than the reference's per-access unmodifiable-wrapper pattern because the port's models never change after construction.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:54-57` · high · sha:f9ecb6e7d87b</sub>
- The dead-code-survival gate targets a different risk than the JVM reference, since JS bundlers have no reflection blind spot to guard against, so `@dexpace/shrink-test` instead targets the dual-package hazard of two copies of `@dexpace/core` breaking cross-package `instanceof` checks after a bundle-and-tree-shake round trip.
  <sub>design · `docs/sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md:58-62` · high · sha:f9ecb6e7d87b</sub>

## Reference

## Conflicts

## Superseded
