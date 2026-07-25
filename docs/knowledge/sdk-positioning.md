# sdk-positioning

## Rules
- The idempotent-method set and the retryable-status classifier MUST each be single-sourced, so the retry allow-list, the inherent replay-safety gate, and the exception's baked retryable flag all derive from one place (HTTP-9 / RETRY-1 / RETRY-6).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:17-17` · high · sha:8014d2ec2c9d</sub>
- Both retry stacks MUST compute backoff via one shared calculator using one shared set of constants, and neither may carry an independent formula (RETRY-13).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:18-18` · high · sha:8014d2ec2c9d</sub>
- The SDK must declare a lowest-supported-runtime floor and target it for all general-purpose units; a capability requiring a newer runtime must be isolated into its own unit that declares the higher floor explicitly and must not be a hard dependency of the general-purpose core, and no produced artifact may reference runtime/stdlib APIs absent on the floor it declares.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:29` · high · sha:5f4684bf7123</sub>
- The core should be concurrency-model agnostic, exposing plain blocking operations correct on any scheduler and leaking no async-framework types into the core public surface, with shared mutable state guarded for safe concurrent access and synchronization primitives avoiding pinning or blocking lightweight scheduler threads where the target runtime distinguishes them.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:33` · high · sha:5f4684bf7123</sub>

## Constraints
- The SDK core carries no concrete transport, codec, or async-runtime dependency, per SEAM-1.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:24-26` · high · sha:600a5307e799</sub>

## Conclusions
- The dexpace SDK is designed as an HTTP-client toolkit rather than an HTTP client itself, supplying immutable wire models, a staged request/response pipeline, and recovery-aware resilience primitives while never opening sockets, encoding JSON, or reading bytes off a stream directly.
  <sub>spec · `docs/product-spec/01-product-overview.md:3-3` · high · sha:4f786c44354d</sub>
- Because the core carries no concrete transport, codec, or I/O dependency (SEAM-1), a consumer can adopt the SDK without inheriting a transitive-dependency conflict and can swap any one concern (transport, JSON library, async runtime) without touching the others.
  <sub>spec · `docs/product-spec/01-product-overview.md:7-7` · high · sha:4f786c44354d</sub>
- Correctness-sensitive decisions (idempotency classification, status ranges, body replayability, header-injection defenses, credential hygiene, cancellation semantics) are made once in the core so that every transport behaves identically.
  <sub>spec · `docs/product-spec/01-product-overview.md:7-7` · high · sha:4f786c44354d</sub>
- A faithful port of the SDK must preserve the seams and their invariants rather than reimplement each concern per adapter.
  <sub>spec · `docs/product-spec/01-product-overview.md:7-7` · high · sha:4f786c44354d</sub>
- The dexpace Node.js SDK's thesis is "an HTTP-client toolkit, not an HTTP client," which requires restating for Node because the ecosystem's default reflex (axios, got, ky, global fetch) is the opposite of the JVM reference audience's toolkit-composition habit.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:3-10` · high · sha:600a5307e799</sub>
- Correctness-sensitive decisions — idempotent-method classification, retryable-status classification, body replayability, header-injection defenses, credential hygiene across redirects, and cancellation-vs-timeout classification — are made once in @dexpace/core so every transport adapter behaves identically.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:26-29` · high · sha:600a5307e799</sub>
- A faithful port preserves the seams and their invariants but does not preserve the Kotlin reference's module count, because Node's runtime model genuinely needs fewer seams to express the same guarantees.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:29-30` · high · sha:600a5307e799</sub>

## Reference
- Every capability that touches the outside world (network transport, byte-stream implementation, wire codec) plugs into the core behind a single-purpose interface, and the async-runtime concern is handled through a canonical async pivot plus optional out-of-core adapter modules.
  <sub>spec · `docs/product-spec/01-product-overview.md:3-3` · high · sha:4f786c44354d</sub>
- The product's own framing describes itself as "the machinery an HTTP client is made of," not the client itself.
  <sub>spec · `docs/product-spec/01-product-overview.md:3-3` · high · sha:4f786c44354d</sub>
- The first primary audience is authors of generated or hand-written service clients who need correct, secure, observable HTTP plumbing (retries that never double-send a one-shot body, redirects that never leak a bearer token cross-origin, logging that never prints a secret) without re-solving those problems per service.
  <sub>spec · `docs/product-spec/01-product-overview.md:5-5` · high · sha:4f786c44354d</sub>
- The second primary audience is application teams who want to bring their own transport, JSON library, and async runtime and pay only for what they put on the classpath.
  <sub>spec · `docs/product-spec/01-product-overview.md:5-5` · high · sha:4f786c44354d</sub>
- The core depends on a small enumerated set of interfaces it never implements: a byte-stream provider, a synchronous transport, an asynchronous transport, a wire codec, and an operation-input projection (SEAM-2).
  <sub>spec · `docs/product-spec/01-product-overview.md:9-9` · high · sha:4f786c44354d</sub>
- The idempotent-method set is {GET, HEAD, OPTIONS, PUT, DELETE} and the retryable-status classifier covers 408, 429, and all 5xx codes except 501 and 505.
  <sub>spec · `docs/product-spec/02-architectural-principles.md:17-17` · high · sha:8014d2ec2c9d</sub>
- The primary audience for the SDK is authors of generated or hand-written service-client SDKs, such as an internal platform team publishing a client for a company's API or an OpenAPI-codegen backend targeting Node.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:12-18` · high · sha:600a5307e799</sub>
- The secondary audience is application teams who want the SDK's correctness guarantees but insist on choosing their own transport (undici vs. global fetch vs. a corporate proxying library) and their own JSON layer without inheriting the SDK authors' choices.
  <sub>design · `docs/sdk-design-nodejs/01-overview.md:18-22` · high · sha:600a5307e799</sub>

## Conflicts

## Superseded
