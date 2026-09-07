# http-domain-model

## Rules
- Model construction MUST go through an immutable-value plus Builder (or dedicated factory) pattern, with no public field-wise constructor or unchecked copy that bypasses validation (SEAM-29 / HTTP-2).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:13-13` · high · sha:8014d2ec2c9d</sub>
- A shared generic Builder contract with a build() method producing the target type MUST exist so generic composition helpers can accept any builder (SEAM-29).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:49-49` · high · sha:0adae2d6a47f</sub>
- Required-field validation MUST be uniform: a missing required field fails at build() with a consistent message of the form "<name> is required" (SEAM-29).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:49-49` · high · sha:0adae2d6a47f</sub>
- Each builder-based model (request, response, headers, query params, request options, request conditions, multipart body) MUST expose a newBuilder()-style derivation returning a builder pre-populated from the instance, and that pre-filled builder MUST NOT alias the original's internal collections (HTTP-3).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:7-7` · high · sha:22d100d5bc94</sub>
- build() MUST validate required fields and fail with a field-named error when one is missing (a request requires its URL; a response requires request, protocol, status), never silently substituting defaults except where explicitly specified (HTTP-4).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:8-8` · high · sha:22d100d5bc94</sub>
- Accessors returning collections of header/query names, values, or entries MUST NOT let a caller mutate the model through the returned value and MUST NOT surface later mutations of a live builder (HTTP-5).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9-9` · high · sha:22d100d5bc94</sub>
- The request builder MUST reject a non-null body on any method whose classification forbids one (GET, HEAD, TRACE, CONNECT), failing at construction rather than deferring to the transport, because reference transports diverge on how they handle this (HTTP-7).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:14-14` · high · sha:22d100d5bc94</sub>
- With no method set, build() SHOULD default to GET only if no body is present; a body with no method SHOULD fail reporting a missing method rather than defaulting to GET and then tripping the no-body-on-GET rule (HTTP-8).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:15-15` · high · sha:22d100d5bc94</sub>
- Building a request from a malformed URL string or non-absolute URI SHOULD fail with an argument error carrying the offending input (HTTP-47).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:18-18` · high · sha:22d100d5bc94</sub>
- Status MUST be a total function of the integer code: mapping any code returns a Status and never throws, with a canonical named instance for recognized codes and a raw-code, null-named instance for unrecognized ones (HTTP-10).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:22-22` · high · sha:22d100d5bc94</sub>
- A separate lookup MUST let callers distinguish recognized status codes from unrecognized ones, returning absent for unknown codes (HTTP-10).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:22-22` · high · sha:22d100d5bc94</sub>
- Header names MUST be treated case-insensitively for storage, lookup, containment, mutation, removal, equality, and hashing, folding to lower case with an ASCII/invariant rule and never a locale-sensitive fold (HTTP-13).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:28-28` · high · sha:22d100d5bc94</sub>
- The header model MUST support multiple values per name — add appends, set replaces the whole list — preserving per-name insertion order (HTTP-14).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:29-29` · high · sha:22d100d5bc94</sub>
- Setting a header value to null MUST remove the header entirely (HTTP-15).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:30-30` · high · sha:22d100d5bc94</sub>
- The header model SHOULD preserve insertion order of distinct names for deterministic serialization, caching, signing, and test stability (HTTP-16).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:31-31` · high · sha:22d100d5bc94</sub>
- Outbound (caller-set) header names MUST be validated at construction to reject a blank name, any C0 control character (0x00–0x1F, including CR/LF/NUL) or DEL (0x7F), and any non-ASCII byte (>= 0x80), with surrounding whitespace trimmed before validation (HTTP-17).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:32-32` · high · sha:22d100d5bc94</sub>
- Outbound header values MUST reject any control character (C0 and DEL) except horizontal tab (0x09) and reject any non-ASCII byte; the accepted set is HTAB plus printable ASCII 0x20–0x7E (HTTP-18).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:33-33` · high · sha:22d100d5bc94</sub>
- The model MUST provide a distinct lenient path for inbound (response) header values that relaxes the non-ASCII rule, permitting obs-text bytes >= 0x80, while still rejecting control characters (C0 except HTAB, plus DEL); inbound header names remain strictly validated (HTTP-19).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:34-34` · high · sha:22d100d5bc94</sub>
- Validation error messages MUST NOT echo the offending header value verbatim and MUST escape any control characters in an echoed header name, to prevent log injection and secret leakage through error messages (HTTP-20).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:35-35` · high · sha:22d100d5bc94</sub>
- A typed header-name abstraction MUST compare and hash by its case-folded form while preserving original casing for wire emission, MUST interoperate with the string-keyed API, and MUST enforce the same name validation as outbound header names (HTTP-21).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:36-36` · high · sha:22d100d5bc94</sub>
- Media-type construction MUST lower-case the type, subtype, and every parameter key while preserving each parameter value's case; equality is case-insensitive on type/subtype/keys and case-sensitive on values (HTTP-23).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:37-37` · high · sha:22d100d5bc94</sub>
- Media type MUST resolve its charset parameter case-insensitively and return null, not throw, when the charset is absent or unknown, so callers fall back to a default (HTTP-24).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:38-38` · high · sha:22d100d5bc94</sub>
- Media-type parsing MUST split parameters respecting quoted-strings (a semicolon or equals sign inside quotes is not a separator), split each parameter on its first "=" only, strip quotes, and unescape quoted-pairs; rendering MUST emit a value bare when it is a valid token and quoted-and-escaped otherwise, so parse(render(x)) == x (HTTP-25).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:39-39` · high · sha:22d100d5bc94</sub>
- Media-type parsing MUST reject blank input and require a non-empty type before and non-empty subtype after a single "/", and each parameter must contain "=" with a non-empty key and value (HTTP-53).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:39-39` · high · sha:22d100d5bc94</sub>
- Media-type construction MUST reject a control character (C0 except HTAB, plus DEL) or non-ASCII byte anywhere, using the same predicate as outbound header-value validation, so a media type is always header-safe (HTTP-26).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:39-39` · high · sha:22d100d5bc94</sub>
- Wildcard media-type matching SHOULD permit a wildcard type only with a wildcard subtype (bare "*/*"), with a wildcard in either position matching any value and parameters ignored (HTTP-27).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:39-39` · high · sha:22d100d5bc94</sub>
- Tags on request options MUST be defensively copied at build so a built options instance is unaffected by later mutation of the source map (HTTP-34).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:47-47` · high · sha:22d100d5bc94</sub>
- The request options builder MUST reject a non-null timeout that is zero or negative and MUST reject a negative max-retries, while a max-retries of 0 MUST be accepted and means "disable retries for this call" (HTTP-35).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:48-48` · high · sha:22d100d5bc94</sub>
- Public wire models (request, response, headers, media type, status, etc.) must be immutable after construction, safe to share across threads, express mutation as producing a new instance, and never retain an alias to externally-mutable state.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:40` · high · sha:d6123be82c9e</sub>
- The port uses ECMAScript private class fields (#field) for every piece of state a model class holds, since the engine itself refuses to let external code read, write, or detect the field via reflection (Object.keys, JSON.stringify, Reflect.ownKeys all skip them).
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:8-12` · high · sha:9d2a8f2bcfc1</sub>
- Model classes expose only get accessors and the builder's build() method as the way to construct or read state; a private constructor alone is not load-bearing and serves only as a secondary, compile-time signal for callers inside the same package.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:12-14` · high · sha:9d2a8f2bcfc1</sub>
- The mitigation for TypeScript's structural-typing bypass is to keep the public surface a concrete class, not a bare structural interface, exported from each package's single entry point, so the class is the only spelled type consumers are meant to name.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:20-23` · high · sha:9d2a8f2bcfc1</sub>
- newBuilder() (HTTP-3) is a method on every model class returning a pre-filled builder that defensively copies every mutable collection — arrays via spread, header/query maps via new Map(...) — rather than aliasing the source's internals.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:25-27` · high · sha:9d2a8f2bcfc1</sub>
- Every nested collection, such as each header's value array, must be frozen independently at the same construction step rather than relying on transitive freezing.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:39-40` · high · sha:9d2a8f2bcfc1</sub>

## Constraints
- All core domain-model types MUST present an immutable value/metadata surface after construction, safe to share across threads without external synchronization, with any change producing a new instance; the single carve-out is a body that wraps live single-use stream state (HTTP-1).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:12-12` · high · sha:8014d2ec2c9d</sub>
- Request URL equality/hashing MUST NOT perform blocking work or DNS resolution; URLs MUST be compared by textual external form (HTTP-46).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:17-17` · high · sha:22d100d5bc94</sub>
- HTTP-1/SEAM-29/HTTP-2 require immutable value + Builder construction with no public field-wise constructor or unchecked-copy bypass.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:3-4` · high · sha:9d2a8f2bcfc1</sub>
- TypeScript's private/protected modifiers are erased at compile time, so a private field is only a type-checker fiction reachable at runtime via (instance as any).method.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:7-9` · high · sha:9d2a8f2bcfc1</sub>
- TypeScript's structural typing means a public interface type can be satisfied by any object literal shaped like it, entirely bypassing the builder and its validation (HTTP-4's required-field validation, HTTP-7's rejection of a body on GET/HEAD/TRACE/CONNECT); this hole cannot be fully closed in TypeScript and is an acknowledged structural language limitation.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:15-23` · high · sha:9d2a8f2bcfc1</sub>
- Object.freeze is shallow — it prevents adding/removing/reassigning a frozen collection's own entries but does not by itself protect a nested mutable value stored inside it.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:37-39` · high · sha:9d2a8f2bcfc1</sub>

## Conclusions
- Operational knobs such as timeout and retries live outside the wire model, in request options (HTTP-6).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:13-13` · high · sha:22d100d5bc94</sub>
- Because @dexpace/core's models are genuinely immutable once built, the defensive copy for read-only collection exposure (HTTP-5) only needs to happen once, at construction, via Object.freeze(new Map(headerEntries)) computed in the constructor and returned by reference from every subsequent getter call, unlike the JVM reference's need to re-copy per access under an unmodifiable-wrapper pattern.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:31-37` · high · sha:9d2a8f2bcfc1</sub>

## Reference
- Value-based types with no builder (media type, status, the typed header name, ETag, HTTP range, method, protocol) are derived by re-constructing through their factories (HTTP-3).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:7-7` · high · sha:22d100d5bc94</sub>
- Isolation from a builder is guaranteed by a build-time deep copy of every value list, and isolation from mutation-through-the-collection is guaranteed by returning read-only-typed collections; a port in a language without read-only views must reproduce this with unmodifiable wrappers or per-call defensive copies (HTTP-5).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:9-9` · high · sha:22d100d5bc94</sub>
- A request MUST carry exactly method, target URL, headers (non-null, possibly empty), and an optional body (HTTP-6).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:13-13` · high · sha:22d100d5bc94</sub>
- A response MUST carry the originating request, negotiated protocol, status, an optional reason phrase, headers (non-null, possibly empty), and an optional body (HTTP-6).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:13-13` · high · sha:22d100d5bc94</sub>
- The model defines an idempotency classification of the set {GET, HEAD, OPTIONS, PUT, DELETE} as the single source both the configurable retry allow-list and the inherent replay-safety gate derive from, and each method's canonical wire token equals its uppercase name (HTTP-9).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:16-16` · high · sha:22d100d5bc94</sub>
- Request equality otherwise compares method, headers, and body by value (HTTP-46).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:17-17` · high · sha:22d100d5bc94</sub>
- Status MUST classify by range — informational 100–199, success 200–299, redirect 300–399, client-error 400–499, server-error 500–599, and error 400–599 — and a response exposes these derived from its status (HTTP-11).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:23-23` · high · sha:22d100d5bc94</sub>
- Two Status values MUST be equal if and only if their numeric codes are equal; the name does not participate in equality or hashing (HTTP-12).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:24-24` · high · sha:22d100d5bc94</sub>
- A typed header-name abstraction MAY intern instances process-wide, with the first casing winning; interning is an optimization and the observable contract is value equality by case-folded name (HTTP-22).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:36-36` · high · sha:22d100d5bc94</sub>
- Protocol MUST expose a canonical lower-case wire form (http/1.1, http/2) and a locale-invariant, case-insensitive parse accepting the canonical forms plus the aliases "HTTP/2" and "HTTP/2.0", throwing on an unrecognized identifier (HTTP-33).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:43-43` · high · sha:22d100d5bc94</sub>
- Request options model per-call operational overrides not part of the wire form: at minimum a per-call timeout, a per-call max-retries, and opaque string-keyed tags, with every field defaulting to a null/empty "use the default" sentinel, and a canonical EMPTY "override nothing" instance (HTTP-34).
  <sub>spec · `docs/product-spec/04-core-http-domain-model.md:47-47` · high · sha:22d100d5bc94</sub>
- A static build/runtime descriptor should expose the SDK version and host runtime identity resolved once at load time, each falling back to a non-blank "unknown" when unavailable, and should provide a default ordered identity-token list (SDK token then runtime token), with every token required to be non-blank.
  <sub>spec · `docs/product-spec/16-configuration.md:59-59` · high · sha:367e27ec6481</sub>
- Deep value equality is content-based equals/hashCode comparison that recurses into arrays element-by-element while falling back to ordinary equality for non-arrays, keeping equals and hashCode mutually consistent, including NaN-equals-NaN and +0.0-unequal-to-(-0.0) array semantics.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:23` · high · sha:f0b3d2058626</sub>
- Required-field validation is single-sourced through one shared helper, requireField(value, name), thrown as a common RequiredFieldError with the exact message form `${name} is required`, used by every builder's build().
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:27-29` · high · sha:9d2a8f2bcfc1</sub>
- The Headers model (HTTP-13 through HTTP-22) is a class wrapping two parallel maps: a lower-cased key to value-array map for case-insensitive lookup/mutation/equality, and a lower-cased key to original-casing map for wire emission.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:42-44` · high · sha:9d2a8f2bcfc1</sub>
- MediaType, Status, Protocol, and the typed header-name type are plain frozen classes reconstructed through a parse/of static factory rather than a builder, matching the reference's value-based-types-with-no-builder pattern (HTTP-23, HTTP-33, HTTP-3).
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:44-47` · high · sha:9d2a8f2bcfc1</sub>
- The shared Builder<T> generic contract (SEAM-29 restated) is a one-line structural interface, `interface Builder<T> { build(): T }`, which any class exposing a build(): T method satisfies with no explicit implements clause required, being structural.
  <sub>design · `docs/sdk-design-nodejs/04-domain-model-construction.md:49-53` · high · sha:9d2a8f2bcfc1</sub>

## Conflicts
- **design vs styleguide: `#private` fields as the default for model state** — the design uses ECMAScript `#field` for every piece of state a model class holds, because runtime encapsulation is what the immutable-value requirement needs; the styleguide makes the `private` modifier the default precisely because it is erasable and emits no runtime code, and requires a comment justifying each `#private` use as a genuine runtime-privacy requirement. The design's rationale is the justification the styleguide asks for, so this may be a sanctioned carve-out rather than a true conflict — but it is blanket across every model class, not per-use.
  <sub>design `docs/sdk-design-nodejs/04-domain-model-construction.md:7-14` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/06-classes-and-data-modeling.md:168-183` · unresolved 2026-07-25</sub>

## Superseded
