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

## Eleven rules a real transport must follow

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

**4. Map aborts to exactly two errors** (`TRANSPORT-3`/`TRANSPORT-4`/`TRANSPORT-8`). A timeout is the
retryable `TransportFailureError`; a caller abort is the terminal `CancellationError`. A raw
`DOMException` must never surface. `isTimeoutSignal(signal)` is how you tell them apart.

**5. An abort after delivery must not close the delivered body** (`SEAM-16`). Both native clients tie
a response body's lifetime to the signal they were given, so dispatch over a **fork** of the signal
and detach it at delivery. Get this wrong and a caller who aborts a moment after `send()` resolves
finds the body they already own torn out from under them.

**6. The caller owns the response body** (`BODY-15`). Return it live and unread. Do not buffer it, do
not close it.

**7. Ownership decides who closes what** (`SEAM-14`). A dispatcher or client the caller supplied is
never touched by your `close()`. One you constructed is yours to close. Make that decision once, at
construction, and make supplying both a caller-owned client *and* an option that would build one a
construction-time `TypeError` rather than a silent win for one of them.

**8. `close()` must be idempotent, concurrent-safe, and non-blocking** (`TRANSPORT-15`/`TRANSPORT-16`).
No unbounded await — a graceful drain would stall teardown for as long as one in-flight send against
a slow peer takes. Destroying is the sanctioned choice; in-flight sends then reject with
`CancellationError`, and so does a `send()` issued after `close()`, because it cannot succeed over a
dispatcher that no longer exists and so is not a retryable failure. Declare your post-close mode
(`SEAM-15`) either way: `@dexpace/transport-fetch`'s `close()` is a documented no-op over a runtime
global it does not own, and `send()` keeps working after it.

**9. Recognize a file body structurally, and still write it through `writeTo`**
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

**10. Refuse a proxy you cannot honour, at construction** (`TRANSPORT-30`). `ProxyType` admits
`socks4` and `socks5`, and core resolves both from `ALL_PROXY`, so a configuration can hand you a
proxy your client cannot build. Reject it in the factory with a typed error that names the type,
before you allocate anything — not on the first send, where it arrives as whatever the native
client raises. Keep it outside the `IoError` tree: `retry/classify.ts` is an allow-list, so a
misconfiguration no retry can fix is then non-retryable for free. Declare it in `@throws`.

**11. Send a real `User-Agent`** (`NFR-15`), never a placeholder. `getBuildInfo()` supplies the tokens.

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
  // TRANSPORT-30, optional: a proxy type your configuration can express and your client cannot
  // honour. Omit it and the row asserts `supportsProxy` is false, rather than skipping.
  // unsupportedProxy: {type: 'socks5', build: () => myTransport({proxy: socks5Proxy})},
});
```

Those capability entries are the only clauses §17 scopes to a subset of transports; everything else
runs unconditionally. The suite starts its own fixture server, and a second one on a separate origin
for the rows that deliberately leave a connection unusable — a client that reuses a poisoned
connection otherwise fails thirty rows downstream, which is a debugging problem of a different order.

The package is `private` and its `exports` name `./src/index.ts`, so it resolves unbuilt and is a
`devDependency`.

## Reuse the plumbing

`@dexpace/transport-shared` exists so the algorithm both adapters need exists once. Its exports are
`@internal` and it is not a package to install directly, but reading it is the fastest way to see
what a correct implementation of rules 2, 3, 4, 5 and 7 looks like:

| Module | Concern |
|---|---|
| `header-mapping.ts` | Rules 2 and 3: the outbound drop-and-degrade pass, and the lenient inbound copy |
| `drop-log.ts` | Bounded, case-insensitive, drain-to-cap dedup of already-logged drop names |
| `abort-mapping.ts` | The single mapping from an aborted signal to `TransportFailureError` or `CancellationError` |
| `body-pump.ts` | Turning a `Body` into a request stream the transport owns, plus idempotent teardown for an abandoned producer |
| `signal-fork.ts` | Rule 5's fork-and-detach |

## Package it

`@dexpace/core` goes in `peerDependencies`, never `dependencies` — two copies of core defeat the
identity checks the seams rely on, and `verify:seam-1` enforces it. Take at most one external HTTP
library (`NFR-2`). Declare `engines.node` honestly; `verify:runtime-floor` checks it against your
`tsconfig` target.
