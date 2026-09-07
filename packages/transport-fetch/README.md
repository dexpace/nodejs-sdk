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
- `Content-Length`, `Host` and `Transfer-Encoding` are dropped outbound because the client computes
  its own framing; `Connection`, `Expect`, `Keep-Alive` and `Upgrade` because the layer underneath
  refuses them. WHATWG names all four forbidden request headers, but the implementations do not
  enforce that list and disagree about what happens instead: on Node the global `fetch` is
  undici-backed, so an undropped `Expect`/`Keep-Alive`/`Upgrade` reaches undici's own validation and
  fails the send with the **retryable** `TransportFailureError` — a permanent misconfiguration
  spending the caller's whole retry budget — while Bun 1.3.14 forwards the first two to the wire and
  hangs on the third until something else times the call out. Dropping the name is the one behaviour
  `TRANSPORT-12` asks for,
  and it matches `@dexpace/transport-undici` (measured 2026-09-05; audit #67 / #81).
- A header name the WHATWG `Headers` layer rejects — `@dexpace/core` admits every printable ASCII
  byte in a name, so `X Custom` is model-valid and unsendable — degrades to the same drop, never a
  failed send (`TRANSPORT-12`).
- Every drop is logged by name (never by value) through the global logger, deduped per name by
  default (`TRANSPORT-11`/`TRANSPORT-13`).
- An abort that fires **after** `send()` resolved does not close the delivered body: the caller owns
  it (`SEAM-16`). Cancellation stays live for the whole in-flight window.
- A timeout surfaces as the retryable `TransportFailureError`; a caller abort as the terminal
  `CancellationError` (`TRANSPORT-3`/`TRANSPORT-4`). A raw `DOMException` is never surfaced.
- A request `fetch` refused to make — an unsupported scheme such as `ftp://`, a forbidden method, an
  argument its own validation rejects — is a bare `TypeError` outside the `IoError` tree, so
  `retry/classify.ts`'s allow-list makes it non-retryable (`RETRY-2`). A failed *exchange* stays the
  retryable `TransportFailureError` (`TRANSPORT-20`). The table that tells them apart is
  `@dexpace/transport-shared`'s, shared with `@dexpace/transport-undici`, because the runtimes report
  the same refusal in three different shapes (audit #67 / #82).
- A 204, a 304 and every HEAD response carry `body === null`. Node's `fetch` says so itself; Bun
  1.3.14's returns a live `ReadableStream` for all three, which this transport cancels and replaces
  with `null` so the shape is the SDK's rather than the runtime's.
- `defaultTimeoutMs` must be an integer number of milliseconds in `1 .. 2**32 - 1` —
  `AbortSignal.timeout()`'s range. Anything else is a `TypeError` out of `fetchTransport()`, not a
  failure on the first send (`HTTP-35`).

## Conformance

Proven against the shared `TRANSPORT-N` suite in `@dexpace/transport-conformance`, the same one
`@dexpace/transport-undici` runs, so the two adapters cannot drift.
