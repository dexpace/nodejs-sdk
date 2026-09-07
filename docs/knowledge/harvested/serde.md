# serde

## Rules
- A Serde MUST be a single bundle exposing exactly one encoder and one decoder for one wire format, so consumers acquire both through one reference.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:7-7` · high · sha:c6bc7789c3a9</sub>
- A Serde MUST declare the wire media type it produces, that media type MUST be used as the default Content-Type when a request body is created from a value plus a Serde, and the media type MUST NOT be defaulted to a format-agnostic constant at the SPI level.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:8-8` · high · sha:c6bc7789c3a9</sub>
- When encoding into or decoding from a caller-supplied stream, the serializer/deserializer MUST read/write the payload fully to EOF on the read side but MUST NOT close or take ownership of the caller's stream, and the encode-into-buffer profile likewise touches only the target region without assuming ownership (SEAM-20).
  <sub>spec · `docs/product-spec/14-serialization-serde.md:12-12` · high · sha:c6bc7789c3a9</sub>
- The encode-into-buffer serialization profile MUST return the number of bytes written, MUST honor a start offset, MUST throw a range/overflow error distinct from the serde exception type when the offset is out of range or the payload does not fit, and MUST leave bytes before the offset untouched (SEAM-20).
  <sub>spec · `docs/product-spec/14-serialization-serde.md:13-13` · high · sha:c6bc7789c3a9</sub>
- Every decode operation MUST take an explicit runtime type witness for the target type, and a decoder MUST NOT rely on erased compile-time generics because on an erasure-based runtime that silently yields an untyped map/list which detonates as a cast error on first field access.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:17-17` · high · sha:c6bc7789c3a9</sub>
- Parametric decode targets such as List<Dto> MUST be expressible through a full-generic type carrier that preserves element types across erasure; a format-agnostic decoder that cannot resolve type arguments MUST fail loudly with a serde exception for a genuinely parametric carrier, while a carrier wrapping a plain class MUST still decode via the raw path.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:18-18` · high · sha:c6bc7789c3a9</sub>
- An ergonomic reified/inline decode helper, where the host language offers one, MUST capture the full generic type and route through the generic carrier rather than forwarding only the raw class.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:19-19` · high · sha:c6bc7789c3a9</sub>
- The generic type carrier MUST capture a concrete, fully-resolved type at construction and MUST reject construction with no type argument or an unresolved type variable, failing fast with an actionable message (SEAM-22).
  <sub>spec · `docs/product-spec/14-serialization-serde.md:20-20` · high · sha:c6bc7789c3a9</sub>
- Encode/decode failures MUST surface as the SDK's stable serde exception type or a subtype; adapters MUST catch the backing codec's processing failures and rethrow as the serde type, MUST chain the original as the cause, and MUST NOT allow a backing-library exception type to escape the SPI (SEAM-23).
  <sub>spec · `docs/product-spec/14-serialization-serde.md:24-24` · high · sha:c6bc7789c3a9</sub>
- Write-path serde failures MUST be a serialization-specific subtype and read-path failures a deserialization-specific subtype, both of a common root exception type, so callers can distinguish direction while catching one base type (SEAM-23).
  <sub>spec · `docs/product-spec/14-serialization-serde.md:25-25` · high · sha:c6bc7789c3a9</sub>
- A genuine stream I/O error raised while reading/writing a caller-owned stream MUST propagate unwrapped as an I/O error and MUST NOT be re-wrapped as a serde exception; only malformed-input, shape-mismatch, or unencodable-value failures are wrapped.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:27-27` · high · sha:c6bc7789c3a9</sub>
- Decoding a wire null literal into a non-null target type MUST fail with a deserialization exception naming the target type, across every decode overload, and MUST NOT return a null that flows through the non-null result and detonates later.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:28-28` · high · sha:c6bc7789c3a9</sub>
- The PATCH tri-state type MUST model exactly three states (Absent for a missing key, Null for an explicit null, Present carrying a value), MUST make the illegal fourth state of Present-of-null unrepresentable by bounding Present to non-null values, and SHOULD be covariant in its value type.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:32-32` · high · sha:c6bc7789c3a9</sub>
- When serializing a tri-state field within an object, Absent MUST omit the key entirely, Null MUST emit the key with a wire null, and Present MUST emit the key with the encoded inner value, so a PATCH server treats an omitted key as "leave unchanged" and an explicit null as "clear".
  <sub>spec · `docs/product-spec/14-serialization-serde.md:33-33` · high · sha:c6bc7789c3a9</sub>
- When deserializing a tri-state field, a missing key MUST map to Absent, a present explicit-null MUST map to Null, and a present value MUST map to Present(value) with the inner value's declared element type preserved.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:34-34` · high · sha:c6bc7789c3a9</sub>
- A tri-state field with no key on the wire MUST resolve to Absent, which in practice requires the field's declared default to be Absent and the decoder's empty-value fallback to yield Absent because a missing key is short-circuited by the codec before the decoder's null hook runs.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:35-35` · high · sha:c6bc7789c3a9</sub>
- The default codec configuration MUST wire the tri-state PATCH semantics, an adapter building a serde around a caller-supplied codec MUST register that wiring by default and MAY allow opting out only when a caller already installed equivalent wiring, and absent this wiring, Absent and Null become indistinguishable on the wire.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:37-37` · high · sha:c6bc7789c3a9</sub>
- The default decoder configuration MUST reject cross-shape scalar coercions instead of silently reshaping them, including string-to-integer, string-to-float, string-to-boolean, empty-string-to-integer/float/boolean, float-to-integer, boolean-to-integer, integer-to-boolean, boolean-to-float, and any non-string scalar-to-string, and a rejected coercion MUST surface as a deserialization failure.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:43-43` · high · sha:c6bc7789c3a9</sub>
- The strict-coercion decoder policy MUST still permit representation-preserving conversions: numeric widening of an integer into a floating-point target, an empty string into a textual target, and any well-typed value binding to its matching target.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:44-44` · high · sha:c6bc7789c3a9</sub>
- When a serde is built around a caller-supplied codec instance, the SDK MUST NOT mutate the caller's instance during normal construction and MUST operate on a private copy of the codec engine, though if the codec cannot be copied, the implementation MAY fall back to using the supplied instance directly as documented mutating fallback behavior.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:48-48` · high · sha:c6bc7789c3a9</sub>
- A response-decoding handler MUST stream the response body directly through the deserializer into the target value without first materializing the whole body, MUST consume and close the response on every path, MUST surface a missing body such as 204 as a serde exception naming the target type, and MUST surface a codec/parse failure as a serde exception chaining the original while letting a genuine mid-stream I/O error propagate unwrapped.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:53-53` · high · sha:c6bc7789c3a9</sub>
- A status-aware response handler MUST decode the body only on a 2xx status, on 4xx/5xx it MUST throw the mapped HTTP-error exception carrying a bounded, buffered in-memory copy of the error body so it is readable after the live response closes, and on any other non-2xx status such as 1xx or an unfollowed 3xx like 304 it MUST close the response and raise a serde exception whose message leads with the status code and preserves conditional/redirect context such as ETag or Location.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:54-54` · high · sha:c6bc7789c3a9</sub>

## Constraints

## Conclusions
- Serde failures SHOULD be unchecked/runtime exceptions rather than checked/declared, so callers are not forced to wrap every round-trip; on languages without checked exceptions the portable intent is that it is a normal error not part of the declared signature.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:26-26` · high · sha:c6bc7789c3a9</sub>
- The tri-state type SHOULD provide construction/consumption helpers including factories for absent, explicit-null, and present(non-null), a nullable-to-(present|null) mapper that can never yield Absent, a three-way fold, a value-or-null accessor, and is-absent/is-null/is-present predicates.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:36-36` · high · sha:c6bc7789c3a9</sub>
- When a tri-state value is serialized with no enclosing object able to omit a key, such as a top-level value or an array element, the implementation SHOULD degrade gracefully by emitting a wire null for both Absent and Null rather than throwing.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:38-38` · high · sha:c6bc7789c3a9</sub>
- The default decoder configuration SHOULD ignore unknown/unexpected fields rather than failing, so a server can add backward-compatible fields ahead of a client model update.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:45-45` · high · sha:c6bc7789c3a9</sub>
- The default encoder configuration SHOULD emit date/time values as ISO-8601 strings rather than numeric epoch timestamps, and whichever form is chosen, the encoding MUST round-trip to the same instant.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:46-46` · high · sha:c6bc7789c3a9</sub>
- A factory building the default codec configuration SHOULD return a fresh, independent instance on each call rather than a shared mutable singleton, because codec instances carry mutable caches that interact poorly with post-construction reconfiguration.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:47-47` · high · sha:c6bc7789c3a9</sub>
- A configured serde SHOULD be safe to share across concurrent threads/tasks once configuration is complete and no longer mutated, and any per-type sub-serializer caches SHOULD use non-blocking, publication-safe updates rather than coarse locks.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:49-49` · high · sha:c6bc7789c3a9</sub>
- Instead of trying to recover an erased type at runtime, the port's `Deserializer<T>` seam requires the caller to supply a runtime schema value conforming to a minimal structural interface, `{ parse(input: unknown): T }`.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:76-80` · high · sha:d546f9973c4e</sub>
- `@dexpace/core` defines only the minimal deserializer structural interface and does not implement, bundle, or depend on any concrete schema library.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:81-82` · high · sha:d546f9973c4e</sub>
- Because TypeScript infers the decode function's static return type from the schema's own generic parameter, the compile-time type and the runtime schema witness are the same artifact rather than two things kept in sync by convention.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:86-89` · high · sha:d546f9973c4e</sub>
- The reference's runtime-thrown guard against construction with no type argument or an unresolved type variable has no equivalent needed in the port, because the TypeScript compiler already refuses to accept a call site missing a concrete schema value, a compile-time rejection stronger than the reference's runtime check.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:96-101` · high · sha:d546f9973c4e</sub>
- On the encode side, the requirement that Absent must omit the key while Null must emit a wire null is satisfied using `JSON.stringify`'s replacer function, which can return `undefined` to omit a key entirely, a mechanism built into the language rather than requiring custom object-shape massaging.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:107-110` · high · sha:d546f9973c4e</sub>
- Because a `JSON.parse` reviver runs bottom-up per key with no visibility into the enclosing DTO's declared shape, Tristate decoding has no built-in JSON-layer hook and is instead resolved one layer up, via a schema-based `tristate(innerSchema)` combinator provided by `@dexpace/codec-json`.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:112-118` · high · sha:d546f9973c4e</sub>

## Reference
- Serde is the SDK's format-agnostic serialization seam, defining a small SPI consisting of a Serde bundling an encoder, decoder, and declared wire media type so subsystems round-trip typed values through a single injection point without naming a concrete codec.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:3-3` · high · sha:c6bc7789c3a9</sub>
- The serde core ships only abstractions (Serde/Serializer/Deserializer, the generic type carrier, the three-state Tristate sum type for PATCH, and a stable exception hierarchy), while a concrete codec such as Jackson plugs in at the edge.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:3-3` · high · sha:c6bc7789c3a9</sub>
- The absent and explicit-null tri-state sentinels MAY provide a stable, identity-free textual representation such as "Absent" and "Null" so logs and assertions do not leak an identity hash.
  <sub>spec · `docs/product-spec/14-serialization-serde.md:39-39` · high · sha:c6bc7789c3a9</sub>
- Serde is a bundle exposing one serializer, one deserializer, and the declared wire media type for one format, serving as the SDK's format-agnostic serialization seam.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:61` · high · sha:f0b3d2058626</sub>
- Tristate is a three-valued sum type — Absent / Null / Present(value) — distinguishing a missing key from an explicit null from a present value at the serialization boundary, primarily for HTTP PATCH.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:67` · high · sha:f0b3d2058626</sub>
- A TypeRef / type witness is an explicit runtime carrier of a target type, either a raw class token or a full generic capture, passed into deserialization so a language with type erasure recovers the intended type.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:69` · high · sha:f0b3d2058626</sub>
- The serialization conformance suite verifies a serde bundle round-trips through its own serializer/deserializer (SERDE-1) and that the declared media type is the default Content-Type rather than being defaulted at the SPI (SERDE-2).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:29` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies streaming/buffer targets are not closed (SERDE-3) and encode-into-buffer returns length, honors offset, and throws a non-serde range error on overflow (SERDE-4).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:30` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies decode requires an explicit type witness (SERDE-5), parametric carriers preserve element types with a no-codec decoder failing loudly on a parametric ref but decoding a plain-class carrier (SERDE-6), a reified helper routes through the carrier (SERDE-7), and a carrier rejects an unresolved type variable at construction (SERDE-8).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:31` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies failures surface the stable serde type chaining the original cause with no library type escaping (SERDE-9), write/read directional subtypes (SERDE-10), unchecked failures (SERDE-11), a genuine stream I/O error propagating unwrapped (SERDE-12), and a wire null into a non-null target failing while naming the type across overloads (SERDE-13).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:32` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies Tristate has three states with Present(null) unrepresentable (SERDE-14), Absent omits key / Null emits null / Present emits value (SERDE-15), round-trip decode of `{}`, `{"x":null}`, and `{"x":v}` (SERDE-16), missing key maps to Absent via field default (SERDE-17), construction/consumption helpers where ofNullable never yields Absent (SERDE-18), a default codec auto-registers the wiring (SERDE-19), top-level/array-element degradation (SERDE-20), and stable sentinel strings (SERDE-30).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:33` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies strict cross-shape coercion is rejected (SERDE-21), widening and empty-string-to-string conversion are permitted (SERDE-22), unknown fields are ignored (SERDE-23), ISO-8601 dates round-trip (SERDE-24), a fresh codec is produced per factory call (SERDE-25), a caller-supplied codec is not mutated (SERDE-26), and shared-after-config thread safety holds (SERDE-29).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:34` · high · sha:0451cc7f3bb4</sub>
- The serialization conformance suite verifies a streaming response handler closes on all paths including missing body, missing codec, and I/O handling (SERDE-27), and a status-aware handler decodes only 2xx, buffers a bounded 4xx/5xx error body, and raises a status-naming serde exception for other non-2xx statuses (SERDE-28).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:35` · high · sha:0451cc7f3bb4</sub>
- TypeScript erases types more completely than JVM generic erasure, because JVM erasure loses only the generic parameter while the raw class token remains reflectively inspectable, whereas TypeScript leaves no runtime representation of a type at all.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:65-74` · high · sha:d546f9973c4e</sub>
- The `Deserializer<T>` structural interface matches the shape shared today by Zod, Valibot, ArkType, and effect/schema, and is increasingly formalized by the community's emerging "Standard Schema" convention.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:79-81` · high · sha:d546f9973c4e</sub>
- `@dexpace/codec-json` decodes raw text via `JSON.parse` and then runs the caller-supplied schema's `parse()` method over the resulting value.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:83-84` · high · sha:d546f9973c4e</sub>
- A parametric target type such as `List<Dto>` is expressed in the port as a schema combinator, e.g. `z.array(DtoSchema)`, supplied directly by the caller as data, with no reflective reconstruction step.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:90-96` · high · sha:d546f9973c4e</sub>
- `Tristate<T>` is a three-branch discriminated union — `{ kind: 'absent' } | { kind: 'null' } | { kind: 'present', value: T }` — with `Tristate.present()` constrained so a `null` value cannot type-check as its argument.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:103-106` · high · sha:d546f9973c4e</sub>
- `@dexpace/codec-json` installs a shared `JSON.stringify` replacer that recognizes `Tristate` values by a branded tag, returning `undefined` for Absent, `null` for Null, and `.value` for Present.
  <sub>design · `docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md:111-112` · high · sha:d546f9973c4e</sub>

## Conflicts

## Superseded
