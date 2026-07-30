# dexpace SDK — Node.js/TypeScript Port Design

**Status:** Design proposal. This document is not normative in the sense `docs/product-spec.md` is — it does not
mint new requirement IDs — but every architectural decision below is justified against, or deliberately deviates
from, a specific requirement in that specification. Read `docs/product-spec.md` first; this document assumes its
vocabulary (`SEAM-*`, `HTTP-*`, `IO-*`, `BODY-*`, `CTX-*`, `PIPE-*`, `RECOV-*`, `RETRY-*`, `REDIR-*`, `AUTH-*`,
`PAGE-*`, `SSE-*`, `SERDE-*`, `OBS-*`, `CFG-*`, `TRANSPORT-*`, `ASYNC-*`, `XCUT-*`, `NFR-*`) and cites IDs inline
rather than re-deriving them.

**Scope.** This is a package-and-seam-level architecture for a Node.js/TypeScript implementation of the same
product: an HTTP-client toolkit, not an HTTP client. It covers workspace layout, the idiomatic Node/TS mapping of
each of the spec's five seams and its async pivot, domain-model construction under TypeScript's structural type
system, the two pipeline layers, resilience (retry/redirect/auth), pagination/SSE/serde, instrumentation and
configuration, and the toolchain that enforces the same quality bar the Kotlin reference enforces mechanically.
It does not contain TypeScript source, a package scaffold, or a build script — those are downstream of this
document, produced when a port is actually undertaken.

**A note on judgment calls.** The Kotlin/JVM reference makes several structural choices — a distinct synchronous
and asynchronous transport seam, five separate async-runtime adapter modules, a pluggable byte-stream provider — that
exist because of *specific* JVM constraints: two genuinely different I/O execution models (blocking threads vs.
NIO/reactive), fragmentation across coroutines/reactive-streams/Netty/virtual-thread ecosystems, and the absence of
any standard-library byte-stream type good enough to build a wire protocol on. None of those constraints hold in
Node. Where a MUST-level requirement's *intent* is separable from its JVM-specific *mechanism*, this document keeps
the intent and finds the Node-native mechanism. Where collapsing two JVM concepts into one Node concept is what
idiomatic design demands, it says so plainly and cites the requirement whose letter, not spirit, is being adjusted.
All such calls are collected in §10.

---

## Table of Contents

- [1. Overview](./sdk-design-nodejs/01-overview.md)
- [2. Package and Workspace Layout](./sdk-design-nodejs/02-package-and-workspace-layout.md)
- [3. Seam-by-Seam Idiomatic Mapping](./sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md)
- [4. Domain Model Construction](./sdk-design-nodejs/04-domain-model-construction.md)
- [5. Pipeline Architecture](./sdk-design-nodejs/05-pipeline-architecture.md)
- [6. Retry, Redirect, and Authentication](./sdk-design-nodejs/06-retry-redirect-and-authentication.md)
- [7. Pagination, SSE, and Serialization](./sdk-design-nodejs/07-pagination-sse-and-serialization.md)
- [8. Instrumentation and Configuration](./sdk-design-nodejs/08-instrumentation-and-configuration.md)
- [9. Toolchain and Quality Gates](./sdk-design-nodejs/09-toolchain-and-quality-gates.md)
- [10. Deliberate Deviations from the Reference Contract](./sdk-design-nodejs/10-deliberate-deviations-from-the-reference-contract.md)
