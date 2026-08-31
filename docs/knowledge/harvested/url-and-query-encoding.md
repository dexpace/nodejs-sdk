# url-and-query-encoding

## Rules
- The operation-input projection MUST let generated code declare, per operation, an HTTP method, a path template with named placeholders, and typed projections of inputs onto path, query, header, and body, so operation arguments flow through typed projections rather than URL string surgery (SEAM-26).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:29-29` · high · sha:0adae2d6a47f</sub>
- When assembled against a base URL, path-parameter values MUST be percent-encoded as single path segments so a value cannot inject an extra "/" (SEAM-27).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:30-30` · high · sha:0adae2d6a47f</sub>
- Every path-template placeholder MUST have a supplied value at assembly time (SEAM-27).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:30-30` · high · sha:0adae2d6a47f</sub>
- The query portion of an assembled request MUST be RFC-3986 rendered (SEAM-27).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:30-30` · high · sha:0adae2d6a47f</sub>
- Base-URL composition follows fixed rules: a trailing slash normalizes to one separator, an empty operation path leaves the base untouched, an existing base query is preserved with the operation query appended after it, and a base carrying a fragment or resolving to a malformed URL is rejected with a context-bearing error (SEAM-27).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:30-30` · high · sha:0adae2d6a47f</sub>
- Query-parameter names MUST be case-sensitive with no folding, preserve insertion order, support multiple values, and model a value-less parameter ("?flag") as a single empty-string value distinct from an absent name (HTTP-28).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:40-40` · high · sha:22d100d5bc94</sub>
- Query encoding MUST render each name/value with RFC 3986 percent-encoding — space becomes %20, literal "+" becomes %2B, "/" becomes %2F, "*" becomes %2A — encoding everything except the unreserved set A–Z a–z 0–9 - . _ ~, preserving insertion order, emitting a repeated name once per value, omitting the leading "?", and returning empty when empty; this is not application/x-www-form-urlencoded (HTTP-29).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:41-41` · high · sha:22d100d5bc94</sub>
- A single query component's encoding SHOULD follow RFC 3986 independent of stdlib quirks — space is %20 never "+", a literal "+" is %2B, decoding leaves "+" as "+", "~" stays unencoded, and "*" is encoded (HTTP-32).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:41-41` · high · sha:22d100d5bc94</sub>
- Query equality MUST be order-sensitive — two instances are equal if and only if they encode identically — and a name whose value list is empty MUST be dropped at build time so it cannot leave a phantom contains-true entry invisible to encode (HTTP-30).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:42-42` · high · sha:22d100d5bc94</sub>
- Query parsing MUST invert encoding and be lenient — a null/blank query becomes empty, a leading "?" is tolerated, a segment with no "=" or a trailing "=" becomes an empty-string value, stray "&" is skipped, and malformed percent-encoding falls back to raw text rather than throwing (HTTP-31).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:42-42` · high · sha:22d100d5bc94</sub>
- @dexpace/core wraps encodeURIComponent with a small additional replace pass for the four sub-delim characters (! ' ( ) *) wherever the spec demands strict RFC 3986 component encoding, specifically path-segment percent-encoding per SEAM-27 and query rendering per HTTP-29.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:122-125` · high · sha:b691aee1e452</sub>

## Constraints

## Conclusions
- The buildRequest() helper implies no codegen dependency, matching the parent project's decision to defer a codegen layer and to specify only the runtime primitive a generator would target.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:113-115` · high · sha:b691aee1e452</sub>

## Reference
- In the operation-input projection seam, only the HTTP method and path template are required; the four projections (path, query, header, body) default to empty (SEAM-26).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:29-29` · high · sha:0adae2d6a47f</sub>
- The body is carried, not encoded, by the operation-input projection seam (SEAM-26).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:29-29` · high · sha:0adae2d6a47f</sub>
- An ETag helper SHOULD model strong ("opaque"), weak (W/"opaque"), and the any singleton (*), validate permitted etagc characters (rejecting a literal quote, control chars, DEL, permitting obs-text), reject an empty strong opaque, permit an empty weak opaque, round-trip its raw form, reject unterminated forms, and return absent for blank input (HTTP-48).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:52-52` · high · sha:22d100d5bc94</sub>
- An HTTP-range helper SHOULD provide validated factories for a bounded range (rejecting negative offset or non-positive length, detecting overflow), a suffix range, and an open-ended range, supporting only the "bytes" unit and a single range (rejecting multi-range commas), and storing a parsed value verbatim (HTTP-49).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:53-53` · high · sha:22d100d5bc94</sub>
- A conditional-requests aggregator SHOULD emit If-Match/If-None-Match as one comma-separated header, emit If-Modified-Since/If-Unmodified-Since as RFC 1123 dates, be idempotent when applied by using set rather than add, and enforce that the any-tag (*) is mutually exclusive with concrete entity-tags, collapsing repeated "*" to one (HTTP-50).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:54-54` · high · sha:22d100d5bc94</sub>
- SEAM-26/SEAM-27's per-operation method + path-template + typed path/query/header/body projection is implemented in the port as a plain descriptor object (method, template string with {name} placeholders, typed projection functions/maps) assembled by a buildRequest() helper in @dexpace/core.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:110-115` · high · sha:b691aee1e452</sub>
- JavaScript's built-in encodeURIComponent has an unescaped character set of A-Za-z0-9-_.!~*'(), whereas RFC 3986's unreserved set (required by HTTP-29/HTTP-32 and SEAM-27) is only A-Za-z0-9-._~, meaning the four characters ! ' ( ) * are sub-delims that a strictly conformant encoder must additionally percent-encode.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:117-122` · high · sha:b691aee1e452</sub>
- encodeURIComponent is reused unmodified, without the sub-delim fix, for application/x-www-form-urlencoded form-body encoding per HTTP-38/BODY-35, because form encoding uses + for space rather than %20 and never claimed RFC 3986 compliance.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:125-127` · high · sha:b691aee1e452</sub>

## Conflicts

## Superseded
