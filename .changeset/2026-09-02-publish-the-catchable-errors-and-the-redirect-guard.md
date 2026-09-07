---
"@dexpace/core": minor
---

Publish ten symbols that the emitted `.d.ts` already told consumers about but no package exported.

**The redirect guard** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` U7). `withRedirect(builder, overrides?)` and
`stripCrossOriginMarkerStep()` are now public. `redirectStep()` marks a cross-origin hop with an
internal header and relies on a second `POST_AUTH` step to strip it before dispatch (`REDIR-11(c)`);
that step was `@internal`, so `withRedirect`'s own instruction — "a caller who installs
`redirectStep()` directly is responsible for installing the guard too" — named an obligation no
consumer could discharge. `standardResilience()` and `PipelineBuilder.seedFrom()` were the only safe
routes to a redirect pipeline; `withRedirect(builder)` is now the direct one.

**Eight catchable error classes** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` U9): `PillarCollisionError`,
`ReservedStageError`, `AnchorNotFoundError`, `CrossStageEditError`, `CursorAlreadyAdvancedError`,
`EndOfStreamError`, `SchemeDowngradeError` and `NonReplayableBodyError`. Each is the subject of a
`@throws` tag on a public symbol, and each shipped into the `.d.ts` — so a consumer read the tag,
reached for `instanceof`, and had nothing to reach for. `error.name` was the only handle.

`InvariantViolation` stays unexported and `@internal`: it signals a bug rather than a condition, and
extends `Error` rather than `DexpaceError`. Its `@throws` tags on public symbols now read as prose —
"an assertion failure (a caller bug, not a catchable condition)" — instead of naming a class nobody
can catch. `DuplicateContextKeyError` likewise stays behind the `@internal` `ContextStore`.

**Two new error classes, both from `XCUT-8`** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` N2/V14):

- `HttpStatusValidationError` — `HttpStatusError`'s constructor now validates that `status` is an
  integer in HTTP-11's 400–599 band and throws this otherwise. The class documented that invariant
  and never enforced it, so `new HttpStatusError(200, …)` built the "successful exception" `XCUT-8`
  forbids. **This is the one behavioural break in this changeset**: a caller constructing an
  `HttpStatusError` out of band now gets a throw. `toHttpError` is unaffected — it is the total form
  and still returns `null` for any status outside the band.
- `RetryDiscardedResponseError` — the retry engine's trail entry for a response it discarded whose
  status is outside 400–599, reachable only by widening `RetrySettings.retryableStatuses` to include
  a non-error code. The engine used to fabricate `new HttpStatusError(<that status>, …)` there, so
  core itself built the object the requirement forbids and the trail claimed an HTTP failure that had
  not occurred. A discarded 4xx/5xx still yields `HttpStatusError` exactly as before.

Otherwise additive: nothing else was removed or narrowed.
