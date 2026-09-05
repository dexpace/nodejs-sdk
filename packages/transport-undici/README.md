# @dexpace/transport-undici

The full-featured `Transport` for the dexpace SDK, built on `undici` — connection-pool control,
proxy routing, and real ownership-aware `close()` semantics. Exactly one external dependency.

```sh
bun add @dexpace/transport-undici @dexpace/core
```

```typescript
import {Request} from '@dexpace/core';
import {undiciTransport} from '@dexpace/transport-undici';

const transport = undiciTransport({
  agentOptions: {connections: 32},
  defaultTimeoutMs: 30_000,
});

try {
  const response = await transport.send(
    Request.newBuilder().url('https://example.com/v1/users').build(),
  );
  await response.close();
} finally {
  await transport.close(); // this transport owns a real dispatcher — always close it
}
```

`close()` is the teardown, not `await using`. The factory returns a plain `Transport`: the disposal
member is installed only when `Symbol.asyncDispose` exists, which it does not on this package's
declared `engines.node` floor of `>=20.3` (the symbol arrived in 20.4). Declaring `AsyncDisposable`
in the `.d.ts` regardless would be a type that lies on the supported runtime — `NFR-10` forbids it,
and the [`await using` support row](https://github.com/dexpace/nodejs-sdk/blob/main/docs/work/mvp/2026-09-04-open-items-dissolution.md#d-nfr-10-await-using) in the dissolved open-items register
records the decision and the four reasons the floor does not move instead. Unlike `@dexpace/transport-fetch`, closing here is not optional: see below.

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

## Proxy support and its two real limits

`ProxyOptions` routes here in full: address, Basic credentials, and `NO_PROXY`/`nonProxyHosts`
bypass globs, which route over a separate direct `Agent` rather than being tunnelled anyway.

**`type` must be `http`.** undici's `ProxyAgent` is an HTTP `CONNECT` tunnel and reads its `uri` as
a URL, so `socks4`/`socks5` — which `ProxyType` admits and core resolves from `ALL_PROXY`
(`CFG-22`) — are refused at construction with a `TypeError` naming the type. Before 2026-09-05 they
reached `new ProxyAgent({uri: 'socks5://…'})` and escaped this factory as an undici
`InvalidArgumentError`, untyped and undocumented. Neither shipped transport can carry SOCKS;
`docs/deviations.md` records the gap.

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

- File bodies (`body.kind === 'file'`, e.g. `@dexpace/body-file`'s `fileBody()`) are written
  through the descriptor's own `writeTo`, exactly as in the `fetch` transport — buffered below
  1 MB, streamed above it. Until 2026-09-05 this transport instead handed
  `createReadStream(path, {start, end})` to undici: one fewer userspace copy, and no `writeTo`, so
  `BODY-13`'s `transferred === count` check never ran and a file truncated between `stat` and
  `send` uploaded its remaining bytes and returned 200. `content-length` is dropped outbound, so
  the framing could not catch it either. `TRANSPORT-28`'s zero-copy clause is a SHOULD that no
  user-space path in either client can honour anyway (Deviation Ledger item 13); its MUSTs — a file
  body is replayable, and exactly its declared byte range reaches the wire — are honoured by the
  descriptor. Recognition, where it is still needed, stays structural: this package does not depend
  on `@dexpace/body-file`.
- Redirects are pinned off (`maxRedirections: 0`) even behind a bring-your-own dispatcher that may
  carry a redirect interceptor. The pipeline is the single redirect authority.
- `Connection` is **not** dropped outbound — §17's own note is that an undici-class transport
  forwards it — but only with a value undici will carry (`close` or `keep-alive`, matched
  case-insensitively). Any other value is dropped, because undici rejects it outright.
- `Content-Length`, `Host` and `Transfer-Encoding` are dropped because undici computes them;
  `Expect`, `Keep-Alive` and `Upgrade` because undici refuses them
  (`InvalidArgumentError`/`NotSupportedError` out of its own argument validation, before anything
  reaches the wire). So is any header name outside RFC 9110 `token` — `@dexpace/core` admits every
  printable ASCII byte in a name, undici does not. Every one of these is a drop logged by name
  (`TRANSPORT-12`), never a failed send.
- Destroying the dispatcher mid-flight surfaces as the terminal `CancellationError`, while a timeout
  on the same path stays the retryable `TransportFailureError` (`TRANSPORT-8`).
- `Response.protocol` is always `HTTP_1_1`: undici's `ResponseData` does not surface the negotiated
  version. A Deviation Ledger row, not a silent gap.

## Conformance

Proven against the shared `TRANSPORT-N` suite in `@dexpace/transport-conformance`, the same one
`@dexpace/transport-fetch` runs, so the two adapters cannot drift.
