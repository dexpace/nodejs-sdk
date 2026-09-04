---
"@dexpace/core": patch
---

`MediaType.charset` now returns `undefined` for an encoding label the runtime does not recognize,
closing the "or unknown" half of `HTTP-24` — whose own conformance text reads
`charset=bogus` → null. It previously returned the label verbatim, so `text/plain;charset=bogus`
answered `'bogus'` and a caller had no way to reach the requirement's fallback without exception
handling of its own.

"Unknown" is resolved against the runtime's WHATWG Encoding registry: a label
`new TextDecoder(label)` refuses is one nothing in this SDK could decode with, and it is the same
resolution `decodeBodyText` already performs a layer down, so the two cannot disagree about what is
decodable. Recognized labels keep their original case (`HTTP-23`).

The raw parameter is unchanged and still reachable: `parameter('charset')` returns `'bogus'`, and
`render()` still round-trips it verbatim (`HTTP-25`). Behaviour downstream is unchanged too —
`resolveCharset` already fell back to UTF-8 for a label `TextDecoder` rejected.

Recorded at `docs/open-items.md` A1.
