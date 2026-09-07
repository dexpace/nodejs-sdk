# cross-cutting-invariants

## Rules

## Constraints

## Conclusions

## Reference
- Universal, subsystem-independent contracts spanning transports, I/O, pipeline, auth, and instrumentation apply to every reimplementation, and a port that violates any one of them is incorrect or unsafe even if each subsystem individually appears to work.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:1-3` · high · sha:d6123be82c9e</sub>
- The cross-cutting conformance checklist verifies cancellation is terminal and non-retryable with the flag preserved (XCUT-1), timeout is retryable with a clear flag and discriminated out-of-band with the subtype checked first (XCUT-2), and an inter-attempt wait is promptly cancellable (XCUT-3).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:76` · high · sha:0451cc7f3bb4</sub>
- The cross-cutting conformance checklist verifies the two-branch error taxonomy with transport errors always-retryable and I/O-family (XCUT-4), a baked protocol-error flag from one classifier covering 408/429/all-5xx-except-501/505 (XCUT-5), capability-based classification for non-protocol errors (XCUT-6), a configurable authoritative retryable-status set driving protocol-error retries (XCUT-7), a status factory rejecting non-error status (XCUT-8), and cycle-safe cause-chain walks (XCUT-9).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:77` · high · sha:0451cc7f3bb4</sub>
- The cross-cutting conformance checklist verifies the retry-safety gate applies uniformly including to transport errors, with a bare POST never retried and a non-replayable body never re-sent (XCUT-10).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:78` · high · sha:0451cc7f3bb4</sub>
- The cross-cutting conformance checklist verifies shared components are concurrent-safe with per-call state kept local (XCUT-11), a wait-free credential read with scoped single-flight refresh (XCUT-12), idempotent non-blocking close (XCUT-13), the SDK closes only what it created (XCUT-22), and a pluggable seam resolves as explicit-install > auto-discovery > loud-fail on zero/ambiguous candidates (XCUT-23).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:79` · high · sha:0451cc7f3bb4</sub>
- The cross-cutting conformance checklist verifies caller/server-keyed maps are bounded with a drain-to-cap loop (XCUT-14) and public wire models are immutable with no external-mutable alias (XCUT-15).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:80` · high · sha:0451cc7f3bb4</sub>
- The cross-cutting conformance checklist verifies no credential is sent over non-HTTPS (XCUT-16); redirect credential hygiene strips Authorization always, strips Cookie/Proxy-Authorization on cross-origin judged against the seed, drops userinfo, and default-denies downgrade (XCUT-17); header name/value validation guards against splitting at the model layer (XCUT-18); default-deny log redaction covers userinfo/query/fragment/headers/credentials/bodies (XCUT-19); observability never throws into the request path (XCUT-20); a CSPRNG is used for security-relevant randomness (XCUT-21); and diagnostic previews are byte-capped and non-consuming (XCUT-24).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:81` · high · sha:0451cc7f3bb4</sub>

## Conflicts

## Superseded
