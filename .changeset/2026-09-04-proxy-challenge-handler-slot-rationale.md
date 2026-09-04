---
"@dexpace/core": patch
---

Document `ProxyOptions.challengeHandler`'s settled disposition on the field itself, in both
`ProxyOptions` and `ProxyOptionsInit` (CFG-22, TRANSPORT-30, SEAM-1). Documentation only: no
behavior, no types, and no exported symbol changed, so `packages/core/etc/core.api.md` is
byte-identical — both entries are still `readonly challengeHandler?: unknown;`.

The slot was previously described as having "no protocol behind it yet", which read as pending
work. It is not pending. The field is required by `CFG-22`'s field list (a MUST) and gives
`TRANSPORT-30`'s SHOULD-warn clause a subject, but **nothing dispatches through it and nothing is
going to**: undici's `ProxyAgent` takes its credential solely from its own constructor and rejects
a per-request `Proxy-Authorization` with `InvalidArgumentError`, and that constructor runs before
any challenge exists, so a handler-minted credential can never reach the exchange that provoked it.
`@dexpace/transport-undici` answers the requirement by discoverability instead — a WARN at
construction, a second WARN on the first real `407`, Basic proxy auth through
`ProxyOptions.credentials`, and the `407` returned untouched.

The TSDoc also records why the type stays `unknown` rather than becoming a declared signature: the
only concrete argument a handler could take is the native client's own response type, which
`SEAM-1`'s zero-runtime-dependency rule forbids core from naming, and a transport-neutral challenge
shape invented here would be a contract with no implementation behind it.

The reasoning now lives in the code a consumer reads in the published `.d.ts` rather than in a
register, so the row for it has been removed from the deferral register; the full platform audit
remains at `docs/deviations.md` item 13.
