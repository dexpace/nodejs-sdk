# @dexpace/transport-undici

The full-featured `Transport` for the dexpace SDK, built on `undici` — connection-pool control,
proxy routing, and real ownership-aware `close()` semantics. Exactly one external dependency.

```sh
bun add @dexpace/transport-undici @dexpace/core
```

```typescript
import {Request} from '@dexpace/core';
import {undiciTransport} from '@dexpace/transport-undici';

await using transport = undiciTransport({
  agentOptions: {connections: 32},
  defaultTimeoutMs: 30_000,
});

const response = await transport.send(
  Request.newBuilder().url('https://example.com/v1/users').build(),
);
await response.close();
```

## Dispatcher ownership

Exactly one decision, made once at construction, fixing both the dispatcher and who closes it:

| Option supplied | Dispatcher used | Closed by `close()` |
|---|---|---|
| `dispatcher` | yours, as-is | **no** — a caller-supplied client is never touched (`SEAM-14`) |
| `proxy` | a `ProxyAgent` this package constructs, plus an `Agent` for `NO_PROXY` hosts | yes, both |
| neither | an `Agent` this package constructs | yes |

Supplying **both** `dispatcher` and `proxy` is a construction-time `TypeError`, not a silent win for
one: a bring-your-own dispatcher may already be a `ProxyAgent`, and ignoring either option would
hide which is in force. `close()` is idempotent and concurrent calls share one teardown
(`TRANSPORT-15`/`TRANSPORT-16`).

`close()` **destroys** the dispatchers it owns rather than draining them: `TRANSPORT-16` requires a
non-blocking shutdown with no unbounded await, and a graceful close would stall teardown for as long
as one in-flight send against a slow peer takes. Sends still in flight therefore reject with the
terminal `CancellationError`, and so does a `send()` issued after `close()` — this transport's
documented `SEAM-15` post-close mode. It cannot succeed over a dispatcher that no longer exists, so
it is not reported as a retryable failure.

## Proxy support and its one real limit

`ProxyOptions` routes here in full: address, Basic credentials, and `NO_PROXY`/`nonProxyHosts`
bypass globs, which route over a separate direct `Agent` rather than being tunnelled anyway.

**A custom `challengeHandler` cannot be dispatched**, and the limitation is surfaced rather than
silently misbehaving (`TRANSPORT-30`):

- undici's `ProxyAgent` takes its credential **only** from its own constructor and rejects any
  per-request `Proxy-Authorization` header with `InvalidArgumentError` — a deliberate security fix
  on their side, not an oversight. The constructor runs before any challenge has been seen, so
  there is no point at which a handler-minted credential could be applied to the exchange that
  provoked it.
- Configuring one therefore emits a WARN at construction, and a second WARN the first time a proxy
  actually answers `407`. The `407` is surfaced to the caller unchanged, for its own auth layer.
- Proxy auth falls back to **Basic**: `ProxyOptions.credentials`, which is passed to the
  `ProxyAgent` constructor as a token. Credentials are never logged, and are never sent in answer to
  an origin-server `401`.
- A per-request `Proxy-Authorization` header is dropped from the outbound pass whenever a proxy is
  configured — forwarding one would turn every proxied send into a hard failure. The drop is logged
  by name like any other.

## Behavior worth knowing

- File bodies (`body.kind === 'file'`, e.g. `@dexpace/body-file`'s `fileBody()`) dispatch straight
  off the file honoring `start`/`count`, one fewer userspace copy than the `fetch` transport
  (`TRANSPORT-28`; a literal kernel zero-copy path does not exist on Node — see the Deviation
  Ledger). Recognition is structural, on `kind` alone: this package does not depend on
  `@dexpace/body-file`.
- Redirects are pinned off (`maxRedirections: 0`) even behind a bring-your-own dispatcher that may
  carry a redirect interceptor. The pipeline is the single redirect authority.
- `Connection` is **not** dropped outbound — §17's own note is that an undici-class transport
  forwards it. `Content-Length`, `Host`, and `Transfer-Encoding` are.
- Destroying the dispatcher mid-flight surfaces as the terminal `CancellationError`, while a timeout
  on the same path stays the retryable `TransportFailureError` (`TRANSPORT-8`).
- `Response.protocol` is always `HTTP_1_1`: undici's `ResponseData` does not surface the negotiated
  version. A Deviation Ledger row, not a silent gap.

## Conformance

Proven against the shared `TRANSPORT-N` suite in `@dexpace/transport-conformance`, the same one
`@dexpace/transport-fetch` runs, so the two adapters cannot drift.
