## 2. Package and Workspace Layout

The port is a pnpm workspace (`pnpm-workspace.yaml`, `packages/*`), matching the pnpm/npm-workspaces monorepo shape
the wider Node ecosystem already expects for a multi-package SDK. TypeScript project references
(`composite: true`, `tsconfig.base.json` at the root) give incremental, dependency-ordered builds — the Node analog
of Gradle's multi-module build graph.

| Package | Purpose | Runtime floor | Dependencies |
|---|---|---|---|
| `@dexpace/core` | Domain model, I/O contracts (built directly on Web Streams, not pluggable — see §3.1), execution context, both pipeline layers, retry/redirect/auth, pagination, SSE parsing, the serde SPI + `Tristate<T>`, the instrumentation SPI, configuration. | Any runtime with Web Streams, `fetch`-shaped `AbortSignal`, and `globalThis.crypto.subtle` (Node ≥18.17, current evergreen browsers, Deno, Bun, Cloudflare Workers). | none |
| `@dexpace/codec-json` | Reference wire codec: `JSON.parse`/`JSON.stringify` plus `Tristate` wiring and Standard-Schema decode glue (§7.3). | same as core | none beyond a `@dexpace/core` peer |
| `@dexpace/transport-fetch` | Minimal transport built on the global `fetch`. The zero-dependency, built-into-the-runtime option — the Node analog of `sdk-transport-jdkhttp`'s "no extra library, but less low-level control" trade-off. | same as core | none beyond a `@dexpace/core` peer |
| `@dexpace/transport-undici` | Full-featured transport built on `undici`'s `Client`/`Pool`/`request()` API: connection-pool tuning, trailers, explicit socket-level cancellation. The Node analog of `sdk-transport-okhttp`'s "richer, but pulls in a real library" trade-off. | Node only | `undici` |
| `@dexpace/logging-pino` | Bridges the core `Logger` seam to a caller-supplied `pino` instance. | Node/any pino-compatible runtime | `pino` (peer) |
| `@dexpace/logging-debug` | Bridges the core `Logger` seam to the ubiquitous zero-config `debug` package, for consumers who want a logger with no configuration story at all. | any | `debug` (peer) |
| `@dexpace/rx` | Thin optional sugar exposing pagination and SSE as RxJS `Observable`s for teams already standardized on RxJS (notably Angular shops). Not a bridge for the request/response pivot itself — see §3.2. | any | `rxjs` (peer) |
| `@dexpace/shrink-test` | Unpublished. A bundler tree-shake smoke test mirroring `sdk-shrink-test` (§9). | — | dev-only |

Two things the Kotlin module map has that this layout deliberately does not reproduce, both argued in full in §3:

- **No pluggable byte-stream provider module** (no `@dexpace/io-*` analog to `sdk-io-okio3`). The reason `sdk-core`
  cannot embed Okio is that Okio is a third-party library, and **SEAM-1** forbids the core from depending on one.
  Web Streams are not a third-party library in the same sense — they are a language/runtime-standard API, as much
  "the standard library" as `java.io` is for the JVM reference. There is nothing to keep out of core, so there is
  nothing to make pluggable. `@dexpace/core` implements its buffered-source/sink/tee-sink contracts directly against
  `ReadableStream`/`WritableStream`, with zero `IoProvider`-style discovery machinery.
- **No async-runtime-bridge fragmentation** (no `@dexpace/async-coroutines` / `-reactor` / `-netty` /
  `-virtualthreads` analogs). Every one of those four Kotlin modules exists to bridge one ecosystem's async
  primitive to `CompletableFuture`. Node has exactly one async primitive that matters — `Promise`, which every
  framework, test runner, and ORM already inter-operates with via `await` — so there is nothing left to bridge
  except the one ecosystem (RxJS) that still prefers push-based `Observable`s over `Promise`s, and even that bridge
  is sugar, not plumbing (§3.2).

**Enforcing SEAM-1's zero-runtime-dependency invariant** in an npm-based dependency graph uses two mechanisms
together, since npm has no first-class "compile-only" scope the way Gradle's `compileOnly` gives SLF4J:

1. `@dexpace/core`'s `package.json` `dependencies` field is a hard-committed empty object; a CI script parses it and
   fails the build the moment anything is added, the direct Node analog of the SEAM-1 dependency-audit conformance
   check.
2. Every adapter declares `@dexpace/core` as a `peerDependency` (not a regular dependency) with a matching
   `peerDependenciesMeta` entry, so an application installing `@dexpace/transport-undici` and
   `@dexpace/codec-json` side by side is guaranteed exactly one copy of `@dexpace/core` in its dependency tree. This
   matters beyond bundle size: several core types (typed HTTP exceptions, the `Tristate` discriminant, the
   `Outcome` sum type in §5) are distinguished by `instanceof`/branded-symbol checks, and npm's nested resolution
   can otherwise silently install two non-identical copies of a package — a "dual-package hazard" that breaks those
   checks the same way two JVM classloaders loading the same class would break `instanceof`, without Gradle's
   project-dependency graph to prevent it structurally. The peer-dependency declaration is what makes npm/pnpm
   dedupe to one instance instead.

Version and tooling coordinates live in one place via pnpm's `catalog:` protocol (pnpm ≥9) referenced from every
package's `package.json` — the direct analog of `gradle/libs.versions.toml` (**NFR-14**).

---

