# @dexpace/transport-fetch

The zero-dependency `Transport` for the dexpace SDK, built on the runtime's own global `fetch`.
Nothing beyond a `@dexpace/core` peer is installed.

```sh
bun add @dexpace/transport-fetch @dexpace/core
```

```typescript
import {Request} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const transport = fetchTransport({headerDropLogging: 'first-per-name'});

const response = await transport.send(
  Request.newBuilder().url('https://example.com/v1/users').build(),
);
try {
  console.log(response.status.code, await response.text());
} finally {
  await response.close(); // the caller owns the body, always (BODY-15)
}
```

`close()` is the teardown, not `await using`. The factory returns a plain `Transport`: the disposal
member is installed only when `Symbol.asyncDispose` exists, which it does not on this package's
declared `engines.node` floor of `>=20.3` (the symbol arrived in 20.4). Declaring `AsyncDisposable`
in the `.d.ts` regardless would be a type that lies on the supported runtime — `NFR-10` forbids it,
and the [`await using` support row](https://github.com/dexpace/nodejs-sdk/blob/main/docs/open-items.md#d-nfr-10-await-using) in `docs/open-items.md`
records the decision and the four reasons the floor does not move instead.

## What this transport deliberately does not do

- **No proxy support, at all (`TRANSPORT-30`, scoped out).** There is no `proxy` option on
  `FetchTransportOptions` — an absent option, not a silently ignored one — so a caller reaching for
  proxying is type-directed to `@dexpace/transport-undici` rather than discovering the gap at
  runtime. Node's bare global `fetch` exposes no proxy hook that does not route through `undici`
  internals, and depending on `undici` would undo this package's entire reason to exist.
- **No native-internal cancel path (`TRANSPORT-8`, scoped out).** `fetch` has no teardown distinct
  from an `AbortSignal` abort, so there is no second failure mode to tell apart from a timeout.
- **No connection pool to release.** `close()` is a sanctioned no-op over a runtime global this
  package does not own, and `send()` keeps working after it — this transport's documented `SEAM-15`
  post-close mode. `@dexpace/transport-undici` is the one with real close semantics.
- **`Response.protocol` is always `HTTP_1_1`.** A documented best-effort default: the WHATWG
  `Response` object exposes no negotiated-HTTP-version field to read. Recorded in the Deviation
  Ledger, not silently papered over.

## Behavior worth knowing

- Redirects are **never** followed (`redirect: 'manual'`). The SDK pipeline is the redirect
  authority (`TRANSPORT-1`/`TRANSPORT-2`).
- `Content-Length`, `Host`, `Transfer-Encoding`, and `Connection` are dropped outbound — the client
  computes its own framing — and every drop is logged by name (never by value) through the global
  logger, deduped per name by default (`TRANSPORT-11`/`TRANSPORT-13`).
- An abort that fires **after** `send()` resolved does not close the delivered body: the caller owns
  it (`SEAM-16`). Cancellation stays live for the whole in-flight window.
- A timeout surfaces as the retryable `TransportFailureError`; a caller abort as the terminal
  `CancellationError` (`TRANSPORT-3`/`TRANSPORT-4`). A raw `DOMException` is never surfaced.

## Conformance

Proven against the shared `TRANSPORT-N` suite in `@dexpace/transport-conformance`, the same one
`@dexpace/transport-undici` runs, so the two adapters cannot drift.
