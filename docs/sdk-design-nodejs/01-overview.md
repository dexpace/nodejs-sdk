## 1. Overview

The dexpace SDK's thesis — "an HTTP-client toolkit, not an HTTP client" — needs restating for an ecosystem whose
default reflex is exactly the opposite of what the JVM reference audience reaches for. On the JVM, teams already
default to composing a toolkit (a transport, a JSON library, a resilience layer, chosen independently) because no
single dominant "just works" HTTP client exists. In Node, the ecosystem's gravity pulls the other way: `axios`,
`got`, `ky`, and the built-in `fetch` are complete, terminal HTTP clients that already bundle retries, interceptors,
JSON handling, and redirect following into one opinionated package. A Node engineer's default move when they need
to call an HTTP API is `npm install axios` (or increasingly, just use global `fetch`), not assemble a pipeline from
parts.

This SDK is not a competitor to those clients — it does not compete on "easiest way to GET a JSON endpoint." It
targets a narrower, specific audience: **authors of generated or hand-written service-client SDKs** (an internal
platform team publishing a client for a company's own API surface, or an OpenAPI-codegen backend targeting Node)
who need the correctness-sensitive plumbing — idempotency-aware retry that never double-sends a one-shot body,
redirects that never leak a bearer token cross-origin, RFC 7235 challenge/Digest auth, cursor/Link-header
pagination, WHATWG SSE parsing, PATCH's absent/null/present three-state semantics — solved exactly once, correctly,
and available to every generated client without every codegen backend re-solving it. The secondary audience is
application teams who want those same correctness guarantees but insist on choosing their own transport (`undici`
vs. the global `fetch` vs. a corporate HTTP proxying library) and their own JSON layer (native `JSON`, a
schema-validating decoder, a streaming parser) without inheriting whichever choices this SDK's authors happened to
prefer.

The value proposition inherited unchanged from the reference: because the core carries no concrete transport,
codec, or async-runtime dependency (**SEAM-1**), a consumer adopts it without inheriting a peer-dependency conflict,
and swaps any one concern independently. The correctness-sensitive decisions — idempotent-method classification,
retryable-status classification, body replayability, header-injection defenses, credential hygiene across
redirects, cancellation-vs-timeout classification — are made once in `@dexpace/core` so every transport adapter
behaves identically. A faithful port preserves the seams and their invariants; it does not preserve the Kotlin
module count, because Node's runtime model genuinely needs fewer seams to say the same thing (see §2, §3).

---

