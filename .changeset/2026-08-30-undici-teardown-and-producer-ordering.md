---
"@dexpace/transport-undici": patch
---

Fix two teardown defects in `undiciTransport()`.

`close()` no longer strands owned dispatchers when one fails to release. It previously walked the
owned set with a bare `for … await` loop, so the first rejecting `destroy()` aborted the walk — and
because the set is walked in reverse, a configured proxy meant the `ProxyAgent` actually holding the
pooled connections was the one left leaked. Every owned dispatcher is now destroyed before any
failure is reported, and the failure surfaces as a `TransportFailureError` carrying the underlying
cause (an `AggregateError` when more than one dispatcher failed) rather than a raw `undici` error
escaping a public method untyped.

`send()` now maps request headers before preparing the request body. `prepareBody()` starts a
streaming producer eagerly while header mapping reads `request.body.mediaType` — a getter on a
caller-supplied `Body` that may throw. In the old order such a throw left a live producer that
nothing could abandon, whose own later rejection reached Node's default `unhandledRejection` policy
(TRANSPORT-19, SEAM-30). `@dexpace/transport-fetch` already evaluated the two in this order and is
unaffected; both transports now carry a regression test pinning it.
