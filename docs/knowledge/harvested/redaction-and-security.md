# redaction-and-security

## Rules
- Credentials are transport-scoped and never stamped over plaintext (AUTH-28).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:22-22` · high · sha:8014d2ec2c9d</sub>
- Redirects strip credentials and never launder them cross-origin (REDIR-7, REDIR-9, REDIR-8).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:22-22` · high · sha:8014d2ec2c9d</sub>
- Header names and values are validated against request-splitting before any transport sees them (HTTP-17 through HTTP-19).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:22-22` · high · sha:8014d2ec2c9d</sub>
- Digest client nonces come from a cryptographically strong source (AUTH-20).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:22-22` · high · sha:8014d2ec2c9d</sub>
- Log-preview and error-body buffers are bounded (HTTP-52, BODY-30).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:22-22` · high · sha:8014d2ec2c9d</sub>
- URL userinfo (user:password@) must always be redacted to a fixed placeholder (***:***@), unconditionally and independent of any allow-list.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:24-24` · high · sha:1b678eca176d</sub>
- URL query-parameter values must be redacted to *** unless the parameter name (decoded, case-insensitive) is allow-listed; the default query allow-list is exactly {api-version}, an empty allow-list redacts every value, multi-value keys are treated atomically, and names and the "=" separator are preserved.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:25-25` · high · sha:1b678eca176d</sub>
- A URL fragment must be scrubbed under the same allow-list as query parameters — key=value tokens redacted like query values, a plain fragment with no "=" preserved verbatim — because OAuth implicit-flow access tokens ride in the fragment.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:26-26` · high · sha:1b678eca176d</sub>
- URL redaction must not alter scheme, host, port, or path, must preserve a present-but-empty query, must not treat a "?" inside the fragment as a query delimiter, and may drop a trailing "&" empty final pair.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:27-27` · high · sha:1b678eca176d</sub>
- URL redaction must be total: on any parse/rebuild failure it must return a fixed sentinel ([malformed url]) rather than throwing.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:28-28` · high · sha:1b678eca176d</sub>
- A URL arriving as a header value must be redacted: a parseable absolute value is redacted like a request URL, a relative/unparseable value must keep the path and drop everything after it while appending a fixed "?***" marker whenever the value carried a query or fragment, and a value with neither is returned verbatim.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:29-29` · high · sha:1b678eca176d</sub>
- When logging header values, URL-valued response headers (at minimum Location and Content-Location) must be redacted through the URL-value redactor while other header values pass through unchanged, and the redaction policy must be shared by the sync and async logging paths so it cannot drift.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:30-30` · high · sha:1b678eca176d</sub>
- Header logging must gate which header names are logged by an allow-list; a non-allow-listed header must not have its value logged (emitted with a fixed REDACTED marker or omitted, per a boolean policy), and the default allow-list contains only diagnostic, non-credential headers.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:31-31` · high · sha:1b678eca176d</sub>
- A credential must not be stamped over a non-secure (non-HTTPS) transport; the auth layer must fail loudly before any token fetch or header write when about to attach a credential over a non-https scheme, except that a deliberately credential-free re-issue may proceed over any scheme.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:44` · high · sha:d6123be82c9e</sub>
- Redirect handling must strip Authorization before every redirect re-issue, additionally strip origin-scoped credentials (Cookie, Proxy-Authorization) on a cross-origin redirect judged against the original seed origin, drop any userinfo in the Location before re-issue, and reject an HTTPS-to-HTTP scheme downgrade by default unless explicitly opted in.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:45` · high · sha:d6123be82c9e</sub>
- Header names and outbound header values must be validated at the transport-agnostic model layer before reaching any transport, rejecting C0 control bytes and DEL in names, rejecting the same set except horizontal tab in outbound values, and rejecting non-ASCII bytes in both, while inbound response values may be validated leniently but must still reject control bytes except HTAB.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:46` · high · sha:d6123be82c9e</sub>
- Logging/telemetry must redact secrets by default, always redacting URL userinfo, redacting query-parameter values and key=value fragment tokens unless the parameter name is allow-listed, defaulting header logging to deny with an explicit allow-list, never revealing a credential object's secret in string/serialized form, and keeping full request/response body logging off by default.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:47` · high · sha:d6123be82c9e</sub>
- Observability code paths (redaction, event emission, span/metric recording) must never throw into the caller's request path, instead degrading gracefully with a safe placeholder or self-describing instrumentation-error event and letting the request proceed.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:48` · high · sha:d6123be82c9e</sub>
- Any security-relevant random value (auth client nonces/cnonce and similar unpredictability-dependent tokens) must be drawn from a cryptographically-strong PRNG with sufficient entropy, never a non-cryptographic RNG.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:49` · high · sha:d6123be82c9e</sub>

## Constraints

## Conclusions

## Reference
- A cross-origin redirect marker is an internal, transport-invisible sentinel the redirect step sets on a cross-origin re-issue so the auth step suppresses credential stamping onto a server-chosen foreign host, and it is stripped before the wire and unforgeable.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:19` · high · sha:f0b3d2058626</sub>
- An origin tuple (RFC 6454) is the (scheme, host, effective-port) triple; two URLs share an origin iff all three match, with case-insensitive host and scheme-default port, and cross-origin is judged against the original seed request rather than the previous hop.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:35` · high · sha:f0b3d2058626</sub>
- The redaction policy centrally scrubs secrets from anything logged, always removing URL userinfo, removing query/fragment values unless allow-listed, gating header values by an allow-list, and never letting credential objects reveal their secret.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:53` · high · sha:f0b3d2058626</sub>

## Conflicts

## Superseded
