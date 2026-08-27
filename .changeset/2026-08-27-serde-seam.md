---
'@dexpace/core': minor
---

Add the serde seam. `Serde`/`Serializer`/`Deserializer` are reshaped around an explicit schema
witness supplied at each decode call, closing `SEAM-21` — `Serde` is no longer generic in a payload
type, because a bundle is per wire format, not per DTO. Ships alongside it: `Tristate<T>` and its
helpers for PATCH three-state fields, the `SerializationError`/`DeserializationError` leaves with an
`isSerdeError` guard, `serdeBody()` (the serde's own media type becomes the default `Content-Type`),
and the `decodeResponse()`/`decodeSuccessResponse()` response handlers.

`decodeResponse()` passes through every error already in the SDK's typed tree rather than re-typing
it, so a stream failure raised by this SDK's I/O layer reaches the caller unwrapped (`SERDE-12`). A
foreign transport's stream error is indistinguishable from a non-conforming codec leaking one and is
still surfaced as `DeserializationError`; both handlers' `@throws` state that limit and name the
affected transports. A body already locked by another consumer raises a plain `TypeError`, matching
`Response.bytes()`, instead of being reported as a malformed payload.

