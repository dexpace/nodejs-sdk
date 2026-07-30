# authentication

## Rules
- A port must preserve the security invariants of never leaking credentials over plaintext or cross-origin, an unpredictable Digest cnonce, and secret redaction, along with the deterministic resolution semantics and the exact challenge/retry lifecycle.
  <sub>spec · `docs/product-spec/11-authentication.md:3` · high · sha:efba58233dd1</sub>
- The recognized auth scheme set MUST be exactly {OAUTH2, API_KEY, BASIC, DIGEST, NO_AUTH}, where NO_AUTH is a distinct sentinel meaning 'may run anonymously / skip credential stamping' rather than a wire scheme.
  <sub>spec · `docs/product-spec/11-authentication.md:7` · high · sha:efba58233dd1</sub>
- An auth requirement MUST bind exactly one scheme to its own OAuth scopes and params, meaningful only for OAUTH2 and never inspected by resolution but preserved, MUST be immutable such that input collections mutated after construction do not affect the stored value, and MUST have value-based equality over scheme, scopes, and params.
  <sub>spec · `docs/product-spec/11-authentication.md:7` · high · sha:efba58233dd1</sub>
- An auth descriptor MUST be a non-empty ordered list of requirements in preference order, MUST reject an empty list at construction, MUST be immutable, and MUST report 'allows anonymous' true if and only if any requirement's scheme is NO_AUTH.
  <sub>spec · `docs/product-spec/11-authentication.md:7` · high · sha:efba58233dd1</sub>
- Tier resolution MUST select the single most-specific descriptor present, in the strict order per-call, then operation, then client, and resolve only against that descriptor; a higher tier that is present but unsatisfiable MUST NOT fall through to a lower tier, since it fails because the caller asked for that override explicitly.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- Within the selected auth descriptor, resolution MUST return the first requirement in declared order whose scheme is satisfiable, where satisfiable means NO_AUTH (always) or membership in the supplied set of available schemes, without inspecting any concrete credential.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- Auth resolution MUST fail with an argument error when all tiers are absent, and with a distinct auth-resolution error carrying the required schemes in preference order and the available schemes when the selected descriptor lists no satisfiable scheme.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- The auth resolver MUST be stateless, concurrency-safe, and a deterministic pure function of its inputs.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- Every credential type MUST redact its secret in any string/diagnostic representation without mutating or corrupting the real fields, MAY leave non-secret fields visible, and MUST preserve its variant-specific equality -- the bearer token has value-based equality over its real token and expiry (unaffected by the redacted string form), while the API-key and name-key credentials use reference identity, so two instances with identical fields are not equal.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- Credential construction MUST validate secret and identity fields as non-blank and reject blanks, for the bearer token, API key, and name-key name and key.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- Bearer-token expiry MUST be optional, with null meaning it never locally expires, and MUST be evaluated additively with a grace margin -- expired at reference time now with margin M if and only if expiry is non-null and now plus M is strictly after expiry.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- A token provider's fetch errors MUST propagate and MUST NOT be cached, so a subsequent request retries, and async callers MUST observe a provider error through the asynchronous channel (a failed future), never a synchronous throw.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- The challenge parser MUST parse RFC 7235 WWW-Authenticate/Proxy-Authenticate values into an ordered list of challenges, honoring multiple comma-separated challenges, quoted-string values containing commas and equals signs, backslash escapes, scheme/param names normalized to lower case, values stored verbatim after unquoting, a bare scheme emitted with an empty parameter map, and a token68 value recorded under a synthetic key.
  <sub>spec · `docs/product-spec/11-authentication.md:16` · high · sha:efba58233dd1</sub>
- The challenge parser MUST be lenient and never throw -- blank input yields an empty list, a malformed challenge recovers to the next top-level comma, an unterminated quoted string terminates at end-of-input, and parameters parsed before a malformed tail are preserved.
  <sub>spec · `docs/product-spec/11-authentication.md:16` · high · sha:efba58233dd1</sub>
- Basic stamping MUST produce 'Basic ' plus base64 of UTF-8-encoded username:password, computed once, accept a Basic challenge case-insensitively, emit Authorization or Proxy-Authorization for a proxy challenge, and validate credentials as non-empty, permitting whitespace-only per RFC 7617, which is laxer than the non-blank rule used elsewhere.
  <sub>spec · `docs/product-spec/11-authentication.md:17` · high · sha:efba58233dd1</sub>
- Digest stamping MUST support exactly {MD5, MD5-sess, SHA-256, SHA-256-sess} with qop auth or absent, declining auth-int-only challenges, unsupported algorithms, and mutual-auth verification.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- A Digest challenge is considered satisfiable if and only if the scheme is Digest (case-insensitive), it carries realm and nonce, qop contains auth or is absent, and the algorithm is supported or absent, defaulting to MD5, preferring the algorithm earliest in the configured preference list regardless of wire order.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- Digest stamping MUST compute HA1/HA2/response per RFC 7616/2069 using lower-case hex of the selected algorithm.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- The Digest nonce count MUST be tracked per server nonce starting at 00000001 and incrementing only on reuse, rendered as exactly 8 lower-case hex digits using the low 32 bits on overflow.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- The Digest client nonce MUST be drawn from a cryptographically strong source with at least 128 bits of entropy.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- Digest MUST use UTF-8 hash-input encoding when the challenge advertises charset=UTF-8 and ISO-8859-1 otherwise.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- Digest stamping MUST quote/escape the appropriate fields, leave qop/nc/algorithm unquoted with the full algorithm spelling, use the request-target as the digest-uri, and emit cnonce/nc/qop only when qop is negotiated.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- The per-nonce counter store SHOULD be bounded, defaulting to 1024 entries, and drained under the cap; evicting a live nonce is harmless because its nc restarts at 1, which is spec-legal for a fresh nonce.
  <sub>spec · `docs/product-spec/11-authentication.md:18` · high · sha:efba58233dd1</sub>
- Composing auth handlers MUST delegate to the first handler in declaration order whose can-handle check passes and MUST defensively copy the handler list; callers order stronger schemes first.
  <sub>spec · `docs/product-spec/11-authentication.md:19` · high · sha:efba58233dd1</sub>
- Auth handlers MUST be safe for concurrent invocation, with per-handler mutable counters such as Digest nc using thread-safe primitives so concurrent reuse of one nonce still yields correct, non-duplicated counts.
  <sub>spec · `docs/product-spec/11-authentication.md:19` · high · sha:efba58233dd1</sub>
- An auth handler MUST emit Authorization for WWW-Authenticate challenges and Proxy-Authorization for Proxy-Authenticate challenges, selected by an explicit proxy flag, and return no header when it cannot satisfy any offered challenge.
  <sub>spec · `docs/product-spec/11-authentication.md:19` · high · sha:efba58233dd1</sub>
- Static key-credential stamping MUST write the key into the configured header, default Authorization, and when a prefix is configured, prepend it followed by a single space, with the stamping step stateless after construction.
  <sub>spec · `docs/product-spec/11-authentication.md:19` · high · sha:efba58233dd1</sub>
- There MUST be exactly one auth step occupying the single AUTH pillar stage, running nested inside both the redirect loop and the retry loop, so auth executes per redirect hop and per retry attempt, with redirect wrapping retry wrapping auth.
  <sub>spec · `docs/product-spec/11-authentication.md:23` · high · sha:efba58233dd1</sub>
- On any path where a credential will be attached, the auth step MUST reject a non-HTTPS request URL, case-insensitive, before any token fetch or header stamping, failing with an error naming the concrete step and the offending scheme; credentials MUST NOT be stamped over plaintext.
  <sub>spec · `docs/product-spec/11-authentication.md:23` · high · sha:efba58233dd1</sub>
- On a cross-origin redirect re-issue, differing in scheme, host, or effective port under the RFC 6454 tuple and marked by the redirect step, the auth step MUST NOT stamp the caller's credential, MUST strip the internal cross-origin marker so it never reaches the wire, and MUST skip the HTTPS guard so a deliberately-allowed downgrade hop is forwarded credential-free rather than hard-failing; a same-origin re-issue MUST be re-stamped normally and remains subject to the HTTPS guard.
  <sub>spec · `docs/product-spec/11-authentication.md:24` · high · sha:efba58233dd1</sub>
- The cross-origin suppression mechanism MUST only be able to suppress credential stamping, never force a credential to be sent.
  <sub>spec · `docs/product-spec/11-authentication.md:24` · high · sha:efba58233dd1</sub>
- On a 401 carrying a WWW-Authenticate header, the auth step MUST consult its challenge hook; if the hook yields a non-null replacement request, the step MUST close the original 401 and drive the replacement through a fresh copy of the downstream chain exactly once, with no further challenge handling on the replacement; the default hook yields no replacement.
  <sub>spec · `docs/product-spec/11-authentication.md:25` · high · sha:efba58233dd1</sub>
- A 401 without a WWW-Authenticate header MUST be returned unchanged without consulting the challenge hook.
  <sub>spec · `docs/product-spec/11-authentication.md:25` · high · sha:efba58233dd1</sub>
- If the challenge hook throws, or its async future completes exceptionally, or the async hook throws synchronously, the auth step MUST close the open 401 response body before propagating.
  <sub>spec · `docs/product-spec/11-authentication.md:25` · high · sha:efba58233dd1</sub>
- The 401 re-challenge replay MUST be gated on request-body replayability -- if the replacement carries a non-replayable body, the step MUST skip the replay, surface the original 401 unchanged, and MUST NOT close that original response, since the caller owns it.
  <sub>spec · `docs/product-spec/11-authentication.md:26` · high · sha:efba58233dd1</sub>
- The bearer auth step MUST stamp Authorization: Bearer <token> using a token cached until a configurable refresh margin before expiry, default 30 seconds, ensuring concurrent requests racing on a missing/expiring token result in at most one provider fetch (single-flight) with a non-blocking hot-path read of a valid cached token.
  <sub>spec · `docs/product-spec/11-authentication.md:27` · high · sha:efba58233dd1</sub>
- The bearer auth step MUST reject a null token and a token already expired at fetch time, evaluated with no margin, and MUST NOT cache a thrown provider error.
  <sub>spec · `docs/product-spec/11-authentication.md:27` · high · sha:efba58233dd1</sub>
- On a 401 advertising a Bearer challenge, the bearer auth step MUST evict only the exact cached token that produced the 401, matched by the stamped header value, and re-stamp a single retry with a freshly fetched token, preserving a token another request already refreshed, surfacing the 401 unchanged when the rejected request carried no Authorization header or the response advertises no Bearer challenge, and firing the eviction-driven retry regardless of HTTP method.
  <sub>spec · `docs/product-spec/11-authentication.md:27` · high · sha:efba58233dd1</sub>
- The async bearer step MUST implement a three-zone expiry policy without blocking the dispatching thread -- fresh tokens are stamped with no refresh, expiring-but-valid tokens are stamped immediately while an off-thread background refresh is kicked off, and expired/missing tokens await a fresh single-flight fetch, coalescing concurrent expiring/missing requests onto one fetch, not caching a failed fetch, and treating a failed background refresh as non-fatal since a valid token was already stamped.
  <sub>spec · `docs/product-spec/11-authentication.md:27` · high · sha:efba58233dd1</sub>
- In the async auth path, the HTTPS-guard failure and any challenge hook error SHOULD be delivered through the asynchronous channel, a failed future, rather than synchronously thrown.
  <sub>spec · `docs/product-spec/11-authentication.md:27` · high · sha:efba58233dd1</sub>
- The cryptographically-strong client nonce (at least 128 bits of entropy) must use `crypto.getRandomValues()` rather than `Math.random()`, since it must come from a CSPRNG, never a non-cryptographic RNG.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:68-70` · high · sha:b0e2bb42d809</sub>

## Constraints
- The Web Crypto API's `subtle.digest()` does not implement MD5 because the algorithm is excluded from the standard on security grounds, even though RFC 7616 Digest still requires MD5/MD5-sess support for interoperability.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:62-64` · high · sha:b0e2bb42d809</sub>

## Conclusions
- The port prefers the Web Crypto API (`globalThis.crypto.subtle`) over Node-specific `node:crypto` for digest authentication primitives to keep `@dexpace/core` portable to browsers, Deno, and Cloudflare Workers.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:57-63` · high · sha:b0e2bb42d809</sub>
- `@dexpace/core` implements MD5 itself in a small, self-contained, dependency-free TypeScript module rather than adding an npm dependency for it.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:64-67` · high · sha:b0e2bb42d809</sub>

## Reference
- Authentication has two largely independent halves -- a scheme-agnostic descriptor/resolver model that decides which auth alternative an operation requires, and a stamping/challenge half that puts credentials on the wire and reacts to server challenges.
  <sub>spec · `docs/product-spec/11-authentication.md:3` · high · sha:efba58233dd1</sub>
- 401 eviction/refresh matching for bearer tokens is done on the stamped header string, not credential equality, so value equality is not required for the key credentials.
  <sub>spec · `docs/product-spec/11-authentication.md:8` · high · sha:efba58233dd1</sub>
- The reference implementation enforces the 401 replayability gate on the synchronous auth step only; the async auth step does not currently apply a replayability gate and closes the original 401 before re-driving unconditionally, and a faithful port SHOULD apply the same gate on both paths.
  <sub>spec · `docs/product-spec/11-authentication.md:26` · high · sha:efba58233dd1</sub>
- An auth challenge is a parsed RFC 7235 WWW-Authenticate/Proxy-Authenticate directive, a scheme plus a parameter map, that a server returns on a 401/407 to indicate how a client may authenticate.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:7` · high · sha:f0b3d2058626</sub>
- `@dexpace/core` uses `crypto.subtle.digest('SHA-256', ...)` for the SHA-256 and SHA-256-sess Digest authentication algorithms.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:67-68` · high · sha:b0e2bb42d809</sub>

## Conflicts

## Superseded
