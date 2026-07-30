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

