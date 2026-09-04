---
"@dexpace/core": patch
---

Default-constructed execution-context keys now carry a serial number in their description —
`Symbol('dispatch-context#7')` rather than `Symbol('dispatch-context')`.

`CTX-8` is stated in appendix C as an error "whose **message** identifies the key", and
`DuplicateContextKeyError`'s message renders `String(key)`. Every default key of a flavor rendered
identically, so the message named the *kind* of key and never *which* key — the error's typed
`.key` field carried the identity, but the message did not. The identity is still the `Symbol()`
itself; only the label changed, so `CTX-4`/`CTX-5`/`CTX-6`'s uniqueness is untouched.

Recorded at `docs/open-items.md` A5.
