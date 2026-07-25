# package-and-dependency-layout

## Rules
- The core module must depend only on the language standard library, the runtime, and a compile-time-only logging facade, carrying no runtime dependency on any concrete HTTP transport, serialization library, I/O implementation, or async framework, with concrete capabilities supplied by separate adapter units depending on the core and never the reverse.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:7` · high · sha:5f4684bf7123</sub>
- Each optional capability (transport, serialization format, I/O backend, async bridge) should be a separately installable unit depending on the core plus at most one third-party library, so a consumer composes only the units it uses.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:8` · high · sha:5f4684bf7123</sub>
- In target ecosystems that support whole-program dead-code elimination/tree-shaking/minification, the SDK must ship the keep/retain configuration a downstream shrinker needs so its reflectively-reached and runtime-wired surface survives shrinking, covering the runtime-wired SPI seams and the immutable/reflectively-bound models; in ecosystems without such a build step this requirement does not apply.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:24` · high · sha:5f4684bf7123</sub>
- The shipped shrinker keep-configuration should be guarded by an automated regression check, wired into the default build, that shrinks a real consumer using only the shipped rules and runs it end-to-end against a live round-trip, failing the build if any runtime-wired or reflectively-reached surface is stripped.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:25` · high · sha:5f4684bf7123</sub>
- Build artifacts should be reproducible, with identical source inputs yielding byte-for-byte identical output artifacts via normalized/stripped embedded timestamps and deterministic entry ordering.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:37` · high · sha:5f4684bf7123</sub>
- Every source file should carry the project's license/SPDX header block, enforced in the reference implementation as a review convention rather than a mechanical gate.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:38` · high · sha:5f4684bf7123</sub>
- Dependency versions, plugin/tool versions, and project coordinates should live in a single source of truth rather than being restated per unit, so a version bump is ideally a one-line edit that propagates everywhere.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:39` · high · sha:5f4684bf7123</sub>
- Published artifacts should embed self-identifying version metadata the SDK can resolve at runtime, so runtime-emitted identifiers such as a User-Agent report the real version rather than an "unknown" placeholder.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:40` · high · sha:5f4684bf7123</sub>
- Published artifacts should be cryptographically signed for provenance, with signing enforced on the release/CI path and made gracefully optional in local builds lacking signing keys.
  <sub>spec · `docs/product-spec/20-non-functional-requirements-and-quality-bar.md:41` · high · sha:5f4684bf7123</sub>
- @dexpace/core's package.json dependencies field must be a hard-committed empty object, and a CI script parses it and fails the build the moment anything is added, serving as the Node analog of SEAM-1's dependency-audit conformance check.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:34-39` · high · sha:ef06c2482048</sub>
- Every adapter package must declare @dexpace/core as a peerDependency (not a regular dependency) with a matching peerDependenciesMeta entry, guaranteeing exactly one copy of @dexpace/core in an application's dependency tree.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:40-42` · high · sha:ef06c2482048</sub>

## Constraints
- The core library MUST NOT embed a concrete HTTP transport, byte-stream I/O implementation, or wire codec, and MUST depend at runtime on nothing beyond its language's standard library plus a compile-time-only logging facade (SEAM-1).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:7-7` · high · sha:8014d2ec2c9d</sub>
- Each external concern that has a core-owned contract MUST be exposed as exactly one narrow interface — the enumerated seams are byte-stream provider, synchronous transport, asynchronous transport, wire codec, and operation-input-to-request projection — and the core MUST NOT reference any concrete implementation of a seam by name (SEAM-2).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:8-8` · high · sha:8014d2ec2c9d</sub>
- Without the peerDependency declaration, npm's nested resolution can silently install two non-identical copies of @dexpace/core (a "dual-package hazard"), which breaks instanceof/branded-symbol checks used to distinguish core types such as typed HTTP exceptions, the Tristate discriminant, and the Outcome sum type, the same way two JVM classloaders loading the same class break instanceof.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:42-48` · high · sha:ef06c2482048</sub>

## Conclusions
- The core stays small and dependency-free so a consumer's footprint is proportional to the features actually used; optional capabilities — each transport, codec, I/O backend, and async bridge — are separately installable units depending on the core plus at most one third-party library (SEAM-1, NFR-1, NFR-2).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:29-29` · high · sha:8014d2ec2c9d</sub>
- The port deliberately does not reproduce a pluggable byte-stream provider module (no @dexpace/io-* analog to sdk-io-okio3) because Web Streams are a language/runtime-standard API rather than a third-party library that SEAM-1 would need to keep out of core.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:19-26` · high · sha:ef06c2482048</sub>
- The port deliberately does not reproduce async-runtime-bridge fragmentation (no @dexpace/async-coroutines / -reactor / -netty / -virtualthreads analogs) because Node has exactly one async primitive, Promise, that every framework already inter-operates with via await, leaving only RxJS's push-based Observable as something worth bridging via @dexpace/rx sugar.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:27-32` · high · sha:ef06c2482048</sub>

## Reference
- An adapter unit (pay-for-what-you-use module) is a separately installable unit supplying one concrete capability by depending on the core plus at most one third-party library, keeping its public surface minimal so consumers compose only the units they need.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:3` · high · sha:f0b3d2058626</sub>
- A shrink-survival keep-configuration consists of retain/keep rules the SDK ships so a downstream whole-program shrinker does not eliminate reflectively-reached or runtime-wired surface.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:63` · high · sha:f0b3d2058626</sub>
- The port is organized as a pnpm workspace (pnpm-workspace.yaml, packages/*), matching the pnpm/npm-workspaces monorepo shape the Node ecosystem expects for a multi-package SDK.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:3-6` · high · sha:ef06c2482048</sub>
- TypeScript project references (composite: true, tsconfig.base.json at the root) give incremental, dependency-ordered builds, analogous to Gradle's multi-module build graph.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:4-6` · high · sha:ef06c2482048</sub>
- The @dexpace/core package contains the domain model, I/O contracts built directly on Web Streams, execution context, both pipeline layers, retry/redirect/auth, pagination, SSE parsing, the serde SPI plus Tristate<T>, the instrumentation SPI, and configuration, with no runtime dependencies.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:10-10` · high · sha:ef06c2482048</sub>
- @dexpace/core's runtime floor is any runtime with Web Streams, fetch-shaped AbortSignal, and globalThis.crypto.subtle, including Node >=18.17, current evergreen browsers, Deno, Bun, and Cloudflare Workers.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:10-10` · high · sha:ef06c2482048</sub>
- @dexpace/codec-json is the reference wire codec, wrapping JSON.parse/JSON.stringify plus Tristate wiring and Standard-Schema decode glue, with no dependency beyond a @dexpace/core peer.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:11-11` · high · sha:ef06c2482048</sub>
- @dexpace/transport-fetch is a minimal transport built on the global fetch, the zero-dependency built-into-the-runtime option, analogous to sdk-transport-jdkhttp's "no extra library, less low-level control" trade-off.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:12-12` · high · sha:ef06c2482048</sub>
- @dexpace/transport-undici is a full-featured, Node-only transport built on undici's Client/Pool/request() API, providing connection-pool tuning, trailers, and explicit socket-level cancellation, analogous to sdk-transport-okhttp's "richer, pulls in a real library" trade-off.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:13-13` · high · sha:ef06c2482048</sub>
- @dexpace/logging-pino bridges the core Logger seam to a caller-supplied pino instance, depending on pino as a peer.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:14-14` · high · sha:ef06c2482048</sub>
- @dexpace/logging-debug bridges the core Logger seam to the debug package for consumers who want a logger with no configuration story, depending on debug as a peer.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:15-15` · high · sha:ef06c2482048</sub>
- @dexpace/rx is thin optional sugar exposing pagination and SSE as RxJS Observables for teams standardized on RxJS (notably Angular shops), and is not a bridge for the request/response pivot itself.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:16-16` · high · sha:ef06c2482048</sub>
- @dexpace/shrink-test is an unpublished, dev-only package that is a bundler tree-shake smoke test mirroring sdk-shrink-test.
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:17-17` · high · sha:ef06c2482048</sub>
- Version and tooling coordinates live in one place via pnpm's catalog: protocol (pnpm >=9), referenced from every package's package.json, as the direct analog of gradle/libs.versions.toml (NFR-14).
  <sub>design · `docs/sdk-design-nodejs/02-package-and-workspace-layout.md:50-51` · high · sha:ef06c2482048</sub>

## Conflicts

## Superseded
