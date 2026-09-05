# @dexpace/transport-shared

Internal plumbing shared by `@dexpace/transport-fetch` and `@dexpace/transport-undici`. **Not a
package you install directly** — every export is `@internal`, and both transports depend on it so
that the one algorithm they both need exists once rather than twice.

It is published anyway because `NFR-4` snapshots every published unit regardless of how its exports
are marked, and because a transport's own `dependencies` must resolve for consumers.

## What lives here, and why it is not in a transport

Putting any of this in one transport would make the other depend on a sibling transport, which the
Phase 8 segmentation design deliberately avoids — the two adapters must stay independent of each
other, not merely of the rest of the tree.

| Module | Concern |
|---|---|
| `header-mapping.ts` | `TRANSPORT-10`/`TRANSPORT-12`'s outbound drop-and-degrade pass and `TRANSPORT-14`'s lenient inbound copy, which preserves obs-text values rather than rejecting them |
| `drop-log.ts` | `TRANSPORT-13`'s bounded, case-insensitive, drain-to-cap dedup of already-logged drop names. Names only — never values |
| `abort-mapping.ts` | The single mapping from an aborted signal to a canonical SDK error: `TransportFailureError` on timeout, `CancellationError` otherwise. A raw `DOMException` is never surfaced |
| `dispatch-classification.ts` | The single mapping from a *native rejection* to one: the retryable `TransportFailureError` `TRANSPORT-20` requires for a failed exchange, and a bare `TypeError` outside the `IoError` tree for a request the client refused to make. An allow-list, so an unrecognised rejection stays retryable |
| `body-less.ts` | Which method/status pairs can carry no response body at all, so `Response.body` is `null` for a 204, a 304 or a HEAD on every runtime rather than on whichever ones agree with the spec |
| `default-timeout.ts` | `HTTP-35`'s range check for a transport-wide default timeout: an integer in `1 .. 2**32 - 1`, which is `AbortSignal.timeout()`'s and therefore every transport's |
| `body-pump.ts` | Turning a `Body` into a request stream the transport owns the closing of, plus `TRANSPORT-19`'s idempotent teardown for an abandoned producer, and the classification of a producer's own failure |
| `signal-fork.ts` | `SEAM-16`'s abort-after-delivery rule: both native clients tie a response body's lifetime to the signal they were given, so the transport dispatches over a fork it detaches at delivery — and `TRANSPORT-9`'s other direction, a handle the transport pulls to cancel a native call it has abandoned |
