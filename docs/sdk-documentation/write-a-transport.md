# Write a transport

A transport is two methods:

```typescript
interface Transport {
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>;
  close(): Promise<void>;
}
```

There is no registration step. A conforming object is a valid transport; you pass it to
`standardResilience()` or `new PipelineBuilder(...)`. Write one when the two shipped adapters do not
fit — a different HTTP client, a mock service, an in-process loopback, an instrumented wrapper.

## The smallest useful one

```typescript
import {
  Headers,
  Protocol,
  Response,
  Status,
  type Request,
  type Transport,
} from '@dexpace/core';

export function echoTransport(): Transport {
  return {
    async send(request: Request): Promise<Response> {
      return Response.newBuilder()
        .request(request)
        .status(Status.of(200))
        .protocol(Protocol.HTTP_1_1)
        .headers(Headers.newBuilder().setInbound('content-type', 'text/plain').build())
        .body(new Blob([request.url.href]).stream())
        .build();
    },
    async close(): Promise<void> {},
  };
}
```

Note `setInbound`, not `set`: values a server sent are accepted leniently. Using the strict setter on
a real server's headers means a response with an obs-text byte in it becomes unreadable.

## Thirteen rules a real transport must follow

The full contract is `docs/product-spec/17-transport-adapter-conformance-contract.md`, thirty
`TRANSPORT-N` clauses. These are the ones that are easy to get wrong.

**1. Never follow redirects** (`TRANSPORT-1`/`TRANSPORT-2`). Pin them off at the client — `fetch`'s
`redirect: 'manual'`, undici's `maxRedirections: 0` — and pin them off even behind a caller-supplied
dispatcher that may carry a redirect interceptor. The pipeline is the single redirect authority, and
a transport that follows a hop silently defeats loop detection, the hop cap, credential stripping and
the downgrade guard all at once.

**2. Drop the framing headers, and log every drop by name**
(`TRANSPORT-10`–`TRANSPORT-13`). `Content-Length`, `Host` and `Transfer-Encoding` are computed by the
client, so forwarding a caller's copy corrupts framing. `Connection` is in the drop set for a
`fetch`-class transport and not for an undici-class one — §17 says so explicitly. Log the **name**,
never the value, and dedupe per name by default.

**3. Whatever your native client refuses, drop that header — never the request** (`TRANSPORT-12`).
This is the half that is easy to miss, because the refusal happens somewhere you are not looking.
`@dexpace/core` admits every printable ASCII byte in a header name (`http/ascii-validation.ts`), so
`X Custom` is a model-valid name no HTTP client on this platform will carry. Both shipped clients
also refuse `Expect`, `Keep-Alive` and `Upgrade` outright, and undici refuses `Connection` with any
value but `close`/`keep-alive`. Find out *where* your client decides: WHATWG `Headers.append` throws
at construction, which a `try`/`catch` degrades for free; undici validates inside `dispatch`, so
that transport has to ask the question itself before handing the array over. Getting this wrong
does not look like a bug in your transport — it looks like a retryable network failure that burns
the caller's whole retry budget re-proving a permanent misconfiguration. The shared suite has a row
per name.

**4. Classify a native rejection with the shared table, not by hand** (`TRANSPORT-20`, `RETRY-2`).
There are two kinds, and they are not the same kind of thing. An *exchange* that failed — connection
refused, DNS, TLS, peer reset, read timeout — is the retryable `TransportFailureError`, which
`TRANSPORT-20` makes a MUST. A *request* the client refused before dispatching — an unsupported
scheme, a forbidden method, an argument its own validation rejects — can never succeed on a retry,
and `retry/classify.ts` is an allow-list over `IoError`, so reporting it as anything outside that
tree makes it non-retryable for free. Both shipped transports report it as a bare `TypeError` with
the native error as `cause`, matching the `TypeError` they already raise for a misconfiguration
caught at construction.

Telling the two apart is runtime-specific enough that you should not: call
`toDispatchFailure(error, fallbackMessage)` from `@dexpace/transport-shared`. Node's global `fetch`
reports an unsupported scheme as `TypeError: fetch failed` with an `unknown scheme` *cause* — the
same top-level shape as a DNS failure — while Bun 1.3.14 reports it as
`TypeError [ERR_INVALID_ARG_VALUE]` with no cause, and undici's dispatcher as
`UND_ERR_INVALID_ARG`. The two shipped transports disagreed about `ftp://` until audit #67 / #82 for
exactly that reason. The default is retryable, so a shape the table does not recognize keeps
`TRANSPORT-20`'s MUST.

**5. Map aborts to exactly two errors** (`TRANSPORT-3`/`TRANSPORT-4`/`TRANSPORT-8`). A timeout is the
retryable `TransportFailureError`; a caller abort is the terminal `CancellationError`. A raw
`DOMException` must never surface. `isTimeoutSignal(signal)` is how you tell them apart.

**6. Dispatch over a fork of the caller's signal — and keep the fork even when there is no signal**
(`SEAM-16`, `TRANSPORT-9`). Both native clients tie a response body's lifetime to the signal they
were given, so a caller who aborts a moment after `send()` resolves would find the body they already
own torn out from under them. Fork the signal, forward the caller's abort through it, and detach at
delivery.

The fork runs the other way too, and that half is easy to miss. When a streaming request-body
producer fails while the native call is still pending, your `send()` rejects and nothing is left
awaiting that call: a response arriving afterwards is dropped with its body neither read nor
released, which is the leak `TRANSPORT-9` names. Abort the fork before you rethrow. That is why
`forkSignal()` hands back a live signal even when the caller supplied none and no timeout was
composed — a send with no signal at all is precisely the case where nothing could cancel it. Read
whether the *caller* aborted before you pull the fork yourself, or every producer failure surfaces
as a `CancellationError`; and let `detach()` latch the abort, so the second direction cannot become
the `SEAM-16` violation the first one exists to prevent.

**7. The caller owns the response body** (`BODY-15`). Return it live and unread. Do not buffer it, do
not close it.

**8. A response that can carry no body must report `body === null`** (`TRANSPORT-24`,
`TRANSPORT-25`). The WHATWG null-body statuses — `101`, `103`, `204`, `205`, `304` — plus every
`HEAD` response and a 2xx `CONNECT`. Do not forward whatever your native client produced: three of
the four combinations the two shipped adapters meet disagree. undici's dispatcher always hands back
a `BodyReadable`; Node's `fetch` returns `null`; Bun 1.3.14's `fetch` returns a live
`ReadableStream`. `hasNoResponseBody(method, status)` in `@dexpace/transport-shared` is the rule, so
that a consumer can branch on `null` instead of reading to discover there is nothing there.

Whatever handle you then decline to expose is yours to release — `cancel()` it, `dump()` it — before
you return. `Response.close()` is a no-op on a null body, so nobody else will, and an undrained
`BodyReadable` holds a pooled connection open until the dispatcher times it out.

A `Content-Length` on a body-less response is not a lie to correct: on a `HEAD` it describes the
body a `GET` would have returned, and it must survive verbatim. Only the body is absent.

**9. Ownership decides who closes what** (`SEAM-14`). A dispatcher or client the caller supplied is
never touched by your `close()`. One you constructed is yours to close. Make that decision once, at
construction, and make supplying both a caller-owned client *and* an option that would build one a
construction-time `TypeError` rather than a silent win for one of them.

**10. `close()` must be idempotent, concurrent-safe, and non-blocking** (`TRANSPORT-15`/`TRANSPORT-16`).
No unbounded await — a graceful drain would stall teardown for as long as one in-flight send against
a slow peer takes. Destroying is the sanctioned choice; in-flight sends then reject with
`CancellationError`, and so does a `send()` issued after `close()`, because it cannot succeed over a
dispatcher that no longer exists and so is not a retryable failure. Declare your post-close mode
(`SEAM-15`) either way: `@dexpace/transport-fetch`'s `close()` is a documented no-op over a runtime
global it does not own, and `send()` keeps working after it.

**11. Recognize a file body structurally, and still write it through `writeTo`**
(`TRANSPORT-28`, `BODY-13`). `body.kind === 'file'` widens the body to `FileBodyDescriptor` —
`path`, `start`, `count`. Never `instanceof` against `@dexpace/body-file`: a transport must not
depend on it.

Reading `path` yourself is the trap. It is a shorter path to the wire, and it skips the
descriptor's own `writeTo`, which is where `BODY-13`'s `transferred === count` check lives — the
only thing that can notice a file truncated between `stat` and `send`, because `Content-Length` is
dropped outbound (rule 2) so the framing cannot. `@dexpace/transport-undici` did exactly this until
2026-09-05 and uploaded short files with a 200. Unless your client has a genuine kernel `sendfile`
path, treat a file body as an ordinary `Body` and let `writeTo` produce the bytes; `TRANSPORT-28`'s
zero-copy clause is a SHOULD, and its MUSTs — replayable, and exactly the declared range on the
wire — are the descriptor's to keep, not yours.

**12. Refuse at construction what you cannot honour** (`TRANSPORT-30`, `HTTP-35`). `ProxyType`
admits `socks4` and `socks5`, and core resolves both from `ALL_PROXY`, so a configuration can hand
you a proxy your client cannot build. Reject it in the factory with a typed error that names the
type, before you allocate anything — not on the first send, where it arrives as whatever the native
client raises. Keep it outside the `IoError` tree: `retry/classify.ts` is an allow-list, so a
misconfiguration no retry can fix is then non-retryable for free. Declare it in `@throws`.

A transport-wide default timeout is the same shape of decision. It ends up in
`AbortSignal.timeout()`, whose range is an integer in `1 .. 2**32 - 1`, and nothing downstream will
check it for you: `RequestOptions.timeoutMs` is validated at its setter, so an unchecked
`defaultTimeoutMs` is the last path by which `1.5` or `2**32` reaches a deadline — where Node throws
a `RangeError` on the first send and Bun 1.3.14 quietly accepts it. Call
`requireValidDefaultTimeoutMs(value)` from `@dexpace/transport-shared` first thing in your
constructor, before anything is allocated.

**13. Send a real `User-Agent`** (`NFR-15`), never a placeholder. `getBuildInfo()` supplies the tokens.

## Prove it

Do not hand-roll the assertions. `@dexpace/transport-conformance` is the suite both shipped adapters
run, which is what keeps them from drifting apart:

```typescript
import {runTransportConformanceSuite} from '@dexpace/transport-conformance';
import {myTransport} from '../src/index.js';

runTransportConformanceSuite('my-transport', () => myTransport(), {
  supportsInternalCancel: false, // TRANSPORT-8: a cancel path distinct from a caller abort
  supportsProxy: false,          // TRANSPORT-30
  dropsConnectionHeader: true,   // TRANSPORT-11: is `Connection` in your drop set?
  // HTTP-35, required: the rows hand this values `AbortSignal.timeout()` refuses and expect your
  // factory to refuse them too, rather than deferring the failure to the first send.
  buildWithDefaultTimeoutMs: value => myTransport({defaultTimeoutMs: value}),
  // TRANSPORT-30, optional: a proxy type your configuration can express and your client cannot
  // honour. Omit it and the row asserts `supportsProxy` is false, rather than skipping.
  // unsupportedProxy: {type: 'socks5', build: () => myTransport({proxy: socks5Proxy})},
});
```

Those capability entries are the clauses §17 scopes to a subset of transports, plus the one builder
the suite needs to construct a deliberately misconfigured transport; everything else runs
unconditionally. The suite starts its own fixture server, and a second one on a separate origin
for the rows that deliberately leave a connection unusable — a client that reuses a poisoned
connection otherwise fails thirty rows downstream, which is a debugging problem of a different order.

The package is `private` and its `exports` name `./src/index.ts`, so it resolves unbuilt and is a
`devDependency`.

## Reuse the plumbing

`@dexpace/transport-shared` exists so the algorithm both adapters need exists once. Its exports are
`@internal` and it is not a package to install directly, but reading it is the fastest way to see
what a correct implementation of rules 2, 3, 4, 5, 6, 8, 9 and 12 looks like:

| Module | Concern |
|---|---|
| `header-mapping.ts` | Rules 2 and 3: the outbound drop-and-degrade pass, and the lenient inbound copy |
| `drop-log.ts` | Bounded, case-insensitive, drain-to-cap dedup of already-logged drop names |
| `default-timeout.ts` | Rule 12: the range check a transport-wide default timeout has to pass |
| `dispatch-classification.ts` | Rule 4: the one table deciding permanent-versus-retryable for a native rejection |
| `body-less.ts` | Rule 8: which method/status pairs can carry no response body at all |
| `abort-mapping.ts` | Rule 5's single mapping from an aborted signal to `TransportFailureError` or `CancellationError` |
| `body-pump.ts` | Turning a `Body` into a request stream the transport owns, plus idempotent teardown for an abandoned producer |
| `signal-fork.ts` | Rule 6's fork-and-detach |

## Package it

`@dexpace/core` goes in `peerDependencies`, never `dependencies` — two copies of core defeat the
identity checks the seams rely on, and `verify:seam-1` enforces it. Take at most one external HTTP
library (`NFR-2`). Declare `engines.node` honestly; `verify:runtime-floor` checks it against your
`tsconfig` target.
