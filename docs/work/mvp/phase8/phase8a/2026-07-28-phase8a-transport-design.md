# Phase 8a — Transport Adapters — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the concrete `Transport` implementations — `@dexpace/transport-fetch` and
`@dexpace/transport-undici` — satisfying `docs/product-spec/17-transport-adapter-conformance-contract.md`
(`TRANSPORT-1`–`TRANSPORT-30`), plus the nine Deferred Items Log rows the
[Phase 8 segmentation design](../2026-07-28-phase8-segmentation-design.md) routed here: `SEAM-30`/`SEAM-14`/
`SEAM-12` (Phase 2), the transport half of `NFR-2` and `NFR-15` (Phase 0), `FileBody` (Phase 3b brainstorm), and
the `challengeHandler` protocol (Phase 7a brainstorm). This is the first of two Phase 8 sub-phases; 8b
(`@dexpace/rx`, `§18`) has no dependency on this one and may execute in either order.

**Governing documents:** `docs/product-spec/17-transport-adapter-conformance-contract.md` (normative, cited by ID
throughout), `docs/work/mvp/phase8/2026-07-28-phase8-segmentation-design.md` (the cut, the collapse tables, the
open items this document resolves), `docs/work/mvp/phase2/2026-07-23-phase2-seam-foundations-design.md` (the
`Transport` interface, `composeSignal`/`isTimeoutSignal`/`CancellationError`), `docs/work/mvp/phase3/phase3b/
2026-07-25-phase3b-body-lifecycle.md` (`Body`, `Request.body`, `Response.body`/`.close()`),
`docs/sdk-design-nodejs/02-package-and-workspace-layout.md`, `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md`
§3.2, `docs/knowledge/{transport-adapter,concurrency-and-async,message-bodies,resource-management,
package-and-dependency-layout,redaction-and-security,performance,cancellation-and-timeouts,authentication,
configuration}.md`. Styleguide: `styleguide/typescript/{09-concurrency,13-resource-management,15-performance}.md`.

**How this doc was produced.** Solo, user away from keyboard, `docs/knowledge/` as standing tie-breaker, following
the same discipline the segmentation design and every prior sub-phase design applied. No packages exist yet in
this repository (confirmed: no `packages/` directory) — this document, like every phase design before it, is
planning only.

## Scope

8a ships every `TRANSPORT-*` requirement across **four published packages** — `@dexpace/transport-fetch`,
`@dexpace/transport-undici`, `@dexpace/body-file` (§5), `@dexpace/transport-shared` (§7) — plus one small
unpublished devDependency, `@dexpace/transport-conformance` (§8; precedent: `@dexpace/shrink-test`). It does
**not** ship `§18`'s `ASYNC-*` requirements or `@dexpace/rx` — that is 8b's, with zero contract dependency in
either direction (segmentation design §2).

## The collapsed `Transport` interface (recap, unchanged from Phase 2)

```typescript
// packages/core/src/seams/transport.ts — already shipped by Phase 2, consumed here unmodified
interface Transport {
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>;
  close(): Promise<void>;
}
function composeSignal(userSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined;
function isTimeoutSignal(signal: AbortSignal): boolean;
class CancellationError extends DexpaceError {}
```

8a's job is to *implement* this interface twice, not to change it — Phase 2 locked the shape deliberately (its own
design: "adding a required method to a published seam later is a breaking change"). Every obligation Phase 2
carried as TSDoc (concurrency/`SEAM-12`, orphan cleanup/`SEAM-30`, options-threading/`SEAM-18` residual, close/
`SEAM-14`) becomes real, tested behavior here, not new scope.

## Error taxonomy retrofit: `TransportFailureError`

`TRANSPORT-20` requires "the SDK's canonical retryable transport-failure exception," a **subtype of the platform
I/O-error type**, reporting itself retryable. Phase 3a already built that platform I/O-error type — `IoError
extends DexpaceError {}` in `packages/core/src/io/errors.ts` — and 5a's retry classifier (`classify.ts`'s
`isRetryableFailure`) already keys its "no-response transport failure falls back to always-retryable" branch off
`error instanceof IoError` walking the cause chain. There is exactly one correct place for the concrete class:

```typescript
// packages/core/src/io/errors.ts — RETROFIT, one addition to an already-shipped file
export class TransportFailureError extends IoError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
```

Not a new file, not a per-package class. Both `transport-fetch` and `transport-undici` import and throw/reject
with the **same** `TransportFailureError` from `@dexpace/core`. This is a document-edit retrofit to Phase 3a's
already-written (unexecuted) plan, the same class of change as 7a's `Clock`/RFC-1123 retrofits to 5a — Phase 3a
had no transport yet to name a transport-failure class for; Phase 8a is the first consumer, so the type lands
here and is added to Phase 3a's plan/file, not duplicated per transport package. `isRetryableFailure`'s existing
`instanceof IoError` cause-walk covers `TransportFailureError` automatically — no change needed in `classify.ts`.

**Timeout vs. cancellation (`TRANSPORT-3`/`TRANSPORT-4`) are resolved by construction, not by this class.** Per
`sdk-design-nodejs/03` §3.2 and Phase 2's `isTimeoutSignal()`, a timeout aborts with `signal.reason.name ===
'TimeoutError'` (from `AbortSignal.timeout()`) and surfaces as `TransportFailureError` (retryable); a caller abort
surfaces as `CancellationError` (terminal, non-retryable), already a Phase 2 type. Both packages branch on
`isTimeoutSignal(signal)` at the point `fetch`/`undici` throws its abort-shaped error, never on message-matching.

## `@dexpace/transport-fetch`

```typescript
// packages/transport-fetch/src/fetch-transport.ts
export interface FetchTransportOptions {
  readonly defaultTimeoutMs?: number;
}
export function fetchTransport(options?: FetchTransportOptions): Transport;
```

Wraps the global `fetch`. No owned client object — `fetch` is a runtime-global function, not a constructible
resource — so `close()` is the `ASYNC-17`-sanctioned no-op (`async close(): Promise<void> {}`), and `TRANSPORT-15`/
`TRANSPORT-16` are satisfied trivially: there is nothing to release, so idempotence and ownership-awareness hold
vacuously. `SEAM-12`/`TRANSPORT-29` (concurrency safety) hold by construction — `fetchTransport()` returns a
closure over zero mutable fields; all per-request state is local to each `send()` call.

**Request mapping.** `request.headers` iterated into a `Headers` (native) instance; `request.body?.writeTo(...)`
drained through a `TransformStream` into the `fetch` `init.body` as a `ReadableStream<Uint8Array>` when present
and non-replayable-safe, or — for a body whose `Body.replayable` is `true` and whose `contentLength` is known and
small — materialized once into a `Uint8Array` and passed directly (avoids the streaming-body-forces-HTTP/2 corner
case some `fetch` implementations have with `duplex: 'half'`, and sidesteps `TRANSPORT-17`'s single-write
requirement being harder to police through a stream than through a plain buffer for the common case). A streaming,
non-replayable body is passed as a `ReadableStream` with `duplex: 'half'` set (the flag Node's `fetch` requires for
a streaming request body), and `TRANSPORT-17` is enforced by `Body.writeTo` itself — Phase 3b's single-use bodies
already fail loudly on a second `writeTo` call (`BODY-3`/`HTTP-37`), so the transport does not need its own guard.
`TRANSPORT-18`'s re-subscribable-producer clause does not apply: `fetch` has no internal resend path comparable to
OkHttp's proxy-407/GOAWAY retry — Node's `fetch` does not itself retry a request after a partial body write; a 407
or connection reset surfaces as a normal failure the SDK's own retry layer (5a) handles by re-invoking `send()`
from scratch against the original `Body`, which is exactly what `RETRY-5`/`RETRY-7`'s replayability gate already
requires. Recorded as satisfied-by-construction, not built.

**`TRANSPORT-19` (abandoned streaming-body producer) *does* apply to the streaming branch** and is real work, not
a collapse: the `writeTo(writable)` pump running into the `TransformStream` is a producer that outlives a
connect-failure or an early abort. Its promise is therefore never left floating — it is retained, and on any
`send()` exit path other than a delivered response the transport calls `writable.abort(cause)` and then awaits the
retained promise with its rejection swallowed, so the producer unblocks and no file handle or pending write is
stranded. `writable.abort()` is idempotent, satisfying `TRANSPORT-19`'s idempotent-teardown clause. A rejection
from `writeTo` **before** `fetch()` settles must also fail the send: the two are raced, and a `writeTo` rejection
surfaces as `TransportFailureError` with the original as `cause` rather than being swallowed while `fetch` hangs
on a stream that will never close.

**Response mapping.** `fetchResponse.headers` copied leniently (`TRANSPORT-14`): iterate `Headers.entries()` — the
WHATWG `Headers` object already normalizes/validates names at construction, so the "single malformed header drops
only that header" case reduces to *skipping an entry that would throw on read*, wrapped in a per-entry try/catch
around the iteration rather than a bulk try/catch around the whole response (so one bad header cannot abort the
rest). Multi-valued inbound headers are read through `Headers.getSetCookie()` for `Set-Cookie` and the ordinary
comma-joined `entries()` value for every other name (the WHATWG object's own multi-value rule), and are fed into
the SDK `Headers` builder with the **lenient inbound** setter (`HTTP-19`), not the strict outbound one — the
strict path rejects obs-text (`>= 0x80`) that `TRANSPORT-14` explicitly requires be preserved.

`fetchResponse.body` (a `ReadableStream<Uint8Array> | null`) is wrapped in Phase 3b's response-body type — the
stream is handed over as-is, never drained or pre-buffered (`TRANSPORT-25`), and the wrapper's `close()` calls
`stream.cancel()` so `Response.close()` cascades to the native body and releases the connection. It is *not*
passed to `Response.newBuilder().body()` raw: `Body` is the SDK's own interface (`kind`/`mediaType`/
`contentLength`/`replayable`), and `Response.text()` / `BODY-15`'s idempotent connection-releasing close both live
on that wrapper, not on a bare `ReadableStream`.

**Inbound `Content-Type`/`Content-Length` downgrade (`TRANSPORT-27`).** An inbound `Content-Type` is parsed with
`MediaType.parse()` inside a try/catch; on failure (or absence) the response body's media type is `null` — "no
media type" — never a failed response. An absent or non-numeric `Content-Length` maps to the `-1` unknown-length
sentinel (`BODY-35`), never to `0`.

**Adaptation-throw guard (`TRANSPORT-22`).** Everything from the point `fetch()` resolves to the point the SDK
`Response` is returned runs inside one try/catch; on any throw the native `fetchResponse.body?.cancel()` runs
(errors from that cancel swallowed) before the original throwable propagates, so a header-mapping or
`Status.of()` failure cannot leak a live socket. This is the same guard `TRANSPORT-9`'s already-aborted branch
uses, applied to the throw path rather than the race path, and it is identical in both transports.

**Header-drop policy (`TRANSPORT-10`–`TRANSPORT-13`).** Node's `fetch` (undici-backed) already refuses to set
`Content-Length`/`Host`/`Transfer-Encoding`/`Connection` on the `Headers` object passed to `init.headers` — setting
a forbidden header throws inside the `Headers` constructor/`.set()` call. `transport-fetch` therefore filters the
outbound header list *before* constructing `Headers`, dropping the same forbidden set (`TRANSPORT-11`) proactively
rather than catching the native throw, and logs each drop at verbose via `getGlobalLogger()` (7b). A header valid
at the SDK model layer but rejected by `fetch`'s own stricter validation (`TRANSPORT-12`) is caught per-header
(try/catch around each individual `headers.set(name, value)` call, not the whole loop) and dropped with the same
verbose log — never escaping `send()`.

Outbound headers are emitted by **appending each value of each name** onto the native `Headers` object
(`headers.append(name, value)` per entry), never by collapsing the SDK `Headers` into a plain object — an
`Object.fromEntries()` collapse would silently keep only the last value of a repeated name and violate `HTTP-14`'s
multiple-values-per-name contract at the transport boundary.

`TRANSPORT-13`'s drop-log policy is wired here, at the transport's own call site, over the `dropped` list
`mapOutboundHeaders`/`degradeInboundHeaders` return (§7): a `headerDropLogging` option on both transports'
options objects selects `'all'` | `'first-per-name'` (default) | `'quiet'`, and the `'first-per-name'` mode keeps
a case-insensitive `Set` of already-logged names bounded by a named `MAX_LOGGED_DROP_NAMES` constant, evicting in
a drain-to-cap loop, so a server or caller synthesising unbounded distinct names cannot grow it (`XCUT-14`).

**Cancellation/timeout (`TRANSPORT-3`–`TRANSPORT-9`).** `composeSignal(userSignal, options?.timeoutMs ??
this.#defaultTimeoutMs)` from Phase 2, passed as `init.signal`. `TRANSPORT-6` (sub-resolution clamping) is
confirmed **not applicable** here: `AbortSignal.timeout(ms)` takes millisecond resolution directly with no coarser
native unit underneath to truncate against — there is no rounding step in this transport's code for a sub-ms
value to fall through. `TRANSPORT-9` (adaptation-race close) is the one place `SEAM-30`'s TSDoc obligation becomes
real code: after `await fetch(...)` resolves, check `signal.aborted` before constructing the SDK `Response`; if
already aborted, call `fetchResponse.body?.cancel()` (given a `.catch(() => {})`, per Phase 2's own footgun note
about unhandled rejections under Node's default policy) instead of delivering, and then throw **the same
canonical SDK type the pre-dispatch catch would have thrown** — `TransportFailureError` when
`isTimeoutSignal(signal)`, `CancellationError` otherwise. Never re-throw `signal.reason` raw: that is a
`DOMException` (`TimeoutError`/`AbortError`), neither an `IoError` subtype (so `TRANSPORT-20` and 5a's
`isRetryableFailure` cause-walk both miss it) nor the terminal `CancellationError` `TRANSPORT-3` requires. Both
transports share one `abortToSdkError(signal, cause)` helper in `@dexpace/transport-shared` so the two branches
cannot drift. `TRANSPORT-7`/`TRANSPORT-8`: `fetch`
has no internal-cancel-vs-timeout distinction beyond what `isTimeoutSignal` already resolves — `TRANSPORT-8`'s
clause is scoped (per §17's own preamble) to transports with an internal-cancel path; `transport-fetch` has none,
so it is out of scope here by the spec's own terms, not a gap.

**Body-less requests (`TRANSPORT-26`).** `fetch` accepts `init.body: undefined` for any method including POST —
no zero-length-body substitution is needed; Node's `fetch` does not reject a bodyless POST/PUT/PATCH the way the
JVM's `java.net.http` sometimes does. Confirmed satisfied-by-construction, not built.

**Proxy (`TRANSPORT-30`) — scoped out.** See §6. `transport-fetch` documents (TSDoc + package README) that it has
no proxy support: no environment-variable honoring, no `ProxyOptions` consumption, no `challengeHandler` dispatch.
`resolveProxyOptions()` (7a) is simply never called by this package. This is the deliberate scope boundary §6
argues for, not a silent gap.

## `@dexpace/transport-undici`

```typescript
// packages/transport-undici/src/undici-transport.ts
export interface UndiciTransportOptions {
  readonly defaultTimeoutMs?: number;
  readonly dispatcher?: import('undici').Dispatcher;       // BYO Agent (or any Dispatcher), never closed here
  readonly agentOptions?: import('undici').Agent.Options;   // used only when `dispatcher` is not supplied
  readonly proxy?: ProxyOptions;                              // from @dexpace/core, 7a
}
export function undiciTransport(options?: UndiciTransportOptions): Transport;
```

Built on undici's `request()` API against an **`Agent`**, not a `Pool` — `Pool` is bound to one fixed origin at
construction, but this `Transport` must reach whatever origin each `Request` names, and `Agent` is undici's own
general-purpose, multi-origin dispatcher (this is also what makes passing `origin` per call meaningful in the
first place). A caller may supply their own already-constructed `Agent` (or any `Dispatcher`) via the
`dispatcher` option — the `BYO` path `TRANSPORT-15` and `docs/knowledge/concurrency-and-async.md`'s "SDK closes
only what it created" both require.

**Dispatcher selection is one exclusive decision, resolved once at construction**, and it decides ownership at the
same time — there is exactly one `dispatcher` binding and exactly one `owned` flag, never a second agent
constructed and then discarded:

1. `options.dispatcher` supplied → use it, `owned = false`. Supplying **both** `dispatcher` and `proxy` is a
   construction-time error (`invariant`), not a silent win for one of them: the caller's dispatcher may already be
   a `ProxyAgent`, and silently ignoring either option is the ambiguity `SEAM-5`'s loud-fail discipline rejects.
2. `options.proxy` supplied (and no `dispatcher`) → `new ProxyAgent(...)`, `owned = true`. A `ProxyAgent` the
   transport constructed is an SDK-created resource `TRANSPORT-15` requires `close()` to release, exactly like an
   owned `Agent`.
3. neither → `new Agent(options.agentOptions)`, `owned = true`.

The `ProxyAgent` is constructed from the *whole* `ProxyOptions` (7a), not just its address: `uri` is the fully
schemed `` `${proxy.protocol}://${proxy.host}:${proxy.port}` `` — a bare `host:port` is not a valid absolute URL
and `ProxyAgent` rejects it — and `proxy.credentials`, when present, become the `token` (`Basic ` + base64
`user:pass`), never a logged value. `proxy.bypassAll` and `proxy.nonProxyHosts` are honored **per send**
(`CFG-23`/`CFG-27`): `send()` routes through a second, non-proxied owned `Agent` when the request URL's host
matches the bypass decision, because a `ProxyAgent` installed as *the* dispatcher would otherwise tunnel every
origin regardless of the caller's `NO_PROXY`. Both owned agents are released by the one `close()`.

`close()` is real here: `TRANSPORT-15`/`TRANSPORT-16` bite for every owned case — `await` each owned dispatcher's
`.close()` guarded by a `closed` boolean flip-checked-first for idempotence, never touching `options.dispatcher`
when one was supplied. Matches `docs/knowledge/resource-management.md`'s idempotent-close-with-flag pattern and
non-blocking-shutdown discipline (`undici`'s `.close()` already returns a `Promise` that waits for in-flight
requests to drain rather than force-closing — the graceful-shutdown default `ASYNC-16` prefers). Per
`resource-management.md`'s "a class that owns a resource must implement `Symbol.asyncDispose` rather than
exposing a public `close()` as the primary teardown interface," both transports additionally expose
`[Symbol.asyncDispose]` delegating to `close()` — `close()` stays because Phase 2 locked it into the `Transport`
seam, and delegation keeps it a single teardown path.

**`TRANSPORT-1` is pinned explicitly, not inherited.** Every dispatch passes `maxRedirections: 0`. undici's
default is already 0, but a BYO `Dispatcher` may have been constructed with a redirect interceptor, and
`TRANSPORT-1` requires the SDK pipeline be the single redirect authority regardless of who built the dispatcher.
`TRANSPORT-2` needs no counterpart: undici performs no automatic connection-failure retry unless a `RetryAgent`
is explicitly composed, which this package never does.

**Request/response mapping** follows the same shape as `transport-fetch` (`Body.writeTo` → a `Readable`/stream
undici accepts; `undici`'s response `body` is already a `BodyReadable`, adapted with `Readable.toWeb(result.body)`
— **never** by draining it into a `ReadableStream`'s `start()`, which would eagerly pull the whole body into
memory and defeat `TRANSPORT-25`'s not-pre-buffered requirement. `toWeb` preserves demand-driven reads and, via
the body wrapper's `close()` → `stream.cancel()` → `result.body.destroy()`, preserves the close-cascade that
returns the connection to the pool). The same lenient inbound copy, multi-value handling, `TRANSPORT-27`
downgrade, and `TRANSPORT-22` adaptation-throw guard described for `transport-fetch` apply verbatim; only the
source object differs. Two things `undici` gives that bare `fetch` cannot, both real, additive work here (this is the
package's whole reason to exist per `package-and-dependency-layout.md`'s "richer, pulls in a real library"
framing):

- **`TRANSPORT-30`/proxy, in full**, via `undici`'s `ProxyAgent` constructed from 7a's `ProxyOptions` when
  `options.proxy` is supplied. `challengeHandler` (the deferred item — §6 below) dispatches here: on receiving a
  407 with a `Proxy-Authenticate` challenge undici's `ProxyAgent` itself can't satisfy (anything beyond Basic),
  the configured `challengeHandler` is invoked and its result stamped as `Proxy-Authorization` on retry; failing
  that, `TRANSPORT-30`'s SHOULD-level "surfaced with a WARN, falls back to Basic" applies. Proxy credentials never
  logged (shared discipline with `docs/knowledge/redaction-and-security.md`'s redaction policy) and never answered
  to a 401 (only a matching 407) — a request-scoped check on the challenge's response status before invoking any
  auth-stamping path, structurally impossible to misroute since the 401/407 branch is a single `if` at the call
  site, not two independently-maintained code paths. The superseded 407 response's body **must be dumped before
  the retry is dispatched** (`await result.body.dump()`), on both the retry and the handler-failed path: undici
  will not release the connection for an undrained body, and `PIPE-40`/`RECOV-12`'s "close every superseded
  intermediate response" is the same obligation one layer up.
- **`TRANSPORT-28`/file bodies**, via undici's lower-level `Dispatcher` body option accepting a Node stream
  directly, letting a `fs.createReadStream(path, {start, end})` flow through without the extra `ReadableStream`
  adaptation layer `transport-fetch` would need. See §5 — this is *not* the kernel `sendfile(2)` zero-copy path
  the requirement's reference behavior describes, but it is the closest approximation Node's HTTP stack offers,
  and it is meaningfully more direct than `transport-fetch`'s equivalent.

**Header-drop policy.** `undici` does **not** drop `Connection` the way `java.net.http` does (matching
`TRANSPORT-11`'s own explicit "OkHttp does not drop Connection" precedent for the closer reference transport) —
`transport-undici`'s drop set is `{Content-Length, Host, Transfer-Encoding}` only, documented as the
transport-specific scoping `TRANSPORT-11` licenses. `Content-Type` authority (`TRANSPORT-10`) and per-header
graceful degradation (`TRANSPORT-12`) are implemented identically to `transport-fetch` — same algorithm, no
undici-specific wrinkle, so this is a shared, not reimplemented, helper (see §7, `@dexpace/transport-shared`).

## §5 — `FileBody` and `@dexpace/body-file`

**Package placement, resolved.** The segmentation design flagged the tension: `@dexpace/core` cannot host a real
`FileBody` (hard zero-`node:`-import invariant), but both transports must recognize a file body **by type** to
special-case it, which argues against embedding a concrete class in either transport package alone. The
resolution: **the recognition contract is structural, the construction is not.**

```typescript
// packages/core/src/body/body.ts — RETROFIT, one addition to Phase 3b's already-written plan
export interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart' | 'file';  // + 'file'
  // ... unchanged ...
}

export interface FileBodyDescriptor extends Body {
  readonly kind: 'file';
  readonly path: string;
  readonly start: number;
  readonly count: number;
}
```

`FileBodyDescriptor` is a **type-only interface** in `@dexpace/core` — it costs nothing against the zero-`node:`-
import invariant because TypeScript interfaces are erased at compile time; there is no `node:fs` symbol anywhere
in `@dexpace/core`'s emitted JS, only in its `.d.ts`. Both transports narrow on `body.kind === 'file'` (a plain
string-literal check, no cross-package `instanceof`) and, once narrowed, read `path`/`start`/`count` structurally
to open their own read stream — no dependency on wherever the concrete class was constructed.

```typescript
// packages/body-file/src/file-body.ts — new package
export interface FileBodyOptions {
  readonly start?: number;   // default 0
  readonly count?: number;   // default: remaining bytes from start to file end, captured at construction
}
export function fileBody(path: string, options?: FileBodyOptions): FileBodyDescriptor;
```

`fileBody()` needs `node:fs` for `HTTP-40`/`BODY-11`'s fail-fast construction-time validation — the full list, all
four checks, none of them derivable from another: the file exists and is a **regular** file; `start >= 0` **and
`start <= size`**; `count >= 0`; and `start + count <= size`. The middle pair matters because `count` defaults to
`size - start`, so a `start` past end-of-file silently yields a *negative* default count that still satisfies
`start + count <= size` and produces a zero-byte upload instead of an error. This is exactly the reason it
cannot live in core, and exactly the reason a fourth package is the right shape rather than folding the factory
into one transport (the other transport would then either duplicate the validation or depend on a sibling
transport package, which is architecturally backwards). `@dexpace/body-file` depends on `@dexpace/core` as a peer
and nothing else — `node:fs` is a runtime API, not an external library, so `NFR-2`'s "core + ≤1 external lib" is
satisfied with zero. `writeTo(sink)` opens a **fresh** `fs.createReadStream(path, {start, end: start + count -
1})` per call (`HTTP-40`'s "fresh handle per write") and pipes it into the sink, detecting a short read and raising
`BODY-13`'s transferred-of-total error. `replayable` is always `true` (`HTTP-40`).

**Sink ownership, decided once for the whole phase (`BODY-8`'s "a port MUST decide its stream-ownership rule
deliberately").** `Body.writeTo(sink)` **does not close the caller's sink**; it releases its writer lock and, on
failure, calls `writer.abort(cause)` so a downstream consumer sees the error rather than a silently truncated
stream. Closing belongs to whoever created the sink — which is why `transport-fetch`'s streaming branch closes
its own `TransformStream` writable after `writeTo` resolves, rather than relying on the body to do it. A body
that closed the sink would break every tee/multipart composition that writes more than one body into one sink,
and `SEAM-20`'s "streaming variants MUST NOT close the caller's target" says the same thing for the serde seam.

**Roadmap-table consequence:** Phase 8a ships **five** packages, not two — four published
(`@dexpace/transport-fetch`, `@dexpace/transport-undici`, `@dexpace/body-file`, `@dexpace/transport-shared` §7)
plus the unpublished `@dexpace/transport-conformance` devDependency (§8). The roadmap's Phase 8a table row and
package-and-dependency-layout's package list should be amended to add **both** `@dexpace/body-file` and
`@dexpace/transport-shared` alongside the two transports. Each of the four published packages carries the full
published-package apparatus — `api-extractor.json` + a checked-in `etc/<name>.api.md` snapshot (`NFR-4`),
`lint:publish`, its own `etc` gate — including `transport-shared`, whose `@internal` marking governs what
consumers are meant to *use*, not whether its surface is snapshotted.

**Zero-copy dispatch (`TRANSPORT-28`'s SHOULD), resolved — no Node analogue exists.** Checked directly: neither
the global `fetch` implementation nor `undici`'s public `Dispatcher`/`request()` API exposes a `sendfile(2)`-
shaped kernel path for an *outbound* request body — every route from `fs.createReadStream` to the socket passes
through a userspace `Readable`/`Writable` pipe (Node's HTTP client stack has no public binding equivalent to
`FileChannel.transferTo`/`okio.Source`'s zero-copy transfer, and this is a structural property of Node's stream
architecture, not a version-specific gap this design should expect to close later). This is a
**`PAGE-29`-shaped collapse**, the same disposition class the Phase 6 segmentation applied to pagination's
caller-supplied-executor mode: the SHOULD is satisfied by "there is no such path to take on this platform," not by
building one. `transport-undici`'s direct-stream dispatch (§4) is still the *closer* of the two available options
— one fewer userspace copy than `transport-fetch`'s `ReadableStream` adaptation — and is documented as the
practical best-effort this port offers, distinct from the literal zero-copy the reference describes. Recorded in
the Deviation Ledger below, not chased further.

## §6 — Proxy scope: `transport-undici`-only

**Resolved.** `TRANSPORT-30` (and the `challengeHandler` slot it dispatches through) is `transport-undici`-only.
Node's bare global `fetch` has no environment-proxy story and no custom-dispatcher hook without reaching for
`undici`'s `setGlobalDispatcher`/`ProxyAgent` internally — doing so inside `transport-fetch` would make it depend
on `undici` too, undermining its entire reason to exist as the zero-added-dependency option (`package-and-
dependency-layout.md`'s explicit framing). `§17`'s own preamble licenses this: "Where a behavior exists in only
one reference transport... the requirement is scoped accordingly." `transport-fetch`'s package README and its
`FetchTransportOptions` TSDoc state the boundary explicitly — no `proxy` option exists on `FetchTransportOptions`
at all (an absent option, not a silently-ignored one), so a caller reaching for proxy support is type-directed to
`transport-undici` rather than discovering the gap at runtime.

## §7 — Shared header-mapping: `@dexpace/transport-shared`

`TRANSPORT-10`/`TRANSPORT-12`'s algorithm (Content-Type authority, per-header graceful degradation on both the
outbound and inbound side) is identical for both transports — nothing about it is `fetch`-specific or
`undici`-specific. Writing it twice would be exactly the "second implementation is a defect" pattern this
project's discipline rejects (6c's `HTTP-29` precedent). It cannot live in either transport package alone
(the other transport would then depend on a sibling transport package to reuse it, which is architecturally
backwards — transports must stay independent per §2's zero-cross-dependency finding, and that independence
should hold *between the two transports themselves*, not only between 8a and 8b). The resolution is a fifth,
small, published package both transports depend on as a regular dependency:

```typescript
// packages/transport-shared/src/header-mapping.ts
export function mapOutboundHeaders(
  headers: Headers,
  forbidden: readonly string[],
  opts?: {bodyDerivedMediaType?: string | undefined},
): {sent: Headers; dropped: readonly string[]};

/** `raw` carries one entry per value, so a repeated name appears more than once (HTTP-14). */
export function degradeInboundHeaders(
  raw: Iterable<readonly [string, string]>,
): {headers: Headers; dropped: readonly string[]};

// packages/transport-shared/src/abort-mapping.ts
/** Maps an aborted signal to the canonical SDK type: TransportFailureError on timeout, else CancellationError. */
export function abortToSdkError(signal: AbortSignal, cause: unknown): DexpaceError;

// packages/transport-shared/src/drop-log.ts
export type HeaderDropLogging = 'all' | 'first-per-name' | 'quiet';
/** Bounded, case-insensitive, drain-to-cap dedup of already-logged names (TRANSPORT-13, XCUT-14). */
export function createDropLogger(mode: HeaderDropLogging): (dropped: readonly string[]) => void;
```

`@dexpace/transport-shared` depends only on its `@dexpace/core` peer (zero external libraries) and is not
re-exported from either transport's own public barrel (`@internal` exports — a consumer never installs it
directly), though it is still a **published** package with its own `api-extractor.json` and checked-in
`etc/transport-shared.api.md` snapshot, because `NFR-4` snapshots every published unit regardless of how its
exports are marked. `header-mapping.ts` carries no I/O of its own; `TRANSPORT-13`'s bounded, case-insensitive
drop-log dedup policy lives in `drop-log.ts`, which is the one module here that touches `getGlobalLogger()` and
is instantiated once per transport instance at its call site — the *policy* is shared so the two transports
cannot drift, the *logger call* is still made by the transport.

**Inbound copies use the lenient header path.** `degradeInboundHeaders` builds through `@dexpace/core`'s
inbound/lenient `Headers` setter (`HTTP-19`), never the strict outbound one. The strict path rejects every byte
`>= 0x80`, which would drop precisely the obs-text values `TRANSPORT-14` requires be *preserved* (a Latin-1
`Content-Disposition` filename being the canonical case), and would make this module's own "preserves an obs-text
byte in a value" test unsatisfiable.

## Reused, Not Rebuilt

| Surface | From | Why it must not be re-implemented here |
|---|---|---|
| `composeSignal`/`isTimeoutSignal`/`CancellationError` | Phase 2 | The exact per-call-timeout-scoping and timeout-vs-cancel discrimination `TRANSPORT-5`/`TRANSPORT-3`/`TRANSPORT-4` need already exist |
| `IoError` | Phase 3a | `TransportFailureError`'s base class — one addition, not a parallel hierarchy |
| `Body.writeTo`'s single-use guard | Phase 3b | `TRANSPORT-17`'s "written to the wire exactly once" is already enforced at the `Body` layer; a transport-level second guard would be redundant, not more correct |
| `resolveProxyOptions`/`ProxyOptions` | Phase 7a | Ships types and resolution logic only, deliberately unwired until a real transport exists — 8a is that consumer, not a second implementation |
| `getGlobalLogger()` | Phase 7b | Header-drop verbose logging (`TRANSPORT-11`/`TRANSPORT-13`) routes through the existing facade, not a new one |
| 6a's `NFR-14` version single-source + peer-dependency-dedup pattern | Phase 6a | `transport-fetch`, `transport-undici`, and `body-file` are simply the third, fourth, and fifth consumers of an already-decided mechanism |
| 7a's `CFG-36`/`RECOV-33` (`NFR-15`) | Phase 7a | The `User-Agent` value and stamping step already exist; 8a's job is a conformance test that `TRANSPORT-11`'s drop pass leaves the header untouched, not new stamping logic |

## §8 — Shared conformance suite

Both transports implement the identical `§17` contract; a suite written once and run twice is the only way to
keep them honest against drift, the same principle as 6b's `SSE-37` mechanical-check discipline.

```
packages/transport-conformance/          # unpublished devDependency, precedent: @dexpace/shrink-test
  package.json     # private: true, no publish
  src/
    run-suite.ts    # runTransportConformanceSuite(makeTransport: () => Transport, capabilities: TransportCapabilities): void
    fixtures.ts      # node:http-backed local test server fixtures (malformed headers, 520 status, slow endpoint, etc.) -- test-only, node:http is fine here
```

```typescript
interface TransportCapabilities {
  readonly supportsInternalCancel: boolean;   // TRANSPORT-8 scoping
  readonly supportsProxy: boolean;             // TRANSPORT-30 scoping
  readonly dropsConnectionHeader: boolean;     // TRANSPORT-11's transport-specific drop-set note
}
function runTransportConformanceSuite(
  makeTransport: () => Transport,
  capabilities: TransportCapabilities,
): void;   // registers describe/test blocks; called once per package's own *.conformance.test.ts
```

`transport-fetch/src/fetch-transport.conformance.test.ts` and `transport-undici/src/undici-transport.conformance.test.ts`
each import and invoke the suite with their own `makeTransport`/capabilities — one `TRANSPORT-N` assertion, two
call sites, cannot drift (the same "one function, two call sites" discipline 7b's design already used for header-
value URL redaction). `TRANSPORT-8`/`TRANSPORT-30`'s scoped-to-one-reference-transport clauses are the only rows
the suite conditionally skips, gated on `capabilities`, not omitted silently.

## File Layout

```
packages/transport-fetch/
  package.json          # peerDependencies: {"@dexpace/core"}; dependencies: {"@dexpace/transport-shared"} (zero *external* libs)
  tsconfig.json          # composite, project references ../core
  api-extractor.json
  etc/transport-fetch.api.md
  src/
    fetch-transport.ts
    fetch-transport.conformance.test.ts
    index.ts

packages/transport-undici/
  package.json          # peerDependencies: {"@dexpace/core"}; dependencies: {"undici": "^...", "@dexpace/transport-shared"}
  tsconfig.json
  api-extractor.json
  etc/transport-undici.api.md
  src/
    undici-transport.ts    # built on undici's Agent (multi-origin dispatcher), not Pool (single-origin)
    challenge-handler.ts   # TRANSPORT-30's proxy-407 dispatch, including the credential-stamped retry
    undici-transport.conformance.test.ts
    index.ts

packages/body-file/
  package.json          # peerDependencies: {"@dexpace/core"}; dependencies: {} (node:fs is a runtime API)
  tsconfig.json
  api-extractor.json
  etc/body-file.api.md
  src/
    file-body.ts
    index.ts

packages/transport-shared/    # published, @internal-only exports; not part of either transport's public barrel
  package.json          # peerDependencies: {"@dexpace/core"}; dependencies: {}
  tsconfig.json
  api-extractor.json     # published => snapshotted, NFR-4, regardless of the @internal marking
  etc/transport-shared.api.md
  src/
    header-mapping.ts     # mapOutboundHeaders, degradeInboundHeaders (§7)
    abort-mapping.ts       # abortToSdkError (§4's TRANSPORT-3/4/20 canonical mapping, shared)
    drop-log.ts             # HeaderDropLogging, createDropLogger (TRANSPORT-13)
    index.ts

packages/transport-conformance/    # private: true, unpublished
  package.json           # "exports": {".": "./src/index.ts"} -- source-resolved, no build step;
                          #  both transports list it in devDependencies as "workspace:*"
  src/
    run-suite.ts
    fixtures.ts
    index.ts               # re-exports runTransportConformanceSuite/TransportCapabilities

packages/core/src/io/errors.ts     # RETROFIT: + TransportFailureError
packages/core/src/body/body.ts     # RETROFIT: + 'file' kind, + FileBodyDescriptor interface
```

## Public Barrel

Each of the four published packages exports directly from its own `src/index.ts` (no internal barrels, per
`docs/knowledge/module-organization.md`, same discipline every prior package followed): `transport-fetch` exports
`fetchTransport`/`FetchTransportOptions`; `transport-undici` exports `undiciTransport`/`UndiciTransportOptions`;
`body-file` exports `fileBody`/`FileBodyOptions`; `transport-shared` exports `mapOutboundHeaders`/
`degradeInboundHeaders`/`abortToSdkError`/`createDropLogger`/`HeaderDropLogging`, every one of them marked
`@internal`. `@dexpace/core`'s existing root barrel gains
`TransportFailureError` (from `io/errors.js`) and `FileBodyDescriptor` (type-only export, from `body/body.js`) —
two additions to the barrel already amended every phase since Phase 1.

## Error Handling

`TransportFailureError extends IoError` for every no-response failure (`TRANSPORT-20`); `CancellationError`
(Phase 2, unchanged) for caller-initiated aborts; per-header/per-response degradation (`TRANSPORT-12`/
`TRANSPORT-14`) never throws past `send()`. `close()` never throws on repeated calls (`TRANSPORT-16`). No new
`Error` subclass beyond `TransportFailureError` — `MultipartBoundaryError`/`ConsumedBodyError`/`HttpStatusError`
etc. are all pre-existing and untouched by this phase.

An abort is **never** surfaced as its raw `signal.reason` (`DOMException` `AbortError`/`TimeoutError`): every
abort path in both transports goes through `abortToSdkError()` (§7), because a `DOMException` is neither an
`IoError` subtype — so `TRANSPORT-20` and 5a's `isRetryableFailure` cause-walk would both miss a timeout — nor
the terminal `CancellationError` `TRANSPORT-3` requires for a caller abort.

**Post-close behavior (`SEAM-15`, MAY-with-SHOULD-document).** Both transports document that `send()` after
`close()` rejects: `transport-undici` with whatever the closed dispatcher raises, wrapped in
`TransportFailureError`; `transport-fetch` never rejects for this reason, since its `close()` is a no-op over a
runtime global it does not own. Stated in each package's README and the `close()` TSDoc.

## Testing

`bun test`, colocated `*.test.ts` plus each package's `*.conformance.test.ts` (§8). `packages/transport-
conformance`'s fixtures use `node:http` to stand up a local test server per suite run (ephemeral port, closed in
`afterAll`) — acceptable here because it is test-only infrastructure in an unpublished devDependency, not
production code subject to core's zero-`node:`-import invariant (which only ever applied to `@dexpace/core`
itself). `body-file`'s tests exercise real temp files (`node:fs.mkdtemp`), cleaned up in `afterEach` per
`docs/knowledge/resource-management.md`'s "close any resource a test opens in that same test's `afterEach`" rule.
Property tests (fast-check) for the header-drop/degrade path: an arbitrary header-name/value generator asserts
send never throws and either the header survives or is dropped with a log, never a third outcome.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| No kernel-level zero-copy file transfer (`TRANSPORT-28`'s SHOULD) | OkHttp `okio.Source`/`FileChannel.transferTo` | Neither `fetch` nor `undici` expose a `sendfile(2)`-shaped path for outbound request bodies on this platform; `transport-undici`'s direct-stream dispatch is the closest available approximation, not a literal zero-copy path |
| `transport-fetch` has no proxy support at all (`TRANSPORT-30` scoped out) | Reference transports both support proxying | Node's bare global `fetch` has no proxy hook without depending on `undici` internally, which would undermine `transport-fetch`'s zero-added-dependency purpose; `§17`'s own preamble licenses single-transport scoping |
| `TRANSPORT-8` (native-internal-cancel-vs-timeout distinction) does not apply to `transport-fetch` | OkHttp reference implements it | `§17`'s own text scopes this clause to transports with an internal-cancel path; `fetch` has none |
| No re-subscribable-producer replay machinery (`TRANSPORT-18`) | OkHttp resends a request body on proxy-407/GOAWAY internally | Neither `fetch` nor `undici` retries a partially-written request internally; a failed send surfaces normally and the SDK's own retry layer (5a) re-invokes `send()` against the original `Body`, already gated by `RETRY-5`/`RETRY-7`'s replayability check. **Scoped to `TRANSPORT-18` only — `TRANSPORT-19` is built, not collapsed** (see §3's abandoned-producer teardown) |
| `Response.protocol` is a hardcoded `Protocol.HTTP_1_1` best-effort default in both transports, not an observed negotiated value | OkHttp/`java.net.http` both expose the actual negotiated protocol (HTTP/1.1 vs. HTTP/2) per response | Neither the WHATWG `fetch` `Response` object nor undici's `Dispatcher.ResponseData` surfaces which protocol version was actually negotiated for a given exchange; there is no public API on either to read it from. A caller relying on `Response.protocol` reflecting real HTTP/2 usage will observe `HTTP_1_1` regardless. Revisit if either library ever exposes this |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Reason |
|---|---|---|---|
| A real `sendfile(2)`-equivalent path, if Node's HTTP stack ever exposes one | 8a brainstorm | Not scheduled | This document's zero-copy finding (§5) is current as of this session; if a future Node/undici release adds a genuine kernel-transfer API, revisit `transport-undici`'s file-body dispatch, not before |
| Whether `@dexpace/body-file`'s `fileBody()` should also support a read-only memory-mapped view (`BODY-36`, MAY) | 8a brainstorm | Not scheduled | `BODY-36` is a MAY for local hashing/signing without heap copying; no caller identified in this roadmap's scope, same "don't build speculatively" discipline as `FakeTransport`'s original deferral |
