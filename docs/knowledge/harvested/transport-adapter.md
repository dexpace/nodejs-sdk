# transport-adapter

## Rules
- An SDK-managed (builder-constructed) transport must disable the native client's automatic redirect following, and the follow-redirects knob's default must be off.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:7-7` · high · sha:2d5843c58993</sub>
- Where the native client has a built-in connection-failure/automatic retry feature, an SDK-managed transport must disable it.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:8-8` · high · sha:2d5843c58993</sub>
- On the sync path, a caller-initiated cancellation must surface as a terminal, non-retryable interrupt-shaped I/O exception with the runtime's cancellation signal preserved, must not be repackaged as the retryable transport-failure exception, and discrimination must be out-of-band (the runtime's cancellation state), not by matching messages.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:12-12` · high · sha:2d5843c58993</sub>
- A read/response timeout must be classified as a retryable transport failure (the canonical NetworkException) and must not set the caller's cancellation flag, even when the runtime represents a timeout with the same exception family as an interrupt.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:13-13` · high · sha:2d5843c58993</sub>
- A per-call timeout override must apply to that single call only, overriding the configured default for that call and leaving the shared native client untouched; a null override leaves the configured default in force.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:14-14` · high · sha:2d5843c58993</sub>
- A transport should not let a positive per-call timeout be silently reduced to zero by unit truncation; where the native timeout API is coarser than the requested duration and treats zero as "no timeout", a positive sub-resolution duration must be clamped up to the smallest finite deadline rather than truncated to zero.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:15-15` · high · sha:2d5843c58993</sub>
- Cancelling the async response future must propagate cancellation into the in-flight native exchange so its connection/resources are released promptly.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:16-16` · high · sha:2d5843c58993</sub>
- Where the native client can surface a cancellation originating inside it while the SDK future is still live, that cancellation must complete the future with a terminal, non-retryable cancellation-shaped exception (not the retryable type), while a genuine timeout on the same path must still complete retryable; this is implemented by the OkHttp reference transport and need not apply to a transport with no internal-cancel path.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:17-17` · high · sha:2d5843c58993</sub>
- If a native response is delivered after the SDK future has already completed or cancelled (the adaptation race), the adapted response must be closed so its connection is returned to the pool.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:18-18` · high · sha:2d5843c58993</sub>
- The caller's explicit request Content-Type must remain authoritative and must not be overwritten by a body-derived media type; a body-derived Content-Type is emitted only when the caller set none (matched case-insensitively).
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:22-22` · high · sha:2d5843c58993</sub>
- Headers the native client computes from the body/connection (at minimum Content-Length, Host, Transfer-Encoding, plus any the native client rejects outright such as Connection/Expect/Upgrade on java.net.http) must be dropped before dispatch, the transport should additionally log each drop at verbose level, and the exact drop set is transport-specific (OkHttp does not drop Connection).
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:23-23` · high · sha:2d5843c58993</sub>
- A header valid at the SDK model layer but rejected by the native client's stricter wire grammar must be dropped for that header only, the resulting native exception must not escape the send contract, and the rest of the headers and body must still be dispatched on both sync and async paths.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:24-24` · high · sha:2d5843c58993</sub>
- A transport should expose a configurable policy for how header drops are logged (every drop loudly; first per name loudly then quiet as default; all quiet), and the per-name dedup mode must be case-insensitive and bounded so an attacker cannot grow it without limit.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:25-25` · high · sha:2d5843c58993</sub>
- Inbound response headers must be copied leniently enough that a single malformed header does not fail the whole response — a control byte in a value, or a control/non-ASCII byte in a name, must drop only that header (logged at verbose) while the body and remaining headers are still delivered — and a transport should preserve a non-ASCII/obs-text byte in a value rather than stripping it.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:26-26` · high · sha:2d5843c58993</sub>
- close() must be ownership-aware, releasing only resources the transport itself created (native client, dispatcher/executor, pool, cache, any SDK-created executor), so a BYO native client and its resources must not be shut down or mutated and the caller may keep using it after the transport is closed.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:30-30` · high · sha:2d5843c58993</sub>
- close() must be idempotent and must not block on native shutdown in a way that discards the caller's cancellation/interrupt state, using non-blocking shutdown with no unbounded await.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:31-31` · high · sha:2d5843c58993</sub>
- A non-replayable (single-use) request body must be written to the wire exactly once: the transport must prevent the native client from re-writing it (e.g. by reporting the body as one-shot) and must not itself trigger a second write, while a replayable body may be re-written.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:32-32` · high · sha:2d5843c58993</sub>
- When the native body API drives writes through a re-subscribable producer (so a native internal resend such as proxy-auth 407 or GOAWAY re-reads the body), the transport must make each subscription produce identical bytes by buffering a non-replayable body once into a replayable copy, and if that buffering fails mid-write the send must fail with the transport-failure type rather than shipping a truncated body.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:33-33` · high · sha:2d5843c58993</sub>
- When a streaming-body subscription is acquired but abandoned (connect failure, early cancellation), the transport should cancel/unblock its producer so no writer thread or file handle is stranded, and teardown must be idempotent.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:34-34` · high · sha:2d5843c58993</sub>
- Any transport failure that produced no HTTP response (connection refused, DNS/TLS failure, peer reset, connect/read timeout) must surface as the SDK's canonical retryable transport-failure exception, which must be a subtype of the platform I/O-error type and must report itself retryable.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:38-38` · high · sha:2d5843c58993</sub>
- On the async path, a failure before dispatch (request adaptation rejecting a request, a synchronous dispatch rejection, an adapter bug) must be delivered through the returned future rather than thrown synchronously; only truly fatal runtime errors may propagate synchronously.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:39-39` · high · sha:2d5843c58993</sub>
- If adapting a live native response throws at any point after the native response (and its socket) are live, the transport must close the native response before propagating, on both sync and async paths.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:40-40` · high · sha:2d5843c58993</sub>
- The async send must not complete its future with a null response on success; a transport with no response must complete exceptionally.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:41-41` · high · sha:2d5843c58993</sub>
- The response status code must be mapped totally: any code the server returns, including vendor/non-standard codes (499, 520-526, 530), must be surfaced faithfully, and such a response and its body must remain readable and closeable.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:42-42` · high · sha:2d5843c58993</sub>
- The response body must be exposed as a lazily-read stream, not pre-buffered, and closing the SDK response must cascade to close the native body and release the connection, with the caller owning closing the response.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:43-43` · high · sha:2d5843c58993</sub>
- A body-less request must be valid for any method the model permits: where the native client rejects a null body for a body-requiring method (POST/PUT/PATCH), the transport must substitute a zero-length body (with Content-Length: 0) instead of failing, and for body-forbidden methods (GET/HEAD/TRACE/CONNECT) it must not attach a body.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:44-44` · high · sha:2d5843c58993</sub>
- An unparseable or absent inbound Content-Type should be downgraded to "no media type" rather than failing the response, and an absent/invalid Content-Length should map to the unknown-length sentinel (-1).
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:45-45` · high · sha:2d5843c58993</sub>
- A transport should stream a file-backed request body directly from the file (honoring start position and byte count) on a zero-copy path where supported, and must treat a file body as replayable so it can be re-sent.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:46-46` · high · sha:2d5843c58993</sub>
- A transport instance must be safe for concurrent send calls from multiple threads and must be effectively immutable after construction, with all per-request state confined to local scope or the returned response graph.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:47-47` · high · sha:2d5843c58993</sub>
- When the SDK's proxy configuration carries a feature the native client cannot honor, the transport should make the limitation discoverable rather than silently misbehaving and must not leak credentials: a custom (non-Basic) proxy challenge handler should be surfaced with a WARN and proxy auth should fall back to Basic, and proxy credentials must not be logged and must not be answered to an origin-server (401) challenge, only to a matching proxy (407).
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:48-48` · high · sha:2d5843c58993</sub>

## Constraints

## Conclusions

## Reference
- The SDK is an HTTP-client toolkit rather than an HTTP client itself: it owns redirect, retry, auth, and logging in its pipeline and delegates only "send one request, get one response" to a transport.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:3-3` · high · sha:2d5843c58993</sub>
- A conforming transport disables the native client's own redirect/retry so the pipeline is the single authority, faithfully maps between the SDK's immutable models and the native client's, classifies cancellation/timeout/no-response failures into the SDK's canonical exception contract, propagates cancellation into the native client bidirectionally, keeps the caller's Content-Type authoritative, drops headers the native client cannot encode rather than failing the send, never touches the lifecycle of a BYO client, and writes request bodies replay-safely.
  <sub>spec · `docs/product-spec/17-transport-adapter-conformance-contract.md:3-3` · high · sha:2d5843c58993</sub>
- The transport conformance suite verifies native redirects and native auto-retry are disabled on SDK-managed transports (TRANSPORT-1, TRANSPORT-2).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:59` · high · sha:0451cc7f3bb4</sub>
- The transport conformance suite verifies sync cancellation yields a terminal interrupt type with the flag preserved rather than the retryable type (TRANSPORT-3); timeout yields a retryable type with a clear flag with the timeout subtype checked first (TRANSPORT-4); per-call timeout applies to one call only (TRANSPORT-5); a sub-resolution positive timeout is clamped rather than truncated (TRANSPORT-6); an async future cancel propagates into the native exchange (TRANSPORT-7); a native-internal cancel yields a terminal type while timeout stays retryable (TRANSPORT-8); and an adaptation-race response is still closed (TRANSPORT-9).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:60` · high · sha:0451cc7f3bb4</sub>
- The transport conformance suite verifies an explicit Content-Type wins over body-derived, which applies only when absent (TRANSPORT-10); framing headers are dropped and recomputed (TRANSPORT-11); a model-valid-but-native-rejected header is dropped rather than thrown in both sync and async (TRANSPORT-12); dropped-header logging is bounded and case-insensitive (TRANSPORT-13); and a malformed inbound header is dropped rather than failing the response, with obs-text preserved (TRANSPORT-14).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:61` · high · sha:0451cc7f3bb4</sub>
- The transport conformance suite verifies ownership-aware close leaves a BYO client usable (TRANSPORT-15); close is idempotent, non-blocking, and interrupt-safe (TRANSPORT-16); a single-use body is written once (TRANSPORT-17); a re-subscribable producer replays identical bytes or fails on buffering failure (TRANSPORT-18); and an abandoned streaming subscription unblocks its producer (TRANSPORT-19).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:62` · high · sha:0451cc7f3bb4</sub>
- The transport conformance suite verifies a no-response failure yields a retryable I/O-subtype exception (TRANSPORT-20); a pre-dispatch async failure surfaces via the future rather than a synchronous throw (TRANSPORT-21); a response-adaptation throw closes the native response (TRANSPORT-22); async never completes with null on success (TRANSPORT-23); vendor status codes are surfaced with a readable body (TRANSPORT-24); a lazy streaming body has close-cascade (TRANSPORT-25); a body-less request is valid for any method with a zero-length body substituted where required (TRANSPORT-26); a malformed inbound Content-Type/Length is downgraded (TRANSPORT-27); a file body is zero-copy where supported and replayable (TRANSPORT-28); the transport is concurrent-safe and immutable (TRANSPORT-29); and unsupported proxy features are discoverable with credentials never leaked (TRANSPORT-30).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:63` · high · sha:0451cc7f3bb4</sub>

## Conflicts

## Superseded
