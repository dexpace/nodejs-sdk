# redirect-handling

## Rules
- A redirect is attempted only for status codes 301, 302, 303, 307, and 308; any other status, including 2xx, 4xx, 5xx, and non-redirect 3xx, is returned verbatim without consulting redirect logic.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:7` · high · sha:f2a0d207be56</sub>
- Status codes 300, 304, and 305 MUST NOT be auto-followed even with a Location header, and 305 in particular must never redirect to a server-chosen proxy.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:7` · high · sha:f2a0d207be56</sub>
- For 301 and 302, a redirect is followed only if the original request method is in the configured allowed-method set (default {GET, HEAD}), and when followed, the original method and body are preserved, with deliberately no automatic POST-to-GET rewrite.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:8` · high · sha:f2a0d207be56</sub>
- 307 and 308 redirects preserve method and body and are followed only if the method is in the allowed-method set.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:8` · high · sha:f2a0d207be56</sub>
- 303 is not followed by default; when opted in it is re-issued as a GET with the body dropped and every Content-* request header, matched case-insensitively, removed, regardless of the original method.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:8` · high · sha:f2a0d207be56</sub>
- Any followed method-preserving redirect (301/302/307/308) re-sends the original body, so the body MUST be replayable; if present and not replayable, the operation MUST fail with a clear error naming replayability rather than corrupting or truncating the re-send, and the redirect is not attempted (303 is exempt because it drops the body).
  <sub>spec · `docs/product-spec/10-redirect-handling.md:9` · high · sha:f2a0d207be56</sub>
- The Authorization header MUST be stripped before every redirect re-issue, including same-origin and the 303 GET rebuild, because re-attaching a credential for a known origin is the auth layer's job.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:13` · high · sha:f2a0d207be56</sub>
- A redirect is cross-origin if and only if the resolved target differs from the original (seed) request origin in scheme, host (case-insensitive), or effective port (scheme default when omitted); the comparison MUST be against the seed origin, not the previous hop, so a same-origin sub-redirect on a foreign host cannot re-expose the credential.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:13` · high · sha:f2a0d207be56</sub>
- On a cross-origin redirect, whether method-preserving or a 303 GET rebuild, the origin-scoped Cookie and Proxy-Authorization headers MUST also be stripped.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:13` · high · sha:f2a0d207be56</sub>
- On a same-origin redirect the Cookie header SHOULD be retained, with only Authorization stripped same-origin; a more conservative port MAY strip all cookies.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:13` · high · sha:f2a0d207be56</sub>
- Because the auth layer runs inside the redirect loop, a cross-origin re-issue MUST carry an out-of-band signal instructing the auth layer to skip credential stamping; this signal MUST be impossible for a server-supplied Location to forge into a leak, MUST only suppress stamping and never cause a credential to be sent, and MUST be removed by the credential-attaching layer before dispatch; a same-origin re-issue is not signaled and is re-stamped normally.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:14` · high · sha:f2a0d207be56</sub>
- The redirect layer clears any inbound copy of the cross-origin marker on every re-issue before conditionally setting its own on a cross-origin hop, making it impossible for a server-supplied Location to forge the marker.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:14` · high · sha:f2a0d207be56</sub>
- The redirect follower MUST wrap the auth layer, with redirect outer and auth inside per hop, which is what necessitates the Authorization-stripping and cross-origin-signal requirements.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:14` · high · sha:f2a0d207be56</sub>
- Userinfo in the Location target (user:pass@) MUST be dropped before re-issue, and server-supplied embedded credentials MUST never be used.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:15` · high · sha:f2a0d207be56</sub>
- Stripping userinfo and resolving the Location generally MUST preserve the wire-exact, already-percent-encoded path, query, and fragment, and MUST preserve bracketed IPv6 literal hosts and explicit ports; re-encoding that would decode %2F to / or %26 to & is forbidden.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:15` · high · sha:f2a0d207be56</sub>
- A relative Location MUST be resolved against the current hop's request URL per RFC 3986; absolute values are used as-is after userinfo stripping.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:19` · high · sha:f2a0d207be56</sub>
- An HTTPS-to-HTTP scheme downgrade across a single hop MUST be rejected by default, failing with a clear error, and permitted only via an opt-in that surfaces the downgrade observably; credential stripping applies regardless, and the check is evaluated per hop.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:19` · high · sha:f2a0d207be56</sub>
- The redirect step MUST detect redirect loops by recording every visited absolute URI, seeded with the original request URI, and when a redirect would revisit a seen URI, MUST stop and return the current redirect response without throwing, leaving its body open for the caller.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:20` · high · sha:f2a0d207be56</sub>
- The number of followed redirects MUST be capped by max-hops (default 3); on reaching the cap the last response is returned as-is even if itself a 3xx, without throwing, and max-hops 0 MUST disable redirect following entirely.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:20` · high · sha:f2a0d207be56</sub>
- A malformed or unresolvable Location, such as an invalid URI, illegal characters, or an unsupported scheme, MUST NOT throw; the step logs it and returns the current redirect response unfollowed.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:21` · high · sha:f2a0d207be56</sub>
- A redirect response with a missing or empty Location MUST be returned unfollowed.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:21` · high · sha:f2a0d207be56</sub>
- The redirect step MUST manage response-body lifecycle deterministically -- before issuing a follow-up the prior redirect response's body MUST be closed; if building the follow-up throws (non-replayable body, downgrade rejection) the current response MUST be closed before the error propagates; on any 'return current' outcome the returned response is left open for the caller.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:22` · high · sha:f2a0d207be56</sub>
- Redirect following SHOULD be an iterative loop, not unbounded recursion, so it is stack-safe.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:22` · high · sha:f2a0d207be56</sub>
- A configured redirect predicate MUST fully override the built-in decision and receive a read-only, defensively-copied condition snapshot containing the current response, the count of redirects already followed, and an insertion-ordered set of visited URIs including the current request's, so it cannot mutate the live cycle-detection state.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:26` · high · sha:f2a0d207be56</sub>
- On the non-redirect fast path, a status that is not a recognized redirect code, the implementation SHOULD short-circuit before allocating a condition snapshot and MUST NOT consult the predicate; but a recognized 3xx always allocates the snapshot and consults the predicate, even with no usable Location.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:26` · high · sha:f2a0d207be56</sub>
- The configured allowed-method set MUST be stored as an immutable defensive copy so post-construction mutation of the caller's collection cannot change policy.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:27` · high · sha:f2a0d207be56</sub>
- Each followed hop, loop detection, and scheme-downgrade event SHOULD be emitted as structured records with URLs passed through a redactor, redaction failures degrading to a placeholder rather than crashing logging; the malformed-Location event is the exception, logging the raw Location string as received since it failed to parse and cannot be redacted.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:27` · high · sha:f2a0d207be56</sub>

## Constraints

## Conclusions
- Redirect credential hygiene relies on the WHATWG `URL` class, which never performs DNS resolution to compare origins, unlike `java.net.URL`'s `equals()`/`hashCode()` behavior that the JVM reference has to explicitly work around.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:49-53` · high · sha:b0e2bb42d809</sub>

## Reference
- Redirect following is a synchronous pillar step coordinating with the auth pillar via an internal cross-origin marker; the async pipeline follows no redirects.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:3` · high · sha:f2a0d207be56</sub>
- Only the auth step strips the internal cross-origin marker in the reference implementation, so a pipeline with no auth step, including the sync standard-resilience preset, forwards the internal marker to the transport; a robust port should strip the signal independently of whether a credential layer runs.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:14` · high · sha:f2a0d207be56</sub>
- The header the redirect target is read from MAY be configurable, defaulting to Location.
  <sub>spec · `docs/product-spec/10-redirect-handling.md:27` · high · sha:f2a0d207be56</sub>
- Cross-origin detection in the port compares `new URL(target).origin` against the seed origin after normalizing default ports.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:53-55` · high · sha:b0e2bb42d809</sub>

## Conflicts

## Superseded
