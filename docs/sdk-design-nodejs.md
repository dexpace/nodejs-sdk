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

## 3. Seam-by-Seam Idiomatic Mapping

### 3.1 The byte-stream provider seam → built-in Web Streams

**SEAM-3/SEAM-4** require a pluggable factory for buffers, buffered readers/writers over raw streams and byte
arrays, and ownership-on-wrap. The port satisfies the *behavioral* contract — **IO-1** through **IO-42** — without
reproducing the *pluggability* mechanism, for the reason given in §2: `ReadableStream<Uint8Array>` and
`WritableStream<Uint8Array>` are WHATWG-standard, natively implemented in Node ≥18, browsers, Deno, Bun, and
Cloudflare Workers, so choosing them is choosing the platform's own answer, not a third-party library the core would
otherwise have to avoid. `@dexpace/core` ships one concrete implementation of:

- A `Buffer`-equivalent (`ByteQueue`): a FIFO byte queue backed by a linked list of `Uint8Array` chunks, satisfying
  **IO-7**–**IO-10** with a `snapshot()` that copies (**IO-8**) and a `copyTo(window)` that does not consume
  (**IO-10**).
- `BufferedSource`/`BufferedSink` wrapping a `ReadableStreamDefaultReader`/`WritableStreamDefaultWriter`, exposing
  the typed reads of **IO-11**–**IO-16** (exact-count reads, UTF-8/charset decode via `TextDecoder`, WHATWG-line
  reads honoring `\n`/`\r`/`\r\n` per **IO-14**) and the non-consuming `peek()`/`slice(offset, count)` views of
  **IO-19**–**IO-24**, implemented as thin cursors over the same `ByteQueue` rather than re-reading the underlying
  stream (a `ReadableStream` can only be read once per reader; repeatable views are a buffering concern, exactly as
  the reference frames it).
- A `TeeSink` satisfying **IO-25**–**IO-29**, built on `TransformStream` with a side-channel tap buffer rather than
  the platform's `ReadableStream.tee()` (which duplicates a *readable* stream for two independent consumers — a
  different problem from mirroring a *sink's* writes into a bounded tap while forwarding the full payload
  untruncated).

Because there is no pluggable factory, **SEAM-5**–**SEAM-10**'s discovery/registration/conflict-resolution machinery
(install precedence, idempotent install, caching, de-duplication) is moot in the port — there is one implementation,
always present, requiring no installation call. This is the single largest simplification the Node port makes
relative to the reference, and it is a direct, mechanical consequence of the byte-stream contract no longer needing
to be kept out of the zero-dependency core.

Interop with Node's own `stream.Readable`/`Writable` (needed when a consumer wants to pipe an SDK response body into
`fs.createWriteStream`, for instance) is provided at the edge via Node's own built-in
`Readable.toWeb()`/`Readable.fromWeb()` conversions — themselves part of `node:stream` since Node 17, so this is
still a zero-added-dependency bridge, just one that only exists on Node (not on Deno/Bun/Workers, which is
acceptable: it is explicitly an interop convenience, not part of the portable contract).

### 3.2 The transport seam(s) and the async pivot → one `Promise`-returning contract

**SEAM-11** specifies a synchronous transport ("given one request, produce one response," no pre-buffering) as a
seam *distinct* from **SEAM-16**'s asynchronous transport (a future completing with a response or exceptionally).
That split exists because the JVM genuinely has two different execution models worth exposing separately: a
blocking call on a platform/virtual thread, and a non-blocking call driven through a `CompletableFuture`. Node has
no blocking network I/O in the JVM sense — there is no idiomatic "call this and park the current thread" story for
an HTTP request, because Node's single-threaded event loop makes every I/O operation asynchronous by construction.
Preserving two seams here would not preserve an invariant; it would manufacture a synchronous API that has to fake
blocking on top of an inherently async runtime (via `Atomics.wait` on a `SharedArrayBuffer`, the only way to
genuinely block Node's main thread, which is exactly the kind of hack the reference explicitly rules out for the
JVM's async-wrapping-blocking bridge in **SEAM-18** — "a naive uninterruptible sleep... is non-conforming" applies
with even more force to blocking Node's single thread).

The port therefore collapses **SEAM-11** and **SEAM-16** into one `Transport` seam:

```
interface Transport {
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>
}
```

This still satisfies **SEAM-11**'s "single-operation contract... MUST NOT pre-buffer the response body" (the
response's body remains a lazy `ReadableStream`) and **SEAM-16**'s "MUST complete either with a non-null response or
exceptionally... MUST NOT complete successfully with a null/absent value" verbatim, because a native `Promise<T>` is
already exactly that shape — it cannot resolve to nothing, and a function returning `Promise<Response>` cannot
type-check while resolving `undefined`. **SEAM-17**'s "canonical, dependency-free async primitive... interop pivot"
is native `Promise`; unlike the JVM, there is no second async ecosystem to reconcile against it, because every
Node-adjacent framework (Express, Fastify, Prisma, `node:test`, Playwright) already treats `Promise`/`await` as its
own native idiom. The four JVM async-adapter modules (`sdk-async-coroutines`/`-reactor`/`-netty`/`-virtualthreads`)
have no Node counterpart for this reason; the one adapter this port does ship, `@dexpace/rx`, exists only because
RxJS's `Observable` is a genuinely different *shape* (push-based, multi-value, cancellable-by-unsubscribe) that some
teams prefer for pagination/SSE streams specifically (§7), not because `Promise` itself needs bridging.

**Cancellation (SEAM-13, SEAM-30, RETRY-23/24, XCUT-1/2)** is expressed end-to-end with `AbortController`/
`AbortSignal` — the platform's own purpose-built cancellation vehicle, already the idiom every native `fetch` call,
`undici` request, and Node timer API expects. This is a case where the Node-native mechanism is arguably a *better*
fit than the JVM's than the requirement's own phrasing suggests: `signal.reason` lets an aborted call carry a typed
cause (a `TimeoutError` vs. a caller-initiated `CancellationError`), so **XCUT-2**'s "timeout and cancellation must be
told apart by ambient state, not by matching a message string, even when represented by the same exception family"
is satisfied by checking `signal.reason`'s concrete class, not any string. Per-call timeouts are `AbortSignal`s
derived via `AbortSignal.timeout(ms)`, composed with a caller signal via `AbortSignal.any([...])` (both native, no
dependency) — satisfying **TRANSPORT-5**'s per-call-timeout-without-touching-the-shared-client requirement for
free, since a fresh derived signal is inherently scoped to one call.

One genuine mechanical difference from `CompletableFuture` worth flagging precisely: a `Promise` has no public
`cancel()`. `CompletableFuture.cancel()` can synchronously flip a future's internal state before its producer
notices; a `Promise` cannot be reached into from outside — cancellation is purely cooperative. The function that
produced the `Promise` must itself observe `signal.aborted` (via `signal.addEventListener('abort', ...)` or a poll
after each `await`) and reject its own `Promise`. This changes *how* **SEAM-30** ("close a response the caller will
never receive because the future already completed/cancelled") is implemented, not whether it is satisfied: the
transport's `send()` implementation must, after the underlying fetch resolves, check whether its own signal already
fired before "delivering" the response through its returned `Promise`, and if so, invoke `response.body?.cancel()`
itself rather than resolving. Because this is a fire-and-forget cleanup path, it must itself be awaited or given a
`.catch(() => {})` internally — an unhandled rejection on that cleanup path crashes the process under Node's default
`unhandledRejection` policy, a footgun with no JVM equivalent worth calling out once here and not repeating.

### 3.3 The wire-codec (serde) seam

**SEAM-19**'s bundle-of-{serializer, deserializer, declared media type} maps to a small `Serde<T>`-shaped structural
interface exposing `mediaType: string`, `serialize`, and `deserialize`. The reference implementation,
`@dexpace/codec-json`, wraps `JSON.stringify`/`JSON.parse` — genuinely zero-dependency, since `JSON` is a language
built-in, not an npm package, the same "standard library" reasoning §3.1 applies to Web Streams. Despite costing
nothing to embed, it still ships as a separate package rather than inside `@dexpace/core`, preserving **SEAM-2**'s
"core MUST NOT reference any concrete implementation of a seam by name" even though there would be no dependency
cost to violating it — keeping the core's declared media type undefaulted (**SEAM-19**'s "MUST NOT be defaulted at
the seam level") is a discipline worth keeping even where the temptation to embed the "free" implementation is
real. **SERDE-5**–**SERDE-8**'s type-witness mechanism is covered separately in §7.3, since it is the one place the
TypeScript answer is structurally different in kind from the JVM one, not just differently packaged.

### 3.4 The operation-input projection seam

**SEAM-26**/**SEAM-27** describe a per-operation method + path-template + typed path/query/header/body projection,
assembled against a base URL with RFC 3986 percent-encoding and fixed base-URL composition rules. The natural TS
shape is a plain descriptor object (method, template string with `{name}` placeholders, and typed projection
functions/maps) assembled by a small `buildRequest()` helper in `@dexpace/core` — no codegen dependency implied,
matching the parent project's own decision to defer a codegen layer (see the "no codegen module yet" project
decision) and to specify only the runtime primitive a generator would target.

One concrete gotcha worth flagging because it will otherwise be gotten wrong silently: JavaScript's built-in
`encodeURIComponent` is *not* a strict RFC 3986 unreserved-character encoder. Its unescaped set is
`A-Za-z0-9-_.!~*'()`, whereas RFC 3986's unreserved set (what **HTTP-29**/**HTTP-32** and **SEAM-27** require for
path segments and query components) is only `A-Za-z0-9-._~`. The four characters `! ' ( ) *` are RFC 3986
*sub-delims*, not unreserved, and a strictly conformant encoder must additionally percent-encode them (a known,
recurring bug source — several cloud SDKs' request-signing code has shipped this exact defect). `@dexpace/core`
wraps `encodeURIComponent` with a small additional replace pass for those four characters wherever the spec demands
strict RFC 3986 component encoding (path-segment percent-encoding per **SEAM-27**, query rendering per **HTTP-29**);
`encodeURIComponent` alone is reused unmodified only where the looser `application/x-www-form-urlencoded` semantics
apply (**HTTP-38**/**BODY-35**'s form-body encoding, which is `+`-for-space rather than `%20`, and does not need the
sub-delim fix since form encoding never claimed RFC 3986 compliance to begin with).

### 3.5 Discovery and the zero-dependency boundary, restated

With the byte-stream seam no longer pluggable (§3.1) and the async pivot no longer fragmented (§3.2), the only
seam that keeps a genuine discovery/registration story in the port is the **logging facade**. `@dexpace/core`
defines `Logger`/`LogEvent` as pure TypeScript structural interfaces with a shared, allocation-minimal no-op default
(§8) — and because a TypeScript interface with no runtime representation compiles away entirely (unlike an SLF4J
`compileOnly` jar, which still needs a real class file present at compile time and, if touched, at runtime), this is
in a real sense a *cheaper* zero-dependency seam than the JVM reference's own logging facade, not merely an
equivalent one.

---

## 4. Domain Model Construction

**HTTP-1**/**SEAM-29**/**HTTP-2** require immutable value + Builder construction with no public field-wise
constructor or unchecked-copy bypass. TypeScript's structural type system makes this harder to enforce than
Kotlin's nominal typing with genuinely private constructors, for two independent reasons worth separating:

1. TypeScript's `private`/`protected` modifiers are erased at compile time — a `private` field is only a
   type-checker fiction; `(instance as any).method` reaches it at runtime with no error. Real, runtime-enforced
   encapsulation in JavaScript requires ECMAScript private class fields (`#field`), which the engine itself refuses
   to let external code read, write, or even detect the existence of via reflection (`Object.keys`,
   `JSON.stringify`, `Reflect.ownKeys` all skip them). The port uses `#field` for every piece of state a model
   class holds, and exposes only `get` accessors and the builder's `build()` as the way to construct or read one —
   `private constructor` alone is not load-bearing and is used only as a secondary, compile-time signal for callers
   inside the same package.
2. TypeScript's structural typing means a *public* type like `interface Request { readonly method: Method; readonly
   url: URL; ... }` can be satisfied by any object literal shaped like it, entirely bypassing the builder and its
   validation (**HTTP-4**'s "required-field validation," **HTTP-7**'s "reject a body on GET/HEAD/TRACE/CONNECT").
   This hole cannot be fully closed in TypeScript — it is an acknowledged, structural limitation of the language,
   not an oversight, and is recorded as such in §10. The mitigation is to keep the *public* surface a concrete class
   (not a bare structural interface) exported from each package's single entry point, with the class itself as the
   only spelled type consumers are meant to name; a caller who deliberately duck-types past that is knowingly
   opting out of the invariant, the same way a JVM caller who reaches for unsafe reflection opts out of a sealed
   hierarchy's guarantees.

`newBuilder()` (**HTTP-3**) is a method on every model class returning a pre-filled builder that defensively copies
every mutable collection (arrays via spread, header/query maps via `new Map(...)`) rather than aliasing the
source's internals. Required-field validation is single-sourced (**SEAM-29**) through one shared helper —
`requireField(value, name)`, thrown as a common `RequiredFieldError` with the exact message form `` `${name} is
required` `` — used by every builder's `build()`, so **HTTP-4**'s field-named errors cannot drift between models.

Read-only collection exposure (**HTTP-5**) has a cheaper answer in the port than in the JVM reference. Kotlin's
unmodifiable-collection wrappers still allow re-reading a *live* backing collection through an unmodifiable view, so
the reference must additionally defensive-copy at build time and wrap with an unmodifiable type on top. Because
`@dexpace/core`'s models are genuinely immutable once built (§4's whole point), the defensive copy only needs to
happen *once*, at construction: `Object.freeze(new Map(headerEntries))` computed in the constructor and returned by
reference from every subsequent getter call, rather than re-copied per access the way an unmodifiable-wrapper
pattern would. `Object.freeze` is shallow — it prevents adding/removing/reassigning the frozen collection's own
entries but would not, by itself, protect a nested mutable value stored inside it — so every nested collection (each
header's value array, for instance) is frozen independently at the same construction step, not relied upon to
freeze transitively.

The `Headers` model (**HTTP-13**–**HTTP-22**) is a class wrapping two parallel maps: a lower-cased key → value-array
map for case-insensitive lookup/mutation/equality, and a lower-cased key → original-casing map for wire emission,
directly satisfying "case-insensitive for storage... preserving original casing." `MediaType`, `Status`, `Protocol`,
and the typed header-name type follow the reference's value-type-with-factory pattern (**HTTP-23**, **HTTP-33**,
etc.) as plain frozen classes reconstructed through a `parse`/`of` static factory rather than a builder, matching
the reference's own "value-based types with no builder... re-constructed through their factories" (**HTTP-3**).

The shared `Builder<T>` generic contract (**SEAM-29** restated) is a one-line structural interface —
`interface Builder<T> { build(): T }` — and, being structural, any class exposing a `build(): T` method already
satisfies it with no explicit `implements` clause required, which is if anything a closer match to the requirement's
intent ("generic composition helpers can accept any builder") than Kotlin's own nominal interface, since TypeScript
never forces a class to declare conformance it structurally already has.

---

## 5. Pipeline Architecture

The two cooperating layers translate cleanly because Node's own web-framework ecosystem already converged on almost
exactly this shape independently. The **stage-based pipeline** (§8.1 of the spec) — an ordered list of bidirectional
steps, each able to inspect the inbound request, invoke the rest of the chain, and inspect/substitute the outbound
response — is structurally identical to the "onion" middleware composition pattern every Koa-descended Node HTTP
framework (Koa itself, tRPC's middleware, Apollo Server's plugin model) already implements. This is worth stating
plainly: the port is not fighting the ecosystem to reproduce this layer, it is reusing an idiom Node engineers
already carry into the codebase.

A step is a function, not an interface implementation:

```
type Step = (request: Request, next: Next) => Promise<Response>
type Next = () => Promise<Response>
```

**PIPE-1**–**PIPE-8**'s fixed stage ordering (an outer-to-inner precedence chain
`PRE_REDIRECT → REDIRECT → RETRY → AUTH → LOGGING → SERDE → SEND`, sparse numeric stage keys per **PIPE-3**) is a
frozen `Stage` enum with pillar stages validated at composition time to admit at most one step (**PIPE-4**/**PIPE-5**,
distinguished by reference identity for idempotent re-installation per **PIPE-6**). Composition flattens the staged
buckets into one ordered array exactly once, at build time (**PIPE-25**), producing an immutable runtime.

The one place the port must deliberately diverge from an off-the-shelf library like `koa-compose` is
**PIPE-15**/**PIPE-16**'s fork semantics: a step that re-drives the downstream chain more than once (a redirect
following a hop, retry re-attempting, auth retrying after a 401 challenge) must invoke a *fresh* continuation each
time, resuming from the *same* position in the step array as its own invocation, never reusing an
already-invoked `next` handle. `koa-compose` treats calling `next()` twice as a bug and throws
`"next() called multiple times"` — the correct default for ordinary middleware, and the wrong default for a pillar
step whose entire job is controlled re-invocation. The port's composition function therefore exposes two distinct
capabilities to a step: a plain `next()` that enforces single-invocation (satisfying **PIPE-15**'s "reusing the
handle... MUST be treated as a defect" for every ordinary step), and an explicit `fork(): Next` available only to
steps occupying a pillar stage, which captures the calling step's position in the flattened array and returns a
*new*, independently-advancing continuation bound to that same starting position each time it is called — directly
implementing "a forked cursor MUST resume from the SAME position as its parent... forks advancing independently."

The **recovery-chain primitives** (§8.2 of the spec) map onto a TypeScript discriminated union, arguably a more
natural fit here than in Kotlin's `sealed class` modeling of the same two-variant sum type:

```
type Outcome<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly error: unknown }
```

`fold()` over this union gets compiler-checked exhaustiveness via a `never`-typed default branch, satisfying
**RECOV-1**'s "mutually exclusive and jointly exhaustive... a fold that applies exactly one of two branches at most
once per call" with no runtime discriminant logic beyond a `switch` on `kind`. The request-recovery chain
(**RECOV-3**) and response/recovery-step folds (**RECOV-4**–**RECOV-9**) are plain `async` reduce-style folds over
an ordered array of step functions; **RECOV-2**'s "every throwable from any step or the transport invocation MUST be
caught and converted to a Failure" is one `try`/`catch` wrapping the whole orchestrator dispatch, converting a thrown
value (which in JavaScript can legally be any value, not only an `Error`, another JS-specific wrinkle worth a single
footnote) into the `Failure` variant.

Because there is only one execution model (§3.2), **PIPE-28**'s "the async runtime MUST reuse identical stage
identities as the sync runtime; the two MUST NOT each re-derive ordering independently" is trivially, structurally
true: there is no second, synchronous pipeline whose ordering could drift from this one. **PIPE-33**/**PIPE-34**'s
sync-to-async and async-to-sync bridges have no Node counterpart to build, for the same reason — there is no
synchronous side to bridge from or to. This is the pipeline-layer instance of the same simplification argued in §3.2
for the transport seam, and it is real: two entire subsystems of bridge code the reference needs (§8.1's "Bridges"
subsection, **PIPE-33**–**PIPE-35**) simply do not exist in the port.

Response-lifecycle discipline across re-drives (**PIPE-40**: close every superseded intermediate response, never
close the one finally returned) maps onto `ReadableStream.cancel()` for an unread body and the SDK's own
`Response.close()` (which cancels the underlying stream and releases the transport's connection handle) for a body
that may have been partially read. A step that re-drives the chain via `fork()` is responsible for calling `close()`
on whatever response its own prior attempt produced before invoking the fork again, mirroring the reference's
placement of this responsibility on "a wrapping step that re-drives the chain," not on the pipeline runtime itself.

---

## 6. Retry, Redirect, and Authentication

**Single-sourcing** (the idempotent-method set of **HTTP-9**/**RETRY-6**, the retryable-status set of
**RETRY-1**/**XCUT-5**/**XCUT-7**, the shared backoff calculator of **RETRY-13**) is, if anything, easier to
guarantee correct in the port than in the reference: ES modules are singletons by default, so a single
`retryPolicy.ts` module exporting `IDEMPOTENT_METHODS`, `RETRYABLE_STATUSES`, and `computeDelay()` cannot silently
exist twice the way two JVM classloaders can each load their own copy of a class. Every consumer imports the same
frozen `Set`/function from the same module specifier; there is no second copy to drift.

The **backoff calculator** is a pure function taking the attempt number, a settings object
(`initialDelayMs`, `multiplier`, `maxDelayMs`, `jitter`), and an injectable random source (defaulting to
`Math.random`, overridable in tests the same way the spec's injectable clock seam, **CFG-15**, wants time
deterministically controllable) — satisfying **RETRY-9**–**RETRY-11** verbatim, including overflow-safe saturation
to the cap rather than throwing. The non-blocking inter-attempt wait (**RETRY-26**, "MUST NOT pin an execution
carrier") is close to a non-issue in Node — there are no carrier threads to pin — but the wait must still be
promptly cancellable (**XCUT-3**): implemented as a `Promise` racing a `setTimeout` against the same `AbortSignal`
used for the call's own cancellation (§3.2), clearing the timer on early abort so no dangling timer keeps the event
loop alive.

**Retry-After parsing** (**RETRY-15**–**RETRY-19**) cannot lean on `new Date(str)` for the RFC 1123 date variant:
JavaScript's `Date` constructor's string-parsing behavior is notoriously permissive and non-standardized across
engines (it accepts many non-conformant formats and its exact leniency differs between V8, JavaScriptCore, and
SpiderMonkey), which is the opposite of **RETRY-16**'s "MUST be total... malformed/negative/out-of-range values MUST
map to no hint, never a zero delay." The port hand-writes a small, strict RFC 1123 parser (mirroring the
reference's own **CFG-30**, which already has to special-case a lenient-but-bounded grammar rather than trust a
platform date parser) rather than risk `Date.parse`'s engine-dependent leniency silently accepting a malformed
header as a valid, wildly-wrong instant.

**One retry stack, not two.** The reference ships two cooperating retry stacks — the recovery-chain retry (with a
total-timeout budget, **RETRY-27**) and the stage-based retry step (without one, **RETRY-28**) — because it has two
pipeline layers with two different sync/async execution stories to serve. Since the port's pipeline layer is a
single execution model end to end (§5), it ships one retry step, and follows the spec's own explicit guidance for
this exact situation: "**RETRY-28**... a port that unifies retry entry points MUST make that total-timeout an
explicitly opt-in feature rather than always-on." The port's retry step therefore accepts an optional
`totalTimeoutMs` budget (undefined by default, matching **RETRY-27**'s "a zero budget disables the deadline"), with
per-attempt deadline shrinking applied only when that option is supplied.

**Body replayability and the race the port does not have.** **BODY-3**'s materialize-once guard needs a JVM
atomic compare-and-set because two threads could genuinely call `write()` on the same body concurrently. Node's
single-threaded event loop means two *synchronous* code paths can never interleave mid-statement — the entire class
of hazard **BODY-3** guards against with a CAS collapses, in the port, to "check-and-set a plain boolean flag before
the function's first `await`." This is a real, precise simplification, with one precise caveat worth stating rather
than glossing: the guard is only sound if the check-and-flip happens *before* the first `await` inside the guarded
`async` function — once execution has suspended at an `await`, another logical call can interleave on the same
event-loop turn, and a flag flipped only *after* an `await` reintroduces exactly the race the JVM reference needs an
atomic for. The port's materialize-once helper is written to flip its guard synchronously as the first statement of
the function, before any `await`, specifically to make this collapse valid.

**Redirect credential hygiene** (**REDIR-7**–**REDIR-13**) benefits from a genuinely better-behaved primitive than
the JVM reference had available: the WHATWG `URL` class (global, spec-identical across every JS runtime) never
performs DNS resolution to compare origins, unlike `java.net.URL`'s notorious `equals()`/`hashCode()`, which the
reference's own **HTTP-46** has to explicitly work around ("some platforms' native URL equality resolves the host —
blocking, and wrong for virtual hosts sharing an IP"). Cross-origin detection (**REDIR-8**: scheme, host, and
effective port compared against the *seed* origin) is `new URL(target).origin !== seedOrigin` after normalizing
default ports, with no blocking-call risk to design around in the first place.

**Digest authentication** (**AUTH-15**–**AUTH-22**) needs cryptographic primitives the reference draws from the
JVM's own standard library (`java.security.MessageDigest`, `SecureRandom`) — the same "standard library, not a
runtime dependency" reasoning applies to Node's built-in `node:crypto`, with one genuine complication worth being
precise about rather than hand-waving past. If `@dexpace/core` is to stay portable to browsers/Deno/Cloudflare
Workers (§3.1's whole premise), it should prefer the Web Crypto API (`globalThis.crypto.subtle`, universal across
those runtimes) over Node-specific `node:crypto` — but Web Crypto's `subtle.digest()` deliberately does not
implement MD5 (the algorithm is excluded from the standard on security grounds), while RFC 7616 Digest still
requires MD5/MD5-sess support for interoperability with servers that have not adopted SHA-256. The concrete answer:
`@dexpace/core` implements MD5 itself in a small, self-contained, dependency-free TypeScript module (the algorithm
is short and stable; several such implementations exist as public-domain reference code, none of them warrant an
npm dependency), and uses `crypto.subtle.digest('SHA-256', ...)` for the SHA-256/SHA-256-sess algorithms, which Web
Crypto does support natively. The cryptographically-strong client nonce (**AUTH-20**, ≥128 bits of entropy) uses
`crypto.getRandomValues()` (Web Crypto, universal) rather than `Math.random()`, exactly mirroring the reference's
requirement that it come from a CSPRNG, never a non-cryptographic RNG (**XCUT-21**).

---

## 7. Pagination, SSE, and Serialization

### 7.1 Pagination as async generators

**PAGE-1**'s two consumption views — item-level and page-level, over one lazy walk — map onto two `async function*`
generators sharing one internal drive routine, exposed to callers as `AsyncIterable<T>` (i.e., implementing
`Symbol.asyncIterator`, consumable via `for await...of`, the language's own native lazy-pull-iteration protocol).
Page-laziness (**PAGE-6**: zero exchanges until the consumer first probes for data) is not something the port has to
engineer — a generator function's body does not execute at all until its iterator's first `.next()` call, so
"constructing the paginator... triggers zero exchanges" is true by construction, not by careful bookkeeping.

Close-on-abandon (**PAGE-11**, **PAGE-12**) is the strongest example in this port of a spec requirement the host
language gives away for free where the reference had to build a bespoke mechanism. Kotlin's `Iterator`/`Sequence`
protocol has no built-in early-termination cleanup hook, which is exactly why the reference needs its own
`CloseablePages` wrapper type and an explicit "consumers must wrap the view in a scoped/auto-close construct"
convention. JavaScript's iterator protocol *does* have one: when a `for await...of` loop exits early — a `break`, a
`return`, or an exception propagating out of the loop body — the runtime automatically calls `.return()` on the
async iterator, which for a generator means resuming execution at whatever `finally` block currently encloses the
last executed `yield`. The port's item-level generator is therefore simply:

```
async function* items(): AsyncGenerator<Item> {
  for await (const page of pages()) {
    try { yield* page.items }
    finally { await page.close() }
  }
}
```

and an early `break` out of the consumer's `for await` loop drives the `finally` — and therefore `page.close()` —
automatically, with no wrapper type and no documented "must remember to close" convention required from callers.
The page-level view's two-outstanding-pages buffering (**PAGE-12**: a `hasNext()` probe eagerly runs the next
exchange, so an abandoned probe must not strand that prefetched page) is a one-slot look-ahead buffer held in the
generator's own closure, released the same way via `finally`.

**Verbatim query splice** (**PAGE-21**–**PAGE-24**) is the one place in this subsystem where the obvious
platform tool is the wrong tool. `URLSearchParams` exists natively and could plausibly rewrite a query parameter in
one line — but it re-serializes the *entire* query string through its own canonical encoding on every mutation,
which reorders and re-encodes untouched parameters (contrary to **PAGE-21**'s "every untargeted parameter is copied
byte-for-byte... order preserved") and encodes space as `+` rather than the RFC 3986 `%20` this port's query model
otherwise standardizes on (**HTTP-29**). The rewriter operates on the raw query substring directly — locating the
targeted parameter by hand-rolled tokenization, splicing only its value, and leaving every other byte of the query
string untouched — the same discipline the reference's own custom encoder already has to apply, for the identical
reason.

### 7.2 SSE as async generators, parsed by hand

The browser platform already ships a native `EventSource` implementing WHATWG SSE — and it is the wrong building
block for this SDK for three concrete reasons: it auto-reconnects (directly contrary to **SSE-38**'s "MUST NOT
auto-reconnect... reconnection... remains the caller's responsibility"), it is GET-only with no custom-header
support (incompatible with an SDK whose SSE streams typically ride behind an authenticated, possibly-non-GET
request), and it does not exist in Node at all without a polyfill package. `@dexpace/core` therefore hand-implements
the WHATWG line/field grammar (**SSE-1**–**SSE-19**) as a small synchronous state machine operating over the same
`BufferedSource` line-reading primitive from §3.1, exposed as an `AsyncGenerator<SseEvent>` — the identical
async-generator idiom §7.1 uses for pagination, and for the identical reason: `for await...of`'s automatic
`.return()`-on-abandon gives **SSE-25**'s "a partial consume MUST NOT strand the resource" the same way it gives
**PAGE-11**/**PAGE-12** their close-on-abandon guarantee, with the stream facade's `finally` block invoking
`response.body.cancel()` exactly once (**SSE-23**, **SSE-28**) regardless of which termination path — clean
end-of-stream, explicit break, or a mid-stream parse failure — triggered it. The typed adapter's Skip/Done/Value
outcomes (**SSE-33**–**SSE-36**) are a second, smaller instance of the same `Outcome`-shaped discriminated union
introduced in §5, reused rather than re-invented.

### 7.3 Serde: schema-as-witness instead of reflective type capture

**SERDE-5**–**SERDE-8** are stated as a defense against JVM generic erasure: a decoder given only an erased
`List<T>` cannot recover `T` at runtime, so the reference forces callers through an explicit runtime type token
(Jackson's `TypeReference<T>`, itself reconstructed via a reflective trick — subclassing to capture
`getGenericSuperclass()`). TypeScript's situation looks superficially similar — "TypeScript types vanish at
runtime" — but is actually a *different and, in one sense, more severe* problem: JVM generics erasure loses only the
*parameter* of a generic type; the raw class token (`Foo.class`) still exists and is still reflectively inspectable.
TypeScript erases *everything* — there is no runtime representation of a type at all, not even a raw class object,
unless the code explicitly constructs one. Reflection cannot recover what was never emitted; there is no
`getGenericSuperclass()`-style trick available, because there is no bytecode-level type metadata to reflect over in
the first place.

The concrete answer this design proposes is not to *recover* an erased type at runtime — that is not achievable in
TypeScript — but to require the caller to supply a **runtime value that already carries the same information a
reflective type token would have reconstructed**: a schema object. `@dexpace/core`'s `Deserializer<T>` seam takes,
in place of a type token, any value conforming to a minimal structural interface — `{ parse(input: unknown): T }` —
matching the shape shared today by Zod, Valibot, ArkType, and effect/schema, and increasingly formalized by the
community's emerging "Standard Schema" convention. `@dexpace/core` defines only that tiny structural interface; it
does not implement, bundle, or depend on any concrete schema library, preserving **SEAM-1**/**SEAM-19** exactly.
`@dexpace/codec-json` ships the glue: decode raw text via `JSON.parse`, then run the caller-supplied schema's
`parse()` over the resulting value.

This directly satisfies **SERDE-5**'s "explicit runtime type witness rather than erased/inferred generic" — the
schema value *is* the witness, and because TypeScript infers the decode function's static return type from the
schema's own generic parameter (`schema: StandardSchema<T>` yields `Promise<T>` from `deserialize(schema)`), the
compile-time type and the runtime witness are the same artifact, not two things kept in sync by convention. It also
gives a cleaner answer to **SERDE-6**'s parametric-target case (`List<Dto>`) than the reference's own mechanism:
Jackson's `TypeReference` for a parametric type still has to reconstruct a `java.lang.reflect.Type` graph at
runtime through reflection; a schema for an array of `Dto` is just `z.array(DtoSchema)` (or the equivalent in any
Standard-Schema-compatible library) — a combinator built from the element schema, supplied directly by the caller as
data, with no reflective reconstruction step needed anywhere, because nothing was ever erased that needs
reconstructing — the caller simply states the parametric structure once, as a value, and both the runtime witness
and the static type fall out of that one statement together. **SERDE-8**'s "reject construction with no type
argument or an unresolved type variable" has no equivalent failure mode to guard against in the port: since nothing
is ever inferred from an erased generic parameter at runtime, there is no "unresolved type variable erasing to its
bound" state reachable in the first place — the TypeScript compiler already refuses to accept a call site missing a
concrete schema value, which is a compile-time rejection, earlier and stronger than the reference's own
runtime-thrown guard.

**`Tristate<T>`** (**SERDE-14**–**SERDE-20**) is a three-branch discriminated union —
`{ kind: 'absent' } | { kind: 'null' } | { kind: 'present', value: T }` — with `Tristate.present()` constrained so a
`null` value cannot type-check as its argument (making the illegal fourth state unrepresentable at the type level,
not just by runtime validation, which is a strictly earlier catch than the reference's own construction-time
rejection). The tricky half of **SERDE-15** ("Absent MUST omit the key entirely; Null MUST emit the key with a wire
null") has a clean, built-in answer on the *encode* side: `JSON.stringify`'s second argument accepts a `replacer`
function invoked once per key, which may return `undefined` to have that key omitted from the output entirely —
exactly the mechanism this requirement needs, built into the language rather than requiring custom object-shape
massaging before serialization. `@dexpace/codec-json` installs a shared replacer recognizing `Tristate` values by a
branded tag and returning `undefined` for Absent, `null` for Null, and `.value` for Present. The *decode* side has no
equivalent built-in hook (a `JSON.parse` reviver runs bottom-up per key with no visibility into the enclosing DTO's
declared shape, so it cannot itself decide "this key was Tristate-typed"), which mirrors the reference's own
observation in **SERDE-17** that a missing key is short-circuited by the codec before any decoder-level null hook
runs — the port resolves it the same way the reference does, one layer up: the schema-based decode step from
earlier in this section interprets absent/null/present against a small `tristate(innerSchema)` combinator that
`@dexpace/codec-json` provides, rather than trying to make the raw JSON layer aware of Tristate at all.

---

## 8. Instrumentation and Configuration

The logging facade (§3.5) is `Logger`/`LogEvent` structural interfaces with one shared, allocation-minimal no-op
default installed process-wide until a consumer supplies a real one — satisfying **OBS-1**'s "disabled path
allocates nothing" as a single frozen object whose methods all return `this` and whose terminal `emit()` is a no-op,
identical in spirit to the reference's own no-op tracer/meter defaults (**OBS-25**, **OBS-31**). `@dexpace/logging-
pino` and `@dexpace/logging-debug` are the two reference bridges, chosen because they represent the two poles of
the Node logging ecosystem worth supporting explicitly: `pino` is the dominant high-throughput structured-JSON
logger (a natural fit for this SDK's field/structured-event model), and `debug` is the zero-configuration
"just works for a library" option most Node engineers already have wired into their terminal output — the closest
Node analog to "implement SLF4J, hand it to whichever backend the application already runs."

For **W3C Trace Context** (**OBS-26**/**OBS-27**), the port makes a deliberate ecosystem-fit choice the JVM
reference did not have available: rather than inventing a bespoke `Tracer`/`Span` interface from scratch, the
`Tracer`/`Span` seam is defined as a structural subset of `@opentelemetry/api`'s own `Tracer`/`Span` shapes. Node's
tracing ecosystem has, unlike the JVM's, largely converged on one dominant API (`@opentelemetry/api`), so an
application already running OpenTelemetry auto-instrumentation gets this SDK's HTTP spans wired in with zero
adapter code — pure duck-typing compatibility, no dependency added to `@dexpace/core` — while an application with no
tracer installed still gets the same no-op default **OBS-25** requires. Redaction (**OBS-11**–**OBS-19**) is
implemented directly against the global `URL` class — userinfo stripping, allow-listed query-parameter redaction
via `url.searchParams`, and manual fragment-token redaction (since `URL` does not parse `key=value` tokens out of
`url.hash`, that half is hand-rolled the same way the reference's own fragment handling is, per **OBS-13**).

**Configuration layering** (**CFG-1**) specifies four tiers: an explicit override, the environment, the *system
property* layer (queried under a normalized dotted-lowercase key), and a default. Node has no system-properties
analog — there is no ambient, JVM-style key/value store distinct from environment variables — so the port's
layering genuinely collapses to three tiers: override, environment, default. This is stated plainly as a platform
difference, not smoothed over by inventing a fake middle tier (e.g., routing a fabricated "system property" through
`process.env` under a different key would just be a second environment lookup wearing a different name, adding
complexity without adding a genuinely distinct source). Applications wanting a `.env`-file-driven layer get it by
loading `dotenv` (or equivalent) at their own bootstrap, before the SDK ever reads `process.env` — that convention
lives entirely outside `@dexpace/core`, which stays unaware that `.env` files exist, the same way the JVM reference
stays unaware of any particular properties-file-loading convention beyond the bare `System.getProperty` seam.

The never-throw typed accessors (**CFG-5**–**CFG-7**) are pure functions with the same tolerant-parsing rules
translated directly — the ISO-8601 duration grammar has no built-in JS parser (unlike Java's
`java.time.Duration.parse`), so it is hand-rolled the same way the Retry-After date grammar in §6 is, for the
identical reason: no platform primitive to trust, and the requirement is total (never throw), so a hand-written
parser with an explicit failure-to-default fallback is the only option regardless.

Node's `globalThis.performance.now()` — spec-guaranteed monotonic, available identically across Node, browsers,
Deno, Bun, and Cloudflare Workers — is the `Clock` seam's elapsed-time primitive (**CFG-16**), chosen over the
Node-specific, higher-resolution `process.hrtime.bigint()` for the same cross-runtime-portability reason Web Streams
were chosen over Node streams in §3.1; a Node-specific extension may substitute `process.hrtime` where
sub-millisecond precision genuinely matters and portability to non-Node runtimes is not a goal for that particular
build. The proxy model (**CFG-22**–**CFG-28**) resolves `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from the environment
only — Node has no system-properties layer to prefer first the way `CFG-24` prefers `https.proxyHost` over an
environment URL, so this is a second, smaller instance of the same three-tier-to-two-tier collapse already stated
for configuration generally, not a new deviation.

---

## 9. Toolchain and Quality Gates

Every gate CLAUDE.md documents as enforced by the Gradle build has a direct Node-ecosystem counterpart; the port's
CI pipeline should wire each in as a blocking step the same way `./gradlew build` blocks on all of them together.

| Gradle gate | Node/TS equivalent |
|---|---|
| ktlint + detekt (`config/detekt.yml`) | ESLint with `@typescript-eslint`'s `strict-type-checked` + `stylistic-type-checked` configs |
| `allWarningsAsErrors` | `tsc --noEmit --strict` (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) as a required CI step |
| Explicit-API strict mode | `@typescript-eslint/explicit-module-boundary-types` + `explicit-function-return-type` lint rules |
| `apiCheck`/`apiDump` (binary-compat snapshots) | `api-extractor` generating a committed, reviewable `.api.md` report per package |
| Kover 80% aggregate line-coverage floor | `c8`/`@vitest/coverage-v8` with a `coverage.thresholds` aggregate floor wired into the default `test` script |
| R8 shrink-survival guard (`sdk-shrink-test`) | `@dexpace/shrink-test`: an esbuild/Rollup production build asserting a bundle-size budget and a post-tree-shake runtime smoke test |
| Cross-compile toolchain discipline (JDK 8 bytecode vs. newer stdlib symbols) | `engines.node` vs. `tsconfig` `lib`/`target` agreement |
| `gradle/libs.versions.toml` | pnpm workspace `catalog:` protocol |
| GPG-signed publications, staging repo | `npm publish --provenance` (Sigstore-based build provenance) |

A few of these deserve more than a table row.

**The API-compatibility gate** (**NFR-4**) is the one place a close, purpose-built analog already exists rather than
needing to be assembled from parts: `api-extractor` (part of Microsoft's Rushstack tooling, built for exactly this
problem on large TypeScript SDKs) rolls up a package's public surface into one `.api.md` report, fails CI on any
undeclared drift, and is regenerated and committed alongside an intentional change — the identical workflow
`apiDump` gives the Kotlin reference, down to "never regenerate to silence an unintentional break" being the same
review discipline in both ecosystems.

**The dead-code-elimination survival gate** (**NFR-8**/**NFR-9**) has a genuinely smaller risk surface in this port
than the JVM shrink-test guards against, and the smoke test should be scoped accordingly rather than mechanically
copying R8's shape. R8/ProGuard's hardest problem is reflection: code invoked only via annotation processing,
`ServiceLoader`, or reflective construction looks unreachable to a static analyzer and gets stripped unless
explicitly kept. JS bundlers (esbuild, Rollup) analyze a purely static `import`/`export` graph with no reflection
equivalent to trip over, so that entire failure class does not apply here — a large part of why §3.1 could retire
the `IoProvider` discovery mechanism outright is that nothing in this port needs runtime, reflection-driven
plugin resolution to begin with. The risk that *does* carry over is the dual-package hazard noted in §2: a bundler's
module-scope hoisting or a misconfigured peer-dependency resolution could theoretically cause two non-identical
copies of `@dexpace/core` to end up in one bundle, silently breaking the `instanceof` checks the typed exception
hierarchy and the `Outcome`/`Tristate` discriminated unions rely on. `@dexpace/shrink-test`'s runtime smoke test
therefore specifically exercises a cross-package check — e.g., catching an error thrown by `@dexpace/transport-
fetch` via `instanceof HttpError` imported from `@dexpace/core` — surviving a full bundle-and-tree-shake round trip,
in addition to a plain bundle-size budget assertion (via `size-limit`/`bundlesize`) catching the more mundane failure
mode of one adapter accidentally pulling in another.

**Runtime-floor discipline** (**NFR-10**) reproduces the same trap CLAUDE.md documents for
`sdk-transport-jdkhttp`/`sdk-async-virtualthreads` — a toolchain compiling against a newer standard-library surface
than the artifact's declared floor, producing a symbol reference that link-checks fine on the build machine but
fails at call time on an older runtime (`NoSuchMethodError` on the JVM; a plain `TypeError: X is not a function` in
Node). The TypeScript-specific version of this trap is a `tsconfig.json` `lib` setting newer than the package's
declared `engines.node` floor — for instance, `lib: ["ES2023"]` type-checks a call to
`Array.prototype.toSorted` cleanly while `engines.node: ">=18.17"` promises a runtime that does not have it,
producing exactly the same class of silent, deferred-to-call-time failure the JVM side already learned to guard
against. Each package's `tsconfig` `lib`/`target` must be pinned to match its own declared `engines.node` floor, not
inherited loosely from whatever the workspace root happens to use for editor tooling, and CI should run the built
output — not just `tsc --noEmit` — against each package's declared minimum Node version in addition to current LTS,
the direct analog of running each JVM module's tests against its declared toolchain rather than trusting the
compiler alone.

---

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
