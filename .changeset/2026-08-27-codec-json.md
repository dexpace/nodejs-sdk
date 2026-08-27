---
'@dexpace/codec-json': minor
---

Initial release of the reference JSON wire codec: `jsonSerde()`, the `Tristate` PATCH replacer (on by
default, opt-out is an explicit `{tristate: false}`), and the `tristate()` / `tristateObject()` decode
combinators. Depends on nothing beyond a `@dexpace/core` peer — the schema that witnesses each decode
is the caller's, so no schema library is a dependency of either package.

Encoding details worth knowing at the call site: a top-level `undefined`, function, or symbol raises
`SerializationError` rather than encoding as the `null` literal — all three are unencodable values,
and substituting `null` would send a PATCH server a meaningful "clear this field" the caller never
wrote. Nested occurrences keep ordinary `JSON.stringify` behaviour. The `SERDE-20` top-level Tristate
degradation (a top-level Absent or Null still encodes as `null`) is resolved by the serializer before
`JSON.stringify` runs, because a replacer cannot tell the top-level value from a key literally named
`""`; a caller composing their own `JSON.stringify(v, tristateReplacer)` therefore gets the nested and
array-element behaviour but must route through `jsonSerde()` for the top level.

