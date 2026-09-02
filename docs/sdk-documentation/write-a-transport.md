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

## Nine rules a real transport must follow

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

**3. Map aborts to exactly two errors** (`TRANSPORT-3`/`TRANSPORT-4`/`TRANSPORT-8`). A timeout is the
retryable `TransportFailureError`; a caller abort is the terminal `CancellationError`. A raw
`DOMException` must never surface. `isTimeoutSignal(signal)` is how you tell them apart.

**4. An abort after delivery must not close the delivered body** (`SEAM-16`). Both native clients tie
a response body's lifetime to the signal they were given, so dispatch over a **fork** of the signal
and detach it at delivery. Get this wrong and a caller who aborts a moment after `send()` resolves
finds the body they already own torn out from under them.

**5. The caller owns the response body** (`BODY-15`). Return it live and unread. Do not buffer it, do
not close it.

**6. Ownership decides who closes what** (`SEAM-14`). A dispatcher or client the caller supplied is
never touched by your `close()`. One you constructed is yours to close. Make that decision once, at
construction, and make supplying both a caller-owned client *and* an option that would build one a
construction-time `TypeError` rather than a silent win for one of them.

**7. `close()` must be idempotent, concurrent-safe, and non-blocking** (`TRANSPORT-15`/`TRANSPORT-16`).
No unbounded await — a graceful drain would stall teardown for as long as one in-flight send against
a slow peer takes. Destroying is the sanctioned choice; in-flight sends then reject with
`CancellationError`, and so does a `send()` issued after `close()`, because it cannot succeed over a
dispatcher that no longer exists and so is not a retryable failure. Declare your post-close mode
(`SEAM-15`) either way: `@dexpace/transport-fetch`'s `close()` is a documented no-op over a runtime
global it does not own, and `send()` keeps working after it.

**8. Recognize a file body structurally** (`TRANSPORT-28`). `body.kind === 'file'` widens the body to
`FileBodyDescriptor` — `path`, `start`, `count` — and lets you dispatch straight off the file. Never
`instanceof` against `@dexpace/body-file`: a transport must not depend on it.

**9. Send a real `User-Agent`** (`NFR-15`), never a placeholder. `getBuildInfo()` supplies the tokens.

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
});
```

The three capability flags are the only clauses §17 scopes to a subset of transports; everything else
runs unconditionally. The suite starts its own fixture server, and a second one on a separate origin
for the rows that deliberately leave a connection unusable — a client that reuses a poisoned
connection otherwise fails thirty rows downstream, which is a debugging problem of a different order.

The package is `private` and its `exports` name `./src/index.ts`, so it resolves unbuilt and is a
`devDependency`.

## Reuse the plumbing

`@dexpace/transport-shared` exists so the algorithm both adapters need exists once. Its exports are
`@internal` and it is not a package to install directly, but reading it is the fastest way to see
what a correct implementation of rules 2, 3, 4 and 6 looks like:

| Module | Concern |
|---|---|
| `header-mapping.ts` | The outbound drop-and-degrade pass and the lenient inbound copy |
| `drop-log.ts` | Bounded, case-insensitive, drain-to-cap dedup of already-logged drop names |
| `abort-mapping.ts` | The single mapping from an aborted signal to `TransportFailureError` or `CancellationError` |
| `body-pump.ts` | Turning a `Body` into a request stream the transport owns, plus idempotent teardown for an abandoned producer |
| `signal-fork.ts` | Rule 4's fork-and-detach |

## Package it

`@dexpace/core` goes in `peerDependencies`, never `dependencies` — two copies of core defeat the
identity checks the seams rely on, and `verify:seam-1` enforces it. Take at most one external HTTP
library (`NFR-2`). Declare `engines.node` honestly; `verify:runtime-floor` checks it against your
`tsconfig` target.
